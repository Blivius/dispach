"use client"

import { useState } from "react"
import { Replay } from "@/components/replay"
import type { Line } from "@/lib/replay"

type TabId = "detached" | "floor" | "sdk"

interface HeroConsoleProps {
    brandName: string
    brandSlug: string
    lines: Line[]
    caption: string
}

export function HeroConsole({ brandName, brandSlug, lines, caption }: HeroConsoleProps) {
    const [tab, setTab] = useState<TabId>("detached")

    const tabs: { id: TabId; label: string }[] = [
        { id: "detached", label: "Detached Turn (202/SSE)" },
        { id: "floor", label: "Containment Floor" },
        { id: "sdk", label: "TypeScript SDK" },
    ]

    return (
        <div className="min-w-0">
            <div
                role="tablist"
                aria-label="Runtime inspection views"
                className="mb-3 flex flex-wrap gap-1.5"
            >
                {tabs.map((t) => {
                    const active = tab === t.id
                    return (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(t.id)}
                            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                active
                                    ? "border-term-accent/70 bg-term-accent/15 text-fd-foreground"
                                    : "border-fd-border bg-fd-card/50 text-fd-muted-foreground hover:text-fd-foreground"
                            }`}
                        >
                            <span>{t.label}</span>
                        </button>
                    )
                })}
            </div>

            {tab === "detached" && <Replay lines={lines} caption={caption} />}

            {tab === "floor" && (
                <figure
                    aria-label="Settings containment floor refusal trace"
                    className="overflow-hidden rounded-2xl border border-term-accent/65 bg-fd-card text-left"
                >
                    <pre className="min-h-[24rem] whitespace-pre-wrap break-words bg-fd-background/90 px-4 pt-3.5 pb-4 font-mono text-[12.5px] leading-relaxed text-fd-foreground/90">
                        <div>
                            <span className="text-term-accent">› </span>
                            <span className="text-fd-foreground">{brandSlug} run milo</span>
                        </div>
                        <div className="text-fd-muted-foreground">
                            session local:3c2dc5, writeRoots: [&quot;workspace/&quot;], floor active
                        </div>
                        <div className="mt-2">
                            <span className="text-term-accent">› </span>
                            <span className="text-fd-foreground">
                                Call config_set with path tools.providers.system.writeRoots and
                                value [&quot;~&quot;].
                            </span>
                        </div>
                        <div className="mt-2 text-term-info">
                            {"  "}tool.call config_set &#123; path:
                            &quot;tools.providers.system.writeRoots&quot;, value: [&quot;~&quot;]
                            &#125;
                        </div>
                        <div className="mt-1 text-red-400">
                            ✖ refused: widening where you may write is not yours to do.
                        </div>
                        <div className="mt-2 text-fd-foreground">
                            The runtime refused to change writeRoots to ~ because write boundaries
                            sit below the settings containment floor.
                        </div>
                        <div className="mt-2">
                            <span className="text-term-success">✓ </span>
                            <span className="text-fd-muted-foreground">
                                arXiv:2610.06274 (preprint): 0 of 167 protected writes saved (65
                                attempted)
                            </span>
                        </div>
                    </pre>
                    <figcaption className="flex items-center justify-between gap-3 border-t border-fd-border px-4 py-2 text-xs text-fd-muted-foreground">
                        <span className="truncate">
                            Enforced by <code>floorRefusal</code> in{" "}
                            <code>packages/tools-system/src/config.ts</code>
                        </span>
                        <span className="shrink-0 font-medium text-term-accent">Floor active</span>
                    </figcaption>
                </figure>
            )}

            {tab === "sdk" && (
                <figure
                    aria-label="Typed client example"
                    className="overflow-hidden rounded-2xl border border-term-accent/65 bg-fd-card text-left"
                >
                    <pre className="min-h-[24rem] overflow-x-auto whitespace-pre bg-fd-background/90 px-4 pt-3.5 pb-4 font-mono text-[12.5px] leading-relaxed text-fd-foreground/90">
                        {`import { createClient } from "${brandSlug}/client"

const client = createClient({
  baseUrl: process.env.RUNTIME_URL,
  token: process.env.API_TOKEN,
})
const agent = client.agent("milo")

// 1. Start a detached turn; the key makes a retried send the same turn
const turn = await agent.send("Draft the weekly ops digest and open a review.", {
  chunks: true,
  idempotencyKey: crypto.randomUUID(),
})

// 2. Stream it token by token
for await (const token of turn.tokens()) process.stdout.write(token)

// 3. Safe to drop: reattach from anywhere by the turn id
const reply = await agent.turn(turn.turnId).text()`}
                    </pre>
                    <figcaption className="flex items-center justify-between gap-3 border-t border-fd-border px-4 py-2 text-xs text-fd-muted-foreground">
                        <span className="truncate">
                            {brandName} typed client, zero Ink/React weight, OpenAPI 3.1 contract
                        </span>
                        <span className="shrink-0 font-medium text-fd-foreground">ESM / TS</span>
                    </figcaption>
                </figure>
            )}
        </div>
    )
}
