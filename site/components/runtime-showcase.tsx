"use client"

import { useState } from "react"

interface DemoItem {
    id: string
    code: string
    label: string
    title: string
    caption: string
    src: string
    alt: string
}

const DEMOS: readonly DemoItem[] = [
    {
        id: "quickstart",
        code: "01",
        label: "HTTP provision & SSE",
        title: "Docker start → live agent provision → streamed reply in three requests",
        caption:
            "Recorded against the published container image: zero agents at start, live POST /v1/agents adoption without restart, then streaming tokens over SSE.",
        src: "/media/quickstart.gif",
        alt: "Terminal recording showing docker run, creating an agent over HTTP, and streaming its reply",
    },
    {
        id: "floor",
        code: "02",
        label: "Containment floor live",
        title: "Agent told to widen writeRoots to ~ — refused at the hardline floor",
        caption:
            "The terminal UI during an interactive turn: the agent invokes config_set to widen its write root and the settings containment floor blocks it deterministically.",
        src: "/media/tui.gif",
        alt: "Terminal UI recording showing the agent attempting to widen writeRoots to home directory and being refused by the containment floor",
    },
    {
        id: "install",
        code: "03",
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
        <section className="border-t border-fd-border px-5 py-16 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-2xl">
                    <p className="font-mono text-xs uppercase tracking-wider text-term-accent">
                        recorded sessions
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                        See the runtime in action
                    </h2>
                    <p className="mt-2 text-sm text-fd-muted-foreground">
                        Unedited terminal captures from the shipped container image and CLI—HTTP
                        provisioning, the containment floor firing live, and a zero-Node Linux boot.
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
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                                    selected
                                        ? "border-term-accent/70 bg-term-accent/15 text-fd-foreground"
                                        : "border-fd-border bg-fd-card/50 text-fd-muted-foreground hover:text-fd-foreground"
                                }`}
                            >
                                <span className={selected ? "text-term-accent" : "opacity-60"}>
                                    {demo.code}
                                </span>
                                <span>{demo.label}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <figure className="mt-6 overflow-hidden rounded-2xl border border-fd-border bg-neutral-950">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 font-mono text-xs text-neutral-400">
                    <span className="inline-flex items-center gap-2 truncate">
                        <span className="text-term-accent">●</span>
                        <span className="truncate text-neutral-200">{current.title}</span>
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-term-muted sm:inline">
                        recorded terminal capture
                    </span>
                </div>
                <div className="flex justify-center bg-[#181825] p-2 sm:p-4">
                    {/* biome-ignore lint/performance/noImgElement: animated GIF recordings bypass Next image optimization */}
                    <img
                        key={current.id}
                        src={current.src}
                        alt={current.alt}
                        className="max-h-[460px] w-auto rounded-lg object-contain"
                    />
                </div>
                <figcaption className="border-t border-white/10 px-4 py-3 text-xs leading-relaxed text-neutral-400">
                    {current.caption}
                </figcaption>
            </figure>
        </section>
    )
}
