import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export const RUNNER_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

const RUNNER_PAIRING_CODE_BYTE_LENGTH = 24;

const normalizeNonEmpty = (value: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

export const generateRunnerPairingCode = (): string =>
  randomBytes(RUNNER_PAIRING_CODE_BYTE_LENGTH).toString("base64url");

export const hashRunnerPairingCode = (code: string): string =>
  createHash("sha256").update(code.trim()).digest("hex");

type RunnerPairingCodeRow = typeof schema.runnerPairingCodes.$inferSelect;

export type CreatedRunnerPairingCode = Pick<
  RunnerPairingCodeRow,
  "id" | "workspaceId" | "expiresAt"
>;

export type RunnerPairingCodeCreateRow = Pick<
  RunnerPairingCodeRow,
  | "createdAt"
  | "createdByActorId"
  | "credentialHash"
  | "expiresAt"
  | "id"
  | "updatedAt"
  | "usedAt"
  | "usedByRunnerId"
  | "workspaceId"
>;

export type RedeemedRunnerPairingCode = Pick<RunnerPairingCodeRow, "id" | "workspaceId">;

export type CreateRunnerPairingCodeWithAuditInput = {
  auditEvent: AuditEventInsert;
  pairingCode: RunnerPairingCodeCreateRow;
};

export type RedeemRunnerPairingCodeWithAuditInput = {
  auditEventFor: (row: RedeemedRunnerPairingCode) => AuditEventInsert;
  credentialHash: string;
  redeemedAt: Date;
  usedByRunnerId: string;
};

export type RunnerPairingStore = WorkspaceMembershipStore & {
  createRunnerPairingCodeWithAudit: (
    input: CreateRunnerPairingCodeWithAuditInput,
  ) => Promise<CreatedRunnerPairingCode>;
  redeemRunnerPairingCodeWithAudit: (
    input: RedeemRunnerPairingCodeWithAuditInput,
  ) => Promise<RedeemedRunnerPairingCode | null>;
};

export type CreateRunnerPairingCodeInput = {
  workspaceId: string;
};

export type CreatedRunnerPairingCodeResult = {
  code: string;
  expiresAt: Date;
  pairingId: string;
  ttlSeconds: number;
  workspaceId: string;
};

export type RedeemRunnerPairingCodeInput = {
  code: string;
  runnerId: string;
};

export type RedeemRunnerPairingCodeResult =
  | {
      pairingId: string;
      status: "redeemed";
      workspaceId: string;
    }
  | {
      status: "not_redeemable";
    };

export type RunnerPairingCodeService = {
  createRunnerPairingCode: (
    input: CreateRunnerPairingCodeInput,
  ) => Promise<CreatedRunnerPairingCodeResult>;
  redeemRunnerPairingCode: (
    input: RedeemRunnerPairingCodeInput,
  ) => Promise<RedeemRunnerPairingCodeResult>;
};

export const createDrizzleRunnerPairingStore = (db: Database): RunnerPairingStore => ({
  createRunnerPairingCodeWithAudit: async ({ auditEvent, pairingCode }) =>
    db.transaction(async (tx) => {
      const [createdPairingCode] = await tx
        .insert(schema.runnerPairingCodes)
        .values(pairingCode)
        .returning({
          expiresAt: schema.runnerPairingCodes.expiresAt,
          id: schema.runnerPairingCodes.id,
          workspaceId: schema.runnerPairingCodes.workspaceId,
        });

      if (createdPairingCode === undefined) {
        throw new Error("Runner pairing code creation did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return createdPairingCode;
    }),
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
  redeemRunnerPairingCodeWithAudit: async ({
    auditEventFor,
    credentialHash,
    redeemedAt,
    usedByRunnerId,
  }) =>
    db.transaction(async (tx) => {
      const [redeemedPairingCode] = await tx
        .update(schema.runnerPairingCodes)
        .set({
          updatedAt: redeemedAt,
          usedAt: redeemedAt,
          usedByRunnerId,
        })
        .where(
          and(
            eq(schema.runnerPairingCodes.credentialHash, credentialHash),
            isNull(schema.runnerPairingCodes.usedAt),
            gt(schema.runnerPairingCodes.expiresAt, redeemedAt),
          ),
        )
        .returning({
          id: schema.runnerPairingCodes.id,
          workspaceId: schema.runnerPairingCodes.workspaceId,
        });

      if (redeemedPairingCode === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEventFor(redeemedPairingCode));

      return redeemedPairingCode;
    }),
});

export const createRunnerPairingCodeService = (input: {
  createAuditEventId?: () => string;
  createPairingId?: () => string;
  generateCode?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RunnerPairingStore;
}): RunnerPairingCodeService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());
  const ttlSeconds = Math.floor(RUNNER_PAIRING_CODE_TTL_MS / 1000);

  return {
    createRunnerPairingCode: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeNonEmpty(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const createdAt = now();
      const code = input.generateCode?.() ?? generateRunnerPairingCode();
      const pairingId = input.createPairingId?.() ?? randomUUID();
      const expiresAt = new Date(createdAt.getTime() + RUNNER_PAIRING_CODE_TTL_MS);

      const pairingCode = await input.store.createRunnerPairingCodeWithAudit({
        auditEvent: createAuditEventInsert({
          actorId: scope.actorId,
          createId: input.createAuditEventId ?? randomUUID,
          eventType: "runner_pairing.created",
          message: "Runner pairing code created.",
          metadata: {
            expiresAt: expiresAt.toISOString(),
            pairingId,
            ttlSeconds,
          },
          now: () => createdAt,
          workspaceId: scope.workspaceId,
        }),
        pairingCode: {
          createdAt,
          createdByActorId: scope.actorId,
          credentialHash: hashRunnerPairingCode(code),
          expiresAt,
          id: pairingId,
          updatedAt: createdAt,
          usedAt: null,
          usedByRunnerId: null,
          workspaceId: scope.workspaceId,
        },
      });

      return {
        code,
        expiresAt: pairingCode.expiresAt,
        pairingId: pairingCode.id,
        ttlSeconds,
        workspaceId: pairingCode.workspaceId,
      };
    },
    redeemRunnerPairingCode: async ({ code, runnerId }) => {
      const normalizedCode = code.trim();
      const normalizedRunnerId = runnerId.trim();

      if (normalizedCode.length === 0 || normalizedRunnerId.length === 0) {
        return { status: "not_redeemable" };
      }

      const redeemedAt = now();
      const redeemedPairingCode = await input.store.redeemRunnerPairingCodeWithAudit({
        auditEventFor: (row) =>
          createAuditEventInsert({
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "runner_pairing.redeemed",
            message: "Runner pairing code redeemed.",
            metadata: {
              pairingId: row.id,
            },
            now: () => redeemedAt,
            runnerId: normalizedRunnerId,
            workspaceId: row.workspaceId,
          }),
        credentialHash: hashRunnerPairingCode(normalizedCode),
        redeemedAt,
        usedByRunnerId: normalizedRunnerId,
      });

      if (redeemedPairingCode === null) {
        return { status: "not_redeemable" };
      }

      return {
        pairingId: redeemedPairingCode.id,
        status: "redeemed",
        workspaceId: redeemedPairingCode.workspaceId,
      };
    },
  };
};
