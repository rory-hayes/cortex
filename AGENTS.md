# AGENTS.md

## Purpose

This file is the operating brief for agents working in this repository. The product is an AI Engineering Control Plane with a hosted web coordinator and a local execution runner. The MVP must prove that approved engineering intent can become a safe, validated pull request while preserving human review and keeping source execution local.

The highest-order rule: the runner is the executor; the web app is the coordinator.

## Required Reading

Before starting any task, read:

- `MVP_PLAN.md`
- `ARCHITECTURE.md`
- `DATA_MODEL.md`
- `RUNNER_PROTOCOL.md`
- `SECURITY_MODEL.md`
- `SPRINT.md`
- `BACKLOG.md`
- This `AGENTS.md`

Treat `BACKLOG.md` as the local source of truth for execution. Pick the first incomplete task unless the user explicitly directs otherwise.

## Operating Rules

- Work one backlog task at a time.
- Do not start the next task until the current task is implemented, tested, documented, and reflected in `BACKLOG.md`.
- After every completed task, update `BACKLOG.md` with status, completion notes, validation result, and the next recommended task.
- After every backlog-moving push, update `README.md` so the GitHub `main` branch shows the current state, completed work, next task, runner status, and known stability notes.
- If blocked, mark the task as `[!] Blocked` in `BACKLOG.md` and explain the exact blocker.
- Keep changes scoped to the current task and its direct dependencies.
- Prefer small, focused files with clear boundaries.
- Do not introduce features outside the agreed MVP.
- Do not weaken security, validation, or human approval requirements to make implementation easier.
- Do not auto-merge pull requests unless the user explicitly invokes the local runner with `--auto-merge`.
- Do not implement hosted code execution for MVP.
- Do not add broad company crawling or generic knowledge ingestion.

## Refactor Principles

- Do not rebuild, replace, or remove the existing local runner unless explicitly directed.
- Preserve source-boundary safety for all new work. The runner may inspect source locally, but hosted surfaces and web-bound payloads must stay metadata-only.
- Initial repo-readiness scan value must not require runner installation. Users should receive readiness findings, AI-ready tasks, queue visibility, and setup recommendations before runner pairing.
- Every new task must update `README.md`, `SPRINT.md`, and relevant tests. In concurrent runner mode, defer only merge-queue-owned `BACKLOG.md` and `README.md` bookkeeping when explicitly instructed; keep task-relevant docs and tests current in the worker branch.

## MVP Build Order

Build in this order:

1. Project foundation
2. Shared contracts
3. Local runner CLI skeleton
4. Repo policy system
5. Dry-run readiness checks
6. Git worktree and branch manager
7. Codex exec adapter
8. Change scanner and safety gates
9. Validation engine
10. Commit, push, and PR creation
11. Runner event system
12. Runner test harness
13. Minimal web control plane
14. Runner protocol and polling
15. Repo mapping and manual task packets
16. Run timeline, cancellation, approval, and repair
17. GitHub visibility
18. External task import
19. Dashboard polish
20. Billing hooks
21. Security hardening
22. End-to-end MVP validation

Sprint 1 is contracts plus the local runner proof: one fixture repo, one task packet, one dry run, one mocked Codex execution, one validation result, one safe commit, one mocked push, and one mocked PR artifact.

## Architecture Rules

- `apps/runner` performs local execution.
- `apps/web` coordinates work and displays metadata.
- `packages/shared` owns versioned contracts.
- `packages/policies` owns policy parsing and risk classification.
- `packages/validation` owns validation command execution and result parsing.
- `packages/codex` owns `codex exec` invocation and prompt rendering.
- `packages/github` owns local git/`gh` helpers first, GitHub App visibility later.
- `packages/linear` is introduced only after the manual task flow works.
- `packages/db` is introduced with the minimal web control plane.
- `packages/logging` owns structured logging and redaction helpers.

Do not collapse runner and web responsibilities. The web app must not need source-code access to coordinate a run.

## Security And Trust Boundary

The runner must never send any of the following to the web app:

- Raw source code
- Diffs
- Patches
- Code snippets
- `.env` contents
- Secrets
- Private keys
- Unredacted command output

Allowed web-bound data:

- Run metadata
- Task packet metadata
- Changed file paths
- Risk flags
- Validation command names
- Validation status
- Exit codes
- Redacted log summaries
- PR URL and number
- Timestamps
- Runner capability metadata
- Audit metadata

When in doubt, keep data local and send less.

## Runner Rules

- Runner execution is local or customer-controlled.
- Runner must support `dryRun` before real execution.
- Dry run must not invoke Codex, create commits, push branches, open PRs, or modify repository files.
- Runner must report capabilities for OS, shell, `git`, `gh`, `codex`, `node`, package managers, `python`, max concurrency, dry-run support, and cancellation support.
- Runner job claims and run events must use idempotency keys.
- Runner must check cancellation before dry run, worktree creation, Codex invocation, validation, commit, push, PR creation, and repair.
- Runner must hard-block real `.env` or `.env.*` changes, suspected secrets, protected path edits, dirty repos, missing validation config, duplicate assignment, stale locks, failed validation, and cancelled runs. `.env.example` templates are allowed when they contain placeholders only.
- Runner may warn on package locks, migrations, infrastructure files, auth/billing files, large diffs, too many changed files, generated files, and skipped optional validation.
- Branch push and PR creation use local git/`gh` auth in v1.

## Local Backlog Runner Rules

- The repo-specific local backlog runner lives in `scripts/codex-runner`.
- The runner always reads this repository's `BACKLOG.md`; it must not be generalized into a broad task runner unless the user explicitly changes scope.
- The runner must include this `AGENTS.md` content in every planning, implementation, review, and fix prompt.
- The runner must stop after planning unless the local user passes an explicit approval flag.
- The runner may merge task branches only when the local user passes `--auto-merge`; it must run full repository verification before each merge.
- The runner may work multiple independent Ready tasks only when the local user explicitly passes `--concurrency=N` with `--approve-plan` and `--auto-merge`.
- Concurrent backlog execution must keep one worktree per task and one serial merge queue; every queued branch must refresh from latest `origin/main`, pass full validation, and merge one at a time.
- Concurrent worker branches must defer `BACKLOG.md` and `README.md` updates to the merge queue so status bookkeeping is applied on the refreshed branch immediately before full validation and merge.
- Concurrent scheduling must avoid running tasks together when their `Files Likely Touched` overlap on non-bookkeeping files.
- A failed concurrent worker must not weaken gates or erase useful artifacts; independent completed workers may continue through the merge queue when dependency rules still allow it.
- The runner must create isolated task branches named `codex/TASK-###-slug`.
- The runner must write local run artifacts under `runs/<run-id>/`, and those artifacts must remain ignored except for `runs/.gitkeep`.
- The runner must hard-block duplicate agent instruction files (`AGENTS.md` and `agents.md`) until they are consolidated.
- The runner must never mark a backlog task complete without validation evidence.
- The runner must hard-block backlog-moving task pushes unless `README.md` is updated in the same changeset.

## Web App Rules

- The web app coordinates, stores metadata, and shows auditability.
- The web app must not request source-code uploads.
- Manual task creation comes before external imports from Linear.
- GitHub App integration is for visibility and metadata, not v1 execution authority.
- Linear is the first optional external import/sync channel, but only after manual Cortex Task flow works.
- Importing Linear issues creates Cortex Task drafts linked by canonical external links; it must not approve, queue, assign, create runs, or create runner task packets automatically.
- Users must manually approve tasks into the queue.
- Human approval remains required before merge unless the repo-specific local runner is explicitly invoked with `--auto-merge` and full local verification passes.
- Billing hooks are allowed; full billing launch is deferred.

## Deferred Work

Do not implement these in MVP unless the user explicitly changes scope:

- Slack
- Notion
- Jira
- Broad company crawling
- Hosted code execution
- Auto-merge outside the explicit local runner `--auto-merge` flow
- Multi-agent orchestration
- Full Stripe billing
- Enterprise SSO
- SOC2 automation
- Advanced analytics
- Mobile app

If a task tempts you toward one of these, stop and record it as deferred rather than building it.

## Testing And Verification

Every implementation task needs evidence before completion.

Use the most specific available checks:

- Contract tests for `packages/shared`
- Policy tests for `packages/policies`
- Redaction tests for `packages/logging`
- Validation tests for `packages/validation`
- Runner unit and integration tests for `apps/runner`
- Fixture repo E2E with mocked Codex and mocked `gh`
- Web integration tests for `apps/web`
- Protocol tests for pairing, heartbeat, polling, claims, idempotent events, cancellation, repair, and artifact submission
- Security boundary tests proving no raw source, diffs, patches, code snippets, or secrets cross into web-bound payloads

Before claiming a task is complete, run the validation listed in `BACKLOG.md` for that task. If validation cannot run, record exactly why in `BACKLOG.md`.

## Backlog Update Format

When completing a task in `BACKLOG.md`:

- Change `Status: [ ]` to `Status: [x]`.
- Add concise completion notes.
- Add the validation command and result.
- Note any follow-up risk or blocker.
- Name the next recommended task.
- Update `README.md` with the current repository status before pushing to `main`.

When starting a task:

- Change `Status: [ ]` to `Status: [~]`.
- Keep the in-progress window short.
- Do not mark multiple tasks in progress unless the user explicitly asks for parallel work.

## Git And Change Hygiene

- Do not revert user changes unless explicitly asked.
- Stage only files relevant to the current task.
- Keep commits focused.
- Do not run destructive git commands without explicit user approval.
- Do not push unless the user asks.
- Do not create PRs unless the user asks or the current task explicitly requires it.

## Product Taste

This product should feel like a disciplined engineering control room, not an unconstrained autonomous-agent playground. Prefer conservative execution, explicit gates, clear audit trails, calm operational UI, and human-owned approval.

Trust is the product.
