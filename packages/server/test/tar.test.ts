/**
 * A file that changes size between its header and its read cannot corrupt the archive (pilot.11):
 * the entry holds exactly the size the header says, cut or zero-padded.
 */

import { describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { entriesOf } from "../src/tar.ts"

async function blocksWhile(change: (path: string) => void, initial: string) {
    const path = join(mkdtempSync(join(tmpdir(), "tar-")), "f.txt")
    writeFileSync(path, initial)
    const out: Uint8Array[] = []
    let first = true
    for await (const chunk of entriesOf([{ name: "f.txt", source: { path } }])) {
        out.push(chunk)
        // The header has been written from `stat`; now the file moves under it.
        if (first) change(path)
        first = false
    }
    const all = new Uint8Array(out.reduce((sum, chunk) => sum + chunk.length, 0))
    let at = 0
    for (const chunk of out) {
        all.set(chunk, at)
        at += chunk.length
    }
    return all
}

async function archiveOf(name: string): Promise<Uint8Array> {
    const out: Uint8Array[] = []
    for await (const chunk of entriesOf([
        { name, source: { bytes: new TextEncoder().encode("x") } },
    ]))
        out.push(chunk)
    return Buffer.concat(out)
}

/** The PAX record after the first header: "<len> path=<name>\n", <len> being its own byte count. */
function paxRecord(all: Uint8Array): { size: number; record: string } {
    const size = parseInt(new TextDecoder().decode(all.subarray(124, 135)), 8)
    return { size, record: new TextDecoder().decode(all.subarray(512, 512 + size)) }
}

describe("tar", () => {
    test("a long non-ASCII path gets a PAX record whose stated length is its byte length", async () => {
        // The path that hung a silo's backup (VelaCrew pilot): over 100 bytes and Bengali, so its
        // UTF-8 bytes and its UTF-16 length differ - the old settle loop never stopped on it.
        const name =
            "agents/marisol-1af711/workspace/projects/tenant-move-in-checklist/tasks/2622ee5c-75ca-49db-b778-e07e9ec150a2/বাড়ি ভাড়া চুক্তি.txt"
        const { size, record } = paxRecord(await archiveOf(name))
        expect(record).toBe(`${size} path=${name}\n`)
        expect(new TextEncoder().encode(record).length).toBe(size)
    })

    test("PAX lengths that cross a digit boundary still settle", async () => {
        // 49 two-byte characters + ".txt" = 102 bytes: past ustar's 100, so every name takes a PAX record.
        for (let pad = 49; pad < 520; pad += 7) {
            const name = `${"é".repeat(pad)}.txt`
            const { size, record } = paxRecord(await archiveOf(name))
            expect(record).toBe(`${size} path=${name}\n`)
        }
    })

    test("a file that grows mid-read is cut at its stated size", async () => {
        const all = await blocksWhile((path) => appendFileSync(path, "x".repeat(2000)), "hello")
        // header + one data block + the two closing blocks
        expect(all.length).toBe(512 * 4)
        expect(new TextDecoder().decode(all.subarray(512, 517))).toBe("hello")
        expect(all[517]).toBe(0)
    })

    test("a file that shrinks mid-read is padded to its stated size", async () => {
        const all = await blocksWhile((path) => truncateSync(path, 2), "x".repeat(700))
        expect(all.length).toBe(512 * 5)
        expect(all.subarray(512 + 2, 512 + 700).every((byte) => byte === 0)).toBe(true)
    })
})
