import { describe, expect, test, vi } from "vitest";

import type {
  RequestRunCancellationWithAuditInput,
  RequestRunCancellationWithAuditResult,
} from "./cancel";
import type { AuditEventInsert } from "../server/audit";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importCancel = async () => import("./cancel");

type TestRunState =
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

type TestRun = {
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  cancellationRequestedByActorId: string | null;
  id: string;
  state: TestRunState;
  taskId: string;
  updatedAt: Date;
  workspaceId: string;
};

const createStore = (input: {
  memberships?: Array<{ userId: string; workspaceId: string }>;
  runs?: TestRun[];
}) => {
  const runs = input.runs ?? [];
  const auditEvents: AuditEventInsert[] = [];

  return {
    auditEvents,
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
      input.memberships?.some(
        (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    requestRunCancellationWithAudit: vi.fn(
      async ({
        auditEventFor,
        reason,
        requestedAt,
        requestedByActorId,
        runId,
        workspaceId,
      }: RequestRunCancellationWithAuditInput): Promise<RequestRunCancellationWithAuditResult> => {
        const run = runs.find(
          (candidate) => candidate.id === runId && candidate.workspaceId === workspaceId,
        );

        if (run === undefined) {
          return { status: "not_found" as const };
        }

        if (["blocked", "cancelled", "completed", "failed"].includes(run.state)) {
          return { state: run.state, status: "terminal" as const };
        }

        run.state = "cancel_requested";
        run.cancellationRequestedAt = requestedAt;
        run.cancellationRequestedByActorId = requestedByActorId;
        run.cancellationReason = reason;
        run.updatedAt = requestedAt;
        auditEvents.push(
          auditEventFor({
            id: run.id,
            state: run.state,
            taskId: run.taskId,
            workspaceId: run.workspaceId,
          }),
        );

        return {
          run: {
            cancellationReason: run.cancellationReason,
            cancellationRequestedAt: run.cancellationRequestedAt,
            cancellationRequestedByActorId: run.cancellationRequestedByActorId,
            id: run.id,
            state: "cancel_requested",
            taskId: run.taskId,
            workspaceId: run.workspaceId,
          },
          status: "cancelled" as const,
        };
      },
    ),
    runs,
  };
};

const createRun = (overrides: Partial<TestRun> = {}): TestRun => ({
  cancellationReason: null,
  cancellationRequestedAt: null,
  cancellationRequestedByActorId: null,
  id: "run_1",
  state: "claimed",
  taskId: "task_1",
  updatedAt: new Date("2026-05-22T11:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

describe("cancel run service", () => {
  test("rejects unauthenticated users before mutation", async () => {
    const { createCancelRunService } = await importCancel();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createCancelRunService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.cancelRun({
        reason: "Cancel before validation.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.requestRunCancellationWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects authenticated non-members before mutation", async () => {
    const { createCancelRunService } = await importCancel();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createCancelRunService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.cancelRun({
        reason: "Cancel before validation.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.requestRunCancellationWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("lets workspace members cancel an eligible run with sanitized metadata", async () => {
    const { createCancelRunService } = await importCancel();
    const requestedAt = new Date("2026-05-22T12:00:00.000Z");
    const run = createRun({ state: "validation_running" });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [run],
    });
    const service = createCancelRunService({
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => requestedAt,
      store,
    });

    await expect(
      service.cancelRun({
        reason: "  Cancel before validation finishes.  ",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      cancellationRequestedAt: requestedAt,
      cancellationRequestedByActorId: "user_1",
      redactionApplied: false,
      runId: "run_1",
      state: "cancel_requested",
      workspaceId: "workspace_1",
    });

    expect(run).toMatchObject({
      cancellationReason: "Cancel before validation finishes.",
      cancellationRequestedAt: requestedAt,
      cancellationRequestedByActorId: "user_1",
      state: "cancel_requested",
      updatedAt: requestedAt,
    });
    expect(store.requestRunCancellationWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Cancel before validation finishes.",
        requestedAt,
        requestedByActorId: "user_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: requestedAt,
        eventType: "run.cancel_requested",
        id: "audit_1",
        message: "Run cancellation requested.",
        metadata: {
          reasonLength: 34,
          reasonRedactionApplied: false,
          targetState: "cancel_requested",
        },
        runId: "run_1",
        taskId: "task_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(JSON.stringify(store.auditEvents)).not.toContain("Cancel before validation finishes");
  });

  test.each(["cancelled", "completed", "failed", "blocked"] as const)(
    "rejects terminal %s runs without mutation or audit",
    async (state) => {
      const { createCancelRunService } = await importCancel();
      const run = createRun({ state });
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        runs: [run],
      });
      const service = createCancelRunService({
        getAuthContext: async () => ({ userId: "user_1" }),
        store,
      });

      await expect(
        service.cancelRun({
          reason: "Cancel before validation.",
          runId: "run_1",
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(run.state).toBe(state);
      expect(run.cancellationRequestedAt).toBeNull();
      expect(store.auditEvents).toEqual([]);
    },
  );

  test("does not leak missing or out-of-workspace run existence", async () => {
    const { createCancelRunService } = await importCancel();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun({ id: "run_hidden", workspaceId: "workspace_2" })],
    });
    const service = createCancelRunService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.cancelRun({
        reason: "Cancel before validation.",
        runId: "run_missing",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.cancelRun({
        reason: "Cancel before validation.",
        runId: "run_hidden",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.auditEvents).toEqual([]);
  });

  test("redacts secret-looking reason text before storage and audit metadata", async () => {
    const { createCancelRunService } = await importCancel();
    const requestedAt = new Date("2026-05-22T12:00:00.000Z");
    const run = createRun();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [run],
    });
    const service = createCancelRunService({
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => requestedAt,
      store,
    });

    await expect(
      service.cancelRun({
        reason: "Cancel because token=ghp_abcdefghijklmnopqrstuvwxyz123456",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      redactionApplied: true,
      state: "cancel_requested",
    });

    expect(run.cancellationReason).toBe("Cancel because token=[REDACTED_SECRET]");
    expect(JSON.stringify(store.auditEvents)).not.toContain("ghp_");
    expect(JSON.stringify(store.auditEvents)).not.toContain("token=");
  });

  test("rejects diff, patch, and source-like reason text before mutation", async () => {
    const { createCancelRunService } = await importCancel();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createCancelRunService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.cancelRun({
        reason: "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-export const a = 1;",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.cancelRun({
        reason: "function run() { return process.env.SECRET; }",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.requestRunCancellationWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects fenced source snippets before mutation", async () => {
    const { createCancelRunService } = await importCancel();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createCancelRunService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.cancelRun({
        reason: "```ts\nconst value = computeValue()\n```",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.requestRunCancellationWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test.each([
    {
      label: "compact control-flow snippet",
      reason: "if (user.isAdmin) { allowAccess(); }",
    },
    {
      label: "SQL statement",
      reason: "SELECT * FROM users WHERE email = 'person@example.test';",
    },
    {
      label: "shell command",
      reason: "git reset --hard HEAD && pnpm install",
    },
  ])("rejects $label before mutation", async ({ reason }) => {
    const { createCancelRunService } = await importCancel();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createCancelRunService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.cancelRun({
        reason,
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.requestRunCancellationWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });
});

describe("Drizzle cancel run store", () => {
  test("wraps scoped run read, cancellation update, and audit insert in one transaction", async () => {
    const { createDrizzleCancelRunStore } = await importCancel();
    const requestedAt = new Date("2026-05-22T12:00:00.000Z");
    const limit = vi.fn(async () => [
      {
        id: "run_1",
        state: "claimed",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
    ]);
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const returning = vi.fn(async () => [
      {
        cancellationReason: "Cancel before validation.",
        cancellationRequestedAt: requestedAt,
        cancellationRequestedByActorId: "user_1",
        id: "run_1",
        state: "cancel_requested",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
    ]);
    const updateWhere = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const values = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; select: typeof select; update: typeof update }) => unknown) =>
        callback({ insert, select, update }),
    );
    const store = createDrizzleCancelRunStore({ transaction } as never);
    const auditEvent = {
      actorId: "user_1",
      createdAt: requestedAt,
      eventType: "run.cancel_requested",
      id: "audit_1",
      message: "Run cancellation requested.",
      metadata: {},
      runId: "run_1",
      taskId: "task_1",
      workspaceId: "workspace_1",
    };

    await expect(
      store.requestRunCancellationWithAudit({
        auditEventFor: (row: { id: string; taskId: string; workspaceId: string }) => ({
          actorId: "user_1",
          createdAt: requestedAt,
          eventType: "run.cancel_requested",
          id: "audit_1",
          message: "Run cancellation requested.",
          metadata: {},
          runId: row.id,
          taskId: row.taskId,
          workspaceId: row.workspaceId,
        }),
        reason: "Cancel before validation.",
        requestedAt,
        requestedByActorId: "user_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      run: {
        cancellationReason: "Cancel before validation.",
        state: "cancel_requested",
      },
      status: "cancelled",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      cancellationReason: "Cancel before validation.",
      cancellationRequestedAt: requestedAt,
      cancellationRequestedByActorId: "user_1",
      state: "cancel_requested",
      updatedAt: requestedAt,
    });
    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(auditEvent);
  });

  test("does not audit when a concurrent terminal update wins before cancellation update", async () => {
    const { createDrizzleCancelRunStore } = await importCancel();
    const requestedAt = new Date("2026-05-22T12:00:00.000Z");
    const firstLimit = vi.fn(async () => [
      {
        id: "run_1",
        state: "validation_running",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
    ]);
    const secondLimit = vi.fn(async () => [
      {
        id: "run_1",
        state: "completed",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
    ]);
    const createSelectBuilder = (limit: typeof firstLimit | typeof secondLimit) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    });
    const select = vi
      .fn()
      .mockReturnValueOnce(createSelectBuilder(firstLimit))
      .mockReturnValueOnce(createSelectBuilder(secondLimit));
    const returning = vi.fn(async () => []);
    const updateWhere = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const insert = vi.fn();
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; select: typeof select; update: typeof update }) => unknown) =>
        callback({ insert, select, update }),
    );
    const store = createDrizzleCancelRunStore({ transaction } as never);

    await expect(
      store.requestRunCancellationWithAudit({
        auditEventFor: () => ({
          createdAt: requestedAt,
          eventType: "run.cancel_requested",
          id: "audit_1",
          message: "Run cancellation requested.",
          metadata: {},
          workspaceId: "workspace_1",
        }),
        reason: "Cancel before validation.",
        requestedAt,
        requestedByActorId: "user_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({ state: "completed", status: "terminal" });

    expect(update).toHaveBeenCalled();
    expect(firstLimit).toHaveBeenCalled();
    expect(secondLimit).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test("does not update or audit missing or terminal scoped runs", async () => {
    const { createDrizzleCancelRunStore } = await importCancel();
    const requestedAt = new Date("2026-05-22T12:00:00.000Z");
    const limit = vi.fn(async () => [
      {
        id: "run_1",
        state: "completed",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
    ]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    }));
    const update = vi.fn();
    const insert = vi.fn();
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; select: typeof select; update: typeof update }) => unknown) =>
        callback({ insert, select, update }),
    );
    const store = createDrizzleCancelRunStore({ transaction } as never);

    await expect(
      store.requestRunCancellationWithAudit({
        auditEventFor: () => ({
          createdAt: requestedAt,
          eventType: "run.cancel_requested",
          id: "audit_1",
          message: "Run cancellation requested.",
          metadata: {},
          workspaceId: "workspace_1",
        }),
        reason: "Cancel before validation.",
        requestedAt,
        requestedByActorId: "user_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({ state: "completed", status: "terminal" });

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
