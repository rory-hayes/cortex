import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, schema, type Database, type GitHubRepository } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export type GitHubRepositoryRow = GitHubRepository;

export type GitHubRepositoryData = GitHubRepositoryRow & {
  matchedRepoMappingId: string | null;
};

export type GitHubRepositoryMetadataInput = {
  archived?: boolean | null;
  defaultBranch?: string | null;
  disabled?: boolean | null;
  fullName: string;
  htmlUrl?: string | null;
  id: number | string;
  name: string;
  owner: string;
  private: boolean;
  visibility?: string | null;
};

export type SyncGitHubRepositoriesForInstallationInput = {
  githubInstallationId: number | string;
  repositories: GitHubRepositoryMetadataInput[];
  workspaceId: string;
};

export type SyncGitHubRepositoriesForWebhookInput = {
  githubInstallationId: number | string;
  repositories: GitHubRepositoryMetadataInput[];
};

export type ListGitHubRepositoriesInput = {
  workspaceId: string;
};

export type GitHubRepositorySyncResult = {
  matchedRepoMappingCount: number;
  skipped: boolean;
  syncedRepositoryCount: number;
};

export type GitHubRepositoryInstallationRow = {
  githubInstallationId: string;
  id: string;
  workspaceId: string;
};

export type GitHubRepositoryMappingRow = {
  archivedAt: Date | null;
  githubInstallationId: string | null;
  id: string;
  remoteUrl: string | null;
  repositoryExternalId: string | null;
  workspaceId: string;
};

export type GitHubRepositoryUpsertRow = Omit<
  GitHubRepositoryRow,
  "createdAt" | "id" | "updatedAt"
> & {
  createdAt?: Date;
  id?: string;
  updatedAt: Date;
};

export type GitHubRepositoryStore = WorkspaceMembershipStore & {
  findGitHubAppInstallation: (input: {
    githubInstallationId: string;
    workspaceId?: string;
  }) => Promise<GitHubRepositoryInstallationRow | null>;
  insertAuditEvent: (event: AuditEventInsert) => Promise<void>;
  listActiveRepoMappingsForGitHubSync: (input: {
    workspaceId: string;
  }) => Promise<GitHubRepositoryMappingRow[]>;
  listGitHubRepositories: (input: { workspaceId: string }) => Promise<GitHubRepositoryRow[]>;
  updateRepoMappingGitHubRepositoryLink: (input: {
    githubInstallationId: string;
    repoMappingId: string;
    repositoryExternalId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<void>;
  upsertGitHubRepository: (input: {
    createRepositoryId: () => string;
    repository: GitHubRepositoryUpsertRow;
  }) => Promise<GitHubRepositoryRow>;
};

export type GitHubRepositoryService = {
  listGitHubRepositories: (input: ListGitHubRepositoriesInput) => Promise<GitHubRepositoryData[]>;
  syncGitHubRepositoriesForInstallation: (
    input: SyncGitHubRepositoriesForInstallationInput,
  ) => Promise<GitHubRepositorySyncResult>;
  syncGitHubRepositoriesForWebhook: (
    input: SyncGitHubRepositoriesForWebhookInput,
  ) => Promise<GitHubRepositorySyncResult>;
};

const requiredTextMaxLength = 240;
const repositoryPartMaxLength = 100;
const repositoryFullNameMaxLength = 220;
const urlMaxLength = 512;
const branchMaxLength = 256;

const unsafeTextPattern =
  /(?:diff\s+--git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/iu;
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

const normalizeRepositoryPart = (value: string): string => {
  const normalizedValue = assertSafeBoundedText(value, repositoryPartMaxLength);

  if (
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.startsWith("-") ||
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

const normalizeFullName = (value: string, owner: string, name: string): string => {
  const normalizedValue = assertSafeBoundedText(value, repositoryFullNameMaxLength);
  const expected = `${owner}/${name}`;

  if (normalizedValue !== expected) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeBranchName = (value: string | null | undefined): string => {
  const normalizedValue = assertSafeBoundedText(value ?? "unknown", branchMaxLength);

  if (
    normalizedValue.startsWith("-") ||
    normalizedValue.startsWith("/") ||
    normalizedValue.endsWith("/") ||
    normalizedValue.endsWith(".") ||
    normalizedValue.endsWith(".lock") ||
    normalizedValue.includes("\\") ||
    normalizedValue.includes("..") ||
    normalizedValue.includes("@{") ||
    normalizedValue.includes(":") ||
    normalizedValue.includes("~") ||
    normalizedValue.includes("^") ||
    normalizedValue.includes("?") ||
    normalizedValue.includes("*") ||
    normalizedValue.includes("[") ||
    /\s/u.test(normalizedValue)
  ) {
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

const normalizeVisibility = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }

  const normalizedValue = assertSafeBoundedText(value, 40);

  if (
    normalizedValue !== "public" &&
    normalizedValue !== "private" &&
    normalizedValue !== "internal"
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeBoolean = (value: boolean | null | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw createActionError("validation_error");
  }

  return value;
};

const normalizeRepositoryInput = (
  input: GitHubRepositoryMetadataInput,
  installation: GitHubRepositoryInstallationRow,
  syncedAt: Date,
): GitHubRepositoryUpsertRow => {
  const repositoryOwner = normalizeRepositoryPart(input.owner);
  const repositoryName = normalizeRepositoryPart(input.name);
  const repositoryExternalId = normalizeGitHubNumericId(input.id);
  const repositoryFullName = normalizeFullName(input.fullName, repositoryOwner, repositoryName);

  return {
    archived: normalizeBoolean(input.archived, false),
    defaultBranch: normalizeBranchName(input.defaultBranch),
    disabled: normalizeBoolean(input.disabled, false),
    githubAppInstallationId: installation.id,
    githubInstallationId: installation.githubInstallationId,
    htmlUrl: normalizeOptionalUrl(input.htmlUrl),
    isPrivate: normalizeBoolean(input.private, false),
    lastSyncedAt: syncedAt,
    repositoryExternalId,
    repositoryFullName,
    repositoryName,
    repositoryOwner,
    updatedAt: syncedAt,
    visibility: normalizeVisibility(input.visibility),
    workspaceId: installation.workspaceId,
  };
};

const toRepositoryData = (
  row: GitHubRepositoryRow,
  mappings: GitHubRepositoryMappingRow[],
): GitHubRepositoryData => ({
  ...row,
  matchedRepoMappingId: findMatchedMappingId(row, mappings),
});

const normalizeRemoteRepositoryKey = (remoteUrl: string | null): string | null => {
  if (remoteUrl === null) {
    return null;
  }

  const value = remoteUrl.trim();

  if (value.length === 0 || hasControlCharacter(value) || unsafeTextPattern.test(value)) {
    return null;
  }

  const scpLikeMatch = value.match(
    /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/u,
  );

  if (scpLikeMatch !== null) {
    return normalizeRepositoryKey(scpLikeMatch[1] ?? "", scpLikeMatch[2] ?? "");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "github.com" || url.password.length > 0) {
    return null;
  }

  if (url.protocol === "https:" || url.protocol === "http:") {
    if (url.username.length > 0) {
      return null;
    }
  } else if (url.protocol === "ssh:") {
    if (url.username !== "git") {
      return null;
    }
  } else {
    return null;
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    return null;
  }

  const pathParts = url.pathname.replace(/^\/+/u, "").split("/");

  if (pathParts.length !== 2) {
    return null;
  }

  const owner = pathParts[0] ?? "";
  const repositoryName = (pathParts[1] ?? "").replace(/\.git$/u, "");

  return normalizeRepositoryKey(owner, repositoryName);
};

const normalizeRepositoryKey = (owner: string, name: string): string | null => {
  try {
    return `${normalizeRepositoryPart(owner).toLowerCase()}/${normalizeRepositoryPart(
      name,
    ).toLowerCase()}`;
  } catch {
    return null;
  }
};

const getRepositoryKey = (
  repository: Pick<GitHubRepositoryRow, "repositoryName" | "repositoryOwner">,
) => `${repository.repositoryOwner.toLowerCase()}/${repository.repositoryName.toLowerCase()}`;

const findMatchedMappingId = (
  repository: GitHubRepositoryRow,
  mappings: GitHubRepositoryMappingRow[],
): string | null => {
  const repositoryKey = getRepositoryKey(repository);
  const linkedMapping = mappings.find(
    (mapping) =>
      mapping.githubInstallationId === repository.githubInstallationId &&
      mapping.repositoryExternalId === repository.repositoryExternalId &&
      normalizeRemoteRepositoryKey(mapping.remoteUrl) === repositoryKey,
  );

  if (linkedMapping !== undefined) {
    return linkedMapping.id;
  }

  const remoteMapping = mappings.find(
    (mapping) => normalizeRemoteRepositoryKey(mapping.remoteUrl) === repositoryKey,
  );

  return remoteMapping?.id ?? null;
};

const syncRepositories = async (input: {
  actorId?: string;
  createAuditEventId?: (() => string) | undefined;
  createRepositoryId?: (() => string) | undefined;
  installation: GitHubRepositoryInstallationRow;
  now: () => Date;
  repositories: GitHubRepositoryMetadataInput[];
  store: GitHubRepositoryStore;
}): Promise<GitHubRepositorySyncResult> => {
  const syncedAt = input.now();
  const normalizedRepositories = input.repositories.map((repository) =>
    normalizeRepositoryInput(repository, input.installation, syncedAt),
  );
  const storedRepositories = [];

  for (const repository of normalizedRepositories) {
    storedRepositories.push(
      await input.store.upsertGitHubRepository({
        createRepositoryId: input.createRepositoryId ?? randomUUID,
        repository,
      }),
    );
  }

  const activeMappings = await input.store.listActiveRepoMappingsForGitHubSync({
    workspaceId: input.installation.workspaceId,
  });
  const matchedMappingIds = new Set<string>();

  for (const repository of storedRepositories) {
    const repositoryKey = getRepositoryKey(repository);

    for (const mapping of activeMappings) {
      if (normalizeRemoteRepositoryKey(mapping.remoteUrl) !== repositoryKey) {
        continue;
      }

      matchedMappingIds.add(mapping.id);
      await input.store.updateRepoMappingGitHubRepositoryLink({
        githubInstallationId: repository.githubInstallationId,
        repoMappingId: mapping.id,
        repositoryExternalId: repository.repositoryExternalId,
        updatedAt: syncedAt,
        workspaceId: input.installation.workspaceId,
      });
    }
  }

  const auditInput: Parameters<typeof createAuditEventInsert>[0] = {
    createId: input.createAuditEventId ?? randomUUID,
    eventType: "github_repositories.synced",
    message: "GitHub repository metadata synced.",
    metadata: {
      githubAppInstallationId: input.installation.id,
      githubInstallationId: input.installation.githubInstallationId,
      matchedRepoMappingCount: matchedMappingIds.size,
      repositoryCount: storedRepositories.length,
    },
    now: () => syncedAt,
    workspaceId: input.installation.workspaceId,
  };

  if (input.actorId !== undefined) {
    auditInput.actorId = input.actorId;
  }

  await input.store.insertAuditEvent(createAuditEventInsert(auditInput));

  return {
    matchedRepoMappingCount: matchedMappingIds.size,
    skipped: false,
    syncedRepositoryCount: storedRepositories.length,
  };
};

export const createDrizzleGitHubRepositoryStore = (db: Database): GitHubRepositoryStore => ({
  findGitHubAppInstallation: async ({ githubInstallationId, workspaceId }) => {
    const conditions = [
      eq(schema.githubAppInstallations.githubInstallationId, githubInstallationId),
    ];

    if (workspaceId !== undefined) {
      conditions.push(eq(schema.githubAppInstallations.workspaceId, workspaceId));
    }

    const [installation] = await db
      .select({
        githubInstallationId: schema.githubAppInstallations.githubInstallationId,
        id: schema.githubAppInstallations.id,
        workspaceId: schema.githubAppInstallations.workspaceId,
      })
      .from(schema.githubAppInstallations)
      .where(and(...conditions))
      .limit(1);

    return installation ?? null;
  },
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
  insertAuditEvent: async (event) => {
    await db.insert(schema.auditEvents).values(event);
  },
  listActiveRepoMappingsForGitHubSync: async ({ workspaceId }) =>
    db
      .select({
        archivedAt: schema.repoMappings.archivedAt,
        githubInstallationId: schema.repoMappings.githubInstallationId,
        id: schema.repoMappings.id,
        remoteUrl: schema.repoMappings.remoteUrl,
        repositoryExternalId: schema.repoMappings.repositoryExternalId,
        workspaceId: schema.repoMappings.workspaceId,
      })
      .from(schema.repoMappings)
      .where(
        and(
          eq(schema.repoMappings.workspaceId, workspaceId),
          isNull(schema.repoMappings.archivedAt),
        ),
      ),
  listGitHubRepositories: async ({ workspaceId }) =>
    db
      .select()
      .from(schema.githubRepositories)
      .where(eq(schema.githubRepositories.workspaceId, workspaceId)),
  updateRepoMappingGitHubRepositoryLink: async ({
    githubInstallationId,
    repoMappingId,
    repositoryExternalId,
    updatedAt,
    workspaceId,
  }) => {
    await db
      .update(schema.repoMappings)
      .set({
        githubInstallationId,
        repositoryExternalId,
        updatedAt,
      })
      .where(
        and(
          eq(schema.repoMappings.id, repoMappingId),
          eq(schema.repoMappings.workspaceId, workspaceId),
          isNull(schema.repoMappings.archivedAt),
        ),
      );
  },
  upsertGitHubRepository: async ({ createRepositoryId, repository }) => {
    const repositoryId = repository.id ?? createRepositoryId();
    const createdAt = repository.createdAt ?? repository.updatedAt;
    const [upsertedRepository] = await db
      .insert(schema.githubRepositories)
      .values({
        ...repository,
        createdAt,
        id: repositoryId,
      })
      .onConflictDoUpdate({
        set: {
          archived: repository.archived,
          defaultBranch: repository.defaultBranch,
          disabled: repository.disabled,
          htmlUrl: repository.htmlUrl,
          isPrivate: repository.isPrivate,
          lastSyncedAt: repository.lastSyncedAt,
          repositoryFullName: repository.repositoryFullName,
          repositoryName: repository.repositoryName,
          repositoryOwner: repository.repositoryOwner,
          updatedAt: repository.updatedAt,
          visibility: repository.visibility,
        },
        target: [
          schema.githubRepositories.workspaceId,
          schema.githubRepositories.githubInstallationId,
          schema.githubRepositories.repositoryExternalId,
        ],
      })
      .returning();

    if (upsertedRepository === undefined) {
      throw new Error("GitHub repository upsert did not return a row.");
    }

    return upsertedRepository;
  },
});

export const createGitHubRepositoryService = (input: {
  createAuditEventId?: () => string;
  createRepositoryId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: GitHubRepositoryStore;
}): GitHubRepositoryService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    listGitHubRepositories: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const [repositories, mappings] = await Promise.all([
        input.store.listGitHubRepositories({ workspaceId: scope.workspaceId }),
        input.store.listActiveRepoMappingsForGitHubSync({ workspaceId: scope.workspaceId }),
      ]);

      return repositories.map((repository) => toRepositoryData(repository, mappings));
    },
    syncGitHubRepositoriesForInstallation: async (syncInput) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(syncInput.workspaceId);
      const normalizedInstallationId = normalizeGitHubNumericId(syncInput.githubInstallationId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const installation = await input.store.findGitHubAppInstallation({
        githubInstallationId: normalizedInstallationId,
        workspaceId: scope.workspaceId,
      });

      if (installation === null) {
        throw createActionError("validation_error");
      }

      return syncRepositories({
        actorId: scope.actorId,
        createAuditEventId: input.createAuditEventId,
        createRepositoryId: input.createRepositoryId,
        installation,
        now,
        repositories: syncInput.repositories,
        store: input.store,
      });
    },
    syncGitHubRepositoriesForWebhook: async (syncInput) => {
      const normalizedInstallationId = normalizeGitHubNumericId(syncInput.githubInstallationId);
      const installation = await input.store.findGitHubAppInstallation({
        githubInstallationId: normalizedInstallationId,
      });

      if (installation === null) {
        return {
          matchedRepoMappingCount: 0,
          skipped: true,
          syncedRepositoryCount: 0,
        };
      }

      return syncRepositories({
        createAuditEventId: input.createAuditEventId,
        createRepositoryId: input.createRepositoryId,
        installation,
        now,
        repositories: syncInput.repositories,
        store: input.store,
      });
    },
  };
};
