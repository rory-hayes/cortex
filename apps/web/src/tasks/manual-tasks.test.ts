import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION } from "@control-plane/shared";

import type { AuditEventInsert } from "../server/audit";
import type {
  CreateManualTaskInput,
  ManualTaskData,
  ManualTaskCreateInsert,
  ManualTaskRow,
  ManualTaskStore,
  ManualTaskListFilter,
  RepoMappingForManualTask,
} from "./manual-tasks";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importTasks = async () => import("./manual-tasks");

type TestStore = ManualTaskStore & {
  auditEvents: AuditEventInsert[];
  listFilter: ManualTaskListFilter | undefined;
  mappings: RepoMappingForManualTask[];
  rows: ManualTaskRow[];
};

const now = new Date("2026-05-23T10:00:00.000Z");

const baseMapping = (
  overrides: Partial<RepoMappingForManualTask> = {},
): RepoMappingForManualTask => ({
  archivedAt: null,
  id: "repo_mapping_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const baseCreateInput = {
  workspaceId: "workspace_1",
  repoMappingId: "repo_mapping_1",
  title: "Repo intake request",
  objective: "Update metadata for manual task creation.",
  acceptanceCriteria: ["Draft task is stored.", "No runner job is queued."],
  source: {
    externalId: "manual-ticket-1",
    url: "https://tracker.example/tasks/manual-ticket-1",
  },
  contextFilePaths: ["apps/web/src/tasks/manual-tasks.ts", "apps/web/app/api/tasks/route.ts"],
};

const createTaskRow = (
  insert: ManualTaskCreateInsert,
  overrides: Partial<ManualTaskRow> = {},
): ManualTaskRow => ({
  acceptanceCriteria: insert.acceptanceCriteria,
  approvedAt: null,
  contextFilePaths: insert.contextFilePaths,
  contractVersion: insert.contractVersion,
  createdAt: now,
  externalId: insert.externalId,
  externalUrl: insert.externalUrl,
  id: insert.id,
  mode: insert.mode,
  objective: insert.objective,
  policySnapshot: insert.policySnapshot,
  repoMappingId: insert.repoMappingId,
  requestedByActorId: insert.requestedByActorId,
  sourceType: insert.sourceType,
  status: insert.status,
  title: insert.title,
  updatedAt: now,
  validationCommands: insert.validationCommands,
  workspaceId: insert.workspaceId,
  ...overrides,
});

const createStoredTaskRow = (overrides: Partial<ManualTaskRow> = {}): ManualTaskRow =>
  createTaskRow(
    {
      acceptanceCriteria: baseCreateInput.acceptanceCriteria,
      auditEvent: {} as AuditEventInsert,
      contextFilePaths: [],
      contractVersion: CONTRACT_VERSION,
      externalId: null,
      externalUrl: null,
      id: "task_1",
      mode: "execute",
      objective: baseCreateInput.objective,
      policySnapshot: null,
      repoMappingId: baseCreateInput.repoMappingId,
      requestedByActorId: "user_1",
      sourceType: "manual",
      status: "draft",
      title: baseCreateInput.title,
      validationCommands: null,
      workspaceId: baseCreateInput.workspaceId,
    },
    overrides,
  );

const toExpectedManualTaskData = (row: ManualTaskRow): ManualTaskData => ({
  acceptanceCriteria: row.acceptanceCriteria,
  approvedAt: row.approvedAt,
  contextFilePaths: row.contextFilePaths,
  contractVersion: row.contractVersion,
  createdAt: row.createdAt,
  externalId: row.externalId,
  externalUrl: row.externalUrl,
  id: row.id,
  mode: row.mode,
  objective: row.objective,
  repoMappingId: row.repoMappingId,
  requestedByActorId: row.requestedByActorId,
  sourceType: row.sourceType,
  status: row.status,
  title: row.title,
  updatedAt: row.updatedAt,
  workspaceId: row.workspaceId,
});

const createStore = (
  input: {
    mappings?: RepoMappingForManualTask[];
    membership?: boolean;
    rows?: ManualTaskRow[];
  } = {},
): TestStore => {
  const store: TestStore = {
    auditEvents: [],
    listFilter: undefined,
    mappings: [...(input.mappings ?? [baseMapping()])],
    rows: [...(input.rows ?? [])],
    createManualTaskWithAudit: async (insert) => {
      store.auditEvents.push(insert.auditEvent);

      const row = createTaskRow(insert);
      store.rows.push(row);

      return row;
    },
    findActiveRepoMapping: async ({ repoMappingId, workspaceId }) =>
      store.mappings.find(
        (mapping) =>
          mapping.id === repoMappingId &&
          mapping.workspaceId === workspaceId &&
          mapping.archivedAt === null,
      ) ?? null,
    findWorkspaceMembership: async ({ userId, workspaceId }) =>
      input.membership === false || userId !== "user_1" || workspaceId !== "workspace_1"
        ? null
        : { id: "membership_1", role: "member" },
    listManualTasks: async (filter) => {
      store.listFilter = filter;
      const activeMappingIds = new Set(
        store.mappings
          .filter(
            (mapping) => mapping.workspaceId === filter.workspaceId && mapping.archivedAt === null,
          )
          .map((mapping) => mapping.id),
      );

      return store.rows
        .filter(
          (row) =>
            row.workspaceId === filter.workspaceId &&
            row.sourceType === filter.sourceType &&
            (filter.statuses as readonly string[]).includes(row.status) &&
            activeMappingIds.has(row.repoMappingId) &&
            (filter.repoMappingId === undefined || row.repoMappingId === filter.repoMappingId),
        )
        .slice(0, filter.limit);
    },
  };

  return store;
};

const createService = async (store: TestStore, userId: string | null = "user_1") => {
  const { createManualTaskService } = await importTasks();

  return createManualTaskService({
    createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
    createTaskId: () => `task_${store.rows.length + 1}`,
    getAuthContext: async () => ({ userId }),
    now: () => now,
    store,
  });
};

describe("manual task service", () => {
  test("creates a manual draft task for an active repo mapping with safe audit metadata", async () => {
    const store = createStore();
    const service = await createService(store);

    const task = await service.createManualTask(baseCreateInput);

    expect(task).toEqual({
      acceptanceCriteria: ["Draft task is stored.", "No runner job is queued."],
      approvedAt: null,
      contextFilePaths: ["apps/web/src/tasks/manual-tasks.ts", "apps/web/app/api/tasks/route.ts"],
      contractVersion: CONTRACT_VERSION,
      createdAt: now,
      externalId: "manual-ticket-1",
      externalUrl: "https://tracker.example/tasks/manual-ticket-1",
      id: "task_1",
      mode: "execute",
      objective: "Update metadata for manual task creation.",
      repoMappingId: "repo_mapping_1",
      requestedByActorId: "user_1",
      sourceType: "manual",
      status: "draft",
      title: "Repo intake request",
      updatedAt: now,
      workspaceId: "workspace_1",
    });
    expect("policySnapshot" in task).toBe(false);
    expect("validationCommands" in task).toBe(false);
    expect(store.rows[0]).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      mode: "execute",
      policySnapshot: null,
      requestedByActorId: "user_1",
      sourceType: "manual",
      status: "draft",
      validationCommands: null,
    });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      actorId: "user_1",
      eventType: "task.manual.created",
      id: "audit_1",
      metadata: {
        acceptanceCriteriaCount: 2,
        acceptanceCriteriaTotalLength: 45,
        contextFilePathCount: 2,
        externalIdLength: 15,
        externalUrlLength: 45,
        mode: "execute",
        objectiveLength: 41,
        originType: "manual",
        repoMappingId: "repo_mapping_1",
        status: "draft",
        taskId: "task_1",
        titleLength: 19,
      },
      taskId: "task_1",
      workspaceId: "workspace_1",
    });

    const auditPayload = JSON.stringify(store.auditEvents);
    expect(auditPayload).not.toContain("Repo intake request");
    expect(auditPayload).not.toContain("Update metadata");
    expect(auditPayload).not.toContain("Draft task is stored");
    expect(auditPayload).not.toContain("apps/web/src/tasks/manual-tasks.ts");
    expect(auditPayload).not.toContain("tracker.example");
    expect(auditPayload).not.toContain("manual-ticket-1");
  });

  test("supports dry-run manual task creation without queueing a runner job", async () => {
    const store = createStore();
    const service = await createService(store);
    const inputWithoutOptionalFields = {
      acceptanceCriteria: baseCreateInput.acceptanceCriteria,
      objective: baseCreateInput.objective,
      repoMappingId: baseCreateInput.repoMappingId,
      title: baseCreateInput.title,
      workspaceId: baseCreateInput.workspaceId,
    };

    const task = await service.createManualTask({
      ...inputWithoutOptionalFields,
      mode: "dryRun",
    });

    expect(task).toMatchObject({
      contextFilePaths: [],
      externalId: null,
      externalUrl: null,
      mode: "dryRun",
      sourceType: "manual",
      status: "draft",
    });
    expect(store.rows).toHaveLength(1);
  });

  test("allows safe .env.example context path references", async () => {
    const store = createStore();
    const service = await createService(store);

    await expect(
      service.createManualTask({
        ...baseCreateInput,
        contextFilePaths: [".env.example", "apps/web/.env.example"],
      }),
    ).resolves.toMatchObject({
      contextFilePaths: [".env.example", "apps/web/.env.example"],
      sourceType: "manual",
      status: "draft",
    });
  });

  test("rejects create and list for unauthenticated users", async () => {
    const store = createStore();
    const service = await createService(store, null);

    await expect(service.createManualTask(baseCreateInput)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(service.listManualTasks({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects create and list for non-members", async () => {
    const store = createStore({ membership: false });
    const service = await createService(store);

    await expect(service.createManualTask(baseCreateInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service.listManualTasks({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test.each([
    ["archived mapping", baseMapping({ archivedAt: now })],
    [
      "mapping in another workspace",
      baseMapping({ id: "repo_mapping_other", workspaceId: "workspace_other" }),
    ],
  ])(
    "rejects task creation for %s without revealing mapping details",
    async (_caseName, mapping) => {
      const store = createStore({ mappings: [mapping] });
      const service = await createService(store);

      await expect(service.createManualTask(baseCreateInput)).rejects.toMatchObject({
        code: "validation_error",
      });
      expect(store.rows).toEqual([]);
      expect(store.auditEvents).toEqual([]);
    },
  );

  test.each([
    ["archived mapping", baseMapping({ archivedAt: now })],
    [
      "mapping in another workspace",
      baseMapping({ id: "repo_mapping_other", workspaceId: "workspace_other" }),
    ],
  ])(
    "rejects list filters for %s without revealing mapping details",
    async (_caseName, mapping) => {
      const store = createStore({ mappings: [mapping] });
      const service = await createService(store);

      await expect(
        service.listManualTasks({
          workspaceId: "workspace_1",
          repoMappingId: "repo_mapping_1",
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
      });
      expect(store.listFilter).toBeUndefined();
    },
  );

  test("lists workspace visible manual tasks with default limit when repo mapping is omitted", async () => {
    const rows = [
      createStoredTaskRow({ id: "task_1", repoMappingId: "repo_mapping_1" }),
      createStoredTaskRow({
        approvedAt: now,
        id: "task_approved",
        repoMappingId: "repo_mapping_1",
        status: "approved",
      }),
      createStoredTaskRow({ id: "task_other_repo", repoMappingId: "repo_mapping_other" }),
      createStoredTaskRow({ id: "task_linear", sourceType: "linear" }),
      createStoredTaskRow({
        id: "task_archived_mapping",
        repoMappingId: "repo_mapping_archived",
      }),
      createStoredTaskRow({ id: "task_other_workspace", workspaceId: "workspace_other" }),
    ];
    const store = createStore({
      mappings: [
        baseMapping(),
        baseMapping({ id: "repo_mapping_other" }),
        baseMapping({ archivedAt: now, id: "repo_mapping_archived" }),
      ],
      rows,
    });
    const service = await createService(store);

    await expect(
      service.listManualTasks({
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      toExpectedManualTaskData(rows[0]!),
      toExpectedManualTaskData(rows[1]!),
      toExpectedManualTaskData(rows[2]!),
    ]);
    expect(store.listFilter).toEqual({
      limit: 25,
      sourceType: "manual",
      statuses: ["draft", "approved"],
      workspaceId: "workspace_1",
    });
  });

  test("lists visible manual tasks scoped to the member workspace and optional repo mapping", async () => {
    const rows = [
      createTaskRow({
        ...baseCreateInput,
        auditEvent: {} as AuditEventInsert,
        contextFilePaths: [],
        contractVersion: CONTRACT_VERSION,
        externalId: null,
        externalUrl: null,
        id: "task_1",
        mode: "execute",
        policySnapshot: null,
        requestedByActorId: "user_1",
        sourceType: "manual",
        status: "draft",
        validationCommands: null,
      }),
      createTaskRow(
        {
          ...baseCreateInput,
          auditEvent: {} as AuditEventInsert,
          contextFilePaths: [],
          contractVersion: CONTRACT_VERSION,
          externalId: null,
          externalUrl: null,
          id: "task_approved",
          mode: "execute",
          policySnapshot: null,
          requestedByActorId: "user_1",
          sourceType: "manual",
          status: "draft",
          validationCommands: null,
        },
        { approvedAt: now, status: "approved" },
      ),
      createTaskRow(
        {
          ...baseCreateInput,
          auditEvent: {} as AuditEventInsert,
          contextFilePaths: [],
          contractVersion: CONTRACT_VERSION,
          externalId: null,
          externalUrl: null,
          id: "task_other_repo",
          mode: "execute",
          policySnapshot: null,
          repoMappingId: "repo_mapping_other",
          requestedByActorId: "user_1",
          sourceType: "manual",
          status: "draft",
          validationCommands: null,
        },
        { repoMappingId: "repo_mapping_other" },
      ),
      createTaskRow(
        {
          ...baseCreateInput,
          auditEvent: {} as AuditEventInsert,
          contextFilePaths: [],
          contractVersion: CONTRACT_VERSION,
          externalId: null,
          externalUrl: null,
          id: "task_linear",
          mode: "execute",
          policySnapshot: null,
          requestedByActorId: "user_1",
          sourceType: "manual",
          status: "draft",
          validationCommands: null,
        },
        { sourceType: "linear" },
      ),
      createTaskRow(
        {
          ...baseCreateInput,
          auditEvent: {} as AuditEventInsert,
          contextFilePaths: [],
          contractVersion: CONTRACT_VERSION,
          externalId: null,
          externalUrl: null,
          id: "task_approved",
          mode: "execute",
          policySnapshot: null,
          requestedByActorId: "user_1",
          sourceType: "manual",
          status: "draft",
          validationCommands: null,
        },
        { status: "cancelled" },
      ),
      createTaskRow(
        {
          ...baseCreateInput,
          auditEvent: {} as AuditEventInsert,
          contextFilePaths: [],
          contractVersion: CONTRACT_VERSION,
          externalId: null,
          externalUrl: null,
          id: "task_other_workspace",
          mode: "execute",
          policySnapshot: null,
          requestedByActorId: "user_1",
          sourceType: "manual",
          status: "draft",
          validationCommands: null,
        },
        { workspaceId: "workspace_other" },
      ),
    ];
    const store = createStore({
      mappings: [baseMapping(), baseMapping({ id: "repo_mapping_other" })],
      rows,
    });
    const service = await createService(store);

    await expect(
      service.listManualTasks({
        workspaceId: "workspace_1",
        repoMappingId: "repo_mapping_1",
        limit: 10,
      }),
    ).resolves.toEqual([toExpectedManualTaskData(rows[0]!), toExpectedManualTaskData(rows[1]!)]);
    expect(store.listFilter).toEqual({
      limit: 10,
      repoMappingId: "repo_mapping_1",
      sourceType: "manual",
      statuses: ["draft", "approved"],
      workspaceId: "workspace_1",
    });
  });

  test.each([
    ["blank title", { title: " " }],
    ["blank objective", { objective: " " }],
    ["empty acceptance criteria", { acceptanceCriteria: [] }],
    ["blank acceptance criteria", { acceptanceCriteria: [" "] }],
    ["overlong title", { title: "a".repeat(241) }],
    ["overlong objective", { objective: "a".repeat(4_001) }],
    [
      "too many acceptance criteria",
      { acceptanceCriteria: Array.from({ length: 21 }, (_, index) => `Criterion ${index}`) },
    ],
    ["repair mode", { mode: "repair" }],
    ["control character", { objective: "Valid objective\nwith newline" }],
    ["diff hunk", { objective: "@@ -1,2 +1,3 @@\n+leak" }],
    ["raw diff", { title: "diff --git a/app.ts b/app.ts" }],
    ["source snippet", { objective: "function leak() { return process.env.SECRET; }" }],
    [
      "private key",
      { objective: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----" },
    ],
    ["token-like value", { objective: `Use ${"ghp_"}${"a".repeat(32)}` }],
    [
      "jwt token-like value",
      {
        objective:
          "Investigate eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      },
    ],
    [
      "slack token-like value",
      {
        acceptanceCriteria: [
          `Avoid ${"xoxb-"}${"1".repeat(12)}-${"2".repeat(12)}-${"a".repeat(24)}`,
        ],
      },
    ],
    [
      "stripe token-like value",
      { source: { externalId: `stripe-${"sk_live_"}${"a".repeat(24)}` } },
    ],
    ["bearer token-like value", { title: `Bearer ${"a".repeat(40)}` }],
    ["credential URL", { source: { url: "https://user:pass@example.com/task" } }],
    ["unsafe absolute context path", { contextFilePaths: ["/Users/rory/project/app.ts"] }],
    ["unsafe traversal context path", { contextFilePaths: ["../app.ts"] }],
    ["unsafe env context path", { contextFilePaths: [".env"] }],
    ["unsafe source-like context path", { contextFilePaths: ["src/function leak() {}"] }],
    ["file tree payload key", { fileTree: ["src/app.ts"] }],
    ["dependency graph payload key", { dependencyGraph: { "src/app.ts": ["src/db.ts"] } }],
    ["raw source payload key", { sourceCode: "const leaked = true;" }],
    ["raw content payload key", { context: { content: "file contents" } }],
    ["raw output payload key", { rawOutput: "command output" }],
    ["source snippet without semicolon", { objective: "const leaked = true" }],
    ["single-line call source snippet", { objective: 'console.log("x");' }],
    ["single-line control-flow source snippet", { objective: "if (enabled) { doWork(); }" }],
    ["tilde local path", { contextFilePaths: ["~/.ssh/id_rsa"] }],
  ])("rejects unsafe manual task input: %s", async (_caseName, overrides) => {
    const store = createStore();
    const service = await createService(store);

    await expect(
      service.createManualTask({
        ...baseCreateInput,
        ...(overrides as Partial<CreateManualTaskInput>),
      } as CreateManualTaskInput),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test.each([
    ["zero limit", 0],
    ["negative limit", -1],
    ["non-integer limit", 1.5],
    ["over max limit", 101],
  ])("rejects unsafe list limit: %s", async (_caseName, limit) => {
    const store = createStore();
    const service = await createService(store);

    await expect(
      service.listManualTasks({
        workspaceId: "workspace_1",
        limit,
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.listFilter).toBeUndefined();
  });

  test("uses stable descending created-at and id ordering for DB-backed manual task lists", async () => {
    const limit = vi.fn(async () => []);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const { createDrizzleManualTaskStore } = await importTasks();
    const store = createDrizzleManualTaskStore({
      select,
    } as never);

    await store.listManualTasks({
      limit: 10,
      sourceType: "manual",
      statuses: ["draft", "approved"],
      workspaceId: "workspace_1",
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(orderBy.mock.calls[0]).toHaveLength(2);
    expect(limit).toHaveBeenCalledWith(10);
  });

  test("excludes tasks whose repo mapping is archived from DB-backed manual task lists", async () => {
    const activeTask = createStoredTaskRow({
      id: "task_active",
      repoMappingId: "repo_mapping_active",
    });
    const archivedTask = createStoredTaskRow({
      id: "task_archived",
      repoMappingId: "repo_mapping_archived",
    });
    const findMany = vi.fn(async (): Promise<ManualTaskRow[]> => [activeTask, archivedTask]);
    const listRows = vi.fn(async () => [{ task: activeTask }]);
    const limit = vi.fn(async () => listRows());
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const { createDrizzleManualTaskStore } = await importTasks();
    const store = createDrizzleManualTaskStore({
      query: {
        tasks: {
          findMany,
        },
      },
      select,
    } as never);

    await expect(
      store.listManualTasks({
        limit: 10,
        sourceType: "manual",
        statuses: ["draft", "approved"],
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([activeTask]);
    expect(findMany).not.toHaveBeenCalled();
    expect(innerJoin).toHaveBeenCalledTimes(1);
  });
});
