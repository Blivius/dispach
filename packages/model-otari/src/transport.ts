/**
 * `otari`: Mozilla.ai's gateway as a model transport.
 *
 * **It is chat-completions underneath, on purpose.** Otari speaks the same wire, so this wraps core's
 * `createChatCompletionsProvider` with an injected `fetch` rather than owning a second HTTP client:
 * retries, the `stream_options` downgrade, SSE parsing and tool-call reassembly stay in the one place
 * that already does them. What the wrapper adds is everything that is a fact about *Otari* rather than
 * about the wire, which is why it lives here and not as body fields core would send to every endpoint
 * (decisions 3.3 and 14.119: an unknown key is a 400 somewhere else).
 *
 * - **Out:** `guardrails` from the role's options, and `metadata` tags — the role is always one — so
 *   Otari's usage splits spend per role without the dashboard being told anything.
 * - **In:** `Otari-Fallback` becomes a `{type: "model"}` chunk naming the provider and model that
 *   actually served the call, so a gateway fallback is visible where a Dispach fallback already is.
 * - **Refusals:** a spent budget, a guardrail block and an empty wallet are each a different thing to
 *   do next, and a bare "403 for https://…" says none of them. They keep their status, so the fallback
 *   chain still refuses to move past a 403 (decision 14.19): a budget stop is a stop.
 */

import {
    ConfigError,
    createChatCompletionsProvider,
    type FetchLike,
    isHarnessError,
    ModelError,
    type ModelProvider,
    type ModelTransport,
} from "@dispach/core"

/** Hosted Otari. The live server answers 404 on `/v1`; the hosted quickstart that says `/v1` is stale. */
export const OTARI_BASE_URL = "https://api.otari.ai/api/v1"

/** The variable a role reads its key from when it names none. */
export const OTARI_KEY_ENV = "OTARI_API_KEY"

export interface OtariGuardrail {
    /** A profile configured in the Otari workspace, e.g. `lakera-guard`. */
    readonly profile: string
    /** `block` refuses before any model sees the request; `monitor` only reports. Otari's default is `monitor`. */
    readonly mode?: "monitor" | "block"
}

export interface OtariOptions {
    readonly guardrails?: readonly OtariGuardrail[]
    /** Extra usage tags, sent as `metadata`. `role` is always added and cannot be overridden. */
    readonly tags?: Readonly<Record<string, string>>
}

/** Otari caps `metadata` at 16 string pairs, and `role` takes one. */
const MAX_TAGS = 15

type Parsed =
    | { readonly success: true; readonly data: OtariOptions }
    | {
          readonly success: false
          readonly error: { readonly issues: readonly { readonly message: string }[] }
      }

function refuse(message: string): Parsed {
    return { success: false, error: { issues: [{ message }] } }
}

const optionsSchema = {
    safeParse(value: unknown): Parsed {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return refuse("options must be a map (takes guardrails, tags)")
        }
        const record = value as Record<string, unknown>
        const unknownKey = Object.keys(record).find((key) => key !== "guardrails" && key !== "tags")
        if (unknownKey !== undefined) {
            return refuse(`unknown option "${unknownKey}" (takes guardrails, tags)`)
        }
        const guardrails: OtariGuardrail[] = []
        if (record.guardrails !== undefined) {
            if (!Array.isArray(record.guardrails)) return refuse("guardrails must be a list")
            for (const entry of record.guardrails as unknown[]) {
                const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
                    string,
                    unknown
                >
                if (typeof item.profile !== "string" || item.profile === "") {
                    return refuse("each guardrail needs a profile, e.g. lakera-guard")
                }
                if (item.mode !== undefined && item.mode !== "monitor" && item.mode !== "block") {
                    return refuse(`guardrail mode is monitor or block, not "${String(item.mode)}"`)
                }
                const extra = Object.keys(item).find((key) => key !== "profile" && key !== "mode")
                if (extra !== undefined) {
                    return refuse(`unknown guardrail field "${extra}" (takes profile, mode)`)
                }
                guardrails.push({
                    profile: item.profile,
                    ...(item.mode === undefined ? {} : { mode: item.mode }),
                })
            }
        }
        let tags: Record<string, string> | undefined
        if (record.tags !== undefined) {
            if (
                typeof record.tags !== "object" ||
                record.tags === null ||
                Array.isArray(record.tags)
            ) {
                return refuse("tags must be a map of strings")
            }
            const entries = Object.entries(record.tags as Record<string, unknown>)
            if (entries.length > MAX_TAGS) {
                return refuse(`at most ${MAX_TAGS} tags; Otari takes 16 and role is one`)
            }
            const bad = entries.find(([, tag]) => typeof tag !== "string")
            if (bad !== undefined) return refuse(`tag "${bad[0]}" must be a string`)
            tags = Object.fromEntries(entries) as Record<string, string>
        }
        return {
            success: true,
            data: {
                ...(guardrails.length === 0 ? {} : { guardrails }),
                ...(tags === undefined ? {} : { tags }),
            },
        }
    },
}

/** What one call's response said about itself, read off the wire before core parses it. */
interface Seen {
    provider?: string
    model?: string
    fallback?: boolean
    refusal?: Refusal
}

interface Refusal {
    readonly status: number
    readonly code: string
    readonly message: string
    readonly scope?: string
    readonly retryAfterSeconds?: number
    readonly profiles?: readonly string[]
}

/** `guardrail profile 'x' could not be evaluated` and `… requested but no guardrails service is configured`. */
const UNAVAILABLE =
    /guardrail profile '([^']+)' (?:could not be evaluated|requested but no guardrails service)/

/**
 * Otari's error body is `{detail, code}` per its docs and `{detail: {message, code, guardrails}}` for a
 * guardrail block, measured against the live API on 2026-11-04. Both shapes are read; anything else
 * leaves the refusal undefined, and core's own error stands.
 */
export function readRefusal(status: number, headers: Headers, text: string): Refusal | undefined {
    let body: unknown
    try {
        body = JSON.parse(text)
    } catch {
        return undefined
    }
    const top = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>
    const detail = top.detail
    const nested = (typeof detail === "object" && detail !== null ? detail : {}) as Record<
        string,
        unknown
    >
    const message =
        typeof detail === "string"
            ? detail
            : typeof nested.message === "string"
              ? nested.message
              : ""
    // A guardrail Otari could not run answers 502 with prose and no code (measured 2026-11-04), so
    // the profile is read out of the sentence. Anything else without a code stays core's error.
    const unavailable = UNAVAILABLE.exec(message)
    const code =
        headers.get("otari-error-code") ??
        top.code ??
        nested.code ??
        (unavailable === null ? undefined : "guardrail_unavailable")
    if (typeof code !== "string") return undefined
    const scope = headers.get("otari-budget-scope") ?? undefined
    const after = Number(headers.get("retry-after"))
    const profiles = Array.isArray(nested.guardrails)
        ? (nested.guardrails as unknown[])
              .map((entry) => (entry as { profile?: unknown } | null)?.profile)
              .filter((profile): profile is string => typeof profile === "string")
        : unavailable?.[1] === undefined
          ? undefined
          : [unavailable[1]]
    return {
        status,
        code,
        message,
        ...(scope === undefined ? {} : { scope }),
        ...(Number.isFinite(after) && after > 0 ? { retryAfterSeconds: after } : {}),
        ...(profiles === undefined || profiles.length === 0 ? {} : { profiles }),
    }
}

/** The error a refusal becomes, or `undefined` for a code with nothing more useful to say than core's. */
export function refusalError(refusal: Refusal, field: string): ModelError | undefined {
    const said = refusal.message === "" ? "" : ` Otari said: ${refusal.message}`
    const base = {
        status: refusal.status,
        ...(refusal.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: refusal.retryAfterSeconds }),
    }
    switch (refusal.code) {
        case "budget_exceeded": {
            const scope = refusal.scope ?? "an"
            const reset =
                refusal.retryAfterSeconds === undefined
                    ? ""
                    : ` Otari says it resets in ${Math.round(refusal.retryAfterSeconds)} s.`
            return new ModelError({
                ...base,
                code: "otari_budget_exceeded",
                message: `Otari refused the call: ${scope} budget is spent.${said}`,
                hint: `Raise or reset the ceiling under Spend & Budgets in the Otari dashboard, or wait for the period to roll over.${reset} No fallback model is tried: a spent budget is a stop, not an outage.`,
                field,
            })
        }
        case "guardrail_violation": {
            const profiles =
                refusal.profiles === undefined ? "a guardrail" : refusal.profiles.join(", ")
            return new ModelError({
                ...base,
                code: "otari_guardrail_violation",
                message: `Otari's guardrail blocked the request before any model saw it (${profiles}).${said}`,
                hint: `The block is the guardrail working. If it is wrong for this agent, set mode: monitor on that profile in ${field}.options.guardrails to report without blocking.`,
                field: `${field}.options.guardrails`,
            })
        }
        case "guardrail_unavailable": {
            const profiles =
                refusal.profiles === undefined ? "a guardrail" : refusal.profiles.join(", ")
            // **No status, on purpose.** Otari sends 502, and a 502 is what moves a fallback chain on
            // (decision 14.19). Here that would be a bypass, not a recovery: a fallback on another
            // endpoint answers the request the guardrail was configured to refuse unchecked.
            return new ModelError({
                code: "otari_guardrail_unavailable",
                message: `Otari could not run the guardrail (${profiles}), and the request was refused rather than served unchecked.${said}`,
                hint: "Check the guardrail in the Otari dashboard: its vendor key, and that the profile's Parameters (JSON) holds only fields that vendor takes — an unknown one fails every check. Lakera takes no threshold; its strictness is a Lakera project's policy.",
                field: `${field}.options.guardrails`,
            })
        }
        case "insufficient_funds":
            return new ModelError({
                ...base,
                code: "otari_insufficient_funds",
                message: `Otari refused the call: the organisation's balance is empty.${said}`,
                hint: "Top up the organisation's balance in the Otari dashboard under Billing. No fallback model is tried, because every model on this gateway draws on the same balance.",
                field,
            })
        default:
            return undefined
    }
}

/** The role a provider id names: `otari:main` → `main`. */
function roleOf(id: string): string {
    const colon = id.indexOf(":")
    return colon === -1 ? id : id.slice(colon + 1)
}

/** The request body with Otari's own fields added, or unchanged when it is not a JSON object. */
export function shapeBody(body: string, options: OtariOptions, role: string): string {
    let parsed: unknown
    try {
        parsed = JSON.parse(body)
    } catch {
        return body
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return body
    return JSON.stringify({
        ...parsed,
        metadata: { ...(options.tags ?? {}), role },
        ...(options.guardrails === undefined ? {} : { guardrails: options.guardrails }),
    })
}

export function otariTransport(): ModelTransport {
    return {
        optionsSchema,
        create(context): ModelProvider {
            const options = (context.options ?? {}) as OtariOptions
            const role = roleOf(context.id)
            const base = context.fetch ?? fetch
            /** Keyed by the per-call signal, so two concurrent calls on one role cannot read each other. */
            const seen = new WeakMap<AbortSignal, Seen>()

            const otariFetch: FetchLike = async (input, init) => {
                const body =
                    typeof init?.body === "string"
                        ? shapeBody(init.body, options, role)
                        : init?.body
                const response = await base(input, { ...init, body })
                const signal = init?.signal
                if (signal === undefined || signal === null) return response
                const record: Seen = seen.get(signal) ?? {}
                seen.set(signal, record)
                const provider = response.headers.get("otari-provider")
                const model = response.headers.get("otari-model")
                if (provider !== null) record.provider = provider
                if (model !== null) record.model = model
                record.fallback = response.headers.get("otari-fallback") === "true"
                if (!response.ok) {
                    const text = await response
                        .clone()
                        .text()
                        .catch(() => "")
                    const refusal = readRefusal(response.status, response.headers, text)
                    if (refusal !== undefined) record.refusal = refusal
                }
                return response
            }

            if (context.config.baseUrl !== undefined && context.config.baseUrl.trim() === "") {
                throw new ConfigError({
                    code: "manifest_base_url_invalid",
                    message: `${context.field}.baseUrl is empty.`,
                    hint: `Leave it out for hosted Otari (${OTARI_BASE_URL}), or give a self-hosted gateway's URL ending at /api/v1.`,
                    field: `${context.field}.baseUrl`,
                })
            }

            const inner = createChatCompletionsProvider({
                id: context.id,
                field: context.field,
                baseUrl: context.config.baseUrl ?? OTARI_BASE_URL,
                apiKeyEnv: context.config.apiKeyEnv ?? OTARI_KEY_ENV,
                fetch: otariFetch,
                ...(context.config.headers === undefined
                    ? {}
                    : { headers: context.config.headers }),
                ...(context.config.streamUsage === undefined
                    ? {}
                    : { streamUsage: context.config.streamUsage }),
                ...(context.env === undefined ? {} : { env: context.env }),
                ...(context.onRetry === undefined ? {} : { onRetry: context.onRetry }),
                ...(context.onUsageUnsupported === undefined
                    ? {}
                    : { onUsageUnsupported: context.onUsageUnsupported }),
                ...(context.retry === undefined ? {} : { retry: context.retry }),
            })

            return {
                id: context.id,
                async *chat(request, signal) {
                    // A signal of this call's own, so the record above cannot be shared with another call.
                    const local = AbortSignal.any([signal])
                    let announced = false
                    try {
                        for await (const chunk of inner.chat(request, local)) {
                            if (!announced) {
                                announced = true
                                const record = seen.get(local)
                                if (record?.fallback === true && record.model !== undefined) {
                                    const served =
                                        record.provider === undefined
                                            ? record.model
                                            : `${record.provider}:${record.model}`
                                    yield { type: "model", id: served }
                                }
                            }
                            yield chunk
                        }
                    } catch (error) {
                        const refusal = seen.get(local)?.refusal
                        const mapped =
                            refusal !== undefined && isHarnessError(error)
                                ? refusalError(refusal, context.field)
                                : undefined
                        throw mapped ?? error
                    }
                },
            }
        },
    }
}
