/**
 * The pixel wordmark, from the TUI's own renderer — the same one the landing site draws.
 *
 * Never written down: `BRAND.name` goes through `packages/cli/src/lib/wordmark.ts`'s glyph table, so a
 * rename changes nothing here (hard rule 3). Each `█` becomes a unit square, so the browser draws
 * pixels rather than a font's idea of a block glyph.
 */

import { DEFAULT_BRAND } from "@dispach/core/wire"
import type React from "react"
import { wordmark } from "../../cli/src/lib/wordmark.ts"

interface Grid {
    readonly width: number
    readonly height: number
    readonly cells: readonly { readonly x: number; readonly y: number }[]
}

/** The `block` tier: one cell per pixel. 60 columns fits it and is too narrow for `wide`. */
function grid(text: string, columns: number): Grid {
    const mark = wordmark(text, { columns, rows: 5 })
    return {
        width: mark.width,
        height: mark.lines.length,
        cells: mark.lines.flatMap((line, y) =>
            [...line].flatMap((cell, x) => (cell === "█" ? [{ x, y }] : [])),
        ),
    }
}

const NAME = grid(DEFAULT_BRAND.name, 60)

function Pixels(props: {
    readonly grid: Grid
    readonly height: number
    readonly label?: string
}): React.ReactElement {
    return (
        <svg
            role="img"
            aria-label={props.label ?? DEFAULT_BRAND.name}
            viewBox={`0 0 ${props.grid.width} ${props.grid.height}`}
            height={props.height}
            className="wordmark"
            shapeRendering="crispEdges"
        >
            {props.grid.cells.map(({ x, y }) => (
                <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
            ))}
        </svg>
    )
}

export function Wordmark(props: { readonly height?: number }): React.ReactElement {
    return <Pixels grid={NAME} height={props.height ?? 14} />
}

/** The Sliced Monolith emblem on the dark ground, as an SVG data URI favicon. */
export function faviconHref(): string {
    const svg =
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120' fill='none'>" +
        "<rect width='120' height='120' rx='26' fill='#121212'/>" +
        "<g transform='translate(14 14) scale(0.7667)'>" +
        "<path d='M22 66 L60 104 H22 Z' fill='#f4f4f6'/>" +
        "<path d='M22 16 H26 L95.71 85.71 A44 44 0 0 1 75.27 101.27 L22 48 Z' fill='#f4f4f6' fill-opacity='0.58'/>" +
        "<path d='M44 16 H60 A44 44 0 0 1 101.78 73.78 Z' fill='#d75fd7'/>" +
        "</g></svg>"
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
