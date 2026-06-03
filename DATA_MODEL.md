# Data Model

## Versioning Rules

All shared contracts live in `packages/shared` and must be versioned from day one.

Every serialized contract includes:

```ts
contractVersion: "2026-05-10.v1"
```

Contract changes must preserve old fixture parsing or introduce an explicit migration path.

## TaskPacket

`TaskPacket` is the operational contract between the web app, runner, Codex, and reviewer.

```ts
type TaskPacket = {
  contractVersion: string
  id: string
  workspaceId?: string
  repositoryId: string
  runId: string
  mode: "dryRun" | "execute" | "repair"
  objective: string
  acceptanceCriteria: string[]
  source: {
    type: "manual" | "linear" | "repair"
    externalId?: string
    title: string
    url?: string
  }
  repo: {
    localPath: string
    defaultBranch: string
    targetBranch: string
    worktreePath?: string
  }
  context: {
    files: string[]
    notes: string[]
  }
  policy: RepoPolicy
  validation: {
    commands: ValidationCommand[]
  }
  repair?: {
    attempt: number
    maxAttempts: number
    feedback: string
    previousRunId: string
  }
  createdAt: string
}
```

Task packets may reference local files by path. They must not embed raw source code.

## RunState

`RunState` is the canonical state machine for a job.

```ts
type RunState =
  | "queued"
  | "claimed"
  | "dry_run_running"
  | "dry_run_passed"
  | "preflight"
  | "worktree_created"
  | "codex_running"
  | "changes_scanned"
  | "validation_running"
  | "blocked"
  | "cancel_requested"
  | "cancelling"
  | "cancelled"
  | "pushed"
  | "pr_opened"
  | "awaiting_approval"
  | "repair_requested"
  | "completed"
  | "failed"
```

Terminal states:

- `cancelled`
- `completed`
- `failed`
- `blocked`

## RunEvent

`RunEvent` is append-only and idempotent.

```ts
type RunEvent = {
  contractVersion: string
  id: string
  idempotencyKey: string
  runId: string
  runnerId?: string
  state: RunState
  severity: "debug" | "info" | "warning" | "error" | "blocked"
  message: string
  metadata: Record<string, unknown>
  createdAt: string
}
```

Idempotency key format:

```text
run:{runId}:event:{stableStepName}:{attempt}
```

The web app stores only one event per idempotency key.

## RepoPolicy

`RepoPolicy` controls what the runner may do in a repository.

```ts
type RepoPolicy = {
  contractVersion: string
  protectedBranches: string[]
  protectedPaths: string[]
  sensitivePaths: string[]
  warningPaths: {
    packageLocks: string[]
    migrations: string[]
    infrastructure: string[]
    auth: string[]
    billing: string[]
  }
  validationCommands: ValidationCommand[]
  maxChangedFiles: number
  maxDiffLines?: number
  allowUntrackedFiles: boolean
  dryRunChecks: DryRunCheck[]
}
```

## ValidationCommand

```ts
type ValidationCommand = {
  id: string
  label: string
  command: string
  cwd?: string
  timeoutSeconds: number
  required: boolean
}
```

## RunnerProtocol

`RunnerProtocol` defines the messages exchanged between runner and web.

```ts
type RunnerProtocol =
  | LinkRunnerRequest
  | LinkRunnerResponse
  | HeartbeatRequest
  | PollJobsRequest
  | ClaimJobRequest
  | SubmitRunEventRequest
  | SubmitDryRunResultRequest
  | SubmitValidationResultRequest
  | SubmitPrArtifactRequest
  | CancellationRequest
  | RepairRequest
  | CloseRunRequest
```

Claims and event submissions must include idempotency keys.

## ValidationResult

```ts
type ValidationResult = {
  contractVersion: string
  id: string
  runId: string
  commandId: string
  commandLabel: string
  command: string
  status: "passed" | "failed" | "skipped" | "cancelled"
  exitCode: number | null
  durationMs: number
  stdoutSummary: string
  stderrSummary: string
  redactionApplied: boolean
  startedAt: string
  finishedAt: string
}
```

`stdoutSummary` and `stderrSummary` must be redacted before leaving the runner.

## ApprovalDecision

```ts
type ApprovalDecision = {
  contractVersion: string
  id: string
  runId: string
  actorId: string
  decision:
    | "approve"
    | "reject"
    | "request_repair"
    | "rerun_validation"
    | "cancel_run"
    | "close_run"
  reason: string
  createdAt: string
}
```

## RunnerCapabilities

```ts
type RunnerCapabilities = {
  contractVersion: string
  runnerId?: string
  os: {
    platform: string
    release: string
    arch: string
  }
  shell: string
  tools: {
    git?: ToolCapability
    gh?: ToolCapability
    codex?: ToolCapability
    node?: ToolCapability
    npm?: ToolCapability
    pnpm?: ToolCapability
    yarn?: ToolCapability
    python?: ToolCapability
  }
  maxConcurrentJobs: number
  supportsDryRun: boolean
  supportsCancellation: boolean
  reportedAt: string
}

type ToolCapability = {
  available: boolean
  version?: string
  path?: string
}
```

## DryRunResult

```ts
type DryRunResult = {
  contractVersion: string
  id: string
  runId: string
  status: "passed" | "failed" | "warning"
  checks: DryRunCheckResult[]
  capabilities: RunnerCapabilities
  blockers: RiskFinding[]
  warnings: RiskFinding[]
  createdAt: string
}

type DryRunCheckResult = {
  id: string
  label: string
  status: "passed" | "failed" | "warning" | "skipped"
  message: string
  metadata: Record<string, unknown>
}
```

Dry run does not invoke Codex and does not modify the repository.

## RiskFinding

```ts
type RiskFinding = {
  id: string
  severity: "warning" | "blocked"
  category:
    | "dirty_repo"
    | "protected_branch"
    | "missing_mapping"
    | "missing_validation"
    | "missing_capability"
    | "sensitive_path"
    | "secret"
    | "protected_path"
    | "validation_failed"
    | "stale_lock"
    | "duplicate_assignment"
    | "large_diff"
    | "package_lock"
    | "migration"
    | "infrastructure"
    | "auth"
    | "billing"
    | "generated_files"
    | "validation_skipped"
  message: string
  paths: string[]
}
```
