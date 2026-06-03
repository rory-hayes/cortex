import "server-only";

import { randomUUID } from "node:crypto";

import type {
  LinearIssueSyncMetadata,
  LinearProjectOption,
  LinearTeamOption,
  LinearWorkflowStateOption,
} from "@control-plane/linear";
import {
  CortexTaskSchema,
  type CortexTask,
  type CortexTaskExternalLink,
} from "@control-plane/shared";

import {
  and,
  eq,
  isNull,
  schema,
  sql,
  type CortexTaskExternalLinkRecord,
  type CortexTaskRecord,
  type Database,
  type GitHubRepository,
} from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import {
  assertSafeWebBoundPayload,
  hasUnsafePayloadPathText,
  hasUnsafePayloadText,
} from "../security/payload-guard";
import {
  createEnvLinearOAuthCredentialUnsealer,
  type LinearOAuthCredentialUnsealer,
} from "./oauth";
import { createLinearTaskSyncClient, type LinearTaskSyncClient } from "./task-sync-client";

type LinearOAuthConnectionRow = typeof schema.linearOAuthConnections.$inferSelect;
type CortexTaskExternalLinkInsert = typeof schema.cortexTaskExternalLinks.$inferInsert;

export type LinearTaskSyncConnection = Pick<
  LinearOAuthConnectionRow,
  | "accessTokenCiphertext"
  | "accessTokenKeyId"
  | "expiresAt"
  | "id"
  | "linearWorkspaceId"
  | "linearWorkspaceName"
  | "revokedAt"
  | "workspaceId"
>;

export type LinearTaskSyncConnectionOption = Pick<
  LinearTaskSyncConnection,
  "id" | "linearWorkspaceId" | "linearWorkspaceName"
>;

export type LinearTaskSyncRepository = Pick<
  GitHubRepository,
  | "defaultBranch"
  | "htmlUrl"
  | "id"
  | "repositoryFullName"
  | "repositoryName"
  | "repositoryOwner"
  | "workspaceId"
>;

export type LinearTaskSyncTaskRecord = {
  externalLink: CortexTaskExternalLinkRecord | null;
  repository: LinearTaskSyncRepository | null;
  task: CortexTaskRecord;
};

export type LinearTaskSyncTaskOption = {
  existingLinearLink: {
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

export type ListLinearTaskSyncPageDataInput = {
  linearConnectionId?: string;
  workspaceId: string;
};

export type LinearTaskSyncPageData = {
  connections: LinearTaskSyncConnectionOption[];
  projects: LinearProjectOption[];
  selectedConnectionId: string | null;
  tasks: LinearTaskSyncTaskOption[];
  teams: LinearTeamOption[];
  workflowStates: LinearWorkflowStateOption[];
  workspaceId: string;
};

export type SyncCortexTaskToLinearInput = {
  linearConnectionId: string;
  projectId?: string;
  statusId?: string;
  taskId: string;
  teamId: string;
  workspaceId: string;
};

export type SyncedLinearCortexTask = {
  action: "created" | "updated";
  externalLinkCount: number;
  issueIdentifier: string;
  issueId: string;
  linearConnectionId: string;
  status: string;
  taskId: string;
  workspaceId: string;
};

type CreateCortexTaskLinearExternalLinkWithAuditInput = {
  createAuditEvent: (input: {
    externalLinkCount: number;
    issue: LinearIssueSyncMetadata;
    link: CortexTaskExternalLink;
    task: CortexTaskRecord;
  }) => AuditEventInsert;
  createExternalLink: (issue: LinearIssueSyncMetadata) => CortexTaskExternalLink;
  createExternalLinkId: () => string;
  createIssue: (record: LinearTaskSyncTaskRecord) => Promise<LinearIssueSyncMetadata>;
  taskId: string;
  updatedAt: Date;
  workspaceId: string;
};

export type LinearTaskSyncStore = WorkspaceMembershipStore & {
  createCortexTaskLinearExternalLinkWithAudit: (
    input: CreateCortexTaskLinearExternalLinkWithAuditInput,
  ) => Promise<{
    action: "created" | "existing";
    externalLink: CortexTaskExternalLinkRecord;
    externalLinkCount: number;
    issue: LinearIssueSyncMetadata;
    task: CortexTaskRecord;
  } | null>;
  findActiveLinearConnectionForSync: (input: {
    linearConnectionId: string;
    now: Date;
    workspaceId: string;
  }) => Promise<LinearTaskSyncConnection | null>;
  getApprovedScanCortexTaskForLinearSync: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<LinearTaskSyncTaskRecord | null>;
  listActiveLinearConnections: (input: {
    now: Date;
    workspaceId: string;
  }) => Promise<LinearTaskSyncConnection[]>;
  listApprovedScanCortexTasksForLinearSync: (input: {
    workspaceId: string;
  }) => Promise<LinearTaskSyncTaskRecord[]>;
  upsertCortexTaskLinearExternalLinkWithAudit: (input: {
    auditEvent: AuditEventInsert;
    externalLink: CortexTaskExternalLinkInsert;
    taskExternalLinks: CortexTaskExternalLink[];
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<{
    externalLink: CortexTaskExternalLinkRecord;
    task: CortexTaskRecord;
  } | null>;
  upsertCortexTaskLinearExternalLinkStatusWithAudit: (input: {
    auditEvent: AuditEventInsert;
    externalLink: CortexTaskExternalLinkInsert;
    taskExternalLinks: CortexTaskExternalLink[];
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<{
    externalLink: CortexTaskExternalLinkRecord;
    task: CortexTaskRecord;
  } | null>;
};

export type LinearTaskSyncService = {
  listLinearTaskSyncPageData: (
    input: ListLinearTaskSyncPageDataInput,
  ) => Promise<LinearTaskSyncPageData>;
  syncCortexTaskToLinear: (input: SyncCortexTaskToLinearInput) => Promise<SyncedLinearCortexTask>;
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

const normalizeId = (value: string): string => {
  const normalizedValue = assertSafeText(value, idMaxLength);

  if (!idPattern.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalId = (value: string | undefined): string | undefined =>
  value === undefined || value.trim().length === 0 ? undefined : normalizeId(value);

const assertSafeBodyText = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > bodyMaxLength ||
    hasBodyControlCharacter(normalizedValue) ||
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

const normalizeLinearIssueUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  return normalizeUrl(value);
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
      `/dashboard/tasks/sync-linear?taskId=${encodeURIComponent(normalizeId(input.taskId))}`,
      input.cortexAppBaseUrl,
    ).toString(),
  );
};

const toConnectionOption = (
  connection: LinearTaskSyncConnection,
): LinearTaskSyncConnectionOption => ({
  id: normalizeId(connection.id),
  linearWorkspaceId: normalizeId(connection.linearWorkspaceId),
  linearWorkspaceName: assertSafeText(connection.linearWorkspaceName, titleMaxLength),
});

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

const assertTaskSafe = (input: {
  repository: LinearTaskSyncRepository;
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

  assertSafePayload({
    acceptanceCriteria: input.task.acceptanceCriteria,
    findingIds: input.task.findingIds,
    metadata: input.task.metadata,
    objective: input.task.objective,
    originExternalId: input.task.originExternalId,
    originExternalSystem: input.task.originExternalSystem,
    repository: {
      defaultBranch: input.repository.defaultBranch,
      htmlUrl: input.repository.htmlUrl,
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

  if (input.repository.htmlUrl !== null) {
    normalizeUrl(input.repository.htmlUrl);
  }
};

const normalizeTaskExternalLinks = (
  task: CortexTaskRecord,
  link: CortexTaskExternalLink,
): CortexTaskExternalLink[] => [
  ...task.externalLinks.filter(
    (item) => !(item.provider === "linear" && item.resourceType === "linear_issue"),
  ),
  link,
];

const toTaskOption = (record: LinearTaskSyncTaskRecord): LinearTaskSyncTaskOption | null => {
  if (!isEligibleScanTask(record.task) || record.repository === null) {
    return null;
  }

  assertTaskSafe({ repository: record.repository, task: record.task });

  return {
    existingLinearLink:
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

const extractExistingLinearIssueId = (record: LinearTaskSyncTaskRecord): string | null => {
  const externalId = record.externalLink?.externalId;

  if (externalId !== null && externalId !== undefined) {
    return normalizeId(externalId.split(":").at(-1) ?? "");
  }

  const taskLink = record.task.externalLinks.find(
    (link) => link.provider === "linear" && link.resourceType === "linear_issue",
  );

  if (taskLink?.externalId !== undefined) {
    return normalizeId(taskLink.externalId.split(":").at(-1) ?? "");
  }

  return null;
};

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

const getExistingLinearExternalLink = (
  record: LinearTaskSyncTaskRecord,
): CortexTaskExternalLink | null => {
  if (record.externalLink !== null) {
    return taskExternalLinkFromRecord(record.externalLink);
  }

  return (
    record.task.externalLinks.find(
      (link) => link.provider === "linear" && link.resourceType === "linear_issue",
    ) ?? null
  );
};

const requireExistingLinearExternalLink = (
  link: CortexTaskExternalLink | null,
): CortexTaskExternalLink => {
  if (link === null || link.externalId === undefined) {
    throw createActionError("validation_error");
  }

  return link;
};

const issueTitle = (issue: LinearIssueSyncMetadata): string =>
  assertSafeText(`${issue.identifier} ${issue.title}`, titleMaxLength);

const issueStatus = (issue: LinearIssueSyncMetadata): string => assertSafeText(issue.status, 120);

const stableExternalId = (input: {
  issue: LinearIssueSyncMetadata;
  linearWorkspaceId: string;
}): string => `${normalizeId(input.linearWorkspaceId)}:${normalizeId(input.issue.issueId)}`;

const createLinearExternalLink = (input: {
  issue: LinearIssueSyncMetadata;
  linearWorkspaceId: string;
  syncedAt: Date;
}): CortexTaskExternalLink => ({
  externalId: stableExternalId({
    issue: input.issue,
    linearWorkspaceId: input.linearWorkspaceId,
  }),
  provider: "linear",
  resourceType: "linear_issue",
  status: issueStatus(input.issue),
  syncedAt: input.syncedAt.toISOString(),
  title: issueTitle(input.issue),
  url: normalizeLinearIssueUrl(input.issue.url),
});

const createLinearExternalLinkStatusUpdate = (input: {
  existingLink: CortexTaskExternalLink;
  issue: LinearIssueSyncMetadata;
  syncedAt: Date;
}): CortexTaskExternalLink => {
  const externalId = normalizeId(input.existingLink.externalId ?? "");
  const expectedIssueId = normalizeId(externalId.split(":").at(-1) ?? "");

  if (normalizeId(input.issue.issueId) !== expectedIssueId) {
    throw createActionError("validation_error");
  }

  return {
    externalId,
    provider: "linear",
    resourceType: "linear_issue",
    status: issueStatus(input.issue),
    syncedAt: input.syncedAt.toISOString(),
    title: assertSafeText(input.existingLink.title, titleMaxLength),
    url: normalizeUrl(input.existingLink.url),
  };
};

const linearIssueMetadataFromExternalLink = (
  link: CortexTaskExternalLink,
): LinearIssueSyncMetadata => {
  const externalId = normalizeId(link.externalId ?? "");
  const issueId = normalizeId(externalId.split(":").at(-1) ?? "");
  const title = assertSafeText(link.title, titleMaxLength);

  return {
    identifier: assertSafeText(title.split(" ")[0] ?? issueId, titleMaxLength),
    issueId,
    status: assertSafeText(link.status, 120),
    title,
    url: normalizeUrl(link.url),
  };
};

const createIssueBody = (input: {
  cortexTaskUrl: string | null;
  repository: LinearTaskSyncRepository;
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
  provider: "linear",
  repoId: normalizeId(input.repoId),
  resourceType: "linear_issue",
  syncedAt: input.link.syncedAt === undefined ? null : new Date(input.link.syncedAt),
  title: assertSafeText(input.link.title, titleMaxLength),
  url: normalizeUrl(input.link.url),
  workspaceId: normalizeId(input.workspaceId),
});

const createAuditMetadata = (input: {
  action: SyncedLinearCortexTask["action"];
  connection: LinearTaskSyncConnection;
  externalId: string;
  externalLinkCount: number;
  issue: LinearIssueSyncMetadata;
  syncedAt: Date;
  task: CortexTaskRecord;
}): Record<string, unknown> => {
  const metadata = {
    action: input.action,
    acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
    executionMode: input.task.executionMode,
    externalId: input.externalId,
    externalLinkCount: input.externalLinkCount,
    externalLinkProviders: ["linear"],
    findingCount: input.task.findingIds.length,
    issueIdentifier: assertSafeText(input.issue.identifier, titleMaxLength),
    linearConnectionId: normalizeId(input.connection.id),
    linearIssueId: normalizeId(input.issue.issueId),
    linearWorkspaceId: normalizeId(input.connection.linearWorkspaceId),
    repoId: normalizeId(input.task.repoId),
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

const getConnectionToken = async (input: {
  connection: LinearTaskSyncConnection;
  unsealer: LinearOAuthCredentialUnsealer;
}): Promise<string> => {
  if (
    input.connection.accessTokenCiphertext === null ||
    input.connection.accessTokenKeyId === null
  ) {
    throw createActionError("validation_error");
  }

  try {
    return await input.unsealer.unsealCredential({
      credential: {
        ciphertext: input.connection.accessTokenCiphertext,
        keyId: input.connection.accessTokenKeyId,
      },
      purpose: "access",
    });
  } catch {
    throw createActionError("validation_error");
  }
};

const assertActiveConnection = (
  connection: LinearTaskSyncConnection | null,
  now: Date,
): LinearTaskSyncConnection => {
  if (
    connection === null ||
    connection.revokedAt !== null ||
    (connection.expiresAt !== null && connection.expiresAt <= now)
  ) {
    throw createActionError("validation_error");
  }

  return connection;
};

const getSelectedConnection = (input: {
  connections: LinearTaskSyncConnection[];
  linearConnectionId?: string;
}): LinearTaskSyncConnection | null => {
  if (input.connections.length === 0) {
    return null;
  }

  const connectionId = normalizeOptionalId(input.linearConnectionId);

  if (connectionId === undefined) {
    return input.connections[0] ?? null;
  }

  return input.connections.find((connection) => connection.id === connectionId) ?? null;
};

const hasOptionId = (
  options:
    | readonly LinearProjectOption[]
    | readonly LinearTeamOption[]
    | readonly LinearWorkflowStateOption[],
  id: string,
): boolean => options.some((option) => option.id === id);

const assertConnectionScopedLinearOptions = async (input: {
  client: LinearTaskSyncClient;
  projectId?: string;
  statusId?: string;
  teamId: string;
}): Promise<void> => {
  const [teams, projects, workflowStates] = await Promise.all([
    input.client.listTeams(),
    input.projectId === undefined ? Promise.resolve([]) : input.client.listProjects(),
    input.statusId === undefined
      ? Promise.resolve([])
      : input.client.listWorkflowStates({ teamId: input.teamId }),
  ]);

  if (!hasOptionId(teams, input.teamId)) {
    throw createActionError("validation_error");
  }

  if (input.projectId !== undefined && !hasOptionId(projects, input.projectId)) {
    throw createActionError("validation_error");
  }

  if (input.statusId !== undefined && !hasOptionId(workflowStates, input.statusId)) {
    throw createActionError("validation_error");
  }
};

export const createDrizzleLinearTaskSyncStore = (db: Database): LinearTaskSyncStore => {
  const getTaskRecord = async (input: {
    task: CortexTaskRecord;
  }): Promise<LinearTaskSyncTaskRecord> => {
    const [repository] = await db
      .select({
        defaultBranch: schema.githubRepositories.defaultBranch,
        htmlUrl: schema.githubRepositories.htmlUrl,
        id: schema.githubRepositories.id,
        repositoryFullName: schema.githubRepositories.repositoryFullName,
        repositoryName: schema.githubRepositories.repositoryName,
        repositoryOwner: schema.githubRepositories.repositoryOwner,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .where(
        and(
          eq(schema.githubRepositories.id, input.task.repoId),
          eq(schema.githubRepositories.workspaceId, input.task.workspaceId),
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
          eq(schema.cortexTaskExternalLinks.provider, "linear"),
          eq(schema.cortexTaskExternalLinks.resourceType, "linear_issue"),
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
    createCortexTaskLinearExternalLinkWithAudit: async ({
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
            defaultBranch: schema.githubRepositories.defaultBranch,
            htmlUrl: schema.githubRepositories.htmlUrl,
            id: schema.githubRepositories.id,
            repositoryFullName: schema.githubRepositories.repositoryFullName,
            repositoryName: schema.githubRepositories.repositoryName,
            repositoryOwner: schema.githubRepositories.repositoryOwner,
            workspaceId: schema.githubRepositories.workspaceId,
          })
          .from(schema.githubRepositories)
          .where(
            and(
              eq(schema.githubRepositories.id, task.repoId),
              eq(schema.githubRepositories.workspaceId, task.workspaceId),
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
              eq(schema.cortexTaskExternalLinks.provider, "linear"),
              eq(schema.cortexTaskExternalLinks.resourceType, "linear_issue"),
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

        const existingLink = getExistingLinearExternalLink(taskRecord);

        if (existingLink !== null) {
          const taskExternalLinks = normalizeTaskExternalLinks(taskRecord.task, existingLink);
          const externalLinkCount = taskExternalLinks.filter(
            (item) => item.provider === "linear" && item.resourceType === "linear_issue",
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
            throw new Error("Linear task sync existing external link did not return a row.");
          }

          return {
            action: "existing",
            externalLink: storedExternalLink,
            externalLinkCount,
            issue: linearIssueMetadataFromExternalLink(existingLink),
            task: taskRecord.task,
          };
        }

        const issue = await createIssue(taskRecord);
        const link = createExternalLink(issue);
        const taskExternalLinks = normalizeTaskExternalLinks(taskRecord.task, link);
        const externalLinkCount = taskExternalLinks.filter(
          (item) => item.provider === "linear" && item.resourceType === "linear_issue",
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
          throw new Error("Linear task sync external link is missing an external id.");
        }

        const externalId = externalLinkInsert.externalId;
        const [matchingExternalLink] = await tx
          .select()
          .from(schema.cortexTaskExternalLinks)
          .where(
            and(
              eq(schema.cortexTaskExternalLinks.workspaceId, workspaceId),
              eq(schema.cortexTaskExternalLinks.provider, "linear"),
              eq(schema.cortexTaskExternalLinks.resourceType, "linear_issue"),
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
          throw new Error("Linear task sync external link upsert did not return a row.");
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
          action: "created",
          externalLink: storedExternalLink,
          externalLinkCount,
          issue,
          task: updatedTask,
        };
      }),
    findActiveLinearConnectionForSync: async ({ linearConnectionId, now, workspaceId }) => {
      const [connection] = await db
        .select({
          accessTokenCiphertext: schema.linearOAuthConnections.accessTokenCiphertext,
          accessTokenKeyId: schema.linearOAuthConnections.accessTokenKeyId,
          expiresAt: schema.linearOAuthConnections.expiresAt,
          id: schema.linearOAuthConnections.id,
          linearWorkspaceId: schema.linearOAuthConnections.linearWorkspaceId,
          linearWorkspaceName: schema.linearOAuthConnections.linearWorkspaceName,
          revokedAt: schema.linearOAuthConnections.revokedAt,
          workspaceId: schema.linearOAuthConnections.workspaceId,
        })
        .from(schema.linearOAuthConnections)
        .where(
          and(
            eq(schema.linearOAuthConnections.id, linearConnectionId),
            eq(schema.linearOAuthConnections.workspaceId, workspaceId),
            isNull(schema.linearOAuthConnections.revokedAt),
            sql`(${schema.linearOAuthConnections.expiresAt} is null or ${schema.linearOAuthConnections.expiresAt} > ${now})`,
          ),
        )
        .limit(1);

      return connection ?? null;
    },
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
    getApprovedScanCortexTaskForLinearSync: async ({ taskId, workspaceId }) => {
      const [task] = await db
        .select()
        .from(schema.cortexTasks)
        .where(
          and(eq(schema.cortexTasks.id, taskId), eq(schema.cortexTasks.workspaceId, workspaceId)),
        )
        .limit(1);

      return task === undefined ? null : getTaskRecord({ task });
    },
    listActiveLinearConnections: async ({ now, workspaceId }) =>
      db
        .select({
          accessTokenCiphertext: schema.linearOAuthConnections.accessTokenCiphertext,
          accessTokenKeyId: schema.linearOAuthConnections.accessTokenKeyId,
          expiresAt: schema.linearOAuthConnections.expiresAt,
          id: schema.linearOAuthConnections.id,
          linearWorkspaceId: schema.linearOAuthConnections.linearWorkspaceId,
          linearWorkspaceName: schema.linearOAuthConnections.linearWorkspaceName,
          revokedAt: schema.linearOAuthConnections.revokedAt,
          workspaceId: schema.linearOAuthConnections.workspaceId,
        })
        .from(schema.linearOAuthConnections)
        .where(
          and(
            eq(schema.linearOAuthConnections.workspaceId, workspaceId),
            isNull(schema.linearOAuthConnections.revokedAt),
            sql`(${schema.linearOAuthConnections.expiresAt} is null or ${schema.linearOAuthConnections.expiresAt} > ${now})`,
          ),
        ),
    listApprovedScanCortexTasksForLinearSync: async ({ workspaceId }) => {
      const tasks = await db
        .select()
        .from(schema.cortexTasks)
        .where(eq(schema.cortexTasks.workspaceId, workspaceId));

      return Promise.all(tasks.map((task) => getTaskRecord({ task })));
    },
    upsertCortexTaskLinearExternalLinkWithAudit: async ({
      auditEvent,
      externalLink,
      taskExternalLinks,
      taskId,
      updatedAt,
      workspaceId,
    }) =>
      db.transaction(async (tx) => {
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

        if (externalLink.externalId === null || externalLink.externalId === undefined) {
          throw new Error("Linear task sync external link is missing an external id.");
        }

        const externalId = externalLink.externalId;
        const [existingLink] = await tx
          .select()
          .from(schema.cortexTaskExternalLinks)
          .where(
            and(
              eq(schema.cortexTaskExternalLinks.workspaceId, workspaceId),
              eq(schema.cortexTaskExternalLinks.provider, "linear"),
              eq(schema.cortexTaskExternalLinks.resourceType, "linear_issue"),
              eq(schema.cortexTaskExternalLinks.externalId, externalId),
            ),
          )
          .limit(1);

        const [storedExternalLink] =
          existingLink === undefined
            ? await tx.insert(schema.cortexTaskExternalLinks).values(externalLink).returning()
            : await tx
                .update(schema.cortexTaskExternalLinks)
                .set({
                  cortexTaskId: externalLink.cortexTaskId,
                  externalStatus: externalLink.externalStatus,
                  metadata: externalLink.metadata,
                  repoId: externalLink.repoId,
                  syncedAt: externalLink.syncedAt,
                  title: externalLink.title,
                  updatedAt,
                  url: externalLink.url,
                })
                .where(eq(schema.cortexTaskExternalLinks.id, existingLink.id))
                .returning();

        if (storedExternalLink === undefined) {
          throw new Error("Linear task sync external link upsert did not return a row.");
        }

        await tx.insert(schema.auditEvents).values(auditEvent);

        return {
          externalLink: storedExternalLink,
          task: updatedTask,
        };
      }),
    upsertCortexTaskLinearExternalLinkStatusWithAudit: async ({
      auditEvent,
      externalLink,
      taskExternalLinks,
      taskId,
      updatedAt,
      workspaceId,
    }) =>
      db.transaction(async (tx) => {
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

        if (externalLink.externalId === null || externalLink.externalId === undefined) {
          throw new Error("Linear task sync external link is missing an external id.");
        }

        const externalId = externalLink.externalId;
        const [existingLink] = await tx
          .select()
          .from(schema.cortexTaskExternalLinks)
          .where(
            and(
              eq(schema.cortexTaskExternalLinks.workspaceId, workspaceId),
              eq(schema.cortexTaskExternalLinks.provider, "linear"),
              eq(schema.cortexTaskExternalLinks.resourceType, "linear_issue"),
              eq(schema.cortexTaskExternalLinks.externalId, externalId),
            ),
          )
          .limit(1);

        const [storedExternalLink] =
          existingLink === undefined
            ? await tx.insert(schema.cortexTaskExternalLinks).values(externalLink).returning()
            : await tx
                .update(schema.cortexTaskExternalLinks)
                .set({
                  externalStatus: externalLink.externalStatus,
                  syncedAt: externalLink.syncedAt,
                  updatedAt,
                })
                .where(eq(schema.cortexTaskExternalLinks.id, existingLink.id))
                .returning();

        if (storedExternalLink === undefined) {
          throw new Error("Linear task sync external link status upsert did not return a row.");
        }

        await tx.insert(schema.auditEvents).values(auditEvent);

        return {
          externalLink: storedExternalLink,
          task: updatedTask,
        };
      }),
  };
};

export const createLinearTaskSyncService = (input: {
  clientFactory?: (accessToken: string) => LinearTaskSyncClient;
  createAuditEventId?: () => string;
  createExternalLinkId?: () => string;
  cortexAppBaseUrl?: string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: LinearTaskSyncStore;
  unsealer?: LinearOAuthCredentialUnsealer;
}): LinearTaskSyncService => {
  const clientFactory =
    input.clientFactory ?? ((accessToken: string) => createLinearTaskSyncClient({ accessToken }));
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createExternalLinkId = input.createExternalLinkId ?? randomUUID;
  const cortexAppBaseUrl = normalizeOptionalCortexAppBaseUrl(input.cortexAppBaseUrl);
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());
  const getUnsealer = () => input.unsealer ?? createEnvLinearOAuthCredentialUnsealer();

  return {
    listLinearTaskSyncPageData: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const currentTime = now();
      const [connections, taskRecords] = await Promise.all([
        input.store.listActiveLinearConnections({
          now: currentTime,
          workspaceId: scope.workspaceId,
        }),
        input.store.listApprovedScanCortexTasksForLinearSync({
          workspaceId: scope.workspaceId,
        }),
      ]);
      const selectedConnection = getSelectedConnection({
        connections,
        ...(listInput.linearConnectionId === undefined
          ? {}
          : { linearConnectionId: listInput.linearConnectionId }),
      });
      const tasks = taskRecords
        .map(toTaskOption)
        .filter((task): task is LinearTaskSyncTaskOption => task !== null);

      if (selectedConnection === null) {
        return {
          connections: connections.map(toConnectionOption),
          projects: [],
          selectedConnectionId: null,
          tasks,
          teams: [],
          workflowStates: [],
          workspaceId: scope.workspaceId,
        };
      }

      const accessToken = await getConnectionToken({
        connection: selectedConnection,
        unsealer: getUnsealer(),
      });
      const client = clientFactory(accessToken);
      const [teams, projects, workflowStates] = await Promise.all([
        client.listTeams(),
        client.listProjects(),
        client.listWorkflowStates(),
      ]);

      return {
        connections: connections.map(toConnectionOption),
        projects,
        selectedConnectionId: selectedConnection.id,
        tasks,
        teams,
        workflowStates,
        workspaceId: scope.workspaceId,
      };
    },
    syncCortexTaskToLinear: async (syncInput) => {
      const workspaceId = normalizeId(syncInput.workspaceId);
      const taskId = normalizeId(syncInput.taskId);
      const linearConnectionId = normalizeId(syncInput.linearConnectionId);
      const teamId = normalizeId(syncInput.teamId);
      const projectId = normalizeOptionalId(syncInput.projectId);
      const statusId = normalizeOptionalId(syncInput.statusId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const currentTime = now();
      const [connection, taskRecord] = await Promise.all([
        input.store.findActiveLinearConnectionForSync({
          linearConnectionId,
          now: currentTime,
          workspaceId: scope.workspaceId,
        }),
        input.store.getApprovedScanCortexTaskForLinearSync({
          taskId,
          workspaceId: scope.workspaceId,
        }),
      ]);
      const activeConnection = assertActiveConnection(connection, currentTime);

      if (taskRecord === null || taskRecord.repository === null) {
        throw createActionError("validation_error");
      }

      assertEligibleScanTask(taskRecord.task);
      assertTaskSafe({ repository: taskRecord.repository, task: taskRecord.task });
      const accessToken = await getConnectionToken({
        connection: activeConnection,
        unsealer: getUnsealer(),
      });
      const client = clientFactory(accessToken);
      await assertConnectionScopedLinearOptions({
        client,
        ...(projectId === undefined ? {} : { projectId }),
        ...(statusId === undefined ? {} : { statusId }),
        teamId,
      });
      const existingIssueId = extractExistingLinearIssueId(taskRecord);
      const cortexTaskUrl = createCortexTaskUrl({
        cortexAppBaseUrl,
        taskId: taskRecord.task.id,
      });

      if (existingIssueId === null) {
        const persisted = await input.store.createCortexTaskLinearExternalLinkWithAudit({
          createAuditEvent: ({ externalLinkCount, issue, link, task }) =>
            createAuditEventInsert({
              actorId: scope.actorId,
              createId: createAuditEventId,
              eventType: "linear.cortex_task_synced",
              message: "Cortex Task synced to Linear.",
              metadata: createAuditMetadata({
                action: "created",
                connection: activeConnection,
                externalId: link.externalId ?? "",
                externalLinkCount,
                issue,
                syncedAt: currentTime,
                task,
              }),
              now: () => currentTime,
              taskId: task.id,
              workspaceId: scope.workspaceId,
            }),
          createExternalLink: (issue) =>
            createLinearExternalLink({
              issue,
              linearWorkspaceId: activeConnection.linearWorkspaceId,
              syncedAt: currentTime,
            }),
          createExternalLinkId,
          createIssue: async (lockedTaskRecord) => {
            if (lockedTaskRecord.repository === null) {
              throw createActionError("validation_error");
            }

            return client.createIssue({
              description: createIssueBody({
                cortexTaskUrl,
                repository: lockedTaskRecord.repository,
                task: lockedTaskRecord.task,
              }),
              ...(projectId === undefined ? {} : { projectId }),
              ...(statusId === undefined ? {} : { stateId: statusId }),
              teamId,
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
          action: persisted.action === "created" ? "created" : "updated",
          externalLinkCount: persisted.externalLinkCount,
          issueIdentifier: assertSafeText(persisted.issue.identifier, titleMaxLength),
          issueId: normalizeId(persisted.issue.issueId),
          linearConnectionId: activeConnection.id,
          status: issueStatus(persisted.issue),
          taskId: persisted.task.id,
          workspaceId: scope.workspaceId,
        };
      }

      const existingLinearLink = requireExistingLinearExternalLink(
        getExistingLinearExternalLink(taskRecord),
      );
      const issue =
        statusId === undefined
          ? linearIssueMetadataFromExternalLink(existingLinearLink)
          : await client.updateIssueState({
              issueId: existingIssueId,
              stateId: statusId,
            });
      const link = createLinearExternalLinkStatusUpdate({
        existingLink: existingLinearLink,
        issue,
        syncedAt: currentTime,
      });
      const taskExternalLinks = normalizeTaskExternalLinks(taskRecord.task, link);
      const externalLinkCount = taskExternalLinks.filter(
        (item) => item.provider === "linear" && item.resourceType === "linear_issue",
      ).length;
      const auditEvent = createAuditEventInsert({
        actorId: scope.actorId,
        createId: createAuditEventId,
        eventType: "linear.cortex_task_synced",
        message: "Cortex Task synced to Linear.",
        metadata: createAuditMetadata({
          action: "updated",
          connection: activeConnection,
          externalId: link.externalId ?? "",
          externalLinkCount,
          issue,
          syncedAt: currentTime,
          task: taskRecord.task,
        }),
        now: () => currentTime,
        taskId: taskRecord.task.id,
        workspaceId: scope.workspaceId,
      });
      const externalLinkInsert = toExternalLinkInsert({
        createExternalLinkId,
        link,
        repoId: taskRecord.task.repoId,
        taskId: taskRecord.task.id,
        workspaceId: scope.workspaceId,
      });
      const persisted = await input.store.upsertCortexTaskLinearExternalLinkStatusWithAudit({
        auditEvent,
        externalLink: externalLinkInsert,
        taskExternalLinks,
        taskId: taskRecord.task.id,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (persisted === null) {
        throw createActionError("validation_error");
      }

      return {
        action: "updated",
        externalLinkCount,
        issueIdentifier: assertSafeText(issue.identifier, titleMaxLength),
        issueId: normalizeId(issue.issueId),
        linearConnectionId: activeConnection.id,
        status: issueStatus(issue),
        taskId: taskRecord.task.id,
        workspaceId: scope.workspaceId,
      };
    },
  };
};
