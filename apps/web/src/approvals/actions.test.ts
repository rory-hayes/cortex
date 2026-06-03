import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type RunState } from "@control-plane/shared";

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

const importActions = async () => import("./actions");

type TestRun = ApprovalDecisionRunRow;

type TestApprovalEvidence = {
  hasChangedPathMetadata: boolean;
  hasPolicyRiskEvidence: boolean;
  hasPrMetadata: boolean;
  hasValidationEvidence: boolean;
};

type TestRunWithEvidence = TestRun & {
  evidence: TestApprovalEvidence;
};

const createRun = (overrides: Partial<TestRunWithEvidence> = {}): TestRunWithEvidence => {
  const { evidence: evidenceOverride, ...runOverrides } = overrides;

  return {
    evidence: {
      hasChangedPathMetadata: true,
      hasPolicyRiskEvidence: true,
      hasPrMetadata: true,
      hasValidationEvidence: true,
      ...evidenceOverride,
    },
    id: "run_1",
    state: "awaiting_approval",
    taskId: "task_1",
    workspaceId: "workspace_1",
    ...runOverrides,
  };
};

const createApprovalEvidence = (
  overrides: Partial<TestApprovalEvidence> = {},
): TestApprovalEvidence => ({
  hasChangedPathMetadata: true,
  hasPolicyRiskEvidence: true,
  hasPrMetadata: true,
  hasValidationEvidence: true,
  ...overrides,
});

const createStore = (input: {
  memberships?: Array<{ userId: string; workspaceId: string }>;
  runs?: TestRunWithEvidence[];
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
        stateTransition,
        workspaceId,
        ...request
      }: PersistApprovalDecisionWithAuditInput): Promise<PersistApprovalDecisionWithAuditResult> => {
        const run = runs.find(
          (candidate) => candidate.id === runId && candidate.workspaceId === workspaceId,
        );

        if (run === undefined) {
          return { status: "not_found" };
        }

        if (stateTransition !== undefined) {
          if (run.state !== stateTransition.expectedState) {
            return {
              state: run.state,
              status: "invalid_state" as const,
            };
          }

          if (
            (request as { requiredEvidence?: unknown }).requiredEvidence !== undefined &&
            (!run.evidence.hasValidationEvidence ||
              !run.evidence.hasPrMetadata ||
              !run.evidence.hasChangedPathMetadata ||
              !run.evidence.hasPolicyRiskEvidence)
          ) {
            return {
              status: "missing_evidence",
            } as unknown as PersistApprovalDecisionWithAuditResult;
          }

          approvals.push(approval);
          auditEvents.push(
            auditEventFor({
              approval,
              run: { ...run },
              targetState: stateTransition.targetState,
            }),
          );
          run.state = stateTransition.targetState;

          return {
            approval,
            run,
            status: "created" as const,
          };
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

describe("approval action service", () => {
  test("workspace member can approve an awaiting approval run and complete it", async () => {
    const { createApprovalActionService } = await importActions();
    const createdAt = new Date("2026-05-24T09:15:00.000Z");
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalActionService({
      createApprovalDecisionId: () => "approval_approve_1",
      createAuditEventId: () => "audit_approve_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.approveRun({
        reason: "  Approved after metadata review.  ",
        runId: " run_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      actorId: "user_1",
      approvalDecisionId: "approval_approve_1",
      createdAt,
      decision: "approve",
      redactionApplied: false,
      runId: "run_1",
      state: "completed",
      workspaceId: "workspace_1",
    });

    expect(store.runs[0]?.state).toBe("completed");
    expect(store.approvals).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        contractVersion: CONTRACT_VERSION,
        decision: "approve",
        id: "approval_approve_1",
        reason: "Approved after metadata review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.persistApprovalDecisionWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        stateTransition: {
          expectedState: "awaiting_approval",
          targetState: "completed",
          transitionedAt: createdAt,
        },
      }),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "run.approval_decision_recorded",
        id: "audit_approve_1",
        message: "Approval decision recorded.",
        metadata: {
          approvalDecisionId: "approval_approve_1",
          decision: "approve",
          reasonLength: 31,
          reasonRedactionApplied: false,
          runStateAtDecision: "awaiting_approval",
          targetState: "completed",
        },
        runId: "run_1",
        taskId: "task_1",
        workspaceId: "workspace_1",
      }),
    ]);

    const auditPayload = JSON.stringify(store.auditEvents);
    expect(auditPayload).not.toContain("Approved after metadata review");
    expect(auditPayload).not.toMatch(/diff|patch|rawOutput|sourceCode|secret/i);
  });

  test("workspace member can reject an awaiting approval run and fail it", async () => {
    const { createApprovalActionService } = await importActions();
    const createdAt = new Date("2026-05-24T09:20:00.000Z");
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalActionService({
      createApprovalDecisionId: () => "approval_reject_1",
      createAuditEventId: () => "audit_reject_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => createdAt,
      store,
    });

    await expect(
      service.rejectRun({
        reason: "Reject because acceptance evidence is incomplete.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      approvalDecisionId: "approval_reject_1",
      decision: "reject",
      runId: "run_1",
      state: "failed",
      workspaceId: "workspace_1",
    });

    expect(store.runs[0]?.state).toBe("failed");
    expect(store.approvals[0]).toMatchObject({
      decision: "reject",
      id: "approval_reject_1",
      reason: "Reject because acceptance evidence is incomplete.",
    });
    expect(store.auditEvents[0]?.metadata).toEqual({
      approvalDecisionId: "approval_reject_1",
      decision: "reject",
      reasonLength: 49,
      reasonRedactionApplied: false,
      runStateAtDecision: "awaiting_approval",
      targetState: "failed",
    });
  });

  test.each([
    ["validation evidence", { hasValidationEvidence: false }],
    ["PR metadata", { hasPrMetadata: false }],
    ["changed path metadata", { hasChangedPathMetadata: false }],
    ["policy and risk evidence", { hasPolicyRiskEvidence: false }],
  ] as const)("blocks approval when %s is missing", async (_label, evidenceOverride) => {
    const { createApprovalActionService } = await importActions();
    const run = createRun({
      evidence: createApprovalEvidence(evidenceOverride),
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [run],
    });
    const service = createApprovalActionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.approveRun({
        reason: "Approved after metadata review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(run.state).toBe("awaiting_approval");
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("blocks rejection when review evidence is incomplete", async () => {
    const { createApprovalActionService } = await importActions();
    const run = createRun({
      evidence: createApprovalEvidence({
        hasChangedPathMetadata: false,
      }),
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [run],
    });
    const service = createApprovalActionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.rejectRun({
        reason: "Reject after human metadata review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(run.state).toBe("awaiting_approval");
    expect(store.approvals).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test.each(["queued", "pr_opened", "completed", "failed", "blocked"] as const)(
    "rejects %s runs without mutation",
    async (state: RunState) => {
      const { createApprovalActionService } = await importActions();
      const run = createRun({ state });
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        runs: [run],
      });
      const service = createApprovalActionService({
        getAuthContext: async () => ({ userId: "user_1" }),
        store,
      });

      await expect(
        service.approveRun({
          reason: "Approved after metadata review.",
          runId: "run_1",
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });

      expect(run.state).toBe(state);
      expect(store.approvals).toEqual([]);
      expect(store.auditEvents).toEqual([]);
    },
  );

  test("rejects unauthenticated users before reading or mutating runs", async () => {
    const { createApprovalActionService } = await importActions();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createApprovalActionService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.rejectRun({
        reason: "Reject after human review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.persistApprovalDecisionWithAudit).not.toHaveBeenCalled();
  });
});
