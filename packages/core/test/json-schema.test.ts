/**
 * Structural keywords flattened into one schema (0.2.6): the latest Composio toolkits spell 80 of 3917
 * tools with `anyOf`/`oneOf`, Gmail and Outlook send among them, and a refusal dropped the tool.
 * Real captured schemas are in `tools-composio/test/fixtures/latest`; these are the rules, small.
 */

import { coerceArgs } from "../src/tools/coerce.ts"
import { parametersFromJsonSchema } from "../src/tools/json-schema.ts"
import type { ToolSpec } from "../src/tools/types.ts"
import { expect, test } from "./_harness.ts"

const conversion = {
    unsupported: (path: string, keyword: string) => new Error(`${keyword} at ${path}`),
}
const map = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    parametersFromJsonSchema({ type: "object", properties, ...extra }, conversion)

test("object options merge: a field every option requires stays required, the rest are optional", () => {
    const p = map({
        target: {
            description: "The range.",
            oneOf: [
                {
                    type: "object",
                    title: "Sheet",
                    required: ["kind", "sheet"],
                    properties: { kind: { const: "sheet" }, sheet: { type: "string" } },
                },
                {
                    type: "object",
                    title: "Named",
                    required: ["kind", "name"],
                    properties: { kind: { const: "named" }, name: { type: "string" } },
                },
            ],
        },
    })
    const target = p.properties.target
    expect(target?.type).toBe("object")
    expect(target?.required).toEqual(["kind"])
    expect(Object.keys(target?.properties ?? {})).toEqual(["kind", "sheet", "name"])
    expect(target?.properties?.kind?.enum).toEqual(["sheet", "named"])
    // Said on the field that tells the options apart, where the model picks one.
    expect(target?.properties?.kind?.description).toBe(
        'One of: kind "sheet" with sheet; kind "named" with name.',
    )
    expect(target?.description).toBe("The range.")
})

test("a single item beside a list of them is the list", () => {
    const file = {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string", description: "File name." } },
    }
    const p = map({
        attachment: { anyOf: [file, { type: "array", items: file }, { type: "null" }] },
        select: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
    })
    expect(p.properties.attachment).toEqual({
        type: "array",
        items: {
            type: "object",
            properties: { name: { type: "string", description: "File name." } },
            required: ["name"],
        },
    })
    expect(p.properties.select).toEqual({ type: "array", items: { type: "string" } })
})

test("any other mix is a type list, the object's fields named", () => {
    const p = map({
        body: {
            description: "Text or a document.",
            anyOf: [
                { type: "string" },
                { type: "object", properties: { type: { type: "string" }, content: {} } },
            ],
        },
    })
    expect(p.properties.body).toEqual({
        type: ["string", "object"],
        description: "Text or a document. As an object, its fields are: type, content.",
    })
})

test("$ref resolves through $defs and definitions; a cycle stops at an object", () => {
    const p = parametersFromJsonSchema(
        {
            type: "object",
            properties: {
                block: { $ref: "#/$defs/Block", description: "One block." },
                user: { $ref: "#/definitions/User" },
            },
            $defs: {
                Block: {
                    type: "object",
                    properties: {
                        text: { type: "string" },
                        children: { type: "array", items: { $ref: "#/$defs/Block" } },
                    },
                },
            },
            definitions: { User: { type: "string", format: "email" } },
        },
        conversion,
    )
    expect(p.properties.user).toEqual({ type: "string", description: "format email" })
    expect(p.properties.block?.description).toBe("One block.")
    expect(p.properties.block?.properties?.text?.type).toBe("string")
    const children = p.properties.block?.properties?.children
    // The block inside a block is the cycle: an object, passed on as written.
    expect(children?.items).toEqual({ type: "object" })
    expect(() => map({ x: { $ref: "#/$defs/Nowhere" } })).toThrow("$ref at x")
})

test("a root oneOf that only varies required: the shared fields keep their prose", () => {
    const p = map(
        {
            mode: { type: "string", enum: ["a", "b"], default: "a", description: "Pick." },
            ref: { type: "string" },
            formula: { type: "string" },
        },
        {
            required: ["mode"],
            oneOf: [
                { required: ["ref"], properties: { mode: { const: "a" } } },
                { required: ["formula"], properties: { mode: { const: "b" } } },
            ],
        },
    )
    expect(p.required).toEqual(["mode"])
    expect(p.properties.mode).toEqual({
        type: "string",
        description: 'Pick. One of: mode "a" with ref; mode "b" with formula.',
        enum: ["a", "b"],
        default: "a",
    })
})

test("allOf merges, not is dropped, const is a one-value enum", () => {
    const p = map({
        a: {
            allOf: [
                { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
                { properties: { y: { type: "number" } } },
            ],
        },
        b: { type: "string", not: { enum: ["root"] } },
        c: { const: "fixed" },
    })
    expect(p.properties.a?.required).toEqual(["x"])
    expect(Object.keys(p.properties.a?.properties ?? {})).toEqual(["x", "y"])
    expect(p.properties.b).toEqual({ type: "string" })
    expect(p.properties.c?.enum).toEqual(["fixed"])
})

test("coerce passes an object or a list to a union that names it, as given", () => {
    const spec = {
        slug: "t",
        provider: "test",
        summary: "",
        whenToUse: "",
        mutating: false,
        parameters: map({
            body: { anyOf: [{ type: "string" }, { type: "object" }] },
            args: { anyOf: [{ type: "object" }, { type: "array" }, { type: "integer" }] },
        }),
    } as unknown as ToolSpec
    const doc = { type: "doc", content: [] }
    expect(coerceArgs(spec, { body: doc, args: [1, "x"] })).toEqual({
        ok: true,
        args: { body: doc, args: [1, "x"] },
    })
    expect(coerceArgs(spec, { body: "plain", args: "[1, 2]" })).toEqual({
        ok: true,
        args: { body: "plain", args: [1, 2] },
    })
    expect(coerceArgs(spec, { args: "7" })).toEqual({ ok: true, args: { args: 7 } })
})
