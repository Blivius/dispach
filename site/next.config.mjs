import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createMDX } from "fumadocs-mdx/next"

const withMDX = createMDX()

/** The repo root: the docs, the OpenAPI spec, the evals feed and brand.ts all live above `site/`. */
const root = fileURLToPath(new URL("..", import.meta.url))

/**
 * The installer's short address. The release attaches `install.sh`, and GitHub's `latest/download`
 * follows the newest stable release, so this stays right without an edit per version; `curl -L`
 * follows the hop. The repository comes from the CLI's `repository.url`, the one npm provenance checks.
 */
const cli = JSON.parse(
    readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8"),
)
const repo = cli.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")
const installer = `${repo}/releases/latest/download/install.sh`

/** @type {import('next').NextConfig} */
const config = {
    reactStrictMode: true,
    experimental: { agentUpgrade: "security" },
    turbopack: { root },
    outputFileTracingRoot: root,
    // Search indexes the OpenAPI document at request time, and the tracer cannot see a path built at
    // runtime, so without this the deployed function has no file to read and answers 500.
    outputFileTracingIncludes: { "/api/search": ["../developer-docs/reference/openapi.json"] },
    // `/docs` has no page of its own; the first section is where a reader starts.
    redirects: async () => [
        { source: "/docs", destination: "/docs/runtime", permanent: false },
        { source: "/install.sh", destination: installer, permanent: false },
        { source: "/install", destination: installer, permanent: false },
    ],
}

export default withMDX(config)
