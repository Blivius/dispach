"use client"

import { useEffect, useRef, useState } from "react"
import type { Line } from "@/lib/replay"

const TYPE_MS = 14
const PAUSE_MS: Record<Line["kind"], number> = { cmd: 500, out: 260, note: 900 }

/**
 * Plays a captured transcript: commands are typed, responses appear. With reduced motion the
 * whole transcript is shown at once, since the content is the point and the typing is not.
 */
export function Replay({ lines, caption }: { lines: Line[]; caption: string }) {
    const [shown, setShown] = useState(0)
    const [typed, setTyped] = useState(0)
    const [run, setRun] = useState(0)
    const preRef = useRef<HTMLPreElement>(null)

    // Keep the active line visible without clipping under the status bar.
    // biome-ignore lint/correctness/useExhaustiveDependencies: scroll follows replay progress
    useEffect(() => {
        const el = preRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [shown, typed])

    // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is the replay button's trigger; the body never reads it, and dropping it makes the button do nothing.
    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setShown(lines.length)
            return
        }
        setShown(0)
        setTyped(0)
        let cancelled = false
        const timers: ReturnType<typeof setTimeout>[] = []
        const wait = (ms: number) =>
            new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)))
        ;(async () => {
            for (let i = 0; i < lines.length && !cancelled; i++) {
                const line = lines[i]
                if (line === undefined) break
                if (line.kind === "cmd") {
                    setShown(i)
                    for (let c = 1; c <= line.text.length && !cancelled; c++) {
                        setTyped(c)
                        await wait(TYPE_MS)
                    }
                }
                setShown(i + 1)
                setTyped(0)
                await wait(PAUSE_MS[line.kind])
            }
        })()
        return () => {
            cancelled = true
            for (const t of timers) clearTimeout(t)
        }
    }, [lines, run])

    const typing = lines[shown]?.kind === "cmd" && typed > 0 ? lines[shown] : undefined
    const done = shown >= lines.length

    return (
        <figure
            aria-label="Recorded terminal session"
            className="overflow-hidden rounded-2xl border border-term-accent/65 bg-fd-card text-left"
        >
            <pre
                ref={preRef}
                className="min-h-[24rem] whitespace-pre-wrap break-all bg-fd-background/90 px-4 pt-3.5 pb-4 font-mono text-[12.5px] leading-relaxed text-fd-foreground/90"
            >
                {lines.slice(0, shown).map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed transcript where one line repeats verbatim; position is its identity.
                    <Row key={`${run}-${i}`} line={line} />
                ))}
                {typing && <Row line={{ ...typing, text: typing.text.slice(0, typed) }} cursor />}
                {done && <span className="text-term-accent">› </span>}
                {done && <span className="animate-pulse bg-fd-foreground/70"> </span>}
            </pre>
            <figcaption className="flex items-center justify-between gap-3 border-t border-fd-border px-4 py-2 text-xs text-fd-muted-foreground">
                <span className="flex min-w-0 items-center gap-2 truncate">
                    <span
                        className={`inline-block size-1.5 shrink-0 rounded-full ${
                            done ? "bg-term-success" : "bg-term-accent"
                        }`}
                        aria-hidden="true"
                    />
                    <span className="font-medium text-fd-foreground">
                        {done ? "Idle" : "Streaming"}
                    </span>
                    <span className="truncate text-fd-muted-foreground">{caption}</span>
                </span>
                <button
                    type="button"
                    onClick={() => setRun((n) => n + 1)}
                    className="shrink-0 rounded px-2 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:text-term-accent"
                >
                    Replay
                </button>
            </figcaption>
        </figure>
    )
}

/** Glyphs and colours are the TUI's: `›` for input, `·` for notes, `✓` for a turn that ended well. */
function Row({ line, cursor = false }: { line: Line; cursor?: boolean }) {
    if (line.kind === "cmd")
        return (
            <div>
                <span className="text-term-accent">› </span>
                <span className="text-fd-foreground">{line.text}</span>
                {cursor && <span className="bg-fd-foreground/70"> </span>}
            </div>
        )
    if (line.kind === "note") return <div className="text-fd-muted-foreground">· {line.text}</div>
    if (line.text.startsWith("event: turn.end"))
        return (
            <div>
                <span className="text-term-success">✓ </span>
                {line.text}
            </div>
        )
    if (line.text.startsWith("event:"))
        return <div className="text-term-info">{`  ${line.text}`}</div>
    return <div className="text-fd-muted-foreground">{line.text}</div>
}
