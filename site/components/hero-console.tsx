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

    const tabs: { id: TabId; code: string; label: string }[] = [
        { id: "detached", code: "01", label: "Detached Turn (202/SSE)" },
        { id: "floor", code: "02", label: "Containment Floor" },
        { id: "sdk", code: "03", label: "TypeScript SDK" },
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
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                                active
                                    ? "border-term-accent/70 bg-term-accent/15 text-fd-foreground"
                                    : "border-fd-border bg-fd-card/50 text-fd-muted-foreground hover:text-fd-foreground"
                            }`}
                        >
                            <span
                                className={
                                    active ? "text-term-accent" : "text-fd-muted-foreground/70"
                                }
                            >
                                {t.code}
                            </span>
                            <span>{t.label}</span>
                        </button>
                    )
                })}
            </div>

            {tab === "detached" && <Replay lines={lines} caption={caption} />}

            {tab === "floor" && (
                <figure
                    aria-label="Settings containment floor refusal trace"
                    className="overflow-hidden rounded-2xl border border-term-accent/70 bg-neutral-950 text-left shadow-2xl shadow-term-accent/10"
                >
                    <pre className="h-[23rem] overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-relaxed text-neutral-300">
                        <div>
                            <span className="text-term-accent">› </span>
                            <span className="text-neutral-100">{brandSlug} run milo</span>
                        </div>
                        <div className="text-term-muted">
                            · session local:3c2dc5 · writeRoots: [&quot;workspace/&quot;] · floor
                            active
                        </div>
                        <div className="mt-2">
                            <span className="text-term-accent">› </span>
                            <span className="text-neutral-100">
                                Call config_set with path tools.providers.system.writeRoots and
                                value [&quot;~&quot;].
                            </span>
                        </div>
                        <div className="mt-2 text-term-info">
                            {"  "}· tool.call config_set &#123; path:
                            &quot;tools.providers.system.writeRoots&quot;, value: [&quot;~&quot;]
                            &#125;
                        </div>
                        <div className="mt-1 text-red-400">
                            ✖ floorRefusal: protected containment path cannot be widened by the
                            agent
                        </div>
                        <div className="text-term-muted">
                            {"  "}hint: capabilities may be configured; writeRoots, policy.deny, and
                            untrusted.onMutate stay operator-owned.
                        </div>
                        <div className="mt-2 text-neutral-200">
                            The runtime refused to change writeRoots to ~ because write boundaries
                            sit below the settings containment floor.
                        </div>
                        <div className="mt-2">
                            <span className="text-term-success">✓ </span>
                            <span className="text-neutral-400">
                                arXiv:2610.06274 (preprint): 0 of 167 protected writes saved (65
                                attempted)
                            </span>
                        </div>
                    </pre>
                    <figcaption className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2 font-mono text-[11px] text-term-muted">
                        <span className="truncate">
                            <span className="text-term-success">● </span>
                            enforced in core · packages/tools-system/src/config.ts
                        </span>
                        <span className="shrink-0 text-term-accent">floor active</span>
                    </figcaption>
                </figure>
            )}

            {tab === "sdk" && (
                <figure
                    aria-label="Typed client example"
                    className="overflow-hidden rounded-2xl border border-term-accent/70 bg-neutral-950 text-left shadow-2xl shadow-term-accent/10"
                >
                    <pre className="h-[23rem] overflow-y-auto whitespace-pre px-4 py-3 font-mono text-[12.5px] leading-relaxed text-neutral-300">
                        {`import { createClient } from "${brandSlug}/client"

const client = createClient({
  baseUrl: process.env.RUNTIME_URL,
  token: process.env.API_TOKEN,
})

// 1. Start a detached turn with an idempotency key
const { turnId } = await client.sendMessage("milo", {
  text: "Draft the weekly ops digest and open a review.",
  chunks: true,
  idempotencyKey: crypto.randomUUID(),
})

// 2. Stream token-by-token; safe to drop and reattach by turnId
for await (const event of client.streamTurn("milo", turnId, { chunks: true })) {
  if (event.type === "model.chunk") process.stdout.write(event.data.delta)
  if (event.type === "turn.end") console.log("\\n✓", event.data.reason)
}`}
                    </pre>
                    <figcaption className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2 font-mono text-[11px] text-term-muted">
                        <span className="truncate">
                            <span className="text-term-info">● </span>
                            {brandName} typed client · zero Ink/React weight · OpenAPI 3.1 contract
                        </span>
                        <span className="shrink-0">ESM / TS</span>
                    </figcaption>
                </figure>
            )}
        </div>
    )
}
