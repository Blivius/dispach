import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { Mark } from "@/components/mark"
import { brand, docsRoute, parentCompany, repoUrl } from "./shared"

function BrandTitle() {
    return (
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <Mark />
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
