# Runner Protocol

## Protocol Principles

- The runner communicates with the web app through outbound HTTPS polling.
- The runner executes locally; the web app coordinates.
- The runner claims one job at a time unless its capabilities explicitly report higher concurrency.
- Job claims and event submissions are idempotent.
- Cancellation is cooperative and checked at every major execution boundary.
- The runner never sends raw source code, diffs, patches, or code snippets to the web app.

## Runner Linking

The web app displays a short-lived pairing code.

Runner command:

```bash
runner link --code <pairing-code>
```

Linking returns:

- `runnerId`
- Workspace association
- Runner credential
- Polling base URL
- Initial polling interval

The runner stores credentials locally.

## Capability Reporting

The runner reports capabilities during link and heartbeat.

Capabilities include:

- OS platform, release, and architecture
- Shell
- `git`
- `gh`
- `codex`
- `node`
- `npm`
- `pnpm`
- `yarn`
- `python`
- Max concurrent jobs
- Dry-run support
- Cancellation support

The web app uses capabilities to decide whether a runner can accept a job.

## Heartbeat

Heartbeat request:

```text
POST /runner/heartbeat
```

Includes:

- `runnerId`
- `contractVersion`
- `status`
- `currentRunId`
- `capabilities`
- `timestamp`

Heartbeat response includes:

- Server time
- Poll interval
- Cancellation request for current run, if any
- Repair or close instruction, if any

## Job Polling

Polling request:

```text
POST /runner/jobs/poll
```

Includes:

- `runnerId`
- `capabilities`
- `availableConcurrency`
- `knownCurrentRunIds`

Polling response includes zero or more eligible jobs. For v1 the runner executes at most one job at a time.

## Job Claim Idempotency

Claim request:

```text
POST /runner/jobs/claim
```

Includes:

- `runnerId`
- `jobId`
- `runId`
- `idempotencyKey`
- `capabilitiesSnapshot`

Idempotency key format:

```text
runner:{runnerId}:claim:{jobId}:{runId}
```

Server behavior:

- First valid claim wins.
- Retrying the same idempotency key returns the same claim result.
- A different runner claiming an already claimed job receives a conflict.
- A duplicate assignment becomes a hard block in the run trace.

## Run Event Submission

Event request:

```text
POST /runner/runs/events
```

Includes:

- `runId`
- `eventId`
- `idempotencyKey`
- `state`
- `severity`
- `message`
- `metadata`
- `createdAt`

Idempotency key format:

```text
run:{runId}:event:{stableStepName}:{attempt}
```

Server behavior:

- Store one event per idempotency key.
- Return existing event on retry.
- Preserve event order by `createdAt` and server receive time.
- Reject events containing disallowed raw code payload fields.

## Dry-Run Execution

Dry run is available from CLI and from the web protocol.

Dry run checks:

- Repo path exists.
- Repo is a git repository.
- Repo is clean.
- Current branch is not protected.
- Repo policy/config exists and parses.
- Required validation commands are configured.
- Required tools are available.
- Branch name can be created.
- Worktree target path is available.
- Protected and sensitive paths are configured.
- Runner capabilities satisfy task packet requirements.

Dry run must not:

- Invoke Codex.
- Create commits.
- Push branches.
- Open PRs.
- Modify source files.

Dry run may create and remove temporary probe files outside the repo if needed.

## Execution Flow

1. Runner claims job.
2. Runner emits `claimed`.
3. Runner performs dry run.
4. Runner emits `dry_run_running`.
5. Runner submits `DryRunResult`.
6. If dry run fails, runner emits `blocked` or `failed`.
7. Runner creates worktree and branch.
8. Runner emits `worktree_created`.
9. Runner invokes `codex exec`.
10. Runner emits `codex_running`.
11. Runner scans changed files.
12. Runner emits `changes_scanned`.
13. Runner blocks unsafe changes.
14. Runner runs validation.
15. Runner emits `validation_running`.
16. Runner submits `ValidationResult`.
17. Runner commits passing changes.
18. Runner pushes branch.
19. Runner opens PR through `gh`.
20. Runner submits PR artifact.
21. Runner emits `awaiting_approval`.

## Cancellation

The web app can request cancellation for a queued, claimed, dry-running, preflight, Codex-running, validation-running, or repair-running job.

The runner checks cancellation:

- Before dry run starts.
- After dry run completes.
- Before worktree creation.
- Before Codex invocation.
- After Codex returns.
- Before validation.
- Between validation commands.
- Before commit.
- Before push.
- Before PR creation.
- Before repair execution.

If cancellation is detected:

1. Emit `cancel_requested`.
2. Stop before the next unsafe boundary.
3. Clean up temporary resources when safe.
4. Emit `cancelled`.

Cancellation is best-effort during an active child process. The runner should terminate child processes it owns when safe to do so.

## Validation Result Submission

Validation result request:

```text
POST /runner/runs/validation-result
```

Includes:

- `runId`
- Command metadata
- Status
- Exit code
- Duration
- Redacted stdout/stderr summaries
- Redaction status

The runner must redact logs before submission.

## PR Artifact Submission

PR artifact request:

```text
POST /runner/runs/pr-artifact
```

Includes:

- `runId`
- Repository owner/name
- Branch name
- PR number
- PR URL
- PR title
- PR status
- Changed file paths
- Risk flags

It must not include raw diffs or patches.

## Repair Loop

Repair is manual.

Flow:

1. Human requests repair.
2. Web app creates repair packet.
3. Runner polls and receives repair job.
4. Runner checks repair attempt limit.
5. Runner executes Codex with local previous context and human feedback.
6. Runner scans changes again.
7. Runner runs validation again.
8. Runner updates the branch and PR.

Maximum repair attempts: 1-2 per run, set by policy.
