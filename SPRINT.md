# Sprint 1: Contracts And Runner Dry Run

## Backlog Source Of Truth

`BACKLOG.md` is the local source of truth for execution. Before starting Sprint 1, workers must read `MVP_PLAN.md`, `ARCHITECTURE.md`, `SECURITY_MODEL.md`, `RUNNER_PROTOCOL.md`, `DATA_MODEL.md`, `SPRINT.md`, and `BACKLOG.md`.

Sprint 1 execution starts at `TASK-001` in `BACKLOG.md`. After every completed task, update `BACKLOG.md` with the task status, completion notes, validation result, and next recommended task.

## Refactor Execution Note

As of the May 25, 2026 repo-readiness refactor queue, new work must preserve the existing local runner, keep source-boundary safety intact, deliver initial repo-readiness scan value before runner installation, and keep `README.md`, `SPRINT.md`, and relevant tests current with task changes. Concurrent worker branches may defer only merge-queue-owned `BACKLOG.md` and `README.md` bookkeeping when explicitly instructed.

`RFB-003` completed the roadmap reclassification after watchdog recovery from repeated Codex phase timeouts. Linear issue work is explicitly external task import, final validation remains in the release-readiness lane, old blocked runner-first tasks have scoped follow-up notes, and deferred post-MVP integrations stay deferred. `RFB-015` has now been manually rescued with a metadata-only join table and workspace-scoped relationship helpers, and `RFB-056` has now been manually rescued with metadata-only GitHub Issues sync for approved scan-generated Cortex Tasks. `RFB-077` has now been manually rescued with reviewed token-storage security documentation and static server/client credential-boundary checks, which unblocks and completes the `RFB-081` security hardening milestone. `RFB-081` final validation also hardened local runner command timeout cleanup for late-spawned descendants and passed full root validation. `RFB-090` through `RFB-094` are explicitly blocked/deferred Phase 14 expansion items until the user approves post-MVP scope.

## Repo-Readiness Shared Contract Note

`RFB-005` adds a metadata-only `Finding` contract to `@control-plane/shared` for scan findings. The contract is separate from runner/security `RiskFinding`, uses repo-readiness categories and severities, validates finding evidence through path-summary metadata, and recursively rejects unsafe evidence metadata keys for source, diff, patch, snippet, code, file content, secrets, tokens, passwords, private keys, raw logs, stdout, stderr, and raw output.

`RFB-006` adds a metadata-only `RepoReadinessReport` contract to `@control-plane/shared` for scan-level readiness output. It reuses the `Finding` category set for exhaustive 0-100 category scores, exposes execution-readiness states, stores finding and task recommendation IDs instead of embedded raw artifacts, and recursively rejects unsafe payload keys for source, diff, patch, snippet, code, file content, secrets, tokens, passwords, private keys, raw logs, stdout, stderr, and raw output.

`RFB-007` adds a metadata-only `CortexTask` contract to `@control-plane/shared` for the internal AI execution queue. It records task origin, objective, acceptance criteria, risk, execution mode, approval status, validation IDs/labels, run/PR artifact links, external links, and safe metadata while recursively rejecting unsafe payload keys for source, diff, patch, snippet, command text, secrets, tokens, passwords, private keys, raw logs, stdout, stderr, and raw output.

`RFB-008` adds a metadata-only `RepoScan` contract to `@control-plane/shared` for repo-readiness scan runs, separate from local code execution runs. It records scan lifecycle status, timestamps, linked report/finding/task IDs, and count/label-based inventory summaries while recursively rejecting unsafe payload keys for source, file contents, diff, patch, snippet, command text, path inventories, local paths, secrets, tokens, passwords, private keys, raw logs, stdout, stderr, and raw output.

`RFB-009` adds a metadata-only `TaskRecommendation` contract to `@control-plane/shared` for repo-readiness recommendations before they become Cortex Tasks. It links recommendations to findings, records lifecycle status, risk, effort, suggested execution mode, acceptance criteria, safe suggested validation metadata, and converted Cortex task IDs only after conversion while recursively rejecting unsafe payload keys for source, file contents, diffs, patches, snippets, command text, path inventories, local paths, secrets, tokens, passwords, private keys, raw logs, stdout, stderr, and raw output.

`RFB-010` hardens shared contract fixture coverage for all new repo-readiness objects: `Finding`, `RepoReadinessReport`, `CortexTask`, `RepoScan`, and `TaskRecommendation`. The shared fixture and compatibility tests now keep an explicit coverage set requiring each contract to have public-entrypoint valid parsing, invalid fixture rejection, unsafe payload/key rejection, and v1 compatibility manifest coverage while preserving the metadata-only non-exfiltration posture.

`RFB-011` persists repo-readiness scan runs as metadata-only `repo_scans` rows tied directly to `github_repositories` and `workspaces`, with lifecycle check constraints, JSON shape checks, shared-contract typed inventory/finding/task ID fields, and server-side helpers that validate `RepoScan` payloads plus web-bound payload safety before storage. The table intentionally avoids raw source, diffs, patches, snippets, local paths, path inventories, secrets, tokens, raw logs, stdout, stderr, and raw command output.

`RFB-012` persists repo-readiness findings as metadata-only `findings` rows tied to workspaces, GitHub repositories, and repo scans. The table aligns category, severity, status, and source enums with the shared `Finding` contract, stores evidence and task links as JSON metadata, enforces an opaque per-workspace/repo dedupe key, and keeps service audit metadata to IDs, statuses, counts, and lengths. The persistence service validates findings through the shared contract plus web-bound payload guards and rejects raw source, diffs, patches, snippets, secrets, `.env` paths, local absolute paths, traversal paths, raw output labels, stdout, stderr, and unredacted command output before storage.

`RFB-013` persists repo-readiness reports as metadata-only `repo_readiness_reports` rows tied to workspaces, GitHub repositories, and repo scans. The table aligns execution-readiness values with the shared `RepoReadinessReport` contract, stores score/category/report arrays as JSON metadata, keeps one report per workspace scan while preserving repo-level history across scans, and updates `repo_scans.readiness_report_id`, `finding_ids`, and `task_recommendation_ids` transactionally. The persistence service validates reports through the shared contract plus web-bound payload guards and rejects raw source, diffs, patches, snippets, secrets, `.env` paths, local absolute paths, traversal paths, raw output labels, stdout, stderr, and unredacted command output before storage.

`RFB-014` persists internal Cortex Tasks as metadata-only `cortex_tasks` rows tied to workspaces and GitHub repositories, separate from the runner/manual `tasks` queue. The table aligns origin, risk, execution mode, status, and approval enums with the shared `CortexTask` contract, stores finding IDs, task recommendation IDs, task packet IDs, run IDs, PR artifact IDs, external links, and metadata as safe metadata, and avoids Linear/Jira-specific foreign keys. The persistence service validates Cortex Tasks through the shared contract plus web-bound payload guards, checks workspace membership plus repo/finding scope, rejects credentialed external links and unsafe source-like payloads, and enforces conservative status transitions before audit-only persistence.

`RFB-015` adds the canonical finding-to-Cortex Task relationship table. `finding_task_links` stores only workspace ID, repository ID, finding ID, Cortex Task ID, optional task recommendation ID, and timestamps; the migration enables RLS and backfills from existing `findings.taskIds` and `cortex_tasks.findingIds` JSON arrays. The web repo-readiness service exposes workspace-scoped helpers for tasks by finding and findings by task, and task creation/conversion paths maintain join rows without exposing raw source, diffs, patches, snippets, secrets, local paths, or command output.

`RFB-016` persists repo-readiness task recommendations as metadata-only `task_recommendations` rows tied to workspaces, GitHub repositories, and repo scans. The persistence service validates recommendations through the shared `TaskRecommendation` contract plus web-bound payload guards, checks workspace/repo/scan/finding scope, supports ignored/deferred status updates, and converts approved open recommendations into exactly one draft Cortex Task with idempotent repeated approval.

`RFB-017` adds a GitHub App repository permission review layer for repo-readiness scanning. The `@control-plane/github` helper documents and evaluates least-privilege profiles for scan-only (`metadata: read` plus `contents: read`), setup PRs (`contents: write` plus `pull_requests: write`), and optional read-only PR/check visibility (`pull_requests: read` plus `checks: read`). Scan-only mode does not require runner installation, and broad permissions such as administration, secrets, actions/workflows write, checks write, and issues write remain outside the MVP profiles. The settings UI renders rejected MVP permissions as blockers so read-level administration or secrets grants cannot appear scan-only ready.

`RFB-018` adds a metadata-only GitHub repository inventory service for repo-readiness onboarding. The `@control-plane/github` builder fetches recursive tree metadata, derives count and label summaries, reads only bounded allowlisted docs/config files, parses `.aicp/policy.json` transiently for policy counts, and returns a `RepoScanInventory`-compatible projection without raw source, diffs, patches, snippets, content, secrets, or path inventories. The web facade is server-only, requires workspace membership plus scan-only GitHub App permission support, blocks archived/disabled repositories, validates the inventory through the shared schema, and applies the web-bound payload guard before returning safe service metadata.

`RFB-019` formalizes the repo-readiness scan file-read allowlist in `@control-plane/github`. The inventory builder now classifies files from recursive tree metadata before any `/contents` request, reads only bounded policy, canonical docs, root config, and GitHub workflow files, and fails closed for real `.env*` paths, env templates, secret/credential filenames, private keys, binary files, source paths, unknown-size files, and oversized files. Inventory output remains metadata-only counts and statuses without raw source, diffs, patches, snippets, content, secrets, or path inventories.

`RFB-020` adds a metadata-only repo scan module runner. Repo scans now persist per-module statuses with queued, running, passed, warning, blocked, failed, and skipped states; module progress keeps safe labels, counts, summaries, and timestamps only. The hosted runner executes modules in deterministic order, continues through optional module failures, fails closed on required module failures, converts thrown errors to generic summaries, and wraps GitHub inventory as the first required scan module without exposing source, diffs, patches, snippets, raw output, local paths, or secrets. Repository pages can now render recent scan module progress from existing scan metadata without adding trigger or status APIs.

`RFB-021` adds the hosted repo-readiness scan trigger path. Authenticated users can trigger a metadata-only scan for a registered GitHub repository in a workspace they belong to; queued or running scans for the same workspace/repo are debounced to the existing scan ID, while terminal scans allow a new queued scan. The API route and server action accept only `workspaceId` and `repoId`, return narrow scan metadata, reject unsafe source-like or provider-output payload fields, and do not execute local runner work or return raw source, diffs, patches, snippets, local paths, secrets, stdout, stderr, or raw output.

`RFB-039` replaces the first dashboard state with repo-readiness onboarding. The overview payload now includes safe GitHub repository options plus minimal repo scan rows after workspace membership verification, and the dashboard shows a GitHub repository scan flow until any scan exists. The scan form submits only canonical `workspaceId` and `repoId`; runner pairing and manual-task CTAs stay hidden before the first scan, with copy that frames the local runner as optional later.

`RFB-040` adds the repo selection screen for hosted repo-readiness scans. The dashboard overview now derives GitHub connection status, active repository access, and per-repository scan-only permission state from safe installation metadata. The onboarding UI handles no GitHub connection, suspended/no-access, and no active repo access states; lists installed repositories with scan permission badges; disables repositories that are not scan-ready; and submits only canonical workspace/repo IDs without exposing raw source, diffs, patches, snippets, secrets, local paths, stdout, stderr, or raw provider output.

`RFB-041` adds product goal intake before hosted repo-readiness scans. The onboarding form now captures optional bounded product/repo goal context, warns that skipping reduces scan quality, and submits only canonical workspace/repo IDs plus `productGoal`. The server action/API route reject unsafe source-like/path/secret text before persistence, repo scans save safe goal context inside `productClaritySummary`, GitHub inventory preserves that context for scoring and report/recommendation prompt inputs, and audit metadata records only the provided/not-provided status without raw goal text.

`RFB-022` adds the hosted repo-readiness scan status read path. The service, API route, and server action accept `workspaceId` plus either `repoId` for the latest scan or `scanId` for an exact scan, returning only lifecycle metadata, module statuses, status summaries, report availability, finding counts, task recommendation counts, timestamps, and inventory counts. The path revalidates persisted scan payloads before return and keeps report bodies, finding evidence, raw source, diffs, patches, snippets, local paths, secrets, stdout, stderr, and raw provider output out of polling responses.

`RFB-042` adds a first-class metadata-only repo scan progress view. The repositories surface now renders the canonical onboarding modules Product Clarity, Agent Readiness, Architecture, Backlog, Validation, Security, and Repo Hygiene in stable order from existing scan status rows, fills missing active modules as queued, fills missing terminal modules as skipped, and shows failed scan summaries only through safe display guards without rendering module metadata, raw source, diffs, patches, snippets, local paths, secrets, stdout, stderr, or raw provider output. Validation passed with `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-043` adds a workspace-scoped readiness report page at `/dashboard/reports/[reportId]`. The page loads exact persisted report metadata by safe report ID after selected-workspace membership verification, renders overall score, execution readiness, category scores, strengths, weaknesses, blockers, and recommended next actions, and links users to filtered findings plus task recommendation targets. Scan progress now links completed scans with report IDs to the report page, and UI tests cover hostile payload display safety without exposing raw source, diffs, patches, snippets, local paths, secrets, stdout, stderr, or raw provider output. Validation passed with focused RFB-043 tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-045` adds a workspace-scoped task recommendations page at `/dashboard/task-recommendations`. The page loads recommendation and repository metadata only after selected-workspace membership verification, filters by status, risk, repository, and scan, groups recommendations by derived risk/category, and supports editable per-recommendation approval, selected bulk approval, approve-all low-risk setup recommendations, defer, and dismiss actions. Approval creates draft Cortex Tasks only and does not queue runner execution. Action revalidation now includes the recommendation page, and tests cover route conventions, editable approval fields, grouped display, bulk actions, status actions, filter behavior, and hostile payload display safety without exposing raw source, diffs, patches, snippets, local paths, secrets, stdout, stderr, raw provider output, or runner command output. Validation passed with focused RFB-045 tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-046` adds the workspace-scoped Cortex Tasks queue at `/dashboard/tasks`. The page verifies selected workspace membership before loading Cortex Task and repository metadata, filters by status, repository, risk, execution mode, and approval status, and renders linked findings, suggested validation, risk, origin, approval state, and safe external links. A metadata-only status transition action accepts only workspace ID, task ID, and shared-valid next status, reuses the shared Cortex transition evaluator through the persistence service, and revalidates task/recommendation/finding/audit surfaces. The UI supports review, approve, reject, defer, external sync navigation, and execute/queue actions while runner execution remains local-runner gated. Validation passed with focused RFB-046 tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-047` reorders the authenticated app navigation around the repo-readiness front door. Task Recommendations is now a primary destination between Findings and Cortex Tasks, while Runs, Approvals, Pull Requests, and Runners stay accessible after the readiness/task flow. Generic dashboard, findings, recommendation, and Cortex Task empty states now guide users back to repository scanning before local runner execution is considered. Validation passed with focused RFB-047 UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-048` adds the "What can safely move forward today?" dashboard actionability view. The overview service now derives safe action rows from scan status, open findings, task recommendations, Cortex Tasks, runner health, approval queues, and blocked runs while selecting only metadata-only finding/recommendation/task columns. The dashboard leads with those actions before operational runner details so it stays useful before runner install and after a runner is online without exposing raw source, diffs, patches, snippets, logs, command output, secrets, objectives, acceptance criteria, evidence, or metadata payloads. Validation passed with focused dashboard overview/actionability tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-049` defines deterministic setup PR file templates. The server-only template catalog covers repository policy, CI validation workflow, agent instructions, architecture docs, backlog structure, contribution guide, product spec, and integration notes, with stable path allowlisting, review-required metadata, generated-file markers where file formats allow them, and task-validation-ID based selection for approved setup-pr Cortex Tasks. The templates do not copy source, diffs, patches, snippets, secrets, `.env` contents, or command output into hosted setup PR metadata. Validation passed with focused setup PR template tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-050` adds the metadata-only setup PR preview backend. The shared `SetupPrPreview` contract, `setup_pr_previews` database table, migration metadata, and server-only preview service persist filenames, summaries, review instructions, source task IDs, excluded task/template selections, and explicit `omittedContent: true` markers without storing generated file bodies, raw source, diffs, patches, snippets, secrets, `.env` contents, or command output. The service supports removing tasks and files before creation, validates approved setup-pr Cortex Tasks through shared schemas, and writes safe audit metadata for preview creation. Validation passed with focused setup PR preview/shared/db tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-051` adds setup PR creation through the GitHub App write abstraction. The GitHub client now creates setup PR branches with Git data operations from generated setup files, and the server-only creation service re-renders only preview-approved deterministic setup templates, checks setup-pr permissions, opens draft PRs with finding IDs and review checklists, and persists PR metadata back to Cortex preview rows without local runner execution or hosted storage of generated file bodies, raw source, diffs, patches, snippets, secrets, `.env` contents, command output, or local artifacts. Validation passed with focused setup PR creation/GitHub client tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-052` adds metadata-only setup PR evidence summaries. The shared contract and server-only web builder map generated setup files to approved source tasks and linked readiness findings, explain why each file was generated, list reviewer checklist items, and keep `omittedContent: true` evidence summaries separate from generated setup file bodies, raw source, diffs, patches, snippets, secrets, `.env` contents, command output, and local runner artifacts. Setup PR creation now returns that summary and includes it in draft PR bodies. Validation passed with focused setup PR evidence/shared/creation tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-053` adds the workspace-scoped setup PR UI flow at `/dashboard/setup-prs`. The page verifies selected workspace membership before loading Cortex Task, repository, and setup PR preview metadata; navigation now exposes Setup PRs between Tasks and operational PR views; and the component lets users select approved setup-pr tasks, create preview rows, view existing draft/created previews, create draft setup PRs, and see addressed task titles plus finding IDs for each setup file. Server actions accept only workspace/repo/task/preview IDs and return metadata-only counts and PR fields, while a server-only GitHub App request transport binds the existing setup PR creation service to placeholder-configured app credentials without storing raw source, diffs, patches, snippets, secrets, `.env` contents, command output, or generated file bodies in hosted surfaces. Validation passed with focused setup PR UI/preview/action/GitHub transport tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`; local browser route verification was blocked by missing Clerk publishable key in the local environment.

`RFB-054` adds setup PR merge detection and finding resolution. The signed GitHub webhook route now recognizes merged `pull_request` events, calls a server-only setup PR resolver, and matches setup PR previews by installation, repository, and pull request number. The resolver idempotently skips already resolved previews, records safe merge metadata on the preview, marks linked approved setup-pr Cortex Tasks completed, resolves linked readiness findings so future scans can confirm or reopen the gap through existing scan upsert behavior, and writes metadata-only audit events without storing raw source, diffs, patches, snippets, secrets, `.env` contents, generated file bodies, or command output. Validation passed with focused setup PR merge resolution/webhook tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-023` adds deterministic product-clarity scanning. The shared repo-scan inventory now exposes product clarity as fixed metadata-only statuses, counts, and signal labels, normalizing the legacy `clear` status to `sufficient` for compatibility. The GitHub inventory path reads only bounded allowlisted product documentation such as `PRODUCT.md`, `PRODUCT_SPEC.md`, `MVP_PLAN.md`, and docs product files, reduces transient document text to safe signal labels, and keeps raw product documentation out of inventory output. The web scan module creates `product_clarity` findings plus conservative `setup_pr` task recommendations for missing, weak, or unreadable product clarity while returning no finding when product signals are sufficient.

`RFB-024` adds deterministic agent-readiness scanning. The GitHub inventory path now reads only bounded root `AGENTS.md` or `agents.md` instruction files, reduces transient content to safe counts, read statuses, completeness statuses, and missing-section labels, and keeps raw instruction text out of returned inventory. The web scan module creates `agent_readiness` findings plus conservative `setup_pr` task recommendations for missing, incomplete, unreadable, or conflicting root agent instructions, while returning no finding when instructions are complete.

`RFB-025` adds deterministic architecture-documentation scanning. The GitHub inventory path detects root or `docs/` `ARCHITECTURE` documents from tree metadata only, keeps those files outside the content-read allowlist, and returns only aggregate documentation kind/count summaries. The optional web module consumes that metadata, passes when architecture docs are present, and otherwise persists one `architecture` finding plus one conservative `setup_pr` recommendation without source paths, document text, diffs, patches, snippets, local paths, secrets, stdout, stderr, or raw provider output.

`RFB-026` adds deterministic backlog-quality scanning. Shared repo-scan inventory now includes metadata-only backlog structure and backlog quality summaries, the GitHub inventory path reads only bounded root `BACKLOG.md` or `backlog.md` files and reduces transient text to fixed statuses, counts, and signal labels, and the optional hosted `backlog_quality` module persists one finding plus one conservative setup recommendation for missing or weak AI-executable backlog structure. Validation passed with `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-027` adds deterministic validation-posture scanning. Shared repo-scan inventory now includes a metadata-only validation posture summary with fixed command labels and posture statuses, the GitHub inventory path classifies validation commands from `.aicp/policy.json` transiently without returning command text, and the optional hosted `validation_posture` module persists one finding plus one conservative setup recommendation for missing or partial validation command maps. Validation passed with `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-028` adds deterministic CI/CD posture scanning. Shared repo-scan inventory now includes a metadata-only CI/CD posture summary with fixed provider labels, workflow counts, validation command labels, missing label lists, and alignment statuses. The GitHub inventory path reads only bounded allowlisted CI workflow files such as `.github/workflows/*.yml` transiently, reduces workflow contents to fixed test/typecheck/build labels where detected validation commands make them applicable, and keeps workflow text, command text, raw source, diffs, patches, snippets, local paths, secrets, stdout, stderr, and raw provider output out of inventory output. The optional hosted `ci_cd` module runs after validation posture, persists one medium `ci_cd` finding plus one conservative setup recommendation for missing or partial coverage, passes aligned coverage, and appears in scan progress as a first-class module. Validation passed with `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-029` adds deterministic security policy-coverage scanning. The policies package now exposes a metadata-only coverage assessment from `RepoScanInventory.policySummary`, and the optional hosted security module persists one `security` finding plus one conservative `setup_pr` recommendation when repository policy coverage is missing or incomplete. The module keeps evidence path arrays empty, uses count and label metadata only, passes when protected and sensitive rule counts are present, and fails safely when inventory metadata is unavailable.

`RFB-030` adds deterministic repo-hygiene scanning. The shared repo-scan inventory now exposes `repoHygieneSummary` as fixed statuses, counts, booleans, and issue labels with legacy default parsing and unsafe-key rejection. The GitHub inventory path derives hygiene metadata from recursive tree metadata only, including mixed JavaScript lockfiles, package manifests without lockfiles, root ignore presence, contribution/development notes, issue-template counts, and unclear monorepo structure without reading `.gitignore`, issue templates, source, env, or secret-like files. The optional hosted `repo_hygiene` module runs after security, persists one low or medium `repo_hygiene` finding plus one conservative setup recommendation when gaps exist, and fails with safe metadata when inventory is unavailable. Validation passed with focused shared/GitHub/web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-031` adds deterministic execution-readiness classification for repo-readiness reports. The web report persistence path now recalculates `executionReadiness`, blocked reasons, and recommended next actions from scoped finding statuses, metadata-only repository inventory, validation posture, policy coverage, and setup recommendation IDs before storage. Blocked findings hard-block AI execution, missing validation or policy coverage cannot be persisted as `local_runner_ready`, and setup recommendation IDs expose the `setup_pr_ready` path without sending raw source, diffs, patches, snippets, secrets, local paths, stdout, stderr, or raw command output to hosted surfaces. Validation passed with focused web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-032` adds deterministic readiness score calculation for repo-readiness reports. The web report persistence path now recalculates `overallScore` and exhaustive category scores from scoped finding statuses plus metadata-only scan summaries before storage, uses the weakest category as the explainable overall score, appends safe score weakness explanations, heavily penalizes blocked findings, reduces product-clarity and agent-readiness gaps when setup documentation is missing, and ignores resolved findings so later scans can recalculate upward after remediation without exposing raw source, diffs, patches, snippets, secrets, local paths, stdout, stderr, or raw command output. Validation passed with focused web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-033` adds a server-only scan summarization prompt contract for repo-readiness reports. The prompt builder parses the existing `RepoScan`, `Finding`, and `RepoReadinessReport` contracts, projects only scan metadata, safe document summaries, module status summaries, inventory counts/statuses, and finding summaries into LLM input, asks for concise evidence-backed report text, and validates model output back through `RepoReadinessReportSchema` while preserving deterministic scope, scores, readiness, IDs, blocked reasons, recommended actions, and timestamps. Validation passed with focused web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-034` adds a safe deterministic document summarizer for RFB-019 allowlisted documentation reads. Shared repo-scan inventory now carries `documentSummaries` as bounded fixed-kind summaries with topic labels, count metadata, and redaction status while defaulting legacy payloads to an empty list. The GitHub inventory content-read path summarizes only successfully read allowlisted documentation and root agent-instruction files, skips non-doc allowlisted files, keeps summary failures local, and never returns raw document bodies, source snippets, diffs, patches, secrets, `.env` content, raw provider output, or source paths. Validation passed with focused shared/GitHub/web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-035` adds a server-only readiness report generator service after deterministic scan modules complete. The generator requires terminal safe module statuses, builds a deterministic `RepoReadinessReport` from metadata-only scan inventory, scoped findings, readiness scores, execution-readiness classification, and task recommendation IDs, optionally refines only human-facing summary fields through the safe LLM prompt contract, falls back to deterministic output on model failure, persists through the existing report service, and marks the scan completed with the persisted report ID. Validation passed with focused web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-036` adds a server-only task recommendation generator for repo-readiness findings. The generator loads scoped open findings, skips resolved findings and findings already covered by existing recommendations, projects only safe finding summaries and scan metadata into the optional LLM prompt, accepts only candidate title/objective/finding IDs/acceptance criteria/risk/effort/execution mode/suggested validation fields, composes final `TaskRecommendation` records itself with `status: "open"`, and falls back to deterministic generic recommendations when generated output is unsafe or unavailable. Validation passed with focused web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-037` adds deterministic task recommendation templates for common repo-readiness findings. The generator now builds server-only templates for product clarity, agent readiness, architecture, backlog quality, validation, CI/CD, security, and repo hygiene before invoking an optional LLM; the LLM may refine only title, objective, and acceptance criteria, while deterministic finding links, risk, effort, execution mode, and suggested validation remain authoritative. Unsafe refinement keys or unsafe payloads fall back to the deterministic templates without approving or queueing work. Validation passed with focused web tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-038` adds the recommendation approval flow into draft Cortex Tasks. The repo-readiness task recommendation service now accepts optional reviewer edits for title, objective, and acceptance criteria before conversion, supports bulk approval of multiple recommendations, rejects duplicate bulk IDs before mutation, keeps repeated converted approvals idempotent, and writes safe audit metadata for task creation and recommendation conversion while leaving runner execution unqueued and approval status `not_requested`. Validation passed with focused service/action tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-023` adds a deterministic product clarity scan module after GitHub inventory. The GitHub inventory path reads only bounded allowlisted product docs such as root or `docs/` `PRODUCT.md` and `PRODUCT_SPEC.md`, reduces transient content to fixed product intent signal labels, and stores only counts, statuses, and labels in `productClaritySummary`. The optional web module consumes only that summary, persists a deterministic `product_clarity` finding plus a conservative setup recommendation for missing or weak clarity, passes clear clarity without inventing product facts, and avoids source paths, package labels, README prose, raw product text, diffs, patches, snippets, local paths, secrets, stdout, stderr, or raw provider output.

`RFB-078` adds scan boundary regression coverage for the hosted repo-readiness path. The GitHub allowlist tests now assert exact skip reasons for env files, env templates, private keys, binary files, oversized or unknown-size allowlisted files, and source paths under `src/`, `apps/`, `packages/`, and `tests/`; inventory and web facade tests prove disallowed files are never requested or returned; repo scan persistence tests prove unsafe source-like summaries, `.env.local` text, private key markers, raw GitHub output, and unsafe inventory fields fail before persistence or audit writes.

`RFB-044` adds a workspace-scoped `/dashboard/findings` page for repo-readiness findings. The page verifies selected workspace membership before loading persisted findings and synced GitHub repository names, renders dense severity/category/status/repo/scan filters, displays evidence summaries plus safe relative paths and recommendations, supports audited dismiss/defer actions, and converts findings directly into draft Cortex Tasks without approving, queueing, or assigning runner execution. The conversion path links task IDs through `findings.taskIds`, maps finding severity to Cortex task risk, uses conservative `setup_pr` execution mode, returns already linked tasks idempotently, and keeps audit events to IDs, counts, statuses, and lengths.

`RFB-059` centralizes Cortex Task status transition rules in `@control-plane/shared` with actor-aware user, runner, and external-sync evaluation. Web persistence now blocks direct creation/upsert into approved or execution states, preserves existing persisted status fields during upsert conflicts, writes transition audit events with IDs/statuses/actor type only, and applies expected current status plus approval status conditions before mutating a task row.

`RFB-060` adds a server-only task packet builder that converts approved metadata-only Cortex Tasks into the existing shared `TaskPacket` runner contract. Packet creation now requires approved task and approval statuses, accepts only `local_runner` execution mode, blocks `planning_only`, `setup_pr`, and blocked-risk work, requires explicit approval evidence for high-risk work, composes active repo mapping policy and validation commands, uses safe GitHub `owner/name` repository identifiers, keeps Cortex risk metadata in safe context notes, and remains file-content blind. Queue, poll, claim, and run assignment integration remains scoped to `RFB-063`.

`RFB-061` adds the first-class runner gate to the Cortex Tasks queue. The UI explains that local execution is optional, shows the three execution modes before runner setup, keeps planning and setup PR flows available without a runner, and renders the local runner setup CTA only when approved local-runner tasks require execution. The gate remains metadata-only and does not expose raw source, diffs, patches, snippets, secrets, `.env` contents, generated file bodies, command output, or local runner artifacts.

`RFB-062` adds a per-task execution mode selector to the Cortex Tasks queue. The server action accepts only workspace ID, task ID, and shared-valid execution mode metadata, the persistence service allows edits only before approval, blocked-risk tasks are constrained to planning-only, and local runner mode requires stored runner availability with dry-run support and git capability. The UI keeps locked approved tasks read-only and does not expose raw source, diffs, patches, snippets, secrets, `.env` contents, generated file bodies, command output, or local runner artifacts.

`RFB-063` connects approved local-runner Cortex Tasks to the existing runner queue. The server action now routes queue requests through a metadata-only bridge that builds safe TaskPackets, creates legacy-compatible queue task rows, inserts queued runs for the existing poll/claim protocol, supports manual and Linear-sourced Cortex Tasks, records Cortex Task run IDs/latest run/task packet IDs, and links stored PR artifacts back to Cortex Tasks through run IDs. Validation passed with focused Cortex queue/action/artifact tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-064` adds runner eligibility checks before Cortex Tasks can enter the local-runner queue. The web service now evaluates approved task state, approved approval state, local-runner execution mode, blocked risk, high-risk approval evidence, GitHub repository availability, active repo mapping setup, policy snapshot, required validation commands, and available local runner dry-run/git support before task packet creation or queue writes. The Cortex Tasks UI shows clear fixable eligibility reasons, links to setup surfaces, and withholds the queued transition form for ineligible tasks while preserving metadata-only hosted surfaces. Validation passed with focused Cortex queue/UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-065` updates run detail pages to show the originating Cortex Task context above technical run evidence. The run detail service loads Cortex Tasks by run ID, validates linked task/finding rows through shared contracts, and returns only safe display metadata: acceptance criteria, risk, execution mode, approval state, finding summaries, suggested validation labels, PR evidence, and validation evidence. Unsafe task/finding context is omitted, and objectives, task packets, raw commands, diffs, patches, snippets, source, local paths, secrets, and logs remain outside hosted surfaces. Validation passed with focused run detail service/UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-066` adds the repair request flow from the Cortex Task view. The task page now loads workspace-scoped repair context for PR-opened Cortex Tasks, renders safe run/PR/validation-count metadata, reuses the existing `RequestRepairDialog` and repair action through `previousRunId`, respects attempt limits, and drops unsafe PR URLs. Repair packet creation remains in the existing metadata-only repair service, so raw source, diffs, patches, snippets, local paths, secrets, task packets, and command output stay outside hosted surfaces. Validation passed with focused repair context/task queue tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-067` adds GitHub webhook handling for repo changes. The GitHub webhook helper now parses signed `push` events into safe repository/ref metadata without commit messages, changed paths, pusher data, raw source, diffs, patches, snippets, or provider output; the webhook route accepts default-branch pushes and merged PR events, triggers workspace/repo-scoped queued scans through a webhook-specific repo scan service, resolves setup PR merges, ignores feature-branch push noise, and debounces queued/running scans. Validation passed with focused GitHub webhook/repo-scan route tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-068` adds the recurring repo scan scheduler. The server-only scheduler selects active GitHub repositories, queues first scans or weekly rescans when due, skips queued/running scans to avoid duplicates, respects workspace plan usage limits when enforcement is enabled, and writes metadata-only audit events with repository IDs, scan IDs, statuses, and trigger reasons only. Manual rescans remain on the explicit repo-readiness scan API surface. Validation passed with focused repo scan scheduler tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-069` adds finding lifecycle and drift detection. The finding service now classifies dedupe-key upserts as new, recurring, worsened, or stale, preserves existing task links across recurring findings, stores lifecycle state only in safe evidence metadata, resolves older open findings that are absent from a completed rescan, and feeds count-only drift summaries into deterministic readiness reports. Existing open new findings continue through the task recommendation generator path. Validation passed with focused finding lifecycle, readiness report generator, and task recommendation generator tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-070` adds the weekly engineering review generator. The shared `WeeklyEngineeringReview` contract validates deterministic review totals, repository summaries, dashboard links, deferred email/slack delivery state, and recursive unsafe payload rejection. The web generator composes workspace-scoped GitHub repository, readiness report, finding, task recommendation, and Cortex Task metadata into a safe weekly summary and exposes the initial lightweight `/dashboard/weekly-review` surface. Validation passed with focused weekly review contract/generator/UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-071` adds the weekly review UI polish. The `/dashboard/weekly-review` surface now frames the latest generated review, shows score totals, deferred delivery status, trend-from-previous-review counts, repository score movement, links to findings, task recommendations, Cortex Tasks, pull requests, and active runs, and routes the “Approve next recommended tasks” CTA into the existing task recommendation approval workflow. Validation passed with focused weekly review contract/generator/UI/navigation tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-072` adds the usage event model for scans and AI generation. The database now has workspace-scoped usage events with event/model-category enums, idempotency, source references, metadata object checks, positive quantities, and migration metadata; repo scans, readiness reports, task recommendations, setup PR previews, and runner claims now write metadata-only events for future plan gates. Usage metadata rejects prompts, raw source, diffs, patches, snippets, logs, secrets, and `.env` references, and usage summaries expose totals by event type and model usage category without requiring full Stripe billing. Validation passed with focused usage-event/schema/repo-readiness/runner-claim tests, a hardened runner descendant-timeout test, plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-073` adds scan and task generation limits by plan. The server-only billing limit service defines free, pro, team, and MVP caps for repo scans, readiness report generation, task recommendation generation, setup PR generation, and runner executions; manual/API scans, GitHub webhook scans, recurring scans, readiness report generation, and task recommendation generation now assert usage before creating new work. Over-limit responses use the public `plan_limit_exceeded` action error with clear reset messaging, and admin overrides are validated for testing while preserving metadata-only hosted payloads without raw source, diffs, patches, snippets, prompts, secrets, `.env` contents, or command output. Validation passed with focused plan-limit/server-error/repo-scan/scheduler/report/recommendation tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-074` adds the managed execution cost boundary. The MVP plan, product spec, architecture, security model, and README now state that Cortex-key AI can be used for metadata-first repo-readiness scanning, readiness report generation, task recommendation generation, and setup PR generation, while source-changing implementation execution defaults to customer-owned local runner credentials and customer-owned Codex/API usage. Any future Cortex-managed implementation execution path must require explicit credits or plan caps before work starts, and no such path may run with unlimited spend or uncapped usage. Validation passed with focused cost-boundary docs coverage plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-075` adds the pricing/plan placeholder UI. The billing plan limit service now exposes a metadata-only monthly plan usage summary, and `/dashboard/settings/billing` renders repo scans used/remaining, task generations used/remaining, setup PRs created/remaining, runner usage, reset date, workspace limits, and Stripe configured/not-configured booleans only after selected-workspace membership verification. The surface remains read-only for the internal MVP with no Stripe checkout or customer portal actions and no rendered Stripe IDs. Validation passed with focused billing plan-limit/UI tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-079` adds setup PR permission boundary coverage. The GitHub App setup PR writer now enforces the approved generated setup path allowlist before transport, blocking source files, `.env` paths, unapproved root files, and unapproved workflow files while preserving the explicitly allowed validation workflow. Focused setup PR creation tests prove preview path tampering stops before GitHub writes and PR bodies do not leak raw source, diffs, patches, or secrets. Validation passed with focused setup PR/GitHub tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-082` adds a full repo-readiness onboarding E2E. The headless test exercises hosted scan trigger, GitHub inventory and validation-posture modules, readiness report persistence, task recommendation approval into a draft setup-pr Cortex Task, and server-rendered findings, recommendations, and tasks without requiring a local runner. Serialized output checks guard against raw source, diffs, patches, snippets, secrets, local paths, `.env` markers, task packets, runs, and runner artifacts. Validation passed with focused onboarding E2E coverage plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-083` adds a setup PR E2E. The headless test exercises approved setup-pr Cortex Tasks through metadata-only preview creation, mock GitHub App branch and draft PR creation, preview PR metadata persistence, linked finding/task evidence summaries, Cortex Task pull-request external-link updates, and server-rendered setup PR flow output. Serialized output checks guard against raw source, diffs, patches, snippets, secrets, local paths, `.env` markers, runner IDs, task packets, and run artifacts. Validation passed with focused setup PR E2E/unit/UI coverage plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-084` updates the full local runner E2E to use a Cortex Task source. The happy-path fixture now starts as an approved local-runner Cortex Task, converts to a schema-valid TaskPacket without embedding a web-supplied worktree path, and executes through the existing mocked Codex, validation, commit, push, and mocked PR artifact loop. The runner now computes a safe local worktree path from runner config before dry-run for TaskPackets that omit `repo.worktreePath`, preserving the runner-owned local execution boundary. Validation passed with focused runner E2E/run/worktree coverage plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-085` updates the web-to-runner protocol E2E. The service-level protocol test now covers manual queued jobs and Cortex Task-derived queued jobs through poll, claim, run event submission, validation result submission, PR artifact submission, and Cortex Task PR artifact linkage by run ID. The same coverage verifies current-run cancellation polling returns cancellation metadata before new work and repair jobs are exposed only when a repair TaskPacket exists. Validation passed with focused protocol suites plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-086` updates the TASK-184 browser happy-path smoke coverage. The new smoke guard covers protected route reachability, server-rendered repo scan onboarding, findings, Cortex Tasks, setup PRs, runs, runners, and approvals, and mobile layout assertions for scroll-contained tables plus reachable primary CTAs. The Cortex Task execution-mode form now stacks on narrow screens, and the paired runners table has an accessible label. Validation passed with the focused smoke test, Playwright CLI mobile/desktop geometry checks, plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-087` updates the TASK-185 MVP acceptance checklist. `docs/MVP_ACCEPTANCE.md` now maps repo scan onboarding, findings/task generation, setup PR creation, optional runner execution, and security boundary checks to concrete automated evidence plus manual release-review checks. `scripts/codex-runner/mvp-acceptance.test.ts` verifies required checklist lanes, evidence paths, status/manual-check fields, and trust-boundary language. Validation passed with the focused checklist test plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-088` runs the TASK-186 full MVP validation suite after the repo-readiness refactor. Focused MVP E2E coverage passed for hosted repo scan onboarding, setup PR creation, Cortex Task-derived local runner execution, runner protocol polling/claims/events/artifacts, browser happy-path smoke coverage, and the acceptance checklist. Focused security-boundary coverage passed for payload guards, audit/idempotency, redaction, shared payload safety, and runner blocked paths. Root validation passed with `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

`RFB-089` prepares the updated MVP release notes. `docs/MVP_RELEASE_NOTES.md` now documents release-candidate status, repo-readiness onboarding, Cortex Tasks, setup PRs, optional runner execution, intentionally deferred work, known risks/limitations, pre-marketing release-review checks, and runtime setup status. `docs/PRODUCTION_RUNTIME_SETUP.md` documents the required production variables without secret values, `apps/web/src/runtime/env.ts` provides a sanitized readiness checker, `pnpm production-runtime:check` gives operators a no-value runtime readiness command, `pnpm production-smoke:check` verifies deployed public/protected route reachability without printing response bodies, `scripts/codex-runner/mvp-release-notes.test.ts` verifies the required release-note lanes and trust-boundary language, and the Supabase config guard verifies local CLI boundary documentation plus canonical migration ownership. Validation passed with the focused release/production/Supabase guard tests plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.

The post-`RFB-089` release wiring pass pushed `main`, launched the Vercel production app at `https://cortex-two-mu.vercel.app`, and smoke-tested `rory-hayes/payslip-peeks-and-probes.git` through metadata-only GitHub inventory, repo-readiness scan modules, Playwright public/protected route checks, and a local runner dry run. `docs/MVP_RELEASE_NOTES.md` now includes a runtime setup status section for production credentials and Supabase CLI boundaries, and `docs/PRODUCTION_RUNTIME_SETUP.md` documents the required production environment variables without secret values. A 2026-06-03 signup repair switched the active auth shell from Clerk to Auth0, added the Auth0 client/proxy/session wiring, kept `/sign-up` as a compatibility route, and verified the configured signup path redirects to Auth0 with `screen_hint=signup`; a June 4, 2026 redirect repair now sends sign-in and sign-up transactions back to `/dashboard` after authentication and updates production smoke coverage for that return target. Production database verification still has the `pnpm supabase-db:check` guard but needs the real database-password-backed `DATABASE_URL`; local Supabase migration listing requires local services to be running; and direct DB query/advisor checks should use a newer CLI, MCP, or `psql` once the database password is available. The runner dry-run probe surfaced and fixed a capability-detection mutation path where Corepack/Yarn could edit a target repo `package.json`; capability probes now run from a neutral probe directory. Full production manual testing remains blocked until a real Supabase `DATABASE_URL` and GitHub App credentials are configured.

A follow-up verification pass added `pnpm release-readiness:check`, which composes sanitized local runtime env checks, Vercel production env-name checks, deployed route smoke, local Supabase link, Supabase migration history, direct Supabase database connectivity, and Supabase endpoint checks into one release gate. Its text and JSON output stay status-only and avoid secret values, Supabase refs, database URLs, API keys, private keys, response bodies, local paths, query output, and raw `psql` errors.

`RFB-080` adds hostile payload coverage for repo-readiness Findings and Cortex Tasks across shared schemas, web payload guards, persistence services, server actions, and rendered list UI. The hardening widens unsafe key aliases for raw source, diffs, patches, snippets, file contents, secrets, private keys, raw logs, stdout/stderr summaries, and raw command output while preserving redacted runner `ValidationResult` summary fields as an allowed protocol shape.

`RFB-077` completes the token-storage documentation/checks follow-up after manual review of the stale `TASK-178` branch. The current-tree implementation adds `docs/TOKEN_STORAGE_SECURITY.md`, a reviewed `SECURITY_MODEL.md` pointer, and `apps/web/src/security/token-storage.test.ts` coverage for runner credential hashes, GitHub server-only credential handling, Linear sealed token storage and revocation clearing, Auth0 server-side environment boundaries, server-only database access, placeholder-only env examples, client-bundle import boundaries, and database hash/ciphertext columns without exposing token values.

`RFB-081` completes the security hardening milestone with `RFB-077` unblocked. The milestone now covers protocol payload filtering, scan and setup PR boundaries, findings/task hostile payload coverage, token-storage checks, runner non-exfiltration blocked paths, the updated security documentation boundary, and runner timeout cleanup regression coverage for descendants spawned during shutdown. Validation passed with focused security suites, `pnpm test` (258 files, 3153 tests), `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `git diff --check`, a clean credential-marker audit, and no open/in-progress backlog statuses.

`RFB-076` closes the old `TASK-174` protocol payload boundary gap by treating runner capability values as web-bound protocol data. Capability strings now reject source-like, diff, patch, snippet, raw-log, secret-like, environment-reference, and control-character payloads across link, heartbeat, poll, claim, and dry-run result paths while preserving safe tool path metadata in the v1 contract and keeping hosted UI surfaces summary-oriented.

`RFB-058` adds the canonical Cortex Task external-link model for GitHub Issues, Linear issues, Jira issues, pull requests, and documentation links. Shared contracts now normalize legacy `label/url/externalId` links into safe provider/resource/title/status fields, tasks remain valid with `externalLinks: []`, and the web database has a normalized `cortex_task_external_links` table for workspace-scoped lookup and external-ID deduplication while preserving metadata-only storage and rejecting credentialed URLs, secret query params, local paths, snippets, raw logs, command output, and source-like payloads before persistence.

`RFB-055` reframes Linear as an explicit external import path. Ready Linear issue candidates can now be imported into draft Cortex Tasks only after a user selects a target GitHub repository; imported tasks use `origin.type: "external_import"`, `origin.externalSystem: "linear"`, conservative `planning_only` execution, `not_requested` approval, and canonical Linear external links. The import service, server action, API route, and UI avoid approval, queue, assignment, run, task packet, and runner mutations.

`RFB-056` adds outbound GitHub Issues sync for approved scan-generated Cortex Tasks. The GitHub App client can create issues through the installation request transport while returning only safe issue metadata. The web sync service requires workspace membership, a registered GitHub repository with optional `issues: write`, shared `CortexTaskSchema` validation, and safe task body material only; it creates a GitHub issue with task objective, acceptance criteria, risk, suggested validation labels, repository metadata, and an optional Cortex URL. Sync writes one canonical `github_issue` external link to the Cortex Task and normalized external-link table, prevents duplicate pushes, records metadata-only audit events, and does not create approvals, queue jobs, runs, task packets, runner assignments, or PR artifacts. The UI exposes `/dashboard/tasks/sync-github-issues` plus task/queue CTAs while preserving the hosted metadata-only boundary.

`RFB-057` adds outbound Linear sync for approved scan-generated Cortex Tasks. The sync requires an active unexpired Linear OAuth connection, user-selected team/project/status metadata, shared `CortexTaskSchema` validation, and safe task body material only; the web-side Linear client keeps option listing and issue creation bounded behind generic token-free errors. It creates or updates a Linear issue with safe task details, finding counts, suggested validation labels, and an optional server-configured Cortex URL, writes one canonical `linear_issue` external link to the Cortex Task and normalized external-link table, and does not create approvals, queue jobs, runs, task packets, runner assignments, or PR artifacts. Validation passed with `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`; the next recommended task remains the merge-queue-selected ready item after RFB-057 lands.

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
