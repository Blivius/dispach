/**
 * `anthropic-messages`: Anthropic's native Messages API over hand-rolled `fetch` (decision 3.2).
 *
 * It exists for one reason the compatible endpoint cannot meet: **prompt caching**. Anthropic's
 * OpenAI-compatible endpoint caches nothing (11.153), so a direct Claude key paid full input price on
 * every step of a tool loop, while cache reads cost 0.05× input on Sonnet and Opus 5.5. Here the
 * prompt carries `cache_control` markers, at the same three positions Bedrock's Converse gets cache
 * points: the static prefix (breakpoint A), the active skill (B) and the rolling tail. That leaves one
 * of Anthropic's four.
 *
 * In core rather than a package like Bedrock (14.17), because 14.17's reason was the AWS SDK and its
 * credential chain. This needs neither: a static key named by `apiKeyEnv`, read on every request so a
 * rotated key needs no restart.
 *
 * The rest follows chat-completions: retries only before the first chunk, since a retry after output
 * has streamed would duplicate it; a 403 is never retried (an embedder may use it as its budget stop,
 * `fallback.ts`); and every failure is a `ModelError` carrying its status, which is what the fallback
 * chain reads.
 */

import { apiKeyMissing, ModelError, modelStreamMalformed, modelUnreachable } from "../errors.ts"
import type { ModelRoleConfig } from "../manifest/schema.ts"
import { trimTrailingSlashes } from "../text.ts"
import {
    backoffMs,
    DEFAULT_RETRY,
    RETRYABLE_STATUS,
    retryAfterMs,
    sleep,
} from "./chat-completions.ts"
import {
    adaptiveFields,
    conversationOrder,
    parseToolInput,
    refusesSampling,
    roleWarnings,
    thinkingStyle,
} from "./claude.ts"
import type { ChatChunk, ChatMessage, ChatRequest, ModelProvider } from "./provider.ts"
import { parseSSE, type SSEEvent } from "./sse.ts"
import type { ModelTransport } from "./transport.ts"

export const ANTHROPIC_MESSAGES_API = "anthropic-messages"

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
const DEFAULT_KEY_ENV = "ANTHROPIC_API_KEY"
/**
 * The API version this mapping was written against. A manifest's `headers` are spread after it, so a
 * role can pin a newer one without a release.
 */
const ANTHROPIC_VERSION = "2023-06-01"
/** Output a reply gets when no `maxTokens` was configured: the API requires `max_tokens`. */
const DEFAULT_MAX_TOKENS = 32_768
/** Anthropic allows four `cache_control` markers per request; more is a 400. */
const MAX_CACHE_MARKERS = 4

const EPHEMERAL = { type: "ephemeral" } as const

type Block = Record<string, unknown> & { type: string; cache_control?: typeof EPHEMERAL }
interface WireMessage {
    role: "user" | "assistant"
    content: Block[]
}

// ─── Request ────────────────────────────────────────────────────────────────────────────

function assistantBlocks(message: ChatMessage): Block[] {
    const blocks: Block[] = []
    for (const block of message.thinking ?? []) {
        if (block.redacted !== undefined) {
            blocks.push({ type: "redacted_thinking", data: block.redacted })
        } else if (block.signature !== undefined) {
            // Kept even when the text is empty: Haiku 5.5 omits the text by default and the signature
            // alone is what the API checks. An unsigned block is not replayable and is dropped.
            blocks.push({ type: "thinking", thinking: block.text, signature: block.signature })
        }
    }
    if (message.content !== "") blocks.push({ type: "text", text: message.content })
    for (const call of message.toolCalls ?? []) {
        blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: parseToolInput(call.arguments),
        })
    }
    return blocks
}

function wireOf(message: ChatMessage): WireMessage {
    if (message.role === "assistant")
        return { role: "assistant", content: assistantBlocks(message) }
    if (message.role === "tool") {
        return {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: message.toolCallId ?? "",
                    content: message.content === "" ? "(no output)" : message.content,
                },
            ],
        }
    }
    // A `system` message after the conversation started (the reminder, retrieved memory) has nowhere
    // to go but a user turn, fenced as Bedrock fences it (`model-bedrock/src/request.ts`): unfenced it
    // read as pasted, and inside `<system>` tags it read as an injection.
    const text =
        message.role === "system" && message.content !== ""
            ? `<runtime_context>\n${message.content}\n</runtime_context>`
            : message.content
    const content: Block[] = text === "" ? [] : [{ type: "text", text }]
    for (const image of message.images ?? []) {
        content.push({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.data },
        })
    }
    return { role: "user", content }
}

/** A thinking block cannot carry `cache_control`; the marker goes on the last block that can. */
function markLast(blocks: Block[]): boolean {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index] as Block
        if (block.type === "thinking" || block.type === "redacted_thinking") continue
        if (block.cache_control !== undefined) return false
        block.cache_control = EPHEMERAL
        return true
    }
    return false
}

/** The request body for one call. Pure, so the mapping is tested without a network. */
export function messagesBody(
    request: ChatRequest,
    config: ModelRoleConfig,
): Record<string, unknown> {
    const caching = config.capabilities?.promptCache !== "none"
    const system: Block[] = []
    const messages: WireMessage[] = []
    let markers = 0
    // Breakpoints A and B take at most three of the four, so the rolling tail always has one.
    const mark = (blocks: Block[]) => {
        if (caching && markers < MAX_CACHE_MARKERS - 1 && markLast(blocks)) markers += 1
    }

    let leading = true
    for (const message of conversationOrder(request.messages)) {
        if (leading && message.role === "system") {
            if (message.content !== "") system.push({ type: "text", text: message.content })
            if (message.cacheBreakpoint === true) mark(system)
            continue
        }
        leading = false
        const { role, content } = wireOf(message)
        if (content.length === 0) continue
        if (message.cacheBreakpoint === true) mark(content)
        const last = messages.at(-1)
        if (last !== undefined && last.role === role) last.content.push(...content)
        else messages.push({ role, content })
    }
    // The rolling marker (pilot.13 on Bedrock): every step of a tool loop then reads the earlier
    // steps from the cache instead of resending them at full price. It pays only because core keeps a
    // caching role's steps append-only (`traceAfterInput`).
    const tail = messages.at(-1)
    if (caching && tail !== undefined && markers < MAX_CACHE_MARKERS && markLast(tail.content)) {
        markers += 1
    }

    const style = thinkingStyle(request.model)
    const adaptive =
        style === "adaptive" ? adaptiveFields(request.model, request.reasoningEffort) : undefined
    const sampling = !refusesSampling(request.model)

    return {
        model: request.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(system.length === 0 ? {} : { system }),
        messages,
        stream: true,
        ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                  tools: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      input_schema: tool.parameters,
                  })),
              }),
        ...(sampling && request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
        ...(sampling && request.topP !== undefined ? { top_p: request.topP } : {}),
        ...(adaptive === undefined ? {} : adaptive.fields),
    }
}

// ─── Stream ─────────────────────────────────────────────────────────────────────────────

const FINISH: Record<string, string> = {
    end_turn: "stop",
    stop_sequence: "stop",
    tool_use: "tool_calls",
    max_tokens: "length",
    model_context_window_exceeded: "length",
    // The model's own safety classifier declining (Claude 5.5 and later), spelled as Bedrock spells it
    // so the loop ends the turn as `model_refused` rather than as an empty answer.
    refusal: "content_filter",
}

/** The HTTP status an in-stream error stands for, so it classifies like the response it replaces. */
const STREAM_ERROR_STATUS: Record<string, number> = {
    overloaded_error: 529,
    api_error: 500,
    rate_limit_error: 429,
    timeout_error: 408,
    request_too_large: 413,
    permission_error: 403,
    authentication_error: 401,
    not_found_error: 404,
    invalid_request_error: 400,
}

type Open =
    | { readonly kind: "tool"; readonly id: string; readonly name: string; input: string }
    | { readonly kind: "thinking"; text: string; signature?: string }
    | { readonly kind: "redacted"; readonly data: string }

interface Usage {
    input: number
    read: number | undefined
    write: number | undefined
    output: number
}

/** An `error` event inside a stream that had otherwise started. */
export class StreamFailure extends Error {
    readonly errorType: string
    readonly detail: string

    constructor(errorType: string, detail: string) {
        super(`${errorType}: ${detail}`)
        this.errorType = errorType
        this.detail = detail
    }
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readUsage(usage: Usage, raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return
    const shape = raw as Record<string, unknown>
    usage.input = num(shape.input_tokens) ?? usage.input
    usage.read = num(shape.cache_read_input_tokens) ?? usage.read
    usage.write = num(shape.cache_creation_input_tokens) ?? usage.write
    usage.output = num(shape.output_tokens) ?? usage.output
}

/**
 * Messages API events as `ChatChunk`s. Text and reasoning stream as deltas; a tool call and a signed
 * thinking block are emitted whole at their `content_block_stop`.
 *
 * **Usage.** Anthropic's `input_tokens` excludes cached tokens; the runtime's `promptTokens` is the
 * whole prompt, since that is what fills the window. So the prompt figure is input + cache read +
 * cache write, and the two cache figures travel beside it.
 */
export async function* messagesChunks(events: AsyncIterable<SSEEvent>): AsyncIterable<ChatChunk> {
    const open = new Map<number, Open>()
    const usage: Usage = { input: 0, read: undefined, write: undefined, output: 0 }
    let stop: string | undefined

    for await (const event of events) {
        const data = event.data.trim()
        if (data === "") continue
        let payload: Record<string, unknown>
        try {
            payload = JSON.parse(data) as Record<string, unknown>
        } catch (cause) {
            throw modelStreamMalformed(data, cause)
        }
        const index = num(payload.index) ?? 0

        switch (payload.type) {
            case "message_start":
                readUsage(usage, (payload.message as { usage?: unknown } | undefined)?.usage)
                break
            case "content_block_start": {
                const block = (payload.content_block ?? {}) as Record<string, unknown>
                if (block.type === "tool_use") {
                    open.set(index, {
                        kind: "tool",
                        id: String(block.id ?? ""),
                        name: String(block.name ?? ""),
                        input: "",
                    })
                } else if (block.type === "thinking") {
                    open.set(index, { kind: "thinking", text: "" })
                } else if (block.type === "redacted_thinking") {
                    open.set(index, { kind: "redacted", data: String(block.data ?? "") })
                }
                break
            }
            case "content_block_delta": {
                const delta = (payload.delta ?? {}) as Record<string, unknown>
                const block = open.get(index)
                if (delta.type === "text_delta" && typeof delta.text === "string") {
                    if (delta.text !== "") yield { type: "text", delta: delta.text }
                } else if (delta.type === "input_json_delta" && block?.kind === "tool") {
                    block.input += typeof delta.partial_json === "string" ? delta.partial_json : ""
                } else if (delta.type === "thinking_delta" && block?.kind === "thinking") {
                    const text = typeof delta.thinking === "string" ? delta.thinking : ""
                    if (text !== "") {
                        block.text += text
                        yield { type: "reasoning", delta: text }
                    }
                } else if (delta.type === "signature_delta" && block?.kind === "thinking") {
                    if (typeof delta.signature === "string") block.signature = delta.signature
                }
                break
            }
            case "content_block_stop": {
                const block = open.get(index)
                open.delete(index)
                if (block?.kind === "tool") {
                    yield {
                        type: "tool_call",
                        call: { id: block.id, name: block.name, arguments: block.input || "{}" },
                    }
                } else if (block?.kind === "thinking") {
                    yield {
                        type: "thinking_block",
                        block: {
                            text: block.text,
                            ...(block.signature === undefined
                                ? {}
                                : { signature: block.signature }),
                        },
                    }
                } else if (block?.kind === "redacted") {
                    yield { type: "thinking_block", block: { text: "", redacted: block.data } }
                }
                break
            }
            case "message_delta": {
                const delta = (payload.delta ?? {}) as Record<string, unknown>
                if (typeof delta.stop_reason === "string") stop = delta.stop_reason
                readUsage(usage, payload.usage)
                break
            }
            case "message_stop":
                yield {
                    type: "usage",
                    promptTokens: usage.input + (usage.read ?? 0) + (usage.write ?? 0),
                    completionTokens: usage.output,
                    ...(usage.read === undefined
                        ? {}
                        : {
                              cachedPromptTokens: usage.read,
                              cacheSource: "cache_read_input_tokens",
                          }),
                    ...(usage.write === undefined ? {} : { cacheWriteTokens: usage.write }),
                }
                yield { type: "finish", reason: FINISH[stop ?? "end_turn"] ?? stop ?? "stop" }
                return
            case "error": {
                const error = (payload.error ?? {}) as Record<string, unknown>
                throw new StreamFailure(
                    String(error.type ?? "api_error"),
                    String(error.message ?? ""),
                )
            }
            default:
                // `ping`, and any event type added after this was written.
                break
        }
    }
}

// ─── Retry ──────────────────────────────────────────────────────────────────────────────

/** One failed attempt, before anything reached the loop. */
export interface AttemptFailure {
    /** HTTP status; `0` when the endpoint was never reached (DNS, refused, reset). */
    readonly status: number
    /** Anthropic's `error.type`, from the response body or an in-stream `error` event. */
    readonly errorType?: string
    /** The `x-should-retry` header, when the API sent one: its own verdict on this failure. */
    readonly shouldRetry?: boolean
    /** The account cannot pay (`outOfCredit`): the same request fails until someone adds credit. */
    readonly outOfCredit?: boolean
}

/**
 * The three ways Anthropic says the account behind a key cannot pay, per its API errors reference: an
 * empty prepaid balance (a 400), a billing problem (402 `billing_error`), and the monthly spend cap
 * (a 429 with `enforced_spend_limit_reached` and no `retry-after`). None is the request's fault, and
 * none clears on a retry, so each ends the attempt and lets a fallback on another account answer.
 */
export function outOfCredit(status: number, body: string): boolean {
    if (status === 402) return true
    if (status === 400) return /credit balance is too low/i.test(body)
    if (status === 429) return body.includes("enforced_spend_limit_reached")
    return false
}

/**
 * Whether a failed attempt may be sent again, with backoff, on the same model. Asked only before the
 * first chunk reached the loop — after that a retry would duplicate output, so the caller never asks.
 * Attempts are counted by the caller (`RetryPolicy.attempts`); this decides only the kind of failure.
 *
 * In order:
 * - **403 never.** An embedder may revoke or cap a key as its budget stop, and a retry, even one
 *   the API invites with `x-should-retry`, would spend past it.
 * - **Out of credit never.** Every retry fails the same way until the account is topped up.
 * - **`x-should-retry` next.** It is the API's own verdict on this failure, and the official SDKs
 *   obey it both ways.
 * - **Otherwise by status.**
 *   - Retried: never reached (0), and the transient statuses chat-completions retries, plus 529
 *     (overloaded), which is Anthropic's own.
 *   - Final: a 400, 401, 404 or 413, because the same request fails the same way.
 */
export function retryable(failure: AttemptFailure): boolean {
    if (failure.status === 403 || failure.outOfCredit === true) return false
    if (failure.shouldRetry !== undefined) return failure.shouldRetry
    return failure.status === 0 || failure.status === 529 || RETRYABLE_STATUS.has(failure.status)
}

// ─── Transport ──────────────────────────────────────────────────────────────────────────

function messagesUrl(baseUrl: string | undefined): string {
    return `${trimTrailingSlashes(baseUrl ?? DEFAULT_BASE_URL)}/messages`
}

function errorType(body: string): string | undefined {
    try {
        const parsed = JSON.parse(body) as { error?: { type?: unknown } }
        return typeof parsed.error?.type === "string" ? parsed.error.type : undefined
    } catch {
        return undefined
    }
}

/** Claude refusing a replayed thinking block because something before it changed within the turn. */
const BOUND_ELSEWHERE = /bound to a different conversation/i

function hintFor(status: number, field: string, keyEnv: string): string {
    if (status === 401)
        return `Check the key in ${keyEnv} (${field}.apiKeyEnv): it must be a Claude API key from the Console, not a claude.ai login.`
    if (status === 403)
        return "The key lacks permission for this model or workspace. Not retried: an embedder may use a 403 as its budget stop."
    if (status === 404)
        return `The model id is not served by this endpoint. Check ${field}.id against Anthropic's model list, and that ${field}.baseUrl ends at /v1.`
    if (status === 413)
        return "The request is larger than the API accepts. Compaction should have prevented this; check the role's contextWindow."
    if (status === 400)
        return "Anthropic refused the request as sent. The body above says which field."
    return "Retried already where the failure allowed it. If this persists, Anthropic is overloaded or unavailable; a fallback role can take over."
}

export const ANTHROPIC_MESSAGES_TRANSPORT: ModelTransport = {
    // The registry's Claude rows say `promptCache: none`, which is true of the compatible endpoint
    // and false here. A manifest that set it keeps its value.
    capabilities: (resolved, config) =>
        config.capabilities?.promptCache === undefined && thinkingStyle(config.id) !== undefined
            ? { ...resolved, promptCache: "anthropic" as const }
            : resolved,
    warnings: (config, field) => [
        ...roleWarnings(config, field),
        // ponytail: budget-style thinking (Claude 4.6 and earlier) is not mapped here yet; Bedrock's
        // THINKING_BUDGET table moves to `claude.ts` when a role needs it on this transport.
        ...(thinkingStyle(config.id) === "budget" && config.reasoningEffort !== undefined
            ? [
                  {
                      code: "model_reasoning_unsupported",
                      message: `${config.id} takes a thinking budget, which the ${ANTHROPIC_MESSAGES_API} transport does not send yet, so ${field}.reasoningEffort has no effect.`,
                      hint: "Use a Claude 4.7 or later model, or the bedrock-converse transport, to set reasoning on this model.",
                      field: `${field}.reasoningEffort`,
                  },
              ]
            : []),
    ],
    create(context): ModelProvider {
        const { config, field } = context
        const url = messagesUrl(config.baseUrl)
        const policy = context.retry ?? DEFAULT_RETRY
        const doFetch = context.fetch ?? globalThis.fetch
        const keyEnv = config.apiKeyEnv ?? DEFAULT_KEY_ENV

        function fail(failure: AttemptFailure, body: string, retryAfter?: number): ModelError {
            const trimmed = body.length > 500 ? `${body.slice(0, 500)}…` : body
            return new ModelError({
                status: failure.status,
                ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter / 1000 }),
                code: failure.outOfCredit === true ? "model_out_of_credit" : "model_http_error",
                message: `Anthropic returned ${failure.status}${failure.errorType === undefined ? "" : ` (${failure.errorType})`} for ${url}: ${trimmed}`,
                hint:
                    failure.outOfCredit === true
                        ? `The account behind ${keyEnv} cannot pay: its credit is spent, its billing failed, or its monthly spend cap is reached. Not retried. Add credit or raise the cap in the Console, or give ${field} a fallback on a key from another organization.`
                        : hintFor(failure.status, field, keyEnv),
            })
        }

        async function* chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
            // Read before the loop, so a missing key is a config error and not three retries that end
            // as "cannot reach the endpoint". Still per request, so rotation needs no restart.
            const key = (context.env ?? process.env)[keyEnv]
            if (key === undefined || key === "") throw apiKeyMissing(keyEnv, `${field}.apiKeyEnv`)

            let body = messagesBody(request, config)
            let stripped = false
            for (let attempt = 1; ; attempt += 1) {
                if (signal.aborted) return
                let failure: AttemptFailure
                let detail = ""
                let retryAfter: number | undefined
                let started = false
                try {
                    const response = await doFetch(url, {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            accept: "text/event-stream",
                            "x-api-key": key,
                            "anthropic-version": ANTHROPIC_VERSION,
                            ...(config.headers ?? {}),
                        },
                        body: JSON.stringify(body),
                        signal,
                    })
                    if (!response.ok) {
                        detail = await response.text().catch(() => "")
                        retryAfter = retryAfterMs(response.headers.get("retry-after"))
                        const should = response.headers.get("x-should-retry")
                        const type = errorType(detail)
                        failure = {
                            status: response.status,
                            ...(type === undefined ? {} : { errorType: type }),
                            ...(should === null ? {} : { shouldRetry: should === "true" }),
                            ...(outOfCredit(response.status, detail) ? { outOfCredit: true } : {}),
                        }
                        // The documented recovery for a stale signed thinking block: send it again
                        // without thinking, once. Reported as a retry, so it is never silent.
                        if (response.status === 400 && !stripped && BOUND_ELSEWHERE.test(detail)) {
                            const without = withoutThinking(body)
                            if (without !== undefined) {
                                body = without
                                stripped = true
                                context.onRetry?.({ status: 400, attempt, delayMs: 0 })
                                continue
                            }
                        }
                    } else {
                        const type = response.headers.get("content-type") ?? ""
                        if (!type.includes("text/event-stream") || response.body === null) {
                            const text = await response.text().catch(() => "")
                            throw modelStreamMalformed(text, undefined)
                        }
                        for await (const chunk of messagesChunks(
                            parseSSE(iterate(response.body)),
                        )) {
                            if (signal.aborted) return
                            started = true
                            yield chunk
                        }
                        return
                    }
                } catch (error) {
                    if (signal.aborted) return
                    if (error instanceof StreamFailure) {
                        failure = {
                            status: STREAM_ERROR_STATUS[error.errorType] ?? 500,
                            errorType: error.errorType,
                        }
                        detail = error.detail
                    } else if (error instanceof ModelError) {
                        throw error
                    } else {
                        // Never reached the endpoint, or the connection broke before a chunk.
                        if (started || !retryable({ status: 0 }) || attempt >= policy.attempts) {
                            throw modelUnreachable(url, error)
                        }
                        const delayMs = backoffMs(policy, attempt)
                        context.onRetry?.({ status: 0, attempt, delayMs })
                        await sleep(delayMs, signal)
                        continue
                    }
                }
                if (started || !retryable(failure) || attempt >= policy.attempts) {
                    throw fail(failure, detail, retryAfter)
                }
                const delayMs = retryAfter ?? backoffMs(policy, attempt)
                context.onRetry?.({ status: failure.status, attempt, delayMs })
                await sleep(delayMs, signal)
            }
        }

        return { id: context.id, chat }
    },
}

/** The same body with every thinking block removed, or `undefined` when it carried none. */
function withoutThinking(body: Record<string, unknown>): Record<string, unknown> | undefined {
    let found = false
    const messages = (body.messages as WireMessage[])
        .map((message) => ({
            ...message,
            content: message.content.filter((block) => {
                const thinking = block.type === "thinking" || block.type === "redacted_thinking"
                found ||= thinking
                return !thinking
            }),
        }))
        .filter((message) => message.content.length > 0)
    return found ? { ...body, messages } : undefined
}

async function* iterate(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = body.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) return
            if (value !== undefined) yield value
        }
    } finally {
        reader.releaseLock()
    }
}
