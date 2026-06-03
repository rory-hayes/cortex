# Cortex MVP Plan

## Summary

Cortex scans your repo, creates AI-ready engineering tasks, and safely turns approved work into validated PRs.

The MVP proves two connected product loops:

- A web-first repo-readiness loop where a user connects a GitHub repo, reviews readiness findings, and turns approved findings into Cortex Tasks before installing a runner.
- A gated local-execution loop where the optional runner handles approved source-code work inside the customer's environment and opens validated PRs.

The product is a hybrid system:

- The hosted web app is the repo-readiness front door, AI execution queue, metadata coordinator, run-history surface, and approval surface.
- The local runner is the optional execution layer for approved work that requires local source-code changes.
- The runner never sends raw source code, diffs, patches, or code snippets to the web app.

The build order is:

1. Product contracts
2. Local runner proof
3. Minimal web control plane and repo-readiness front door
4. Runner protocol
5. GitHub visibility
6. External task import with Linear as the first optional channel
7. Safety and governance hardening
8. Review and repair loop
9. Product dashboard
10. Billing hooks

## CTO Recommendation

Keep the first technical proof boring and concrete while the product front door shifts to repo readiness. The biggest execution risk is still whether Cortex can reliably turn one approved task into one safe, validated, reviewable pull request, but users should get useful repo findings and AI-ready tasks before they install or link a runner.

The first sprint should therefore prove the contracts, runner dry run, and fixture repo E2E with mocked Codex and mocked `gh`, then the web surface should lead with repo scanning, findings, and the AI execution queue.

## Phase 0: Product Contracts First

Create versioned TypeScript contracts in `packages/shared` before runner or web implementation:

- `TaskPacket`
- `RunState`
- `RunEvent`
- `RepoPolicy`
- `RunnerProtocol`
- `ValidationResult`
- `ApprovalDecision`
- `RunnerCapabilities`
- `DryRunResult`

Each contract must include:

- `contractVersion`
- Runtime validation
- JSON serialization
- Fixture examples
- Backward-compatibility tests once a second version exists

## Phase 1: Local Runner Proof

Build only:

- `apps/runner`
- `packages/shared`
- `packages/policies`
- `packages/validation`
- `packages/codex`
- `packages/github`
- Fixture repo test harness

Runner requirements:

- Accept a local repo path.
- Accept a task packet.
- Support `dryRun` mode.
- Report capabilities for `git`, `node`, package managers, `python`, `gh`, `codex`, OS, shell, and max concurrency.
- Confirm the repo is clean.
- Read repo policy/config.
- Check branch and worktree readiness.
- Check validation command availability.
- Create a worktree and branch for real runs.
- Invoke Codex through `codex exec`.
- Scan changed files.
- Block `.env`, suspected secrets, and protected path edits.
- Run validation commands.
- Commit if validation passes.
- Push with local git auth.
- Open a PR using `gh`.
- Output structured run events with idempotency keys.

There is no Linear, hosted dashboard, billing, teams, hosted job assignment, GitHub App dependency, or real web control plane in this phase.

## Phase 2: Minimal Web Control Plane And Repo-Readiness Front Door

Build the smallest hosted app that can coordinate and display runs:

- Next.js App Router
- TypeScript
- Clerk
- Postgres
- Drizzle
- Tailwind/shadcn
- Vercel

The web app must support:

- Sign up.
- Create workspace.
- Connect GitHub.
- Select a repository.
- Run a repo-readiness scan.
- Show a readiness report with findings and recommended Cortex Tasks.
- Let users approve findings into the AI execution queue.
- Create a manual task packet when needed.
- Pair a runner with the workspace only when approved work needs local execution.
- Show runner online/offline status after pairing.
- Show runner capabilities after pairing.
- Register local repo mappings for runner-backed execution.
- Approve a task packet for execution.
- Assign an approved job to a runner.
- Request run cancellation.
- Show run timeline/events.
- Show dry-run result.
- Show validation result.
- Show PR URL/status.
- Show approval required.

Repo-readiness scanning, finding review, and AI-ready task creation come before runner installation. Manual task creation comes before external imports from Linear. GitHub App integration is not required for the local execution loop.

## Phase 3: Runner Protocol

Connect web and runner through outbound HTTPS polling.

Runner flow:

1. Link runner to workspace.
2. Report capabilities.
3. Send heartbeat.
4. Poll jobs.
5. Claim job with idempotency key.
6. Execute job locally.
7. Submit run events idempotently.
8. Submit dry-run result when applicable.
9. Submit validation result.
10. Submit PR artifact.
11. Poll for cancellation, repair, or close.

Avoid WebSockets initially. Polling is simpler, safer, and sufficient for v1.

Critical rule: the runner is the executor; the web app is the coordinator.

## Phase 4: GitHub Integration

Add GitHub App/OAuth for visibility, not execution.

GitHub App responsibilities:

- Repo metadata sync.
- Repo-readiness scan-only permission review with `metadata: read` and `contents: read`.
- Separate setup PR permission review with `contents: write` and `pull_requests: write`.
- Optional read-only PR/check status visibility.
- Installation status.
- PR status tracking.
- PR comments/webhooks.
- Checks visibility.
- User/team permissions later.

For v1, branch push and PR creation still happen from the runner using local `git` and `gh` auth.
The canonical least-privilege matrix is `docs/GITHUB_APP_PERMISSIONS.md`. GitHub App setup PR authority does not replace local-runner execution authority, and broad permissions such as administration, secrets, actions/workflows write, checks write, and issues write are outside the MVP profiles.

## Phase 5: External Task Import And Linear Sync

Add Linear as the first optional external import/sync channel. Linear is not the onboarding front door or the system of record for Cortex Tasks.

Support:

- Linear OAuth.
- Workspace/project sync.
- Issue list.
- `Ready for AI` status or label.
- Manual `Import from Linear` action.
- Draft Cortex Task creation from sanitized issue candidate metadata.
- Canonical Linear external links on imported Cortex Tasks.
- Separate human approval before queueing, assignment, run creation, or task packet generation.
- Optional status updates: queued, running, PR opened, blocked.

Do not auto-run eligible tickets. Importing creates a draft only; the user approves tasks into the queue separately.

## Phase 6: Safety And Governance Hardening

Hard-block:

- Dirty repo.
- Wrong or protected branch.
- Missing repo mapping.
- Missing validation config.
- Missing required runner capability.
- `.env` changes.
- Suspected secrets.
- Protected path edits.
- Failed validation.
- Stale lock.
- Duplicate assignment.
- Cancelled run.

Warn or flag high risk:

- Package lock changes.
- Database migrations.
- Infrastructure files.
- Auth or billing code.
- Large diff.
- Too many files changed.
- Untracked generated files.
- Validation skipped.

Every block and warning must be visible in the run trace and PR summary.

## Phase 7: Review And Repair Loop

The review page should show:

- Original task.
- Acceptance criteria.
- Task packet.
- Changed file paths.
- Validation results.
- Risk flags.
- Redacted logs.
- PR link.
- Approve, reject, or request repair.

Repair is manual only:

1. User clicks `Request Repair`.
2. System creates a repair packet.
3. Runner reruns Codex with previous context and feedback.
4. Validation runs again.
5. PR updates.

Retry limit: 1-2 repair attempts per run.

## Phase 8: Product Dashboard

Build dashboard polish after the loop works.

Core pages:

- Overview
- Repositories
- Tasks
- Runs
- Pull Requests
- Runners
- Approvals
- Audit Log
- Settings

The overview answers only:

- Is my runner online?
- What is ready?
- What is running?
- What failed?
- What needs approval?

Do not overload the MVP with charts.

## Value Before Runner Installation

Users should get value from Cortex before local execution is enabled:

- Repo readiness report.
- Missing-doc, validation, policy, and safety findings.
- AI-ready Cortex Tasks created from approved findings.
- Queue visibility for what can safely move forward today.
- Recommendations for setup PRs, validation, and protected paths.

The runner is introduced only when the user approves work that needs local source-code execution. Runner setup remains gated by human approval, repo mapping, policy checks, dry-run readiness, and validation.

## Phase 9: Billing Hooks Only

Add plan fields but no full billing launch:

- `plan`
- `runner_limit`
- `repo_limit`
- `monthly_run_limit`
- `usage_count`
- `stripe_customer_id`
- `stripe_subscription_id`

Stripe remains behind a feature flag and must not block MVP validation.

## Managed Execution Cost Boundary

Cortex-key AI usage is allowed for repo-readiness scanning, readiness report generation, task recommendation generation, and setup PR generation.

Source-changing implementation execution defaults to customer-owned local runner credentials and customer-owned Codex or API usage.

Any future Cortex-managed implementation execution path must require explicit credits or plan caps before work starts.

No Cortex-managed implementation execution path may run with unlimited spend or uncapped usage.

## V1 Acceptance Criteria

V1 is done when:

- User signs up.
- User creates a workspace.
- User connects GitHub.
- User selects one repository.
- Cortex runs a repo-readiness scan.
- User sees a readiness report and findings.
- User approves at least one finding into an AI-ready Cortex Task.
- User can review the AI execution queue before installing a runner.
- User optionally installs and links a runner for approved local execution.
- User sees runner capabilities after runner pairing.
- User maps one local repo for runner-backed execution.
- System creates a task packet.
- Runner performs a dry run for approved execution.
- Runner creates worktree/branch.
- Runner invokes Codex CLI.
- Runner runs validation.
- Unsafe changes are blocked.
- Passing changes are committed and pushed.
- PR is opened.
- Web app shows redacted run trace, validation, and PR.
- Human approves, rejects, or requests repair.

## Explicit Deferrals

Defer:

- Slack
- Notion
- Jira
- Broad company crawling
- Auto-merge
- Hosted execution
- Multi-agent orchestration
- Complex billing
- Enterprise SSO
- SOC2 automation
- Advanced analytics
- Mobile app
