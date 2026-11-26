/**
 * Tool groups: pinned tools held out of the request until a conversation needs them (decision 18.2).
 *
 * A catalogue's schemas ride on every model call of every conversation, chit-chat included, and an agent
 * with a CRM and a mail account connected carries both whether the turn touches them or not. A group
 * moves those out of the request without moving them out of the agent:
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
 *   loaded and that this turn could load, so a request the keywords missed ("what did John say
 *   yesterday?") can still reach the mail tools in the same turn, one step later.
 *
 * Keywords match at the **start** of a word, where knowledge matches whole words. The two want
 * opposite errors: a knowledge entry that activates wrongly displaces a better one under a budget, while
 * a group that loads wrongly costs only its tokens — and one that fails to load costs a task.
 *
 * Every slug comparison goes through `normaliseSlug`, the registry's own rule, so a group spelled
 * `gmail_fetch_emails` holds back the tool the registry resolved as `GMAIL_FETCH_EMAILS`.
 */

import { isPersonAuthored } from "../context/compaction/stages.ts"
import { toolGroupEmpty, toolGroupNotAvailable, toolGroupUnknown } from "../errors.ts"
import { TOOLS_LOAD } from "../loop/phases.ts"
import type { ChatMessage } from "../model/provider.ts"
import { LOCAL_PROVIDER_ID } from "./local.ts"
import { normaliseSlug } from "./slug.ts"
import type { Tool } from "./types.ts"

export { TOOLS_LOAD }

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
 * What `tools_load` returns, which is how a later turn finds the load. Read only off a `tools_load`
 * result: native, the `tool` message answering a `tools_load` call id, opening with the sentence; NLT,
 * an `ok` block headed `OBSERVATION tools_load` in the observation after a step that called it. Read off
 * any observation, a fetched page or an email quoting the sentence would load a set for the session.
 */
const LOADED = /^Loaded the "([a-z][a-z0-9_-]*)" tools/
const NLT_LOADED = /^OBSERVATION (\S+) — ok\nLoaded the "([a-z][a-z0-9_-]*)" tools/gm

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
    const isLoad = (slug: string): boolean => normaliseSlug(slug) === normaliseSlug(TOOLS_LOAD)
    /** Native call ids of `tools_load`, so only their answers are read for the marker. */
    const loadCalls = new Set<string>()
    /** The last NLT step called `tools_load`, so its observation may carry the marker. */
    let nltLoad = false
    for (const message of history) {
        // The person's words only. A runtime note is `user`-role too, and the missed-set nudge names
        // every unloaded set with its description — counted here, one nudge loaded them all for good.
        if (isPersonAuthored(message)) said.push(message.content)
        for (const call of message.toolCalls ?? []) {
            called.add(normaliseSlug(call.name))
            if (isLoad(call.name)) loadCalls.add(call.id)
        }
        if (message.role === "assistant" && message.origin === "call") {
            nltLoad = false
            for (const match of message.content.matchAll(NLT_ACTION)) {
                if (match[1] === undefined) continue
                called.add(normaliseSlug(match[1]))
                if (isLoad(match[1])) nltLoad = true
            }
        }
        if (message.role === "tool") {
            const match =
                message.toolCallId !== undefined && loadCalls.has(message.toolCallId)
                    ? LOADED.exec(message.content)
                    : null
            if (match?.[1] !== undefined) loaded.add(match[1])
        } else if (message.origin === "observation" && nltLoad) {
            // ponytail: a fenced page in the same observation as a real `tools_load` could still forge
            // a block at line start; closing that needs the observation stored per result.
            for (const match of message.content.matchAll(NLT_LOADED)) {
                if (match[1] !== undefined && match[2] !== undefined && isLoad(match[1])) {
                    loaded.add(match[2])
                }
            }
            nltLoad = false
        }
    }
    const active = new Set<string>()
    for (const group of groups) {
        if (
            loaded.has(group.name) ||
            group.tools.some((tool) => called.has(normaliseSlug(tool))) ||
            said.some((text) => group.keywords.some((keyword) => mentionsKeyword(text, keyword)))
        ) {
            active.add(group.name)
        }
    }
    return active
}

/**
 * A reply that says the agent has nothing, cannot see or check something, or offers to go and look.
 *
 * The shape of a miss: the keywords did not load the set that held the answer and the model did not load
 * it either, so it answered from what it had. Matched on the reply because that is the only place a miss
 * shows — the model never says "I lack the Gmail tools", it says "I don't have anything from John" or
 * "want me to search your mailbox?". Broad on purpose: a false match costs one extra step, a missed one
 * leaves a wrong answer standing.
 */
const MISSED =
    /\b(?:i\s+(?:do\s+not|don['’]t|didn['’]t|did\s+not)\s+(?:have|see|find|know)|i\s+(?:can['’]t|cannot|can\s+not|couldn['’]t|could\s+not|was\s+not\s+able\s+to|wasn['’]t\s+able\s+to|am\s+unable\s+to|['’]m\s+unable\s+to|am\s+not\s+able\s+to|['’]m\s+not\s+able\s+to)\s+(?:find|see|access|check|search|look|read|open|get|reach|tell)|(?:no|don['’]t\s+have)\s+access|nothing\s+(?:from|about|on|in|for|matching)|no\s+(?:record|mention|sign|trace|information|details?|messages?|emails?|mail|results?)\s+(?:of|from|about|on|for|matching)|(?:i\s+can|i\s+could|want\s+me\s+to|shall\s+i|should\s+i|would\s+you\s+like\s+me\s+to)\s+(?:search|check|look|pull|fetch|go\s+through))/i

/** Whether a reply reads as a miss (see `MISSED`). An empty reply is the silence nudge's, not this. */
export function readsAsMissed(text: string): boolean {
    const visible = text.trim()
    return visible !== "" && MISSED.test(visible)
}

/** The note sent once when a reply reads as a miss while sets are still unloaded. */
export function missedSetNote(notLoaded: readonly ToolGroup[]): string {
    const listed = notLoaded.map((group) => `${group.name} (${group.description})`).join("; ")
    return `From the runtime, not the person: some of your tools are not loaded — ${listed}. If the answer could be in one of these, load it with ${TOOLS_LOAD} and look before you reply. If none of them could hold it, give the person your answer.`
}

/** The slugs held back while `active` is all that is loaded, normalised (see `normaliseSlug`). */
export function withheldSlugs(
    groups: readonly ToolGroup[],
    active: ReadonlySet<string>,
): ReadonlySet<string> {
    return new Set(
        groups
            .filter((group) => !active.has(group.name))
            .flatMap((group) => group.tools.map(normaliseSlug)),
    )
}

/**
 * The groups this turn could actually load: at least one of the group's tools is in `available`, the
 * catalogue the turn is allowed before any group is withheld (normalised slugs).
 *
 * A set whose every tool the turn's allowlist removed — the owner's own mail in a turn that is not the
 * owner's — is not offered by `tools_load` and not named by the nudge: offering it sent the model to load
 * it, nothing came back, and the load was still recorded.
 */
export function reachableGroups(
    groups: readonly ToolGroup[],
    available: ReadonlySet<string>,
): readonly ToolGroup[] {
    return groups.filter((group) => group.tools.some((tool) => available.has(normaliseSlug(tool))))
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
            // The second sentence is written against a measured miss (2026-11-26): asked "what did John
            // say yesterday?" with Gmail not loaded, the model answered from memory that it had nothing
            // and offered to search, where with every tool loaded it searched. Saying "I have nothing"
            // without looking is the one outcome that is a wrong answer rather than a slower one.
            summary: `Loads a set of your tools that is not in your list yet. Not loaded: ${listed}. Before telling the person you have nothing, cannot see something or cannot check it, load the set where the answer could be and look.`,
            whenToUse:
                "the request needs a tool from one of the sets named here, or asks about something that could be in one of them (a message, a deal, an event) — load that set, then use its tools in your next step of this turn",
            whenNotToUse:
                "the tools you already have can do it, or the person only wants an answer, an opinion or a draft that needs nothing from these sets",
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
            // Nothing reachable: an error, never the marker. A "Loaded" line for an empty load would
            // be read back next turn as a set this session has, and offered as loaded for good.
            if (slugs.length === 0) throw toolGroupEmpty(name)
            // Carries the marker `activeToolGroups` reads, so the set stays loaded next turn.
            return `Loaded the "${name}" tools: ${slugs.join(", ")}. They are in your tool list from your next step in this turn.`
        },
    }
}
