# Runner Concurrency Queue Plan

## Goal

Add an explicit repo-specific `--concurrency=N` flag to the local Codex backlog runner so independent ready tasks can be implemented in separate worktrees while a single merge queue keeps `main` safe and deterministic.

## Safety Shape

- Default concurrency remains `1`.
- `--concurrency>1` requires `--auto-merge` and `--approve-plan`.
- Worker slots may plan, implement, review, validate, commit, push, and open draft PRs in parallel.
- Merging stays serial. Before each merge, the queue refreshes the task branch from latest `origin/main`, pushes the refreshed branch, runs full repository validation, then fast-forwards `main`.
- A failed worker should not erase useful artifacts or stop already completed independent workers from reaching the merge queue.
- A merge-blocked branch stops the queue because `main` can no longer be advanced safely in order.

## Implementation Steps

1. Add failing orchestrator tests for `--concurrency` parsing and safety constraints.
2. Add failing orchestration tests proving two independent tasks can start in parallel and are merged through the serial queue.
3. Add failing orchestration coverage proving one failed worker does not prevent another independent completed worker from merging.
4. Extend runner types and adapters with branch refresh support.
5. Implement the `--concurrency` parser and validation.
6. Preserve the existing sequential loop for concurrency `1`.
7. Add a concurrent scheduling path for concurrency `>1`.
8. Extract auto-merge validation/merge/cleanup into a reusable serial merge helper.
9. Add production git branch refresh before queued merges.
10. Update runner documentation and agent instructions for the new explicit concurrency mode.
11. Run focused runner tests, then root typecheck, lint, format check, and tests.

## Open Design Decisions

- Merge order should be dependency-safe. Independent tasks may merge as they complete, but every merge must rebase/refresh onto current `main` and pass full validation.
- Concurrency should be conservative for local testing. The CLI validates positive integers, while documentation recommends starting with `--concurrency=2`.
