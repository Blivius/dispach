import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Metadata } from "next"
import { SiteFooter } from "@/components/site-footer"
import { brand, repoUrl } from "@/lib/shared"

interface Claim {
    section: string
    claim: string
    evidence: string
    scope: string
    limitation: string
    status: string
    files: string[]
}
interface Eval {
    name: string
    title: string
    results: string[]
    measuredAt?: string
}

/** Written by `bun run evals:index` and held current by `docs:check` in CI. */
const feed = JSON.parse(readFileSync(join(process.cwd(), "..", "evals", "index.json"), "utf8")) as {
    claims: Claim[]
    evals: Eval[]
}

export const metadata: Metadata = {
    title: `Evals · ${brand.name}`,
    description: `Every number ${brand.name} states in public, with the file it comes from.`,
}

const STATUS_STYLE: Record<string, string> = {
    verified: "bg-green-500/15 text-green-700 dark:text-green-400",
    cite: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "needs-run": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    remove: "bg-fd-muted text-fd-muted-foreground line-through",
}

function Status({ status }: { status: string }) {
    const key = Object.keys(STATUS_STYLE).find((k) => status.startsWith(k)) ?? "remove"
    return (
        <span
            className={`whitespace-nowrap rounded px-2 py-0.5 font-mono text-xs font-medium ${STATUS_STYLE[key]}`}
        >
            {status}
        </span>
    )
}

function slugId(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
}

/** The register writes evidence as Markdown; links and code spans are the only syntax it uses. */
function Evidence({ text }: { text: string }) {
    const parts = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
    let offset = 0
    return (
        <>
            {parts.map((part) => {
                // A part's offset in the text is its identity: unique, and stable across renders.
                const key = offset
                offset += part.length
                const code = part.match(/^`([^`]+)`$/)
                if (code?.[1]) {
                    const file = code[1].replace(/:\d+$/, "")
                    return /\.(json|ts|yml|md)$/.test(file) ? (
                        <a
                            key={key}
                            href={`${repoUrl}/-/blob/main/${file}`}
                            className="font-mono text-xs underline underline-offset-4 hover:text-term-accent"
                        >
                            {code[1]}
                        </a>
                    ) : (
                        <code key={key}>{code[1]}</code>
                    )
                }
                const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
                if (link)
                    return (
                        <a
                            key={key}
                            href={link[2]}
                            className="underline underline-offset-4 hover:text-term-accent"
                        >
                            {link[1]}
                        </a>
                    )
                return <span key={key}>{part.replace(/\*\*/g, "")}</span>
            })}
        </>
    )
}

export default function EvalsPage() {
    const sections = [...new Set(feed.claims.map((c) => c.section))]
    const count = (s: string) => feed.claims.filter((c) => c.status.startsWith(s)).length

    const summaryPills = [
        { label: "Total claims", value: feed.claims.length, tone: "text-fd-foreground" },
        { label: "Verified", value: count("verified"), tone: "text-green-600 dark:text-green-400" },
        { label: "Cited", value: count("cite"), tone: "text-blue-600 dark:text-blue-400" },
        {
            label: "Waiting on run",
            value: count("needs-run"),
            tone: "text-amber-600 dark:text-amber-400",
        },
        { label: "Withdrawn", value: count("remove"), tone: "text-fd-muted-foreground" },
    ] as const

    return (
        <main className="flex flex-1 flex-col">
            <div className="mx-auto w-full max-w-5xl border-x border-fd-border/70 px-5 py-12 sm:px-8">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Evaluations</h1>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
                    Every number {brand.name} states in public has a row here naming the committed
                    file it comes from. Negative results are listed beside the positive ones, and a
                    claim without evidence is marked as such rather than left out. CI fails when a
                    verified claim&apos;s file goes missing.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {summaryPills.map((pill) => (
                        <div
                            key={pill.label}
                            className="rounded-xl border border-fd-border bg-fd-card/50 px-3.5 py-3"
                        >
                            <p className={`font-mono text-xl font-semibold ${pill.tone}`}>
                                {pill.value}
                            </p>
                            <p className="mt-0.5 text-xs text-fd-muted-foreground">{pill.label}</p>
                        </div>
                    ))}
                </div>

                <nav
                    aria-label="Claim sections"
                    className="mt-6 flex flex-wrap gap-2 border-y border-fd-border py-3 font-mono text-xs"
                >
                    {sections.map((section) => (
                        <a
                            key={section}
                            href={`#${slugId(section)}`}
                            className="rounded-md border border-fd-border bg-fd-card/40 px-2.5 py-1 text-fd-muted-foreground transition-colors hover:border-term-accent/60 hover:text-fd-foreground"
                        >
                            {section}
                        </a>
                    ))}
                </nav>

                {sections.map((section) => (
                    <section key={section} id={slugId(section)} className="mt-10 scroll-mt-20">
                        <h2 className="text-xl font-semibold tracking-tight">{section}</h2>
                        <ul className="mt-4 divide-y divide-fd-border rounded-xl border border-fd-border bg-fd-card/30 px-4">
                            {feed.claims
                                .filter((c) => c.section === section)
                                .map((c) => (
                                    <li key={c.claim} className="py-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-medium">
                                                <Evidence text={c.claim} />
                                            </p>
                                            <Status status={c.status} />
                                        </div>
                                        <p className="mt-1 text-sm">
                                            <Evidence text={c.evidence} />
                                        </p>
                                        {c.limitation !== "" && c.limitation !== "—" && (
                                            <p className="mt-1 text-sm text-fd-muted-foreground">
                                                <Evidence text={c.limitation} />
                                            </p>
                                        )}
                                    </li>
                                ))}
                        </ul>
                    </section>
                ))}

                <section className="mt-12">
                    <h2 className="text-xl font-semibold tracking-tight">Eval suites</h2>
                    <ul className="mt-4 divide-y divide-fd-border rounded-xl border border-fd-border bg-fd-card/30 px-4 text-sm">
                        {feed.evals.map((e) => (
                            <li
                                key={e.name}
                                className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                            >
                                <a
                                    href={`${repoUrl}/-/tree/main/evals/${e.name}`}
                                    className="font-mono underline underline-offset-4 hover:text-term-accent"
                                >
                                    {e.name}
                                </a>
                                <span className="flex-1 text-fd-muted-foreground">{e.title}</span>
                                <span className="font-mono text-xs text-fd-muted-foreground">
                                    {e.results.length === 0
                                        ? "no committed results"
                                        : `measured ${e.measuredAt?.slice(0, 10) ?? "date not recorded"}`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
            <SiteFooter />
        </main>
    )
}
