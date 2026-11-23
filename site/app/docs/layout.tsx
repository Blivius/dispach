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
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-fd-border bg-fd-card/70 px-3 py-2 font-mono text-[11px] text-fd-muted-foreground">
                        <span className="truncate">
                            <span className="text-term-success">●</span> v{evidence.version} ·
                            Apache-2.0
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
