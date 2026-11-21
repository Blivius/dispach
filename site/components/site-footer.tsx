import Link from "next/link"
import { evidence } from "@/lib/evidence"
import { brand, docsRoute, paperUrl, parentCompany, repoUrl } from "@/lib/shared"
import { initial } from "@/lib/wordmark"

export function SiteFooter() {
    return (
        <footer className="border-t border-fd-border bg-fd-card/30">
            <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
                <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
                    <div className="space-y-3">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 font-semibold tracking-tight"
                        >
                            <svg
                                aria-hidden="true"
                                viewBox={`0 0 ${initial.width} ${initial.height}`}
                                className="h-4 w-4 text-term-accent"
                                shapeRendering="crispEdges"
                            >
                                {initial.cells.map(({ x, y }) => (
                                    <rect
                                        key={`${x}:${y}`}
                                        x={x}
                                        y={y}
                                        width={1}
                                        height={1}
                                        fill="currentColor"
                                    />
                                ))}
                            </svg>
                            <span>{brand.name}</span>
                            <span className="font-mono text-xs font-normal text-fd-muted-foreground">
                                v{evidence.version}
                            </span>
                        </Link>
                        <p className="max-w-xs text-xs leading-relaxed text-fd-muted-foreground">
                            Open-source, self-hosted agent backend behind one HTTP/SSE/WS contract.
                            Built by{" "}
                            <a
                                href={parentCompany.url}
                                className="text-fd-foreground underline underline-offset-4 hover:text-term-accent"
                            >
                                {parentCompany.name}
                            </a>
                            .
                        </p>
                        <p className="text-xs text-fd-muted-foreground/80">
                            Runtime: Apache-2.0. Control plane (<code>packages/control</code>):
                            FSL-1.1-ALv2.
                        </p>
                    </div>

                    <div>
                        <p className="font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
                            Runtime
                        </p>
                        <ul className="mt-3 space-y-2 text-sm text-fd-muted-foreground">
                            <li>
                                <Link
                                    href={`${docsRoute}/runtime/quickstart/install-and-serve`}
                                    className="hover:text-fd-foreground"
                                >
                                    Install &amp; serve
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href={`${docsRoute}/runtime/quickstart/run-with-docker`}
                                    className="hover:text-fd-foreground"
                                >
                                    Run with Docker
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href={`${docsRoute}/runtime/guides/typescript-client`}
                                    className="hover:text-fd-foreground"
                                >
                                    TypeScript client
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href={`${docsRoute}/runtime/concepts/architecture`}
                                    className="hover:text-fd-foreground"
                                >
                                    Architecture
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
                            Verification
                        </p>
                        <ul className="mt-3 space-y-2 text-sm text-fd-muted-foreground">
                            <li>
                                <Link
                                    href={`${docsRoute}/reference`}
                                    className="hover:text-fd-foreground"
                                >
                                    API reference ({evidence.endpoints})
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href={`${docsRoute}/runtime/benchmarks`}
                                    className="hover:text-fd-foreground"
                                >
                                    Benchmarks
                                </Link>
                            </li>
                            <li>
                                <Link href="/evals" className="hover:text-fd-foreground">
                                    Claim register
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href={`${docsRoute}/runtime/limits-and-evidence`}
                                    className="hover:text-fd-foreground"
                                >
                                    Limits &amp; evidence
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
                            {parentCompany.name} &amp; Source
                        </p>
                        <ul className="mt-3 space-y-2 text-sm text-fd-muted-foreground">
                            <li>
                                <a href={parentCompany.url} className="hover:text-fd-foreground">
                                    {parentCompany.name} ↗
                                </a>
                            </li>
                            <li>
                                <a href={paperUrl} className="hover:text-fd-foreground">
                                    Containment paper (arXiv) ↗
                                </a>
                            </li>
                            <li>
                                <a
                                    href={parentCompany.designPartnerHref}
                                    className="hover:text-fd-foreground"
                                >
                                    Design partners
                                </a>
                            </li>
                            <li>
                                <a href={repoUrl} className="hover:text-fd-foreground">
                                    GitLab repository ↗
                                </a>
                            </li>
                            <li>
                                <Link
                                    href={`${docsRoute}/control-plane`}
                                    className="hover:text-fd-foreground"
                                >
                                    Control plane (FSL-1.1)
                                </Link>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </footer>
    )
}
