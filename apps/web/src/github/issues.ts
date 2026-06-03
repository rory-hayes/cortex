import "server-only";

import { randomUUID } from "node:crypto";

import type { GitHubAppClient, GitHubIssueMetadata } from "@control-plane/github";
import {
  CortexTaskSchema,
  type CortexTask,
  type CortexTaskExternalLink,
} from "@control-plane/shared";

import {
  and,
  eq,
  schema,
  type CortexTaskExternalLinkRecord,
  type CortexTaskRecord,
  type Database,
  type GitHubRepository,
} from "../db";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import {
  assertSafeWebBoundPayload,
  hasUnsafePayloadPathText,
  hasUnsafePayloadText,
} from "../security/payload-guard";

type CortexTaskExternalLinkInsert = typeof schema.cortexTaskExternalLinks.$inferInsert;

export type GitHubIssueSyncRepository = Pick<
  GitHubRepository,
  | "archived"
  | "defaultBranch"
  | "disabled"
  | "githubInstallationId"
  | "id"
  | "repositoryFullName"
  | "repositoryName"
  | "repositoryOwner"
  | "workspaceId"
> & {
  installationPermissions: Record<string, string>;
};

export type GitHubIssueSyncTaskRecord = {
  externalLink: CortexTaskExternalLinkRecord | null;
  repository: GitHubIssueSyncRepository | null;
  task: CortexTaskRecord;
};

export type GitHubIssueSyncTaskOption = {
  existingGitHubIssueLink: {
    status: string;
    syncedAt: Date | null;
    title: string;
    url: string;
  } | null;
  executionMode: CortexTask["executionMode"];
  originType: CortexTask["origin"]["type"];
  repoId: string;
  repositoryFullName: string;
  riskLevel: CortexTask["riskLevel"];
  status: CortexTask["status"];
  taskId: string;
  title: string;
};

export type GitHubIssueSyncPageData = {
  tasks: GitHubIssueSyncTaskOption[];
  workspaceId: string;
};

export type SyncCortexTaskToGitHubIssueInput = {
  taskId: string;
  workspaceId: string;
};

export type SyncedGitHubIssueCortexTask = {
  action: "created" | "existing";
  externalLinkCount: number;
  issueId: string;
  issueNumber: number;
  status: string;
  taskId: string;
  workspaceId: string;
};

type CreateCortexTaskGitHubIssueExternalLinkWithAuditInput = {
  createAuditEvent: (input: {
    externalLinkCount: number;
    issue: GitHubIssueMetadata;
    link: CortexTaskExternalLink;
    task: CortexTaskRecord;
  }) => AuditEventInsert;
  createExternalLink: (issue: GitHubIssueMetadata) => CortexTaskExternalLink;
  createExternalLinkId: () => string;
  createIssue: (record: GitHubIssueSyncTaskRecord) => Promise<GitHubIssueMetadata>;
  taskId: string;
  updatedAt: Date;
  workspaceId: string;
};

export type GitHubIssueSyncStore = WorkspaceMembershipStore & {
  createCortexTaskGitHubIssueExternalLinkWithAudit: (
    input: CreateCortexTaskGitHubIssueExternalLinkWithAuditInput,
  ) => Promise<{
    action: "created" | "existing";
    externalLink: CortexTaskExternalLinkRecord;
    externalLinkCount: number;
    issue: GitHubIssueMetadata;
    task: CortexTaskRecord;
  } | null>;
  getApprovedScanCortexTaskForGitHubIssueSync: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<GitHubIssueSyncTaskRecord | null>;
  listApprovedScanCortexTasksForGitHubIssueSync: (input: {
    workspaceId: string;
  }) => Promise<GitHubIssueSyncTaskRecord[]>;
};

export type GitHubIssueSyncService = {
  listGitHubIssueSyncPageData: (input: { workspaceId: string }) => Promise<GitHubIssueSyncPageData>;
  syncCortexTaskToGitHubIssue: (
    input: SyncCortexTaskToGitHubIssueInput,
  ) => Promise<SyncedGitHubIssueCortexTask>;
};

const idMaxLength = 240;
const titleMaxLength = 240;
const bodyMaxLength = 5_000;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const envTextPattern = /(?:^|[\s"'`([{])\.env(?:\.[A-Za-z0-9_.-]+)?(?:$|[\s"'`)\]},.:;])/iu;
const secretUrlParameterPattern =
  /^(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)$/iu;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const hasBodyControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode === 10) {
      continue;
    }

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

const assertSafeText = (value: string, maxLength = bodyMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafePayloadText(normalizedValue) ||
    hasUnsafePayloadPathText(normalizedValue) ||
    envTextPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const assertSafeBodyText = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > bodyMaxLength ||
    hasBodyControlCharacter(normalizedValue) ||
    hasUnsafePayloadText(normalizedValue) ||
    envTextPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const assertSafeUrlText = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > 2_048 ||
    hasControlCharacter(normalizedValue) ||
    envTextPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeId = (value: string): string => {
  const normalizedValue = assertSafeText(value, idMaxLength);

  if (!idPattern.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeUrl = (value: string): string => {
  const normalizedValue = assertSafeUrlText(value);
  let url: URL;

  try {
    url = new URL(normalizedValue);
  } catch {
    throw createActionError("validation_error");
  }

  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw createActionError("validation_error");
  }

  for (const key of url.searchParams.keys()) {
    if (secretUrlParameterPattern.test(key)) {
      throw createActionError("validation_error");
    }
  }

  return url.toString();
};

const normalizeOptionalCortexAppBaseUrl = (value: string | undefined): string | null => {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const url = new URL(normalizeUrl(value));

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return url.toString();
};

const createCortexTaskUrl = (input: {
  cortexAppBaseUrl: string | null;
  taskId: string;
}): string | null => {
  if (input.cortexAppBaseUrl === null) {
    return null;
  }

  return normalizeUrl(
    new URL(
      `/dashboard/tasks/sync-github-issues?taskId=${encodeURIComponent(normalizeId(input.taskId))}`,
      input.cortexAppBaseUrl,
    ).toString(),
  );
};

const isEligibleScanTask = (task: CortexTaskRecord): boolean =>
  task.status === "approved" &&
  task.approvalStatus === "approved" &&
  (task.originType === "finding" || task.originType === "task_recommendation");

const assertEligibleScanTask = (task: CortexTaskRecord): void => {
  if (!isEligibleScanTask(task)) {
    throw createActionError("validation_error");
  }

  if (task.originType === "finding" && task.findingIds.length === 0) {
    throw createActionError("validation_error");
  }

  if (task.originType === "task_recommendation" && task.taskRecommendationId === null) {
    throw createActionError("validation_error");
  }
};

const hasGitHubIssueWritePermission = (permissions: Record<string, string>): boolean =>
  permissions.issues === "write" || permissions.issues === "admin";

const normalizeInstallationId = (value: string): number => {
  const id = Number(normalizeId(value));

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createActionError("validation_error");
  }

  return id;
};

const assertRepositoryCanCreateIssue = (repository: GitHubIssueSyncRepository): void => {
  if (
    repository.archived ||
    repository.disabled ||
    !hasGitHubIssueWritePermission(repository.installationPermissions)
  ) {
    throw createActionError("validation_error");
  }

  normalizeInstallationId(repository.githubInstallationId);
  for (const [permission, access] of Object.entries(repository.installationPermissions)) {
    if (!/^[a-z_]{1,80}$/u.test(permission) || !/^[a-z_]{1,40}$/u.test(access)) {
      throw createActionError("validation_error");
    }

    assertSafeText(permission, 80);
    assertSafeText(access, 40);
  }

  assertSafePayload({
    defaultBranch: repository.defaultBranch,
    githubInstallationId: repository.githubInstallationId,
    id: repository.id,
    repositoryFullName: repository.repositoryFullName,
    repositoryName: repository.repositoryName,
    repositoryOwner: repository.repositoryOwner,
  });
  [
    repository.defaultBranch,
    repository.githubInstallationId,
    repository.id,
    repository.repositoryFullName,
    repository.repositoryName,
    repository.repositoryOwner,
  ].forEach((value) => assertSafeText(value, titleMaxLength));
};

const assertTaskSafe = (input: {
  repository: GitHubIssueSyncRepository;
  task: CortexTaskRecord;
}): void => {
  try {
    CortexTaskSchema.parse({
      acceptanceCriteria: input.task.acceptanceCriteria,
      approvalStatus: input.task.approvalStatus,
      contractVersion: input.task.contractVersion,
      createdAt: input.task.createdAt.toISOString(),
      executionMode: input.task.executionMode,
      externalLinks: input.task.externalLinks,
      findingIds: input.task.findingIds,
      latestRunId: input.task.latestRunId ?? undefined,
      metadata: input.task.metadata,
      objective: input.task.objective,
      origin: {
        ...(input.task.originExternalId === null
          ? {}
          : { externalId: input.task.originExternalId }),
        ...(input.task.originExternalSystem === null
          ? {}
          : { externalSystem: input.task.originExternalSystem }),
        type: input.task.originType,
      },
      prArtifactIds: input.task.prArtifactIds,
      repoId: input.task.repoId,
      riskLevel: input.task.riskLevel,
      runIds: input.task.runIds,
      status: input.task.status,
      suggestedValidation: input.task.suggestedValidation,
      taskId: input.task.id,
      taskPacketId: input.task.taskPacketId ?? undefined,
      taskRecommendationId: input.task.taskRecommendationId ?? undefined,
      title: input.task.title,
      updatedAt: input.task.updatedAt.toISOString(),
      workspaceId: input.task.workspaceId,
    });
  } catch {
    throw createActionError("validation_error");
  }

  assertRepositoryCanCreateIssue(input.repository);
  assertSafePayload({
    acceptanceCriteria: input.task.acceptanceCriteria,
    findingIds: input.task.findingIds,
    metadata: input.task.metadata,
    objective: input.task.objective,
    originExternalId: input.task.originExternalId,
    originExternalSystem: input.task.originExternalSystem,
    repository: {
      defaultBranch: input.repository.defaultBranch,
      id: input.repository.id,
      repositoryFullName: input.repository.repositoryFullName,
      repositoryName: input.repository.repositoryName,
      repositoryOwner: input.repository.repositoryOwner,
    },
    suggestedValidation: input.task.suggestedValidation,
    title: input.task.title,
  });
  [
    input.task.title,
    input.task.objective,
    ...input.task.acceptanceCriteria,
    input.repository.defaultBranch,
    input.repository.repositoryFullName,
    input.repository.repositoryName,
    input.repository.repositoryOwner,
  ].forEach((value) => assertSafeText(value));
};

const normalizeTaskExternalLinks = (
  task: CortexTaskRecord,
  link: CortexTaskExternalLink,
): CortexTaskExternalLink[] => [
  ...task.externalLinks.filter(
    (item) => !(item.provider === "github" && item.resourceType === "github_issue"),
  ),
  link,
];

const taskExternalLinkFromRecord = (
  record: CortexTaskExternalLinkRecord,
): CortexTaskExternalLink => ({
  ...(record.externalId === null ? {} : { externalId: normalizeId(record.externalId) }),
  provider: record.provider,
  resourceType: record.resourceType,
  status: assertSafeText(record.externalStatus, 120),
  ...(record.syncedAt === null ? {} : { syncedAt: record.syncedAt.toISOString() }),
  title: assertSafeText(record.title, titleMaxLength),
  url: normalizeUrl(record.url),
});

const getExistingGitHubIssueExternalLink = (
  record: GitHubIssueSyncTaskRecord,
): CortexTaskExternalLink | null => {
  if (record.externalLink !== null) {
    return taskExternalLinkFromRecord(record.externalLink);
  }

  return (
    record.task.externalLinks.find(
      (link) => link.provider === "github" && link.resourceType === "github_issue",
    ) ?? null
  );
};

const issueTitle = (issue: GitHubIssueMetadata): string =>
  assertSafeText(`#${issue.number} ${issue.title}`, titleMaxLength);

const issueStatus = (issue: GitHubIssueMetadata): string => assertSafeText(issue.state, 120);

const stableExternalId = (input: { issue: GitHubIssueMetadata; repoId: string }): string =>
  `${normalizeId(input.repoId)}:${normalizeId(String(input.issue.id))}`;

const createGitHubExternalLink = (input: {
  issue: GitHubIssueMetadata;
  repoId: string;
  syncedAt: Date;
}): CortexTaskExternalLink => ({
  externalId: stableExternalId({
    issue: input.issue,
    repoId: input.repoId,
  }),
  provider: "github",
  resourceType: "github_issue",
  status: issueStatus(input.issue),
  syncedAt: input.syncedAt.toISOString(),
  title: issueTitle(input.issue),
  url: normalizeUrl(input.issue.htmlUrl),
});

const gitHubIssueMetadataFromExternalLink = (link: CortexTaskExternalLink): GitHubIssueMetadata => {
  const externalId = normalizeId(link.externalId ?? "");
  const issueId = Number(normalizeId(externalId.split(":").at(-1) ?? ""));
  const issueNumber = Number(
    assertSafeText(link.title, titleMaxLength).match(/^#(?<issueNumber>\d+)/u)?.groups
      ?.issueNumber ?? issueId,
  );

  if (!Number.isSafeInteger(issueId) || issueId <= 0 || !Number.isSafeInteger(issueNumber)) {
    throw createActionError("validation_error");
  }

  return {
    htmlUrl: normalizeUrl(link.url),
    id: issueId,
    number: issueNumber,
    state: issueStatusFromExternalLink(link.status),
    title: assertSafeText(link.title.replace(/^#\d+\s+/u, ""), titleMaxLength),
    ...(link.syncedAt === undefined ? {} : { updatedAt: link.syncedAt }),
  };
};

const issueStatusFromExternalLink = (value: string): GitHubIssueMetadata["state"] => {
  const status = assertSafeText(value, 120);

  if (status === "open" || status === "closed") {
    return status;
  }

  throw createActionError("validation_error");
};

const toTaskOption = (record: GitHubIssueSyncTaskRecord): GitHubIssueSyncTaskOption | null => {
  if (!isEligibleScanTask(record.task) || record.repository === null) {
    return null;
  }

  try {
    assertTaskSafe({ repository: record.repository, task: record.task });
  } catch {
    return null;
  }

  return {
    existingGitHubIssueLink:
      record.externalLink === null
        ? null
        : {
            status: assertSafeText(record.externalLink.externalStatus, 120),
            syncedAt: record.externalLink.syncedAt,
            title: assertSafeText(record.externalLink.title, titleMaxLength),
            url: normalizeUrl(record.externalLink.url),
          },
    executionMode: record.task.executionMode,
    originType: record.task.originType,
    repoId: normalizeId(record.task.repoId),
    repositoryFullName: assertSafeText(record.repository.repositoryFullName, titleMaxLength),
    riskLevel: record.task.riskLevel,
    status: record.task.status,
    taskId: normalizeId(record.task.id),
    title: assertSafeText(record.task.title, titleMaxLength),
  };
};

const createIssueBody = (input: {
  cortexTaskUrl: string | null;
  repository: GitHubIssueSyncRepository;
  task: CortexTaskRecord;
}): string => {
  assertTaskSafe(input);

  const lines = [
    `Cortex Task: ${assertSafeText(input.task.title, titleMaxLength)}`,
    "",
    `Objective: ${assertSafeText(input.task.objective)}`,
    "",
    "Acceptance criteria:",
    ...input.task.acceptanceCriteria.map((criterion) => `- ${assertSafeText(criterion)}`),
    "",
    `Risk: ${input.task.riskLevel}`,
    `Execution mode: ${input.task.executionMode}`,
    `Repository: ${assertSafeText(input.repository.repositoryFullName, titleMaxLength)}`,
    `Default branch: ${assertSafeText(input.repository.defaultBranch, titleMaxLength)}`,
    `Cortex task ID: ${normalizeId(input.task.id)}`,
  ];

  if (input.task.suggestedValidation.length > 0) {
    lines.push(
      `Suggested validation: ${input.task.suggestedValidation
        .map((validation) => assertSafeText(validation.label, titleMaxLength))
        .join(", ")}`,
    );
  }

  if (input.task.findingIds.length > 0) {
    lines.push(`Finding count: ${input.task.findingIds.length}`);
  }

  if (input.task.taskRecommendationId !== null) {
    lines.push("Task recommendation: linked");
  }

  if (input.cortexTaskUrl !== null) {
    lines.push(`Cortex URL: ${normalizeUrl(input.cortexTaskUrl)}`);
  }

  return assertSafeBodyText(lines.join("\n"));
};

const toExternalLinkInsert = (input: {
  createExternalLinkId: () => string;
  link: CortexTaskExternalLink;
  repoId: string;
  taskId: string;
  workspaceId: string;
}): CortexTaskExternalLinkInsert => ({
  cortexTaskId: normalizeId(input.taskId),
  externalId: input.link.externalId ?? null,
  externalStatus: assertSafeText(input.link.status, 120),
  id: normalizeId(input.createExternalLinkId()),
  metadata: {},
  provider: "github",
  repoId: normalizeId(input.repoId),
  resourceType: "github_issue",
  syncedAt: input.link.syncedAt === undefined ? null : new Date(input.link.syncedAt),
  title: assertSafeText(input.link.title, titleMaxLength),
  url: normalizeUrl(input.link.url),
  workspaceId: normalizeId(input.workspaceId),
});

const createAuditMetadata = (input: {
  action: SyncedGitHubIssueCortexTask["action"];
  externalId: string;
  externalLinkCount: number;
  issue: GitHubIssueMetadata;
  repository: GitHubIssueSyncRepository;
  syncedAt: Date;
  task: CortexTaskRecord;
}): Record<string, unknown> => {
  const metadata = {
    action: input.action,
    acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
    executionMode: input.task.executionMode,
    externalId: normalizeId(input.externalId),
    externalLinkCount: input.externalLinkCount,
    externalLinkProviders: ["github"],
    findingCount: input.task.findingIds.length,
    githubInstallationId: normalizeId(input.repository.githubInstallationId),
    issueId: normalizeId(String(input.issue.id)),
    issueNumber: input.issue.number,
    repoId: normalizeId(input.task.repoId),
    repositoryFullName: assertSafeText(input.repository.repositoryFullName, titleMaxLength),
    riskLevel: input.task.riskLevel,
    status: issueStatus(input.issue),
    syncedAt: input.syncedAt.toISOString(),
    taskId: normalizeId(input.task.id),
    taskRecommendationId:
      input.task.taskRecommendationId === null
        ? null
        : normalizeId(input.task.taskRecommendationId),
  };

  assertSafePayload(metadata);

  return metadata;
};

export const createDrizzleGitHubIssueSyncStore = (db: Database): GitHubIssueSyncStore => {
  const getTaskRecord = async (input: {
    task: CortexTaskRecord;
  }): Promise<GitHubIssueSyncTaskRecord> => {
    const [repository] = await db
      .select({
        archived: schema.githubRepositories.archived,
        defaultBranch: schema.githubRepositories.defaultBranch,
        disabled: schema.githubRepositories.disabled,
        githubInstallationId: schema.githubRepositories.githubInstallationId,
        id: schema.githubRepositories.id,
        installationPermissions: schema.githubAppInstallations.permissions,
        repositoryFullName: schema.githubRepositories.repositoryFullName,
        repositoryName: schema.githubRepositories.repositoryName,
        repositoryOwner: schema.githubRepositories.repositoryOwner,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .innerJoin(
        schema.githubAppInstallations,
        eq(schema.githubRepositories.githubAppInstallationId, schema.githubAppInstallations.id),
      )
      .where(
        and(
          eq(schema.githubRepositories.id, input.task.repoId),
          eq(schema.githubRepositories.workspaceId, input.task.workspaceId),
          eq(schema.githubAppInstallations.workspaceId, input.task.workspaceId),
        ),
      )
      .limit(1);
    const [externalLink] = await db
      .select()
      .from(schema.cortexTaskExternalLinks)
      .where(
        and(
          eq(schema.cortexTaskExternalLinks.workspaceId, input.task.workspaceId),
          eq(schema.cortexTaskExternalLinks.cortexTaskId, input.task.id),
          eq(schema.cortexTaskExternalLinks.provider, "github"),
          eq(schema.cortexTaskExternalLinks.resourceType, "github_issue"),
        ),
      )
      .limit(1);

    return {
      externalLink: externalLink ?? null,
      repository: repository ?? null,
      task: input.task,
    };
  };

  return {
    createCortexTaskGitHubIssueExternalLinkWithAudit: async ({
      createAuditEvent,
      createExternalLink,
      createExternalLinkId,
      createIssue,
      taskId,
      updatedAt,
      workspaceId,
    }) =>
      db.transaction(async (tx) => {
        const [task] = await tx
          .select()
          .from(schema.cortexTasks)
          .where(
            and(eq(schema.cortexTasks.id, taskId), eq(schema.cortexTasks.workspaceId, workspaceId)),
          )
          .limit(1)
          .for("update");

        if (task === undefined) {
          return null;
        }

        const [repository] = await tx
          .select({
            archived: schema.githubRepositories.archived,
            defaultBranch: schema.githubRepositories.defaultBranch,
            disabled: schema.githubRepositories.disabled,
            githubInstallationId: schema.githubRepositories.githubInstallationId,
            id: schema.githubRepositories.id,
            installationPermissions: schema.githubAppInstallations.permissions,
            repositoryFullName: schema.githubRepositories.repositoryFullName,
            repositoryName: schema.githubRepositories.repositoryName,
            repositoryOwner: schema.githubRepositories.repositoryOwner,
            workspaceId: schema.githubRepositories.workspaceId,
          })
          .from(schema.githubRepositories)
          .innerJoin(
            schema.githubAppInstallations,
            eq(schema.githubRepositories.githubAppInstallationId, schema.githubAppInstallations.id),
          )
          .where(
            and(
              eq(schema.githubRepositories.id, task.repoId),
              eq(schema.githubRepositories.workspaceId, task.workspaceId),
              eq(schema.githubAppInstallations.workspaceId, task.workspaceId),
            ),
          )
          .limit(1);

        const [existingExternalLink] = await tx
          .select()
          .from(schema.cortexTaskExternalLinks)
          .where(
            and(
              eq(schema.cortexTaskExternalLinks.workspaceId, task.workspaceId),
              eq(schema.cortexTaskExternalLinks.cortexTaskId, task.id),
              eq(schema.cortexTaskExternalLinks.provider, "github"),
              eq(schema.cortexTaskExternalLinks.resourceType, "github_issue"),
            ),
          )
          .limit(1);

        const taskRecord = {
          externalLink: existingExternalLink ?? null,
          repository: repository ?? null,
          task,
        };

        if (taskRecord.repository === null) {
          throw createActionError("validation_error");
        }

        assertEligibleScanTask(taskRecord.task);
        assertTaskSafe({
          repository: taskRecord.repository,
          task: taskRecord.task,
        });

        const existingLink = getExistingGitHubIssueExternalLink(taskRecord);

        if (existingLink !== null) {
          const taskExternalLinks = normalizeTaskExternalLinks(taskRecord.task, existingLink);
          const externalLinkCount = taskExternalLinks.filter(
            (item) => item.provider === "github" && item.resourceType === "github_issue",
          ).length;
          let storedExternalLink = existingExternalLink;

          if (storedExternalLink === undefined) {
            const externalLinkInsert = toExternalLinkInsert({
              createExternalLinkId,
              link: existingLink,
              repoId: taskRecord.task.repoId,
              taskId: taskRecord.task.id,
              workspaceId,
            });
            [storedExternalLink] = await tx
              .insert(schema.cortexTaskExternalLinks)
              .values(externalLinkInsert)
              .returning();
          }

          if (storedExternalLink === undefined) {
            throw new Error("GitHub issue task sync existing external link did not return a row.");
          }

          return {
            action: "existing" as const,
            externalLink: storedExternalLink,
            externalLinkCount,
            issue: gitHubIssueMetadataFromExternalLink(existingLink),
            task: taskRecord.task,
          };
        }

        const issue = await createIssue(taskRecord);
        const link = createExternalLink(issue);
        const taskExternalLinks = normalizeTaskExternalLinks(taskRecord.task, link);
        const externalLinkCount = taskExternalLinks.filter(
          (item) => item.provider === "github" && item.resourceType === "github_issue",
        ).length;
        const [updatedTask] = await tx
          .update(schema.cortexTasks)
          .set({
            externalLinks: taskExternalLinks,
            updatedAt,
          })
          .where(
            and(eq(schema.cortexTasks.id, taskId), eq(schema.cortexTasks.workspaceId, workspaceId)),
          )
          .returning();

        if (updatedTask === undefined) {
          return null;
        }

        const externalLinkInsert = toExternalLinkInsert({
          createExternalLinkId,
          link,
          repoId: taskRecord.task.repoId,
          taskId: taskRecord.task.id,
          workspaceId,
        });

        if (externalLinkInsert.externalId === null || externalLinkInsert.externalId === undefined) {
          throw new Error("GitHub issue task sync external link is missing an external id.");
        }

        const externalId = externalLinkInsert.externalId;
        const [matchingExternalLink] = await tx
          .select()
          .from(schema.cortexTaskExternalLinks)
          .where(
            and(
              eq(schema.cortexTaskExternalLinks.workspaceId, workspaceId),
              eq(schema.cortexTaskExternalLinks.provider, "github"),
              eq(schema.cortexTaskExternalLinks.resourceType, "github_issue"),
              eq(schema.cortexTaskExternalLinks.externalId, externalId),
            ),
          )
          .limit(1);

        const [storedExternalLink] =
          matchingExternalLink === undefined
            ? await tx.insert(schema.cortexTaskExternalLinks).values(externalLinkInsert).returning()
            : await tx
                .update(schema.cortexTaskExternalLinks)
                .set({
                  cortexTaskId: externalLinkInsert.cortexTaskId,
                  externalStatus: externalLinkInsert.externalStatus,
                  metadata: externalLinkInsert.metadata,
                  repoId: externalLinkInsert.repoId,
                  syncedAt: externalLinkInsert.syncedAt,
                  title: externalLinkInsert.title,
                  updatedAt,
                  url: externalLinkInsert.url,
                })
                .where(eq(schema.cortexTaskExternalLinks.id, matchingExternalLink.id))
                .returning();

        if (storedExternalLink === undefined) {
          throw new Error("GitHub issue task sync external link upsert did not return a row.");
        }

        await tx.insert(schema.auditEvents).values(
          createAuditEvent({
            externalLinkCount,
            issue,
            link,
            task: taskRecord.task,
          }),
        );

        return {
          action: "created" as const,
          externalLink: storedExternalLink,
          externalLinkCount,
          issue,
          task: updatedTask,
        };
      }),
    findWorkspaceMembership: async ({ userId, workspaceId }) => {
      const [membership] = await db
        .select({
          id: schema.memberships.id,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.workspaceId, workspaceId),
            eq(schema.memberships.userId, userId),
          ),
        )
        .limit(1);

      return membership ?? null;
    },
    getApprovedScanCortexTaskForGitHubIssueSync: async ({ taskId, workspaceId }) => {
      const [task] = await db
        .select()
        .from(schema.cortexTasks)
        .where(
          and(eq(schema.cortexTasks.id, taskId), eq(schema.cortexTasks.workspaceId, workspaceId)),
        )
        .limit(1);

      return task === undefined ? null : getTaskRecord({ task });
    },
    listApprovedScanCortexTasksForGitHubIssueSync: async ({ workspaceId }) => {
      const tasks = await db
        .select()
        .from(schema.cortexTasks)
        .where(eq(schema.cortexTasks.workspaceId, workspaceId));

      return Promise.all(tasks.map((task) => getTaskRecord({ task })));
    },
  };
};

export const createGitHubIssueSyncService = (input: {
  createAuditEventId?: () => string;
  createExternalLinkId?: () => string;
  cortexAppBaseUrl?: string;
  getAuthContext?: GetAuthContext;
  githubClient: GitHubAppClient;
  now?: () => Date;
  store: GitHubIssueSyncStore;
}): GitHubIssueSyncService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createExternalLinkId = input.createExternalLinkId ?? randomUUID;
  const cortexAppBaseUrl = normalizeOptionalCortexAppBaseUrl(input.cortexAppBaseUrl);
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    listGitHubIssueSyncPageData: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const taskRecords = await input.store.listApprovedScanCortexTasksForGitHubIssueSync({
        workspaceId: scope.workspaceId,
      });
      const tasks = taskRecords
        .map(toTaskOption)
        .filter((task): task is GitHubIssueSyncTaskOption => task !== null);

      return {
        tasks,
        workspaceId: scope.workspaceId,
      };
    },
    syncCortexTaskToGitHubIssue: async (syncInput) => {
      const workspaceId = normalizeId(syncInput.workspaceId);
      const taskId = normalizeId(syncInput.taskId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const taskRecord = await input.store.getApprovedScanCortexTaskForGitHubIssueSync({
        taskId,
        workspaceId: scope.workspaceId,
      });
      const currentTime = now();

      if (taskRecord === null || taskRecord.repository === null) {
        throw createActionError("validation_error");
      }

      assertEligibleScanTask(taskRecord.task);
      assertTaskSafe({ repository: taskRecord.repository, task: taskRecord.task });

      const cortexTaskUrl = createCortexTaskUrl({
        cortexAppBaseUrl,
        taskId: taskRecord.task.id,
      });
      const persisted = await input.store.createCortexTaskGitHubIssueExternalLinkWithAudit({
        createAuditEvent: ({ externalLinkCount, issue, link, task }) => {
          if (taskRecord.repository === null) {
            throw createActionError("validation_error");
          }

          return createAuditEventInsert({
            actorId: scope.actorId,
            createId: createAuditEventId,
            eventType: "github.issue.cortex_task_synced",
            message: "Cortex Task synced to GitHub Issues.",
            metadata: createAuditMetadata({
              action: "created",
              externalId: link.externalId ?? "",
              externalLinkCount,
              issue,
              repository: taskRecord.repository,
              syncedAt: currentTime,
              task,
            }),
            now: () => currentTime,
            taskId: task.id,
            workspaceId: scope.workspaceId,
          });
        },
        createExternalLink: (issue) =>
          createGitHubExternalLink({
            issue,
            repoId: taskRecord.task.repoId,
            syncedAt: currentTime,
          }),
        createExternalLinkId,
        createIssue: async (lockedTaskRecord) => {
          if (lockedTaskRecord.repository === null) {
            throw createActionError("validation_error");
          }

          assertEligibleScanTask(lockedTaskRecord.task);
          assertTaskSafe({
            repository: lockedTaskRecord.repository,
            task: lockedTaskRecord.task,
          });

          return input.githubClient.createIssue({
            body: createIssueBody({
              cortexTaskUrl,
              repository: lockedTaskRecord.repository,
              task: lockedTaskRecord.task,
            }),
            installationId: normalizeInstallationId(
              lockedTaskRecord.repository.githubInstallationId,
            ),
            owner: assertSafeText(lockedTaskRecord.repository.repositoryOwner, titleMaxLength),
            repo: assertSafeText(lockedTaskRecord.repository.repositoryName, titleMaxLength),
            title: assertSafeText(lockedTaskRecord.task.title, titleMaxLength),
          });
        },
        taskId: taskRecord.task.id,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (persisted === null) {
        throw createActionError("validation_error");
      }

      return {
        action: persisted.action,
        externalLinkCount: persisted.externalLinkCount,
        issueId: normalizeId(String(persisted.issue.id)),
        issueNumber: persisted.issue.number,
        status: issueStatus(persisted.issue),
        taskId: persisted.task.id,
        workspaceId: scope.workspaceId,
      };
    },
  };
};
