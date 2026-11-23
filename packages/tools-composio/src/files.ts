/**
 * Files a Composio tool takes, from the agent's own workspace (0.2.6, VLC-431).
 *
 * Composio marks such a field `file_uploadable: true`: an object `{name, mimetype, s3key}` whose
 * `s3key` names a file already in Composio's storage. A model cannot produce one, so an email with an
 * attachment could not be sent. Here:
 *   - the model sees each such field as a workspace path (`withWorkspacePaths`);
 *   - at the call, each path is read inside the workspace and uploaded (`POST /files/upload/request`,
 *     then a PUT to the signed URL the answer carries), and the path is replaced by the object the tool
 *     expects (`uploadFiles`). An object that already carries an `s3key` (a file an earlier action
 *     downloaded) is passed on unchanged.
 *
 * **Confined to the workspace** (`<agentDir>/workspace`, the agent's own dir when there is none),
 * checked on the real path, so a symlink cannot send a file from elsewhere, and never a `.env`.
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { ToolError } from "@dispach/core"

type Raw = Readonly<Record<string, unknown>>

/** Gmail's whole-message ceiling; larger files fail there anyway, after an upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const PATH_NOTE =
    "A file from your workspace, written as its path (for example reports/q3.pdf); it is uploaded for you."

function asRecord(value: unknown): Raw | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Raw)
        : undefined
}

/** A node Composio fills from its own file storage. */
function isUploadable(node: Raw): boolean {
    return node.file_uploadable === true
}

/**
 * The schema with every uploadable object as a path. Local `$ref`s are followed in place so a
 * referenced file field is caught too; a cycle is left as it was.
 */
export function withWorkspacePaths(schema: Raw | undefined): Raw | undefined {
    if (schema === undefined) return undefined
    const visit = (value: unknown, seen: ReadonlySet<string>): unknown => {
        if (Array.isArray(value)) return value.map((item) => visit(item, seen))
        const node = asRecord(value)
        if (node === undefined) return value
        if (isUploadable(node)) {
            const own = typeof node.description === "string" ? `${node.description.trim()} ` : ""
            return { type: "string", description: `${own}${PATH_NOTE}` }
        }
        if (typeof node.$ref === "string" && !seen.has(node.$ref)) {
            const target = resolveRef(schema, node.$ref)
            if (target !== undefined && containsUploadable(target, new Set([node.$ref]))) {
                const { $ref: _ref, ...rest } = node
                return visit({ ...target, ...rest }, new Set([...seen, node.$ref]))
            }
        }
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v, seen)]))
    }
    const containsUploadable = (value: unknown, seen: ReadonlySet<string>): boolean => {
        if (Array.isArray(value)) return value.some((item) => containsUploadable(item, seen))
        const node = asRecord(value)
        if (node === undefined) return false
        if (isUploadable(node)) return true
        if (typeof node.$ref === "string" && !seen.has(node.$ref)) {
            const target = resolveRef(schema, node.$ref)
            return target !== undefined && containsUploadable(target, new Set([...seen, node.$ref]))
        }
        return Object.values(node).some((child) => containsUploadable(child, seen))
    }
    return visit(schema, new Set()) as Raw
}

function resolveRef(root: Raw, ref: string): Raw | undefined {
    if (!ref.startsWith("#/")) return undefined
    let at: unknown = root
    for (const part of ref.slice(2).split("/")) at = asRecord(at)?.[part]
    return asRecord(at)
}

/**
 * Where in the arguments a file goes: `["attachment"]`, `["files", "[]"]`, `["data", "file"]`.
 * A field that is a file or a list of them in different options is one path; `uploadFiles` takes
 * either shape at it.
 */
export function uploadablePaths(schema: Raw | undefined): readonly (readonly string[])[] {
    if (schema === undefined) return []
    const out = new Map<string, readonly string[]>()
    const walk = (node: Raw, path: readonly string[], seen: ReadonlySet<string>): void => {
        if (isUploadable(node)) {
            // `[]` steps are dropped: a list where a file is, or a file where a list is, is handled
            // by `uploadFiles` either way.
            const at = path.filter((step) => step !== "[]")
            out.set(at.join("."), at)
            return
        }
        if (typeof node.$ref === "string" && !seen.has(node.$ref)) {
            const target = resolveRef(schema, node.$ref)
            if (target !== undefined) walk(target, path, new Set([...seen, node.$ref]))
        }
        for (const key of ["anyOf", "oneOf", "allOf"]) {
            const options = node[key]
            if (Array.isArray(options)) {
                for (const option of options) {
                    const record = asRecord(option)
                    if (record !== undefined) walk(record, path, seen)
                }
            }
        }
        const items = asRecord(node.items)
        if (items !== undefined) walk(items, [...path, "[]"], seen)
        for (const [name, child] of Object.entries(asRecord(node.properties) ?? {})) {
            const record = asRecord(child)
            if (record !== undefined) walk(record, [...path, name], seen)
        }
    }
    walk(schema, [], new Set())
    return [...out.values()]
}

/** What `uploadFile` sends. */
export interface WorkspaceFile {
    readonly name: string
    readonly mimetype: string
    readonly bytes: Uint8Array
    readonly md5: string
}

const MIME: Readonly<Record<string, string>> = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".xml": "application/xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ics": "text/calendar",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
}

function fileRefused(path: string, why: string, hint: string): ToolError {
    return new ToolError({
        code: "composio_file_refused",
        message: `The file "${path}" cannot be attached: ${why}`,
        hint,
    })
}

const inside = (root: string, path: string) => {
    const rel = relative(root, path)
    return rel === "" ? false : !rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith(sep)
}

/** A workspace file, read for upload. `dir` is the agent's own directory. */
export async function readWorkspaceFile(dir: string, given: string): Promise<WorkspaceFile> {
    const workspace = existsSync(join(dir, "workspace")) ? join(dir, "workspace") : dir
    const root = await realpath(workspace)
    const wanted = given.trim().replace(/^workspace\//, "")
    const hint = "Attach a file from your own workspace, by its path, e.g. reports/q3.pdf."
    if (wanted === "") throw fileRefused(given, "no path was given.", hint)
    const path = isAbsolute(wanted) ? resolve(wanted) : resolve(root, wanted)
    let real: string
    try {
        real = await realpath(path)
    } catch {
        throw fileRefused(given, "there is no such file in your workspace.", hint)
    }
    if (!inside(root, real)) throw fileRefused(given, "it is outside your workspace.", hint)
    const name = basename(real)
    if (/^\.env/i.test(name)) throw fileRefused(given, "it holds secrets.", hint)
    const info = await stat(real)
    if (!info.isFile()) throw fileRefused(given, "it is not a file.", hint)
    if (info.size > MAX_UPLOAD_BYTES) {
        throw fileRefused(
            given,
            `it is ${Math.ceil(info.size / 1048576)} MB, over the ${MAX_UPLOAD_BYTES / 1048576} MB limit.`,
            "Share a link to it instead, or send a smaller file.",
        )
    }
    const bytes = new Uint8Array(await readFile(real))
    return {
        name,
        mimetype: MIME[extname(name).toLowerCase()] ?? "application/octet-stream",
        bytes,
        md5: createHash("md5").update(bytes).digest("hex"),
    }
}

export type FileUploader = (path: string) => Promise<Raw>

/**
 * The arguments with every workspace path at a file field replaced by what `upload` returns. A file
 * already in Composio (an object with an `s3key`) is left as given; so is a field the call left out.
 */
export async function uploadFiles(
    args: Raw,
    paths: readonly (readonly string[])[],
    upload: FileUploader,
): Promise<Raw> {
    const place = async (value: unknown, rest: readonly string[]): Promise<unknown> => {
        if (Array.isArray(value)) return Promise.all(value.map((item) => place(item, rest)))
        if (rest.length === 0) return typeof value === "string" ? upload(value) : value
        const record = asRecord(value)
        const [head, ...tail] = rest
        if (record === undefined || head === undefined || !(head in record)) return value
        return { ...record, [head]: await place(record[head], tail) }
    }
    let out: unknown = args
    for (const path of paths) out = await place(out, path)
    return out as Raw
}
