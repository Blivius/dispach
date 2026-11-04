# @dispach/model-otari

[Otari](https://otari.ai), Mozilla.ai's LLM gateway, as a model transport.

```yaml
model:
  main:
    id: z-ai/glm-5.3                 # a catalog id: Otari falls back across its offerings
    api: otari                       # baseUrl → https://api.otari.ai/api/v1, apiKeyEnv → OTARI_API_KEY
    options:
      guardrails: [{ profile: lakera-guard, mode: block }]
      tags: { app: support }
  compactor:
    id: openai/gpt-oss-20b           # a second open-weight model, for a different job
    api: otari
```

The CLI and the container image bundle this transport, so `api: otari` needs no `plugins:` entry.
An embedder calling the runtime directly passes `otariTransport()` in
`RuntimeOptions.modelTransports`.

## What it adds over a plain base URL

The wire is chat-completions, so the request, retries, streaming and tool calls are core's. The
transport adds what is specific to Otari:

- **`guardrails`** from the role's options, sent on every call. Profiles are configured in the Otari
  workspace. `block` refuses before any model sees the request; `monitor` only reports.
- **`metadata`** tags. The role (`main`, `compactor`, a custom role) is always one, so Otari's usage
  splits spend per role with nothing configured in the dashboard.
- **A gateway fallback is visible.** When `Otari-Fallback` is `true`, the call reports the provider
  and model that actually answered, the same way a Dispach fallback does.
- **Refusals say what to do next.** `otari_budget_exceeded` names the budget's scope and when it
  resets; `otari_guardrail_violation` names the profile; `otari_insufficient_funds` says to top up.
  They keep their 403/402 status, so a fallback chain stops instead of trying the next model: a spent
  budget is a stop, not an outage.
- **A guardrail Otari cannot run** (`502 guardrail profile '…' could not be evaluated`) is
  `otari_guardrail_unavailable`, and it carries no status so it never falls back: a fallback on another
  endpoint would answer, unchecked, the request the guardrail was set to refuse. The usual cause is a
  field in the profile's Parameters (JSON) that the vendor does not take; Lakera takes no threshold.

## Notes measured against the live API (2026-11-04)

- The base URL is `/api/v1`. `/v1` answers 404.
- A guardrail block's body is `{"detail": {"message", "code", "guardrails": [...]}}`, not the
  `{detail, code}` the docs describe for other errors. Both are read.
- Otari prices a request up front from `max_tokens`. A role with a large `maxTokens` and a small key
  budget is refused before it runs; Dispach sends no `max_tokens` unless the role sets one.
