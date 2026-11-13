/**
 * The event-loop watchdog (0.2.6): a server whose loop freezes is killed so its supervisor restarts
 * it. Run in a child process, because the property is that the process dies.
 */

import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { loopStallFrom } from "../src/lib/watchdog.ts"

const MODULE = join(import.meta.dirname, "..", "src", "lib", "watchdog.ts")

function child(body: string) {
    return spawnSync(
        process.execPath,
        ["-e", `import { startLoopWatchdog } from ${JSON.stringify(MODULE)}\n${body}`],
        { encoding: "utf8", timeout: 20_000 },
    )
}

test("a loop frozen past the limit is killed, and says why on stderr", () => {
    const run = child(`startLoopWatchdog(1, "test: ")
setTimeout(() => { const end = Date.now() + 10_000; while (Date.now() < end) {} ; console.log("survived") }, 100)`)
    expect(run.signal).toBe("SIGKILL")
    expect(run.stdout).not.toContain("survived")
    expect(run.stderr).toMatch(/test: event loop stalled for \d+s/)
})

test("a healthy process exits on its own: the watchdog never keeps it alive", () => {
    // A long limit: this is about unref, and a busy test machine must not trip a real stall.
    const run = child(`startLoopWatchdog(30)
setTimeout(() => console.log("done"), 2_500)`)
    expect(run.status).toBe(0)
    expect(run.stdout).toContain("done")
})

test("DISPACH_LOOP_STALL_S: default 60, 0 is off, anything else refused", () => {
    expect(loopStallFrom({})).toBe(60)
    expect(loopStallFrom({ DISPACH_LOOP_STALL_S: "0" })).toBe(0)
    expect(loopStallFrom({ DISPACH_LOOP_STALL_S: "90" })).toBe(90)
    expect(() => loopStallFrom({ DISPACH_LOOP_STALL_S: "1m" })).toThrow("not a whole number")
})
