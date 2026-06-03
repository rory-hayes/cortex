import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

import {
  AUDIT_LOG_CATEGORIES,
  createDrizzleAuditLogStore,
  createAuditLogService,
  type AuditLogCategory,
  type AuditLogSourceRows,
  type AuditLogStore,
} from "./list";

type ClaimedRunSourceRow = {
  claimedAt: Date;
  claimExpiresAt: Date | null;
  id: string;
  jobId: string;
  jobType: string;
  mode: string;
  runnerId: string | null;
  taskId: string;
  workspaceId: string;
};

type TestStoreInput = {
  auditEvents?: AuditLogSourceRows["auditEvents"];
  claimedRuns?: ClaimedRunSourceRow[];
  memberships?: Array<{ role?: string; userId: string; workspaceId: string }>;
  runEvents?: AuditLogSourceRows["runEvents"];
};

const at = (value: string) => new Date(value);

const auditEvent = (
  overrides: Partial<AuditLogSourceRows["auditEvents"][number]> = {},
): AuditLogSourceRows["auditEvents"][number] => ({
  actorId: "user_1",
  createdAt: at("2026-05-23T10:00:00.000Z"),
  eventType: "runner_pairing.created",
  id: "audit_1",
  message: "Runner pairing code created.",
  metadata: {
    pairingId: "pairing_1",
    runnerId: "runner_1",
  },
  runId: null,
  runnerId: "runner_1",
  taskId: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const runEvent = (
  overrides: Partial<AuditLogSourceRows["runEvents"][number]> = {},
): AuditLogSourceRows["runEvents"][number] => ({
  createdAt: at("2026-05-23T10:00:00.000Z"),
  id: "event_1",
  message: "Job claimed.",
  metadata: {
    jobId: "job_1",
    jobType: "task",
    runnerId: "runner_1",
    taskId: "task_1",
  },
  runId: "run_1",
  runnerId: "runner_1",
  severity: "info",
  state: "claimed",
  workspaceId: "workspace_1",
  ...overrides,
});

const claimedRun = (overrides: Partial<ClaimedRunSourceRow> = {}): ClaimedRunSourceRow => ({
  claimedAt: at("2026-05-23T10:30:00.000Z"),
  claimExpiresAt: at("2026-05-23T10:45:00.000Z"),
  id: "run_1",
  jobId: "job_1",
  jobType: "task",
  mode: "execute",
  runnerId: "runner_1",
  taskId: "task_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (input: TestStoreInput = {}) => {
  const sourceCalls: Array<{ limit: number; workspaceId: string }> = [];
  const membershipCalls: Array<{ userId: string; workspaceId: string }> = [];
  const store: AuditLogStore & {
    membershipCalls: typeof membershipCalls;
    sourceCalls: typeof sourceCalls;
  } = {
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) => {
      membershipCalls.push({ userId, workspaceId });
      const membership = input.memberships?.find(
        (candidate) => candidate.userId === userId && candidate.workspaceId === workspaceId,
      );

      return membership === undefined
        ? null
        : {
            id: `${membership.workspaceId}:${membership.userId}`,
            role: membership.role ?? "member",
          };
    }),
    listAuditLogSources: vi.fn(async ({ limit, workspaceId }) => {
      sourceCalls.push({ limit, workspaceId });

      return {
        auditEvents: input.auditEvents ?? [],
        claimedRuns: input.claimedRuns ?? [],
        runEvents: input.runEvents ?? [],
      } as AuditLogSourceRows & { claimedRuns: ClaimedRunSourceRow[] };
    }),
    membershipCalls,
    sourceCalls,
  };

  return store;
};

const createService = (
  store: AuditLogStore,
  getAuthContext: () => Promise<{ userId: string | null }> = async () => ({ userId: "user_1" }),
) =>
  createAuditLogService({
    getAuthContext,
    store,
  });

const expectServerActionErrorCode = (code: string) => ({
  asymmetricMatch: (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === code,
  toString: () => `ServerActionError(${code})`,
});

const expectNoUnsafeMaterial = (value: unknown) => {
  const text = JSON.stringify(value);

  expect(text).not.toMatch(
    /diff --git|@@|raw source|source code|sourceCode|raw patch|rawLog|command output|snippet|rawOutput|stdout|stderr|credential|\/Users\/rory|\/private\/tmp|ghp_|sk-test|secret=|token=/i,
  );
};

describe("createAuditLogService", () => {
  test("rejects unauthenticated users and non-members before audit row access", async () => {
    const unauthenticatedStore = createStore({
      auditEvents: [auditEvent()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [runEvent()],
    });
    const unauthenticatedService = createService(unauthenticatedStore, async () => ({
      userId: null,
    }));

    await expect(
      unauthenticatedService.listAuditLog({ workspaceId: "workspace_1" }),
    ).rejects.toEqual(expectServerActionErrorCode("unauthenticated"));
    expect(unauthenticatedStore.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(unauthenticatedStore.listAuditLogSources).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      auditEvents: [auditEvent()],
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runEvents: [runEvent()],
    });
    const nonMemberService = createService(nonMemberStore);

    await expect(nonMemberService.listAuditLog({ workspaceId: "workspace_1" })).rejects.toEqual(
      expectServerActionErrorCode("forbidden"),
    );
    expect(nonMemberStore.membershipCalls).toEqual([
      { userId: "user_1", workspaceId: "workspace_1" },
    ]);
    expect(nonMemberStore.listAuditLogSources).not.toHaveBeenCalled();
  });

  test("trims and validates workspace ids before querying the verified workspace", async () => {
    const store = createStore({
      auditEvents: [auditEvent()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [runEvent()],
    });
    const service = createService(store);

    await expect(service.listAuditLog({ workspaceId: " workspace_1 " })).resolves.toHaveLength(2);
    expect(store.membershipCalls).toEqual([{ userId: "user_1", workspaceId: "workspace_1" }]);
    expect(store.sourceCalls).toEqual([{ limit: 150, workspaceId: "workspace_1" }]);

    await expect(service.listAuditLog({ workspaceId: "   " })).rejects.toEqual(
      expectServerActionErrorCode("validation_error"),
    );
  });

  test("combines immutable audit rows with only consequential runner events sorted newest first", async () => {
    const store = createStore({
      auditEvents: [
        auditEvent({
          createdAt: at("2026-05-23T09:00:00.000Z"),
          id: "audit_old",
          message: "Runner linked.",
        }),
        auditEvent({
          createdAt: at("2026-05-23T12:00:00.000Z"),
          eventType: "run.cancel_requested",
          id: "audit_cancel",
          message: "Run cancellation requested.",
          runId: "run_2",
        }),
        auditEvent({
          createdAt: at("2026-05-23T13:00:00.000Z"),
          id: "audit_other_workspace",
          workspaceId: "workspace_2",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [
        runEvent({
          createdAt: at("2026-05-23T11:00:00.000Z"),
          id: "event_claimed",
          state: "claimed",
        }),
        runEvent({
          createdAt: at("2026-05-23T11:30:00.000Z"),
          id: "event_noise",
          state: "codex_running",
        }),
        runEvent({
          createdAt: at("2026-05-23T14:00:00.000Z"),
          id: "event_other_workspace",
          state: "blocked",
          workspaceId: "workspace_2",
        }),
      ],
    });
    const service = createService(store);

    const rows = await service.listAuditLog({ limit: 10, workspaceId: "workspace_1" });

    expect(rows.map((row) => row.id)).toEqual([
      "audit:audit_cancel",
      "run-event:event_claimed",
      "audit:audit_old",
    ]);
    expect(rows.every((row) => row.workspaceId === "workspace_1")).toBe(true);
    expect(rows.map((row) => row.id)).not.toContain("run-event:event_noise");
  });

  test("derives job claim rows from claimed run records without fabricated run events", async () => {
    const store = createStore({
      auditEvents: [],
      claimedRuns: [claimedRun()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [],
    });
    const service = createService(store);

    const rows = await service.listAuditLog({ workspaceId: "workspace_1" });

    expect(rows).toEqual([
      expect.objectContaining({
        actorId: null,
        category: "job",
        details: expect.arrayContaining([
          { label: "Runner", value: "runner_1" },
          { label: "Job", value: "job_1" },
          { label: "Job type", value: "task" },
          { label: "Mode", value: "execute" },
          { label: "Task", value: "task_1" },
        ]),
        eventType: "run.claimed",
        id: "run-claim:run_1",
        message: "Job claimed.",
        runId: "run_1",
        runnerId: "runner_1",
        severity: "info",
        source: "run_event",
        sourceLabel: "Run record",
        taskId: "task_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeMaterial(rows);
  });

  test("maps audit event types and runner states into stable audit categories", async () => {
    expect(AUDIT_LOG_CATEGORIES).toEqual([
      "runner",
      "job",
      "cancellation",
      "approval",
      "repair",
      "integration",
      "policy",
      "repository",
      "task",
      "workspace",
    ] satisfies AuditLogCategory[]);

    const store = createStore({
      auditEvents: [
        auditEvent({ eventType: "runner_pairing.redeemed", id: "runner_pairing" }),
        auditEvent({ eventType: "run.cancel_requested", id: "cancel" }),
        auditEvent({ eventType: "run.approval_decision_recorded", id: "approval" }),
        auditEvent({ eventType: "run.repair_requested", id: "repair" }),
        auditEvent({ eventType: "integration.linear.synced", id: "integration" }),
        auditEvent({ eventType: "repo_mapping.created", id: "repo_mapping" }),
        auditEvent({ eventType: "task.manual.created", id: "task" }),
        auditEvent({ eventType: "workspace.updated", id: "workspace" }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [
        runEvent({ id: "claimed", state: "claimed" }),
        runEvent({ id: "cancelled", state: "cancelled" }),
        runEvent({ id: "awaiting_approval", state: "awaiting_approval" }),
        runEvent({ id: "repair_requested", state: "repair_requested" }),
        runEvent({ id: "pr_opened", state: "pr_opened" }),
        runEvent({
          id: "policy_block",
          message: "Policy block recorded.",
          metadata: {
            riskCategory: "protected_path",
          },
          severity: "blocked",
          state: "blocked",
        }),
      ],
    });
    const service = createService(store);

    const rows = await service.listAuditLog({ workspaceId: "workspace_1" });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.category]));

    expect(byId).toMatchObject({
      "audit:approval": "approval",
      "audit:cancel": "cancellation",
      "audit:integration": "integration",
      "audit:repo_mapping": "repository",
      "audit:repair": "repair",
      "audit:runner_pairing": "runner",
      "audit:task": "task",
      "audit:workspace": "workspace",
      "run-event:awaiting_approval": "approval",
      "run-event:cancelled": "cancellation",
      "run-event:claimed": "job",
      "run-event:policy_block": "policy",
      "run-event:pr_opened": "job",
      "run-event:repair_requested": "repair",
    });
  });

  test("supports category and source filters while capping source query limits", async () => {
    const store = createStore({
      auditEvents: [
        auditEvent({
          eventType: "runner.revoked",
          id: "audit_runner",
          message: "Runner revoked.",
        }),
        auditEvent({
          eventType: "run.cancel_requested",
          id: "audit_cancel",
          message: "Run cancellation requested.",
        }),
        auditEvent({
          eventType: "run.approval_decision_recorded",
          id: "audit_approval",
          message: "Approval decision recorded.",
          metadata: {
            decision: "approve",
            reasonLength: 20,
          },
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [
        runEvent({
          id: "run_policy_block",
          metadata: {
            jobId: "job_1",
            riskCategory: "protected_path",
          },
          severity: "blocked",
          state: "blocked",
        }),
      ],
    });
    const service = createService(store);

    const cancellationRows = await service.listAuditLog({
      category: "cancellation",
      limit: 1_000,
      workspaceId: "workspace_1",
    });

    expect(cancellationRows).toHaveLength(1);
    expect(cancellationRows[0]).toMatchObject({
      category: "cancellation",
      id: "audit:audit_cancel",
      message: "Run cancellation requested.",
    });
    expect(store.sourceCalls).toEqual([{ limit: 300, workspaceId: "workspace_1" }]);

    await expect(
      service.listAuditLog({
        category: "policy",
        source: "run_event",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        category: "policy",
        id: "run-event:run_policy_block",
        source: "run_event",
      }),
    ]);
  });

  test("returns only allowlisted display fields and summary labels without unsafe metadata", async () => {
    const store = createStore({
      auditEvents: [
        auditEvent({
          eventType: "run.approval_decision_recorded",
          id: "audit_unsafe",
          message: "diff --git a/src/app.ts b/src/app.ts with token=ghp_12345678901234567890",
          metadata: {
            credentialHash: "hash_should_not_render",
            decision: "request_repair",
            diff: "diff --git a/file b/file",
            localPath: "/Users/rory/private/source/repo",
            patch: "@@ -1 +1 @@",
            rawLog: "stderr token=abc12345",
            rawOutput: "command output token=abc12345",
            reasonLength: 42,
            secret: "secret=ghp_12345678901234567890",
            source: "raw source code",
            sourceCode: "function unsafe() {}",
            snippet: "const token = 'sk-test-abc'",
            stderr: "stderr with token=abc12345",
            stdout: "stdout with logs",
            token: "token=abc12345",
          },
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runEvents: [
        runEvent({
          id: "event_unsafe",
          message: "Source code leaked from /private/tmp/repo",
          metadata: {
            jobId: "job_1",
            rawLog: "stderr token=abc12345",
            riskCategory: "protected_path",
            taskId: "task_1",
          },
          severity: "blocked",
          state: "blocked",
        }),
      ],
    });
    const service = createService(store);

    const rows = await service.listAuditLog({ workspaceId: "workspace_1" });

    expect(rows).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        category: "approval",
        details: [
          { label: "Decision", value: "request repair" },
          { label: "Reason length", value: "42" },
        ],
        eventType: "run.approval_decision_recorded",
        id: "audit:audit_unsafe",
        message: "Run Approval Decision Recorded.",
        runId: null,
        runnerId: "runner_1",
        severity: "info",
        taskId: null,
        workspaceId: "workspace_1",
      }),
      expect.objectContaining({
        actorId: null,
        category: "policy",
        details: [
          { label: "Job", value: "job_1" },
          { label: "Risk", value: "protected path" },
          { label: "Task", value: "task_1" },
        ],
        eventType: "run.blocked",
        id: "run-event:event_unsafe",
        message: "Run Blocked.",
        runId: "run_1",
        runnerId: "runner_1",
        severity: "blocked",
        taskId: "task_1",
        workspaceId: "workspace_1",
      }),
    ]);
    for (const row of rows) {
      expect(row).not.toHaveProperty("metadata");
    }
    expectNoUnsafeMaterial(rows);
  });

  test("drizzle store filters consequential run events before applying the run event limit", async () => {
    type FakeOperators = {
      and: (...values: unknown[]) => unknown;
      desc: (field: string) => unknown;
      eq: (field: string, value: unknown) => unknown;
      inArray: (field: string, values: unknown[]) => unknown;
      isNotNull: (field: string) => unknown;
      or: (...values: unknown[]) => unknown;
    };
    const operators: FakeOperators = {
      and: (...values: unknown[]) => ({ op: "and", values }),
      desc: (field: string) => ({ field, op: "desc" }),
      eq: (field: string, value: unknown) => ({ field, op: "eq", value }),
      inArray: (field: string, values: unknown[]) => ({ field, op: "inArray", values }),
      isNotNull: (field: string) => ({ field, op: "isNotNull" }),
      or: (...values: unknown[]) => ({ op: "or", values }),
    };
    const queryPredicates: {
      claimedRuns?: unknown;
      runEvents?: unknown;
    } = {};
    const createFindMany = (
      fields: Record<string, string>,
      capture: keyof typeof queryPredicates | null,
    ) =>
      vi.fn(
        async (options: {
          limit: number;
          orderBy?: (fields: Record<string, string>, operators: FakeOperators) => unknown;
          where?: (fields: Record<string, string>, operators: FakeOperators) => unknown;
        }) => {
          if (capture !== null && options.where !== undefined) {
            queryPredicates[capture] = options.where(fields, operators);
          }

          if (options.orderBy !== undefined) {
            options.orderBy(fields, operators);
          }

          return [];
        },
      );
    const legacyLimit = vi.fn(async () => []);
    const db = {
      query: {
        auditEvents: {
          findMany: createFindMany(
            {
              createdAt: "auditEvents.createdAt",
              workspaceId: "auditEvents.workspaceId",
            },
            null,
          ),
        },
        runEvents: {
          findMany: createFindMany(
            {
              createdAt: "runEvents.createdAt",
              severity: "runEvents.severity",
              state: "runEvents.state",
              workspaceId: "runEvents.workspaceId",
            },
            "runEvents",
          ),
        },
        runs: {
          findMany: createFindMany(
            {
              claimedAt: "runs.claimedAt",
              workspaceId: "runs.workspaceId",
            },
            "claimedRuns",
          ),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: legacyLimit,
            })),
          })),
        })),
      })),
    };
    const store = createDrizzleAuditLogStore(db as never);

    await store.listAuditLogSources({ limit: 3, workspaceId: "workspace_1" });

    expect(db.query.runEvents.findMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    expect(queryPredicates.runEvents).toEqual({
      op: "and",
      values: [
        { field: "runEvents.workspaceId", op: "eq", value: "workspace_1" },
        {
          op: "or",
          values: [
            {
              field: "runEvents.state",
              op: "inArray",
              values: expect.arrayContaining([
                "awaiting_approval",
                "blocked",
                "cancel_requested",
                "cancelling",
                "cancelled",
                "claimed",
                "failed",
                "pr_opened",
                "repair_requested",
              ]),
            },
            { field: "runEvents.severity", op: "eq", value: "blocked" },
          ],
        },
      ],
    });
    expect(queryPredicates.claimedRuns).toEqual({
      op: "and",
      values: [
        { field: "runs.workspaceId", op: "eq", value: "workspace_1" },
        { field: "runs.claimedAt", op: "isNotNull" },
      ],
    });
    expect(legacyLimit).not.toHaveBeenCalled();
  });
});
