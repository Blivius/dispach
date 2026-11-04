# @dispach/tools-otari

Otari's own tools as one `otari` provider, on the key the model already uses with `api: otari`.

```yaml
model:
  main: { id: z-ai/glm-5.3, api: otari }
tools:
  providers:
    otari: {}                     # apiKeyEnv, baseUrl, searchModel: all optional
    web: { search: false }        # keep web_fetch; web_search comes from otari
  pinned: [web_search, web_fetch, run_code]
  policy:
    allow: [run_code]             # mutating + untrusted: once per turn without a rule
```

| Tool | How it runs | Trust |
| --- | --- | --- |
| `run_code` | `POST /api/v1/code/execute`. Python in Otari's sandbox, never this machine. The first call asks for `container: "auto"`, later calls in the same session reuse the container Otari named in `Otari-Container-Id`, so state carries like a notebook. An expired container is replaced once and the model is told its variables are gone. | untrusted, mutating |
| `web_search` | One `/chat/completions` call to `searchModel` with `otari_web_search` declared. Returns Otari's own source list (`otari_tool_calls[].sources`) and, labelled as such, that model's one-line summaries. | untrusted, read |

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

## Not tools-mcp

`tools-mcp` connects to MCP servers itself and holds their credentials. This package reaches only
what the Otari workspace registered, with Otari holding the credentials.
