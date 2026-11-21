import { evidence } from "@/lib/evidence"

/**
 * Four-column architectural schematic strip with frameless, softly animated vector diagrams.
 * Every SVG declares explicit width/height + viewBox + currentColor inheritance so it renders
 * crisply across light/dark themes and all browsers, while pausing cleanly under reduced motion.
 */
export function FlexibleSection() {
    const pillars = [
        {
            title: "Multi-tenant silos",
            body: `Host ${evidence.agents} isolated agents in one process (${evidence.idleMiB} MiB idle RSS) with scoped bearer keys. Adopt and dispose agents over HTTP with zero restart.`,
            code: "POST /v1/agents",
            svg: (
                <svg
                    width={240}
                    height={128}
                    viewBox="0 0 240 128"
                    preserveAspectRatio="xMidYMid meet"
                    fill="none"
                    className="block h-32 w-full text-fd-foreground transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden="true"
                >
                    {/* Subtle architectural floor grid */}
                    <g stroke="currentColor" strokeOpacity="0.12" strokeWidth="1">
                        <path d="M120 12 L212 58 L120 104 L28 58 Z" />
                        <path d="M74 35 L166 81 M166 35 L74 81" />
                    </g>

                    {/* Three peer isolated agent silos */}
                    <g stroke="currentColor" strokeOpacity="0.42" strokeWidth="1.25">
                        <polygon
                            points="68,42 112,64 68,86 24,64"
                            fill="currentColor"
                            fillOpacity="0.06"
                        />
                        <polygon
                            points="172,42 216,64 172,86 128,64"
                            fill="currentColor"
                            fillOpacity="0.06"
                        />
                        <polygon
                            points="120,68 164,90 120,112 76,90"
                            fill="currentColor"
                            fillOpacity="0.06"
                        />
                    </g>

                    {/* Subtle depth edges under peer tiles */}
                    <g stroke="currentColor" strokeOpacity="0.24" strokeWidth="1">
                        <path d="M24 64 v5 L68 91 L112 69 v-5" />
                        <path d="M128 64 v5 L172 91 L216 69 v-5" />
                        <path d="M76 90 v5 L120 117 L164 95 v-5" />
                    </g>

                    {/* Active elevated magenta silo */}
                    <g className="anim-flex-float">
                        <path
                            d="M76 38 v6 L120 66 L164 44 v-6"
                            fill="#d75fd7"
                            fillOpacity="0.12"
                            stroke="#d75fd7"
                            strokeOpacity="0.55"
                            strokeWidth="1.1"
                        />
                        <polygon
                            points="120,16 164,38 120,60 76,38"
                            fill="#d75fd7"
                            fillOpacity="0.22"
                            stroke="#d75fd7"
                            strokeWidth="1.5"
                        />
                        <circle
                            cx="120"
                            cy="38"
                            r="3.8"
                            fill="#d75fd7"
                            className="anim-flex-pulse"
                        />
                    </g>

                    {/* Independent peer heartbeat nodes */}
                    <circle
                        cx="68"
                        cy="64"
                        r="2.8"
                        fill="#5fd75f"
                        className="anim-flex-pulse"
                        style={{ animationDelay: "0.7s" }}
                    />
                    <circle
                        cx="172"
                        cy="64"
                        r="2.8"
                        fill="#5f87d7"
                        className="anim-flex-pulse"
                        style={{ animationDelay: "1.4s" }}
                    />
                    <circle
                        cx="120"
                        cy="90"
                        r="2.8"
                        fill="currentColor"
                        fillOpacity="0.65"
                        className="anim-flex-pulse"
                        style={{ animationDelay: "2.1s" }}
                    />
                </svg>
            ),
        },
        {
            title: "Detached turns & replay",
            body: "Every turn returns HTTP 202 and outlives the request socket. Refresh a browser or drop mobile connectivity, then reattach by turn ID over SSE or WebSocket.",
            code: "202 → stream.replay",
            svg: (
                <svg
                    width={240}
                    height={128}
                    viewBox="0 0 240 128"
                    preserveAspectRatio="xMidYMid meet"
                    fill="none"
                    className="block h-32 w-full text-fd-foreground transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden="true"
                >
                    {/* Subtle reference rail */}
                    <line
                        x1="14"
                        y1="106"
                        x2="226"
                        y2="106"
                        stroke="currentColor"
                        strokeOpacity="0.14"
                        strokeWidth="1"
                    />

                    {/* Disconnecting client */}
                    <rect
                        x="16"
                        y="42"
                        width="46"
                        height="36"
                        rx="5"
                        fill="currentColor"
                        fillOpacity="0.04"
                        stroke="currentColor"
                        strokeOpacity="0.45"
                        strokeWidth="1.25"
                    />
                    <line
                        x1="24"
                        y1="56"
                        x2="53"
                        y2="56"
                        stroke="currentColor"
                        strokeOpacity="0.42"
                        strokeWidth="1.5"
                    />
                    <line
                        x1="24"
                        y1="65"
                        x2="44"
                        y2="65"
                        stroke="currentColor"
                        strokeOpacity="0.28"
                        strokeWidth="1.5"
                    />

                    {/* Animated request packet dash */}
                    <line
                        x1="64"
                        y1="60"
                        x2="94"
                        y2="60"
                        stroke="currentColor"
                        strokeOpacity="0.55"
                        strokeWidth="1.4"
                        strokeDasharray="4 5"
                        className="anim-flex-dash"
                    />

                    {/* Persistent detached runtime buffer */}
                    <rect
                        x="96"
                        y="28"
                        width="48"
                        height="64"
                        rx="6"
                        fill="#d75fd7"
                        fillOpacity="0.16"
                        stroke="#d75fd7"
                        strokeWidth="1.5"
                    />
                    <circle cx="120" cy="48" r="4.2" fill="#d75fd7" className="anim-flex-pulse" />
                    <line
                        x1="107"
                        y1="64"
                        x2="133"
                        y2="64"
                        stroke="#5f87d7"
                        strokeWidth="1.8"
                        strokeDasharray="10 4"
                        className="anim-flex-dash-slow"
                    />
                    <line
                        x1="107"
                        y1="74"
                        x2="127"
                        y2="74"
                        stroke="#5fd75f"
                        strokeWidth="1.8"
                        strokeDasharray="8 4"
                        className="anim-flex-dash-slow"
                        style={{ animationDelay: "0.8s" }}
                    />

                    {/* Animated green replay stream */}
                    <line
                        x1="146"
                        y1="60"
                        x2="174"
                        y2="60"
                        stroke="#5fd75f"
                        strokeWidth="1.6"
                        strokeDasharray="5 4"
                        className="anim-flex-dash"
                    />
                    <polygon points="171,56 179,60 171,64" fill="#5fd75f" />

                    {/* Reattached client */}
                    <rect
                        x="180"
                        y="42"
                        width="44"
                        height="36"
                        rx="5"
                        fill="#5fd75f"
                        fillOpacity="0.08"
                        stroke="#5fd75f"
                        strokeOpacity="0.82"
                        strokeWidth="1.35"
                    />
                    <line x1="188" y1="56" x2="215" y2="56" stroke="#5fd75f" strokeWidth="1.6" />
                    <line
                        x1="188"
                        y1="65"
                        x2="208"
                        y2="65"
                        stroke="currentColor"
                        strokeOpacity="0.45"
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
                <svg
                    width={240}
                    height={128}
                    viewBox="0 0 240 128"
                    preserveAspectRatio="xMidYMid meet"
                    fill="none"
                    className="block h-32 w-full text-fd-foreground transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden="true"
                >
                    {/* Upper open capability plane */}
                    <rect
                        x="46"
                        y="18"
                        width="148"
                        height="40"
                        rx="6"
                        fill="currentColor"
                        fillOpacity="0.04"
                        stroke="currentColor"
                        strokeOpacity="0.42"
                        strokeWidth="1.25"
                    />
                    <rect
                        x="58"
                        y="29"
                        width="34"
                        height="18"
                        rx="3"
                        fill="currentColor"
                        fillOpacity="0.08"
                        stroke="currentColor"
                        strokeOpacity="0.42"
                    />
                    <rect
                        x="103"
                        y="29"
                        width="34"
                        height="18"
                        rx="3"
                        fill="currentColor"
                        fillOpacity="0.08"
                        stroke="currentColor"
                        strokeOpacity="0.42"
                    />
                    <rect
                        x="148"
                        y="29"
                        width="34"
                        height="18"
                        rx="3"
                        fill="#5fd75f"
                        fillOpacity="0.2"
                        stroke="#5fd75f"
                        strokeOpacity="0.82"
                        className="anim-flex-pulse"
                    />

                    {/* Animated probe attempting to cross the floor */}
                    <line
                        x1="120"
                        y1="58"
                        x2="120"
                        y2="78"
                        stroke="#d75fd7"
                        strokeWidth="1.6"
                        strokeDasharray="3 3"
                        className="anim-flex-dash-slow"
                    />

                    {/* Hard refusal stop cap */}
                    <line
                        x1="108"
                        y1="78"
                        x2="132"
                        y2="78"
                        stroke="#d75fd7"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        className="anim-flex-shield"
                    />

                    {/* Hardline containment floor bar */}
                    <rect x="24" y="85" width="192" height="9" rx="2.5" fill="#d75fd7" />

                    {/* Protected invariants beneath the floor */}
                    <line
                        x1="36"
                        y1="106"
                        x2="204"
                        y2="106"
                        stroke="currentColor"
                        strokeOpacity="0.28"
                        strokeWidth="1.2"
                    />
                    <line
                        x1="64"
                        y1="114"
                        x2="176"
                        y2="114"
                        stroke="currentColor"
                        strokeOpacity="0.18"
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
                <svg
                    width={240}
                    height={128}
                    viewBox="0 0 240 128"
                    preserveAspectRatio="xMidYMid meet"
                    fill="none"
                    className="block h-32 w-full text-fd-foreground transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden="true"
                >
                    {/* Left upstream provider nodes */}
                    <g
                        fill="currentColor"
                        fillOpacity="0.05"
                        stroke="currentColor"
                        strokeOpacity="0.45"
                        strokeWidth="1.25"
                    >
                        <rect x="18" y="20" width="40" height="20" rx="3.5" />
                        <rect x="18" y="54" width="40" height="20" rx="3.5" />
                        <rect x="18" y="88" width="40" height="20" rx="3.5" />
                    </g>

                    {/* Base bus traces */}
                    <path
                        d="M58 30 H82 V64 H94 M58 64 H94 M58 98 H82 V64"
                        stroke="currentColor"
                        strokeOpacity="0.26"
                        strokeWidth="1.25"
                    />
                    {/* Animated fan-in signal overlay */}
                    <path
                        d="M58 30 H82 V64 H94 M58 64 H94 M58 98 H82 V64"
                        stroke="#d75fd7"
                        strokeOpacity="0.72"
                        strokeWidth="1.4"
                        strokeDasharray="4 14"
                        className="anim-flex-dash"
                    />

                    {/* Central runtime loop hub */}
                    <rect
                        x="94"
                        y="44"
                        width="52"
                        height="40"
                        rx="6"
                        fill="#d75fd7"
                        fillOpacity="0.18"
                        stroke="#d75fd7"
                        strokeWidth="1.5"
                    />
                    <circle cx="120" cy="64" r="4.5" fill="#d75fd7" className="anim-flex-pulse" />

                    {/* Base fan-out traces */}
                    <path
                        d="M146 64 H158 V30 H182 M146 64 H182 M158 64 V98 H182"
                        stroke="currentColor"
                        strokeOpacity="0.26"
                        strokeWidth="1.25"
                    />
                    {/* Animated fan-out signal overlay */}
                    <path
                        d="M146 64 H158 V30 H182 M146 64 H182 M158 64 V98 H182"
                        stroke="#5fd75f"
                        strokeOpacity="0.75"
                        strokeWidth="1.4"
                        strokeDasharray="4 14"
                        className="anim-flex-dash"
                        style={{ animationDelay: "0.9s" }}
                    />

                    {/* Right downstream surface adapters */}
                    <rect
                        x="182"
                        y="20"
                        width="40"
                        height="20"
                        rx="3.5"
                        fill="#5f87d7"
                        fillOpacity="0.1"
                        stroke="#5f87d7"
                        strokeOpacity="0.8"
                        strokeWidth="1.3"
                    />
                    <rect
                        x="182"
                        y="54"
                        width="40"
                        height="20"
                        rx="3.5"
                        fill="#5fd75f"
                        fillOpacity="0.1"
                        stroke="#5fd75f"
                        strokeOpacity="0.8"
                        strokeWidth="1.3"
                    />
                    <rect
                        x="182"
                        y="88"
                        width="40"
                        height="20"
                        rx="3.5"
                        fill="#d7af5f"
                        fillOpacity="0.1"
                        stroke="#d7af5f"
                        strokeOpacity="0.8"
                        strokeWidth="1.3"
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
                    Built for real agent workloads
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
                    Four runtime primitives in one process, with zero proxy, zero vector DB, and
                    zero network I/O before ready.
                </p>
            </div>

            <div className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
                {pillars.map((pillar) => (
                    <article key={pillar.title} className="group flex flex-col">
                        <div className="mb-6 flex items-center justify-center py-2">
                            {pillar.svg}
                        </div>
                        <h3 className="text-base font-semibold tracking-tight text-fd-foreground">
                            {pillar.title}
                        </h3>
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
