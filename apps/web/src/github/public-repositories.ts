import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, schema, type Database, type GitHubRepository } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import { assertSafeWebBoundPayload } from "../security/payload-guard";

export const PUBLIC_GITHUB_INSTALLATION_ID_PREFIX = "public:";

type PublicGitHubOwnerMetadata = {
  html_url?: string | null;
  id: number | string;
  login: string;
  type?: string | null;
};

export type PublicGitHubRepositoryMetadata = {
  archived?: boolean | null;
  default_branch?: string | null;
  disabled?: boolean | null;
  full_name: string;
  html_url?: string | null;
  id: number | string;
  name: string;
  owner: PublicGitHubOwnerMetadata;
  private: boolean;
  visibility?: string | null;
};

export type PublicGitHubRepositoryLocator = {
  name: string;
  owner: string;
};

export type RegisterPublicGitHubRepositoryInput = {
  repositoryUrl: string;
  workspaceId: string;
};

export type RegisteredPublicGitHubRepository = {
  githubInstallationId: string;
  repoId: string;
  repositoryFullName: string;
  workspaceId: string;
};

type PublicGitHubInstallationInsert = typeof schema.githubAppInstallations.$inferInsert;
type PublicGitHubRepositoryInsert = Omit<
  typeof schema.githubRepositories.$inferInsert,
  "createdAt" | "id"
> & {
  createdAt?: Date;
  id?: string;
};

export type PublicGitHubRepositoryStore = WorkspaceMembershipStore & {
  upsertPublicGitHubRepositorySource: (input: {
    createAuditEvent: (repository: GitHubRepository) => AuditEventInsert;
    createRepositoryId: () => string;
    installation: PublicGitHubInstallationInsert;
    repository: PublicGitHubRepositoryInsert;
  }) => Promise<GitHubRepository>;
};

export type PublicGitHubRepositoryService = {
  registerPublicGitHubRepository: (
    input: RegisterPublicGitHubRepositoryInput,
  ) => Promise<RegisteredPublicGitHubRepository>;
};

const textMaxLength = 240;
const urlMaxLength = 512;
const repositoryPartMaxLength = 100;
const branchMaxLength = 256;
const idPattern = /^[A-Za-z0-9._:-]+$/u;

export const isPublicGitHubInstallationId = (value: string): boolean =>
  value.startsWith(PUBLIC_GITHUB_INSTALLATION_ID_PREFIX);

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const assertSafePayload = (value: unknown): void => {
  try {
    assertSafeWebBoundPayload(value);
  } catch {
    throw createActionError("validation_error");
  }
};

const assertSafeText = (value: string, maxLength = textMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    /diff\s+--git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}/iu.test(
      normalizedValue,
    )
  ) {
    throw createActionError("validation_error");
  }

  assertSafePayload(normalizedValue);

  return normalizedValue;
};

const normalizeId = (value: string): string => {
  const normalizedValue = assertSafeText(value);

  if (!idPattern.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

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
  const normalizedValue = assertSafeText(value, repositoryPartMaxLength);

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
  const normalizedValue = assertSafeText(value, 220);
  const expected = `${owner}/${name}`;

  if (normalizedValue !== expected) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeBranchName = (value: string | null | undefined): string => {
  const normalizedValue = assertSafeText(value ?? "unknown", branchMaxLength);

  if (
    normalizedValue.startsWith("-") ||
    normalizedValue.startsWith("/") ||
    normalizedValue.endsWith("/") ||
    normalizedValue.endsWith(".") ||
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

  const normalizedValue = assertSafeText(value, urlMaxLength);

  try {
    const url = new URL(normalizedValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      Boolean(url.username || url.password) ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw createActionError("validation_error");
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

  const normalizedValue = assertSafeText(value, 40);

  if (
    normalizedValue !== "public" &&
    normalizedValue !== "private" &&
    normalizedValue !== "internal"
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeAccountType = (value: string | null | undefined): string =>
  assertSafeText(value ?? "User", 40);

const parsePathParts = (pathname: string): PublicGitHubRepositoryLocator => {
  const pathParts = pathname.replace(/^\/+/u, "").split("/");

  if (pathParts.length !== 2) {
    throw createActionError("validation_error");
  }

  const owner = normalizeRepositoryPart(pathParts[0] ?? "");
  const name = normalizeRepositoryPart((pathParts[1] ?? "").replace(/\.git$/u, ""));

  return { name, owner };
};

export const parsePublicGitHubRepositoryUrl = (value: string): PublicGitHubRepositoryLocator => {
  const normalizedValue = assertSafeText(value, urlMaxLength);
  const scpLikeMatch = normalizedValue.match(
    /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/u,
  );

  if (scpLikeMatch !== null) {
    return {
      name: normalizeRepositoryPart(scpLikeMatch[2] ?? ""),
      owner: normalizeRepositoryPart(scpLikeMatch[1] ?? ""),
    };
  }

  let url: URL;

  try {
    url = new URL(normalizedValue);
  } catch {
    throw createActionError("validation_error");
  }

  if (
    url.hostname.toLowerCase() !== "github.com" ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    Boolean(url.username || url.password) ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw createActionError("validation_error");
  }

  return parsePathParts(url.pathname);
};

const buildPublicGitHubApiUrl = (input: PublicGitHubRepositoryLocator): string =>
  `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(
    input.name,
  )}`;

export const fetchPublicGitHubRepositoryMetadata = async (
  input: PublicGitHubRepositoryLocator,
): Promise<PublicGitHubRepositoryMetadata> => {
  const response = await fetch(buildPublicGitHubApiUrl(input), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cortex-public-repo-readiness",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    method: "GET",
  });

  if (!response.ok) {
    throw createActionError("validation_error");
  }

  try {
    return (await response.json()) as PublicGitHubRepositoryMetadata;
  } catch {
    throw createActionError("validation_error");
  }
};

const toRegistrationRows = (input: {
  metadata: PublicGitHubRepositoryMetadata;
  syncedAt: Date;
  workspaceId: string;
}): {
  githubInstallationId: string;
  installation: PublicGitHubInstallationInsert;
  repository: PublicGitHubRepositoryInsert;
  repositoryFullName: string;
} => {
  const repositoryOwner = normalizeRepositoryPart(input.metadata.owner.login);
  const repositoryName = normalizeRepositoryPart(input.metadata.name);
  const repositoryExternalId = normalizeGitHubNumericId(input.metadata.id);
  const repositoryFullName = normalizeFullName(
    input.metadata.full_name,
    repositoryOwner,
    repositoryName,
  );
  const githubInstallationId = `${PUBLIC_GITHUB_INSTALLATION_ID_PREFIX}${repositoryExternalId}`;
  const githubAppInstallationId = `github_app_installation_public:${input.workspaceId}:${repositoryExternalId}`;

  if (input.metadata.private || normalizeVisibility(input.metadata.visibility) === "private") {
    throw createActionError("validation_error");
  }

  return {
    githubInstallationId,
    installation: {
      accountHtmlUrl: normalizeOptionalUrl(input.metadata.owner.html_url ?? null),
      accountId: normalizeGitHubNumericId(input.metadata.owner.id),
      accountLogin: repositoryOwner,
      accountType: normalizeAccountType(input.metadata.owner.type),
      githubInstallationId,
      id: githubAppInstallationId,
      installationHtmlUrl: null,
      lastSyncedAt: input.syncedAt,
      permissions: {
        contents: "read",
        metadata: "read",
      },
      repositorySelection: "selected",
      updatedAt: input.syncedAt,
      workspaceId: input.workspaceId,
    },
    repository: {
      archived: input.metadata.archived === true,
      defaultBranch: normalizeBranchName(input.metadata.default_branch),
      disabled: input.metadata.disabled === true,
      githubAppInstallationId,
      githubInstallationId,
      htmlUrl: normalizeOptionalUrl(input.metadata.html_url ?? null),
      isPrivate: false,
      lastSyncedAt: input.syncedAt,
      repositoryExternalId,
      repositoryFullName,
      repositoryName,
      repositoryOwner,
      updatedAt: input.syncedAt,
      visibility: "public",
      workspaceId: input.workspaceId,
    },
    repositoryFullName,
  };
};

export const createDrizzlePublicGitHubRepositoryStore = (
  db: Database,
): PublicGitHubRepositoryStore => ({
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
  upsertPublicGitHubRepositorySource: async ({
    createAuditEvent,
    createRepositoryId,
    installation,
    repository,
  }) =>
    db.transaction(async (tx) => {
      await tx
        .insert(schema.githubAppInstallations)
        .values(installation)
        .onConflictDoUpdate({
          set: {
            accountHtmlUrl: installation.accountHtmlUrl,
            accountId: installation.accountId,
            accountLogin: installation.accountLogin,
            accountType: installation.accountType,
            lastSyncedAt: installation.lastSyncedAt,
            permissions: installation.permissions,
            repositorySelection: installation.repositorySelection,
            suspendedAt: null,
            updatedAt: installation.updatedAt,
          },
          target: [
            schema.githubAppInstallations.workspaceId,
            schema.githubAppInstallations.githubInstallationId,
          ],
        });

      const [upsertedRepository] = await tx
        .insert(schema.githubRepositories)
        .values({
          ...repository,
          createdAt: repository.createdAt ?? repository.updatedAt,
          id: repository.id ?? createRepositoryId(),
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
        throw new Error("Public GitHub repository upsert did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(createAuditEvent(upsertedRepository));

      return upsertedRepository;
    }),
});

export const createPublicGitHubRepositoryService = (input: {
  createAuditEventId?: () => string;
  createRepositoryId?: () => string;
  fetchRepositoryMetadata?: (
    input: PublicGitHubRepositoryLocator,
  ) => Promise<PublicGitHubRepositoryMetadata>;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: PublicGitHubRepositoryStore;
}): PublicGitHubRepositoryService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createRepositoryId = input.createRepositoryId ?? randomUUID;
  const fetchRepositoryMetadata =
    input.fetchRepositoryMetadata ?? fetchPublicGitHubRepositoryMetadata;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    registerPublicGitHubRepository: async (registerInput) => {
      const workspaceId = normalizeId(registerInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const locator = parsePublicGitHubRepositoryUrl(registerInput.repositoryUrl);
      const metadata = await fetchRepositoryMetadata(locator);
      const syncedAt = now();
      const rows = toRegistrationRows({
        metadata,
        syncedAt,
        workspaceId: scope.workspaceId,
      });
      const repository = await input.store.upsertPublicGitHubRepositorySource({
        createAuditEvent: (repositoryRow) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: createAuditEventId,
            eventType: "github_repositories.public_registered",
            message: "Public GitHub repository metadata registered.",
            metadata: {
              githubInstallationId: rows.githubInstallationId,
              repoId: repositoryRow.id,
              repositoryFullName: rows.repositoryFullName,
            },
            now: () => syncedAt,
            workspaceId: scope.workspaceId,
          }),
        createRepositoryId,
        installation: rows.installation,
        repository: rows.repository,
      });
      const result: RegisteredPublicGitHubRepository = {
        githubInstallationId: rows.githubInstallationId,
        repoId: repository.id,
        repositoryFullName: repository.repositoryFullName,
        workspaceId: scope.workspaceId,
      };

      assertSafePayload(result);

      return result;
    },
  };
};
