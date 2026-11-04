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

export async function post(
    client: OtariClient,
    path: string,
    payload: unknown,
    context: ToolContext,
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
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify(payload),
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
    return new ToolError({
        code: "otari_tool_http_error",
        message: `Otari refused ${path} with HTTP ${status}: ${detailOf(text)}`,
        hint:
            status === 401
                ? "The key was not accepted. Check it is a current Otari key, the one the model uses."
                : "Otari's own words are above. A 4xx is about this request and repeating it unchanged will fail the same way; a 5xx is worth one more try.",
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
