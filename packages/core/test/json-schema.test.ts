import { describe, expect, test } from "bun:test"
import { parametersFromJsonSchema } from "../src/tools/json-schema.ts"

const conversion = {
    unsupported: (path: string, keyword: string) => new Error(`${keyword} at ${path}`),
    untyped: "object" as const,
}

describe("anyOf of real types (decision 4.100)", () => {
    test("narrows to the first branch the subset can express, keeping the outer description", () => {
        // DeepWiki's ask_wiki_question, as Otari's discovery returned it on 2026-11-04.
        const params = parametersFromJsonSchema(
            {
                type: "object",
                properties: {
                    repoName: {
                        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                        description: "GitHub repository in owner/repo format.",
                    },
                },
                required: ["repoName"],
            },
            conversion,
        )
        expect(params.properties.repoName).toEqual({
            type: "string",
            description: "GitHub repository in owner/repo format.",
        })
        expect(params.required).toEqual(["repoName"])
    })

    test("skips a branch it cannot express and takes the next", () => {
        const params = parametersFromJsonSchema(
            {
                properties: {
                    x: { anyOf: [{ allOf: [{ type: "string" }] }, { type: "integer" }] },
                },
            },
            conversion,
        )
        expect(params.properties.x?.type).toBe("integer")
    })

    test("oneOf is still refused: a value from one branch is not proven valid", () => {
        expect(() =>
            parametersFromJsonSchema(
                { properties: { x: { oneOf: [{ type: "object" }, { type: "string" }] } } },
                conversion,
            ),
        ).toThrow("oneOf at x")
        expect(() =>
            parametersFromJsonSchema(
                { properties: { x: { anyOf: [{ $ref: "#/a" }, { not: {} }] } } },
                conversion,
            ),
        ).toThrow("anyOf at x")
    })
})
