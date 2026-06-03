# MVP Acceptance Checklist

Last updated: June 2, 2026

This checklist maps the Cortex MVP acceptance criteria to concrete validation evidence. Every row must have either automated evidence or a manual check before release readiness can be claimed.

The runner is the executor; the web app is the coordinator. Source stays local for implementation execution. Raw source, diffs, patches, code snippets, `.env` contents, secrets, private keys, and unredacted command output must not cross into hosted payloads. Hosted setup PR surfaces store generated file metadata only.

## Repo Scan Onboarding

| Acceptance item | Required evidence | Status source | Manual check |
| --- | --- | --- | --- |
| Connect GitHub before runner pairing. | `pnpm test -- apps/web/src/repo-readiness/onboarding-e2e.test.tsx` | `RFB-082` | Confirm the first useful path starts with GitHub connection and not runner setup. |
| Select repository with scan-only readiness state. | `pnpm test -- apps/web/src/repo-readiness/onboarding-e2e.test.tsx` | `RFB-082` | Confirm scan-ready repositories can be selected and blocked repositories cannot be submitted. |
| Describe product goal before scan. | `pnpm test -- apps/web/src/repo-readiness/onboarding-e2e.test.tsx` | `RFB-082` | Confirm bounded product goal text can be submitted without source-like or secret text. |
| Run scan and land on a visible readiness path. | `pnpm test -- apps/web/app/task-184-browser-happy-path-smoke.test.tsx` | `RFB-086` | Confirm the browser smoke shows scan onboarding without visual overlap or hidden primary CTAs. |

## Findings And Task Generation

| Acceptance item | Required evidence | Status source | Manual check |
| --- | --- | --- | --- |
| Readiness report renders safe score, category, and next-action metadata. | `pnpm test -- apps/web/src/repo-readiness/onboarding-e2e.test.tsx apps/web/app/readiness-report-ui.test.tsx` | `RFB-043`, `RFB-082` | Confirm report links lead to findings and task recommendation surfaces. |
| Findings review renders evidence summaries and safe relative paths only. | `pnpm test -- apps/web/app/findings-list-ui.test.tsx` | `RFB-044` | Confirm finding evidence never renders source, diffs, patches, snippets, secrets, or local paths. |
| Task recommendation approval creates draft Cortex Task records. | `pnpm test -- apps/web/src/repo-readiness/onboarding-e2e.test.tsx apps/web/src/repo-readiness/task-recommendations.test.ts` | `RFB-038`, `RFB-082` | Confirm approval does not queue runner execution or create a run. |
| Cortex Task queue shows approved intent, risk, validation labels, and execution mode. | `pnpm test -- apps/web/app/cortex-task-queue-ui.test.tsx` | `RFB-046`, `RFB-061`, `RFB-062` | Confirm the queue answers what can safely move forward today before local execution. |

## Setup PR Creation

| Acceptance item | Required evidence | Status source | Manual check |
| --- | --- | --- | --- |
| Approved setup tasks create a metadata-only preview. | `pnpm test -- apps/web/src/setup-pr/e2e.test.tsx apps/web/app/setup-pr-flow-ui.test.tsx` | `RFB-050`, `RFB-083` | Confirm preview rows show filenames, summaries, review instructions, and omitted generated file bodies. |
| User can create a draft setup PR through the setup PR flow. | `pnpm test -- apps/web/src/setup-pr/e2e.test.tsx` | `RFB-051`, `RFB-053`, `RFB-083` | Confirm the PR is draft, linked to the setup preview, and not treated as local runner execution. |
| Generated file body omitted is preserved in hosted setup PR evidence. | `pnpm test -- apps/web/src/setup-pr/e2e.test.tsx apps/web/src/setup-pr/creation.test.ts` | `RFB-050`, `RFB-079`, `RFB-083` | Confirm hosted setup PR surfaces store generated file metadata only. |
| Setup PR writer blocks paths outside the approved template allowlist. | `pnpm test -- apps/web/src/setup-pr/creation.test.ts` | `RFB-079` | Confirm source files, real `.env` paths, unapproved root files, and unapproved workflow files are blocked. |

## Optional Runner Execution

| Acceptance item | Required evidence | Status source | Manual check |
| --- | --- | --- | --- |
| Local runner is optional until approved local execution is needed. | `pnpm test -- apps/web/app/cortex-task-queue-ui.test.tsx` | `RFB-061`, `RFB-086` | Confirm the queue keeps setup PR and planning paths available without a runner. |
| Approved Cortex Task can become a local execution packet without a web-supplied worktree path. | `pnpm test -- apps/runner/test/e2e/runner-happy-path.test.ts` | `RFB-084` | Confirm the runner computes local worktree metadata and keeps local path ownership runner-side. |
| Runner protocol can poll, claim, submit events, validation, and PR artifact metadata. | `pnpm test -- apps/web/src/jobs/runner-protocol-e2e.test.ts` | `RFB-085` | Confirm duplicate claims/events stay idempotent and cancellation/repair boundaries remain visible. |
| Validated local execution opens or reports a reviewable PR artifact. | `pnpm test -- apps/runner/test/e2e/runner-happy-path.test.ts apps/web/src/jobs/runner-protocol-e2e.test.ts` | `RFB-084`, `RFB-085` | Confirm PR artifact metadata contains URL/number/status only and no raw implementation material. |

## Security Boundary Checks

| Acceptance item | Required evidence | Status source | Manual check |
| --- | --- | --- | --- |
| Hosted payload guards reject raw source, diffs, patches, code snippets, secrets, `.env` markers, and unredacted output. | `pnpm test -- apps/web/src/security/payload-guard.test.ts packages/shared/src/payload-safety.test.ts` | `RFB-010`, `RFB-080` | Confirm unsafe keys and source-like strings fail before persistence or hosted rendering. |
| Runner hard-blocks `.env`, suspected secrets, protected paths, failed validation, dirty repos, and cancellation before commit/push/PR. | `pnpm test -- apps/runner/test/e2e/runner-blocked-paths.test.ts` | Safety gate milestone | Confirm blocked runs stop before commit, push, PR creation, or unsafe artifact submission. |
| Redaction removes secret patterns from command output summaries. | `pnpm test -- packages/logging/src/redact.test.ts packages/validation/src/redact.test.ts` | Redaction coverage | Confirm validation summaries are redacted before any web-bound payload. |
| Audit and protocol idempotency preserve reviewability without source exfiltration. | `pnpm test -- apps/web/test/security/audit-events.test.ts apps/web/test/security/claim-idempotency.test.ts apps/web/src/jobs/runner-protocol-e2e.test.ts` | `RFB-085` | Confirm audit data remains IDs, statuses, counts, timestamps, and safe metadata only. |

## Final Validation Commands

Run these before marking the MVP release candidate ready:

| Command | Purpose | Status source |
| --- | --- | --- |
| `pnpm run typecheck` | Compile-time contract and app/package validation. | `RFB-088` |
| `pnpm run lint` | Static code quality validation. | `RFB-088` |
| `pnpm run format:check` | Repository formatting validation. | `RFB-088` |
| `pnpm test` | Full automated unit, integration, E2E, protocol, and security suite. | `RFB-088` |

## Manual Release Review

Before marketing or broad user testing, manually verify:

- A new user can sign up, create/select a workspace, connect GitHub, select a repository, Describe product goal, and Run scan.
- Readiness report, Findings review, Task recommendation approval, and Cortex Task queue pages are understandable without installing a runner.
- Setup PR Creation can produce a metadata-only preview and a draft setup PR for approved setup tasks.
- Optional Runner Execution remains gated behind approval, dry run, validation, local commit/push/PR creation, and human review.
- Security Boundary Checks remain visible in reports, run detail, approval queue, PR artifact views, and repair flows.
