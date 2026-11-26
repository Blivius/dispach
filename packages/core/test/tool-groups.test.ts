/**
 * Tool groups (decision 18.2): pinned tools held out of the request until a conversation needs them.
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
import {
    activeToolGroups,
    mentionsKeyword,
    missedSetNote,
    readsAsMissed,
    type ToolGroup,
    toolsLoadTool,
} from "../src/tools/groups.ts"
import { toolContext } from "../src/tools/local.ts"
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

function tool(slug: string, ran: string[], personal = false): Tool {
    return {
        spec: {
            slug,
            provider: "cache",
            ...(personal ? { personal: true } : {}),
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

const GROUPED_YAML = `apiVersion: ${BRAND.apiVersion}
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
`

/**
 * One agent, three tools in two groups plus one ungrouped. `script` is what the model does per step,
 * by request number: a tool call, or text.
 */
async function agentWith(
    script: (step: number) => { call?: string; args?: string; text?: string },
    /** Rewrites the manifest before it is written: a phase, a policy, a slug spelled another way. */
    edit: (yaml: string) => string = (yaml) => yaml,
    /** Slugs whose specs are `personal`: withheld from a turn that is not the owner's. */
    personal: readonly string[] = [],
) {
    const dir = mkdtempSync(join(tmpdir(), "tool-groups-"))
    const path = join(dir, "agent.yaml")
    writeFileSync(path, edit(GROUPED_YAML))
    const ran: string[] = []
    const cache: ToolProviderFactory = () => ({
        id: "cache",
        resolve: async (slugs) =>
            ["projects", "crm_list", "gmail_fetch"]
                .filter((slug) => slugs.includes(slug))
                .map((slug) => tool(slug, ran, personal.includes(slug))),
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

describe("readsAsMissed", () => {
    test("a reply that has nothing, cannot see or check something, or offers to look", () => {
        // The reply measured on a real silo with Gmail withheld (2026-11-26).
        expect(
            readsAsMissed(
                "I don't have anything from John in what I can see. If John messaged you by email, I can search your mailbox.",
            ),
        ).toBe(true)
        expect(readsAsMissed("I couldn't find any emails from her.")).toBe(true)
        expect(readsAsMissed("Want me to check your inbox?")).toBe(true)
        expect(readsAsMissed("There's no record of that deal.")).toBe(true)
    })

    test("an ordinary answer is not a miss", () => {
        expect(readsAsMissed("Here are your three projects.")).toBe(false)
        expect(readsAsMissed("Done, it is saved.")).toBe(false)
        expect(readsAsMissed("I don't think that is a good idea, but here is a draft.")).toBe(false)
        expect(readsAsMissed("")).toBe(false)
    })
})

describe("a reply that reads as a miss while a set is unloaded", () => {
    const NOTE = "some of your tools are not loaded"
    const carries = (request: ChatRequest | undefined, text: string) =>
        (request?.messages ?? []).some((message) => message.content.includes(text))

    test("is nudged once, and the model loads the set and looks", async () => {
        const { runtime, requests, ran, send } = await agentWith((step) =>
            step === 1
                ? {
                      text: "I don't have anything from John. I can search your mailbox if you like.",
                  }
                : step === 2
                  ? { call: "tools_load", args: '{"group":"gmail"}' }
                  : step === 3
                    ? { call: "gmail_fetch" }
                    : { text: "John said yes." },
        )
        const result = await send("what did John say yesterday?")
        // The answer alone is the one that looked; `text` keeps the earlier prose as well, because it
        // streamed to the screen as it was written and a stored turn must match what was shown.
        expect(result.finalText).toBe("John said yes.")
        expect(result.text.endsWith("John said yes.")).toBe(true)
        expect(carries(requests[0], NOTE)).toBe(false)
        // The second request carries the runtime's note naming both unloaded sets.
        expect(carries(requests[1], NOTE)).toBe(true)
        expect(carries(requests[1], "gmail (")).toBe(true)
        expect(ran).toEqual(["gmail_fetch"])
        await runtime.stop()
    })

    test("is nudged once only: the second such reply stands", async () => {
        const { runtime, requests, send } = await agentWith(() => ({
            text: "I don't have anything about that.",
        }))
        const result = await send("what did John say yesterday?")
        expect(requests.length).toBe(2)
        expect(result.finalText).toBe("I don't have anything about that.")
        await runtime.stop()
    })

    test("is not nudged once the turn has looked in a set: finding nothing there is an answer", async () => {
        // Measured live: Gmail searched, nothing from John, and the nudge sent the model on into the
        // CRM for 2–3 more steps. A turn that ran tools_load or a set's tool did look.
        const { runtime, requests, ran, send } = await agentWith((step) =>
            step === 1
                ? { call: "tools_load", args: '{"group":"gmail"}' }
                : step === 2
                  ? { call: "gmail_fetch" }
                  : { text: "I couldn't find anything from John yesterday." },
        )
        const result = await send("what did John say yesterday?")
        expect(requests.length).toBe(3)
        expect(carries(requests[2], NOTE)).toBe(false)
        expect(ran).toEqual(["gmail_fetch"])
        expect(result.finalText).toBe("I couldn't find anything from John yesterday.")
        await runtime.stop()
    })

    test("is not nudged when every set is loaded, or when the reply is an ordinary answer", async () => {
        const { runtime, requests, send } = await agentWith(() => ({
            text: "I couldn't find any emails from John.",
        }))
        // "email" and "deal" load both sets, so nothing is withheld and the reply stands.
        await send("any email from John about the deal?")
        expect(requests.length).toBe(1)
        await runtime.stop()

        const plain = await agentWith(() => ({ text: "Hello! How can I help?" }))
        await plain.send("hi")
        expect(plain.requests.length).toBe(1)
        await plain.runtime.stop()
    })
})

describe("loading the last withheld set", () => {
    test("does not fail the turn: the call is judged by the catalogue that ran it", async () => {
        // Found live (2026-11-26): loading the last set removes `tools_load` from the catalogue, and the
        // loop then asked the *new* catalogue whether that call changed anything. Every such turn failed
        // with unknown_tool_at_runtime after it had already done its work.
        const { runtime, requests, names, send } = await agentWith((step) =>
            step === 1
                ? { call: "tools_load", args: '{"group":"crm"}' }
                : step === 2
                  ? { call: "tools_load", args: '{"group":"gmail"}' }
                  : { text: "Both sets are loaded." },
        )
        const result = await send("look into it")
        expect(result.reason).toBe("final")
        expect(result.finalText).toBe("Both sets are loaded.")
        // Nothing is withheld any more, so the last request has every tool and no tools_load.
        expect(names(requests[2])).toEqual(["crm_list", "gmail_fetch", "projects"])
        await runtime.stop()
    })
})

// ─── Review fixes: each was a defect found reading the change, and each test fails without its fix ───

/** The `group` enum `tools_load` offered in a request, or undefined when it was not offered. */
function offered(request: ChatRequest | undefined): readonly string[] | undefined {
    const loader = request?.tools?.find((spec) => spec.name === "tools_load")
    if (loader === undefined) return undefined
    const parameters = loader.parameters as {
        readonly properties?: { readonly group?: { readonly enum?: readonly string[] } }
    }
    return parameters.properties?.group?.enum
}

describe("the runtime's own notes are not the person's words", () => {
    test("a nudge that names every unloaded set, read back next turn, loads none of them", () => {
        // The nudge lists each set with its description, and a description holds the set's own keywords.
        const history: ChatMessage[] = [
            { role: "user", content: "what did John say?" },
            { role: "user", origin: "repair", content: missedSetNote(GROUPS) },
            { role: "assistant", content: "Nothing from John." },
        ]
        expect([...activeToolGroups(GROUPS, "ok", history)]).toEqual([])
    })
})

describe("tools_load is there wherever the turn withholds a set", () => {
    test("in a phase whose allow list names its tools, as phase_set is", async () => {
        const { runtime, requests, names, send } = await agentWith(
            () => ({ text: "hello" }),
            (yaml) =>
                `${yaml}phases:\n  work:\n    entry: true\n    allow: [projects]\n  all:\n    allow: ["*"]\n`,
        )
        await send("hi")
        expect(names(requests[0])).toContain("tools_load")
        expect(offered(requests[0])).toEqual(["crm", "gmail"])
        await runtime.stop()
    })

    test("a policy that would refuse it gets every tool instead: a missed set could never load", async () => {
        const refusing = [
            "  policy:\n    mode: deny\n    allow: [projects, crm_list, gmail_fetch]\n",
            "  policy:\n    mode: ask\n    onNoApprover: deny\n    allow: [projects, crm_list, gmail_fetch]\n",
        ]
        for (const policy of refusing) {
            const { runtime, requests, names, send } = await agentWith(
                () => ({ text: "hello" }),
                (yaml) => yaml.replace("limits:", `${policy}limits:`),
            )
            await send("hi")
            expect(names(requests[0])).toEqual(["crm_list", "gmail_fetch", "projects"])
            await runtime.stop()
        }
    })
})

describe("a checkpoint does not unload what the conversation loaded", () => {
    test("a set loaded by tools_load before a compaction is still loaded after it", async () => {
        let turn = 0
        // The first turn's long reply is what the compaction has to shrink; a short history is refused.
        const long = "Here is what I found in the thread, message by message. ".repeat(120)
        const { runtime, agent, requests, names, send } = await agentWith((step) =>
            turn === 1 && step === 1
                ? { call: "tools_load", args: '{"group":"gmail"}' }
                : { text: turn === 1 ? long : "done" },
        )
        turn = 1
        await send("what did John say yesterday?")
        turn = 2
        await send("and before that?")
        await agent.compactSession("api:ada", { keepTurns: 1 })
        turn = 3
        await send("thanks")
        // No keyword in any request: only the load, now behind the checkpoint, keeps the set.
        expect(names(requests.at(-1))).toContain("gmail_fetch")
        await runtime.stop()
    })
})

describe("turns with nobody to rephrase get every tool", () => {
    test("a peer ask, a handoff and a turn another agent sent", async () => {
        const { runtime, requests, names, send } = await agentWith(() => ({ text: "hello" }))
        const cases = [
            { source: "ask", sessionKey: "ask:r1" },
            { source: "handoff", sessionKey: "handoff:r2" },
            { from: { id: "agent:helper", kind: "agent" as const }, sessionKey: "api:helper" },
        ]
        for (const options of cases) {
            await send("hi", options)
            expect(names(requests.at(-1))).toEqual(["crm_list", "gmail_fetch", "projects"])
        }
        await runtime.stop()
    })
})

describe("a set the turn cannot reach is not offered", () => {
    test("a turn that is not the owner's is not offered the owner's personal set", async () => {
        const { runtime, agent, requests } = await agentWith(() => ({ text: "hello" }), undefined, [
            "gmail_fetch",
        ])
        await runtime.conversations.registerParticipant({ id: "user:owner", name: "Owner" })
        await runtime.conversations.registerParticipant({ id: "user:bob", name: "Bob" })
        await runtime.conversations.assign({
            agentId: "grouped",
            participantId: "user:owner",
            channelIds: [],
        })
        await agent.send("hi", {
            sessionKey: "api:bob",
            participant: { id: "user:bob", via: "api" },
        })
        expect(offered(requests.at(-1))).toEqual(["crm"])
        await runtime.stop()
    })

    test("a load that reaches no tool is an error, never a Loaded result", async () => {
        const loader = toolsLoadTool(GROUPS)
        let error: unknown
        try {
            await loader.handler({ group: "gmail" }, toolContext({ loadToolGroup: async () => [] }))
        } catch (caught) {
            error = caught
        }
        expect((error as { code?: string } | undefined)?.code).toBe("tool_group_empty")
    })
})

describe("slugs compare the registry's way", () => {
    test("a group spelled differently from the resolved tool still holds it back", async () => {
        const { runtime, requests, names, send } = await agentWith(
            () => ({ text: "hello" }),
            (yaml) => yaml.replace("tools: [gmail_fetch]", "tools: [GMAIL-FETCH]"),
        )
        await send("hi")
        expect(names(requests[0])).toEqual(["projects", "tools_load"])
        await runtime.stop()
    })

    test("and is not warned about as unpinned", () => {
        const { manifest } = loadYaml(`${MODEL}tools:
  local: [now]
  pinned: [crm_list]
  groups:
    crm:
      description: deals
      tools: [CRM-LIST]
`)
        expect(toolGroupWarnings(manifest)).toEqual([])
    })
})
