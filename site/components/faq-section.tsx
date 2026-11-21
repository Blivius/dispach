"use client"

import Link from "next/link"
import { useState } from "react"
import { benchmark, evidence } from "@/lib/evidence"
import { brand, docsRoute, paperUrl, parentCompany } from "@/lib/shared"

interface FaqItem {
    question: string
    plainAnswer: string
    render: () => React.ReactNode
}

export function FaqSection() {
    const [openIndex, setOpenIndex] = useState<number | null>(null)
    const sonnet = benchmark.sonnet
    const { openclaw } = benchmark.rivals

    const items: readonly FaqItem[] = [
        {
            question: `How is ${brand.name} different from agent frameworks like LangGraph, CrewAI, or ${openclaw.name}?`,
            plainAnswer: `${brand.name} is a long-running HTTP agent runtime rather than an orchestration library embedded inside your web app. Your product calls it over OpenAPI 3.1 HTTP, SSE, or WebSockets while ${brand.name} owns detached turns, SQLite FTS5 memory, schedules, policy gates, and tool execution. On our ${benchmark.runs}-run ${sonnet?.name ?? "Claude Sonnet 5.5"} benchmark, ${brand.name} completed ${sonnet ? `${sonnet.runtime.pass}/${sonnet.runtime.n} tasks at $${sonnet.runtime.cost.toFixed(2)} versus ${openclaw.name}'s ${sonnet.openclaw.pass}/${sonnet.openclaw.n} at $${sonnet.openclaw.cost.toFixed(2)}` : `${benchmark.perfect} of ${benchmark.rows.length} models at ${benchmark.runs}/${benchmark.runs}`}.`,
            render: () => (
                <>
                    {brand.name} is a long-running HTTP runtime, not a library embedded inside your
                    web process. Your product calls it over{" "}
                    <Link
                        href={`${docsRoute}/reference`}
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        {evidence.endpoints} OpenAPI 3.1 endpoints
                    </Link>{" "}
                    while {brand.name} handles detached turns, SQLite FTS5 memory, schedules, policy
                    gates, and tool execution.{" "}
                    {sonnet ? (
                        <>
                            On our {benchmark.runs}-run {sonnet.name} benchmark, it finished{" "}
                            {sonnet.runtime.pass}/{sonnet.runtime.n} tasks at $
                            {sonnet.runtime.cost.toFixed(2)} versus {openclaw.name}&apos;s{" "}
                            {sonnet.openclaw.pass}/{sonnet.openclaw.n} at $
                            {sonnet.openclaw.cost.toFixed(2)} (
                            <Link
                                href={`${docsRoute}/runtime/benchmarks`}
                                className="underline underline-offset-4 hover:text-fd-foreground"
                            >
                                full benchmarks
                            </Link>
                            ).
                        </>
                    ) : null}
                </>
            ),
        },
        {
            question: "What is Apache-2.0 open source, and what is source-available or managed?",
            plainAnswer: `The entire self-hosted runtime is Apache-2.0: HTTP, SSE, and WebSocket APIs, multi-tenant agents, SQLite FTS5 memory, policies, schedules, channels, TUI, and browser console, with no telemetry and no artificial limits. The multi-site control plane (packages/control) is licensed under FSL-1.1-ALv2 (converting to Apache-2.0 after two years), and managed hosting is being built with design partners.`,
            render: () => (
                <>
                    The full self-hosted runtime is <strong>Apache-2.0</strong>: HTTP/SSE/WebSocket
                    APIs, multi-tenant silos, SQLite FTS5 memory, policies, schedules, channels,
                    TUI, and browser console, with zero telemetry and no artificial caps. The
                    multi-site control plane (<code>packages/control</code>,{" "}
                    <Link
                        href={`${docsRoute}/control-plane`}
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        docs
                    </Link>
                    ) is licensed under FSL-1.1-ALv2 (converting to Apache-2.0 after two years), and
                    managed hosting is being built with{" "}
                    <a
                        href={parentCompany.designPartnerHref}
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        design partners
                    </a>
                    .
                </>
            ),
        },
        {
            question: "Does any telemetry, prompt, or workspace data leave my infrastructure?",
            plainAnswer:
                "No. The self-hosted runtime collects zero usage telemetry and performs zero network I/O before reaching runtime.ready. Outbound traffic goes strictly to the model providers and remote MCP servers you explicitly configure.",
            render: () => (
                <>
                    No. The self-hosted runtime sends zero usage telemetry and performs zero network
                    I/O before reaching <code>runtime.ready</code>. The only outbound requests go to
                    the model endpoints (OpenAI-compatible APIs, AWS Bedrock, or local Ollama/vLLM)
                    and remote MCP servers you explicitly configure.
                </>
            ),
        },
        {
            question:
                "Can I switch models or run open-weight local models without rewriting agents?",
            plainAnswer: `Yes. One loop speaks OpenAI-compatible endpoints and AWS Bedrock, and lets you pin native tool calling or the natural-language tool (nlt) dialect per agent. Our published benchmarks evaluate ${benchmark.rows.length} frontier and open-weight models across Anthropic, OpenAI, Google, DeepSeek, GLM, Kimi, Gemma, Qwen, and GPT-OSS.`,
            render: () => (
                <>
                    Yes. One runtime loop speaks OpenAI-compatible endpoints and AWS Bedrock, and
                    lets you pin native tool calling or the natural-language tool (<code>nlt</code>)
                    dialect per agent. Our{" "}
                    <Link
                        href={`${docsRoute}/runtime/benchmarks`}
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        published benchmarks
                    </Link>{" "}
                    cover {benchmark.rows.length} frontier and open-weight models with the exact
                    harness configuration committed.
                </>
            ),
        },
        {
            question: "How does the containment floor stop agents from weakening their own rules?",
            plainAnswer: `${brand.name} separates capability settings (tools, MCP servers, skills) from protected security invariants (workspace.writeRoots, tools.policy.deny, untrusted-content write gates). Protected writes are refused below configuration before touching disk: 0 of 167 protected writes saved across evaluation, even when models attempted one in 65 cases.`,
            render: () => (
                <>
                    {brand.name} separates capability settings (tools, MCP servers, skills) from
                    protected invariants (<code>workspace.writeRoots</code>,{" "}
                    <code>tools.policy.deny</code>, untrusted-content write gates). Protected writes
                    are refused beneath configuration before touching disk: 0 of 167 protected
                    writes saved across evaluation (
                    <a
                        href={paperUrl}
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        arXiv 2610.06274
                    </a>
                    ).
                </>
            ),
        },
        {
            question: "What happens if a client disconnects mid-turn or a browser tab refreshes?",
            plainAnswer:
                "Every turn returns HTTP 202 and executes detached from the request socket. Any authorized client can reattach by turn ID over SSE or WebSocket and replay the event stream from sequence 0 without re-running tools or losing state.",
            render: () => (
                <>
                    Every send returns <code>HTTP 202</code> and executes detached from the request
                    socket. Refresh a browser or drop mobile connectivity, then reattach by turn ID
                    over SSE or WebSocket to replay the event stream from sequence 0 without
                    re-running tools (
                    <Link
                        href={`${docsRoute}/runtime/concepts/turn-lifecycle`}
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        turn lifecycle
                    </Link>
                    ).
                </>
            ),
        },
        {
            question: "Do I need Postgres, Redis, or a vector database to run it in production?",
            plainAnswer: `No. A single process boots in ${evidence.bootMs} ms median with embedded SQLite and FTS5 + BM25 lexical recall (${evidence.memoryMedianMs} ms median over ${evidence.memoryPassages.toLocaleString("en-US")} passages) and hosts ${evidence.agents} idle isolated agents in ${evidence.idleMiB} MiB RSS. Deploy via npm, standalone curl binary, Docker, or Kubernetes.`,
            render: () => (
                <>
                    No. One process boots in {evidence.bootMs} ms median with embedded SQLite and
                    FTS5 + BM25 lexical recall ({evidence.memoryMedianMs} ms median over{" "}
                    {evidence.memoryPassages.toLocaleString("en-US")} passages) and hosts{" "}
                    {evidence.agents} isolated idle agents in {evidence.idleMiB} MiB RSS. Deploy via{" "}
                    <code>npm</code>, standalone <code>curl</code> install, Docker, or Kubernetes (
                    <Link
                        href="/evals"
                        className="underline underline-offset-4 hover:text-fd-foreground"
                    >
                        claim register
                    </Link>
                    ).
                </>
            ),
        },
    ]

    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: {
                "@type": "Answer",
                text: item.plainAnswer,
            },
        })),
    }

    return (
        <section
            id="faq"
            aria-labelledby="faq-heading"
            className="border-t border-fd-border px-5 py-16 sm:px-8"
        >
            <script
                type="application/ld+json"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: static build-time JSON-LD schema
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />

            <div className="grid gap-10 lg:grid-cols-[0.82fr_1.45fr] lg:items-start">
                <div className="lg:sticky lg:top-24">
                    <p className="font-mono text-xs uppercase tracking-wider text-term-accent">
                        questions
                    </p>
                    <h2
                        id="faq-heading"
                        className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
                    >
                        Frequently asked questions
                    </h2>
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-fd-muted-foreground">
                        Technical answers for teams self-hosting today or exploring managed agent
                        infrastructure. Still have a question?{" "}
                        <Link
                            href={docsRoute}
                            className="text-fd-foreground underline underline-offset-4 hover:text-term-accent"
                        >
                            Read the docs
                        </Link>{" "}
                        or write to{" "}
                        <a
                            href={parentCompany.designPartnerHref}
                            className="text-fd-foreground underline underline-offset-4 hover:text-term-accent"
                        >
                            {parentCompany.email}
                        </a>
                        .
                    </p>
                </div>

                <div className="divide-y divide-fd-border border-y border-fd-border">
                    {items.map((item, index) => {
                        const isOpen = openIndex === index
                        const panelId = `faq-panel-${index}`
                        return (
                            <div key={item.question}>
                                <h3>
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        aria-controls={panelId}
                                        onClick={() => setOpenIndex(isOpen ? null : index)}
                                        className="group flex w-full items-start gap-4 py-5 text-left transition-colors hover:text-fd-foreground"
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center font-mono text-base leading-none text-fd-muted-foreground transition-transform duration-200 group-hover:text-term-accent ${
                                                isOpen ? "rotate-45 text-term-accent" : ""
                                            }`}
                                        >
                                            +
                                        </span>
                                        <span className="text-base font-medium tracking-tight text-fd-foreground">
                                            {item.question}
                                        </span>
                                    </button>
                                </h3>
                                <div
                                    id={panelId}
                                    className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                                        isOpen
                                            ? "grid-rows-[1fr] opacity-100"
                                            : "grid-rows-[0fr] opacity-0"
                                    }`}
                                >
                                    <div className="overflow-hidden">
                                        <p className="pb-5 pl-9 text-sm leading-relaxed text-fd-muted-foreground [&_code]:rounded [&_code]:bg-fd-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_code]:text-fd-foreground">
                                            {item.render()}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </section>
    )
}
