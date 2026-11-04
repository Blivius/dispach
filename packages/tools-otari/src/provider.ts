/**
 * The `otari` `ToolProvider`: Otari's gateway-side tools, on the key the model already uses.
 *
 * `web_search` and `run_code` are module constants; MCP tools come from a cache on disk. Either way
 * `resolve()` touches no network and boot makes no call (hard rule 4) — the network happens when a
 * tool runs, and for MCP in `refresh()` after readiness.
 *
 * Not `tools-mcp`, and the two do not overlap: that package connects to MCP servers itself and holds
 * their credentials; this one reaches only what the Otari workspace has registered, with Otari
 * holding the credentials and metering the calls (`mcp.ts`).
 */

import {
    ConfigError,
    type RefusedTool,
    type Tool,
    type ToolAvailability,
    type ToolProvider,
    type ToolProviderContext,
    type ToolProviderRefresh,
} from "@dispach/core"
import { OTARI_BASE_URL, OTARI_KEY_ENV } from "@dispach/model-otari"
import type { FetchLike, OtariClient } from "./client.ts"
import { codeTool } from "./code.ts"
import { OtariMcp, type OtariMcpServer, parseMcpServers } from "./mcp.ts"
import { OTARI_TOOLS_PROVIDER_ID } from "./paths.ts"
import { DEFAULT_SEARCH_MODEL, searchTool } from "./search.ts"

export const OTARI_TOOL_SLUGS: readonly string[] = ["web_search", "run_code"]

export interface OtariToolsOptions {
    readonly env: Readonly<Record<string, string | undefined>>
    readonly apiKeyEnv?: string
    readonly baseUrl?: string
    readonly searchModel?: string
    /** Workspace MCP servers by slug prefix; their tools are cached under `dir`. */
    readonly mcp?: readonly OtariMcpServer[]
    readonly dir?: string
    readonly fetch?: FetchLike
}

export class OtariToolProvider implements ToolProvider {
    readonly id = OTARI_TOOLS_PROVIDER_ID
    readonly #tools: readonly Tool[]
    readonly #mcp: OtariMcp

    constructor(options: OtariToolsOptions) {
        const client: OtariClient = {
            baseUrl: options.baseUrl ?? OTARI_BASE_URL,
            apiKeyEnv: options.apiKeyEnv ?? OTARI_KEY_ENV,
            env: options.env,
            fetch: options.fetch ?? ((input, init) => fetch(input, init)),
        }
        this.#tools = [
            searchTool(client, options.searchModel ?? DEFAULT_SEARCH_MODEL),
            codeTool(client),
        ]
        this.#mcp = new OtariMcp(client, options.dir ?? ".", options.mcp ?? [])
    }

    /** Every entry, so an agent with none pinned can still say the capability exists. */
    available(): Promise<readonly ToolAvailability[]> {
        return Promise.resolve([
            ...this.#tools.map((tool) => ({ slug: tool.spec.slug, summary: tool.spec.summary })),
            ...this.#mcp.available(),
        ])
    }

    resolve(slugs: readonly string[]): Promise<readonly Tool[]> {
        const wanted = new Set(slugs)
        return Promise.resolve([
            ...this.#tools.filter((tool) => wanted.has(tool.spec.slug)),
            ...this.#mcp.resolve(slugs),
        ])
    }

    list(): Promise<readonly string[]> {
        return Promise.resolve([...this.#tools.map((tool) => tool.spec.slug), ...this.#mcp.list()])
    }

    refresh(slugs: readonly string[], signal?: AbortSignal): Promise<ToolProviderRefresh> {
        return this.#mcp.refresh(slugs, signal)
    }

    explainUnresolved(slugs: readonly string[]): ConfigError | undefined {
        return this.#mcp.explainUnresolved(slugs)
    }

    refused(): readonly RefusedTool[] {
        return this.#mcp.refused()
    }
}

const CONFIG_KEYS = ["apiKeyEnv", "baseUrl", "searchModel", "mcp"] as const

export function otariToolsFromConfig(context: ToolProviderContext): OtariToolProvider {
    const refuse = (key: string, problem: string) =>
        new ConfigError({
            code: "otari_tools_config_invalid",
            message: `tools.providers.otari.${key} ${problem}`,
            hint: `Accepted keys are ${CONFIG_KEYS.join(", ")}; all are optional. The key is read from OTARI_API_KEY by default, the same variable the model uses with api: otari.`,
            field: `tools.providers.otari.${key}`,
        })
    const unknown = Object.keys(context.config).find(
        (key) => !CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number]),
    )
    // Refused rather than ignored: a setting that looks applied and is not is worse than a load failure.
    if (unknown !== undefined) throw refuse(unknown, "is not a setting.")

    const text = (key: Exclude<(typeof CONFIG_KEYS)[number], "mcp">): string | undefined => {
        const value = context.config[key]
        if (value === undefined) return undefined
        if (typeof value !== "string" || value.trim() === "")
            throw refuse(key, "must be a non-empty string.")
        return value.trim()
    }
    const apiKeyEnv = text("apiKeyEnv")
    const searchModel = text("searchModel")
    const raw = text("baseUrl")
    let baseUrl: string | undefined
    if (raw !== undefined) {
        let url: URL
        try {
            url = new URL(raw)
        } catch {
            throw refuse("baseUrl", `is not a URL: ${JSON.stringify(raw)}.`)
        }
        if (url.protocol !== "https:" && url.protocol !== "http:")
            throw refuse("baseUrl", "must be http or https.")
        if (url.username !== "" || url.password !== "")
            throw refuse("baseUrl", "must not carry credentials; the key comes from apiKeyEnv.")
        baseUrl = url.href.replace(/\/+$/, "")
    }
    const mcp = context.config.mcp === undefined ? [] : parseMcpServers(context.config.mcp)
    return new OtariToolProvider({
        env: context.env,
        dir: context.dir,
        mcp,
        ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(searchModel === undefined ? {} : { searchModel }),
    })
}
