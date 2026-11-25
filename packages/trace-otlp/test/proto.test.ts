import { describe, expect, test } from "bun:test"
import { encodeExport, type SpanData } from "../src/proto.ts"
import { attrs, decode, hex, one, spansOf, sub, subs, text } from "./decode.ts"

const SPAN: SpanData = {
    traceId: Uint8Array.from({ length: 16 }, (_, i) => i + 1),
    spanId: Uint8Array.from({ length: 8 }, (_, i) => 0xa0 + i),
    parentSpanId: Uint8Array.from({ length: 8 }, (_, i) => 0xb0 + i),
    name: "chat m1",
    kind: 3,
    startMs: Date.parse("2026-11-25T10:00:00.000Z"),
    endMs: Date.parse("2026-11-25T10:00:01.250Z"),
    attributes: {
        "gen_ai.request.model": "m1",
        "llm.token_count.prompt": 90,
        "model.prompt_tokens_reported": true,
        ratio: 0.5,
        negative: -3,
        zero: 0,
        "gen_ai.response.finish_reasons": ["stop"],
        skipped: undefined,
    },
    events: [
        {
            name: "tool.gated",
            timeMs: Date.parse("2026-11-25T10:00:00.500Z"),
            attributes: { slug: "exec" },
        },
    ],
    status: { code: 2, message: "max_steps" },
}

const REQUEST = {
    resource: { "service.name": "support" },
    scope: { name: "trace-otlp", version: "0.1.0" },
    spans: [SPAN],
}

describe("encodeExport", () => {
    test("lays out ExportTraceServiceRequest → ResourceSpans → ScopeSpans → Span by field number", () => {
        const request = decode(encodeExport(REQUEST))
        const resourceSpans = sub(request, 1)
        expect(attrs(sub(resourceSpans, 1), 1)).toEqual({ "service.name": "support" })
        const scopeSpans = sub(resourceSpans, 2)
        const scope = sub(scopeSpans, 1)
        expect([text(scope, 1), text(scope, 2)]).toEqual(["trace-otlp", "0.1.0"])

        const [span] = subs(scopeSpans, 2)
        if (span === undefined) throw new Error("no span")
        expect(hex(one(span, 1))).toBe("0102030405060708090a0b0c0d0e0f10")
        expect(hex(one(span, 2))).toBe("a0a1a2a3a4a5a6a7")
        expect(hex(one(span, 4))).toBe("b0b1b2b3b4b5b6b7")
        expect(text(span, 5)).toBe("chat m1")
        expect(one(span, 6)).toBe(3n)
        expect(one(span, 7)).toBe(BigInt(SPAN.startMs) * 1_000_000n)
        expect(one(span, 8)).toBe(BigInt(SPAN.endMs) * 1_000_000n)
        const attributes = attrs(span, 9)
        expect(attributes).toEqual({
            "gen_ai.request.model": "m1",
            "llm.token_count.prompt": 90n,
            "model.prompt_tokens_reported": true,
            ratio: one(sub(subs(span, 9)[3] ?? new Map(), 2), 4),
            negative: -3n,
            zero: 0n,
            "gen_ai.response.finish_reasons": ["stop"],
        })
        // 0.5 as an IEEE double, little-endian: the bit pattern of 0x3fe0000000000000.
        expect(attributes.ratio).toBe(0x3fe0000000000000n)

        const [event] = subs(span, 11)
        if (event === undefined) throw new Error("no event")
        expect(one(event, 1)).toBe(BigInt(SPAN.startMs + 500) * 1_000_000n)
        expect(text(event, 2)).toBe("tool.gated")
        expect(attrs(event, 3)).toEqual({ slug: "exec" })

        const status = sub(span, 15)
        expect([text(status, 2), one(status, 3)]).toEqual(["max_steps", 2n])
    })

    test("a root span has no parent field, and an unset status writes no code", () => {
        const { parentSpanId: _, ...root } = SPAN
        const [span] = spansOf(
            encodeExport({ ...REQUEST, spans: [{ ...root, status: { code: 0 } }] }),
        )
        expect(span?.has(4)).toBe(false)
        expect(sub(span ?? new Map(), 15).size).toBe(0)
    })

    test("a large batch does not overflow the stack", () => {
        // Spreading a nested message's bytes into push() threw RangeError at this size.
        const spans = Array.from({ length: 5_000 }, () => SPAN)
        expect(spansOf(encodeExport({ ...REQUEST, spans }))).toHaveLength(5_000)
    })

    /**
     * Golden bytes, decoded by a real collector.
     *
     * These are the bytes `encodeExport(REQUEST)` produced on 2026-11-25. Posted to
     * `otel/opentelemetry-collector-contrib` 0.166.0 with the `debug` exporter at `detailed`
     * verbosity, the collector printed every field asserted above, types included (the output is in
     * `docs/26-SPEC-TRACES.md`). Phoenix 22.0.1 stored the same span as kind `LLM`. A change to the
     * encoder that alters them has to be checked against a collector again: this file's own decoder
     * cannot vouch for itself.
     */
    test("matches the bytes a real collector decoded", () => {
        expect(Buffer.from(encodeExport(REQUEST)).toString("base64")).toBe(GOLDEN)
    })
})

const GOLDEN =
    "CvgCChsKGQoMc2VydmljZS5uYW1lEgkKB3N1cHBvcnQS2AIKEwoKdHJhY2Utb3RscBIFMC4xLjASwAIKEAECAwQFBgcICQoLDA0ODxASCKChoqOkpaanIgiwsbKztLW2tyoHY2hhdCBtMTADOQBAaAJqQesYQYC86UxqQesYShwKFGdlbl9haS5yZXF1ZXN0Lm1vZGVsEgQKAm0xShwKFmxsbS50b2tlbl9jb3VudC5wcm9tcHQSAhhaSiIKHG1vZGVsLnByb21wdF90b2tlbnNfcmVwb3J0ZWQSAhABShIKBXJhdGlvEgkhAAAAAAAA4D9KFwoIbmVnYXRpdmUSCxj9//////////8BSgoKBHplcm8SAhgASiwKHmdlbl9haS5yZXNwb25zZS5maW5pc2hfcmVhc29ucxIKKggKBgoEc3RvcFolCQClNSBqQesYEgp0b29sLmdhdGVkGg4KBHNsdWcSBgoEZXhlY3oNEgltYXhfc3RlcHMYAg=="
