import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  RunnerJobSchema,
  type CortexTask,
  type RepoPolicy,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import {
  createCortexTaskRunnerQueueService,
  evaluateCortexTaskRunnerEligibility,
  type CortexTaskRunnerQueueStore,
  type QueueCortexTaskRunnerJobInput,
} from "./cortex-queue.js";
import { toRunnerJob, type ManualQueueRunRow } from "./manual-queue.js";

vi.mock("server-only", () => ({}));

const now = new Date("2026-05-24T14:00:00.000Z");

const requiredValidationCommand = {
  command: "pnpm test",
  id: "test",
  label: "Tests",
  required: true,
  timeoutSeconds: 300,
} satisfies ValidationCommand;

const optionalValidationCommand = {
  command: "pnpm run lint",
  id: "lint",
  label: "Lint",
  required: false,
  timeoutSeconds: 120,
} satisfies ValidationCommand;

const policySnapshot = {
  allowUntrackedFiles: false,
  contractVersion: CONTRACT_VERSION,
  dryRunChecks: [...DRY_RUN_CHECKS],
  maxChangedFiles: 25,
  protectedBranches: ["main"],
  protectedPaths: ["packages/shared/**"],
  sensitivePaths: [".env", ".env.*"],
  validationCommands: [optionalValidationCommand],
  warningPaths: {
    auth: ["apps/web/src/server/auth.ts"],
    billing: ["apps/web/src/billing/**"],
    infrastructure: [".github/**"],
    migrations: ["packages/db/migrations/**"],
    packageLocks: ["pnpm-lock.yaml"],
  },
} satisfies RepoPolicy;

const baseCortexTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  acceptanceCriteria: [
    "Runner receives a schema-valid task packet.",
    "Task execution remains metadata-only in web storage.",
  ],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-24T13:45:00.000Z",
  executionMode: "local_runner",
  externalLinks: [],
  findingIds: ["finding_1"],
  metadata: {},
  objective: "Queue the approved Cortex Task for the local runner.",
  origin: {
    type: "finding",
  },
  prArtifactIds: [],
  repoId: "github_repo_1",
  riskLevel: "medium",
  runIds: [],
  status: "approved",
  suggestedValidation: [
    { label: "Tests", required: true, validationId: "test" },
    { label: "Lint", required: false, validationId: "lint" },
  ],
  taskId: "cortex_task_1",
  title: "Queue Cortex task",
  updatedAt: "2026-05-24T13:50:00.000Z",
  workspaceId: "workspace_1",
  ...overrides,
});

const baseRepoMapping = () => ({
  archivedAt: null,
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/Users/rory/src/control-plane",
  policySnapshot,
  repositoryName: "control-plane",
  repositoryOwner: "rory-hayes",
  validationCommands: [requiredValidationCommand, optionalValidationCommand],
  workspaceId: "workspace_1",
});

const baseGitHubRepository = () => ({
  archived: false,
  disabled: false,
  id: "github_repo_1",
  repositoryFullName: "rory-hayes/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory-hayes",
  workspaceId: "workspace_1",
});

const createRunRow = (input: QueueCortexTaskRunnerJobInput): ManualQueueRunRow => ({
  attemptCount: 0,
  cancellationReason: null,
  cancellationRequestedAt: null,
  cancellationRequestedByActorId: null,
  changedPaths: [],
  claimExpiresAt: null,
  contractVersion: input.taskPacket.contractVersion,
  createdAt: input.queuedAt,
  id: input.runId,
  jobId: input.jobId,
  jobType: "task",
  maxAttempts: 1,
  mode: input.taskPacket.mode,
  policySnapshot: input.taskPacket.policy,
  queuedAt: input.queuedAt,
  repoMappingId: input.repoMappingId,
  riskFindings: [],
  state: "queued",
  taskId: input.legacyTask.id,
  taskPacket: input.taskPacket,
  updatedAt: input.queuedAt,
  validationCommands: input.taskPacket.validation.commands,
  workspaceId: input.workspaceId,
});

type CortexTaskRunnerQueueContextOverrides = Partial<{
  githubRepository: ReturnType<typeof baseGitHubRepository> | null;
  hasAvailableLocalRunner: boolean;
  repoMapping: ReturnType<typeof baseRepoMapping> | null;
  requiredApprovalExists: boolean;
}>;

const createStore = (
  task: CortexTask = baseCortexTask(),
  contextOverrides: CortexTaskRunnerQueueContextOverrides = {},
) => {
  const tasks = [task];
  const runs: ManualQueueRunRow[] = [];
  const queueInputs: QueueCortexTaskRunnerJobInput[] = [];
  const store: CortexTaskRunnerQueueStore = {
    findCortexTaskRunnerQueueContext: vi.fn(async ({ taskId, workspaceId }) => {
      const matchedTask = tasks.find(
        (candidate) => candidate.taskId === taskId && candidate.workspaceId === workspaceId,
      );

      if (matchedTask === undefined) {
        return null;
      }

      return {
        githubRepository: baseGitHubRepository(),
        hasAvailableLocalRunner: true,
        repoMapping: baseRepoMapping(),
        requiredApprovalExists: matchedTask.riskLevel === "high",
        ...contextOverrides,
        task: matchedTask,
      };
    }),
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
      userId === "user_1" && workspaceId === "workspace_1"
        ? { id: "membership_1", role: "owner" }
        : null,
    ),
    queueCortexTaskRunnerJob: vi.fn(async (input) => {
      queueInputs.push(input);
      const run = createRunRow(input);
      runs.push(run);

      const index = tasks.findIndex(
        (candidate) =>
          candidate.taskId === input.cortexTaskId && candidate.workspaceId === input.workspaceId,
      );

      if (index === -1) {
        throw new Error("Missing queued Cortex Task fixture.");
      }

      const previousTask = tasks[index];
      if (previousTask === undefined) {
        throw new Error("Missing queued Cortex Task fixture.");
      }

      const updatedTask = {
        ...previousTask,
        latestRunId: input.runId,
        runIds: [...new Set([...previousTask.runIds, input.runId])],
        status: "queued",
        taskPacketId: input.taskPacket.id,
        updatedAt: input.queuedAt.toISOString(),
      } satisfies CortexTask;

      tasks[index] = updatedTask;

      return {
        run,
        task: updatedTask,
      };
    }),
  };

  const service = createCortexTaskRunnerQueueService({
    createAuditEventId: () => "audit_event_1",
    createJobId: () => "job_cortex_1",
    createPacketId: () => "packet_cortex_1",
    createRunId: () => "run_cortex_1",
    getAuthContext: async () => ({ userId: "user_1" }),
    now: () => now,
    store,
  });

  return {
    queueInputs,
    runs,
    service,
    store,
    tasks,
  };
};

const collectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    keys.push(key);
    collectKeys(childValue, keys);
  }

  return keys;
};

describe("Cortex Task runner queue", () => {
  test("reports clear runner eligibility reasons without leaking local setup details", () => {
    const eligibility = evaluateCortexTaskRunnerEligibility({
      githubRepository: baseGitHubRepository(),
      hasAvailableLocalRunner: false,
      repoMapping: {
        ...baseRepoMapping(),
        localPath: "/Users/rory/src/control-plane",
        policySnapshot: null,
        validationCommands: [optionalValidationCommand],
      },
      task: baseCortexTask(),
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: [
        expect.objectContaining({
          code: "runner_unavailable",
          fixHref: "/dashboard/runners",
          message: "Pair an available local runner with dry-run and git support.",
        }),
        expect.objectContaining({
          code: "repo_mapping_policy_missing",
          fixHref: "/dashboard/repositories",
          message: "Refresh the repository policy snapshot before queueing local execution.",
        }),
        expect.objectContaining({
          code: "validation_required_missing",
          fixHref: "/dashboard/repositories",
          message: "Add at least one required validation command to the repository mapping.",
        }),
      ],
    });

    const serializedEligibility = JSON.stringify(eligibility);

    expect(serializedEligibility).not.toContain("/Users/rory/src/control-plane");
    expect(serializedEligibility).not.toContain("pnpm test");
    expect(serializedEligibility).not.toContain("pnpm run lint");
  });

  test("rejects runner-ineligible Cortex Tasks before writing queue state", async () => {
    const { runs, service, store } = createStore(baseCortexTask(), {
      hasAvailableLocalRunner: false,
      repoMapping: {
        ...baseRepoMapping(),
        validationCommands: [optionalValidationCommand],
      },
    });

    await expect(
      service.queueApprovedCortexTask({
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.queueCortexTaskRunnerJob).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  test("queues an approved local-runner Cortex Task as an existing runner job", async () => {
    const { queueInputs, runs, service, tasks } = createStore();

    await expect(
      service.queueApprovedCortexTask({
        taskId: " cortex_task_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      approvalStatus: "approved",
      jobId: "job_cortex_1",
      repoId: "github_repo_1",
      repoMappingId: "repo_mapping_1",
      runId: "run_cortex_1",
      runState: "queued",
      status: "queued",
      taskId: "cortex_task_1",
      taskPacketId: "packet_cortex_1",
      workspaceId: "workspace_1",
    });

    expect(queueInputs).toHaveLength(1);
    expect(queueInputs[0]).toMatchObject({
      actorId: "user_1",
      cortexTaskId: "cortex_task_1",
      jobId: "job_cortex_1",
      repoMappingId: "repo_mapping_1",
      runId: "run_cortex_1",
      workspaceId: "workspace_1",
    });
    expect(queueInputs[0]?.legacyTask).toMatchObject({
      approvedAt: now,
      externalId: "cortex_task_1",
      id: "cortex_task_1",
      mode: "execute",
      repoMappingId: "repo_mapping_1",
      sourceType: "manual",
      status: "approved",
      workspaceId: "workspace_1",
    });
    expect(queueInputs[0]?.auditEvent).toMatchObject({
      actorId: "user_1",
      eventType: "repo_readiness_cortex_tasks.queued_for_runner",
      runId: "run_cortex_1",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(queueInputs[0]?.taskPacket).toMatchObject({
      id: "packet_cortex_1",
      mode: "execute",
      runId: "run_cortex_1",
      source: {
        title: "Queue Cortex task",
        type: "manual",
      },
      workspaceId: "workspace_1",
    });
    expect(tasks[0]).toMatchObject({
      latestRunId: "run_cortex_1",
      runIds: ["run_cortex_1"],
      status: "queued",
      taskPacketId: "packet_cortex_1",
    });
    expect(RunnerJobSchema.safeParse(toRunnerJob(runs[0]!)).success).toBe(true);
  });

  test("accepts Linear-sourced Cortex Task packets without falling back to the manual-only queue", async () => {
    const { queueInputs, runs, service } = createStore(
      baseCortexTask({
        externalLinks: [
          {
            externalId: "LIN-123",
            provider: "linear",
            resourceType: "linear_issue",
            status: "open",
            title: "LIN-123 Queue Cortex task",
            url: "https://linear.app/acme/issue/LIN-123/queue-cortex-task",
          },
        ],
        origin: {
          externalId: "LIN-123",
          externalSystem: "linear",
          type: "external_import",
        },
      }),
    );

    await expect(
      service.queueApprovedCortexTask({
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      runId: "run_cortex_1",
      status: "queued",
      taskId: "cortex_task_1",
    });

    expect(queueInputs[0]?.legacyTask).toMatchObject({
      externalId: "cortex_task_1",
      sourceType: "linear",
    });
    expect((queueInputs[0]?.taskPacket as TaskPacket | undefined)?.source).toEqual({
      externalId: "LIN-123",
      title: "Queue Cortex task",
      type: "linear",
      url: "https://linear.app/acme/issue/LIN-123/queue-cortex-task",
    });
    expect(RunnerJobSchema.safeParse(toRunnerJob(runs[0]!)).success).toBe(true);
  });

  test("keeps queue audit metadata free of source payload, diffs, snippets, and command output", async () => {
    const { queueInputs, service } = createStore();

    await service.queueApprovedCortexTask({
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });

    const auditMetadata = queueInputs[0]?.auditEvent.metadata;
    const unsafeKeys = collectKeys(auditMetadata).filter((key) =>
      /(?:content|diff|output|patch|raw|secret|snippet|source|stderr|stdout|token)/iu.test(key),
    );

    expect(unsafeKeys).toEqual([]);
    expect(JSON.stringify(auditMetadata)).not.toContain("pnpm test");
    expect(JSON.stringify(auditMetadata)).not.toContain("/Users/rory/src/control-plane");
  });

  test("rejects non-approved Cortex Tasks before writing a run", async () => {
    const { runs, service, store } = createStore(
      baseCortexTask({
        approvalStatus: "pending",
        status: "needs_review",
      }),
    );

    await expect(
      service.queueApprovedCortexTask({
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.queueCortexTaskRunnerJob).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });
});
