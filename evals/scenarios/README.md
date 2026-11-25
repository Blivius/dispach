# Scenario evals — layer 2

A real agent, a real model, **mocked tools**, and a judge. The packages' own tests are layer 1
(the machinery against a fake endpoint). This layer answers whether *this agent, with this prompt,
on this model*, does the job.

```bash
JUDGE_BASE_URL=https://api.deepseek.com/v1 JUDGE_MODEL=deepseek-v4-flash JUDGE_API_KEY_ENV=MODEL_API_KEY \
  bun run eval:scenarios evals/scenarios/example --runs 3 --threshold 0.8
```

A suite is a directory: `suite.yaml` (the agent, its mocked tools, calibration cases) and
`scenarios/*.yaml` (one conversation each). A step has a `prompt`, the `expected_calls` checked
against the call log (`in_order`, `exact`, or `any_order`; an empty `exact` means no tool at all),
an optional `max_calls` ceiling on how many calls the step may make to the suite's mocked tools
(built-ins such as `now` are not counted), up to four **binary**
`criteria`, and the `mocks` its tools return. Details are in
`scripts/eval-scenarios.ts`.

**The rules:**
- The model is never mocked, only its tools.
- What code can decide (which calls, which arguments, how many), code decides. Two of DeepEval's
  agent metrics are this rule already: argument correctness is `expected_calls[].args`, step
  efficiency is `max_calls`. Its knowledge retention is a scenario shape, `05-retention.yaml`.
- The judge is a different model, answers pass or fail per criterion, and is calibrated on
  known cases before anything is scored.
- A scenario's result is a pass count over runs ("4 of 5"). One below the threshold fails the run.
- **Prompt changes are deploys.** Rerun a template's suite before changing its prompt, its
  workspace or its model.
- A labelled failure from real use becomes a new scenario.

## `example/` — 2026-11-25, deepseek-v4-pro judged by deepseek-v4-flash, 2 runs

| scenario | result |
| --- | --- |
| calendar-today | 0 of 2 |
| email-send | 2 of 2 |
| no-tool-needed | 2 of 2 |
| follow-up | 2 of 2 |
| retention | 2 of 2 |

`calendar-today` passed 2 of 2 on 2026-09-27 and fails now only because `max_calls: 1` is new: in
both runs the agent called `calendar_list_events` twice for one question, and every criterion
passed. That is the point of the check, and it is a routing finding rather than a reply one.

`retention`'s first draft failed 0 of 2 for two reasons worth keeping. Its first step required no
call at all, and one run looked at Friday's calendar before acknowledging the move, which is
reasonable, so the step no longer constrains calls. In the other run the whole reply was
`now timezone: UTC format: iso`: a `now` call written as bare fields with no `ACTION:` line,
parsed as prose and delivered as the answer. The example agent runs the default NLT dialect, so
this is the invented-format class the parser's `malformed` backstop exists for, and that shape is
not caught. Not fixed here; recorded so it is not lost.

Proven able to fail. With the dentist removed from the calendar mock, *"Mentions the dentist at
15:30"* failed. With the expected recipient changed to `bob@example.com`, the call check failed and
named both addresses. A judge set to the agent's own model is refused.
