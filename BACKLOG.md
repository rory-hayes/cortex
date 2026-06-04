# BACKLOG.md

> Active refactor backlog generated from `refactorBacklog.md`. The prior runner-first backlog is preserved in `BACKLOG.runner-first.md`.

## Cortex Refactor Backlog — Repo Readiness Front Door + AI Execution Queue

**Document purpose:** This backlog defines the ordered refactor required to evolve Cortex from a runner-first AI Engineering Control Plane into a repo-readiness and AI-execution system.

**New product direction:** Cortex should start with a web-first GitHub repo scan that diagnoses whether a repository is ready for safe AI-assisted engineering work, generates findings, converts findings into Cortex Tasks, creates setup PRs, and only then offers local runner execution as an optional, gated path.

**Important:** This is not a rebuild. Preserve the existing runner, shared contracts, policies, validation gates, Codex adapter, PR artifact flow, approval/repair controls, and strict source-boundary model. The refactor changes the product front door and the operating model, not the core safety architecture.

---

## Strategic Decisions

### Keep

- Existing monorepo architecture.
- `apps/web` as the hosted coordinator.
- Local runner architecture as the optional execution engine.
- Existing shared contract and fixture approach.
- Existing task packet model.
- Existing repo policy and validation systems.
- Existing non-exfiltration posture: no raw source, diffs, patches, snippets, secrets, `.env` contents, or unredacted command output should be sent to the hosted coordinator.
- GitHub as the primary repo/PR system.
- Human approval before merge.

### Change

- The first user experience becomes **Connect GitHub → Select Repo → Describe Goal → Scan Repo → Review Findings → Approve Tasks**.
- Runner installation is no longer the initial CTA.
- Linear/Jira/GitHub Issues become optional sync channels, not the primary system of record.
- Cortex owns its own internal execution-readiness queue.
- Dashboard is reorganized around **What can safely move forward today?**

### Do Not Build Yet

- Full Linear/Jira replacement.
- Broad Slack/Notion/company crawling.
- Hosted code execution.
- Auto-merge by default.
- Multi-agent orchestration.
- Enterprise SSO/SOC2 automation.
- Full analytics suite.
- Mobile app.

---

## Target User Journey

```text
1. User signs up / creates workspace
2. User connects GitHub
3. User selects a repository
4. User describes what the repo/product is meant to be
5. Cortex runs a repo readiness scan
6. Cortex shows a readiness report and score
7. Cortex lists findings: missing docs, weak validation, unsafe paths, unclear backlog, etc.
8. Cortex converts approved findings into Cortex Tasks
9. User approves tasks
10. Cortex can create setup PRs or sync tasks to Linear/GitHub Issues
11. User can optionally enable local runner execution
12. Runner executes approved tasks locally, validates, opens PRs, and reports metadata/evidence
13. Cortex tracks PRs, approvals, repairs, recurring scans, and weekly reviews
```

---

## New Core Objects

### Finding

A finding is a repo-readiness issue discovered by Cortex.

Examples:

- Missing `AGENTS.md`.
- Missing product specification.
- Missing architecture document.
- No validation commands found.
- CI workflow not detected.
- Auth/billing/migration files not protected.
- Existing backlog tasks are too vague for AI execution.

### RepoReadinessReport

A scan-level report for a repository.

Contains:

- Score.
- Category scores.
- Summary.
- Findings.
- Recommended tasks.
- Scan metadata.
- Execution-readiness status.

### CortexTask

An internal AI-execution-readiness task.

This is not a generic ticket. It is a task prepared for AI-assisted engineering execution.

Contains:

- Source finding/import/manual source.
- Repo.
- Objective.
- Acceptance criteria.
- Risk level.
- Suggested validation.
- Execution mode.
- Approval status.
- Linked PR/run/external issue.

### Run

An execution attempt against an approved Cortex Task.

Existing runner/run models should continue to support this.

### Evidence

Validation, PR artifact, changed-path metadata, risk flags, summary, and review guidance.

---

# Phase 0 — Refactor Preparation and Safety Freeze

## Runner-Compatible Refactor Tasks

### RFB-001 — Create refactor branch and freeze runner-first backlog changes

Status: [x]
Milestone: Phase 0 — Refactor Preparation and Safety Freeze
Priority: P0
Area: Project management
Depends on: None
Goal: Create a dedicated branch for the repo-readiness front door refactor. Do not continue expanding runner-only features while this refactor is underway, except for critical fixes and already-started tasks that unblock the new architecture.
Acceptance Criteria: A branch exists for the refactor.; Existing runner-first work is not deleted.; Current BACKLOG.md, SPRINT.md, and README.md are preserved.; This refactorBacklog.md is committed to the repository.; Project docs state that the runner is now a gated execution layer, not the onboarding front door.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-002
Validation Result: Passed

### RFB-002 — Update product language across docs

Status: [x]
Milestone: Phase 0 — Refactor Preparation and Safety Freeze
Priority: P0
Area: Product/docs
Depends on: RFB-001
Goal: Update the product language from “AI Engineering Control Plane” as the primary user-facing message to “repo readiness and AI execution queue”. The control-plane language can remain in architecture docs, but the product front door should be clearer.
Acceptance Criteria: README.md describes Cortex as: “Cortex scans your repo, creates AI-ready engineering tasks, and safely turns approved work into validated PRs.”; PRODUCT_SPEC.md is updated with the new front-door flow.; Runner is described as optional/gated.; No docs imply that runner installation is required before getting value.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-003 — Reclassify existing open tasks under the new roadmap

Status: [x]
Milestone: Phase 0 — Refactor Preparation and Safety Freeze
Priority: P0
Area: Planning
Depends on: RFB-001
Goal: Reclassify the current open tasks into one of four groups: keep-now, reframe, defer, or close. Existing Linear intake tasks should be reframed as external task import rather than the primary onboarding flow.
Acceptance Criteria: TASK-161, TASK-162, and TASK-163 are marked as “External task import / Linear intake”, not “primary onboarding”.; TASK-181 to TASK-187 remain in final validation/release readiness.; Blocked tasks TASK-169, TASK-174, and TASK-178 have clear resolution notes.; Deferred tasks remain deferred unless directly required by repo-readiness onboarding.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by watchdog recovery. Linear intake is kept as external task import in RFB-055 rather than primary onboarding; final validation remains in RFB-081 through RFB-089; TASK-169 is closed as a stale dashboard-polish verification branch with no mergeable evidence and is covered by the repo-readiness UI/E2E follow-ups; TASK-174 is reframed as RFB-076; TASK-178 remains a protected-doc/manual-review follow-up in RFB-077; Phase 14 work remains deferred post-MVP.
Next Recommended Task: RFB-017
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-004 — Add refactor principles to `AGENTS.md`

Status: [x]
Milestone: Phase 0 — Refactor Preparation and Safety Freeze
Priority: P0
Area: Engineering process
Depends on: RFB-001
Goal: Update AGENTS.md so Codex/runner work follows the new direction. The repo should now prioriti
Acceptance Criteria: AGENTS.md instructs Codex not to rebuild or remove the runner.; AGENTS.md says new work should preserve source-boundary safety.; AGENTS.md states runner installation must not be required for initial repo scan value.; AGENTS.md says any new task must update README.md, SPRINT.md, and relevant tests.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-005 — Add `Finding` shared contract

Status: [x]
Milestone: Phase 1 — Shared Contracts for Repo Readiness
Priority: P0
Area: Shared contracts
Depends on: RFB-004
Goal: Add a strict shared contract for scan findings.
Acceptance Criteria: Zod schema exists in packages/shared.; Type export exists.; Valid and invalid fixtures exist.; Unsafe metadata keys are rejected recursively.; No raw source, diff, patch, snippet, code, file content, secret, or unredacted log fields are allowed.; Contract compatibility tests pass.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-006 — Add `RepoReadinessReport` shared contract

Status: [x]
Milestone: Phase 1 — Shared Contracts for Repo Readiness
Priority: P0
Area: Shared contracts
Depends on: RFB-005
Goal: Add a contract representing a repo readiness report generated from a scan.
Acceptance Criteria: Zod schema exists.; Score ranges are validated.; Category score names match finding categories.; Unsafe payload keys are rejected.; Fixtures and compatibility tests exist.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-007 — Add `CortexTask` shared contract

Status: [x]
Milestone: Phase 1 — Shared Contracts for Repo Readiness
Priority: P0
Area: Shared contracts
Depends on: RFB-006
Goal: Add a strict contract for Cortex’s internal AI execution queue item.
Acceptance Criteria: Contract exists in packages/shared.; Contract forbids raw source/diff/log/snippet fields.; Fixtures exist.; Public package exports are tested.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-008 — Add `RepoScan` shared contract

Status: [x]
Milestone: Phase 1 — Shared Contracts for Repo Readiness
Priority: P0
Area: Shared contracts
Depends on: RFB-007
Goal: Add a contract representing a repo scan run. This is different from a code execution run.
Acceptance Criteria: Supports statuses: queued, running, completed, failed, cancelled.; Stores metadata-only inventory summaries.; Does not store raw file contents.; Fixtures and compatibility tests exist.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-009 — Add `TaskRecommendation` shared contract

Status: [x]
Milestone: Phase 1 — Shared Contracts for Repo Readiness
Priority: P1
Area: Shared contracts
Depends on: RFB-007
Goal: Add a contract for recommended tasks generated before they are accepted into the Cortex Task queue.
Acceptance Criteria: Recommendations can be approved, ignored, deferred, or converted into Cortex Tasks.; Each recommendation links to one or more findings.; Each recommendation has risk, effort, execution-mode suggestion, and acceptance criteria.; Unsafe metadata keys are rejected.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-010 — Add shared contract test coverage for all new objects

Status: [x]
Milestone: Phase 1 — Shared Contracts for Repo Readiness
Priority: P0
Area: Testing
Depends on: RFB-005, RFB-006, RFB-007, RFB-008, RFB-009
Goal: Extend the shared contract fixture and compatibility harness to cover all new repo-readiness objects.
Acceptance Criteria: Valid fixtures parse through public package entrypoints.; Invalid fixtures fail at expected issue paths.; Fixture hygiene checks reject source-like content.; Root typecheck, lint, test, and format check pass.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-011 — Add database tables for repo scans

Status: [x]
Milestone: Phase 2 — Database Schema and Persistence
Priority: P0
Area: Database
Depends on: RFB-008
Goal: Create Dri
Acceptance Criteria: Stores scan metadata, status, timestamps, repo/workspace linkage, summary only.; No raw source contents are persisted.; Migration exists and passes local validation.; Server-side query helpers exist.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/db, apps/web/src/db, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-012 — Add database tables for findings

Status: [x]
Milestone: Phase 2 — Database Schema and Persistence
Priority: P0
Area: Database
Depends on: RFB-005, RFB-011
Goal: Create persistence for findings generated by repo scans.
Acceptance Criteria: findings table exists.; Supports severity, category, status, summary, evidence, recommendation.; Supports linking to scan, repo, workspace, and tasks.; Supports deduplication key per finding type/repo/path/category.; Does not store raw source or raw file contents.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-013 — Add database tables for readiness reports

Status: [x]
Milestone: Phase 2 — Database Schema and Persistence
Priority: P0
Area: Database
Depends on: RFB-006, RFB-012
Goal: Create persistence for repo readiness reports.
Acceptance Criteria: repo_readiness_reports table exists.; Stores overall score and category scores.; Links to latest scan and findings.; Supports report history per repo.; Query helper returns latest report for dashboard/onboarding.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-014 — Add database tables for Cortex Tasks

Status: [x]
Milestone: Phase 2 — Database Schema and Persistence
Priority: P0
Area: Database
Depends on: RFB-007, RFB-012
Goal: Create the internal Cortex Task queue model.
Acceptance Criteria: cortex_tasks table exists.; Links to workspace, repo, findings, task packet, runs, and PR artifacts.; Supports status transitions: draft, needs_review, approved, queued, running, blocked, pr_opened, completed, rejected, deferred.; Supports execution mode.; Supports external task links.; Does not require Linear/Jira to exist.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-015 — Add join tables for finding-task relationships

Status: [x]
Milestone: Phase 2 — Database Schema and Persistence
Priority: P1
Area: Database
Depends on: RFB-012, RFB-014
Goal: Allow one task to address multiple findings and one finding to generate multiple possible task recommendations.
Acceptance Criteria: finding_task_links table exists.; Links are workspace-scoped.; Query helpers can fetch tasks for finding and findings for task.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a metadata-only `finding_task_links` table with workspace, repository, finding, Cortex Task, optional task recommendation, and timestamp columns; enabled RLS on the public table; added a migration that backfills links from existing `findings.taskIds` and `cortex_tasks.findingIds`; exported the table through `@control-plane/db` and the web facade; added workspace-scoped query helpers that fetch Cortex Tasks for a finding and findings for a Cortex Task; and wired Cortex Task/finding/recommendation conversion paths to maintain the join table alongside the legacy JSON arrays.
Follow-up Risk: Current usage is server-only. If future client-side Supabase Data API access is added for `finding_task_links`, add explicit grants plus RLS policies first rather than relying on table exposure defaults.
Next Recommended Task: RFB-056
Validation Result: Passed `pnpm --filter @control-plane/db exec vitest run src/schema.test.ts --config vitest.config.ts --configLoader runner`; passed `pnpm --filter @control-plane/web exec vitest run src/db.test.ts src/repo-readiness/cortex-tasks.test.ts src/repo-readiness/findings.test.ts src/repo-readiness/task-recommendations.test.ts src/repo-readiness/finding-task-links.test.ts --config vitest.config.ts --configLoader runner`; passed `pnpm run typecheck`; passed `pnpm run lint`; passed `pnpm run format:check`; passed `pnpm test` with 249 files and 3,077 tests.

### RFB-016 — Add task recommendation persistence

Status: [x]
Milestone: Phase 2 — Database Schema and Persistence
Priority: P1
Area: Database
Depends on: RFB-009, RFB-014
Goal: Persist pre-task recommendations before user approval.
Acceptance Criteria: Recommendations can be listed, approved, dismissed, or deferred.; Approved recommendations create Cortex Tasks.; No duplicate task creation on repeated approval.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-017 — Add GitHub App repository scan permissions review

Status: [x]
Milestone: Phase 3 — GitHub Repo Scan Foundation
Priority: P0
Area: GitHub/security
Depends on: RFB-003
Goal: Review the GitHub integration permissions needed for web-first repo scan and setup PR generation.
Acceptance Criteria: Permission list is documented.; Least-privilege approach is recorded.; Scan-only mode can be supported separately from setup-PR mode.; No runner installation is required for scan-only mode.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/github, apps/web/src/server, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by watchdog recovery after removing protected-path edits; permission review now lives in dedicated GitHub App permissions documentation plus GitHub helper/UI coverage.
Next Recommended Task: RFB-018
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-018 — Add GitHub repo inventory service

Status: [x]
Milestone: Phase 3 — GitHub Repo Scan Foundation
Priority: P0
Area: GitHub/backend
Depends on: RFB-017
Goal: Create a backend service that builds a metadata-only inventory of a selected GitHub repository.
Acceptance Criteria: Does not store full raw source contents.; Enforces file si
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-019
Validation Result: Passed

### RFB-019 — Add safe file read allowlist for scan inputs

Status: [x]
Milestone: Phase 3 — GitHub Repo Scan Foundation
Priority: P0
Area: Security/backend
Depends on: RFB-018
Goal: Define which repo files Cortex may read in web scan mode.
Acceptance Criteria: Real .env, .env.local, .env.production, private keys, and secrets are never read.; File si
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-020
Validation Result: Passed

### RFB-020 — Add repo scan module runner

Status: [x]
Milestone: Phase 3 — GitHub Repo Scan Foundation
Priority: P0
Area: Backend
Depends on: RFB-018, RFB-019
Goal: Create a service that runs scan modules in a deterministic order and persists scan module statuses.
Acceptance Criteria: Modules can pass, warn, block, fail, or skip.; Failures do not break the entire scan unless required modules fail.; Scan progress can be displayed in UI.; Outputs are metadata-only.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-021
Validation Result: Passed

### RFB-021 — Add scan trigger API

Status: [x]
Milestone: Phase 3 — GitHub Repo Scan Foundation
Priority: P0
Area: API/backend
Depends on: RFB-020
Goal: Add an authenticated API/server action to trigger a repo readiness scan.
Acceptance Criteria: User must have workspace access.; Repo must be registered or selected.; Scan job is queued.; Duplicate scans are debounced.; Response returns scan ID.; No raw source is returned.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-022
Validation Result: Passed

### RFB-022 — Add scan status API

Status: [x]
Milestone: Phase 3 — GitHub Repo Scan Foundation
Priority: P0
Area: API/backend
Depends on: RFB-021
Goal: Add an API/server action to fetch scan progress and latest report/finding status.
Acceptance Criteria: UI can poll or subscribe to scan progress.; Returns module statuses.; Returns latest safe summary.; Does not expose raw file contents.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-023
Validation Result: Passed

### RFB-023 — Add product clarity scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-020
Goal: Detect whether the repo has enough product clarity for AI-assisted engineering.
Acceptance Criteria: Generates findings for missing/weak product docs.; Does not invent product facts.; Uses user-provided goal context when available.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-025
Validation Result: Passed

### RFB-024 — Add agent-readiness scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-020
Goal: Detect whether a repo has instructions for AI/coding agents.
Acceptance Criteria: Generates findings for missing/incomplete AGENTS.md.; Creates recommendation to generate/improve AGENTS.md.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, apps/web/src/repo-readiness, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-023
Validation Result: Passed

### RFB-025 — Add architecture scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-020
Goal: Detect whether the repo has architecture-level context.
Acceptance Criteria: Generates findings for missing architecture docs.; Recommends architecture doc creation task.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-026
Validation Result: Passed

### RFB-026 — Add backlog-quality scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-020
Goal: Detect whether the repo has an AI-executable backlog.
Acceptance Criteria: Generates findings for missing/weak backlog structure.; Can recommend setup tasks to create/improve backlog.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added metadata-only backlog inventory summaries, root BACKLOG.md allowlist handling, safe GitHub backlog-quality reduction, hosted backlog_quality scan module, and coverage for missing, weak, unreadable/default, and AI-executable backlog states.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` on 2026-06-01.
Follow-up Risk: None known; the scan stores only fixed statuses, counts, and labels and does not persist raw backlog text.
Next Recommended Task: RFB-027

### RFB-027 — Add validation posture scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-020
Goal: Detect whether the repo has clear validation commands.
Acceptance Criteria: Generates findings for missing validation.; Suggests validation command map.; Does not execute commands in web scan mode.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added metadata-only validation posture inventory summaries, fixed validation command labels, GitHub policy validation-command classification, hosted validation_posture scan module, and tests for missing, partial, ready, and missing-inventory states without executing validation commands in hosted scan mode.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` on 2026-06-02.
Follow-up Risk: None known; validation posture stores only fixed command labels and counts, not command text or command output.
Next Recommended Task: RFB-028

### RFB-028 — Add CI/CD posture scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P1
Area: Repo scan
Depends on: RFB-027
Goal: Detect whether GitHub Actions or other CI workflows exist and whether they align with detected validation commands.
Acceptance Criteria: Detects .github/workflows files.; Flags missing CI for repos with validation commands.; Flags CI workflows that do not run tests/build/typecheck where applicable.; Does not parse or expose secrets.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added metadata-only CI/CD posture inventory summaries, GitHub workflow-file classification against detected validation labels, hosted ci_cd scan module findings/recommendations, and progress UI visibility for the CI/CD module without exposing workflow contents, command text, source, diffs, patches, snippets, secrets, stdout, stderr, or raw provider output.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` on 2026-06-02.
Follow-up Risk: None known; CI/CD posture stores only fixed provider labels, workflow counts, and validation command labels.
Next Recommended Task: RFB-031

### RFB-029 — Add security and protected-path scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan/security
Depends on: RFB-020
Goal: Detect sensitive areas that should be protected before AI execution.
Acceptance Criteria: Generates findings for missing policy coverage.; Does not read secrets.; Recommends protected path rules.; Reuses existing policy package where appropriate.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, packages/logging, packages/policies, apps/web/src/security, apps/web/src/billing
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-026
Validation Result: Passed

### RFB-030 — Add repo hygiene scan module

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P1
Area: Repo scan
Depends on: RFB-020
Goal: Detect structural hygiene issues that reduce safe AI execution quality.
Acceptance Criteria: Generates low/medium findings.; Does not block execution unless critical.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-026
Validation Result: Passed

### RFB-031 — Add execution-readiness classifier

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-023, RFB-024, RFB-025, RFB-026, RFB-027, RFB-029
Goal: Classify the repo’s current readiness for AI execution.
Acceptance Criteria: Classification is deterministic from findings/rules.; Local runner is not presented as ready if policy or validation is missing.; Setup PR path is available even if local runner is not ready.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added deterministic execution-readiness classification from metadata-only scan inventory, policy coverage, validation posture, and scoped finding statuses. Repo readiness report persistence now recalculates executionReadiness, blocked reasons, and recommended next actions before storage, so missing policy or validation cannot be persisted as local-runner ready and setup recommendations surface the setup PR path without exposing raw source or command output.
Next Recommended Task: RFB-032
Validation Result: Passed with pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-032 — Add readiness score calculation

Status: [x]
Milestone: Phase 4 — Deterministic Readiness Rules
Priority: P0
Area: Repo scan
Depends on: RFB-031
Goal: Calculate overall and category readiness scores.
Acceptance Criteria: Score is explainable.; Blocked findings reduce score heavily.; Missing setup docs reduce agent-readiness and product-clarity scores.; Scores can be recalculated when findings are resolved.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added deterministic readiness score calculation from metadata-only scan inventory and scoped finding statuses. Report persistence now recalculates overallScore and categoryScores before storage, records safe score weakness explanations, heavily reduces blocked findings, reduces product-clarity and agent-readiness setup gaps, and ignores resolved findings so scores can rise after remediation.
Next Recommended Task: RFB-033
Validation Result: Passed with pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-033 — Add scan summarization prompt contract

Status: [x]
Milestone: Phase 5 — LLM-Assisted Report and Task Generation
Priority: P0
Area: AI/backend
Depends on: RFB-031, RFB-032
Goal: Create a safe LLM prompt/input schema for summarizing repo-readiness scan results.
Acceptance Criteria: LLM input contains only scan metadata, safe doc summaries, and finding summaries.; No raw source files are included.; Prompt asks for concise, evidence-backed summaries.; Output is parsed/validated against RepoReadinessReport contract.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only repo-readiness report summarization prompt contract that parses existing RepoScan, Finding, and RepoReadinessReport contracts, projects only scan metadata, safe document summaries, module status summaries, inventory counts/statuses, and finding summaries into LLM input, and parses model output back through RepoReadinessReportSchema with deterministic scope, score, readiness, ID, action, and timestamp checks.
Next Recommended Task: RFB-035
Validation Result: Passed with pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-034 — Add safe document summarizer for allowlisted docs

Status: [x]
Milestone: Phase 5 — LLM-Assisted Report and Task Generation
Priority: P1
Area: AI/backend
Depends on: RFB-019
Goal: For allowlisted docs only, summarize bounded document signals into safe metadata.
Acceptance Criteria: Only allowlisted docs are summarized.; Summaries are bounded metadata.; No raw document bodies are stored.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-026
Validation Result: Passed

### RFB-035 — Add readiness report generator service

Status: [x]
Milestone: Phase 5 — LLM-Assisted Report and Task Generation
Priority: P0
Area: AI/backend
Depends on: RFB-033
Goal: Generate and persist the readiness report after deterministic scan modules complete.
Acceptance Criteria: Report is generated from scan output.; Report validates against shared schema.; Report is persisted.; LLM failure falls back to deterministic report.; Unit tests cover fallback path.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/db, apps/web/src/db, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/web/src/ai, apps/web/src/tasks, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only readiness report generator service that waits for deterministic scan modules to reach terminal safe statuses, builds a deterministic RepoReadinessReport from metadata-only scan inventory, scoped findings, readiness scores, execution-readiness classification, and task recommendation IDs, optionally refines human-facing summary fields through the safe LLM prompt contract, falls back to deterministic output on model failure, persists through the existing report service, and marks the scan completed with the persisted report ID.
Next Recommended Task: RFB-036
Validation Result: Passed with pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-036 — Add task recommendation generator

Status: [x]
Milestone: Phase 5 — LLM-Assisted Report and Task Generation
Priority: P0
Area: AI/backend
Depends on: RFB-009, RFB-035
Goal: Generate task recommendations from findings.
Acceptance Criteria: Each recommendation links to finding IDs.; Recommendations have title, objective, acceptance criteria, risk, suggested execution mode, and suggested validation.; Recommendations are not automatically approved.; Recommendations validate against shared schema.; Unsafe payload keys are rejected.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only task recommendation generator that loads scoped open findings after repo-readiness report generation, skips already covered or resolved findings, projects safe finding summaries into an optional LLM candidate prompt, validates candidate fields before composing full TaskRecommendation payloads, falls back to deterministic generic recommendations when LLM output is unsafe or unavailable, persists only open unapproved recommendations through the existing service, and rejects unsafe generated payload keys before storage.
Next Recommended Task: RFB-037
Validation Result: Passed with pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-037 — Add deterministic task templates for common findings

Status: [x]
Milestone: Phase 5 — LLM-Assisted Report and Task Generation
Priority: P0
Area: Backend
Depends on: RFB-036
Goal: Create deterministic task templates for common findings so Cortex does not rely only on LLM generation.
Acceptance Criteria: Templates can produce Cortex Task recommendations.; Templates include acceptance criteria.; Templates include execution mode suggestions.; LLM can refine but not bypass safety fields.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added deterministic server-only task recommendation templates for common repo-readiness findings, including product clarity, agent readiness, architecture, backlog quality, validation, CI/CD, security, and repo hygiene. The task recommendation generator now sends those templates as safe metadata to the optional LLM and accepts only text refinements for title, objective, and acceptance criteria, preserving deterministic risk, effort, execution mode, finding links, and suggested validation fields.
Next Recommended Task: RFB-038
Validation Result: Passed with focused RFB-037 web tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-038 — Add approval flow from recommendation to Cortex Task

Status: [x]
Milestone: Phase 5 — LLM-Assisted Report and Task Generation
Priority: P0
Area: Backend/API
Depends on: RFB-014, RFB-016, RFB-036
Goal: Allow users to approve task recommendations into Cortex Tasks.
Acceptance Criteria: User can approve one or many recommendations.; Approval creates Cortex Tasks.; Duplicate approvals are prevented.; User can edit title/objective/acceptance criteria before approval.; Audit event is recorded.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Extended the repo-readiness task recommendation approval flow so users can approve one or many recommendations into draft Cortex Tasks, optionally edit title, objective, and acceptance criteria before conversion, reject duplicate bulk approvals before mutation, preserve idempotent repeated approvals, and write safe audit events for task creation and recommendation conversion without queuing runner execution.
Next Recommended Task: RFB-040
Validation Result: Passed with focused RFB-038 service/action tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-039 — Replace first dashboard state with repo readiness onboarding

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-021
Goal: When a workspace has no scanned repos, the primary UI should guide the user through GitHub connection and repo scan, not runner setup.
Acceptance Criteria: Empty dashboard shows “Connect GitHub repo” CTA.; No runner install CTA appears before a scan.; User can select repository.; User can start scan.; Copy clearly says runner is optional later.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-026
Validation Result: Passed

### RFB-040 — Add repo selection screen

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-017, RFB-018
Goal: Build UI for selecting a GitHub repository for scan.
Acceptance Criteria: Lists installed repos.; Shows scan permission status.; Supports scan-only access copy.; Handles no GitHub connection state.; Handles no repo access state.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/shared
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a workspace-scoped repo selection screen to the first dashboard onboarding state. The overview service now derives GitHub connection status, active repo access, and per-repository scan-only permission status from safe installation metadata; the UI lists installed repos with scan permission badges, disables repos that are not scan-ready, handles no GitHub connection and no active repo access states, and keeps scan submission limited to canonical workspace/repo IDs.
Next Recommended Task: RFB-041
Validation Result: Passed with focused dashboard overview/service tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-041 — Add product goal intake screen

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-040
Goal: Before scanning, capture the user’s intended product/repo goal.
Acceptance Criteria: Goal context is saved.; Goal context is used in scan/report generation.; User can skip with reduced scan quality warning.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added product goal intake to the repo-readiness onboarding scan form. The server action and API route now accept only canonical workspace/repo IDs plus an optional bounded `productGoal`; blank goals are treated as an intentional skip, unsafe source-like/path/secret text is rejected before persistence, and scan trigger responses remain metadata-only. Queued repo scans persist safe goal context in `inventory.productClaritySummary`, GitHub inventory preserves that context for product-clarity scoring plus report/recommendation prompts, and audit metadata records only provided/not-provided status.
Next Recommended Task: RFB-043
Validation Result: Passed focused RFB-041 tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-042 — Add scan progress screen

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-022
Goal: Show credible scan progress through modules.
Acceptance Criteria: Shows modules: Product Clarity, Agent Readiness, Architecture, Backlog, Validation, Security, Repo Hygiene.; Shows pass/warn/fail/running/skipped states.; Handles scan failure with safe error summary.; No raw file content is rendered.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-026
Validation Result: Passed

### RFB-043 — Add readiness report page

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-035
Goal: Create a report page showing score, category scores, strengths, weaknesses, blockers, and next actions.
Acceptance Criteria: Shows overall score.; Shows category score cards.; Shows top blockers.; Shows recommended next actions.; Links to findings and task recommendations.; Copy explains how to improve score.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a workspace-scoped `/dashboard/reports/[reportId]` page for persisted repo-readiness reports. The page verifies selected workspace membership, loads an exact report by safe report ID, labels the report with synced GitHub repository metadata when available, shows overall score, execution readiness, category score cards, strengths, weaknesses, blockers, recommended next actions, and links to filtered findings plus task recommendation targets. Scan progress now links completed scans with report IDs to the report page. UI and service tests cover exact report lookup, route conventions, report display, scan-progress report links, and hostile payload display safety.
Next Recommended Task: RFB-045
Validation Result: Passed focused RFB-043 tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-044 — Add findings list page

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-012
Goal: Create a filterable findings page.
Acceptance Criteria: Filters by severity, category, status, repo, scan.; Each finding shows evidence and recommendation.; User can convert finding to task recommendation/task.; User can dismiss or defer findings.; Dismissals are audited.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-045 — Add task recommendations UI

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-016, RFB-036
Goal: Create UI where users review recommended tasks before approving them into the Cortex Task queue.
Acceptance Criteria: Shows recommended tasks grouped by risk/category.; User can edit fields before approval.; User can approve selected or all low-risk setup tasks.; User can defer/dismiss recommendations.; No task automatically enters runner queue.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a workspace-scoped `/dashboard/task-recommendations` page for scan-generated recommendations. The page verifies selected workspace membership, loads recommendation and repository metadata scoped to that workspace, filters by status, risk, repository, and scan, and renders recommendations grouped by derived risk/category. The UI supports editable per-recommendation approval fields, selected bulk approval, approve-all low-risk setup recommendations, defer, and dismiss actions. Approval creates draft Cortex Tasks only; runner queueing remains separate and human-gated. Action revalidation now includes the task recommendations surface, and tests cover route conventions, grouped display, editable approval fields, bulk actions, status actions, filter behavior, and hostile payload display safety.
Next Recommended Task: RFB-046
Validation Result: Passed focused RFB-045 tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-046 — Add Cortex Tasks queue page

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-014, RFB-038
Goal: Create the internal execution-readiness queue.
Acceptance Criteria: Shows Cortex Tasks independent of Linear/Jira.; Filters by status, repo, risk, execution mode, approval status.; Shows linked findings, suggested validation, risk, and external links.; Supports approve, reject, defer, sync, and execute actions.; Runner execution is gated.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added the workspace-scoped Cortex Tasks queue at `/dashboard/tasks`. The page verifies selected workspace membership before loading Cortex Tasks and GitHub repository metadata, filters by status, repository, risk, execution mode, and approval status, and shows linked finding IDs, suggested validation labels, risk, execution mode, approval state, origin, and safe external links. Added a narrow server action for Cortex Task status transitions that accepts only workspace ID, task ID, and shared-valid next status, reuses the shared transition evaluator through the Cortex Task service, and returns metadata-only action results. The UI supports review, approve, reject, defer, sync-link navigation, and execute/queue actions while keeping runner execution gated to local-runner ownership of source access, worktrees, policy checks, validation, commits, pushes, and PRs. Tests cover route conventions, gated action forms, filters, external links, manual draft reachability, server action parsing/revalidation, and hostile payload display/action rejection.
Next Recommended Task: RFB-047
Validation Result: Passed focused RFB-046 tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-047 — Reorder app navigation

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P1
Area: Web/UI
Depends on: RFB-043, RFB-044, RFB-046
Goal: Refactor nav hierarchy to prioritize readiness and tasks.
Acceptance Criteria: Runners are no longer above readiness/tasks.; Empty states guide toward repo scan.; Existing operational pages remain accessible.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Reordered the authenticated app navigation so the primary flow is Overview, Workspaces, Repositories, Findings, Task Recommendations, Cortex Tasks, then operational surfaces for runs, approvals, pull requests, runners, audit, and settings. Added Task Recommendations as a first-class nav destination, kept every operational page reachable, and updated generic, findings, task recommendation, and Cortex Task queue empty states to point users back to the repo readiness scan before runner work. Tests cover the nav hierarchy plus scan-oriented empty states.
Next Recommended Task: RFB-048
Validation Result: Passed focused RFB-047 UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-048 — Add “What can safely move forward today?” dashboard

Status: [x]
Milestone: Phase 6 — Onboarding UI Refactor
Priority: P1
Area: Web/UI
Depends on: RFB-043, RFB-046
Goal: Refactor the dashboard around actionability.
Acceptance Criteria: Dashboard is useful before runner install.; Dashboard is useful after runner install.; Dashboard does not expose raw source/diffs/logs.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a metadata-only dashboard actionability model and overview section for "What can safely move forward today?" The dashboard now leads with safe next actions for running scans, reviewing open findings, approving task recommendations, reviewing Cortex Tasks, pairing a runner when local-runner work is approved but no runner is online, monitoring local execution after a runner is online, reviewing validated PRs, and resolving blocked runner work. The web overview store now selects only safe finding, task recommendation, and Cortex Task columns for this summary and omits evidence, objectives, acceptance criteria, metadata, raw logs, diffs, patches, source, command output, and secrets. Tests cover pre-runner and runner-online actionability states plus UI rendering and safe selected-column boundaries.
Next Recommended Task: RFB-049
Validation Result: Passed focused dashboard overview/actionability tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-049 — Define setup PR file templates

Status: [x]
Milestone: Phase 7 — Setup PR Generation
Priority: P0
Area: Backend/templates
Depends on: RFB-037
Goal: Define templates for files Cortex can safely create/update in setup PR mode.
Acceptance Criteria: Templates are deterministic and reviewable.; User can preview before PR creation.; Templates do not include secrets or copied source.; Files are clearly marked as generated/review-required where appropriate.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added server-only setup PR template definitions for repository policy, CI validation workflow, agent instructions, architecture docs, backlog structure, contribution guide, product spec, and integration notes. Templates are deterministic, path-allowlisted, review-required, generated-marker aware, and selected from approved setup-pr Cortex Task validation IDs without copying source, diffs, patches, snippets, secrets, .env contents, or command output.
Next Recommended Task: RFB-050
Validation Result: Passed focused setup PR template tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-050 — Add setup PR preview service

Status: [x]
Milestone: Phase 7 — Setup PR Generation
Priority: P0
Area: Backend
Depends on: RFB-049
Goal: Generate a preview of setup PR changes from approved tasks.
Acceptance Criteria: Preview shows filenames and high-level summary.; Preview does not expose raw private source contents.; User can remove files/tasks before creation.; Preview is persisted as metadata.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a versioned metadata-only setup PR preview contract, database table, migration metadata, and server-only preview service. Approved setup-pr Cortex Tasks now produce persisted preview rows with filenames, summaries, review instructions, source task IDs, excluded task/template metadata, safe audit metadata, and explicit `omittedContent: true` markers instead of generated file bodies, raw source, diffs, patches, snippets, secrets, .env contents, or command output. The service supports removing tasks and files before PR creation and blocks ineligible or unsafe tasks before persistence.
Next Recommended Task: RFB-051
Validation Result: Passed focused setup PR preview/shared/db tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-051 — Add setup PR creation through GitHub App

Status: [x]
Milestone: Phase 7 — Setup PR Generation
Priority: P0
Area: GitHub/backend
Depends on: RFB-050
Goal: Allow Cortex to create a branch and draft PR for approved setup artifacts.
Acceptance Criteria: Creates branch with safe deterministic name.; Writes only approved setup files.; Opens draft PR.; PR body includes findings addressed and review checklist.; PR metadata is stored in Cortex.; No code execution occurs.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a GitHub App setup PR write abstraction plus server-only creation service for approved setup previews. The service re-renders only preview-approved deterministic setup templates, creates safe deterministic `cortex/setup-pr/...` branch names, builds draft PR bodies with finding IDs and review checklist material, opens draft PRs through Git data operations without local runner execution, and persists PR number, URL, branch, base branch, repository, file count, and task count metadata back to the setup preview row without storing generated file bodies, raw source, diffs, patches, snippets, secrets, `.env` contents, command output, or local runner artifacts.
Next Recommended Task: RFB-052
Validation Result: Passed focused setup PR creation/GitHub client tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-052 — Add setup PR evidence summary

Status: [x]
Milestone: Phase 7 — Setup PR Generation
Priority: P1
Area: Backend/UI
Depends on: RFB-051
Goal: Generate evidence summary for setup PRs.
Acceptance Criteria: Maps PR files to findings/tasks.; Shows why each file was generated.; Shows what user should review.; Avoids raw source exposure beyond generated setup content.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a versioned metadata-only setup PR evidence summary contract plus server-only web evidence builder. Setup PR creation now loads scoped readiness findings for approved setup tasks, maps each generated setup file to source tasks and linked finding IDs/details, explains why the file was generated, returns an evidence summary with `omittedContent: true`, and includes the evidence summary in the draft PR body without exposing generated file bodies, raw source, diffs, patches, snippets, secrets, `.env` contents, command output, or local runner artifacts beyond the approved generated setup PR files sent to GitHub.
Validation Result: Passed focused setup PR evidence/shared/creation tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` on 2026-06-02.
Follow-up Risk: None known; RFB-053 should render the evidence summary in the setup PR UI without expanding it into raw file content or source excerpts.
Next Recommended Task: RFB-053

### RFB-053 — Add setup PR UI flow

Status: [x]
Milestone: Phase 7 — Setup PR Generation
Priority: P0
Area: Web/UI
Depends on: RFB-050, RFB-051, RFB-052
Goal: Build UI for previewing and creating setup PRs.
Acceptance Criteria: User can create setup PR from approved tasks.; User can view PR link/status.; User can see which findings/tasks are addressed.; User can create more than one setup PR if needed.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added the `/dashboard/setup-prs` workspace-scoped setup PR flow with navigation, approved setup-task selection, preview listing, draft PR creation controls, PR status/link display, and task/finding coverage display. Setup PR server actions accept only workspace/repo/task/preview IDs and return metadata-only counts/PR fields, the preview service can list workspace/repo previews, and the web GitHub App request transport uses placeholder-configured app credentials for existing setup PR creation without touching real env files.
Validation Result: Passed focused setup PR UI/preview/action/GitHub transport tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` on 2026-06-02. Rendered browser route check reached `/dashboard/setup-prs` on local dev server but was blocked by missing local Clerk publishable key; no real env files were edited.
Follow-up Risk: RFB-054 should detect merged setup PRs and resolve linked readiness findings/tasks; local authenticated browser QA requires Clerk placeholder values to be configured outside this repo.
Next Recommended Task: RFB-054

### RFB-054 — Add setup PR merge detection and finding resolution

Status: [x]
Milestone: Phase 7 — Setup PR Generation
Priority: P1
Area: GitHub/backend
Depends on: RFB-051
Goal: When a setup PR is merged, detect it and mark relevant findings/tasks as resolved or ready for rescan.
Acceptance Criteria: GitHub webhook or polling detects PR merged.; Linked tasks update status.; Linked findings move to pending_rescan or resolved.; New scan can confirm resolution.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/runner, scripts/codex-runner
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only setup PR merge resolution service plus GitHub pull_request webhook integration. Signed merged PR webhooks now match setup PR previews by installation, repository, and PR number, idempotently skip already resolved previews, record safe merge metadata, complete linked approved setup-pr Cortex Tasks, resolve linked readiness findings, and write metadata-only audit events without storing source, diffs, patches, snippets, secrets, .env contents, generated file bodies, or command output.
Validation Result: Passed focused setup PR merge resolution/webhook tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test` on 2026-06-02.
Follow-up Risk: RFB-067 can broaden GitHub webhook handling and scan debounce; this task resolves setup PR merge lifecycle without adding a new preview status enum.
Next Recommended Task: RFB-061

### RFB-055 — Reframe Linear intake as external task import

Status: [x]
Milestone: Phase 8 — Cortex Tasks and External Sync
Priority: P0
Area: Product/backend
Depends on: RFB-003
Goal: Keep Linear intake work, but position it as importing external work into Cortex Tasks, not as the main front door.
Acceptance Criteria: Linear issue candidates become Cortex Task drafts or task packet candidates.; User approval is required.; Linear issues do not auto-run.; UI copy says “Import from Linear”, not “Start here”.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-017
Validation Result: Passed

### RFB-056 — Add GitHub Issues sync for Cortex Tasks

Status: [x]
Milestone: Phase 8 — Cortex Tasks and External Sync
Priority: P1
Area: GitHub/integrations
Depends on: RFB-014
Goal: Allow approved Cortex Tasks to be pushed to GitHub Issues when users prefer GitHub-native tracking.
Acceptance Criteria: User can push selected tasks to GitHub Issues.; Created issue links back to Cortex Task.; Issue body includes task objective, acceptance criteria, risk, suggested validation, and Cortex link.; Duplicate pushes are prevented.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Manually rescued the blocked GitHub Issues sync work without reviving the stale stash schema. The GitHub App client now supports metadata-only issue creation through an injected installation request transport and returns only safe issue fields. The web app has a server-only GitHub Issues sync service for approved scan-generated Cortex Tasks, requiring workspace membership, a registered GitHub repository, and an installation with `issues: write`; it builds a safe issue body with task objective, acceptance criteria, risk, suggested validation labels, repository metadata, and an optional Cortex task URL. Sync writes exactly one canonical `github_issue` external link through the normalized `cortex_task_external_links` model, prevents duplicate pushes for already-synced tasks, records metadata-only audit events, exposes a narrow server action, and adds `/dashboard/tasks/sync-github-issues` plus task/queue CTAs without creating approvals, queue jobs, runs, task packets, runner assignments, or PR artifacts.
Follow-up Risk: Production GitHub Issues sync requires an optional GitHub App installation grant with `issues: write`; scan-only and setup-PR permission profiles remain separate from issue mutation.
Next Recommended Task: RFB-077
Validation Result: Passed `pnpm --filter @control-plane/github exec vitest run src/app-client.test.ts --config vitest.config.ts --configLoader runner`; passed `pnpm --filter @control-plane/web exec vitest run src/github/issues.test.ts src/server/action-factories.test.ts src/server/actions.test.ts app/github-issue-sync-ui.test.tsx app/linear-task-sync-ui.test.tsx app/cortex-task-queue-ui.test.tsx --config vitest.config.ts --configLoader runner`; passed `pnpm run typecheck`; passed `pnpm run lint`; passed `pnpm run format:check`; passed `pnpm test` with 251 files and 3,119 tests.

### RFB-057 — Add Linear task sync from Cortex Tasks

Status: [x]
Milestone: Phase 8 — Cortex Tasks and External Sync
Priority: P1
Area: Linear/integrations
Depends on: RFB-055
Goal: Allow approved Cortex Tasks generated from scans to be pushed to Linear.
Acceptance Criteria: User can choose Linear team/project/status.; Cortex Task links to Linear issue.; Linear issue body includes safe task details.; Status sync is bounded and metadata-only.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-017
Validation Result: Passed

### RFB-058 — Add external link model for tasks

Status: [x]
Milestone: Phase 8 — Cortex Tasks and External Sync
Priority: P1
Area: Database/shared
Depends on: RFB-014
Goal: Create a robust model for linking Cortex Tasks to external systems.
Acceptance Criteria: Supports GitHub Issue, Linear Issue, Jira Issue, PR, and docs links.; Does not require external sync for task to exist.; Stores provider, external ID, URL, title, status, and sync timestamp.
Validation: Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/db, apps/web/src/db, packages/github, apps/web/src/server, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by watchdog repair after removing the protected DATA_MODEL.md change and preserving the runner safety gate.
Next Recommended Task: Resume the local backlog runner so it can continue the normal merge queue.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-059 — Add task status transition rules

Status: [x]
Milestone: Phase 8 — Cortex Tasks and External Sync
Priority: P0
Area: Backend
Depends on: RFB-014
Goal: Define legal status transitions for Cortex Tasks.
Acceptance Criteria: Invalid transitions are rejected.; User actions are audited.; Runner actions can only transition execution-related states.; External sync cannot bypass user approval.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-060 — Add task packet builder from Cortex Task

Status: [x]
Milestone: Phase 8 — Cortex Tasks and External Sync
Priority: P0
Area: Backend/runner bridge
Depends on: RFB-014
Goal: Build task packets from approved Cortex Tasks for runner execution.
Acceptance Criteria: Uses Cortex Task objective, acceptance criteria, repo policy, validation commands, and risk metadata.; Requires approved status.; Blocks high-risk tasks unless required approval exists.; Produces existing TaskPacket contract.; Does not embed raw source.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-017
Validation Result: Passed

### RFB-061 — Add runner gate UI

Status: [x]
Milestone: Phase 9 — Runner Gate and Execution Flow Refactor
Priority: P0
Area: Web/UI
Depends on: RFB-046, RFB-060
Goal: Introduce runner installation only after the user has approved tasks or needs local execution.
Acceptance Criteria: Runner gate explains why local execution is optional.; Shows execution modes: planning only, setup PR, local runner.; User can continue without runner.; Runner setup CTA appears only for tasks requiring local execution.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/github, apps/web/src/server, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/shared, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a first-class Cortex Tasks runner gate that explains local execution is optional, summarizes planning-only/setup-PR/local-runner modes, keeps a continue-without-runner path available, and shows the local runner setup CTA only when approved local-runner tasks require execution.
Next Recommended Task: RFB-062
Validation Result: Passed with focused Cortex Task queue UI test plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-062 — Add execution mode selector per Cortex Task

Status: [x]
Milestone: Phase 9 — Runner Gate and Execution Flow Refactor
Priority: P0
Area: Web/UI/backend
Depends on: RFB-046
Goal: Allow each task to specify how it should be handled.
Acceptance Criteria: Mode is editable before approval.; Invalid modes are blocked based on task risk/status.; Local runner mode requires runner availability.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/shared, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a metadata-only Cortex Task execution mode update path and queue selector. Mode edits are allowed only before approval, blocked-risk tasks can move only to planning-only, and local runner mode requires an available runner with dry-run support and git capability.
Next Recommended Task: RFB-063
Validation Result: Passed with focused Cortex Task service/action/UI tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-063 — Connect approved Cortex Tasks to existing runner queue

Status: [x]
Milestone: Phase 9 — Runner Gate and Execution Flow Refactor
Priority: P0
Area: Runner/backend
Depends on: RFB-060, RFB-061
Goal: Approved Cortex Tasks should be claimable/executable by the local runner through the existing web-to-runner protocol.
Acceptance Criteria: Runner polls/claims Cortex Task-derived jobs.; Task packet is passed through existing protocol.; Run events link back to Cortex Task.; Validation and PR artifacts link to Cortex Task.; Cancellation/repair still work.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/runner, scripts/codex-runner, packages/shared, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a Cortex Task runner queue bridge that converts approved local-runner Cortex Tasks into safe TaskPackets, legacy-compatible queue task rows, and queued runs that the existing runner poll/claim protocol can serve. The bridge accepts manual and Linear-sourced Cortex Tasks, keeps audit metadata counts/IDs only, updates Cortex Task run links, and records PR artifact links back onto Cortex Tasks through run IDs.
Next Recommended Task: RFB-064
Validation Result: Passed with focused Cortex queue/action/artifact tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-064 — Add runner eligibility checks for tasks

Status: [x]
Milestone: Phase 9 — Runner Gate and Execution Flow Refactor
Priority: P0
Area: Runner/backend
Depends on: RFB-063
Goal: Before offering runner execution, check whether a task is eligible.
Acceptance Criteria: Ineligible tasks show clear reasons.; User can fix setup gaps before execution.; No ineligible task reaches runner queue.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/runner, scripts/codex-runner, packages/shared, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added metadata-only runner eligibility checks before Cortex Tasks can enter the runner queue, including clear fixable reasons for runner availability, repository setup, repo mapping policy, required validation, approval state, execution mode, and blocked risk. The Cortex Tasks UI now shows eligibility reasons and disables the local execution submit path for ineligible tasks.
Next Recommended Task: RFB-065
Validation Result: Passed focused Cortex runner queue/UI tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-065 — Update run detail pages to show Cortex Task context

Status: [x]
Milestone: Phase 9 — Runner Gate and Execution Flow Refactor
Priority: P1
Area: Web/UI
Depends on: RFB-063
Goal: Run pages should show the originating Cortex Task, findings, acceptance criteria, risk, validation, and PR evidence.
Acceptance Criteria: Existing run pages preserve timeline/evidence.; New task context appears above technical event details.; No raw source/diffs/logs exposed.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added metadata-only Cortex Task context to run detail loading and rendering. Run detail pages now show the originating Cortex Task, acceptance criteria, risk, execution mode, approval state, linked finding summaries, suggested validation labels, PR evidence, and validation evidence above technical run metadata while preserving timeline, dry-run, validation, PR artifact, approval, and repair surfaces. Unsafe task/finding payloads are omitted before display and objectives, task packets, raw commands, diffs, patches, snippets, local paths, secrets, and logs remain excluded.
Next Recommended Task: RFB-066
Validation Result: Passed focused run detail service/UI tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-066 — Add repair request flow from Cortex Task view

Status: [x]
Milestone: Phase 9 — Runner Gate and Execution Flow Refactor
Priority: P1
Area: Web/UI/backend
Depends on: RFB-065
Goal: Allow user to request repair from the Cortex Task page when a PR/run needs adjustment.
Acceptance Criteria: Repair request links to task, run, PR, and prior validation evidence.; Repair packet remains metadata-only.; Attempt limits are respected.; Existing runner repair flow is reused.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/shared, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a workspace-scoped Cortex Task repair context service and surfaced bounded repair controls on PR-opened Cortex Tasks. The task view now links safe task/run/PR metadata with prior validation status counts, reuses the existing `RequestRepairDialog` and repair action through `previousRunId`, respects attempt limits, drops unsafe PR URLs, and keeps repair packets handled by the existing metadata-only repair service.
Follow-up Risk: The repair dialog content is still opened client-side; static task-card HTML intentionally shows only trigger metadata and attempt summaries.
Next Recommended Task: RFB-067
Validation Result: Passed focused repair context/task queue tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-067 — Add GitHub webhook handling for repo changes

Status: [x]
Milestone: Phase 10 — Recurring Scans and Weekly Reviews
Priority: P1
Area: GitHub/backend
Depends on: RFB-018
Goal: Handle GitHub events for pushes, PR merges, and setup PR status changes.
Acceptance Criteria: Webhooks are authenticated and verified.; Events are workspace/repo scoped.; PR merge can trigger rescan.; Noise is debounced.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added safe GitHub `push` webhook parsing, default-branch push rescan triggers, merged-PR rescan triggers, and a webhook-scoped repo scan trigger service. Webhook scans resolve registered repositories by installation and repository metadata, skip unregistered repos, debounce queued/running scans, and keep webhook responses/audit metadata free of commit messages, changed paths, pusher data, raw source, diffs, patches, snippets, secrets, and command output.
Follow-up Risk: Webhook-triggered scans are queued only; recurring scheduling and plan-aware cadence remain in RFB-068/RFB-073.
Next Recommended Task: RFB-068
Validation Result: Passed focused GitHub webhook/repo-scan route tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-068 — Add recurring scan scheduler

Status: [x]
Milestone: Phase 10 — Recurring Scans and Weekly Reviews
Priority: P1
Area: Backend
Depends on: RFB-067
Goal: Schedule recurring repo scans for active workspaces.
Acceptance Criteria: Supports weekly scan cadence.; Supports manual rescan.; Avoids duplicate scans.; Respects plan limits.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only recurring repo scan scheduler that selects active GitHub repositories, queues first scans or weekly rescans when due, skips queued/running scans to avoid duplicates, respects workspace plan usage limits when enforcement is enabled, and writes metadata-only audit events. The manual rescan API remains the explicit user-triggered rescan surface and continues to debounce active scans.
Follow-up Risk: Plan enforcement is still feature-flagged while billing usage validation matures, and RFB-069 needs to classify finding drift after recurring scans complete.
Next Recommended Task: RFB-069
Validation Result: Passed focused repo scan scheduler tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-069 — Add finding lifecycle and drift detection

Status: [x]
Milestone: Phase 10 — Recurring Scans and Weekly Reviews
Priority: P1
Area: Backend
Depends on: RFB-068
Goal: Track whether findings are new, recurring, resolved, worsened, or stale.
Acceptance Criteria: Finding dedupe keys are used.; Resolved findings can be confirmed after rescan.; New findings can generate task recommendations.; Report shows changes since previous scan.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added metadata-only finding lifecycle handling around dedupe-key upserts and rescan reconciliation. New, recurring, worsened, and stale findings are tagged in safe evidence metadata; duplicate findings preserve linked task IDs; missing open findings from prior scans are resolved during lifecycle reconciliation; deterministic readiness reports include count-only drift summaries, strengths, weaknesses, and next actions without exposing raw evidence, source, diffs, patches, snippets, local paths, secrets, or command output.
Follow-up Risk: Lifecycle state is represented as safe finding metadata rather than a dedicated database column; future reporting can add indexed lifecycle storage if analytics need it.
Next Recommended Task: RFB-070
Validation Result: Passed focused finding lifecycle, readiness report generator, and task recommendation generator tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-070 — Add weekly review generator

Status: [x]
Milestone: Phase 10 — Recurring Scans and Weekly Reviews
Priority: P1
Area: AI/backend
Depends on: RFB-069
Goal: Generate a weekly engineering review summary.
Acceptance Criteria: Review is generated from safe metadata.; User can view in app.; Email/slack delivery can be deferred.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a shared metadata-only WeeklyEngineeringReview contract plus a deterministic web generator that summarizes safe workspace repository, readiness report, finding, task recommendation, and Cortex Task metadata. The generated review includes totals, repository summaries, dashboard links, deferred email/slack delivery status, and recursive unsafe payload rejection. Added a lightweight /dashboard/weekly-review app surface so users can view the generated review while richer UI polish remains in RFB-071.
Follow-up Risk: Reviews are generated on demand rather than persisted; RFB-071 delivered the polished view without adding stored weekly snapshots.
Next Recommended Task: RFB-071
Validation Result: Passed focused weekly review contract/generator/UI tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-071 — Add weekly review UI

Status: [x]
Milestone: Phase 10 — Recurring Scans and Weekly Reviews
Priority: P1
Area: Web/UI
Depends on: RFB-070
Goal: Add a weekly review page or dashboard section.
Acceptance Criteria: Shows latest review.; Shows trend from previous review.; Links to findings/tasks/PRs/runs.; Provides “approve next recommended tasks” CTA.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Polished the weekly engineering review surface into a latest-review view with score totals, deferred delivery status, an explicit trend-from-previous-review section, repository score movement counts, action links for findings/task recommendations/tasks/PRs/runs, and a primary “Approve next recommended tasks” CTA that routes into the existing task recommendation approval workflow without duplicating runner or approval logic.
Follow-up Risk: Reviews are still generated on demand rather than persisted snapshots; RFB-072 can start usage/event tracking before deciding whether persisted weekly review history is needed.
Next Recommended Task: RFB-072
Validation Result: Passed focused weekly review contract/generator/UI/navigation tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-072 — Add usage event model for scans and AI generation

Status: [x]
Milestone: Phase 11 — Billing, Usage, and Cost Controls
Priority: P1
Area: Billing/backend
Depends on: RFB-035, RFB-036
Goal: Track usage for scans, report generation, task generation, setup PR generation, and runner executions.
Acceptance Criteria: Usage events are workspace-scoped.; Tracks model usage category without exposing prompts/source.; Supports plan limits.; Does not require full Stripe billing yet.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, packages/shared, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a workspace-scoped usage event table, enums, migration metadata, and billing service for repo scans, readiness report generation, task recommendation generation, setup PR generation, and runner executions. Existing scan/report/recommendation/setup PR persistence paths and runner claim handling now write idempotent metadata-only usage events with model usage categories and quantity summaries for future plan gates, while tests reject prompts, raw source, diffs, patches, snippets, logs, secrets, and .env references in usage metadata. Hardened the runner descendant-timeout test after full-suite timing exposed a pre-timeout marker race.
Follow-up Risk: RFB-073 still needs user-facing plan enforcement, over-limit states, and admin overrides on top of the usage event counters.
Next Recommended Task: RFB-073
Validation Result: Passed focused usage-event/schema/repo-readiness/runner-claim tests plus pnpm vitest run scripts/codex-runner/git.test.ts, pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-073 — Add scan/task generation limits by plan

Status: [x]
Milestone: Phase 11 — Billing, Usage, and Cost Controls
Priority: P1
Area: Billing/backend
Depends on: RFB-072
Goal: Add simple plan gates to prevent unbounded AI cost.
Acceptance Criteria: Free plan can run limited scans.; Paid plans have higher caps.; Over-limit states are clear.; Admin override exists for testing.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/ai, apps/web/src/tasks, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only billing plan limit service with free, pro, team, and MVP caps for repo scans, readiness report generation, task recommendation generation, setup PR generation, and runner executions. Manual/API scans, GitHub webhook scans, recurring scans, readiness report generation, and task recommendation generation now assert usage before creating new work, with a public `plan_limit_exceeded` action error, clear reset messaging, and validated admin override support for testing. The gates count metadata-only usage events and keep plan decisions free of raw source, diffs, patches, snippets, secrets, .env contents, prompts, and command output.
Follow-up Risk: Pricing/plan UI still needs to expose scans and generation usage/remaining counts for users; RFB-075 depends on this backend gate.
Next Recommended Task: RFB-074
Validation Result: Passed focused plan-limit/server-error/repo-scan/scheduler/report/recommendation tests plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-074 — Add managed execution cost boundary

Status: [x]
Milestone: Phase 11 — Billing, Usage, and Cost Controls
Priority: P2
Area: Billing/product
Depends on: RFB-063
Goal: Define cost boundaries for any Cortex-key implementation execution. Default should remain customer-owned Codex/API execution.
Acceptance Criteria: Docs state task creation/scanning can use Cortex key.; Docs state heavy implementation defaults to customer-owned execution.; Any Cortex-managed implementation path requires credits/caps.; No unlimited implementation path exists.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/server, apps/web/src/app/api, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added an explicit managed execution cost boundary to the MVP plan, product spec, architecture, security model, and README. The docs now state that Cortex-key AI usage is allowed for metadata-first repo-readiness scanning, readiness report generation, task recommendation generation, and setup PR generation, while source-changing implementation defaults to customer-owned local runner credentials and customer-owned Codex/API usage. Future Cortex-managed implementation execution must require credits or plan caps before work starts, and no such path may run with unlimited spend or uncapped usage.
Follow-up Risk: RFB-075 still needs user-facing plan usage display for scans, task generations, and setup PR usage.
Next Recommended Task: RFB-075
Validation Result: Passed focused cost-boundary docs test plus pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.

### RFB-075 — Add pricing/plan placeholder UI

Status: [x]
Milestone: Phase 11 — Billing, Usage, and Cost Controls
Priority: P2
Area: Web/UI
Depends on: RFB-073
Goal: Add lightweight plan usage display before full billing.
Acceptance Criteria: Shows scans used/remaining.; Shows task generations used/remaining.; Shows setup PRs created.; Does not require Stripe to ship internal MVP.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web/src/billing, packages/db
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added a server-only plan usage summary on top of the billing plan limit service and surfaced it in the billing settings page after selected-workspace membership verification. The UI now shows monthly repo scans used/remaining, task generations used/remaining, setup PRs created/remaining, runner usage, workspace limits, reset date, and Stripe configured/not-configured booleans without rendering Stripe IDs or checkout actions.
Follow-up Risk: Billing remains a placeholder; no Stripe checkout, customer portal, or paid-plan upgrade flow exists yet. `RFB-077` remains blocked pending manual protected-doc review, so the next unblocked security-boundary task is `RFB-079`.
Next Recommended Task: RFB-079
Validation Result: Passed focused billing plan-limit/UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-076 — Resolve existing `TASK-174` protocol payload boundary tests

Status: [x]
Milestone: Phase 12 — Security and Boundary Hardening
Priority: P0
Area: Security/testing
Depends on: RFB-003
Goal: Unblock and complete protocol payload boundary tests with a clear scope. Ensure new scan/report/task payloads also reject source-like data.
Acceptance Criteria: Boundary tests pass.; Capability-value filtering scope is explicitly decided.; New repo-readiness contracts are included in unsafe payload tests.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Resolution Notes: Existing TASK-174 remains keep-now as this scoped follow-up; capability-value filtering must be decided here before the boundary tests are completed.
Completion Notes: Completed by watchdog recovery after the runner stopped on a quality-gate blocker. Shared payload safety now treats runner capability values as web-bound metadata and rejects source-like text, diff/patch markers, raw-output labels, secret-like assignments, environment references, and control characters across the affected protocol schemas while preserving safe tool path metadata.
Follow-up Risk: RFB-057 still has a clean, CI-passing draft PR and should resume through the runner merge path rather than bypassing runner gates.
Next Recommended Task: Restart the local backlog runner so it can resume the normal merge queue.
Validation Result: Passed `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

### RFB-077 — Resolve existing `TASK-178` token storage documentation/checks

Status: [x]
Milestone: Phase 12 — Security and Boundary Hardening
Priority: P0
Area: Security/docs
Depends on: Manual review
Goal: Complete token storage docs/checks safely despite SECURITY_MODEL.md being protected.
Acceptance Criteria: Manual review completed.; Security docs updated.; Full validation passes.; No sensitive token details are exposed.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Manually reviewed the stale `codex/TASK-178-add-token-storage-documentation-and-checks` branch and did not merge it because it was based before the repo-readiness refactor and would delete current MVP work. Ported the token-storage intent into the current tree as `docs/TOKEN_STORAGE_SECURITY.md`, added a small reviewed `SECURITY_MODEL.md` pointer, and added `apps/web/src/security/token-storage.test.ts` to verify runner pairing/credential hashes, GitHub server-only credential handling, Linear sealed token storage and revocation clearing, Clerk public/server env boundaries, server-only database access, placeholder-only env examples, client-bundle import boundaries, and schema hash/ciphertext columns without exposing sensitive token details.
Follow-up Risk: Token-storage coverage is static/source-level; production runtime validation still depends on real Clerk, database, and GitHub App credentials being configured outside the repository.
Next Recommended Task: RFB-081
Validation Result: Passed red/green focused token-storage guard (`pnpm --filter @control-plane/web test -- src/security/token-storage.test.ts`, 1 file, 6 tests) and focused web security suite (`pnpm --filter @control-plane/web test -- src/security/token-storage.test.ts src/security/payload-guard.test.ts test/security src/runner-auth.test.ts src/linear/oauth.test.ts app/auth-shell.test.ts app/db-shell.test.ts src/server/source-conventions.test.ts`, 9 files, 93 tests). Full repository validation is recorded in `RFB-081`.

### RFB-078 — Add scan boundary tests

Status: [x]
Milestone: Phase 12 — Security and Boundary Hardening
Priority: P0
Area: Security/testing
Depends on: RFB-018, RFB-019
Goal: Prove web scan mode does not read or persist disallowed files.
Acceptance Criteria: Tests cover .env, .env.local, private keys, large files, binary files, and source files outside allowlist.; Tests prove no raw source is persisted.; Tests prove safe error summaries.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-020
Validation Result: Passed

### RFB-079 — Add setup PR permission boundary tests

Status: [x]
Milestone: Phase 12 — Security and Boundary Hardening
Priority: P0
Area: Security/testing
Depends on: RFB-051
Goal: Prove setup PR mode can only create/update approved setup files.
Acceptance Criteria: Blocks attempts to write code files by default.; Blocks .env writes.; Blocks protected paths unless explicitly allowed for safe generated files.; PR body does not leak raw source.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added setup PR boundary coverage in the GitHub App writer and web setup PR creation service. The GitHub writer now rejects setup PR file writes outside the approved setup template path allowlist before transport, including source paths, .env paths, unapproved root files, and unapproved workflow paths, while preserving the explicitly allowed generated validation workflow. Setup PR body tests now reject raw source, diffs, patches, and secrets, and service tests prove preview path tampering stops before GitHub writes.
Follow-up Risk: RFB-081 remains gated by blocked RFB-077 manual protected-doc review; the next unblocked implementation task is RFB-082.
Next Recommended Task: RFB-082
Validation Result: Passed — pnpm run typecheck; pnpm run lint; pnpm run format:check; pnpm test (242 files, 3057 tests).

### RFB-080 — Add findings/task redaction tests

Status: [x]
Milestone: Phase 12 — Security and Boundary Hardening
Priority: P0
Area: Security/testing
Depends on: RFB-005, RFB-007
Goal: Ensure findings and Cortex Tasks cannot store or render unsafe data.
Acceptance Criteria: Unsafe keys rejected at schema level.; UI does not render raw code/log/diff fields.; Server actions strip unsafe metadata.; Tests include hostile payloads.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/db, apps/web/src/db, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed by local Codex backlog runner.
Next Recommended Task: RFB-003
Validation Result: Passed

### RFB-081 — Complete existing `TASK-181` security hardening milestone

Status: [x]
Milestone: Phase 12 — Security and Boundary Hardening
Priority: P0
Area: Security/testing
Depends on: RFB-076, RFB-077, RFB-078, RFB-079, RFB-080
Goal: Complete the security hardening milestone with the new repo-readiness model included.
Acceptance Criteria: All security tests pass.; Existing runner non-exfiltration checks still pass.; New scan/setup task boundaries are verified.; Security model is updated.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/repo-readiness, packages/shared, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Completed after `RFB-077` resolved the token-storage documentation/check gap. The security hardening milestone now includes runner capability payload filtering, scan boundary tests, setup PR permission boundaries, findings/task hostile payload coverage, token-storage/server-only/client-bundle checks, runner non-exfiltration blocked-path E2E coverage, and security-model documentation coverage for token and secret storage. Final validation also hardened the local backlog runner command timeout helper with a regression test for late-spawned descendants so timed-out commands cannot leave child processes writing after the parent exits.
Follow-up Risk: Production manual testing still requires real runtime credentials and authenticated review; post-MVP deferred work begins at `RFB-090` and remains out of scope without an explicit scope change.
Next Recommended Task: Complete production runtime credential setup and production manual testing, or explicitly approve a post-MVP expansion plan before starting `RFB-090`.
Validation Result: Passed - red/green token-storage guard (`pnpm --filter @control-plane/web test -- src/security/token-storage.test.ts`, 1 file, 6 tests); focused web security suite (`pnpm --filter @control-plane/web test -- src/security/token-storage.test.ts src/security/payload-guard.test.ts test/security src/runner-auth.test.ts src/linear/oauth.test.ts app/auth-shell.test.ts app/db-shell.test.ts src/server/source-conventions.test.ts`, 9 files, 93 tests); focused milestone/security suite (`pnpm test -- apps/web/src/security/token-storage.test.ts apps/web/src/security/payload-guard.test.ts apps/web/test/security/audit-events.test.ts apps/web/test/security/claim-idempotency.test.ts packages/shared/src/payload-safety.test.ts packages/logging/src/redact.test.ts packages/validation/src/redact.test.ts apps/runner/test/e2e/runner-blocked-paths.test.ts apps/web/src/repo-readiness/onboarding-e2e.test.tsx apps/web/src/setup-pr/e2e.test.tsx apps/web/src/setup-pr/creation.test.ts packages/github/src/app-client.test.ts`, 12 files, 96 tests); runner timeout regression (`pnpm test -- scripts/codex-runner/git.test.ts`, 1 file, 11 tests); full `pnpm test` (258 files, 3153 tests); `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `git diff --check`; credential-marker audit returned no matches; backlog open/in-progress scan returned no incomplete or active task status rows.

### RFB-082 — Add full repo-readiness onboarding E2E

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Testing/E2E
Depends on: RFB-039 through RFB-046
Goal: Create an end-to-end test for the new onboarding flow.
Acceptance Criteria: Test passes headlessly.; No runner required.; No raw source displayed.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added `apps/web/src/repo-readiness/onboarding-e2e.test.tsx` covering the hosted repo-readiness onboarding path from scan trigger through GitHub inventory and validation-posture modules, readiness report persistence, task recommendation approval into a draft setup-pr Cortex Task, and server-rendered findings, recommendations, and tasks. The test asserts no local runner queue, task packet, or run is required and guards serialized outputs against raw source, diffs, patches, snippets, secrets, local paths, `.env` markers, and runner artifacts.
Validation Result: Passed - `pnpm vitest run apps/web/src/repo-readiness/onboarding-e2e.test.tsx`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` (243 files, 3058 tests).
Follow-up Risk: None for this task; `RFB-081` remains gated by blocked `RFB-077`.
Next Recommended Task: RFB-083

### RFB-083 — Add setup PR E2E

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Testing/E2E
Depends on: RFB-051, RFB-053
Goal: Create an end-to-end test for setup PR generation.
Acceptance Criteria: Approved setup tasks produce PR preview.; PR branch is created in mock/local GitHub test harness.; PR artifact is stored.; Findings/tasks link to PR.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added `apps/web/src/setup-pr/e2e.test.tsx` covering approved setup-pr Cortex Tasks through metadata-only preview creation, mock GitHub App branch/PR creation, preview PR metadata persistence, linked finding/task evidence summaries, task PR external-link updates, and server-rendered setup PR flow output. The E2E asserts generated setup file bodies remain omitted from hosted preview/evidence data and guards serialized outputs against raw source, diffs, patches, snippets, secrets, local paths, `.env` markers, runner IDs, task packets, and run artifacts.
Validation Result: Passed - `pnpm vitest run apps/web/src/setup-pr/e2e.test.tsx apps/web/src/setup-pr/creation.test.ts apps/web/src/setup-pr/previews.test.ts apps/web/src/setup-pr/resolution.test.ts apps/web/app/setup-pr-flow-ui.test.tsx`; `pnpm --filter @control-plane/web run typecheck`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`.
Follow-up Risk: None for this task; setup PR artifacts are represented as preview PR metadata and Cortex Task pull-request links, while runner-run PR artifacts remain scoped to local-runner executions.
Next Recommended Task: RFB-084

### RFB-084 — Update existing `TASK-182` full local runner E2E to use Cortex Task source

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Testing/E2E
Depends on: RFB-063
Goal: Update the local runner E2E so it can execute a task derived from a Cortex Task, not only a standalone task packet/backlog task.
Acceptance Criteria: Fixture Cortex Task converts to TaskPacket.; Runner executes through existing mock/Codex flow.; Validation, commit, push, and PR artifact behavior is verified.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Updated the full local runner happy-path E2E so the fixture starts as an approved local-runner Cortex Task, converts to a schema-valid TaskPacket without an embedded worktree path, and then executes through the existing mocked Codex, validation, commit, push, and mocked PR artifact loop. The runner now computes a safe local worktree path from runner config before dry-run when web/coordinator-originated TaskPackets omit `repo.worktreePath`, keeping local execution details runner-owned.
Validation Result: Passed - `pnpm vitest run apps/runner/test/e2e/runner-happy-path.test.ts`; `pnpm --filter @control-plane/runner run typecheck`; `pnpm vitest run apps/runner/src/run.test.ts apps/runner/src/dry-run/check-worktree-readiness.test.ts apps/runner/src/git/worktree-path.test.ts apps/runner/test/e2e/runner-happy-path.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`.
Follow-up Risk: None for this task; `RFB-081` remains gated by blocked `RFB-077`.
Next Recommended Task: RFB-085

### RFB-085 — Update existing `TASK-183` web-to-runner protocol E2E

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Testing/E2E
Depends on: RFB-063
Goal: Prove coordinator-to-runner protocol loop works with Cortex Tasks.
Acceptance Criteria: Manual task still works.; Cortex Task-derived job works.; Claim/run/event/validation/artifact submissions link correctly.; Cancellation/repair boundaries still pass.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/runner, scripts/codex-runner, packages/shared, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added `apps/web/src/jobs/runner-protocol-e2e.test.ts`, an in-memory service-level protocol E2E covering manual queued jobs and Cortex Task-derived queued jobs through poll, claim, run event submission, validation result submission, PR artifact submission, and Cortex Task PR artifact linkage. The test also verifies current-run cancellation polling returns cancellation metadata before new work and repair jobs are only exposed when a repair TaskPacket is present, while keeping all assertions metadata-only.
Validation Result: Passed - `pnpm vitest run apps/web/src/jobs/runner-protocol-e2e.test.ts`; `pnpm vitest run apps/web/src/jobs/runner-protocol-e2e.test.ts apps/web/src/jobs/poll.test.ts apps/web/src/jobs/claim.test.ts apps/web/src/jobs/cortex-queue.test.ts apps/web/src/runs/events.test.ts apps/web/src/runs/artifacts.test.ts apps/runner/src/protocol/poll-loop.test.ts apps/web/src/repairs/repair-requests.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test`.
Follow-up Risk: None for this task; this adds protocol integration coverage without changing production protocol behavior.
Next Recommended Task: RFB-086

### RFB-086 — Update existing `TASK-184` browser happy-path smoke test

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Testing/browser
Depends on: RFB-039 through RFB-048
Goal: Browser smoke test should validate the new front door and key operational pages.
Acceptance Criteria: New onboarding path passes.; Findings page renders.; Cortex Tasks page renders.; Setup PR page renders.; Existing Runs/Runners/Approvals pages still render.; Mobile layout does not overlap or hide primary CTAs.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added `apps/web/app/task-184-browser-happy-path-smoke.test.tsx`, a TASK-184/RFB-086 browser-path smoke guard covering protected route reachability, server-rendered repo scan onboarding, findings, Cortex Tasks, setup PRs, runs, runners, and approvals, plus mobile layout assertions for scroll-contained tables and reachable primary CTAs. Updated the Cortex Task execution-mode form to stack on narrow screens and added an accessible label to the paired runners table.
Validation Result: Passed - `pnpm test -- apps/web/app/task-184-browser-happy-path-smoke.test.tsx`; Playwright CLI smoke against the TASK-184 static browser target at mobile 390x844 and desktop 1440x1000 with page scroll width equal to viewport width, nine CTAs reachable, and zero geometry failures; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` (246 files, 3066 tests).
Follow-up Risk: The Playwright check used a static browser target because the real protected dashboard requires runtime database/auth configuration; full route/component coverage remains in Vitest and the browser geometry target mirrors the user path labels and CTA layout.
Next Recommended Task: RFB-087

### RFB-087 — Update existing `TASK-185` MVP acceptance checklist

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Release readiness
Depends on: RFB-082, RFB-083, RFB-084, RFB-085, RFB-086
Goal: Update MVP acceptance checklist to reflect the new product direction.
Acceptance Criteria: Checklist includes repo scan onboarding.; Checklist includes findings/task generation.; Checklist includes setup PR creation.; Checklist includes optional runner execution.; Checklist includes security boundary checks.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/github, apps/web/src/server, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added `docs/MVP_ACCEPTANCE.md`, mapping the updated repo-readiness MVP acceptance lanes to concrete automated evidence and manual checks: repo scan onboarding, findings/task generation, setup PR creation, optional runner execution, and security boundary checks. Added `scripts/codex-runner/mvp-acceptance.test.ts` to verify the checklist exists, covers the required lanes, references concrete test evidence, and preserves the runner/web trust boundary language.
Validation Result: Passed - `pnpm test -- scripts/codex-runner/mvp-acceptance.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` (247 files, 3068 tests).
Follow-up Risk: The checklist records manual release-review items that still need execution in `RFB-088` before claiming full MVP release readiness.
Next Recommended Task: RFB-088

### RFB-088 — Run existing `TASK-186` full MVP validation suite

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Release readiness
Depends on: RFB-087
Goal: Run full validation suite after the refactor.
Acceptance Criteria: Root typecheck passes.; Root lint passes.; Root test passes.; Format check passes.; E2E tests pass.; Security boundary tests pass.; No known blockers remain for MVP release.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, packages/logging, packages/policies, apps/web/src/security, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Ran the post-refactor MVP validation suite, including focused repo-readiness/setup PR/local runner/protocol/browser/checklist E2E coverage and focused security-boundary coverage. The focused suites covered hosted repo scan onboarding, setup PR creation, Cortex Task-derived local runner execution, runner protocol polling/claims/events/artifacts, browser happy-path smoke assertions, MVP acceptance checklist coverage, payload guards, audit/idempotency, redaction, shared payload safety, and blocked runner paths. No automated MVP release blockers were found.
Validation Result: Passed - focused MVP E2E suite with `pnpm test -- apps/web/src/repo-readiness/onboarding-e2e.test.tsx apps/web/src/setup-pr/e2e.test.tsx apps/runner/test/e2e/runner-happy-path.test.ts apps/web/src/jobs/runner-protocol-e2e.test.ts apps/web/app/task-184-browser-happy-path-smoke.test.tsx scripts/codex-runner/mvp-acceptance.test.ts` (6 files, 13 tests); focused security-boundary suite with `pnpm test -- apps/web/src/security/payload-guard.test.ts apps/web/test/security/audit-events.test.ts apps/web/test/security/claim-idempotency.test.ts packages/shared/src/payload-safety.test.ts packages/logging/src/redact.test.ts packages/validation/src/redact.test.ts apps/runner/test/e2e/runner-blocked-paths.test.ts` (7 files, 72 tests); `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` (247 files, 3068 tests).
Follow-up Risk: Release notes remain to be prepared in `RFB-089`; user-requested GitHub push, Vercel launch, Supabase connection, and Playwright/manual testing against `rory-hayes/payslip-peeks-and-probes.git` are intentionally deferred until all backlog tasks are complete.
Next Recommended Task: RFB-089

### RFB-089 — Prepare updated MVP release notes

Status: [x]
Milestone: Phase 13 — Final MVP Validation and Release Readiness
Priority: P0
Area: Release readiness/docs
Depends on: RFB-088
Goal: Update release notes to describe the new Cortex MVP.
Acceptance Criteria: Release notes explain repo readiness onboarding.; Release notes explain Cortex Tasks.; Release notes explain setup PRs.; Release notes explain optional runner execution.; Release notes list what is intentionally deferred.; Release notes list known risks/limitations.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Added `docs/MVP_RELEASE_NOTES.md` with release-candidate status, repo-readiness onboarding, Cortex Tasks, setup PRs, optional runner execution, intentionally deferred work, known risks/limitations, pre-marketing release-review checks, and a runtime setup status section for Vercel, Auth0, Supabase, GitHub App, and local Supabase CLI boundaries. Added `docs/PRODUCTION_RUNTIME_SETUP.md`, `apps/web/src/runtime/env.ts`, `pnpm production-runtime:check`, `pnpm production-smoke:check`, `pnpm supabase-link:check`, `pnpm supabase-db:check`, `pnpm supabase-smoke:check`, and related guard tests so required production runtime variables, deployed route reachability, local Supabase link state, direct Supabase database connectivity, and Supabase REST/Auth endpoint reachability can be checked through sanitized key/status output without storing secret values, printing response bodies, printing local paths, printing database URLs, printing hosts, printing query output, printing raw `psql` errors, or exposing the Supabase project ref. Added `scripts/codex-runner/mvp-release-notes.test.ts` to verify the required release-note lanes and trust-boundary language. Updated README and SPRINT so the MVP release-readiness lane points to the user-requested GitHub push, Vercel launch, Supabase verification, and Playwright/manual validation with `rory-hayes/payslip-peeks-and-probes.git`. A 2026-06-03 runtime recheck confirmed the Vercel app serves the public Cortex landing page, the Supabase project endpoints are reachable and require API authentication, production manual testing is still gated by missing Supabase `DATABASE_URL` and GitHub App runtime credentials rather than missing deployment, the current worktree passes the root production build, and the Supabase CLI can see the active healthy `Cortex` project. `pnpm vercel-production-env:check` now reports only Vercel production variable names/statuses, confirms the required Auth0 variables are configured and confirms Supabase `DATABASE_URL` plus GitHub App runtime variables are not configured. The repo now has local Supabase config from `supabase init` with a safe `cortex` local project id plus a local setup README and config guard test proving generated local state stays placeholder-only, ignores temp/env files, documents link/migration boundaries, and keeps canonical SQL migrations in `packages/db/migrations`; `pnpm supabase-link:check` now reports ready after local linking with generated `.temp` state ignored. `pnpm supabase-migrations:check` compares canonical package migration IDs with linked remote migration history without printing raw CLI output, database URLs, project refs, passwords, API keys, or local paths. Package migration `0022` has now been applied to the linked remote database through a temporary Supabase CLI release layout, and the migration checker reports local and remote history through `0022`. The Supabase endpoint smoke command intentionally proves only REST/Auth endpoint reachability and API-auth gating; table grants remain a separate credential-backed check. `pnpm supabase-db:check` now verifies direct Postgres connectivity through `DATABASE_URL` using `psql` while printing only statuses; in the current shell it blocks safely because `DATABASE_URL` is not loaded. A follow-up release wiring pass added `pnpm release-readiness:check`, a single sanitized operator gate that composes local runtime env, Vercel production env-name checks, deployed route smoke, local Supabase link status, Supabase migration history, direct Supabase database connectivity, and Supabase endpoint smoke while avoiding secret values, Supabase refs, database URLs, API keys, private keys, response bodies, local paths, query output, and raw `psql` errors in text or JSON output.
Validation Result: Passed - `pnpm test -- scripts/codex-runner/mvp-release-notes.test.ts` (1 file, 2 tests); `pnpm run typecheck`; `pnpm run lint`; `pnpm run format:check`; `pnpm test` (248 files, 3070 tests). Additional 2026-06-03 validation passed: `pnpm run build`; `pnpm test -- scripts/codex-runner/supabase-config.test.ts` (1 file, 4 tests); `pnpm test -- scripts/check-supabase-smoke.test.ts scripts/check-production-smoke.test.ts scripts/check-production-runtime.test.ts apps/web/src/runtime/env.test.ts scripts/codex-runner/production-runtime-doc.test.ts scripts/codex-runner/mvp-release-notes.test.ts scripts/codex-runner/supabase-config.test.ts` (7 files, 29 tests); `pnpm test -- scripts/check-supabase-link.test.ts` (1 file, 4 tests); `pnpm production-runtime:check` and `pnpm production-runtime:check --json` both returned sanitized blocked output in the local shell because production credentials are not loaded; `pnpm production-smoke:check --url https://cortex-two-mu.vercel.app` and `pnpm production-smoke:check --url https://cortex-two-mu.vercel.app --json` both returned sanitized ready output showing public route HTTP 200, sign-up Auth0 dashboard redirect, and protected dashboard HTTP 307; `pnpm supabase-smoke:check --url <supabase-project-url>` returned sanitized ready output with REST/Auth HTTP 401 key-auth gating and no response bodies or project ref, while the bare command remains blocked until `SUPABASE_URL` is exported in the shell; red/green release-readiness guard (`pnpm test -- scripts/check-release-readiness.test.ts`, 1 file, 5 tests); red/green migration-readiness guard (`pnpm test -- scripts/check-supabase-migrations.test.ts`, 1 file, 4 tests); red/green direct database guard (`pnpm test -- scripts/check-supabase-db.test.ts`, 1 file, 5 tests); combined release/runtime/smoke/Supabase guard suite (`pnpm test -- scripts/check-vercel-production-env.test.ts scripts/check-supabase-db.test.ts scripts/check-supabase-migrations.test.ts scripts/check-release-readiness.test.ts scripts/check-production-runtime.test.ts scripts/check-production-smoke.test.ts scripts/check-supabase-link.test.ts scripts/check-supabase-smoke.test.ts apps/web/src/runtime/env.test.ts scripts/codex-runner/production-runtime-doc.test.ts scripts/codex-runner/mvp-release-notes.test.ts scripts/codex-runner/supabase-config.test.ts`, 12 files, 51 tests); local Supabase link completed without storing a database password in the repository; `pnpm supabase-link:check` and `pnpm supabase-link:check --json` now return sanitized ready output; package migration `0022` was applied through a temporary Supabase CLI release layout; `pnpm supabase-migrations:check` and `pnpm supabase-migrations:check --json` now return sanitized ready output with local and remote history through `0022`; `pnpm supabase-db:check` and `pnpm supabase-db:check --json` returned sanitized blocked output because `DATABASE_URL` is not loaded in the local shell; `pnpm release-readiness:check --app-url <deployed-app-url> --supabase-url <supabase-project-url>` returned sanitized blocked output with production public route HTTP 200, sign-up Auth0 redirect ready, protected route HTTP 307, Supabase link ready, Supabase migration history ready, direct Supabase database verification blocked until `DATABASE_URL` is loaded, Supabase endpoint smoke ready, and local runtime shell blocked until credentials are loaded; `pnpm vercel-production-env:check` and `pnpm vercel-production-env:check --json` returned sanitized blocked output with `WEB_BASE_URL` configured and required Auth0 variables configured and `DATABASE_URL` plus GitHub App variables absent; `pnpm run typecheck`; `pnpm run build`; `pnpm run lint`; `pnpm run format:check`; `git diff --check`; credential-marker audit over the release/Supabase/runtime/smoke docs and guard tests with no matches; `pnpm test` (263 files, 3175 tests).
Additional 2026-06-04 Runtime Recheck: Passed focused release-readiness/doc guards with `pnpm test -- scripts/check-release-readiness.test.ts scripts/check-vercel-production-env.test.ts scripts/codex-runner/mvp-release-notes.test.ts scripts/codex-runner/production-runtime-doc.test.ts`; `git diff --check`; and live `pnpm release-readiness:check --app-url <deployed-app-url> --supabase-url <supabase-project-url> --json` returned sanitized blocked output with local shell runtime variables absent, Vercel Auth0 variables configured, Vercel `DATABASE_URL` and GitHub App variables absent, production route smoke ready, Supabase link ready, Supabase migration history ready, direct database verification blocked until `DATABASE_URL` is loaded, and Supabase endpoint smoke ready.
Follow-up Risk: Post-MVP deferred tasks begin at `RFB-090` and should not start without an explicit scope change. Production manual testing remains blocked until a real Supabase `DATABASE_URL` with the remote database password and GitHub App runtime credentials are configured.
Next Recommended Task: Complete production runtime credential setup, then rerun production manual testing.

### RFB-090 — Add Jira import/sync

Status: [!]
Milestone: Phase 14 — Post-MVP Deferred Expansion
Priority: P3
Area: Integrations
Depends on: Post-MVP validation
Goal: Add Jira as an external task import/sync channel after GitHub + internal Cortex Tasks + Linear are stable.
Acceptance Criteria: Jira issues can import into Cortex Task drafts.; Jira tasks do not auto-run.; Status sync is bounded.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, packages/github, apps/web/src/server, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Deferred and blocked for MVP scope. `AGENTS.md` lists Jira as deferred work, and this task depends on post-MVP validation after GitHub, internal Cortex Tasks, and Linear are stable.
Follow-up Risk: Do not implement without an explicit user scope change and a new post-MVP plan.
Next Recommended Task: Complete production runtime credential setup and production manual testing, or explicitly approve a post-MVP expansion plan.
Validation Result: Blocked before validation; post-MVP scope has not been approved.

### RFB-091 — Add Slack linked-context intake

Status: [!]
Milestone: Phase 14 — Post-MVP Deferred Expansion
Priority: P3
Area: Integrations
Depends on: Post-MVP validation
Goal: Allow explicit Slack thread links to enrich Cortex Tasks. Do not crawl Slack broadly.
Acceptance Criteria: User can attach a Slack thread link.; Thread is summarized only after explicit user action.; No broad Slack crawling.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Deferred and blocked for MVP scope. `AGENTS.md` lists Slack as deferred work, and this task depends on post-MVP validation after the core repo-readiness/task/runner loop is stable.
Follow-up Risk: Do not implement without an explicit user scope change and a narrow linked-context privacy plan.
Next Recommended Task: Complete production runtime credential setup and production manual testing, or explicitly approve a post-MVP expansion plan.
Validation Result: Blocked before validation; post-MVP scope has not been approved.

### RFB-092 — Add Notion/Confluence linked-doc intake

Status: [!]
Milestone: Phase 14 — Post-MVP Deferred Expansion
Priority: P3
Area: Integrations
Depends on: Post-MVP validation
Goal: Allow explicit linked docs to enrich task context.
Acceptance Criteria: User can link a doc.; Doc is summarized only after explicit user action.; No broad workspace crawling.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/app, apps/web/src/components, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Deferred and blocked for MVP scope. `AGENTS.md` lists Notion as deferred work, and broad linked-doc ingestion remains outside the MVP trust boundary until explicitly approved.
Follow-up Risk: Do not implement without an explicit user scope change and a document-ingestion boundary plan that avoids broad company crawling.
Next Recommended Task: Complete production runtime credential setup and production manual testing, or explicitly approve a post-MVP expansion plan.
Validation Result: Blocked before validation; post-MVP scope has not been approved.

### RFB-093 — Add advanced agency workspace features

Status: [!]
Milestone: Phase 14 — Post-MVP Deferred Expansion
Priority: P3
Area: Product
Depends on: Post-MVP validation
Goal: Support agency/product-studio workflows.
Acceptance Criteria: Only implemented after MVP usage validates agency demand.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, apps/web/src/repo-readiness, packages/shared, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, apps/web/src/billing, packages/db, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Deferred and blocked for MVP scope. This expansion depends on post-MVP usage validation and should not be built before the core GitHub readiness, Cortex Task, setup PR, and optional runner loop is fully reviewed in production.
Follow-up Risk: Do not implement without an explicit user scope change and validated agency/product-studio demand.
Next Recommended Task: Complete production runtime credential setup and production manual testing, or explicitly approve a post-MVP expansion plan.
Validation Result: Blocked before validation; post-MVP scope has not been approved.

### RFB-094 — Add full Stripe billing

Status: [!]
Milestone: Phase 14 — Post-MVP Deferred Expansion
Priority: P3
Area: Billing
Depends on: Usage validation
Goal: Implement subscription billing once scan/task/run usage is validated.
Acceptance Criteria: Plans map to scan/task/setup PR/runner limits.; Usage overages are supported or explicitly blocked.; Managed execution is not unlimited.
Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.
Files Likely Touched: BACKLOG.md, README.md, AGENTS.md, MVP_PLAN.md, ARCHITECTURE.md, PRODUCT_SPEC.md, packages/shared, packages/db, apps/web/src/db, packages/github, apps/web/src/server, apps/web/src/app/api, apps/web/src/repo-readiness, apps/web/src/ai, apps/web/src/tasks, apps/web/src/app, apps/web/src/components, apps/runner, scripts/codex-runner, packages/logging, packages/policies, apps/web/src/security, apps/web/src/billing, apps/web, packages
Security/Trust Notes: Preserve the local-runner trust boundary; do not expose raw source, diffs, patches, snippets, secrets, .env contents, or unredacted command output to hosted surfaces.
Completion Notes: Deferred and blocked for MVP scope. `AGENTS.md` lists full Stripe billing as deferred work; the MVP currently ships only usage/cost boundaries and read-only plan placeholders.
Follow-up Risk: Do not implement subscription billing without explicit user approval, usage validation, and a billing launch plan.
Next Recommended Task: Complete production runtime credential setup and production manual testing, or explicitly approve a post-MVP expansion plan.
Validation Result: Blocked before validation; post-MVP scope has not been approved.
