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

function GitLabIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current">
            <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94Z" />
        </svg>
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
            {
                type: "icon",
                label: "GitLab",
                text: "GitLab",
                icon: <GitLabIcon />,
                url: repoUrl,
                external: true,
            },
        ],
    }
}
