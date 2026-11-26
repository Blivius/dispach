/**
 * The far end: a manifest names the plugin, a real `Runtime` runs a real turn, and a real HTTP
 * server receives what the plugin sends. Every layer between the event bus and the socket is the
 * shipped one — the runtime's `onEvent` filtering, the loader's logger, the builder, the encoder,
 * `fetch`. A test of any one of them can be green while the value is dropped between two.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type AnyEvent, BRAND, Runtime } from "@dispach/core"
import plugin from "../src/index.ts"
import { attrs, spansOf, sub, text } from "./decode.ts"

const ENV = { MODEL_API_KEY: "test-key", COLLECTOR_AUTH: "Bearer test" }

function workspace(endpoint: string, id = "support"): string {
    const dir = mkdtempSync(join(tmpdir(), "trace-otlp-"))
    writeFileSync(
        join(dir, "agent.yaml"),
        `apiVersion: ${BRAND.apiVersion}
id: ${id}
model:
  main:
    id: gpt-4o-mini
    baseUrl: https://api.example.com/v1
    apiKeyEnv: MODEL_API_KEY
context:
  window: 8192
  reserveOutput: 512
  files:
    - IDENTITY.md
plugins:
  - spec: "@dispach/trace-otlp"
    config:
      endpoint: ${endpoint}
      headersEnv: { authorization: COLLECTOR_AUTH }
limits:
  maxSteps: 2
  turnTimeoutMs: 5000
`,
    )
    writeFileSync(join(dir, "IDENTITY.md"), "You are a test fixture.")
    return dir
}

/** A streamed reply of "hi" with usage, as an OpenAI-compatible endpoint sends it. */
const model = (async () => {
    const frames = [
        { choices: [{ delta: { content: "hi" } }] },
        {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 40, completion_tokens: 2 },
        },
    ]
    const body = `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")}data: [DONE]\n\n`
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
}) as unknown as typeof fetch

interface Received {
    headers: Record<string, string | string[] | undefined>
    body: Uint8Array
}

let server: Server | undefined
afterEach(() => server?.close())

/** An OTLP/HTTP collector that records each request. */
async function collector(
    status = 200,
): Promise<{ url: string; received: Received[]; next: () => Promise<Received> }> {
    const received: Received[] = []
    const waiters: ((r: Received) => void)[] = []
    server = createServer((request, response) => {
        const chunks: Buffer[] = []
        request.on("data", (chunk: Buffer) => chunks.push(chunk))
        request.on("end", () => {
            const entry = { headers: request.headers, body: new Uint8Array(Buffer.concat(chunks)) }
            received.push(entry)
            waiters.shift()?.(entry)
            response.writeHead(status).end()
        })
    })
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    return {
        url: `http://127.0.0.1:${port}/v1/traces`,
        received,
        next: () => new Promise((resolve) => waiters.push(resolve)),
    }
}

describe("through a real runtime", () => {
    test("a turn arrives at the collector as one trace, with tokens and no text", async () => {
        const otlp = await collector()
        const runtime = await Runtime.create({
            agents: [join(workspace(otlp.url), "agent.yaml")],
            env: ENV,
            builtInPlugins: { "@dispach/trace-otlp": plugin },
            fetch: model,
        })
        const arrived = otlp.next()
        const result = await runtime.agent("support").send("what's my order status?")
        const request = await arrived
        await runtime.stop()

        expect(result.text).toBe("hi")
        expect(request.headers["content-type"]).toBe("application/x-protobuf")
        expect(request.headers.authorization).toBe("Bearer test")
        const resource = sub(sub(sub(new Map([[1, [request.body]]]), 1), 1), 1)
        expect(attrs(resource, 1)).toEqual({
            "service.name": "support",
            "openinference.project.name": "support",
        })

        const spans = spansOf(request.body)
        const names = spans.map((span) => text(span, 5))
        expect(names).toEqual(["invoke_agent support", "chat gpt-4o-mini"])
        const turn = attrs(spans[0] ?? new Map(), 9)
        expect(turn["agent.turn.end_reason"]).toBe("final")
        expect(turn["openinference.span.kind"]).toBe("AGENT")
        expect(attrs(spans[1] ?? new Map(), 9)["gen_ai.usage.input_tokens"]).toBe(40n)
        // Metadata only: neither the question nor the reply is anywhere in the bytes.
        const raw = Buffer.from(request.body).toString("latin1")
        expect(raw).not.toContain("order status")
        expect(raw).not.toContain("You are a test fixture")
    })

    test("a collector that refuses is an agent.warning, and the turn is unaffected", async () => {
        const otlp = await collector(503)
        const runtime = await Runtime.create({
            agents: [join(workspace(otlp.url), "agent.yaml")],
            env: ENV,
            builtInPlugins: { "@dispach/trace-otlp": plugin },
            fetch: model,
        })
        const warned = new Promise<AnyEvent>((resolve) => {
            runtime.bus.on("agent.warning", (event) => {
                if ((event.data as { code: string }).code === "trace_export_failed") resolve(event)
            })
        })
        const result = await runtime.agent("support").send("hello")
        const warning = await warned
        await runtime.stop()

        expect(result.text).toBe("hi")
        expect(warning.agentId).toBe("support")
        expect((warning.data as { message: string }).message).toContain("HTTP 503")
    })

    test("a header variable that is not set fails the plugin's load by name, and the agent still starts", async () => {
        const otlp = await collector()
        const runtime = await Runtime.create({
            agents: [join(workspace(otlp.url), "agent.yaml")],
            env: { MODEL_API_KEY: "test-key" },
            builtInPlugins: { "@dispach/trace-otlp": plugin },
            fetch: model,
        })
        const warnings = runtime.agent("support").warnings.map((w) => w.message)
        await runtime.stop()
        expect(warnings.some((m) => m.includes("COLLECTOR_AUTH, which is not set"))).toBe(true)
    })
})
