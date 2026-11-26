/**
 * Tool groups (decision 17.2): pinned tools held out of the request until a conversation needs them.
 *
 * The property that saves the money and the property that keeps the accuracy are both read at the far
 * end — the `tools` a model request actually carries — because every layer can be right while the value
 * is dropped between them (`ChatMessage.toolCalls`, `TurnInput.skills`, `ToolContext.readArtifact`).
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"
import { BRAND } from "../src/brand.ts"
import { HarnessError } from "../src/errors.ts"
import {
    type ChatChunk,
    type ChatMessage,
    type ChatRequest,
    type ModelTransport,
    prepareManifestEdit,
    Runtime,
    type Tool,
    type ToolProviderFactory,
} from "../src/index.ts"
import { loadManifest } from "../src/manifest/load.ts"
import { toolGroupWarnings } from "../src/manifest/validate.ts"
import { activeToolGroups, mentionsKeyword, type ToolGroup } from "../src/tools/groups.ts"
import { describe, expect, test } from "./_harness.ts"

const GROUPS: readonly ToolGroup[] = [
    {
        name: "crm",
        description: "deals, contacts and proposals",
        tools: ["crm_list", "crm_update"],
        keywords: ["crm", "deal", "lead"],
    },
    {
        name: "gmail",
        description: "the person's Gmail",
        tools: ["gmail_fetch"],
        keywords: ["email", "inbox", "gmail"],
    },
]

describe("mentionsKeyword", () => {
    test("matches at the start of a word, ignoring case, so plurals and inflections load", () => {
        expect(mentionsKeyword("Any new EMAILS today?", "email")).toBe(true)
        expect(mentionsKeyword("what about the deals", "deal")).toBe(true)
        expect(mentionsKeyword("check my inbox.", "inbox")).toBe(true)
    })

    test("does not match inside a word: 'idealist' is not a deal", () => {
        expect(mentionsKeyword("an idealist plan", "deal")).toBe(false)
        expect(mentionsKeyword("hello", "email")).toBe(false)
        expect(mentionsKeyword("anything", "  ")).toBe(false)
    })
})

describe("activeToolGroups", () => {
    test("a greeting loads nothing; a keyword in the input loads its group only", () => {
        expect([...activeToolGroups(GROUPS, "hi there", [])]).toEqual([])
        expect([...activeToolGroups(GROUPS, "update the Acme deal", [])]).toEqual(["crm"])
    })

    test("a group stays loaded for the session: a keyword the person said earlier", () => {
        const history: ChatMessage[] = [
            { role: "user", content: "summarise my inbox" },
            { role: "assistant", content: "Three new messages." },
        ]
        expect([...activeToolGroups(GROUPS, "thanks, and the first one?", history)]).toEqual([
            "gmail",
        ])
    })

    test("a digest's words are not the person's", () => {
        const history: ChatMessage[] = [
            { role: "user", content: "Earlier: they talked about a deal.", origin: "digest" },
        ]
        expect([...activeToolGroups(GROUPS, "ok", history)]).toEqual([])
    })

    test("a call to one of its tools keeps it loaded, native or NLT", () => {
        const native: ChatMessage[] = [
            {
                role: "assistant",
                content: "",
                origin: "call",
                toolCalls: [{ id: "c1", name: "crm_list", arguments: "{}" }],
            },
        ]
        const nlt: ChatMessage[] = [
            { role: "assistant", content: "Looking.\nACTION: gmail_fetch\nEND", origin: "call" },
        ]
        expect([...activeToolGroups(GROUPS, "and now?", native)]).toEqual(["crm"])
        expect([...activeToolGroups(GROUPS, "and now?", nlt)]).toEqual(["gmail"])
    })

    test("a tools_load result keeps its group loaded, bare (native) or under NLT's header", () => {
        const native: ChatMessage[] = [
            {
                role: "tool",
                content: 'Loaded the "gmail" tools: gmail_fetch. They are in your tool list…',
                toolCallId: "c1",
            },
        ]
        const nlt: ChatMessage[] = [
            {
                role: "user",
                origin: "observation",
                content:
                    'OBSERVATION tools_load — ok\nLoaded the "crm" tools: crm_list, crm_update.',
            },
        ]
        expect([...activeToolGroups(GROUPS, "next", native)]).toEqual(["gmail"])
        expect([...activeToolGroups(GROUPS, "next", nlt)]).toEqual(["crm"])
    })
})

const ENV = { MODEL_API_KEY: "test-key" }

function loadYaml(body: string) {
    const dir = mkdtempSync(join(tmpdir(), "tool-groups-manifest-"))
    writeFileSync(join(dir, "agent.yaml"), `apiVersion: ${BRAND.apiVersion}\n${body}`)
    return loadManifest(join(dir, "agent.yaml"), { env: ENV, skipEnvFile: true })
}

function failureCodes(body: string): string[] {
    try {
        loadYaml(body)
    } catch (error) {
        if (!(error instanceof HarnessError)) throw error
        const details = error.details.length > 0 ? error.details : [error.toDetail()]
        return details.map((detail) => detail.code)
    }
    throw new Error("expected the load to fail")
}

const MODEL = `id: test
model:
  main:
    id: gpt-4o-mini
    baseUrl: https://api.example.com/v1
    apiKeyEnv: MODEL_API_KEY
`

describe("validation", () => {
    test("a group naming a tool the agent is not given loads, with a warning saying so", () => {
        // Not a refusal: the agent's own config_set may unpin a grouped tool, and an agent that then
        // could not reload would be stuck on its old settings for a slug it no longer has.
        const { manifest } = loadYaml(`${MODEL}tools:
  local: [now]
  groups:
    crm:
      description: deals
      tools: [crm_list]
      keywords: [deal]
`)
        expect(toolGroupWarnings(manifest).map((warning) => warning.code)).toEqual([
            "tool_group_unpinned",
        ])
    })

    test("a tool belongs to one group at most", () => {
        const codes = failureCodes(`${MODEL}tools:
  local: [now]
  pinned: [crm_list]
  groups:
    crm:
      description: deals
      tools: [crm_list]
    sales:
      description: sales
      tools: [crm_list]
`)
        expect(codes).toContain("tool_group_overlap")
    })

    test("a well-formed group loads, keywords defaulted", () => {
        const { manifest } = loadYaml(`${MODEL}tools:
  local: [now, memory_write]
  groups:
    notes:
      description: saving notes
      tools: [memory_write]
`)
        expect(manifest.tools.groups.notes?.keywords).toEqual([])
    })
})

describe("the config surface", () => {
    test("tools.groups round-trips through the one manifest writer as a map of objects", () => {
        // A settable path with a new value shape has written `[object Object]` twice in this repo.
        const source = `apiVersion: ${BRAND.apiVersion}\n${MODEL}tools:\n  local: [now]\n  pinned: [crm_list]\n`
        const value = {
            crm: {
                description: "deals and contacts",
                tools: ["crm_list"],
                keywords: ["deal", "crm"],
            },
        }
        const prepared = prepareManifestEdit(source, { path: ["tools", "groups"], value })
        expect(prepared.next).not.toContain("[object Object]")
        expect(parse(prepared.next).tools.groups).toEqual(value)
    })
})

// ─── At the far end: what each model request carries ─────────────────────────────────────────

function tool(slug: string, ran: string[]): Tool {
    return {
        spec: {
            slug,
            provider: "cache",
            summary: `The ${slug} tool.`,
            whenToUse: "When asked.",
            whenNotToUse: "Otherwise.",
            mutating: false,
            tags: [],
            parameters: { type: "object", properties: {} },
        },
        handler: async () => {
            ran.push(slug)
            return `${slug} ok`
        },
    }
}

/**
 * One agent, three tools in two groups plus one ungrouped. `script` is what the model does per step,
 * by request number: a tool call, or text.
 */
async function agentWith(
    script: (step: number) => { call?: string; args?: string; text?: string },
) {
    const dir = mkdtempSync(join(tmpdir(), "tool-groups-"))
    const path = join(dir, "agent.yaml")
    writeFileSync(
        path,
        `apiVersion: ${BRAND.apiVersion}
id: grouped
model:
  main:
    id: scripted
    api: scripted
    capabilities:
      nativeTools: true
tools:
  dialect: native
  providers:
    cache: {}
  pinned: [projects, crm_list, gmail_fetch]
  groups:
    crm:
      description: deals and contacts
      tools: [crm_list]
      keywords: [deal, crm]
    gmail:
      description: the person's Gmail
      tools: [gmail_fetch]
      keywords: [email, inbox]
limits:
  turnTimeoutMs: 5000
`,
    )
    const ran: string[] = []
    const cache: ToolProviderFactory = () => ({
        id: "cache",
        resolve: async (slugs) =>
            ["projects", "crm_list", "gmail_fetch"]
                .filter((slug) => slugs.includes(slug))
                .map((slug) => tool(slug, ran)),
    })
    const requests: ChatRequest[] = []
    let inTurn = 0
    const scripted: ModelTransport = {
        create: (context) => ({
            id: context.id,
            async *chat(request): AsyncIterable<ChatChunk> {
                requests.push(request)
                inTurn += 1
                const step = script(inTurn)
                if (step.call !== undefined) {
                    yield {
                        type: "tool_call",
                        call: {
                            id: `c${requests.length}`,
                            name: step.call,
                            arguments: step.args ?? "{}",
                        },
                    }
                    yield { type: "finish", reason: "tool_calls" }
                    return
                }
                yield { type: "text", delta: step.text ?? "done" }
                yield { type: "finish", reason: "stop" }
            },
        }),
    }
    const runtime = await Runtime.create({
        agents: [path],
        env: {},
        store: ":memory:",
        modelTransports: { scripted },
        toolProviders: { cache },
    })
    const agent = runtime.agent("grouped")
    const names = (request: ChatRequest | undefined) =>
        (request?.tools ?? []).map((spec) => spec.name).sort()
    const send = async (text: string, options: Parameters<typeof agent.send>[1] = {}) => {
        inTurn = 0
        return agent.send(text, { sessionKey: "api:ada", ...options })
    }
    return { runtime, agent, requests, ran, names, send }
}

describe("a turn's catalogue", () => {
    test("a greeting carries the ungrouped tools and tools_load, never a withheld group", async () => {
        const { runtime, requests, names, send } = await agentWith(() => ({ text: "hello" }))
        await send("hi")
        expect(names(requests[0])).toEqual(["projects", "tools_load"])
        await runtime.stop()
    })

    test("a keyword loads its group for the turn, and the session keeps it", async () => {
        const { runtime, requests, names, send } = await agentWith(() => ({ text: "ok" }))
        await send("any new email?")
        expect(names(requests[0])).toEqual(["gmail_fetch", "projects", "tools_load"])
        // No keyword this time; the session already loaded gmail, so it stays.
        await send("thanks")
        expect(names(requests[1])).toEqual(["gmail_fetch", "projects", "tools_load"])
        await runtime.stop()
    })

    test("tools_load loads a group the keywords missed, in the same turn, and it sticks", async () => {
        const { runtime, requests, names, ran, send } = await agentWith((step) =>
            step === 1
                ? { call: "tools_load", args: '{"group":"gmail"}' }
                : step === 2
                  ? { call: "gmail_fetch" }
                  : { text: "John said yes." },
        )
        const result = await send("what did John say yesterday?")
        expect(result.text).toBe("John said yes.")
        expect(names(requests[0])).toEqual(["projects", "tools_load"])
        // The next step of the same turn has the group.
        expect(names(requests[1])).toContain("gmail_fetch")
        expect(ran).toEqual(["gmail_fetch"])
        // And the next turn starts with it, read back from the tools_load result in the history.
        await send("ok")
        expect(names(requests[3])).toContain("gmail_fetch")
        await runtime.stop()
    })

    test("a schedule's run and an explicit allowlist get every tool", async () => {
        const { runtime, requests, names, send } = await agentWith(() => ({ text: "ok" }))
        await send("daily brief", { source: "schedule:brief", sessionKey: "schedule:brief:r1" })
        expect(names(requests[0])).toEqual(["crm_list", "gmail_fetch", "projects"])
        await send("hi", { toolsAllow: ["projects", "crm_list"], sessionKey: "api:other" })
        expect(names(requests[1])).toEqual(["crm_list", "projects"])
        await runtime.stop()
    })

    test("GET /context reports the catalogue a turn would send, not the agent's whole one", async () => {
        const { runtime, agent, send, requests } = await agentWith(() => ({ text: "ok" }))
        const greeting = await agent.previewContext({ sessionKey: "api:fresh", input: "hi" })
        const crm = await agent.previewContext({ sessionKey: "api:fresh", input: "the Acme deal" })
        expect(greeting.wireTokens < crm.wireTokens).toBe(true)
        // And the greeting's figure is the one a real turn sends.
        await send("hi", { sessionKey: "api:fresh" })
        expect(requests[0]?.tools?.length).toBe(2)
        await runtime.stop()
    })
})
