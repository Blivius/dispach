/**
 * `otari` against a recorded gateway: the body Otari would receive, the chunks the loop would see, the
 * refusals as errors that name their cause, and one real turn through the runtime. Response shapes are
 * the ones the live API returned on 2026-11-04, not the ones its docs describe where the two differ.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    BRAND,
    type ChatChunk,
    type FetchLike,
    isHarnessError,
    type ModelProvider,
    Runtime,
} from "@dispach/core"
import { OTARI_BASE_URL, otariTransport } from "../src/index.ts"

interface Sent {
    readonly url: string
    readonly headers: Record<string, string>
    readonly body: Record<string, unknown>
}

function sse(frames: readonly unknown[], headers: Record<string, string> = {}): Response {
    const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`
    return new Response(text, {
        status: 200,
        headers: { "content-type": "text/event-stream", ...headers },
    })
}

const REPLY = [
    { choices: [{ delta: { content: "pong" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 19, completion_tokens: 7, cost_usd: "0.000007" } },
]

function recording(respond: (sent: Sent) => Response): { fetch: FetchLike; sent: Sent[] } {
    const sent: Sent[] = []
    const fake: FetchLike = async (input, init) => {
        const record = {
            url: String(input),
            headers: { ...(init?.headers as Record<string, string>) },
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        }
        sent.push(record)
        return respond(record)
    }
    return { fetch: fake, sent }
}

function provider(fetch: FetchLike, options?: unknown, role = "main"): ModelProvider {
    const transport = otariTransport()
    const parsed = options === undefined ? undefined : transport.optionsSchema?.safeParse(options)
    if (parsed !== undefined && !parsed.success)
        throw new Error("options refused in a test fixture")
    return transport.create({
        id: `otari:${role}`,
        field: `model.${role}`,
        config: { id: "z-ai/glm-5.3-flash", api: "otari" },
        options: parsed?.data,
        env: { OTARI_API_KEY: "otk_test" },
        fetch,
        retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
    })
}

async function collect(stream: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
    const out: ChatChunk[] = []
    for await (const chunk of stream) out.push(chunk)
    return out
}

async function failure(stream: AsyncIterable<ChatChunk>): Promise<unknown> {
    try {
        await collect(stream)
    } catch (error) {
        return error
    }
    throw new Error("expected the call to fail")
}

const PING = { model: "z-ai/glm-5.3-flash", messages: [{ role: "user" as const, content: "ping" }] }

describe("the request Otari receives", () => {
    test("hosted Otari by default, the key from OTARI_API_KEY, and the role as a usage tag", async () => {
        const { fetch, sent } = recording(() => sse(REPLY))
        await collect(provider(fetch).chat(PING, new AbortController().signal))

        expect(sent[0]?.url).toBe(`${OTARI_BASE_URL}/chat/completions`)
        expect(sent[0]?.headers.authorization).toBe("Bearer otk_test")
        expect(sent[0]?.body.metadata).toEqual({ role: "main" })
        expect(sent[0]?.body.guardrails).toBeUndefined()
        // Core's own fields are untouched by the reshaping.
        expect(sent[0]?.body.model).toBe("z-ai/glm-5.3-flash")
        expect(sent[0]?.body.stream_options).toEqual({ include_usage: true })
    })

    test("guardrails and tags from the role's options; role cannot be overridden by a tag", async () => {
        const { fetch, sent } = recording(() => sse(REPLY))
        const options = {
            guardrails: [{ profile: "lakera-guard", mode: "block" }],
            tags: { app: "support", role: "spoofed" },
        }
        await collect(
            provider(fetch, options, "compactor").chat(PING, new AbortController().signal),
        )

        expect(sent[0]?.body.guardrails).toEqual([{ profile: "lakera-guard", mode: "block" }])
        expect(sent[0]?.body.metadata).toEqual({ app: "support", role: "compactor" })
    })

    test("options are checked at load, naming what is wrong", () => {
        const schema = otariTransport().optionsSchema
        const reason = (value: unknown) => {
            const parsed = schema?.safeParse(value)
            return parsed?.success === false ? parsed.error.issues?.[0]?.message : "accepted"
        }
        expect(reason({ guardrail: [] })).toContain('unknown option "guardrail"')
        expect(reason({ guardrails: [{ mode: "block" }] })).toContain("needs a profile")
        expect(reason({ guardrails: [{ profile: "x", mode: "deny" }] })).toContain(
            "monitor or block",
        )
        expect(reason({ tags: { a: 1 } })).toContain('"a" must be a string')
        const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, "v"]))
        expect(reason({ tags: many })).toContain("at most 15")
        expect(reason({ guardrails: [{ profile: "lakera-guard" }] })).toBe("accepted")
    })
})

describe("what Otari says about the response", () => {
    test("a gateway fallback is announced before the first chunk, naming who served it", async () => {
        const { fetch } = recording(() =>
            sse(REPLY, {
                "otari-provider": "nebius",
                "otari-model": "zai-org/GLM-5.3-Flash",
                "otari-fallback": "true",
            }),
        )
        const chunks = await collect(provider(fetch).chat(PING, new AbortController().signal))
        expect(chunks[0]).toEqual({ type: "model", id: "nebius:zai-org/GLM-5.3-Flash" })
        expect(chunks[1]).toEqual({ type: "text", delta: "pong" })
    })

    test("no fallback, no announcement: the requested model answered", async () => {
        const { fetch } = recording(() =>
            sse(REPLY, {
                "otari-provider": "deepinfra",
                "otari-model": "zai-org/GLM-5.3-Flash",
                "otari-fallback": "false",
            }),
        )
        const chunks = await collect(provider(fetch).chat(PING, new AbortController().signal))
        expect(chunks.some((chunk) => chunk.type === "model")).toBe(false)
    })

    test("two concurrent calls on one role do not read each other's headers", async () => {
        let n = 0
        const { fetch } = recording(() => {
            n += 1
            return sse(REPLY, {
                "otari-provider": n === 1 ? "nebius" : "deepinfra",
                "otari-model": "m",
                "otari-fallback": n === 1 ? "true" : "false",
            })
        })
        const shared = provider(fetch)
        const signal = new AbortController().signal
        const [first, second] = await Promise.all([
            collect(shared.chat(PING, signal)),
            collect(shared.chat(PING, signal)),
        ])
        const announced = [first, second].filter((c) => c.some((chunk) => chunk.type === "model"))
        expect(announced.length).toBe(1)
    })
})

describe("refusals say what to do next", () => {
    test("a spent budget: its scope, its reset, its 403 — and no fallback past it", async () => {
        const { fetch } = recording(
            () =>
                new Response(
                    JSON.stringify({
                        detail: "workspace has exceeded budget limit",
                        code: "budget_exceeded",
                    }),
                    {
                        status: 403,
                        headers: {
                            "otari-error-code": "budget_exceeded",
                            "otari-budget-scope": "workspace",
                            "retry-after": "3600",
                        },
                    },
                ),
        )
        const error = await failure(provider(fetch).chat(PING, new AbortController().signal))
        expect(isHarnessError(error)).toBe(true)
        const refused = error as { code: string; status: number; message: string; hint: string }
        expect(refused.code).toBe("otari_budget_exceeded")
        expect(refused.status).toBe(403)
        expect(refused.message).toContain("workspace budget is spent")
        expect(refused.hint).toContain("resets in 3600 s")
        // A 403 is outside the statuses `fallbackReason` moves on (decision 14.19), so the chain stops here.
    })

    test("a guardrail block, in the shape the live API returns, names the profile", async () => {
        const { fetch } = recording(
            () =>
                new Response(
                    JSON.stringify({
                        detail: {
                            message: "Request blocked by guardrail policy.",
                            code: "guardrail_violation",
                            guardrails: [{ profile: "lakera-guard", explanation: null, score: 1 }],
                        },
                    }),
                    { status: 403 },
                ),
        )
        const error = await failure(provider(fetch).chat(PING, new AbortController().signal))
        const refused = error as { code: string; message: string; field: string }
        expect(refused.code).toBe("otari_guardrail_violation")
        expect(refused.message).toContain("lakera-guard")
        expect(refused.field).toBe("model.main.options.guardrails")
    })

    test("a guardrail Otari cannot run is refused by name, and no fallback model is tried", async () => {
        // The live 502: prose, no code, no header (2026-11-04, a profile with a parameter Lakera refused).
        const { fetch } = recording(
            () =>
                new Response(
                    JSON.stringify({
                        detail: "guardrail profile 'lakera-guard' could not be evaluated",
                    }),
                    { status: 502 },
                ),
        )
        const error = await failure(provider(fetch).chat(PING, new AbortController().signal))
        const refused = error as { code: string; message: string; status: unknown }
        expect(refused.code).toBe("otari_guardrail_unavailable")
        expect(refused.message).toContain("lakera-guard")
        // A status of 502 is what a fallback chain moves on; a guardrail outage must stop instead.
        expect(refused.status).toBeUndefined()
    })

    test("a profile name Otari does not know is the same refusal, and the hint says check the name", async () => {
        // Live wording, 2026-11-04, for `profile: no-such-profile` on hosted Otari.
        const { fetch } = recording(
            () =>
                new Response(
                    JSON.stringify({
                        detail: "guardrail profile 'no-such-profile' requested but no guardrails service is configured. Set OTARI_GUARDRAILS_URL on the gateway or pass `url` on the guardrail entry.",
                    }),
                    { status: 502 },
                ),
        )
        const error = await failure(provider(fetch).chat(PING, new AbortController().signal))
        const refused = error as { code: string; message: string; hint: string; status: unknown }
        expect(refused.code).toBe("otari_guardrail_unavailable")
        expect(refused.message).toContain("no-such-profile")
        expect(refused.hint).toContain("profile name")
        expect(refused.status).toBeUndefined()
    })

    test("an empty wallet is its own error; an unknown code keeps core's", async () => {
        const wallet = recording(
            () =>
                new Response(JSON.stringify({ detail: "no funds", code: "insufficient_funds" }), {
                    status: 402,
                }),
        )
        const empty = await failure(provider(wallet.fetch).chat(PING, new AbortController().signal))
        expect((empty as { code: string }).code).toBe("otari_insufficient_funds")

        const other = recording(
            () =>
                new Response(JSON.stringify({ detail: "nope", code: "something_new" }), {
                    status: 400,
                }),
        )
        const plain = await failure(provider(other.fetch).chat(PING, new AbortController().signal))
        expect((plain as { code: string }).code).toBe("model_http_error")
    })
})

describe("a turn through the runtime", () => {
    test("api: otari with no baseUrl boots, answers, and tags the call with its role", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-"))
        writeFileSync(
            join(dir, "agent.yaml"),
            `apiVersion: ${BRAND.apiVersion}
id: otaried
model:
  main:
    id: z-ai/glm-5.3-flash
    api: otari
    options:
      guardrails: [{ profile: lakera-guard, mode: block }]
limits:
  maxSteps: 2
  turnTimeoutMs: 5000
`,
        )
        const { fetch, sent } = recording(() => sse(REPLY))
        const runtime = await Runtime.create({
            agents: [join(dir, "agent.yaml")],
            env: { OTARI_API_KEY: "otk_test" },
            store: ":memory:",
            fetch,
            modelTransports: { otari: otariTransport() },
        })
        const reply = await runtime.agent("otaried").send("ping")
        await runtime.stop()

        expect(reply.text).toBe("pong")
        expect(sent[0]?.url).toBe(`${OTARI_BASE_URL}/chat/completions`)
        expect(sent[0]?.body.metadata).toEqual({ role: "main" })
        expect(sent[0]?.body.guardrails).toEqual([{ profile: "lakera-guard", mode: "block" }])
    })
})
