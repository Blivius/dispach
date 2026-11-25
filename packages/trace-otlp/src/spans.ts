/**
 * Lifecycle events → OTLP spans. Pure: events in, finished spans out, no clock and no I/O.
 *
 * One trace per top-level turn:
 *
 *     invoke_agent <agent>            turn.start … turn.end
 *       chat <model>                  model.call … model.result
 *       execute_tool <slug>           tool.call … tool.result
 *         invoke_agent <subagent>     handoff.start … handoff.result
 *           invoke_agent <agent>      the subagent's own turn, nested by its session key
 *         invoke_agent <peer>         peer.ask … peer.answer
 *
 * A handoff or a peer ask hangs off the tool call that made it, by `callId`, or off the turn when
 * that call is not open.
 *
 * Everything else worth seeing on a timeline (a gated call, a repair, a compaction stage, a retry,
 * a fallback, a warning) is a span **event** on the turn, not a span: none has a duration, and a
 * zero-length span is a bar nobody can click.
 *
 * A trace is emitted whole when its top-level turn ends, so an export never carries a child whose
 * parent has not been sent. Anything still open then (a model call that threw before its result)
 * is closed at the turn's end and marked an error, never dropped: a hole in a trace reads as a gap
 * in time, which is the wrong story.
 *
 * **Metadata only** (decision 16.3). Nothing here reads `turn.end.finalText`, a redacted tool
 * argument, a handoff's `task` or `label`, or any event field `MARKS` does not list.
 *
 * Attribute names are two vocabularies at once: OpenTelemetry's `gen_ai.*` (still Development
 * status, so pinned by `SEMCONV` below) for collectors and APM backends, and OpenInference's
 * `openinference.span.kind` / `llm.*` / `tool.*`, which is what Phoenix renders. Two keys for one
 * fact costs bytes, not design.
 */

import { randomBytes } from "node:crypto"
import type { AnyEvent } from "@dispach/core"
import { type Attributes, type SpanData, type SpanEvent, SpanKind, StatusCode } from "./proto.ts"

/** The `semantic-conventions-genai` revision these `gen_ai.*` names were read from. */
export const SEMCONV = "gen-ai Development, read 2026-11-25"

export interface Ids {
    traceId(): Uint8Array
    spanId(): Uint8Array
}

const RANDOM_IDS: Ids = { traceId: () => randomBytes(16), spanId: () => randomBytes(8) }

interface OpenSpan {
    readonly trace: Trace
    readonly spanId: Uint8Array
    readonly parentSpanId: Uint8Array | undefined
    name: string
    readonly kind: number
    readonly startMs: number
    endMs: number | undefined
    readonly attributes: Record<string, Attributes[string]>
    readonly events: SpanEvent[]
    status: { code: number; message?: string }
}

interface Trace {
    readonly traceId: Uint8Array
    /** The top-level turn. Its end emits the trace. */
    readonly rootTurnId: string
    readonly spans: OpenSpan[]
}

export interface TraceBuilderOptions {
    readonly ids?: Ids
    /**
     * Traces held open at once before the oldest is emitted unfinished. A turn whose `turn.end`
     * never arrives (the process that ran it was killed) would otherwise be held forever.
     */
    readonly maxOpenTraces?: number
}

const ms = (event: AnyEvent): number => Date.parse(event.ts)

const ERROR_REASONS = new Set(["max_steps", "no_progress", "truncated", "timeout", "error"])

/**
 * Events shown as a point on the turn's timeline, and the fields of each that may leave the process.
 *
 * An allowlist per event, never "every scalar": `approval.requested.match` is the command or path a
 * rule matched, unredacted, and a `reason`, a repair's `errors` or a warning's `message` can quote
 * arguments. Copying every string field shipped the literal `exec` command to the trace backend while
 * the docs said spans carry no tool input. A field added to an event later is dropped until it is
 * listed here, which is the safe direction.
 */
const MARKS: Readonly<Partial<Record<AnyEvent["type"], readonly string[]>>> = {
    "tool.gated": ["slug", "callId", "policy"],
    "tool.repair": ["slugs"],
    "compaction.stage": ["stage", "before", "after", "changed", "digest"],
    "context.dropped": ["messages", "budget", "keptTokens"],
    "context.reset": ["count"],
    "model.retry": ["status", "attempt", "delayMs"],
    "model.fallback": ["from", "to", "reason"],
    "phase.changed": ["to", "tools"],
    "approval.requested": ["approvalId", "slug", "callId", "mutating"],
    "approval.resolved": ["approvalId", "slug", "granted", "by"],
    "agent.warning": ["code", "field"],
}

/** The listed fields of a mark's data, scalars and string lists only. */
function markAttributes(data: unknown, keys: readonly string[]): Attributes {
    const out: Record<string, Attributes[string]> = {}
    if (typeof data !== "object" || data === null) return out
    const record = data as Record<string, unknown>
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            out[key] = value
        } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
            out[key] = value as string[]
        }
    }
    return out
}

export class TraceBuilder {
    readonly #ids: Ids
    readonly #maxOpen: number
    readonly #traces = new Map<string, Trace>()
    readonly #turns = new Map<string, OpenSpan>()
    readonly #models = new Map<string, OpenSpan>()
    readonly #tools = new Map<string, OpenSpan>()
    /** Keyed by the child's session key, which is how its `turn.start` finds its parent. */
    readonly #handoffs = new Map<string, OpenSpan>()
    readonly #peers = new Map<string, OpenSpan>()

    constructor(options: TraceBuilderOptions = {}) {
        this.#ids = options.ids ?? RANDOM_IDS
        this.#maxOpen = options.maxOpenTraces ?? 256
    }

    /** How many traces are waiting on their top-level turn. */
    get open(): number {
        return this.#traces.size
    }

    /** Feed one event. Returns the spans of any trace it finished, or an empty list. */
    observe(event: AnyEvent): SpanData[] {
        if (event.type === "runtime.stopping") return this.flush(ms(event))
        const turnId = event.turnId
        if (turnId === undefined) return []

        switch (event.type) {
            case "turn.start":
                return this.#turnStart(event, turnId)
            case "turn.end": {
                const span = this.#turns.get(turnId)
                if (span === undefined) return []
                const { reason, steps, tokens, durationMs } = event.data
                this.#close(span, ms(event), {
                    "agent.turn.end_reason": reason,
                    "agent.turn.steps": steps,
                    "agent.turn.duration_ms": durationMs,
                    "gen_ai.usage.input_tokens": tokens.prompt,
                    "gen_ai.usage.output_tokens": tokens.output,
                    "llm.token_count.prompt": tokens.prompt,
                    "llm.token_count.completion": tokens.output,
                    "llm.token_count.total": tokens.prompt + tokens.output,
                })
                if (ERROR_REASONS.has(reason))
                    span.status = { code: StatusCode.error, message: reason }
                return span.trace.rootTurnId === turnId ? this.#emit(span.trace, ms(event)) : []
            }
            case "model.call": {
                const turn = this.#turns.get(turnId)
                const { callId, model, role } = event.data
                // One call is one id across its retries; the first attempt starts the span.
                if (turn === undefined || this.#models.has(callId)) return []
                this.#models.set(
                    callId,
                    this.#open(turn.trace, turn, `chat ${model}`, SpanKind.client, ms(event), {
                        "gen_ai.operation.name": "chat",
                        "gen_ai.request.model": model,
                        "openinference.span.kind": "LLM",
                        "model.role": role,
                    }),
                )
                return []
            }
            case "model.result": {
                const span = this.#models.get(event.data.callId)
                if (span === undefined) return []
                const data = event.data
                this.#models.delete(data.callId)
                this.#close(span, ms(event), {
                    "gen_ai.response.model": data.model,
                    "gen_ai.response.finish_reasons": [data.finishReason],
                    "gen_ai.usage.input_tokens": data.promptTokens,
                    "gen_ai.usage.output_tokens": data.outputTokens,
                    "llm.model_name": data.model,
                    "llm.token_count.prompt": data.promptTokens,
                    "llm.token_count.completion": data.outputTokens,
                    "llm.token_count.total": data.promptTokens + data.outputTokens,
                    "model.prompt_tokens_reported": data.promptTokensReported,
                    "model.cached_prompt_tokens": data.cachedPromptTokens,
                    "model.cache_write_tokens": data.cacheWriteTokens,
                    "model.first_token_ms": data.firstTokenMs,
                    "model.latency_ms": data.latencyMs,
                })
                return []
            }
            case "tool.call": {
                const turn = this.#turns.get(turnId)
                const { slug, callId, mutating } = event.data
                if (turn === undefined) return []
                this.#tools.set(
                    callId,
                    this.#open(
                        turn.trace,
                        turn,
                        `execute_tool ${slug}`,
                        SpanKind.internal,
                        ms(event),
                        {
                            "gen_ai.operation.name": "execute_tool",
                            "gen_ai.tool.name": slug,
                            "gen_ai.tool.call.id": callId,
                            "gen_ai.tool.type": "function",
                            "openinference.span.kind": "TOOL",
                            "tool.name": slug,
                            "tool.mutating": mutating,
                        },
                    ),
                )
                return []
            }
            case "tool.result": {
                const span = this.#tools.get(event.data.callId)
                if (span === undefined) return []
                const { ok, bytes, truncated, trust } = event.data
                this.#tools.delete(event.data.callId)
                this.#close(span, ms(event), {
                    "tool.ok": ok,
                    "tool.output_bytes": bytes,
                    "tool.truncated": truncated,
                    "tool.trust": trust,
                })
                if (!ok) span.status = { code: StatusCode.error, message: "tool returned an error" }
                return []
            }
            case "handoff.start": {
                const turn = this.#turns.get(turnId)
                if (turn === undefined) return []
                const data = event.data
                const parent =
                    (data.callId === undefined ? undefined : this.#tools.get(data.callId)) ?? turn
                const agent = data.name ?? data.member
                this.#handoffs.set(
                    data.sessionKey,
                    this.#open(
                        turn.trace,
                        parent,
                        `invoke_agent ${agent}`,
                        SpanKind.internal,
                        ms(event),
                        {
                            "gen_ai.operation.name": "invoke_agent",
                            "gen_ai.agent.name": agent,
                            "gen_ai.conversation.id": data.sessionKey,
                            "openinference.span.kind": "AGENT",
                            "handoff.kind": data.kind,
                            // Not `label` or `task`: the model wrote both, and either can quote
                            // the conversation.
                            "handoff.index": data.index,
                        },
                    ),
                )
                return []
            }
            case "handoff.result": {
                const span = this.#handoffs.get(event.data.sessionKey)
                if (span === undefined) return []
                const { outcome, steps, tokens } = event.data
                this.#handoffs.delete(event.data.sessionKey)
                this.#close(span, ms(event), {
                    "handoff.outcome": outcome,
                    "handoff.steps": steps,
                    "gen_ai.usage.input_tokens": tokens.prompt,
                    "gen_ai.usage.output_tokens": tokens.output,
                })
                if (outcome === "error") span.status = { code: StatusCode.error, message: outcome }
                return []
            }
            case "peer.ask": {
                const turn = this.#turns.get(turnId)
                if (turn === undefined) return []
                const data = event.data
                const parent =
                    (data.callId === undefined ? undefined : this.#tools.get(data.callId)) ?? turn
                this.#peers.set(
                    data.askId,
                    this.#open(
                        turn.trace,
                        parent,
                        `invoke_agent ${data.peer}`,
                        SpanKind.client,
                        ms(event),
                        {
                            "gen_ai.operation.name": "invoke_agent",
                            "gen_ai.agent.name": data.peer,
                            "openinference.span.kind": "AGENT",
                            "peer.remote": data.remote,
                        },
                    ),
                )
                return []
            }
            case "peer.answer": {
                const span = this.#peers.get(event.data.askId)
                if (span === undefined) return []
                const { outcome, steps, tokens } = event.data
                this.#peers.delete(event.data.askId)
                this.#close(span, ms(event), {
                    "peer.outcome": outcome,
                    "peer.steps": steps,
                    "gen_ai.usage.input_tokens": tokens.prompt,
                    "gen_ai.usage.output_tokens": tokens.output,
                })
                if (outcome === "error") span.status = { code: StatusCode.error, message: outcome }
                return []
            }
            default: {
                const keys = MARKS[event.type]
                if (keys === undefined) return []
                const turn = this.#turns.get(turnId)
                turn?.events.push({
                    name: event.type,
                    timeMs: ms(event),
                    attributes: markAttributes(event.data, keys),
                })
                return []
            }
        }
    }

    /** Emit every open trace as it stands, its unfinished spans closed at `endMs`. */
    flush(endMs: number): SpanData[] {
        return [...this.#traces.values()].flatMap((trace) => this.#emit(trace, endMs))
    }

    #turnStart(event: Extract<AnyEvent, { type: "turn.start" }>, turnId: string): SpanData[] {
        if (this.#turns.has(turnId)) return []
        const { source, trust, inputKind } = event.data
        const sessionKey = event.sessionKey
        const agent = event.agentId ?? "agent"
        const attributes = {
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.name": agent,
            "gen_ai.conversation.id": sessionKey,
            "openinference.span.kind": "AGENT",
            "session.id": sessionKey,
            "agent.turn.id": turnId,
            "agent.turn.source": source,
            "agent.turn.trust": trust,
            "agent.turn.input_kind": inputKind,
            "agent.turn.sender_kind": event.data.from?.kind,
        }

        // A subagent's turn hangs off the handoff that started it, found by its session key; a turn
        // whose parent this instance never saw starts a trace of its own rather than guessing.
        const parent =
            (sessionKey === undefined ? undefined : this.#handoffs.get(sessionKey)) ??
            (event.parentTurnId === undefined ? undefined : this.#turns.get(event.parentTurnId))
        let trace = parent?.trace
        const out: SpanData[] = []
        if (trace === undefined) {
            if (this.#traces.size >= this.#maxOpen) {
                // ponytail: evicts the oldest open trace; per-session bounds if one session hogs it.
                const oldest = this.#traces.values().next().value
                if (oldest !== undefined)
                    out.push(...this.#emit(oldest, ms(event), "turn never ended"))
            }
            trace = { traceId: this.#ids.traceId(), rootTurnId: turnId, spans: [] }
            this.#traces.set(turnId, trace)
        }
        this.#turns.set(
            turnId,
            this.#open(
                trace,
                parent,
                `invoke_agent ${agent}`,
                SpanKind.internal,
                ms(event),
                attributes,
            ),
        )
        return out
    }

    #open(
        trace: Trace,
        parent: OpenSpan | undefined,
        name: string,
        kind: number,
        startMs: number,
        attributes: Attributes,
    ): OpenSpan {
        const span: OpenSpan = {
            trace,
            spanId: this.#ids.spanId(),
            parentSpanId: parent?.spanId,
            name,
            kind,
            startMs,
            endMs: undefined,
            attributes: { ...attributes },
            events: [],
            status: { code: StatusCode.unset },
        }
        trace.spans.push(span)
        return span
    }

    #close(span: OpenSpan, endMs: number, attributes: Attributes): void {
        span.endMs = endMs
        Object.assign(span.attributes, attributes)
    }

    #emit(
        trace: Trace,
        endMs: number,
        unfinished = "closed before its end event arrived",
    ): SpanData[] {
        this.#traces.delete(trace.rootTurnId)
        for (const map of [this.#turns, this.#models, this.#tools, this.#handoffs, this.#peers]) {
            for (const [key, span] of map) if (span.trace === trace) map.delete(key)
        }
        return trace.spans.map((span) => {
            if (span.endMs === undefined) {
                span.endMs = endMs
                span.status = { code: StatusCode.error, message: unfinished }
            }
            const { status, ...rest } = span
            return {
                traceId: trace.traceId,
                spanId: rest.spanId,
                ...(rest.parentSpanId === undefined ? {} : { parentSpanId: rest.parentSpanId }),
                name: rest.name,
                kind: rest.kind,
                startMs: rest.startMs,
                endMs: span.endMs,
                attributes: rest.attributes,
                events: rest.events,
                status: status.message === undefined ? { code: status.code } : status,
            }
        })
    }
}
