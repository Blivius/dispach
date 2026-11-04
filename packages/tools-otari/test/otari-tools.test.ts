/**
 * `otari` tools against a recorded gateway. Response shapes are the live API's on 2026-11-04:
 * `/code/execute` names its sandbox in `Otari-Container-Id`, and a search's sources arrive in
 * `otari_tool_calls` beside a `cost_usd` decimal string.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    BRAND,
    type FetchLike,
    Runtime,
    type Tool,
    type ToolContext,
    type ToolUsage,
} from "@dispach/core"
import { OTARI_BASE_URL, otariTransport } from "@dispach/model-otari"
import {
    type FetchLike as OtariFetch,
    OtariToolProvider,
    otariToolsFromConfig,
} from "../src/index.ts"

interface Sent {
    readonly url: string
    readonly auth: string | undefined
    readonly body: Record<string, unknown>
}

function recording(respond: (sent: Sent, n: number) => Response) {
    const sent: Sent[] = []
    const fetch = async (input: string, init?: RequestInit) => {
        const record = {
            url: input,
            auth: (init?.headers as Record<string, string> | undefined)?.authorization,
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        }
        sent.push(record)
        return respond(record, sent.length)
    }
    return { fetch, sent }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    })

function context(sessionKey = "local:abc123", usage: ToolUsage[] = []): ToolContext {
    return {
        agentId: "a",
        sessionKey,
        turnId: "t",
        dir: tmpdir(),
        signal: new AbortController().signal,
        deadlineMs: 120_000,
        now: () => new Date(),
        meter: (spent) => usage.push(spent),
    } as ToolContext
}

async function tool(
    slug: string,
    fetch: OtariFetch,
    env = { OTARI_API_KEY: "otk_test" },
): Promise<Tool> {
    const [found] = await new OtariToolProvider({ env, fetch }).resolve([slug])
    if (found === undefined) throw new Error(`no ${slug}`)
    return found
}

describe("run_code", () => {
    test("runs in Otari's sandbox and keeps one sandbox per session", async () => {
        const { fetch, sent } = recording((_, n) =>
            json(
                {
                    object: "code_execution.result",
                    stdout: `run ${n}\n`,
                    stderr: "",
                    return_code: 0,
                    files: [],
                },
                200,
                { "otari-container-id": n === 1 ? "cntr_one" : "cntr_two" },
            ),
        )
        const run = await tool("run_code", fetch)
        const usage: ToolUsage[] = []

        const first = await run.handler(
            { code: "x = 1\nprint('run 1')" },
            context("local:aaa111", usage),
        )
        await run.handler({ code: "print(x)" }, context("local:aaa111"))
        await run.handler({ code: "print(1)" }, context("local:bbb222"))

        expect(sent[0]?.url).toBe(`${OTARI_BASE_URL}/code/execute`)
        expect(sent[0]?.auth).toBe("Bearer otk_test")
        expect(sent[0]?.body).toMatchObject({ code: "x = 1\nprint('run 1')", container: "auto" })
        // The second call in the session goes back to the sandbox the first was given.
        expect(sent[1]?.body.container).toBe("cntr_one")
        // Another conversation never shares it.
        expect(sent[2]?.body.container).toBe("auto")
        expect(first).toContain("exit status: 0")
        expect(first).toContain("stdout:\nrun 1")
        expect(usage).toEqual([
            { provider: "otari", operation: "code_execution", unit: "requests", units: 1 },
        ])
    })

    test("an expired sandbox is replaced once, and the model is told its state is gone", async () => {
        const { fetch, sent } = recording((_, n) =>
            n === 2
                ? json({ detail: "Container 'cntr_one' has expired or does not exist." }, 400)
                : json({ stdout: "ok\n", stderr: "", return_code: 0, files: [] }, 200, {
                      "otari-container-id": n === 1 ? "cntr_one" : "cntr_fresh",
                  }),
        )
        const run = await tool("run_code", fetch)
        await run.handler({ code: "a = 1" }, context())
        const second = await run.handler({ code: "print(a)" }, context())
        expect(sent.map((s) => s.body.container)).toEqual(["auto", "cntr_one", "auto"])
        expect(second).toContain("variables and files from before are gone")
    })

    test("a failing program is a result, not an error", async () => {
        const { fetch } = recording(() =>
            json({
                stdout: "",
                stderr: "ZeroDivisionError: division by zero",
                return_code: 1,
                files: [],
            }),
        )
        const out = await (await tool("run_code", fetch)).handler({ code: "1/0" }, context())
        expect(out).toContain("exit status: 1")
        expect(out).toContain("ZeroDivisionError")
    })
})

const SEARCH_REPLY = {
    choices: [{ message: { content: "Otari — https://otari.ai — the hosted gateway." } }],
    usage: {
        prompt_tokens: 2675,
        completion_tokens: 593,
        estimated_cost: 0.00015,
        cost_usd: "0.010163",
    },
    otari_tool_calls: [
        {
            type: "web_search",
            status: "completed",
            query: "Mozilla.ai Otari",
            sources: [
                {
                    url: "https://github.com/mozilla-ai/otari",
                    title: "mozilla-ai/otari",
                    published_date: null,
                },
                { url: "https://otari.ai", title: "Otari", published_date: "2026-10-01" },
                { url: "https://otari.ai", title: "Otari (again)", published_date: null },
            ],
        },
    ],
}

describe("web_search", () => {
    test("one in-loop search on the small model: sources from Otari, summaries labelled as a model's", async () => {
        const { fetch, sent } = recording(() => json(SEARCH_REPLY))
        const usage: ToolUsage[] = []
        const out = await (await tool("web_search", fetch)).handler(
            { query: "Mozilla.ai Otari" },
            context("local:abc123", usage),
        )

        expect(sent[0]?.url).toBe(`${OTARI_BASE_URL}/chat/completions`)
        expect(sent[0]?.body).toMatchObject({
            model: "openai/gpt-oss-20b",
            tools: [{ type: "otari_web_search" }],
            metadata: { role: "web_search" },
        })
        // Deduplicated by URL, numbered, dated when Otari gave a date.
        expect(out).toContain("2 sources for")
        expect(out).toContain("1. mozilla-ai/otari\n   https://github.com/mozilla-ai/otari")
        expect(out).toContain("2. Otari (2026-10-01)\n   https://otari.ai")
        expect(out).toContain(
            "Summaries, written by openai/gpt-oss-20b from those pages (not the pages themselves):",
        )
        // Billed in the dollars Otari reported, not the estimate.
        expect(usage).toEqual([
            { provider: "otari", operation: "search", unit: "usd", units: 0.010163 },
        ])
    })

    test("a spent budget is Otari's refusal, by name", async () => {
        const { fetch } = recording(() =>
            json({ detail: "workspace has exceeded budget limit", code: "budget_exceeded" }, 403, {
                "otari-error-code": "budget_exceeded",
                "otari-budget-scope": "workspace",
            }),
        )
        const error = await Promise.resolve(
            (await tool("web_search", fetch)).handler({ query: "x" }, context()),
        ).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        expect((error as { code: string }).code).toBe("otari_budget_exceeded")
    })

    test("no key is a tool error that names the variable, and nothing is sent", async () => {
        const { fetch, sent } = recording(() => json(SEARCH_REPLY))
        const error = await Promise.resolve(
            (await tool("web_search", fetch, { OTARI_API_KEY: "" })).handler(
                { query: "x" },
                context(),
            ),
        ).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        expect((error as { code: string; hint: string }).code).toBe("otari_key_missing")
        expect(sent.length).toBe(0)
    })
})

describe("configuration", () => {
    const build = (config: Record<string, unknown>) => () =>
        otariToolsFromConfig({ dir: tmpdir(), env: {}, config, agentId: "a" })

    test("unknown keys and bad values are refused at load, naming the field", () => {
        expect(build({ searchModle: "x" })).toThrow(
            "tools.providers.otari.searchModle is not a setting",
        )
        expect(build({ baseUrl: "ftp://x" })).toThrow("must be http or https")
        expect(build({ baseUrl: "https://k:s@api.otari.ai/api/v1" })).toThrow(
            "must not carry credentials",
        )
        expect(build({ searchModel: "z-ai/glm-5.3-flash", apiKeyEnv: "MY_KEY" })).not.toThrow()
    })

    test("the catalogue is offered unpinned, so the model is told what it was not given", async () => {
        const available = await new OtariToolProvider({ env: {} }).available()
        expect(available.map((entry) => entry.slug)).toEqual(["web_search", "run_code"])
    })
})

describe("a turn through the runtime", () => {
    test("the model calls run_code and reads what the sandbox printed", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-tools-"))
        writeFileSync(
            join(dir, "agent.yaml"),
            `apiVersion: ${BRAND.apiVersion}
id: coder
model:
  main:
    id: z-ai/glm-5.3-flash
    api: otari
tools:
  providers:
    otari: {}
  pinned: [run_code]
  policy:
    allow: [run_code]
limits:
  maxSteps: 3
  turnTimeoutMs: 10000
`,
        )
        const sse = (text: string) =>
            new Response(
                `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            )
        const prompts: string[] = []
        const fetch: FetchLike = async (input, init) => {
            const url = String(input)
            if (url.endsWith("/code/execute")) {
                return json({ stdout: "4950\n", stderr: "", return_code: 0, files: [] }, 200, {
                    "otari-container-id": "cntr_turn",
                })
            }
            prompts.push(String(init?.body))
            return prompts.length === 1
                ? sse("ACTION: run_code\ncode: print(sum(range(100)))\n")
                : sse("The sum is 4950.")
        }
        const runtime = await Runtime.create({
            agents: [join(dir, "agent.yaml")],
            env: { OTARI_API_KEY: "otk_test" },
            store: ":memory:",
            fetch,
            modelTransports: { otari: otariTransport() },
            toolProviders: { otari: (ctx) => new OtariToolProvider({ env: ctx.env, fetch }) },
        })
        const reply = await runtime.agent("coder").send("add 0..99")
        await runtime.stop()

        expect(reply.text).toContain("4950")
        // The far end: the sandbox's output is in the request the model answered from.
        expect(prompts[1]).toContain("stdout:\\n4950")
    })
})
