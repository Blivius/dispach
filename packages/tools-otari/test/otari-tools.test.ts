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
    parseMcpServers,
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

const SERVER = "56eb8d19-eca7-4ec3-8f60-62c9c7d9c0a5"
/** The live discovery answer for DeepWiki on 2026-11-04, trimmed to two tools. */
const DISCOVERY = {
    server_id: SERVER,
    server_revision: "ffd75627319061a7ddc909f7fa37ade3",
    tools: [
        {
            name: "read_wiki_structure",
            description: "Get a list of documentation topics for a GitHub repository.",
            input_schema: {
                type: "object",
                properties: { repoName: { type: "string", description: "owner/repo" } },
                required: ["repoName"],
                additionalProperties: false,
            },
            annotations: null,
        },
        {
            name: "ask_wiki_question",
            description: "Ask any question about a GitHub repository's codebase.",
            input_schema: {
                type: "object",
                properties: {
                    repoName: {
                        anyOf: [{ type: "string" }, { items: { type: "string" }, type: "array" }],
                        description: "GitHub repository or list of repositories (max 10).",
                    },
                    question: { type: "string" },
                },
                required: ["repoName", "question"],
            },
            annotations: null,
        },
    ],
    warnings: [],
}
const MCP = [{ name: "deepwiki", id: SERVER }]

async function warmed(dir: string) {
    const fetch = async (input: string) => {
        if (!input.endsWith(`/mcp/servers/${SERVER}/tools`)) throw new Error(`unexpected ${input}`)
        return json(DISCOVERY)
    }
    const provider = new OtariToolProvider({ env: { OTARI_API_KEY: "k" }, dir, mcp: MCP, fetch })
    return provider.refresh(["deepwiki__read_wiki_structure"])
}

const refusing: OtariFetch = () => Promise.reject(new Error("boot must not touch the network"))

describe("MCP servers registered in Otari", () => {
    test("discovery fills a cache, and the next boot resolves from it with no network", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-mcp-"))
        const refreshed = await warmed(dir)
        expect(refreshed).toEqual({
            fetched: 1,
            missing: [],
            changed: ["deepwiki__read_wiki_structure"],
        })

        const booted = new OtariToolProvider({ env: {}, dir, mcp: MCP, fetch: refusing })
        const [tool, ask] = await booted.resolve([
            "deepwiki__read_wiki_structure",
            "deepwiki__ask_wiki_question",
        ])
        // The real schema's repoName is anyOf [string, string[]]: narrowed, not refused (4.100).
        expect(ask?.spec.parameters.properties.repoName?.type).toBe("string")
        expect(booted.refused()).toEqual([])
        expect(tool?.spec).toMatchObject({
            slug: "deepwiki__read_wiki_structure",
            provider: "otari",
            // No readOnlyHint from the server: a write, which is the fail-closed direction.
            mutating: true,
        })
        expect((await booted.available()).map((entry) => entry.slug)).toEqual([
            "web_search",
            "run_code",
            "deepwiki__read_wiki_structure",
            "deepwiki__ask_wiki_question",
        ])
    })

    test("one execute per call, carrying the cached revision and a fresh UUID", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-mcp-"))
        await warmed(dir)
        const { fetch, sent } = recording(() =>
            json({ content: [{ type: "text", text: "- 1 Overview\n- 2 Getting Started" }] }),
        )
        const usage: ToolUsage[] = []
        const [tool] = await new OtariToolProvider({
            env: { OTARI_API_KEY: "k" },
            dir,
            mcp: MCP,
            fetch,
        }).resolve(["deepwiki__read_wiki_structure"])
        const out = await tool?.handler(
            { repoName: "mozilla-ai/any-llm" },
            context("local:abc123", usage),
        )

        expect(out).toBe("- 1 Overview\n- 2 Getting Started")
        expect(sent[0]?.url).toBe(`${OTARI_BASE_URL}/mcp/execute`)
        expect(sent[0]?.body).toMatchObject({
            mcp_server_id: SERVER,
            tool_name: "read_wiki_structure",
            arguments: { repoName: "mozilla-ai/any-llm" },
            server_revision: "ffd75627319061a7ddc909f7fa37ade3",
        })
        expect(String(sent[0]?.body.client_execution_id)).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        )
        expect(usage).toEqual([{ provider: "otari", operation: "mcp", unit: "requests", units: 1 }])
    })

    test("a call that may have run is never retried, and says it may have run", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-mcp-"))
        await warmed(dir)
        const { fetch, sent } = recording(() =>
            json(
                {
                    detail: "MCP execution outcome is unknown",
                    code: "mcp_outcome_unknown",
                    execution_state: "outcome_unknown",
                },
                504,
            ),
        )
        const [tool] = await new OtariToolProvider({
            env: { OTARI_API_KEY: "k" },
            dir,
            mcp: MCP,
            fetch,
        }).resolve(["deepwiki__read_wiki_structure"])
        const error = await Promise.resolve(tool?.handler({ repoName: "x/y" }, context())).then(
            () => undefined,
            (caught: unknown) => caught as { code: string; message: string },
        )
        expect(sent.length).toBe(1)
        expect(error?.code).toBe("otari_mcp_outcome_unknown")
        expect(error?.message).toContain("may or may not have taken effect")
    })

    test("the server's own error is a failed call, and a changed server says to re-read it", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-mcp-"))
        await warmed(dir)
        const replies = [
            json({ content: [{ type: "text", text: "Repository not found" }], isError: true }),
            json(
                {
                    detail: "MCP server changed",
                    code: "mcp_server_changed",
                    execution_state: "not_started",
                },
                409,
            ),
        ]
        const fetch: OtariFetch = () => Promise.resolve(replies.shift() ?? json({}))
        const [tool] = await new OtariToolProvider({
            env: { OTARI_API_KEY: "k" },
            dir,
            mcp: MCP,
            fetch,
        }).resolve(["deepwiki__read_wiki_structure"])
        const fail = (args: Record<string, unknown>) =>
            Promise.resolve(tool?.handler(args, context())).then(
                () => undefined,
                (caught: unknown) => caught as { code: string; message: string; hint: string },
            )
        const toolError = await fail({ repoName: "no/such" })
        expect(toolError?.code).toBe("mcp_tool_failed")
        expect(toolError?.message).toContain("Repository not found")
        const changed = await fail({ repoName: "x/y" })
        expect(changed?.code).toBe("otari_mcp_server_changed")
        expect(changed?.hint).toContain("--warm")
    })

    test("a cold cache names the warm command, and a bad entry is refused at load", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-mcp-"))
        const cold = new OtariToolProvider({ env: {}, dir, mcp: MCP, fetch: refusing })
        expect(await cold.resolve(["deepwiki__ask_wiki_question"])).toEqual([])
        expect(cold.explainUnresolved(["deepwiki__ask_wiki_question", "web_search"])?.code).toBe(
            "otari_mcp_cache_miss",
        )
        expect(cold.explainUnresolved(["config_read"])).toBeUndefined()

        const build = (mcp: unknown) => () =>
            otariToolsFromConfig({ dir, env: {}, config: { mcp }, agentId: "a" })
        expect(build({ deepwiki: "https://mcp.deepwiki.com/mcp" })).toThrow(
            "is not an Otari MCP server id",
        )
        expect(build({ Deep_Wiki: SERVER })).toThrow("not usable in a tool slug")
        expect(build({ deepwiki: SERVER })).not.toThrow()
    })

    test("a turn: the model calls a DeepWiki tool and reads what it returned", async () => {
        const dir = mkdtempSync(join(tmpdir(), "otari-mcp-turn-"))
        await warmed(dir)
        writeFileSync(
            join(dir, "agent.yaml"),
            `apiVersion: ${BRAND.apiVersion}
id: reader
model:
  main:
    id: z-ai/glm-5.3-flash
    api: otari
tools:
  providers:
    otari:
      mcp: { deepwiki: ${SERVER} }
  pinned: [deepwiki__read_wiki_structure]
  policy:
    allow: [deepwiki__read_wiki_structure]
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
            if (url.endsWith("/mcp/execute")) {
                return json({ content: [{ type: "text", text: "- 5.2 Tool Calling" }] })
            }
            if (url.includes("/mcp/servers/")) return json(DISCOVERY)
            prompts.push(String(init?.body))
            return prompts.length === 1
                ? sse("ACTION: deepwiki__read_wiki_structure\nrepoName: mozilla-ai/any-llm\n")
                : sse("It has a Tool Calling page.")
        }
        const runtime = await Runtime.create({
            agents: [join(dir, "agent.yaml")],
            env: { OTARI_API_KEY: "otk_test" },
            store: ":memory:",
            fetch,
            modelTransports: { otari: otariTransport() },
            toolProviders: {
                otari: (ctx) =>
                    new OtariToolProvider({
                        env: ctx.env,
                        dir: ctx.dir,
                        mcp: parseMcpServers(ctx.config.mcp),
                        fetch,
                    }),
            },
        })
        const reply = await runtime.agent("reader").send("what does any-llm document?")
        await runtime.stop()

        expect(reply.text).toContain("Tool Calling")
        expect(prompts[1]).toContain("5.2 Tool Calling")
    })
})
