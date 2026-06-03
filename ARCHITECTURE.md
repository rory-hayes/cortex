# Architecture

## System Shape

The product is a web-first AI engineering control plane coupled with a local execution runner.

The web app coordinates work:

- Workspaces
- Users
- Repository registrations
- Runner pairing
- Task packets
- Run state
- Run events
- Validation summaries
- PR artifacts
- Approvals
- Audit history

The runner executes work:

- Local repo inspection
- Policy parsing
- Dry-run readiness checks
- Worktree and branch creation
- Codex invocation
- File-change scanning
- Validation commands
- Commit and push
- PR creation through `gh`

The web app must not need source-code access to coordinate the loop.

## Core Boundary

The runner is the executor. The web app is the coordinator.

The runner may read source code locally and pass local context to Codex. The runner must not send raw source code, diffs, patches, or code snippets to the web app.

Allowed web-bound data:

- Run metadata
- Task packet metadata
- Changed file paths
- Risk flags
- Validation command names
- Validation status
- Exit codes
- Redacted log summaries
- PR URL
- PR number
- Timestamps
- Runner capability metadata

Disallowed web-bound data:

- Raw source files
- Diffs
- Patches
- Code snippets
- `.env` contents
- Secrets
- Private keys
- Unredacted command output

## Monorepo Layout

```text
apps/
  web/
  runner/

packages/
  shared/
  db/
  github/
  linear/
  policies/
  validation/
  codex/
  logging/
```

## Package Responsibilities

### `apps/runner`

Local CLI and execution orchestrator.

Responsibilities:

- Parse CLI options.
- Load task packets.
- Run dry-run checks.
- Report capabilities.
- Manage worktrees and branches.
- Invoke Codex through `packages/codex`.
- Scan changed files through `packages/policies`.
- Run validation through `packages/validation`.
- Commit, push, and open PRs through local `git` and `gh`.
- Emit structured run events.

### `apps/web`

Hosted control plane.

Responsibilities:

- User signup and workspace creation.
- Runner pairing.
- Runner health and capability display.
- Repo mapping registration.
- Manual task packet creation.
- External task import from Linear into Cortex Task drafts.
- Job assignment.
- Run timeline.
- Cancellation requests.
- Validation and PR artifact display.
- Approval decisions.

### `packages/shared`

Versioned contracts used by runner and web.

Contains:

- `TaskPacket`
- `RunState`
- `RunEvent`
- `RepoPolicy`
- `RunnerProtocol`
- `ValidationResult`
- `ApprovalDecision`
- `RunnerCapabilities`
- `DryRunResult`

### `packages/policies`

Policy parsing and risk classification.

Responsibilities:

- Read repo policy config.
- Evaluate protected paths.
- Detect sensitive path changes.
- Detect suspected secrets.
- Classify warnings and hard blocks.
- Produce safe metadata for web-bound events.

### `packages/validation`

Validation command execution and result parsing.

Responsibilities:

- Execute configured commands.
- Capture exit code and duration.
- Summarize stdout/stderr.
- Redact logs before event submission.
- Produce `ValidationResult`.

### `packages/codex`

Codex adapter.

Responsibilities:

- Render local task packet prompt.
- Invoke `codex exec`.
- Capture local logs.
- Return execution status to the runner.

The package does not submit source code to the web app.

### `packages/github`

Local GitHub and future GitHub App helpers.

Sprint 1 responsibilities:

- Wrap local `git` and `gh` commands.
- Produce a mocked PR artifact in tests.

Later responsibilities:

- GitHub App metadata sync.
- Least-privilege GitHub App repository permission review for repo-readiness scans.
- PR status tracking.
- PR comments/webhooks.
- Checks visibility.

Repo-readiness scan-only mode requires only GitHub App `metadata: read` and
`contents: read` repository permissions and does not require runner installation. Setup
PR mode is a separate elevated path requiring `metadata: read`, `contents: write`, and
`pull_requests: write`. Optional PR visibility uses read-only `pull_requests: read` and
`checks: read`. The canonical matrix is `docs/GITHUB_APP_PERMISSIONS.md`; broad
permissions such as administration, secrets, actions/workflows write, checks write, and
issues write are outside the MVP profiles.

### `packages/db`

Database schema and typed persistence for the web control plane.

Not used in Sprint 1.

### `packages/linear`

Linear OAuth, issue candidate sync, and metadata-only external import support.

Linear imports create draft Cortex Tasks linked by canonical external links. They do not approve, queue, assign, create runs, or create runner task packets.

### `packages/logging`

Structured logging and redaction helpers used by runner and web.

## AI Cost Boundary

The hosted web app may use Cortex-key AI for metadata-only repo-readiness scanning, readiness report generation, task recommendation generation, and setup PR generation.

Source-changing implementation remains runner-owned by default. The runner invokes Codex locally and uses customer-owned local credentials, customer-owned API configuration, local git auth, and local `gh` auth for implementation, validation, push, and PR creation.

Any future Cortex-managed implementation execution path must be introduced as a separate architecture path with explicit credits or plan caps before work starts. It must not inherit the metadata-only scan/task generation allowance.

No hosted implementation execution path may run without a bounded spend and usage model.

## Execution Loop

1. User approves a task packet.
2. Runner receives or loads the job.
3. Runner reports capabilities.
4. Runner performs dry-run checks.
5. Runner creates a worktree and branch.
6. Runner invokes `codex exec`.
7. Runner scans changed files.
8. Runner blocks unsafe changes.
9. Runner runs validation.
10. Runner commits passing changes.
11. Runner pushes using local git auth.
12. Runner opens PR using local `gh`.
13. Runner submits metadata, validation result, and PR artifact.
14. Human approves, rejects, or requests repair.

## Phase Sequence

The architecture must be built in this order:

1. Contracts
2. Runner dry run
3. Fixture repo E2E with mocked Codex/`gh`
4. Minimal web app
5. Polling runner protocol
6. GitHub visibility
7. External task import
8. Safety hardening
9. Review and repair
10. Dashboard polish
11. Billing hooks
