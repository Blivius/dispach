/**
 * The OTLP trace request, encoded as protobuf by hand.
 *
 * Only the subset a trace export needs: `ExportTraceServiceRequest` → `ResourceSpans` →
 * `ScopeSpans` → `Span`, with attributes, span events and a status. Field numbers are
 * `opentelemetry/proto/trace/v1/trace.proto`, `common/v1/common.proto` and
 * `collector/trace/v1/trace_service.proto`.
 *
 * Hand-rolled rather than `@opentelemetry/exporter-trace-otlp-proto` (decision 16.2): that package
 * brings `protobufjs` and a tree of SDK packages into a bundle that ships no dependencies, to encode
 * about a dozen message types. OTLP/JSON would have been smaller still, but Phoenix's `/v1/traces`
 * accepts protobuf only. The encoding is checked against a real collector, not against
 * this file's own reading of the spec — see `test/proto.test.ts` for the golden bytes and where they
 * came from.
 */

export type AttributeValue = string | number | boolean | readonly string[]

/** One attribute. An integer `number` is written as `int_value`, anything else as `double_value`. */
export type Attributes = Readonly<Record<string, AttributeValue | undefined>>

export const SpanKind = { internal: 1, client: 3 } as const
export const StatusCode = { unset: 0, ok: 1, error: 2 } as const

export interface SpanEvent {
    readonly name: string
    readonly timeMs: number
    readonly attributes: Attributes
}

export interface SpanData {
    readonly traceId: Uint8Array
    readonly spanId: Uint8Array
    readonly parentSpanId?: Uint8Array
    readonly name: string
    readonly kind: number
    readonly startMs: number
    readonly endMs: number
    readonly attributes: Attributes
    readonly events: readonly SpanEvent[]
    readonly status: { readonly code: number; readonly message?: string }
}

export interface ExportRequest {
    readonly resource: Attributes
    readonly scope: { readonly name: string; readonly version: string }
    readonly spans: readonly SpanData[]
}

// Wire types.
const VARINT = 0
const FIXED64 = 1
const LEN = 2

const utf8 = new TextEncoder()

function varint(value: bigint): number[] {
    let rest = BigInt.asUintN(64, value)
    const out: number[] = []
    while (rest >= 0x80n) {
        out.push(Number(rest & 0x7fn) | 0x80)
        rest >>= 7n
    }
    out.push(Number(rest))
    return out
}

/**
 * Accumulates one message's fields. Nested messages are encoded first and added as bytes.
 *
 * Chunks rather than one `number[]` grown with `push(...bytes)`: spreading a nested message's
 * bytes as arguments overflows the stack once a batch reaches a few hundred kilobytes.
 */
class Writer {
    readonly #chunks: Uint8Array[] = []
    #length = 0

    #raw(bytes: Uint8Array | readonly number[]): void {
        const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
        this.#chunks.push(chunk)
        this.#length += chunk.length
    }

    #tag(field: number, wire: number): void {
        this.#raw(varint(BigInt((field << 3) | wire)))
    }

    bytes(field: number, value: Uint8Array): this {
        this.#tag(field, LEN)
        this.#raw(varint(BigInt(value.length)))
        this.#raw(value)
        return this
    }

    string(field: number, value: string): this {
        return this.bytes(field, utf8.encode(value))
    }

    /** Omits zero, as proto3 does for a scalar at its default. */
    uint(field: number, value: number): this {
        if (value === 0) return this
        this.#tag(field, VARINT)
        this.#raw(varint(BigInt(value)))
        return this
    }

    /** `int64` inside a oneof, so zero is written. A negative value is ten bytes of two's complement. */
    int64(field: number, value: number): this {
        this.#tag(field, VARINT)
        this.#raw(varint(BigInt(value)))
        return this
    }

    bool(field: number, value: boolean): this {
        this.#tag(field, VARINT)
        this.#raw([value ? 1 : 0])
        return this
    }

    fixed64(field: number, value: bigint): this {
        this.#tag(field, FIXED64)
        const view = new DataView(new ArrayBuffer(8))
        view.setBigUint64(0, value, true)
        this.#raw(new Uint8Array(view.buffer))
        return this
    }

    double(field: number, value: number): this {
        this.#tag(field, FIXED64)
        const view = new DataView(new ArrayBuffer(8))
        view.setFloat64(0, value, true)
        this.#raw(new Uint8Array(view.buffer))
        return this
    }

    finish(): Uint8Array {
        const out = new Uint8Array(this.#length)
        let offset = 0
        for (const chunk of this.#chunks) {
            out.set(chunk, offset)
            offset += chunk.length
        }
        return out
    }
}

/** Milliseconds since the epoch, as OTLP's `fixed64` nanoseconds. */
const nanos = (ms: number): bigint => BigInt(Math.round(ms * 1_000)) * 1_000n

function anyValue(value: AttributeValue): Uint8Array {
    const w = new Writer()
    if (typeof value === "string") w.string(1, value)
    else if (typeof value === "boolean") w.bool(2, value)
    else if (typeof value === "number") {
        if (Number.isSafeInteger(value)) w.int64(3, value)
        else w.double(4, value)
    } else {
        // ArrayValue { repeated AnyValue values = 1 }
        const array = new Writer()
        for (const item of value) array.bytes(1, anyValue(item))
        w.bytes(5, array.finish())
    }
    return w.finish()
}

function attributes(w: Writer, field: number, values: Attributes): void {
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue
        // KeyValue { string key = 1; AnyValue value = 2 }
        w.bytes(field, new Writer().string(1, key).bytes(2, anyValue(value)).finish())
    }
}

function span(data: SpanData): Uint8Array {
    const w = new Writer().bytes(1, data.traceId).bytes(2, data.spanId)
    if (data.parentSpanId !== undefined) w.bytes(4, data.parentSpanId)
    w.string(5, data.name)
        .uint(6, data.kind)
        .fixed64(7, nanos(data.startMs))
        .fixed64(8, nanos(Math.max(data.endMs, data.startMs)))
    attributes(w, 9, data.attributes)
    for (const event of data.events) {
        // Span.Event { fixed64 time_unix_nano = 1; string name = 2; repeated KeyValue attributes = 3 }
        const e = new Writer().fixed64(1, nanos(event.timeMs)).string(2, event.name)
        attributes(e, 3, event.attributes)
        w.bytes(11, e.finish())
    }
    // Status { string message = 2; StatusCode code = 3 }
    const status = new Writer()
    if (data.status.message !== undefined) status.string(2, data.status.message)
    status.uint(3, data.status.code)
    w.bytes(15, status.finish())
    return w.finish()
}

/** `ExportTraceServiceRequest`, ready to POST as `application/x-protobuf`. */
export function encodeExport(request: ExportRequest): Uint8Array {
    const resource = new Writer()
    attributes(resource, 1, request.resource)
    const scope = new Writer().string(1, request.scope.name).string(2, request.scope.version)
    const scopeSpans = new Writer().bytes(1, scope.finish())
    for (const data of request.spans) scopeSpans.bytes(2, span(data))
    const resourceSpans = new Writer().bytes(1, resource.finish()).bytes(2, scopeSpans.finish())
    return new Writer().bytes(1, resourceSpans.finish()).finish()
}
