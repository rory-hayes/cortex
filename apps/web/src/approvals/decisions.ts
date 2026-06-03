import "server-only";

import { randomUUID } from "node:crypto";

import { redactLogText } from "@control-plane/logging";
import {
  ApprovalDecisionSchema,
  ApprovalDecisionValueSchema,
  CONTRACT_VERSION,
  type ApprovalDecisionValue,
  type RunState,
} from "@control-plane/shared";

import { and, eq, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import {
  APPROVAL_REASON_MAX_LENGTH,
  RUN_ID_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH,
} from "./constants";

export {
  APPROVAL_REASON_MAX_LENGTH,
  RUN_ID_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH,
} from "./constants";

export type RecordApprovalDecisionInput = {
  decision: ApprovalDecisionValue;
  reason: string;
  requiredEvidence?: ApprovalDecisionRequiredEvidence;
  runId: string;
  stateTransition?: {
    expectedState: RunState;
    targetState: RunState;
  };
  workspaceId: string;
};

export type RecordApprovalDecisionData = {
  actorId: string;
  approvalDecisionId: string;
  createdAt: Date;
  decision: ApprovalDecisionValue;
  redactionApplied: boolean;
  runId: string;
  workspaceId: string;
};

export type ApprovalDecisionRunRow = {
  id: string;
  state: RunState;
  taskId: string;
  workspaceId: string;
};

export type ApprovalDecisionInsert = {
  actorId: string;
  contractVersion: typeof CONTRACT_VERSION;
  createdAt: Date;
  decision: ApprovalDecisionValue;
  id: string;
  reason: string;
  runId: string;
  workspaceId: string;
};

export type ApprovalDecisionAuditContext = {
  approval: ApprovalDecisionInsert;
  run: ApprovalDecisionRunRow;
  targetState?: RunState;
};

export type ApprovalDecisionStateTransition = {
  expectedState: RunState;
  targetState: RunState;
  transitionedAt: Date;
};

export type ApprovalDecisionRequiredEvidence = {
  changedPathMetadata: boolean;
  policyRiskEvidence: boolean;
  prMetadata: boolean;
  validationEvidence: boolean;
};

export type MissingApprovalDecisionEvidence =
  | "changed_path_metadata"
  | "policy_risk_evidence"
  | "pr_metadata"
  | "validation_evidence";

export type PersistApprovalDecisionWithAuditInput = {
  approval: ApprovalDecisionInsert;
  auditEventFor: (context: ApprovalDecisionAuditContext) => AuditEventInsert;
  requiredEvidence?: ApprovalDecisionRequiredEvidence;
  runId: string;
  stateTransition?: ApprovalDecisionStateTransition;
  workspaceId: string;
};

export type PersistApprovalDecisionWithAuditResult =
  | {
      approval: ApprovalDecisionInsert;
      run: ApprovalDecisionRunRow;
      status: "created";
    }
  | {
      status: "not_found";
    }
  | {
      state: RunState;
      status: "invalid_state";
    }
  | {
      status: "stale_state";
    }
  | {
      missingEvidence: MissingApprovalDecisionEvidence[];
      status: "missing_evidence";
    };

export type ApprovalDecisionStore = WorkspaceMembershipStore & {
  persistApprovalDecisionWithAudit: (
    input: PersistApprovalDecisionWithAuditInput,
  ) => Promise<PersistApprovalDecisionWithAuditResult>;
};

export type ApprovalDecisionService = {
  recordApprovalDecision: (
    input: RecordApprovalDecisionInput,
  ) => Promise<RecordApprovalDecisionData>;
};

const sourceLikeReasonPatterns = [
  /```[\s\S]*?```/,
  /\bdiff --git\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /^\s*(?:---|\+\+\+) [ab]\//m,
  /^\s*[+-]\s*(?:class|const|export|function|import|let|return|var)\b/m,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*interface\s+[A-Za-z_$][\w$]*(?:<[^>\n]+>)?(?:\s+extends\s+[A-Za-z_$][\w$.,\s<>]*)?\s*\{/m,
  /^\s*type\s+[A-Za-z_$][\w$]*(?:<[^>\n]+>)?\s*=\s*.+$/m,
  /\b(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/,
  /\b(?:try|else|finally)\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;?\s*$/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m,
  /^\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\([^{}\n;]*\))*\s*\([^;\n]*\{[^;\n]*\}[^;\n]*\)\s*;?\s*$/m,
  /^\s*[A-Za-z_$][\w$.]*\s*\([^;\n{}]*\)\s*;?\s*$/m,
  /^\s*[A-Za-z_$][\w$.[\]'"]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*[^;\n]+;\s*$/m,
  /^\s*(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b[\s\S]*;\s*$/im,
  /^\s*(?:FAIL|PASS)\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?(?:\s|$)/m,
  /^\s*(?:Test Files|Tests)\s+\d+\s+(?:failed|passed|skipped)/m,
  /^\s*(?:AssertionError|Error):\s+.+/m,
  /^\s*(?:git\s+(?:add|branch|checkout|clean|commit|diff|log|merge|pull|push|rebase|reset|show|status|switch|worktree)|(?:pnpm|npm|yarn)\s+(?:add|build|ci|exec|install|lint|run|test|typecheck)|(?:node|python3?|bash|sh|docker|kubectl)\s+\S+|rm\s+-[A-Za-z]+|curl\s+https?:\/\/|wget\s+https?:\/\/).*/im,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
] as const;

const residualSecretReasonPattern =
  /(?:-----BEGIN|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk_(?:live|test)_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}|(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s,;]{8,})/i;

const hasUnsafeReasonShape = (reason: string): boolean =>
  sourceLikeReasonPatterns.some((pattern) => pattern.test(reason));

const normalizeRequiredText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maxLength) {
    throw createActionError("validation_error");
  }

  return normalized;
};

const normalizeApprovalReason = (
  reason: unknown,
): {
  reason: string;
  redactionApplied: boolean;
} => {
  const normalizedReason = normalizeRequiredText(reason, APPROVAL_REASON_MAX_LENGTH);

  if (hasUnsafeReasonShape(normalizedReason)) {
    throw createActionError("validation_error");
  }

  const redacted = redactLogText(normalizedReason);
  const safeReason = normalizeRequiredText(redacted.text, APPROVAL_REASON_MAX_LENGTH);

  if (hasUnsafeReasonShape(safeReason) || residualSecretReasonPattern.test(safeReason)) {
    throw createActionError("validation_error");
  }

  return {
    reason: safeReason,
    redactionApplied: redacted.redactionApplied,
  };
};

const normalizeApprovalDecision = (decision: unknown): ApprovalDecisionValue => {
  const result = ApprovalDecisionValueSchema.safeParse(decision);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeRunId = (runId: unknown): string => normalizeRequiredText(runId, RUN_ID_MAX_LENGTH);

const normalizeWorkspaceId = (workspaceId: unknown): string =>
  normalizeRequiredText(workspaceId, WORKSPACE_ID_MAX_LENGTH);

const buildApprovalDecisionInsert = (input: {
  actorId: string;
  createdAt: Date;
  createId: () => string;
  decision: ApprovalDecisionValue;
  reason: string;
  runId: string;
  workspaceId: string;
}): ApprovalDecisionInsert => {
  const id = input.createId();
  const sharedDecision = {
    actorId: input.actorId,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt.toISOString(),
    decision: input.decision,
    id,
    reason: input.reason,
    runId: input.runId,
  };

  if (!ApprovalDecisionSchema.safeParse(sharedDecision).success) {
    throw createActionError("validation_error");
  }

  return {
    actorId: sharedDecision.actorId,
    contractVersion: sharedDecision.contractVersion,
    createdAt: input.createdAt,
    decision: sharedDecision.decision,
    id: sharedDecision.id,
    reason: sharedDecision.reason,
    runId: sharedDecision.runId,
    workspaceId: input.workspaceId,
  };
};

const hasChangedPathMetadata = (changedFilePaths: unknown): boolean =>
  Array.isArray(changedFilePaths) &&
  changedFilePaths.some(
    (pathValue) => typeof pathValue === "string" && pathValue.trim().length > 0,
  );

const hasRiskFindingMetadata = (riskFindings: unknown): boolean => Array.isArray(riskFindings);

export const createDrizzleApprovalDecisionStore = (db: Database): ApprovalDecisionStore => ({
  findWorkspaceMembership: async ({ userId, workspaceId }) => {
    const [membership] = await db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);

    return membership ?? null;
  },
  persistApprovalDecisionWithAudit: async ({
    approval,
    auditEventFor,
    requiredEvidence,
    runId,
    stateTransition,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [run] = await tx
        .select({
          id: schema.runs.id,
          mode: schema.runs.mode,
          state: schema.runs.state,
          taskId: schema.runs.taskId,
          workspaceId: schema.runs.workspaceId,
        })
        .from(schema.runs)
        .where(and(eq(schema.runs.id, runId), eq(schema.runs.workspaceId, workspaceId)))
        .limit(1);

      if (run === undefined) {
        return { status: "not_found" };
      }

      let resultRun = run;
      if (stateTransition !== undefined) {
        if (run.state !== stateTransition.expectedState) {
          return {
            state: run.state,
            status: "invalid_state" as const,
          };
        }

        if (requiredEvidence !== undefined) {
          const missingEvidence: MissingApprovalDecisionEvidence[] = [];
          let prArtifact:
            | {
                changedFilePaths: unknown;
                id: string;
                riskFindings: unknown;
              }
            | undefined;

          if (requiredEvidence.validationEvidence) {
            const validationRows = await tx
              .select({
                id: schema.validationResults.id,
              })
              .from(schema.validationResults)
              .where(
                and(
                  eq(schema.validationResults.runId, run.id),
                  eq(schema.validationResults.workspaceId, workspaceId),
                ),
              )
              .limit(1);

            if (validationRows.length === 0) {
              missingEvidence.push("validation_evidence");
            }
          }

          if (
            requiredEvidence.prMetadata ||
            requiredEvidence.changedPathMetadata ||
            (requiredEvidence.policyRiskEvidence && run.mode === "repair")
          ) {
            const [storedPrArtifact] = await tx
              .select({
                changedFilePaths: schema.prArtifacts.changedFilePaths,
                id: schema.prArtifacts.id,
                riskFindings: schema.prArtifacts.riskFindings,
              })
              .from(schema.prArtifacts)
              .where(
                and(
                  eq(schema.prArtifacts.runId, run.id),
                  eq(schema.prArtifacts.workspaceId, workspaceId),
                ),
              )
              .limit(1);

            prArtifact = storedPrArtifact;
          }

          if (requiredEvidence.prMetadata || requiredEvidence.changedPathMetadata) {
            if (prArtifact === undefined) {
              if (requiredEvidence.prMetadata) {
                missingEvidence.push("pr_metadata");
              }

              if (requiredEvidence.changedPathMetadata) {
                missingEvidence.push("changed_path_metadata");
              }
            } else if (
              requiredEvidence.changedPathMetadata &&
              !hasChangedPathMetadata(prArtifact.changedFilePaths)
            ) {
              missingEvidence.push("changed_path_metadata");
            }
          }

          if (requiredEvidence.policyRiskEvidence) {
            const hasRepairRiskMetadata =
              run.mode === "repair" &&
              prArtifact !== undefined &&
              hasRiskFindingMetadata(prArtifact.riskFindings);

            if (!hasRepairRiskMetadata) {
              const dryRunRows = await tx
                .select({
                  id: schema.dryRunResults.id,
                })
                .from(schema.dryRunResults)
                .where(
                  and(
                    eq(schema.dryRunResults.runId, run.id),
                    eq(schema.dryRunResults.workspaceId, workspaceId),
                  ),
                )
                .limit(1);

              if (dryRunRows.length === 0) {
                missingEvidence.push("policy_risk_evidence");
              }
            }
          }

          if (missingEvidence.length > 0) {
            return {
              missingEvidence,
              status: "missing_evidence" as const,
            };
          }
        }

        const [transitionedRun] = await tx
          .update(schema.runs)
          .set({
            finishedAt: stateTransition.transitionedAt,
            state: stateTransition.targetState,
            updatedAt: stateTransition.transitionedAt,
          })
          .where(
            and(
              eq(schema.runs.id, run.id),
              eq(schema.runs.workspaceId, run.workspaceId),
              eq(schema.runs.state, stateTransition.expectedState),
            ),
          )
          .returning({
            id: schema.runs.id,
            mode: schema.runs.mode,
            state: schema.runs.state,
            taskId: schema.runs.taskId,
            workspaceId: schema.runs.workspaceId,
          });

        if (transitionedRun === undefined) {
          return { status: "stale_state" as const };
        }

        if (transitionedRun.state !== stateTransition.targetState) {
          throw new Error("Run approval transition returned an unexpected state.");
        }

        resultRun = transitionedRun;
      }

      const [persistedApproval] = await tx.insert(schema.approvals).values(approval).returning();

      if (persistedApproval === undefined) {
        throw new Error("Approval decision insert did not return a row.");
      }

      if (persistedApproval.contractVersion !== CONTRACT_VERSION) {
        throw new Error("Approval decision insert returned an unexpected contract version.");
      }

      const approvalRow: ApprovalDecisionInsert = {
        actorId: persistedApproval.actorId,
        contractVersion: CONTRACT_VERSION,
        createdAt: persistedApproval.createdAt,
        decision: persistedApproval.decision,
        id: persistedApproval.id,
        reason: persistedApproval.reason,
        runId: persistedApproval.runId,
        workspaceId: persistedApproval.workspaceId,
      };

      await tx.insert(schema.auditEvents).values(
        auditEventFor({
          approval: approvalRow,
          run,
          ...(stateTransition === undefined
            ? {}
            : {
                targetState: stateTransition.targetState,
              }),
        }),
      );

      return {
        approval: approvalRow,
        run: resultRun,
        status: "created",
      };
    }),
});

export const createApprovalDecisionService = (input: {
  createApprovalDecisionId?: () => string;
  createAuditEventId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: ApprovalDecisionStore;
}): ApprovalDecisionService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    recordApprovalDecision: async ({
      decision,
      reason,
      requiredEvidence,
      runId,
      stateTransition,
      workspaceId,
    }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const normalizedRunId = normalizeRunId(runId);
      const normalizedDecision = normalizeApprovalDecision(decision);
      const normalizedReason = normalizeApprovalReason(reason);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const createdAt = input.now?.() ?? new Date();
      const approval = buildApprovalDecisionInsert({
        actorId: scope.actorId,
        createdAt,
        createId: input.createApprovalDecisionId ?? randomUUID,
        decision: normalizedDecision,
        reason: normalizedReason.reason,
        runId: normalizedRunId,
        workspaceId: scope.workspaceId,
      });
      const result = await input.store.persistApprovalDecisionWithAudit({
        approval,
        auditEventFor: ({ approval: persistedApproval, run, targetState }) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "run.approval_decision_recorded",
            message: "Approval decision recorded.",
            metadata: {
              approvalDecisionId: persistedApproval.id,
              decision: persistedApproval.decision,
              reasonLength: persistedApproval.reason.length,
              reasonRedactionApplied: normalizedReason.redactionApplied,
              runStateAtDecision: run.state,
              ...(targetState === undefined ? {} : { targetState }),
            },
            now: () => createdAt,
            runId: run.id,
            taskId: run.taskId,
            workspaceId: run.workspaceId,
          }),
        runId: normalizedRunId,
        ...(requiredEvidence === undefined ? {} : { requiredEvidence }),
        ...(stateTransition === undefined
          ? {}
          : {
              stateTransition: {
                ...stateTransition,
                transitionedAt: createdAt,
              },
            }),
        workspaceId: scope.workspaceId,
      });

      if (result.status === "not_found") {
        throw createActionError("forbidden");
      }

      if (result.status === "invalid_state" || result.status === "stale_state") {
        throw createActionError("validation_error");
      }

      if (result.status === "missing_evidence") {
        throw createActionError("validation_error");
      }

      return {
        actorId: result.approval.actorId,
        approvalDecisionId: result.approval.id,
        createdAt: result.approval.createdAt,
        decision: result.approval.decision,
        redactionApplied: normalizedReason.redactionApplied,
        runId: result.approval.runId,
        workspaceId: result.approval.workspaceId,
      };
    },
  };
};
