"use client"

import { useState } from "react"

interface DemoItem {
    id: string
    label: string
    title: string
    caption: string
    src: string
    alt: string
}

const DEMOS: readonly DemoItem[] = [
    {
        id: "quickstart",
        label: "HTTP provision & SSE",
        title: "Docker start, live agent provision, and streamed reply in three requests",
        caption:
            "Recorded against the published container image: zero agents at start, live POST /v1/agents adoption without restart, then streaming tokens over SSE.",
        src: "/media/quickstart.gif",
        alt: "Terminal recording showing docker run, creating an agent over HTTP, and streaming its reply",
    },
    {
        id: "floor",
        label: "Containment floor live",
        title: "Agent told to widen writeRoots to ~, refused at the hardline floor",
        caption:
            "The terminal UI during an interactive turn: the agent invokes config_set to widen its write root and the settings containment floor blocks it deterministically.",
        src: "/media/tui.gif",
        alt: "Terminal UI recording showing the agent attempting to widen writeRoots to home directory and being refused by the containment floor",
    },
    {
        id: "install",
        label: "Bare Linux install",
        title: "Fresh machine with no Node: standalone curl install, init, serve, and TUI",
        caption:
            "Checksum-verified standalone bundle carrying its own Node runtime, installing with zero root permissions and passing /v1/ready before the first turn.",
        src: "/media/install.gif",
        alt: "Terminal recording of curl installer on a fresh Linux host, init wizard, serve readiness check, and interactive TUI",
    },
]

export function RuntimeShowcase() {
    const [activeId, setActiveId] = useState<string>(DEMOS[0]?.id ?? "quickstart")
    const current = DEMOS.find((item) => item.id === activeId) ?? DEMOS[0]
    if (!current) return null

    return (
        <section className="border-t border-fd-border px-5 py-20 sm:px-8 lg:py-28">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-2xl">
                    <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                        See the runtime in action
                    </h2>
                    <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-fd-muted-foreground">
                        Unedited captures from the shipped image and CLI: provisioning over HTTP,
                        the settings floor refusing a write, and an install on Linux with no Node.
                    </p>
                </div>

                <div
                    role="tablist"
                    aria-label="Recorded runtime demos"
                    className="flex flex-wrap gap-1.5"
                >
                    {DEMOS.map((demo) => {
                        const selected = demo.id === current.id
                        return (
                            <button
                                key={demo.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setActiveId(demo.id)}
                                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    selected
                                        ? "border-term-accent/70 bg-term-accent/15 text-fd-foreground"
                                        : "border-fd-border bg-fd-card/50 text-fd-muted-foreground hover:text-fd-foreground"
                                }`}
                            >
                                <span>{demo.label}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <figure className="mt-6 overflow-hidden rounded-2xl border border-fd-border bg-fd-card">
                <div className="flex items-center justify-between gap-3 border-b border-fd-border px-4 py-2.5 text-xs text-fd-muted-foreground">
                    <span className="truncate font-medium text-fd-foreground">{current.title}</span>
                    <span className="hidden shrink-0 text-xs text-fd-muted-foreground sm:inline">
                        Terminal capture
                    </span>
                </div>
                <div className="flex justify-center bg-term-stage p-2 sm:p-4">
                    {/* biome-ignore lint/performance/noImgElement: animated GIF recordings bypass Next image optimization */}
                    <img
                        key={current.id}
                        src={current.src}
                        alt={current.alt}
                        className="max-h-[460px] w-auto rounded-lg object-contain"
                    />
                </div>
                <figcaption className="border-t border-fd-border px-4 py-3 text-xs leading-relaxed text-fd-muted-foreground">
                    {current.caption}
                </figcaption>
            </figure>
        </section>
    )
}
