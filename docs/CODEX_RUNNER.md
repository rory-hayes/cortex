# Codex Backlog Runner

This repository includes a local, repo-specific Codex backlog runner. It reads `BACKLOG.md`, selects Ready tasks, and runs a controlled plan, approve, implement, review, validate, fix, commit, push, and draft PR workflow.

The runner is deliberately conservative. It is built for auditability and reviewability, not speed.

## Commands

```bash
pnpm install
pnpm codex-runner -- --limit=1
pnpm codex-runner -- --limit=5
pnpm codex-runner -- --all
```

By default the runner stops after writing the plan to `runs/<run-id>/plan.md`.

Implementation requires explicit approval:

```bash
pnpm codex-runner -- --limit=1 --approve-plan
```

To allow the runner to merge passing task branches into `main` and continue to the next Ready task, add `--auto-merge`:

```bash
pnpm codex-runner -- --limit=5 --approve-plan --auto-merge
```

To test parallel worker slots for independent Ready tasks, add `--concurrency=N`:

```bash
pnpm codex-runner -- --all --approve-plan --auto-merge --concurrency=2
```

Concurrency is deliberately opt-in and conservative. Values greater than `1` require both `--approve-plan` and `--auto-merge`, because parallel work only becomes safe when the runner can feed completed task branches through its serial merge queue. Start with `--concurrency=2` while testing local machine load, Codex rate limits, and merge behavior.

`--auto-merge` is intentionally opt-in. Before every merge, the runner runs full repository verification:

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run format:check`
- `pnpm test`

If any required command fails, the runner stops before merging and reports `merge_blocked`.

With `--concurrency>1`, worker slots can plan, implement, review, validate, commit, push, and open draft PRs in parallel for independent Ready tasks. Merging remains serial: before each queued merge, the runner refreshes that task branch from latest `origin/main`, prepares the refreshed worktree dependencies again, records final `BACKLOG.md` and `README.md` status on the refreshed branch, pushes the refreshed branch, runs the full verification set above inside the task worktree, fast-forwards `main`, pushes `main`, and cleans up the task branch/worktree. If one worker fails, other independent completed workers can still merge. If a queued branch cannot refresh, validate, or merge, the merge queue stops without weakening gates.

The concurrency mode is for independent tasks only. Dependencies are still enforced through `BACKLOG.md`, and tasks that depend on unfinished or failed work are not selected.

Concurrent workers also defer repo bookkeeping. Worker prompts tell Codex not to edit `BACKLOG.md` or `README.md`; the merge queue applies those updates after branch refresh so multiple workers do not constantly conflict on the same status files. If an older or retried branch still has a bookkeeping-only rebase conflict in `BACKLOG.md` or `README.md`, the runner keeps latest `main` for those files, continues the rebase, reapplies current task bookkeeping, and then validates before merge. Source-code conflicts still block.

Verification-only milestone tasks may produce no source changes in worker mode. The runner treats those as bookkeeping-only queue entries instead of failing on an empty source commit; the serial merge queue then records `BACKLOG.md` and `README.md`, opens or reuses the task PR, runs full verification, and merges only if the refreshed branch is clean.

The scheduler reads `Files Likely Touched:` from `BACKLOG.md`, normalizes markdown-wrapped path entries such as `` `BACKLOG.md` ``, and avoids filling parallel slots with Ready tasks that are expected to edit the same non-bookkeeping file. `BACKLOG.md` and `README.md` are ignored for this overlap check because the merge queue owns them in concurrent mode.

Codex phases retry transient failures twice by default. Override that budget when needed:

```bash
pnpm codex-runner -- --limit=5 --approve-plan --auto-merge --codex-attempts=3
```

Codex phases use a 10-minute timeout by default. Larger contract or orchestration tasks can use a longer phase budget:

```bash
pnpm codex-runner -- --limit=5 --approve-plan --auto-merge --codex-attempts=2 --codex-timeout-ms=1800000
```

Timeout artifacts are intentionally concise. They keep the phase, retry status, and timeout reason without preserving long Codex startup warning streams.

Use `--dry-run` to check selection and readiness without invoking Codex, implementation, commit, push, or PR creation:

```bash
pnpm codex-runner -- --limit=1 --dry-run
```

## Local Dashboard

The repository also includes a read-only local dashboard for watching the runner without asking Codex for status:

```bash
pnpm codex-runner-dashboard
```

By default it serves `http://127.0.0.1:8787` for the current repository. Use a different port when needed:

```bash
pnpm codex-runner-dashboard -- --port=8790
```

The dashboard reads local metadata only:

- `.codex-runner.lock`
- `BACKLOG.md`
- `runs/<run-id>/summary.json`
- active task worktree names
- local git task commit metadata

It is intentionally read-only. It does not invoke Codex, merge branches, clean worktrees, mutate backlog files, read source contents, display raw diffs or patches, or send data outside the local machine.

The dashboard shows current runner health, ready tasks, recent runs, blocked or failed runs, task completion percentage, task commit count, approximate code-line additions in `apps`, `packages`, and `scripts`, and a rough time-saved estimate. The time-saved metric is deliberately labeled as an estimate: it uses 45 manual minutes per merged run and subtracts observed run artifact duration.

## Work Selection

The runner always uses this repository root and this repository's `BACKLOG.md`.

A task is Ready when:

- `Status: [ ]`
- every `Depends on:` task is `Status: [x]`

`--limit=1` runs one Ready task. Without `--auto-merge`, `--limit=5` and `--all` stop after opening the first task PR so the branch can be reviewed and manually merged. With `--auto-merge`, the runner runs full verification, fast-forwards `main`, pushes `main`, and then continues to the next Ready task. With `--concurrency=N`, the limit counts attempted task executions across worker slots.

Each approved task runs in an isolated git worktree. Before implementation starts, the runner prepares that worktree with `pnpm install --frozen-lockfile --ignore-scripts` when a lockfile is present, so validation runs against the task checkout rather than borrowing dependencies from the main working tree. In concurrent auto-merge mode, the merge queue repeats this preparation after refreshing from latest `main` because dependency graph changes can land while a worker branch waits to merge.

The runner also creates a local `.codex-runner.lock` while active. A second run against the same repository reports `runner_locked` and exits without touching the backlog.

If a previous attempt left behind a task branch, task worktree, or open PR, the runner reuses the existing branch/worktree/PR instead of blindly creating duplicates. After a successful `--auto-merge`, it removes the task worktree and local branch and attempts to delete the merged remote task branch.

## Agent Instructions

`AGENTS.md` or `agents.md` is mandatory execution guidance. Lookup order is:

1. `AGENTS.md`
2. `agents.md`

If both files exist, the runner hard-blocks until they are consolidated. If neither exists, the runner creates a canonical `AGENTS.md`.

Every Codex prompt includes the agent instructions, selected backlog task, and the core project docs.

## Stop Conditions

The runner stops on:

- dirty base repo
- active `.codex-runner.lock`
- missing or duplicate agent instruction files
- plan approval required
- draft PR opened and awaiting manual merge
- auto-merge validation failure
- Codex failure after configured retry attempts
- Codex timeout after configured retry attempts
- review failure after fix attempts
- failed required validation
- real `.env*` changes, excluding `.env.example` templates
- suspected secrets
- protected path edits
- raw diff or patch leakage in artifacts
- commit, push, or PR failure

## Quality Gates

Hard blocks prevent commit and PR creation. Warnings are included in the PR body and run artifacts.

Hard blocks include real environment files, suspected secrets, protected paths, missing tests for code changes, raw diffs or patches in artifacts, and failed required validation. `.env.example` templates are allowed so tasks can document required configuration without committing local secrets.

Warnings include lockfile changes, migrations, infrastructure, auth, billing, large changesets, and skipped optional validation.

The runner asks git for individual untracked files, not collapsed untracked directories. This keeps missing-test checks accurate when a task creates a new package directory containing both implementation and test files.

Review output should start with an explicit `PASS` or `BLOCKED` verdict. The runner trusts that first non-empty verdict line before scanning explanatory text, so phrases such as "no blockers" or "blocked by read-only sandbox" do not accidentally trigger a fix phase after a `PASS`.

## Run Artifacts

Run artifacts are written under `runs/<run-id>/` and ignored by git. The tracked `runs/.gitkeep` keeps the directory visible.

Artifacts contain plans, safe summaries, validation results, quality findings, and run summaries. They must not contain raw source files, diffs, patches, secrets, or unredacted command output.

## Task Validation

Backlog validation text can include reviewer guidance and runnable commands. The runner only executes commands written explicitly in backticks, such as `pnpm test`. Prose-only guidance is preserved in prompts and artifacts but is not converted into a shell command.

When a validation line contains multiple backticked commands, the runner executes each command in order. If a backticked command uses shell operators such as `&&` or `||`, the runner runs that one command through the local shell so the expression behaves as written.

## README Freshness

Every backlog-moving task must update `README.md` in the same changeset as `BACKLOG.md`. This keeps the GitHub `main` branch README current after every runner push.

The quality gates hard-block a task when `BACKLOG.md` changes without a corresponding `README.md` update.

## Tests

Runner logic is covered by Vitest:

```bash
pnpm test
pnpm run typecheck
```

The tests cover backlog parsing and selection, agent policy handling, quality gates, validation execution, git helpers, and mocked orchestration.
