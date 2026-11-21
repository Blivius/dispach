import { evidence } from "@/lib/evidence"

/**
 * Four-column architectural overview inspired by Tesser's "Flexible by design" strip:
 * monochrome isometric/geometric SVG schematics with a single terminal accent highlight.
 */
export function FlexibleSection() {
    const pillars = [
        {
            title: "Multi-tenant silos",
            body: `Host ${evidence.agents} isolated agents in one process (${evidence.idleMiB} MiB idle RSS) with scoped bearer keys. Adopt and dispose agents over HTTP with zero restart.`,
            code: "POST /v1/agents",
            svg: (
                <svg viewBox="0 0 220 118" fill="none" className="h-28 w-full" aria-hidden="true">
                    {/* Isometric 2x2 isolated agent tiles */}
                    <g stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.2">
                        <polygon
                            points="110,12 152,32 110,52 68,32"
                            fill="currentColor"
                            fillOpacity="0.04"
                        />
                        <polygon
                            points="62,38 104,58 62,78 20,58"
                            fill="currentColor"
                            fillOpacity="0.04"
                        />
                        <polygon
                            points="158,38 200,58 158,78 116,58"
                            fill="currentColor"
                            fillOpacity="0.04"
                        />
                        <polygon
                            points="110,64 152,84 110,104 68,84"
                            fill="currentColor"
                            fillOpacity="0.04"
                        />
                    </g>
                    {/* Active highlighted silo */}
                    <polygon
                        points="110,12 152,32 110,52 68,32"
                        fill="#d75fd7"
                        fillOpacity="0.18"
                        stroke="#d75fd7"
                        strokeWidth="1.4"
                    />
                    <circle cx="110" cy="32" r="3.5" fill="#d75fd7" />
                    <circle cx="62" cy="58" r="2.5" fill="#5fd75f" />
                    <circle cx="158" cy="58" r="2.5" fill="#5f87d7" />
                    <circle cx="110" cy="84" r="2.5" fill="currentColor" fillOpacity="0.5" />
                </svg>
            ),
        },
        {
            title: "Detached turns & replay",
            body: "Every turn returns HTTP 202 and outlives the request socket. Refresh a browser or drop mobile connectivity, then reattach by turn ID over SSE or WebSocket.",
            code: "202 → stream.replay",
            svg: (
                <svg viewBox="0 0 220 118" fill="none" className="h-28 w-full" aria-hidden="true">
                    {/* Client -> detached runtime -> reattached client */}
                    <rect
                        x="18"
                        y="36"
                        width="44"
                        height="32"
                        rx="4"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1.2"
                    />
                    <line
                        x1="25"
                        y1="48"
                        x2="52"
                        y2="48"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.5"
                    />
                    <line
                        x1="25"
                        y1="56"
                        x2="44"
                        y2="56"
                        stroke="currentColor"
                        strokeOpacity="0.2"
                        strokeWidth="1.5"
                    />

                    <line
                        x1="62"
                        y1="52"
                        x2="88"
                        y2="52"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1.2"
                        strokeDasharray="3 3"
                    />

                    <rect
                        x="90"
                        y="24"
                        width="44"
                        height="56"
                        rx="6"
                        fill="#d75fd7"
                        fillOpacity="0.14"
                        stroke="#d75fd7"
                        strokeWidth="1.4"
                    />
                    <circle cx="112" cy="44" r="4" fill="#d75fd7" />
                    <line x1="100" y1="58" x2="124" y2="58" stroke="#5f87d7" strokeWidth="1.6" />
                    <line x1="100" y1="66" x2="118" y2="66" stroke="#5fd75f" strokeWidth="1.6" />

                    <line x1="134" y1="52" x2="160" y2="52" stroke="#5fd75f" strokeWidth="1.4" />
                    <polygon points="158,48 165,52 158,56" fill="#5fd75f" />

                    <rect
                        x="166"
                        y="36"
                        width="38"
                        height="32"
                        rx="4"
                        stroke="#5fd75f"
                        strokeOpacity="0.7"
                        strokeWidth="1.2"
                    />
                    <line x1="173" y1="48" x2="196" y2="48" stroke="#5fd75f" strokeWidth="1.5" />
                    <line
                        x1="173"
                        y1="56"
                        x2="190"
                        y2="56"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1.5"
                    />
                </svg>
            ),
        },
        {
            title: "Policy & containment floor",
            body: "Declarative tool policies, an untrusted-content write gate, and a hardline settings floor that refuses self-widening writes even when models try.",
            code: "0 / 167 floor breaches",
            svg: (
                <svg viewBox="0 0 220 118" fill="none" className="h-28 w-full" aria-hidden="true">
                    {/* Capability calls above, solid containment floor bar below */}
                    <rect
                        x="44"
                        y="18"
                        width="132"
                        height="36"
                        rx="5"
                        stroke="currentColor"
                        strokeOpacity="0.28"
                        strokeWidth="1.2"
                    />
                    <rect
                        x="56"
                        y="28"
                        width="30"
                        height="16"
                        rx="2"
                        fill="currentColor"
                        fillOpacity="0.08"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                    />
                    <rect
                        x="95"
                        y="28"
                        width="30"
                        height="16"
                        rx="2"
                        fill="currentColor"
                        fillOpacity="0.08"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                    />
                    <rect
                        x="134"
                        y="28"
                        width="30"
                        height="16"
                        rx="2"
                        fill="#5fd75f"
                        fillOpacity="0.16"
                        stroke="#5fd75f"
                        strokeOpacity="0.7"
                    />

                    {/* Blocked vertical probe */}
                    <line
                        x1="110"
                        y1="54"
                        x2="110"
                        y2="70"
                        stroke="#d75fd7"
                        strokeWidth="1.5"
                        strokeDasharray="2 2"
                    />
                    <line x1="103" y1="70" x2="117" y2="70" stroke="#d75fd7" strokeWidth="2" />

                    {/* Hardline floor rail */}
                    <rect x="24" y="76" width="172" height="8" rx="2" fill="#d75fd7" />
                    <line
                        x1="24"
                        y1="96"
                        x2="196"
                        y2="96"
                        stroke="currentColor"
                        strokeOpacity="0.2"
                        strokeWidth="1.2"
                    />
                </svg>
            ),
        },
        {
            title: "Model & surface agnostic",
            body: "One loop over OpenAI-compatible endpoints, AWS Bedrock, or local Ollama/vLLM. Pin native or NLT tool dialects, remote MCP servers, Composio, and channels.",
            code: "native | nlt · MCP",
            svg: (
                <svg viewBox="0 0 220 118" fill="none" className="h-28 w-full" aria-hidden="true">
                    {/* Fan-in / fan-out bus */}
                    <rect
                        x="20"
                        y="20"
                        width="36"
                        height="18"
                        rx="3"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1.2"
                    />
                    <rect
                        x="20"
                        y="50"
                        width="36"
                        height="18"
                        rx="3"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1.2"
                    />
                    <rect
                        x="20"
                        y="80"
                        width="36"
                        height="18"
                        rx="3"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="1.2"
                    />

                    <path
                        d="M56 29 H78 V59 H88 M56 59 H88 M56 89 H78 V59"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.2"
                    />

                    <rect
                        x="88"
                        y="42"
                        width="44"
                        height="34"
                        rx="5"
                        fill="#d75fd7"
                        fillOpacity="0.16"
                        stroke="#d75fd7"
                        strokeWidth="1.4"
                    />
                    <circle cx="110" cy="59" r="4" fill="#d75fd7" />

                    <path
                        d="M132 59 H142 V29 H164 M132 59 H164 M142 59 V89 H164"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.2"
                    />

                    <rect
                        x="164"
                        y="20"
                        width="36"
                        height="18"
                        rx="3"
                        stroke="#5f87d7"
                        strokeOpacity="0.7"
                        strokeWidth="1.2"
                    />
                    <rect
                        x="164"
                        y="50"
                        width="36"
                        height="18"
                        rx="3"
                        stroke="#5fd75f"
                        strokeOpacity="0.7"
                        strokeWidth="1.2"
                    />
                    <rect
                        x="164"
                        y="80"
                        width="36"
                        height="18"
                        rx="3"
                        stroke="#d7af5f"
                        strokeOpacity="0.7"
                        strokeWidth="1.2"
                    />
                </svg>
            ),
        },
    ] as const

    return (
        <section className="border-t border-fd-border px-5 py-16 sm:px-8">
            <div className="max-w-2xl">
                <p className="font-mono text-xs uppercase tracking-wider text-term-accent">
                    runtime architecture
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                    Flexible by design
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
                    Four primitives inside one TypeScript runtime—no mandatory proxy, no vector
                    database, and no network I/O before readiness.
                </p>
            </div>

            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {pillars.map((pillar) => (
                    <article
                        key={pillar.title}
                        className="flex flex-col rounded-xl border border-fd-border bg-fd-card/45 p-5 transition-colors hover:border-term-accent/45"
                    >
                        <div className="mb-5 rounded-lg border border-fd-border/70 bg-fd-background/80 p-2">
                            {pillar.svg}
                        </div>
                        <h3 className="text-base font-medium tracking-tight">{pillar.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                            {pillar.body}
                        </p>
                        <p className="mt-auto pt-4 font-mono text-[11px] text-term-accent">
                            {pillar.code}
                        </p>
                    </article>
                ))}
            </div>
        </section>
    )
}
