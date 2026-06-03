import "server-only";

import { randomUUID } from "node:crypto";

import type { RunState } from "@control-plane/shared";

import {
  APPROVAL_ACTION_REQUIRED_STATE,
  APPROVAL_ACTION_TARGET_STATES,
  type ApprovalActionDecision,
} from "./constants";
import {
  createApprovalDecisionService,
  type ApprovalDecisionRequiredEvidence,
  type ApprovalDecisionStore,
  type RecordApprovalDecisionData,
  type RecordApprovalDecisionInput,
} from "./decisions";
import { getCurrentAuthContext, type GetAuthContext } from "../server/auth";

export type ApprovalActionInput = {
  reason: string;
  runId: string;
  workspaceId: string;
};

export type ApprovalActionData = Omit<RecordApprovalDecisionData, "decision"> & {
  decision: ApprovalActionDecision;
  state: Extract<RunState, "completed" | "failed">;
};

export type ApprovalActionService = {
  approveRun: (input: ApprovalActionInput) => Promise<ApprovalActionData>;
  rejectRun: (input: ApprovalActionInput) => Promise<ApprovalActionData>;
};

const approvalActionRequiredEvidence = {
  changedPathMetadata: true,
  policyRiskEvidence: true,
  prMetadata: true,
  validationEvidence: true,
} as const satisfies ApprovalDecisionRequiredEvidence;

const toApprovalActionData = (
  decision: ApprovalActionDecision,
  data: RecordApprovalDecisionData,
): ApprovalActionData => ({
  actorId: data.actorId,
  approvalDecisionId: data.approvalDecisionId,
  createdAt: data.createdAt,
  decision,
  redactionApplied: data.redactionApplied,
  runId: data.runId,
  state: APPROVAL_ACTION_TARGET_STATES[decision],
  workspaceId: data.workspaceId,
});

export const createApprovalActionService = (input: {
  createApprovalDecisionId?: () => string;
  createAuditEventId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: ApprovalDecisionStore;
}): ApprovalActionService => {
  const decisionService = createApprovalDecisionService({
    createApprovalDecisionId: input.createApprovalDecisionId ?? randomUUID,
    createAuditEventId: input.createAuditEventId ?? randomUUID,
    getAuthContext: input.getAuthContext ?? getCurrentAuthContext,
    ...(input.now === undefined ? {} : { now: input.now }),
    store: input.store,
  });

  const recordActionDecision = async (
    decision: ApprovalActionDecision,
    request: ApprovalActionInput,
  ) => {
    const data = await decisionService.recordApprovalDecision({
      decision,
      reason: request.reason,
      requiredEvidence: approvalActionRequiredEvidence,
      runId: request.runId,
      stateTransition: {
        expectedState: APPROVAL_ACTION_REQUIRED_STATE,
        targetState: APPROVAL_ACTION_TARGET_STATES[decision],
      },
      workspaceId: request.workspaceId,
    } satisfies RecordApprovalDecisionInput);

    return toApprovalActionData(decision, data);
  };

  return {
    approveRun: (request) => recordActionDecision("approve", request),
    rejectRun: (request) => recordActionDecision("reject", request),
  };
};
