/**
 * `@dispach/tools-otari` — Otari's gateway-side tools as one `otari` provider: `web_search` through
 * Otari's search, `run_code` in Otari's sandbox, and the MCP servers the Otari workspace has registered. Same key as `api: otari`, so an agent on Otari gets
 * them with nothing else to sign up for. See `README.md`.
 */

import type { Plugin } from "@dispach/core"
import { otariToolsFromConfig } from "./provider.ts"

export type { FetchLike, OtariClient } from "./client.ts"
export { CODE_SPEC, codeTool, render as renderCode } from "./code.ts"
export { mcpCachePath, OtariMcp, type OtariMcpServer, parseMcpServers } from "./mcp.ts"
export { OTARI_TOOLS_PROVIDER_ID } from "./paths.ts"
export {
    OTARI_TOOL_SLUGS,
    OtariToolProvider,
    type OtariToolsOptions,
    otariToolsFromConfig,
} from "./provider.ts"
export {
    DEFAULT_SEARCH_MODEL,
    render as renderSearch,
    searchTool,
    sourcesOf,
    WEB_SEARCH_SPEC,
} from "./search.ts"

/** Package version, kept in step with `package.json`. */
export const VERSION = "0.1.0"

export default {
    name: "tools-otari",
    version: VERSION,
    dispachApi: "^0.2",
    permissions: [
        { kind: "network", hosts: ["api.otari.ai"] },
        { kind: "env", vars: ["OTARI_API_KEY"] },
        { kind: "fs", paths: ["<state>/otari-mcp.cache.json"], mode: "write" },
    ],
    setup(context) {
        context.defineToolProvider("otari", otariToolsFromConfig)
    },
} satisfies Plugin
