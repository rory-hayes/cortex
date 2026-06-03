import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  CONTRACT_VERSION,
  LinkRunnerResponseSchema,
  RunnerCapabilitiesSchema,
  type LinkRunnerResponse,
  type RunnerCapabilities,
} from "@control-plane/shared";

import { and, eq, getDatabase, gt, isNull, schema, type Database } from "./db";
import { createAuditEventInsert, type AuditEventInsert } from "./server/audit";

export const RUNNER_LINK_POLL_INTERVAL_SECONDS = 15;

const RUNNER_CREDENTIAL_BYTE_LENGTH = 32;

const hashTrimmedSecret = (value: string): string =>
  createHash("sha256").update(value.trim()).digest("hex");

const normalizeGeneratedSecret = (value: string, label: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${label} must not be blank.`);
  }

  return normalizedValue;
};

export const generateRunnerCredential = (): string =>
  randomBytes(RUNNER_CREDENTIAL_BYTE_LENGTH).toString("base64url");

export const hashRunnerCredential = (credential: string): string => hashTrimmedSecret(credential);

type RunnerStatus = "idle" | "busy" | "offline";

export type LinkableRunnerPairingCode = {
  pairingId: string;
  workspaceId: string;
};

export type LinkedRunnerRecord = LinkableRunnerPairingCode & {
  linkedAt: Date;
  runnerId: string;
};

export type RunnerLinkCreateRow = {
  capabilities: RunnerCapabilities;
  createdAt: Date;
  credentialHash: string;
  displayName: string;
  id: string;
  lastHeartbeatAt: Date | null;
  linkedAt: Date;
  status: RunnerStatus;
  updatedAt: Date;
  workspaceId: string;
};

export type LinkRunnerWithPairingCodeInput = {
  createAuditEvent: (row: LinkedRunnerRecord) => AuditEventInsert;
  createRunnerRow: (row: LinkableRunnerPairingCode) => RunnerLinkCreateRow;
  linkedAt: Date;
  pairingCodeHash: string;
};

export type RunnerLinkStore = {
  linkRunnerWithPairingCode: (
    input: LinkRunnerWithPairingCodeInput,
  ) => Promise<LinkedRunnerRecord | null>;
};

export type LinkRunnerInput = {
  capabilities: RunnerCapabilities;
  pairingCode: string;
  pollingBaseUrl: string;
};

export type LinkRunnerResult =
  | {
      response: LinkRunnerResponse;
      status: "linked";
    }
  | {
      response?: never;
      status: "invalid_pairing_code";
    };

export type RunnerLinkService = {
  linkRunner: (input: LinkRunnerInput) => Promise<LinkRunnerResult>;
};

export type AuthenticatedRunnerContext = {
  runnerId: string;
  workspaceId: string;
};

export type RunnerAuthenticationRecord = {
  credentialHash: string;
  id: string;
  revokedAt: Date | null;
  workspaceId: string;
};

export type RunnerAuthenticationStore = {
  findRunnerAuthRecord: (input: { runnerId: string }) => Promise<RunnerAuthenticationRecord | null>;
  insertRunnerAuthFailureAudit: (event: AuditEventInsert) => Promise<void>;
};

export type RunnerAuthenticationService = {
  authenticateRunnerRequest: (request: Request) => Promise<AuthenticatedRunnerContext>;
};

type RunnerAuthenticationFailureReason = "malformed" | "mismatch" | "revoked";

export class RunnerAuthenticationError extends Error {
  readonly code = "invalid_runner_auth" as const;

  constructor() {
    super("Invalid runner credentials.");
    this.name = "RunnerAuthenticationError";
  }
}

export const isRunnerAuthenticationError = (error: unknown): error is RunnerAuthenticationError =>
  error instanceof RunnerAuthenticationError;

export const createDrizzleRunnerLinkStore = (db: Database): RunnerLinkStore => ({
  linkRunnerWithPairingCode: async (input) =>
    db.transaction(async (tx) => {
      const [pairingCode] = await tx
        .update(schema.runnerPairingCodes)
        .set({
          updatedAt: input.linkedAt,
          usedAt: input.linkedAt,
        })
        .where(
          and(
            eq(schema.runnerPairingCodes.credentialHash, input.pairingCodeHash),
            isNull(schema.runnerPairingCodes.usedAt),
            gt(schema.runnerPairingCodes.expiresAt, input.linkedAt),
          ),
        )
        .returning({
          pairingId: schema.runnerPairingCodes.id,
          workspaceId: schema.runnerPairingCodes.workspaceId,
        });

      if (pairingCode === undefined) {
        return null;
      }

      const [runner] = await tx
        .insert(schema.runners)
        .values(input.createRunnerRow(pairingCode))
        .returning({
          id: schema.runners.id,
          linkedAt: schema.runners.linkedAt,
          workspaceId: schema.runners.workspaceId,
        });

      if (runner === undefined) {
        throw new Error("Runner link creation did not return a row.");
      }

      await tx
        .update(schema.runnerPairingCodes)
        .set({
          updatedAt: input.linkedAt,
          usedByRunnerId: runner.id,
        })
        .where(eq(schema.runnerPairingCodes.id, pairingCode.pairingId));

      const linkedRunner = {
        linkedAt: runner.linkedAt,
        pairingId: pairingCode.pairingId,
        runnerId: runner.id,
        workspaceId: runner.workspaceId,
      };

      await tx.insert(schema.auditEvents).values(input.createAuditEvent(linkedRunner));

      return linkedRunner;
    }),
});

const RUNNER_ID_HEADER = "x-control-plane-runner-id";
const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

const readTrimmedHeader = (request: Request, headerName: string): string | null => {
  const value = request.headers.get(headerName);

  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length === 0 ? null : trimmedValue;
};

const parseBearerCredential = (request: Request): string | null => {
  const authorization = readTrimmedHeader(request, "authorization");

  if (authorization === null || authorization.includes(",")) {
    return null;
  }

  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/iu.exec(authorization);

  if (match === null) {
    return null;
  }

  const credential = match[1] ?? "";

  return credential.length === 0 ? null : credential;
};

export const compareRunnerCredentialHashes = (
  storedHash: string,
  presentedHash: string,
): boolean => {
  if (!SHA_256_HEX_PATTERN.test(storedHash) || !SHA_256_HEX_PATTERN.test(presentedHash)) {
    return false;
  }

  const storedHashBuffer = Buffer.from(storedHash, "hex");
  const presentedHashBuffer = Buffer.from(presentedHash, "hex");

  if (storedHashBuffer.length !== presentedHashBuffer.length) {
    return false;
  }

  return timingSafeEqual(storedHashBuffer, presentedHashBuffer);
};

const createAuthenticationFailureAuditEvent = (input: {
  createAuditEventId?: () => string;
  failedAt: Date;
  reason: RunnerAuthenticationFailureReason;
  runner: RunnerAuthenticationRecord;
}): AuditEventInsert =>
  createAuditEventInsert({
    createId: input.createAuditEventId ?? randomUUID,
    eventType: "runner.auth_failed",
    message: "Runner authentication failed.",
    metadata: {
      reason: input.reason,
    },
    now: () => input.failedAt,
    runnerId: input.runner.id,
    workspaceId: input.runner.workspaceId,
  });

export const createDrizzleRunnerAuthenticationStore = (
  db: Database,
): RunnerAuthenticationStore => ({
  findRunnerAuthRecord: async ({ runnerId }) => {
    const [runner] = await db
      .select({
        credentialHash: schema.runners.credentialHash,
        id: schema.runners.id,
        revokedAt: schema.runners.revokedAt,
        workspaceId: schema.runners.workspaceId,
      })
      .from(schema.runners)
      .where(eq(schema.runners.id, runnerId))
      .limit(1);

    return runner ?? null;
  },
  insertRunnerAuthFailureAudit: async (event) => {
    await db.insert(schema.auditEvents).values(event);
  },
});

export const createRunnerAuthenticationService = (input: {
  createAuditEventId?: () => string;
  now?: () => Date;
  store: RunnerAuthenticationStore;
}): RunnerAuthenticationService => {
  const now = input.now ?? (() => new Date());

  const recordAuthenticationFailure = async (
    runner: RunnerAuthenticationRecord,
    reason: RunnerAuthenticationFailureReason = "malformed",
  ): Promise<void> => {
    const auditInput: Parameters<typeof createAuthenticationFailureAuditEvent>[0] = {
      failedAt: now(),
      reason,
      runner,
    };

    if (input.createAuditEventId !== undefined) {
      auditInput.createAuditEventId = input.createAuditEventId;
    }

    await input.store.insertRunnerAuthFailureAudit(
      createAuthenticationFailureAuditEvent(auditInput),
    );
  };

  return {
    authenticateRunnerRequest: async (request) => {
      const credential = parseBearerCredential(request);

      if (credential === null) {
        throw new RunnerAuthenticationError();
      }

      const runnerId = readTrimmedHeader(request, RUNNER_ID_HEADER);

      if (runnerId === null) {
        throw new RunnerAuthenticationError();
      }

      const runner = await input.store.findRunnerAuthRecord({ runnerId });

      if (runner === null) {
        throw new RunnerAuthenticationError();
      }

      if (runner.revokedAt !== null) {
        await recordAuthenticationFailure(runner, "revoked");
        throw new RunnerAuthenticationError();
      }

      const presentedHash = hashRunnerCredential(credential);

      if (!compareRunnerCredentialHashes(runner.credentialHash, presentedHash)) {
        await recordAuthenticationFailure(runner, "mismatch");
        throw new RunnerAuthenticationError();
      }

      return {
        runnerId: runner.id,
        workspaceId: runner.workspaceId,
      };
    },
  };
};

export const authenticateRunnerRequest = async (
  request: Request,
): Promise<AuthenticatedRunnerContext> => {
  const database = getDatabase();
  const service = createRunnerAuthenticationService({
    store: createDrizzleRunnerAuthenticationStore(database.db),
  });

  return service.authenticateRunnerRequest(request);
};

export const createRunnerLinkService = (input: {
  createAuditEventId?: () => string;
  createRunnerId?: () => string;
  generateCredential?: () => string;
  now?: () => Date;
  store: RunnerLinkStore;
}): RunnerLinkService => {
  const now = input.now ?? (() => new Date());

  return {
    linkRunner: async ({ capabilities, pairingCode, pollingBaseUrl }) => {
      const normalizedPairingCode = pairingCode.trim();

      if (normalizedPairingCode.length === 0) {
        return { status: "invalid_pairing_code" };
      }

      const linkedAt = now();
      const runnerId = normalizeGeneratedSecret(
        input.createRunnerId?.() ?? randomUUID(),
        "Runner id",
      );
      const runnerCredential = normalizeGeneratedSecret(
        input.generateCredential?.() ?? generateRunnerCredential(),
        "Runner credential",
      );
      const runnerCredentialHash = hashRunnerCredential(runnerCredential);
      const runnerCapabilities = RunnerCapabilitiesSchema.parse({
        ...capabilities,
        runnerId,
      });
      const linkedRunner = await input.store.linkRunnerWithPairingCode({
        createAuditEvent: (row) =>
          createAuditEventInsert({
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "runner.linked",
            message: "Runner linked.",
            metadata: {
              pairingId: row.pairingId,
              runnerId: row.runnerId,
            },
            now: () => linkedAt,
            runnerId: row.runnerId,
            workspaceId: row.workspaceId,
          }),
        createRunnerRow: (row) => ({
          capabilities: runnerCapabilities,
          createdAt: linkedAt,
          credentialHash: runnerCredentialHash,
          displayName: "Local runner",
          id: runnerId,
          lastHeartbeatAt: linkedAt,
          linkedAt,
          status: "idle",
          updatedAt: linkedAt,
          workspaceId: row.workspaceId,
        }),
        linkedAt,
        pairingCodeHash: hashTrimmedSecret(normalizedPairingCode),
      });

      if (linkedRunner === null) {
        return { status: "invalid_pairing_code" };
      }

      return {
        response: LinkRunnerResponseSchema.parse({
          contractVersion: CONTRACT_VERSION,
          linkedAt: linkedRunner.linkedAt.toISOString(),
          pollIntervalSeconds: RUNNER_LINK_POLL_INTERVAL_SECONDS,
          pollingBaseUrl,
          runnerCredential,
          runnerId: linkedRunner.runnerId,
          workspaceId: linkedRunner.workspaceId,
        }),
        status: "linked",
      };
    },
  };
};
