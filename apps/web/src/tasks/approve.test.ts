import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, TaskPacketSchema, type RepoPolicy } from "@control-plane/shared";

import { schema } from "../db";
import { queueManualJob, type ManualQueueRunRow } from "../jobs/manual-queue";
import type { AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import type {
  ApproveManualTaskStore,
  ApproveManualTaskWithQueueInput,
  ManualTaskApprovalRepoMapping,
  ManualTaskApprovalTask,
} from "./approve";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importApproval = async () => import("./approve");

const now = new Date("2026-05-23T11:00:00.000Z");

const requiredValidationCommand = {
  command: "pnpm test",
  id: "test",
  label: "Tests",
  required: true,
  timeoutSeconds: 300,
};

const optionalValidationCommand = {
  command: "pnpm run lint",
  id: "lint",
  label: "Lint",
  required: false,
  timeoutSeconds: 120,
};

const policySnapshot = {
  allowUntrackedFiles: false,
  contractVersion: CONTRACT_VERSION,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
  ],
  maxChangedFiles: 20,
  protectedBranches: ["main"],
  protectedPaths: [],
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

const baseTask = (overrides: Partial<ManualTaskApprovalTask> = {}): ManualTaskApprovalTask => ({
  acceptanceCriteria: ["Approved task creates one queued run.", "Audit metadata stays safe."],
  contextFilePaths: ["apps/web/src/tasks/approve.ts"],
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-05-23T10:00:00.000Z"),
  externalId: "manual-ticket-129",
  externalUrl: "https://tracker.example/tasks/manual-ticket-129",
  id: "task_129",
  mode: "execute",
  objective: "Create the manual approval path.",
  approvedAt: null,
  policySnapshot: null,
  repoMappingId: "repo_mapping_1",
  requestedByActorId: "user_1",
  sourceType: "manual",
  status: "draft",
  title: "Approve manual task",
  updatedAt: new Date("2026-05-23T10:00:00.000Z"),
  validationCommands: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const baseRepoMapping = (
  overrides: Partial<ManualTaskApprovalRepoMapping> = {},
): ManualTaskApprovalRepoMapping => ({
  archivedAt: null,
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/Users/rory/src/control-plane",
  policySnapshot,
  validationCommands: [requiredValidationCommand, optionalValidationCommand],
  workspaceId: "workspace_1",
  ...overrides,
});

type TestStore = ApproveManualTaskStore & {
  approveCalls: number;
  auditEvents: AuditEventInsert[];
  lastQueueInput: ApproveManualTaskWithQueueInput | undefined;
  mappings: ManualTaskApprovalRepoMapping[];
  rows: ManualTaskApprovalTask[];
  runs: ManualQueueRunRow[];
};

const createStore = (
  input: {
    mappings?: ManualTaskApprovalRepoMapping[];
    membership?: boolean;
    rows?: ManualTaskApprovalTask[];
  } = {},
): TestStore => {
  const store: TestStore = {
    approveCalls: 0,
    auditEvents: [],
    lastQueueInput: undefined,
    mappings: [...(input.mappings ?? [baseRepoMapping()])],
    rows: [...(input.rows ?? [baseTask()])],
    runs: [],
    approveManualTaskWithQueue: async (approvalInput) => {
      store.approveCalls += 1;
      store.lastQueueInput = approvalInput;

      const taskIndex = store.rows.findIndex(
        (row) =>
          row.id === approvalInput.taskId &&
          row.workspaceId === approvalInput.workspaceId &&
          row.sourceType === "manual" &&
          row.status === "draft",
      );

      if (taskIndex === -1) {
        throw createActionError("validation_error");
      }

      const row = store.rows[taskIndex]!;
      const approvedRow = {
        ...row,
        approvedAt: approvalInput.approvedAt,
        policySnapshot: approvalInput.taskPacket.policy,
        status: "approved",
        updatedAt: approvalInput.approvedAt,
        validationCommands: approvalInput.taskPacket.validation.commands,
      };
      store.rows[taskIndex] = approvedRow;

      const insertedRun = await queueManualJob(
        {
          insertRun: async (runInsert) => {
            const run = {
              ...runInsert,
              queuedAt:
                runInsert.queuedAt instanceof Date ? runInsert.queuedAt : approvalInput.approvedAt,
            } as ManualQueueRunRow;

            store.runs.push(run);

            return run;
          },
          listQueuedRuns: async () => [],
        },
        {
          jobId: approvalInput.jobId,
          queuedAt: approvalInput.approvedAt,
          repoMappingId: approvalInput.repoMappingId,
          runId: approvalInput.runId,
          taskId: approvalInput.taskId,
          taskPacket: approvalInput.taskPacket,
          workspaceId: approvalInput.workspaceId,
        },
      );

      store.auditEvents.push(approvalInput.auditEvent);

      return {
        run: insertedRun,
        task: approvedRow,
      };
    },
    findManualDraftTaskForApproval: async ({ taskId, workspaceId }) => {
      const task =
        store.rows.find(
          (row) =>
            row.id === taskId &&
            row.workspaceId === workspaceId &&
            row.sourceType === "manual" &&
            row.status === "draft",
        ) ?? null;

      if (task === null) {
        return null;
      }

      const repoMapping =
        store.mappings.find(
          (mapping) =>
            mapping.id === task.repoMappingId &&
            mapping.workspaceId === workspaceId &&
            mapping.archivedAt === null,
        ) ?? null;

      return repoMapping === null ? null : { repoMapping, task };
    },
    findWorkspaceMembership: async ({ userId, workspaceId }) =>
      input.membership === false || userId !== "user_1" || workspaceId !== "workspace_1"
        ? null
        : { id: "membership_1", role: "member" },
  };

  return store;
};

const createService = async (store: TestStore, userId: string | null = "user_1") => {
  const { createApproveManualTaskService } = await importApproval();

  return createApproveManualTaskService({
    createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
    createJobId: () => `job_${store.runs.length + 1}`,
    createPacketId: () => `packet_${store.runs.length + 1}`,
    createRunId: () => `run_${store.runs.length + 1}`,
    getAuthContext: async () => ({ userId }),
    now: () => now,
    store,
  });
};

const expectValidationError = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toMatchObject({ code: "validation_error" });
};

describe("manual task approval service", () => {
  test("approves a manual draft, builds a valid TaskPacket, queues one run, and records safe audit metadata", async () => {
    const store = createStore();
    const service = await createService(store);

    const result = await service.approveManualTask({
      taskId: " task_129 ",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual({
      approvedAt: now,
      jobId: "job_1",
      repoMappingId: "repo_mapping_1",
      runId: "run_1",
      runState: "queued",
      status: "approved",
      taskId: "task_129",
      workspaceId: "workspace_1",
    });
    expect(store.rows[0]).toMatchObject({
      approvedAt: now,
      status: "approved",
    });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      id: "run_1",
      jobId: "job_1",
      repoMappingId: "repo_mapping_1",
      state: "queued",
      taskId: "task_129",
      workspaceId: "workspace_1",
    });

    const packet = store.lastQueueInput?.taskPacket;
    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      id: "packet_1",
      mode: "execute",
      repositoryId: "repo_mapping_1",
      runId: "run_1",
      source: {
        title: "Approve manual task",
        type: "manual",
      },
      workspaceId: "workspace_1",
    });

    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      actorId: "user_1",
      eventType: "task.manual.approved",
      id: "audit_1",
      message: "Manual task approved for runner queue.",
      metadata: {
        acceptanceCriteriaCount: 2,
        contextFilePathCount: 1,
        jobId: "job_1",
        mode: "execute",
        originType: "manual",
        packetId: "packet_1",
        repoMappingId: "repo_mapping_1",
        requiredValidationCommandCount: 1,
        runId: "run_1",
        runState: "queued",
        status: "approved",
        taskId: "task_129",
        validationCommandCount: 2,
      },
      runId: "run_1",
      taskId: "task_129",
      workspaceId: "workspace_1",
    });

    const auditPayload = JSON.stringify(store.auditEvents);
    expect(auditPayload).not.toContain("Approve manual task");
    expect(auditPayload).not.toContain("Create the manual approval path");
    expect(auditPayload).not.toContain("Approved task creates one queued run");
    expect(auditPayload).not.toContain("apps/web/src/tasks/approve.ts");
    expect(auditPayload).not.toContain("/Users/rory/src/control-plane");
    expect(auditPayload).not.toContain("pnpm test");
    expect(auditPayload).not.toMatch(/diff|patch|raw|log|source|snippet|secret/i);
  });

  test.each([
    ["unauthenticated user", null, true, { code: "unauthenticated" }],
    ["non-member user", "user_1", false, { code: "forbidden" }],
  ])(
    "rejects approval for %s without mutating tasks or queue",
    async (_caseName, userId, membership, error) => {
      const store = createStore({ membership });
      const service = await createService(store, userId);

      await expect(
        service.approveManualTask({
          taskId: "task_129",
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject(error);
      expect(store.approveCalls).toBe(0);
      expect(store.rows[0]).toMatchObject({
        approvedAt: null,
        status: "draft",
      });
      expect(store.runs).toEqual([]);
      expect(store.auditEvents).toEqual([]);
    },
  );

  test.each([
    ["missing task", []],
    ["non-manual task", [baseTask({ sourceType: "linear" })]],
    ["non-draft task", [baseTask({ status: "cancelled" })]],
    ["already-approved task", [baseTask({ approvedAt: now, status: "approved" })]],
  ])("rejects a %s without queueing a run", async (_caseName, rows) => {
    const store = createStore({ rows });
    const service = await createService(store);

    await expectValidationError(
      service.approveManualTask({
        taskId: "task_129",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.approveCalls).toBe(0);
    expect(store.runs).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects an archived repo mapping without queueing a run", async () => {
    const store = createStore({
      mappings: [baseRepoMapping({ archivedAt: now })],
    });
    const service = await createService(store);

    await expectValidationError(
      service.approveManualTask({
        taskId: "task_129",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.approveCalls).toBe(0);
    expect(store.runs).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test.each([
    ["missing local path", baseRepoMapping({ localPath: null })],
    ["missing default branch", baseRepoMapping({ defaultBranch: "" })],
    ["missing validation commands", baseRepoMapping({ validationCommands: null })],
    ["empty validation commands", baseRepoMapping({ validationCommands: [] })],
    [
      "optional-only validation commands",
      baseRepoMapping({ validationCommands: [optionalValidationCommand] }),
    ],
  ])(
    "fails closed for repo mapping with %s before updating the task",
    async (_caseName, mapping) => {
      const store = createStore({ mappings: [mapping] });
      const service = await createService(store);

      await expectValidationError(
        service.approveManualTask({
          taskId: "task_129",
          workspaceId: "workspace_1",
        }),
      );
      expect(store.approveCalls).toBe(0);
      expect(store.rows[0]).toMatchObject({
        approvedAt: null,
        status: "draft",
      });
      expect(store.runs).toEqual([]);
      expect(store.auditEvents).toEqual([]);
    },
  );

  test("does not create a duplicate queued run on repeated approval", async () => {
    const store = createStore();
    const service = await createService(store);

    await service.approveManualTask({
      taskId: "task_129",
      workspaceId: "workspace_1",
    });
    await expectValidationError(
      service.approveManualTask({
        taskId: "task_129",
        workspaceId: "workspace_1",
      }),
    );

    expect(store.runs).toHaveLength(1);
    expect(store.auditEvents).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      approvedAt: now,
      status: "approved",
    });
  });

  test("keeps task text, local paths, validation commands, and source-like fields out of audit metadata", async () => {
    const store = createStore({
      mappings: [
        baseRepoMapping({
          localPath: "/private/repos/sensitive-control-plane",
          validationCommands: [
            {
              ...requiredValidationCommand,
              command: "pnpm run sensitive-validation-command",
            },
          ],
        }),
      ],
      rows: [
        baseTask({
          acceptanceCriteria: ["Sensitive criterion text."],
          contextFilePaths: ["apps/private/context-reference.ts"],
          objective: "Sensitive objective text.",
          title: "Sensitive task title",
        }),
      ],
    });
    const service = await createService(store);

    await service.approveManualTask({
      taskId: "task_129",
      workspaceId: "workspace_1",
    });

    const auditPayload = JSON.stringify(store.auditEvents);
    expect(auditPayload).not.toContain("Sensitive task title");
    expect(auditPayload).not.toContain("Sensitive objective text");
    expect(auditPayload).not.toContain("Sensitive criterion text");
    expect(auditPayload).not.toContain("apps/private/context-reference.ts");
    expect(auditPayload).not.toContain("/private/repos/sensitive-control-plane");
    expect(auditPayload).not.toContain("sensitive-validation-command");
    expect(auditPayload).not.toMatch(/diff|patch|raw|log|source|snippet|secret/i);
  });

  test("Drizzle-backed approval store wraps task update, run insert, and audit insert in one transaction", async () => {
    const { createDrizzleApproveManualTaskStore } = await importApproval();
    const operations: string[] = [];
    const taskPacket = TaskPacketSchema.parse({
      acceptanceCriteria: ["Approval queues exactly one run."],
      context: {
        files: [],
        notes: ["Context files are path references only."],
      },
      contractVersion: CONTRACT_VERSION,
      createdAt: now.toISOString(),
      id: "packet_1",
      mode: "execute",
      objective: "Approve safely.",
      policy: {
        ...policySnapshot,
        validationCommands: [requiredValidationCommand],
      },
      repo: {
        defaultBranch: "main",
        localPath: "/Users/rory/src/control-plane",
        targetBranch: "aicp/manual-task-task-129-run-1",
      },
      repositoryId: "repo_mapping_1",
      runId: "run_1",
      source: {
        title: "Approve safely",
        type: "manual",
      },
      validation: {
        commands: [requiredValidationCommand],
      },
      workspaceId: "workspace_1",
    });
    const approvedTask = baseTask({
      approvedAt: now,
      policySnapshot: taskPacket.policy,
      status: "approved",
      validationCommands: taskPacket.validation.commands,
    });
    const tx = {
      insert: (table: unknown) => ({
        values: (row: unknown) => {
          if (table === schema.runs) {
            operations.push("run:insert");

            return {
              returning: async () => [
                {
                  ...(row as Record<string, unknown>),
                  queuedAt: now,
                },
              ],
            };
          }

          operations.push("audit:insert");

          return {
            returning: async () => [],
          };
        },
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              operations.push("task:update");

              return [approvedTask];
            },
          }),
        }),
      }),
    };
    const fakeDb = {
      transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => {
        operations.push("transaction:start");
        const result = await operation(tx);
        operations.push("transaction:end");

        return result;
      },
    };
    const store = createDrizzleApproveManualTaskStore(fakeDb as never);

    await expect(
      store.approveManualTaskWithQueue({
        approvedAt: now,
        auditEvent: {
          actorId: "user_1",
          createdAt: now,
          eventType: "task.manual.approved",
          id: "audit_1",
          message: "Manual task approved for runner queue.",
          metadata: { taskId: "task_129" },
          runId: "run_1",
          taskId: "task_129",
          workspaceId: "workspace_1",
        },
        jobId: "job_1",
        repoMappingId: "repo_mapping_1",
        runId: "run_1",
        taskId: "task_129",
        taskPacket,
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      run: {
        id: "run_1",
        state: "queued",
      },
      task: {
        approvedAt: now,
        status: "approved",
      },
    });
    expect(operations).toEqual([
      "transaction:start",
      "task:update",
      "run:insert",
      "audit:insert",
      "transaction:end",
    ]);
  });
});
