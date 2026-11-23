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
import { brand, dockerImage, docsRoute, paperUrl, parentCompany, repoUrl } from "@/lib/shared"
import { pixels } from "@/lib/wordmark"

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
        command: `curl -fsSL ${repoUrl}/releases/latest/download/install.sh | sh`,
        note: "no Node needed",
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

const PROOFS = [
    {
        figure: `${benchmark.perfect} of ${benchmark.rows.length}`,
        title: `Models at ${benchmark.runs}/${benchmark.runs}, head-to-head`,
        body: `On ${benchmark.tasks} multi-turn tool tasks run ${benchmark.repeats} times each, ${brand.name} matches or beats ${hermes.name} on ${benchmark.atLeastHermes} of ${benchmark.rows.length} models and costs the least of three harnesses on ${benchmark.cheapest}.`,
        caveat: `One benchmark of our own design, each harness on its own defaults. ${hermes.name} leads on ${new Intl.ListFormat("en").format(benchmark.hermesAhead)}.`,
        href: BENCHMARK,
        link: "Benchmarks",
    },
    {
        figure: "202",
        title: "Turns outlive the client",
        body: "A turn is detached from the request that started it. Drop the connection, reattach from any client, and its events replay from the start, token by token when the send asked for chunks.",
        caveat: "The recording above is that, unedited apart from shortened request bodies.",
        href: "/docs/runtime/concepts/turn-lifecycle",
        link: "Turn lifecycle",
    },
    {
        figure: `${evidence.bootMs} ms`,
        title: "Process start to ready",
        body: "No network I/O before readiness, by rule. Channels and remote catalogues connect afterwards and report status as events.",
        caveat: `Median of ${evidence.bootRuns} boots under ${evidence.bootRuntime}, ${evidence.bootMachine}. Boot, not response latency. CI fails above ${evidence.bootCiFailMs.toLocaleString("en-US")} ms.`,
        href: "/evals",
        link: "Evidence",
    },
    {
        figure: `${evidence.idleMiB} MiB`,
        title: `${evidence.agents} agents, one process`,
        body: "One runtime hosts many agents, and scoped keys fence each off. Adopt and remove agents live, with no restart.",
        caveat: "Idle resident memory, linux/arm64 image, one machine.",
        href: "/evals",
        link: "Evidence",
    },
] as const

export default function HomePage() {
    const sonnet = benchmark.sonnet
    const headlineStats = [
        {
            figure: sonnet
                ? `${sonnet.runtime.pass}/${sonnet.runtime.n}`
                : `${benchmark.perfect}/${benchmark.rows.length}`,
            label: sonnet
                ? `$${sonnet.runtime.cost.toFixed(2)} on ${sonnet.name} vs. ${openclaw.name} $${sonnet.openclaw.cost.toFixed(2)}`
                : "Perfect multi-turn harness runs",
        },
        {
            figure: `${evidence.bootMs} ms`,
            label: "Boot to runtime.ready, zero network I/O",
        },
        {
            figure: `${evidence.idleMiB} MiB`,
            label: `${evidence.agents} isolated agents in one idle process`,
        },
        {
            figure: "0 / 167",
            label: "Protected writes saved under containment floor",
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
                                <span className="size-1.5 rounded-full bg-term-success" />
                                <span className="font-mono text-fd-foreground">
                                    v{evidence.version}
                                </span>
                                <span className="border-l border-fd-border pl-2">Apache-2.0</span>
                                <span className="border-l border-fd-border pl-2">
                                    {evidence.endpoints} OpenAPI 3.1 endpoints
                                </span>
                            </Link>

                            <svg
                                role="img"
                                aria-label={brand.name}
                                viewBox={`0 0 ${pixels.width} ${pixels.height}`}
                                className="mt-6 mb-5 h-9 w-auto text-term-accent sm:h-11"
                                shapeRendering="crispEdges"
                            >
                                {pixels.cells.map(({ x, y }) => (
                                    <rect
                                        key={`${x}:${y}`}
                                        x={x}
                                        y={y}
                                        width={1}
                                        height={1}
                                        fill="currentColor"
                                    />
                                ))}
                            </svg>

                            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                                The agent backend your product calls over HTTP.
                            </h1>

                            <p className="mt-4 max-w-xl text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
                                <span className="font-serif text-[1.12em] italic text-fd-foreground">
                                    The harness is not just scaffolding.
                                </span>{" "}
                                It decides whether agents finish tasks, what inference costs, and
                                what your application controls. Persistent memory, policy-gated
                                tools, schedules, and detached streams on any OpenAI-compatible
                                model or AWS Bedrock.
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

                {/* Headline proof rail */}
                <section
                    aria-label="Key measured metrics"
                    className="grid divide-y divide-fd-border border-t border-fd-border bg-fd-card/35 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4"
                >
                    {headlineStats.map((stat, index) => (
                        <div
                            key={stat.label}
                            className={`px-5 py-6 sm:px-6 ${
                                index > 0 ? "lg:border-l lg:border-fd-border" : ""
                            } ${index % 2 === 1 ? "sm:border-l sm:border-fd-border" : ""} ${
                                index >= 2 ? "sm:border-t sm:border-fd-border lg:border-t-0" : ""
                            }`}
                        >
                            <p className="font-mono text-2xl font-semibold tracking-tight text-term-accent">
                                {stat.figure}
                            </p>
                            <p className="mt-1.5 text-xs leading-relaxed text-fd-muted-foreground">
                                {stat.label}
                            </p>
                        </div>
                    ))}
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
                    sonnet={benchmark.sonnet}
                    benchmarkHref={BENCHMARK}
                />

                {/* Architecture & Built-in primitives */}
                <ArchitectureBand />

                {/* Real recorded terminal demos */}
                <RuntimeShowcase />

                {/* Proof cards with transparent caveats */}
                <section className="border-t border-fd-border px-5 py-16 sm:px-8">
                    <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                        Every number traced to a committed file
                    </h2>
                    <div className="mt-8 grid gap-4 sm:grid-cols-2">
                        {PROOFS.map((p) => (
                            <article
                                key={p.title}
                                className="flex flex-col rounded-2xl border border-fd-border bg-fd-card/40 p-6 transition-colors hover:border-term-accent/55"
                            >
                                <p className="font-mono text-3xl font-semibold">{p.figure}</p>
                                <h3 className="mt-2 font-medium">{p.title}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                                    {p.body}
                                </p>
                                <p className="mt-3 text-xs text-fd-muted-foreground/80">
                                    {p.caveat}
                                </p>
                                <Link
                                    href={p.href}
                                    className="mt-auto pt-4 text-sm font-medium text-term-accent underline-offset-4 hover:underline"
                                >
                                    {p.link}
                                </Link>
                            </article>
                        ))}
                    </div>
                    <p className="mt-6 text-sm text-fd-muted-foreground">
                        Research:{" "}
                        <a href={paperUrl} className="underline underline-offset-4">
                            What May an Agent Change About Itself?
                        </a>{" "}
                        (Hossain &amp; Mahmud, 2026, arXiv 2610.06274, preprint). Every public claim
                        has a row in the{" "}
                        <Link href="/evals" className="underline underline-offset-4">
                            claim register
                        </Link>
                        , negative results included.
                    </p>
                </section>

                {/* Honest Open-Core & Deployment Comparison */}
                <section className="border-t border-fd-border bg-fd-card/30 px-5 py-16 sm:px-8">
                    <div className="max-w-2xl">
                        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
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
                            <ul className="mt-5 space-y-2 text-sm text-fd-muted-foreground">
                                <li>
                                    <span className="mr-2 font-mono text-term-success">✓</span>
                                    Full HTTP/SSE/WS API ({evidence.endpoints} OpenAPI 3.1 routes) +
                                    typed client
                                </li>
                                <li>
                                    <span className="mr-2 font-mono text-term-success">✓</span>
                                    SQLite FTS5 memory, 5-stage compaction, policy &amp; settings
                                    floor
                                </li>
                                <li>
                                    <span className="mr-2 font-mono text-term-success">✓</span>
                                    Built-in browser console, interactive TUI, Docker &amp; K8s
                                    manifests
                                </li>
                            </ul>
                            <div className="mt-auto flex flex-wrap gap-3 pt-6">
                                <Link
                                    href={QUICKSTART}
                                    className="whitespace-nowrap rounded-lg bg-term-accent px-4 py-2 text-sm font-medium text-neutral-950 hover:brightness-110"
                                >
                                    Install &amp; serve
                                </Link>
                                <a
                                    href={repoUrl}
                                    className="whitespace-nowrap rounded-lg border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
                                >
                                    View source
                                </a>
                            </div>
                        </article>

                        <article className="flex flex-col rounded-2xl border border-dashed border-term-accent/50 bg-fd-background/80 p-6">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-term-warning">
                                    Seeking design partners
                                </span>
                                <span className="rounded-md border border-fd-border px-2 py-0.5 text-xs text-fd-muted-foreground">
                                    FSL-1.1 / Managed
                                </span>
                            </div>
                            <h3 className="mt-3 text-xl font-semibold tracking-tight">
                                Control plane &amp; managed infrastructure
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                                For teams operating isolated agent silos per user or team. There is
                                no hosted cloud GA yet. We are partnering directly with engineering
                                teams building production agent products.
                            </p>
                            <ul className="mt-5 space-y-2 text-sm text-fd-muted-foreground">
                                <li>
                                    <span className="mr-2 font-mono text-term-accent">›</span>
                                    Per-user &amp; per-team silo placement, suspend/wake, and
                                    backups (<code>packages/control</code>)
                                </li>
                                <li>
                                    <span className="mr-2 font-mono text-term-accent">›</span>
                                    Experimental in {evidence.line}: multiplayer rooms, stand-ins,
                                    and shared team memory
                                </li>
                                <li>
                                    <span className="mr-2 font-mono text-term-accent">›</span>
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
