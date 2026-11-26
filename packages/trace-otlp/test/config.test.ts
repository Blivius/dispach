import { describe, expect, test } from "bun:test"
import { readConfig } from "../src/config.ts"

const failure = (fn: () => unknown): { code: string; message: string; field?: string } => {
    try {
        fn()
    } catch (error) {
        return error as { code: string; message: string; field?: string }
    }
    throw new Error("expected a refusal")
}

describe("endpoint", () => {
    test("a bare origin gets /v1/traces; any other path is kept as written", () => {
        expect(readConfig({ endpoint: "http://localhost:6006" }, {}).endpoint).toBe(
            "http://localhost:6006/v1/traces",
        )
        expect(readConfig({ endpoint: "https://otel.example/api/traces" }, {}).endpoint).toBe(
            "https://otel.example/api/traces",
        )
    })

    test("is required, must parse, and must be http(s)", () => {
        expect(failure(() => readConfig({}, {})).message).toContain("endpoint is required")
        expect(failure(() => readConfig({ endpoint: "localhost:6006" }, {})).message).toContain(
            "http or https",
        )
        expect(
            failure(() => readConfig({ endpoint: "grpc://localhost:4317" }, {})).message,
        ).toContain("gRPC")
    })
})

describe("headersEnv", () => {
    test("reads each header's value from the named variable", () => {
        const config = readConfig(
            { endpoint: "http://c", headersEnv: { authorization: "PHOENIX_AUTH" } },
            { PHOENIX_AUTH: "Bearer s3cret" },
        )
        expect(config.headers).toEqual({ authorization: "Bearer s3cret" })
    })

    test("a value where a variable name belongs is refused, so a credential never sits in the manifest", () => {
        const refused = failure(() =>
            readConfig(
                { endpoint: "http://c", headersEnv: { authorization: "Bearer s3cret" } },
                {},
            ),
        )
        expect(refused.code).toBe("trace_config_invalid")
        expect(refused.message).toContain("environment variable name, not a value")
    })

    test("a variable that is not set fails the load, naming it", () => {
        const refused = failure(() =>
            readConfig({ endpoint: "http://c", headersEnv: { authorization: "PHOENIX_AUTH" } }, {}),
        )
        expect(refused.message).toBe(
            "headersEnv.authorization names PHOENIX_AUTH, which is not set.",
        )
    })

    test("`headers` is refused with the reason, not as an unknown key", () => {
        expect(
            failure(() => readConfig({ endpoint: "http://c", headers: { a: "b" } }, {})).message,
        ).toContain("use headersEnv")
    })
})
