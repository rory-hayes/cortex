import { describe, expect, it } from "vitest";
import type {
  CancellationRequest as SharedCancellationRequest,
  ClaimJobRequest as SharedClaimJobRequest,
  ClaimJobResponse as SharedClaimJobResponse,
  CloseRunRequest as SharedCloseRunRequest,
  HeartbeatRequest as SharedHeartbeatRequest,
  HeartbeatResponse as SharedHeartbeatResponse,
  LinkRunnerRequest as SharedLinkRunnerRequest,
  LinkRunnerResponse as SharedLinkRunnerResponse,
  PollJobsRequest as SharedPollJobsRequest,
  PollJobsResponse as SharedPollJobsResponse,
  PrArtifact as SharedPrArtifact,
  PrArtifactStatus as SharedPrArtifactStatus,
  RepairRequest as SharedRepairRequest,
  RunnerHeartbeatStatus as SharedRunnerHeartbeatStatus,
  RunnerJob as SharedRunnerJob,
  RunnerJobType as SharedRunnerJobType,
  RunnerProtocol as SharedRunnerProtocol,
  RunnerProtocolEndpoint as SharedRunnerProtocolEndpoint,
  RunnerProtocolEndpointName as SharedRunnerProtocolEndpointName,
  RunnerProtocolRequest as SharedRunnerProtocolRequest,
  RunnerProtocolResponse as SharedRunnerProtocolResponse,
  SubmitDryRunResultRequest as SharedSubmitDryRunResultRequest,
  SubmitPrArtifactRequest as SharedSubmitPrArtifactRequest,
  SubmitRunEventRequest as SharedSubmitRunEventRequest,
  SubmitValidationResultRequest as SharedSubmitValidationResultRequest,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const RUNNER_PROTOCOL_ENDPOINTS = {
  linkRunner: "/runner/link",
  heartbeat: "/runner/heartbeat",
  pollJobs: "/runner/jobs/poll",
  claimJob: "/runner/jobs/claim",
  submitRunEvent: "/runner/runs/events",
  submitDryRunResult: "/runner/runs/dry-run-result",
  submitValidationResult: "/runner/runs/validation-result",
  submitPrArtifact: "/runner/runs/pr-artifact",
} as const;

const RUNNER_HEARTBEAT_STATUSES = ["idle", "busy", "offline"] as const;
const RUNNER_JOB_TYPES = ["task", "repair"] as const;
const CLAIM_JOB_STATUSES = ["claimed", "already_claimed", "conflict", "not_found"] as const;
const PR_ARTIFACT_STATUSES = ["draft", "open", "closed", "merged"] as const;

type RunnerHeartbeatStatus = (typeof RUNNER_HEARTBEAT_STATUSES)[number];
type RunnerJobType = (typeof RUNNER_JOB_TYPES)[number];
type ClaimJobStatus = (typeof CLAIM_JOB_STATUSES)[number];
type PrArtifactStatus = (typeof PR_ARTIFACT_STATUSES)[number];

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
  | "failed";

type RunEventSeverity = "debug" | "info" | "warning" | "error" | "blocked";
type TaskPacketMode = "dryRun" | "execute" | "repair";
type TaskPacketSourceType = "manual" | "linear" | "repair";
type DryRunCheck =
  | "repo_path_exists"
  | "git_repository"
  | "repo_clean"
  | "current_branch_not_protected"
  | "repo_policy_exists_and_parses"
  | "validation_commands_configured"
  | "required_tools_available"
  | "branch_name_available"
  | "worktree_path_available"
  | "protected_and_sensitive_paths_configured"
  | "runner_capabilities_satisfied";

type ValidationCommand = {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  required: boolean;
};

type RepoPolicy = {
  contractVersion: typeof CONTRACT_VERSION;
  protectedBranches: string[];
  protectedPaths: string[];
  sensitivePaths: string[];
  warningPaths: {
    packageLocks: string[];
    migrations: string[];
    infrastructure: string[];
    auth: string[];
    billing: string[];
  };
  validationCommands: ValidationCommand[];
  maxChangedFiles: number;
  maxDiffLines?: number;
  allowUntrackedFiles: boolean;
  dryRunChecks: DryRunCheck[];
};

type TaskPacket = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  workspaceId?: string;
  repositoryId: string;
  runId: string;
  mode: TaskPacketMode;
  objective: string;
  acceptanceCriteria: string[];
  source: {
    type: TaskPacketSourceType;
    externalId?: string;
    title: string;
    url?: string;
  };
  repo: {
    localPath: string;
    defaultBranch: string;
    targetBranch: string;
    worktreePath?: string;
  };
  context: {
    files: string[];
    notes: string[];
  };
  policy: RepoPolicy;
  validation: {
    commands: ValidationCommand[];
  };
  repair?: {
    attempt: number;
    maxAttempts: number;
    feedback: string;
    previousRunId: string;
  };
  createdAt: string;
};

type RunnerCapabilities = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId?: string;
  os: {
    platform: string;
    release: string;
    arch: string;
  };
  shell: string;
  tools: {
    git?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    gh?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    codex?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    node?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    npm?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    pnpm?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    yarn?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    python?: {
      available: boolean;
      version?: string;
      path?: string;
    };
  };
  maxConcurrentJobs: number;
  supportsDryRun: boolean;
  supportsCancellation: boolean;
  reportedAt: string;
};

type RiskFinding = {
  id: string;
  severity: "warning" | "blocked";
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
    | "validation_skipped";
  message: string;
  paths: string[];
};

type DryRunCheckResult = {
  id: DryRunCheck;
  label: string;
  status: "passed" | "failed" | "warning" | "skipped";
  message: string;
  metadata: Record<string, unknown>;
};

type DryRunResult = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  runId: string;
  status: "passed" | "failed" | "warning";
  checks: DryRunCheckResult[];
  capabilities: RunnerCapabilities;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
  createdAt: string;
};

type ValidationResult = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  runId: string;
  commandId: string;
  commandLabel: string;
  command: string;
  status: "passed" | "failed" | "skipped" | "cancelled";
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  redactionApplied: boolean;
  startedAt: string;
  finishedAt: string;
};

type LinkRunnerRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  pairingCode: string;
  capabilities: RunnerCapabilities;
  requestedAt: string;
};

type LinkRunnerResponse = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  workspaceId: string;
  runnerCredential: string;
  pollingBaseUrl: string;
  pollIntervalSeconds: number;
  linkedAt: string;
};

type HeartbeatRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  status: RunnerHeartbeatStatus;
  currentRunId: string | null;
  capabilities: RunnerCapabilities;
  timestamp: string;
};

type HeartbeatResponse = {
  contractVersion: typeof CONTRACT_VERSION;
  serverTime: string;
  pollIntervalSeconds: number;
  cancellation?: CancellationRequest;
  repair?: RepairRequest;
  close?: CloseRunRequest;
};

type RunnerJob = {
  contractVersion: typeof CONTRACT_VERSION;
  jobId: string;
  runId: string;
  type: RunnerJobType;
  taskPacket: TaskPacket;
  queuedAt: string;
};

type PollJobsRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  capabilities: RunnerCapabilities;
  availableConcurrency: number;
  knownCurrentRunIds: string[];
};

type PollJobsResponse = {
  contractVersion: typeof CONTRACT_VERSION;
  jobs: RunnerJob[];
  pollIntervalSeconds: number;
  serverTime: string;
  cancellation?: CancellationRequest;
};

type ClaimJobRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  jobId: string;
  runId: string;
  idempotencyKey: string;
  capabilitiesSnapshot: RunnerCapabilities;
};

type ClaimJobResponse = {
  contractVersion: typeof CONTRACT_VERSION;
  jobId: string;
  runId: string;
  status: ClaimJobStatus;
  claimedByRunnerId?: string;
  claimExpiresAt?: string;
  conflictReason?: string;
};

type SubmitRunEventRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runId: string;
  runnerId?: string;
  eventId: string;
  idempotencyKey: string;
  state: RunState;
  severity: RunEventSeverity;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type SubmitDryRunResultRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  runId: string;
  result: DryRunResult;
  submittedAt: string;
};

type SubmitValidationResultRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  runId: string;
  result: ValidationResult;
  submittedAt: string;
};

type PrArtifact = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  runId: string;
  repository: {
    owner: string;
    name: string;
  };
  branchName: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prStatus: PrArtifactStatus;
  changedFilePaths: string[];
  riskFindings: RiskFinding[];
  createdAt: string;
};

type SubmitPrArtifactRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId: string;
  runId: string;
  artifact: PrArtifact;
  submittedAt: string;
};

type CancellationRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runId: string;
  requestedByActorId: string;
  reason: string;
  requestedAt: string;
};

type RepairRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runId: string;
  requestedByActorId: string;
  reason: string;
  taskPacket: TaskPacket;
  requestedAt: string;
};

type CloseRunRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  runId: string;
  closedByActorId: string;
  reason: string;
  closedAt: string;
};

type RunnerProtocolModule = {
  RUNNER_PROTOCOL_ENDPOINTS: typeof RUNNER_PROTOCOL_ENDPOINTS;
  RUNNER_HEARTBEAT_STATUSES: readonly RunnerHeartbeatStatus[];
  RUNNER_JOB_TYPES: readonly RunnerJobType[];
  CLAIM_JOB_STATUSES: readonly ClaimJobStatus[];
  PR_ARTIFACT_STATUSES: readonly PrArtifactStatus[];
  RunnerHeartbeatStatusSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerJobTypeSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  ClaimJobStatusSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  PrArtifactStatusSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  LinkRunnerRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  LinkRunnerResponseSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  HeartbeatRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  HeartbeatResponseSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerJobSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  PollJobsRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  PollJobsResponseSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  ClaimJobRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  ClaimJobResponseSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  SubmitRunEventRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  SubmitDryRunResultRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  SubmitValidationResultRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  PrArtifactSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  SubmitPrArtifactRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  CancellationRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RepairRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  CloseRunRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerProtocolRequestSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerProtocolResponseSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerProtocolSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  createClaimJobIdempotencyKey: (input: {
    runnerId: string;
    jobId: string;
    runId: string;
  }) => string;
};

const loadRunnerProtocolModule = async () =>
  (await import("./runner-protocol.js")) as RunnerProtocolModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RunnerProtocolModule>;

const validCommand = (overrides: Partial<ValidationCommand> = {}): ValidationCommand => ({
  id: "test",
  label: "Run tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
  ...overrides,
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["SECURITY_MODEL.md", ".github/workflows/**"],
  sensitivePaths: [".env", ".env.*", "secrets/**"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"],
    migrations: ["db/migrations/**"],
    infrastructure: [".github/**", "infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [validCommand()],
  maxChangedFiles: 25,
  maxDiffLines: 1_000,
  allowUntrackedFiles: false,
  dryRunChecks: ["repo_path_exists", "git_repository", "repo_clean"],
  ...overrides,
});

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-1",
  workspaceId: "workspace-1",
  repositoryId: "repo-1",
  runId: "run-1",
  mode: "execute",
  objective: "Implement the shared RunnerProtocol contract.",
  acceptanceCriteria: ["Protocol payloads validate at runtime.", "Unsafe payloads are rejected."],
  source: {
    type: "manual",
    externalId: "manual-1",
    title: "Implement RunnerProtocol schema",
    url: "https://example.test/tasks/runner-protocol",
  },
  repo: {
    localPath: "/repos/control-plane",
    defaultBranch: "main",
    targetBranch: "codex/TASK-021-implement-runnerprotocol-schemas",
    worktreePath: "/tmp/control-plane-task-021",
  },
  context: {
    files: ["RUNNER_PROTOCOL.md", "packages/shared/src/index.ts"],
    notes: ["Use path references only."],
  },
  policy: validPolicy(),
  validation: {
    commands: [validCommand()],
  },
  createdAt: "2026-05-14T21:45:00.000Z",
  ...overrides,
});

const validRepairPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  validTaskPacket({
    mode: "repair",
    source: {
      type: "repair",
      title: "Repair RunnerProtocol schema",
    },
    repair: {
      attempt: 1,
      maxAttempts: 2,
      feedback: "Keep protocol payloads metadata-only.",
      previousRunId: "run-previous",
    },
    ...overrides,
  });

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  os: {
    platform: "darwin",
    release: "25.5.0",
    arch: "arm64",
  },
  shell: "/bin/zsh",
  tools: {
    git: {
      available: true,
      version: "2.49.0",
      path: "/usr/bin/git",
    },
    gh: {
      available: true,
      version: "2.72.0",
      path: "/opt/homebrew/bin/gh",
    },
    codex: {
      available: true,
      version: "0.12.0",
      path: "/opt/homebrew/bin/codex",
    },
    node: {
      available: true,
      version: "24.0.0",
      path: "/opt/homebrew/bin/node",
    },
    pnpm: {
      available: true,
      version: "10.11.0",
      path: "/opt/homebrew/bin/pnpm",
    },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: true,
  reportedAt: "2026-05-14T21:45:30.000Z",
  ...overrides,
});

const capabilitiesWithUnsafeValue = (unsafeValue: string): RunnerCapabilities => ({
  ...validCapabilities(),
  tools: {
    ...validCapabilities().tools,
    git: {
      available: true,
      version: unsafeValue,
    },
  },
});

const validRiskFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk-1",
  severity: "warning",
  category: "package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  ...overrides,
});

const validDryRunResult = (overrides: Partial<DryRunResult> = {}): DryRunResult => ({
  contractVersion: CONTRACT_VERSION,
  id: "dry-run-result-1",
  runId: "run-1",
  status: "passed",
  checks: [
    {
      id: "repo_clean",
      label: "Repo clean",
      status: "passed",
      message: "Repository has no uncommitted changes.",
      metadata: {
        pathCount: 0,
        checkedAt: "2026-05-14T21:46:00.000Z",
      },
    },
  ],
  capabilities: validCapabilities(),
  blockers: [],
  warnings: [],
  createdAt: "2026-05-14T21:46:30.000Z",
  ...overrides,
});

const validValidationResult = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
  contractVersion: CONTRACT_VERSION,
  id: "validation-result-1",
  runId: "run-1",
  commandId: "test",
  commandLabel: "Run tests",
  command: "pnpm --filter @control-plane/shared test",
  status: "passed",
  exitCode: 0,
  durationMs: 1_250,
  stdoutSummary: "11 files passed.",
  stderrSummary: "",
  redactionApplied: true,
  startedAt: "2026-05-14T21:47:00.000Z",
  finishedAt: "2026-05-14T21:47:02.000Z",
  ...overrides,
});

const validLinkRunnerRequest = (overrides: Partial<LinkRunnerRequest> = {}): LinkRunnerRequest => ({
  contractVersion: CONTRACT_VERSION,
  pairingCode: "PAIR-123456",
  capabilities: validCapabilities(),
  requestedAt: "2026-05-14T21:48:00.000Z",
  ...overrides,
});

const validLinkRunnerResponse = (
  overrides: Partial<LinkRunnerResponse> = {},
): LinkRunnerResponse => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  workspaceId: "workspace-1",
  runnerCredential: "credential-local-runner-1",
  pollingBaseUrl: "https://control-plane.example.test",
  pollIntervalSeconds: 15,
  linkedAt: "2026-05-14T21:48:01.000Z",
  ...overrides,
});

const validHeartbeatRequest = (overrides: Partial<HeartbeatRequest> = {}): HeartbeatRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  status: "idle",
  currentRunId: null,
  capabilities: validCapabilities(),
  timestamp: "2026-05-14T21:49:00.000Z",
  ...overrides,
});

const validHeartbeatResponse = (overrides: Partial<HeartbeatResponse> = {}): HeartbeatResponse => ({
  contractVersion: CONTRACT_VERSION,
  serverTime: "2026-05-14T21:49:01.000Z",
  pollIntervalSeconds: 15,
  ...overrides,
});

const validRunnerJob = (overrides: Partial<RunnerJob> = {}): RunnerJob => ({
  contractVersion: CONTRACT_VERSION,
  jobId: "job-1",
  runId: "run-1",
  type: "task",
  taskPacket: validTaskPacket(),
  queuedAt: "2026-05-14T21:50:00.000Z",
  ...overrides,
});

const validPollJobsRequest = (overrides: Partial<PollJobsRequest> = {}): PollJobsRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  capabilities: validCapabilities(),
  availableConcurrency: 1,
  knownCurrentRunIds: [],
  ...overrides,
});

const validPollJobsResponse = (overrides: Partial<PollJobsResponse> = {}): PollJobsResponse => ({
  contractVersion: CONTRACT_VERSION,
  jobs: [validRunnerJob()],
  pollIntervalSeconds: 15,
  serverTime: "2026-05-14T21:50:01.000Z",
  ...overrides,
});

const validClaimJobRequest = (overrides: Partial<ClaimJobRequest> = {}): ClaimJobRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  jobId: "job-1",
  runId: "run-1",
  idempotencyKey: "runner:runner-1:claim:job-1:run-1",
  capabilitiesSnapshot: validCapabilities(),
  ...overrides,
});

const validClaimJobResponse = (overrides: Partial<ClaimJobResponse> = {}): ClaimJobResponse => ({
  contractVersion: CONTRACT_VERSION,
  jobId: "job-1",
  runId: "run-1",
  status: "claimed",
  claimedByRunnerId: "runner-1",
  claimExpiresAt: "2026-05-14T21:55:00.000Z",
  ...overrides,
});

const validSubmitRunEventRequest = (
  overrides: Partial<SubmitRunEventRequest> = {},
): SubmitRunEventRequest => ({
  contractVersion: CONTRACT_VERSION,
  runId: "run-1",
  runnerId: "runner-1",
  eventId: "event-1",
  idempotencyKey: "run:run-1:event:worktree_created:1",
  state: "worktree_created",
  severity: "info",
  message: "Worktree created.",
  metadata: {
    changedFilePaths: ["packages/shared/src/runner-protocol.ts"],
    riskFlags: ["package_lock"],
    validationStatus: "passed",
  },
  createdAt: "2026-05-14T21:51:00.000Z",
  ...overrides,
});

const validSubmitDryRunResultRequest = (
  overrides: Partial<SubmitDryRunResultRequest> = {},
): SubmitDryRunResultRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  runId: "run-1",
  result: validDryRunResult(),
  submittedAt: "2026-05-14T21:52:00.000Z",
  ...overrides,
});

const validSubmitValidationResultRequest = (
  overrides: Partial<SubmitValidationResultRequest> = {},
): SubmitValidationResultRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  runId: "run-1",
  result: validValidationResult(),
  submittedAt: "2026-05-14T21:53:00.000Z",
  ...overrides,
});

const validPrArtifact = (overrides: Partial<PrArtifact> = {}): PrArtifact => ({
  contractVersion: CONTRACT_VERSION,
  id: "pr-artifact-1",
  runId: "run-1",
  repository: {
    owner: "control-plane",
    name: "ai-engineering-control-plane",
  },
  branchName: "codex/TASK-021-implement-runnerprotocol-schemas",
  prNumber: 21,
  prUrl: "https://github.example.test/control-plane/ai-engineering-control-plane/pull/21",
  prTitle: "TASK-021 Implement RunnerProtocol schemas",
  prStatus: "open",
  changedFilePaths: [
    "packages/shared/src/runner-protocol.ts",
    "packages/shared/src/runner-protocol.test.ts",
  ],
  riskFindings: [validRiskFinding()],
  createdAt: "2026-05-14T21:54:00.000Z",
  ...overrides,
});

const validSubmitPrArtifactRequest = (
  overrides: Partial<SubmitPrArtifactRequest> = {},
): SubmitPrArtifactRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  runId: "run-1",
  artifact: validPrArtifact(),
  submittedAt: "2026-05-14T21:54:30.000Z",
  ...overrides,
});

const validCancellationRequest = (
  overrides: Partial<CancellationRequest> = {},
): CancellationRequest => ({
  contractVersion: CONTRACT_VERSION,
  runId: "run-1",
  requestedByActorId: "user-1",
  reason: "User cancelled the run before validation.",
  requestedAt: "2026-05-14T21:55:00.000Z",
  ...overrides,
});

const validRepairRequest = (overrides: Partial<RepairRequest> = {}): RepairRequest => ({
  contractVersion: CONTRACT_VERSION,
  runId: "run-1",
  requestedByActorId: "user-1",
  reason: "Validation failed and needs repair.",
  taskPacket: validRepairPacket(),
  requestedAt: "2026-05-14T21:56:00.000Z",
  ...overrides,
});

const validCloseRunRequest = (overrides: Partial<CloseRunRequest> = {}): CloseRunRequest => ({
  contractVersion: CONTRACT_VERSION,
  runId: "run-1",
  closedByActorId: "user-1",
  reason: "Run reviewed and closed.",
  closedAt: "2026-05-14T21:57:00.000Z",
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  endpointName: SharedRunnerProtocolEndpointName;
  endpoint: SharedRunnerProtocolEndpoint;
  heartbeatStatus: SharedRunnerHeartbeatStatus;
  jobType: SharedRunnerJobType;
  prStatus: SharedPrArtifactStatus;
  linkRequest: SharedLinkRunnerRequest;
  linkResponse: SharedLinkRunnerResponse;
  heartbeatRequest: SharedHeartbeatRequest;
  heartbeatResponse: SharedHeartbeatResponse;
  pollRequest: SharedPollJobsRequest;
  pollResponse: SharedPollJobsResponse;
  job: SharedRunnerJob;
  claimRequest: SharedClaimJobRequest;
  claimResponse: SharedClaimJobResponse;
  eventRequest: SharedSubmitRunEventRequest;
  dryRunRequest: SharedSubmitDryRunResultRequest;
  validationRequest: SharedSubmitValidationResultRequest;
  artifact: SharedPrArtifact;
  prRequest: SharedSubmitPrArtifactRequest;
  cancellation: SharedCancellationRequest;
  repair: SharedRepairRequest;
  close: SharedCloseRunRequest;
  protocolRequest: SharedRunnerProtocolRequest;
  protocolResponse: SharedRunnerProtocolResponse;
  protocol: SharedRunnerProtocol;
}) => value;

describe("RunnerProtocol", () => {
  it("exports protocol constants in canonical order", async () => {
    const {
      CLAIM_JOB_STATUSES: exportedClaimStatuses,
      PR_ARTIFACT_STATUSES: exportedPrStatuses,
      RUNNER_HEARTBEAT_STATUSES: exportedHeartbeatStatuses,
      RUNNER_JOB_TYPES: exportedJobTypes,
      RUNNER_PROTOCOL_ENDPOINTS: exportedEndpoints,
      ClaimJobStatusSchema,
      PrArtifactStatusSchema,
      RunnerHeartbeatStatusSchema,
      RunnerJobTypeSchema,
    } = await loadRunnerProtocolModule();

    expect(exportedEndpoints).toEqual(RUNNER_PROTOCOL_ENDPOINTS);
    expect(exportedHeartbeatStatuses).toEqual(RUNNER_HEARTBEAT_STATUSES);
    expect(exportedJobTypes).toEqual(RUNNER_JOB_TYPES);
    expect(exportedClaimStatuses).toEqual(CLAIM_JOB_STATUSES);
    expect(exportedPrStatuses).toEqual(PR_ARTIFACT_STATUSES);

    for (const status of RUNNER_HEARTBEAT_STATUSES) {
      expect(RunnerHeartbeatStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const type of RUNNER_JOB_TYPES) {
      expect(RunnerJobTypeSchema.safeParse(type).success).toBe(true);
    }
    for (const status of CLAIM_JOB_STATUSES) {
      expect(ClaimJobStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of PR_ARTIFACT_STATUSES) {
      expect(PrArtifactStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("validates link runner request and response payloads", async () => {
    const { LinkRunnerRequestSchema, LinkRunnerResponseSchema, RunnerProtocolSchema } =
      await loadRunnerProtocolModule();
    const request = validLinkRunnerRequest();
    const response = validLinkRunnerResponse();

    expect(LinkRunnerRequestSchema.safeParse(request).success).toBe(true);
    expect(LinkRunnerResponseSchema.safeParse(response).success).toBe(true);
    expect(RunnerProtocolSchema.safeParse(request).success).toBe(true);
    expect(RunnerProtocolSchema.safeParse(response).success).toBe(true);
  });

  it("validates heartbeat request and response payloads with control instructions", async () => {
    const { HeartbeatRequestSchema, HeartbeatResponseSchema, RunnerProtocolResponseSchema } =
      await loadRunnerProtocolModule();
    const request = validHeartbeatRequest({
      status: "busy",
      currentRunId: "run-1",
    });
    const response = validHeartbeatResponse({
      cancellation: validCancellationRequest(),
    });

    expect(HeartbeatRequestSchema.safeParse(request).success).toBe(true);
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
    expect(RunnerProtocolResponseSchema.safeParse(response).success).toBe(true);
  });

  it("validates poll jobs request and response payloads", async () => {
    const { PollJobsRequestSchema, PollJobsResponseSchema, RunnerJobSchema } =
      await loadRunnerProtocolModule();
    const request = validPollJobsRequest({
      knownCurrentRunIds: ["run-active"],
    });
    const response = validPollJobsResponse();

    expect(PollJobsRequestSchema.safeParse(request).success).toBe(true);
    expect(RunnerJobSchema.safeParse(response.jobs[0]).success).toBe(true);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  it("accepts a cancellation instruction on poll job responses", async () => {
    const { PollJobsResponseSchema, RunnerProtocolResponseSchema } =
      await loadRunnerProtocolModule();
    const response = validPollJobsResponse({
      cancellation: validCancellationRequest({ runId: "run-active" }),
      jobs: [],
    });

    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
    expect(RunnerProtocolResponseSchema.safeParse(response).success).toBe(true);
  });

  it("validates claim job request and response payloads", async () => {
    const { ClaimJobRequestSchema, ClaimJobResponseSchema, createClaimJobIdempotencyKey } =
      await loadRunnerProtocolModule();
    const request = validClaimJobRequest({
      idempotencyKey: createClaimJobIdempotencyKey({
        runnerId: "runner-1",
        jobId: "job-1",
        runId: "run-1",
      }),
    });

    expect(request.idempotencyKey).toBe("runner:runner-1:claim:job-1:run-1");
    expect(ClaimJobRequestSchema.safeParse(request).success).toBe(true);
    expect(ClaimJobResponseSchema.safeParse(validClaimJobResponse()).success).toBe(true);
  });

  it("rejects unsafe capability values across protocol request payloads", async () => {
    const {
      ClaimJobRequestSchema,
      HeartbeatRequestSchema,
      LinkRunnerRequestSchema,
      PollJobsRequestSchema,
      SubmitDryRunResultRequestSchema,
    } = await loadRunnerProtocolModule();
    const unsafeCapabilities = capabilitiesWithUnsafeValue(
      "diff --git a/src/private.ts b/src/private.ts",
    );

    expect(
      LinkRunnerRequestSchema.safeParse(
        validLinkRunnerRequest({
          capabilities: unsafeCapabilities,
        }),
      ).success,
    ).toBe(false);
    expect(
      HeartbeatRequestSchema.safeParse(
        validHeartbeatRequest({
          capabilities: unsafeCapabilities,
        }),
      ).success,
    ).toBe(false);
    expect(
      PollJobsRequestSchema.safeParse(
        validPollJobsRequest({
          capabilities: unsafeCapabilities,
        }),
      ).success,
    ).toBe(false);
    expect(
      ClaimJobRequestSchema.safeParse(
        validClaimJobRequest({
          capabilitiesSnapshot: unsafeCapabilities,
        }),
      ).success,
    ).toBe(false);
    expect(
      SubmitDryRunResultRequestSchema.safeParse(
        validSubmitDryRunResultRequest({
          result: validDryRunResult({
            capabilities: unsafeCapabilities,
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("validates submit run event requests", async () => {
    const { RunnerProtocolRequestSchema, SubmitRunEventRequestSchema } =
      await loadRunnerProtocolModule();
    const request = validSubmitRunEventRequest();

    expect(SubmitRunEventRequestSchema.safeParse(request).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(request).success).toBe(true);
  });

  it("validates submit dry-run result requests", async () => {
    const { RunnerProtocolRequestSchema, SubmitDryRunResultRequestSchema } =
      await loadRunnerProtocolModule();
    const request = validSubmitDryRunResultRequest();

    expect(SubmitDryRunResultRequestSchema.safeParse(request).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(request).success).toBe(true);
  });

  it("validates submit validation result requests", async () => {
    const { RunnerProtocolRequestSchema, SubmitValidationResultRequestSchema } =
      await loadRunnerProtocolModule();
    const request = validSubmitValidationResultRequest();

    expect(SubmitValidationResultRequestSchema.safeParse(request).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(request).success).toBe(true);
  });

  it("validates submit PR artifact requests", async () => {
    const { PrArtifactSchema, RunnerProtocolRequestSchema, SubmitPrArtifactRequestSchema } =
      await loadRunnerProtocolModule();
    const request = validSubmitPrArtifactRequest();

    expect(PrArtifactSchema.safeParse(request.artifact).success).toBe(true);
    expect(SubmitPrArtifactRequestSchema.safeParse(request).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(request).success).toBe(true);
  });

  it("validates cancellation, repair, and close requests", async () => {
    const {
      CancellationRequestSchema,
      CloseRunRequestSchema,
      RepairRequestSchema,
      RunnerProtocolRequestSchema,
    } = await loadRunnerProtocolModule();
    const cancellation = validCancellationRequest();
    const repair = validRepairRequest();
    const close = validCloseRunRequest();

    expect(CancellationRequestSchema.safeParse(cancellation).success).toBe(true);
    expect(RepairRequestSchema.safeParse(repair).success).toBe(true);
    expect(CloseRunRequestSchema.safeParse(close).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(cancellation).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(repair).success).toBe(true);
    expect(RunnerProtocolRequestSchema.safeParse(close).success).toBe(true);
  });

  it("rejects claim requests missing idempotency keys", async () => {
    const { ClaimJobRequestSchema } = await loadRunnerProtocolModule();
    const requestWithoutIdempotencyKey: Record<string, unknown> = validClaimJobRequest();
    delete requestWithoutIdempotencyKey.idempotencyKey;

    expect(ClaimJobRequestSchema.safeParse(requestWithoutIdempotencyKey).success).toBe(false);
  });

  it("rejects claim requests with non-canonical idempotency keys", async () => {
    const { ClaimJobRequestSchema } = await loadRunnerProtocolModule();

    expect(
      ClaimJobRequestSchema.safeParse(
        validClaimJobRequest({
          idempotencyKey: "runner:other-runner:claim:job-1:run-1",
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects event submissions missing idempotency keys", async () => {
    const { SubmitRunEventRequestSchema } = await loadRunnerProtocolModule();
    const requestWithoutIdempotencyKey: Record<string, unknown> = validSubmitRunEventRequest();
    delete requestWithoutIdempotencyKey.idempotencyKey;

    expect(SubmitRunEventRequestSchema.safeParse(requestWithoutIdempotencyKey).success).toBe(false);
  });

  it("rejects nested diff, patch, source, and code keys in event metadata", async () => {
    const { SubmitRunEventRequestSchema } = await loadRunnerProtocolModule();

    for (const unsafeKey of ["diff", "patch", "source", "code"]) {
      expect(
        SubmitRunEventRequestSchema.safeParse(
          validSubmitRunEventRequest({
            metadata: {
              safeSummary: "Metadata only.",
              nested: [
                {
                  [unsafeKey]: "unsafe payload",
                },
              ],
            },
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("rejects nested source-like, patch-like, and raw log event metadata keys", async () => {
    const { SubmitRunEventRequestSchema } = await loadRunnerProtocolModule();
    const unsafeKeys = [
      "sourceCode",
      "rawDiff",
      "patchText",
      "codeSnippet",
      "rawSource",
      "sourceContent",
      "fullPatch",
      "rawCode",
      "rawOutput",
      "rawStdout",
      "rawStderr",
      "rawLog",
    ];

    for (const unsafeKey of unsafeKeys) {
      expect(
        SubmitRunEventRequestSchema.safeParse(
          validSubmitRunEventRequest({
            metadata: {
              safeSummary: "Metadata only.",
              nested: {
                safeList: [
                  {
                    [unsafeKey]: "unsafe payload",
                  },
                ],
              },
            },
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("rejects PR artifact payload fields that could carry diffs, patches, source, or code", async () => {
    const { PrArtifactSchema, SubmitPrArtifactRequestSchema } = await loadRunnerProtocolModule();
    const unsafeFields = [
      "diff",
      "patch",
      "rawDiff",
      "patchText",
      "source",
      "sourceCode",
      "rawSource",
      "code",
      "codeSnippet",
    ];

    for (const unsafeField of unsafeFields) {
      const artifact = {
        ...validPrArtifact(),
        [unsafeField]: "unsafe payload",
      };

      expect(PrArtifactSchema.safeParse(artifact).success).toBe(false);
      expect(
        SubmitPrArtifactRequestSchema.safeParse(
          validSubmitPrArtifactRequest({
            artifact: artifact as PrArtifact,
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("rejects dry-run result submissions when top-level and nested run ids differ", async () => {
    const { SubmitDryRunResultRequestSchema } = await loadRunnerProtocolModule();

    expect(
      SubmitDryRunResultRequestSchema.safeParse(
        validSubmitDryRunResultRequest({
          runId: "run-1",
          result: validDryRunResult({
            runId: "run-2",
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects validation result submissions when top-level and nested run ids differ", async () => {
    const { SubmitValidationResultRequestSchema } = await loadRunnerProtocolModule();

    expect(
      SubmitValidationResultRequestSchema.safeParse(
        validSubmitValidationResultRequest({
          runId: "run-1",
          result: validValidationResult({
            runId: "run-2",
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects repair requests without a repair-mode task packet", async () => {
    const { RepairRequestSchema } = await loadRunnerProtocolModule();

    expect(
      RepairRequestSchema.safeParse(
        validRepairRequest({
          taskPacket: validTaskPacket({
            mode: "execute",
            source: {
              type: "manual",
              title: "Non-repair task",
            },
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields on protocol payloads", async () => {
    const { LinkRunnerRequestSchema, SubmitRunEventRequestSchema } =
      await loadRunnerProtocolModule();

    expect(
      LinkRunnerRequestSchema.safeParse({
        ...validLinkRunnerRequest(),
        sourceCode: "not allowed",
      }).success,
    ).toBe(false);
    expect(
      SubmitRunEventRequestSchema.safeParse({
        ...validSubmitRunEventRequest(),
        rawOutput: "not allowed",
      }).success,
    ).toBe(false);
  });

  it("exports runner protocol schemas, constants, helpers, and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.RUNNER_PROTOCOL_ENDPOINTS).toEqual(RUNNER_PROTOCOL_ENDPOINTS);
    expect(shared.RUNNER_HEARTBEAT_STATUSES).toEqual(RUNNER_HEARTBEAT_STATUSES);
    expect(shared.RUNNER_JOB_TYPES).toEqual(RUNNER_JOB_TYPES);
    expect(shared.CLAIM_JOB_STATUSES).toEqual(CLAIM_JOB_STATUSES);
    expect(shared.PR_ARTIFACT_STATUSES).toEqual(PR_ARTIFACT_STATUSES);
    expect(shared.LinkRunnerRequestSchema?.safeParse(validLinkRunnerRequest()).success).toBe(true);
    expect(shared.LinkRunnerResponseSchema?.safeParse(validLinkRunnerResponse()).success).toBe(
      true,
    );
    expect(shared.HeartbeatRequestSchema?.safeParse(validHeartbeatRequest()).success).toBe(true);
    expect(shared.HeartbeatResponseSchema?.safeParse(validHeartbeatResponse()).success).toBe(true);
    expect(shared.PollJobsRequestSchema?.safeParse(validPollJobsRequest()).success).toBe(true);
    expect(shared.PollJobsResponseSchema?.safeParse(validPollJobsResponse()).success).toBe(true);
    expect(shared.RunnerJobSchema?.safeParse(validRunnerJob()).success).toBe(true);
    expect(shared.ClaimJobRequestSchema?.safeParse(validClaimJobRequest()).success).toBe(true);
    expect(shared.ClaimJobResponseSchema?.safeParse(validClaimJobResponse()).success).toBe(true);
    expect(
      shared.SubmitRunEventRequestSchema?.safeParse(validSubmitRunEventRequest()).success,
    ).toBe(true);
    expect(
      shared.SubmitDryRunResultRequestSchema?.safeParse(validSubmitDryRunResultRequest()).success,
    ).toBe(true);
    expect(
      shared.SubmitValidationResultRequestSchema?.safeParse(validSubmitValidationResultRequest())
        .success,
    ).toBe(true);
    expect(shared.PrArtifactSchema?.safeParse(validPrArtifact()).success).toBe(true);
    expect(
      shared.SubmitPrArtifactRequestSchema?.safeParse(validSubmitPrArtifactRequest()).success,
    ).toBe(true);
    expect(shared.CancellationRequestSchema?.safeParse(validCancellationRequest()).success).toBe(
      true,
    );
    expect(shared.RepairRequestSchema?.safeParse(validRepairRequest()).success).toBe(true);
    expect(shared.CloseRunRequestSchema?.safeParse(validCloseRunRequest()).success).toBe(true);
    expect(
      shared.createClaimJobIdempotencyKey?.({
        runnerId: "runner-1",
        jobId: "job-1",
        runId: "run-1",
      }),
    ).toBe("runner:runner-1:claim:job-1:run-1");

    assertEntrypointTypeExports({
      endpointName: "heartbeat",
      endpoint: "/runner/heartbeat",
      heartbeatStatus: "idle",
      jobType: "task",
      prStatus: "open",
      linkRequest: validLinkRunnerRequest(),
      linkResponse: validLinkRunnerResponse(),
      heartbeatRequest: validHeartbeatRequest(),
      heartbeatResponse: validHeartbeatResponse(),
      pollRequest: validPollJobsRequest(),
      pollResponse: validPollJobsResponse(),
      job: validRunnerJob(),
      claimRequest: validClaimJobRequest(),
      claimResponse: validClaimJobResponse(),
      eventRequest: validSubmitRunEventRequest(),
      dryRunRequest: validSubmitDryRunResultRequest(),
      validationRequest: validSubmitValidationResultRequest(),
      artifact: validPrArtifact(),
      prRequest: validSubmitPrArtifactRequest(),
      cancellation: validCancellationRequest(),
      repair: validRepairRequest(),
      close: validCloseRunRequest(),
      protocolRequest: validClaimJobRequest(),
      protocolResponse: validClaimJobResponse(),
      protocol: validSubmitPrArtifactRequest(),
    });
  });
});
