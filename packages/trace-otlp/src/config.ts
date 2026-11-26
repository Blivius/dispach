/**
 * The plugin's config, as a manifest writes it:
 *
 * ```yaml
 * plugins:
 *   - spec: "@dispach/trace-otlp"
 *     config:
 *       endpoint: http://localhost:6006/v1/traces   # Phoenix; a bare origin gets /v1/traces
 *       headersEnv:                                 # header name → the variable holding its value
 *         authorization: PHOENIX_AUTH_HEADER
 *       serviceName: support-bot                    # the agent id when absent
 * ```
 *
 * Header values are variable **names** (hard rule 10): a manifest is committed, and an auth header
 * written into it is a credential in git. A name that is not set is a load failure naming it,
 * because an exporter that starts and is refused on every turn is the configuration failing
 * somewhere nobody reads.
 */

import { ConfigError, type EnvSource } from "@dispach/core"

export interface TraceConfig {
    readonly endpoint: string
    readonly headers: Readonly<Record<string, string>>
    readonly serviceName: string | undefined
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

function invalid(message: string, field: string): ConfigError {
    return new ConfigError({
        code: "trace_config_invalid",
        message,
        hint: "See @dispach/trace-otlp's config: `endpoint` is the OTLP/HTTP traces URL (Phoenix: http://localhost:6006/v1/traces), `headersEnv` maps a header name to the environment variable holding its value, and `serviceName` is optional.",
        field: `plugins[trace-otlp].${field}`,
    })
}

/** The traces URL. A bare origin gets the conventional `/v1/traces`; any other path is kept. */
function endpointOf(value: unknown): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw invalid("endpoint is required: the OTLP/HTTP URL traces are sent to.", "endpoint")
    }
    let url: URL
    try {
        url = new URL(value.trim())
    } catch {
        throw invalid(`endpoint "${value}" is not a URL.`, "endpoint")
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw invalid(
            `endpoint must be http or https; "${url.protocol}" is not OTLP/HTTP. gRPC (port 4317) is not supported.`,
            "endpoint",
        )
    }
    if (url.pathname === "/") url.pathname = "/v1/traces"
    return url.toString()
}

export function readConfig(raw: unknown, env: EnvSource): TraceConfig {
    const config = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
    const known = new Set(["endpoint", "headersEnv", "serviceName"])
    for (const key of Object.keys(config)) {
        if (!known.has(key)) {
            throw invalid(
                `"${key}" is not a setting. ${key === "headers" ? "Header values come from the environment: use headersEnv, mapping the header to a variable name." : "The settings are endpoint, headersEnv and serviceName."}`,
                key,
            )
        }
    }

    const headers: Record<string, string> = {}
    const headersEnv = config.headersEnv
    if (headersEnv !== undefined) {
        if (typeof headersEnv !== "object" || headersEnv === null || Array.isArray(headersEnv)) {
            throw invalid(
                "headersEnv must map header names to environment variable names.",
                "headersEnv",
            )
        }
        for (const [header, name] of Object.entries(headersEnv)) {
            if (!HEADER_NAME.test(header)) {
                throw invalid(`"${header}" is not a header name.`, `headersEnv.${header}`)
            }
            if (typeof name !== "string" || !ENV_NAME.test(name)) {
                throw invalid(
                    `headersEnv.${header} must be an environment variable name, not a value. Put the value in the agent's .env and name the variable here.`,
                    `headersEnv.${header}`,
                )
            }
            const value = env[name]
            if (value === undefined || value === "") {
                throw invalid(
                    `headersEnv.${header} names ${name}, which is not set.`,
                    `headersEnv.${header}`,
                )
            }
            headers[header] = value
        }
    }

    const serviceName = config.serviceName
    if (
        serviceName !== undefined &&
        (typeof serviceName !== "string" || serviceName.trim() === "")
    ) {
        throw invalid("serviceName must be a non-empty string.", "serviceName")
    }

    return {
        endpoint: endpointOf(config.endpoint),
        headers,
        serviceName: typeof serviceName === "string" ? serviceName.trim() : undefined,
    }
}
