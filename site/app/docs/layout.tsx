import { DocsLayout } from "fumadocs-ui/layouts/docs"
import Link from "next/link"
import { evidence } from "@/lib/evidence"
import { baseOptions } from "@/lib/layout.shared"
import { tree } from "@/lib/tree"

export default function Layout({ children }: LayoutProps<"/docs">) {
    return (
        <DocsLayout
            tree={tree}
            {...baseOptions()}
            sidebar={{
                banner: (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-fd-border bg-fd-card/70 px-3 py-2 text-xs text-fd-muted-foreground">
                        <span className="flex min-w-0 items-center gap-2 truncate">
                            <span className="font-mono text-fd-foreground">
                                v{evidence.version}
                            </span>
                            <span className="border-l border-fd-border pl-2">Apache-2.0</span>
                        </span>
                        <Link href="/" className="shrink-0 text-term-accent hover:underline">
                            Home
                        </Link>
                    </div>
                ),
            }}
        >
            {children}
        </DocsLayout>
    )
}
