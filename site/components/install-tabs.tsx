"use client"

import { useState } from "react"

export interface InstallOption {
    id: string
    label: string
    command: string
    note: string
}

export function InstallTabs({ options }: { options: readonly InstallOption[] }) {
    const [activeId, setActiveId] = useState(options[0]?.id ?? "npm")
    const [copied, setCopied] = useState(false)

    const current = options.find((opt) => opt.id === activeId) ?? options[0]
    if (!current) return null

    async function copyCommand() {
        if (!current) return
        try {
            await navigator.clipboard.writeText(current.command)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch {
            // Clipboard unavailable in restricted context; ignore silently.
        }
    }

    return (
        <div className="mt-7 overflow-hidden rounded-xl border border-fd-border bg-fd-card/80">
            <div className="flex items-center justify-between gap-2 border-b border-fd-border px-3 py-1.5">
                <div
                    className="flex flex-wrap items-center gap-1"
                    role="tablist"
                    aria-label="Install method"
                >
                    {options.map((opt) => {
                        const selected = opt.id === current.id
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => {
                                    setActiveId(opt.id)
                                    setCopied(false)
                                }}
                                className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                                    selected
                                        ? "bg-term-accent/15 font-medium text-term-accent"
                                        : "text-fd-muted-foreground hover:text-fd-foreground"
                                }`}
                            >
                                {opt.label}
                            </button>
                        )
                    })}
                </div>
                <span className="hidden font-mono text-[11px] text-fd-muted-foreground sm:inline">
                    {current.note}
                </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-fd-foreground">
                    <span className="mr-2 select-none text-term-accent">›</span>
                    {current.command}
                </code>
                <button
                    type="button"
                    onClick={copyCommand}
                    className="shrink-0 rounded-md border border-fd-border bg-fd-background px-2.5 py-1 font-mono text-[11px] text-fd-muted-foreground transition-colors hover:border-term-accent/60 hover:text-fd-foreground"
                >
                    {copied ? "copied ✓" : "copy"}
                </button>
            </div>
        </div>
    )
}
