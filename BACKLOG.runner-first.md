# BACKLOG.md

## Purpose

This backlog is the local execution plan for building the AI Engineering Control Plane MVP. It decomposes the locked product docs into small, ordered, buildable tasks that Codex can execute one at a time while preserving the local-runner trust boundary.

## Operating Rules

- Work one task at a time.
- Always read `MVP_PLAN.md`, `ARCHITECTURE.md`, `SECURITY_MODEL.md`, `RUNNER_PROTOCOL.md`, `DATA_MODEL.md`, and `BACKLOG.md` before starting.
- Pick the first incomplete task unless instructed otherwise.
- Do not start the next task until the current task is complete, tested, and documented.
- After every task, update `BACKLOG.md` with status, notes, validation result, and next recommended task.
- If blocked, mark the task as Blocked and explain exactly why.
- Never weaken the security/data-boundary requirements to make implementation easier.
- The runner must never send raw source code, diffs, patches, or code snippets to the web app.
- Keep execution local and governed.

## Status Key

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked
- `[>]` Deferred

## Milestones

## 1. Project Foundation

### TASK-001 — Lock package manager and workspace strategy
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: None
Goal: Establish `pnpm` as the monorepo package manager.
Scope: Add root workspace metadata and document the package-manager decision.
Out of Scope: Product code, runner behavior, web app scaffolding.
Implementation Notes: Use `pnpm` workspaces for `apps/*` and `packages/*`; keep the repo docs-only plus config.
Files Likely Touched: `package.json`, `pnpm-workspace.yaml`, `BACKLOG.md`
Acceptance Criteria: Root workspace declares `pnpm`; workspace globs include `apps/*` and `packages/*`; backlog notes are updated.
Validation: Run `pnpm --version` and inspect workspace config.
Security/Trust Notes: No execution behavior changes; do not introduce scripts that access source outside the repo.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-002
Validation Result: Passed

### TASK-002 — Add root script surface
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001
Goal: Provide consistent root commands for build, typecheck, lint, test, and format check.
Scope: Add scripts that delegate to workspace packages without creating product behavior.
Out of Scope: Real app implementation, test content beyond command plumbing.
Implementation Notes: Prefer `pnpm -r` scripts and make missing package scripts non-destructive during the foundation stage.
Files Likely Touched: `package.json`, `BACKLOG.md`
Acceptance Criteria: Root scripts exist for `build`, `typecheck`, `lint`, `test`, `format:check`.
Validation: Run `pnpm run typecheck`, `pnpm run lint`, and `pnpm run test` once scripts are present.
Security/Trust Notes: Scripts must not run Codex, git push, `gh`, or external network actions.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: `lint`, `format:check`, and `build` are workspace no-ops until TASK-004/TASK-005 add package/tooling baselines.
Next Recommended Task: TASK-003
Validation Result: Passed

### TASK-003 — Add TypeScript config baseline
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001
Goal: Establish shared TypeScript compiler settings for packages and apps.
Scope: Add root/base TypeScript configs and package/app extension pattern.
Out of Scope: Contract schemas, app code, runner code.
Implementation Notes: Use strict TypeScript, NodeNext or Bundler settings appropriate per package, and no emit by default for checks.
Files Likely Touched: `tsconfig.base.json`, `tsconfig.json`, `BACKLOG.md`
Acceptance Criteria: TypeScript configs can be extended by packages; root typecheck has a stable config.
Validation: Run `pnpm run typecheck` after package stubs exist.
Security/Trust Notes: Strict typing supports protocol and data-boundary correctness.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: App/package-specific configs are intentionally deferred until TASK-004 creates package stubs; repeat fuller validation after those configs exist.
Next Recommended Task: TASK-004
Validation Result: Passed

### TASK-004 — Scaffold monorepo directories
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001
Goal: Create the agreed app and package directory layout.
Scope: Add empty or README-backed directories for `apps/web`, `apps/runner`, and required packages.
Out of Scope: Product behavior, generated frameworks, database migrations.
Implementation Notes: Use minimal placeholder package manifests where needed so tooling can discover packages.
Files Likely Touched: `apps/runner/package.json`, `apps/web/package.json`, `packages/*/package.json`, `BACKLOG.md`
Acceptance Criteria: All directories from `ARCHITECTURE.md` exist and are workspace packages.
Validation: Run `pnpm -r list --depth -1`.
Security/Trust Notes: Package boundaries must preserve runner/web separation.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-005
Validation Result: Passed

### TASK-005 — Add formatting, linting, and test baseline
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-002, TASK-003, TASK-004
Goal: Provide a minimal quality gate before contracts are added.
Scope: Configure formatting, linting, and a test runner for TypeScript packages.
Out of Scope: Product tests, app UI tests, E2E harness.
Implementation Notes: Prefer Prettier, ESLint, and Vitest for the TypeScript monorepo.
Files Likely Touched: `package.json`, `eslint.config.*`, `.prettierrc`, `vitest.config.*`, `BACKLOG.md`
Acceptance Criteria: Empty test/lint/typecheck commands run without false failures.
Validation: Run `pnpm run format:check`, `pnpm run lint`, `pnpm run test`.
Security/Trust Notes: Tooling must not redact or ignore security test files by default.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-006
Validation Result: Passed

### TASK-006 — Add environment validation package plan
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-004
Goal: Establish where environment validation will live.
Scope: Add package-level env validation stubs for web and runner without secrets.
Out of Scope: Clerk, database, GitHub, Linear credentials.
Implementation Notes: Document required env groups and safe defaults; schema-based validation is covered by the package tasks.
Files Likely Touched: `apps/web/.env.example`, `apps/runner/.env.example`, `BACKLOG.md`
Acceptance Criteria: Example env files contain only non-secret placeholders and comments for required variables.
Validation: Inspect files and run placeholder scan for real-looking secrets.
Security/Trust Notes: Never commit actual tokens, pairing secrets, runner credentials, or API keys.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: Schema-based env validation remains deferred to later package tasks.
Next Recommended Task: TASK-008
Validation Result: Passed

### TASK-007 — Add repo documentation index
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001
Goal: Create a minimal `README.md` that points to the locked docs and backlog.
Scope: Summarize project purpose and execution docs.
Out of Scope: Marketing copy, installation docs, product screenshots.
Implementation Notes: Keep the README short and route implementers to `BACKLOG.md`.
Files Likely Touched: `README.md`, `BACKLOG.md`
Acceptance Criteria: README links to MVP, architecture, data model, protocol, security, sprint, and backlog docs.
Validation: Run `rg -n "BACKLOG.md|MVP_PLAN.md|SECURITY_MODEL.md" README.md`.
Security/Trust Notes: README must repeat the no-raw-source-to-web rule.
Completion Notes: Added a root README with the current project state, completed foundation tasks, runner capabilities, recent auto-merge test outcome, long-running stability hardening needs, key document links, and local commands.
Follow-up Risk: TASK-005 remains open; merge verification should expand to lint and format checks after that tooling baseline lands.
Next Recommended Task: TASK-005
Validation Result: Passed — `rg -n "BACKLOG.md|MVP_PLAN.md|SECURITY_MODEL.md" README.md`.

### TASK-008 — Add git ignore baseline
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001
Goal: Prevent generated output, local secrets, and fixture artifacts from entering git.
Scope: Add ignore rules for Node artifacts, env files, runner output, fixture temp repos, and build caches.
Out of Scope: Ignoring source packages or docs.
Implementation Notes: Allow `.env.example` but ignore `.env` and `.env.*.local`.
Files Likely Touched: `.gitignore`, `BACKLOG.md`
Acceptance Criteria: Local secrets and fixture-generated repos are ignored; tracked docs remain visible.
Validation: Run `git check-ignore .env apps/runner/.runner-state || true`.
Security/Trust Notes: Secret-bearing files must be ignored by default.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-009
Validation Result: Passed

### TASK-009 — Add CI placeholder workflow
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-005
Goal: Define the eventual CI checks without relying on product services.
Scope: Add a GitHub Actions workflow for install, typecheck, lint, and test.
Out of Scope: Deployment, Vercel, GitHub App, Linear, real runner execution.
Implementation Notes: Keep CI offline except dependency installation; no secrets required.
Files Likely Touched: `.github/workflows/ci.yml`, `BACKLOG.md`, `README.md`
Acceptance Criteria: CI workflow runs root checks with `pnpm`.
Validation: Run `pnpm run typecheck && pnpm run lint && pnpm run test` locally.
Security/Trust Notes: CI must not run real Codex, `gh pr create`, or push commands.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-010
Validation Result: Passed

### TASK-010 — Verify foundation state
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
Goal: Confirm the monorepo foundation is ready for contracts.
Scope: Run foundation checks and update backlog notes with results.
Out of Scope: Adding contracts or runner behavior.
Implementation Notes: Capture exact commands and outcomes in this task’s completion notes.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Workspace list, typecheck, lint, test, and format check have recorded results.
Validation: Run `pnpm -r list --depth -1`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run format:check`.
Security/Trust Notes: Confirm no secret files are tracked.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-011
Validation Result: Passed

## 2. Shared Contracts

### TASK-011 — Create shared contract package exports
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-010
Goal: Establish `packages/shared` as the contract authority.
Scope: Add package entrypoints, constants, and test setup for shared contracts.
Out of Scope: Individual schemas beyond the package shell.
Implementation Notes: Export `CONTRACT_VERSION = "2026-05-10.v1"` from one place.
Files Likely Touched: `packages/shared/src/index.ts`, `packages/shared/src/version.ts`, `packages/shared/package.json`, `BACKLOG.md`
Acceptance Criteria: Other packages can import the shared package; version constant is tested.
Validation: Run `pnpm --filter @*/shared test` or the final package name equivalent.
Security/Trust Notes: Contract versioning prevents loose prompt/shell-command drift.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-012
Validation Result: Passed

### TASK-012 — Implement RunState schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-011
Goal: Define the canonical run state enum.
Scope: Add Zod schema, TypeScript type, terminal state helper, and tests.
Out of Scope: Web persistence or runner transitions.
Implementation Notes: Match `DATA_MODEL.md` exactly, including cancellation states.
Files Likely Touched: `packages/shared/src/run-state.ts`, `packages/shared/src/run-state.test.ts`, `BACKLOG.md`
Acceptance Criteria: All documented states validate; unknown states fail.
Validation: Run shared package tests.
Security/Trust Notes: State accuracy matters for cancellation and block enforcement.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-013
Validation Result: Passed

### TASK-013 — Implement RiskFinding and ValidationCommand schemas
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-011
Goal: Define reusable policy and validation primitives.
Scope: Add schemas and tests for risk findings and validation commands.
Out of Scope: Policy parser, command execution.
Implementation Notes: Include all categories from `DATA_MODEL.md`.
Files Likely Touched: `packages/shared/src/risk.ts`, `packages/shared/src/validation-command.ts`, `packages/shared/src/*.test.ts`, `BACKLOG.md`
Acceptance Criteria: Categories, severities, command fields, and required flags validate.
Validation: Run `pnpm --filter @control-plane/shared test` and `pnpm --filter @control-plane/shared typecheck`.
Security/Trust Notes: Risk categories must include secrets, `.env`, protected paths, duplicate assignment, and validation failure.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-014
Validation Result: Passed

### TASK-014 — Implement RepoPolicy schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-013
Goal: Define the runner policy contract.
Scope: Add `RepoPolicy` Zod schema, defaults helper only where explicitly safe, and tests.
Out of Scope: Reading policy files from disk.
Implementation Notes: Avoid permissive defaults for protected or sensitive paths; missing required policy stays invalid.
Files Likely Touched: `packages/shared/src/repo-policy.ts`, `packages/shared/src/repo-policy.test.ts`, `BACKLOG.md`
Acceptance Criteria: Valid policies parse; missing validation commands fail.
Validation: Run shared package tests.
Security/Trust Notes: Do not weaken policy requirements to improve developer convenience.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: DryRunCheck is represented as a narrow string enum from `RUNNER_PROTOCOL.md`; revisit only if later protocol work requires richer check objects.
Next Recommended Task: TASK-015
Validation Result: Passed

### TASK-015 — Implement TaskPacket schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-014
Goal: Define the execution-ready task packet contract.
Scope: Add schema, type, mode validation, context path references, and tests.
Out of Scope: Task packet UI, Linear imports, prompt rendering.
Implementation Notes: Context files are paths and notes only; source content is not embedded.
Files Likely Touched: `packages/shared/src/task-packet.ts`, `packages/shared/src/task-packet.test.ts`, `BACKLOG.md`
Acceptance Criteria: Manual, dryRun, execute, and repair packets validate; embedded source-like fields are not accepted.
Validation: Run shared package tests.
Security/Trust Notes: Task packets must not carry raw source code to the web app.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-016
Validation Result: Passed

### TASK-016 — Implement RunEvent schema with idempotency
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-012
Goal: Define append-only idempotent run events.
Scope: Add schema, idempotency key helper, metadata shape guard, and tests.
Out of Scope: Event storage, event transport.
Implementation Notes: Reject obvious disallowed metadata keys such as `diff`, `patch`, `source`, and `code`.
Files Likely Touched: `packages/shared/src/run-event.ts`, `packages/shared/src/run-event.test.ts`, `BACKLOG.md`
Acceptance Criteria: Events require `idempotencyKey`; duplicate key helper is deterministic; disallowed payload keys fail.
Validation: Run shared package tests.
Security/Trust Notes: Event metadata must not become an exfiltration channel.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-017
Validation Result: Passed

### TASK-017 — Implement ValidationResult schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-013
Goal: Define validation result payloads.
Scope: Add schema, result status validation, redaction flag, and tests.
Out of Scope: Running validation commands.
Implementation Notes: Summaries are redacted strings, not raw logs.
Files Likely Touched: `packages/shared/src/validation-result.ts`, `packages/shared/src/validation-result.test.ts`, `BACKLOG.md`
Acceptance Criteria: Passed, failed, skipped, and cancelled results validate; missing redaction flag fails.
Validation: Run shared package tests.
Security/Trust Notes: Validation output must be safe before it crosses the runner boundary.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: The schema requires redaction metadata, but actual output redaction enforcement belongs to `packages/validation`.
Next Recommended Task: TASK-018
Validation Result: Passed

### TASK-018 — Implement ApprovalDecision schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-011
Goal: Define human approval and repair decisions.
Scope: Add schema and tests for approve, reject, request repair, rerun validation, cancel run, and close run.
Out of Scope: Approval UI or database persistence.
Implementation Notes: Require actor, reason, run id, and timestamp.
Files Likely Touched: `packages/shared/src/approval-decision.ts`, `packages/shared/src/approval-decision.test.ts`, `BACKLOG.md`
Acceptance Criteria: All documented decisions validate; missing reason fails.
Validation: Run shared package tests.
Security/Trust Notes: Human authority remains explicit and auditable.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: Schema-only coverage is complete; approval UI, persistence, and protocol behavior remain out of scope for this task.
Next Recommended Task: TASK-019
Validation Result: Passed

### TASK-019 — Implement RunnerCapabilities schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-011
Goal: Define runner capability reporting.
Scope: Add schema for OS, shell, tools, max concurrency, dry-run support, and cancellation support.
Out of Scope: Local capability detection.
Implementation Notes: Missing tools should be representable as unavailable without schema failure.
Files Likely Touched: `packages/shared/src/runner-capabilities.ts`, `packages/shared/src/runner-capabilities.test.ts`, `BACKLOG.md`
Acceptance Criteria: Capability payload validates with unavailable tools and available versioned tools.
Validation: Run shared package tests.
Security/Trust Notes: Capability reports inform safe job assignment.
Completion Notes: Completed by local Codex backlog runner.
Completion Notes: Added strict RunnerCapabilities schemas for OS metadata, shell, fixed optional tool capabilities, max concurrency, dry-run support, cancellation support, and report timestamp. Exported schemas and inferred types from `@control-plane/shared`; no local capability detection was added.
Next Recommended Task: TASK-020
Validation Result: Passed
Follow-up Risk: None.

### TASK-020 — Implement DryRunResult schema
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-019, TASK-013
Goal: Define dry-run readiness output.
Scope: Add dry-run check result schema, blocker/warning arrays, and tests.
Out of Scope: Running dry-run checks.
Implementation Notes: Dry-run result must contain capabilities and never contain file contents.
Files Likely Touched: `packages/shared/src/dry-run-result.ts`, `packages/shared/src/dry-run-result.test.ts`, `BACKLOG.md`
Acceptance Criteria: Passed, warning, and failed dry-run results validate; raw code fields fail.
Validation: Run shared package tests.
Security/Trust Notes: Dry run is metadata-only and non-mutating.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-021
Validation Result: Passed
Follow-up Risk: None.

### TASK-021 — Implement RunnerProtocol schemas
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-015, TASK-016, TASK-017, TASK-020
Goal: Define web/runner protocol request and response contracts.
Scope: Add schemas for link, heartbeat, poll, claim, submit event, dry-run result, validation result, PR artifact, cancellation, repair, and close.
Out of Scope: HTTP routes or polling client.
Implementation Notes: Claim and event requests must require idempotency keys.
Files Likely Touched: `packages/shared/src/runner-protocol.ts`, `packages/shared/src/runner-protocol.test.ts`, `BACKLOG.md`
Acceptance Criteria: All protocol messages validate; PR artifact rejects diffs and patches.
Validation: Run shared package tests.
Security/Trust Notes: Protocol schemas enforce the no-raw-source web boundary.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-022
Validation Result: Passed
Follow-up Risk: None.

### TASK-022 — Add JSON fixtures for contracts
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-021
Goal: Provide canonical fixture examples for every shared contract.
Scope: Add valid and invalid JSON fixtures used by tests.
Out of Scope: Fixture repos or E2E harness.
Implementation Notes: Include invalid fixtures for missing idempotency, embedded source, and invalid contract version.
Files Likely Touched: `packages/shared/fixtures/*.json`, `packages/shared/src/fixtures.test.ts`, `BACKLOG.md`
Acceptance Criteria: All valid fixtures parse; invalid fixtures fail with clear errors.
Validation: Run shared package tests.
Security/Trust Notes: Fixtures must not contain real secrets or real source code.
Completion Notes: Completed by local Codex backlog runner.
Follow-up Risk: None.
Next Recommended Task: TASK-023
Validation Result: Passed

### TASK-023 — Add contract compatibility test harness
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-022
Goal: Prepare version compatibility tests from day one.
Scope: Add tests that load fixture versions and assert current v1 parsing.
Out of Scope: A second contract version.
Implementation Notes: Keep the harness ready for v2 without inventing v2 behavior.
Files Likely Touched: `packages/shared/src/compatibility.test.ts`, `packages/shared/fixtures/v1/*.json`, `BACKLOG.md`
Acceptance Criteria: v1 fixtures are tested through the compatibility harness.
Validation: Run shared package tests.
Security/Trust Notes: Compatibility protects auditability across runner/web upgrades.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-024
Validation Result: Passed
Follow-up Risk: None.

### TASK-024 — Export shared contract index
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021
Goal: Provide clean imports for downstream packages.
Scope: Export all schemas, types, constants, and helpers from shared package entrypoint.
Out of Scope: Business logic.
Implementation Notes: Avoid circular imports between schemas.
Files Likely Touched: `packages/shared/src/index.ts`, `BACKLOG.md`
Acceptance Criteria: Consumer package can import every contract from the shared entrypoint.
Validation: Run shared package tests and root typecheck.
Security/Trust Notes: Central exports reduce divergent local protocol definitions.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-025
Validation Result: Passed
Follow-up Risk: None.

### TASK-025 — Verify shared contracts milestone
Status: [x]
Milestone: Shared Contracts
Priority: P0
Depends on: TASK-024
Goal: Confirm contract package is ready for runner implementation.
Scope: Run package tests, typecheck, fixture validation, and update backlog notes.
Out of Scope: New schemas or runner code.
Implementation Notes: Record exact test commands and outcomes.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Shared package tests pass; root typecheck passes; fixture parse results are documented.
Validation: Run `pnpm --filter @*/shared test` and `pnpm run typecheck`.
Security/Trust Notes: Do not proceed to runner work if any boundary fixture fails.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-026
Validation Result: Passed
Follow-up Risk: None.

## 3. Local Runner CLI Skeleton

### TASK-026 — Create runner package entrypoint
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-025
Goal: Add the local runner CLI entrypoint.
Scope: Create CLI bin wiring, command parser, and help output.
Out of Scope: Dry-run checks, Codex, git operations.
Implementation Notes: Support `run` command shape with `--repo`, `--task`, `--dry-run`, and `--events-out`.
Files Likely Touched: `apps/runner/src/cli.ts`, `apps/runner/package.json`, `apps/runner/src/index.ts`, `BACKLOG.md`
Acceptance Criteria: CLI prints help and rejects missing required options.
Validation: Run runner package tests and invoke CLI help through package script.
Security/Trust Notes: CLI must not perform side effects before explicit run command execution.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-027
Validation Result: Passed
Follow-up Risk: None.

### TASK-027 — Add task packet loader
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-026
Goal: Load and validate a task packet from disk.
Scope: Read JSON, validate with shared schema, return typed task packet.
Out of Scope: Prompt rendering, web API loading, Linear import.
Implementation Notes: Error messages should name the invalid file and schema issue without printing source content.
Files Likely Touched: `apps/runner/src/task-packet-loader.ts`, `apps/runner/src/task-packet-loader.test.ts`, `BACKLOG.md`
Acceptance Criteria: Valid fixture loads; invalid fixture fails; errors are safe.
Validation: Run runner package tests.
Security/Trust Notes: Do not log embedded local file contents when validation fails.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-028
Validation Result: Passed
Follow-up Risk: None.

### TASK-028 — Add runner config loader
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-026
Goal: Load local runner config for non-secret defaults.
Scope: Support config path, default worktree root, event output path, and mock mode flags.
Out of Scope: Pairing credentials, hosted protocol credentials.
Implementation Notes: Keep credentials out of Sprint 1 config.
Files Likely Touched: `apps/runner/src/config.ts`, `apps/runner/src/config.test.ts`, `BACKLOG.md`
Acceptance Criteria: Config defaults are stable; invalid config fails safely.
Validation: Run runner package tests.
Security/Trust Notes: Config loader must not print secret-like values.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-029
Validation Result: Passed
Follow-up Risk: None.

### TASK-029 — Add local repo path validation
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-026
Goal: Validate the supplied local repository path.
Scope: Confirm path exists, is a directory, and is a git repository.
Out of Scope: Clean-state check and branch policy.
Implementation Notes: Use git commands through a small command wrapper for testability.
Files Likely Touched: `apps/runner/src/repo-path.ts`, `apps/runner/src/repo-path.test.ts`, `BACKLOG.md`
Acceptance Criteria: Missing path, file path, and non-git directory fail with structured errors.
Validation: Run runner package tests.
Security/Trust Notes: Repo validation must not enumerate or upload source files.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-030
Validation Result: Passed
Follow-up Risk: None.

### TASK-030 — Add runner command execution wrapper
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-026
Goal: Provide a safe wrapper for local shell commands.
Scope: Add typed execution result with command, cwd, exit code, duration, and redacted summaries.
Out of Scope: Validation engine behavior and Codex adapter behavior.
Implementation Notes: Do not use shell interpolation for untrusted arguments; support direct argv execution.
Files Likely Touched: `apps/runner/src/command.ts`, `apps/runner/src/command.test.ts`, `BACKLOG.md`
Acceptance Criteria: Wrapper captures success/failure and does not throw on nonzero exits unless configured.
Validation: Run runner package tests.
Security/Trust Notes: Redaction must happen before command output is persisted or emitted.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-031
Validation Result: Passed
Follow-up Risk: Future TASK-071 should centralize redaction in `packages/logging`.

### TASK-031 — Add structured runner error type
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-026
Goal: Normalize runner errors for events and test assertions.
Scope: Add error categories, user-safe message, optional metadata, and exit code mapping.
Out of Scope: Policy risk classification.
Implementation Notes: Keep raw command output separate from user-safe error summaries.
Files Likely Touched: `apps/runner/src/errors.ts`, `apps/runner/src/errors.test.ts`, `BACKLOG.md`
Acceptance Criteria: Known error categories map to stable exit codes and messages.
Validation: Run runner package tests.
Security/Trust Notes: Error metadata must not include raw source, diffs, patches, or secrets.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-032
Validation Result: Passed
Follow-up Risk: Future orchestration wiring must keep raw command output, stacks, diffs, patches, and source snippets outside `RunnerError.metadata`.

### TASK-032 — Add local event output writer
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-016, TASK-026
Goal: Write structured run events to a local file for Sprint 1.
Scope: Append JSONL events validated by shared schema.
Out of Scope: Web event submission and idempotent server storage.
Implementation Notes: Use idempotency keys even for local output.
Files Likely Touched: `apps/runner/src/event-writer.ts`, `apps/runner/src/event-writer.test.ts`, `BACKLOG.md`
Acceptance Criteria: Events append as JSONL; invalid event fails before write.
Validation: Run runner package tests.
Security/Trust Notes: Event writer rejects disallowed raw code payload keys.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-033
Validation Result: Passed
Follow-up Risk: TASK-033 still needs to wire the writer into the CLI skeleton flow; no web submission, local deduplication, or server idempotency behavior was added.

### TASK-033 — Wire runner skeleton flow
Status: [x]
Milestone: Local Runner CLI Skeleton
Priority: P0
Depends on: TASK-027, TASK-028, TASK-029, TASK-030, TASK-031, TASK-032
Goal: Connect CLI parsing, config loading, task loading, repo validation, and event output.
Scope: Implement a no-op dry-run placeholder that emits start/fail/success events as appropriate.
Out of Scope: Real dry-run checks, worktrees, Codex, validation, commits.
Implementation Notes: Keep the placeholder clearly non-product and replace it in dry-run tasks.
Files Likely Touched: `apps/runner/src/cli.ts`, `apps/runner/src/run.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: Runner accepts repo/task arguments and emits schema-valid events without invoking Codex.
Validation: Run runner package tests.
Security/Trust Notes: Skeleton must not mutate the repo.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-034
Validation Result: Passed
Follow-up Risk: The flow is intentionally a placeholder and does not perform real repo policy checks, capability reporting, validation commands, worktree creation, Codex invocation, commits, pushes, or PR creation.

## 4. Repo Policy System

### TASK-034 — Define repo policy file convention
Status: [x]
Milestone: Repo Policy System
Priority: P0
Depends on: TASK-014
Goal: Choose the local repository policy file name and shape.
Scope: Document and implement lookup for `.aicp/policy.json`.
Out of Scope: Web-managed policy editing.
Implementation Notes: Keep JSON compatible with `RepoPolicy`.
Files Likely Touched: `packages/policies/src/policy-path.ts`, `packages/policies/src/policy-path.test.ts`, `BACKLOG.md`
Acceptance Criteria: Policy lookup resolves `.aicp/policy.json` under repo root.
Validation: Run policies package tests.
Security/Trust Notes: Missing policy must fail dry run rather than falling back to permissive execution.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-035
Validation Result: Passed
Follow-up Risk: TASK-035 still needs to read and validate the JSON against the shared `RepoPolicy` schema; this task intentionally does not parse policy contents.

### TASK-035 — Implement repo policy parser
Status: [x]
Milestone: Repo Policy System
Priority: P0
Depends on: TASK-034
Goal: Parse and validate local repo policy files.
Scope: Read JSON policy, validate shared schema, return typed policy or structured failure.
Out of Scope: Risk classification and dry-run aggregation.
Implementation Notes: Error output must not include unrelated file contents.
Files Likely Touched: `packages/policies/src/parse-policy.ts`, `packages/policies/src/parse-policy.test.ts`, `BACKLOG.md`
Acceptance Criteria: Valid policy parses; missing and invalid policy fail predictably.
Validation: Run policies package tests.
Security/Trust Notes: Invalid policy is a blocker, not a warning.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-036
Validation Result: Passed
Follow-up Risk: Reusable policy fixtures remain deferred to TASK-036; risk classification and dry-run aggregation remain out of scope.

### TASK-036 — Add policy fixture files
Status: [x]
Milestone: Repo Policy System
Priority: P0
Depends on: TASK-035
Goal: Provide reusable policy fixtures for parser and runner tests.
Scope: Add valid policy, missing validation policy, invalid JSON policy, and sensitive path policy fixtures.
Out of Scope: Fixture git repo E2E.
Implementation Notes: Keep fixtures free of real secrets or source code.
Files Likely Touched: `packages/policies/fixtures/*`, `packages/policies/src/parse-policy.test.ts`, `BACKLOG.md`
Acceptance Criteria: Parser tests cover each fixture.
Validation: Run policies package tests.
Security/Trust Notes: Sensitive path fixtures must include `.env` and protected path examples.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-037
Validation Result: Passed
Follow-up Risk: The intentionally malformed invalid JSON fixture is narrowly ignored by Prettier so root format checks can continue while parser tests still exercise `invalid_json`.

### TASK-037 — Implement protected path evaluator
Status: [x]
Milestone: Repo Policy System
Priority: P0
Depends on: TASK-035
Goal: Evaluate changed paths against protected and sensitive path globs.
Scope: Add path matching helper and tests.
Out of Scope: Git changed-file scanning.
Implementation Notes: Normalize path separators and reject paths escaping repo root.
Files Likely Touched: `packages/policies/src/path-policy.ts`, `packages/policies/src/path-policy.test.ts`, `BACKLOG.md`
Acceptance Criteria: Protected, sensitive, warning, and safe paths classify correctly.
Validation: Run policies package tests.
Security/Trust Notes: `.env` must be treated as sensitive even if policy omits it.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-038
Validation Result: Passed
Follow-up Risk: None; advanced glob syntax remains out of scope and now fails closed instead of being treated as a literal pattern.

### TASK-038 — Implement risk finding builder
Status: [x]
Milestone: Repo Policy System
Priority: P0
Depends on: TASK-037
Goal: Produce shared `RiskFinding` objects from policy matches.
Scope: Map policy matches to blocked/warning risk findings.
Out of Scope: Secret scanning and diff analysis.
Implementation Notes: Use stable risk IDs for deterministic tests.
Files Likely Touched: `packages/policies/src/risk-findings.ts`, `packages/policies/src/risk-findings.test.ts`, `BACKLOG.md`
Acceptance Criteria: Protected paths become blockers; warning paths become warnings.
Validation: Run policies package tests.
Security/Trust Notes: Risk metadata includes paths only, never file contents.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-039
Validation Result: Passed
Follow-up Risk: None; builder consumes path policy evaluation metadata only and emits normalized paths without patterns, contents, diffs, snippets, or command output.

### TASK-039 — Verify policy system milestone
Status: [x]
Milestone: Repo Policy System
Priority: P0
Depends on: TASK-035, TASK-036, TASK-037, TASK-038
Goal: Confirm policy parsing and path classification are ready for dry run.
Scope: Run policy tests and update backlog notes.
Out of Scope: Adding new policy behavior.
Implementation Notes: Record parser and path evaluator coverage.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: All policy tests pass and missing policy remains a blocker.
Validation: Run `pnpm --filter @*/policies test`.
Security/Trust Notes: Confirm no permissive policy fallback exists.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-040
Validation Result: Passed
Follow-up Risk: None for this milestone.

## 5. Dry Run Readiness Checks

### TASK-040 — Add capability detection module
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-019, TASK-030
Goal: Detect local runner capabilities.
Scope: Detect OS, shell, git, gh, codex, node, npm, pnpm, yarn, python, max concurrency, dry-run support, cancellation support.
Out of Scope: Web capability display.
Implementation Notes: Missing tools are unavailable capabilities, not crashes.
Files Likely Touched: `apps/runner/src/capabilities.ts`, `apps/runner/src/capabilities.test.ts`, `BACKLOG.md`
Acceptance Criteria: Capability payload validates against shared schema.
Validation: Run runner package tests.
Security/Trust Notes: Capability reports must not include environment variables or tokens.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-041
Validation Result: Passed
Follow-up Risk: None for capability detection; dry-run integration will need to consume this detector in later tasks.

### TASK-041 — Add git clean-state check
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-029, TASK-030
Goal: Detect dirty repositories before execution.
Scope: Check tracked, untracked, and staged changes with git status porcelain.
Out of Scope: Changed-file scan after Codex.
Implementation Notes: Return metadata counts and paths if safe; do not include file contents.
Files Likely Touched: `apps/runner/src/dry-run/check-clean-repo.ts`, `apps/runner/src/dry-run/check-clean-repo.test.ts`, `BACKLOG.md`
Acceptance Criteria: Dirty repo produces blocker; clean repo passes.
Validation: Run runner package tests.
Security/Trust Notes: Dirty paths are metadata only.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-042
Validation Result: Passed
Follow-up Risk: CLI dry-run orchestration still needs to consume this reusable check in the later dry-run wiring task.

### TASK-042 — Add protected branch check
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-035, TASK-030
Goal: Block execution from protected branches.
Scope: Detect current branch and compare against repo policy protected branches.
Out of Scope: Branch creation.
Implementation Notes: Treat unknown detached state as a blocker unless explicitly supported by policy.
Files Likely Touched: `apps/runner/src/dry-run/check-branch.ts`, `apps/runner/src/dry-run/check-branch.test.ts`, `BACKLOG.md`
Acceptance Criteria: Protected branch produces blocker; allowed branch passes.
Validation: Run runner package tests.
Security/Trust Notes: Protected branch enforcement reduces accidental main-branch mutation.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-043
Validation Result: Passed
Follow-up Risk: CLI dry-run orchestration still needs to consume this reusable check in the later dry-run wiring task.

### TASK-043 — Add validation config readiness check
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-035
Goal: Ensure required validation commands exist before execution.
Scope: Verify policy has at least one required validation command and commands are non-empty.
Out of Scope: Running validation.
Implementation Notes: Missing validation is a dry-run blocker.
Files Likely Touched: `apps/runner/src/dry-run/check-validation-config.ts`, `apps/runner/src/dry-run/check-validation-config.test.ts`, `BACKLOG.md`
Acceptance Criteria: Missing or empty commands block; valid commands pass.
Validation: Run runner package tests.
Security/Trust Notes: Do not allow unvalidated execution to proceed.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-044
Validation Result: Passed
Follow-up Risk: CLI dry-run orchestration still needs to consume this reusable check in the later dry-run wiring task.

### TASK-044 — Add required tool readiness check
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-040
Goal: Verify required runner tools are available.
Scope: Check git, node/package manager as needed, gh for PR-capable runs, and codex for execute mode.
Out of Scope: Installing tools.
Implementation Notes: `dryRun` mode may report missing Codex as a warning or blocker based on task mode requirements.
Files Likely Touched: `apps/runner/src/dry-run/check-tools.ts`, `apps/runner/src/dry-run/check-tools.test.ts`, `BACKLOG.md`
Acceptance Criteria: Missing required tools produce clear blockers; unavailable optional tools are warnings.
Validation: Run runner package tests.
Security/Trust Notes: Tool paths must not include secrets.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-045
Validation Result: Passed
Follow-up Risk: CLI dry-run orchestration still needs to consume this reusable check in the later dry-run wiring task.

### TASK-045 — Add worktree readiness check
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-015, TASK-029
Goal: Verify branch and worktree target can be created.
Scope: Validate branch name format, worktree path availability, and repo root relationship.
Out of Scope: Creating the worktree.
Implementation Notes: Check without mutating repo state.
Files Likely Touched: `apps/runner/src/dry-run/check-worktree-readiness.ts`, `apps/runner/src/dry-run/check-worktree-readiness.test.ts`, `BACKLOG.md`
Acceptance Criteria: Invalid branch names and occupied worktree paths block.
Validation: Run runner package tests.
Security/Trust Notes: Keep check non-mutating and avoid source enumeration.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-046
Validation Result: Passed
Follow-up Risk: CLI dry-run orchestration still needs to consume this reusable check in the later dry-run wiring task.

### TASK-046 — Add protected/sensitive policy readiness check
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-035, TASK-037
Goal: Verify protected and sensitive path policy is present.
Scope: Ensure policy includes protected and sensitive path arrays and implicit `.env` handling is active.
Out of Scope: Scanning changed files.
Implementation Notes: Missing explicit sensitive paths can warn, but `.env` remains hard-coded sensitive.
Files Likely Touched: `apps/runner/src/dry-run/check-path-policy.ts`, `apps/runner/src/dry-run/check-path-policy.test.ts`, `BACKLOG.md`
Acceptance Criteria: Dry-run result reports policy readiness and `.env` protection.
Validation: Run runner package tests.
Security/Trust Notes: `.env` hard block must not depend on user policy.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-047
Validation Result: Passed
Follow-up Risk: CLI dry-run aggregation still needs to consume this reusable readiness check in TASK-047.

### TASK-047 — Compose dry-run result
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-040, TASK-041, TASK-042, TASK-043, TASK-044, TASK-045, TASK-046
Goal: Aggregate readiness checks into a shared `DryRunResult`.
Scope: Run all checks, collect blockers/warnings, include capabilities, validate result schema.
Out of Scope: CLI wiring and web submission.
Implementation Notes: Status is failed with blockers, warning with warnings only, passed otherwise.
Files Likely Touched: `apps/runner/src/dry-run/run-dry-run.ts`, `apps/runner/src/dry-run/run-dry-run.test.ts`, `BACKLOG.md`
Acceptance Criteria: Aggregated result matches shared schema and includes all checks.
Validation: Run runner package tests.
Security/Trust Notes: Dry-run metadata must not include file contents.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: CLI dry-run mode still emits skeleton events until TASK-048 wires `runDryRun` into `apps/runner/src/run.ts`.
Next Recommended Task: TASK-048

### TASK-048 — Wire CLI dry-run mode
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-047
Goal: Make `--dry-run` execute the real readiness checks.
Scope: CLI loads packet and policy, runs dry run, emits events and result to local output.
Out of Scope: Web protocol, Codex, worktree mutation.
Implementation Notes: Emit `dry_run_running` and `dry_run_passed` or `blocked`.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/cli.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: CLI dry run performs no repo mutation and exits predictably.
Validation: Run runner package tests and a local fixture dry-run command.
Security/Trust Notes: Dry run must not invoke Codex, commit, push, or open PRs.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: None known for CLI dry-run wiring; TASK-049 should verify the dry-run milestone end to end.
Next Recommended Task: TASK-049

### TASK-049 — Verify dry-run milestone
Status: [x]
Milestone: Dry Run Readiness Checks
Priority: P0
Depends on: TASK-048
Goal: Confirm dry-run readiness checks satisfy Sprint 1 requirements.
Scope: Run tests and update backlog with results.
Out of Scope: Worktree or Codex behavior.
Implementation Notes: Include a check that fixture repo files remain unmodified.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Dry-run tests pass and no mutation is observed.
Validation: Run runner dry-run tests and root test suite.
Security/Trust Notes: Confirm no raw source appears in dry-run outputs.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: None known for the dry-run milestone. Worktree creation and real execution remain intentionally deferred to the next milestone.
Next Recommended Task: TASK-050

## 6. Git Worktree and Branch Manager

### TASK-050 — Add branch naming helper
Status: [x]
Milestone: Git Worktree and Branch Manager
Priority: P0
Depends on: TASK-015
Goal: Generate safe branch names from task packets.
Scope: Add deterministic branch name sanitizer with collision-resistant suffix.
Out of Scope: Worktree creation and git push.
Implementation Notes: Prefix branches with `aicp/` and include task or run id.
Files Likely Touched: `apps/runner/src/git/branch-name.ts`, `apps/runner/src/git/branch-name.test.ts`, `BACKLOG.md`
Acceptance Criteria: Unsafe characters are removed; branch names are deterministic.
Validation: Run runner package tests.
Security/Trust Notes: Branch names must not include secrets or full task descriptions if sensitive.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: None known for branch name generation. Worktree path computation, worktree creation, commits, pushes, and PR behavior remain intentionally deferred.
Next Recommended Task: TASK-051

### TASK-051 — Add worktree path helper
Status: [x]
Milestone: Git Worktree and Branch Manager
Priority: P0
Depends on: TASK-028, TASK-050
Goal: Compute safe worktree paths beside or under configured runner worktree root.
Scope: Normalize path, avoid traversal, and ensure path is outside protected source paths when configured.
Out of Scope: Creating worktrees.
Implementation Notes: Use run id for deterministic path.
Files Likely Touched: `apps/runner/src/git/worktree-path.ts`, `apps/runner/src/git/worktree-path.test.ts`, `BACKLOG.md`
Acceptance Criteria: Path traversal attempts fail; valid paths are stable.
Validation: Run runner package tests.
Security/Trust Notes: Do not place worktrees in ignored secret directories.
Completion Notes: Added a pure worktree path helper with deterministic run-id-based directory names, traversal rejection, env-like directory rejection, policy coverage checks, and public runner exports.
Validation Result: Passed `pnpm --filter @control-plane/runner test -- src/git/worktree-path.test.ts`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
Follow-up Risk: Worktree creation remains intentionally deferred to TASK-052; TASK-052 should consume this helper rather than recomputing paths.
Next Recommended Task: TASK-052

### TASK-052 — Implement worktree creation
Status: [x]
Milestone: Git Worktree and Branch Manager
Priority: P0
Depends on: TASK-050, TASK-051
Goal: Create a git worktree and branch for execution.
Scope: Use local git to create branch/worktree after dry-run passes.
Out of Scope: Codex execution, commit, push.
Implementation Notes: Return worktree path and branch metadata; emit safe metadata only.
Files Likely Touched: `apps/runner/src/git/create-worktree.ts`, `apps/runner/src/git/create-worktree.test.ts`, `BACKLOG.md`
Acceptance Criteria: Worktree is created in fixture repo tests; existing path fails safely.
Validation: Run runner package tests.
Security/Trust Notes: Never create worktree when dry-run blockers exist.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: Worktree cleanup remains deferred to TASK-053; run event integration remains deferred to TASK-054.
Next Recommended Task: TASK-053

### TASK-053 — Implement worktree cleanup helper
Status: [x]
Milestone: Git Worktree and Branch Manager
Priority: P0
Depends on: TASK-052
Goal: Clean up runner-owned worktrees on failure or cancellation.
Scope: Remove worktree paths known to be created by the runner and prune stale entries.
Out of Scope: Removing user-owned repos or branches.
Implementation Notes: Only remove paths under the configured runner worktree root.
Files Likely Touched: `apps/runner/src/git/cleanup-worktree.ts`, `apps/runner/src/git/cleanup-worktree.test.ts`, `BACKLOG.md`
Acceptance Criteria: Runner-owned worktrees clean up; external paths are refused.
Validation: Run runner package tests.
Security/Trust Notes: Avoid destructive cleanup outside runner-owned directories.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: Cleanup is implemented as a local helper only; run event integration remains deferred to TASK-054.
Next Recommended Task: TASK-054

### TASK-054 — Add worktree event integration
Status: [x]
Milestone: Git Worktree and Branch Manager
Priority: P0
Depends on: TASK-052, TASK-032
Goal: Emit structured events for worktree creation and cleanup.
Scope: Add event helpers and wire into runner flow.
Out of Scope: Web event submission.
Implementation Notes: Metadata includes branch and worktree path only.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/events.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: `worktree_created` event validates and has idempotency key.
Validation: Run runner package tests.
Security/Trust Notes: Events must not include file contents or diffs.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: Web event submission remains out of scope; cleanup event helper is available but cleanup orchestration is deferred to later runner flow tasks.
Next Recommended Task: TASK-055

### TASK-055 — Verify worktree milestone
Status: [x]
Milestone: Git Worktree and Branch Manager
Priority: P0
Depends on: TASK-054
Goal: Confirm worktree and branch management is ready for Codex execution.
Scope: Run tests and document outcomes.
Out of Scope: Adding new git behavior.
Implementation Notes: Verify cleanup safety in test output.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Branch/worktree tests pass and external cleanup is refused.
Validation: Run runner git tests and root test suite.
Security/Trust Notes: Confirm no operation touches protected branches directly.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: Codex adapter remains next; no new worktree behavior was added in this verification-only task.
Next Recommended Task: TASK-056

## 7. Codex Exec Adapter

### TASK-056 — Create Codex adapter package entrypoint
Status: [x]
Milestone: Codex Exec Adapter
Priority: P0
Depends on: TASK-011
Goal: Establish `packages/codex` as the Codex invocation boundary.
Scope: Add package exports and adapter interface.
Out of Scope: Running Codex and prompt rendering.
Implementation Notes: Define adapter interface so tests can inject mock Codex.
Files Likely Touched: `packages/codex/src/index.ts`, `packages/codex/src/types.ts`, `BACKLOG.md`
Acceptance Criteria: Runner can import adapter types.
Validation: Run codex package tests and root typecheck.
Security/Trust Notes: The adapter returns local execution status, not web-bound source payloads.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: TASK-057 must keep prompt rendering local-only and avoid modeling source, diff, patch, raw stdout/stderr, or web-bound code payloads in adapter output.
Next Recommended Task: TASK-057

### TASK-057 — Add task-packet prompt renderer
Status: [x]
Milestone: Codex Exec Adapter
Priority: P0
Depends on: TASK-015, TASK-056
Goal: Render a local Codex prompt from a task packet.
Scope: Include objective, acceptance criteria, policy summary, validation commands, and local file path references.
Out of Scope: Embedding source file contents into web-bound data.
Implementation Notes: Prompt is local-only and may reference files by path for Codex to inspect.
Files Likely Touched: `packages/codex/src/prompt-renderer.ts`, `packages/codex/src/prompt-renderer.test.ts`, `BACKLOG.md`
Acceptance Criteria: Prompt includes required execution context and excludes raw file contents.
Validation: Run codex package tests.
Security/Trust Notes: Prompt renderer output must not be sent to the web app.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: TASK-058 must keep `codex exec` invocation local, use the rendered prompt only inside the runner execution boundary, and continue excluding raw source, diffs, patches, snippets, and unredacted logs from web-bound outputs.
Next Recommended Task: TASK-058

### TASK-058 — Implement `codex exec` adapter
Status: [x]
Milestone: Codex Exec Adapter
Priority: P0
Depends on: TASK-056, TASK-057
Goal: Invoke local Codex through `codex exec`.
Scope: Add command construction, cwd handling, timeout, exit capture, and redacted summaries.
Out of Scope: Mock behavior and runner orchestration.
Implementation Notes: Use argv execution and avoid shell string interpolation.
Files Likely Touched: `packages/codex/src/codex-exec.ts`, `packages/codex/src/codex-exec.test.ts`, `BACKLOG.md`
Acceptance Criteria: Adapter builds expected command and handles success/failure in tests.
Validation: Run codex package tests.
Security/Trust Notes: Logs must be redacted before leaving the adapter boundary.
Completion Notes: Implemented the local `codex exec` adapter with direct argv command construction, task worktree cwd handling, prompt-over-stdin execution, timeout kill handling, exit status mapping, missing executable handling, bounded redacted stdout/stderr summaries, prompt scrubbing, source-like output suppression, dotenv/token/JWT redaction, and async stdin error handling so `EPIPE`-style stream failures return safe failed results instead of crashing the caller.
Validation Result: Passed `pnpm --filter @control-plane/codex typecheck`, `pnpm --filter @control-plane/codex test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
Follow-up Risk: TASK-059 should keep mocked Codex behavior under the same no-raw-output boundary, and later runner wiring must still enforce cancellation before invocation while keeping prompts and command output local.
Next Recommended Task: TASK-059

### TASK-059 — Implement mocked Codex adapter
Status: [x]
Milestone: Codex Exec Adapter
Priority: P0
Depends on: TASK-056
Goal: Provide deterministic test-mode Codex behavior.
Scope: Mock adapter modifies fixture repo files according to a test instruction.
Out of Scope: Real Codex CLI use in Sprint 1 E2E.
Implementation Notes: Keep mock modifications simple and explicit.
Files Likely Touched: `packages/codex/src/mock-codex.ts`, `packages/codex/src/mock-codex.test.ts`, `BACKLOG.md`
Acceptance Criteria: Mock adapter can create a safe change in a fixture worktree.
Validation: Run codex package tests.
Security/Trust Notes: Mock output follows the same no-raw-source web-bound constraints.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: TASK-060 must wire mock-vs-real adapter selection into the runner without exposing prompts, raw Codex output, file contents, diffs, patches, snippets, or unredacted command output in events.
Next Recommended Task: TASK-060

### TASK-060 — Wire Codex adapter into runner flow
Status: [x]
Milestone: Codex Exec Adapter
Priority: P0
Depends on: TASK-054, TASK-058, TASK-059
Goal: Let runner invoke real or mocked Codex after worktree creation.
Scope: Add adapter selection from config and emit Codex start/finish events.
Out of Scope: Change scanning and validation.
Implementation Notes: Sprint 1 tests use mock mode by default.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/codex.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: Runner calls mock Codex in tests and emits schema-valid events.
Validation: Run runner and codex tests.
Security/Trust Notes: Codex logs are local and redacted before event output.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: TASK-061 must scan changed paths without reading or emitting raw diffs, patches, file contents, code snippets, prompts, or unredacted command output.
Next Recommended Task: TASK-061

## 8. Change Scanner and Safety Gates

### TASK-061 — Add git changed-file scanner
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-030, TASK-060
Goal: Detect paths changed by Codex in the worktree.
Scope: Use git status/diff name-only to collect changed and untracked file paths.
Out of Scope: Reading file contents or raw diffs.
Implementation Notes: Return paths and counts only.
Files Likely Touched: `apps/runner/src/changes/changed-files.ts`, `apps/runner/src/changes/changed-files.test.ts`, `BACKLOG.md`
Acceptance Criteria: Scanner reports added, modified, deleted, and untracked paths.
Validation: Run runner package tests.
Security/Trust Notes: Scanner must never emit raw diffs or file contents.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: Later safety-gate tasks must treat `omittedPathCount > 0` conservatively because omitted paths may hide sensitive, source-like, absolute, escaping, control-character, or token-looking path text.
Next Recommended Task: TASK-062

### TASK-062 — Add `.env` hard-block detector
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-061
Goal: Hard-block changes to `.env` and env-like secret files.
Scope: Detect `.env`, `.env.*`, and local secret variants in changed paths.
Out of Scope: Secret content scanning.
Implementation Notes: This rule applies even if policy is missing or permissive.
Files Likely Touched: `apps/runner/src/changes/env-block.ts`, `apps/runner/src/changes/env-block.test.ts`, `BACKLOG.md`
Acceptance Criteria: Env file changes produce blocked `RiskFinding`.
Validation: Run runner package tests.
Security/Trust Notes: Env edits never commit or push.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: `omittedPathCount > 0` from the changed-file scanner still needs conservative handling in the later composed safety gate because omitted paths may hide env-like or otherwise sensitive changes.
Next Recommended Task: TASK-063

### TASK-063 — Add suspected secret detector
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-061
Goal: Detect likely secrets in changed files before commit.
Scope: Scan changed file contents locally for common secret patterns and high-entropy strings.
Out of Scope: Uploading secret contents or full file contents.
Implementation Notes: Findings include path and redacted pattern category only.
Files Likely Touched: `apps/runner/src/changes/secret-scan.ts`, `apps/runner/src/changes/secret-scan.test.ts`, `BACKLOG.md`
Acceptance Criteria: Common token/private-key patterns hard-block in tests.
Validation: Run runner package tests.
Security/Trust Notes: Do not log matched secret values.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: The scanner is intentionally not wired into the post-Codex safety gate until the later safety-gate composition tasks.
Next Recommended Task: TASK-064

### TASK-064 — Add protected path safety gate
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-038, TASK-061
Goal: Hard-block protected path edits after Codex changes.
Scope: Classify changed paths against repo policy protected paths.
Out of Scope: Warning paths.
Implementation Notes: Return shared risk findings with paths only.
Files Likely Touched: `apps/runner/src/changes/protected-paths.ts`, `apps/runner/src/changes/protected-paths.test.ts`, `BACKLOG.md`
Acceptance Criteria: Protected path changes block commit and push.
Validation: Run runner package tests.
Security/Trust Notes: Protected path blocks must be visible in events and PR summary.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: The detector is intentionally not wired into the composed post-Codex safety scan, runner events, commit, push, or PR flow until the later safety-gate composition tasks.
Next Recommended Task: TASK-065

### TASK-065 — Add warning path classifier
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-038, TASK-061
Goal: Flag package locks, migrations, infra, auth, and billing changes.
Scope: Classify warning paths from policy and built-in patterns.
Out of Scope: Blocking warnings by default.
Implementation Notes: Warnings include file paths and categories only.
Files Likely Touched: `apps/runner/src/changes/warning-paths.ts`, `apps/runner/src/changes/warning-paths.test.ts`, `BACKLOG.md`
Acceptance Criteria: Known warning path patterns produce warning findings.
Validation: Run runner package tests.
Security/Trust Notes: High-risk flags help reviewers without exposing code.
Completion Notes: Completed by local Codex backlog runner.
Validation Result: Passed
Follow-up Risk: The classifier remains intentionally uncomposed until TASK-067 wires the post-Codex safety scan into runner events, validation gates, commit, push, and PR flow.
Next Recommended Task: TASK-066

### TASK-066 — Add diff-size and file-count gate
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-061
Goal: Detect overly large change sets.
Scope: Count changed files and diff lines locally; emit counts only.
Out of Scope: Sending diff content.
Implementation Notes: Use diff stats, never raw patch text.
Files Likely Touched: `apps/runner/src/changes/change-size.ts`, `apps/runner/src/changes/change-size.test.ts`, `BACKLOG.md`
Acceptance Criteria: Threshold breaches warn or block according to policy.
Validation: Run runner package tests.
Security/Trust Notes: Diff stats are allowed; raw diffs are disallowed.
Completion Notes: Added the runner-local change-size gate with safe changed-file counts, tracked/untracked shortstat line counts, policy-threshold warnings, fail-closed evaluation blockers, entrypoint exports, and non-leakage coverage for raw diffs, patches, source-like keys, command output, and secret text.
Validation Result: Passed (`pnpm --filter @control-plane/runner test -- src/changes/change-size.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`).
Follow-up Risk: The gate is intentionally uncomposed until TASK-067 aggregates changed paths, blockers, and warnings after Codex.
Next Recommended Task: TASK-067

### TASK-067 — Compose change scan result
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-062, TASK-063, TASK-064, TASK-065, TASK-066
Goal: Aggregate changed paths, blockers, and warnings after Codex.
Scope: Produce safe metadata for runner events and downstream validation.
Out of Scope: PR summary rendering.
Implementation Notes: Blockers prevent validation commit path from continuing.
Files Likely Touched: `apps/runner/src/changes/scan-changes.ts`, `apps/runner/src/changes/scan-changes.test.ts`, `BACKLOG.md`
Acceptance Criteria: Aggregated result validates and contains no raw source/diff fields.
Validation: Run runner package tests.
Security/Trust Notes: This is a primary data-boundary enforcement point.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-068
Validation Result: Passed

### TASK-068 — Wire change scan into runner flow
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-060, TASK-067
Goal: Run safety gates after Codex and before validation.
Scope: Emit `changes_scanned`, warning events, and blocked events.
Out of Scope: Validation and commit flow.
Implementation Notes: Stop immediately on hard blockers.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/events.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: Runner blocks `.env`, secrets, and protected paths before validation.
Validation: Run runner package tests.
Security/Trust Notes: Hard-blocked runs never commit, push, or open PRs.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-069 — Verify safety gate milestone
Status: [x]
Milestone: Change Scanner and Safety Gates
Priority: P0
Depends on: TASK-068
Goal: Confirm changed-file safety gates satisfy MVP policy.
Scope: Run safety tests and document outcomes.
Out of Scope: New safety categories beyond MVP.
Implementation Notes: Include explicit no-raw-diff assertion.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Env, secret, protected path, warning path, and size tests pass.
Validation: Run runner changes tests and root test suite.
Security/Trust Notes: Do not proceed if safety metadata leaks code.
Completion Notes: Safety gate milestone verified manually after the concurrent runner exposed this as a no-change milestone task. Focused changed-file, env, secret, protected path, warning path, size, composed scan, and script quality-gate tests passed; runner now has regression coverage for no-change milestone bookkeeping.
Validation Result: `pnpm vitest run apps/runner/src/changes/changed-files.test.ts apps/runner/src/changes/env-block.test.ts apps/runner/src/changes/secret-scan.test.ts apps/runner/src/changes/protected-paths.test.ts apps/runner/src/changes/warning-paths.test.ts apps/runner/src/changes/change-size.test.ts apps/runner/src/changes/scan-changes.test.ts scripts/codex-runner/quality-gates.test.ts` — passed, 8 files and 76 tests.
Next Recommended Task: TASK-072

## 9. Validation Engine

### TASK-070 — Create validation package entrypoint
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-017
Goal: Establish `packages/validation` as command validation boundary.
Scope: Add package exports and result types.
Out of Scope: Running commands.
Implementation Notes: Import shared `ValidationResult` schema.
Files Likely Touched: `packages/validation/src/index.ts`, `packages/validation/package.json`, `BACKLOG.md`
Acceptance Criteria: Runner can import validation engine interfaces.
Validation: Run validation package tests and root typecheck.
Security/Trust Notes: Validation results are web-bound only after redaction.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-066
Validation Result: Passed

### TASK-071 — Implement log redaction helper
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-070
Goal: Redact secrets from command output.
Scope: Remove `.env` values, tokens, API keys, private keys, credentials in URLs, and high-entropy strings.
Out of Scope: Full DLP service.
Implementation Notes: Return redacted text and whether redaction was applied.
Files Likely Touched: `packages/logging/src/redact.ts`, `packages/logging/src/redact.test.ts`, `packages/validation/src/redact.ts`, `BACKLOG.md`
Acceptance Criteria: Common secret fixtures are redacted in tests.
Validation: Run logging and validation tests.
Security/Trust Notes: Redaction must run before logs are emitted or submitted.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-072 — Implement validation command runner
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-070, TASK-071
Goal: Execute one validation command and return a shared result.
Scope: Run command in configured cwd, capture exit code, duration, redacted summaries.
Out of Scope: Multiple command orchestration.
Implementation Notes: Use argv or controlled shell mode according to policy, with timeout support.
Files Likely Touched: `packages/validation/src/run-command.ts`, `packages/validation/src/run-command.test.ts`, `BACKLOG.md`
Acceptance Criteria: Passed, failed, timeout, and skipped outcomes produce valid results.
Validation: Run validation package tests.
Security/Trust Notes: Raw stdout/stderr must not be stored after redaction boundary.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-073
Validation Result: Passed

### TASK-073 — Implement validation suite runner
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-072
Goal: Run configured validation commands for a task packet.
Scope: Execute commands in order, stop or continue according to required flag, aggregate results.
Out of Scope: Web display and PR summary.
Implementation Notes: Required failure blocks commit.
Files Likely Touched: `packages/validation/src/run-validation-suite.ts`, `packages/validation/src/run-validation-suite.test.ts`, `BACKLOG.md`
Acceptance Criteria: Required failures block; optional failures are reported as warnings.
Validation: Run validation package tests.
Security/Trust Notes: Validation summaries must remain redacted.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-074
Validation Result: Passed

### TASK-074 — Wire validation into runner flow
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-068, TASK-073
Goal: Run validation after successful safety scan.
Scope: Emit validation events, write validation results, block failed required validation.
Out of Scope: Commit and PR creation.
Implementation Notes: Check cancellation before validation and between commands.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/validation.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: Failed required validation prevents commit path.
Validation: Run runner and validation tests.
Security/Trust Notes: Validation output must be redacted before event output.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-075
Validation Result: Passed

### TASK-075 — Add validation result artifact writer
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-074
Goal: Persist local validation result artifacts for Sprint 1 E2E.
Scope: Write JSON validation artifacts validated by shared schema.
Out of Scope: Hosted upload.
Implementation Notes: Artifact contains summaries, not raw logs.
Files Likely Touched: `apps/runner/src/artifacts/validation-artifact.ts`, `apps/runner/src/artifacts/validation-artifact.test.ts`, `BACKLOG.md`
Acceptance Criteria: Artifact is schema-valid and redacted.
Validation: Run runner package tests.
Security/Trust Notes: Local artifacts must follow web-bound data rules.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-076
Validation Result: Passed

### TASK-076 — Verify validation milestone
Status: [x]
Milestone: Validation Engine
Priority: P0
Depends on: TASK-075
Goal: Confirm validation engine is ready for commit flow.
Scope: Run validation, logging, and runner validation tests.
Out of Scope: Adding new validation features.
Implementation Notes: Record command output summaries in completion notes.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Validation tests pass and redaction tests prove secret removal.
Validation: Run validation, logging, runner, and root tests.
Security/Trust Notes: Do not proceed if any unredacted secret fixture appears in artifacts.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-078
Validation Result: Passed

## 10. Commit, Push, and PR Creation

### TASK-077 — Implement git commit helper
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-074
Goal: Commit validated safe changes in the worktree.
Scope: Stage changed files, create commit with task/run metadata, return commit hash.
Out of Scope: Push and PR creation.
Implementation Notes: Only run after no blockers and required validation passes.
Files Likely Touched: `packages/github/src/git-commit.ts`, `packages/github/src/git-commit.test.ts`, `BACKLOG.md`
Acceptance Criteria: Fixture worktree commits safe changes and returns hash.
Validation: Run github package tests.
Security/Trust Notes: Never commit `.env`, secrets, or protected path blockers.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-076
Validation Result: Passed

### TASK-078 — Implement git push helper with mockable interface
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-077
Goal: Push committed branch using local git auth.
Scope: Add push interface and mock implementation for tests.
Out of Scope: GitHub App tokens and hosted credentials.
Implementation Notes: Real push path uses local credentials only; tests use local bare remote or mock.
Files Likely Touched: `packages/github/src/git-push.ts`, `packages/github/src/git-push.test.ts`, `BACKLOG.md`
Acceptance Criteria: Mock push returns branch artifact; real helper can push to fixture bare remote.
Validation: Run github package tests.
Security/Trust Notes: Control plane never receives git write credentials for execution.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-079
Validation Result: Passed

### TASK-079 — Implement `gh` PR creation helper
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-078
Goal: Open PR using local GitHub CLI.
Scope: Add real and mocked PR creation interfaces returning PR artifact metadata.
Out of Scope: GitHub App PR creation.
Implementation Notes: Sprint 1 E2E uses mocked `gh`.
Files Likely Touched: `packages/github/src/gh-pr.ts`, `packages/github/src/gh-pr.test.ts`, `BACKLOG.md`
Acceptance Criteria: PR artifact includes URL, number, title, status, branch, changed paths, and risk flags.
Validation: Run github package tests.
Security/Trust Notes: PR artifact must not include raw diff or patch text.
Completion Notes: Added real and mock `gh pr create` helpers that build metadata-only draft PR artifacts, invoke local `gh` with direct argv and body stdin, parse PR URLs, sanitize branch/repo/title/body/path/risk metadata, and return safe errors without raw command output, diffs, patches, snippets, secrets, or local paths. Repaired path safety to allow ordinary path metadata such as content/source/code filenames while still blocking actual diff, patch, secret, and code-snippet-shaped values.
Next Recommended Task: TASK-081
Validation Result: `pnpm --filter @control-plane/github typecheck`; `pnpm --filter @control-plane/github test`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` — passed.

### TASK-080 — Add PR summary renderer
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-067, TASK-073
Goal: Build a safe PR body summary from task, validation, and risk metadata.
Scope: Include objective, acceptance criteria, changed file paths, validation summary, and risk flags.
Out of Scope: Code snippets and diff excerpts.
Implementation Notes: Render Markdown without raw source or patches.
Files Likely Touched: `packages/github/src/pr-summary.ts`, `packages/github/src/pr-summary.test.ts`, `BACKLOG.md`
Acceptance Criteria: Summary contains required sections and rejects/omits code payload fields.
Validation: Run github package tests.
Security/Trust Notes: PR body may live on GitHub, so it must be metadata-only.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-074
Validation Result: Passed

### TASK-081 — Wire commit/push/PR into runner flow
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-077, TASK-078, TASK-079, TASK-080
Goal: Complete the runner path from validation pass to PR artifact.
Scope: Commit safe changes, push branch, create PR artifact, emit events.
Out of Scope: Hosted artifact submission.
Implementation Notes: Check cancellation before commit, push, and PR creation.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/github.ts`, `apps/runner/src/run.test.ts`, `BACKLOG.md`
Acceptance Criteria: Runner produces mocked PR artifact after safe validation in tests.
Validation: Run runner and github tests.
Security/Trust Notes: Cancellation and safety blockers prevent commit/push/PR.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-082
Validation Result: Passed

### TASK-082 — Add local PR artifact writer
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-081
Goal: Persist safe PR artifact for Sprint 1 E2E.
Scope: Write JSON artifact with PR metadata and changed file paths.
Out of Scope: Web submission.
Implementation Notes: Validate artifact against runner protocol PR artifact schema.
Files Likely Touched: `apps/runner/src/artifacts/pr-artifact.ts`, `apps/runner/src/artifacts/pr-artifact.test.ts`, `BACKLOG.md`
Acceptance Criteria: Artifact contains no raw diffs, patches, source, or code snippets.
Validation: Run runner package tests.
Security/Trust Notes: Artifact follows web-bound data rules.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-083
Validation Result: Passed

### TASK-083 — Verify commit/push/PR milestone
Status: [x]
Milestone: Commit, Push, and PR Creation
Priority: P0
Depends on: TASK-082
Goal: Confirm safe changes can become a mocked PR artifact.
Scope: Run github and runner tests and document results.
Out of Scope: Real GitHub PR creation.
Implementation Notes: Include cancellation-before-commit test result.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Commit, mock push, mock PR, and artifact tests pass.
Validation: Run github, runner, and root tests.
Security/Trust Notes: Confirm hard blockers prevent commit and push.
Completion Notes: Completed by heartbeat repair after runner fix-attempt failure. Hardened PR summary/body safety so source-like task prose is omitted or rejected before PR metadata leaves the local boundary.
Next Recommended Task: TASK-095
Validation Result: Passed — `pnpm --filter @control-plane/github typecheck`, `pnpm --filter @control-plane/github test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

## 11. Runner Event System

### TASK-084 — Add event builder helpers
Status: [x]
Milestone: Runner Event System
Priority: P0
Depends on: TASK-016
Goal: Standardize runner event creation.
Scope: Add helpers for state, severity, message, metadata, and idempotency key generation.
Out of Scope: Hosted event API.
Implementation Notes: Stable step names should produce deterministic idempotency keys.
Files Likely Touched: `apps/runner/src/events/build-event.ts`, `apps/runner/src/events/build-event.test.ts`, `BACKLOG.md`
Acceptance Criteria: Every event has contract version and idempotency key.
Validation: Run runner package tests.
Security/Trust Notes: Event builder rejects raw code/diff metadata keys.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-085 — Add event stream ordering tests
Status: [x]
Milestone: Runner Event System
Priority: P0
Depends on: TASK-084
Goal: Confirm events are emitted in expected runner order.
Scope: Test dry-run, blocked, validation failure, and successful PR paths.
Out of Scope: Web timeline rendering.
Implementation Notes: Assert state sequence without overfitting timestamps.
Files Likely Touched: `apps/runner/src/events/event-order.test.ts`, `BACKLOG.md`
Acceptance Criteria: Main paths emit expected ordered states.
Validation: Run runner package tests.
Security/Trust Notes: Blocked paths must emit safe failure details.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-086 — Add local event idempotency tests
Status: [x]
Milestone: Runner Event System
Priority: P0
Depends on: TASK-084
Goal: Prove retried event writes do not create conflicting event identities.
Scope: Test deterministic idempotency keys for repeated steps and attempts.
Out of Scope: Server-side event storage.
Implementation Notes: Use attempt numbers for repeatable repair and validation events.
Files Likely Touched: `apps/runner/src/events/idempotency.test.ts`, `BACKLOG.md`
Acceptance Criteria: Same step/run/attempt yields same key; different attempts differ.
Validation: Run runner package tests.
Security/Trust Notes: Idempotency prevents duplicate run confusion.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-087 — Add event redaction enforcement
Status: [x]
Milestone: Runner Event System
Priority: P0
Depends on: TASK-071, TASK-084
Goal: Ensure event messages and metadata are redacted before persistence.
Scope: Apply redaction to event builder or writer.
Out of Scope: Validation output redaction already handled separately.
Implementation Notes: Reject disallowed payload keys even after redaction.
Files Likely Touched: `apps/runner/src/events/redact-event.ts`, `apps/runner/src/events/redact-event.test.ts`, `BACKLOG.md`
Acceptance Criteria: Secret fixtures are redacted from events.
Validation: Run runner package tests.
Security/Trust Notes: Event stream is a web-bound artifact class.
Completion Notes: Added runner event redaction before event building and persistence, including secret-bearing message redaction, recursive metadata redaction, low-entropy secret-key redaction, and unsafe metadata key rejection after redaction.
Validation Result: `pnpm --filter @control-plane/runner test -- src/events/redact-event.test.ts src/events/build-event.test.ts src/event-writer.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` — passed.
Next Recommended Task: TASK-072

### TASK-088 — Wire event system across runner flow
Status: [x]
Milestone: Runner Event System
Priority: P0
Depends on: TASK-084, TASK-085, TASK-086, TASK-087
Goal: Replace ad hoc runner events with event builder helpers.
Scope: Ensure dry run, worktree, Codex, scan, validation, commit, push, PR, block, and cancel events use common helpers.
Out of Scope: Web timeline.
Implementation Notes: Keep state names aligned with shared `RunState`.
Files Likely Touched: `apps/runner/src/run.ts`, `apps/runner/src/events/*`, `BACKLOG.md`
Acceptance Criteria: All emitted events validate through shared schema.
Validation: Run runner package tests.
Security/Trust Notes: Central event path enforces no raw-source data boundary.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-074
Validation Result: Passed

### TASK-089 — Verify runner event milestone
Status: [x]
Milestone: Runner Event System
Priority: P0
Depends on: TASK-088
Goal: Confirm structured event output is ready for E2E.
Scope: Run runner event tests and inspect sample JSONL.
Out of Scope: Hosted protocol tests.
Implementation Notes: Record sample event count and state sequence in backlog notes.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Event tests pass; sample output has idempotency keys and safe metadata.
Validation: Run runner event tests and root test suite.
Security/Trust Notes: Do not proceed if sample events include code, diffs, patches, or secrets.
Completion Notes: Verified runner event milestone with focused event tests and a local JSONL sample containing 4 schema-shaped events. Sample state sequence: dry_run_running -> dry_run_passed -> worktree_created -> changes_scanned. Idempotency keys were unique, and the sample inspection found no unsafe metadata keys or secret/diff/patch/source-like values.
Validation Result: `pnpm --filter @control-plane/runner test -- src/events.test.ts src/events/build-event.test.ts src/events/event-order.test.ts src/events/idempotency.test.ts src/events/redact-event.test.ts src/event-writer.test.ts src/run.test.ts`; JSONL sample inspection; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` — passed.
Next Recommended Task: TASK-079

## 12. Runner Test Harness

### TASK-090 — Create fixture repository generator
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-049
Goal: Generate local git fixture repos for integration tests.
Scope: Create helper that initializes repo, commits base files, writes policy, and configures validation script.
Out of Scope: Real product repository tests.
Implementation Notes: Fixture source should be tiny and synthetic.
Files Likely Touched: `apps/runner/test/fixtures/create-fixture-repo.ts`, `apps/runner/test/fixtures/*`, `BACKLOG.md`
Acceptance Criteria: Tests can create clean fixture repos repeatedly.
Validation: Run runner fixture tests.
Security/Trust Notes: Fixture files contain no real secrets.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-091 — Create local bare remote harness
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-090
Goal: Simulate git push without external GitHub.
Scope: Add helper to create a local bare remote and configure fixture repo origin.
Out of Scope: Real network push.
Implementation Notes: Use local filesystem paths and clean up after tests.
Files Likely Touched: `apps/runner/test/fixtures/create-bare-remote.ts`, `BACKLOG.md`
Acceptance Criteria: Fixture branch can push to local bare remote.
Validation: Run runner integration tests.
Security/Trust Notes: No external credentials are used.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-072
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` after rebasing onto current `origin/main`.

### TASK-092 — Add mocked `gh` harness
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-079
Goal: Simulate PR creation without real GitHub.
Scope: Provide mock `gh` implementation or PATH shim for tests.
Out of Scope: Real PR creation.
Implementation Notes: Return deterministic PR URL and number.
Files Likely Touched: `apps/runner/test/mocks/gh.ts`, `packages/github/src/gh-pr.test.ts`, `BACKLOG.md`
Acceptance Criteria: Tests produce mocked PR artifact without network.
Validation: Run github and runner tests.
Security/Trust Notes: Mocked PR artifact must follow metadata-only rule.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-081
Validation Result: Passed

### TASK-093 — Add mocked Codex fixture behavior
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-059, TASK-090
Goal: Make mocked Codex modify fixture repo in a safe, deterministic way.
Scope: Add fixture task instruction and mock output behavior.
Out of Scope: Real Codex invocation.
Implementation Notes: Change one safe file and leave validation passing.
Files Likely Touched: `apps/runner/test/mocks/codex.ts`, `packages/codex/src/mock-codex.test.ts`, `BACKLOG.md`
Acceptance Criteria: Mock Codex creates predictable changed paths.
Validation: Run codex and runner tests.
Security/Trust Notes: Mock logs must be redacted and source-free in artifacts.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-069
Validation Result: Passed

### TASK-094 — Add runner happy-path integration test
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-081, TASK-090, TASK-091, TASK-092, TASK-093
Goal: Prove task packet to mocked PR artifact in one test.
Scope: Run dry run, worktree, mocked Codex, scan, validation, commit, mock push, mock PR.
Out of Scope: Web app and real GitHub.
Implementation Notes: Assert events, artifacts, and git branch state.
Files Likely Touched: `apps/runner/test/e2e/runner-happy-path.test.ts`, `BACKLOG.md`
Acceptance Criteria: E2E test passes and produces safe artifacts.
Validation: Run runner E2E test.
Security/Trust Notes: Assert no raw source, diff, patch, or code snippet in web-bound artifacts.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-083
Validation Result: Passed

### TASK-095 — Add runner blocked-path integration tests
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-094
Goal: Prove unsafe changes stop before commit/push/PR.
Scope: Test `.env`, suspected secret, protected path, failed validation, dirty repo, and cancellation-before-commit paths.
Out of Scope: Web cancellation route.
Implementation Notes: Each blocked scenario should assert no commit and no PR artifact.
Files Likely Touched: `apps/runner/test/e2e/runner-blocked-paths.test.ts`, `BACKLOG.md`
Acceptance Criteria: All hard-block scenarios stop safely.
Validation: Run runner E2E tests.
Security/Trust Notes: This is core credibility testing.
Completion Notes: Completed by heartbeat repair after runner interruption. Added runner E2E coverage for `.env`, suspected secret, protected path, failed validation, dirty repo, and cancellation-before-commit hard-block behavior with no commit, push, PR, or unsafe web-bound artifact leakage.
Next Recommended Task: TASK-096
Validation Result: Passed — `pnpm --filter @control-plane/runner typecheck`, `pnpm --filter @control-plane/runner test -- runner-blocked-paths.test.ts`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### TASK-096 — Verify Sprint 1 runner proof
Status: [x]
Milestone: Runner Test Harness
Priority: P0
Depends on: TASK-094, TASK-095
Goal: Confirm Sprint 1 acceptance criteria are complete.
Scope: Run contract, policy, runner, validation, Codex, GitHub helper, and E2E tests.
Out of Scope: Web app work.
Implementation Notes: Update `SPRINT.md` and backlog with exact results.
Files Likely Touched: `SPRINT.md`, `BACKLOG.md`
Acceptance Criteria: Sprint 1 local proof passes with mocked Codex and mocked `gh`.
Validation: Run full root test suite.
Security/Trust Notes: Verify no raw source/diff/patch leakage in artifacts.
Completion Notes: Completed by local Codex backlog runner. `SPRINT.md` now records Sprint 1 verification results for preflight, focused package suites, runner happy-path and blocked-path E2E tests, full repository validation, and artifact non-exfiltration review.
Next Recommended Task: TASK-097
Validation Result: Passed — `pnpm --filter @control-plane/shared test`, `pnpm --filter @control-plane/policies test`, `pnpm --filter @control-plane/validation test`, `pnpm --filter @control-plane/codex test`, `pnpm --filter @control-plane/github test`, `pnpm --filter @control-plane/runner test -- runner-happy-path.test.ts runner-blocked-paths.test.ts`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

## 13. Minimal Web Control Plane Foundation

### TASK-097 — Scaffold Next.js web app
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-096
Goal: Create the web control plane shell after the runner proof works.
Scope: Add Next.js App Router app with TypeScript, Tailwind, and basic layout.
Out of Scope: Auth, database, runner protocol.
Implementation Notes: Use App Router and keep client components minimal.
Files Likely Touched: `apps/web/*`, `BACKLOG.md`
Acceptance Criteria: Web app starts locally and builds.
Validation: Run `pnpm --filter @*/web build`.
Security/Trust Notes: Web app must not request source-code upload.
Completion Notes: Completed by local repair after the Codex implementation phase exited early. Added the `@control-plane/web` Next.js App Router scaffold with TypeScript, Tailwind, package scripts, root generated-output ignores, and a basic operational control-plane shell that keeps source execution local.
Next Recommended Task: TASK-098
Validation Result: Passed — `pnpm --filter '@*/web' build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### TASK-098 — Add shadcn UI baseline
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-097
Goal: Establish reusable UI primitives.
Scope: Configure shadcn components needed for forms, tables, badges, dialogs, and tabs.
Out of Scope: Dashboard polish.
Implementation Notes: Follow existing design guidance; keep operational UI dense and calm.
Files Likely Touched: `apps/web/components/*`, `apps/web/app/globals.css`, `BACKLOG.md`
Acceptance Criteria: Components render in a simple internal page or tests.
Validation: Run web lint and build.
Security/Trust Notes: UI must not expose secrets in client-rendered props.
Completion Notes: Repaired the blocked runner output by replacing inert hand-rolled component wrappers with real shadcn/Radix-backed primitives, adding the shared `cn` utility, shadcn config, an internal `/dashboard/ui-baseline` smoke page, and source tests proving package metadata, lockfile coverage, primitive imports, and safe client data boundaries.
Validation Result: Passed — `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm --filter '@control-plane/web' build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` (91 files, 831 tests) after rebasing on top of `TASK-100`.
Follow-up Risk: The baseline uses focused smoke coverage until the full dashboard screens consume these primitives.
Next Recommended Task: TASK-101

### TASK-099 — Add Clerk auth shell
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-097
Goal: Add signup/sign-in and protected app routes.
Scope: Configure Clerk provider, middleware, sign-in/up routes, and protected dashboard route.
Out of Scope: Workspace creation logic.
Implementation Notes: Keep env validation explicit with `.env.example`.
Files Likely Touched: `apps/web/app/*`, `apps/web/middleware.ts`, `apps/web/.env.example`, `BACKLOG.md`
Acceptance Criteria: Protected route requires auth in local dev.
Validation: Run web build and auth route smoke test.
Security/Trust Notes: Clerk secrets remain server-only and uncommitted.
Completion Notes: Added the Clerk provider shell, sign-in/sign-up routes, protected dashboard route, safe `.env.example` placeholders, source-level auth shell tests, and upgraded to `@clerk/nextjs@7.4.0` so the shell builds with the Next 16 web scaffold.
Validation Result: Passed — `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm --filter '@control-plane/web' build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` (87 files, 818 tests).
Follow-up Risk: Local route smoke remains source-level until real Clerk dev keys are configured; `.env.example` contains placeholders only.
Next Recommended Task: TASK-101

### TASK-100 — Add Drizzle database foundation
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-097
Goal: Add typed Postgres persistence layer.
Scope: Configure Drizzle, database connection helper, migrations folder, and env validation.
Out of Scope: Full schema.
Implementation Notes: Lazily initialize database client for Next.js build safety.
Files Likely Touched: `packages/db/*`, `apps/web/src/db.ts`, `drizzle.config.*`, `BACKLOG.md`
Acceptance Criteria: Empty migration setup works and web app can import db helpers.
Validation: Run db package typecheck and web build.
Security/Trust Notes: Never expose `DATABASE_URL` to the browser.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-101
Validation Result: Passed

### TASK-101 — Add core database schema
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-100
Goal: Model MVP control-plane entities.
Scope: Add tables for workspaces, memberships, runners, repo mappings, tasks, runs, run events, validation results, PR artifacts, approvals, audit events, and plan fields.
Out of Scope: GitHub/Linear-specific sync tables beyond nullable metadata.
Implementation Notes: Add unique constraints for event and claim idempotency.
Files Likely Touched: `packages/db/src/schema.ts`, `packages/db/src/schema.test.ts`, `BACKLOG.md`
Acceptance Criteria: Schema supports all protocol and MVP UI needs.
Validation: Run db tests and migration generation check.
Security/Trust Notes: Store metadata only; no raw source/diff columns.
Completion Notes: Completed by local repair after Codex review timed out. Added Drizzle schema tables and migration artifacts for workspaces, memberships, runners, repo mappings, tasks, runs, run events, validation results, PR artifacts, approvals, and audit events, with protocol idempotency constraints and tests that reject unsafe raw source/diff/log/secret columns.
Next Recommended Task: TASK-102
Validation Result: Passed `pnpm --filter @control-plane/db test` and `pnpm --dir packages/db exec drizzle-kit generate --config drizzle.config.ts` with no pending schema changes.

### TASK-102 — Add server action/API conventions
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-099, TASK-101
Goal: Establish mutation patterns for the web app.
Scope: Define auth checks, workspace scoping, audit event creation, and error handling.
Out of Scope: Specific runner protocol endpoints.
Implementation Notes: Use Server Actions for app UI mutations and route handlers for runner APIs.
Files Likely Touched: `apps/web/src/server/*`, `apps/web/app/api/*`, `BACKLOG.md`
Acceptance Criteria: Example scoped mutation is tested.
Validation: Run web tests and build.
Security/Trust Notes: Every mutation must enforce workspace ownership.
Completion Notes: Completed by manual repair after the backlog runner hit a Codex fix timeout. Added server-side action and route-handler conventions for workspace-scoped mutations, auth checks, audit event creation, structured errors, and metadata-only runner API handling, with tests covering scoped mutation behavior and source-boundary conventions.
Next Recommended Task: TASK-115
Validation Result: Passed `pnpm --filter @control-plane/web typecheck`, `pnpm --filter @control-plane/web build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` (99 files, 859 tests).

### TASK-103 — Add basic app navigation shell
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-098, TASK-099
Goal: Create minimal authenticated app navigation.
Scope: Add links for Overview, Repositories, Tasks, Runs, Pull Requests, Runners, Approvals, Audit Log, Settings.
Out of Scope: Page feature implementation.
Implementation Notes: Empty states should point to runner pairing and manual task creation.
Files Likely Touched: `apps/web/app/(app)/layout.tsx`, `apps/web/components/nav.tsx`, `BACKLOG.md`
Acceptance Criteria: Authenticated nav renders and routes exist.
Validation: Run web build.
Security/Trust Notes: Navigation must not leak workspace data across users.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-101
Validation Result: Passed

### TASK-104 — Verify web foundation
Status: [x]
Milestone: Minimal Web Control Plane Foundation
Priority: P0
Depends on: TASK-097, TASK-098, TASK-099, TASK-100, TASK-101, TASK-102, TASK-103
Goal: Confirm minimal web app foundation is ready for runner pairing.
Scope: Run web checks and update backlog.
Out of Scope: New feature work.
Implementation Notes: Record build and test results.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Web app builds, tests pass, and schema checks pass.
Validation: Run web build, db tests, and root checks.
Security/Trust Notes: Confirm no source-upload feature exists.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-105
Validation Result: Passed

## 14. Workspace and Runner Pairing

### TASK-105 — Implement workspace creation
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-104
Goal: Let signed-in users create a workspace.
Scope: Add workspace create flow, membership row, and audit event.
Out of Scope: Invites and team management.
Implementation Notes: Use Clerk user id for owner membership.
Files Likely Touched: `apps/web/app/(app)/workspaces/*`, `packages/db/src/schema.ts`, `BACKLOG.md`
Acceptance Criteria: User can create and select one workspace.
Validation: Run web integration tests.
Security/Trust Notes: Workspace access must be scoped to authenticated membership.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-106
Validation Result: Passed

### TASK-106 — Add runner pairing code model
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-105
Goal: Store short-lived pairing codes for runner linking.
Scope: Add pairing code table/model, expiry, one-time use, and audit event.
Out of Scope: Runner CLI link command.
Implementation Notes: Store hashed code, not raw code.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/runner-pairing/*`, `BACKLOG.md`
Acceptance Criteria: Pairing codes expire and cannot be reused.
Validation: Run web/db tests.
Security/Trust Notes: Pairing code is a credential and must be short-lived.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-107
Validation Result: Passed

### TASK-107 — Add pairing code UI
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-106
Goal: Let users generate and view a runner pairing code.
Scope: Add runner setup page with code, expiry, and CLI command snippet.
Out of Scope: Runner heartbeat.
Implementation Notes: Show code only once or until expiry according to model.
Files Likely Touched: `apps/web/app/(app)/runners/page.tsx`, `apps/web/components/runner-pairing.tsx`, `BACKLOG.md`
Acceptance Criteria: User can generate a pairing code for current workspace.
Validation: Run web tests and build.
Security/Trust Notes: Do not expose codes to non-members or browser logs.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-108
Validation Result: Passed

### TASK-108 — Implement runner link endpoint
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-106
Goal: Exchange pairing code for runner registration.
Scope: Add route handler that validates code, creates runner, returns runner credential and polling URL.
Out of Scope: CLI link command implementation.
Implementation Notes: Hash runner credential at rest.
Files Likely Touched: `apps/web/app/api/runner/link/route.ts`, `apps/web/src/runner-auth.ts`, `BACKLOG.md`
Acceptance Criteria: Valid code links once; expired/used code fails.
Validation: Run web API tests.
Security/Trust Notes: Runner credentials must not be logged.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-109
Validation Result: Passed

### TASK-109 — Add runner CLI link command
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-108
Goal: Let local runner link to the web workspace.
Scope: Add `runner link --code --base-url`, call endpoint, store credential locally.
Out of Scope: Polling jobs.
Implementation Notes: Store credentials in local config path ignored by git.
Files Likely Touched: `apps/runner/src/link.ts`, `apps/runner/src/credential-store.ts`, `BACKLOG.md`
Acceptance Criteria: CLI link stores runner id and credential safely in tests.
Validation: Run runner tests.
Security/Trust Notes: Credentials never enter events or logs.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-110
Validation Result: Passed

### TASK-110 — Add runner list and status display
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-108
Goal: Show paired runners in the web app.
Scope: Display runner name, status, last heartbeat, capabilities summary placeholder, and revoke action placeholder.
Out of Scope: Live heartbeat and revocation implementation.
Implementation Notes: Offline status is based on last heartbeat timestamp once heartbeats exist.
Files Likely Touched: `apps/web/app/(app)/runners/page.tsx`, `apps/web/components/runner-list.tsx`, `BACKLOG.md`
Acceptance Criteria: Paired runners appear for workspace members only.
Validation: Run web tests and build.
Security/Trust Notes: Do not show credentials in UI.
Completion Notes: Completed by manual merge-queue repair after TASK-109 introduced runner pairing command context on the same page. Added workspace-scoped runner listing service coverage and a runners dashboard list with safe status, heartbeat, capability summary, and disabled revoke placeholder.
Validation Result: Passed (`pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`).
Follow-up Risk: Live heartbeat freshness and runner revocation remain out of scope for this task.
Next Recommended Task: TASK-111

### TASK-111 — Verify pairing milestone
Status: [x]
Milestone: Workspace and Runner Pairing
Priority: P0
Depends on: TASK-105, TASK-106, TASK-107, TASK-108, TASK-109, TASK-110
Goal: Confirm workspace and runner pairing works.
Scope: Run link endpoint, CLI link, and UI tests.
Out of Scope: Polling and job assignment.
Implementation Notes: Document manual local link command.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Runner can be linked to workspace and displayed.
Validation: Run web, runner, and root tests.
Security/Trust Notes: Confirm no pairing credentials are leaked in logs.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-112
Validation Result: Passed

## 15. Runner Protocol and Polling

### TASK-112 — Implement runner authentication middleware
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-108
Goal: Authenticate runner API requests.
Scope: Verify runner credential, workspace association, revocation status, and audit failures.
Out of Scope: User auth routes.
Implementation Notes: Use constant-time comparison for credential hashes where applicable.
Files Likely Touched: `apps/web/src/runner-auth.ts`, `apps/web/app/api/runner/*`, `BACKLOG.md`
Acceptance Criteria: Invalid credentials are rejected; valid runner resolves workspace.
Validation: Run web API tests.
Security/Trust Notes: Runner tokens are scoped and revocable.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-113
Validation Result: Passed

### TASK-113 — Implement heartbeat endpoint
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-112, TASK-019
Goal: Receive runner heartbeat and capabilities.
Scope: Validate payload, update runner status/capabilities, return poll interval and pending control instruction.
Out of Scope: Job polling.
Implementation Notes: Store capability snapshot as metadata.
Files Likely Touched: `apps/web/app/api/runner/heartbeat/route.ts`, `packages/db/src/schema.ts`, `BACKLOG.md`
Acceptance Criteria: Heartbeat updates last-seen and capabilities.
Validation: Run web API tests.
Security/Trust Notes: Capabilities must not include env vars or tokens.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-114
Validation Result: Passed

### TASK-114 — Add runner heartbeat client
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-109, TASK-113
Goal: Let runner send authenticated heartbeats.
Scope: Load stored credential, report capabilities, process server instructions.
Out of Scope: Job execution loop.
Implementation Notes: Retry transient errors without duplicating runs.
Files Likely Touched: `apps/runner/src/protocol/heartbeat.ts`, `apps/runner/src/protocol/client.ts`, `BACKLOG.md`
Acceptance Criteria: Runner heartbeat client passes mocked API tests.
Validation: Run runner tests.
Security/Trust Notes: Do not log runner credential or source paths unnecessarily.
Completion Notes: Completed by manual merge-queue repair after the branch conflicted with newer repo-mapping protocol exports and credential-store hardening. Added the runner protocol client, authenticated heartbeat sender, capability reporting, server instruction normalization, safe credential loading, and mocked protocol tests without exposing runner credentials.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
Follow-up Risk: The runner execution loop still needs to consume heartbeat instructions in later protocol tasks.
Next Recommended Task: TASK-118

### TASK-115 — Implement manual job queue model
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-101
Goal: Store manually approved jobs for runners.
Scope: Add job fields for task packet, status, assigned runner, claim idempotency, attempts, cancellation.
Out of Scope: Linear jobs.
Implementation Notes: Use database constraints to protect duplicate claims.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/jobs/*`, `BACKLOG.md`
Acceptance Criteria: Jobs can be queued and queried by workspace/repo mapping.
Validation: Run db and web tests.
Security/Trust Notes: Task packet stored in web must contain metadata/path references only.
Completion Notes: Completed by manual repair after the backlog runner hit a Codex fix timeout. Added durable manual job queue fields on run rows, queue lookup constraints, cancellation/claim metadata, manual queue helpers, and tests proving queued jobs are scoped by workspace/repo mapping while rejecting raw source, diff, patch, log, snippet, and secret-like task packet payloads.
Next Recommended Task: TASK-104
Validation Result: Passed `pnpm --filter @control-plane/db test`, `pnpm --dir packages/db exec drizzle-kit generate --config drizzle.config.ts`, `pnpm --filter @control-plane/web build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` (100 files, 879 tests).

### TASK-116 — Implement poll jobs endpoint
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-112, TASK-115
Goal: Let runners poll for eligible jobs.
Scope: Validate capabilities, repo mapping, runner availability, and return safe task packet payloads.
Out of Scope: Claiming jobs.
Implementation Notes: Only return jobs for mapped repos and compatible capabilities.
Files Likely Touched: `apps/web/app/api/runner/jobs/poll/route.ts`, `apps/web/src/jobs/poll.ts`, `BACKLOG.md`
Acceptance Criteria: Poll returns only eligible jobs for that runner.
Validation: Run web API tests.
Security/Trust Notes: Poll response must not include source content or secrets.
Completion Notes: Completed by manual repair after the local backlog runner hit a merge-queue metadata conflict. The poll jobs endpoint implementation was already merged to `main`; this entry repairs stale backlog bookkeeping so the runner does not select the completed task again.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
Follow-up Risk: Remaining runner protocol endpoints should continue through the merge queue without reselecting this completed task.
Next Recommended Task: TASK-117

### TASK-117 — Implement idempotent claim endpoint
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-116
Goal: Claim jobs safely under retry and duplicate assignment.
Scope: Require claim idempotency key; enforce first valid claim wins; return existing claim on same key.
Out of Scope: Runner execution.
Implementation Notes: Different runner conflict creates safe failure response.
Files Likely Touched: `apps/web/app/api/runner/jobs/claim/route.ts`, `apps/web/src/jobs/claim.ts`, `BACKLOG.md`
Acceptance Criteria: Duplicate claim retries do not duplicate runs.
Validation: Run web protocol tests.
Security/Trust Notes: Duplicate assignment protection is a hard safety gate.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-114
Validation Result: Passed

### TASK-118 — Implement idempotent event submission endpoint
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-112, TASK-016
Goal: Store runner events exactly once per idempotency key.
Scope: Validate schema, reject disallowed payloads, persist event, return existing on retry.
Out of Scope: Timeline UI.
Implementation Notes: Enforce unique `(runId, idempotencyKey)`.
Files Likely Touched: `apps/web/app/api/runner/runs/events/route.ts`, `apps/web/src/runs/events.ts`, `BACKLOG.md`
Acceptance Criteria: Event retries are idempotent and unsafe payloads are rejected.
Validation: Run web protocol tests.
Security/Trust Notes: Event endpoint rejects raw source, diffs, patches, code snippets.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-119 — Implement result and artifact submission endpoints
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-118
Goal: Store dry-run results, validation results, and PR artifacts.
Scope: Add endpoints and persistence for safe runner artifacts.
Out of Scope: UI display.
Implementation Notes: Validate shared schemas before storage.
Files Likely Touched: `apps/web/app/api/runner/runs/*/route.ts`, `apps/web/src/runs/artifacts.ts`, `BACKLOG.md`
Acceptance Criteria: Artifacts persist and reject raw diff/source fields.
Validation: Run web API tests.
Security/Trust Notes: Artifact endpoints enforce metadata-only boundary.
Completion Notes: Added runner artifact submission endpoints for dry-run results, validation results, and PR artifacts with metadata-only persistence, schema validation, unsafe payload rejection, and regenerated DB migration metadata after merge-queue repair.
Follow-up Risk: The repair preserved partial TASK-146 and TASK-171 runner worktrees for later runner handling.
Next Recommended Task: TASK-120
Validation Result: Passed — focused `pnpm --filter @control-plane/web test -- app/api/runner/runs src/runs/artifacts.test.ts src/server/source-conventions.test.ts` and `pnpm --filter @control-plane/db test`; full `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` passed before commit.

### TASK-120 — Add runner polling loop client
Status: [x]
Milestone: Runner Protocol and Polling
Priority: P0
Depends on: TASK-114, TASK-116, TASK-117, TASK-118, TASK-119
Goal: Connect runner to hosted job protocol.
Scope: Poll jobs, claim idempotently, execute local runner flow, submit events/results/artifacts.
Out of Scope: Linear and GitHub App integrations.
Implementation Notes: Keep local execution authority in runner and web coordination in API.
Files Likely Touched: `apps/runner/src/protocol/poll-loop.ts`, `apps/runner/src/run.ts`, `BACKLOG.md`
Acceptance Criteria: Mock protocol test completes one hosted job path.
Validation: Run runner protocol tests and web protocol tests.
Security/Trust Notes: Protocol client must not upload source, diffs, patches, or code snippets.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-140
Validation Result: Passed

## 16. Repo Mapping in Web App

### TASK-121 — Add repo mapping model and API
Status: [x]
Milestone: Repo Mapping in Web App
Priority: P0
Depends on: TASK-101
Goal: Store local repo mappings for runners.
Scope: Add CRUD API for workspace repo mapping metadata.
Out of Scope: GitHub metadata sync.
Implementation Notes: Store local path as runner-scoped metadata; avoid source indexing.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/repo-mappings/*`, `BACKLOG.md`
Acceptance Criteria: Workspace members can create/list/delete mappings.
Validation: Run web/db tests.
Security/Trust Notes: Repo mapping is path metadata only.
Completion Notes: Completed by manual merge-queue repair after TASK-121 conflicted with newer runner authentication and revocation schema work. Added runner-scoped repo mapping schema, generated migration metadata, safe create/list/delete service behavior, server actions, source-boundary tests, and validation coverage for path metadata without source indexing.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` (113 files, 1027 tests).
Follow-up Risk: TASK-122 must keep runner repo path registration metadata-only and avoid uploading file trees, source content, dependency graphs, diffs, patches, or secrets.
Next Recommended Task: TASK-122

### TASK-122 — Add runner repo mapping CLI command
Status: [x]
Milestone: Repo Mapping in Web App
Priority: P0
Depends on: TASK-121
Goal: Let runner register local repo paths with the control plane.
Scope: Add `runner repos add --path` command that validates local repo then submits mapping metadata.
Out of Scope: Source upload and GitHub App sync.
Implementation Notes: Send repo path, detected remote URL, default branch, and runner id.
Files Likely Touched: `apps/runner/src/repos.ts`, `apps/runner/src/protocol/repo-mappings.ts`, `BACKLOG.md`
Acceptance Criteria: CLI registers mapping in mocked API tests.
Validation: Run runner tests.
Security/Trust Notes: Do not send file tree, source content, or dependency graph.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-114
Validation Result: Passed

### TASK-123 — Add repo mapping UI
Status: [x]
Milestone: Repo Mapping in Web App
Priority: P0
Depends on: TASK-121
Goal: Display and manage registered local repo mappings.
Scope: Add repositories page with runner, path, remote, branch, policy status, and actions.
Out of Scope: Full repo health charts.
Implementation Notes: Empty state points users to runner CLI mapping command.
Files Likely Touched: `apps/web/app/(app)/repositories/page.tsx`, `apps/web/components/repo-mapping-table.tsx`, `BACKLOG.md`
Acceptance Criteria: Repo mappings display only inside their workspace.
Validation: Run web tests and build.
Security/Trust Notes: UI must clearly state source code stays local.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-113
Validation Result: Passed

### TASK-124 — Gate jobs by repo mapping
Status: [x]
Milestone: Repo Mapping in Web App
Priority: P0
Depends on: TASK-116, TASK-121
Goal: Prevent assignment to runners without a matching repo mapping.
Scope: Update poll/claim logic to require active runner mapping.
Out of Scope: Auto-discovery.
Implementation Notes: Missing mapping creates job blocker/status, not silent failure.
Files Likely Touched: `apps/web/src/jobs/poll.ts`, `apps/web/src/jobs/claim.ts`, `BACKLOG.md`
Acceptance Criteria: Jobs are not offered to unmapped runners.
Validation: Run web protocol tests.
Security/Trust Notes: Missing mapping is a hard governance block.
Completion Notes: Completed via manual merge-queue repair after the branch conflicted with duplicate-assignment claim hardening. Poll and claim now require active usable repo mapping metadata, block missing or mismatched mappings with a pathless `missing_mapping` finding, and preserve duplicate-assignment event recording.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` after conflict repair.
Follow-up Risk: Claim and polling are busy shared protocol surfaces; keep queued branches refreshed before merge.
Next Recommended Task: TASK-125

### TASK-125 — Verify repo mapping milestone
Status: [x]
Milestone: Repo Mapping in Web App
Priority: P0
Depends on: TASK-122, TASK-123, TASK-124
Goal: Confirm repo mapping supports manual jobs.
Scope: Run UI/API/protocol tests and update backlog.
Out of Scope: GitHub metadata sync.
Implementation Notes: Record mapping flow.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Runner mapping can be registered, displayed, and used for job eligibility.
Validation: Run web, runner, and root tests.
Security/Trust Notes: Confirm no source tree data is stored.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

## 17. Manual Task Packet Creation

### TASK-126 — Add manual task model and API
Status: [x]
Milestone: Manual Task Packet Creation
Priority: P0
Depends on: TASK-115, TASK-121
Goal: Let users create manual tasks for mapped repos.
Scope: Add task create/list API with objective, acceptance criteria, source metadata, repo mapping.
Out of Scope: Linear import.
Implementation Notes: Store user-entered metadata and path references only.
Files Likely Touched: `apps/web/src/tasks/*`, `apps/web/app/api/tasks/*`, `BACKLOG.md`
Acceptance Criteria: Workspace member can create a manual task for a repo mapping.
Validation: Run web API tests.
Security/Trust Notes: Task creation must not request raw source code.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-113
Validation Result: Passed

### TASK-127 — Add task packet builder service
Status: [x]
Milestone: Manual Task Packet Creation
Priority: P0
Depends on: TASK-015, TASK-126
Goal: Compile a shared `TaskPacket` from manual task metadata.
Scope: Use repo mapping, policy defaults, objective, criteria, validation commands, and mode.
Out of Scope: AI context retrieval.
Implementation Notes: Context files are path references only.
Files Likely Touched: `apps/web/src/task-packets/build-task-packet.ts`, `apps/web/src/task-packets/*.test.ts`, `BACKLOG.md`
Acceptance Criteria: Built packet validates against shared schema.
Validation: Run web tests.
Security/Trust Notes: Builder must not embed source content.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-118
Validation Result: Passed

### TASK-128 — Add manual task creation UI
Status: [x]
Milestone: Manual Task Packet Creation
Priority: P0
Depends on: TASK-126
Goal: Provide a form for manual task creation.
Scope: Select repo mapping, enter objective, acceptance criteria, optional context path references, and dry-run/execute mode.
Out of Scope: Rich document ingestion.
Implementation Notes: Keep form focused and validation explicit.
Files Likely Touched: `apps/web/app/(app)/tasks/new/page.tsx`, `apps/web/components/task-form.tsx`, `BACKLOG.md`
Acceptance Criteria: User can create task and see it in task list.
Validation: Run web tests and build.
Security/Trust Notes: Form labels must discourage source paste; path references only.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-118
Validation Result: Passed

### TASK-129 — Add task approval-to-run action
Status: [x]
Milestone: Manual Task Packet Creation
Priority: P0
Depends on: TASK-127
Goal: Convert a manual task into a queued job.
Scope: Add approve action that creates job with task packet and audit event.
Out of Scope: Automatic eligibility.
Implementation Notes: Approval is explicit even for manual tasks.
Files Likely Touched: `apps/web/src/tasks/approve.ts`, `apps/web/app/(app)/tasks/*`, `BACKLOG.md`
Acceptance Criteria: Approved task creates queued job.
Validation: Run web tests.
Security/Trust Notes: Approval preserves human control before runner execution.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-130 — Add tasks list UI
Status: [x]
Milestone: Manual Task Packet Creation
Priority: P0
Depends on: TASK-128, TASK-129
Goal: Show manual tasks and approval state.
Scope: List task title, repo, status, source, created by, and approve action.
Out of Scope: Dashboard polish.
Implementation Notes: Include empty state for first task creation.
Files Likely Touched: `apps/web/app/(app)/tasks/page.tsx`, `apps/web/components/task-table.tsx`, `BACKLOG.md`
Acceptance Criteria: Task list shows queued/approved status.
Validation: Run web tests and build.
Security/Trust Notes: Do not display sensitive local path data to unauthorized users.
Completion Notes: Added the manual tasks list UI, empty state, approval controls, repo-safe display fields, and web coverage. Manually repaired a merge-queue rebase conflict with newer web test and database exports.
Next Recommended Task: TASK-131
Validation Result: Passed full manual repair validation on 2026-05-23 (`pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm test`, `pnpm run build`).

### TASK-131 — Verify manual task milestone
Status: [x]
Milestone: Manual Task Packet Creation
Priority: P0
Depends on: TASK-126, TASK-127, TASK-128, TASK-129, TASK-130
Goal: Confirm manual tasks can create runner jobs.
Scope: Run task API/UI tests and protocol eligibility test.
Out of Scope: Linear import.
Implementation Notes: Record sample task packet validation result.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Manual task to queued job works with valid task packet.
Validation: Run web and root tests.
Security/Trust Notes: Confirm task packet contains no raw source.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

## 18. Run Timeline and Artifacts

### TASK-132 — Add run list page
Status: [x]
Milestone: Run Timeline and Artifacts
Priority: P0
Depends on: TASK-118
Goal: Show workspace runs.
Scope: List run status, task, runner, repo mapping, updated time, and PR status.
Out of Scope: Detailed timeline.
Implementation Notes: Use server-side data fetching scoped to workspace.
Files Likely Touched: `apps/web/app/(app)/runs/page.tsx`, `apps/web/components/run-table.tsx`, `BACKLOG.md`
Acceptance Criteria: Runs list renders scoped runs.
Validation: Run web tests and build.
Security/Trust Notes: Runs show metadata only.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-133 — Add run detail timeline
Status: [x]
Milestone: Run Timeline and Artifacts
Priority: P0
Depends on: TASK-132
Goal: Display append-only run events in order.
Scope: Show state, severity, message, timestamp, and safe metadata.
Out of Scope: Real-time streaming.
Implementation Notes: Sort by created and received order.
Files Likely Touched: `apps/web/app/(app)/runs/[runId]/page.tsx`, `apps/web/components/run-timeline.tsx`, `BACKLOG.md`
Acceptance Criteria: Timeline displays idempotent events without duplicates.
Validation: Run web tests.
Security/Trust Notes: UI must not render raw HTML from runner messages.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-134 — Add dry-run result display
Status: [x]
Milestone: Run Timeline and Artifacts
Priority: P0
Depends on: TASK-119, TASK-133
Goal: Show dry-run readiness checks.
Scope: Display check results, blockers, warnings, and runner capabilities.
Out of Scope: Capability management.
Implementation Notes: Make blockers visually distinct.
Files Likely Touched: `apps/web/components/dry-run-result.tsx`, `apps/web/app/(app)/runs/[runId]/page.tsx`, `BACKLOG.md`
Acceptance Criteria: Dry-run result renders passed, warning, and failed states.
Validation: Run web tests and build.
Security/Trust Notes: Display only safe metadata.
Completion Notes: Added a safe dry-run result display for run detail pages, including readiness check status, blockers, warnings, runner capabilities, and sanitized dry-run metadata alongside the existing timeline and validation result surfaces.
Follow-up Risk: Full-suite validation exposed one runner orchestration timing test that passed on isolated rerun and passed in the final full-suite rerun; keep an eye on this test if local machines are under heavy load.
Next Recommended Task: TASK-120
Validation Result: Passed — `pnpm --filter @control-plane/web test -- src/runs/detail.test.ts app/run-detail-ui.test.ts`, `pnpm --filter @control-plane/web test`, `pnpm --filter @control-plane/web typecheck`, `pnpm --filter @control-plane/web lint`, `pnpm --filter @control-plane/web build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm test`.

### TASK-135 — Add validation result display
Status: [x]
Milestone: Run Timeline and Artifacts
Priority: P0
Depends on: TASK-119, TASK-133
Goal: Show validation command outcomes.
Scope: Display command labels, statuses, exit codes, durations, and redacted summaries.
Out of Scope: Raw log download.
Implementation Notes: Mark redaction status.
Files Likely Touched: `apps/web/components/validation-result.tsx`, `BACKLOG.md`
Acceptance Criteria: Validation results show pass/fail/skipped/cancelled states.
Validation: Run web tests.
Security/Trust Notes: Never show unredacted logs.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-120
Validation Result: Passed

### TASK-136 — Add PR artifact display
Status: [x]
Milestone: Run Timeline and Artifacts
Priority: P0
Depends on: TASK-119, TASK-133
Goal: Show PR URL and metadata after runner opens PR.
Scope: Display PR link, branch, status, changed file paths, and risk flags.
Out of Scope: GitHub App live status.
Implementation Notes: Changed files are paths only.
Files Likely Touched: `apps/web/components/pr-artifact.tsx`, `BACKLOG.md`
Acceptance Criteria: PR artifact renders and links out.
Validation: Run web tests and build.
Security/Trust Notes: Do not display diffs, patches, or source snippets.
Completion Notes: Added a server-rendered PR artifact panel to run details, expanded safe PR artifact metadata shaping, and reused the web-bound payload guard so only PR URL/status/title, branch, repository, changed path metadata, and risk flags are displayed.
Follow-up Risk: Live GitHub status remains deferred to TASK-154; this display intentionally uses stored artifact metadata only.
Next Recommended Task: TASK-137
Validation Result: Passed — `pnpm --filter @control-plane/web test -- app/run-detail-ui.test.ts src/runs/detail.test.ts`, `pnpm --filter @control-plane/web test`, `pnpm --filter @control-plane/web typecheck`, `pnpm --filter @control-plane/web lint`, `pnpm --filter @control-plane/web build`.

### TASK-137 — Verify timeline/artifacts milestone
Status: [x]
Milestone: Run Timeline and Artifacts
Priority: P0
Depends on: TASK-132, TASK-133, TASK-134, TASK-135, TASK-136
Goal: Confirm run history is useful for approval.
Scope: Run UI tests and inspect sample run detail page.
Out of Scope: Approval actions.
Implementation Notes: Use fixture event/artifact data.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Run detail shows task, events, dry run, validation, and PR artifact.
Validation: Run web tests and build.
Security/Trust Notes: Confirm no code/diff rendering path exists.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-120
Validation Result: Passed

## 19. Cancellation Flow

### TASK-138 — Add cancellation request model and action
Status: [x]
Milestone: Cancellation Flow
Priority: P0
Depends on: TASK-115
Goal: Let users request run cancellation from the web app.
Scope: Add cancellation state update, audit event, and reason field.
Out of Scope: Runner cancellation enforcement.
Implementation Notes: Only allow cancellation for non-terminal runs.
Files Likely Touched: `apps/web/src/runs/cancel.ts`, `packages/db/src/schema.ts`, `BACKLOG.md`
Acceptance Criteria: Cancel action marks run/job as cancel requested.
Validation: Run web tests.
Security/Trust Notes: Cancellation is part of human governance.
Completion Notes: Completed by manual repair after the concurrent merge queue hit a source conflict. Added the cancellation service/action path with workspace membership checks, non-terminal run enforcement, audit metadata, safe reason redaction, and run-surface revalidation.
Validation Result: Passed (`pnpm exec vitest run apps/web/src/server/actions.test.ts apps/web/src/runs/cancel.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`).
Follow-up Risk: Runner-side cancellation checkpoints remain in TASK-140 after TASK-120 lands.
Next Recommended Task: TASK-139

### TASK-139 — Expose cancellation through heartbeat/poll responses
Status: [x]
Milestone: Cancellation Flow
Priority: P0
Depends on: TASK-113, TASK-138
Goal: Deliver cancellation instructions to the runner.
Scope: Include cancel instruction for current run in heartbeat and polling responses.
Out of Scope: Runner process termination.
Implementation Notes: Instruction includes run id and reason.
Files Likely Touched: `apps/web/app/api/runner/heartbeat/route.ts`, `apps/web/src/jobs/poll.ts`, `BACKLOG.md`
Acceptance Criteria: Runner receives cancellation for matching active run.
Validation: Run web protocol tests.
Security/Trust Notes: Cancellation instruction contains no source data.
Completion Notes: Delivered metadata-only cancellation instructions through heartbeat and poll responses, added shared protocol coverage, and preserved repo-mapping missing-mapping blocks during manual merge-queue repair.
Validation Result: Passed full manual repair validation on 2026-05-23 (`pnpm vitest run apps/web/src/jobs/poll.test.ts apps/web/src/runners/heartbeat.test.ts packages/shared/src/runner-protocol.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`).
Follow-up Risk: Runner-side cancellation checkpoints remain in TASK-140 after TASK-120 lands.
Next Recommended Task: TASK-119

### TASK-140 — Add runner cancellation checkpoints
Status: [x]
Milestone: Cancellation Flow
Priority: P0
Depends on: TASK-120, TASK-139
Goal: Stop runner execution at safe boundaries.
Scope: Check cancellation before dry run, worktree, Codex, validation, commit, push, PR, and repair.
Out of Scope: Web button UI.
Implementation Notes: Emit `cancel_requested`, `cancelling`, and `cancelled` events.
Files Likely Touched: `apps/runner/src/cancellation.ts`, `apps/runner/src/run.ts`, `BACKLOG.md`
Acceptance Criteria: Cancellation before commit prevents commit/push/PR.
Validation: Run runner cancellation tests.
Security/Trust Notes: Cancellation must preserve local cleanup safety.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-142
Validation Result: Passed

### TASK-141 — Add cancel action to run detail UI
Status: [x]
Milestone: Cancellation Flow
Priority: P0
Depends on: TASK-138, TASK-133
Goal: Let users request cancellation from run detail.
Scope: Add cancel button/dialog for cancellable runs and show cancellation events.
Out of Scope: Bulk cancellation.
Implementation Notes: Require user reason.
Files Likely Touched: `apps/web/components/cancel-run-button.tsx`, `apps/web/app/(app)/runs/[runId]/page.tsx`, `BACKLOG.md`
Acceptance Criteria: Cancel action is hidden for terminal runs.
Validation: Run web tests and build.
Security/Trust Notes: Only workspace members can cancel.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-142 — Verify cancellation milestone
Status: [x]
Milestone: Cancellation Flow
Priority: P0
Depends on: TASK-139, TASK-140, TASK-141
Goal: Confirm web cancellation stops local runner safely.
Scope: Run web protocol and runner cancellation tests.
Out of Scope: New cancellation states.
Implementation Notes: Include before-commit and before-PR tests.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Cancelled runs do not commit, push, or open PR.
Validation: Run web, runner, and root tests.
Security/Trust Notes: Cancellation protects human control.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-147
Validation Result: Passed

## 20. Approval and Repair Flow

### TASK-143 — Add approval decision persistence
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-018, TASK-101
Goal: Store human approval decisions.
Scope: Persist approve, reject, repair, rerun validation, cancel, and close decisions with audit event.
Out of Scope: UI actions.
Implementation Notes: Decisions require actor and reason.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/approvals/*`, `BACKLOG.md`
Acceptance Criteria: Decisions validate and persist.
Validation: Run web/db tests.
Security/Trust Notes: Approval authority remains explicit and auditable.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-118
Validation Result: Passed

### TASK-144 — Add approve/reject actions
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-143, TASK-137
Goal: Let users approve or reject runs awaiting approval.
Scope: Add server actions and run detail controls.
Out of Scope: Merge automation.
Implementation Notes: Approval records human decision only; it does not merge.
Files Likely Touched: `apps/web/src/approvals/actions.ts`, `apps/web/components/approval-actions.tsx`, `BACKLOG.md`
Acceptance Criteria: Approve and reject update run state and audit log.
Validation: Run web tests.
Security/Trust Notes: No auto-merge behavior may be introduced.
Completion Notes: Added human approve/reject server actions, scoped run-detail controls, bounded decision reasons, safe action parsing, atomic approval decision persistence with run-state transitions, and audit metadata that excludes raw reason text, source, diffs, patches, logs, and secrets.
Follow-up Risk: Runner-side repair execution remains in TASK-147 and still depends on TASK-120; approval actions deliberately do not merge, push, close PRs, or trigger runner execution.
Next Recommended Task: TASK-120
Validation Result: Passed manual merge-queue repair validation on 2026-05-24 (`pnpm --filter @control-plane/web test -- src/approvals/actions.test.ts src/approvals/decisions.test.ts src/server/actions.test.ts app/run-detail-ui.test.ts`; `pnpm --filter @control-plane/web test`; `pnpm --filter @control-plane/web typecheck`; `pnpm --filter @control-plane/web lint`; `pnpm --filter @control-plane/web build`; `pnpm run format:check`; `pnpm run typecheck`; `pnpm run lint`; `pnpm test`; `pnpm run build`).

### TASK-145 — Add repair request model
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-143
Goal: Represent manual repair requests.
Scope: Store repair feedback, attempt count, max attempts, previous run id, and queued repair job.
Out of Scope: Runner repair execution.
Implementation Notes: Default max attempts is 2.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/repairs/*`, `BACKLOG.md`
Acceptance Criteria: Repair request creates repair job when under attempt limit.
Validation: Run web/db tests.
Security/Trust Notes: Repair feedback must not require source paste.
Completion Notes: Completed by local Codex backlog runner. Manually repaired the merge-queue conflict by preserving cancellation and missing-mapping poll behavior while adding packetless repair-run skipping, then adjusted the pagination test to account for the existing mapping-gate lookup.
Next Recommended Task: TASK-146
Validation Result: Passed — `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`; `pnpm --filter @control-plane/web test`; `pnpm --filter @control-plane/db test`.

### TASK-146 — Add repair packet builder
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-145, TASK-127
Goal: Build repair-mode task packet from previous run and human feedback.
Scope: Include previous metadata, acceptance criteria, feedback, attempt count, and same repo policy.
Out of Scope: Embedding raw diffs or source.
Implementation Notes: Use changed file paths and validation summaries only.
Files Likely Touched: `apps/web/src/repairs/build-repair-packet.ts`, `BACKLOG.md`
Acceptance Criteria: Repair packet validates against shared `TaskPacket`.
Validation: Run web tests.
Security/Trust Notes: Repair packet must not include raw code, diffs, or patches.
Completion Notes: Added a server-only repair packet builder that creates schema-valid repair-mode task packets from prior run metadata and sanitized repair feedback, preserves original acceptance criteria, validation commands, repo policy, and target branch, filters unsafe changed paths and validation summaries, and wires the concrete builder into repair request creation while keeping injection support for tests.
Follow-up Risk: Runner-side repair execution remains deferred to TASK-147 and still depends on TASK-120.
Next Recommended Task: TASK-147
Validation Result: Passed — `pnpm --filter @control-plane/web test -- src/repairs/build-repair-packet.test.ts src/repairs/repair-requests.test.ts src/server/source-conventions.test.ts`, `pnpm --filter @control-plane/web test`, `pnpm --filter @control-plane/web typecheck`, `pnpm --filter @control-plane/web lint`, `pnpm run format:check`, `pnpm test`, `pnpm run typecheck`, `pnpm run lint`.

### TASK-147 — Add runner repair execution support
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-120, TASK-146
Goal: Let runner execute repair jobs.
Scope: Treat repair packet as bounded rerun, invoke Codex, rescan, validate, commit update, push branch.
Out of Scope: Automatic repair.
Implementation Notes: Enforce attempt limit and cancellation checkpoints.
Files Likely Touched: `apps/runner/src/repair.ts`, `apps/runner/src/run.ts`, `BACKLOG.md`
Acceptance Criteria: Mock repair E2E updates branch and PR artifact.
Validation: Run runner repair tests.
Security/Trust Notes: Repair remains manual and metadata-only across web boundary.
Completion Notes: Added bounded repair-mode runner execution against existing task branches, repair worktree reuse/creation safety checks, attempt-limit enforcement, cancellation handling before repair execution, metadata-only repair events, existing-PR refresh support, and safe blocked events for repair-preparation failures.
Follow-up Risk: Repair remains manually requested; automatic repair and auto-approval remain out of scope.
Next Recommended Task: TASK-149
Validation Result: Passed — `pnpm --filter @control-plane/runner test -- src/repair.test.ts src/run.test.ts`; `pnpm --filter @control-plane/runner test -- src/repair.test.ts src/run.test.ts src/protocol/poll-loop.test.ts test/e2e/runner-repair.test.ts`; `pnpm --filter @control-plane/github test`; `pnpm --filter @control-plane/runner typecheck`; `pnpm run format:check`; `pnpm run lint`; `pnpm run typecheck`; `pnpm test`.

### TASK-148 — Add repair UI
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-145, TASK-146
Goal: Let users request repair from run detail.
Scope: Add feedback form, attempt count display, and disabled state at limit.
Out of Scope: Chat-style repair loop.
Implementation Notes: Require concise feedback.
Files Likely Touched: `apps/web/components/request-repair-dialog.tsx`, `apps/web/app/(app)/runs/[runId]/page.tsx`, `BACKLOG.md`
Acceptance Criteria: Repair request queues repair job and appears in timeline.
Validation: Run web tests and build.
Security/Trust Notes: UI warns not to paste secrets or source code.
Completion Notes: Added a run-detail repair request dialog with bounded feedback, attempt-count display, limit-aware disabled states, safe server action wiring, and metadata-only repair summaries while preserving dry-run, validation, timeline, and PR artifact displays.
Follow-up Risk: Runner-side repair execution remains in TASK-147, and approval/rejection controls in TASK-144 are still needed before TASK-149 can verify the full approval/repair milestone.
Next Recommended Task: TASK-144
Validation Result: Passed manual merge-queue repair validation on 2026-05-24 (`pnpm --filter @control-plane/web test -- src/repairs/repair-requests.test.ts src/runs/detail.test.ts src/server/actions.test.ts app/run-detail-ui.test.ts`; `pnpm --filter @control-plane/web test`; `pnpm --filter @control-plane/web typecheck`; `pnpm --filter @control-plane/web lint`; `pnpm --filter @control-plane/web build`; `pnpm run format:check`; `pnpm run typecheck`; `pnpm run lint`; `pnpm test`; `pnpm run build`).

### TASK-149 — Verify approval/repair milestone
Status: [x]
Milestone: Approval and Repair Flow
Priority: P0
Depends on: TASK-144, TASK-147, TASK-148
Goal: Confirm human approval and bounded repair are complete.
Scope: Run web, runner, and repair flow tests.
Out of Scope: Auto-merge and automatic retries.
Implementation Notes: Record repair attempt limit behavior.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: User can approve, reject, or request repair; repair is capped and manual.
Validation: Run web, runner, and root tests.
Security/Trust Notes: Human review remains final authority.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-150
Validation Result: Passed

## 21. GitHub Visibility Integration

### TASK-150 — Add GitHub integration package shell
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-149
Goal: Prepare GitHub App/OAuth visibility integration.
Scope: Add package entrypoints for GitHub App client and webhook helpers.
Out of Scope: Runner push/PR execution changes.
Implementation Notes: Keep local git/`gh` responsible for v1 push and PR creation.
Files Likely Touched: `packages/github/src/app-client.ts`, `packages/github/src/webhooks.ts`, `BACKLOG.md`
Acceptance Criteria: Package exports visibility helpers without affecting runner execution.
Validation: Run github package tests.
Security/Trust Notes: GitHub App is for metadata and visibility, not local code execution.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-151
Validation Result: Passed

### TASK-151 — Add GitHub App installation model
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-150
Goal: Store GitHub installation metadata.
Scope: Add installation id, account, permissions summary, and workspace link.
Out of Scope: Source cloning or hosted execution.
Implementation Notes: Store metadata needed for repo and PR status sync.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/github/installations.ts`, `BACKLOG.md`
Acceptance Criteria: Installation metadata can be persisted and listed.
Validation: Run db/web tests.
Security/Trust Notes: Do not store source contents from GitHub.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-152 — Implement GitHub webhook verification
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-151
Goal: Receive GitHub metadata events securely.
Scope: Verify signatures and handle installation, repository, and pull request event envelopes.
Out of Scope: Full PR comment automation.
Implementation Notes: Reject unsigned or invalid webhooks.
Files Likely Touched: `apps/web/app/api/github/webhook/route.ts`, `packages/github/src/webhooks.ts`, `BACKLOG.md`
Acceptance Criteria: Valid fixtures pass; invalid signatures fail.
Validation: Run GitHub webhook tests.
Security/Trust Notes: Webhooks store metadata only.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-153 — Add repository metadata sync
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-152
Goal: Sync repository metadata for installed GitHub accounts.
Scope: Store repo owner/name/default branch/private flag and installation mapping.
Out of Scope: Code checkout or file indexing.
Implementation Notes: Connect GitHub repo metadata to local repo mappings when remote URLs match.
Files Likely Touched: `apps/web/src/github/repositories.ts`, `packages/db/src/schema.ts`, `BACKLOG.md`
Acceptance Criteria: Repo metadata appears in repository page.
Validation: Run web/GitHub tests.
Security/Trust Notes: Metadata sync must not read source files.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-154 — Add PR status tracking
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-153, TASK-136
Goal: Update PR artifacts with live GitHub status.
Scope: Track PR open/closed/merged, review state, checks summary, and URL.
Out of Scope: Auto-merge.
Implementation Notes: Use GitHub App visibility only.
Files Likely Touched: `apps/web/src/github/pull-requests.ts`, `apps/web/components/pr-artifact.tsx`, `BACKLOG.md`
Acceptance Criteria: PR artifact can refresh status from GitHub metadata.
Validation: Run web/GitHub tests.
Security/Trust Notes: Merge remains human-owned outside the app by default.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-155 — Add GitHub connection UI
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-151, TASK-153
Goal: Show GitHub installation and repository visibility status.
Scope: Add settings page section for GitHub connection and synced repos.
Out of Scope: Advanced permissions management.
Implementation Notes: Make local execution boundary clear.
Files Likely Touched: `apps/web/app/(app)/settings/github/page.tsx`, `apps/web/components/github-settings.tsx`, `BACKLOG.md`
Acceptance Criteria: Users can see installation status and synced repo metadata.
Validation: Run web tests and build.
Security/Trust Notes: UI states GitHub App does not execute code in v1.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-156 — Verify GitHub visibility milestone
Status: [x]
Milestone: GitHub Visibility Integration
Priority: P1
Depends on: TASK-150, TASK-151, TASK-152, TASK-153, TASK-154, TASK-155
Goal: Confirm GitHub metadata integration works without changing execution authority.
Scope: Run GitHub package, webhook, and UI tests.
Out of Scope: Real runner push changes.
Implementation Notes: Record proof that local git/`gh` remains execution path.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: GitHub metadata sync and PR status tracking pass tests.
Validation: Run github, web, and root tests.
Security/Trust Notes: Confirm no hosted source access or push authority is added.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

## 22. Linear Intake Integration

### TASK-157 — Add Linear package shell
Status: [x]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-149
Goal: Prepare Linear as the first task source.
Scope: Add client package entrypoints and OAuth helper interfaces.
Out of Scope: Auto-running Linear issues.
Implementation Notes: Keep manual approve-to-run.
Files Likely Touched: `packages/linear/src/index.ts`, `packages/linear/package.json`, `BACKLOG.md`
Acceptance Criteria: Web can import Linear client interfaces.
Validation: Run linear package tests.
Security/Trust Notes: Linear content becomes task metadata, not source execution authority.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-150
Validation Result: Passed

### TASK-158 — Add Linear OAuth connection model
Status: [x]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-157
Goal: Store Linear connection metadata and encrypted tokens.
Scope: Add workspace connection table and token storage strategy.
Out of Scope: Issue sync.
Implementation Notes: Tokens must be server-only and encrypted or stored through secure provider.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/linear/oauth.ts`, `BACKLOG.md`
Acceptance Criteria: Linear connection can be created and revoked in tests.
Validation: Run web/db tests.
Security/Trust Notes: Linear tokens must not reach client components.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-159 — Implement Linear issue sync
Status: [x]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-158
Goal: Import Linear issue metadata into the task queue.
Scope: Sync issue id, title, body summary, comments summary, status, labels, project, URL.
Out of Scope: Broad company crawling or external docs ingestion.
Implementation Notes: Keep raw issue text bounded and user-visible; do not fetch unrelated systems.
Files Likely Touched: `apps/web/src/linear/sync-issues.ts`, `packages/db/src/schema.ts`, `BACKLOG.md`
Acceptance Criteria: Synced issues appear as candidate tasks.
Validation: Run Linear sync tests with mocked API.
Security/Trust Notes: Linear import must not trigger execution automatically.
Completion Notes: Implemented bounded Linear issue candidate sync with metadata-only persistence, mocked Linear API coverage, database schema/migration support, and web/db exports. Manually repaired the stale-base merge queue conflict by rebasing the validated task branch onto current `main` and merging the Linear migration snapshot with the existing GitHub/PR schema snapshot.
Follow-up Risk: Linear eligibility and approval flow remain in TASK-160 through TASK-163.
Next Recommended Task: TASK-160
Validation Result: Passed — `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`.

### TASK-160 — Add Ready-for-AI filter
Status: [x]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-159
Goal: Identify Linear issues eligible for manual approval.
Scope: Support configured status or label such as `Ready for AI`.
Out of Scope: Auto-run.
Implementation Notes: Eligibility creates candidates, not jobs.
Files Likely Touched: `apps/web/src/linear/eligibility.ts`, `apps/web/src/linear/eligibility.test.ts`, `BACKLOG.md`
Acceptance Criteria: Ready status/label issues are filtered into candidate list.
Validation: Run Linear package/web tests.
Security/Trust Notes: Manual approval remains required.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-161
Validation Result: Passed

### TASK-161 — Build task packet from Linear issue
Status: [ ]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-127, TASK-160
Goal: Convert a Linear issue into a manual-approval task packet candidate.
Scope: Use title, body, comments summary, acceptance criteria extraction, repo mapping selection.
Out of Scope: Autonomous context crawling.
Implementation Notes: User reviews/edits packet before approve-to-run.
Files Likely Touched: `apps/web/src/linear/build-task-packet.ts`, `BACKLOG.md`
Acceptance Criteria: Candidate packet validates and requires manual approval.
Validation: Run web/Linear tests.
Security/Trust Notes: Do not include linked external documents unless explicitly supported as bounded metadata.
Completion Notes: Not started.

### TASK-162 — Add Linear intake UI
Status: [ ]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-160, TASK-161
Goal: Let users review Ready-for-AI Linear issues and approve them into the queue.
Scope: Add issue list, filters, packet preview, and approve-to-run action.
Out of Scope: Automatic execution.
Implementation Notes: Make manual approval explicit in the UI.
Files Likely Touched: `apps/web/app/(app)/tasks/linear/page.tsx`, `apps/web/components/linear-issue-list.tsx`, `BACKLOG.md`
Acceptance Criteria: User can approve a Linear issue into a queued job.
Validation: Run web tests and build.
Security/Trust Notes: UI must not imply all eligible tickets auto-run.
Completion Notes: Not started.

### TASK-163 — Verify Linear intake milestone
Status: [ ]
Milestone: Linear Intake Integration
Priority: P1
Depends on: TASK-157, TASK-158, TASK-159, TASK-160, TASK-161, TASK-162
Goal: Confirm Linear works as a bounded task source.
Scope: Run mocked Linear OAuth, sync, eligibility, packet, and UI tests.
Out of Scope: Slack, Notion, Jira, or broad crawling.
Implementation Notes: Record manual approval behavior.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Ready Linear issue can become approved queued job after human action.
Validation: Run linear, web, and root tests.
Security/Trust Notes: Linear integration must not bypass local runner governance.
Completion Notes: Not started.

## 23. Dashboard Polish

UI Handover Source: Use `https://github.com/rory-hayes/code-companion.git` as the Cortex UI/UX reference implementation. Treat `src/routes/handover.tsx` in that repo as the canonical screen, copy, data, and interaction handover for this milestone. The goal is not a generic redesign; it is to merge/adapt that trust-first Cortex interface into this app before MVP validation.

### TASK-164 — Add overview data query
Status: [x]
Milestone: Dashboard Polish
Priority: P1
Depends on: TASK-137, TASK-142, TASK-149
Goal: Aggregate dashboard answers.
Scope: Query runner online state, ready tasks, running runs, failed runs, approvals needed, build phase progress, and recent run trace metadata needed by the Cortex overview.
Out of Scope: Charts and analytics.
Implementation Notes: Keep query workspace-scoped and fast. Shape the data to support the `code-companion` handover overview without exposing raw source, diffs, patches, snippets, or unredacted logs.
Files Likely Touched: `apps/web/src/dashboard/overview.ts`, `BACKLOG.md`
Acceptance Criteria: Query returns the core overview buckets and UI handover fields for runner health, active runs, blocked runs, awaiting approval, recent runs, run trace, and roadmap/build phase status.
Validation: Run web tests.
Security/Trust Notes: Overview uses metadata only.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-150
Validation Result: Passed

### TASK-165 — Build overview page
Status: [x]
Milestone: Dashboard Polish
Priority: P1
Depends on: TASK-164
Goal: Render the operational overview.
Scope: Merge/adapt the Cortex overview UI from `rory-hayes/code-companion`, showing runner online, ready, running, failed, approval-needed, recent runs, selected run trace, and build phase sections.
Out of Scope: Decorative charts.
Implementation Notes: Use the visual direction from `src/routes/handover.tsx`: calm operational dashboard, left navigation, evidence-rich run trace, restrained status badges, and compact cards. Replace mock data with real control-plane state.
Files Likely Touched: `apps/web/app/(app)/overview/page.tsx`, `apps/web/components/overview/*`, `BACKLOG.md`
Acceptance Criteria: Overview matches the Cortex UX direction and answers the MVP operational questions without feeling empty: what is running, what is blocked, what needs approval, which runners are online, and what evidence supports the selected run.
Validation: Run web tests and build.
Security/Trust Notes: No source details are displayed.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-178
Validation Result: Passed

### TASK-166 — Polish repositories and runners pages
Status: [x]
Milestone: Dashboard Polish
Priority: P1
Depends on: TASK-123, TASK-110
Goal: Improve scanability of repo and runner operational pages.
Scope: Merge/adapt the Cortex repositories and runners screens from `rory-hayes/code-companion`, including statuses, filters, empty states, capability badges, pairing guidance, repo policy strictness, validation command summaries, last heartbeat, and runner capability details.
Out of Scope: Advanced analytics.
Implementation Notes: Keep design restrained and work-focused. Use `src/routes/handover.tsx` as the source for layout density, copy hierarchy, and status naming.
Files Likely Touched: `apps/web/app/(app)/repositories/page.tsx`, `apps/web/app/(app)/runners/page.tsx`, `BACKLOG.md`
Acceptance Criteria: Pages support common operational scanning and clearly show runner health, repo policy posture, validation expectations, and connection status.
Validation: Run web build and UI tests.
Security/Trust Notes: Do not expose credentials or source.
Completion Notes: Completed by manual repair after the local backlog runner stopped on a review blocker. Polished repository and runner dashboard pages with clearer setup, policy, validation, capability, heartbeat, and action states, and fixed policy-count labels so the UI renders "protected paths", "sensitive paths", and "warning paths" instead of awkward adjective plurals.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
Follow-up Risk: Broader Cortex handover parity remains in the dashboard polish milestone and should be covered by the upcoming dashboard review/validation tasks.
Next Recommended Task: TASK-167

### TASK-167 — Polish tasks, runs, and PR pages
Status: [x]
Milestone: Dashboard Polish
Priority: P1
Depends on: TASK-130, TASK-132, TASK-136
Goal: Improve task/run/PR review workflow.
Scope: Merge/adapt the Cortex tasks, runs, approvals, and PR review screens from `rory-hayes/code-companion`, including task packet creation, queue state, run list, run trace, approval decisions, blocked-by-policy evidence, repair actions, risk badges, and empty/loading/error states.
Out of Scope: Merge controls.
Implementation Notes: Favor dense tables and clear actions. Approve/reject/repair controls must be backed by validation evidence, changed paths, PR metadata, and policy/risk flags before the user is asked to decide.
Files Likely Touched: `apps/web/app/(app)/tasks/page.tsx`, `apps/web/app/(app)/runs/page.tsx`, `apps/web/app/(app)/approvals/page.tsx`, `apps/web/app/(app)/pull-requests/page.tsx`, `BACKLOG.md`
Acceptance Criteria: User can quickly find ready, running, failed, blocked, awaiting-approval, and PR-ready work, and can make approval decisions from an evidence-rich screen.
Validation: Run web tests and build.
Security/Trust Notes: PR pages show metadata and links, not diffs.
Completion Notes: Completed by local Codex backlog runner and manual merge-queue repair. Polished task, run, approval, and PR review surfaces with dense metadata tables, evidence summaries, review-state filters, loading/error states, and evidence-backed approve/reject/repair controls that preserve TASK-144 dedicated approval actions and TASK-148 repair requests.
Validation Result: Passed `pnpm --filter @control-plane/web test`; `pnpm --filter @control-plane/web typecheck`; `pnpm --filter @control-plane/web lint`; `pnpm --filter @control-plane/web build`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`; `pnpm run build`.
Follow-up Risk: Dashboard polish still needs TASK-169 milestone verification; runner-side repair execution remains in TASK-147 before TASK-149 can verify the full approval/repair flow.
Next Recommended Task: TASK-169

### TASK-168 — Add audit log page
Status: [x]
Milestone: Dashboard Polish
Priority: P1
Depends on: TASK-143
Goal: Display consequential actions.
Scope: Show runner pairing, job claims, cancellations, approvals, repairs, integration events, policy blocks, and the Cortex backend handover/audit information from `src/routes/handover.tsx` where it helps operators understand the system.
Out of Scope: Enterprise audit export.
Implementation Notes: Use immutable audit rows from existing actions. If a backend handover page remains useful, adapt it as an internal product/developer handover view rather than exposing raw implementation details to end users.
Files Likely Touched: `apps/web/app/(app)/audit-log/page.tsx`, `apps/web/app/(app)/backend-handover/page.tsx`, `apps/web/components/audit-log-table.tsx`, `BACKLOG.md`
Acceptance Criteria: Workspace audit events are visible and filterable, and any retained handover view helps operators/developers connect UI state to the implemented backend without exposing secrets or source.
Validation: Run web tests and build.
Security/Trust Notes: Audit rows must not contain secrets or source.
Completion Notes: Completed by local Codex backlog runner. Manually repaired the merge-queue conflict by preserving the app-local web test command while combining database export helpers needed by both the current main branch and the audit log query path.
Next Recommended Task: TASK-169
Validation Result: Passed — `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`; `pnpm --filter @control-plane/web test`; `pnpm run build`.

### TASK-169 — Verify dashboard polish milestone
Status: [!] Blocked
Milestone: Dashboard Polish
Priority: P1
Depends on: TASK-165, TASK-166, TASK-167, TASK-168
Goal: Confirm dashboard supports habitual operational use.
Scope: Run web tests, build, visual smoke check, and UI parity review against `rory-hayes/code-companion/src/routes/handover.tsx`.
Out of Scope: Pixel-perfect marketing pages.
Implementation Notes: Verify mobile text does not overlap. Confirm the implemented app preserves the Cortex trust-first UI: task queue, run timeline, approvals, runner health, repository policy state, blocked runs, validation evidence, and PR review controls.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Core pages answer MVP operational questions and the final MVP UI matches the approved Cortex UX direction from the handover repo closely enough for TASK-186 acceptance.
Validation: Run web tests/build and browser smoke check.
Security/Trust Notes: Confirm no page renders raw source/diff/code fields.
Completion Notes: Blocked after latest runner attempt: no TASK-169 implementation or verification evidence was produced, and the preserved branch is an ancestor of current `main`. Required parity review, browser smoke, mobile overlap check, and security display review artifacts are still missing.
Follow-up Risk: Dashboard milestone verification needs a scoped manual pass with browser evidence and the Cortex handover reference available locally.
Next Recommended Task: TASK-160
Validation Result: Blocked before merge; no TASK-169 code was merged.

## 24. Billing Hooks

### TASK-170 — Add plan and usage fields
Status: [x]
Milestone: Billing Hooks
Priority: P1
Depends on: TASK-101
Goal: Add billing hook fields without launching billing.
Scope: Add plan, runner limit, repo limit, monthly run limit, usage count, nullable Stripe ids.
Out of Scope: Stripe Checkout, customer portal, payment enforcement.
Implementation Notes: Keep defaults generous for MVP validation.
Files Likely Touched: `packages/db/src/schema.ts`, `apps/web/src/billing/limits.ts`, `BACKLOG.md`
Acceptance Criteria: Fields exist and are nullable where specified.
Validation: Run db tests.
Security/Trust Notes: Do not block MVP execution on billing.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-171 — Add usage counting service
Status: [x]
Milestone: Billing Hooks
Priority: P1
Depends on: TASK-170
Goal: Track monthly run usage for future billing.
Scope: Increment usage on claimed execution jobs and expose current usage.
Out of Scope: Payment collection and hard enforcement.
Implementation Notes: Feature flag enforcement off by default.
Files Likely Touched: `apps/web/src/billing/usage.ts`, `apps/web/src/jobs/claim.ts`, `BACKLOG.md`
Acceptance Criteria: Usage increments once per claimed run.
Validation: Run web tests.
Security/Trust Notes: Idempotent claims must not double-count usage.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-120
Validation Result: Passed

### TASK-172 — Add settings billing placeholder UI
Status: [x]
Milestone: Billing Hooks
Priority: P1
Depends on: TASK-171
Goal: Show plan and usage fields without payment flows.
Scope: Add settings panel for plan, limits, usage, and Stripe disabled state.
Out of Scope: Stripe Checkout or portal.
Implementation Notes: Clearly label billing as not active in MVP.
Files Likely Touched: `apps/web/app/(app)/settings/billing/page.tsx`, `apps/web/components/billing-settings.tsx`, `BACKLOG.md`
Acceptance Criteria: Billing settings show hooks and no payment action.
Validation: Run web tests and build.
Security/Trust Notes: No Stripe secrets or client keys are required.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-120
Validation Result: Passed

### TASK-173 — Verify billing hooks milestone
Status: [x]
Milestone: Billing Hooks
Priority: P1
Depends on: TASK-170, TASK-171, TASK-172
Goal: Confirm billing hooks do not block MVP validation.
Scope: Run db/web tests and inspect feature flag behavior.
Out of Scope: Full billing launch.
Implementation Notes: Record Stripe remains disabled.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Plan/usage exists; no payment infra required for E2E.
Validation: Run web/db/root tests.
Security/Trust Notes: Keep Stripe ids nullable and secrets absent.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-120
Validation Result: Passed

## 25. Security and Redaction Hardening

### TASK-174 — Add protocol payload boundary tests
Status: [!]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-120
Goal: Prove runner protocol rejects raw source, diffs, patches, and code snippets.
Scope: Add tests for all web-bound protocol endpoints and local runner artifacts.
Out of Scope: New endpoint behavior.
Implementation Notes: Use malicious payload fixtures with `source`, `diff`, `patch`, `code`, and file content keys.
Files Likely Touched: `apps/web/test/security/protocol-boundary.test.ts`, `apps/runner/test/security/artifact-boundary.test.ts`, `BACKLOG.md`
Acceptance Criteria: All disallowed payloads fail validation or are stripped before storage.
Validation: Run security tests.
Security/Trust Notes: This is the central non-exfiltration test suite.
Completion Notes: Blocked by local Codex backlog runner review: the remaining required coverage must prove raw diff/source/code text is rejected inside allowed runner capability string fields such as `shell`, tool `version`, and capability snapshots on link, heartbeat, poll, and claim requests. Adding that coverage exposes a product behavior gap that requires new endpoint/capability-value filtering, while this task explicitly excludes new endpoint behavior.
Next Recommended Task: Define a scoped endpoint/capability-value filtering task, then return to protocol boundary tests.
Validation Result: Blocked before merge; no TASK-174 code was merged.

### TASK-175 — Harden redaction pattern coverage
Status: [x]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-071
Goal: Expand redaction tests for real-world secret patterns.
Scope: Cover GitHub, Linear, OpenAI, generic bearer tokens, private keys, URLs with credentials, and `.env` lines.
Out of Scope: External DLP service.
Implementation Notes: Use synthetic fake secrets only.
Files Likely Touched: `packages/logging/src/redact.test.ts`, `packages/logging/src/redact.ts`, `BACKLOG.md`
Acceptance Criteria: All secret fixtures redact values and keep safe context.
Validation: Run logging security tests.
Security/Trust Notes: Never add real tokens to fixtures.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-072
Validation Result: Passed

### TASK-176 — Add server-side raw payload guard
Status: [x]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-118, TASK-119
Goal: Prevent unsafe web-bound artifacts even if a runner client is buggy.
Scope: Add reusable guard for runner API payloads and enforce on event/artifact endpoints.
Out of Scope: Client-side-only checks.
Implementation Notes: Guard rejects suspicious keys and high-risk string markers.
Files Likely Touched: `apps/web/src/security/payload-guard.ts`, `apps/web/app/api/runner/*`, `BACKLOG.md`
Acceptance Criteria: Unsafe payloads are rejected before database writes.
Validation: Run web security tests.
Security/Trust Notes: Server remains the final web-bound data gate.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-120
Validation Result: Passed

### TASK-177 — Add runner revocation
Status: [x]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-112
Goal: Let workspace owners revoke a runner credential.
Scope: Add revoke action, runner status, auth rejection, and audit event.
Out of Scope: Remote process kill.
Implementation Notes: Revoked runners fail heartbeat/poll/submit requests.
Files Likely Touched: `apps/web/src/runners/revoke.ts`, `apps/web/app/(app)/runners/page.tsx`, `BACKLOG.md`
Acceptance Criteria: Revoked runner cannot access runner APIs.
Validation: Run web security tests.
Security/Trust Notes: Revocation limits credential exposure risk.
Completion Notes: Completed by manual merge-queue repair after TASK-177 conflicted with newer server action and repo mapping action exports. Added owner-only runner revocation service, action wiring, dashboard revoke controls, safe audit metadata, list/status integration, and API auth rejection coverage for revoked runners.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` (114 files, 1044 tests).
Follow-up Risk: Remote runner processes are not killed by revocation; revoked credentials are rejected on subsequent runner API calls.
Next Recommended Task: TASK-178

### TASK-178 — Add token storage documentation and checks
Status: [!] Blocked
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-109, TASK-158
Goal: Document and test runner, GitHub, Linear, Clerk, and database token storage rules.
Scope: Add security docs section and tests/checks for env exposure.
Out of Scope: Enterprise secret manager integration.
Implementation Notes: Ensure client bundles do not import server secrets.
Files Likely Touched: `SECURITY_MODEL.md`, `apps/web/src/security/*.test.ts`, `BACKLOG.md`
Acceptance Criteria: Token handling rules are documented and tested.
Validation: Run web security tests and build.
Security/Trust Notes: Secrets are server/local only.
Completion Notes: Blocked by the local backlog runner because the preserved implementation changes `SECURITY_MODEL.md`, which is a protected path requiring manual review. Useful partial work remains in the TASK-178 worktree and includes token storage documentation plus a focused web security test.
Follow-up Risk: Manually review the protected security-model change, run focused web security validation and full repository validation, then merge only if clean.
Next Recommended Task: TASK-160
Validation Result: Blocked before merge by `PROTECTED_PATH_CHANGED`; no TASK-178 code was merged.

### TASK-179 — Add audit event completeness tests
Status: [x]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-168
Goal: Ensure consequential actions produce audit events.
Scope: Test pairing, claim, cancel, approve, reject, repair, revoke, block, and integration events.
Out of Scope: Audit export.
Implementation Notes: Audit data is metadata only.
Files Likely Touched: `apps/web/test/security/audit-events.test.ts`, `BACKLOG.md`
Acceptance Criteria: Required actions create audit events.
Validation: Run web security tests.
Security/Trust Notes: Audit trail builds trust without source exposure.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-119
Validation Result: Passed

### TASK-180 — Add duplicate assignment hardening tests
Status: [x]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-117
Goal: Prove duplicate job assignment cannot create duplicate runs.
Scope: Race-like tests for repeated claims, different runner conflicts, and retry idempotency.
Out of Scope: Distributed lock service beyond MVP database constraints.
Implementation Notes: Assert conflicts are visible in run trace.
Files Likely Touched: `apps/web/test/security/claim-idempotency.test.ts`, `BACKLOG.md`
Acceptance Criteria: Duplicate assignment is blocked and audited.
Validation: Run web protocol/security tests.
Security/Trust Notes: Prevents uncontrolled parallel execution.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: TASK-118
Validation Result: Passed

### TASK-181 — Verify security hardening milestone
Status: [ ]
Milestone: Security and Redaction Hardening
Priority: P0
Depends on: TASK-174, TASK-175, TASK-176, TASK-177, TASK-178, TASK-179, TASK-180
Goal: Confirm security model is enforced by tests.
Scope: Run all security suites and update docs/backlog with results.
Out of Scope: New product features.
Implementation Notes: Summarize no-exfiltration proof.
Files Likely Touched: `BACKLOG.md`, `SECURITY_MODEL.md`
Acceptance Criteria: Security tests pass and docs match implementation.
Validation: Run full security test suite and root tests.
Security/Trust Notes: MVP cannot ship if this milestone fails.
Completion Notes: Not started.

## 26. End-to-End MVP Validation

### TASK-182 — Add full local runner E2E script
Status: [ ]
Milestone: End-to-End MVP Validation
Priority: P0
Depends on: TASK-181
Goal: Provide one command to validate the local runner proof.
Scope: Script fixture repo setup, dry run, mocked Codex, validation, commit, mock push, mock PR artifact.
Out of Scope: Hosted web flow.
Implementation Notes: Use synthetic fixture and local bare remote.
Files Likely Touched: `apps/runner/scripts/e2e-local-runner.ts`, `BACKLOG.md`
Acceptance Criteria: Command exits zero and writes safe artifacts.
Validation: Run local runner E2E script.
Security/Trust Notes: Script must not call real GitHub or real Codex in mocked mode.
Completion Notes: Not started.

### TASK-183 — Add web-to-runner protocol E2E
Status: [ ]
Milestone: End-to-End MVP Validation
Priority: P0
Depends on: TASK-181
Goal: Validate manual task to runner protocol loop.
Scope: Use test database and mocked runner client/server to pair, map repo, create task, approve, poll, claim, submit events/results/artifacts.
Out of Scope: Browser polish and real PR.
Implementation Notes: Assert idempotency and safe payload boundaries.
Files Likely Touched: `apps/web/test/e2e/manual-task-runner-protocol.test.ts`, `BACKLOG.md`
Acceptance Criteria: Web protocol E2E passes.
Validation: Run web E2E test.
Security/Trust Notes: No raw source crosses protocol.
Completion Notes: Not started.

### TASK-184 — Add browser happy-path smoke test
Status: [ ]
Milestone: End-to-End MVP Validation
Priority: P0
Depends on: TASK-183
Goal: Validate core web screens in a browser.
Scope: Sign in mock/dev user, create workspace, view runner, repo mapping, task, run detail, approval controls.
Out of Scope: Real external integrations.
Implementation Notes: Use Playwright or project-standard browser testing.
Files Likely Touched: `apps/web/e2e/happy-path.spec.ts`, `BACKLOG.md`
Acceptance Criteria: Browser flow completes without visual overlap or broken navigation.
Validation: Run web E2E browser test.
Security/Trust Notes: Browser never shows source code or secrets.
Completion Notes: Not started.

### TASK-185 — Add MVP acceptance checklist
Status: [ ]
Milestone: End-to-End MVP Validation
Priority: P0
Depends on: TASK-182, TASK-183, TASK-184
Goal: Create a checklist mapped to `MVP_PLAN.md` V1 acceptance criteria.
Scope: Add checklist with command evidence fields.
Out of Scope: New implementation.
Implementation Notes: Include user signup through approve/reject/request repair.
Files Likely Touched: `docs/MVP_ACCEPTANCE.md`, `BACKLOG.md`
Acceptance Criteria: Every MVP acceptance criterion maps to a test or manual check.
Validation: Review checklist against `MVP_PLAN.md`.
Security/Trust Notes: Include explicit data-boundary acceptance criteria.
Completion Notes: Not started.

### TASK-186 — Run full MVP validation suite
Status: [ ]
Milestone: End-to-End MVP Validation
Priority: P0
Depends on: TASK-185
Goal: Verify the MVP end to end before release candidate.
Scope: Run root checks, runner E2E, web protocol E2E, browser smoke, and security suite.
Out of Scope: Deferred features.
Implementation Notes: Record exact commands and results.
Files Likely Touched: `docs/MVP_ACCEPTANCE.md`, `BACKLOG.md`
Acceptance Criteria: All P0 validation commands pass.
Validation: Run full MVP validation suite.
Security/Trust Notes: Any data-boundary failure blocks release.
Completion Notes: Not started.

### TASK-187 — Prepare MVP release notes
Status: [ ]
Milestone: End-to-End MVP Validation
Priority: P0
Depends on: TASK-186
Goal: Summarize the validated MVP and remaining deferred work.
Scope: Add release notes covering capabilities, limits, setup, and trust boundary.
Out of Scope: Marketing launch page.
Implementation Notes: Reference deferred items rather than sneaking them into MVP.
Files Likely Touched: `docs/MVP_RELEASE_NOTES.md`, `BACKLOG.md`
Acceptance Criteria: Release notes match implemented MVP and test evidence.
Validation: Review against acceptance checklist and docs.
Security/Trust Notes: Release notes state local execution and no source-code upload.
Completion Notes: Not started.

## 27. Deferred Post-MVP Work

### TASK-188 — Defer Slack integration
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record Slack as post-MVP.
Scope: Keep Slack out of active MVP implementation.
Out of Scope: Slack messages, Slack task intake, Slack notifications.
Implementation Notes: Revisit only after MVP PR loop is trusted.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task depends on Slack.
Validation: Scan backlog for active Slack tasks.
Security/Trust Notes: Avoid broad chat-context ingestion in MVP.
Completion Notes: Deferred post-MVP.

### TASK-189 — Defer Notion integration
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record Notion as post-MVP.
Scope: Keep Notion out of active MVP implementation.
Out of Scope: Notion PRDs, broad document crawling, Notion sync.
Implementation Notes: Bounded linked docs can be reconsidered after core loop.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task depends on Notion.
Validation: Scan backlog for active Notion tasks.
Security/Trust Notes: Avoid broad document crawling in MVP.
Completion Notes: Deferred post-MVP.

### TASK-190 — Defer Jira integration
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record Jira as post-MVP.
Scope: Keep Jira out of active MVP implementation.
Out of Scope: Jira issue sync and Jira approval flow.
Implementation Notes: Linear remains the first task source.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task depends on Jira.
Validation: Scan backlog for active Jira tasks.
Security/Trust Notes: Avoid expanding task-source surface before governance is proven.
Completion Notes: Deferred post-MVP.

### TASK-191 — Defer broad company crawling
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record broad organizational crawling as post-MVP.
Scope: Keep company-brain crawling out of active MVP implementation.
Out of Scope: Slack/Notion/docs/support/design broad indexing.
Implementation Notes: Use bounded task packets and explicit linked context only after MVP.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task implements broad crawling.
Validation: Scan backlog for crawling/indexing tasks.
Security/Trust Notes: Prevent noisy retrieval and accidental data exposure.
Completion Notes: Deferred post-MVP.

### TASK-192 — Defer hosted code execution
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record hosted code execution as post-MVP.
Scope: Keep execution local or customer-controlled.
Out of Scope: Cloud sandboxes, hosted repo cloning, hosted dependency execution.
Implementation Notes: Hosted execution changes trust, cost, compliance, and isolation assumptions.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task executes customer source in hosted infrastructure.
Validation: Scan active tasks for hosted execution.
Security/Trust Notes: Local runner remains the trust boundary.
Completion Notes: Deferred post-MVP.

### TASK-193 — Defer auto-merge
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record auto-merge as post-MVP.
Scope: Preserve human-owned merge authority.
Out of Scope: Merge buttons, merge automation, policy-based auto-merge.
Implementation Notes: Approval means review decision, not autonomous merge.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task merges PRs automatically.
Validation: Scan backlog and code for auto-merge paths.
Security/Trust Notes: Humans retain final acceptance.
Completion Notes: Deferred post-MVP.

### TASK-194 — Defer multi-agent orchestration
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record multi-agent orchestration as post-MVP.
Scope: Keep MVP to one runner job and one Codex run per task path.
Out of Scope: Multi-agent planning, parallel agent swarms, autonomous delegation.
Implementation Notes: Build reliability before parallelism.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task introduces multi-agent orchestration.
Validation: Scan active tasks for multi-agent terms.
Security/Trust Notes: Simpler execution is easier to audit.
Completion Notes: Deferred post-MVP.

### TASK-195 — Defer full Stripe billing
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record full billing launch as post-MVP.
Scope: Keep only billing hooks in MVP.
Out of Scope: Stripe Checkout, customer portal, subscription enforcement.
Implementation Notes: Payment infrastructure must not block MVP validation.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: Active MVP contains hooks only, no payment launch.
Validation: Scan billing tasks for Stripe payment flow.
Security/Trust Notes: Avoid adding payment secrets before needed.
Completion Notes: Deferred post-MVP.

### TASK-196 — Defer enterprise SSO
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record enterprise SSO as post-MVP.
Scope: Use Clerk MVP auth only.
Out of Scope: SAML, SCIM, enterprise org provisioning.
Implementation Notes: Add after customer demand and governance loop proof.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task implements enterprise SSO.
Validation: Scan auth tasks.
Security/Trust Notes: Do not over-expand identity surface.
Completion Notes: Deferred post-MVP.

### TASK-197 — Defer SOC2 automation
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record SOC2 automation as post-MVP.
Scope: Keep auditability and security tests in MVP without compliance automation.
Out of Scope: Vendor evidence automation and SOC2 workflows.
Implementation Notes: Build credible logs first.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task builds SOC2 automation.
Validation: Scan active tasks.
Security/Trust Notes: Audit log is MVP; compliance program automation is post-MVP.
Completion Notes: Deferred post-MVP.

### TASK-198 — Defer advanced analytics
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record advanced analytics as post-MVP.
Scope: Keep dashboard operational, not analytical.
Out of Scope: Charts, forecasting, productivity analytics, model performance analytics.
Implementation Notes: Overview answers only what is ready, running, failed, online, or awaiting approval.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task builds advanced analytics.
Validation: Scan dashboard tasks.
Security/Trust Notes: Avoid over-collecting operational data.
Completion Notes: Deferred post-MVP.

### TASK-199 — Defer mobile app
Status: [>]
Milestone: Deferred Post-MVP Work
Priority: P2
Depends on: TASK-187
Goal: Record mobile app as post-MVP.
Scope: Keep MVP web-first.
Out of Scope: Native mobile, mobile-specific approvals, push notifications.
Implementation Notes: Responsive web is sufficient for MVP.
Files Likely Touched: `BACKLOG.md`
Acceptance Criteria: No active MVP task builds a mobile app.
Validation: Scan backlog for mobile app implementation tasks.
Security/Trust Notes: Keep approval and runner control in the web app.
Completion Notes: Deferred post-MVP.
