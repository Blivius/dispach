/**
 * The event-loop watchdog for `serve` (0.2.6).
 *
 * A turn that blocks the event loop (a runaway regex, a synchronous read of something huge, a busy
 * loop in a plugin) freezes the whole server: every agent, every channel, `/v1/ready`. Nothing inside
 * the loop can notice, because noticing needs the loop. So the main thread stamps a shared clock once
 * a second, and a worker thread, which keeps running, kills the process when the stamp is older than
 * `<PREFIX>LOOP_STALL_S` (default 60). The supervisor (Docker's restart policy, launchd, systemd)
 * starts it again; the outbox and the interrupted-turn sweep are what make that restart safe.
 *
 * SIGKILL, because SIGTERM is answered on the frozen loop. The line before it is written with
 * `fs.writeSync` from the worker: a worker's `process.stderr` is relayed through the main thread and
 * would never arrive. Node's `--report-on-signal` was measured and dropped for the same reason: its
 * handler runs on the main loop, so a stalled process never writes the report.
 */

import { Worker } from "node:worker_threads"
import { BRAND, HarnessError } from "@dispach/core"

const DEFAULT_STALL_S = 60

/** Seconds of stall before the kill; 0 switches the watchdog off. Refused at start when malformed. */
export function loopStallFrom(env: Readonly<Record<string, string | undefined>>): number {
    const name = `${BRAND.envPrefix}LOOP_STALL_S`
    const raw = env[name]
    if (raw === undefined || raw === "") return DEFAULT_STALL_S
    if (!/^\d+$/.test(raw)) {
        throw new HarnessError({
            code: "serve_loop_stall_invalid",
            message: `${name} is "${raw}", which is not a whole number of seconds.`,
            hint: `Set it to the seconds a frozen server may stay frozen before it is killed and restarted (default ${DEFAULT_STALL_S}), or 0 to switch the watchdog off.`,
            field: name,
        })
    }
    return Number(raw)
}

/** CommonJS, because an `eval` worker is a script in Node; Bun accepts it as well. */
const WORKER = `
const { workerData } = require("node:worker_threads")
const { writeSync } = require("node:fs")
const beat = new Float64Array(workerData.beat)
setInterval(() => {
    const stalled = Date.now() - beat[0]
    if (stalled < workerData.limitMs) return
    try {
        writeSync(2, workerData.prefix + "event loop stalled for " + Math.round(stalled / 1000) + "s; killing the process so its supervisor restarts it\\n")
    } finally {
        process.kill(workerData.pid, "SIGKILL")
    }
}, 1000)
`

/** Start watching; the returned function stops it. Never keeps the process alive on its own. */
export function startLoopWatchdog(stallS: number, prefix = `${BRAND.slug}: `): () => void {
    if (stallS <= 0) return () => {}
    const beat = new Float64Array(new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT))
    beat[0] = Date.now()
    const tick = setInterval(() => {
        beat[0] = Date.now()
    }, 1000)
    tick.unref()
    const worker = new Worker(WORKER, {
        eval: true,
        workerData: { beat: beat.buffer, limitMs: stallS * 1000, pid: process.pid, prefix },
    })
    worker.unref()
    return () => {
        clearInterval(tick)
        void worker.terminate()
    }
}
