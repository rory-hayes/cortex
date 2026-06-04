import "server-only";

import {
  buildGitHubRepositoryInventory,
  reviewGitHubAppPermissions,
  type GitHubAppRequestFunction,
  type GitHubRepositoryInventory,
  type GitHubRepositoryInventoryRequest,
} from "@control-plane/github";
import { RepoScanInventorySchema, type RepoScanInventory } from "@control-plane/shared";

import {
  and,
  eq,
  schema,
  type Database,
  type GitHubAppInstallation,
  type GitHubRepository,
} from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createPublicGitHubRequestFunction } from "../github/public-request";
import { isPublicGitHubInstallationId } from "../github/public-repositories";
import { createActionError } from "../server/errors";
import { assertSafeWebBoundPayload } from "../security/payload-guard";

type GitHubInventoryRepositoryRow = Pick<
  GitHubRepository,
  | "archived"
  | "defaultBranch"
  | "disabled"
  | "githubAppInstallationId"
  | "githubInstallationId"
  | "id"
  | "isPrivate"
  | "repositoryName"
  | "repositoryOwner"
  | "workspaceId"
>;

type GitHubInventoryInstallationRow = Pick<
  GitHubAppInstallation,
  "githubInstallationId" | "id" | "permissions" | "suspendedAt" | "workspaceId"
>;

export type BuildGitHubRepositoryInventoryInput = {
  repoId: string;
  workspaceId: string;
};

export type GitHubRepositoryInventoryServiceMetadata = {
  allowlistedFileReadCount: number;
  githubInstallationId: string;
  hasTestDirectories: boolean;
  policyReadStatus: GitHubRepositoryInventory["policyReadStatus"];
  skippedOversizedFileCount: number;
  treeTruncated: boolean;
};

export type GitHubRepositoryInventoryServiceResult = {
  repoId: string;
  repository: {
    defaultBranch: string;
    name: string;
    owner: string;
  };
  repoScanInventory: RepoScanInventory;
  serviceMetadata: GitHubRepositoryInventoryServiceMetadata;
  workspaceId: string;
};

export type GitHubRepositoryInventoryStore = WorkspaceMembershipStore & {
  findGitHubAppInstallationForInventory: (input: {
    githubAppInstallationId: string;
    workspaceId: string;
  }) => Promise<GitHubInventoryInstallationRow | null>;
  findGitHubRepositoryForInventory: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<GitHubInventoryRepositoryRow | null>;
};

export type GitHubRepositoryInventoryBuilder = (
  input: GitHubRepositoryInventoryRequest,
) => Promise<GitHubRepositoryInventory>;

export type GitHubRepositoryInventoryService = {
  buildRepositoryInventory: (
    input: BuildGitHubRepositoryInventoryInput,
  ) => Promise<GitHubRepositoryInventoryServiceResult>;
};

const idPattern = /^[A-Za-z0-9._:-]+$/u;
const textMaxLength = 240;

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

const normalizeId = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > textMaxLength ||
    hasControlCharacter(normalizedValue) ||
    !idPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  assertSafePayload(normalizedValue);

  return normalizedValue;
};

const parseInstallationId = (value: string): number => {
  const normalizedValue = value.trim();

  if (!/^\d{1,15}$/u.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  const installationId = Number(normalizedValue);

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw createActionError("validation_error");
  }

  return installationId;
};

const assertScanOnlyPermissions = (permissions: Record<string, string>): void => {
  const review = reviewGitHubAppPermissions(permissions);
  const scanOnlyReview = review.profiles.scan_only;

  if (
    !scanOnlyReview.supported ||
    scanOnlyReview.excessPermissions.length > 0 ||
    review.rejectedPermissions.length > 0
  ) {
    throw createActionError("validation_error");
  }
};

const validateRepoScanInventory = (value: unknown): RepoScanInventory => {
  assertSafePayload(value);

  try {
    const inventory = RepoScanInventorySchema.parse(value);
    assertSafePayload(inventory);

    return inventory;
  } catch {
    throw createActionError("validation_error");
  }
};

const buildServiceResult = (input: {
  inventory: GitHubRepositoryInventory;
  installation: GitHubInventoryInstallationRow;
  repository: GitHubInventoryRepositoryRow;
  workspaceId: string;
}): GitHubRepositoryInventoryServiceResult => {
  const repoScanInventory = validateRepoScanInventory(input.inventory.repoScanInventory);
  const result: GitHubRepositoryInventoryServiceResult = {
    repoId: input.repository.id,
    repository: {
      defaultBranch: input.inventory.repository.defaultBranch,
      name: input.inventory.repository.name,
      owner: input.inventory.repository.owner,
    },
    repoScanInventory,
    serviceMetadata: {
      allowlistedFileReadCount: input.inventory.allowlistedFileReadSummary.readFileCount,
      githubInstallationId: input.installation.githubInstallationId,
      hasTestDirectories: input.inventory.treeSummary.hasTestDirectories,
      policyReadStatus: input.inventory.policyReadStatus,
      skippedOversizedFileCount:
        input.inventory.allowlistedFileReadSummary.skippedOversizedFileCount,
      treeTruncated: input.inventory.treeSummary.truncated,
    },
    workspaceId: input.workspaceId,
  };

  assertSafePayload(result);

  return result;
};

export const createDrizzleGitHubRepositoryInventoryStore = (
  db: Database,
): GitHubRepositoryInventoryStore => ({
  findGitHubAppInstallationForInventory: async ({ githubAppInstallationId, workspaceId }) => {
    const [installation] = await db
      .select({
        githubInstallationId: schema.githubAppInstallations.githubInstallationId,
        id: schema.githubAppInstallations.id,
        permissions: schema.githubAppInstallations.permissions,
        suspendedAt: schema.githubAppInstallations.suspendedAt,
        workspaceId: schema.githubAppInstallations.workspaceId,
      })
      .from(schema.githubAppInstallations)
      .where(
        and(
          eq(schema.githubAppInstallations.id, githubAppInstallationId),
          eq(schema.githubAppInstallations.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return installation ?? null;
  },
  findGitHubRepositoryForInventory: async ({ repoId, workspaceId }) => {
    const [repository] = await db
      .select({
        archived: schema.githubRepositories.archived,
        defaultBranch: schema.githubRepositories.defaultBranch,
        disabled: schema.githubRepositories.disabled,
        githubAppInstallationId: schema.githubRepositories.githubAppInstallationId,
        githubInstallationId: schema.githubRepositories.githubInstallationId,
        id: schema.githubRepositories.id,
        isPrivate: schema.githubRepositories.isPrivate,
        repositoryName: schema.githubRepositories.repositoryName,
        repositoryOwner: schema.githubRepositories.repositoryOwner,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .where(
        and(
          eq(schema.githubRepositories.id, repoId),
          eq(schema.githubRepositories.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return repository ?? null;
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
});

export const createGitHubRepositoryInventoryService = (input: {
  buildInventory?: GitHubRepositoryInventoryBuilder;
  getAuthContext?: GetAuthContext;
  publicRequest?: GitHubAppRequestFunction;
  request: GitHubAppRequestFunction;
  store: GitHubRepositoryInventoryStore;
}): GitHubRepositoryInventoryService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const buildInventory = input.buildInventory ?? buildGitHubRepositoryInventory;
  const publicRequest = input.publicRequest ?? createPublicGitHubRequestFunction();

  return {
    buildRepositoryInventory: async (buildInput) => {
      const workspaceId = normalizeId(buildInput.workspaceId);
      const repoId = normalizeId(buildInput.repoId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const repository = await input.store.findGitHubRepositoryForInventory({
        repoId,
        workspaceId: scope.workspaceId,
      });

      if (repository === null || repository.archived || repository.disabled) {
        throw createActionError("validation_error");
      }

      const installation = await input.store.findGitHubAppInstallationForInventory({
        githubAppInstallationId: repository.githubAppInstallationId,
        workspaceId: scope.workspaceId,
      });

      if (
        installation === null ||
        installation.suspendedAt !== null ||
        installation.githubInstallationId !== repository.githubInstallationId
      ) {
        throw createActionError("validation_error");
      }

      assertScanOnlyPermissions(installation.permissions);

      try {
        const isPublicSource = isPublicGitHubInstallationId(installation.githubInstallationId);

        if (isPublicSource && repository.isPrivate) {
          throw createActionError("validation_error");
        }

        const inventory = await buildInventory({
          defaultBranch: repository.defaultBranch,
          installationId: isPublicSource
            ? 1
            : parseInstallationId(installation.githubInstallationId),
          owner: repository.repositoryOwner,
          repo: repository.repositoryName,
          request: isPublicSource ? publicRequest : input.request,
        });

        return buildServiceResult({
          installation,
          inventory,
          repository,
          workspaceId: scope.workspaceId,
        });
      } catch {
        throw createActionError("validation_error");
      }
    },
  };
};
