/**
 * A provider's JSON Schema → this runtime's `ToolParameters` subset.
 *
 * Moved here from `tools-composio` when MCP became a second provider handing over JSON Schema, so the
 * two cannot disagree about what a schema means. The rules were grounded on live Composio data and
 * hold for any provider:
 *
 * **Constraints are folded into the description, not modelled.** `minimum`, `format`, `pattern` and
 * the rest reach the model as text in the field's description, where both dialects render it, and
 * `coerce` does not enforce them. An out-of-range value is rejected by the provider at execution.
 *
 * **Structural keywords are flattened, not refused (0.2.6).** Refusing `anyOf` & co. dropped the
 * whole tool, and the latest Composio toolkits spell 80 of 3917 tools that way, Gmail and Outlook
 * send among them ("configured but could not be loaded"). So, before a node is mapped:
 *   - `$ref` is resolved against the root's `$defs`/`definitions`; a cycle stops at a plain object;
 *   - `allOf` is merged into one shape; `not` is dropped; `const` is a one-value `enum`;
 *   - a union (`anyOf`/`oneOf`) becomes ONE node: objects merge into one object (a field every option
 *     requires stays required, the options are listed in the description); arrays merge their items;
 *     a list beside its own single form ("one file or a list") is the list; plain values are a type
 *     list as before; any other mix is a type list (`["string", "object"]`), valid JSON Schema the
 *     native dialect hands over as written, and a value `coerce` passes on as given.
 * The merged schema admits more than the provider does; the provider's own validation is the
 * backstop, exactly as for the constraints above. Only a `$ref` that cannot be resolved is refused.
 *
 * **`default: null` is dropped**: it is a schema saying "no default", and `coerce` would otherwise
 * send an explicit `null` on every call that left the field blank.
 *
 * **A nullable field is its non-null type.** Leaving the field out is how this runtime says null.
 */

import type { JsonSchemaNode, JsonType, ToolParameters } from "./types.ts"

/**
 * Rendered into the description in this order. `additionalProperties` is deliberately absent: the
 * common value is `false`, which is already how `coerce` behaves — an unknown field is a field error.
 */
const CONSTRAINTS = [
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
] as const

const TYPES = new Set<string>(["string", "number", "integer", "boolean", "array", "object"])
/** A type list is written in this order, so the same union always reads the same. */
const ORDER: readonly JsonType[] = ["string", "number", "integer", "boolean", "object", "array"]

type Raw = Readonly<Record<string, unknown>>

/** `string`, or `string, number or boolean` for a union: how a type is named to a model or a person. */
export function typeWords(type: JsonSchemaNode["type"]): string {
    if (typeof type === "string") return type
    return type.length === 1 ? (type[0] ?? "") : `${type.slice(0, -1).join(", ")} or ${type.at(-1)}`
}

export interface SchemaConversion {
    /** The error for a keyword at `path` this runtime cannot express, naming the provider and tool. */
    readonly unsupported: (path: string, keyword: string) => Error
    /** What a node with no `type` becomes. Composio's are strings; MCP's are any JSON, so objects. */
    readonly untyped?: JsonType
    /** How the top-level schema is named in a refusal. */
    readonly rootPath?: string
}

interface Context {
    readonly conversion: SchemaConversion
    readonly root: Raw
}

function asRecord(value: unknown): Raw | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Raw)
        : undefined
}

function stringArray(value: unknown): readonly string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
}

function joinText(...parts: unknown[]): string | undefined {
    const kept = parts
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter((part) => part !== "")
    return kept.length === 0 ? undefined : kept.join(" ")
}

// ── Flattening: structural keywords out, one plain schema in ───────────────────────────────────

/** `#/$defs/Name` or `#/definitions/Name` in the root schema; anything else is not resolvable. */
function resolveRef(root: Raw, ref: string): Raw | undefined {
    if (!ref.startsWith("#/")) return undefined
    let at: unknown = root
    for (const part of ref.slice(2).split("/")) {
        at = asRecord(at)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")]
    }
    return asRecord(at)
}

/** The declared types of a schema, null left out (a nullable field is its non-null type). */
function typesOf(raw: Raw): JsonType[] {
    const declared = Array.isArray(raw.type) ? raw.type : [raw.type]
    const known = declared.filter((t): t is JsonType => typeof t === "string" && TYPES.has(t))
    if (known.length === 0 && asRecord(raw.properties) !== undefined) return ["object"]
    if (known.length === 0 && raw.items !== undefined) return ["array"]
    return known
}

/** Several object schemas as one: every field, required only where every option requires it. */
function mergeObjects(objects: readonly Raw[], ctx: Context, seen: Set<string>): Raw {
    const properties: Record<string, Raw[]> = {}
    for (const object of objects) {
        for (const [name, value] of Object.entries(asRecord(object.properties) ?? {})) {
            const record = asRecord(value)
            if (record === undefined) continue
            const list = properties[name] ?? []
            list.push(record)
            properties[name] = list
        }
    }
    const merged: Record<string, Raw> = {}
    for (const [name, options] of Object.entries(properties)) {
        merged[name] = options.length === 1 ? (options[0] as Raw) : union(options, {}, ctx, seen)
    }
    const required = objects
        .map((object) => stringArray(object.required))
        .reduce((common, next) => common.filter((name) => next.includes(name)))
    if (Object.keys(merged).length === 0) return { type: "object" }
    return { type: "object", properties: merged, required }
}

/** The one value a field is fixed to (`const`, or a one-value `enum`), else undefined. */
function fixedValue(field: unknown): { readonly value: unknown } | undefined {
    const record = asRecord(field)
    if (record === undefined) return undefined
    if (record.const !== undefined) return { value: record.const }
    return Array.isArray(record.enum) && record.enum.length === 1
        ? { value: record.enum[0] }
        : undefined
}

/** A field's `const`, the part of an option's field that narrows the shared one. */
function fixedOf(field: unknown): Raw {
    const value = asRecord(field)?.const
    return value === undefined ? {} : { const: value }
}

/** What makes two options the same option: their types, fields and required fields, not their prose. */
function shapeKey(option: Raw): string {
    return JSON.stringify([
        typesOf(option),
        Object.keys(asRecord(option.properties) ?? {}).sort(),
        [...stringArray(option.required)].sort(),
        option.enum,
        option.items === undefined ? undefined : shapeKey(asRecord(option.items) ?? {}),
    ])
}

/** A field every option fixes to one value (`kind: "worksheet"`): where the options are told apart. */
function discriminators(objects: readonly Raw[]): string[] {
    const fixed = (object: Raw, name: string) =>
        fixedValue(asRecord(object.properties)?.[name]) !== undefined
    const first = Object.keys(asRecord(objects[0]?.properties) ?? {})
    return first.filter((name) => objects.every((object) => fixed(object, name)))
}

/** `kind "worksheet" with worksheet_id`, or the option's title: how a model tells the options apart. */
function optionWords(option: Raw, index: number, common: readonly string[]): string {
    const fields = asRecord(option.properties) ?? {}
    const fixed: string[] = []
    const fixedNames = new Set<string>()
    for (const [name, field] of Object.entries(fields)) {
        const one = fixedValue(field)
        if (one !== undefined) {
            fixed.push(`${name} ${JSON.stringify(one.value)}`)
            fixedNames.add(name)
        }
    }
    const needs = stringArray(option.required).filter(
        (name) => !fixedNames.has(name) && !common.includes(name),
    )
    const head =
        fixed.length > 0
            ? fixed.join(", ")
            : typeof option.title === "string"
              ? option.title
              : `option ${index + 1}`
    return needs.length === 0 ? head : `${head} with ${needs.join(", ")}`
}

/**
 * `anyOf`/`oneOf` options as one schema. `outer` is the node's own keywords (description, default),
 * which win over an option's.
 */
function union(options: readonly Raw[], outer: Raw, ctx: Context, seen: Set<string>): Raw {
    // Identical options ("one file" and the list's item, both FileUploadable) are one option.
    const byShape = new Map<string, Raw>()
    for (const option of options.map((given) => flatten(given, ctx, seen))) {
        if (option.type === "null" && option.enum === undefined) continue
        const key = shapeKey(option)
        if (!byShape.has(key)) byShape.set(key, option)
    }
    const flat = [...byShape.values()]
    if (flat.length === 0) return outer
    if (flat.length === 1) return { ...flat[0], ...outer }

    const objects = flat.filter((option) => typesOf(option).includes("object"))
    const arrays = flat.filter(
        (option) => !objects.includes(option) && typesOf(option).includes("array"),
    )
    const others = flat.filter((option) => !objects.includes(option) && !arrays.includes(option))
    // A typeless option (`{}`) admits anything and adds nothing a model can be told.
    const scalarTypes = [...new Set(others.flatMap(typesOf))]

    const array: Raw | undefined =
        arrays.length === 0
            ? undefined
            : {
                  type: "array",
                  items: union(
                      arrays.map((option) => asRecord(option.items) ?? {}),
                      {},
                      ctx,
                      seen,
                  ),
              }
    let object = objects.length === 0 ? undefined : mergeObjects(objects, ctx, seen)
    // Which option needs which fields, said where the model picks one: on the field that tells them
    // apart when there is one (a root `oneOf` has no description of its own a model would read).
    const common = stringArray(object?.required)
    const words =
        objects.length > 1 ? objects.map((option, i) => optionWords(option, i, common)) : []
    const telling = words.some((word) => !/^option \d+$/.test(word))
    const choices = telling ? `One of: ${words.join("; ")}.` : undefined
    const key = choices === undefined ? undefined : discriminators(objects)[0]
    const fields = asRecord(object?.properties)
    const field = key === undefined ? undefined : asRecord(fields?.[key])
    if (object !== undefined && key !== undefined && field !== undefined) {
        const text = joinText(field.description, choices)
        object = { ...object, properties: { ...fields, [key]: { ...field, description: text } } }
    }
    // A description or default every option carries alike is the node's own.
    const agreed = (key: string) =>
        new Set(flat.map((option) => JSON.stringify(option[key]))).size === 1
            ? flat[0]?.[key]
            : undefined
    const fallbackDefault = outer.default === undefined ? agreed("default") : undefined
    const described = (...more: unknown[]) => {
        const description = joinText(
            outer.description ?? agreed("description"),
            field === undefined ? choices : undefined,
            ...more,
        )
        return {
            ...(fallbackDefault === undefined ? {} : { default: fallbackDefault }),
            ...outer,
            ...(description === undefined ? {} : { description }),
        }
    }

    // Only objects, or only lists: one shape.
    if (array === undefined && scalarTypes.length === 0 && object !== undefined) {
        return { ...object, ...described() }
    }
    if (object === undefined && scalarTypes.length === 0 && array !== undefined) {
        return { ...array, ...described() }
    }
    // Only plain values: one type with its enums merged, or a type list.
    if (array === undefined && object === undefined) {
        const enums = others.map((option) => option.enum)
        const allEnums = enums.every(Array.isArray) ? [...new Set(enums.flat())] : undefined
        return {
            type: scalarTypes.length === 1 ? scalarTypes[0] : scalarTypes,
            ...(allEnums === undefined ? {} : { enum: allEnums }),
            ...described(),
        }
    }
    // A list beside its own single form ("a single file or a list of files"; "a list or a
    // comma-separated string"): the list. One becomes a list of one; a comma string is split.
    if (array !== undefined) {
        const items = asRecord(array.items) ?? {}
        const itemTypes = typesOf(items)
        const fits =
            (object === undefined || itemTypes.length === 0 || itemTypes.includes("object")) &&
            scalarTypes.every((type) => type === "string" || itemTypes.includes(type))
        if (fits) {
            const single = object === undefined ? items : union([items, object], {}, ctx, seen)
            return { type: "array", items: single, ...described() }
        }
    }
    // Anything else: the types side by side. The value is passed on as given; the object's fields
    // are named in the description so the model can still write one.
    const types = ORDER.filter(
        (type) =>
            scalarTypes.includes(type) ||
            (type === "object" && object !== undefined) ||
            (type === "array" && array !== undefined),
    )
    const names = Object.keys(fields ?? {})
    return {
        type: types,
        ...described(
            names.length === 0 ? undefined : `As an object, its fields are: ${names.join(", ")}.`,
        ),
    }
}

/**
 * One schema with no `$ref`, `allOf`, `anyOf`, `oneOf`, `not` or `const` at its top: what `node`
 * maps. Children are flattened when `node` reaches them.
 */
function flatten(given: Raw, ctx: Context, seen: Set<string>, path = ""): Raw {
    let raw = given
    if (typeof raw.$ref === "string") {
        const ref = raw.$ref
        const { $ref: _ref, ...rest } = raw
        // A schema that contains itself (a tree of blocks): the inner level is an object passed on
        // as written.
        if (seen.has(ref)) return { type: "object", ...rest }
        const target = resolveRef(ctx.root, ref)
        if (target === undefined) throw ctx.conversion.unsupported(path, "$ref")
        // `seen` is the chain of references this node sits under, carried to its children by
        // `node`, so a tree that contains itself stops instead of recursing forever.
        seen.add(ref)
        raw = { ...flatten(target, ctx, seen, path), ...rest }
    }
    if (Array.isArray(raw.allOf)) {
        const { allOf, ...rest } = raw
        const parts = allOf
            .map(asRecord)
            .filter((part): part is Raw => part !== undefined)
            .map((part) => flatten(part, ctx, seen, path))
        const properties = Object.assign(
            {},
            ...parts.map((part) => asRecord(part.properties) ?? {}),
            asRecord(rest.properties) ?? {},
        )
        const required = [
            ...new Set([...parts, rest].flatMap((part) => stringArray(part.required))),
        ]
        raw = Object.assign({}, ...parts, rest)
        if (Object.keys(properties).length > 0) raw = { ...raw, properties, required }
    }
    if (raw.not !== undefined) {
        const { not: _not, ...rest } = raw
        raw = rest
    }
    if (raw.const !== undefined) {
        const { const: value, ...rest } = raw
        raw = { ...rest, enum: [value] }
    }
    const options = raw.anyOf ?? raw.oneOf
    if (Array.isArray(options)) {
        const { anyOf: _a, oneOf: _o, ...outer } = raw
        const records = options.map(asRecord).filter((o): o is Raw => o !== undefined)
        // The node's own fields (a root `oneOf` that only varies `required`) are shared by every
        // option, so each option gets them before the options are merged.
        const shared = asRecord(outer.properties)
        if (shared === undefined) {
            raw = union(records, outer, ctx, seen)
        } else {
            const { properties: _p, required: _r, ...rest } = outer
            const withShared = records.map((option) => ({
                ...option,
                type: option.type ?? "object",
                // A field both name is the shared one narrowed by the option (`const`), keeping
                // the shared description and default.
                properties: Object.fromEntries(
                    Object.entries({ ...shared, ...(asRecord(option.properties) ?? {}) }).map(
                        ([name, field]) => [
                            name,
                            {
                                ...asRecord(field),
                                ...asRecord(shared[name]),
                                ...fixedOf(field),
                            },
                        ],
                    ),
                ),
                required: [
                    ...new Set([...stringArray(outer.required), ...stringArray(option.required)]),
                ],
            }))
            raw = union(withShared, rest, ctx, seen)
        }
    }
    return raw
}

// ── Mapping: a plain schema → JsonSchemaNode ────────────────────────────────────────────────────

/** `minimum: 1, maximum: 100` — appended so the model sees a bound the coercer will not enforce. */
function constraintText(raw: Raw): string {
    const parts: string[] = []
    for (const key of CONSTRAINTS) {
        const value = raw[key]
        if (value === undefined || value === null) continue
        if (typeof value === "object") continue
        parts.push(`${key} ${String(value)}`)
    }
    return parts.join(", ")
}

function describe(raw: Raw): string | undefined {
    const base = typeof raw.description === "string" ? raw.description.trim() : ""
    const constraints = constraintText(raw)
    if (base === "" && constraints === "") return undefined
    if (constraints === "") return base
    return base === "" ? constraints : `${base} (${constraints})`
}

function node(given: Raw, path: string, ctx: Context, under: ReadonlySet<string>): JsonSchemaNode {
    const seen = new Set(under)
    const raw = flatten(given, ctx, seen, path)
    const declared = typesOf(raw)
    const type: JsonType | readonly JsonType[] =
        declared.length > 1 ? declared : (declared[0] ?? ctx.conversion.untyped ?? "string")

    const description = describe(raw)
    const enumValues = Array.isArray(raw.enum)
        ? raw.enum.filter(
              (value): value is string | number | boolean =>
                  typeof value === "string" ||
                  typeof value === "number" ||
                  typeof value === "boolean",
          )
        : undefined

    const items = type === "array" ? asRecord(raw.items) : undefined
    const properties = type === "object" ? asRecord(raw.properties) : undefined

    return {
        type,
        ...(description === undefined ? {} : { description }),
        ...(enumValues === undefined || enumValues.length === 0 ? {} : { enum: enumValues }),
        ...(items === undefined ? {} : { items: node(items, `${path}[]`, ctx, seen) }),
        ...(properties === undefined
            ? {}
            : {
                  properties: mapProperties(properties, path, ctx, seen),
                  required: stringArray(raw.required),
              }),
        ...(raw.default === undefined || raw.default === null ? {} : { default: raw.default }),
    }
}

function mapProperties(
    properties: Raw,
    path: string,
    ctx: Context,
    seen: ReadonlySet<string>,
): Readonly<Record<string, JsonSchemaNode>> {
    const out: Record<string, JsonSchemaNode> = {}
    for (const [name, value] of Object.entries(properties)) {
        const raw = asRecord(value)
        if (raw === undefined) continue
        out[name] = node(raw, path === "" ? name : `${path}.${name}`, ctx, seen)
    }
    return out
}

export function parametersFromJsonSchema(
    raw: Raw | undefined,
    conversion: SchemaConversion,
): ToolParameters {
    if (raw === undefined) return { type: "object", properties: {} }
    const ctx: Context = { conversion, root: raw }
    const seen = new Set<string>()
    const flat = flatten(raw, ctx, seen, conversion.rootPath ?? "parameters")

    const properties = asRecord(flat.properties) ?? {}
    const required = stringArray(flat.required)
    const mapped = mapProperties(properties, "", ctx, seen)

    return {
        type: "object",
        properties: mapped,
        // Filtered against what actually resolved: `required` naming a property that is not in
        // `properties` would make every call fail coercion on a field the model cannot supply.
        ...(required.length === 0 ? {} : { required: required.filter((name) => name in mapped) }),
    }
}
