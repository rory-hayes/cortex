import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  PrArtifactSchema,
  RunnerCapabilitiesSchema,
  TaskPacketSchema,
  ValidationResultSchema,
  createClaimJobIdempotencyKey,
  createRunEventIdempotencyKey,
  type DryRunResult,
  type PrArtifact,
  type RepoPolicy,
  type RiskFinding,
  type RunEvent,
  type RunnerCapabilities,
  type TaskPacket,
  type ValidationCommand,
  type ValidationResult,
} from "@control-plane/shared";

import { createClaimJobService, type ClaimJobStore, type ClaimRunRow } from "./claim.js";
import {
  createPollJobsService,
  type PollJobsStore,
  type PollRepoMappingRow,
  type PollRunRow,
} from "./poll.js";
import {
  createSubmitPrArtifactService,
  createSubmitValidationResultService,
  type RunArtifactSubmissionStore,
} from "../runs/artifacts.js";
import {
  createSubmitRunEventService,
  getConservativeRunEventRunState,
  shouldUpdateRunAggregateForEvent,
  type SubmitRunEventStore,
} from "../runs/events.js";

vi.mock("server-only", () => ({}));

const now = new Date("2026-05-26T10:00:00.000Z");
const runnerId = "runner_1";
const workspaceId = "workspace_1";

const validationCommand: ValidationCommand = {
  command: "pnpm test",
  id: "test",
  label: "Unit tests",
  required: true,
  timeoutSeconds: 120,
};

const policy: RepoPolicy = {
  allowUntrackedFiles: true,
  contractVersion: CONTRACT_VERSION,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
  ],
  maxChangedFiles: 20,
  maxDiffLines: 400,
  protectedBranches: ["main"],
  protectedPaths: ["infra/**"],
  sensitivePaths: [".env", ".env.*"],
  validationCommands: [validationCommand],
  warningPaths: {
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
    infrastructure: ["infra/**"],
    migrations: ["packages/db/migrations/**"],
    packageLocks: ["pnpm-lock.yaml"],
  },
};

const capabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    maxConcurrentJobs: 1,
    os: {
      arch: "arm64",
      platform: "darwin",
      release: "25.5.0",
    },
    reportedAt: "2026-05-26T09:59:00.000Z",
    runnerId,
    shell: "/bin/zsh",
    supportsCancellation: true,
    supportsDryRun: true,
    tools: {
      codex: {
        available: true,
        path: "/opt/homebrew/bin/codex",
        version: "1.0.0",
      },
      gh: {
        available: true,
        path: "/opt/homebrew/bin/gh",
        version: "2.0.0",
      },
      git: {
        available: true,
        path: "/usr/bin/git",
        version: "2.50.0",
      },
      node: {
        available: true,
        path: "/opt/homebrew/bin/node",
        version: "24.0.0",
      },
      pnpm: {
        available: true,
        path: "/opt/homebrew/bin/pnpm",
        version: "10.0.0",
      },
    },
    ...overrides,
  });

type TaskPacketOverrides = Partial<
  Omit<TaskPacket, "context" | "policy" | "repo" | "source" | "validation">
> & {
  context?: Partial<TaskPacket["context"]>;
  policy?: RepoPolicy;
  repo?: Partial<TaskPacket["repo"]>;
  source?: Partial<TaskPacket["source"]>;
  validation?: Partial<TaskPacket["validation"]>;
};

const taskPacket = (overrides: TaskPacketOverrides = {}): TaskPacket => {
  const base: TaskPacket = {
    acceptanceCriteria: ["The runner protocol preserves metadata-only task execution."],
    context: {
      files: ["apps/web/src/jobs/poll.ts", "apps/web/src/jobs/claim.ts"],
      notes: ["Use only metadata-safe path references."],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: "2026-05-26T09:58:00.000Z",
    id: "packet_1",
    mode: "execute",
    objective: "Verify the web-to-runner protocol loop.",
    policy,
    repo: {
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      targetBranch: "codex/protocol-loop",
    },
    repositoryId: "repo_mapping_1",
    runId: "run_1",
    source: {
      title: "Verify runner protocol",
      type: "manual",
    },
    validation: {
      commands: [validationCommand],
    },
    workspaceId,
  };

  return TaskPacketSchema.parse({
    ...base,
    ...overrides,
    context: {
      ...base.context,
      ...overrides.context,
    },
    policy: overrides.policy ?? base.policy,
    repo: {
      ...base.repo,
      ...overrides.repo,
    },
    source: {
      ...base.source,
      ...overrides.source,
    },
    validation: {
      commands: overrides.validation?.commands ?? base.validation.commands,
    },
  });
};

type ProtocolRun = PollRunRow &
  ClaimRunRow & {
    changedPaths: string[];
    lastEventAt: Date | null;
    riskFindings: RiskFinding[];
  };

type ProtocolCortexTask = {
  id: string;
  latestRunId: string | null;
  prArtifactIds: string[];
  runIds: string[];
  status: string;
  updatedAt: Date;
  workspaceId: string;
};

type ProtocolStore = PollJobsStore &
  ClaimJobStore &
  SubmitRunEventStore &
  RunArtifactSubmissionStore & {
    cortexTasks: ProtocolCortexTask[];
    prArtifacts: PrArtifact[];
    runEvents: RunEvent[];
    runs: ProtocolRun[];
    validationResults: ValidationResult[];
  };

const repoMapping = (overrides: Partial<PollRepoMappingRow> = {}): PollRepoMappingRow =>
  ({
    archivedAt: null,
    defaultBranch: "main",
    id: "repo_mapping_1",
    localPath: "/repos/control-plane",
    runnerId,
    workspaceId,
    ...overrides,
  }) as PollRepoMappingRow;

const runRow = (overrides: Partial<ProtocolRun> = {}): ProtocolRun => {
  const id = overrides.id ?? "run_1";
  const jobId = overrides.jobId ?? "job_1";
  const packet =
    overrides.taskPacket ??
    taskPacket({
      id: `packet_${id}`,
      runId: id,
    });

  return {
    attemptCount: 0,
    capabilitiesSnapshot: null,
    changedPaths: [],
    claimExpiresAt: null,
    claimIdempotencyKey: null,
    claimedAt: null,
    contractVersion: CONTRACT_VERSION,
    createdAt: now,
    id,
    jobId,
    jobType: "task",
    lastEventAt: null,
    maxAttempts: 1,
    mode: "execute",
    queuedAt: now,
    repoMappingId: "repo_mapping_1",
    riskFindings: [],
    runnerId: null,
    state: "queued",
    taskId: "task_1",
    taskPacket: packet,
    updatedAt: now,
    workspaceId,
    ...overrides,
  } as ProtocolRun;
};

const validationResult = (runId: string): ValidationResult =>
  ValidationResultSchema.parse({
    command: "pnpm test",
    commandId: "test",
    commandLabel: "Unit tests",
    contractVersion: CONTRACT_VERSION,
    durationMs: 1234,
    exitCode: 0,
    finishedAt: "2026-05-26T10:03:00.000Z",
    id: `validation_${runId}`,
    redactionApplied: true,
    runId,
    startedAt: "2026-05-26T10:02:00.000Z",
    status: "passed",
    stderrSummary: "",
    stdoutSummary: "Validation passed.",
  });

const prArtifact = (runId: string): PrArtifact =>
  PrArtifactSchema.parse({
    branchName: `codex/${runId}`,
    changedFilePaths: ["apps/web/src/jobs/runner-protocol-e2e.test.ts"],
    contractVersion: CONTRACT_VERSION,
    createdAt: "2026-05-26T10:04:00.000Z",
    id: `pr_artifact_${runId}`,
    prNumber: runId === "run_cortex_1" ? 85 : 84,
    prStatus: "draft",
    prTitle: `Protocol loop ${runId}`,
    prUrl: `https://github.com/control-plane/app/pull/${runId === "run_cortex_1" ? "85" : "84"}`,
    repository: {
      name: "app",
      owner: "control-plane",
    },
    riskFindings: [],
    runId,
  });

const createProtocolStore = (input: {
  cortexTasks?: ProtocolCortexTask[];
  repoMappings?: PollRepoMappingRow[];
  runs: ProtocolRun[];
}): ProtocolStore => {
  const repoMappings = input.repoMappings ?? [repoMapping()];
  const runEvents: RunEvent[] = [];
  const dryRunResults: DryRunResult[] = [];
  const validationResults: ValidationResult[] = [];
  const prArtifacts: PrArtifact[] = [];

  const findRun = (runId: string, runWorkspaceId: string) =>
    input.runs.find(
      (candidate) => candidate.id === runId && candidate.workspaceId === runWorkspaceId,
    );

  const findMapping = (run: ProtocolRun) =>
    repoMappings.find(
      (candidate) =>
        candidate.id === run.repoMappingId && candidate.workspaceId === run.workspaceId,
    );

  const store: ProtocolStore = {
    cortexTasks: input.cortexTasks ?? [],
    prArtifacts,
    runEvents,
    runs: input.runs,
    validationResults,
    blockRunForMissingMapping: async ({ finding, runId, updatedAt, workspaceId }) => {
      const run = findRun(runId, workspaceId);

      if (run === undefined) {
        return;
      }

      run.riskFindings = [
        ...run.riskFindings.filter((riskFinding) => riskFinding.id !== finding.id),
        finding,
      ];
      run.state = "blocked";
      run.updatedAt = updatedAt;
    },
    claimRun: async (claimInput) => {
      const run = input.runs.find(
        (candidate) =>
          candidate.id === claimInput.runId &&
          candidate.jobId === claimInput.jobId &&
          candidate.workspaceId === claimInput.workspaceId,
      );

      if (run === undefined || run.state !== "queued" || run.claimIdempotencyKey !== null) {
        return {
          run: run ?? null,
          status: "miss",
        };
      }

      const mapping = findMapping(run);
      const parsedPacket = TaskPacketSchema.safeParse(run.taskPacket);
      const packet = parsedPacket.success ? parsedPacket.data : null;
      const mappingIsEligible =
        mapping !== undefined &&
        mapping.archivedAt === null &&
        mapping.runnerId === claimInput.runnerId &&
        mapping.localPath === packet?.repo.localPath &&
        mapping.defaultBranch === packet?.repo.defaultBranch &&
        packet.runId === run.id &&
        (packet.workspaceId === undefined || packet.workspaceId === run.workspaceId);

      if (!mappingIsEligible) {
        run.riskFindings = [
          ...run.riskFindings.filter(
            (riskFinding) => riskFinding.id !== claimInput.missingMappingFinding.id,
          ),
          claimInput.missingMappingFinding,
        ];
        run.state = "blocked";
        run.updatedAt = claimInput.updatedAt;

        return {
          run,
          status: "blocked_missing_mapping",
        };
      }

      run.capabilitiesSnapshot = claimInput.capabilitiesSnapshot;
      run.claimExpiresAt = claimInput.claimExpiresAt;
      run.claimIdempotencyKey = claimInput.idempotencyKey;
      run.claimedAt = claimInput.claimedAt;
      run.runnerId = claimInput.runnerId;
      run.state = "claimed";
      run.updatedAt = claimInput.updatedAt;

      return {
        run,
        status: "claimed",
      };
    },
    findCancellationForCurrentRuns: async ({ runIds, runnerId: currentRunnerId, workspaceId }) => {
      const run = runIds
        .map((runId) => findRun(runId, workspaceId))
        .find(
          (candidate) =>
            candidate !== undefined &&
            candidate.runnerId === currentRunnerId &&
            candidate.state === "cancel_requested",
        );

      if (run === undefined) {
        return null;
      }

      return {
        cancellationReason: run.cancellationReason ?? null,
        cancellationRequestedAt: run.cancellationRequestedAt ?? null,
        cancellationRequestedByActorId: run.cancellationRequestedByActorId ?? null,
        runId: run.id,
      };
    },
    listQueuedRuns: async ({ excludedRunIds, limit, repoMappingIds, workspaceId }) =>
      input.runs
        .filter(
          (run) =>
            run.workspaceId === workspaceId &&
            run.state === "queued" &&
            !excludedRunIds.includes(run.id) &&
            (repoMappingIds === undefined || repoMappingIds.includes(run.repoMappingId)),
        )
        .sort((left, right) => left.queuedAt.getTime() - right.queuedAt.getTime())
        .slice(0, limit),
    listRepoMappingsForWorkspace: async ({ workspaceId }) =>
      repoMappings.filter((mapping) => mapping.workspaceId === workspaceId),
    persistDryRunResult: async ({ result, runnerId: currentRunnerId, workspaceId }) => {
      const run = findRun(result.runId, workspaceId);

      if (run === undefined) {
        return { status: "run_not_found" };
      }

      if (run.runnerId !== currentRunnerId) {
        return { status: "runner_conflict" };
      }

      const existing = dryRunResults.find((candidate) => candidate.runId === result.runId);

      if (existing !== undefined) {
        if (existing.id !== result.id) {
          return { status: "artifact_conflict" };
        }

        return {
          inserted: false,
          result: existing,
          status: "stored",
        };
      }

      dryRunResults.push(result);

      return {
        inserted: true,
        result,
        status: "stored",
      };
    },
    persistPrArtifact: async ({
      artifact,
      runnerId: currentRunnerId,
      submittedAt,
      workspaceId,
    }) => {
      const run = findRun(artifact.runId, workspaceId);

      if (run === undefined) {
        return { status: "run_not_found" };
      }

      if (run.runnerId !== currentRunnerId) {
        return { status: "runner_conflict" };
      }

      const existing = prArtifacts.find(
        (candidate) => candidate.runId === artifact.runId && candidate.id === artifact.id,
      );

      if (existing !== undefined) {
        return {
          artifact: existing,
          inserted: false,
          status: "stored",
        };
      }

      if (prArtifacts.some((candidate) => candidate.runId === artifact.runId)) {
        return { status: "artifact_conflict" };
      }

      prArtifacts.push(artifact);
      run.changedPaths = artifact.changedFilePaths;
      run.riskFindings = artifact.riskFindings;
      run.updatedAt = submittedAt;

      for (const task of store.cortexTasks) {
        if (task.workspaceId !== workspaceId || !task.runIds.includes(artifact.runId)) {
          continue;
        }

        task.prArtifactIds = [...new Set([...task.prArtifactIds, artifact.id])];
        task.status = "pr_opened";
        task.updatedAt = submittedAt;
      }

      return {
        artifact,
        inserted: true,
        status: "stored",
      };
    },
    persistRunEvent: async ({
      event,
      eventCreatedAt,
      receivedAt,
      runnerId: currentRunnerId,
      workspaceId,
    }) => {
      const run = findRun(event.runId, workspaceId);

      if (run === undefined) {
        return { status: "run_not_found" };
      }

      if (run.runnerId !== null && run.runnerId !== currentRunnerId) {
        return { status: "runner_conflict" };
      }

      const existing = runEvents.find(
        (candidate) =>
          candidate.runId === event.runId && candidate.idempotencyKey === event.idempotencyKey,
      );

      if (existing !== undefined) {
        return {
          event: existing,
          inserted: false,
          status: "stored",
        };
      }

      if (runEvents.some((candidate) => candidate.id === event.id)) {
        return { status: "event_id_conflict" };
      }

      runEvents.push(event);

      if (
        shouldUpdateRunAggregateForEvent({
          currentLastEventAt: run.lastEventAt,
          eventCreatedAt,
        })
      ) {
        run.lastEventAt = eventCreatedAt;
        run.state = getConservativeRunEventRunState({
          currentState: run.state,
          eventState: event.state,
        });
        run.updatedAt = receivedAt;
      }

      return {
        event,
        inserted: true,
        status: "stored",
      };
    },
    persistValidationResult: async ({ result, runnerId: currentRunnerId, workspaceId }) => {
      const run = findRun(result.runId, workspaceId);

      if (run === undefined) {
        return { status: "run_not_found" };
      }

      if (run.runnerId !== currentRunnerId) {
        return { status: "runner_conflict" };
      }

      const existing = validationResults.find(
        (candidate) => candidate.id === result.id && candidate.runId === result.runId,
      );

      if (existing !== undefined) {
        return {
          inserted: false,
          result: existing,
          status: "stored",
        };
      }

      validationResults.push(result);

      return {
        inserted: true,
        result,
        status: "stored",
      };
    },
    recordDuplicateAssignmentBlock: vi.fn(async ({ event }) => {
      runEvents.push(event);
    }),
  };

  return store;
};

const pollRequest = (currentRunIds: string[] = []) => ({
  availableConcurrency: currentRunIds.length === 0 ? 1 : 0,
  capabilities: capabilities(),
  contractVersion: CONTRACT_VERSION,
  knownCurrentRunIds: currentRunIds,
  runnerId,
});

const exerciseRunnerProtocol = async (store: ProtocolStore, run: ProtocolRun) => {
  const context = { runnerId, workspaceId };
  const pollService = createPollJobsService({
    now: () => now,
    pollIntervalSeconds: 15,
    store,
  });
  const claimService = createClaimJobService({
    now: () => now,
    store,
  });
  const eventService = createSubmitRunEventService({
    now: () => new Date("2026-05-26T10:01:00.000Z"),
    store,
  });
  const validationService = createSubmitValidationResultService({
    store,
  });
  const prService = createSubmitPrArtifactService({
    store,
  });

  const pollResponse = await pollService.pollJobs({
    context,
    request: pollRequest(),
  });

  expect(pollResponse.jobs).toHaveLength(1);
  expect(pollResponse.jobs[0]).toMatchObject({
    jobId: run.jobId,
    runId: run.id,
    taskPacket: {
      id: (run.taskPacket as TaskPacket).id,
      runId: run.id,
      workspaceId,
    },
  });

  const claimResponse = await claimService.claimJob({
    context,
    request: {
      capabilitiesSnapshot: capabilities(),
      contractVersion: CONTRACT_VERSION,
      idempotencyKey: createClaimJobIdempotencyKey({
        jobId: run.jobId,
        runId: run.id,
        runnerId,
      }),
      jobId: run.jobId,
      runId: run.id,
      runnerId,
    },
  });

  expect(claimResponse).toMatchObject({
    claimedByRunnerId: runnerId,
    jobId: run.jobId,
    runId: run.id,
    status: "claimed",
  });

  const event = await eventService.submitRunEvent({
    context,
    request: {
      contractVersion: CONTRACT_VERSION,
      createdAt: "2026-05-26T10:01:00.000Z",
      eventId: `event_${run.id}_validation_running`,
      idempotencyKey: createRunEventIdempotencyKey({
        attempt: 1,
        runId: run.id,
        stableStepName: "validation_running",
      }),
      message: "Validation running.",
      metadata: {
        changedFilePaths: ["apps/web/src/jobs/runner-protocol-e2e.test.ts"],
        validationCommandIds: ["test"],
      },
      runId: run.id,
      runnerId,
      severity: "info",
      state: "validation_running",
    },
  });

  expect(event).toMatchObject({
    runId: run.id,
    runnerId,
    state: "validation_running",
  });

  const validation = await validationService.submitValidationResult({
    context,
    request: {
      contractVersion: CONTRACT_VERSION,
      result: validationResult(run.id),
      runId: run.id,
      runnerId,
      submittedAt: "2026-05-26T10:03:30.000Z",
    },
  });

  expect(validation).toMatchObject({
    id: `validation_${run.id}`,
    runId: run.id,
    status: "passed",
  });

  const artifact = await prService.submitPrArtifact({
    context,
    request: {
      artifact: prArtifact(run.id),
      contractVersion: CONTRACT_VERSION,
      runId: run.id,
      runnerId,
      submittedAt: "2026-05-26T10:04:30.000Z",
    },
  });

  expect(artifact).toMatchObject({
    id: `pr_artifact_${run.id}`,
    runId: run.id,
  });

  return { artifact, event, validation };
};

describe("web-to-runner protocol E2E", () => {
  test("manual queued jobs still poll, claim, emit events, validate, and store PR artifacts", async () => {
    const manualRun = runRow({
      id: "run_manual_1",
      jobId: "job_manual_1",
      taskId: "task_manual_1",
      taskPacket: taskPacket({
        id: "packet_manual_1",
        runId: "run_manual_1",
        source: {
          title: "Manual task packet",
          type: "manual",
        },
      }),
    });
    const cortexTask = {
      id: "cortex_task_1",
      latestRunId: "run_cortex_1",
      prArtifactIds: [],
      runIds: ["run_cortex_1"],
      status: "queued",
      updatedAt: now,
      workspaceId,
    };
    const store = createProtocolStore({
      cortexTasks: [cortexTask],
      runs: [manualRun],
    });

    await exerciseRunnerProtocol(store, manualRun);

    expect(store.runEvents).toHaveLength(1);
    expect(store.validationResults.map((result) => result.runId)).toEqual(["run_manual_1"]);
    expect(store.prArtifacts.map((artifact) => artifact.runId)).toEqual(["run_manual_1"]);
    expect(manualRun).toMatchObject({
      changedPaths: ["apps/web/src/jobs/runner-protocol-e2e.test.ts"],
      runnerId,
      state: "validation_running",
    });
    expect(cortexTask).toMatchObject({
      prArtifactIds: [],
      status: "queued",
    });
  });

  test("Cortex Task-derived jobs keep run, validation, and PR artifacts linked to the task", async () => {
    const cortexRun = runRow({
      id: "run_cortex_1",
      jobId: "job_cortex_1",
      taskId: "cortex_task_1",
      taskPacket: taskPacket({
        context: {
          files: ["apps/web/src/task-packets/build-cortex-task-packet.ts"],
          notes: ["Cortex task id: cortex_task_1.", "Risk level: medium."],
        },
        id: "packet_cortex_1",
        repositoryId: "rory/payslip-peeks-and-probes",
        runId: "run_cortex_1",
        source: {
          title: "Cortex Task readiness remediation",
          type: "manual",
        },
      }),
    });
    const cortexTask = {
      id: "cortex_task_1",
      latestRunId: "run_cortex_1",
      prArtifactIds: [],
      runIds: ["run_cortex_1"],
      status: "queued",
      updatedAt: now,
      workspaceId,
    };
    const store = createProtocolStore({
      cortexTasks: [cortexTask],
      runs: [cortexRun],
    });

    await exerciseRunnerProtocol(store, cortexRun);

    expect(store.runEvents).toMatchObject([
      {
        runId: "run_cortex_1",
        state: "validation_running",
      },
    ]);
    expect(store.validationResults.map((result) => result.runId)).toEqual(["run_cortex_1"]);
    expect(store.prArtifacts.map((artifact) => artifact.runId)).toEqual(["run_cortex_1"]);
    expect(cortexTask).toMatchObject({
      latestRunId: "run_cortex_1",
      prArtifactIds: ["pr_artifact_run_cortex_1"],
      runIds: ["run_cortex_1"],
      status: "pr_opened",
      workspaceId,
    });
  });

  test("current-run polling returns cancellation metadata before offering more work", async () => {
    const currentRun = runRow({
      cancellationReason: "Stop before validation.",
      cancellationRequestedAt: new Date("2026-05-26T10:05:00.000Z"),
      cancellationRequestedByActorId: "user_1",
      id: "run_current_1",
      jobId: "job_current_1",
      runnerId,
      state: "cancel_requested",
      taskPacket: taskPacket({
        id: "packet_current_1",
        runId: "run_current_1",
      }),
    });
    const nextRun = runRow({
      id: "run_next_1",
      jobId: "job_next_1",
      taskPacket: taskPacket({
        id: "packet_next_1",
        runId: "run_next_1",
      }),
    });
    const store = createProtocolStore({
      runs: [currentRun, nextRun],
    });
    const service = createPollJobsService({
      now: () => now,
      store,
    });

    const response = await service.pollJobs({
      context: { runnerId, workspaceId },
      request: pollRequest(["run_current_1"]),
    });

    expect(response.jobs).toEqual([]);
    expect(response.cancellation).toMatchObject({
      reason: "Stop before validation.",
      runId: "run_current_1",
    });
  });

  test("repair jobs are exposed only when they carry a repair task packet", async () => {
    const packetlessRepair = runRow({
      id: "run_repair_packetless",
      jobId: "job_repair_packetless",
      jobType: "repair",
      taskPacket: null,
    });
    const repairRun = runRow({
      id: "run_repair_1",
      jobId: "job_repair_1",
      jobType: "repair",
      mode: "repair",
      taskPacket: taskPacket({
        id: "packet_repair_1",
        mode: "repair",
        repair: {
          attempt: 1,
          feedback: "Repair the failed validation.",
          maxAttempts: 2,
          previousRunId: "run_previous_1",
        },
        repo: {
          targetBranch: "codex/repair-protocol-loop",
        },
        runId: "run_repair_1",
        source: {
          title: "Repair protocol loop",
          type: "repair",
        },
      }),
    });
    const store = createProtocolStore({
      runs: [packetlessRepair, repairRun],
    });
    const service = createPollJobsService({
      now: () => now,
      store,
    });

    const response = await service.pollJobs({
      context: { runnerId, workspaceId },
      request: pollRequest(),
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]).toMatchObject({
      jobId: "job_repair_1",
      runId: "run_repair_1",
      taskPacket: {
        mode: "repair",
        repair: {
          previousRunId: "run_previous_1",
        },
      },
      type: "repair",
    });
  });
});
