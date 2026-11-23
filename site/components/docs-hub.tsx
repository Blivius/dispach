import Link from "next/link"
import { benchmark, evidence } from "@/lib/evidence"
import { brand, docsRoute } from "@/lib/shared"

const RUNTIME_PATHS = [
    {
        code: "01",
        title: "Install & serve",
        desc: `Install via npm or the standalone curl bundle and reach /v1/ready in under ${evidence.bootCiFailMs} ms.`,
        href: `${docsRoute}/runtime/quickstart/install-and-serve`,
    },
    {
        code: "02",
        title: "Run with Docker",
        desc: "Boot the container with a single token: web console, API, and /docs on one origin.",
        href: `${docsRoute}/runtime/quickstart/run-with-docker`,
    },
    {
        code: "03",
        title: "Send & stream a turn",
        desc: "Start a detached HTTP 202 turn with an idempotency key and stream events over SSE.",
        href: `${docsRoute}/runtime/quickstart/send-and-stream-a-turn`,
    },
    {
        code: "04",
        title: `HTTP API (${evidence.endpoints} routes)`,
        desc: "Every request, response, and error schema generated from the live Zod contracts.",
        href: `${docsRoute}/reference`,
    },
] as const

const API_STARTERS = [
    {
        method: "POST",
        path: "/v1/agents/{id}/messages",
        note: "Start a detached turn (202)",
    },
    {
        method: "GET",
        path: "/v1/agents/{id}/turns/{turnId}/stream",
        note: "Stream & replay events over SSE",
    },
    {
        method: "GET",
        path: "/v1/agents/{id}/turns/{turnId}",
        note: "Read authoritative turn state",
    },
    {
        method: "POST",
        path: "/v1/keys",
        note: "Mint a scoped bearer key",
    },
] as const

export function RuntimeDocsHub() {
    const sonnet = benchmark.sonnet
    return (
        <div className="not-prose mb-10 space-y-5">
            <div className="rounded-xl border border-fd-border bg-fd-card/60 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-term-accent">
                        <span className="font-medium">{brand.name}</span>
                        <span className="border-l border-fd-border pl-2">v{evidence.version}</span>
                        <span className="border-l border-fd-border pl-2">Apache-2.0</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-fd-muted-foreground">
                        <span>{evidence.bootMs} ms boot</span>
                        <span className="border-l border-fd-border pl-2">
                            {evidence.memoryMedianMs} ms memory
                        </span>
                        {sonnet ? (
                            <span className="border-l border-fd-border pl-2">
                                {sonnet.runtime.pass}/{sonnet.runtime.n} ({sonnet.name}, $
                                {sonnet.runtime.cost.toFixed(2)})
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="mt-3 overflow-x-auto rounded-lg border border-fd-border bg-fd-background px-3 py-2 font-mono text-xs text-fd-foreground">
                    <span className="mr-2 select-none text-term-accent">›</span>
                    npm install --global {brand.slug} &amp;&amp; {brand.slug} init &amp;&amp;{" "}
                    {brand.slug} serve
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {RUNTIME_PATHS.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className="group flex flex-col rounded-xl border border-fd-border bg-fd-card/45 p-4 transition-colors hover:border-term-accent/60 hover:bg-fd-card"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-term-accent">{item.code}</span>
                            <span className="font-mono text-xs text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-term-accent">
                                →
                            </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-fd-foreground">
                            {item.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-fd-muted-foreground">
                            {item.desc}
                        </p>
                    </Link>
                ))}
            </div>
        </div>
    )
}

export function ReferenceDocsHub() {
    return (
        <div className="not-prose mb-8 grid gap-2.5 sm:grid-cols-2">
            {API_STARTERS.map((ep) => (
                <div
                    key={ep.path}
                    className="rounded-xl border border-fd-border bg-fd-card/50 px-3.5 py-3"
                >
                    <div className="flex items-center gap-2 font-mono text-xs">
                        <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                ep.method === "POST"
                                    ? "bg-term-accent/20 text-term-accent"
                                    : "bg-term-info/20 text-term-info"
                            }`}
                        >
                            {ep.method}
                        </span>
                        <span className="truncate text-fd-foreground">{ep.path}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-fd-muted-foreground">{ep.note}</p>
                </div>
            ))}
        </div>
    )
}
