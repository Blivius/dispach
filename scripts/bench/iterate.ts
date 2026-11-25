/**
 * The iterate family: fourteen small JavaScript projects whose hidden test suite fails. Each is a
 * README with the rules, code with bugs seeded into a working version, and the suite `run_check` runs.
 * The README is silent on a behaviour or two that only a failing test reveals, so reading alone does
 * not finish a task; a run is edits and checks until the suite passes.
 *
 * It measures what the 25-task suite cannot: work that takes several rounds of edit and check. The
 * bugs are patches on the working code (`seed`), which keeps them visible here and makes a patch that
 * no longer applies a load-time error rather than a task that silently passes.
 *
 * Project sources are String.raw so a regex keeps its backslashes, and use no backticks or "${".
 */
import type { Task } from "./tasks.ts"
import type { WorldState } from "./tools-server.ts"

interface Project {
    readonly id: string
    readonly readme: string
    /** Path → the working source and the bugs seeded into it, applied in order. */
    readonly code: Readonly<
        Record<
            string,
            { readonly fixed: string; readonly bugs: readonly (readonly [string, string])[] }
        >
    >
    /** Suite body: imports and a default export of test name → function that throws on failure. */
    readonly tests: string
}

// Prepended to every suite. `eq` compares by JSON so arrays and objects compare by value, with an
// object's keys sorted so the order a model's code happened to insert them in is not a failure.
const PRELUDE = String.raw`
const byKey = (key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value
const show = (value) => JSON.stringify(value, byKey)
function errorOf(fn) {
    try { fn() } catch (error) { return error.message }
    return "no error"
}
function eq(actual, expected, label) {
    if (show(actual) !== show(expected)) throw new Error(label + ": expected " + show(expected) + ", got " + show(actual))
}
function throws(fn, label) {
    try { fn() } catch { return }
    throw new Error(label + ": expected an error, got none")
}
`

function seed(path: string, source: string, bugs: readonly (readonly [string, string])[]): string {
    return bugs.reduce((text, [from, to]) => {
        if (!text.includes(from))
            throw new Error(`iterate: seeded bug not found in ${path}: ${from}`)
        return text.replace(from, to)
    }, source)
}

const passed = (s: WorldState): [boolean, string] => [
    s.check !== undefined && s.check.failures.length === 0,
    `tests still failing: ${s.check?.failures.map((f) => f.name).join(", ") ?? "no suite"}`,
]

function iterateTask(project: Project): Task {
    const paths = Object.keys(project.code)
    return {
        id: `iterate-${project.id}`,
        category: "iterate",
        world: {
            files: {
                "README.md": project.readme,
                ...Object.fromEntries(
                    paths.map((p) => [
                        p,
                        seed(p, project.code[p]?.fixed ?? "", project.code[p]?.bugs ?? []),
                    ]),
                ),
            },
            check: PRELUDE + project.tests,
        },
        turns: [
            `This project's tests are failing. The rules are in README.md and the code is in ${paths.join(" and ")}. Where the README is silent, the tests decide. Fix the code until run_check passes, then tell me briefly what you changed.`,
        ],
        grade: (s, reply) => {
            const [ok, why] = passed(s)
            if (reply.trim() === "") return "empty reply"
            return ok ? undefined : why
        },
        oracle: {
            calls: [
                ["read_file", { path: "README.md" }],
                ...paths.map((p): [string, Record<string, string>] => ["read_file", { path: p }]),
                ...paths.map((p): [string, Record<string, string>] => [
                    "write_file",
                    { path: p, content: project.code[p]?.fixed ?? "" },
                ]),
                ["run_check", {}],
            ],
            reply: "Fixed the seeded bugs; every test passes.",
        },
    }
}

// ── Staged projects: several modules, and a suite in stages whose later stages hold requirements the
// README never states. In the single-file projects above most bugs can be fixed by reading alone, so a
// capable model finishes in one write and one check; a stage that opens only after the previous one
// passes makes every run go round several times, the way wrap does when a fix exposes the next failure.

const LEDGER_AMOUNT = String.raw`// Amounts are integer cents.
const AMOUNT = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/

export function parseAmount(text) {
    if (!AMOUNT.test(text)) throw new Error("not an amount: " + text)
    const [whole, fraction = ""] = text.replaceAll(",", "").split(".")
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
    if (cents === 0) throw new Error("amount must be above zero")
    return cents
}

export function formatAmount(cents) {
    const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    return whole + "." + String(cents % 100).padStart(2, "0")
}
`

const LEDGER_TRANSFER = String.raw`        transfer(from, to, amount) {
            const cents = parseAmount(amount)
            const balance = need(from)
            need(to)
            if (cents > balance) throw new Error("insufficient funds in " + from)
            balances.set(from, balance - cents)
            balances.set(to, balances.get(to) + cents)
        },
`

const LEDGER_CORE = String.raw`import { parseAmount } from "./amount.js"

export function createLedger() {
    const balances = new Map()
    const refused = []

    function need(account) {
        if (!balances.has(account)) throw new Error("no account " + account)
        return balances.get(account)
    }

    const commands = {
        open(account) {
            if (balances.has(account)) throw new Error("account " + account + " is already open")
            balances.set(account, 0)
        },
        deposit(account, amount) {
            balances.set(account, need(account) + parseAmount(amount))
        },
        withdraw(account, amount) {
            const cents = parseAmount(amount)
            const balance = need(account)
            if (cents > balance) throw new Error("insufficient funds in " + account)
            balances.set(account, balance - cents)
        },
${LEDGER_TRANSFER}    }

    return {
        apply(line, number) {
            const [name, ...args] = line.trim().split(/\s+/)
            try {
                const command = Object.hasOwn(commands, name) ? commands[name] : undefined
                if (command === undefined || command.length !== args.length) throw new Error("unknown command")
                command(...args)
            } catch (error) {
                refused.push({ number, line: line.trim(), reason: error.message })
            }
        },
        balances: () => new Map(balances),
        refused: () => [...refused],
    }
}
`

const LEDGER_REPORT = String.raw`import { formatAmount } from "./amount.js"
import { createLedger } from "./ledger.js"

// The report for a list of commands, one per line.
export function run(text) {
    const ledger = createLedger()
    text.split("\n").forEach((line, i) => {
        if (line.trim() !== "") ledger.apply(line, i + 1)
    })
    const rows = [...ledger.balances()]
        .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
        .map(([account, cents]) => account + ": " + formatAmount(cents))
    const refused = ledger.refused().map((r) => "refused line " + r.number + ": " + r.line + " (" + r.reason + ")")
    return [...rows, ...(refused.length > 0 ? ["", ...refused] : [])].join("\n")
}
`

const GRAPH_CRITICAL = String.raw`
export function criticalPath(tasks, durations) {
    const finish = finishTimes(tasks, durations)
    const latest = (names) => [...names].sort((a, b) => finish[b] - finish[a] || (a < b ? -1 : 1))[0]
    const path = [latest(Object.keys(finish))]
    while (tasks[path[0]].length > 0) path.unshift(latest(tasks[path[0]]))
    return path
}
`

const GRAPH = String.raw`// A build plan: tasks is { name: [names it depends on] }.

function findCycle(waiting) {
    // Every waiting task has a waiting dependency, so following first dependencies must repeat.
    const path = []
    let name = [...waiting.keys()].sort()[0]
    while (!path.includes(name)) {
        path.push(name)
        name = [...waiting.get(name)].sort()[0]
    }
    return [...path.slice(path.indexOf(name)), name].join(" -> ")
}

export function order(tasks) {
    for (const [name, deps] of Object.entries(tasks)) {
        for (const dep of deps) {
            if (!Object.hasOwn(tasks, dep)) throw new Error(name + " depends on unknown task " + dep)
        }
    }
    const waiting = new Map(Object.entries(tasks).map(([name, deps]) => [name, new Set(deps)]))
    const out = []
    while (waiting.size > 0) {
        const ready = [...waiting].filter(([, deps]) => deps.size === 0).map(([name]) => name).sort()
        if (ready.length === 0) throw new Error("cycle: " + findCycle(waiting))
        const next = ready[0]
        out.push(next)
        waiting.delete(next)
        for (const deps of waiting.values()) deps.delete(next)
    }
    return out
}

export function finishTimes(tasks, durations) {
    const finish = {}
    for (const name of order(tasks)) {
        if (!(durations[name] >= 0)) throw new Error("no duration for " + name)
        finish[name] = Math.max(0, ...tasks[name].map((dep) => finish[dep])) + durations[name]
    }
    return finish
}
${GRAPH_CRITICAL}`

const STAGED: readonly Project[] = [
    {
        id: "ledger",
        readme: String.raw`# Ledger

run(text) applies commands, one per line, and returns a report.

- "open <account>" opens an account with a balance of 0.
- "deposit <account> <amount>" and "withdraw <account> <amount>" change one balance. Amounts are decimal strings with up to two places, like 12, 12.5 or 1,250.00.
- A withdrawal that would take a balance below zero is refused and changes nothing.
- The report lists every account, one per line, as "<account>: <balance>", with the balance to two decimal places.

The code is split across src/amount.js (reading and writing amounts), src/ledger.js (applying commands) and src/report.js (run and the report).
`,
        code: {
            "src/amount.js": {
                fixed: LEDGER_AMOUNT,
                bugs: [
                    [
                        String.raw`/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/`,
                        String.raw`/^[\d,]+(\.\d+)?$/`,
                    ],
                    ['fraction.padEnd(2, "0")', "fraction"],
                    ['    if (cents === 0) throw new Error("amount must be above zero")\n', ""],
                    [String.raw`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")`, ""],
                ],
            },
            "src/ledger.js": {
                fixed: LEDGER_CORE,
                bugs: [
                    [
                        '            if (balances.has(account)) throw new Error("account " + account + " is already open")\n',
                        "",
                    ],
                    [
                        "need(account) + parseAmount(amount)",
                        "(balances.get(account) ?? 0) + parseAmount(amount)",
                    ],
                    [
                        '            if (cents > balance) throw new Error("insufficient funds in " + account)\n            balances.set(account, balance - cents)',
                        '            balances.set(account, balance - cents)\n            if (cents > balance) throw new Error("insufficient funds in " + account)',
                    ],
                    [LEDGER_TRANSFER, ""],
                ],
            },
            "src/report.js": {
                fixed: LEDGER_REPORT,
                bugs: [
                    [
                        '    text.split("\\n").forEach((line, i) => {\n        if (line.trim() !== "") ledger.apply(line, i + 1)\n    })',
                        '    text\n        .split("\\n")\n        .filter((line) => line.trim() !== "")\n        .forEach((line, i) => ledger.apply(line, i + 1))',
                    ],
                    [
                        "\n        .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))",
                        "",
                    ],
                    [
                        '    return [...rows, ...(refused.length > 0 ? ["", ...refused] : [])].join("\\n")',
                        '    return rows.join("\\n")',
                    ],
                ],
            },
        },
        tests: String.raw`
import { run } from "./src/report.js"
const lines = (text) => run(text).split("\n")
const balancesOf = (text) => lines(text).filter((l) => l !== "" && !l.startsWith("refused"))
const refusedOf = (text) => lines(text).filter((l) => l.startsWith("refused")).map((l) => l.split(":")[0])
export default [
    {
        "deposit and withdraw": () => eq(run("open a\ndeposit a 10\nwithdraw a 2.5"), "a: 7.50", "the report after run(" + show("open a\ndeposit a 10\nwithdraw a 2.5") + ")"),
        "amounts with thousands separators": () =>
            eq(balancesOf("open a\ndeposit a 1,250.00\nwithdraw a 1,000"), ["a: 250.00"], "the balances after run(" + show("open a\ndeposit a 1,250.00\nwithdraw a 1,000") + ")"),
        "a refused withdrawal changes nothing": () =>
            eq(balancesOf("open a\ndeposit a 5\nwithdraw a 9"), ["a: 5.00"], "the balances after run(" + show("open a\ndeposit a 5\nwithdraw a 9") + ")"),
    },
    {
        "transfer moves money between accounts": () =>
            eq(balancesOf("open a\nopen b\ndeposit a 10\ntransfer a b 4"), ["a: 6.00", "b: 4.00"], "the balances after run(" + show("open a\nopen b\ndeposit a 10\ntransfer a b 4") + ")"),
        "a transfer that would overdraw changes nothing": () =>
            eq(balancesOf("open a\nopen b\ndeposit a 3\ntransfer a b 4"), ["a: 3.00", "b: 0.00"], "the balances after run(" + show("open a\nopen b\ndeposit a 3\ntransfer a b 4") + ")"),
        "an unknown account is refused, not opened": () =>
            eq(balancesOf("open a\ndeposit b 5\ntransfer a c 1"), ["a: 0.00"], "the balances after run(" + show("open a\ndeposit b 5\ntransfer a c 1") + ")"),
    },
    {
        "highest balance first, then by name": () =>
            eq(balancesOf("open c\nopen a\nopen b\ndeposit b 5\ndeposit c 5"), ["b: 5.00", "c: 5.00", "a: 0.00"], "the balances after run(" + show("open c\nopen a\nopen b\ndeposit b 5\ndeposit c 5") + ")"),
        "the report groups thousands": () => eq(balancesOf("open a\ndeposit a 1234567.5"), ["a: 1,234,567.50"], "the balances after run(" + show("open a\ndeposit a 1234567.5") + ")"),
        "refused commands follow a blank line, numbered by line in the input": () =>
            eq(
                run("open a\n\nwithdraw a 1\nfly a"),
                "a: 0.00\n\nrefused line 3: withdraw a 1 (insufficient funds in a)\nrefused line 4: fly a (unknown command)",
                "the report after run(" + show("open a\n\nwithdraw a 1\nfly a") + ")",
            ),
    },
    {
        "zero and malformed amounts are refused": () => {
            const text = "open a\ndeposit a 0\ndeposit a 1.234\ndeposit a -5\ndeposit a 7"
            eq(balancesOf(text), ["a: 7.00"], "the balances after run(" + show(text) + ")")
            eq(refusedOf(text), ["refused line 2", "refused line 3", "refused line 4"], "the refused lines after run(" + show(text) + ")")
        },
        "opening an account twice is refused": () => {
            const text = "open a\ndeposit a 1\nopen a"
            eq(balancesOf(text), ["a: 1.00"], "the balances after run(" + show(text) + ")")
            eq(refusedOf(text), ["refused line 3"], "the refused lines after run(" + show(text) + ")")
        },
    },
]
`,
    },
    {
        id: "build-plan",
        readme: String.raw`# Build plan

Tasks are { name: [names of the tasks it depends on] }.

- order(tasks) returns every task name, each after all of its dependencies.
- finishTimes(tasks, durations) returns { name: time }: when each task finishes if it starts the moment its last dependency finishes, and tasks with no dependencies start at 0.
`,
        code: {
            "src/graph.js": {
                fixed: GRAPH,
                bugs: [
                    [
                        '    for (const [name, deps] of Object.entries(tasks)) {\n        for (const dep of deps) {\n            if (!Object.hasOwn(tasks, dep)) throw new Error(name + " depends on unknown task " + dep)\n        }\n    }\n',
                        "",
                    ],
                    [".map(([name]) => name).sort()", ".map(([name]) => name)"],
                    [
                        '        if (ready.length === 0) throw new Error("cycle: " + findCycle(waiting))\n',
                        "",
                    ],
                    [
                        '        if (!(durations[name] >= 0)) throw new Error("no duration for " + name)\n',
                        "",
                    ],
                    [
                        "tasks[name].map((dep) => finish[dep])",
                        "tasks[name].map((dep) => durations[dep])",
                    ],
                    [GRAPH_CRITICAL, ""],
                ],
            },
        },
        tests: String.raw`
import * as graph from "./src/graph.js"
const diamond = { d: ["b", "c"], b: ["a"], c: ["a"], a: [] }
const durations = { a: 2, b: 3, c: 5, d: 1 }
export default [
    {
        "every task comes after its dependencies": () => {
            const out = graph.order(diamond)
            eq(out.length, 4, "order(diamond).length")
            for (const [name, deps] of Object.entries(diamond)) {
                for (const dep of deps) {
                    if (out.indexOf(dep) > out.indexOf(name)) throw new Error("order(diamond) is " + show(out) + ": " + dep + " comes after " + name)
                }
            }
        },
        "finish times follow the longest chain": () =>
            eq(graph.finishTimes(diamond, durations), { a: 2, b: 5, c: 7, d: 8 }, "finishTimes(diamond)"),
    },
    {
        "tasks that are ready go in name order": () => eq(graph.order({ c: [], a: [], b: ["c"] }), ["a", "c", "b"], "order({ c: [], a: [], b: [c] })"),
        "an unknown dependency is refused": () =>
            eq(errorOf(() => graph.order({ a: ["zz"] })), "a depends on unknown task zz", "the error from order({ a: [zz] })"),
        "a cycle is reported with its path": () =>
            eq(errorOf(() => graph.order({ a: ["b"], b: ["c"], c: ["b"], d: [] })), "cycle: b -> c -> b", "the error from order({ a: [b], b: [c], c: [b], d: [] })"),
    },
    {
        "the critical path": () =>
            eq(
                typeof graph.criticalPath === "function" ? graph.criticalPath(diamond, durations) : "no criticalPath export in src/graph.js",
                ["a", "c", "d"],
                "criticalPath(diamond, durations)",
            ),
        "a missing duration is refused": () =>
            eq(errorOf(() => graph.finishTimes({ a: [] }, {})), "no duration for a", "the error from finishTimes({ a: [] }, {})"),
    },
]
`,
    },
]

const PROJECTS: readonly Project[] = [
    {
        id: "cart",
        readme: String.raw`# Checkout

Amounts are integer cents. total(lines, code) prices a cart of { price, qty } lines.

- Discount codes: SAVE10 takes 10% off the subtotal. FIVEOFF takes 500 cents off, but never below zero.
- Discounts apply before tax. Tax is 8.25% of the discounted subtotal, rounded half up to the cent.
- Shipping is 599 cents, and free when the discounted subtotal is 5000 cents or more.
- The total is the discounted subtotal plus tax plus shipping.
`,
        code: {
            "src/money.js": {
                fixed: String.raw`// Every amount is integer cents.
export function roundCents(x) {
    return Math.floor(x + 0.5)
}

export function percentOf(cents, pct) {
    return roundCents((cents * pct) / 100)
}
`,
                bugs: [["return Math.floor(x + 0.5)", "return Math.floor(x)"]],
            },
            "src/cart.js": {
                fixed: String.raw`import { percentOf } from "./money.js"

const CODES = {
    SAVE10: (cents) => cents - percentOf(cents, 10),
    FIVEOFF: (cents) => Math.max(0, cents - 500),
}

export function subtotal(lines) {
    return lines.reduce((sum, line) => sum + line.price * line.qty, 0)
}

export function total(lines, code) {
    const base = subtotal(lines)
    let discounted = base
    if (code !== undefined) {
        const apply = CODES[code]
        if (apply === undefined) throw new Error("unknown discount code " + code)
        discounted = apply(base)
    }
    const tax = percentOf(discounted, 8.25)
    const shipping = discounted >= 5000 ? 0 : 599
    return discounted + tax + shipping
}
`,
                bugs: [
                    ["Math.max(0, cents - 500)", "cents - 500"],
                    [
                        'if (apply === undefined) throw new Error("unknown discount code " + code)\n        discounted = apply(base)',
                        "if (apply !== undefined) discounted = apply(base)",
                    ],
                    ["percentOf(discounted, 8.25)", "percentOf(base, 8.25)"],
                    ["discounted >= 5000", "base > 5000"],
                ],
            },
        },
        tests: String.raw`
import { subtotal, total } from "./src/cart.js"
const line = (price, qty = 1) => ({ price, qty })
export default {
    "subtotal sums price times qty": () => eq(subtotal([line(250, 2), line(99, 3)]), 797, "subtotal"),
    "tax rounds half up": () => eq(total([line(1000)]), 1682, "total of 1000"),
    "discounts apply before tax": () => eq(total([line(2000)], "SAVE10"), 2548, "2000 with SAVE10"),
    "shipping is free at exactly 5000": () => eq(total([line(5000)]), 5413, "total of 5000"),
    "free shipping looks at the discounted subtotal": () => eq(total([line(5200)], "SAVE10"), 5665, "5200 with SAVE10"),
    "FIVEOFF never goes below zero": () => eq(total([line(300)], "FIVEOFF"), 599, "300 with FIVEOFF"),
    "an unknown code is refused": () => throws(() => total([line(100)], "BOGUS"), "total with code BOGUS"),
}
`,
    },
    {
        id: "slug",
        readme: String.raw`# Slugs

slugify(title) turns a title into a URL slug:

- lowercase, with accents removed (é becomes e);
- every run of characters other than a-z and 0-9 becomes a single "-", with none at either end;
- at most 40 characters, cut at a "-" so no word is cut in half (a single word longer than 40 is cut at 40).

uniqueSlug(title, taken) returns the slug, or the slug with "-2", "-3" and so on appended, whichever comes first that is not in the Set taken.
`,
        code: {
            "src/slug.js": {
                fixed: String.raw`export function slugify(title) {
    const base = title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    if (base === "") return "untitled"
    if (base.length <= 40) return base
    const cut = base.slice(0, 41).lastIndexOf("-")
    return cut > 0 ? base.slice(0, cut) : base.slice(0, 40)
}

export function uniqueSlug(title, taken) {
    const slug = slugify(title)
    if (!taken.has(slug)) return slug
    let n = 2
    while (taken.has(slug + "-" + n)) n += 1
    return slug + "-" + n
}
`,
                bugs: [
                    [
                        String.raw`        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
`,
                        "",
                    ],
                    ["/[^a-z0-9]+/g", "/[^a-z0-9]/g"],
                    ["/^-+|-+$/g", "/^-+/"],
                    [
                        'const cut = base.slice(0, 41).lastIndexOf("-")\n    return cut > 0 ? base.slice(0, cut) : base.slice(0, 40)',
                        "return base.slice(0, 40)",
                    ],
                    ['    if (base === "") return "untitled"\n', ""],
                    ["let n = 2", "let n = 1"],
                ],
            },
        },
        tests: String.raw`
import { slugify, uniqueSlug } from "./src/slug.js"
export default {
    "accents are removed": () => eq(slugify("Crème Brûlée"), "creme-brulee", "slugify('Crème Brûlée')"),
    "runs of other characters become one dash": () => eq(slugify("Hello,   World"), "hello-world", "slugify('Hello,   World')"),
    "no dash at the end": () => eq(slugify("Done!"), "done", "slugify('Done!')"),
    "long titles are cut between words": () =>
        eq(
            slugify("the quick brown fox jumps over the lazy dog again"),
            "the-quick-brown-fox-jumps-over-the-lazy",
            "slugify of a 49-character title",
        ),
    "one long word is cut at 40": () => eq(slugify("a".repeat(50)), "a".repeat(40), "slugify of 50 a's"),
    "nothing left becomes untitled": () => eq(slugify("!!!"), "untitled", "slugify('!!!')"),
    "uniqueSlug starts counting at 2": () => {
        eq(uniqueSlug("Done", new Set(["done"])), "done-2", "uniqueSlug with done taken")
        eq(uniqueSlug("Done", new Set(["done", "done-2"])), "done-3", "uniqueSlug with done and done-2 taken")
    },
}
`,
    },
    {
        id: "csv",
        readme: String.raw`# CSV

parse(text) returns an array of rows, each an array of string fields.

- Fields are separated by commas. A field may be wrapped in double quotes; inside quotes a doubled quote ("") is one literal quote, and commas and line breaks belong to the field.
- Rows end with a line feed, or a carriage return and a line feed.
- A line break at the very end of the text does not start another row.
`,
        code: {
            "src/csv.js": {
                fixed: String.raw`export function parse(text) {
    const rows = []
    let row = []
    let field = ""
    let quoted = false
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i]
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"'
                i += 1
            } else if (c === '"') quoted = false
            else field += c
        } else if (c === '"') quoted = true
        else if (c === ",") {
            row.push(field)
            field = ""
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i += 1
            row.push(field)
            rows.push(row)
            row = []
            field = ""
        } else field += c
    }
    if (field !== "" || row.length > 0) {
        row.push(field)
        rows.push(row)
    }
    return rows
}
`,
                bugs: [
                    [
                        "if (c === '\"' && text[i + 1] === '\"') {\n                field += '\"'\n                i += 1\n            } else if (c === '\"') quoted = false",
                        "if (c === '\"') quoted = false",
                    ],
                    [String.raw`c === "\n" || c === "\r"`, String.raw`c === "\n"`],
                    ['if (field !== "" || row.length > 0)', 'if (field !== "")'],
                ],
            },
        },
        tests: String.raw`
import { parse } from "./src/csv.js"
export default {
    "plain rows": () => eq(parse("a,b\nc,d"), [["a", "b"], ["c", "d"]], "parse('a,b\\nc,d')"),
    "quoted fields keep commas and line breaks": () =>
        eq(parse('"x,y","one\ntwo"'), [["x,y", "one\ntwo"]], "parse of two quoted fields"),
    "a doubled quote is one quote": () => eq(parse('"say ""hi"""'), [['say "hi"']], "parse('\"say \"\"hi\"\"\"')"),
    "CRLF ends a row": () => eq(parse("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]], "parse with CRLF"),
    "a trailing comma is an empty field": () => eq(parse("a,"), [["a", ""]], "parse('a,')"),
    "a final line break adds no row": () => eq(parse("a\n"), [["a"]], "parse('a\\n')"),
    "an empty line is a row with one empty field": () => eq(parse("a\n\nb"), [["a"], [""], ["b"]], "parse('a\\n\\nb')"),
}
`,
    },
    {
        id: "semver",
        readme: String.raw`# Versions

compare(a, b) returns -1, 0 or 1 by Semantic Versioning 2.0.0 precedence:

- MAJOR.MINOR.PATCH compare as numbers, left to right.
- A pre-release (1.0.0-rc.1) is lower than the same version without one.
- Pre-release identifiers compare left to right: numeric ones as numbers, others as ASCII text, and numeric ones sort before the others. When every shared identifier is equal, the longer set is higher.

satisfiesCaret(version, range) answers whether a version is in a caret range: ^1.2.3 allows >=1.2.3 <2.0.0, ^0.2.3 allows >=0.2.3 <0.3.0, and ^0.0.3 allows only 0.0.3. A pre-release version never satisfies.
`,
        code: {
            "src/semver.js": {
                fixed: String.raw`function parseVersion(version) {
    const noBuild = version.split("+")[0]
    const dash = noBuild.indexOf("-")
    const core = dash === -1 ? noBuild : noBuild.slice(0, dash)
    const pre = dash === -1 ? [] : noBuild.slice(dash + 1).split(".")
    return { nums: core.split(".").map(Number), pre }
}

const isNumeric = (id) => /^\d+$/.test(id)

function compareIds(x, y) {
    if (isNumeric(x) && isNumeric(y)) return Math.sign(Number(x) - Number(y))
    if (isNumeric(x)) return -1
    if (isNumeric(y)) return 1
    return x < y ? -1 : x > y ? 1 : 0
}

export function compare(a, b) {
    const A = parseVersion(a)
    const B = parseVersion(b)
    for (let i = 0; i < 3; i += 1) {
        if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1
    }
    if (A.pre.length === 0 || B.pre.length === 0) return Math.sign(B.pre.length - A.pre.length)
    for (let i = 0; i < Math.min(A.pre.length, B.pre.length); i += 1) {
        const c = compareIds(A.pre[i], B.pre[i])
        if (c !== 0) return c
    }
    return Math.sign(A.pre.length - B.pre.length)
}

export function satisfiesCaret(version, range) {
    const base = range.replace(/^\^/, "")
    const [major, minor, patch] = parseVersion(base).nums
    if (parseVersion(version).pre.length > 0) return false
    const upper = major > 0 ? major + 1 + ".0.0" : minor > 0 ? "0." + (minor + 1) + ".0" : "0.0." + (patch + 1)
    return compare(version, base) >= 0 && compare(version, upper) < 0
}
`,
                bugs: [
                    ['version.split("+")[0]', "version"],
                    ['core.split(".").map(Number)', 'core.split(".")'],
                    [
                        "return Math.sign(Number(x) - Number(y))",
                        "return x < y ? -1 : x > y ? 1 : 0",
                    ],
                    [
                        "Math.sign(B.pre.length - A.pre.length)",
                        "Math.sign(A.pre.length - B.pre.length)",
                    ],
                    [
                        'major > 0 ? major + 1 + ".0.0" : minor > 0 ? "0." + (minor + 1) + ".0" : "0.0." + (patch + 1)',
                        'major + 1 + ".0.0"',
                    ],
                ],
            },
        },
        tests: String.raw`
import { compare, satisfiesCaret } from "./src/semver.js"
export default {
    "numeric parts compare as numbers": () => eq(compare("1.10.0", "1.9.0"), 1, "compare(1.10.0, 1.9.0)"),
    "a pre-release is lower than its release": () => {
        eq(compare("1.0.0-rc.1", "1.0.0"), -1, "compare(1.0.0-rc.1, 1.0.0)")
        eq(compare("1.0.0", "1.0.0-rc.1"), 1, "compare(1.0.0, 1.0.0-rc.1)")
    },
    "numeric identifiers compare as numbers": () =>
        eq(compare("1.0.0-alpha.2", "1.0.0-alpha.11"), -1, "compare(1.0.0-alpha.2, 1.0.0-alpha.11)"),
    "numeric identifiers sort before words": () =>
        eq(compare("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1, "compare(1.0.0-alpha.1, 1.0.0-alpha.beta)"),
    "the longer pre-release set is higher": () =>
        eq(compare("1.0.0-alpha", "1.0.0-alpha.1"), -1, "compare(1.0.0-alpha, 1.0.0-alpha.1)"),
    "build metadata is ignored": () =>
        eq(compare("1.0.0-beta+exp.sha.5114f85", "1.0.0-beta"), 0, "compare(1.0.0-beta+exp.sha.5114f85, 1.0.0-beta)"),
    "a caret below 1.0 stops at the next minor": () => {
        eq(satisfiesCaret("0.2.9", "^0.2.3"), true, "0.2.9 in ^0.2.3")
        eq(satisfiesCaret("0.3.0", "^0.2.3"), false, "0.3.0 in ^0.2.3")
    },
    "a caret from 1.0 stops at the next major": () => {
        eq(satisfiesCaret("1.9.9", "^1.2.3"), true, "1.9.9 in ^1.2.3")
        eq(satisfiesCaret("2.0.0", "^1.2.3"), false, "2.0.0 in ^1.2.3")
    },
    "a pre-release never satisfies": () => eq(satisfiesCaret("1.5.0-rc.1", "^1.2.3"), false, "1.5.0-rc.1 in ^1.2.3"),
}
`,
    },
    {
        id: "business-days",
        readme: String.raw`# Business days

addBusinessDays(date, n, holidays) moves n business days from date and returns the new date. Dates are "YYYY-MM-DD" strings, read as UTC calendar days.

- Business days are Monday to Friday, except the dates listed in holidays.
- A positive n moves forward and a negative n moves backward.
`,
        code: {
            "src/business-days.js": {
                fixed: String.raw`const DAY_MS = 86400000

const toDate = (iso) => new Date(iso + "T00:00:00Z")
const toIso = (date) => date.toISOString().slice(0, 10)

export function isBusinessDay(iso, holidays = []) {
    const day = toDate(iso).getUTCDay()
    return day !== 0 && day !== 6 && !holidays.includes(iso)
}

export function addBusinessDays(iso, n, holidays = []) {
    let date = toDate(iso)
    if (n === 0) {
        while (!isBusinessDay(toIso(date), holidays)) date = new Date(date.getTime() + DAY_MS)
        return toIso(date)
    }
    const step = n > 0 ? 1 : -1
    let left = Math.abs(n)
    while (left > 0) {
        date = new Date(date.getTime() + step * DAY_MS)
        if (isBusinessDay(toIso(date), holidays)) left -= 1
    }
    return toIso(date)
}
`,
                bugs: [
                    ["day !== 0 && day !== 6", "day !== 0"],
                    [" && !holidays.includes(iso)", ""],
                    [
                        "    if (n === 0) {\n        while (!isBusinessDay(toIso(date), holidays)) date = new Date(date.getTime() + DAY_MS)\n        return toIso(date)\n    }",
                        "    if (n === 0) return iso",
                    ],
                    ["const step = n > 0 ? 1 : -1", "const step = 1"],
                ],
            },
        },
        tests: String.raw`
import { addBusinessDays } from "./src/business-days.js"
// 2026-03-13 is a Friday.
export default {
    "the weekend is skipped": () => eq(addBusinessDays("2026-03-13", 1), "2026-03-16", "Friday + 1"),
    "holidays are skipped": () => eq(addBusinessDays("2026-03-13", 1, ["2026-03-16"]), "2026-03-17", "Friday + 1 over a Monday holiday"),
    "a negative n counts backward": () => eq(addBusinessDays("2026-03-16", -1), "2026-03-13", "Monday - 1"),
    "zero on a weekend moves to the next business day": () => eq(addBusinessDays("2026-03-14", 0), "2026-03-16", "Saturday + 0"),
    "a month end is crossed": () => eq(addBusinessDays("2026-03-30", 5), "2026-04-06", "2026-03-30 + 5"),
}
`,
    },
    {
        id: "lru",
        readme: String.raw`# LRU cache

new LRU(capacity) holds at most capacity entries.

- get(key) returns the value, or undefined, and makes key the most recently used.
- set(key, value) adds or replaces an entry and makes key the most recently used. When the cache is over capacity it drops the least recently used entry.
- delete(key) removes an entry and returns whether there was one. size is the number of entries, and keys() lists them from least to most recently used.
`,
        code: {
            "src/lru.js": {
                fixed: String.raw`export class LRU {
    #entries = new Map()

    constructor(capacity) {
        if (!Number.isInteger(capacity) || capacity < 0) {
            throw new RangeError("capacity must be a whole number, 0 or more")
        }
        this.capacity = capacity
    }

    get size() {
        return this.#entries.size
    }

    get(key) {
        if (!this.#entries.has(key)) return undefined
        const value = this.#entries.get(key)
        this.#entries.delete(key)
        this.#entries.set(key, value)
        return value
    }

    set(key, value) {
        this.#entries.delete(key)
        if (this.capacity === 0) return this
        this.#entries.set(key, value)
        if (this.#entries.size > this.capacity) this.#entries.delete(this.#entries.keys().next().value)
        return this
    }

    delete(key) {
        return this.#entries.delete(key)
    }

    keys() {
        return [...this.#entries.keys()]
    }
}
`,
                bugs: [
                    [
                        "        if (!this.#entries.has(key)) return undefined\n        const value = this.#entries.get(key)\n        this.#entries.delete(key)\n        this.#entries.set(key, value)\n        return value",
                        "        const value = this.#entries.get(key)\n        if (!value) return undefined\n        return value",
                    ],
                    [
                        "        this.#entries.delete(key)\n        if (this.capacity === 0)",
                        "        if (this.capacity === 0)",
                    ],
                    [
                        '        if (!Number.isInteger(capacity) || capacity < 0) {\n            throw new RangeError("capacity must be a whole number, 0 or more")\n        }\n',
                        "",
                    ],
                ],
            },
        },
        tests: String.raw`
import { LRU } from "./src/lru.js"
export default {
    "get makes a key the most recent": () => {
        const c = new LRU(2)
        c.set("a", 1)
        c.set("b", 2)
        c.get("a")
        c.set("c", 3)
        eq(c.keys(), ["a", "c"], "keys after get(a) then set(c)")
    },
    "set on an existing key makes it the most recent": () => {
        const c = new LRU(2)
        c.set("a", 1)
        c.set("b", 2)
        c.set("a", 9)
        c.set("c", 3)
        eq(c.keys(), ["a", "c"], "keys after set(a) again then set(c)")
        eq(c.get("a"), 9, "get(a)")
    },
    "stored falsy values come back": () => {
        const c = new LRU(2)
        c.set("zero", 0)
        c.set("empty", "")
        eq(c.get("zero"), 0, "get(zero)")
        eq(c.get("empty"), "", "get(empty)")
    },
    "capacity 0 keeps nothing": () => {
        const c = new LRU(0)
        c.set("a", 1)
        eq(c.size, 0, "size")
    },
    "a bad capacity is refused": () => {
        throws(() => new LRU(-1), "new LRU(-1)")
        throws(() => new LRU(1.5), "new LRU(1.5)")
    },
    "delete says whether it removed": () => {
        const c = new LRU(2)
        c.set("a", 1)
        eq(c.delete("a"), true, "delete(a)")
        eq(c.delete("a"), false, "delete(a) again")
    },
}
`,
    },
    {
        id: "roman",
        readme: String.raw`# Roman numerals

toRoman(n) writes n, from 1 to 3999, as a numeral using the subtractive forms (IV, IX, XL, XC, CD, CM). Anything outside that range throws a RangeError.

fromRoman(text) reads a numeral back. It accepts only the form toRoman writes, so IIII, VX or lowercase input throws.
`,
        code: {
            "src/roman.js": {
                fixed: String.raw`const TABLE = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
]
const VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

export function toRoman(n) {
    if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError(n + " is not a whole number from 1 to 3999")
    let out = ""
    for (const [value, numeral] of TABLE) {
        while (n >= value) {
            out += numeral
            n -= value
        }
    }
    return out
}

export function fromRoman(text) {
    let total = 0
    for (let i = 0; i < text.length; i += 1) {
        const value = VALUES[text[i]]
        if (value === undefined) throw new Error("not a roman numeral: " + text)
        const next = VALUES[text[i + 1]] ?? 0
        total += value < next ? -value : value
    }
    if (total < 1 || total > 3999 || toRoman(total) !== text) throw new Error("not a canonical roman numeral: " + text)
    return total
}
`,
                bugs: [
                    ['[90, "XC"], [50, "L"], [40, "XL"],', '[50, "L"],'],
                    ["!Number.isInteger(n) || n < 1 || n > 3999", "n < 1"],
                    ["total < 1 || total > 3999 || toRoman(total) !== text", "total < 1"],
                ],
            },
        },
        tests: String.raw`
import { fromRoman, toRoman } from "./src/roman.js"
export default {
    "subtractive forms": () => {
        eq(toRoman(94), "XCIV", "toRoman(94)")
        eq(toRoman(1944), "MCMXLIV", "toRoman(1944)")
    },
    "3999 is the largest": () => {
        eq(toRoman(3999), "MMMCMXCIX", "toRoman(3999)")
        throws(() => toRoman(4000), "toRoman(4000)")
    },
    "whole numbers only": () => throws(() => toRoman(1.5), "toRoman(1.5)"),
    "fromRoman reads what toRoman writes": () => eq(fromRoman("MCMXLIV"), 1944, "fromRoman(MCMXLIV)"),
    "fromRoman refuses anything else": () => {
        for (const text of ["IIII", "VX", "IC", "mc", ""]) throws(() => fromRoman(text), "fromRoman(" + show(text) + ")")
    },
}
`,
    },
    {
        id: "intervals",
        readme: String.raw`# Intervals

merge(intervals) takes [start, end] pairs in any order and returns their union as sorted pairs that do not overlap. Pairs that only touch, like [1, 3] and [3, 5], merge into one.

covered(intervals) is the total length the pairs cover, counting overlaps once.
`,
        code: {
            "src/intervals.js": {
                fixed: String.raw`export function merge(intervals) {
    for (const [start, end] of intervals) {
        if (start > end) throw new RangeError("[" + start + ", " + end + "] ends before it starts")
    }
    const sorted = intervals.map(([start, end]) => [start, end]).sort((a, b) => a[0] - b[0])
    const out = []
    for (const [start, end] of sorted) {
        const last = out.at(-1)
        if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
        else out.push([start, end])
    }
    return out
}

export function covered(intervals) {
    return merge(intervals).reduce((sum, [start, end]) => sum + end - start, 0)
}
`,
                bugs: [
                    [
                        '    for (const [start, end] of intervals) {\n        if (start > end) throw new RangeError("[" + start + ", " + end + "] ends before it starts")\n    }\n',
                        "",
                    ],
                    [
                        "intervals.map(([start, end]) => [start, end]).sort((a, b) => a[0] - b[0])",
                        "intervals.sort()",
                    ],
                    ["start <= last[1]", "start < last[1]"],
                    ["Math.max(last[1], end)", "end"],
                ],
            },
        },
        tests: String.raw`
import { covered, merge } from "./src/intervals.js"
export default {
    "unsorted input comes back sorted": () => eq(merge([[5, 8], [1, 3]]), [[1, 3], [5, 8]], "merge([[5,8],[1,3]])"),
    "pairs sort by number, not text": () => eq(merge([[10, 12], [2, 4]]), [[2, 4], [10, 12]], "merge([[10,12],[2,4]])"),
    "touching pairs merge": () => eq(merge([[1, 3], [3, 5]]), [[1, 5]], "merge([[1,3],[3,5]])"),
    "a pair inside another does not shrink it": () => eq(merge([[1, 10], [2, 3]]), [[1, 10]], "merge([[1,10],[2,3]])"),
    "the input is left as it was": () => {
        const input = [[5, 6], [1, 2], [2, 4]]
        const before = show(input)
        merge(input)
        eq(show(input), before, "the input after merge")
    },
    "a pair that ends before it starts is refused": () => throws(() => merge([[3, 1]]), "merge([[3,1]])"),
    "covered counts overlaps once": () => eq(covered([[1, 3], [2, 6], [10, 11]]), 6, "covered([[1,3],[2,6],[10,11]])"),
}
`,
    },
    {
        id: "template",
        readme: String.raw`# Templates

render(template, data) fills in tags from data:

- {{ path }} inserts the value at a dotted path such as user.name, HTML-escaped: & < > " and ' become &amp; &lt; &gt; &quot; and &#39;.
- {{{ path }}} inserts the value without escaping.
- Spaces inside the braces are optional.
- A missing value, null or undefined renders as nothing; any other value renders as text, so 0 shows as 0.
`,
        code: {
            "src/render.js": {
                fixed: String.raw`const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const TAG = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g

function lookup(data, path) {
    return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data)
}

const show = (value) => (value == null ? "" : String(value))
const escape = (text) => text.replace(/[&<>"']/g, (c) => ESCAPES[c])

export function render(template, data) {
    return template.replace(TAG, (_, raw, escaped) =>
        raw !== undefined ? show(lookup(data, raw)) : escape(show(lookup(data, escaped))),
    )
}
`,
                bugs: [
                    [`/[&<>"']/g`, "/[<>]/g"],
                    [
                        'return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data)',
                        "return data[path]",
                    ],
                    ['(value == null ? "" : String(value))', '(value ? String(value) : "")'],
                    [
                        "    return template.replace(TAG, (_, raw, escaped) =>\n        raw !== undefined ? show(lookup(data, raw)) : escape(show(lookup(data, escaped))),\n    )",
                        String.raw`    return template
        .replace(/\{\{\{ ([\w.]+) \}\}\}/g, (_, path) => show(lookup(data, path)))
        .replace(/\{\{ ([\w.]+) \}\}/g, (_, path) => escape(show(lookup(data, path))))`,
                    ],
                ],
            },
        },
        tests: String.raw`
import { render } from "./src/render.js"
export default {
    "dotted paths reach into objects": () => eq(render("Hi {{ user.name }}", { user: { name: "Ada" } }), "Hi Ada", "render with user.name"),
    "spaces inside the braces are optional": () => eq(render("{{name}}!", { name: "Bo" }), "Bo!", "render('{{name}}!')"),
    "all five characters are escaped": () =>
        eq(
            render("{{ s }}", { s: "<a href=\"x\">Tom & Jerry's</a>" }),
            "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
            "render of an HTML string",
        ),
    "triple braces are not escaped": () => eq(render("{{{ html }}}", { html: "<b>x</b>" }), "<b>x</b>", "render('{{{ html }}}')"),
    "inserted text is never rendered again": () =>
        eq(render("{{{ a }}}", { a: "{{ b }}", b: "no" }), "{{ b }}", "render where a holds a tag"),
    "0 and false are shown": () => eq(render("{{ n }} {{ f }}", { n: 0, f: false }), "0 false", "render of 0 and false"),
    "a missing path renders nothing": () => eq(render("[{{ nope.deeper }}]", {}), "[]", "render of a missing path"),
}
`,
    },
    {
        id: "allocate",
        readme: String.raw`# Allocation

allocate(amount, ratios) splits amount, a whole number of cents, into shares in proportion to ratios (numbers 0 or more, at least one above 0).

- Each share starts as its exact share rounded down. The cents left over go one each to the shares with the largest remainders, and a tie goes to the earlier share.
- The shares always add up to amount.
`,
        code: {
            "src/allocate.js": {
                fixed: String.raw`export function allocate(amount, ratios) {
    if (!Number.isInteger(amount)) throw new RangeError("amount must be whole cents")
    const sum = ratios.reduce((total, ratio) => total + ratio, 0)
    if (!(sum > 0) || ratios.some((ratio) => ratio < 0)) {
        throw new RangeError("ratios must be 0 or more, with at least one above 0")
    }
    if (amount < 0) return allocate(-amount, ratios).map((share) => -share)
    const exact = ratios.map((ratio) => (amount * ratio) / sum)
    const shares = exact.map(Math.floor)
    let left = amount - shares.reduce((total, share) => total + share, 0)
    const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    for (const [, i] of order) {
        if (left === 0) break
        shares[i] += 1
        left -= 1
    }
    return shares
}
`,
                bugs: [
                    [
                        '    if (!Number.isInteger(amount)) throw new RangeError("amount must be whole cents")\n',
                        "",
                    ],
                    [
                        "    if (amount < 0) return allocate(-amount, ratios).map((share) => -share)\n",
                        "",
                    ],
                    [".sort((a, b) => b[0] - a[0] || a[1] - b[1])", ""],
                ],
            },
        },
        tests: String.raw`
import { allocate } from "./src/allocate.js"
export default {
    "shares add up to the amount": () => eq(allocate(100, [1, 1, 1]), [34, 33, 33], "allocate(100, [1,1,1])"),
    "the leftover cent goes to the largest remainder": () => eq(allocate(100, [1, 2]), [33, 67], "allocate(100, [1,2])"),
    "a tie goes to the earlier share": () => eq(allocate(10, [1, 1, 1, 1, 1, 1]), [2, 2, 2, 2, 1, 1], "allocate(10, six 1s)"),
    "a negative amount mirrors the positive split": () => eq(allocate(-100, [1, 1, 1]), [-34, -33, -33], "allocate(-100, [1,1,1])"),
    "a zero ratio gets nothing": () => eq(allocate(5, [0, 1]), [0, 5], "allocate(5, [0,1])"),
    "fractions of a cent are refused": () => throws(() => allocate(10.5, [1]), "allocate(10.5, [1])"),
    "ratios that sum to zero are refused": () => throws(() => allocate(10, [0, 0]), "allocate(10, [0,0])"),
}
`,
    },
    {
        id: "wrap",
        readme: String.raw`# Word wrap

wrap(text, width) re-flows text into lines of at most width characters.

- Words are separated by spaces or line breaks. A blank line separates paragraphs, and paragraphs stay separated by one blank line.
- Each line holds as many words as fit, joined by single spaces.
- A word longer than width is broken into pieces of width characters.
`,
        code: {
            "src/wrap.js": {
                fixed: String.raw`export function wrap(text, width) {
    if (!Number.isInteger(width) || width < 1) throw new RangeError("width must be a whole number, 1 or more")
    return text.split(/\n\s*\n/).map((paragraph) => wrapParagraph(paragraph, width)).join("\n\n")
}

function wrapParagraph(paragraph, width) {
    const words = paragraph.split(/\s+/).filter(Boolean).flatMap((word) => pieces(word, width))
    const lines = []
    let line = ""
    for (const word of words) {
        if (line === "") line = word
        else if (line.length + 1 + word.length <= width) line += " " + word
        else {
            lines.push(line)
            line = word
        }
    }
    if (line !== "") lines.push(line)
    return lines.join("\n")
}

function pieces(word, width) {
    const out = []
    for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width))
    return out
}
`,
                bugs: [
                    [
                        '    if (!Number.isInteger(width) || width < 1) throw new RangeError("width must be a whole number, 1 or more")\n',
                        "",
                    ],
                    [
                        String.raw`return text.split(/\n\s*\n/).map((paragraph) => wrapParagraph(paragraph, width)).join("\n\n")`,
                        "return wrapParagraph(text, width)",
                    ],
                    [String.raw`paragraph.split(/\s+/)`, "paragraph.split(/ +/)"],
                    [".filter(Boolean).flatMap((word) => pieces(word, width))", ".filter(Boolean)"],
                    [
                        "line.length + 1 + word.length <= width",
                        "line.length + 1 + word.length < width",
                    ],
                ],
            },
        },
        tests: String.raw`
import { wrap } from "./src/wrap.js"
export default {
    "a line fills to exactly the width": () => eq(wrap("aaa bbb ccc", 7), "aaa bbb\nccc", "wrap('aaa bbb ccc', 7)"),
    "a long word is broken into pieces": () => eq(wrap("abcdefghij", 4), "abcd\nefgh\nij", "wrap('abcdefghij', 4)"),
    "paragraphs stay apart": () => eq(wrap("one two\n\nthree four", 9), "one two\n\nthree\nfour", "wrap of two paragraphs at 9"),
    "a single line break is a space": () => eq(wrap("one\ntwo", 20), "one two", "wrap('one\\ntwo', 20)"),
    "runs of spaces collapse": () => eq(wrap("a    b", 10), "a b", "wrap('a    b', 10)"),
    "a width below 1 is refused": () => throws(() => wrap("a", 0), "wrap('a', 0)"),
}
`,
    },
    {
        id: "limiter",
        readme: String.raw`# Rate limiter

createLimiter({ capacity, refillPerSecond, now }) is a token bucket. now() returns the time in milliseconds.

- The bucket starts full and refills continuously at refillPerSecond tokens per second, never above capacity.
- take(cost) takes cost tokens (default 1) and returns true, or returns false when fewer than cost are available.
- available() returns the whole number of tokens available now.
`,
        code: {
            "src/limiter.js": {
                fixed: String.raw`export function createLimiter({ capacity, refillPerSecond, now }) {
    let tokens = capacity
    let last = now()

    function refill() {
        const t = now()
        if (t > last) {
            tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSecond)
            last = t
        }
    }

    return {
        take(cost = 1) {
            refill()
            if (cost > tokens) return false
            tokens -= cost
            return true
        },
        available() {
            refill()
            return Math.floor(tokens)
        },
    }
}
`,
                bugs: [
                    ["((t - last) / 1000) * refillPerSecond", "(t - last) * refillPerSecond"],
                    [
                        "Math.min(capacity, tokens + (t - last) * refillPerSecond)",
                        "tokens + (t - last) * refillPerSecond",
                    ],
                    [
                        "        if (t > last) {\n            tokens = tokens + (t - last) * refillPerSecond\n            last = t\n        }",
                        "        tokens = tokens + (t - last) * refillPerSecond\n        last = t",
                    ],
                    [
                        "            if (cost > tokens) return false\n            tokens -= cost\n            return true",
                        "            tokens -= cost\n            return tokens >= 0",
                    ],
                ],
            },
        },
        tests: String.raw`
import { createLimiter } from "./src/limiter.js"
function setup(capacity, refillPerSecond) {
    const clock = { t: 0 }
    return { clock, limiter: createLimiter({ capacity, refillPerSecond, now: () => clock.t }) }
}
export default {
    "the bucket starts full": () => {
        const { limiter } = setup(5, 1)
        eq(limiter.take(5), true, "take(5) from a full bucket of 5")
        eq(limiter.take(), false, "take() from an empty bucket")
    },
    "refill is per second": () => {
        const { clock, limiter } = setup(10, 2)
        limiter.take(10)
        clock.t += 500
        eq(limiter.available(), 1, "available() 500 ms after emptying, at 2 per second")
    },
    "the bucket never fills past capacity": () => {
        const { clock, limiter } = setup(3, 1)
        clock.t += 10000
        eq(limiter.available(), 3, "available() after 10 s with capacity 3")
    },
    "a refused take costs nothing": () => {
        const { clock, limiter } = setup(2, 2)
        limiter.take(2)
        eq(limiter.take(), false, "take() from an empty bucket")
        clock.t += 500
        eq(limiter.available(), 1, "available() 500 ms later")
    },
    "a clock that goes back adds nothing": () => {
        const { clock, limiter } = setup(2, 2)
        limiter.take(2)
        clock.t -= 1000
        eq(limiter.available(), 0, "available() after the clock went back 1 s")
        clock.t += 1500
        eq(limiter.available(), 1, "available() once the clock is 500 ms past where it was")
    },
}
`,
    },
    ...STAGED,
]

export const ITERATE_TASKS: readonly Task[] = PROJECTS.map(iterateTask)
