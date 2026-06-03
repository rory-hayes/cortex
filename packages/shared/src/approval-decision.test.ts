import { describe, expect, it } from "vitest";
import type {
  ApprovalDecision as SharedApprovalDecision,
  ApprovalDecisionValue as SharedApprovalDecisionValue,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const DOCUMENTED_APPROVAL_DECISIONS = [
  "approve",
  "reject",
  "request_repair",
  "rerun_validation",
  "cancel_run",
  "close_run",
] as const;

type ApprovalDecisionValue = (typeof DOCUMENTED_APPROVAL_DECISIONS)[number];

type ApprovalDecision = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  runId: string;
  actorId: string;
  decision: ApprovalDecisionValue;
  reason: string;
  createdAt: string;
};

type ApprovalDecisionModule = {
  APPROVAL_DECISIONS: readonly ApprovalDecisionValue[];
  ApprovalDecisionValueSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  ApprovalDecisionSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadApprovalDecisionModule = async () =>
  (await import("./approval-decision.js")) as ApprovalDecisionModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<ApprovalDecisionModule>;

const validApprovalDecision = (overrides: Partial<ApprovalDecision> = {}): ApprovalDecision => ({
  contractVersion: CONTRACT_VERSION,
  id: "approval-decision-1",
  runId: "run-1",
  actorId: "user-1",
  decision: "approve",
  reason: "Validation passed and the PR is ready for human review.",
  createdAt: "2026-05-14T20:20:21.667Z",
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  decision: SharedApprovalDecision;
  value: SharedApprovalDecisionValue;
}) => value;

describe("ApprovalDecision", () => {
  it("exports the documented decision values in canonical order", async () => {
    const { APPROVAL_DECISIONS, ApprovalDecisionValueSchema } = await loadApprovalDecisionModule();

    expect(APPROVAL_DECISIONS).toEqual(DOCUMENTED_APPROVAL_DECISIONS);
    for (const decision of DOCUMENTED_APPROVAL_DECISIONS) {
      expect(ApprovalDecisionValueSchema.safeParse(decision).success).toBe(true);
    }
  });

  it("validates every documented decision", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();

    for (const decision of DOCUMENTED_APPROVAL_DECISIONS) {
      expect(ApprovalDecisionSchema.safeParse(validApprovalDecision({ decision })).success).toBe(
        true,
      );
    }
  });

  it("rejects unknown decisions", async () => {
    const { ApprovalDecisionSchema, ApprovalDecisionValueSchema } =
      await loadApprovalDecisionModule();
    const unknownDecision = "defer" as ApprovalDecisionValue;

    expect(ApprovalDecisionValueSchema.safeParse(unknownDecision).success).toBe(false);
    expect(
      ApprovalDecisionSchema.safeParse(validApprovalDecision({ decision: unknownDecision }))
        .success,
    ).toBe(false);
  });

  it("rejects missing or wrong contract versions", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();
    const decisionWithoutContractVersion: Record<string, unknown> = {
      ...validApprovalDecision(),
    };
    delete decisionWithoutContractVersion.contractVersion;

    expect(ApprovalDecisionSchema.safeParse(decisionWithoutContractVersion).success).toBe(false);
    expect(
      ApprovalDecisionSchema.safeParse(
        validApprovalDecision({
          contractVersion: "2026-05-10.v0" as typeof CONTRACT_VERSION,
        }),
      ).success,
    ).toBe(false);
  });

  it("requires a reason", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();
    const decisionWithoutReason: Record<string, unknown> = { ...validApprovalDecision() };
    delete decisionWithoutReason.reason;

    expect(ApprovalDecisionSchema.safeParse(decisionWithoutReason).success).toBe(false);
  });

  it("rejects empty reasons", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();

    expect(ApprovalDecisionSchema.safeParse(validApprovalDecision({ reason: "" })).success).toBe(
      false,
    );
  });

  it("rejects missing required identifiers and timestamps", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();

    for (const key of [
      "id",
      "actorId",
      "runId",
      "createdAt",
    ] satisfies (keyof ApprovalDecision)[]) {
      const decisionWithoutRequiredField: Record<string, unknown> = {
        ...validApprovalDecision(),
      };
      delete decisionWithoutRequiredField[key];

      expect(ApprovalDecisionSchema.safeParse(decisionWithoutRequiredField).success).toBe(false);
    }
  });

  it("rejects empty required identifiers and timestamps", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();

    for (const key of [
      "id",
      "actorId",
      "runId",
      "createdAt",
    ] satisfies (keyof ApprovalDecision)[]) {
      expect(ApprovalDecisionSchema.safeParse(validApprovalDecision({ [key]: "" })).success).toBe(
        false,
      );
    }
  });

  it("rejects unknown top-level fields", async () => {
    const { ApprovalDecisionSchema } = await loadApprovalDecisionModule();

    expect(
      ApprovalDecisionSchema.safeParse({
        ...validApprovalDecision(),
        diff: "not allowed",
      }).success,
    ).toBe(false);
  });

  it("exports approval decision schemas, constants, and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();
    const decision: SharedApprovalDecision = validApprovalDecision();
    const value: SharedApprovalDecisionValue = "request_repair";

    expect(shared.APPROVAL_DECISIONS).toEqual(DOCUMENTED_APPROVAL_DECISIONS);
    expect(shared.ApprovalDecisionValueSchema?.safeParse(value).success).toBe(true);
    expect(shared.ApprovalDecisionSchema?.safeParse(decision).success).toBe(true);

    assertEntrypointTypeExports({
      decision,
      value,
    });
  });
});
