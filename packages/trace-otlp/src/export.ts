/**
 * Sends finished traces, one POST per trace (every open trace in one POST at shutdown), in order,
 * never blocking a turn.
 *
 * Failure is reported through the plugin logger, which the host turns into `agent.warning`: on the
 * first failure, every twentieth after it, and once when exports work again with the count lost in
 * between. Every failure would be a warning per turn against a dead collector, which teaches a
 * reader to ignore the one stream that matters; none would be rule 8.
 *
 * Spans are not retried. A collector that is down for a minute loses that minute, and the recovery
 * warning says how much. Retrying would need a disk queue to survive the process, and a trace is
 * worth less than the turn it describes.
 */

import type { Logger } from "@dispach/core"
import { type Attributes, encodeExport, type SpanData } from "./proto.ts"

export interface ExporterOptions {
    readonly endpoint: string
    readonly headers: Readonly<Record<string, string>>
    readonly resource: Attributes
    readonly scope: { readonly name: string; readonly version: string }
    readonly logger: Logger
    readonly fetch?: typeof fetch
    readonly timeoutMs?: number
    /** Exports queued behind a slow endpoint, counting the one in flight, before new ones drop. */
    readonly maxQueued?: number
}

const REPORT_EVERY = 20

export class Exporter {
    readonly #options: ExporterOptions
    readonly #fetch: typeof fetch
    /** Where a message may name the endpoint: no credentials in the userinfo, no query string. */
    readonly #where: string
    #tail: Promise<void> = Promise.resolve()
    #queued = 0
    #failures = 0
    #lost = 0

    constructor(options: ExporterOptions) {
        this.#options = options
        this.#fetch = options.fetch ?? fetch
        const url = new URL(options.endpoint)
        this.#where = `${url.origin}${url.pathname}`
    }

    send(spans: readonly SpanData[]): void {
        if (spans.length === 0) return
        if (this.#queued >= (this.#options.maxQueued ?? 32)) {
            this.#failed(spans.length, "the export queue is full because the endpoint is slow")
            return
        }
        this.#queued += 1
        this.#tail = this.#tail
            .then(() => this.#post(spans))
            .finally(() => {
                this.#queued -= 1
            })
    }

    /** Resolves once everything sent so far has been attempted. */
    idle(): Promise<void> {
        return this.#tail
    }

    async #post(spans: readonly SpanData[]): Promise<void> {
        const { resource, scope, headers } = this.#options
        try {
            const response = await this.#fetch(this.#options.endpoint, {
                method: "POST",
                headers: { "content-type": "application/x-protobuf", ...headers },
                body: encodeExport({ resource, scope, spans }),
                signal: AbortSignal.timeout(this.#options.timeoutMs ?? 10_000),
            })
            const text = await response.text()
            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}${text === "" ? "" : `: ${text.slice(0, 200)}`}`,
                )
            }
        } catch (error) {
            this.#failed(spans.length, error instanceof Error ? error.message : String(error))
            return
        }
        if (this.#failures > 0) {
            this.#options.logger.warn(
                `exporting to ${this.#where} again after ${this.#failures} failed export(s); ${this.#lost} span(s) were lost.`,
                {
                    code: "trace_export_recovered",
                    hint: "Nothing to do. The spans from the outage are not retried, so those turns are missing from the trace backend.",
                },
            )
            this.#failures = 0
            this.#lost = 0
        }
    }

    #failed(spans: number, reason: string): void {
        this.#failures += 1
        this.#lost += spans
        if (this.#failures !== 1 && this.#failures % REPORT_EVERY !== 0) return
        this.#options.logger.warn(
            `could not export traces to ${this.#where}: ${reason} (${this.#failures} failed in a row, ${this.#lost} span(s) lost).`,
            {
                code: "trace_export_failed",
                hint: "Turns are unaffected: traces are dropped, never queued to disk. Check that the collector is running and that `endpoint` is its OTLP/HTTP traces URL (Phoenix: http://<host>:6006/v1/traces). A 401 or 403 means a header in `headersEnv` is wrong. This repeats every 20 failures until an export succeeds.",
            },
        )
    }
}
