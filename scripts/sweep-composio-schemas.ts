#!/usr/bin/env bun
/**
 * Every tool of the named Composio toolkits through the schema converter, listing each refusal.
 *
 *   COMPOSIO_API_KEY=… bun scripts/sweep-composio-schemas.ts gmail outlook … [--out dir]
 *
 * The report is the spec for the converter: a refused tool never reaches the agent ("configured but
 * could not be loaded"). With `--out`, each refused tool's raw `input_parameters` is written there as
 * `<SLUG>.json`, ready to become a test fixture. Reads only (`GET /tools`); the key is never printed.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type ComposioTool, mapParameters } from "../packages/tools-composio/src/map.ts"

const key = process.env.COMPOSIO_API_KEY
if (!key) throw new Error("COMPOSIO_API_KEY is not set")
const args = process.argv.slice(2)
const outAt = args.indexOf("--out")
const out = outAt === -1 ? undefined : args[outAt + 1]
const toolkits = args.filter((_, i) => i !== outAt && i !== outAt + 1)
if (toolkits.length === 0) throw new Error("name at least one toolkit slug")
if (out) mkdirSync(out, { recursive: true })

const BASE = "https://backend.composio.dev/api/v3"

async function toolsOf(toolkit: string): Promise<ComposioTool[]> {
    const all: ComposioTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 50; page += 1) {
        // What a relay that asks for the newest schemas (VelaCrew's does) hands the provider.
        const q = new URLSearchParams({
            toolkit_slug: toolkit,
            limit: "100",
            toolkit_versions: "latest",
        })
        if (cursor) q.set("cursor", cursor)
        const res = await fetch(`${BASE}/tools?${q}`, { headers: { "x-api-key": key as string } })
        if (!res.ok) throw new Error(`${toolkit}: HTTP ${res.status}`)
        const body = (await res.json()) as { items?: ComposioTool[]; next_cursor?: string | null }
        all.push(...(body.items ?? []))
        if (!body.next_cursor || body.next_cursor === cursor) break
        cursor = body.next_cursor
    }
    return all
}

const byKeyword = new Map<string, number>()
let total = 0
let refused = 0
for (const toolkit of toolkits) {
    const tools = await toolsOf(toolkit).catch((e: Error) => {
        console.log(`${toolkit}: FETCH FAILED ${e.message}`)
        return []
    })
    const bad: string[] = []
    for (const tool of tools) {
        total += 1
        try {
            mapParameters(tool)
        } catch (e) {
            refused += 1
            const msg = (e as Error).message
            const kw = /keyword[^`'"]*[`'"]([^`'"]+)/.exec(msg)?.[1] ?? msg.slice(0, 60)
            byKeyword.set(kw, (byKeyword.get(kw) ?? 0) + 1)
            bad.push(`    ${tool.slug}: ${msg}`)
            if (out)
                writeFileSync(
                    join(out, `${tool.slug}.json`),
                    JSON.stringify(tool.input_parameters, null, 2),
                )
        }
    }
    console.log(`${toolkit}: ${tools.length} tools, ${bad.length} refused`)
    for (const line of bad) console.log(line)
}
console.log(`\nTOTAL ${total} tools, ${refused} refused`)
for (const [kw, n] of [...byKeyword].sort((a, b) => b[1] - a[1])) console.log(`  ${kw}: ${n}`)
