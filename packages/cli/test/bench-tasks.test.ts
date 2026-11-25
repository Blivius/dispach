import { describe, expect, test } from "bun:test"
import { ITERATE_TASKS } from "../../../scripts/bench/iterate.ts"
import { TASKS } from "../../../scripts/bench/tasks.ts"
import { createToolServer } from "../../../scripts/bench/tools-server.ts"

async function replay(task: (typeof TASKS)[number]) {
    const server = createToolServer(task.world, { checks: true })
    let id = 0
    for (const [name, args] of task.oracle.calls) {
        id += 1
        await server.fetch(
            new Request("http://bench.test/mcp", {
                method: "POST",
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id,
                    method: "tools/call",
                    params: { name, arguments: args },
                }),
            }),
        )
    }
    return server.state()
}

describe("bench task suite", () => {
    test("25 tasks, unique ids, every category represented", () => {
        expect(TASKS).toHaveLength(25)
        expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length)
        expect(new Set(TASKS.map((t) => t.category))).toEqual(
            new Set(["single", "chain", "recall", "abstention", "recovery", "long"]),
        )
    })

    for (const task of TASKS) {
        test(`${task.id}: the oracle passes, and doing nothing fails`, async () => {
            expect(task.grade(await replay(task), task.oracle.reply)).toBeUndefined()
            expect(task.grade(createToolServer(task.world).state(), "")).toBeDefined()
        })
    }
})

describe("iterate family", () => {
    test("fourteen projects, unique ids that do not collide with the suite", () => {
        expect(ITERATE_TASKS.length).toBe(14)
        const ids = [...TASKS, ...ITERATE_TASKS].map((t) => t.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(
            ITERATE_TASKS.every((t) => t.category === "iterate" && t.world.check !== undefined),
        ).toBe(true)
    })

    for (const task of ITERATE_TASKS) {
        test(`${task.id}: the oracle passes, and the project as given needs more than one round`, async () => {
            expect(task.grade(await replay(task), task.oracle.reply)).toBeUndefined()
            const untouched = createToolServer(task.world, { checks: true }).state()
            expect(task.grade(untouched, "I fixed it.")).toBeDefined()
            // A project finished in one round of edit-and-check is not an iterate task: more than one failing
            // test, or more than one stage to get through.
            const rounds = Math.max(
                untouched.check?.failures.length ?? 0,
                untouched.check?.stages ?? 1,
            )
            expect(rounds).toBeGreaterThan(1)
        })
    }
})
