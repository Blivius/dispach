import openapiDoc from "../../developer-docs/reference/openapi.json"
import bootResult from "../../evals/boot/results.json"
import benchResult from "../../evals/harness/summary.json"
import memoryResult from "../../evals/memory/results.json"
import tenancyResult from "../../evals/tenancy/results.json"
import toolsResult from "../../evals/tools/results.json"
import cliPackage from "../../packages/cli/package.json"

/**
 * The landing page's numbers, read from the committed results at build time so the page cannot
 * say something `evals/` does not. Each figure has a row in `evals/CLAIMS.md`.
 */
const boot = bootResult as {
    processMs: { median: number }
    machine: { cpu: string }
    runs: number
    ciFailMs: number
    runtime: string
}
const memory = memoryResult as {
    corpus: { passages: number }
    latencyMs: { median: number; slowest: number }
}
const tenancy = tenancyResult as {
    results: Record<string, { median: { idleRssKb: number } }>
}
const tools = toolsResult as {
    results: {
        id: string
        nlt: { summary: { accuracy: number } }
        native: { summary: { accuracy: number } }
    }[]
}
const openapi = openapiDoc as {
    paths: Record<string, Record<string, unknown>>
}

export interface BenchCell {
    pass: number
    n: number
    low: number
    high: number
    cost: number
    measured: string
    paused?: true
}
interface BenchModel {
    key: string
    name: string
    native?: BenchCell
    nlt?: BenchCell
    hermes?: BenchCell
    openclaw?: BenchCell
}
const bench = benchResult as {
    tasks: number
    repeats: number
    sweep: { commit: string }
    rivals: Record<"hermes" | "openclaw", { name: string; version: string }>
    models: BenchModel[]
}

const OPEN_WEIGHT_KEYS = new Set([
    "glm-5.3",
    "deepseek-v4-pro",
    "kimi-k3",
    "gemma-4-26b-a4b",
    "qwen3.5-9b",
    "gpt-oss-20b",
])

/** The models measured on all three harnesses, and what the landing page says about them. */
const h2h = bench.models.flatMap((m) =>
    m.native && m.hermes && m.openclaw
        ? [
              {
                  key: m.key,
                  name: m.name,
                  tier: (OPEN_WEIGHT_KEYS.has(m.key) ? "open" : "frontier") as "frontier" | "open",
                  runtime: m.native,
                  hermes: m.hermes,
                  openclaw: m.openclaw,
              },
          ]
        : [],
)

const sonnetRow = h2h.find((r) => r.name.toLowerCase().includes("sonnet")) ?? h2h[0]

export const benchmark = {
    runs: bench.tasks * bench.repeats,
    tasks: bench.tasks,
    repeats: bench.repeats,
    commit: bench.sweep.commit,
    rivals: bench.rivals,
    rows: h2h,
    sonnet: sonnetRow,
    perfect: h2h.filter((r) => r.runtime.pass === r.runtime.n).length,
    atLeastHermes: h2h.filter((r) => r.runtime.pass >= r.hermes.pass).length,
    /** The models Hermes scores higher on, named on the page rather than summarised. */
    hermesAhead: h2h.filter((r) => r.hermes.pass > r.runtime.pass).map((r) => r.name),
    cheapest: h2h.filter((r) => r.runtime.cost < Math.min(r.hermes.cost, r.openclaw.cost)).length,
    openclawLast: h2h.every((r) => r.openclaw.pass < Math.min(r.runtime.pass, r.hermes.pass)),
}

const endpointCount = Object.values(openapi.paths).reduce(
    (count, ops) => count + Object.keys(ops).length,
    0,
)

export const evidence = {
    bootMs: Math.round(boot.processMs.median),
    bootMachine: boot.machine.cpu,
    bootRuns: boot.runs,
    bootCiFailMs: boot.ciFailMs,
    /** The runtime the boot was measured under, e.g. "bun 1.3.5": not what ships, so say so. */
    bootRuntime: boot.runtime,
    memoryMedianMs: Number(memory.latencyMs.median.toFixed(2)),
    memorySlowestMs: Number(memory.latencyMs.slowest.toFixed(1)),
    memoryPassages: memory.corpus.passages,
    endpoints: endpointCount,
    agents: 100,
    idleMiB: Math.round((tenancy.results["100"]?.median.idleRssKb ?? 0) / 1024),
    dialect: tools.results.map((r) => ({
        model: r.id,
        nlt: Math.round(r.nlt.summary.accuracy * 1000) / 10,
        native: Math.round(r.native.summary.accuracy * 1000) / 10,
    })),
    version: cliPackage.version,
    /** The release line a reader can rely on, `0.2.x`, from the same version. */
    line: `${cliPackage.version.split(".").slice(0, 2).join(".")}.x`,
    /** The Node floor `npm` enforces, from `engines.node`. */
    node: cliPackage.engines.node.replace(/^>=\s*/, ""),
}
