# 25 — Source security scans, by a provider that cannot be pointed elsewhere

Status: **proposed** (drafted 2026-11-01; not accepted, no decisions recorded, no issue yet). Phase
37. Once accepted it is binding the way `02` and `04` are: a field, tool or rule it names changes
here in the same PR as the code.

## The problem

An agent asked "is there anything exploitable in this repository" has two answers today, and both
are wrong. It can read files with `file_read` and reason, which is a code review by a model with no
tooling. Or, with `--system full`, it can run a scanner through `exec`, which works and cannot be
bounded: the policy engine matches the command string, so `exec(strix:*)` authorises a scan of
*any* target the model types, which is the same hole recorded for `exec` growing an `env` map. On a
runtime an embedder uses to host other people's agents, "this agent may scan this repository and
nothing else" has to be a property of the tool, not of the model's restraint.

[Strix](https://github.com/usestrix/strix) (Apache-2.0) is an open-source scanner with a headless
mode, `strix -n --target <dir>`, that reports findings and exits non-zero when it finds any.
This spec wraps it as a provider whose target the agent cannot choose.

## Decisions taken for this spec (Moeen, 2026-11-01)

| | |
| --- | --- |
| Scope | **Source only.** The provider scans a checkout of one configured repository. No live host, URL, API spec or staging target. |
| Report | Delivered to the agent's configured recipients by default. Who those recipients are is the embedder's business, not the runtime's. |
| Shape | A provider package, `packages/tools-strix`, not a skill over `exec`. A skill stays possible for a local spike and is not what ships. |

## Design

### The tool

One tool, `security_scan`, with **no target argument**.

| Argument | Type | Meaning |
| --- | --- | --- |
| `ref` | string, optional | A branch, tag or commit **of the configured repository**. Validated against git's ref grammar before any process starts. Default: the repository's default branch. |
| `mode` | `quick \| standard`, optional | Passed through as Strix's `--scan-mode`. Default `quick`. |

The repository comes from the manifest. This follows the same rule as `memory_write` having no file
argument and `exec` having no `env`: a field that lets the model choose the target is the hole, and
leaving it out is cheaper than writing a guard for it. `policyArg: "ref"` makes `deny
security_scan(main)` expressible if anybody wants that.

`trust: "untrusted"`, because the report quotes repository content and repository content can carry
prompt injection. `mutating: true`, because a scan costs money and starts containers, and that
default also means it is never retried. Together they mean one scan per turn unless `policy.allow`
names the tool, which is the right default here: a turn that wants two scans is a loop.

### What the provider does

1. **Clone.** A shallow clone of `repo` at `ref` into a fresh directory under the agent's state
   directory, using `tokenEnv` for a private repository. The token reaches `git` through the
   credential environment, never through a URL, and never reaches Strix: Strix gets a local
   directory, so the credential never leaves the clone step. All four non-interactive controls
   apply (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`, `SSH_ASKPASS`, ssh `BatchMode=yes`), plus a
   wall-clock bound, as everywhere else `git` runs.
2. **Scan.** `strix -n --scan-mode <mode> --target <clone>` with Strix's own model configured
   from `model` (below), through the same spawn path `tools-system` uses (process group, reaped by
   `stop()`, timing out five seconds before `ToolContext.deadlineMs`).
3. **Return.** A bounded summary (counts by severity, then one line per finding: title, file,
   severity) sized to fit `observationMaxTokens`. The full report becomes an artifact, read with
   `artifact_read` by the id the summary names, as compaction already does.
4. **Clean up.** The clone is deleted whatever the outcome. Strix's `strix_runs/` output is copied
   into the artifact first.

Exit codes are read literally: non-zero with findings is a **successful scan that found
something**, and the tool must not report it as a failure. Any other non-zero exit is a
`ToolError` with a hint, never an empty report, because an empty report reads as "clean".

### Manifest

```yaml
tools:
  providers:
    strix:
      repo: https://github.com/acme/widgets   # the only thing this agent can scan
      tokenEnv: SCAN_GITHUB_TOKEN             # optional; needed for a private repository
      model:                                  # Strix's own LLM calls, not the agent's
        id: deepseek-v4-pro
        apiKeyEnv: SCAN_MODEL_API_KEY
        baseUrl: https://api.deepseek.com/v1  # optional
      runner: local                           # local | cloud: see "Where Docker runs"
  pinned: [security_scan]
```

Secrets are environment variable names (hard rule 10). `model` is separate from `model.main`
because Strix makes its own calls with its own cost, and an operator should see that bill as a
separate line.

### The floor

`repo`, `tokenEnv` and `runner` are **the person's**, by the rule that already covers `allowFrom`
and `writeRoots`: enabling a capability is the agent's job, deciding where it points is the
person's. `floorRefusal` (`packages/core/src/manifest/edit.ts`) refuses them as a path segment
**and** as a key nested anywhere inside a `tools.providers` value, the two shapes `writeRoots`
needed. An agent that could rewrite `repo` could be talked into scanning a stranger's repository by
the message it is reading.

`config` (the person's editor) is not floored, as always.

### Where Docker runs

Strix requires a running Docker daemon for its sandbox. That is the hardest constraint in this
spec, and it is deployment-shaped:

| `runner` | Where the sandbox runs | Cost |
| --- | --- | --- |
| `local` | The Docker daemon visible to the runtime's process. | Fine on a laptop or a VM. In a container this means mounting the host's Docker socket, which is **root on the host**. Never the default in the image, and the image docs say so. |
| `cloud` | Strix's managed service (`strix cloud`). | No daemon needed, but the source leaves the deployment. That is a data-handling decision for whoever owns the repository, and the manifest comment must say so. |

A third option, a scan worker with its own daemon reached over the network, is the right shape for
a multi-tenant host, and it is out of scope here (see Non-goals). Containment stays a deployment
concern: the provider decides *whether* a scan runs, and the deployment decides *where*.

### Reporting

The runtime already has every piece:

- **Scheduled.** A Phase 8 schedule with `tools: [security_scan]` and a `deliver` target sends the
  summary through the idempotent outbox. A nightly scan is configuration, not code.
- **On demand.** A person asks in any channel and the reply carries the summary.
- **Memory.** Accepted risks and known false positives are notes in the agent's memory, so the next
  run's summary can mark them as already seen. This uses the existing `memory_write`; there is no
  new store.

Deciding who counts as a recipient (a project's members, for example) is the embedder's job, done
over `/v1` by writing `deliver` targets. The runtime has no idea what a project is, and must not
learn.

### `init` and slot 2

By the standing directive, every capability gets a question: `init` asks whether the agent scans a
repository and, if yes, for its URL. `--scan <url>` is the flag. Slot 2 gains a `security scan` row
that names the repository or says `none`, because an agent that does not know a capability exists
will not reach for it.

## Non-goals

- **Live targets.** No URL, host, staging environment, API spec or Postman collection, even though
  Strix accepts all of them. A later phase adds them only with a per-target authorisation that the
  person writes and the agent cannot.
- **More than one repository per agent.** One repository per agent keeps the floor simple. A team
  with three repositories runs three agents or a later phase.
- **Fixing.** Opening an issue, an advisory or a PR is a separate capability (Composio's GitHub
  tools already cover it) and is not wired here.
- **A remote scan worker.** See "Where Docker runs".
- **Parsing Strix's report into a stable schema.** The format is not documented upstream. The
  summary is best-effort and the artifact holds the raw output, so nothing is lost when the format
  changes.
- **Anything about projects, members or teams.** That belongs to the embedder.

## Open questions (a spike answers these before building)

1. **Does a local-directory scan stay source-only?** It is not yet verified whether Strix, given a
   directory, builds and runs the code inside its sandbox, and if so what network access that
   sandbox has. If it reaches the network, "source only" needs a network-off sandbox setting or it
   is not true.
2. **How long does a quick scan of a mid-sized repository take, and what does it cost?** Both are
   unmeasured. A scan longer than the turn timeout needs either a schedule with a raised `timeoutMs`
   or an asynchronous start-then-report shape, and the second is a bigger phase.
3. **What does `strix_runs/<run>` contain on disk?** That decides how much of the summary can be
   structured.
4. **Does `runner: cloud` accept a local directory or only a repository URL?** If only a URL, the
   token would have to reach Strix's service, and the clone-locally guarantee in "What the provider
   does" stops holding for that runner.

## Acceptance

Run in the container (the deployment target) with `runner: local` against a disposable host, and on
the Mac:

1. `security_scan` against a small repository seeded with one known-vulnerable file reports it, with
   the full report readable through `artifact_read`.
2. `config_set tools.providers.strix.repo …` is refused by the floor, and so is a `repo` nested
   inside a value written to `tools.providers`. Each guard goes red with its fix reverted.
3. A manifest with a literal token in place of `tokenEnv` fails validation.
4. A `ref` of `main; rm -rf ~` or `--upload-pack=…` is refused before any process starts.
5. A scan killed by the deadline leaves no Strix process, no container and no clone behind.
6. A Strix failure (no Docker daemon, a bad key) is a `ToolError` whose hint names the cause, and
   never an empty report.
7. A schedule with `tools: [security_scan]` delivers its summary to Telegram.
8. `validate` and `run` agree on every manifest above.
9. `bench:boot` is unchanged: the provider spawns nothing and touches no network before
   `runtime.ready`.
