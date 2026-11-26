/**
 * Tool groups: pinned tools held out of the request until a conversation needs them (decision 17.2).
 *
 * Measured on a real VelaCrew agent, a one-word greeting sent 41k prompt tokens and 34k of them were
 * tool schemas — 33 CRM tools and 11 Gmail tools the greeting never touched, re-read on every model
 * call. A group moves those out of the catalogue without moving them out of the agent:
 *
 * - **It is not tool search.** Decision 4.3 refuses search-then-execute because it is two hops. Every
 *   slug in a group is already pinned, so the working set is still fixed at load; the group only
 *   decides *when* it is in the request.
 * - **The harness chooses first, the way it chooses skills and knowledge.** A group loads when the
 *   person's message mentions one of its keywords, so the common case never asks the model to notice
 *   that it lacks something.
 * - **Once loaded, a group stays for the session.** Its activation is read back from the session
 *   itself — a person's message with a keyword, a call to one of its tools, a `tools_load` result — so
 *   the catalogue changes at most once per group per conversation, which is the prompt cache's price,
 *   and survives a restart with nothing stored.
 * - **`tools_load` is the backstop, not the mechanism.** Its description names every set that is not
 *   loaded, so a request the keywords missed ("what did John say yesterday?") can still reach Gmail in
 *   the same turn, one step later.
 *
 * Keywords match at the **start** of a word, where knowledge matches whole words. The two want
 * opposite errors: a knowledge entry that activates wrongly displaces a better one under a budget, while
 * a group that loads wrongly costs only its tokens — and one that fails to load costs a task.
 */

import { isTurnStart } from "../context/compaction/stages.ts"
import { toolGroupNotAvailable, toolGroupUnknown } from "../errors.ts"
import type { ChatMessage } from "../model/provider.ts"
import { LOCAL_PROVIDER_ID } from "./local.ts"
import type { Tool } from "./types.ts"

export const TOOLS_LOAD = "tools_load"

export interface ToolGroup {
    readonly name: string
    readonly description: string
    readonly tools: readonly string[]
    readonly keywords: readonly string[]
}

/** The manifest's `tools.groups`, in declared order. */
export function toolGroupsOf(
    config:
        | Readonly<
              Record<
                  string,
                  {
                      readonly description: string
                      readonly tools: readonly string[]
                      readonly keywords: readonly string[]
                  }
              >
          >
        | undefined,
): readonly ToolGroup[] {
    return Object.entries(config ?? {}).map(([name, group]) => ({
        name,
        description: group.description,
        tools: group.tools,
        keywords: group.keywords,
    }))
}

/** Whether `text` mentions `keyword` at the start of a word, ignoring case. */
export function mentionsKeyword(text: string, keyword: string): boolean {
    const haystack = text.toLowerCase()
    const needle = keyword.trim().toLowerCase()
    if (needle === "") return false
    let from = 0
    while (true) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) return false
        const before = at === 0 ? "" : (haystack[at - 1] ?? "")
        if (!isWordChar(before)) return true
        from = at + 1
    }
}

function isWordChar(char: string): boolean {
    return char !== "" && /[\p{L}\p{N}]/u.test(char)
}

/**
 * What `tools_load` returns, which is how a later turn finds the load. Searched for anywhere in an
 * observation, not anchored: NLT puts an `OBSERVATION <slug> — <state>` header in front of it. A page
 * quoting the sentence could load a set early, which costs its tokens and nothing else.
 */
const LOADED = /Loaded the "([a-z][a-z0-9_-]*)" tools/g

/** NLT puts a call in the assistant's text; native in `toolCalls`. Both count. */
const NLT_ACTION = /^ACTION:\s*(\S+)/gm

/**
 * The groups a turn starts with: those whose keywords the input mentions, and those the session has
 * already loaded — read from what it said and did, so it holds across turns and restarts.
 */
export function activeToolGroups(
    groups: readonly ToolGroup[],
    input: string,
    history: readonly ChatMessage[],
): ReadonlySet<string> {
    if (groups.length === 0) return new Set()
    const said = [input]
    const called = new Set<string>()
    const loaded = new Set<string>()
    for (const message of history) {
        if (isTurnStart(message) && message.origin !== "digest") said.push(message.content)
        for (const call of message.toolCalls ?? []) called.add(call.name)
        if (message.role === "assistant" && message.origin === "call") {
            for (const match of message.content.matchAll(NLT_ACTION)) {
                if (match[1] !== undefined) called.add(match[1])
            }
        }
        if (message.role === "tool" || message.origin === "observation") {
            for (const match of message.content.matchAll(LOADED)) {
                if (match[1] !== undefined) loaded.add(match[1])
            }
        }
    }
    const active = new Set<string>()
    for (const group of groups) {
        if (
            loaded.has(group.name) ||
            group.tools.some((tool) => called.has(tool)) ||
            said.some((text) => group.keywords.some((keyword) => mentionsKeyword(text, keyword)))
        ) {
            active.add(group.name)
        }
    }
    return active
}

/** The slugs held back while `active` is all that is loaded. */
export function withheldSlugs(
    groups: readonly ToolGroup[],
    active: ReadonlySet<string>,
): readonly string[] {
    return groups.filter((group) => !active.has(group.name)).flatMap((group) => group.tools)
}

/**
 * The backstop: loads a set the keywords missed, for the rest of this turn and the session.
 *
 * Its description is the only place the model learns the withheld sets exist, so it names each one
 * with what it is for. "When not to" comes first and concretely, for the reason `phase_set`'s does: a
 * model told that more tools exist elsewhere reads it as an instruction to fetch them, and a greeting
 * that loads the CRM spends exactly what the group exists to save.
 */
export function toolsLoadTool(notLoaded: readonly ToolGroup[]): Tool {
    const names = notLoaded.map((group) => group.name)
    const listed = notLoaded.map((group) => `${group.name} (${group.description})`).join("; ")
    return {
        spec: {
            slug: TOOLS_LOAD,
            provider: LOCAL_PROVIDER_ID,
            summary: `Loads a set of your tools that is not in your list yet. Not loaded: ${listed}.`,
            whenToUse:
                "the person's request needs a tool from one of the sets named here — load that set, then use its tools in your next step of this turn",
            whenNotToUse:
                "the tools you already have can do it, the person only wants an answer or a draft, or the right response is to call no tool at all",
            mutating: false,
            tags: ["read", "control"],
            parameters: {
                type: "object",
                properties: {
                    group: {
                        type: "string",
                        description: "The set to load.",
                        enum: names,
                    },
                },
                required: ["group"],
            },
        },
        async handler(args, context) {
            const name = typeof args.group === "string" ? args.group.trim() : ""
            if (!names.includes(name)) throw toolGroupUnknown(name, names)
            if (context.loadToolGroup === undefined) throw toolGroupNotAvailable()
            const slugs = await context.loadToolGroup(name)
            // Carries the marker `activeToolGroups` reads, so the set stays loaded next turn.
            return `Loaded the "${name}" tools: ${slugs.join(", ") || "none could be loaded"}. They are in your tool list from your next step in this turn.`
        },
    }
}
