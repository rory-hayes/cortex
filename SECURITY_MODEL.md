# Security Model

## Trust Boundary

The system is designed around a strict trust boundary:

- The web app coordinates work and stores metadata.
- The runner executes code-related work locally.
- Source code stays in the local or customer-controlled environment.

The runner must never send raw source code, diffs, patches, code snippets, `.env` contents, secrets, credentials, or private keys to the web app.

## Allowed Web-Bound Data

The runner may send:

- Runner capabilities
- Repo mapping metadata
- Task packet metadata
- Run state
- Run events
- Changed file paths
- Risk flags
- Validation command names
- Exit codes
- Redacted stdout/stderr summaries
- PR URL
- PR number
- PR status
- Timestamps
- Audit metadata

## Disallowed Web-Bound Data

The runner must not send:

- Raw source files
- Raw diffs
- Patch text
- Code snippets
- `.env` values
- API keys
- Tokens
- Passwords
- Private keys
- Unredacted logs
- Full dependency graphs containing private code paths beyond changed path metadata

## Redaction

Redaction runs before any log or command output leaves the runner.

Redaction must target:

- `.env` key/value lines
- API keys
- Access tokens
- OAuth tokens
- GitHub tokens
- Linear tokens
- OpenAI keys
- Private key blocks
- Password-like assignments
- High-entropy strings
- URLs containing credentials

Validation results include `redactionApplied`.

## Hard Blocks

The runner must stop before commit, push, or PR creation when it detects:

- Dirty repo before execution.
- Wrong or protected branch.
- Missing repo mapping.
- Missing validation config.
- Missing required capability.
- `.env` changes.
- Suspected secrets.
- Protected path edits.
- Failed required validation.
- Stale lock.
- Duplicate assignment.
- Cancelled run.

Hard blocks are emitted as structured run events and visible in the web app.

## Warning And High-Risk Flags

The runner may continue while flagging:

- Package lock changes.
- Database migrations.
- Infrastructure files.
- Auth code.
- Billing code.
- Large diff.
- Too many files changed.
- Untracked generated files.
- Skipped optional validation.

Warnings must appear in the run trace and PR summary.

## Local Credentials

For v1:

- Branch push uses local git auth.
- PR creation uses local `gh` auth.
- The control plane does not receive source-code write credentials for execution.
- GitHub App integration later provides visibility, metadata sync, webhooks, and checks tracking, not runner execution authority.

## Token And Secret Storage

Token and secret storage rules are documented in `docs/TOKEN_STORAGE_SECURITY.md`.

The short version is: runner pairing codes and runner credentials are one-time or local-only
materials, hosted services store only hashes or sealed ciphertext where persistence is required,
GitHub App, Auth0, and webhook credentials stay server-side, the current Auth0 integration does
not require browser-visible auth credentials, and `DATABASE_URL` must not become
`NEXT_PUBLIC_DATABASE_URL`.

## Cost And Execution Authority

Cortex-key AI may be used for repo-readiness scans, readiness report generation, task recommendation generation, and setup PR generation because those hosted paths are metadata-only and plan-limited.

Source-changing implementation execution defaults to customer-owned local runner credentials and customer-owned Codex or API usage.

Any future Cortex-managed implementation execution path must require explicit credits or plan caps before work starts, and it must preserve the same source-boundary restrictions as the local-runner model.

No Cortex-managed implementation execution path may run with unlimited spend or uncapped usage.

## Dry-Run Safety

Dry run must not invoke Codex, commit, push, open PRs, or modify repository files.

Dry run verifies:

- Repo cleanliness.
- Policy presence.
- Validation command config.
- Tool availability.
- Worktree/branch readiness.
- Protected path configuration.
- Runner capability match.

Dry run output is safe metadata only.

## Cancellation Boundaries

Cancellation is enforced before:

- Codex invocation.
- Validation start.
- Each validation command.
- Commit.
- Push.
- PR creation.
- Repair attempt.

If cancellation arrives during a child process, the runner stops the child process when safe and emits a cancellation event.

## Auditability

Every consequential action must produce a structured event:

- Claim job.
- Dry run started/completed.
- Capability report.
- Worktree created.
- Codex started/completed.
- File scan completed.
- Block detected.
- Warning detected.
- Validation started/completed.
- Commit created.
- Branch pushed.
- PR opened.
- Cancellation requested/completed.
- Repair requested/completed.
- Approval decision.

Events are append-only and idempotent.

## Security Test Requirements

Tests must prove:

- Raw source code is not sent to web-bound protocol functions.
- Diffs and patches are rejected from event payloads.
- `.env` changes hard-block.
- Suspected secrets hard-block.
- Redaction removes common secret patterns.
- Cancellation prevents commit, push, and PR creation.
- Duplicate job claims do not create duplicate runs.
- Duplicate event submissions do not create duplicate events.
