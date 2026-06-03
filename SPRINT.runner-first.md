# Sprint 1: Contracts And Runner Dry Run

## Backlog Source Of Truth

`BACKLOG.md` is the local source of truth for execution. Before starting Sprint 1, workers must read `MVP_PLAN.md`, `ARCHITECTURE.md`, `SECURITY_MODEL.md`, `RUNNER_PROTOCOL.md`, `DATA_MODEL.md`, `SPRINT.md`, and `BACKLOG.md`.

Sprint 1 execution starts at `TASK-001` in `BACKLOG.md`. After every completed task, update `BACKLOG.md` with the task status, completion notes, validation result, and next recommended task.

## Goal

Prove the hard local loop without the web app:

One local fixture repo, one task packet, one dry run, one mocked Codex execution, one validation result, one safe commit, and one mocked PR artifact.

## Build Scope

Build only:

- `packages/shared`
- `packages/policies`
- `packages/validation`
- `packages/codex`
- `packages/github`
- `apps/runner`
- Fixture repo test harness

Do not build:

- Clerk
- Postgres
- Dashboard UI
- Linear
- GitHub App
- Billing
- Teams
- Hosted job assignment
- Real PR creation

## Deliverables

### 1. Shared Contracts

Create versioned contracts with runtime validation for:

- `TaskPacket`
- `RunState`
- `RunEvent`
- `RepoPolicy`
- `RunnerProtocol`
- `ValidationResult`
- `ApprovalDecision`
- `RunnerCapabilities`
- `DryRunResult`

Acceptance:

- Every contract has `contractVersion`.
- Every contract has runtime validation.
- JSON fixtures parse successfully.
- Invalid fixtures fail validation.
- Run events require `idempotencyKey`.

### 2. Runner CLI Skeleton

Create a runner command that accepts:

- Local repo path.
- Task packet path.
- `--dry-run`.
- Optional output path for structured events.

Acceptance:

- Runner can load a task packet.
- Runner validates the packet.
- Runner validates the repo path.
- Runner outputs structured events.

### 3. Capability Reporting

Implement local capability detection for:

- OS platform, release, architecture.
- Shell.
- `git`.
- `node`.
- `npm`.
- `pnpm`.
- `yarn`.
- `python`.
- `gh`.
- `codex`.
- Max concurrency.

Acceptance:

- Missing tools are reported as unavailable, not treated as runner crashes.
- Tool versions are captured when available.
- Capabilities are included in dry-run output.

### 4. Repo Policy Parsing

Create repo policy parser in `packages/policies`.

Acceptance:

- Policy config can define validation commands, protected paths, sensitive paths, warning paths, protected branches, and diff limits.
- Missing policy is a dry-run failure.
- Invalid policy is a dry-run failure.

### 5. Dry Run

Implement runner dry-run mode.

Dry run checks:

- Repo exists.
- Repo is a git repository.
- Repo is clean.
- Current branch is not protected.
- Repo policy parses.
- Validation commands exist.
- Required tools are available.
- Worktree branch name is valid.
- Worktree path is available.
- Protected and sensitive paths are configured.

Acceptance:

- Dry run does not invoke Codex.
- Dry run does not create commits.
- Dry run does not push.
- Dry run does not open PRs.
- Dry run does not modify repo files.
- Dry-run result includes blockers, warnings, checks, and capabilities.

### 6. Mocked Codex Adapter

Implement a `packages/codex` adapter with a mock mode for tests.

Acceptance:

- Test mode can simulate `codex exec`.
- Mock Codex changes fixture repo files.
- Real runner path is designed around `codex exec`, but Sprint 1 E2E does not require real Codex.

### 7. Policy Scan

Implement changed-file scan and risk classification.

Acceptance:

- `.env` changes hard-block.
- Suspected secrets hard-block.
- Protected path edits hard-block.
- Package lock changes warn.
- Migration changes warn.
- Infrastructure changes warn.
- Auth and billing path changes warn.
- Large file count warns or blocks according to policy.

### 8. Validation

Implement validation command runner in `packages/validation`.

Acceptance:

- Commands run in the repo/worktree.
- Exit code is captured.
- Duration is captured.
- Output summaries are redacted.
- Required validation failure blocks commit.
- Validation result matches shared contract.

### 9. Git And PR Artifact Helpers

Implement local git and mocked `gh` helpers in `packages/github`.

Acceptance:

- Runner can commit safe changes.
- Runner can simulate push in tests.
- Runner can produce mocked PR artifact.
- No real PR is created in Sprint 1 tests.

### 10. Fixture Repo E2E

Create a fixture repo E2E test.

The test proves:

- Task packet loads.
- Dry run passes.
- Mocked Codex changes files.
- Policy scan runs.
- Validation runs.
- Safe changes commit.
- Mocked push/PR artifact is produced.
- Events are captured.
- Idempotency keys exist on events.
- No raw source, diffs, patches, or code snippets are emitted to web-bound artifacts.

## Sprint 1 Acceptance Criteria

Sprint 1 is complete when:

- Shared contracts exist, are versioned, and have runtime validation.
- Runner accepts a local repo path and task packet.
- Runner supports `dryRun` mode.
- Dry run checks repo cleanliness, policy config, required tools, repo mapping readiness, branch/worktree readiness, and validation command availability.
- Runner reports capabilities for git, node, package managers, python, gh, codex, OS, shell, and max concurrency.
- Runner emits structured run events with idempotency keys.
- Runner never sends raw source code, diffs, patches, or code snippets outside the local process.
- Fixture repo E2E runs with mocked Codex and mocked `gh`.
- E2E proves the full local path from task packet to mocked PR artifact.

## Verification

Run the Sprint 1 test suite before declaring the sprint complete.

Required verification categories:

- Contract validation tests.
- Capability detection tests.
- Policy parser tests.
- Dry-run tests.
- Secret and protected path tests.
- Validation command tests.
- Fixture repo E2E with mocked Codex/`gh`.
- Non-exfiltration tests for web-bound artifacts.

### Sprint 1 Verification Result - 2026-05-22

Preflight passed:

- `rg --files -g 'AGENTS.md' -g 'agents.md'`: returned only `AGENTS.md`; no duplicate `agents.md` was present.
- `git status --short`: clean before verification.

Focused verification passed:

- `pnpm --filter @control-plane/shared test`: passed, 15 test files and 169 tests.
- `pnpm --filter @control-plane/policies test`: passed, 4 test files and 34 tests.
- `pnpm --filter @control-plane/validation test`: passed, 4 test files and 26 tests.
- `pnpm --filter @control-plane/codex test`: passed, 4 test files and 34 tests.
- `pnpm --filter @control-plane/github test`: passed, 4 test files and 62 tests.
- `pnpm --filter @control-plane/runner test -- runner-happy-path.test.ts runner-blocked-paths.test.ts`: passed, 2 test files and 8 tests.

Full repository validation passed:

- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm run format:check`: passed.
- `pnpm test`: passed, 85 test files and 811 tests.

E2E assertion review confirmed:

- The happy-path runner proof uses the deterministic mocked Codex adapter and changes only `src/app.txt` in the fixture worktree.
- Validation passes before commit, and the runner records no validation blockers before entering the commit path.
- The safe change is committed, and the resulting commit hash is pushed to the fixture bare remote branch.
- The mocked `gh pr create` path produces a schema-valid draft PR artifact with PR number, PR URL, branch name, changed file paths, and risk findings only.
- The `.env`, suspected provider token, protected path, failed required validation, dirty repo, and cancellation-before-commit E2E scenarios all stop before commit, push, PR creation, or approval state.
- Serialized web-bound artifacts reject unsafe keys/text including `diff`, `patch`, `source`, `sourcecode`, `snippet`, raw content fields, raw output labels, hunk markers, private key blocks, GitHub/OpenAI token patterns, secret assignments, raw fixture contents, and unredacted command-output labels.

## Sprint Principle

Keep the first proof boring and concrete. The runner loop must become trustworthy before the web control plane becomes polished.
