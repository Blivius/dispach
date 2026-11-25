/**
 * `@dispach/trace-otlp` — every turn as an OpenTelemetry trace, sent over OTLP/HTTP.
 *
 * ```yaml
 * plugins:
 *   - spec: "@dispach/trace-otlp"
 *     config: { endpoint: http://localhost:6006/v1/traces }
 * ```
 *
 * Closes decision 11.6 ("OpenTelemetry is a plugin"), which until now had no plugin behind it.
 * Built only on public API: it observes through `use({ onEvent })`, so the runtime filters events
 * to this agent and drops the subscription when the agent is disposed, and it reports failure
 * through `logger`, which reaches `agent.warning`.
 *
 * Nothing touches the network before `runtime.ready` (hard rule 4): `setup` validates and
 * constructs, and the first export happens when the first turn ends. Exporting is
 * fire-and-forget; a turn never waits on a collector. Spans carry metadata only — no prompt, reply
 * or tool output (decision 16.3).
 */

import type { Plugin } from "@dispach/core"
import { readConfig } from "./config.ts"
import { Exporter } from "./export.ts"
import { TraceBuilder } from "./spans.ts"

export { readConfig, type TraceConfig } from "./config.ts"
export { Exporter } from "./export.ts"
export { encodeExport } from "./proto.ts"
export { SEMCONV, TraceBuilder } from "./spans.ts"

export const VERSION = "0.1.0"

export default {
    name: "trace-otlp",
    version: VERSION,
    dispachApi: "^0.2",
    permissions: [
        // Whatever `endpoint` names; a static declaration cannot know it.
        { kind: "network", hosts: ["*"] },
    ],
    setup(context) {
        const config = readConfig(context.config, context.env)
        const builder = new TraceBuilder()
        const service = config.serviceName ?? context.agentId
        const exporter = new Exporter({
            endpoint: config.endpoint,
            headers: config.headers,
            // `openinference.project.name` is what files an agent under its own project in Phoenix
            // (verified against 22.0.1; without it everything lands in `default`).
            resource: { "service.name": service, "openinference.project.name": service },
            scope: { name: "trace-otlp", version: VERSION },
            logger: context.logger,
        })
        context.use({
            name: "trace-otlp",
            onEvent(event) {
                exporter.send(builder.observe(event))
            },
        })
    },
} satisfies Plugin
