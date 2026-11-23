import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { brand, docsRoute, parentCompany, repoUrl } from "./shared"
import { initial } from "./wordmark"

function BrandTitle() {
    return (
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <svg
                aria-hidden="true"
                viewBox={`0 0 ${initial.width} ${initial.height}`}
                className="h-4 w-4 text-term-accent"
                shapeRendering="crispEdges"
            >
                {initial.cells.map(({ x, y }) => (
                    <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
                ))}
            </svg>
            <span>{brand.name}</span>
        </span>
    )
}

export function baseOptions(): BaseLayoutProps {
    return {
        nav: { title: <BrandTitle /> },
        links: [
            { text: "Docs", url: "/docs" },
            // The HTTP reference is what somebody checks before self-hosting; one click, from anywhere.
            { text: "API", url: `${docsRoute}/reference` },
            { text: "Benchmarks", url: `${docsRoute}/runtime/benchmarks` },
            { text: "Evals", url: "/evals" },
            { text: parentCompany.name, url: parentCompany.url, external: true },
        ],
        githubUrl: repoUrl,
    }
}
