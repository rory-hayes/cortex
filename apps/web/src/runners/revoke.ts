import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export const RUNNER_ID_MAX_LENGTH = 160;
export const WORKSPACE_ID_MAX_LENGTH = 160;

export type RevokeRunnerInput = {
  runnerId: string;
  workspaceId: string;
};

export type RevokeRunnerData = {
  revokedAt: Date;
  runnerId: string;
  status: "revoked";
  workspaceId: string;
};

export type RevokeRunnerRow = {
  id: string;
  revokedAt: Date;
  workspaceId: string;
};

export type RevokeRunnerWithAuditInput = {
  auditEventFor: (row: RevokeRunnerRow) => AuditEventInsert;
  revokedAt: Date;
  runnerId: string;
  workspaceId: string;
};

export type RevokeRunnerWithAuditResult =
  | {
      runner: RevokeRunnerRow;
      status: "already_revoked" | "revoked";
    }
  | {
      status: "not_found";
    };

export type RunnerRevokeStore = WorkspaceMembershipStore & {
  revokeRunnerWithAudit: (
    input: RevokeRunnerWithAuditInput,
  ) => Promise<RevokeRunnerWithAuditResult>;
};

export type RunnerRevokeService = {
  revokeRunner: (input: RevokeRunnerInput) => Promise<RevokeRunnerData>;
};

const normalizeRequiredText = (value: string, maxLength: number): string => {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maxLength) {
    throw createActionError("validation_error");
  }

  return normalized;
};

const normalizeRunnerId = (runnerId: string): string =>
  normalizeRequiredText(runnerId, RUNNER_ID_MAX_LENGTH);

const normalizeWorkspaceId = (workspaceId: string): string =>
  normalizeRequiredText(workspaceId, WORKSPACE_ID_MAX_LENGTH);

const assertOwnerRole = (role: string) => {
  if (role !== "owner") {
    throw createActionError("forbidden");
  }
};

const toRevokeRunnerData = (runner: RevokeRunnerRow): RevokeRunnerData => ({
  revokedAt: runner.revokedAt,
  runnerId: runner.id,
  status: "revoked",
  workspaceId: runner.workspaceId,
});

export const createDrizzleRunnerRevokeStore = (db: Database): RunnerRevokeStore => ({
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
  revokeRunnerWithAudit: async ({ auditEventFor, revokedAt, runnerId, workspaceId }) =>
    db.transaction(async (tx) => {
      const [runner] = await tx
        .select({
          id: schema.runners.id,
          revokedAt: schema.runners.revokedAt,
          workspaceId: schema.runners.workspaceId,
        })
        .from(schema.runners)
        .where(and(eq(schema.runners.id, runnerId), eq(schema.runners.workspaceId, workspaceId)))
        .limit(1);

      if (runner === undefined) {
        return { status: "not_found" };
      }

      if (runner.revokedAt !== null) {
        return {
          runner: {
            id: runner.id,
            revokedAt: runner.revokedAt,
            workspaceId: runner.workspaceId,
          },
          status: "already_revoked",
        };
      }

      const [revokedRunner] = await tx
        .update(schema.runners)
        .set({
          revokedAt,
          status: "offline",
          updatedAt: revokedAt,
        })
        .where(
          and(
            eq(schema.runners.id, runner.id),
            eq(schema.runners.workspaceId, runner.workspaceId),
            isNull(schema.runners.revokedAt),
          ),
        )
        .returning({
          id: schema.runners.id,
          revokedAt: schema.runners.revokedAt,
          workspaceId: schema.runners.workspaceId,
        });

      if (revokedRunner === undefined) {
        const [currentRunner] = await tx
          .select({
            id: schema.runners.id,
            revokedAt: schema.runners.revokedAt,
            workspaceId: schema.runners.workspaceId,
          })
          .from(schema.runners)
          .where(and(eq(schema.runners.id, runner.id), eq(schema.runners.workspaceId, workspaceId)))
          .limit(1);

        if (currentRunner === undefined) {
          return { status: "not_found" };
        }

        if (currentRunner.revokedAt !== null) {
          return {
            runner: {
              id: currentRunner.id,
              revokedAt: currentRunner.revokedAt,
              workspaceId: currentRunner.workspaceId,
            },
            status: "already_revoked",
          };
        }

        throw new Error("Runner revocation update did not return the revoked runner row.");
      }

      if (revokedRunner.revokedAt === null) {
        throw new Error("Runner revocation update returned an unrevoked runner row.");
      }

      const revokedRow = {
        id: revokedRunner.id,
        revokedAt: revokedRunner.revokedAt,
        workspaceId: revokedRunner.workspaceId,
      };

      await tx.insert(schema.auditEvents).values(auditEventFor(revokedRow));

      return {
        runner: revokedRow,
        status: "revoked",
      };
    }),
});

export const createRunnerRevokeService = (input: {
  createAuditEventId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RunnerRevokeStore;
}): RunnerRevokeService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    revokeRunner: async ({ runnerId, workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const normalizedRunnerId = normalizeRunnerId(runnerId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });

      assertOwnerRole(scope.membership.role);

      const revokedAt = input.now?.() ?? new Date();
      const result = await input.store.revokeRunnerWithAudit({
        auditEventFor: (runner) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "runner.revoked",
            message: "Runner revoked.",
            metadata: {
              revokedAt: runner.revokedAt.toISOString(),
              runnerId: runner.id,
            },
            now: () => revokedAt,
            runnerId: runner.id,
            workspaceId: runner.workspaceId,
          }),
        revokedAt,
        runnerId: normalizedRunnerId,
        workspaceId: scope.workspaceId,
      });

      if (result.status === "not_found") {
        throw createActionError("forbidden");
      }

      return toRevokeRunnerData(result.runner);
    },
  };
};
