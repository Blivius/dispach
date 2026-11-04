# @dispach/tools-otari

Otari's own tools as one `otari` provider, on the key the model already uses with `api: otari`.

```yaml
model:
  main: { id: z-ai/glm-5.3, api: otari }
tools:
  providers:
    otari:                        # apiKeyEnv, baseUrl, searchModel, mcp: all optional
      mcp: { deepwiki: 56eb8d19-eca7-4ec3-8f60-62c9c7d9c0a5 }   # slug prefix → Otari server id
    web: { search: false }        # keep web_fetch; web_search comes from otari
  pinned: [web_search, web_fetch, run_code, deepwiki__ask_wiki_question]
  policy:
    allow: [run_code, deepwiki__ask_wiki_question]   # mutating + untrusted: once per turn without a rule
```

| Tool | How it runs | Trust |
| --- | --- | --- |
| `run_code` | `POST /api/v1/code/execute`. Python in Otari's sandbox, never this machine. The first call asks for `container: "auto"`, later calls in the same session reuse the container Otari named in `Otari-Container-Id`, so state carries like a notebook. An expired container is replaced once and the model is told its variables are gone. | untrusted, mutating |
| `web_search` | One `/chat/completions` call to `searchModel` with `otari_web_search` declared. Returns Otari's own source list (`otari_tool_calls[].sources`) and, labelled as such, that model's one-line summaries. | untrusted, read |
| `<name>__<tool>` | One `POST /api/v1/mcp/execute` on an MCP server registered in the Otari workspace, with the `server_revision` discovery returned and a fresh `client_execution_id`. Never retried: Otari does not deduplicate, and a call that was sent with no result back is `otari_mcp_outcome_unknown`, not an ordinary failure. | untrusted, mutating unless the server says `readOnlyHint` |

## Why search goes through a model

Otari's direct `POST /api/v1/search` runs only on a search-tool instance, and on hosted Otari only the
deployment operator can create one. An organization search key only re-keys an instance, it never
creates one. Measured on 2026-11-04: every name answered "No search tools are configured". The
in-loop `otari_web_search` is what a tenant can use, so the tool makes one small call around it
(about $0.01, almost all of it Otari's search fee).

## Spend

Each call reports through `ToolContext.meter`, reaching `tool.usage`:
- a search in `usd`, using the `cost_usd` Otari returned;
- a code run in `requests`.

Refusals reuse `@dispach/model-otari`'s reader, so a spent budget, a guardrail block or an empty
balance reads the same from a tool as from the model.

## MCP through Otari

Otari's caller-orchestrated MCP: Otari stores the server's URL and credential and enforces its
allowlist, and the calling application is the authorization boundary — here, `tools.policy` and the
write gate. Discovery (`GET /api/v1/mcp/servers/{id}/tools`) runs in `refresh()` after readiness and
on `tools --warm`, into `.dispach/otari-mcp.cache.json`; boot resolves from that file and contacts
nothing. Slugs, schemas and the `mutating` rule come from `tools-mcp`'s own mapping, so the same
server reached directly or through Otari gives the same tools — and naming it in both fails the load
with `tool_slug_collision` rather than picking one.

Each call is metered as one `mcp` request; a server Otari reports changed since discovery (409)
names `tools --warm`.

## Not tools-mcp

`tools-mcp` connects to MCP servers itself and holds their credentials. This package reaches only
what the Otari workspace registered, with Otari holding the credentials.
