import { evidence } from "@/lib/evidence"
import { paperUrl } from "@/lib/shared"

/**
 * What the runtime handles around the model call, as one ruled list. It replaces two grids that said
 * overlapping things (four drawn schematics, then six cards): ten items, one line each, the real API
 * name beside the ones that have one. Hairlines, not cards, so the section reads as a list.
 */
const CAPABILITIES = [
    {
        term: "Many agents, one process",
        detail: `${evidence.agents} isolated agents idle in ${evidence.idleMiB} MiB, each fenced by a scoped key, added live.`,
        code: "POST /v1/agents",
    },
    {
        term: "Turns that outlive the client",
        detail: (
            <>
                A send returns 202; any client{" "}
                <a
                    href="/docs/runtime/concepts/turn-lifecycle"
                    className="underline underline-offset-4 hover:text-term-accent"
                >
                    reattaches to the turn
                </a>{" "}
                by its id.
            </>
        ),
        code: "stream.replay",
    },
    {
        term: "A policy and a floor",
        detail: (
            <>
                Policy decides which tools run;{" "}
                <a href={paperUrl} className="underline underline-offset-4 hover:text-term-accent">
                    a settings floor
                </a>{" "}
                refuses any widening the agent tries.
            </>
        ),
        code: "tools.policy",
    },
    {
        term: "Any model",
        detail: "OpenAI-compatible endpoints, AWS Bedrock or local Ollama, with native or NLT tool calls.",
        code: "native, nlt",
    },
    {
        term: "Sessions",
        detail: "Every conversation persists in SQLite, keyed the way your product keys users.",
    },
    {
        term: "Lexical memory",
        detail: `FTS5 and BM25 recall in ${evidence.memoryMedianMs} ms over ${evidence.memoryPassages.toLocaleString("en-US")} passages, with no vector store.`,
    },
    {
        term: "Tools",
        detail: "Shell, files, web, remote MCP servers and Composio.",
        code: "MCP",
    },
    {
        term: "Schedules",
        detail: "Cron, interval and one-shot jobs, DST-correct, sent through the same idempotent outbox.",
    },
    {
        term: "Channels and console",
        detail: "Telegram and WhatsApp; Slack, Teams and A2A experimental; a web console on the same origin.",
    },
    {
        term: "Approvals and keys",
        detail: "Human approval gates over the wire; keys scoped to an agent, a capability set or an expiry.",
    },
] as const

export function FlexibleSection() {
    return (
        <section className="border-t border-fd-border px-5 py-20 sm:px-8 lg:py-28">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Everything around the model call, already wired
            </h2>
            <dl className="mt-12 grid gap-x-12 sm:grid-cols-2">
                {CAPABILITIES.map((item) => (
                    <div key={item.term} className="border-t border-fd-border py-5">
                        <dt className="flex items-baseline justify-between gap-4">
                            <span className="font-medium text-fd-foreground">{item.term}</span>
                            {"code" in item && (
                                <code className="shrink-0 text-xs text-term-accent">
                                    {item.code}
                                </code>
                            )}
                        </dt>
                        <dd className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-fd-muted-foreground">
                            {item.detail}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    )
}
