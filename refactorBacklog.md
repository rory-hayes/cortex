# refactorBacklog.md

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

## RFB-001 — Create refactor branch and freeze runner-first backlog changes

**Priority:** P0  
**Area:** Project management  
**Depends on:** None

### Description

Create a dedicated branch for the repo-readiness front door refactor. Do not continue expanding runner-only features while this refactor is underway, except for critical fixes and already-started tasks that unblock the new architecture.

### Acceptance Criteria

- A branch exists for the refactor.
- Existing runner-first work is not deleted.
- Current `BACKLOG.md`, `SPRINT.md`, and `README.md` are preserved.
- This `refactorBacklog.md` is committed to the repository.
- Project docs state that the runner is now a gated execution layer, not the onboarding front door.

---

## RFB-002 — Update product language across docs

**Priority:** P0  
**Area:** Product/docs  
**Depends on:** RFB-001

### Description

Update the product language from “AI Engineering Control Plane” as the primary user-facing message to “repo readiness and AI execution queue”. The control-plane language can remain in architecture docs, but the product front door should be clearer.

### Acceptance Criteria

- `README.md` describes Cortex as: “Cortex scans your repo, creates AI-ready engineering tasks, and safely turns approved work into validated PRs.”
- `PRODUCT_SPEC.md` is updated with the new front-door flow.
- Runner is described as optional/gated.
- No docs imply that runner installation is required before getting value.

---

## RFB-003 — Reclassify existing open tasks under the new roadmap

**Priority:** P0  
**Area:** Planning  
**Depends on:** RFB-001

### Description

Reclassify the current open tasks into one of four groups: keep-now, reframe, defer, or close. Existing Linear intake tasks should be reframed as external task import rather than the primary onboarding flow.

### Acceptance Criteria

- `TASK-161`, `TASK-162`, and `TASK-163` are marked as “External task import / Linear intake”, not “primary onboarding”.
- `TASK-181` to `TASK-187` remain in final validation/release readiness.
- Blocked tasks `TASK-169`, `TASK-174`, and `TASK-178` have clear resolution notes.
- Deferred tasks remain deferred unless directly required by repo-readiness onboarding.

---

## RFB-004 — Add refactor principles to `AGENTS.md`

**Priority:** P0  
**Area:** Engineering process  
**Depends on:** RFB-001

### Description

Update `AGENTS.md` so Codex/runner work follows the new direction. The repo should now prioritize repo-readiness onboarding, findings, Cortex Tasks, setup PRs, and gated runner execution.

### Acceptance Criteria

- `AGENTS.md` instructs Codex not to rebuild or remove the runner.
- `AGENTS.md` says new work should preserve source-boundary safety.
- `AGENTS.md` states runner installation must not be required for initial repo scan value.
- `AGENTS.md` says any new task must update `README.md`, `SPRINT.md`, and relevant tests.

---

# Phase 1 — Shared Contracts for Repo Readiness

## RFB-005 — Add `Finding` shared contract

**Priority:** P0  
**Area:** Shared contracts  
**Depends on:** RFB-004

### Description

Add a strict shared contract for scan findings.

### Fields

- `contractVersion`
- `findingId`
- `workspaceId`
- `repoId`
- `scanId`
- `category`
- `severity`
- `title`
- `summary`
- `evidence`
- `recommendation`
- `source`
- `deterministicRuleId`
- `confidence`
- `status`
- `createdAt`
- `updatedAt`

### Categories

- `product_clarity`
- `agent_readiness`
- `architecture`
- `backlog_quality`
- `validation`
- `ci_cd`
- `security`
- `repo_hygiene`
- `execution_risk`
- `integration`

### Severities

- `info`
- `low`
- `medium`
- `high`
- `blocked`

### Acceptance Criteria

- Zod schema exists in `packages/shared`.
- Type export exists.
- Valid and invalid fixtures exist.
- Unsafe metadata keys are rejected recursively.
- No raw source, diff, patch, snippet, code, file content, secret, or unredacted log fields are allowed.
- Contract compatibility tests pass.

---

## RFB-006 — Add `RepoReadinessReport` shared contract

**Priority:** P0  
**Area:** Shared contracts  
**Depends on:** RFB-005

### Description

Add a contract representing a repo readiness report generated from a scan.

### Fields

- `contractVersion`
- `reportId`
- `workspaceId`
- `repoId`
- `scanId`
- `overallScore`
- `categoryScores`
- `summary`
- `strengths`
- `weaknesses`
- `blockedReasons`
- `recommendedNextActions`
- `findingIds`
- `taskRecommendationIds`
- `executionReadiness`
- `generatedAt`

### Acceptance Criteria

- Zod schema exists.
- Score ranges are validated.
- Category score names match finding categories.
- Unsafe payload keys are rejected.
- Fixtures and compatibility tests exist.

---

## RFB-007 — Add `CortexTask` shared contract

**Priority:** P0  
**Area:** Shared contracts  
**Depends on:** RFB-006

### Description

Add a strict contract for Cortex’s internal AI execution queue item.

### Fields

- `contractVersion`
- `taskId`
- `workspaceId`
- `repoId`
- `sourceType`
- `sourceIds`
- `title`
- `objective`
- `acceptanceCriteria`
- `riskLevel`
- `readinessStatus`
- `approvalStatus`
- `executionMode`
- `suggestedValidationCommands`
- `protectedAreaHints`
- `externalLinks`
- `linkedRunIds`
- `linkedPullRequestIds`
- `createdAt`
- `updatedAt`

### Source Types

- `repo_scan`
- `manual`
- `linear`
- `github_issue`
- `jira`
- `setup_pr`

### Execution Modes

- `planning_only`
- `setup_pr`
- `local_runner`
- `self_hosted_runner`
- `external_sync_only`

### Acceptance Criteria

- Contract exists in `packages/shared`.
- Contract forbids raw source/diff/log/snippet fields.
- Fixtures exist.
- Public package exports are tested.

---

## RFB-008 — Add `RepoScan` shared contract

**Priority:** P0  
**Area:** Shared contracts  
**Depends on:** RFB-007

### Description

Add a contract representing a repo scan run. This is different from a code execution run.

### Fields

- `scanId`
- `workspaceId`
- `repoId`
- `trigger`
- `status`
- `startedAt`
- `completedAt`
- `inventorySummary`
- `moduleStatuses`
- `findingCounts`
- `reportId`
- `errorSummary`

### Acceptance Criteria

- Supports statuses: `queued`, `running`, `completed`, `failed`, `cancelled`.
- Stores metadata-only inventory summaries.
- Does not store raw file contents.
- Fixtures and compatibility tests exist.

---

## RFB-009 — Add `TaskRecommendation` shared contract

**Priority:** P1  
**Area:** Shared contracts  
**Depends on:** RFB-007

### Description

Add a contract for recommended tasks generated before they are accepted into the Cortex Task queue.

### Acceptance Criteria

- Recommendations can be approved, ignored, deferred, or converted into Cortex Tasks.
- Each recommendation links to one or more findings.
- Each recommendation has risk, effort, execution-mode suggestion, and acceptance criteria.
- Unsafe metadata keys are rejected.

---

## RFB-010 — Add shared contract test coverage for all new objects

**Priority:** P0  
**Area:** Testing  
**Depends on:** RFB-005, RFB-006, RFB-007, RFB-008, RFB-009

### Description

Extend the shared contract fixture and compatibility harness to cover all new repo-readiness objects.

### Acceptance Criteria

- Valid fixtures parse through public package entrypoints.
- Invalid fixtures fail at expected issue paths.
- Fixture hygiene checks reject source-like content.
- Root typecheck, lint, test, and format check pass.

---

# Phase 2 — Database Schema and Persistence

## RFB-011 — Add database tables for repo scans

**Priority:** P0  
**Area:** Database  
**Depends on:** RFB-008

### Description

Create Drizzle schema and migrations for repo scan runs.

### Tables

- `repo_scans`
- `repo_scan_modules`

### Acceptance Criteria

- Stores scan metadata, status, timestamps, repo/workspace linkage, summary only.
- No raw source contents are persisted.
- Migration exists and passes local validation.
- Server-side query helpers exist.

---

## RFB-012 — Add database tables for findings

**Priority:** P0  
**Area:** Database  
**Depends on:** RFB-005, RFB-011

### Description

Create persistence for findings generated by repo scans.

### Acceptance Criteria

- `findings` table exists.
- Supports severity, category, status, summary, evidence, recommendation.
- Supports linking to scan, repo, workspace, and tasks.
- Supports deduplication key per finding type/repo/path/category.
- Does not store raw source or raw file contents.

---

## RFB-013 — Add database tables for readiness reports

**Priority:** P0  
**Area:** Database  
**Depends on:** RFB-006, RFB-012

### Description

Create persistence for repo readiness reports.

### Acceptance Criteria

- `repo_readiness_reports` table exists.
- Stores overall score and category scores.
- Links to latest scan and findings.
- Supports report history per repo.
- Query helper returns latest report for dashboard/onboarding.

---

## RFB-014 — Add database tables for Cortex Tasks

**Priority:** P0  
**Area:** Database  
**Depends on:** RFB-007, RFB-012

### Description

Create the internal Cortex Task queue model.

### Acceptance Criteria

- `cortex_tasks` table exists.
- Links to workspace, repo, findings, task packet, runs, and PR artifacts.
- Supports status transitions: `draft`, `needs_review`, `approved`, `queued`, `running`, `blocked`, `pr_opened`, `completed`, `rejected`, `deferred`.
- Supports execution mode.
- Supports external task links.
- Does not require Linear/Jira to exist.

---

## RFB-015 — Add join tables for finding-task relationships

**Priority:** P1  
**Area:** Database  
**Depends on:** RFB-012, RFB-014

### Description

Allow one task to address multiple findings and one finding to generate multiple possible task recommendations.

### Acceptance Criteria

- `finding_task_links` table exists.
- Links are workspace-scoped.
- Query helpers can fetch tasks for finding and findings for task.

---

## RFB-016 — Add task recommendation persistence

**Priority:** P1  
**Area:** Database  
**Depends on:** RFB-009, RFB-014

### Description

Persist pre-task recommendations before user approval.

### Acceptance Criteria

- Recommendations can be listed, approved, dismissed, or deferred.
- Approved recommendations create Cortex Tasks.
- No duplicate task creation on repeated approval.

---

# Phase 3 — GitHub Repo Scan Foundation

## RFB-017 — Add GitHub App repository scan permissions review

**Priority:** P0  
**Area:** GitHub/security  
**Depends on:** RFB-003

### Description

Review the GitHub integration permissions needed for web-first repo scan and setup PR generation.

### Required Capabilities

- List installed repositories.
- Read repository metadata.
- Read file tree and selected file contents.
- Read workflows/checks metadata.
- Create branch for setup PRs.
- Create/update files on setup branches.
- Open draft PRs.
- Read PR metadata.

### Acceptance Criteria

- Permission list is documented.
- Least-privilege approach is recorded.
- Scan-only mode can be supported separately from setup-PR mode.
- No runner installation is required for scan-only mode.

---

## RFB-018 — Add GitHub repo inventory service

**Priority:** P0  
**Area:** GitHub/backend  
**Depends on:** RFB-017

### Description

Create a backend service that builds a metadata-only inventory of a selected GitHub repository.

### Inventory Data

- Repository name, owner, default branch.
- File tree summary.
- Detected languages.
- Key files present/missing.
- Package manager indicators.
- CI workflow files present/missing.
- Test directory indicators.
- Documentation files present/missing.
- Policy/config files present/missing.

### Acceptance Criteria

- Does not store full raw source contents.
- Enforces file size limits.
- Supports allowlisted file reads for config/docs only.
- Produces structured inventory output.
- Includes unit tests with mocked GitHub responses.

---

## RFB-019 — Add safe file read allowlist for scan inputs

**Priority:** P0  
**Area:** Security/backend  
**Depends on:** RFB-018

### Description

Define which repo files Cortex may read in web scan mode.

### Initial Allowlist

- `README.md`
- `AGENTS.md`
- `PRODUCT_SPEC.md`
- `ARCHITECTURE.md`
- `BACKLOG.md`
- `SPRINT.md`
- `ROADMAP.md`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `.github/workflows/*.yml`
- `.github/workflows/*.yaml`
- `.env.example`
- `.env.template`
- `.aicp/policy.json`
- `.cortex/policy.json`

### Acceptance Criteria

- Real `.env`, `.env.local`, `.env.production`, private keys, and secrets are never read.
- File size cap is enforced.
- Unsupported binary files are skipped.
- Read failures are summarized safely.

---

## RFB-020 — Add repo scan module runner

**Priority:** P0  
**Area:** Backend  
**Depends on:** RFB-018, RFB-019

### Description

Create a service that runs scan modules in a deterministic order and persists scan module statuses.

### Acceptance Criteria

- Modules can pass, warn, block, fail, or skip.
- Failures do not break the entire scan unless required modules fail.
- Scan progress can be displayed in UI.
- Outputs are metadata-only.

---

## RFB-021 — Add scan trigger API

**Priority:** P0  
**Area:** API/backend  
**Depends on:** RFB-020

### Description

Add an authenticated API/server action to trigger a repo readiness scan.

### Acceptance Criteria

- User must have workspace access.
- Repo must be registered or selected.
- Scan job is queued.
- Duplicate scans are debounced.
- Response returns scan ID.
- No raw source is returned.

---

## RFB-022 — Add scan status API

**Priority:** P0  
**Area:** API/backend  
**Depends on:** RFB-021

### Description

Add an API/server action to fetch scan progress and latest report/finding status.

### Acceptance Criteria

- UI can poll or subscribe to scan progress.
- Returns module statuses.
- Returns latest safe summary.
- Does not expose raw file contents.

---

# Phase 4 — Deterministic Readiness Rules

## RFB-023 — Add product clarity scan module

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-020

### Description

Detect whether the repo has enough product clarity for AI-assisted engineering.

### Checks

- `README.md` exists.
- Product description exists or can be inferred.
- `PRODUCT_SPEC.md` exists.
- User flows or feature descriptions exist.
- Missing goal context is flagged.

### Acceptance Criteria

- Generates findings for missing/weak product docs.
- Does not invent product facts.
- Uses user-provided goal context when available.

---

## RFB-024 — Add agent-readiness scan module

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-020

### Description

Detect whether a repo has instructions for AI/coding agents.

### Checks

- `AGENTS.md` exists.
- Agent instructions mention task discipline.
- Agent instructions mention validation.
- Agent instructions mention protected paths/secrets.
- Agent instructions mention updating docs/backlog.

### Acceptance Criteria

- Generates findings for missing/incomplete `AGENTS.md`.
- Creates recommendation to generate/improve `AGENTS.md`.

---

## RFB-025 — Add architecture scan module

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-020

### Description

Detect whether the repo has architecture-level context.

### Checks

- `ARCHITECTURE.md` exists.
- Data model docs exist.
- Route/service boundaries are documented.
- Deployment/runtime assumptions are documented.

### Acceptance Criteria

- Generates findings for missing architecture docs.
- Recommends architecture doc creation task.

---

## RFB-026 — Add backlog-quality scan module

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-020

### Description

Detect whether the repo has an AI-executable backlog.

### Checks

- `BACKLOG.md` exists.
- `SPRINT.md` exists.
- Tasks have IDs.
- Tasks have descriptions.
- Tasks have acceptance criteria.
- Tasks have likely touched files where applicable.
- Tasks are ordered.
- Tasks are not too vague for AI execution.

### Acceptance Criteria

- Generates findings for missing/weak backlog structure.
- Can recommend setup tasks to create/improve backlog.

---

## RFB-027 — Add validation posture scan module

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-020

### Description

Detect whether the repo has clear validation commands.

### Checks

- `package.json` scripts: build/typecheck/lint/test/format.
- Workspace-level scripts.
- CI workflow presence.
- Test framework indicators.
- Missing test command.
- Missing typecheck/lint/build command.

### Acceptance Criteria

- Generates findings for missing validation.
- Suggests validation command map.
- Does not execute commands in web scan mode.

---

## RFB-028 — Add CI/CD posture scan module

**Priority:** P1  
**Area:** Repo scan  
**Depends on:** RFB-027

### Description

Detect whether GitHub Actions or other CI workflows exist and whether they align with detected validation commands.

### Acceptance Criteria

- Detects `.github/workflows` files.
- Flags missing CI for repos with validation commands.
- Flags CI workflows that do not run tests/build/typecheck where applicable.
- Does not parse or expose secrets.

---

## RFB-029 — Add security and protected-path scan module

**Priority:** P0  
**Area:** Repo scan/security  
**Depends on:** RFB-020

### Description

Detect sensitive areas that should be protected before AI execution.

### Checks

- Auth files/directories.
- Billing/payment files/directories.
- Database migrations.
- Infrastructure/deployment config.
- `.env` and secret-like files.
- Missing `.aicp/policy.json` or `.cortex/policy.json`.

### Acceptance Criteria

- Generates findings for missing policy coverage.
- Does not read secrets.
- Recommends protected path rules.
- Reuses existing policy package where appropriate.

---

## RFB-030 — Add repo hygiene scan module

**Priority:** P1  
**Area:** Repo scan  
**Depends on:** RFB-020

### Description

Detect structural hygiene issues that reduce safe AI execution quality.

### Checks

- Lockfile/package-manager consistency.
- Missing `.gitignore` basics.
- Unclear monorepo structure.
- Missing contribution/development notes.
- Missing issue templates.

### Acceptance Criteria

- Generates low/medium findings.
- Does not block execution unless critical.

---

## RFB-031 — Add execution-readiness classifier

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-023, RFB-024, RFB-025, RFB-026, RFB-027, RFB-029

### Description

Classify the repo’s current readiness for AI execution.

### States

- `not_ready`
- `setup_required`
- `planning_ready`
- `setup_pr_ready`
- `local_runner_ready`
- `blocked`

### Acceptance Criteria

- Classification is deterministic from findings/rules.
- Local runner is not presented as ready if policy or validation is missing.
- Setup PR path is available even if local runner is not ready.

---

## RFB-032 — Add readiness score calculation

**Priority:** P0  
**Area:** Repo scan  
**Depends on:** RFB-031

### Description

Calculate overall and category readiness scores.

### Acceptance Criteria

- Score is explainable.
- Blocked findings reduce score heavily.
- Missing setup docs reduce agent-readiness and product-clarity scores.
- Scores can be recalculated when findings are resolved.

---

# Phase 5 — LLM-Assisted Report and Task Generation

## RFB-033 — Add scan summarization prompt contract

**Priority:** P0  
**Area:** AI/backend  
**Depends on:** RFB-031, RFB-032

### Description

Create a safe LLM prompt/input schema for summarizing deterministic scan output into a human-readable readiness report.

### Acceptance Criteria

- LLM input contains only scan metadata, safe doc summaries, and finding summaries.
- No raw source files are included.
- Prompt asks for concise, evidence-backed summaries.
- Output is parsed/validated against `RepoReadinessReport` contract.

---

## RFB-034 — Add safe document summarizer for allowlisted docs

**Priority:** P1  
**Area:** AI/backend  
**Depends on:** RFB-019

### Description

For allowlisted docs only, summarize content into bounded metadata useful for readiness analysis.

### Acceptance Criteria

- Only allowlisted docs are summarized.
- Summaries are capped and redacted.
- Real `.env` or source files are never summarized.
- Summary errors are safe.

---

## RFB-035 — Add readiness report generator service

**Priority:** P0  
**Area:** AI/backend  
**Depends on:** RFB-033

### Description

Generate and persist the readiness report after deterministic scan modules complete.

### Acceptance Criteria

- Report is generated from scan output.
- Report validates against shared schema.
- Report is persisted.
- LLM failure falls back to deterministic report.
- Unit tests cover fallback path.

---

## RFB-036 — Add task recommendation generator

**Priority:** P0  
**Area:** AI/backend  
**Depends on:** RFB-009, RFB-035

### Description

Generate task recommendations from findings.

### Acceptance Criteria

- Each recommendation links to finding IDs.
- Recommendations have title, objective, acceptance criteria, risk, suggested execution mode, and suggested validation.
- Recommendations are not automatically approved.
- Recommendations validate against shared schema.
- Unsafe payload keys are rejected.

---

## RFB-037 — Add deterministic task templates for common findings

**Priority:** P0  
**Area:** Backend  
**Depends on:** RFB-036

### Description

Create deterministic task templates for common findings so Cortex does not rely only on LLM generation.

### Templates

- Create `AGENTS.md`.
- Create `PRODUCT_SPEC.md`.
- Create `ARCHITECTURE.md`.
- Create `BACKLOG.md`.
- Create `SPRINT.md`.
- Create `.cortex/policy.json`.
- Add validation command map.
- Add GitHub issue templates.
- Add CI workflow suggestion.

### Acceptance Criteria

- Templates can produce Cortex Task recommendations.
- Templates include acceptance criteria.
- Templates include execution mode suggestions.
- LLM can refine but not bypass safety fields.

---

## RFB-038 — Add approval flow from recommendation to Cortex Task

**Priority:** P0  
**Area:** Backend/API  
**Depends on:** RFB-014, RFB-016, RFB-036

### Description

Allow users to approve task recommendations into Cortex Tasks.

### Acceptance Criteria

- User can approve one or many recommendations.
- Approval creates Cortex Tasks.
- Duplicate approvals are prevented.
- User can edit title/objective/acceptance criteria before approval.
- Audit event is recorded.

---

# Phase 6 — Onboarding UI Refactor

## RFB-039 — Replace first dashboard state with repo readiness onboarding

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-021

### Description

When a workspace has no scanned repos, the primary UI should guide the user through GitHub connection and repo scan, not runner setup.

### Acceptance Criteria

- Empty dashboard shows “Connect GitHub repo” CTA.
- No runner install CTA appears before a scan.
- User can select repository.
- User can start scan.
- Copy clearly says runner is optional later.

---

## RFB-040 — Add repo selection screen

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-017, RFB-018

### Description

Build UI for selecting a GitHub repository for scan.

### Acceptance Criteria

- Lists installed repos.
- Shows scan permission status.
- Supports scan-only access copy.
- Handles no GitHub connection state.
- Handles no repo access state.

---

## RFB-041 — Add product goal intake screen

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-040

### Description

Before scanning, capture the user’s intended product/repo goal.

### Fields

- Repo/product description.
- Stage: prototype, MVP, production.
- User’s goal: cleanup, build backlog, prepare for AI execution, improve tests, other.
- Preferred execution style: planning only, setup PRs, local runner later.

### Acceptance Criteria

- Goal context is saved.
- Goal context is used in scan/report generation.
- User can skip with reduced scan quality warning.

---

## RFB-042 — Add scan progress screen

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-022

### Description

Show credible scan progress through modules.

### Acceptance Criteria

- Shows modules: Product Clarity, Agent Readiness, Architecture, Backlog, Validation, Security, Repo Hygiene.
- Shows pass/warn/fail/running/skipped states.
- Handles scan failure with safe error summary.
- No raw file content is rendered.

---

## RFB-043 — Add readiness report page

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-035

### Description

Create a report page showing score, category scores, strengths, weaknesses, blockers, and next actions.

### Acceptance Criteria

- Shows overall score.
- Shows category score cards.
- Shows top blockers.
- Shows recommended next actions.
- Links to findings and task recommendations.
- Copy explains how to improve score.

---

## RFB-044 — Add findings list page

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-012

### Description

Create a filterable findings page.

### Acceptance Criteria

- Filters by severity, category, status, repo, scan.
- Each finding shows evidence and recommendation.
- User can convert finding to task recommendation/task.
- User can dismiss or defer findings.
- Dismissals are audited.

---

## RFB-045 — Add task recommendations UI

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-016, RFB-036

### Description

Create UI where users review recommended tasks before approving them into the Cortex Task queue.

### Acceptance Criteria

- Shows recommended tasks grouped by risk/category.
- User can edit fields before approval.
- User can approve selected or all low-risk setup tasks.
- User can defer/dismiss recommendations.
- No task automatically enters runner queue.

---

## RFB-046 — Add Cortex Tasks queue page

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-014, RFB-038

### Description

Create the internal execution-readiness queue.

### Acceptance Criteria

- Shows Cortex Tasks independent of Linear/Jira.
- Filters by status, repo, risk, execution mode, approval status.
- Shows linked findings, suggested validation, risk, and external links.
- Supports approve, reject, defer, sync, and execute actions.
- Runner execution is gated.

---

## RFB-047 — Reorder app navigation

**Priority:** P1  
**Area:** Web/UI  
**Depends on:** RFB-043, RFB-044, RFB-046

### Description

Refactor nav hierarchy to prioritize repo readiness and tasks.

### New Nav

- Overview
- Repo Readiness
- Findings
- Tasks
- Pull Requests
- Runs
- Runners
- Integrations
- Settings

### Acceptance Criteria

- Runners are no longer above readiness/tasks.
- Empty states guide toward repo scan.
- Existing operational pages remain accessible.

---

## RFB-048 — Add “What can safely move forward today?” dashboard

**Priority:** P1  
**Area:** Web/UI  
**Depends on:** RFB-043, RFB-046

### Description

Refactor the dashboard around actionability.

### Cards

- Latest readiness score.
- New findings.
- AI-ready tasks.
- Setup PRs awaiting review.
- Runner tasks waiting approval.
- Failed/blocked runs.
- Weekly recommendation.

### Acceptance Criteria

- Dashboard is useful before runner install.
- Dashboard is useful after runner install.
- Dashboard does not expose raw source/diffs/logs.

---

# Phase 7 — Setup PR Generation

## RFB-049 — Define setup PR file templates

**Priority:** P0  
**Area:** Backend/templates  
**Depends on:** RFB-037

### Description

Define templates for files Cortex can safely create/update in setup PR mode.

### Files

- `AGENTS.md`
- `PRODUCT_SPEC.md`
- `ARCHITECTURE.md`
- `BACKLOG.md`
- `SPRINT.md`
- `.cortex/policy.json`
- `.github/ISSUE_TEMPLATE/ai-ready-task.md`
- optional validation map file

### Acceptance Criteria

- Templates are deterministic and reviewable.
- User can preview before PR creation.
- Templates do not include secrets or copied source.
- Files are clearly marked as generated/review-required where appropriate.

---

## RFB-050 — Add setup PR preview service

**Priority:** P0  
**Area:** Backend  
**Depends on:** RFB-049

### Description

Generate a preview of setup PR changes from approved tasks.

### Acceptance Criteria

- Preview shows filenames and high-level summary.
- Preview does not expose raw private source contents.
- User can remove files/tasks before creation.
- Preview is persisted as metadata.

---

## RFB-051 — Add setup PR creation through GitHub App

**Priority:** P0  
**Area:** GitHub/backend  
**Depends on:** RFB-050

### Description

Allow Cortex to create a branch and draft PR for approved setup artifacts.

### Acceptance Criteria

- Creates branch with safe deterministic name.
- Writes only approved setup files.
- Opens draft PR.
- PR body includes findings addressed and review checklist.
- PR metadata is stored in Cortex.
- No code execution occurs.

---

## RFB-052 — Add setup PR evidence summary

**Priority:** P1  
**Area:** Backend/UI  
**Depends on:** RFB-051

### Description

Generate evidence summary for setup PRs.

### Acceptance Criteria

- Maps PR files to findings/tasks.
- Shows why each file was generated.
- Shows what user should review.
- Avoids raw source exposure beyond generated setup content.

---

## RFB-053 — Add setup PR UI flow

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-050, RFB-051

### Description

Build UI for previewing and creating setup PRs.

### Acceptance Criteria

- User can create setup PR from approved tasks.
- User can view PR link/status.
- User can see which findings/tasks are addressed.
- User can create more than one setup PR if needed.

---

## RFB-054 — Add setup PR merge detection and finding resolution

**Priority:** P1  
**Area:** GitHub/backend  
**Depends on:** RFB-051

### Description

When a setup PR is merged, detect it and mark relevant findings/tasks as resolved or ready for rescan.

### Acceptance Criteria

- GitHub webhook or polling detects PR merged.
- Linked tasks update status.
- Linked findings move to `pending_rescan` or `resolved`.
- New scan can confirm resolution.

---

# Phase 8 — Cortex Tasks and External Sync

## RFB-055 — Reframe Linear intake as external task import

**Priority:** P0  
**Area:** Product/backend  
**Depends on:** Existing TASK-161/TASK-162/TASK-163

### Description

Keep Linear intake work, but position it as importing external work into Cortex Tasks, not as the main front door.

### Acceptance Criteria

- Linear issue candidates become Cortex Task drafts or task packet candidates.
- User approval is required.
- Linear issues do not auto-run.
- UI copy says “Import from Linear”, not “Start here”.

---

## RFB-056 — Add GitHub Issues sync for Cortex Tasks

**Priority:** P1  
**Area:** GitHub/integrations  
**Depends on:** RFB-014

### Description

Allow approved Cortex Tasks to be pushed to GitHub Issues when users prefer GitHub-native tracking.

### Acceptance Criteria

- User can push selected tasks to GitHub Issues.
- Created issue links back to Cortex Task.
- Issue body includes task objective, acceptance criteria, risk, suggested validation, and Cortex link.
- Duplicate pushes are prevented.

---

## RFB-057 — Add Linear task sync from Cortex Tasks

**Priority:** P1  
**Area:** Linear/integrations  
**Depends on:** RFB-055

### Description

Allow approved Cortex Tasks generated from scans to be pushed to Linear.

### Acceptance Criteria

- User can choose Linear team/project/status.
- Cortex Task links to Linear issue.
- Linear issue body includes safe task details.
- Status sync is bounded and metadata-only.

---

## RFB-058 — Add external link model for tasks

**Priority:** P1  
**Area:** Database/shared  
**Depends on:** RFB-014

### Description

Create a robust model for linking Cortex Tasks to external systems.

### Acceptance Criteria

- Supports GitHub Issue, Linear Issue, Jira Issue, PR, and docs links.
- Does not require external sync for task to exist.
- Stores provider, external ID, URL, title, status, and sync timestamp.

---

## RFB-059 — Add task status transition rules

**Priority:** P0  
**Area:** Backend  
**Depends on:** RFB-014

### Description

Define legal status transitions for Cortex Tasks.

### Acceptance Criteria

- Invalid transitions are rejected.
- User actions are audited.
- Runner actions can only transition execution-related states.
- External sync cannot bypass user approval.

---

## RFB-060 — Add task packet builder from Cortex Task

**Priority:** P0  
**Area:** Backend/runner bridge  
**Depends on:** RFB-014, existing task packet system

### Description

Build task packets from approved Cortex Tasks for runner execution.

### Acceptance Criteria

- Uses Cortex Task objective, acceptance criteria, repo policy, validation commands, and risk metadata.
- Requires approved status.
- Blocks high-risk tasks unless required approval exists.
- Produces existing `TaskPacket` contract.
- Does not embed raw source.

---

# Phase 9 — Runner Gate and Execution Flow Refactor

## RFB-061 — Add runner gate UI

**Priority:** P0  
**Area:** Web/UI  
**Depends on:** RFB-046, RFB-060

### Description

Introduce runner installation only after the user has approved tasks or needs local execution.

### Acceptance Criteria

- Runner gate explains why local execution is optional.
- Shows execution modes: planning only, setup PR, local runner.
- User can continue without runner.
- Runner setup CTA appears only for tasks requiring local execution.

---

## RFB-062 — Add execution mode selector per Cortex Task

**Priority:** P0  
**Area:** Web/UI/backend  
**Depends on:** RFB-046

### Description

Allow each task to specify how it should be handled.

### Modes

- Planning only.
- Setup PR.
- Local runner.
- External sync only.

### Acceptance Criteria

- Mode is editable before approval.
- Invalid modes are blocked based on task risk/status.
- Local runner mode requires runner availability.

---

## RFB-063 — Connect approved Cortex Tasks to existing runner queue

**Priority:** P0  
**Area:** Runner/backend  
**Depends on:** RFB-060, RFB-061

### Description

Approved Cortex Tasks should be claimable/executable by the local runner through the existing web-to-runner protocol.

### Acceptance Criteria

- Runner polls/claims Cortex Task-derived jobs.
- Task packet is passed through existing protocol.
- Run events link back to Cortex Task.
- Validation and PR artifacts link to Cortex Task.
- Cancellation/repair still work.

---

## RFB-064 — Add runner eligibility checks for tasks

**Priority:** P0  
**Area:** Runner/backend  
**Depends on:** RFB-063

### Description

Before offering runner execution, check whether a task is eligible.

### Checks

- Repo mapping exists.
- Runner online.
- Policy exists.
- Validation commands exist.
- Task approved.
- Risk threshold allowed.
- No conflicting active run.

### Acceptance Criteria

- Ineligible tasks show clear reasons.
- User can fix setup gaps before execution.
- No ineligible task reaches runner queue.

---

## RFB-065 — Update run detail pages to show Cortex Task context

**Priority:** P1  
**Area:** Web/UI  
**Depends on:** RFB-063

### Description

Run pages should show the originating Cortex Task, findings, acceptance criteria, risk, validation, and PR evidence.

### Acceptance Criteria

- Existing run pages preserve timeline/evidence.
- New task context appears above technical event details.
- No raw source/diffs/logs exposed.

---

## RFB-066 — Add repair request flow from Cortex Task view

**Priority:** P1  
**Area:** Web/UI/backend  
**Depends on:** RFB-065

### Description

Allow user to request repair from the Cortex Task page when a PR/run needs adjustment.

### Acceptance Criteria

- Repair request links to task, run, PR, and prior validation evidence.
- Repair packet remains metadata-only.
- Attempt limits are respected.
- Existing runner repair flow is reused.

---

# Phase 10 — Recurring Scans and Weekly Reviews

## RFB-067 — Add GitHub webhook handling for repo changes

**Priority:** P1  
**Area:** GitHub/backend  
**Depends on:** RFB-018

### Description

Handle GitHub events for pushes, PR merges, and setup PR status changes.

### Acceptance Criteria

- Webhooks are authenticated and verified.
- Events are workspace/repo scoped.
- PR merge can trigger rescan.
- Noise is debounced.

---

## RFB-068 — Add recurring scan scheduler

**Priority:** P1  
**Area:** Backend  
**Depends on:** RFB-067

### Description

Schedule recurring repo scans for active workspaces.

### Acceptance Criteria

- Supports weekly scan cadence.
- Supports manual rescan.
- Avoids duplicate scans.
- Respects plan limits.

---

## RFB-069 — Add finding lifecycle and drift detection

**Priority:** P1  
**Area:** Backend  
**Depends on:** RFB-068

### Description

Track whether findings are new, recurring, resolved, worsened, or stale.

### Acceptance Criteria

- Finding dedupe keys are used.
- Resolved findings can be confirmed after rescan.
- New findings can generate task recommendations.
- Report shows changes since previous scan.

---

## RFB-070 — Add weekly review generator

**Priority:** P1  
**Area:** AI/backend  
**Depends on:** RFB-069

### Description

Generate a weekly engineering review summary.

### Output

- Readiness score trend.
- New findings.
- Resolved findings.
- AI-ready tasks.
- Tasks needing human clarification.
- PRs awaiting review.
- Failed/blocked runs.
- Recommended next actions.

### Acceptance Criteria

- Review is generated from safe metadata.
- User can view in app.
- Email/slack delivery can be deferred.

---

## RFB-071 — Add weekly review UI

**Priority:** P1  
**Area:** Web/UI  
**Depends on:** RFB-070

### Description

Add a weekly review page or dashboard section.

### Acceptance Criteria

- Shows latest review.
- Shows trend from previous review.
- Links to findings/tasks/PRs/runs.
- Provides “approve next recommended tasks” CTA.

---

# Phase 11 — Billing, Usage, and Cost Controls

## RFB-072 — Add usage event model for scans and AI generation

**Priority:** P1  
**Area:** Billing/backend  
**Depends on:** RFB-035, RFB-036

### Description

Track usage for scans, report generation, task generation, setup PR generation, and runner executions.

### Acceptance Criteria

- Usage events are workspace-scoped.
- Tracks model usage category without exposing prompts/source.
- Supports plan limits.
- Does not require full Stripe billing yet.

---

## RFB-073 — Add scan/task generation limits by plan

**Priority:** P1  
**Area:** Billing/backend  
**Depends on:** RFB-072

### Description

Add simple plan gates to prevent unbounded AI cost.

### Acceptance Criteria

- Free plan can run limited scans.
- Paid plans have higher caps.
- Over-limit states are clear.
- Admin override exists for testing.

---

## RFB-074 — Add managed execution cost boundary

**Priority:** P2  
**Area:** Billing/product  
**Depends on:** RFB-063

### Description

Define cost boundaries for any Cortex-key implementation execution. Default should remain customer-owned Codex/API execution.

### Acceptance Criteria

- Docs state task creation/scanning can use Cortex key.
- Docs state heavy implementation defaults to customer-owned execution.
- Any Cortex-managed implementation path requires credits/caps.
- No unlimited implementation path exists.

---

## RFB-075 — Add pricing/plan placeholder UI

**Priority:** P2  
**Area:** Web/UI  
**Depends on:** RFB-073

### Description

Add lightweight plan usage display before full billing.

### Acceptance Criteria

- Shows scans used/remaining.
- Shows task generations used/remaining.
- Shows setup PRs created.
- Does not require Stripe to ship internal MVP.

---

# Phase 12 — Security and Boundary Hardening

## RFB-076 — Resolve existing `TASK-174` protocol payload boundary tests

**Priority:** P0  
**Area:** Security/testing  
**Depends on:** Current blocked task review

### Description

Unblock and complete protocol payload boundary tests with a clear scope. Ensure new scan/report/task payloads also reject source-like data.

### Acceptance Criteria

- Boundary tests pass.
- Capability-value filtering scope is explicitly decided.
- New repo-readiness contracts are included in unsafe payload tests.

---

## RFB-077 — Resolve existing `TASK-178` token storage documentation/checks

**Priority:** P0  
**Area:** Security/docs  
**Depends on:** Manual review

### Description

Complete token storage docs/checks safely despite `SECURITY_MODEL.md` being protected.

### Acceptance Criteria

- Manual review completed.
- Security docs updated.
- Full validation passes.
- No sensitive token details are exposed.

---

## RFB-078 — Add scan boundary tests

**Priority:** P0  
**Area:** Security/testing  
**Depends on:** RFB-018, RFB-019

### Description

Prove web scan mode does not read or persist disallowed files.

### Acceptance Criteria

- Tests cover `.env`, `.env.local`, private keys, large files, binary files, and source files outside allowlist.
- Tests prove no raw source is persisted.
- Tests prove safe error summaries.

---

## RFB-079 — Add setup PR permission boundary tests

**Priority:** P0  
**Area:** Security/testing  
**Depends on:** RFB-051

### Description

Prove setup PR mode can only create/update approved setup files.

### Acceptance Criteria

- Blocks attempts to write code files by default.
- Blocks `.env` writes.
- Blocks protected paths unless explicitly allowed for safe generated files.
- PR body does not leak raw source.

---

## RFB-080 — Add findings/task redaction tests

**Priority:** P0  
**Area:** Security/testing  
**Depends on:** RFB-005, RFB-007

### Description

Ensure findings and Cortex Tasks cannot store or render unsafe data.

### Acceptance Criteria

- Unsafe keys rejected at schema level.
- UI does not render raw code/log/diff fields.
- Server actions strip unsafe metadata.
- Tests include hostile payloads.

---

## RFB-081 — Complete existing `TASK-181` security hardening milestone

**Priority:** P0  
**Area:** Security/testing  
**Depends on:** RFB-076, RFB-077, RFB-078, RFB-079, RFB-080

### Description

Complete the security hardening milestone with the new repo-readiness model included.

### Acceptance Criteria

- All security tests pass.
- Existing runner non-exfiltration checks still pass.
- New scan/setup task boundaries are verified.
- Security model is updated.

---

# Phase 13 — Final MVP Validation and Release Readiness

## RFB-082 — Add full repo-readiness onboarding E2E

**Priority:** P0  
**Area:** Testing/E2E  
**Depends on:** RFB-039 through RFB-046

### Description

Create an end-to-end test for the new onboarding flow.

### Flow

- Create workspace.
- Connect/select mock GitHub repo.
- Provide product goal.
- Run scan.
- Generate report.
- View findings.
- Approve task recommendations.
- Create Cortex Tasks.

### Acceptance Criteria

- Test passes headlessly.
- No runner required.
- No raw source displayed.

---

## RFB-083 — Add setup PR E2E

**Priority:** P0  
**Area:** Testing/E2E  
**Depends on:** RFB-051, RFB-053

### Description

Create an end-to-end test for setup PR generation.

### Acceptance Criteria

- Approved setup tasks produce PR preview.
- PR branch is created in mock/local GitHub test harness.
- PR artifact is stored.
- Findings/tasks link to PR.

---

## RFB-084 — Update existing `TASK-182` full local runner E2E to use Cortex Task source

**Priority:** P0  
**Area:** Testing/E2E  
**Depends on:** RFB-063

### Description

Update the local runner E2E so it can execute a task derived from a Cortex Task, not only a standalone task packet/backlog task.

### Acceptance Criteria

- Fixture Cortex Task converts to TaskPacket.
- Runner executes through existing mock/Codex flow.
- Validation, commit, push, and PR artifact behavior is verified.

---

## RFB-085 — Update existing `TASK-183` web-to-runner protocol E2E

**Priority:** P0  
**Area:** Testing/E2E  
**Depends on:** RFB-063

### Description

Prove coordinator-to-runner protocol loop works with Cortex Tasks.

### Acceptance Criteria

- Manual task still works.
- Cortex Task-derived job works.
- Claim/run/event/validation/artifact submissions link correctly.
- Cancellation/repair boundaries still pass.

---

## RFB-086 — Update existing `TASK-184` browser happy-path smoke test

**Priority:** P0  
**Area:** Testing/browser  
**Depends on:** RFB-039 through RFB-048

### Description

Browser smoke test should validate the new front door and key operational pages.

### Acceptance Criteria

- New onboarding path passes.
- Findings page renders.
- Cortex Tasks page renders.
- Setup PR page renders.
- Existing Runs/Runners/Approvals pages still render.
- Mobile layout does not overlap or hide primary CTAs.

---

## RFB-087 — Update existing `TASK-185` MVP acceptance checklist

**Priority:** P0  
**Area:** Release readiness  
**Depends on:** RFB-082, RFB-083, RFB-084, RFB-085, RFB-086

### Description

Update MVP acceptance checklist to reflect the new product direction.

### Acceptance Criteria

- Checklist includes repo scan onboarding.
- Checklist includes findings/task generation.
- Checklist includes setup PR creation.
- Checklist includes optional runner execution.
- Checklist includes security boundary checks.

---

## RFB-088 — Run existing `TASK-186` full MVP validation suite

**Priority:** P0  
**Area:** Release readiness  
**Depends on:** RFB-087

### Description

Run full validation suite after the refactor.

### Acceptance Criteria

- Root typecheck passes.
- Root lint passes.
- Root test passes.
- Format check passes.
- E2E tests pass.
- Security boundary tests pass.
- No known blockers remain for MVP release.

---

## RFB-089 — Prepare updated MVP release notes

**Priority:** P0  
**Area:** Release readiness/docs  
**Depends on:** RFB-088

### Description

Update release notes to describe the new Cortex MVP.

### Acceptance Criteria

- Release notes explain repo readiness onboarding.
- Release notes explain Cortex Tasks.
- Release notes explain setup PRs.
- Release notes explain optional runner execution.
- Release notes list what is intentionally deferred.
- Release notes list known risks/limitations.

---

# Phase 14 — Post-MVP Deferred Expansion

## RFB-090 — Add Jira import/sync

**Priority:** P3  
**Area:** Integrations  
**Depends on:** Post-MVP validation

### Description

Add Jira as an external task import/sync channel after GitHub + internal Cortex Tasks + Linear are stable.

### Acceptance Criteria

- Jira issues can import into Cortex Task drafts.
- Jira tasks do not auto-run.
- Status sync is bounded.

---

## RFB-091 — Add Slack linked-context intake

**Priority:** P3  
**Area:** Integrations  
**Depends on:** Post-MVP validation

### Description

Allow explicit Slack thread links to enrich Cortex Tasks. Do not crawl Slack broadly.

### Acceptance Criteria

- User can attach a Slack thread link.
- Thread is summarized safely.
- Summary can enrich a task.
- Slack chatter does not auto-create executable tasks.

---

## RFB-092 — Add Notion/Confluence linked-doc intake

**Priority:** P3  
**Area:** Integrations  
**Depends on:** Post-MVP validation

### Description

Allow explicit linked docs to enrich task context.

### Acceptance Criteria

- User can link a doc.
- Doc is summarized safely.
- Summary can enrich task packet.
- No broad workspace crawling.

---

## RFB-093 — Add advanced agency workspace features

**Priority:** P3  
**Area:** Product  
**Depends on:** Post-MVP validation

### Description

Support agency/product-studio workflows.

### Possible Features

- Multi-client workspaces.
- Client-facing weekly reports.
- Multi-repo readiness dashboard.
- Runner pools.
- White-label reports.

### Acceptance Criteria

- Only implemented after MVP usage validates agency demand.

---

## RFB-094 — Add full Stripe billing

**Priority:** P3  
**Area:** Billing  
**Depends on:** Usage validation

### Description

Implement subscription billing once scan/task/run usage is validated.

### Acceptance Criteria

- Plans map to scan/task/setup PR/runner limits.
- Usage overages are supported or explicitly blocked.
- Managed execution is not unlimited.

---

# First Sprint Recommendation

The first sprint should not touch runner internals unless required. It should establish the new product spine.

## Sprint 1 — Repo Readiness Contract + Data Foundation

1. RFB-001 — Create refactor branch and freeze runner-first backlog changes.
2. RFB-002 — Update product language across docs.
3. RFB-003 — Reclassify existing open tasks under the new roadmap.
4. RFB-004 — Add refactor principles to `AGENTS.md`.
5. RFB-005 — Add `Finding` shared contract.
6. RFB-006 — Add `RepoReadinessReport` shared contract.
7. RFB-007 — Add `CortexTask` shared contract.
8. RFB-008 — Add `RepoScan` shared contract.
9. RFB-010 — Add shared contract test coverage for all new objects.
10. RFB-011 — Add database tables for repo scans.
11. RFB-012 — Add database tables for findings.
12. RFB-014 — Add database tables for Cortex Tasks.

## Sprint 2 — GitHub Scan and Findings

1. RFB-017 — GitHub App repository scan permissions review.
2. RFB-018 — GitHub repo inventory service.
3. RFB-019 — Safe file read allowlist.
4. RFB-020 — Repo scan module runner.
5. RFB-021 — Scan trigger API.
6. RFB-022 — Scan status API.
7. RFB-023 — Product clarity scan module.
8. RFB-024 — Agent-readiness scan module.
9. RFB-027 — Validation posture scan module.
10. RFB-029 — Security/protected-path scan module.

## Sprint 3 — Report, Tasks, and Onboarding UI

1. RFB-031 — Execution-readiness classifier.
2. RFB-032 — Readiness score calculation.
3. RFB-035 — Readiness report generator service.
4. RFB-036 — Task recommendation generator.
5. RFB-038 — Approval flow from recommendation to Cortex Task.
6. RFB-039 — Replace first dashboard state with repo readiness onboarding.
7. RFB-040 — Repo selection screen.
8. RFB-041 — Product goal intake screen.
9. RFB-042 — Scan progress screen.
10. RFB-043 — Readiness report page.
11. RFB-044 — Findings page.
12. RFB-046 — Cortex Tasks queue page.

## Sprint 4 — Setup PRs and Runner Gate

1. RFB-049 — Setup PR file templates.
2. RFB-050 — Setup PR preview service.
3. RFB-051 — Setup PR creation through GitHub App.
4. RFB-053 — Setup PR UI flow.
5. RFB-060 — Task packet builder from Cortex Task.
6. RFB-061 — Runner gate UI.
7. RFB-062 — Execution mode selector per Cortex Task.
8. RFB-063 — Connect approved Cortex Tasks to existing runner queue.
9. RFB-064 — Runner eligibility checks.

## Sprint 5 — Validation and Release

1. RFB-076 — Resolve protocol payload boundary tests.
2. RFB-077 — Resolve token storage docs/checks.
3. RFB-078 — Scan boundary tests.
4. RFB-079 — Setup PR permission boundary tests.
5. RFB-080 — Findings/task redaction tests.
6. RFB-081 — Complete security hardening milestone.
7. RFB-082 — Repo-readiness onboarding E2E.
8. RFB-083 — Setup PR E2E.
9. RFB-084 — Runner E2E with Cortex Task source.
10. RFB-085 — Web-to-runner protocol E2E.
11. RFB-086 — Browser happy-path smoke test.
12. RFB-087 — MVP acceptance checklist.
13. RFB-088 — Full MVP validation suite.
14. RFB-089 — Updated MVP release notes.

---

# Final Target State

Cortex should ship with this user-visible MVP:

```text
Connect GitHub repo
↓
Describe product/repo goal
↓
Run repo readiness scan
↓
View readiness score and findings
↓
Approve generated Cortex Tasks
↓
Create setup PRs or sync tasks externally
↓
Optionally enable local runner
↓
Execute approved tasks into validated PRs
↓
Review/approve/repair manually
↓
Recurring scans and weekly reviews keep the loop alive
```

This is the refactor path that preserves the existing technical foundation while making the product easier to understand, easier to trust, and more commercially useful.
