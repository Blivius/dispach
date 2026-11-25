# 26 — Traces: the OTLP exporter plugin

`@dispach/trace-otlp` sends every turn to an OpenTelemetry backend as a trace, over OTLP/HTTP
(protobuf). It is bundled with the binary and does nothing until a manifest names it. Decisions
16.1–16.5 carry the reasoning; this file is the contract.

## Switching it on

```yaml
plugins:
  - spec: "@dispach/trace-otlp"
    config:
      endpoint: http://localhost:6006/v1/traces   # required; a bare origin gets /v1/traces
      headersEnv:                                 # optional: header name → variable holding its value
        authorization: TRACES_AUTH
      serviceName: support-bot                    # optional; the agent id when absent
```

Or at creation: `dispach init --traces http://localhost:6006`. Without the flag, `init` writes the
same entry commented.

| Setting | Rule |
| --- | --- |
| `endpoint` | An `http` or `https` URL. A path of `/` becomes `/v1/traces`; any other path is kept. Any other scheme (`grpc://` included) fails the plugin's load. An `http` URL pointing at a gRPC port such as 4317 is accepted and then fails at export, as `trace_export_failed`. |
| `headersEnv` | Each value is an environment variable **name** (hard rule 10). A value that is not a name, or a name that is not set, fails the load and names it. `headers` is refused with a sentence pointing here. |
| `serviceName` | Sets `service.name` and `openinference.project.name` on the resource. |

A plugin that fails to load is a warning and the agent starts without it (03-SPEC-PLUGIN-API,
*Loading*), so a bad tracing config never stops an agent. The warning is core's
`plugin_setup_failed`, its message carrying the sentence above that names the setting; under `serve`
it is also written to stderr.

## What a trace is

One trace per top-level turn, sent when that turn ends:

```
invoke_agent <agent>          turn.start … turn.end
├─ chat <model>               model.call … model.result     (one span per call, across retries)
└─ execute_tool <slug>        tool.call … tool.result
   ├─ invoke_agent <name>     handoff.start … handoff.result
   │  └─ invoke_agent <agent> the subagent's turn, found by its session key
   └─ invoke_agent <peer>     peer.ask … peer.answer
```

A handoff or peer ask hangs off the tool call that made it (`callId`), or off the turn when the
call is not known.

These are span **events** on the turn rather than spans, because none has a duration:
`tool.gated`, `tool.repair`, `compaction.stage`, `context.dropped`, `context.reset`,
`model.retry`, `model.fallback`, `phase.changed`, `approval.requested`, `approval.resolved` and
`agent.warning`. Each carries only the fields listed for it in `MARKS` (`spans.ts`): identifiers,
counts, codes and outcomes. Never `approval.requested.match` (the literal command or path), a
`reason`, a repair's `errors` or a warning's `message`, any of which can quote what was typed. A
field added to one of these events later is left out until it is listed.

A span still open when its turn ends (a model call that threw before its result) is closed at the
turn's end with status `ERROR`, never dropped. A turn ending `max_steps`, `no_progress`,
`truncated`, `timeout` or `error` is an `ERROR` span naming the reason; `final` and `stopped` are
unset. `runtime.stopping` sends every open trace as it stands. More than 256 open traces sends the
oldest unfinished, so a turn whose process died cannot hold memory forever.

A team member is a different agent with its own plugin list, so its turns are its own traces; a
subagent (`kind: self`) nests.

## Attributes

Metadata only (16.3): no prompt, reply, tool argument or tool output is read, so none can be sent. Nor is a handoff's `task` or `label`, which the model wrote.

| Span | OpenTelemetry `gen_ai.*` | OpenInference | Other |
| --- | --- | --- | --- |
| turn | `operation.name=invoke_agent`, `agent.name`, `conversation.id`, `usage.input_tokens`, `usage.output_tokens` | `openinference.span.kind=AGENT`, `session.id`, `llm.token_count.*` | `agent.turn.{id,source,trust,input_kind,sender_kind,end_reason,steps,duration_ms}` |
| model call | `operation.name=chat`, `request.model`, `response.model`, `response.finish_reasons`, `usage.*` | `LLM`, `llm.model_name`, `llm.token_count.{prompt,completion,total}` | `model.{role,latency_ms,first_token_ms,prompt_tokens_reported,cached_prompt_tokens,cache_write_tokens}` |
| tool call | `operation.name=execute_tool`, `tool.name`, `tool.call.id`, `tool.type=function` | `TOOL`, `tool.name` | `tool.{mutating,ok,output_bytes,truncated,trust}` |
| handoff | `operation.name=invoke_agent`, `agent.name`, `conversation.id`, `usage.*` | `AGENT` | `handoff.{kind,index,outcome,steps}` |
| peer ask | `operation.name=invoke_agent`, `agent.name`, `usage.*` | `AGENT` | `peer.{remote,outcome,steps}` |

Resource: `service.name` and `openinference.project.name`, both `serviceName` or the agent id.
Scope: `trace-otlp` and the plugin version. The `gen_ai.*` names were read from
`open-telemetry/semantic-conventions-genai` on 2026-11-25, status Development; `SEMCONV` in
`spans.ts` records that.

## When the collector is down

A turn never waits on an export. Exports go one at a time, one POST per finished trace (every open
trace in one POST at shutdown). The queue holds 32, counting the one in flight; past that, new
exports are dropped and counted. A failed export is not retried.

Failure reaches `agent.warning` through the plugin logger (16.5): `trace_export_failed` on the
first failure and every twentieth, with the count lost so far, and `trace_export_recovered` once
an export succeeds, with the total lost. Messages name the endpoint by origin and path only, never
its userinfo or query string. `serve` also writes every plugin warning to stderr with its code and
hint, so these are in `docker logs` and the service log.

Known loss: spans of turns that end during a graceful stop may not reach the collector, because
the runtime does not wait for the plugin's last POST.

## Phoenix in two minutes

Phoenix 22 requires authentication by default. Generate the admin secret on the host and keep
it, because the image has no shell tools to read it back (`docker exec phoenix printenv` fails).
Run on 2026-11-25:

```bash
export PHOENIX_ADMIN_SECRET="$(openssl rand -hex 24)"
docker run -d --name phoenix -p 127.0.0.1:6006:6006 \
  -e PHOENIX_SECRET="$(openssl rand -hex 24)" -e PHOENIX_ADMIN_SECRET \
  arizephoenix/phoenix:version-22.0.1
echo "TRACES_AUTH=Bearer $PHOENIX_ADMIN_SECRET" >> <agent dir>/.env
```

```yaml
plugins:
  - spec: "@dispach/trace-otlp"
    config:
      endpoint: http://localhost:6006/v1/traces
      headersEnv: { authorization: TRACES_AUTH }
```

with `TRACES_AUTH=Bearer <that secret>` in the agent's `.env`. Without the header Phoenix answers
`401 Invalid token`, which arrives as `trace_export_failed`. Phoenix is Elastic License 2.0:
running it yourself is free; offering it to others as a hosted service is not.

## Verification

The encoder's golden bytes (`packages/trace-otlp/test/proto.test.ts`) were posted on 2026-11-25 to
`otel/opentelemetry-collector-contrib` 0.166.0 with the `debug` exporter at `detailed` verbosity.
It printed:

```
ResourceSpans #0
Resource SchemaURL:
Resource attributes:
     -> service.name: Str(support)
ScopeSpans #0
ScopeSpans SchemaURL:
InstrumentationScope trace-otlp 0.1.0
Span #0
    Trace ID       : 0102030405060708090a0b0c0d0e0f10
    Parent ID      : b0b1b2b3b4b5b6b7
    ID             : a0a1a2a3a4a5a6a7
    Name           : chat m1
    Kind           : Client
    Start time     : 2026-11-25 10:00:00 +0000 UTC
    End time       : 2026-11-25 10:00:01.25 +0000 UTC
    Status code    : Error
    Status message : max_steps
    DroppedAttributesCount: 0
    DroppedEventsCount: 0
    DroppedLinksCount: 0
Attributes:
     -> gen_ai.request.model: Str(m1)
     -> llm.token_count.prompt: Int(90)
     -> model.prompt_tokens_reported: Bool(true)
     -> ratio: Double(0.5)
     -> negative: Int(-3)
     -> zero: Int(0)
     -> gen_ai.response.finish_reasons: Slice(["stop"])
Events:
SpanEvent #0
     -> Name: tool.gated
     -> Timestamp: 2026-11-25 10:00:00.5 +0000 UTC
     -> DroppedAttributesCount: 0
     -> Attributes::
          -> slug: Str(exec)
```

Phoenix 22.0.1 stored the same span (its REST API, `GET /v1/projects/default/spans`) as
`span_kind: LLM` with the tokens, status, event and attributes, and derived `llm.finish_reason`
from `gen_ai.response.finish_reasons` on its own. A change to `proto.ts` that moves the golden bytes
has to be checked against a collector again.
