import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  RunnerJobSchema,
  TaskPacketSchema,
  type RepoPolicy,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import type { AuditEventInsert } from "../server/audit";
import type {
  BuildRepairTaskPacket,
  PreviousRunForRepair,
  PreviousRunValidationSummary,
  RepairRequestInsert,
  RepairRunEventInsert,
  RepairRequestStore,
  RepairRunInsert,
} from "./repair-requests";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRequest = async () => import("./repair-requests");

const createdAt = new Date("2026-05-23T10:15:00.000Z");

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

const createOriginalTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  TaskPacketSchema.parse({
    acceptanceCriteria: ["Repair requests can preserve original task criteria."],
    context: {
      files: ["apps/web/src/repairs/repair-requests.ts"],
      notes: ["Original context remains path-only."],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: "2026-05-23T09:30:00.000Z",
    id: "packet_previous",
    mode: "execute",
    objective: "Add repair request support.",
    policy,
    repo: {
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      targetBranch: "aicp/manual-task-145-run-previous",
      worktreePath: "/tmp/stale-repair-worktree",
    },
    repositoryId: "repo_mapping_1",
    runId: "run_previous",
    source: {
      externalId: "manual_task_145",
      title: "Repair request model",
      type: "manual",
    },
    validation: {
      commands: [validationCommand],
    },
    workspaceId: "workspace_1",
    ...overrides,
  });

const createRepairTaskPacket = (input: {
  attempt: number;
  feedback: string;
  maxAttempts: number;
  previousRun: PreviousRunForRepair;
  queuedRunId: string;
  repairRequestId: string;
  requestedAt: Date;
  workspaceId: string;
}): TaskPacket =>
  TaskPacketSchema.parse({
    acceptanceCriteria: ["Repair the previous run according to reviewer feedback."],
    context: {
      files: ["apps/web/src/repairs/repair-requests.ts"],
      notes: ["Repair context remains path-only."],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: input.requestedAt.toISOString(),
    id: `packet_${input.queuedRunId}`,
    mode: "repair",
    objective: "Repair the previous control-plane run.",
    policy: input.previousRun.policySnapshot ?? policy,
    repair: {
      attempt: input.attempt,
      feedback: input.feedback,
      maxAttempts: input.maxAttempts,
      previousRunId: input.previousRun.id,
    },
    repo: {
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      targetBranch: "aicp/repair-run",
    },
    repositoryId: input.previousRun.taskPacket?.repositoryId ?? input.previousRun.repoMappingId,
    runId: input.queuedRunId,
    source: {
      externalId: input.repairRequestId,
      title: "Repair request",
      type: "repair",
    },
    validation: {
      commands: input.previousRun.validationCommands ?? [validationCommand],
    },
    workspaceId: input.workspaceId,
  });

const createRepairPacketBuilder = (): ReturnType<typeof vi.fn<BuildRepairTaskPacket>> =>
  vi.fn<BuildRepairTaskPacket>((input) => createRepairTaskPacket(input));

const createValidationSummary = (
  overrides: Partial<PreviousRunValidationSummary> = {},
): PreviousRunValidationSummary => ({
  commandId: "test",
  commandLabel: "Unit tests",
  durationMs: 1_000,
  exitCode: 1,
  finishedAt: new Date("2026-05-23T10:07:00.000Z"),
  redactionApplied: true,
  startedAt: new Date("2026-05-23T10:06:00.000Z"),
  status: "failed",
  stderrSummary: "Unit test failure summary after redaction.",
  stdoutSummary: "One repair flow test failed after redaction.",
  ...overrides,
});

type StoredPreviousRunForRepair = PreviousRunForRepair & {
  lastEventAt: Date | null;
  updatedAt: Date;
};

type RepairStore = RepairRequestStore & {
  auditEvents: AuditEventInsert[];
  createRepairRequestWithJob: ReturnType<
    typeof vi.fn<RepairRequestStore["createRepairRequestWithJob"]>
  >;
  findWorkspaceMembership: ReturnType<typeof vi.fn<RepairRequestStore["findWorkspaceMembership"]>>;
  previousRuns: StoredPreviousRunForRepair[];
  runEvents: RepairRunEventInsert[];
  repairRequests: RepairRequestInsert[];
  repairRuns: RepairRunInsert[];
};

const createPreviousRun = (
  overrides: Partial<StoredPreviousRunForRepair> = {},
): StoredPreviousRunForRepair => ({
  attemptCount: 0,
  changedPaths: [],
  contractVersion: CONTRACT_VERSION,
  id: "run_previous",
  jobId: "job_previous",
  maxAttempts: 1,
  mode: "execute",
  policySnapshot: policy,
  repoMappingId: "repo_mapping_1",
  state: "awaiting_approval",
  taskId: "task_1",
  taskPacket: null,
  lastEventAt: null,
  updatedAt: new Date("2026-05-23T10:00:00.000Z"),
  validationCommands: [validationCommand],
  validationSummaries: [],
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    previousRuns?: StoredPreviousRunForRepair[];
    repairRequests?: RepairRequestInsert[];
  } = {},
): RepairStore => {
  const previousRuns = input.previousRuns ?? [createPreviousRun()];
  const repairRequests = [...(input.repairRequests ?? [])];
  const repairRuns: RepairRunInsert[] = [];
  const runEvents: RepairRunEventInsert[] = [];
  const auditEvents: AuditEventInsert[] = [];
  const store: RepairStore = {
    auditEvents,
    createRepairRequestWithJob: vi.fn<RepairRequestStore["createRepairRequestWithJob"]>(
      async ({
        auditEventFor,
        buildRepairRows,
        defaultMaxAttempts,
        previousRunId,
        runEventFor,
        requestedAt,
        workspaceId,
      }) => {
        const previousRun = previousRuns.find(
          (run) => run.id === previousRunId && run.workspaceId === workspaceId,
        );

        if (previousRun === undefined) {
          return { status: "not_found" as const };
        }

        if (previousRun.state !== "awaiting_approval") {
          return { status: "not_repairable" as const };
        }

        const maxAttempts = Math.max(previousRun.maxAttempts, defaultMaxAttempts);
        const attempt = previousRun.attemptCount + 1;

        if (attempt > maxAttempts) {
          return {
            attempt,
            maxAttempts,
            status: "max_attempts_reached" as const,
          };
        }

        const rows = buildRepairRows({
          attempt,
          maxAttempts,
          previousRun,
        });
        const previousRunForAudit = { ...previousRun };

        repairRuns.push(rows.repairRun);
        repairRequests.push(rows.repairRequest);
        previousRun.state = "repair_requested";
        previousRun.lastEventAt = requestedAt;
        previousRun.updatedAt = requestedAt;
        runEvents.push(
          runEventFor({
            previousRun: previousRunForAudit,
            repairRequest: rows.repairRequest,
            repairRun: rows.repairRun,
          }),
        );
        auditEvents.push(
          auditEventFor({
            previousRun: previousRunForAudit,
            repairRequest: rows.repairRequest,
            repairRun: rows.repairRun,
          }),
        );

        return {
          previousRun,
          repairRequest: rows.repairRequest,
          repairRun: rows.repairRun,
          status: "created" as const,
        };
      },
    ),
    findWorkspaceMembership: vi.fn<RepairRequestStore["findWorkspaceMembership"]>(
      async ({ userId, workspaceId }) =>
        input.memberships?.some(
          (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
        )
          ? { id: "membership_1", role: "member" }
          : null,
    ),
    previousRuns,
    runEvents,
    repairRequests,
    repairRuns,
  };

  return store;
};

describe("repair request service", () => {
  test("creates a queued repair run with the real repair task packet builder", async () => {
    const { createRepairRequestService } = await importRequest();
    const { buildRepairTaskPacket } = await import("./build-repair-packet");
    const previousRun = createPreviousRun({
      changedPaths: ["apps/web/src/repairs/repair-requests.ts"],
      taskPacket: createOriginalTaskPacket({
        repositoryId: "rory/control-plane",
      }),
      validationSummaries: [createValidationSummary()],
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      previousRuns: [previousRun],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket,
      createJobId: () => "job_repair_1",
      createRepairRequestId: () => "repair_request_1",
      createQueuedRunId: () => "run_repair_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please fix the validation failure without changing the original scope.",
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      queuedRunId: "run_repair_1",
      repairRequestId: "repair_request_1",
    });

    const taskPacket = store.repairRuns[0]?.taskPacket;

    expect(TaskPacketSchema.safeParse(taskPacket).success).toBe(true);
    expect(taskPacket).toMatchObject({
      acceptanceCriteria: ["Repair requests can preserve original task criteria."],
      mode: "repair",
      repair: {
        attempt: 1,
        feedback: "Please fix the validation failure without changing the original scope.",
        maxAttempts: 2,
        previousRunId: "run_previous",
      },
      repo: {
        defaultBranch: "main",
        localPath: "/repos/control-plane",
        targetBranch: "aicp/manual-task-145-run-previous",
      },
      repositoryId: "rory/control-plane",
      runId: "run_repair_1",
      source: {
        externalId: "repair_request_1",
        type: "repair",
      },
    });
    expect(taskPacket?.repo).not.toHaveProperty("worktreePath");
    expect(taskPacket?.context.files).toEqual(["apps/web/src/repairs/repair-requests.ts"]);
    expect(taskPacket?.context.notes.join("\n")).toContain(
      "Validation Unit tests failed with exit code 1",
    );
    const serializedPacket = JSON.stringify(taskPacket);

    expect(serializedPacket).not.toMatch(
      /diff --git|@@ -\d|\bpatch\b|sourceCode|\bstdout\b|\bstderr\b|-----BEGIN|\.env=/i,
    );
  });

  test("defaults to the real repair task packet builder when no builder is injected", async () => {
    const { createRepairRequestService } = await importRequest();
    const previousRun = createPreviousRun({
      changedPaths: ["apps/web/src/repairs/repair-requests.ts"],
      taskPacket: createOriginalTaskPacket(),
      validationSummaries: [createValidationSummary()],
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      previousRuns: [previousRun],
    });
    const service = createRepairRequestService({
      createJobId: () => "job_repair_1",
      createRepairRequestId: () => "repair_request_1",
      createQueuedRunId: () => "run_repair_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please fix the validation failure without changing the original scope.",
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      queuedRunId: "run_repair_1",
      repairRequestId: "repair_request_1",
    });

    expect(store.repairRuns[0]?.taskPacket).toMatchObject({
      mode: "repair",
      repair: {
        attempt: 1,
        feedback: "Please fix the validation failure without changing the original scope.",
        maxAttempts: 2,
        previousRunId: "run_previous",
      },
      source: {
        externalId: "repair_request_1",
        type: "repair",
      },
    });
  });

  test("creates attempt 1 from an original run using an injected repair task packet builder", async () => {
    const { createRepairRequestService } = await importRequest();
    const previousRun = createPreviousRun({
      attemptCount: 0,
      maxAttempts: 1,
      taskPacket: createOriginalTaskPacket({
        repositoryId: "rory/control-plane",
      }),
    });
    const buildRepairTaskPacket = createRepairPacketBuilder();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      previousRuns: [previousRun],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket,
      createAuditEventId: () => "audit_1",
      createJobId: () => "job_repair_1",
      createRunEventId: () => "event_repair_requested_1",
      createRepairRequestId: () => "repair_request_1",
      createQueuedRunId: () => "run_repair_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "  Please adjust the validation handling.  ",
        previousRunId: " run_previous ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      actorId: "user_1",
      attempt: 1,
      createdAt,
      repairJobId: "job_repair_1",
      maxAttempts: 2,
      previousRunId: "run_previous",
      queuedRunId: "run_repair_1",
      redactionApplied: false,
      repairRequestId: "repair_request_1",
      workspaceId: "workspace_1",
    });

    expect(store.repairRequests).toEqual([
      expect.objectContaining({
        attempt: 1,
        feedback: "Please adjust the validation handling.",
        id: "repair_request_1",
        maxAttempts: 2,
        previousRunId: "run_previous",
        queuedRunId: "run_repair_1",
        requestedByActorId: "user_1",
        updatedAt: createdAt,
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.repairRuns).toEqual([
      expect.objectContaining({
        attemptCount: 1,
        id: "run_repair_1",
        jobId: "job_repair_1",
        jobType: "repair",
        maxAttempts: 2,
        mode: "repair",
        repoMappingId: "repo_mapping_1",
        state: "queued",
        taskId: "task_1",
        taskPacket: expect.objectContaining({
          mode: "repair",
          repositoryId: "rory/control-plane",
          repair: {
            attempt: 1,
            feedback: "Please adjust the validation handling.",
            maxAttempts: 2,
            previousRunId: "run_previous",
          },
          runId: "run_repair_1",
          source: expect.objectContaining({
            externalId: "repair_request_1",
            type: "repair",
          }),
        }),
        workspaceId: "workspace_1",
      }),
    ]);
    expect(buildRepairTaskPacket).toHaveBeenCalledWith({
      attempt: 1,
      feedback: "Please adjust the validation handling.",
      maxAttempts: 2,
      previousRun,
      queuedRunId: "run_repair_1",
      repairRequestId: "repair_request_1",
      requestedAt: createdAt,
      workspaceId: "workspace_1",
    });
    expect(
      RunnerJobSchema.safeParse({
        contractVersion: CONTRACT_VERSION,
        jobId: "job_repair_1",
        queuedAt: createdAt.toISOString(),
        runId: "run_repair_1",
        taskPacket: store.repairRuns[0]?.taskPacket,
        type: "repair",
      }).success,
    ).toBe(true);
    expect(previousRun.state).toBe("repair_requested");
    expect(previousRun.lastEventAt).toBe(createdAt);
    expect(previousRun.updatedAt).toBe(createdAt);

    expect(store.runEvents).toEqual([
      expect.objectContaining({
        contractVersion: CONTRACT_VERSION,
        createdAt,
        id: "event_repair_requested_1",
        idempotencyKey: "run:run_previous:event:repair_requested:1",
        message: "Repair requested.",
        metadata: {
          attempt: 1,
          maxAttempts: 2,
          queuedRunId: "run_repair_1",
          repairJobId: "job_repair_1",
          repairRequestId: "repair_request_1",
        },
        receivedAt: createdAt,
        runId: "run_previous",
        runnerId: null,
        severity: "info",
        state: "repair_requested",
        workspaceId: "workspace_1",
      }),
    ]);
    const serializedEvent = JSON.stringify(store.runEvents[0]);

    expect(serializedEvent).not.toContain("Please adjust the validation handling");
    expect(serializedEvent).not.toMatch(
      /feedback|source|diff|patch|snippet|raw|stdout|stderr|log|secret|token|\.env|redaction|remaining|previousRunAttemptCount/i,
    );
    expect(Object.keys(store.runEvents[0]?.metadata ?? {}).sort()).toEqual([
      "attempt",
      "maxAttempts",
      "queuedRunId",
      "repairJobId",
      "repairRequestId",
    ]);

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt,
        eventType: "run.repair_requested",
        id: "audit_1",
        message: "Run repair requested.",
        metadata: {
          feedbackLength: 38,
          feedbackRedactionApplied: false,
          maxAttempts: 2,
          previousRunAttemptCount: 0,
          previousRunId: "run_previous",
          previousRunState: "awaiting_approval",
          repairJobId: "job_repair_1",
          repairRequestId: "repair_request_1",
          queuedRunAttemptCount: 1,
          queuedRunId: "run_repair_1",
          targetState: "repair_requested",
        },
        runId: "run_previous",
        taskId: "task_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(JSON.stringify(store.auditEvents)).not.toContain(
      "Please adjust the validation handling",
    );
  });

  test("creates attempt 2 from a prior repair run with attempt count 1", async () => {
    const { createRepairRequestService } = await importRequest();
    const buildRepairTaskPacket = createRepairPacketBuilder();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      previousRuns: [
        createPreviousRun({
          attemptCount: 1,
          id: "run_repair_1",
          jobId: "job_repair_1",
          maxAttempts: 2,
          mode: "repair",
          state: "awaiting_approval",
        }),
      ],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket,
      createJobId: () => "job_repair_2",
      createRepairRequestId: () => "repair_request_2",
      createQueuedRunId: () => "run_repair_2",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please retry with the reviewer constraint.",
        previousRunId: "run_repair_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      attempt: 2,
      maxAttempts: 2,
      previousRunId: "run_repair_1",
      queuedRunId: "run_repair_2",
      repairJobId: "job_repair_2",
      repairRequestId: "repair_request_2",
    });

    expect(store.repairRequests.at(-1)).toMatchObject({
      attempt: 2,
      previousRunId: "run_repair_1",
      queuedRunId: "run_repair_2",
    });
    expect(store.repairRuns.at(-1)).toMatchObject({
      attemptCount: 2,
      taskPacket: expect.objectContaining({
        mode: "repair",
        repair: expect.objectContaining({
          attempt: 2,
          maxAttempts: 2,
          previousRunId: "run_repair_1",
        }),
        runId: "run_repair_2",
      }),
    });
  });

  test("rejects attempt 3 when max attempts is 2", async () => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      previousRuns: [
        createPreviousRun({
          attemptCount: 2,
          id: "run_repair_2",
          maxAttempts: 2,
          mode: "repair",
        }),
      ],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please try another repair.",
        previousRunId: "run_repair_2",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.repairRequests).toEqual([]);
    expect(store.repairRuns).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects unauthenticated users before mutation", async () => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please adjust validation handling.",
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.createRepairRequestWithJob).not.toHaveBeenCalled();
    expect(store.repairRequests).toEqual([]);
    expect(store.repairRuns).toEqual([]);
  });

  test("rejects authenticated non-members before mutation", async () => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please adjust validation handling.",
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.createRepairRequestWithJob).not.toHaveBeenCalled();
    expect(store.repairRequests).toEqual([]);
    expect(store.repairRuns).toEqual([]);
  });

  test("does not leak missing or out-of-workspace previous run existence", async () => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      previousRuns: [createPreviousRun({ id: "run_hidden", workspaceId: "workspace_2" })],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please adjust validation handling.",
        previousRunId: "run_missing",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.requestRepair({
        feedback: "Please adjust validation handling.",
        previousRunId: "run_hidden",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.repairRequests).toEqual([]);
    expect(store.repairRuns).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test.each(["queued", "repair_requested", "completed", "failed", "cancelled", "blocked"] as const)(
    "rejects %s previous runs before inserting repair rows",
    async (state) => {
      const { createRepairRequestService } = await importRequest();
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        previousRuns: [createPreviousRun({ state })],
      });
      const service = createRepairRequestService({
        buildRepairTaskPacket: createRepairPacketBuilder(),
        getAuthContext: async () => ({ userId: "user_1" }),
        store,
      });

      await expect(
        service.requestRepair({
          feedback: "Please adjust validation handling.",
          previousRunId: "run_previous",
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(store.repairRequests).toEqual([]);
      expect(store.repairRuns).toEqual([]);
      expect(store.auditEvents).toEqual([]);
    },
  );

  test("uses the authenticated actor instead of caller-supplied actor data", async () => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      createRepairRequestId: () => "repair_request_1",
      createQueuedRunId: () => "run_repair_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.requestRepair({
        feedback: "Please adjust validation handling.",
        previousRunId: "run_previous",
        requestedByActorId: "attacker_actor",
        workspaceId: "workspace_1",
      } as Parameters<typeof service.requestRepair>[0] & { requestedByActorId: string }),
    ).resolves.toMatchObject({
      actorId: "user_1",
      repairRequestId: "repair_request_1",
    });

    expect(store.repairRequests[0]?.requestedByActorId).toBe("user_1");
    expect(store.auditEvents[0]?.actorId).toBe("user_1");
    expect(JSON.stringify(store.repairRequests)).not.toContain("attacker_actor");
    expect(JSON.stringify(store.auditEvents)).not.toContain("attacker_actor");
  });

  test("redacts secret-looking feedback before persistence and keeps audit metadata text-free", async () => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      createAuditEventId: () => "audit_1",
      createRepairRequestId: () => "repair_request_1",
      createQueuedRunId: () => "run_repair_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.requestRepair({
        feedback:
          "Please repair because secret=ghp_abcdefghijklmnopqrstuvwxyz123456 and password=password-from-fixture-12345",
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      redactionApplied: true,
      repairRequestId: "repair_request_1",
    });

    expect(store.repairRequests[0]).toMatchObject({
      feedback: "Please repair because secret=[REDACTED_SECRET] and password=[REDACTED_SECRET]",
    });
    expect(store.repairRuns[0]?.taskPacket).toMatchObject({
      mode: "repair",
      repair: {
        feedback: "Please repair because secret=[REDACTED_SECRET] and password=[REDACTED_SECRET]",
      },
    });
    expect(store.auditEvents[0]?.metadata).toMatchObject({
      feedbackLength: 77,
      feedbackRedactionApplied: true,
    });
    expect(JSON.stringify(store.auditEvents)).not.toContain("ghp_");
    expect(JSON.stringify(store.auditEvents)).not.toContain("token=");
    expect(JSON.stringify(store.auditEvents)).not.toContain("password=");
    expect(JSON.stringify(store.auditEvents)).not.toContain("[REDACTED_SECRET]");
  });

  test.each([
    {
      feedback: "   ",
      label: "empty text",
    },
    {
      feedback: "x".repeat(2_001),
      label: "overlong text",
    },
    {
      feedback: "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-export const a = 1;",
      label: "diff text",
    },
    {
      feedback: "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@",
      label: "patch text",
    },
    {
      feedback: "```ts\nconst value = computeValue()\n```",
      label: "fenced source snippet",
    },
    {
      feedback: "function run() { return process.env.SECRET; }",
      label: "source-like text",
    },
    {
      feedback: "FAIL apps/web/src/foo.test.ts\nExpected true to be false",
      label: "command output",
    },
    {
      feedback:
        "TypeError: Cannot read properties of undefined (reading 'id')\n    at createRepairRequestService (apps/web/src/repairs/requests.ts:42:12)",
      label: "stack trace output",
    },
    {
      feedback:
        "apps/web/src/repairs/requests.ts(42,12): error TS2322: Type 'string' is not assignable to type 'number'.",
      label: "TypeScript diagnostic output",
    },
    {
      feedback:
        "TypeError: Cannot read properties of undefined\n > apps/web/src/repairs/requests.test.ts:18:13",
      label: "Vitest diagnostic output",
    },
    {
      feedback: "ELIFECYCLE Command failed with exit code 1.\nnpm ERR! command sh -c vitest run",
      label: "package manager failure output",
    },
    {
      feedback: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      label: ".env-style secret",
    },
    {
      feedback:
        "Please repair this\n-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
      label: "private key block",
    },
    {
      feedback: "Please repair bearer still-visible-token-value",
      label: "residual bearer token",
    },
  ])("rejects $label repair feedback before mutation", async ({ feedback }) => {
    const { createRepairRequestService } = await importRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRepairRequestService({
      buildRepairTaskPacket: createRepairPacketBuilder(),
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.requestRepair({
        feedback,
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.createRepairRequestWithJob).not.toHaveBeenCalled();
    expect(store.repairRequests).toEqual([]);
    expect(store.repairRuns).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });
});

describe("Drizzle repair request store", () => {
  test("is exported for wiring repair persistence into the web database", async () => {
    const { createDrizzleRepairRequestStore } = await importRequest();

    expect(typeof createDrizzleRepairRequestStore).toBe("function");
  });

  test("selects only path and redacted validation summary context for repair packet building", async () => {
    const source = await readFile(new URL("./repair-requests.ts", import.meta.url), "utf8");

    expect(source).toMatch(/changedPaths:\s*schema\.runs\.changedPaths/);
    expect(source).toContain("schema.validationResults");
    expect(source).toMatch(/commandId:\s*schema\.validationResults\.commandId/);
    expect(source).toMatch(/commandLabel:\s*schema\.validationResults\.commandLabel/);
    expect(source).toMatch(/status:\s*schema\.validationResults\.status/);
    expect(source).toMatch(/exitCode:\s*schema\.validationResults\.exitCode/);
    expect(source).toMatch(/durationMs:\s*schema\.validationResults\.durationMs/);
    expect(source).toMatch(/stdoutSummary:\s*schema\.validationResults\.stdoutSummary/);
    expect(source).toMatch(/stderrSummary:\s*schema\.validationResults\.stderrSummary/);
    expect(source).toMatch(/redactionApplied:\s*schema\.validationResults\.redactionApplied/);
    expect(source).toMatch(/startedAt:\s*schema\.validationResults\.startedAt/);
    expect(source).toMatch(/finishedAt:\s*schema\.validationResults\.finishedAt/);
    expect(source).not.toMatch(/command:\s*schema\.validationResults\.command/);
  });

  test("persists a metadata-only repair_requested timeline event and updates lastEventAt", async () => {
    const source = await readFile(new URL("./repair-requests.ts", import.meta.url), "utf8");

    expect(source).toContain("schema.runEvents");
    expect(source).toContain("createRunEventIdempotencyKey");
    expect(source).toContain('stableStepName: "repair_requested"');
    expect(source).toMatch(/state:\s*"repair_requested"/);
    expect(source).toMatch(/lastEventAt:\s*requestedAt/);
    expect(source).toContain("onConflictDoNothing");
  });

  test("exports repair request services from the repairs module index", async () => {
    const repairs = await import("./index");

    expect(typeof repairs.buildRepairTaskPacket).toBe("function");
    expect(typeof repairs.createDrizzleRepairRequestStore).toBe("function");
    expect(typeof repairs.createRepairRequestService).toBe("function");
  });
});
