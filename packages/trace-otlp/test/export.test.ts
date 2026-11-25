import { describe, expect, test } from "bun:test"
import type { Logger } from "@dispach/core"
import { Exporter } from "../src/export.ts"
import type { SpanData } from "../src/proto.ts"
import { spansOf, text } from "./decode.ts"

const SPAN: SpanData = {
    traceId: new Uint8Array(16).fill(1),
    spanId: new Uint8Array(8).fill(2),
    name: "invoke_agent support",
    kind: 1,
    startMs: 0,
    endMs: 5,
    attributes: {},
    events: [],
    status: { code: 0 },
}

function recordingLogger(): { logger: Logger; warnings: { message: string; code: unknown }[] } {
    const warnings: { message: string; code: unknown }[] = []
    const noop = () => {}
    return {
        warnings,
        logger: {
            debug: noop,
            info: noop,
            warn: (message, fields) => warnings.push({ message, code: fields?.code }),
            error: noop,
        },
    }
}

function exporter(fetchImpl: typeof fetch, logger: Logger, maxQueued?: number): Exporter {
    return new Exporter({
        endpoint: "https://user:pw@otel.example/v1/traces?token=t",
        headers: { authorization: "Bearer x" },
        resource: { "service.name": "support" },
        scope: { name: "trace-otlp", version: "0.1.0" },
        logger,
        fetch: fetchImpl,
        ...(maxQueued === undefined ? {} : { maxQueued }),
    })
}

describe("Exporter", () => {
    test("POSTs protobuf with the configured headers", async () => {
        const seen: { headers: Headers; body: Uint8Array }[] = []
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            seen.push({ headers: new Headers(init.headers), body: init.body as Uint8Array })
            return new Response("")
        }) as unknown as typeof fetch
        const { logger, warnings } = recordingLogger()
        const out = exporter(fetchImpl, logger)
        out.send([SPAN])
        await out.idle()
        expect(seen[0]?.headers.get("content-type")).toBe("application/x-protobuf")
        expect(seen[0]?.headers.get("authorization")).toBe("Bearer x")
        const [span] = spansOf(seen[0]?.body ?? new Uint8Array())
        expect(span === undefined ? undefined : text(span, 5)).toBe("invoke_agent support")
        expect(warnings).toEqual([])
    })

    test("reports the first failure, then every twentieth, then the recovery with what was lost", async () => {
        let fail = true
        const fetchImpl = (async () =>
            fail
                ? new Response("nope", { status: 503 })
                : new Response("")) as unknown as typeof fetch
        const { logger, warnings } = recordingLogger()
        const out = exporter(fetchImpl, logger)
        for (let i = 0; i < 25; i++) out.send([SPAN, SPAN])
        await out.idle()
        expect(warnings.map((w) => w.code)).toEqual(["trace_export_failed", "trace_export_failed"])
        expect(warnings[0]?.message).toContain("HTTP 503: nope")
        expect(warnings[1]?.message).toContain("20 failed in a row, 40 span(s) lost")
        // The endpoint is named without its userinfo or query string, either of which may be a credential.
        expect(warnings[0]?.message).toContain("https://otel.example/v1/traces:")
        expect(
            warnings.some((w) => w.message.includes("pw") || w.message.includes("token=t")),
        ).toBe(false)

        fail = false
        out.send([SPAN])
        await out.idle()
        expect(warnings[2]?.code).toBe("trace_export_recovered")
        expect(warnings[2]?.message).toContain("after 25 failed export(s); 50 span(s) were lost")
    })

    test("a network error is a failure like a status is", async () => {
        const fetchImpl = (async () => {
            throw new TypeError("fetch failed")
        }) as unknown as typeof fetch
        const { logger, warnings } = recordingLogger()
        const out = exporter(fetchImpl, logger)
        out.send([SPAN])
        await out.idle()
        expect(warnings[0]?.message).toContain("fetch failed")
    })

    test("behind a slow endpoint the queue is bounded, and what it drops is reported", async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const fetchImpl = (async () => {
            await gate
            return new Response("")
        }) as unknown as typeof fetch
        const { logger, warnings } = recordingLogger()
        const out = exporter(fetchImpl, logger, 2)
        out.send([SPAN])
        out.send([SPAN])
        out.send([SPAN])
        expect(warnings[0]?.message).toContain("the export queue is full")
        release()
        await out.idle()
    })
})
