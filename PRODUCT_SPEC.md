# Cortex Product Specification

## Product Positioning

Cortex scans your repo, creates AI-ready engineering tasks, and safely turns approved work into validated PRs.

The product front door is repo readiness and the AI execution queue. The local runner is an optional, gated execution layer for approved work that needs source-code changes in a customer-controlled environment.

## Primary User Flow

1. User signs up and creates a workspace.
2. User connects GitHub.
3. User selects a repository.
4. User describes what the repo or product is meant to be.
5. Cortex runs a repo-readiness scan.
6. Cortex shows a readiness report with findings, severity, evidence summaries, and recommended next tasks.
7. User approves findings into Cortex Tasks.
8. Cortex places approved tasks in the AI execution queue.
9. User can create setup PRs, sync tasks outward, or enable local runner execution when source-code work is ready.
10. If local execution is enabled, the runner performs approved work locally, validates it, opens a PR, and reports metadata back to Cortex.
11. Cortex tracks PRs, validation evidence, approvals, repair requests, recurring scans, and weekly review signals.

## Value Before Runner Installation

Cortex must be useful before a user installs or links the local runner.

Pre-runner value includes:

- Repo-readiness reports.
- Findings for missing docs, weak validation, unsafe paths, unclear backlog items, and incomplete AI-execution setup.
- AI-ready Cortex Tasks created from approved findings.
- Queue visibility around what can safely move forward today.
- Recommendations for validation, policy, protected paths, and setup work.
- Safe metadata and evidence summaries that help a human decide what to approve next.

Runner installation must not be the first onboarding call to action. It appears only when a user wants Cortex to execute approved work locally.

## GitHub App Permission Modes

GitHub App repo-readiness permissions are reviewed in two separate modes:

- Scan-only requires `metadata: read` and `contents: read`. It supports readiness findings and setup recommendations before runner pairing.
- Setup PR requires `metadata: read`, `contents: write`, and `pull_requests: write`. It is an elevated setup path, not general hosted execution authority.

Scan-only mode does not require local runner installation. GitHub App visibility and setup PRs do not replace the local runner for approved source-code execution.
The canonical permission matrix is `docs/GITHUB_APP_PERMISSIONS.md`; broad permissions such as administration, secrets, actions/workflows write, checks write, and issues write are outside the MVP profiles.

## AI Execution Queue

The AI execution queue contains Cortex Tasks that are ready for human review and approval.

Each queued task should have:

- A clear objective.
- Acceptance criteria.
- Repository metadata.
- Risk and readiness flags.
- Suggested validation.
- Approval state.
- Execution mode.
- Links to run, PR, repair, or external task metadata when available.

External task metadata is represented as safe Cortex Task external links. The MVP supports GitHub Issues, Linear issues, Jira issues, pull requests, and documentation links without requiring external sync before a task can exist. Hosted surfaces may show provider, resource type, external ID, HTTPS URL, safe title, safe external status, and sync timestamp only.

The queue answers: what can safely move forward today?

## AI Cost Boundary

Cortex-key AI usage is allowed for repo-readiness scanning, readiness report generation, task recommendation generation, and setup PR generation.

These Cortex-key paths are metadata-first product assistance: they produce findings, reports, task recommendations, and deterministic setup PR material under plan limits. They do not authorize hosted source-changing implementation.

Source-changing implementation execution defaults to customer-owned local runner credentials and customer-owned Codex or API usage.

Any future Cortex-managed implementation execution path must require explicit credits or plan caps before work starts.

No Cortex-managed implementation execution path may run with unlimited spend or uncapped usage.

## External Task Import

Linear is an optional external import path into Cortex, not the onboarding front door. Synced Linear issues marked Ready for AI can be imported only after the user selects a target GitHub repository. Importing creates a draft Cortex Task with a canonical Linear external link.

External imports must not approve tasks, queue runner work, assign jobs, create runs, or create runner task packets. Human review and approval remain separate steps after import.

## Local Runner Role

The runner is the executor. The web app is the coordinator.

The runner:

- Runs in a local or customer-controlled environment.
- Executes only approved work.
- Performs dry-run readiness checks before real execution.
- Creates local worktrees and branches for approved runs.
- Invokes Codex locally.
- Scans changed paths and risk flags locally.
- Runs validation locally.
- Commits, pushes, and opens PRs through local git and `gh` credentials.
- Sends only safe metadata and evidence summaries back to Cortex.

The runner is not required for repo-readiness scans, finding review, Cortex Task creation, or queue review.

## Trust Boundary

Cortex preserves the existing local-runner trust boundary.

The hosted web app may store:

- Workspace and repository metadata.
- Readiness findings.
- Cortex Task metadata.
- Queue state.
- Runner capability metadata.
- Run state and timestamps.
- Changed file paths.
- Risk flags.
- Validation command names and status.
- Exit codes.
- Redacted log summaries.
- PR URL, number, branch, and status.
- Audit metadata.

The hosted web app must not receive:

- Raw source code.
- Diffs.
- Patches.
- Code snippets.
- `.env` contents.
- Secrets.
- Private keys.
- Unredacted command output.

When in doubt, Cortex stores less and keeps source-bound data local.

## Deferred Work

The MVP does not include:

- Hosted source-code execution.
- Broad company crawling.
- Slack, Notion, or Jira intake.
- Auto-merge by default.
- Multi-agent orchestration.
- Full billing launch.
- Enterprise SSO.
- SOC2 automation.
- Advanced analytics.
- Mobile apps.
