import Link from "next/link"
import { docsRoute } from "@/lib/shared"

export function ArchitectureBand() {
    return (
        <section className="border-t border-fd-border">
            {/* Alternating architectural deep-dive: Context prefix & 5-stage compaction */}
            <div className="grid items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:py-28">
                <div>
                    <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                        Cache-stable context and five-stage compaction
                    </h2>
                    <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-fd-muted-foreground">
                        Identity and pinned tools stay frozen in slots 0 and 1, so the prompt prefix
                        keeps its cache. Knowledge enters by keyword, and compaction starts at 60%
                        instead of one lossy cut at 95%.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-5 text-sm font-medium">
                        <Link
                            href={`${docsRoute}/runtime/concepts/architecture`}
                            className="text-term-accent underline-offset-4 hover:underline"
                        >
                            Read architecture
                        </Link>
                        <Link
                            href={`${docsRoute}/runtime/guides/workspaces-and-memory`}
                            className="text-fd-muted-foreground underline-offset-4 hover:text-fd-foreground hover:underline"
                        >
                            Workspaces and memory
                        </Link>
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/60 p-4 sm:p-5">
                    <svg
                        viewBox="0 0 560 212"
                        fill="none"
                        className="h-auto w-full"
                        role="img"
                        aria-label="Context assembly pipeline: fixed cache-stable slots 0 and 1, volatile history, tool step loop, and five-stage compaction ladder"
                    >
                        {/* Top row: Context assembly slots */}
                        <text
                            x="12"
                            y="18"
                            fill="currentColor"
                            fillOpacity="0.55"
                            fontSize="10"
                            fontFamily="monospace"
                        >
                            Context assembly, in fixed slot order
                        </text>

                        <rect
                            x="12"
                            y="28"
                            width="144"
                            height="54"
                            rx="6"
                            fill="#d75fd7"
                            fillOpacity="0.14"
                            stroke="#d75fd7"
                            strokeWidth="1.2"
                        />
                        <text
                            x="24"
                            y="48"
                            fill="#d75fd7"
                            fontSize="10"
                            fontFamily="monospace"
                            fontWeight="600"
                        >
                            Slots 0, 1 pinned
                        </text>
                        <text x="24" y="65" fill="currentColor" fillOpacity="0.82" fontSize="11">
                            SOUL, AGENTS, Tools
                        </text>

                        <line
                            x1="156"
                            y1="55"
                            x2="176"
                            y2="55"
                            stroke="currentColor"
                            strokeOpacity="0.35"
                            strokeWidth="1.2"
                        />
                        <polygon
                            points="175,51 182,55 175,59"
                            fill="currentColor"
                            fillOpacity="0.5"
                        />

                        <rect
                            x="184"
                            y="28"
                            width="166"
                            height="54"
                            rx="6"
                            fill="currentColor"
                            fillOpacity="0.04"
                            stroke="currentColor"
                            strokeOpacity="0.24"
                            strokeWidth="1.2"
                        />
                        <text
                            x="196"
                            y="48"
                            fill="#5f87d7"
                            fontSize="10"
                            fontFamily="monospace"
                            fontWeight="600"
                        >
                            Tier 2, 3 (budgeted)
                        </text>
                        <text x="196" y="65" fill="currentColor" fillOpacity="0.82" fontSize="11">
                            FTS5 memory, knowledge
                        </text>

                        <line
                            x1="350"
                            y1="55"
                            x2="370"
                            y2="55"
                            stroke="currentColor"
                            strokeOpacity="0.35"
                            strokeWidth="1.2"
                        />
                        <polygon
                            points="369,51 376,55 369,59"
                            fill="currentColor"
                            fillOpacity="0.5"
                        />

                        <rect
                            x="378"
                            y="28"
                            width="170"
                            height="54"
                            rx="6"
                            fill="#5fd75f"
                            fillOpacity="0.1"
                            stroke="#5fd75f"
                            strokeOpacity="0.65"
                            strokeWidth="1.2"
                        />
                        <text
                            x="390"
                            y="48"
                            fill="#5fd75f"
                            fontSize="10"
                            fontFamily="monospace"
                            fontWeight="600"
                        >
                            Step loop, outbox
                        </text>
                        <text x="390" y="65" fill="currentColor" fillOpacity="0.82" fontSize="11">
                            Parse, policy, persist
                        </text>

                        {/* Breakpoint label */}
                        <line
                            x1="170"
                            y1="26"
                            x2="170"
                            y2="96"
                            stroke="#d75fd7"
                            strokeDasharray="3 3"
                            strokeOpacity="0.7"
                        />
                        <text x="12" y="100" fill="#d75fd7" fontSize="9.5" fontFamily="monospace">
                            cache-stable prefix (survives S5)
                        </text>

                        {/* Bottom row: 5-stage progressive compaction ladder */}
                        <text
                            x="12"
                            y="132"
                            fill="currentColor"
                            fillOpacity="0.55"
                            fontSize="10"
                            fontFamily="monospace"
                        >
                            Progressive compaction ladder (from 60% pressure)
                        </text>

                        {[
                            // The defaults in core's manifest schema (`compaction.thresholds`) and the
                            // order of `STAGE_ORDER`; the two accented stages are the ones that call a model.
                            { x: 12, tag: "snip 60%", label: "Cut big results", accent: false },
                            {
                                x: 120,
                                tag: "micro 70%",
                                label: "Swap for pointer",
                                accent: false,
                            },
                            {
                                x: 228,
                                tag: "collapse 80%",
                                label: "Digest old turns",
                                accent: true,
                            },
                            { x: 336, tag: "reset 88%", label: "Checkpoint", accent: true },
                            { x: 444, tag: "trim 95%", label: "Keep requests", accent: false },
                        ].map((stage) => (
                            <g key={stage.tag}>
                                <rect
                                    x={stage.x}
                                    y="144"
                                    width="102"
                                    height="52"
                                    rx="5"
                                    fill={stage.accent ? "#d7af5f" : "currentColor"}
                                    fillOpacity={stage.accent ? "0.12" : "0.04"}
                                    stroke={stage.accent ? "#d7af5f" : "currentColor"}
                                    strokeOpacity={stage.accent ? "0.6" : "0.22"}
                                    strokeWidth="1.1"
                                />
                                <text
                                    x={stage.x + 10}
                                    y="164"
                                    fill={stage.accent ? "#d7af5f" : "currentColor"}
                                    fillOpacity={stage.accent ? "1" : "0.65"}
                                    fontSize="9.5"
                                    fontFamily="monospace"
                                    fontWeight="600"
                                >
                                    {stage.tag}
                                </text>
                                <text
                                    x={stage.x + 10}
                                    y="182"
                                    fill="currentColor"
                                    fillOpacity="0.82"
                                    fontSize="10"
                                >
                                    {stage.label}
                                </text>
                            </g>
                        ))}
                    </svg>
                </div>
            </div>
        </section>
    )
}
