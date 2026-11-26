/**
 * A `ChatRequest` as a ConverseStream input.
 *
 * Pure, and typed against the SDK with `import type` only, so it is testable and bundles without the
 * SDK itself. Converse differs from chat-completions in four ways that matter here:
 *
 * - **System is not a message.** The leading `system` messages become `system[]`. A `system` message
 *   after the conversation has started (the reminder, retrieved memory) becomes user text, since
 *   Converse has nowhere else to put it — its content is unchanged.
 * - **Roles must alternate.** Consecutive messages of one role are merged into one message, and a
 *   tool observation is a `toolResult` block in a user message.
 * - **Caching is explicit.** A `cachePoint` goes after each message assembly marked
 *   `cacheBreakpoint`, for a model family that caches; elsewhere it would be refused.
 * - **Thinking is replayed as content.** An assistant call carrying signed thinking sends it back as
 *   `reasoningContent` ahead of its text and tool use, which Anthropic models require with tool
 *   results.
 */

import type {
    ContentBlock,
    ConverseStreamCommandInput,
    Message,
    SystemContentBlock,
    ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime"
import {
    adaptiveFields,
    type ChatMessage,
    type ChatRequest,
    conversationOrder,
    type ModelRoleConfig,
    parseToolInput,
    refusesSampling,
    thinkingStyle,
} from "@dispach/core"

// Moved to core (`model/claude.ts`) when the native Messages transport needed them too; re-exported
// so this package's public surface is unchanged.
export { conversationOrder, roleWarnings, thinkingOff, thinkingStyle } from "@dispach/core"

const CACHE_POINT = { cachePoint: { type: "default" as const } }

/** `ImageBlock.format`, by the media type the loader sniffed. Raw bytes: the SDK encodes them. */
const IMAGE_FORMAT = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/gif": "gif",
    "image/webp": "webp",
} as const

/** The SDK's JSON document type. A parsed JSON value is one by construction. */
type Document = NonNullable<ToolUseBlock["input"]>

/** Families whose Bedrock models take `cachePoint` blocks. Anything else is sent none. */
export function cachesPrompts(modelId: string): boolean {
    return /(^|[./])anthropic\.claude|(^|[./])amazon\.nova/.test(modelId)
}

/** Anthropic models on Bedrock take extended thinking through `additionalModelRequestFields`. */
export function thinksWithBudget(modelId: string): boolean {
    return thinkingStyle(modelId) === "budget"
}

/** Output a reply gets when adaptive thinking is on and no `maxTokens` was configured. */
const ADAPTIVE_MAX_TOKENS = 32_768

/** `reasoningEffort` as an Anthropic thinking budget. `none` and unset mean no thinking requested. */
/** Output left for the answer after a thinking budget, when no `maxTokens` was configured. */
const ANSWER_HEADROOM = 16_384

const THINKING_BUDGET: Record<string, number> = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16_384,
}

function assistantContent(message: ChatMessage): ContentBlock[] {
    const blocks: ContentBlock[] = []
    for (const block of message.thinking ?? []) {
        blocks.push(
            block.redacted !== undefined
                ? {
                      reasoningContent: {
                          redactedContent: Uint8Array.from(Buffer.from(block.redacted, "base64")),
                      },
                  }
                : {
                      reasoningContent: {
                          reasoningText: {
                              text: block.text,
                              ...(block.signature === undefined
                                  ? {}
                                  : { signature: block.signature }),
                          },
                      },
                  },
        )
    }
    if (message.content !== "") blocks.push({ text: message.content })
    for (const call of message.toolCalls ?? []) {
        blocks.push({
            toolUse: {
                toolUseId: call.id,
                name: call.name,
                input: parseToolInput(call.arguments) as Document,
            },
        })
    }
    return blocks
}

function contentOf(message: ChatMessage): { role: "user" | "assistant"; content: ContentBlock[] } {
    if (message.role === "assistant")
        return { role: "assistant", content: assistantContent(message) }
    if (message.role === "tool") {
        return {
            role: "user",
            content: [
                {
                    toolResult: {
                        toolUseId: message.toolCallId ?? "",
                        content: [
                            { text: message.content === "" ? "(no output)" : message.content },
                        ],
                    },
                },
            ],
        }
    }
    // `user`, and a `system` message after the conversation started. Converse has no system role
    // past the top, so that one is sent as user text, fenced so it never reads as the person's words
    // (pilot.14): unfenced, a reminder merged with the input looked pasted. Not `<system>`: system tags
    // inside a user message are what an injection looks like, so the model came to distrust the whole
    // message, the person's own request included, and refused its owner (0.2.9).
    const text =
        message.role === "system" && message.content !== ""
            ? `<runtime_context>\n${message.content}\n</runtime_context>`
            : message.content
    const content: ContentBlock[] = text === "" ? [] : [{ text }]
    for (const image of message.images ?? []) {
        content.push({
            image: {
                format: IMAGE_FORMAT[image.mediaType],
                source: { bytes: Uint8Array.from(Buffer.from(image.data, "base64")) },
            },
        })
    }
    return { role: "user", content }
}

export function converseInput(
    request: ChatRequest,
    config: ModelRoleConfig,
): ConverseStreamCommandInput {
    const caching = cachesPrompts(request.model) && config.capabilities?.promptCache !== "none"
    const system: SystemContentBlock[] = []
    const messages: Message[] = []

    // Nova refuses a cachePoint in any message carrying a tool result (see the tail below). The
    // history's breakpoints can land on one — an observation, or a turn's input merged into it — so
    // the rule covers them too. Claude takes the point anywhere.
    const nova = /(^|[./])amazon\.nova/.test(request.model)
    const holdsToolResult = (blocks: readonly ContentBlock[] | undefined) =>
        (blocks ?? []).some((block) => block.toolResult !== undefined)
    let leading = true
    for (const message of conversationOrder(request.messages)) {
        if (leading && message.role === "system") {
            if (message.content !== "") system.push({ text: message.content })
            if (caching && message.cacheBreakpoint === true) system.push(CACHE_POINT)
            continue
        }
        leading = false
        const { role, content } = contentOf(message)
        if (content.length === 0) continue
        const last = messages.at(-1)
        const merging = last !== undefined && last.role === role
        if (
            caching &&
            message.cacheBreakpoint === true &&
            !(nova && (holdsToolResult(content) || (merging && holdsToolResult(last.content))))
        ) {
            content.push(CACHE_POINT)
        }
        if (merging) {
            // A tool result arriving into a Nova message that already holds a point takes it out again.
            const kept =
                nova && holdsToolResult(content)
                    ? (last.content ?? []).filter((block) => block.cachePoint === undefined)
                    : (last.content ?? [])
            last.content = [...kept, ...content]
        } else messages.push({ role, content })
    }
    // A rolling cache point at the end (pilot.13): each step of a tool loop then reads every
    // earlier step from the cache instead of resending it at full price. Measured on their Haiku 4.5:
    // 2.0M prompt tokens over 50 calls with 0.56M cached, the cached figure stuck at the static prefix.
    // It pays only because core keeps a caching role's steps append-only (`traceAfterInput`). The
    // third of Converse's four points, beside the static prefix and the skill.
    //
    // Not for Nova when that message carries a tool result: Nova refuses a cachePoint there ("extraneous
    // key [cachePoint] is not permitted", pilot.13, every native tool turn's second call),
    // while Claude takes it and read 99.7% of the step from the cache. Nova keeps its static prefix and
    // the tail of a turn's first call.
    const tail = messages.at(-1)
    const novaToolResult =
        /(^|[./])amazon\.nova/.test(request.model) &&
        (tail?.content ?? []).some((block) => block.toolResult !== undefined)
    if (
        caching &&
        tail !== undefined &&
        !novaToolResult &&
        tail.content?.at(-1)?.cachePoint === undefined
    ) {
        tail.content = [...(tail.content ?? []), CACHE_POINT]
    }

    const style = thinkingStyle(request.model)
    const effort = request.reasoningEffort
    const budget =
        style === "budget" && effort !== undefined
            ? THINKING_BUDGET[effort === "xhigh" || effort === "max" ? "high" : effort]
            : undefined
    const adaptive = style === "adaptive" ? adaptiveFields(request.model, effort) : undefined
    // Claude 4.7 and later and GPT-6 refuse a sampling setting, so it is never sent to them;
    // `warnings` says so at load.
    const sampling = budget === undefined && !refusesSampling(request.model)
    // Anthropic requires the output cap to exceed the thinking budget, and refuses a sampling
    // temperature beside it. The headroom past the budget is what the answer gets once thinking has
    // spent it: 4,096 cut long tool calls off mid-argument (pilot.4), so it is 16,384 —
    // under every thinking-capable Claude's output ceiling even at the `high` budget.
    const maxTokens =
        budget !== undefined
            ? Math.max(request.maxTokens ?? 0, budget + ANSWER_HEADROOM)
            : adaptive?.thinking === true
              ? (request.maxTokens ?? ADAPTIVE_MAX_TOKENS)
              : request.maxTokens
    const inference = {
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(!sampling || request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
        ...(!sampling || request.topP === undefined ? {} : { topP: request.topP }),
    }
    const extra =
        budget !== undefined
            ? { thinking: { type: "enabled", budget_tokens: budget } }
            : adaptive !== undefined
              ? (adaptive.fields as Record<string, Document>)
              : style === "openai" && effort !== undefined && effort !== "none"
                ? // Nested, as OpenAI's Responses API spells it. Probed on Bedrock (gpt-6-luna, 2026-10-05):
                  // a top-level `reasoning_effort` is a 400 `unknown_parameter`, and `reasoning.effort`
                  // is accepted. Whether it is honoured a one-word probe could not show.
                  { reasoning: { effort: effort === "minimal" ? "low" : effort } }
                : undefined

    return {
        modelId: request.model,
        messages,
        ...(system.length === 0 ? {} : { system }),
        ...(Object.keys(inference).length === 0 ? {} : { inferenceConfig: inference }),
        ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                  toolConfig: {
                      tools: request.tools.map((tool) => ({
                          toolSpec: {
                              name: tool.name,
                              description: tool.description,
                              inputSchema: { json: tool.parameters as Document },
                          },
                      })),
                  },
              }),
        ...(extra === undefined ? {} : { additionalModelRequestFields: extra }),
    }
}
