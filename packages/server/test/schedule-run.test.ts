/**
 * `POST …/schedules/:sid/run` runs the schedule as the scheduler would (pilot.5, #15). A manual run is
 * how a schedule is tested, and the route used to send the role and nothing else: found in the image,
 * where a run limited to `now` showed the model `memory_write` too.
 */

import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BRAND, type ChannelHost, type OutboundMessage, Runtime } from "@dispach/core"
import { createHandler } from "../src/handler.ts"
import {
    cleanupWorkspaces,
    contractChecked,
    harness,
    PINNED_MANIFEST,
    replyFetch,
} from "./harness.ts"

afterAll(cleanupWorkspaces)

test("a manual run gets the schedule's tools.allow", async () => {
    const bodies: string[] = []
    const inner = replyFetch("It is noon.")
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""))
        return inner(url, init)
    }) as typeof globalThis.fetch
    const { runtime, call } = await harness({ fetch, manifest: PINNED_MANIFEST })
    const created = await call("POST", "/v1/agents/assistant/schedules", {
        body: {
            id: "brief",
            kind: "every",
            expr: "1h",
            task: "Say the time.",
            deliver: "none",
            tools: { allow: ["now"] },
        },
    })
    expect(created.status).toBe(201)
    expect((await call("POST", "/v1/agents/assistant/schedules/brief/run")).status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(bodies[0]).toContain("now")
    expect(bodies[0]).not.toContain("memory_write")
    await runtime.stop()
})

test("a manual run delivers its reply where the schedule delivers", async () => {
    /**
     * Found by an embedder's owner pressing "run now" on a routine pinned to WhatsApp: the run
     * finished and nothing arrived, because only the scheduler delivered. The timed run, half an
     * hour later, did.
     */
    const dir = mkdtempSync(join(tmpdir(), "schedule-run-"))
    writeFileSync(
        join(dir, "agent.yaml"),
        `apiVersion: ${BRAND.apiVersion}
id: sender
model:
  main:
    id: test-model
    baseUrl: https://example.invalid/v1
    apiKeyEnv: MODEL_API_KEY
channels:
  - type: stub
    id: tg
`,
    )
    const sent: OutboundMessage[] = []
    const runtime = await Runtime.create({
        agents: [join(dir, "agent.yaml")],
        env: { MODEL_API_KEY: "test-key" },
        store: ":memory:",
        startChannels: true,
        fetch: replyFetch("It is noon."),
        channels: {
            stub: (context) => ({
                id: context.id,
                type: "stub",
                limits: { maxMessageChars: 4096, idempotentSend: false },
                start: async (host: ChannelHost) => host.status("connected"),
                stop: async () => {},
                send: async (message: OutboundMessage) => {
                    sent.push(message)
                    return { ok: true as const, providerMessageId: String(sent.length) }
                },
            }),
        },
    })
    const handler = contractChecked(createHandler({ runtime, allowUnauthenticated: true }))
    const post = (path: string, body?: unknown) =>
        handler(
            new Request(`http://127.0.0.1:7420/v1/agents/sender/schedules${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
        )
    const schedule = (id: string, deliver: unknown) =>
        post("", { id, kind: "every", expr: "1h", task: "Say the time.", deliver })
    expect((await schedule("brief", { channel: "tg", to: "42" })).status).toBe(201)
    expect((await schedule("quiet", "none")).status).toBe(201)

    expect((await post("/quiet/run")).status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(sent).toHaveLength(0)

    expect((await post("/brief/run")).status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(sent.map((message) => [message.recipient, message.text])).toEqual([
        ["42", "It is noon."],
    ])
    await runtime.stop()
    rmSync(dir, { recursive: true, force: true })
})

test("a PATCH of one field keeps every other field the schedule was written with", async () => {
    /**
     * The route rebuilds the whole schedule from the stored row before validating, and a field that
     * rebuild did not name was erased by a patch that never mentioned it: `{expr: "1m"}` dropped
     * `timeoutMs`, `maxSteps` and `tools`, found live. So the fixture sets every optional field the
     * write accepts, and the assertion is that nothing but the patched field moved.
     */
    const manifest = PINNED_MANIFEST.replace(
        "    apiKeyEnv: MODEL_API_KEY\n",
        "    apiKeyEnv: MODEL_API_KEY\n  fast:\n    id: gpt-4o-mini\n    baseUrl: https://api.example.com/v1\n    apiKeyEnv: MODEL_API_KEY\n",
    )
    const { runtime, call } = await harness({ manifest })
    const created = await call("POST", "/v1/agents/assistant/schedules", {
        body: {
            id: "full",
            kind: "cron",
            expr: "0 9 * * *",
            timezone: "Asia/Dhaka",
            task: "Digest",
            deliver: "none",
            session: "shared",
            role: "fast",
            tools: { allow: ["now"] },
            timeoutMs: 90_000,
            maxSteps: 12,
        },
    })
    expect(created.status).toBe(201)
    const before = (await created.json()) as Record<string, unknown>
    const patched = await call("PATCH", "/v1/agents/assistant/schedules/full", {
        body: { expr: "0 10 * * *" },
    })
    expect(patched.status).toBe(200)
    const after = (await patched.json()) as Record<string, unknown>
    const kept = (row: Record<string, unknown>) => {
        const {
            expr: _expr,
            nextRunAt: _next,
            anchorAt: _anchor,
            updatedAt: _updated,
            ...rest
        } = row
        return rest
    }
    expect(kept(after)).toEqual(kept(before))
    expect(after.expr).toBe("0 10 * * *")
    await runtime.stop()
})
