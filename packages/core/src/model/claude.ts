/**
 * What every Claude transport needs to know about a Claude model id, wherever it is served.
 *
 * Moved here from the Bedrock package when a second transport (`anthropic-messages`) needed the same
 * answers: which thinking style a version takes, how `none` is spelled, whether sampling is refused,
 * and the conversation order Anthropic's API requires. One copy, because these rules change with each
 * model release and two copies drift.
 *
 * Ids are matched bare (`claude-sonnet-5-5`, the native API), with a Bedrock prefix
 * (`eu.anthropic.claude-sonnet-4-6`) or behind a vendor path (`anthropic/claude-…`). The `openai.*`
 * branches are Bedrock's (it serves GPT-6 through the same Converse call) and stay because
 * `roleWarnings` covers both.
 */

import type { ErrorDetail } from "../errors.ts"
import type { ModelRoleConfig } from "../manifest/schema.ts"
import type { ChatMessage, ChatRequest } from "./provider.ts"

/** A Claude model's family and version, from any of the id spellings above. */
function claudeVersion(
    modelId: string,
): { readonly family: string; readonly version: number } | undefined {
    // Current ids put the family first (`claude-opus-5-5`, `claude-sonnet-4-20250514-v1:0`); older ones
    // put it last (`claude-3-7-sonnet-20250219-v1:0`). A dated suffix is not a minor version.
    const current =
        /(?:^|[./])(?:anthropic\.)?claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(
            modelId,
        )
    if (current !== null) {
        const minor = Number(current[3] ?? "0")
        return {
            family: current[1] ?? "",
            version: Number(current[2]) + (minor < 100 ? minor / 10 : 0),
        }
    }
    const older = /(?:^|[./])(?:anthropic\.)?claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)/.exec(
        modelId,
    )
    if (older !== null) {
        return { family: older[3] ?? "", version: Number(older[1]) + Number(older[2] ?? "0") / 10 }
    }
    return /(?:^|[./])(?:anthropic\.)?claude/.test(modelId) ? { family: "", version: 0 } : undefined
}

/**
 * How a model takes reasoning: a Claude token budget, Claude's adaptive thinking with an effort, or
 * an `openai.*` effort (Bedrock). Adaptive from 4.7, the first version that refuses a budget with a
 * 400; 4.6 still accepts one (deprecated), so its requests stay exactly as they were. Haiku stayed on
 * a budget through 4.5; Haiku 5.5 is adaptive and refuses a budget (pilot.17: `"thinking.type.enabled"
 * is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"`).
 */
export function thinkingStyle(modelId: string): "budget" | "adaptive" | "openai" | undefined {
    if (/(^|[./])openai\./.test(modelId)) return "openai"
    const claude = claudeVersion(modelId)
    if (claude === undefined) return undefined
    if (claude.family === "fable" || claude.family === "mythos") return "adaptive"
    if (claude.family === "haiku") return claude.version >= 5.5 ? "adaptive" : "budget"
    return claude.version >= 4.7 ? "adaptive" : "budget"
}

/**
 * How `reasoningEffort: none` is spelled for an adaptive Claude model, which differs by model: most
 * accept `disabled`, Sonnet 5.5 refuses it and turns thinking off with `between_tools`, and Opus 5.5,
 * Fable and Mythos cannot turn it off at all, so `none` runs at the lowest effort instead.
 */
export function thinkingOff(modelId: string): "disabled" | "between_tools" | "low" {
    const claude = claudeVersion(modelId)
    if (claude === undefined) return "disabled"
    if (claude.family === "fable" || claude.family === "mythos") return "low"
    if (claude.family === "opus" && claude.version >= 5.5) return "low"
    if (claude.family === "sonnet" && claude.version >= 5.5) return "between_tools"
    return "disabled"
}

/**
 * Whether the model refuses `temperature` and `topP`. Claude 4.7 and later (Sonnet 5.5 a non-default
 * value), and GPT-6 on Bedrock (pilot.6: "This model doesn't support the temperature field" on
 * every turn of `global.openai.gpt-6-luna`). Other `openai.*` models, gpt-oss among them, still take
 * both.
 */
export function refusesSampling(modelId: string): boolean {
    return thinkingStyle(modelId) === "adaptive" || /(^|[./])openai\.gpt-6/.test(modelId)
}

/**
 * What a Claude transport adjusts in a role's config, said at load rather than discovered as a 400 or
 * as a setting that quietly did nothing.
 */
export function roleWarnings(config: ModelRoleConfig, field: string): readonly ErrorDetail[] {
    const warnings: ErrorDetail[] = []
    if (
        thinkingStyle(config.id) === "adaptive" &&
        config.reasoningEffort === "none" &&
        thinkingOff(config.id) === "low"
    ) {
        warnings.push({
            code: "model_thinking_always_on",
            message: `${config.id} cannot turn thinking off, so ${field}.reasoningEffort: none runs at low effort.`,
            hint: `Set ${field}.reasoningEffort: low to say so explicitly, which also silences this.`,
            field: `${field}.reasoningEffort`,
        })
    }
    if (
        refusesSampling(config.id) &&
        (config.temperature !== undefined || config.topP !== undefined)
    ) {
        warnings.push({
            code: "model_sampling_unsupported",
            message: `${config.id} does not accept temperature or topP, so ${field} sends neither.`,
            hint: `Remove temperature and topP from ${field}; steer this model with reasoningEffort instead.`,
            field,
        })
    }
    return warnings
}

/**
 * Adaptive thinking's request fields for one effort. `thinking` is whether thinking stays on, which
 * decides the output headroom. Unset effort sends nothing: the model's own default.
 */
export function adaptiveFields(
    modelId: string,
    effort: ChatRequest["reasoningEffort"],
): { readonly fields: Record<string, unknown>; readonly thinking: boolean } | undefined {
    if (effort === undefined) return undefined
    if (effort === "none") {
        const off = thinkingOff(modelId)
        if (off === "low") {
            return {
                fields: { thinking: { type: "adaptive" }, output_config: { effort: "low" } },
                thinking: true,
            }
        }
        return { fields: { thinking: { type: off } }, thinking: false }
    }
    return {
        fields: {
            thinking: { type: "adaptive" },
            output_config: { effort: effort === "minimal" ? "low" : effort },
        },
        thinking: true,
    }
}

/**
 * A tool call's raw argument text as the JSON object Anthropic's `tool_use.input` must be. A
 * malformed document still has to reach the model as the call it made; the loop's own coercion has
 * already reported it.
 */
export function parseToolInput(raw: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(raw === "" ? "{}" : raw)
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed }
    } catch {
        return { raw }
    }
}

/**
 * The messages with the turn's input moved ahead of its own trace when they would otherwise open with
 * the assistant. Assembly puts the input last, after the calls and observations of the turn so far,
 * so on a fresh session's second step the first non-system message is the model's own call, and
 * Converse refuses that for Nova ("A conversation must start with a user message", pilot.5)
 * and tolerates it for Claude when the call is a `toolUse`. Moved in both cases, so every model gets
 * the canonical order (the question, the call, the result); a request that already opened with the
 * user is unchanged.
 */
export function conversationOrder(messages: readonly ChatMessage[]): readonly ChatMessage[] {
    const first = messages.findIndex((message) => message.role !== "system")
    if (first === -1 || messages[first]?.role === "user") return messages
    const input = messages.findIndex((message) => message.turnInput === true)
    if (input === -1 || input < first) return messages
    const moved = messages[input] as ChatMessage
    return [
        ...messages.slice(0, first),
        moved,
        ...messages.slice(first, input),
        ...messages.slice(input + 1),
    ]
}
