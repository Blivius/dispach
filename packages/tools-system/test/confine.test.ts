/**
 * `confine: agent` (0.2.6): commands run inside the agent's own directory under Landlock. The kernel
 * half runs only where Landlock exists (Linux 5.13+ with python3: a silo); elsewhere a confined
 * command is refused, never run unconfined, and that half is what runs here.
 */

import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
    type PluginContext,
    type ScriptRunner,
    type ToolProviderFactory,
    toolContext,
} from "@dispach/core"
import { configSetHandler } from "../src/config.ts"
import { confineUnsupported } from "../src/confine.ts"
import plugin from "../src/index.ts"
import { confinementFor } from "../src/provider.ts"
import { resolveRoots } from "../src/root.ts"

/** Two agents side by side, as in one silo, and the runtime's secret in the environment. */
async function silo(config: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), "confine-"))
    const dir = join(root, "agents", "a")
    const other = join(root, "agents", "b")
    for (const d of [join(dir, "workspace"), join(other, "workspace")])
        mkdirSync(d, { recursive: true })
    writeFileSync(join(other, "workspace", "notes.md"), "b's notes")
    writeFileSync(join(root, "store.db"), "every conversation")
    const env = { PATH: process.env.PATH, DISPACH_API_TOKEN: "runtime-secret" }
    let factory: ToolProviderFactory | undefined
    let runner: ScriptRunner | undefined
    await plugin.setup({
        env,
        defineToolProvider: (_id: string, made: ToolProviderFactory) => {
            factory = made
        },
        defineScriptRunner: (made: ScriptRunner) => {
            runner = made
        },
    } as unknown as PluginContext)
    const provider = await factory?.({ dir, env, config, agentId: "a" })
    const [exec] = (await provider?.resolve(["exec"])) ?? []
    const run = async (command: string) => {
        try {
            return String(await exec?.handler({ command }, toolContext({ agentId: "a", dir })))
        } catch (error) {
            return `THREW ${(error as { code?: string }).code}`
        }
    }
    const script = async (command: string) => {
        try {
            return (
                (
                    await runner?.run({
                        command: "sh",
                        args: ["-c", command],
                        cwd: dir,
                        timeoutMs: 5000,
                        signal: new AbortController().signal,
                    })
                )?.output ?? ""
            )
        } catch (error) {
            return `THREW ${(error as { code?: string }).code}`
        }
    }
    return { root, dir, other, run, script }
}

test("confine takes agent or workspace", async () => {
    await expect(silo({ confine: true })).rejects.toThrow("the values are agent and workspace")
})

test("confine: workspace grants the workspace, the temp and the writeRoots, and the skills read-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "confine-ws-"))
    const c = confinementFor(dir, resolveRoots(dir, ["/data/shared"], true), "workspace")
    const real = realpathSync(dir)
    const at = (p: string) => p.replace(dir, real)
    expect(c.writable.map(at)).toEqual([
        join(real, "workspace"),
        join(real, ".tmp"),
        "/data/shared",
    ])
    expect(c.readable?.map(at)).toEqual([join(real, "skills")])
    // The temp exists before the ruleset is made: Landlock can only allow a path that is there.
    expect(existsSync(join(dir, ".tmp"))).toBe(true)
    expect(confinementFor(dir, resolveRoots(dir, [], true)).writable).toEqual([resolve(dir)])
})

test("the agent cannot turn confinement off, by path or inside a value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "confine-floor-"))
    const file = join(dir, "agent.yaml")
    writeFileSync(file, "apiVersion: dispach/v1\nid: a\nmodel:\n  main:\n    id: m\n")
    const set = configSetHandler({ agentDir: dir, file })
    for (const [path, value] of [
        ["tools.providers.system.confine", "none"],
        ["tools.providers", '{"system": {"confine": "none"}}'],
    ]) {
        let code = ""
        try {
            await set({ path, value }, toolContext({ dir }))
        } catch (error) {
            code = (error as { code?: string }).code ?? ""
        }
        expect(code).toBe("config_refused")
    }
})

test.if(confineUnsupported() !== undefined)(
    "without Landlock a confined command is refused, never run unconfined",
    async () => {
        const { run, script } = await silo({ confine: "agent" })
        expect(await run("echo ran")).toBe("THREW exec_confine_unavailable")
        expect(await script("echo ran")).toBe("THREW exec_confine_unavailable")
    },
)

test.if(confineUnsupported() === undefined)(
    "with Landlock a command has its own directory and nothing else",
    async () => {
        const { root, dir, other, run, script } = await silo({ confine: "agent" })
        expect(await run("echo hi > own.txt && cat own.txt")).toContain("hi")
        const probes = [
            `cat ${join(other, "workspace", "notes.md")}`,
            `echo x > ${join(other, "workspace", "x")}`,
            `cat ${join(root, "store.db")}`,
            `cat /proc/${process.pid}/environ`,
        ]
        for (const probe of probes) {
            for (const out of [await run(probe), await script(probe)]) {
                expect(out).toContain("Permission denied")
            }
        }
        // The environment is scrubbed; temp and home are the agent's own.
        const env = await run("env")
        expect(env).not.toContain("runtime-secret")
        expect(env).toContain(`TMPDIR=${join(dir, ".tmp")}`)
        expect(await run("echo t > $TMPDIR/t && cat $TMPDIR/t")).toContain("t")
        // Ordinary programs still run.
        expect(await run("python3 -c 'print(6*7)'")).toContain("42")
    },
)

test.if(confineUnsupported() === undefined)(
    "with confine: workspace a command has the workspace and not the rest of its own directory",
    async () => {
        const { dir, run } = await silo({ confine: "workspace" })
        writeFileSync(join(dir, ".env"), "TELEGRAM_BOT_TOKEN=secret")
        expect(await run("echo hi > own.txt && cat own.txt")).toContain("hi")
        expect(await run(`cat ${join(dir, ".env")}`)).toContain("Permission denied")
        expect(await run(`echo x > ${join(dir, "agent.yaml")}`)).toContain("Permission denied")
        expect(await run("echo t > $TMPDIR/t && cat $TMPDIR/t")).toContain("t")
    },
)
