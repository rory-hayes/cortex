# Runner Merge Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make concurrent backlog runs stable enough for a `--concurrency=10` test by reducing predictable merge conflicts and repairing bookkeeping-only rebase conflicts.

**Architecture:** Worker branches should focus on source/test implementation. The merge queue owns final `BACKLOG.md` and `README.md` bookkeeping on top of latest `main`, then validates and merges serially. Concurrent scheduling should avoid starting ready tasks with overlapping likely-touched source files.

**Tech Stack:** TypeScript, Vitest, local git helpers, repo-specific `scripts/codex-runner`.

---

### Task 1: File-Aware Concurrent Scheduling

**Files:**

- Modify: `scripts/codex-runner/backlog.ts`
- Modify: `scripts/codex-runner/types.ts`
- Modify: `scripts/codex-runner/index.ts`
- Test: `scripts/codex-runner/orchestrator.test.ts`

- [ ] Write a failing orchestration test where `TASK-001` and `TASK-002` share a `Files Likely Touched` path, `TASK-003` does not, and `--concurrency=2` starts `TASK-001` plus `TASK-003`.
- [ ] Extend backlog parsing to expose `filesLikelyTouched`.
- [ ] Teach concurrent launch selection to skip ready tasks whose likely-touched paths overlap active tasks, ignoring runner-owned bookkeeping files.
- [ ] Run the focused orchestration test.

### Task 2: Deferred Bookkeeping In Concurrent Workers

**Files:**

- Modify: `scripts/codex-runner/prompts/implement-task.md`
- Modify: `scripts/codex-runner/prompts/review-task.md`
- Modify: `scripts/codex-runner/index.ts`
- Modify: `scripts/codex-runner/types.ts`
- Modify: `scripts/codex-runner/git.ts`
- Test: `scripts/codex-runner/orchestrator.test.ts`

- [ ] Write a failing test where a concurrent worker tries to edit `BACKLOG.md` and `README.md`, the runner resets those worker edits before commit, then the merge queue records task completion on the refreshed branch.
- [ ] Add a `resetBookkeepingFiles` adapter and production git helper.
- [ ] Pass prompt instructions that tell Codex not to edit `BACKLOG.md` or `README.md` in concurrent merge mode.
- [ ] Skip runner `markTaskStarted` and pre-PR `markTaskCompleted` in concurrent merge mode.
- [ ] Apply final backlog and README bookkeeping in `mergeQueuedTask` after branch refresh and before merge validation.
- [ ] Run the focused orchestration test.

### Task 3: Bookkeeping Conflict Auto-Repair

**Files:**

- Modify: `scripts/codex-runner/git.ts`
- Test: `scripts/codex-runner/git.test.ts`

- [ ] Write a failing git fixture test where a task branch and `main` both edit `README.md`, then branch refresh succeeds by keeping latest `main` bookkeeping.
- [ ] Update `refreshBranchFromMain` to detect conflicted files after rebase failure.
- [ ] If every conflicted file is runner bookkeeping (`BACKLOG.md`, `README.md`), keep the upstream version, continue the rebase, and let merge-queue bookkeeping reapply the task status.
- [ ] Preserve hard failure for source-code conflicts.
- [ ] Run the focused git test.

### Task 4: Documentation And Verification

**Files:**

- Modify: `docs/CODEX_RUNNER.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] Document that concurrent worker branches defer `BACKLOG.md` and `README.md` to the merge queue.
- [ ] Document file-aware scheduling and bookkeeping-only rebase repair.
- [ ] Run `pnpm vitest run scripts/codex-runner/orchestrator.test.ts scripts/codex-runner/git.test.ts`.
- [ ] Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
