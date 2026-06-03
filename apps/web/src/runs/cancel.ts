import "server-only";

import { randomUUID } from "node:crypto";

import { redactLogText } from "@control-plane/logging";
import { TERMINAL_RUN_STATES, isTerminalRunState, type RunState } from "@control-plane/shared";

import { and, eq, notInArray, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export const RUN_ID_MAX_LENGTH = 160;
export const WORKSPACE_ID_MAX_LENGTH = 160;
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export type CancelRunInput = {
  reason: string;
  runId: string;
  workspaceId: string;
};

export type CancelRunData = {
  cancellationRequestedAt: Date;
  cancellationRequestedByActorId: string;
  redactionApplied: boolean;
  runId: string;
  state: "cancel_requested";
  workspaceId: string;
};

export type CancelableRunRow = {
  id: string;
  state: RunState;
  taskId: string;
  workspaceId: string;
};

export type CancelledRunRow = CancelableRunRow & {
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  cancellationRequestedByActorId: string | null;
  state: "cancel_requested";
};

export type RequestRunCancellationWithAuditInput = {
  auditEventFor: (row: CancelableRunRow) => AuditEventInsert;
  reason: string;
  requestedAt: Date;
  requestedByActorId: string;
  runId: string;
  workspaceId: string;
};

export type RequestRunCancellationWithAuditResult =
  | {
      run: CancelledRunRow;
      status: "cancelled";
    }
  | {
      status: "not_found";
    }
  | {
      state: RunState;
      status: "terminal";
    };

export type CancelRunStore = WorkspaceMembershipStore & {
  requestRunCancellationWithAudit: (
    input: RequestRunCancellationWithAuditInput,
  ) => Promise<RequestRunCancellationWithAuditResult>;
};

export type CancelRunService = {
  cancelRun: (input: CancelRunInput) => Promise<CancelRunData>;
};

const sourceLikeReasonPatterns = [
  /```[\s\S]*?```/,
  /\bdiff --git\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /^\s*(?:---|\+\+\+) [ab]\//m,
  /^\s*[+-]\s*(?:class|const|export|function|import|let|return|var)\b/m,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /\b(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/,
  /\b(?:try|else|finally)\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;?\s*$/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m,
  /^\s*[A-Za-z_$][\w$.]*\s*\([^;\n{}]*\)\s*;?\s*$/m,
  /^\s*[A-Za-z_$][\w$.[\]'"]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*[^;\n]+;\s*$/m,
  /^\s*(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b[\s\S]*;\s*$/im,
  /^\s*(?:git\s+(?:add|branch|checkout|clean|commit|diff|log|merge|pull|push|rebase|reset|show|status|switch|worktree)|(?:pnpm|npm|yarn)\s+(?:add|build|ci|exec|install|lint|run|test|typecheck)|(?:node|python3?|bash|sh|docker|kubectl)\s+\S+|rm\s+-[A-Za-z]+|curl\s+https?:\/\/|wget\s+https?:\/\/).*/im,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
] as const;

const residualSecretReasonPattern =
  /(?:-----BEGIN|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk_(?:live|test)_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}|(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s,;]{8,})/i;

const terminalRunStatesForSql: RunState[] = [...TERMINAL_RUN_STATES];

const hasUnsafeReasonShape = (reason: string): boolean =>
  sourceLikeReasonPatterns.some((pattern) => pattern.test(reason));

const normalizeRequiredText = (value: string, maxLength: number): string => {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maxLength) {
    throw createActionError("validation_error");
  }

  return normalized;
};

const normalizeCancellationReason = (
  reason: string,
): {
  reason: string;
  redactionApplied: boolean;
} => {
  const normalizedReason = normalizeRequiredText(reason, CANCELLATION_REASON_MAX_LENGTH);

  if (hasUnsafeReasonShape(normalizedReason)) {
    throw createActionError("validation_error");
  }

  const redacted = redactLogText(normalizedReason);
  const safeReason = normalizeRequiredText(redacted.text, CANCELLATION_REASON_MAX_LENGTH);

  if (hasUnsafeReasonShape(safeReason) || residualSecretReasonPattern.test(safeReason)) {
    throw createActionError("validation_error");
  }

  return {
    reason: safeReason,
    redactionApplied: redacted.redactionApplied,
  };
};

const normalizeRunId = (runId: string): string => normalizeRequiredText(runId, RUN_ID_MAX_LENGTH);

const normalizeWorkspaceId = (workspaceId: string): string =>
  normalizeRequiredText(workspaceId, WORKSPACE_ID_MAX_LENGTH);

export const createDrizzleCancelRunStore = (db: Database): CancelRunStore => ({
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
  requestRunCancellationWithAudit: async ({
    auditEventFor,
    reason,
    requestedAt,
    requestedByActorId,
    runId,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [run] = await tx
        .select({
          id: schema.runs.id,
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

      if (isTerminalRunState(run.state)) {
        return {
          state: run.state,
          status: "terminal",
        };
      }

      const [cancelledRun] = await tx
        .update(schema.runs)
        .set({
          cancellationReason: reason,
          cancellationRequestedAt: requestedAt,
          cancellationRequestedByActorId: requestedByActorId,
          state: "cancel_requested",
          updatedAt: requestedAt,
        })
        .where(
          and(
            eq(schema.runs.id, run.id),
            eq(schema.runs.workspaceId, run.workspaceId),
            notInArray(schema.runs.state, terminalRunStatesForSql),
          ),
        )
        .returning({
          cancellationReason: schema.runs.cancellationReason,
          cancellationRequestedAt: schema.runs.cancellationRequestedAt,
          cancellationRequestedByActorId: schema.runs.cancellationRequestedByActorId,
          id: schema.runs.id,
          state: schema.runs.state,
          taskId: schema.runs.taskId,
          workspaceId: schema.runs.workspaceId,
        });

      if (cancelledRun === undefined) {
        const [currentRun] = await tx
          .select({
            id: schema.runs.id,
            state: schema.runs.state,
            taskId: schema.runs.taskId,
            workspaceId: schema.runs.workspaceId,
          })
          .from(schema.runs)
          .where(and(eq(schema.runs.id, run.id), eq(schema.runs.workspaceId, run.workspaceId)))
          .limit(1);

        if (currentRun === undefined) {
          return { status: "not_found" };
        }

        if (isTerminalRunState(currentRun.state)) {
          return {
            state: currentRun.state,
            status: "terminal",
          };
        }

        throw new Error("Run cancellation update did not return the cancelled run row.");
      }

      if (cancelledRun.state !== "cancel_requested") {
        throw new Error("Run cancellation update did not return the cancelled run row.");
      }

      await tx.insert(schema.auditEvents).values(auditEventFor(run));

      return {
        run: {
          ...cancelledRun,
          state: "cancel_requested",
        },
        status: "cancelled",
      };
    }),
});

export const createCancelRunService = (input: {
  createAuditEventId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: CancelRunStore;
}): CancelRunService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    cancelRun: async ({ reason, runId, workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const normalizedRunId = normalizeRunId(runId);
      const normalizedReason = normalizeCancellationReason(reason);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const requestedAt = input.now?.() ?? new Date();
      const result = await input.store.requestRunCancellationWithAudit({
        auditEventFor: (run) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "run.cancel_requested",
            message: "Run cancellation requested.",
            metadata: {
              reasonLength: normalizedReason.reason.length,
              reasonRedactionApplied: normalizedReason.redactionApplied,
              targetState: "cancel_requested",
            },
            now: () => requestedAt,
            runId: run.id,
            taskId: run.taskId,
            workspaceId: run.workspaceId,
          }),
        reason: normalizedReason.reason,
        requestedAt,
        requestedByActorId: scope.actorId,
        runId: normalizedRunId,
        workspaceId: scope.workspaceId,
      });

      if (result.status === "not_found") {
        throw createActionError("forbidden");
      }

      if (result.status === "terminal") {
        throw createActionError("validation_error");
      }

      return {
        cancellationRequestedAt: result.run.cancellationRequestedAt ?? requestedAt,
        cancellationRequestedByActorId:
          result.run.cancellationRequestedByActorId ?? scope.actorId,
        redactionApplied: normalizedReason.redactionApplied,
        runId: result.run.id,
        state: "cancel_requested",
        workspaceId: result.run.workspaceId,
      };
    },
  };
};
