import { describe, expect, test } from "bun:test"
import type { AnyEvent, EventDataMap, EventType } from "@dispach/core"
import { StatusCode } from "../src/proto.ts"
import { type Ids, TraceBuilder } from "../src/spans.ts"

/** Sequential ids, so a parent can be asserted by value. */
function counter(): Ids {
    let n = 0
    const next = (size: number) => {
        n += 1
        const bytes = new Uint8Array(size)
        bytes[size - 1] = n
        return bytes
    }
    return { traceId: () => next(16), spanId: () => next(8) }
}

let clock = Date.parse("2026-11-25T10:00:00.000Z")

function ev<K extends EventType>(
    type: K,
    data: EventDataMap[K],
    context: { turnId?: string; sessionKey?: string; parentTurnId?: string } = {},
): AnyEvent {
    clock += 10
    return {
        v: 1,
        ts: new Date(clock).toISOString(),
        runtimeId: "r",
        agentId: "support",
        sessionKey: context.sessionKey ?? "local:abc",
        ...(context.turnId === undefined ? {} : { turnId: context.turnId }),
        ...(context.parentTurnId === undefined ? {} : { parentTurnId: context.parentTurnId }),
        type,
        data,
    } as AnyEvent
}

const T1 = { turnId: "t1" }
const start = (context = T1) =>
    ev("turn.start", { source: "api", inputTokens: 5, trust: "trusted" }, context)
const end = (reason: EventDataMap["turn.end"]["reason"] = "final", context = T1) =>
    ev(
        "turn.end",
        { reason, steps: 2, tokens: { prompt: 100, output: 20 }, durationMs: 50 },
        context,
    )
const modelCall = (callId: string, context = T1) =>
    ev(
        "model.call",
        { role: "main", model: "m1", promptTokens: 90, cached: false, attempt: 1, callId },
        context,
    )
const modelResult = (callId: string, context = T1) =>
    ev(
        "model.result",
        {
            outputTokens: 20,
            promptTokens: 90,
            promptTokensReported: true,
            finishReason: "stop",
            latencyMs: 30,
            firstTokenMs: 12,
            callId,
            model: "m1",
            role: "main",
            cachedPromptTokens: 64,
        },
        context,
    )

const byName = (spans: ReturnType<TraceBuilder["observe"]>, name: string) => {
    const span = spans.find((s) => s.name === name)
    if (span === undefined) throw new Error(`no span named ${name}: ${spans.map((s) => s.name)}`)
    return span
}

describe("one turn", () => {
    test("is held until the turn ends, then emitted whole with the model and tool under it", () => {
        const builder = new TraceBuilder({ ids: counter() })
        const pending = [
            start(),
            modelCall("c1"),
            modelResult("c1"),
            ev(
                "tool.call",
                { slug: "web_fetch", callId: "k1", argsHash: "h", mutating: false },
                T1,
            ),
            ev(
                "tool.result",
                {
                    slug: "web_fetch",
                    callId: "k1",
                    ok: true,
                    latencyMs: 5,
                    bytes: 300,
                    truncated: false,
                    trust: "untrusted",
                },
                T1,
            ),
        ].flatMap((e) => builder.observe(e))
        expect(pending).toEqual([])
        expect(builder.open).toBe(1)

        const spans = builder.observe(end())
        expect(builder.open).toBe(0)
        expect(spans.map((s) => s.name)).toEqual([
            "invoke_agent support",
            "chat m1",
            "execute_tool web_fetch",
        ])
        const turn = byName(spans, "invoke_agent support")
        expect(turn.parentSpanId).toBeUndefined()
        for (const child of spans.slice(1)) {
            expect(child.parentSpanId).toEqual(turn.spanId)
            expect(child.traceId).toEqual(turn.traceId)
        }
        expect(turn.attributes).toMatchObject({
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.conversation.id": "local:abc",
            "openinference.span.kind": "AGENT",
            "session.id": "local:abc",
            "agent.turn.end_reason": "final",
            "gen_ai.usage.input_tokens": 100,
            "llm.token_count.total": 120,
        })
        expect(byName(spans, "chat m1").attributes).toMatchObject({
            "gen_ai.request.model": "m1",
            "gen_ai.response.finish_reasons": ["stop"],
            "openinference.span.kind": "LLM",
            "llm.model_name": "m1",
            "model.cached_prompt_tokens": 64,
            "model.first_token_ms": 12,
        })
        expect(byName(spans, "execute_tool web_fetch").attributes).toMatchObject({
            "gen_ai.tool.name": "web_fetch",
            "gen_ai.tool.call.id": "k1",
            "openinference.span.kind": "TOOL",
            "tool.trust": "untrusted",
        })
        expect(turn.status.code).toBe(StatusCode.unset)
    })

    test("carries no text: the reply on turn.end never reaches an attribute", () => {
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        const spans = builder.observe(
            ev(
                "turn.end",
                {
                    reason: "final",
                    steps: 1,
                    tokens: { prompt: 1, output: 1 },
                    durationMs: 1,
                    finalText: "the customer's address is 12 Elm St",
                },
                T1,
            ),
        )
        expect(JSON.stringify(spans)).not.toContain("Elm St")
    })

    test("a turn that ends badly is an error span, naming the reason", () => {
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        const [turn] = builder.observe(end("max_steps"))
        expect(turn?.status).toEqual({ code: StatusCode.error, message: "max_steps" })
    })

    test("a model call with no result is closed at the turn's end as an error, not dropped", () => {
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        builder.observe(modelCall("c1"))
        const spans = builder.observe(end("error"))
        const model = byName(spans, "chat m1")
        expect(model.status.code).toBe(StatusCode.error)
        expect(model.endMs).toBe(byName(spans, "invoke_agent support").endMs)
    })

    test("a retried call is one span: the second model.call for the same id does not open another", () => {
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        builder.observe(modelCall("c1"))
        builder.observe(modelCall("c1"))
        builder.observe(modelResult("c1"))
        expect(builder.observe(end()).filter((s) => s.name === "chat m1")).toHaveLength(1)
    })

    test("gates, repairs and compaction are points on the turn's timeline", () => {
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        builder.observe(
            ev(
                "tool.gated",
                { slug: "exec", callId: "k9", reason: "untrusted turn", policy: "refuse" },
                T1,
            ),
        )
        builder.observe(
            ev("compaction.stage", { stage: "snip", before: 900, after: 400, changed: true }, T1),
        )
        const [turn] = builder.observe(end())
        expect(turn?.events.map((e) => [e.name, e.attributes])).toEqual([
            ["tool.gated", { slug: "exec", callId: "k9", policy: "refuse" }],
            ["compaction.stage", { stage: "snip", before: 900, after: 400, changed: true }],
        ])
    })

    test("a command, a path or model-written text in an event's fields never reaches a span", () => {
        // `approval.requested.match` is the literal command a rule matched; copying every string
        // field shipped it. Each field that can carry text somebody typed or a model wrote is planted.
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        builder.observe(
            ev(
                "approval.requested",
                {
                    approvalId: "a1",
                    slug: "exec",
                    callId: "k1",
                    match: "cat ~/.ssh/id_ed25519",
                    mutating: true,
                    reason: "exec(cat:*) asks",
                },
                T1,
            ),
        )
        builder.observe(
            ev(
                "tool.repair",
                { slugs: ["exec"], errors: ["command: cat ~/.ssh/id_ed25519 is not valid"] },
                T1,
            ),
        )
        builder.observe(
            ev(
                "agent.warning",
                { code: "x", message: "the reply quoted cat ~/.ssh/id_ed25519", hint: "h" },
                T1,
            ),
        )
        builder.observe(
            ev("tool.call", { slug: "delegate", callId: "k2", argsHash: "h", mutating: false }, T1),
        )
        builder.observe(
            ev(
                "handoff.start",
                {
                    member: "support",
                    task: "read cat ~/.ssh/id_ed25519",
                    sessionKey: "self:c",
                    kind: "self",
                    callId: "k2",
                    index: 0,
                    label: "cat ~/.ssh/id_ed25519",
                },
                T1,
            ),
        )
        const spans = builder.observe(end())
        expect(JSON.stringify(spans)).not.toContain("id_ed25519")
        expect(spans[0]?.events.map((e) => e.name)).toEqual([
            "approval.requested",
            "tool.repair",
            "agent.warning",
        ])
    })

    test("an event for a turn this builder never saw start is ignored", () => {
        const builder = new TraceBuilder({ ids: counter() })
        expect(builder.observe(modelCall("c1"))).toEqual([])
        expect(builder.observe(end())).toEqual([])
        expect(builder.open).toBe(0)
    })
})

describe("delegation", () => {
    test("a subagent's turn nests under the handoff, under the delegate call, in one trace", () => {
        const builder = new TraceBuilder({ ids: counter() })
        const child = { turnId: "t2", sessionKey: "self:child", parentTurnId: "t1" }
        const out = [
            start(),
            ev("tool.call", { slug: "delegate", callId: "k1", argsHash: "h", mutating: false }, T1),
            ev(
                "handoff.start",
                {
                    member: "support",
                    task: "look it up",
                    sessionKey: "self:child",
                    kind: "self",
                    name: "researcher",
                    callId: "k1",
                    index: 0,
                    label: "lookup",
                },
                T1,
            ),
            start(child),
            modelCall("c2", child),
            modelResult("c2", child),
            end("final", child),
            ev(
                "handoff.result",
                {
                    member: "support",
                    sessionKey: "self:child",
                    kind: "self",
                    name: "researcher",
                    callId: "k1",
                    index: 0,
                    outcome: "ok",
                    steps: 1,
                    tokens: { prompt: 50, output: 5 },
                },
                T1,
            ),
            ev(
                "tool.result",
                {
                    slug: "delegate",
                    callId: "k1",
                    ok: true,
                    latencyMs: 40,
                    bytes: 80,
                    truncated: false,
                    trust: "trusted",
                },
                T1,
            ),
        ].flatMap((e) => builder.observe(e))
        // The child's turn.end does not emit: it belongs to t1's trace.
        expect(out).toEqual([])

        const spans = builder.observe(end())
        const tool = byName(spans, "execute_tool delegate")
        const handoff = byName(spans, "invoke_agent researcher")
        const childTurn = spans.find((s) => s.attributes["agent.turn.id"] === "t2")
        const childModel = spans.filter((s) => s.name === "chat m1")[0]
        expect(handoff.parentSpanId).toEqual(tool.spanId)
        expect(childTurn?.parentSpanId).toEqual(handoff.spanId)
        expect(childModel?.parentSpanId).toEqual(childTurn?.spanId)
        expect(new Set(spans.map((s) => Buffer.from(s.traceId).toString("hex"))).size).toBe(1)
        expect(handoff.attributes).toMatchObject({
            "handoff.outcome": "ok",
            "handoff.index": 0,
        })
    })
})

describe("bounds", () => {
    test("runtime.stopping emits every open trace as it stands", () => {
        const builder = new TraceBuilder({ ids: counter() })
        builder.observe(start())
        builder.observe(start({ turnId: "t2" }))
        const spans = builder.observe(ev("runtime.stopping", { reason: "SIGTERM" }))
        expect(spans).toHaveLength(2)
        expect(spans.every((s) => s.status.code === StatusCode.error)).toBe(true)
        expect(builder.open).toBe(0)
    })

    test("past the cap the oldest open trace is emitted unfinished, so a dead turn cannot leak", () => {
        const builder = new TraceBuilder({ ids: counter(), maxOpenTraces: 2 })
        builder.observe(start({ turnId: "a" }))
        builder.observe(start({ turnId: "b" }))
        const evicted = builder.observe(start({ turnId: "c" }))
        expect(evicted.map((s) => s.attributes["agent.turn.id"])).toEqual(["a"])
        expect(evicted[0]?.status).toEqual({ code: StatusCode.error, message: "turn never ended" })
        expect(builder.open).toBe(2)
    })
})
