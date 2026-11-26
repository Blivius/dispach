/**
 * The history's cache breakpoints.
 *
 * The slots after the history change every turn, so before these two marks the first call of every
 * turn re-wrote the whole conversation at the cache-write price. The property that matters is across
 * two *requests*, not inside one: the previous turn's end-of-history mark must sit at exactly the
 * position, over exactly the bytes, of this turn's turn-before-last mark. A test reading one request
 * can pass with the marks in plausible places and still never produce a cache read.
 */

import { assembleContext } from "../src/context/assemble.ts"
import type { ChatMessage } from "../src/model/provider.ts"
import { describe, expect, test } from "./_harness.ts"

const TURN_ONE: readonly ChatMessage[] = [
    { role: "user", content: "list my projects" },
    {
        role: "assistant",
        content: "",
        origin: "call",
        toolCalls: [{ id: "c1", name: "projects", arguments: "{}" }],
    },
    { role: "tool", content: "[apollo, gemini]", toolCallId: "c1", origin: "observation" },
    { role: "assistant", content: "You have apollo and gemini." },
]
const TURN_TWO: readonly ChatMessage[] = [
    { role: "user", content: "which is late?" },
    { role: "assistant", content: "Gemini is two weeks behind." },
]

function assemble(
    history: readonly ChatMessage[],
    input: string,
    extra: { skills?: boolean; trace?: readonly ChatMessage[] } = {},
) {
    const trace = extra.trace ?? []
    return assembleContext({
        identity: "You are a test fixture.",
        volatile: "The person is Ada.",
        ...(extra.skills
            ? { skills: [{ name: "pdf", content: "How to read a PDF.", role: "system" as const }] }
            : {}),
        reminder: "Answer briefly.",
        note: `today is day ${history.length}`,
        history: [...history, ...trace],
        protectedTail: trace.length,
        traceAfterInput: true,
        input,
        window: 200_000,
        reserveOutput: 1024,
    })
}

const marked = (messages: readonly ChatMessage[]) =>
    messages.flatMap((m, i) => (m.cacheBreakpoint === true ? [i] : []))

/** The request's bytes up to and including position `at`, markers removed. */
const prefix = (messages: readonly ChatMessage[], at: number) =>
    JSON.stringify(messages.slice(0, at + 1).map(({ cacheBreakpoint: _, ...rest }) => rest))

describe("history cache breakpoints", () => {
    test("two prior turns: the static prefix, the end of turn one and the end of turn two", () => {
        const { messages } = assemble([...TURN_ONE, ...TURN_TWO], "and the other?")
        const points = marked(messages)
        expect(points.length).toBe(3)
        const [, h1, h2] = points
        expect(messages[h1 ?? -1]?.content).toBe("You have apollo and gemini.")
        expect(messages[h2 ?? -1]?.content).toBe("Gemini is two weeks behind.")
        // Nothing that changes per turn is marked.
        for (const i of points) {
            expect(messages[i]?.content).not.toBe("Answer briefly.")
            expect(messages[i]?.turnInput).toBe(undefined)
        }
    })

    test("next turn's turn-before-last mark is this turn's end-of-history mark, byte for byte", () => {
        // The guard that makes it a cache read and not merely a cache write: request N writes at its
        // H2, and request N+1 must ask at the same position over the same bytes.
        const now = assemble([...TURN_ONE], "which is late?").messages
        const next = assemble([...TURN_ONE, ...TURN_TWO], "and the other?").messages
        const written = marked(now).at(-1) ?? -1
        const asked = marked(next).at(-2) ?? -2
        expect(written).toBe(asked)
        expect(prefix(next, asked)).toBe(prefix(now, written))
    })

    test("a one-turn history marks its end and keeps the skill's mark; three at most either way", () => {
        const one = assemble([...TURN_ONE], "which is late?", { skills: true }).messages
        expect(marked(one).length).toBe(3)
        expect(one.some((m) => m.cacheBreakpoint === true && m.content.includes("PDF"))).toBe(true)
        // With both history marks the skill's is dropped: a hit at H1 covers it, and the transport
        // adds a fourth, rolling, point. Five is a refused request on Converse and Anthropic alike.
        const two = assemble([...TURN_ONE, ...TURN_TWO], "next?", { skills: true }).messages
        expect(marked(two).length).toBe(3)
        expect(two.some((m) => m.cacheBreakpoint === true && m.content.includes("PDF"))).toBe(false)
    })

    test("no history: only the static prefix and the skill", () => {
        const { messages } = assemble([], "hello", { skills: true })
        expect(marked(messages).length).toBe(2)
    })

    test("the current turn's trace after the input is the rolling point's, never a history mark", () => {
        const trace: ChatMessage[] = [
            {
                role: "assistant",
                content: "",
                origin: "call",
                toolCalls: [{ id: "c2", name: "projects", arguments: "{}" }],
            },
            { role: "tool", content: "[apollo]", toolCallId: "c2", origin: "observation" },
        ]
        const { messages } = assemble([...TURN_ONE, ...TURN_TWO], "and the other?", { trace })
        const input = messages.findIndex((m) => m.turnInput === true)
        expect(input > 0).toBe(true)
        for (const i of marked(messages)) expect(i < input).toBe(true)
    })

    test("after a checkpoint the digest-led history still chains from one turn to the next", () => {
        // A `reset` leaves a digest where the older turns were; the conversation then grows from it.
        const digest: ChatMessage = {
            role: "user",
            content: "Summary of earlier work.",
            origin: "digest",
        }
        const now = assemble([digest, ...TURN_TWO], "and the other?").messages
        const next = assemble(
            [
                digest,
                ...TURN_TWO,
                { role: "user", content: "and the other?" },
                { role: "assistant", content: "Apollo is on time." },
            ],
            "thanks",
        ).messages
        const written = marked(now).at(-1) ?? -1
        const asked = marked(next).at(-2) ?? -2
        expect(written).toBe(asked)
        expect(prefix(next, asked)).toBe(prefix(now, written))
    })

    test("a digest alone is not a turn: nothing ahead of it is taken for the turn before the last", () => {
        // Were the digest a turn start, the block before it would be marked as H1. Here that block is
        // turn one's answer, and the digest that follows it is not a request anybody made.
        const digest: ChatMessage = { role: "user", content: "Summary.", origin: "digest" }
        const { messages } = assemble(
            [...TURN_ONE.slice(0, 1), TURN_ONE[3] as ChatMessage, digest],
            "next?",
        )
        const points = marked(messages)
        expect(points.length).toBe(2)
        expect(messages[points.at(-1) ?? -1]?.content).toBe("Summary.")
    })

    test("a repair note inside the previous turn does not move the mark the next turn reads at", () => {
        // A repair or a nudge is `user`-role. Taken for the start of a turn, it put the read mark inside
        // the previous turn, one place short of where that turn's write mark was, and every turn after a
        // nudge missed the history cache.
        const now = assemble([...TURN_ONE], "which is late?").messages
        const next = assemble(
            [
                ...TURN_ONE,
                { role: "user", content: "which is late?" },
                {
                    role: "user",
                    origin: "repair",
                    content: "From the runtime, not the person: some of your tools are not loaded.",
                },
                { role: "assistant", content: "Gemini is two weeks behind." },
            ],
            "and the other?",
        ).messages
        const written = marked(now).at(-1) ?? -1
        const asked = marked(next).at(-2) ?? -2
        expect(asked).toBe(written)
        expect(prefix(next, asked)).toBe(prefix(now, written))
    })
})
