import type { ModelError } from "../src/errors.ts"
import type { ModelRoleConfig } from "../src/manifest/schema.ts"
import {
    ANTHROPIC_MESSAGES_TRANSPORT,
    messagesBody,
    messagesChunks,
} from "../src/model/anthropic-messages.ts"
import type { ModelCapabilities } from "../src/model/capabilities.ts"
import type { ChatChunk, ChatMessage, ChatRequest, FetchLike } from "../src/model/provider.ts"
import { parseSSE } from "../src/model/sse.ts"
import { describe, expect, test } from "./_harness.ts"

/**
 * The native Messages transport, driven by an injected `fetch` and recorded event streams. What
 * matters here is what reaches the wire (cache markers, replayed thinking, merged turns) and what a
 * stream becomes (usage that adds up, a tool call reassembled from fragments), plus which failures
 * are sent again. None of that is summonable on demand from the live API.
 */

const SONNET = "claude-sonnet-5-5"
const CONFIG: ModelRoleConfig = { id: SONNET, api: "anthropic-messages" }
const KEY_ENV = { ANTHROPIC_API_KEY: "sk-test" }
const FAST = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 }

function frame(payload: Record<string, unknown>): string {
    return `event: ${String(payload.type)}\ndata: ${JSON.stringify(payload)}\n\n`
}

function sseResponse(frames: string[], init: ResponseInit = {}): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder()
            for (const each of frames) controller.enqueue(encoder.encode(each))
            controller.close()
        },
    })
    return new Response(stream, {
        ...init,
        headers: { "content-type": "text/event-stream", ...(init.headers ?? {}) },
    })
}

/** The smallest complete reply: one text block, usage, a stop. */
function reply(text = "ok"): string[] {
    return [
        frame({
            type: "message_start",
            message: { usage: { input_tokens: 5, output_tokens: 1 } },
        }),
        frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
        frame({ type: "content_block_stop", index: 0 }),
        frame({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 2 },
        }),
        frame({ type: "message_stop" }),
    ]
}

function errorBody(type: string, message = "x"): string {
    return JSON.stringify({ type: "error", error: { type, message } })
}

async function drain(stream: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
    const chunks: ChatChunk[] = []
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
}

function provider(fetch: FetchLike, config: ModelRoleConfig = CONFIG) {
    return ANTHROPIC_MESSAGES_TRANSPORT.create({
        id: "anthropic-messages:main",
        field: "model.main",
        config,
        options: undefined,
        env: KEY_ENV,
        fetch,
        retry: FAST,
    })
}

const REQUEST: ChatRequest = { model: SONNET, messages: [{ role: "user", content: "hi" }] }

/** Every `cache_control` marker anywhere in a body. */
function markers(body: Record<string, unknown>): number {
    return (JSON.stringify(body).match(/"cache_control"/g) ?? []).length
}

describe("request shape", () => {
    const messages: ChatMessage[] = [
        { role: "system", content: "identity" },
        { role: "system", content: "workspace", cacheBreakpoint: true },
        { role: "user", content: "skill text", cacheBreakpoint: true },
        { role: "user", content: "fix the bug", turnInput: true },
        {
            role: "assistant",
            content: "",
            thinking: [{ text: "", signature: "sig-1" }, { text: "unsigned" }],
            toolCalls: [{ id: "t1", name: "read_file", arguments: '{"path":"a.ts"}' }],
        },
        { role: "tool", content: "export const a = 1", toolCallId: "t1" },
        { role: "system", content: "reminder" },
    ]
    const body = messagesBody({ model: SONNET, messages }, CONFIG)
    const wire = body.messages as { role: string; content: Record<string, unknown>[] }[]

    test("leading system messages become system[], with breakpoint A on the last", () => {
        expect(body.system).toEqual([
            { type: "text", text: "identity" },
            { type: "text", text: "workspace", cache_control: { type: "ephemeral" } },
        ])
    })

    test("roles alternate: same-role messages merge, a tool result is a user block", () => {
        expect(wire.map((message) => message.role)).toEqual(["user", "assistant", "user"])
        expect(wire[2]?.content[0]).toEqual({
            type: "tool_result",
            tool_use_id: "t1",
            content: "export const a = 1",
        })
    })

    test("a later system message is fenced user text", () => {
        expect(wire[2]?.content[1]?.text).toBe("<runtime_context>\nreminder\n</runtime_context>")
    })

    test("signed thinking is replayed even when empty; unsigned thinking is dropped", () => {
        expect(wire[1]?.content).toEqual([
            { type: "thinking", thinking: "", signature: "sig-1" },
            { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
        ])
    })

    test("three markers: static prefix, skill, rolling tail", () => {
        expect(markers(body)).toBe(3)
        expect(wire[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
        expect(wire[2]?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" })
    })

    test("never more than four markers, however many breakpoints assembly sets", () => {
        const many: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({
            role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
            content: `m${index}`,
            cacheBreakpoint: true as const,
        }))
        expect(markers(messagesBody({ model: SONNET, messages: many }, CONFIG))).toBe(4)
    })

    test("promptCache: none sends no markers", () => {
        const off = messagesBody(
            { model: SONNET, messages },
            { ...CONFIG, capabilities: { promptCache: "none" } },
        )
        expect(markers(off)).toBe(0)
    })

    test("adaptive thinking for Sonnet 5.5, and no sampling fields it would refuse", () => {
        const shaped = messagesBody(
            { ...REQUEST, reasoningEffort: "medium", temperature: 0.2 },
            CONFIG,
        )
        expect(shaped.thinking).toEqual({ type: "adaptive" })
        expect(shaped.output_config).toEqual({ effort: "medium" })
        expect(shaped.temperature).toBeUndefined()
        expect(shaped.max_tokens).toBe(32_768)
    })
})

describe("stream", () => {
    async function chunksOf(frames: string[]): Promise<ChatChunk[]> {
        async function* source() {
            yield* frames
        }
        return drain(messagesChunks(parseSSE(source())))
    }

    test("thinking, text and a fragmented tool call; usage adds the cache back in", async () => {
        const chunks = await chunksOf([
            frame({
                type: "message_start",
                message: {
                    usage: {
                        input_tokens: 10,
                        cache_read_input_tokens: 900,
                        cache_creation_input_tokens: 50,
                        output_tokens: 1,
                    },
                },
            }),
            frame({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
            frame({
                type: "content_block_delta",
                index: 0,
                delta: { type: "thinking_delta", thinking: "plan" },
            }),
            frame({
                type: "content_block_delta",
                index: 0,
                delta: { type: "signature_delta", signature: "s" },
            }),
            frame({ type: "content_block_stop", index: 0 }),
            frame({ type: "ping" }),
            frame({ type: "content_block_start", index: 1, content_block: { type: "text" } }),
            frame({
                type: "content_block_delta",
                index: 1,
                delta: { type: "text_delta", text: "Reading." },
            }),
            frame({ type: "content_block_stop", index: 1 }),
            frame({
                type: "content_block_start",
                index: 2,
                content_block: { type: "tool_use", id: "t9", name: "read_file" },
            }),
            frame({
                type: "content_block_delta",
                index: 2,
                delta: { type: "input_json_delta", partial_json: '{"pa' },
            }),
            frame({
                type: "content_block_delta",
                index: 2,
                delta: { type: "input_json_delta", partial_json: 'th":"a"}' },
            }),
            frame({ type: "content_block_stop", index: 2 }),
            frame({
                type: "message_delta",
                delta: { stop_reason: "tool_use" },
                usage: { output_tokens: 40 },
            }),
            frame({ type: "message_stop" }),
        ])
        expect(chunks).toEqual([
            { type: "reasoning", delta: "plan" },
            { type: "thinking_block", block: { text: "plan", signature: "s" } },
            { type: "text", delta: "Reading." },
            { type: "tool_call", call: { id: "t9", name: "read_file", arguments: '{"path":"a"}' } },
            {
                type: "usage",
                promptTokens: 960,
                completionTokens: 40,
                cachedPromptTokens: 900,
                cacheSource: "cache_read_input_tokens",
                cacheWriteTokens: 50,
            },
            { type: "finish", reason: "tool_calls" },
        ])
    })

    test("a tool call with no input fragments is an empty object, not an empty string", async () => {
        const chunks = await chunksOf([
            frame({
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "t", name: "now" },
            }),
            frame({ type: "content_block_stop", index: 0 }),
        ])
        expect(chunks).toEqual([
            { type: "tool_call", call: { id: "t", name: "now", arguments: "{}" } },
        ])
    })
})

describe("transport", () => {
    test("create makes no network call: it runs before runtime.ready", () => {
        let calls = 0
        provider(async () => {
            calls += 1
            return sseResponse(reply())
        })
        expect(calls).toBe(0)
    })

    test("posts to /v1/messages with the key and version headers", async () => {
        let url = ""
        let headers: Record<string, string> = {}
        await drain(
            provider(async (input, init) => {
                url = String(input)
                headers = init?.headers as Record<string, string>
                return sseResponse(reply())
            }).chat(REQUEST, new AbortController().signal),
        )
        expect(url).toBe("https://api.anthropic.com/v1/messages")
        expect(headers["x-api-key"]).toBe("sk-test")
        expect(headers["anthropic-version"]).toBeDefined()
    })

    test("a missing key is a config error, and nothing is sent", async () => {
        let calls = 0
        const bare = ANTHROPIC_MESSAGES_TRANSPORT.create({
            id: "anthropic-messages:main",
            field: "model.main",
            config: CONFIG,
            options: undefined,
            env: {},
            fetch: async () => {
                calls += 1
                return sseResponse(reply())
            },
        })
        await expect(drain(bare.chat(REQUEST, new AbortController().signal))).rejects.toThrow(
            "ANTHROPIC_API_KEY",
        )
        expect(calls).toBe(0)
    })

    test("a stale signed thinking block is stripped and the request sent again, once", async () => {
        const bodies: Record<string, unknown>[] = []
        const withThinking: ChatRequest = {
            model: SONNET,
            messages: [
                { role: "user", content: "q", turnInput: true },
                {
                    role: "assistant",
                    content: "",
                    thinking: [{ text: "t", signature: "old" }],
                    toolCalls: [{ id: "a", name: "x", arguments: "{}" }],
                },
                { role: "tool", content: "r", toolCallId: "a" },
            ],
        }
        const bound = () =>
            new Response(
                errorBody(
                    "invalid_request_error",
                    "thinking block is bound to a different conversation",
                ),
                {
                    status: 400,
                },
            )
        await expect(
            drain(
                provider(async (_url, init) => {
                    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
                    return bound()
                }).chat(withThinking, new AbortController().signal),
            ),
        ).rejects.toThrow(/Anthropic returned 400/)
        expect(bodies.length).toBe(2)
        expect(JSON.stringify(bodies[0])).toContain('"thinking"')
        expect(JSON.stringify(bodies[1])).not.toContain('"signature"')
    })

    test("an error after output has streamed is surfaced, never retried", async () => {
        let calls = 0
        const run = drain(
            provider(async () => {
                calls += 1
                return sseResponse([
                    ...reply().slice(0, 3),
                    frame({ type: "error", error: { type: "overloaded_error", message: "busy" } }),
                ])
            }).chat(REQUEST, new AbortController().signal),
        )
        await expect(run).rejects.toThrow(/Anthropic returned 529 \(overloaded_error\)/)
        expect(calls).toBe(1)
    })

    test("the transport turns caching on for Claude, unless the manifest said otherwise", () => {
        const resolved = { promptCache: "none" } as ModelCapabilities
        const hook = ANTHROPIC_MESSAGES_TRANSPORT.capabilities
        expect(hook?.(resolved, CONFIG).promptCache).toBe("anthropic")
        expect(
            hook?.(resolved, { ...CONFIG, capabilities: { promptCache: "none" } }).promptCache,
        ).toBe("none")
    })
})

/**
 * What is already decided about retrying (`retryable` in the transport). These fail until the rule is
 * written, which is the point: they are the rule's acceptance.
 */
describe("retry", () => {
    async function attempts(
        responses: (() => Response)[],
    ): Promise<{ calls: number; error?: unknown }> {
        let calls = 0
        try {
            await drain(
                provider(async () => {
                    const next = responses[Math.min(calls, responses.length - 1)] as () => Response
                    calls += 1
                    return next()
                }).chat(REQUEST, new AbortController().signal),
            )
            return { calls }
        } catch (error) {
            return { calls, error }
        }
    }

    test("529 overloaded is sent again", async () => {
        const result = await attempts([
            () => new Response(errorBody("overloaded_error"), { status: 529 }),
            () => sseResponse(reply()),
        ])
        expect(result).toEqual({ calls: 2 })
    })

    test("an overloaded error inside the stream, before any output, is sent again", async () => {
        const result = await attempts([
            () =>
                sseResponse([
                    frame({ type: "error", error: { type: "overloaded_error", message: "busy" } }),
                ]),
            () => sseResponse(reply()),
        ])
        expect(result).toEqual({ calls: 2 })
    })

    test("an account that cannot pay is sent once, and the error says so", async () => {
        const refusals: [number, string][] = [
            [
                400,
                errorBody(
                    "invalid_request_error",
                    "Your credit balance is too low to access the Anthropic API.",
                ),
            ],
            [402, errorBody("billing_error")],
            [
                429,
                JSON.stringify({
                    type: "error",
                    error: {
                        type: "rate_limit_error",
                        message: "spend cap",
                        details: { error_code: "enforced_spend_limit_reached" },
                    },
                }),
            ],
        ]
        for (const [status, body] of refusals) {
            const result = await attempts([
                () => new Response(body, { status }),
                () => sseResponse(reply()),
            ])
            expect(result.calls).toBe(1)
            expect((result.error as ModelError).code).toBe("model_out_of_credit")
            expect((result.error as ModelError).status).toBe(status)
        }
    })

    test("any other 400 is still the request's fault", async () => {
        const result = await attempts([
            () =>
                new Response(errorBody("invalid_request_error", "max_tokens: required"), {
                    status: 400,
                }),
        ])
        expect(result.calls).toBe(1)
        expect((result.error as ModelError).code).toBe("model_http_error")
    })

    test("403 is never retried: it may be an embedder's budget stop", async () => {
        const result = await attempts([
            () => new Response(errorBody("permission_error"), { status: 403 }),
            () => sseResponse(reply()),
        ])
        expect(result.calls).toBe(1)
        expect((result.error as ModelError).status).toBe(403)
    })

    test("x-should-retry: false is the API's own verdict and is obeyed", async () => {
        const result = await attempts([
            () =>
                new Response(errorBody("rate_limit_error"), {
                    status: 429,
                    headers: { "x-should-retry": "false" },
                }),
            () => sseResponse(reply()),
        ])
        expect(result.calls).toBe(1)
    })

    test("403 stays final even when the API invites a retry", async () => {
        const result = await attempts([
            () =>
                new Response(errorBody("permission_error"), {
                    status: 403,
                    headers: { "x-should-retry": "true" },
                }),
            () => sseResponse(reply()),
        ])
        expect(result.calls).toBe(1)
    })

    test("an endpoint never reached is tried again", async () => {
        let calls = 0
        await drain(
            provider(async () => {
                calls += 1
                if (calls === 1) throw new TypeError("fetch failed")
                return sseResponse(reply())
            }).chat(REQUEST, new AbortController().signal),
        )
        expect(calls).toBe(2)
    })

    test("a 400 the request caused is not retried", async () => {
        const result = await attempts([
            () =>
                new Response(errorBody("invalid_request_error", "max_tokens: too large"), {
                    status: 400,
                }),
            () => sseResponse(reply()),
        ])
        expect(result.calls).toBe(1)
    })
})
