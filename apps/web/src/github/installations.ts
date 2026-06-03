import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, schema, type Database, type GitHubAppInstallation } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export type GitHubAppInstallationRow = GitHubAppInstallation;

export type GitHubAppInstallationData = GitHubAppInstallationRow;

export type GitHubAppInstallationAccountInput = {
  htmlUrl?: string | null;
  id: number | string;
  login: string;
  type: string;
};

export type GitHubAppInstallationMetadataInput = {
  account: GitHubAppInstallationAccountInput;
  htmlUrl?: string | null;
  id: number | string;
  permissions: Record<string, string>;
  repositorySelection: string;
  suspendedAt?: Date | string | null;
};

export type PersistGitHubInstallationInput = {
  installation: GitHubAppInstallationMetadataInput;
  workspaceId: string;
};

export type ListGitHubInstallationsInput = {
  workspaceId: string;
};

export type GitHubAppInstallationUpsertRow = Pick<
  GitHubAppInstallationRow,
  | "accountHtmlUrl"
  | "accountId"
  | "accountLogin"
  | "accountType"
  | "createdAt"
  | "githubInstallationId"
  | "id"
  | "installationHtmlUrl"
  | "lastSyncedAt"
  | "permissions"
  | "repositorySelection"
  | "suspendedAt"
  | "updatedAt"
  | "workspaceId"
>;

export type UpsertGitHubInstallationWithAuditInput = {
  auditEventFor: (row: GitHubAppInstallationRow) => AuditEventInsert;
  installation: GitHubAppInstallationUpsertRow;
};

export type GitHubInstallationStore = WorkspaceMembershipStore & {
  listGitHubInstallations: (input: { workspaceId: string }) => Promise<GitHubAppInstallationRow[]>;
  upsertGitHubInstallationWithAudit: (
    input: UpsertGitHubInstallationWithAuditInput,
  ) => Promise<GitHubAppInstallationRow>;
};

export type GitHubInstallationService = {
  listGitHubInstallations: (
    input: ListGitHubInstallationsInput,
  ) => Promise<GitHubAppInstallationData[]>;
  persistGitHubInstallation: (
    input: PersistGitHubInstallationInput,
  ) => Promise<GitHubAppInstallationData>;
};

const requiredTextMaxLength = 240;
const urlMaxLength = 512;
const maxPermissionCount = 100;
const maxPermissionKeyLength = 80;
const maxPermissionValueLength = 40;

const unsafeTextPattern =
  /(?:diff --git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/iu;
const unsafePermissionFieldPattern =
  /(?:api[_-]?key|credential|installation[_-]?access|password|private|secret|token)/iu;
const unsafeUrlQueryKeyPattern =
  /(?:access[_-]?token|api[_-]?key|client[_-]?secret|secret|token)/iu;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const assertSafeBoundedText = (value: string, maxLength = requiredTextMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    unsafeTextPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeWorkspaceId = (value: string): string => assertSafeBoundedText(value);

const normalizeGitHubNumericId = (value: number | string): string => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw createActionError("validation_error");
    }

    return String(value);
  }

  const normalizedValue = value.trim();

  if (!/^\d{1,32}$/u.test(normalizedValue) || BigInt(normalizedValue) <= 0n) {
    throw createActionError("validation_error");
  }

  return BigInt(normalizedValue).toString();
};

const normalizeGitHubLogin = (value: string): string => {
  const normalizedValue = assertSafeBoundedText(value, 100);

  if (
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.includes("/") ||
    normalizedValue.includes("\\") ||
    normalizedValue.includes(":") ||
    normalizedValue.includes("@") ||
    /\s/u.test(normalizedValue) ||
    !/^[A-Za-z0-9._-]+$/u.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeAccountType = (value: string): string => {
  const normalizedValue = assertSafeBoundedText(value, 40);

  if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalUrl = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = assertSafeBoundedText(value, urlMaxLength);

  try {
    const url = new URL(normalizedValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      Boolean(url.username || url.password)
    ) {
      throw createActionError("validation_error");
    }

    for (const key of url.searchParams.keys()) {
      if (unsafeUrlQueryKeyPattern.test(key)) {
        throw createActionError("validation_error");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ServerActionError") {
      throw error;
    }

    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeRepositorySelection = (value: string): "all" | "selected" => {
  const normalizedValue = assertSafeBoundedText(value, 20);

  if (normalizedValue !== "all" && normalizedValue !== "selected") {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizePermissions = (permissions: Record<string, string>): Record<string, string> => {
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions) ||
    Object.getPrototypeOf(permissions) !== Object.prototype
  ) {
    throw createActionError("validation_error");
  }

  const entries = Object.entries(permissions).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );

  if (entries.length > maxPermissionCount) {
    throw createActionError("validation_error");
  }

  const normalizedPermissions: Record<string, string> = {};

  for (const [key, value] of entries) {
    const normalizedKey = key.trim();
    const normalizedValue = typeof value === "string" ? value.trim() : "";

    if (
      normalizedKey.length === 0 ||
      normalizedKey.length > maxPermissionKeyLength ||
      normalizedValue.length === 0 ||
      normalizedValue.length > maxPermissionValueLength ||
      hasControlCharacter(normalizedKey) ||
      hasControlCharacter(normalizedValue) ||
      unsafeTextPattern.test(normalizedKey) ||
      unsafeTextPattern.test(normalizedValue) ||
      unsafePermissionFieldPattern.test(normalizedKey) ||
      unsafePermissionFieldPattern.test(normalizedValue) ||
      !/^[a-z_]+$/u.test(normalizedKey) ||
      !/^[a-z_]+$/u.test(normalizedValue)
    ) {
      throw createActionError("validation_error");
    }

    normalizedPermissions[normalizedKey] = normalizedValue;
  }

  return normalizedPermissions;
};

const normalizeOptionalTimestamp = (value: Date | string | null | undefined): Date | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(assertSafeBoundedText(value, 80));

  if (!Number.isFinite(date.getTime())) {
    throw createActionError("validation_error");
  }

  return date;
};

const toInstallationData = (row: GitHubAppInstallationRow): GitHubAppInstallationData => ({
  accountHtmlUrl: row.accountHtmlUrl,
  accountId: row.accountId,
  accountLogin: row.accountLogin,
  accountType: row.accountType,
  createdAt: row.createdAt,
  githubInstallationId: row.githubInstallationId,
  id: row.id,
  installationHtmlUrl: row.installationHtmlUrl,
  lastSyncedAt: row.lastSyncedAt,
  permissions: normalizePermissions(row.permissions),
  repositorySelection: row.repositorySelection,
  suspendedAt: row.suspendedAt,
  updatedAt: row.updatedAt,
  workspaceId: row.workspaceId,
});

const parsePersistInput = (
  input: PersistGitHubInstallationInput,
): Omit<GitHubAppInstallationUpsertRow, "createdAt" | "id" | "lastSyncedAt" | "updatedAt"> => ({
  accountHtmlUrl: normalizeOptionalUrl(input.installation.account.htmlUrl),
  accountId: normalizeGitHubNumericId(input.installation.account.id),
  accountLogin: normalizeGitHubLogin(input.installation.account.login),
  accountType: normalizeAccountType(input.installation.account.type),
  githubInstallationId: normalizeGitHubNumericId(input.installation.id),
  installationHtmlUrl: normalizeOptionalUrl(input.installation.htmlUrl),
  permissions: normalizePermissions(input.installation.permissions),
  repositorySelection: normalizeRepositorySelection(input.installation.repositorySelection),
  suspendedAt: normalizeOptionalTimestamp(input.installation.suspendedAt),
  workspaceId: normalizeWorkspaceId(input.workspaceId),
});

export const createDrizzleGitHubInstallationStore = (db: Database): GitHubInstallationStore => ({
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
  listGitHubInstallations: async ({ workspaceId }) =>
    db
      .select()
      .from(schema.githubAppInstallations)
      .where(eq(schema.githubAppInstallations.workspaceId, workspaceId)),
  upsertGitHubInstallationWithAudit: async ({ auditEventFor, installation }) =>
    db.transaction(async (tx) => {
      const [upsertedInstallation] = await tx
        .insert(schema.githubAppInstallations)
        .values(installation)
        .onConflictDoUpdate({
          set: {
            accountHtmlUrl: installation.accountHtmlUrl,
            accountId: installation.accountId,
            accountLogin: installation.accountLogin,
            accountType: installation.accountType,
            installationHtmlUrl: installation.installationHtmlUrl,
            lastSyncedAt: installation.lastSyncedAt,
            permissions: installation.permissions,
            repositorySelection: installation.repositorySelection,
            suspendedAt: installation.suspendedAt,
            updatedAt: installation.updatedAt,
          },
          target: [
            schema.githubAppInstallations.workspaceId,
            schema.githubAppInstallations.githubInstallationId,
          ],
        })
        .returning();

      if (upsertedInstallation === undefined) {
        throw new Error("GitHub App installation upsert did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEventFor(upsertedInstallation));

      return upsertedInstallation;
    }),
});

export const createGitHubInstallationService = (input: {
  createAuditEventId?: () => string;
  createInstallationId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: GitHubInstallationStore;
}): GitHubInstallationService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    listGitHubInstallations: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const installations = await input.store.listGitHubInstallations({
        workspaceId: scope.workspaceId,
      });

      return installations.map(toInstallationData);
    },
    persistGitHubInstallation: async (persistInput) => {
      const parsedInput = parsePersistInput(persistInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: parsedInput.workspaceId,
      });
      const syncedAt = now();
      const installationId = input.createInstallationId?.() ?? randomUUID();
      const installation: GitHubAppInstallationUpsertRow = {
        ...parsedInput,
        createdAt: syncedAt,
        id: installationId,
        lastSyncedAt: syncedAt,
        updatedAt: syncedAt,
        workspaceId: scope.workspaceId,
      };
      const storedInstallation = await input.store.upsertGitHubInstallationWithAudit({
        auditEventFor: (row) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "github_app_installation.synced",
            message: "GitHub App installation synced.",
            metadata: {
              accountId: row.accountId,
              githubInstallationId: row.githubInstallationId,
              installationId: row.id,
              permissionCount: Object.keys(row.permissions).length,
              repositorySelection: row.repositorySelection,
              suspended: row.suspendedAt !== null,
            },
            now: () => syncedAt,
            workspaceId: scope.workspaceId,
          }),
        installation,
      });

      return toInstallationData(storedInstallation);
    },
  };
};
