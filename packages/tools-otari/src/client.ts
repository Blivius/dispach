/**
 * One authenticated POST to Otari, shared by every tool here.
 *
 * Refusals are read by `model-otari`'s own `readRefusal`, so a spent budget or a guardrail block says
 * the same thing whether a model call or a tool call hit it — two readers of one wire would drift.
 * Never retried here: a search is billed per call and a code run may have side effects in its
 * sandbox, so a second attempt is the model's decision, made after it has read why the first failed.
 */

import { type ToolContext, ToolError } from "@dispach/core"
import { readRefusal, refusalError } from "@dispach/model-otari"

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OtariClient {
    readonly baseUrl: string
    readonly apiKeyEnv: string
    readonly env: Readonly<Record<string, string | undefined>>
    readonly fetch: FetchLike
}

/** Kept under the harness's deadline, so the tool reports a timeout before it is abandoned. */
const DEADLINE_MARGIN_MS = 3_000

export interface Posted {
    readonly body: unknown
    readonly headers: Headers
}

/** What a call needs from its caller: a tool's context, or a refresh's own signal and deadline. */
export type CallScope = Pick<ToolContext, "signal" | "deadlineMs">

export function post(
    client: OtariClient,
    path: string,
    payload: unknown,
    context: CallScope,
    capMs: number,
): Promise<Posted> {
    return request(client, "POST", path, payload, context, capMs)
}

export function get(
    client: OtariClient,
    path: string,
    context: CallScope,
    capMs: number,
): Promise<Posted> {
    return request(client, "GET", path, undefined, context, capMs)
}

async function request(
    client: OtariClient,
    method: "GET" | "POST",
    path: string,
    payload: unknown,
    context: CallScope,
    capMs: number,
): Promise<Posted> {
    const key = client.env[client.apiKeyEnv] ?? ""
    if (key === "") {
        throw new ToolError({
            code: "otari_key_missing",
            message: `${client.apiKeyEnv} is not set, so Otari cannot be called.`,
            hint: `Set ${client.apiKeyEnv} in the agent's .env (the same key the model uses with api: otari), then restart the agent.`,
        })
    }

    const controller = new AbortController()
    const abort = () => controller.abort()
    context.signal.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(
        abort,
        Math.min(capMs, Math.max(1_000, context.deadlineMs - DEADLINE_MARGIN_MS)),
    )
    try {
        const response = await client.fetch(`${client.baseUrl}${path}`, {
            method,
            headers: {
                authorization: `Bearer ${key}`,
                ...(payload === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) throw failure(response.status, response.headers, text, path)
        try {
            return { body: JSON.parse(text) as unknown, headers: response.headers }
        } catch {
            throw new ToolError({
                code: "otari_response_unreadable",
                message: `Otari answered ${path} with something that is not JSON.`,
                hint: "Usually a proxy or an outage page in front of the gateway. Try again in a moment; if it persists, check status.otari.ai.",
            })
        }
    } catch (error) {
        if (controller.signal.aborted && !context.signal.aborted) {
            throw new ToolError({
                code: "otari_tool_timeout",
                message: `Otari did not answer ${path} in time.`,
                hint: "The call was abandoned before the turn's own deadline. Try a smaller piece of work, or raise limits.toolTimeoutMs.",
            })
        }
        throw error
    } finally {
        clearTimeout(timer)
        context.signal.removeEventListener("abort", abort)
    }
}

/** A refusal Otari named (budget, guardrail, balance) keeps its own code; anything else says the status. */
export function failure(status: number, headers: Headers, text: string, path: string): ToolError {
    const refusal = readRefusal(status, headers, text)
    const named = refusal === undefined ? undefined : refusalError(refusal, "tools.providers.otari")
    if (named !== undefined) {
        return new ToolError({ code: named.code, message: named.message, hint: named.hint })
    }
    const mcp = mcpFailure(status, text, path)
    if (mcp !== undefined) return mcp
    return new ToolError({
        code: "otari_tool_http_error",
        message: `Otari refused ${path} with HTTP ${status}: ${detailOf(text)}`,
        hint:
            status === 401
                ? "The key was not accepted. Check it is a current Otari key, the one the model uses."
                : "Otari's own words are above. A 4xx is about this request and repeating it unchanged will fail the same way; a 5xx is worth one more try.",
    })
}

/**
 * Otari's MCP routes say on every error whether the call was dispatched (`execution_state`). The one
 * that matters is `outcome_unknown`: the tool may have run, so this must never read as an ordinary
 * failure the model would simply repeat — Otari does not deduplicate, and neither does this.
 */
function mcpFailure(status: number, text: string, path: string): ToolError | undefined {
    let body: { code?: unknown; execution_state?: unknown }
    try {
        body = JSON.parse(text) as typeof body
    } catch {
        return undefined
    }
    if (typeof body.execution_state !== "string") return undefined
    const code = typeof body.code === "string" ? body.code : "unknown"
    if (body.execution_state === "outcome_unknown") {
        return new ToolError({
            code: "otari_mcp_outcome_unknown",
            message: `The MCP call through Otari was sent and no result came back (${code}, HTTP ${status}). It may or may not have taken effect.`,
            hint: "Do not repeat it blindly: if the tool changes something, check whether the change happened first. A read-only tool is safe to call again.",
        })
    }
    return new ToolError({
        code: `otari_${code}`,
        message: `Otari refused ${path} before running anything: ${detailOf(text)} (${code}, HTTP ${status}).`,
        hint:
            code === "mcp_server_changed"
                ? "The server's settings changed in the Otari dashboard since this agent read its tools. Restart the agent (or run `tools --warm`) so it reads them again."
                : code === "mcp_server_not_found"
                  ? "The server id in tools.providers.otari.mcp names no enabled server in this key's workspace. Check it under Tools → MCP servers in the Otari dashboard."
                  : code === "mcp_tool_not_allowed"
                    ? "The server's allowlist in the Otari dashboard leaves this tool out. Add it there, or unpin it here."
                    : "Nothing ran, so this is safe to retry once the cause is fixed.",
    })
}

export function detailOf(text: string): string {
    try {
        const body = JSON.parse(text) as { detail?: unknown }
        if (typeof body.detail === "string") return body.detail
        if (typeof body.detail === "object" && body.detail !== null) {
            const message = (body.detail as { message?: unknown }).message
            if (typeof message === "string") return message
        }
    } catch {
        // Not JSON: the text itself, bounded.
    }
    return text.slice(0, 300)
}
