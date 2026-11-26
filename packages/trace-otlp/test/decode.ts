/**
 * A generic protobuf reader for the tests: field number → raw values, no schema.
 *
 * Deliberately not a mirror of `proto.ts`. It knows the wire format and nothing about OTLP, so the
 * field numbers the tests assert are typed a second time from the `.proto` files rather than read
 * back from the encoder. The golden bytes in `proto.test.ts` were additionally decoded by a real
 * OpenTelemetry collector, which is the check this reader cannot be.
 */

export type Field = bigint | Uint8Array

export type Message = Map<number, Field[]>

function varint(bytes: Uint8Array, at: number): [bigint, number] {
    let value = 0n
    let shift = 0n
    let offset = at
    for (;;) {
        const byte = bytes[offset]
        if (byte === undefined) throw new Error("truncated varint")
        offset += 1
        value |= BigInt(byte & 0x7f) << shift
        if ((byte & 0x80) === 0) return [value, offset]
        shift += 7n
    }
}

export function decode(bytes: Uint8Array): Message {
    const out: Message = new Map()
    let offset = 0
    while (offset < bytes.length) {
        const [tag, next] = varint(bytes, offset)
        offset = next
        const field = Number(tag >> 3n)
        const wire = Number(tag & 7n)
        let value: Field
        if (wire === 0) {
            ;[value, offset] = varint(bytes, offset)
        } else if (wire === 1) {
            value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true)
            offset += 8
        } else if (wire === 2) {
            const [length, start] = varint(bytes, offset)
            value = bytes.subarray(start, start + Number(length))
            offset = start + Number(length)
        } else {
            throw new Error(`unexpected wire type ${wire} for field ${field}`)
        }
        const list = out.get(field) ?? []
        list.push(value)
        out.set(field, list)
    }
    return out
}

export function one(message: Message, field: number): Field {
    const value = message.get(field)?.[0]
    if (value === undefined) throw new Error(`field ${field} absent`)
    return value
}

export const sub = (message: Message, field: number): Message =>
    decode(one(message, field) as Uint8Array)

export const subs = (message: Message, field: number): Message[] =>
    (message.get(field) ?? []).map((value) => decode(value as Uint8Array))

export const text = (message: Message, field: number): string =>
    new TextDecoder().decode(one(message, field) as Uint8Array)

/** `KeyValue` list → key to the decoded `AnyValue`'s first field, as a plain value. */
export function attrs(message: Message, field: number): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const kv of subs(message, field)) {
        const key = text(kv, 1)
        const value = sub(kv, 2)
        const [kind] = [...value.keys()]
        const raw = kind === undefined ? undefined : one(value, kind)
        if (kind === 1) out[key] = new TextDecoder().decode(raw as Uint8Array)
        else if (kind === 2) out[key] = raw === 1n
        else if (kind === 3) out[key] = BigInt.asIntN(64, raw as bigint)
        else if (kind === 5) {
            out[key] = subs(decode(raw as Uint8Array), 1).map((item) => text(item, 1))
        } else out[key] = raw
    }
    return out
}

/** The spans of an `ExportTraceServiceRequest`, flattened. */
export function spansOf(request: Uint8Array): Message[] {
    return subs(decode(request), 1).flatMap((resourceSpans) =>
        subs(resourceSpans, 2).flatMap((scopeSpans) => subs(scopeSpans, 2)),
    )
}

export const hex = (bytes: Field): string => Buffer.from(bytes as Uint8Array).toString("hex")
