import { describe, expect, test } from "bun:test"
import { createToolServer, runCheck } from "../../../scripts/bench/tools-server.ts"
import { McpClient } from "../../tools-mcp/src/client.ts"

function connect(world = {}) {
    const server = createToolServer(world)
    const client = new McpClient({
        server: "bench",
        url: "http://bench.test/mcp",
        headers: () => ({}),
        fetch: (url, init) => server.fetch(new Request(url, init)),
        timeoutMs: 5_000,
    })
    return { server, client }
}

const text = (result: { content?: readonly { text?: string }[] }) => result.content?.[0]?.text

describe("bench tool server", () => {
    test("Dispach's own MCP client lists the eight tools with read-only hints", async () => {
        const { client } = connect()
        const tools = await client.listTools()
        expect(tools.map((t) => t.name)).toEqual([
            "kv_get",
            "kv_set",
            "read_file",
            "write_file",
            "calculator",
            "lookup_order",
            "now",
            "send_message",
        ])
        expect(tools.find((t) => t.name === "kv_set")?.annotations?.readOnlyHint).toBe(false)
        expect(tools.find((t) => t.name === "kv_get")?.annotations?.readOnlyHint).toBe(true)
    })

    test("calls change the world, and the state reports it with the call log", async () => {
        const { server, client } = connect({
            files: { "./notes/a.md": "alpha" },
            orders: [{ id: "A-1", status: "shipped", total: 12.5, items: ["pen"] }],
        })
        expect(text(await client.callTool("read_file", { path: "notes/a.md" }, {}))).toBe("alpha")
        await client.callTool("kv_set", { key: "k", value: "v" }, {})
        await client.callTool("write_file", { path: "/out.txt", content: "done" }, {})
        await client.callTool("send_message", { to: "ada", text: "hi" }, {})
        expect(
            text(await client.callTool("calculator", { expression: "(12.5 * 4) - 3" }, {})),
        ).toBe("47")
        expect(text(await client.callTool("lookup_order", { order_id: "A-1" }, {}))).toContain(
            "shipped",
        )
        const missing = await client.callTool("lookup_order", { order_id: "Z-9" }, {})
        expect(missing.isError).toBe(true)

        const state = server.state()
        expect(state.kv).toEqual({ k: "v" })
        expect(state.files["out.txt"]).toBe("done")
        expect(state.messages).toEqual([{ to: "ada", text: "hi" }])
        expect(state.calls.map((c) => c.tool)).toEqual([
            "read_file",
            "kv_set",
            "write_file",
            "send_message",
            "calculator",
            "lookup_order",
            "lookup_order",
        ])
        expect(state.calls.at(-1)?.isError).toBe(true)
    })

    test("calculator refuses anything that is not arithmetic", async () => {
        const { client } = connect()
        const result = await client.callTool("calculator", { expression: "Math.max(1, 2)" }, {})
        expect(result.isError).toBe(true)
    })

    test("an injected failure fails the first N calls, then the tool works", async () => {
        const { client } = connect({ failures: { now: 2 }, clock: "2030-01-01T00:00:00Z" })
        expect((await client.callTool("now", {}, {})).isError).toBe(true)
        expect((await client.callTool("now", {}, {})).isError).toBe(true)
        expect(text(await client.callTool("now", {}, {}))).toBe("2030-01-01T00:00:00Z")
    })

    test("/reset loads a fresh world and clears the log; /state serves it", async () => {
        const { server, client } = connect()
        await client.callTool("kv_set", { key: "old", value: "x" }, {})
        await server.fetch(
            new Request("http://bench.test/reset", {
                method: "POST",
                body: JSON.stringify({ kv: { seeded: "1" } }),
            }),
        )
        const state = (await (
            await server.fetch(new Request("http://bench.test/state"))
        ).json()) as {
            kv: Record<string, string>
            calls: unknown[]
        }
        expect(state).toMatchObject({ kv: { seeded: "1" }, calls: [] })
    })
})

describe("run_check", () => {
    const tests =
        'import { double } from "./src/double.js"\nexport default { "doubles 2": () => { if (double(2) !== 4) throw new Error("double(2) is " + double(2)) } }'

    test("is listed only by a server made with checks", async () => {
        expect((await connect().client.listTools()).map((t) => t.name)).not.toContain("run_check")
        const server = createToolServer({}, { checks: true })
        const client = new McpClient({
            server: "bench",
            url: "http://bench.test/mcp",
            headers: () => ({}),
            fetch: (url, init) => server.fetch(new Request(url, init)),
            timeoutMs: 5_000,
        })
        expect((await client.listTools()).map((t) => t.name)).toContain("run_check")
    })

    test("runs the hidden suite against the files as they are now", () => {
        const right = runCheck({ "src/double.js": "export const double = (n) => n + 2" }, tests)
        expect(right).toEqual({ total: 1, failures: [] })
        const wrong = runCheck({ "src/double.js": "export const double = (n) => n * 3" }, tests)
        expect(wrong.failures.map((f) => f.message)).toEqual(["double(2) is 6"])
    })

    test("a file that does not parse is one failure the model can read, not a crash", () => {
        const result = runCheck({ "src/double.js": "export const double = (n) =>" }, tests)
        expect(result.failures.length).toBe(1)
        expect(result.failures[0]?.name).toBe("the suite did not run")
    })

    test("a path that climbs out of the workspace is not written", () => {
        const result = runCheck(
            { "../escape.js": "export {}", "src/double.js": "export const double = (n) => n * 2" },
            tests,
        )
        expect(result.failures).toEqual([])
    })
})
