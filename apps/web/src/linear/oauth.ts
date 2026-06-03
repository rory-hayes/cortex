import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import { and, eq, isNull, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export const LINEAR_OAUTH_ENCRYPTION_KEY_ENV = "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY";
export const LINEAR_OAUTH_ENCRYPTION_KEY_ID_ENV = "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_ID";

const requiredTextMaxLength = 240;
const workspaceNameMaxLength = 160;
const scopeMaxLength = 120;
const maxScopeCount = 50;
const aes256KeyLength = 32;
const aesGcmIvLength = 12;

const unsafeMetadataPattern =
  /(?:diff --git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|ghp_[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/iu;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const assertSafeBoundedText = (value: string, maxLength: number): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    unsafeMetadataPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const assertRequiredCredential = (value: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasControlCharacter(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalCredential = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return assertRequiredCredential(value);
};

const normalizeOptionalExpiry = (value: Date | null | undefined): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw createActionError("validation_error");
  }

  return value;
};

const normalizeScopes = (scopes: string[]): string[] => {
  const normalizedScopes = new Set<string>();

  for (const scope of scopes) {
    const normalizedScope = scope.trim();

    if (normalizedScope.length === 0) {
      continue;
    }

    if (
      normalizedScope.length > scopeMaxLength ||
      hasControlCharacter(normalizedScope) ||
      !/^[A-Za-z0-9:._/-]+$/u.test(normalizedScope)
    ) {
      throw createActionError("validation_error");
    }

    normalizedScopes.add(normalizedScope);

    if (normalizedScopes.size > maxScopeCount) {
      throw createActionError("validation_error");
    }
  }

  return [...normalizedScopes].sort((left, right) => left.localeCompare(right));
};

const encodeBase64Url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");

const decodeBase64Url = (value: string): Buffer => {
  const normalizedValue = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const paddingLength = (4 - (normalizedValue.length % 4)) % 4;

  return Buffer.from(`${normalizedValue}${"=".repeat(paddingLength)}`, "base64");
};

const decodeEncryptionKey = (value: string | undefined): Buffer => {
  if (value === undefined) {
    throw new LinearOAuthCredentialSealingError();
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    throw new LinearOAuthCredentialSealingError();
  }

  const key = /^[a-f0-9]{64}$/iu.test(normalizedValue)
    ? Buffer.from(normalizedValue, "hex")
    : decodeBase64Url(normalizedValue);

  if (key.byteLength !== aes256KeyLength) {
    throw new LinearOAuthCredentialSealingError();
  }

  return key;
};

const normalizeKeyId = (value: string | undefined): string =>
  value === undefined ? "linear-oauth-env-v1" : assertSafeBoundedText(value, requiredTextMaxLength);

const assertSealedCredential = (
  credential: SealedLinearOAuthCredential,
): SealedLinearOAuthCredential => {
  const ciphertext = credential.ciphertext.trim();
  const keyId = credential.keyId.trim();

  if (ciphertext.length === 0 || keyId.length === 0) {
    throw new LinearOAuthCredentialSealingError();
  }

  return {
    ciphertext,
    keyId,
  };
};

type LinearOAuthConnectionRow = typeof schema.linearOAuthConnections.$inferSelect;

export type LinearOAuthConnectionData = Pick<
  LinearOAuthConnectionRow,
  | "connectedAt"
  | "connectedByActorId"
  | "createdAt"
  | "expiresAt"
  | "id"
  | "linearActorId"
  | "linearWorkspaceId"
  | "linearWorkspaceName"
  | "revokedAt"
  | "revokedByActorId"
  | "scopes"
  | "updatedAt"
  | "workspaceId"
>;

export type LinearOAuthConnectionCreateRow = Pick<
  LinearOAuthConnectionRow,
  | "accessTokenCiphertext"
  | "accessTokenKeyId"
  | "connectedAt"
  | "connectedByActorId"
  | "createdAt"
  | "expiresAt"
  | "id"
  | "linearActorId"
  | "linearWorkspaceId"
  | "linearWorkspaceName"
  | "refreshTokenCiphertext"
  | "refreshTokenKeyId"
  | "revokedAt"
  | "revokedByActorId"
  | "scopes"
  | "updatedAt"
  | "workspaceId"
>;

export type CreateLinearOAuthConnectionWithAuditInput = {
  auditEvent: AuditEventInsert;
  connection: LinearOAuthConnectionCreateRow;
};

export type RevokeLinearOAuthConnectionWithAuditInput = {
  auditEventFor: (row: LinearOAuthConnectionRow) => AuditEventInsert;
  connectionId: string;
  revokedAt: Date;
  revokedByActorId: string;
  workspaceId: string;
};

export type LinearOAuthConnectionStore = WorkspaceMembershipStore & {
  createLinearOAuthConnectionWithAudit: (
    input: CreateLinearOAuthConnectionWithAuditInput,
  ) => Promise<LinearOAuthConnectionRow>;
  revokeLinearOAuthConnectionWithAudit: (
    input: RevokeLinearOAuthConnectionWithAuditInput,
  ) => Promise<LinearOAuthConnectionRow | null>;
};

export type LinearOAuthCredentialPurpose = "access" | "refresh";

export type SealedLinearOAuthCredential = {
  ciphertext: string;
  keyId: string;
};

export type LinearOAuthCredentialSealer = {
  sealCredential: (input: {
    plaintext: string;
    purpose: LinearOAuthCredentialPurpose;
  }) => Promise<SealedLinearOAuthCredential>;
};

export type LinearOAuthCredentialUnsealer = {
  unsealCredential: (input: {
    credential: SealedLinearOAuthCredential;
    purpose: LinearOAuthCredentialPurpose;
  }) => Promise<string>;
};

export type CreateLinearOAuthConnectionInput = {
  accessToken: string;
  expiresAt?: Date | null;
  linearActorId: string;
  linearWorkspaceId: string;
  linearWorkspaceName: string;
  refreshToken?: string | null;
  scopes: string[];
  workspaceId: string;
};

export type RevokeLinearOAuthConnectionInput = {
  connectionId: string;
  workspaceId: string;
};

export type LinearOAuthConnectionService = {
  createLinearOAuthConnection: (
    input: CreateLinearOAuthConnectionInput,
  ) => Promise<LinearOAuthConnectionData>;
  revokeLinearOAuthConnection: (
    input: RevokeLinearOAuthConnectionInput,
  ) => Promise<LinearOAuthConnectionData>;
};

export class LinearOAuthCredentialSealingError extends Error {
  readonly code = "linear_oauth_credential_sealing_unavailable" as const;

  constructor() {
    super("Linear OAuth credential sealing is unavailable.");
    this.name = "LinearOAuthCredentialSealingError";
  }
}

const toConnectionData = (row: LinearOAuthConnectionRow): LinearOAuthConnectionData => ({
  connectedAt: row.connectedAt,
  connectedByActorId: row.connectedByActorId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  id: row.id,
  linearActorId: row.linearActorId,
  linearWorkspaceId: row.linearWorkspaceId,
  linearWorkspaceName: row.linearWorkspaceName,
  revokedAt: row.revokedAt,
  revokedByActorId: row.revokedByActorId,
  scopes: normalizeScopes(row.scopes),
  updatedAt: row.updatedAt,
  workspaceId: row.workspaceId,
});

const parseCreateInput = (input: CreateLinearOAuthConnectionInput) => ({
  accessToken: assertRequiredCredential(input.accessToken),
  expiresAt: normalizeOptionalExpiry(input.expiresAt),
  linearActorId: assertSafeBoundedText(input.linearActorId, requiredTextMaxLength),
  linearWorkspaceId: assertSafeBoundedText(input.linearWorkspaceId, requiredTextMaxLength),
  linearWorkspaceName: assertSafeBoundedText(input.linearWorkspaceName, workspaceNameMaxLength),
  refreshToken: normalizeOptionalCredential(input.refreshToken),
  scopes: normalizeScopes(input.scopes),
  workspaceId: assertSafeBoundedText(input.workspaceId, requiredTextMaxLength),
});

const parseRevokeInput = (input: RevokeLinearOAuthConnectionInput) => ({
  connectionId: assertSafeBoundedText(input.connectionId, requiredTextMaxLength),
  workspaceId: assertSafeBoundedText(input.workspaceId, requiredTextMaxLength),
});

export const createAesGcmLinearOAuthCredentialSealer = (input: {
  key: Uint8Array;
  keyId: string;
  randomBytes?: (size: number) => Buffer;
}): LinearOAuthCredentialSealer => {
  if (input.key.byteLength !== aes256KeyLength) {
    throw new LinearOAuthCredentialSealingError();
  }

  const key = Buffer.from(input.key);
  const keyId = normalizeKeyId(input.keyId);
  const generateRandomBytes = input.randomBytes ?? randomBytes;

  return {
    sealCredential: async ({ plaintext, purpose }) => {
      const normalizedPlaintext = assertRequiredCredential(plaintext);
      const iv = generateRandomBytes(aesGcmIvLength);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const associatedData = Buffer.from(`linear-oauth:${purpose}:${keyId}`, "utf8");

      cipher.setAAD(associatedData);

      const encrypted = Buffer.concat([cipher.update(normalizedPlaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();

      return {
        ciphertext: `v1.${encodeBase64Url(iv)}.${encodeBase64Url(tag)}.${encodeBase64Url(
          encrypted,
        )}`,
        keyId,
      };
    },
  };
};

const parseAesGcmCiphertext = (
  credential: SealedLinearOAuthCredential,
  expectedKeyId: string,
): {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
} => {
  const sealedCredential = assertSealedCredential(credential);

  if (sealedCredential.keyId !== expectedKeyId) {
    throw new LinearOAuthCredentialSealingError();
  }

  const parts = sealedCredential.ciphertext.split(".");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new LinearOAuthCredentialSealingError();
  }

  const [, ivText, tagText, ciphertextText] = parts;

  if (
    ivText === undefined ||
    tagText === undefined ||
    ciphertextText === undefined ||
    ivText.length === 0 ||
    tagText.length === 0 ||
    ciphertextText.length === 0
  ) {
    throw new LinearOAuthCredentialSealingError();
  }

  const iv = decodeBase64Url(ivText);
  const tag = decodeBase64Url(tagText);
  const ciphertext = decodeBase64Url(ciphertextText);

  if (iv.byteLength !== aesGcmIvLength || tag.byteLength !== 16 || ciphertext.byteLength === 0) {
    throw new LinearOAuthCredentialSealingError();
  }

  return { ciphertext, iv, tag };
};

export const createAesGcmLinearOAuthCredentialUnsealer = (input: {
  key: Uint8Array;
  keyId: string;
}): LinearOAuthCredentialUnsealer => {
  if (input.key.byteLength !== aes256KeyLength) {
    throw new LinearOAuthCredentialSealingError();
  }

  const key = Buffer.from(input.key);
  const keyId = normalizeKeyId(input.keyId);

  return {
    unsealCredential: async ({ credential, purpose }) => {
      try {
        const parsed = parseAesGcmCiphertext(credential, keyId);
        const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv);
        const associatedData = Buffer.from(`linear-oauth:${purpose}:${keyId}`, "utf8");

        decipher.setAAD(associatedData);
        decipher.setAuthTag(parsed.tag);

        const decrypted = Buffer.concat([
          decipher.update(parsed.ciphertext),
          decipher.final(),
        ]).toString("utf8");

        return assertRequiredCredential(decrypted);
      } catch {
        throw new LinearOAuthCredentialSealingError();
      }
    },
  };
};

export const createEnvLinearOAuthCredentialSealer = (
  env: NodeJS.ProcessEnv = process.env,
): LinearOAuthCredentialSealer =>
  createAesGcmLinearOAuthCredentialSealer({
    key: decodeEncryptionKey(env[LINEAR_OAUTH_ENCRYPTION_KEY_ENV]),
    keyId: normalizeKeyId(env[LINEAR_OAUTH_ENCRYPTION_KEY_ID_ENV]),
  });

export const createEnvLinearOAuthCredentialUnsealer = (
  env: NodeJS.ProcessEnv = process.env,
): LinearOAuthCredentialUnsealer =>
  createAesGcmLinearOAuthCredentialUnsealer({
    key: decodeEncryptionKey(env[LINEAR_OAUTH_ENCRYPTION_KEY_ENV]),
    keyId: normalizeKeyId(env[LINEAR_OAUTH_ENCRYPTION_KEY_ID_ENV]),
  });

export const createDrizzleLinearOAuthConnectionStore = (
  db: Database,
): LinearOAuthConnectionStore => ({
  createLinearOAuthConnectionWithAudit: async ({ auditEvent, connection }) =>
    db.transaction(async (tx) => {
      const [createdConnection] = await tx
        .insert(schema.linearOAuthConnections)
        .values(connection)
        .returning();

      if (createdConnection === undefined) {
        throw new Error("Linear OAuth connection creation did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return createdConnection;
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
  revokeLinearOAuthConnectionWithAudit: async ({
    auditEventFor,
    connectionId,
    revokedAt,
    revokedByActorId,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [revokedConnection] = await tx
        .update(schema.linearOAuthConnections)
        .set({
          accessTokenCiphertext: null,
          accessTokenKeyId: null,
          refreshTokenCiphertext: null,
          refreshTokenKeyId: null,
          revokedAt,
          revokedByActorId,
          updatedAt: revokedAt,
        })
        .where(
          and(
            eq(schema.linearOAuthConnections.id, connectionId),
            eq(schema.linearOAuthConnections.workspaceId, workspaceId),
            isNull(schema.linearOAuthConnections.revokedAt),
          ),
        )
        .returning();

      if (revokedConnection === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEventFor(revokedConnection));

      return revokedConnection;
    }),
});

export const createLinearOAuthConnectionService = (input: {
  createAuditEventId?: () => string;
  createConnectionId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  sealer?: LinearOAuthCredentialSealer;
  store: LinearOAuthConnectionStore;
}): LinearOAuthConnectionService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());
  const getSealer = () => input.sealer ?? createEnvLinearOAuthCredentialSealer();

  return {
    createLinearOAuthConnection: async (createInput) => {
      const parsedInput = parseCreateInput(createInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: parsedInput.workspaceId,
      });
      const connectedAt = now();
      const connectionId = input.createConnectionId?.() ?? randomUUID();
      const sealer = getSealer();
      const accessCredential = assertSealedCredential(
        await sealer.sealCredential({
          plaintext: parsedInput.accessToken,
          purpose: "access",
        }),
      );
      const refreshCredential =
        parsedInput.refreshToken === null
          ? null
          : assertSealedCredential(
              await sealer.sealCredential({
                plaintext: parsedInput.refreshToken,
                purpose: "refresh",
              }),
            );
      const auditEvent = createAuditEventInsert({
        actorId: scope.actorId,
        createId: input.createAuditEventId ?? randomUUID,
        eventType: "linear_oauth_connection.created",
        message: "Linear OAuth connection created.",
        metadata: {
          connectionId,
          expiresAt: parsedInput.expiresAt?.toISOString() ?? null,
          linearWorkspaceId: parsedInput.linearWorkspaceId,
          scopeCount: parsedInput.scopes.length,
        },
        now: () => connectedAt,
        workspaceId: scope.workspaceId,
      });
      const connection = await input.store.createLinearOAuthConnectionWithAudit({
        auditEvent,
        connection: {
          accessTokenCiphertext: accessCredential.ciphertext,
          accessTokenKeyId: accessCredential.keyId,
          connectedAt,
          connectedByActorId: scope.actorId,
          createdAt: connectedAt,
          expiresAt: parsedInput.expiresAt,
          id: connectionId,
          linearActorId: parsedInput.linearActorId,
          linearWorkspaceId: parsedInput.linearWorkspaceId,
          linearWorkspaceName: parsedInput.linearWorkspaceName,
          refreshTokenCiphertext: refreshCredential?.ciphertext ?? null,
          refreshTokenKeyId: refreshCredential?.keyId ?? null,
          revokedAt: null,
          revokedByActorId: null,
          scopes: parsedInput.scopes,
          updatedAt: connectedAt,
          workspaceId: scope.workspaceId,
        },
      });

      return toConnectionData(connection);
    },
    revokeLinearOAuthConnection: async (revokeInput) => {
      const parsedInput = parseRevokeInput(revokeInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: parsedInput.workspaceId,
      });
      const revokedAt = now();
      const revokedConnection = await input.store.revokeLinearOAuthConnectionWithAudit({
        auditEventFor: (row) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "linear_oauth_connection.revoked",
            message: "Linear OAuth connection revoked.",
            metadata: {
              connectionId: row.id,
              linearWorkspaceId: row.linearWorkspaceId,
              revokedAt: revokedAt.toISOString(),
              scopeCount: row.scopes.length,
            },
            now: () => revokedAt,
            workspaceId: scope.workspaceId,
          }),
        connectionId: parsedInput.connectionId,
        revokedAt,
        revokedByActorId: scope.actorId,
        workspaceId: scope.workspaceId,
      });

      if (revokedConnection === null) {
        throw createActionError("validation_error");
      }

      return toConnectionData(revokedConnection);
    },
  };
};
