import { describe, expect, expectTypeOf, test } from "vitest";

import type { Database } from "@control-plane/db";
import {
  CONTRACT_VERSION,
  RunnerJobSchema,
  TaskPacketSchema,
  type TaskPacket,
} from "@control-plane/shared";

import {
  listQueuedJobsForRepoMapping,
  queueManualJob,
  toRunnerJob,
  type ManualQueueDatabase,
  type ManualQueueListFilter,
  type ManualQueueRunRow,
  type ManualQueueTestDatabase,
} from "./manual-queue.js";

type TestRunRow = ManualQueueRunRow & Record<string, unknown>;
type ListFilter = ManualQueueListFilter;

type ManualQueueTestDb = ManualQueueTestDatabase & {
  insertedRows: TestRunRow[];
  listFilter: ListFilter | undefined;
};

const now = new Date("2026-05-22T13:00:00.000Z");

const validationCommand = {
  id: "test",
  label: "Unit tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
};

const policy = {
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["infra/**"],
  sensitivePaths: [".env", ".env.*"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["packages/db/migrations/**"],
    infrastructure: ["infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [validationCommand],
  maxChangedFiles: 20,
  maxDiffLines: 400,
  allowUntrackedFiles: true,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
  ],
};

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  TaskPacketSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "packet_123",
    workspaceId: "workspace_123",
    repositoryId: "repo_mapping_123",
    runId: "run_123",
    mode: "execute",
    objective: "Update the manual queue metadata only.",
    acceptanceCriteria: ["A queued run can be polled by a runner."],
    source: {
      type: "manual",
      title: "Manual queue task",
    },
    repo: {
      localPath: "/repos/control-plane",
      defaultBranch: "main",
      targetBranch: "aicp/manual-queue",
    },
    context: {
      files: ["packages/db/src/schema.ts"],
      notes: ["Use metadata and path references only."],
    },
    policy,
    validation: {
      commands: [validationCommand],
    },
    createdAt: "2026-05-22T12:59:00.000Z",
    ...overrides,
  });

const createDb = (seedRows: TestRunRow[] = []): ManualQueueTestDb => {
  const db: ManualQueueTestDb = {
    insertedRows: [...seedRows],
    listFilter: undefined,
    insertRun: async (row) => {
      const queuedAt = row.queuedAt instanceof Date ? row.queuedAt : now;
      const storedRow = {
        ...row,
        queuedAt,
      } as TestRunRow;

      db.insertedRows.push(storedRow);

      return storedRow;
    },
    listQueuedRuns: async (filter) => {
      db.listFilter = filter;

      return db.insertedRows
        .filter(
          (row) =>
            row.workspaceId === filter.workspaceId &&
            row.repoMappingId === filter.repoMappingId &&
            row.state === filter.state,
        )
        .slice(0, filter.limit);
    },
  };

  return db;
};

const baseQueueInput = (taskPacket: TaskPacket = validTaskPacket()) => ({
  jobId: "job_123",
  runId: "run_123",
  taskId: "task_123",
  workspaceId: "workspace_123",
  repoMappingId: "repo_mapping_123",
  taskPacket,
  maxAttempts: 2,
  queuedAt: now,
});

const collectUnsafeKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUnsafeKeys(item, keys));

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      [
        "content",
        "contents",
        "diff",
        "filecontent",
        "filecontents",
        "log",
        "logs",
        "output",
        "patch",
        "rawdiff",
        "rawlog",
        "rawoutput",
        "rawpatch",
        "rawsource",
        "rawstderr",
        "rawstdout",
        "sourcecode",
        "sourcecontent",
        "stderr",
        "stdout",
        "snippet",
        "snippets",
      ].includes(normalizedKey)
    ) {
      keys.push(key);
    }

    collectUnsafeKeys(childValue, keys);
  }

  return keys;
};

describe("manual job queue", () => {
  test("is compatible with the real database client type", () => {
    expectTypeOf<Database>().toMatchTypeOf<ManualQueueDatabase>();
  });

  test("queues a valid manual task packet as a runner task row", async () => {
    const db = createDb();
    const taskPacket = validTaskPacket();

    const row = await queueManualJob(db, baseQueueInput(taskPacket));

    expect(row).toMatchObject({
      id: "run_123",
      workspaceId: "workspace_123",
      taskId: "task_123",
      repoMappingId: "repo_mapping_123",
      contractVersion: CONTRACT_VERSION,
      jobId: "job_123",
      jobType: "task",
      state: "queued",
      mode: "execute",
      taskPacket,
      attemptCount: 0,
      maxAttempts: 2,
      claimExpiresAt: null,
      cancellationRequestedByActorId: null,
      cancellationReason: null,
      queuedAt: now,
    });
  });

  test("lists queued jobs scoped by workspace and repo mapping", async () => {
    const taskPacket = validTaskPacket();
    const db = createDb([
      {
        ...baseQueueInput(taskPacket),
        id: "run_123",
        contractVersion: CONTRACT_VERSION,
        jobType: "task",
        state: "queued",
        mode: "execute",
        queuedAt: now,
      },
      {
        ...baseQueueInput(validTaskPacket({ runId: "run_other" })),
        id: "run_other",
        runId: "run_other",
        workspaceId: "workspace_other",
        contractVersion: CONTRACT_VERSION,
        jobType: "task",
        state: "queued",
        mode: "execute",
        queuedAt: now,
      },
      {
        ...baseQueueInput(validTaskPacket({ runId: "run_claimed" })),
        id: "run_claimed",
        runId: "run_claimed",
        contractVersion: CONTRACT_VERSION,
        jobType: "task",
        state: "claimed",
        mode: "execute",
        queuedAt: now,
      },
    ]);

    const jobs = await listQueuedJobsForRepoMapping(db, {
      workspaceId: "workspace_123",
      repoMappingId: "repo_mapping_123",
      limit: 5,
    });

    expect(db.listFilter).toEqual({
      workspaceId: "workspace_123",
      repoMappingId: "repo_mapping_123",
      state: "queued",
      limit: 5,
    });
    expect(jobs.map((job) => job.runId)).toEqual(["run_123"]);
  });

  test("does not require taskPacket.repositoryId to equal the database repo mapping id", async () => {
    const db = createDb();
    const taskPacket = validTaskPacket({ repositoryId: "rory/control-plane" });

    const row = await queueManualJob(db, baseQueueInput(taskPacket));

    expect(row.repoMappingId).toBe("repo_mapping_123");
    expect(row.taskPacket?.repositoryId).toBe("rory/control-plane");
  });

  test("maps queued run rows to shared-schema-valid runner jobs", async () => {
    const row = await queueManualJob(createDb(), baseQueueInput());
    const job = toRunnerJob(row);

    expect(RunnerJobSchema.safeParse(job).success).toBe(true);
    expect(job).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobId: "job_123",
      runId: "run_123",
      type: "task",
      taskPacket: validTaskPacket(),
      queuedAt: now.toISOString(),
    });
  });

  test("rejects packet and run id mismatch", async () => {
    await expect(
      queueManualJob(createDb(), {
        ...baseQueueInput(validTaskPacket({ runId: "run_123" })),
        runId: "run_other",
      }),
    ).rejects.toThrow(/run id/i);
  });

  test("rejects workspace mismatch", async () => {
    await expect(
      queueManualJob(createDb(), {
        ...baseQueueInput(validTaskPacket({ workspaceId: "workspace_other" })),
        workspaceId: "workspace_123",
      }),
    ).rejects.toThrow(/workspace/i);
  });

  test("rejects repair-mode packets for the manual queue", async () => {
    const repairPacket = validTaskPacket({
      mode: "repair",
      source: {
        type: "repair",
        title: "Repair task",
      },
      repair: {
        attempt: 1,
        maxAttempts: 2,
        feedback: "Repair requested by reviewer.",
        previousRunId: "run_previous",
      },
    });

    await expect(queueManualJob(createDb(), baseQueueInput(repairPacket))).rejects.toThrow(
      /repair/i,
    );
  });

  test("rejects Linear-source packets for this manual queue", async () => {
    const linearPacket = validTaskPacket({
      source: {
        type: "linear",
        externalId: "LIN-123",
        title: "Linear task",
        url: "https://linear.example/LIN-123",
      },
    });

    await expect(queueManualJob(createDb(), baseQueueInput(linearPacket))).rejects.toThrow(
      /manual/i,
    );
  });

  test.each([
    [
      "raw git diff text",
      {
        objective: "Review local metadata only.\ndiff --git a/app.ts b/app.ts",
      },
    ],
    [
      "patch hunk text",
      {
        acceptanceCriteria: [
          "Queue metadata only.",
          "@@ -1,3 +1,4 @@\n+const leakedSource = true;",
        ],
      },
    ],
    [
      "private key text",
      {
        context: {
          files: ["packages/db/src/schema.ts"],
          notes: ["-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----"],
        },
      },
    ],
    [
      "token text",
      {
        objective: "Queue metadata only with token ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      },
    ],
    [
      "source snippet text",
      {
        source: {
          type: "manual",
          title: "function leakSource() { return process.env.SECRET; }",
        },
      },
    ],
    [
      "standalone source statement text",
      {
        context: {
          files: ["packages/db/src/schema.ts"],
          notes: ["const leakedSource = true;"],
        },
      },
    ],
  ])("rejects schema-valid packets containing %s", async (_caseName, overrides) => {
    const taskPacket = validTaskPacket(overrides as Partial<TaskPacket>);

    await expect(queueManualJob(createDb(), baseQueueInput(taskPacket))).rejects.toThrow(
      /unsafe text/i,
    );
  });

  test("rejects raw output and file-content payload fields before queue insert", async () => {
    const taskPacket = validTaskPacket();
    const taskPacketWithUnsafePayload = {
      ...taskPacket,
      context: {
        ...taskPacket.context,
        fileContent: "do not store file bodies in the web queue",
      },
      rawStdout: "do not store unredacted command output",
    };

    await expect(
      queueManualJob(createDb(), {
        ...baseQueueInput(),
        taskPacket: taskPacketWithUnsafePayload,
      }),
    ).rejects.toThrow(/raw payload field/i);
  });

  test("does not serialize raw diff, patch, log, source-like, snippet, or content fields", async () => {
    const row = await queueManualJob(createDb(), baseQueueInput());
    const job = toRunnerJob(row);

    expect(collectUnsafeKeys(job)).toEqual([]);
    expect(JSON.stringify(job)).not.toMatch(/rawDiff|rawPatch|rawLog|snippet|sourceCode/);
  });

  test("rejects unsafe stored packet values when mapping runner jobs", () => {
    const taskPacket = validTaskPacket({
      objective: "diff --git a/app.ts b/app.ts",
    });

    expect(() =>
      toRunnerJob({
        ...baseQueueInput(taskPacket),
        id: "run_123",
        contractVersion: CONTRACT_VERSION,
        jobType: "task",
        state: "queued",
        mode: "execute",
        taskPacket,
        queuedAt: now,
      }),
    ).toThrow(/unsafe text/i);
  });
});
