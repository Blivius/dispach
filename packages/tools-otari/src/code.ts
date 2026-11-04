/**
 * `run_code` — Python in Otari's sandbox, through its direct `POST /code/execute`.
 *
 * Runtime-owned: Dispach decides the call is made and sees exactly what ran and what it printed. No
 * second model sits between the agent and the interpreter, which the in-loop `otari_code_execution`
 * tool would add. "A policy decides whether, a sandbox decides where": `run_code` is an ordinary
 * tool to the policy engine, and the place the code runs is Otari's container, never this machine.
 *
 * One sandbox per session. The first call asks for `container: "auto"`, Otari names the container in
 * `Otari-Container-Id`, and later calls in that session run in it again, so variables and files
 * carry like a notebook. A container Otari has expired is dropped and the call runs once in a fresh
 * one, saying so, because a model that expects yesterday's variables should be told they are gone.
 */

import type { Tool, ToolContext } from "@dispach/core"
import { type OtariClient, post } from "./client.ts"
import { OTARI_TOOLS_PROVIDER_ID } from "./paths.ts"

/** Otari's own ceiling when the workspace sets none. */
const DEFAULT_TIMEOUT_S = 60
/** Long enough for a traceback, short enough to fit the observation budget. */
const STREAM_CHARS = 6_000
const GONE = /has expired or does not exist/

export const CODE_SPEC: Tool["spec"] = {
    slug: "run_code",
    provider: OTARI_TOOLS_PROVIDER_ID,
    summary:
        "Runs Python in a remote sandbox and returns what it printed. State carries between calls in this conversation.",
    whenToUse:
        "you need an exact answer a calculation, a parse or a small program gives — arithmetic, dates, statistics, transforming data you have, checking that code works",
    whenNotToUse:
        "the answer is a fact rather than a computation; you want to touch this machine's files or run a shell command, which this sandbox cannot reach",
    // The sandbox can reach the network, so a call is an action rather than a read. Serialised and
    // never retried; `policy.allow` it when the turn may run code more than once.
    mutating: true,
    trust: "untrusted",
    tags: ["code", "sandbox", "otari"],
    parameters: {
        type: "object",
        properties: {
            code: {
                type: "string",
                description:
                    "Python 3 source. Print what you want to see: only stdout and stderr come back. Variables and files from earlier calls in this conversation are still there.",
            },
        },
        required: ["code"],
    },
}

interface ExecuteResult {
    readonly stdout?: unknown
    readonly stderr?: unknown
    readonly return_code?: unknown
    readonly files?: readonly { readonly filename?: unknown; readonly path?: unknown }[]
}

export function codeTool(client: OtariClient): Tool {
    // ponytail: one map per agent, never pruned. Bounded by the sessions one process sees; evict by
    // last use if a long-lived host shows it growing.
    const containers = new Map<string, string>()

    const execute = async (code: string, context: ToolContext) => {
        const held = containers.get(context.sessionKey)
        const posted = await post(
            client,
            "/code/execute",
            {
                code,
                container: held ?? "auto",
                timeout_seconds: DEFAULT_TIMEOUT_S,
            },
            context,
            (DEFAULT_TIMEOUT_S + 15) * 1000,
        )
        const id = posted.headers.get("otari-container-id")
        if (id !== null && id !== "") containers.set(context.sessionKey, id)
        return posted.body as ExecuteResult
    }

    return {
        spec: CODE_SPEC,
        handler: async (args, context) => {
            const code = String(args.code ?? "")
            if (code.trim() === "") {
                return "No code was given, so nothing ran. Call this again with the Python to run."
            }
            let restarted = false
            let result: ExecuteResult
            try {
                result = await execute(code, context)
            } catch (error) {
                if (!(error instanceof Error) || !GONE.test(error.message)) throw error
                containers.delete(context.sessionKey)
                restarted = true
                result = await execute(code, context)
            }
            context.meter?.({
                provider: "otari",
                operation: "code_execution",
                unit: "requests",
                units: 1,
            })
            return render(result, restarted)
        },
    }
}

export function render(result: ExecuteResult, restarted: boolean): string {
    const stdout = clip(typeof result.stdout === "string" ? result.stdout : "")
    const stderr = clip(typeof result.stderr === "string" ? result.stderr : "")
    const code = typeof result.return_code === "number" ? result.return_code : undefined
    const files = (result.files ?? [])
        .map((file) => String(file.filename ?? file.path ?? ""))
        .filter((name) => name !== "")
    return [
        ...(restarted
            ? [
                  "The earlier sandbox had expired, so this ran in a fresh one: variables and files from before are gone.",
              ]
            : []),
        code === undefined ? "exit status: not reported" : `exit status: ${code}`,
        stdout === "" ? "stdout: (empty)" : `stdout:\n${stdout}`,
        ...(stderr === "" ? [] : [`stderr:\n${stderr}`]),
        ...(files.length === 0 ? [] : [`files written: ${files.join(", ")}`]),
    ].join("\n")
}

function clip(text: string): string {
    const trimmed = text.replace(/\s+$/, "")
    return trimmed.length > STREAM_CHARS
        ? `${trimmed.slice(0, STREAM_CHARS)}\n… (${trimmed.length - STREAM_CHARS} more characters cut)`
        : trimmed
}
