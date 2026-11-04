/**
 * MCP servers registered in the Otari workspace, called through Otari's caller-orchestrated routes.
 *
 * ```yaml
 * tools:
 *   providers:
 *     otari:
 *       mcp: { deepwiki: 56eb8d19-eca7-4ec3-8f60-62c9c7d9c0a5 }   # slug prefix → Otari server id
 *   pinned: [deepwiki__ask_wiki_question]
 * ```
 *
 * Discovery is `GET /mcp/servers/{id}/tools`, execution `POST /mcp/execute`. Otari holds the server's
 * URL and credential and enforces its allowlist; **this runtime is the authorization boundary** —
 * Otari's own docs: "Otari executes a caller-authorized call. It does not verify a user approval."
 * Here that is `tools.policy` and the write gate, which is why these are ordinary pinned tools.
 *
 * Same shape as `tools-mcp` and Composio: boot resolves from a cache on disk and contacts nothing
 * (hard rule 4); `refresh` runs after readiness, rewrites the cache and picks up the current
 * `server_revision`, which every execute sends back so a server changed in the dashboard since is
 * refused (409) instead of run against. Slugs and schemas come from `tools-mcp`'s own mapping, so a
 * tool reached through Otari looks exactly like one reached directly.
 *
 * **Never retried.** Otari does not deduplicate `client_execution_id`, so a second attempt may run
 * the tool twice; a dispatched call with no result says so (`otari_mcp_outcome_unknown`).
 */

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
    BRAND,
    ConfigError,
    isHarnessError,
    type RefusedTool,
    type Tool,
    type ToolAvailability,
    ToolError,
    type ToolProviderRefresh,
} from "@dispach/core"
import {
    type McpCallResult,
    type McpTool,
    mcpToolFailed,
    renderResult,
    SEPARATOR,
    slugOf,
    summaryOf,
    toSpec,
} from "@dispach/tools-mcp"
import { get, type OtariClient, post } from "./client.ts"
import { OTARI_TOOLS_PROVIDER_ID } from "./paths.ts"

export interface OtariMcpServer {
    /** The slug prefix: `deepwiki` → `deepwiki__ask_wiki_question`. */
    readonly name: string
    /** The id the Otari dashboard shows under Tools → MCP servers. */
    readonly id: string
}

interface CachedServer {
    readonly id: string
    readonly revision: string
    readonly fetchedAt: string
    readonly tools: readonly McpTool[]
}

type Cache = Readonly<Record<string, CachedServer>>

const CACHE_VERSION = 1
/** Otari's own execution ceiling is 45 s end to end; discovery's is 15 s. */
const EXECUTE_CAP_MS = 50_000
const DISCOVERY_CAP_MS = 20_000
/** `available()` is billed every turn. */
const AVAILABLE_LIMIT = 40
const NAME = /^[a-z][a-z0-9-]{0,23}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function mcpCachePath(dir: string): string {
    return join(resolve(dir), BRAND.stateDir, "otari-mcp.cache.json")
}

function readCache(dir: string): Cache {
    try {
        const parsed = JSON.parse(readFileSync(mcpCachePath(dir), "utf8")) as {
            version?: number
            servers?: Record<string, CachedServer>
        }
        return parsed.version === CACHE_VERSION && typeof parsed.servers === "object"
            ? (parsed.servers ?? {})
            : {}
    } catch {
        // Absent or unreadable reads as cold; the next refresh rewrites it.
        return {}
    }
}

function writeCache(dir: string, servers: Cache): void {
    const path = mcpCachePath(dir)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
        `${path}.partial`,
        `${JSON.stringify({ version: CACHE_VERSION, servers }, null, 2)}\n`,
    )
    renameSync(`${path}.partial`, path)
}

/** `tools.providers.otari.mcp` → servers, refusing a name that cannot prefix a slug or an id that is not one. */
export function parseMcpServers(value: unknown): OtariMcpServer[] {
    const field = "tools.providers.otari.mcp"
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ConfigError({
            code: "otari_tools_config_invalid",
            message: `${field} must map a name to an Otari MCP server id.`,
            hint: "e.g. mcp: { deepwiki: 56eb8d19-eca7-4ec3-8f60-62c9c7d9c0a5 }. The id is on the server's row under Tools → MCP servers in the Otari dashboard.",
            field,
        })
    }
    return Object.entries(value).map(([name, id]) => {
        if (!NAME.test(name)) {
            throw new ConfigError({
                code: "otari_tools_config_invalid",
                message: `The MCP server name "${name}" is not usable in a tool slug.`,
                hint: "Lowercase letters, digits and hyphens, starting with a letter, at most 24 characters. It prefixes every tool: deepwiki → deepwiki__ask_wiki_question.",
                field: `${field}.${name}`,
            })
        }
        if (typeof id !== "string" || !UUID.test(id)) {
            throw new ConfigError({
                code: "otari_tools_config_invalid",
                message: `${field}.${name} is not an Otari MCP server id: ${JSON.stringify(id)}.`,
                hint: "It is a UUID, shown on the server's row under Tools → MCP servers in the Otari dashboard. Not the server's URL: Otari holds that.",
                field: `${field}.${name}`,
            })
        }
        return { name, id: id.toLowerCase() }
    })
}

/** Otari's discovery descriptor → the MCP shape `tools-mcp` maps. */
function toMcpTool(raw: Readonly<Record<string, unknown>>): McpTool | undefined {
    if (typeof raw.name !== "string") return undefined
    const annotations = raw.annotations
    return {
        name: raw.name,
        ...(typeof raw.description === "string" ? { description: raw.description } : {}),
        ...(typeof raw.input_schema === "object" && raw.input_schema !== null
            ? { inputSchema: raw.input_schema as Readonly<Record<string, unknown>> }
            : {}),
        ...(typeof annotations === "object" && annotations !== null
            ? { annotations: annotations as McpTool["annotations"] & object }
            : {}),
    }
}

export class OtariMcp {
    readonly #client: OtariClient
    readonly #dir: string
    readonly #servers: ReadonlyMap<string, OtariMcpServer>
    #cache: Cache
    #refused: RefusedTool[] = []

    constructor(client: OtariClient, dir: string, servers: readonly OtariMcpServer[]) {
        this.#client = client
        this.#dir = dir
        this.#servers = new Map(servers.map((server) => [server.name, server]))
        this.#cache = servers.length === 0 ? {} : readCache(dir)
    }

    /** The cached entry, or none when it was written for a different server id. */
    #cached(server: OtariMcpServer): CachedServer | undefined {
        const entry = this.#cache[server.name]
        return entry?.id === server.id ? entry : undefined
    }

    #ours(slug: string): OtariMcpServer | undefined {
        return slug.includes(SEPARATOR)
            ? this.#servers.get(slug.split(SEPARATOR)[0] ?? "")
            : undefined
    }

    /** Cache only: this runs inside boot. */
    resolve(slugs: readonly string[]): Tool[] {
        const wanted = new Set(slugs)
        const out: Tool[] = []
        const refused: RefusedTool[] = []
        for (const server of this.#servers.values()) {
            for (const tool of this.#cached(server)?.tools ?? []) {
                const slug = slugOf(server.name, tool.name)
                if (!wanted.has(slug)) continue
                // A schema this runtime cannot represent costs that tool, not the agent (pilot.16).
                try {
                    out.push(this.#toTool(server, tool))
                } catch (error) {
                    if (!isHarnessError(error)) throw error
                    refused.push({ slug, detail: error.toDetail() })
                }
            }
        }
        this.#refused = refused
        return out
    }

    refused(): readonly RefusedTool[] {
        return this.#refused
    }

    list(): string[] {
        return [...this.#servers.values()].flatMap((server) =>
            (this.#cached(server)?.tools ?? []).map((tool) => slugOf(server.name, tool.name)),
        )
    }

    available(): ToolAvailability[] {
        return [...this.#servers.values()]
            .flatMap((server) =>
                (this.#cached(server)?.tools ?? []).map((tool) => ({
                    slug: slugOf(server.name, tool.name),
                    summary: summaryOf(server.name, tool),
                })),
            )
            .slice(0, AVAILABLE_LIMIT)
    }

    explainUnresolved(slugs: readonly string[]): ConfigError | undefined {
        const cold = slugs.filter((slug) => {
            const server = this.#ours(slug)
            return server !== undefined && this.#cached(server) === undefined
        })
        if (cold.length === 0) return undefined
        return new ConfigError({
            code: "otari_mcp_cache_miss",
            message: `Otari MCP tools are pinned and nothing is cached for them yet: ${cold.join(", ")}.`,
            hint: `Boot reads them from ${mcpCachePath(this.#dir)} and contacts nothing before runtime.ready. Run \`${BRAND.slug} tools <manifest> --warm\` once to fill it, then start again.`,
            field: "tools.pinned",
        })
    }

    /** Discover every server's tools and rewrite the cache. **After readiness only.** */
    async refresh(slugs: readonly string[], signal?: AbortSignal): Promise<ToolProviderRefresh> {
        if (this.#servers.size === 0) return { fetched: 0, missing: [], changed: [] }
        const next: Record<string, CachedServer> = { ...this.#cache }
        const failures: string[] = []
        const changed: string[] = []
        let fetched = 0
        const scope = {
            signal: signal ?? new AbortController().signal,
            deadlineMs: DISCOVERY_CAP_MS + 5_000,
        }
        for (const server of this.#servers.values()) {
            try {
                const { body } = await get(
                    this.#client,
                    `/mcp/servers/${server.id}/tools`,
                    scope,
                    DISCOVERY_CAP_MS,
                )
                const reply = body as { server_revision?: unknown; tools?: unknown }
                const tools = (Array.isArray(reply.tools) ? reply.tools : [])
                    .map((raw) => toMcpTool(raw as Readonly<Record<string, unknown>>))
                    .filter((tool): tool is McpTool => tool !== undefined)
                const before = new Map(
                    (this.#cached(server)?.tools ?? []).map((tool) => [
                        tool.name,
                        JSON.stringify(tool),
                    ]),
                )
                for (const tool of tools) {
                    const slug = slugOf(server.name, tool.name)
                    if (!slugs.includes(slug)) continue
                    fetched += 1
                    if (before.get(tool.name) !== JSON.stringify(tool)) changed.push(slug)
                }
                next[server.name] = {
                    id: server.id,
                    revision:
                        typeof reply.server_revision === "string" ? reply.server_revision : "",
                    fetchedAt: new Date().toISOString(),
                    tools,
                }
            } catch (error) {
                failures.push(
                    `${server.name}: ${error instanceof Error ? error.message : String(error)}`,
                )
            }
        }
        // The servers that answered are written even when another did not.
        this.#cache = next
        writeCache(this.#dir, next)
        if (failures.length > 0) {
            throw new ToolError({
                code: "otari_mcp_discovery_failed",
                message: `Otari could not list the tools of ${failures.join("; ")}`,
                hint: "The agent keeps the tools it cached; only this refresh failed. Check the server's health under Tools → MCP servers in the Otari dashboard.",
            })
        }
        const known = new Set(this.list())
        const missing = slugs.filter((slug) => this.#ours(slug) !== undefined && !known.has(slug))
        return { fetched, missing, changed }
    }

    #toTool(server: OtariMcpServer, tool: McpTool): Tool {
        return {
            spec: { ...toSpec(server.name, tool, undefined), provider: OTARI_TOOLS_PROVIDER_ID },
            handler: async (args, context) => {
                // Read at call time: a refresh after readiness may have brought a newer revision.
                const revision = this.#cached(server)?.revision ?? ""
                const { body } = await post(
                    this.#client,
                    "/mcp/execute",
                    {
                        mcp_server_id: server.id,
                        tool_name: tool.name,
                        arguments: args,
                        server_revision: revision,
                        // Correlation only. Not an idempotency key: Otari does not deduplicate.
                        client_execution_id: randomUUID(),
                    },
                    context,
                    EXECUTE_CAP_MS,
                )
                context.meter?.({
                    provider: "otari",
                    operation: "mcp",
                    unit: "requests",
                    units: 1,
                })
                const result = body as McpCallResult
                if (result.isError === true) {
                    throw mcpToolFailed(server.name, tool.name, renderResult(result))
                }
                return renderResult(result)
            },
        }
    }
}
