/**
 * Attachments from the workspace (0.2.6, VLC-431): a `file_uploadable` field is a workspace path to the
 * model, uploaded at the call, confined to the workspace.
 */

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeCache } from "../src/cache.ts"
import {
    readWorkspaceFile,
    uploadablePaths,
    uploadFiles,
    withWorkspacePaths,
} from "../src/files.ts"
import { type ComposioTool, mapTool } from "../src/map.ts"
import { ComposioProvider } from "../src/provider.ts"

const GMAIL: ComposioTool = {
    slug: "GMAIL_SEND_EMAIL",
    description: "Sends an email.",
    tags: ["gmail"],
    toolkit: { slug: "gmail" },
    input_parameters: JSON.parse(
        readFileSync(
            join(import.meta.dirname, "fixtures", "latest", "GMAIL_SEND_EMAIL.json"),
            "utf8",
        ),
    ),
}

/** An agent dir with `workspace/report.pdf`, a secret beside the workspace, and a symlink out. */
function agentDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "composio-files-"))
    mkdirSync(join(dir, "workspace", "reports"), { recursive: true })
    writeFileSync(join(dir, "workspace", "reports", "q3.pdf"), "%PDF-1.4 hello")
    writeFileSync(join(dir, "workspace", ".env"), "KEY=1")
    writeFileSync(join(dir, "agent.yaml"), "name: a")
    symlinkSync(join(dir, "agent.yaml"), join(dir, "workspace", "link.yaml"))
    return dir
}

test("the model sees a file field as a workspace path; the upload paths are found", () => {
    const spec = mapTool(GMAIL)
    const attachment = spec.parameters.properties.attachment
    expect(attachment?.type).toBe("array")
    expect(attachment?.items?.type).toBe("string")
    expect(uploadablePaths(GMAIL.input_parameters)).toEqual([["attachment"]])
    // Nothing else in the schema changed.
    const plain = withWorkspacePaths(GMAIL.input_parameters) as {
        properties: Record<string, unknown>
    }
    expect(plain.properties.recipient_email).toEqual(
        (GMAIL.input_parameters as { properties: Record<string, unknown> }).properties
            .recipient_email,
    )
})

test("a path at a file field is uploaded; a file already in storage is passed on", async () => {
    const uploaded: string[] = []
    const upload = async (path: string) => {
        uploaded.push(path)
        return { name: path, mimetype: "x/y", s3key: `k/${path}` }
    }
    const kept = { name: "a.pdf", mimetype: "application/pdf", s3key: "already" }
    const out = await uploadFiles(
        { attachment: ["one.pdf", kept, "two.pdf"], body: "hi", nested: { file: "n.txt" } },
        [["attachment"], ["nested", "file"], ["absent"]],
        upload,
    )
    expect(uploaded).toEqual(["one.pdf", "two.pdf", "n.txt"])
    expect(out).toEqual({
        attachment: [
            { name: "one.pdf", mimetype: "x/y", s3key: "k/one.pdf" },
            kept,
            { name: "two.pdf", mimetype: "x/y", s3key: "k/two.pdf" },
        ],
        body: "hi",
        nested: { file: { name: "n.txt", mimetype: "x/y", s3key: "k/n.txt" } },
    })
    // A single path where the tool takes a file or a list.
    expect(await uploadFiles({ attachment: "one.pdf" }, [["attachment"]], upload)).toEqual({
        attachment: { name: "one.pdf", mimetype: "x/y", s3key: "k/one.pdf" },
    })
})

test("only the workspace: no escape, no symlink out, no secrets, no folders", async () => {
    const dir = agentDir()
    const file = await readWorkspaceFile(dir, "reports/q3.pdf")
    expect(file.name).toBe("q3.pdf")
    expect(file.mimetype).toBe("application/pdf")
    expect(file.md5).toHaveLength(32)
    expect((await readWorkspaceFile(dir, "workspace/reports/q3.pdf")).name).toBe("q3.pdf")
    for (const [path, why] of [
        ["../agent.yaml", "outside your workspace"],
        [join(dir, "agent.yaml"), "outside your workspace"],
        ["link.yaml", "outside your workspace"],
        [".env", "holds secrets"],
        ["reports", "not a file"],
        ["missing.pdf", "no such file"],
        ["  ", "no path"],
    ] as const) {
        let error: { code?: string; message?: string } = {}
        try {
            await readWorkspaceFile(dir, path)
        } catch (caught) {
            error = caught as typeof error
        }
        expect(error.code).toBe("composio_file_refused")
        expect(error.message).toContain(why)
    }
})

test("the handler uploads the workspace file, then sends the tool its s3key", async () => {
    const dir = agentDir()
    writeCache(
        dir,
        { [GMAIL.slug]: GMAIL },
        "https://backend.composio.dev/api/v3",
        () => new Date(0),
    )
    const calls: { url: string; method?: string; body?: unknown; key?: string }[] = []
    const fetchLike = async (
        url: string,
        init?: { method?: string; body?: string | Uint8Array; headers?: Record<string, string> },
    ) => {
        calls.push({
            url,
            ...(init?.method === undefined ? {} : { method: init.method }),
            body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body?.byteLength,
            ...(init?.headers?.["x-api-key"] === undefined
                ? {}
                : { key: init.headers["x-api-key"] }),
        })
        const json = url.endsWith("/files/upload/request")
            ? { key: "gmail/up/q3.pdf", new_presigned_url: "https://storage.example/put?sig=1" }
            : { successful: true, data: { id: "m1" } }
        return new Response(url.startsWith("https://storage") ? "" : JSON.stringify(json), {
            status: 200,
        })
    }
    const p = new ComposioProvider({
        dir,
        env: { COMPOSIO_API_KEY: "test-key" },
        fetch: fetchLike,
        now: () => new Date(0),
    })
    const [tool] = await p.resolve(["GMAIL_SEND_EMAIL"])
    await tool?.handler(
        { recipient_email: "a@b.com", body: "hi", attachment: ["reports/q3.pdf"] },
        {
            agentId: "a",
            sessionKey: "s",
            turnId: "t",
            dir,
            signal: new AbortController().signal,
            deadlineMs: 120_000,
            now: () => new Date(0),
        },
    )
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://backend.composio.dev/api/v3/files/upload/request",
        "PUT https://storage.example/put?sig=1",
        "POST https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL",
    ])
    expect(calls[0]?.body).toMatchObject({
        filename: "q3.pdf",
        mimetype: "application/pdf",
        tool_slug: "GMAIL_SEND_EMAIL",
        toolkit_slug: "gmail",
    })
    // Storage's signed URL never sees the API key.
    expect(calls[1]?.key).toBeUndefined()
    expect(calls[1]?.body).toBe("%PDF-1.4 hello".length)
    expect((calls[2]?.body as { arguments?: unknown } | undefined)?.arguments).toEqual({
        recipient_email: "a@b.com",
        body: "hi",
        attachment: [{ name: "q3.pdf", mimetype: "application/pdf", s3key: "gmail/up/q3.pdf" }],
    })
})
