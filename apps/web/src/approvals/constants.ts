import type { ApprovalDecisionValue, RunState } from "@control-plane/shared";

export const APPROVAL_REASON_MAX_LENGTH = 1_000;
export const RUN_ID_MAX_LENGTH = 160;
export const WORKSPACE_ID_MAX_LENGTH = 160;

export const APPROVAL_ACTION_DECISIONS = ["approve", "reject"] as const satisfies readonly Extract<
  ApprovalDecisionValue,
  "approve" | "reject"
>[];

export type ApprovalActionDecision = (typeof APPROVAL_ACTION_DECISIONS)[number];

export const APPROVAL_ACTION_TARGET_STATES = {
  approve: "completed",
  reject: "failed",
} as const satisfies Record<ApprovalActionDecision, RunState>;

export const APPROVAL_ACTION_REQUIRED_STATE = "awaiting_approval" as const satisfies RunState;
