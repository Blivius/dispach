import Link from "next/link"
import { ArchitectureBand } from "@/components/architecture-band"
import { BenchmarkTable } from "@/components/benchmark-table"
import { FaqSection } from "@/components/faq-section"
import { FlexibleSection } from "@/components/flexible-section"
import { HeroConsole } from "@/components/hero-console"
import { type InstallOption, InstallTabs } from "@/components/install-tabs"
import { RuntimeShowcase } from "@/components/runtime-showcase"
import { SiteFooter } from "@/components/site-footer"
import { benchmark, evidence } from "@/lib/evidence"
import { capturedAt, capturedModel, replay } from "@/lib/replay"
import {
    brand,
    dockerImage,
    docsRoute,
    paperUrl,
    parentCompany,
    repoUrl,
    siteUrl,
} from "@/lib/shared"

const QUICKSTART = "/docs/runtime/quickstart/install-and-serve"
const BENCHMARK = "/docs/runtime/benchmarks"
const { hermes, openclaw } = benchmark.rivals

const INSTALL_OPTIONS: readonly InstallOption[] = [
    {
        id: "npm",
        label: "npm",
        command: `npm install --global ${brand.slug}`,
        note: `Node ${evidence.node}+`,
    },
    {
        id: "curl",
        label: "curl",
        command: `curl -fsSL ${siteUrl}/install.sh | sh`,
        note: "no Node needed",
    },
    {
        id: "brew",
        label: "Homebrew",
        command: `brew install blivius/tap/${brand.slug}`,
        note: "macOS and Linux",
    },
    {
        id: "docker",
        label: "Docker",
        command: `docker run -d --init -p 7420:7420 -v ${brand.slug}-home:/home/${brand.slug} -e ${brand.envPrefix}API_TOKEN=secret ${dockerImage}:${evidence.version}`,
        note: "multi-arch image",
    },
    {
        id: "sdk",
        label: "Client SDK",
        command: `npm install ${brand.slug}`,
        note: "typed TS client",
    },
]

export default function HomePage() {
    const sonnet = benchmark.sonnet
    const headlineStats = [
        {
            figure: sonnet
                ? `${sonnet.runtime.pass}/${sonnet.runtime.n}`
                : `${benchmark.perfect}/${benchmark.rows.length}`,
            label: sonnet
                ? `${sonnet.name} for $${sonnet.runtime.cost.toFixed(2)}; ${openclaw.name} cost $${sonnet.openclaw.cost.toFixed(2)}`
                : "Perfect multi-turn harness runs",
            href: BENCHMARK,
        },
        {
            figure: `${evidence.bootMs} ms`,
            label: "Process start to ready, before any network I/O",
            href: "/evals",
        },
        {
            figure: `${evidence.idleMiB} MiB`,
            label: `${evidence.agents} idle agents in one process`,
            href: "/evals",
        },
        {
            figure: "0 / 167",
            label: "Protected writes saved under the settings floor",
            href: paperUrl,
        },
    ] as const

    return (
        <main className="flex flex-1 flex-col">
            <div className="mx-auto w-full max-w-6xl border-x border-fd-border/70">
                {/* Hero */}
                <section className="relative px-5 pt-12 pb-16 sm:px-8 lg:pt-20 lg:pb-20">
                    <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_1.08fr]">
                        <div className="min-w-0">
                            <Link
                                href={`${docsRoute}/runtime/whats-new-since-0-2-0`}
                                className="inline-flex flex-wrap items-center gap-2 rounded-full border border-fd-border bg-fd-card/80 px-3 py-1 text-xs text-fd-muted-foreground transition-colors hover:border-term-accent/60 hover:text-fd-foreground"
                            >
                                <span className="font-mono text-fd-foreground">
                                    v{evidence.version}
                                </span>
                                <span className="border-l border-fd-border pl-2">Apache-2.0</span>
                                <span className="border-l border-fd-border pl-2">
                                    {evidence.endpoints} OpenAPI 3.1 endpoints
                                </span>
                            </Link>

                            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance [overflow-wrap:break-word] sm:text-5xl lg:text-[3.5rem] lg:leading-[1.05]">
                                The agent backend your product calls over HTTP.
                            </h1>

                            <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
                                Memory, policy-gated tools, schedules and detached streams, on any
                                OpenAI-compatible model or AWS Bedrock.
                            </p>

                            <div className="mt-7 flex flex-wrap items-center gap-3">
                                <Link
                                    href={QUICKSTART}
                                    className="whitespace-nowrap rounded-lg bg-term-accent px-4 py-2.5 text-sm font-medium text-neutral-950 transition-[filter,background-color] hover:brightness-110"
                                >
                                    Run it in five minutes
                                </Link>
                                <Link
                                    href={`${docsRoute}/reference`}
                                    className="whitespace-nowrap rounded-lg border border-fd-border bg-fd-card/60 px-4 py-2.5 text-sm font-medium transition-colors hover:border-term-accent/50 hover:bg-fd-accent"
                                >
                                    API reference
                                </Link>
                                <a
                                    href={parentCompany.designPartnerHref}
                                    className="whitespace-nowrap px-2 py-2 text-sm text-fd-muted-foreground underline-offset-4 hover:text-fd-foreground hover:underline"
                                >
                                    Design partners
                                </a>
                            </div>

                            <InstallTabs options={INSTALL_OPTIONS} />
                        </div>

                        <HeroConsole
                            brandName={brand.name}
                            brandSlug={brand.slug}
                            lines={replay}
                            caption={`Recorded ${capturedAt} (${capturedModel})`}
                        />
                    </div>
                </section>

                {/* Proof rail: each figure links to the file or paper it comes from */}
                <section aria-label="Measured figures" className="border-t border-fd-border">
                    <div className="grid divide-y divide-fd-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
                        {headlineStats.map((stat, index) => (
                            <a
                                key={stat.label}
                                href={stat.href}
                                className={`group block px-5 py-7 transition-colors hover:bg-fd-card/60 sm:px-6 ${
                                    index > 0 ? "lg:border-l lg:border-fd-border" : ""
                                } ${index % 2 === 1 ? "sm:border-l sm:border-fd-border" : ""} ${
                                    index >= 2
                                        ? "sm:border-t sm:border-fd-border lg:border-t-0"
                                        : ""
                                }`}
                            >
                                <p className="font-mono text-3xl font-semibold tracking-tight text-term-accent">
                                    {stat.figure}
                                </p>
                                <p className="mt-2 text-sm leading-snug text-fd-muted-foreground group-hover:text-fd-foreground">
                                    {stat.label}
                                </p>
                            </a>
                        ))}
                    </div>
                    <p className="border-t border-fd-border px-5 py-3 text-sm text-fd-muted-foreground sm:px-6">
                        Every public claim has a row in the{" "}
                        <Link
                            href="/evals"
                            className="underline underline-offset-4 hover:text-fd-foreground"
                        >
                            claim register
                        </Link>
                        , negative results included.
                    </p>
                </section>

                {/* Tesser-inspired Flexible by Design */}
                <FlexibleSection />

                {/* Interactive Head-to-Head Benchmarks */}
                <BenchmarkTable
                    brandName={brand.name}
                    commit={benchmark.commit}
                    runs={benchmark.runs}
                    tasks={benchmark.tasks}
                    repeats={benchmark.repeats}
                    atLeastHermes={benchmark.atLeastHermes}
                    cheapest={benchmark.cheapest}
                    openclawLast={benchmark.openclawLast}
                    hermesName={hermes.name}
                    hermesVersion={hermes.version}
                    openclawName={openclaw.name}
                    openclawVersion={openclaw.version}
                    rows={benchmark.rows}
                    benchmarkHref={BENCHMARK}
                />

                {/* Architecture & Built-in primitives */}
                <ArchitectureBand />

                {/* Real recorded terminal demos */}
                <RuntimeShowcase />

                {/* Honest Open-Core & Deployment Comparison */}
                <section className="border-t border-fd-border bg-fd-card/30 px-5 py-20 sm:px-8 lg:py-28">
                    <div className="max-w-2xl">
                        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                            Run it yourself today. Partner with us for managed scale.
                        </h2>
                        <p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
                            Nothing is withheld from the runtime to force an upgrade. The
                            open-source boundary sits where the architecture already puts it.
                        </p>
                    </div>

                    <div className="mt-8 grid gap-6 lg:grid-cols-2">
                        <article className="flex flex-col rounded-2xl border border-fd-border bg-fd-background/80 p-6">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-term-success">
                                    Available today
                                </span>
                                <span className="rounded-md border border-fd-border px-2 py-0.5 text-xs text-fd-muted-foreground">
                                    Apache-2.0
                                </span>
                            </div>
                            <h3 className="mt-3 text-xl font-semibold tracking-tight">
                                Self-hosted runtime
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                                One process hosts many agents on your own servers, containers, or
                                Kubernetes cluster, with zero telemetry and no gateway requirement.
                            </p>
                            <ul className="mt-5 list-disc space-y-2 pl-5 text-sm text-fd-muted-foreground marker:text-fd-border">
                                <li>
                                    Full HTTP, SSE and WebSocket API ({evidence.endpoints} OpenAPI
                                    3.1 routes) and a typed client
                                </li>
                                <li>
                                    SQLite FTS5 memory, five-stage compaction, the policy and
                                    settings floor
                                </li>
                                <li>
                                    Built-in browser console, interactive TUI, Docker and Kubernetes
                                    manifests
                                </li>
                            </ul>
                            <div className="mt-auto flex flex-wrap gap-3 pt-6">
                                <Link
                                    href={QUICKSTART}
                                    className="whitespace-nowrap rounded-lg bg-term-accent px-4 py-2 text-sm font-medium text-neutral-950 hover:brightness-110"
                                >
                                    Install and serve
                                </Link>
                                <a
                                    href={repoUrl}
                                    className="whitespace-nowrap rounded-lg border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
                                >
                                    View source
                                </a>
                            </div>
                        </article>

                        <article className="flex flex-col rounded-2xl border border-fd-border bg-fd-background/80 p-6">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-term-warning">
                                    Seeking design partners
                                </span>
                                <span className="rounded-md border border-fd-border px-2 py-0.5 text-xs text-fd-muted-foreground">
                                    FSL-1.1 / Managed
                                </span>
                            </div>
                            <h3 className="mt-3 text-xl font-semibold tracking-tight">
                                Control plane and managed infrastructure
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                                For teams operating isolated agent silos per user or team. There is
                                no hosted cloud GA yet. We are partnering directly with engineering
                                teams building production agent products.
                            </p>
                            <ul className="mt-5 list-disc space-y-2 pl-5 text-sm text-fd-muted-foreground marker:text-fd-border">
                                <li>
                                    Per-user and per-team silo placement, suspend and wake, backups
                                    (<code>packages/control</code>)
                                </li>
                                <li>
                                    Experimental in {evidence.line}: multiplayer rooms, stand-ins,
                                    and shared team memory
                                </li>
                                <li>
                                    Upcoming: managed hosting, observability, audit logs, and
                                    private deployments
                                </li>
                            </ul>
                            <div className="mt-auto flex flex-wrap gap-3 pt-6">
                                <a
                                    href={parentCompany.designPartnerHref}
                                    className="whitespace-nowrap rounded-lg border border-term-accent/70 bg-term-accent/15 px-4 py-2 text-sm font-medium text-fd-foreground hover:bg-term-accent/25"
                                >
                                    Become a design partner
                                </a>
                                <Link
                                    href={`${docsRoute}/control-plane`}
                                    className="whitespace-nowrap rounded-lg border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
                                >
                                    Control plane docs
                                </Link>
                            </div>
                        </article>
                    </div>
                </section>
                {/* Tesser-inspired 2-column hairline FAQ accordion */}
                <FaqSection />
            </div>

            <SiteFooter />
        </main>
    )
}
