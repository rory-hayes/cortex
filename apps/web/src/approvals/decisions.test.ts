import { describe, expect, test, vi } from "vitest";

import {
  APPROVAL_DECISIONS,
  ApprovalDecisionSchema,
  CONTRACT_VERSION,
  type ApprovalDecision,
  type ApprovalDecisionValue,
  type RunState,
} from "@control-plane/shared";

import type {
  ApprovalDecisionInsert,
  ApprovalDecisionRunRow,
  PersistApprovalDecisionWithAuditInput,
  PersistApprovalDecisionWithAuditResult,
} from "./decisions";
import type { AuditEventInsert } from "../server/audit";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importDecisions = async () => import("./decisions");

type TestRun = ApprovalDecisionRunRow;

const createRun = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "run_1",
  state: "awaiting_approval",
  taskId: "task_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const toSharedApprovalDecision = (approval: ApprovalDecisionInsert): ApprovalDecision => ({
  actorId: approval.actorId,
  contractVersion: approval.contractVersion,
  createdAt: approval.createdAt.toISOString(),
  decision: approval.decision,
  id: approval.id,
  reason: approval.reason,
  runId: approval.runId,
});

const createStore = (input: {
  memberships?: Array<{ userId: string; workspaceId: string }>;
  runs?: TestRun[];
}) => {
  const approvals: ApprovalDecisionInsert[] = [];
  const auditEvents: AuditEventInsert[] = [];
  const runs = input.runs ?? [];

  return {
    approvals,
    auditEvents,
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
      input.memberships?.some(
        (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    persistApprovalDecisionWithAudit: vi.fn(
      async ({
        approval,
        auditEventFor,
        runId,
        workspaceId,
      }: PersistApprovalDecisionWithAuditInput): Promise<PersistApprovalDecisionWithAuditResult> => {
        const run = runs.find(
          (candidate) => candidate.id === runId && candidate.workspaceId === workspaceId,
        );

        if (run === undefined) {
          return { status: "not_found" as const };
        }

        approvals.push(approval);
        auditEvents.push(auditEventFor({ approval, run }));

        return {
          approval,
          run,
          status: "created" as const,
        };
      },
    ),
    runs,
  };
};

describe("approval decision service", () => {
  test.each(APPROVAL_DECISIONS)(
    "persists %s decisions with shared-contract fields and sanitized audit metadata",
    async (decision) => {
      const { createApprovalDecisionService } = await importDecisions();
      const createdAt = new Date("2026-05-23T09:15:00.000Z");
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        runs: [createRun({ state: "pr_opened" })],
      });
      const service = createApprovalDecisionService({
        createApprovalDecisionId: () => `approval_${decision}`,
        createAuditEventId: () => `audit_${decision}`,
        getAuthContext: async () => ({ userId: "user_1" }),
        now: () => createdAt,
        store,
      });

      await expect(
        service.recordApprovalDecision({
          decision,
          reason: "  Human review completed.  ",
          runId: " run_1 ",
          workspaceId: " workspace_1 ",
        }),
      ).resolves.toEqual({
        actorId: "user_1",
        approvalDecisionId: `approval_${decision}`,
        createdAt,
        decision,
        redactionApplied: false,
        runId: "run_1",
        workspaceId: "workspace_1",
      });

      expect(store.approvals).toEqual([
        expect.objectContaining({
          actorId: "user_1",
          createdAt,
          decision,
          id: `approval_${decision}`,
          reason: "Human review completed.",
          runId: "run_1",
          workspaceId: "workspace_1",
        }),
      ]);
      const persistedApproval = store.approvals[0];

      expect(persistedApproval).toBeDefined();
      if (persistedApproval === undefined) {
        throw new Error("Approval decision was not persisted.");
      }
      expect(
        ApprovalDecisionSchema.safeParse(toSharedApprovalDecision(persistedApproval)).success,
      ).toBe(true);
      expect(store.persistApprovalDecisionWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run_1",
          workspaceId: "workspace_1",
        }),
      );
      expect(store.auditEvents).toEqual([
        expect.objectContaining({
          actorId: "user_1",
          createdAt,
          eventType: "run.approval_decision_recorded",
          id: `audit_${decision}`,
          message: "Approval decision recorded.",
          metadata: {
            approvalDecisionId: `approval_${decision}`,
            decision,
            reasonLength: 23,
            reasonRedactionApplied: false,
            runStateAtDecision: "pr_opened",
          },
          runId: "run_1",
          taskId: "task_1",
          workspaceId: "workspace_1",
        }),
      ]);
      expect(JSON.stringify(store.auditEvents)).not.toContain("Human review completed");
    },
  );

  test("rejects unauthenticated users before mutation", async () => {
    const { createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "Human review completed.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.persistApprovalDecisionWithAudit).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("uses the authenticated actor instead of caller-supplied actor data", async () => {
    const { createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      createApprovalDecisionId: () => "approval_1",
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        actorId: "attacker_actor",
        decision: "approve",
        reason: "Human review completed.",
        runId: "run_1",
        workspaceId: "workspace_1",
      } as Parameters<typeof service.recordApprovalDecision>[0] & { actorId: string }),
    ).resolves.toMatchObject({
      actorId: "user_1",
      approvalDecisionId: "approval_1",
    });

    expect(store.approvals[0]?.actorId).toBe("user_1");
    expect(store.auditEvents[0]?.actorId).toBe("user_1");
    expect(JSON.stringify(store.approvals)).not.toContain("attacker_actor");
    expect(JSON.stringify(store.auditEvents)).not.toContain("attacker_actor");
  });

  test("rejects authenticated non-members before mutation", async () => {
    const { createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "Human review completed.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.persistApprovalDecisionWithAudit).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("does not leak missing or out-of-workspace run existence", async () => {
    const { createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun({ id: "run_hidden", workspaceId: "workspace_2" })],
    });
    const service = createApprovalDecisionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "Human review completed.",
        runId: "run_missing",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "Human review completed.",
        runId: "run_hidden",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects invalid decisions through the shared approval decision contract", async () => {
    const { createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "defer" as ApprovalDecisionValue,
        reason: "Human review completed.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.persistApprovalDecisionWithAudit).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects empty and overlong reasons before mutation", async () => {
    const { APPROVAL_REASON_MAX_LENGTH, createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "   ",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "a".repeat(APPROVAL_REASON_MAX_LENGTH + 1),
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.persistApprovalDecisionWithAudit).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("redacts secret-looking reasons before persistence and audit", async () => {
    const { createApprovalDecisionService } = await importDecisions();
    const createdAt = new Date("2026-05-23T09:15:00.000Z");
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      createApprovalDecisionId: () => "approval_1",
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "approve",
        reason: "Approve because token=ghp_abcdefghijklmnopqrstuvwxyz123456",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      approvalDecisionId: "approval_1",
      redactionApplied: true,
    });

    expect(store.approvals[0]?.reason).toBe("Approve because token=[REDACTED_SECRET]");
    expect(store.auditEvents[0]?.metadata).toMatchObject({
      reasonLength: 39,
      reasonRedactionApplied: true,
    });
    expect(JSON.stringify(store.auditEvents)).not.toContain("ghp_");
    expect(JSON.stringify(store.auditEvents)).not.toContain("token=");
  });

  test.each([
    {
      label: "diff",
      reason: "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-export const a = 1;",
    },
    {
      label: "patch",
      reason: "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@",
    },
    {
      label: "fenced snippet",
      reason: "```ts\nconst value = computeValue()\n```",
    },
    {
      label: "source-like text",
      reason: "function run() { return process.env.SECRET; }",
    },
    {
      label: "awaited chained call with object literal",
      reason: 'await db.insert(schema.approvals).values({ reason: "Approved after review." })',
    },
    {
      label: "TypeScript interface snippet",
      reason: "interface User { id: string }",
    },
    {
      label: "TypeScript type alias snippet",
      reason: "type User = { id: string }",
    },
    {
      label: "raw test failure output",
      reason: "FAIL apps/web/src/foo.test.ts\n  rejects unsafe input\nExpected true to be false",
    },
    {
      label: "shell command output",
      reason: "pnpm test -- apps/web/src/approvals/decisions.test.ts",
    },
    {
      label: "residual bearer secret",
      reason: "Please approve after bearer deadbeefcafebabe still appears.",
    },
  ])("rejects $label reason text before mutation", async ({ reason }) => {
    const { createApprovalDecisionService } = await importDecisions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalDecisionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.recordApprovalDecision({
        decision: "request_repair",
        reason,
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.persistApprovalDecisionWithAudit).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });
});

describe("Drizzle approval decision store", () => {
  test("wraps scoped run read, approval insert, and audit insert in one transaction", async () => {
    const { createDrizzleApprovalDecisionStore } = await importDecisions();
    const { schema } = await import("../db");
    const createdAt = new Date("2026-05-23T09:15:00.000Z");
    const operations: string[] = [];
    const approval: ApprovalDecisionInsert = {
      actorId: "user_1",
      contractVersion: CONTRACT_VERSION,
      createdAt,
      decision: "approve",
      id: "approval_1",
      reason: "Human review completed.",
      runId: "run_1",
      workspaceId: "workspace_1",
    };
    const run = {
      id: "run_1",
      state: "awaiting_approval" as RunState,
      taskId: "task_1",
      workspaceId: "workspace_1",
    };
    const limit = vi.fn(async () => {
      operations.push("select-run");

      return [run];
    });
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const approvalReturning = vi.fn(async () => {
      operations.push("insert-approval");

      return [approval];
    });
    const approvalValues = vi.fn(() => ({ returning: approvalReturning }));
    const auditValues = vi.fn(async () => {
      operations.push("insert-audit");
    });
    const insert = vi.fn((table: unknown) => {
      if (table === schema.approvals) {
        return { values: approvalValues };
      }

      if (table === schema.auditEvents) {
        return { values: auditValues };
      }

      throw new Error("Unexpected insert table.");
    });
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; select: typeof select }) => unknown) =>
        callback({ insert, select }),
    );
    const store = createDrizzleApprovalDecisionStore({ transaction } as never);
    const auditEvent = {
      actorId: "user_1",
      createdAt,
      eventType: "run.approval_decision_recorded",
      id: "audit_1",
      message: "Approval decision recorded.",
      metadata: {
        approvalDecisionId: "approval_1",
      },
      runId: "run_1",
      taskId: "task_1",
      workspaceId: "workspace_1",
    };

    await expect(
      store.persistApprovalDecisionWithAudit({
        approval,
        auditEventFor: () => auditEvent,
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      approval,
      run,
      status: "created",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalled();
    expect(insert).toHaveBeenNthCalledWith(1, schema.approvals);
    expect(insert).toHaveBeenNthCalledWith(2, schema.auditEvents);
    expect(approvalValues).toHaveBeenCalledWith(approval);
    expect(auditValues).toHaveBeenCalledWith(auditEvent);
    expect(operations).toEqual(["select-run", "insert-approval", "insert-audit"]);
  });

  test("updates run state in the same transaction before approval and audit when a transition is requested", async () => {
    const { createDrizzleApprovalDecisionStore } = await importDecisions();
    const { schema } = await import("../db");
    const createdAt = new Date("2026-05-23T09:15:00.000Z");
    const operations: string[] = [];
    const approval: ApprovalDecisionInsert = {
      actorId: "user_1",
      contractVersion: CONTRACT_VERSION,
      createdAt,
      decision: "approve",
      id: "approval_1",
      reason: "Human review completed.",
      runId: "run_1",
      workspaceId: "workspace_1",
    };
    const run = {
      id: "run_1",
      state: "awaiting_approval" as RunState,
      taskId: "task_1",
      workspaceId: "workspace_1",
    };
    const transitionedRun = {
      ...run,
      state: "completed" as RunState,
    };
    const limit = vi.fn(async () => {
      operations.push("select-run");

      return [run];
    });
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const updateReturning = vi.fn(async () => {
      operations.push("update-run-state");

      return [transitionedRun];
    });
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn((table: unknown) => {
      if (table !== schema.runs) {
        throw new Error("Unexpected update table.");
      }

      return { set: updateSet };
    });
    const approvalReturning = vi.fn(async () => {
      operations.push("insert-approval");

      return [approval];
    });
    const approvalValues = vi.fn(() => ({ returning: approvalReturning }));
    const auditValues = vi.fn(async () => {
      operations.push("insert-audit");
    });
    const insert = vi.fn((table: unknown) => {
      if (table === schema.approvals) {
        return { values: approvalValues };
      }

      if (table === schema.auditEvents) {
        return { values: auditValues };
      }

      throw new Error("Unexpected insert table.");
    });
    const transaction = vi.fn(
      async (
        callback: (tx: {
          insert: typeof insert;
          select: typeof select;
          update: typeof update;
        }) => unknown,
      ) => callback({ insert, select, update }),
    );
    const store = createDrizzleApprovalDecisionStore({ transaction } as never);
    const auditEvent = {
      actorId: "user_1",
      createdAt,
      eventType: "run.approval_decision_recorded",
      id: "audit_1",
      message: "Approval decision recorded.",
      metadata: {
        approvalDecisionId: "approval_1",
        runStateAtDecision: "awaiting_approval",
        targetState: "completed",
      },
      runId: "run_1",
      taskId: "task_1",
      workspaceId: "workspace_1",
    };
    const auditEventFor = vi.fn(() => auditEvent);

    await expect(
      store.persistApprovalDecisionWithAudit({
        approval,
        auditEventFor,
        runId: "run_1",
        stateTransition: {
          expectedState: "awaiting_approval",
          targetState: "completed",
          transitionedAt: createdAt,
        },
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      approval,
      run: transitionedRun,
      status: "created",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(schema.runs);
    expect(updateSet).toHaveBeenCalledWith({
      finishedAt: createdAt,
      state: "completed",
      updatedAt: createdAt,
    });
    expect(auditEventFor).toHaveBeenCalledWith({
      approval,
      run,
      targetState: "completed",
    });
    expect(auditValues).toHaveBeenCalledWith(auditEvent);
    expect(operations).toEqual([
      "select-run",
      "update-run-state",
      "insert-approval",
      "insert-audit",
    ]);
  });

  test("fails closed before run transition when required approval evidence is missing", async () => {
    const { createDrizzleApprovalDecisionStore } = await importDecisions();
    const createdAt = new Date("2026-05-23T09:15:00.000Z");
    const approval: ApprovalDecisionInsert = {
      actorId: "user_1",
      contractVersion: CONTRACT_VERSION,
      createdAt,
      decision: "approve",
      id: "approval_1",
      reason: "Human review completed.",
      runId: "run_1",
      workspaceId: "workspace_1",
    };
    const run = {
      id: "run_1",
      state: "awaiting_approval" as RunState,
      taskId: "task_1",
      workspaceId: "workspace_1",
    };
    let selectCallIndex = 0;
    const select = vi.fn(() => {
      const currentCallIndex = selectCallIndex;
      selectCallIndex += 1;

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => (currentCallIndex === 0 ? [run] : [])),
          })),
        })),
      };
    });
    const update = vi.fn();
    const insert = vi.fn();
    const transaction = vi.fn(
      async (
        callback: (tx: {
          insert: typeof insert;
          select: typeof select;
          update: typeof update;
        }) => unknown,
      ) => callback({ insert, select, update }),
    );
    const store = createDrizzleApprovalDecisionStore({ transaction } as never);

    await expect(
      store.persistApprovalDecisionWithAudit({
        approval,
        auditEventFor: () => {
          throw new Error("Audit event should not be built without complete review evidence.");
        },
        requiredEvidence: {
          changedPathMetadata: true,
          policyRiskEvidence: true,
          prMetadata: true,
          validationEvidence: true,
        },
        runId: "run_1",
        stateTransition: {
          expectedState: "awaiting_approval",
          targetState: "completed",
          transitionedAt: createdAt,
        },
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      missingEvidence: [
        "validation_evidence",
        "pr_metadata",
        "changed_path_metadata",
        "policy_risk_evidence",
      ],
      status: "missing_evidence",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(4);
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test.each([
    ["approve", "completed"],
    ["reject", "failed"],
  ] as const)(
    "transitions repaired runs on %s when PR risk metadata replaces dry-run policy evidence",
    async (decision, targetState) => {
      const { createDrizzleApprovalDecisionStore } = await importDecisions();
      const { schema } = await import("../db");
      const createdAt = new Date("2026-05-23T09:15:00.000Z");
      const operations: string[] = [];
      const approval: ApprovalDecisionInsert = {
        actorId: "user_1",
        contractVersion: CONTRACT_VERSION,
        createdAt,
        decision,
        id: `approval_repair_${decision}_1`,
        reason: "Repair evidence received human review.",
        runId: "run_repair_1",
        workspaceId: "workspace_1",
      };
      const run = {
        id: "run_repair_1",
        mode: "repair" as const,
        state: "awaiting_approval" as RunState,
        taskId: "task_1",
        workspaceId: "workspace_1",
      };
      const transitionedRun = {
        ...run,
        state: targetState,
      };
      let selectCallIndex = 0;
      const select = vi.fn(() => {
        const currentCallIndex = selectCallIndex;
        selectCallIndex += 1;

        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => {
                if (currentCallIndex === 0) {
                  operations.push("select-run");

                  return [run];
                }

                if (currentCallIndex === 1) {
                  operations.push("select-validation");

                  return [{ id: "validation_1" }];
                }

                if (currentCallIndex === 2) {
                  operations.push("select-pr-artifact");

                  return [
                    {
                      changedFilePaths: ["apps/web/components/approval-review-panel.tsx"],
                      id: "pr_artifact_1",
                      riskFindings: [
                        {
                          category: "package_lock",
                          id: "risk:package_lock",
                          message: "Package lock changed.",
                          paths: ["pnpm-lock.yaml"],
                          severity: "warning",
                        },
                      ],
                    },
                  ];
                }

                operations.push("select-dry-run");

                return [];
              }),
            })),
          })),
        };
      });
      const updateReturning = vi.fn(async () => {
        operations.push("update-run-state");

        return [transitionedRun];
      });
      const update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: updateReturning })),
        })),
      }));
      const approvalReturning = vi.fn(async () => {
        operations.push("insert-approval");

        return [approval];
      });
      const insert = vi.fn((table: unknown) => {
        if (table === schema.approvals) {
          return {
            values: vi.fn(() => ({ returning: approvalReturning })),
          };
        }

        if (table === schema.auditEvents) {
          return {
            values: vi.fn(async () => {
              operations.push("insert-audit");
            }),
          };
        }

        throw new Error("Unexpected insert table.");
      });
      const transaction = vi.fn(
        async (
          callback: (tx: {
            insert: typeof insert;
            select: typeof select;
            update: typeof update;
          }) => unknown,
        ) => callback({ insert, select, update }),
      );
      const store = createDrizzleApprovalDecisionStore({ transaction } as never);
      const auditEventFor = vi.fn(() => ({
        actorId: "user_1",
        createdAt,
        eventType: "run.approval_decision_recorded",
        id: "audit_1",
        message: "Approval decision recorded.",
        metadata: {
          approvalDecisionId: `approval_repair_${decision}_1`,
          runStateAtDecision: "awaiting_approval",
          targetState,
        },
        runId: "run_repair_1",
        taskId: "task_1",
        workspaceId: "workspace_1",
      }));

      await expect(
        store.persistApprovalDecisionWithAudit({
          approval,
          auditEventFor,
          requiredEvidence: {
            changedPathMetadata: true,
            policyRiskEvidence: true,
            prMetadata: true,
            validationEvidence: true,
          },
          runId: "run_repair_1",
          stateTransition: {
            expectedState: "awaiting_approval",
            targetState,
            transitionedAt: createdAt,
          },
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        approval,
        run: transitionedRun,
        status: "created",
      });

      expect(select).toHaveBeenCalledTimes(3);
      expect(update).toHaveBeenCalledWith(schema.runs);
      expect(auditEventFor).toHaveBeenCalledWith({
        approval,
        run,
        targetState,
      });
      expect(operations).toEqual([
        "select-run",
        "select-validation",
        "select-pr-artifact",
        "update-run-state",
        "insert-approval",
        "insert-audit",
      ]);
    },
  );

  test("fails closed without approval or audit inserts when a raced state transition updates no rows", async () => {
    const { createDrizzleApprovalDecisionStore } = await importDecisions();
    const { schema } = await import("../db");
    const createdAt = new Date("2026-05-23T09:15:00.000Z");
    const approval: ApprovalDecisionInsert = {
      actorId: "user_1",
      contractVersion: CONTRACT_VERSION,
      createdAt,
      decision: "reject",
      id: "approval_1",
      reason: "Human review completed.",
      runId: "run_1",
      workspaceId: "workspace_1",
    };
    const limit = vi.fn(async () => [
      {
        id: "run_1",
        state: "awaiting_approval" as RunState,
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
    ]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    }));
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    }));
    const insert = vi.fn();
    const transaction = vi.fn(
      async (
        callback: (tx: {
          insert: typeof insert;
          select: typeof select;
          update: typeof update;
        }) => unknown,
      ) => callback({ insert, select, update }),
    );
    const store = createDrizzleApprovalDecisionStore({ transaction } as never);

    await expect(
      store.persistApprovalDecisionWithAudit({
        approval,
        auditEventFor: () => {
          throw new Error("Audit event should not be built after a stale transition.");
        },
        runId: "run_1",
        stateTransition: {
          expectedState: "awaiting_approval",
          targetState: "failed",
          transitionedAt: createdAt,
        },
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({ status: "stale_state" });

    expect(update).toHaveBeenCalledWith(schema.runs);
    expect(insert).not.toHaveBeenCalled();
  });

  test("fails closed without mutation when the current run state does not match the requested transition", async () => {
    const { createDrizzleApprovalDecisionStore } = await importDecisions();
    const createdAt = new Date("2026-05-23T09:15:00.000Z");
    const approval: ApprovalDecisionInsert = {
      actorId: "user_1",
      contractVersion: CONTRACT_VERSION,
      createdAt,
      decision: "approve",
      id: "approval_1",
      reason: "Human review completed.",
      runId: "run_1",
      workspaceId: "workspace_1",
    };
    const currentRun = {
      id: "run_1",
      state: "pr_opened" as RunState,
      taskId: "task_1",
      workspaceId: "workspace_1",
    };
    const limit = vi.fn(async () => [currentRun]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    }));
    const update = vi.fn();
    const insert = vi.fn();
    const transaction = vi.fn(
      async (
        callback: (tx: {
          insert: typeof insert;
          select: typeof select;
          update: typeof update;
        }) => unknown,
      ) => callback({ insert, select, update }),
    );
    const store = createDrizzleApprovalDecisionStore({ transaction } as never);

    await expect(
      store.persistApprovalDecisionWithAudit({
        approval,
        auditEventFor: () => {
          throw new Error("Audit event should not be built for invalid state.");
        },
        runId: "run_1",
        stateTransition: {
          expectedState: "awaiting_approval",
          targetState: "completed",
          transitionedAt: createdAt,
        },
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      state: "pr_opened",
      status: "invalid_state",
    });

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test("returns not_found without inserts when the scoped run is missing", async () => {
    const { createDrizzleApprovalDecisionStore } = await importDecisions();
    const limit = vi.fn(async () => []);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    }));
    const insert = vi.fn();
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; select: typeof select }) => unknown) =>
        callback({ insert, select }),
    );
    const store = createDrizzleApprovalDecisionStore({ transaction } as never);

    await expect(
      store.persistApprovalDecisionWithAudit({
        approval: {
          actorId: "user_1",
          contractVersion: CONTRACT_VERSION,
          createdAt: new Date("2026-05-23T09:15:00.000Z"),
          decision: "approve",
          id: "approval_1",
          reason: "Human review completed.",
          runId: "run_1",
          workspaceId: "workspace_1",
        },
        auditEventFor: () => {
          throw new Error("Audit event should not be built for missing runs.");
        },
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({ status: "not_found" });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
