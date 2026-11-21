"use client"

import Link from "next/link"
import { useState } from "react"
import type { BenchCell } from "@/lib/evidence"

export interface BenchmarkRow {
    key: string
    name: string
    tier: "frontier" | "open"
    runtime: BenchCell
    hermes: BenchCell
    openclaw: BenchCell
}

interface BenchmarkTableProps {
    brandName: string
    commit: string
    runs: number
    tasks: number
    repeats: number
    atLeastHermes: number
    cheapest: number
    openclawLast: boolean
    hermesName: string
    hermesVersion: string
    openclawName: string
    openclawVersion: string
    rows: readonly BenchmarkRow[]
    sonnet?: BenchmarkRow
    benchmarkHref: string
}

type Filter = "all" | "frontier" | "open"

function Score({ cell, best, accent }: { cell: BenchCell; best: boolean; accent?: boolean }) {
    return (
        <td className="px-3.5 py-2.5">
            <div className="flex items-baseline justify-between gap-3 font-mono text-sm">
                <span
                    className={
                        best ? "font-semibold text-fd-foreground" : "text-fd-muted-foreground"
                    }
                >
                    {cell.pass}
                </span>
                <span className="text-xs text-fd-muted-foreground">${cell.cost.toFixed(2)}</span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-fd-border">
                <div
                    className={`h-1 rounded-full ${accent ? "bg-term-accent" : "bg-fd-muted-foreground/50"}`}
                    style={{ width: `${(cell.pass / cell.n) * 100}%` }}
                />
            </div>
        </td>
    )
}

export function BenchmarkTable(props: BenchmarkTableProps) {
    const [filter, setFilter] = useState<Filter>("all")

    const frontierCount = props.rows.filter((r) => r.tier === "frontier").length
    const openCount = props.rows.filter((r) => r.tier === "open").length
    const visible = filter === "all" ? props.rows : props.rows.filter((row) => row.tier === filter)

    const sonnetSavings =
        props.sonnet && props.sonnet.runtime.cost > 0
            ? (props.sonnet.openclaw.cost / props.sonnet.runtime.cost).toFixed(1)
            : undefined

    return (
        <section className="border-t border-fd-border px-5 py-16 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-6">
                <div className="max-w-3xl">
                    <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                        {props.brandName} matches or beats {props.hermesName} on{" "}
                        {props.atLeastHermes} of {props.rows.length} models, and costs the least on{" "}
                        {props.cheapest}.
                        {props.openclawLast
                            ? ` ${props.openclawName} scores lowest on every one.`
                            : ""}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                        Tasks passed out of {props.runs}: {props.tasks} multi-turn tool tasks, run{" "}
                        {props.repeats} times each, graded on what the tools were left holding.
                        Every harness runs in its own container against the same tools and pinned
                        model providers. Cost is the OpenRouter bill for all {props.runs} runs.
                    </p>
                </div>

                {props.sonnet && sonnetSavings && (
                    <div className="rounded-xl border border-term-accent/40 bg-term-accent/8 px-4 py-3 text-xs">
                        <p className="font-medium text-term-accent">
                            {props.sonnet.name} (125 runs)
                        </p>
                        <p className="mt-1 font-mono text-sm font-semibold text-fd-foreground">
                            {props.sonnet.runtime.pass}/{props.sonnet.runtime.n} at $
                            {props.sonnet.runtime.cost.toFixed(2)}{" "}
                            <span className="font-sans font-normal text-fd-muted-foreground">
                                vs. {props.openclawName} {props.sonnet.openclaw.pass}/
                                {props.sonnet.openclaw.n} at $
                                {props.sonnet.openclaw.cost.toFixed(2)} ({sonnetSavings}× lower
                                cost)
                            </span>
                        </p>
                    </div>
                )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div
                    role="tablist"
                    aria-label="Filter benchmark models"
                    className="inline-flex flex-wrap gap-1 rounded-lg border border-fd-border bg-fd-card/50 p-1 text-xs"
                >
                    {[
                        { id: "all" as const, label: `All (${props.rows.length})` },
                        { id: "frontier" as const, label: `Frontier (${frontierCount})` },
                        { id: "open" as const, label: `Open-weight (${openCount})` },
                    ].map((tab) => {
                        const active = filter === tab.id
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setFilter(tab.id)}
                                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                                    active
                                        ? "bg-term-accent/15 text-term-accent"
                                        : "text-fd-muted-foreground hover:text-fd-foreground"
                                }`}
                            >
                                {tab.label}
                            </button>
                        )
                    })}
                </div>

                <Link
                    href={props.benchmarkHref}
                    className="text-xs font-medium text-term-accent underline-offset-4 hover:underline"
                >
                    Full methodology &amp; intervals
                </Link>
            </div>

            <p className="mt-3 text-xs text-fd-muted-foreground sm:hidden">
                Scroll horizontally to compare all three harnesses.
            </p>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-fd-border bg-fd-card/40">
                <table className="w-full min-w-[580px] text-left">
                    <thead className="border-b border-fd-border text-xs text-fd-muted-foreground">
                        <tr>
                            <th className="px-3.5 py-3 font-medium">Model</th>
                            <th className="px-3.5 py-3 font-medium text-term-accent">
                                {props.brandName} <span className="font-mono">{props.commit}</span>
                            </th>
                            <th className="px-3.5 py-3 font-medium">
                                {props.hermesName} {props.hermesVersion}
                            </th>
                            <th className="px-3.5 py-3 font-medium">
                                {props.openclawName} {props.openclawVersion}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-fd-border">
                        {visible.map((r) => {
                            const top = Math.max(r.runtime.pass, r.hermes.pass, r.openclaw.pass)
                            return (
                                <tr key={r.key} className="hover:bg-fd-accent/25">
                                    <td className="px-3.5 py-2.5 text-sm font-medium">{r.name}</td>
                                    <Score cell={r.runtime} best={r.runtime.pass === top} accent />
                                    <Score cell={r.hermes} best={r.hermes.pass === top} />
                                    <Score cell={r.openclaw} best={r.openclaw.pass === top} />
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-fd-muted-foreground">
                One benchmark of our own design, each harness on its own documented defaults. With{" "}
                {props.runs} runs an arm a gap of a few runs is noise.{" "}
                <Link href={props.benchmarkHref} className="underline underline-offset-4">
                    Method, intervals, and where {props.brandName} loses
                </Link>
                .
            </p>
        </section>
    )
}
