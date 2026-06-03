import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  CortexTaskApprovalStatusSchema,
  CortexTaskSchema,
  CortexTaskStatusSchema,
  type CortexTask,
  type CortexTaskExternalLink,
} from "@control-plane/shared";

import {
  and,
  eq,
  schema,
  type CortexTaskRecord,
  type Database,
  type GitHubRepository,
  type LinearIssueCandidate,
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
import { isLinearIssueReadyForAi } from "./eligibility";

type CortexTaskInsert = typeof schema.cortexTasks.$inferInsert;
type CortexTaskExternalLinkInsert = typeof schema.cortexTaskExternalLinks.$inferInsert;

type LinearImportRepositoryRow = Pick<
  GitHubRepository,
  "id" | "repositoryFullName" | "repositoryName" | "repositoryOwner" | "workspaceId"
>;

export type ImportLinearIssueCandidateInput = {
  linearIssueCandidateId: string;
  repoId: string;
  workspaceId: string;
};

export type ImportedLinearIssueCandidateTask = {
  approvalStatus: CortexTask["approvalStatus"];
  externalLinkCount: number;
  repoId: string;
  status: CortexTask["status"];
  taskId: string;
  workspaceId: string;
};

export type LinearIssueCandidateImportStore = WorkspaceMembershipStore & {
  findCortexTaskByExternalLink: (input: {
    externalId: string;
    provider: "linear";
    resourceType: "linear_issue";
    workspaceId: string;
  }) => Promise<CortexTaskRecord | null>;
  findGithubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<LinearImportRepositoryRow | null>;
  findLinearIssueCandidate: (input: {
    linearIssueCandidateId: string;
    workspaceId: string;
  }) => Promise<LinearIssueCandidate | null>;
  importLinearIssueCandidateWithAudit: (input: {
    auditEvent: AuditEventInsert;
    externalLink: CortexTaskExternalLinkInsert;
    task: CortexTaskInsert;
  }) => Promise<CortexTaskRecord>;
};

export type LinearIssueCandidateImportService = {
  importLinearIssueCandidate: (
    input: ImportLinearIssueCandidateInput,
  ) => Promise<ImportedLinearIssueCandidateTask>;
};

const idMaxLength = 240;
const titleMaxLength = 240;
const textMaxLength = 1_000;
const statusMaxLength = 120;
const fallbackLinearUrl = "https://linear.app";
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const secretUrlParameterPattern =
  /^(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)$/iu;

const defaultAcceptanceCriteria = [
  "Review the imported Linear issue metadata before requesting runner execution.",
  "Confirm the selected GitHub repository is the correct source owner.",
  "Keep the task in draft until a human requests approval.",
] as const;

const fallbackObjective =
  "Create a draft Cortex Task from the imported Linear issue metadata. Review scope, repository ownership, and acceptance criteria before requesting any runner execution.";

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
    hasControlCharacter(value) ||
    hasUnsafePayloadPathText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const assertSafeUrlText = (value: string, maxLength = 2_048): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(value)
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

const normalizeExternalUrl = (value: string | null): string => {
  const normalizedValue = value === null ? fallbackLinearUrl : assertSafeUrlText(value);

  try {
    const url = new URL(normalizedValue);

    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
      throw createActionError("validation_error");
    }

    for (const key of url.searchParams.keys()) {
      if (secretUrlParameterPattern.test(key)) {
        throw createActionError("validation_error");
      }
    }

    return url.toString();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createActionError("validation_error");
  }
};

const maybeSafeSummary = (value: string): string | null => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue === "[redacted]" ||
    normalizedValue.length > 500 ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafePayloadText(normalizedValue) ||
    hasUnsafePayloadPathText(normalizedValue)
  ) {
    return null;
  }

  return normalizedValue;
};

const createStableLinearExternalId = (
  candidate: Pick<LinearIssueCandidate, "linearIssueId" | "linearWorkspaceId">,
): string => `${normalizeId(candidate.linearWorkspaceId)}:${normalizeId(candidate.linearIssueId)}`;

const createTaskTitle = (candidate: Pick<LinearIssueCandidate, "identifier" | "title">): string => {
  const identifier = assertSafeText(candidate.identifier, titleMaxLength);
  const title = assertSafeText(candidate.title, titleMaxLength);
  const taskTitle = `${identifier} ${title}`.trim();

  return assertSafeText(taskTitle, titleMaxLength);
};

const createTaskObjective = (candidate: LinearIssueCandidate): string => {
  if (candidate.redactionApplied) {
    return fallbackObjective;
  }

  const summaries = [
    maybeSafeSummary(candidate.bodySummary),
    maybeSafeSummary(candidate.commentsSummary),
  ]
    .filter((summary): summary is string => summary !== null)
    .map((summary) => summary.replace(/\s+/gu, " "));

  if (summaries.length === 0) {
    return fallbackObjective;
  }

  return assertSafeText(summaries.join(" "), textMaxLength);
};

const toTaskResult = (
  task: CortexTaskRecord,
  externalLinkCount: number,
): ImportedLinearIssueCandidateTask => {
  const statusResult = CortexTaskStatusSchema.safeParse(task.status);
  const approvalStatusResult = CortexTaskApprovalStatusSchema.safeParse(task.approvalStatus);

  if (!statusResult.success || !approvalStatusResult.success) {
    throw createActionError("validation_error");
  }

  return {
    approvalStatus: approvalStatusResult.data,
    externalLinkCount,
    repoId: task.repoId,
    status: statusResult.data,
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
};

const validateReadyCandidate = (candidate: LinearIssueCandidate): void => {
  if (
    !isLinearIssueReadyForAi({
      labels: candidate.labels,
      status: candidate.status,
    })
  ) {
    throw createActionError("validation_error");
  }
};

const createLinearExternalLink = (input: {
  candidate: LinearIssueCandidate;
  externalId: string;
  title: string;
}): CortexTaskExternalLink => ({
  externalId: input.externalId,
  provider: "linear",
  resourceType: "linear_issue",
  status: assertSafeText(input.candidate.status, statusMaxLength),
  syncedAt: input.candidate.lastSyncedAt.toISOString(),
  title: input.title,
  url: normalizeExternalUrl(input.candidate.url),
});

const createDraftCortexTask = (input: {
  candidate: LinearIssueCandidate;
  createdAt: Date;
  externalId: string;
  externalLink: CortexTaskExternalLink;
  repoId: string;
  taskId: string;
  title: string;
  workspaceId: string;
}): CortexTask => {
  const task = CortexTaskSchema.parse({
    acceptanceCriteria: [...defaultAcceptanceCriteria],
    approvalStatus: "not_requested",
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt.toISOString(),
    executionMode: "planning_only",
    externalLinks: [input.externalLink],
    findingIds: [],
    latestRunId: undefined,
    metadata: {
      bodySummaryAvailable: maybeSafeSummary(input.candidate.bodySummary) !== null,
      commentsSummaryAvailable: maybeSafeSummary(input.candidate.commentsSummary) !== null,
      importedFrom: "linear",
      linearIssueCandidateId: normalizeId(input.candidate.id),
      redactionApplied: input.candidate.redactionApplied,
    },
    objective: createTaskObjective(input.candidate),
    origin: {
      externalId: input.externalId,
      externalSystem: "linear",
      type: "external_import",
    },
    prArtifactIds: [],
    repoId: input.repoId,
    riskLevel: "medium",
    runIds: [],
    status: "draft",
    suggestedValidation: [],
    taskId: input.taskId,
    title: input.title,
    updatedAt: input.createdAt.toISOString(),
    workspaceId: input.workspaceId,
  });

  return task;
};

const toTaskInsert = (task: CortexTask, now: Date): CortexTaskInsert => ({
  acceptanceCriteria: task.acceptanceCriteria,
  approvalStatus: task.approvalStatus,
  contractVersion: task.contractVersion,
  createdAt: now,
  executionMode: task.executionMode,
  externalLinks: task.externalLinks,
  findingIds: task.findingIds,
  id: task.taskId,
  latestRunId: task.latestRunId ?? null,
  metadata: task.metadata,
  objective: task.objective,
  originExternalId: task.origin.externalId ?? null,
  originExternalSystem: task.origin.externalSystem ?? null,
  originType: task.origin.type,
  prArtifactIds: task.prArtifactIds,
  repoId: task.repoId,
  riskLevel: task.riskLevel,
  runIds: task.runIds,
  status: task.status,
  suggestedValidation: task.suggestedValidation,
  taskPacketId: task.taskPacketId ?? null,
  taskRecommendationId: task.taskRecommendationId ?? null,
  title: task.title,
  updatedAt: now,
  workspaceId: task.workspaceId,
});

const createAuditMetadata = (input: {
  candidate: LinearIssueCandidate;
  externalId: string;
  importedExistingTask: boolean;
  task: CortexTask;
}): Record<string, unknown> => {
  const metadata = {
    acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
    approvalStatus: input.task.approvalStatus,
    bodySummaryLength: input.candidate.bodySummary.length,
    commentsSummaryLength: input.candidate.commentsSummary.length,
    executionMode: input.task.executionMode,
    externalId: input.externalId,
    externalLinkCount: input.task.externalLinks.length,
    externalLinkProviders: ["linear"],
    importedExistingTask: input.importedExistingTask,
    issueStatus: assertSafeText(input.candidate.status, statusMaxLength),
    labelCount: input.candidate.labels.length,
    linearIssueCandidateId: normalizeId(input.candidate.id),
    redactionApplied: input.candidate.redactionApplied,
    repoId: input.task.repoId,
    status: input.task.status,
    taskId: input.task.taskId,
    titleLength: input.task.title.length,
  };

  assertSafePayload(metadata);

  return metadata;
};

const buildExternalLinkInsert = (input: {
  createExternalLinkId: () => string;
  link: CortexTaskExternalLink;
  repoId: string;
  taskId: string;
  workspaceId: string;
}): CortexTaskExternalLinkInsert => ({
  cortexTaskId: input.taskId,
  externalId: input.link.externalId ?? null,
  externalStatus: input.link.status,
  id: normalizeId(input.createExternalLinkId()),
  metadata: {},
  provider: input.link.provider,
  repoId: input.repoId,
  resourceType: input.link.resourceType,
  syncedAt: input.link.syncedAt === undefined ? null : new Date(input.link.syncedAt),
  title: input.link.title,
  url: input.link.url,
  workspaceId: input.workspaceId,
});

export const createDrizzleLinearIssueCandidateImportStore = (
  db: Database,
): LinearIssueCandidateImportStore => ({
  findCortexTaskByExternalLink: async ({ externalId, provider, resourceType, workspaceId }) => {
    const [externalLink] = await db
      .select({
        cortexTaskId: schema.cortexTaskExternalLinks.cortexTaskId,
      })
      .from(schema.cortexTaskExternalLinks)
      .where(
        and(
          eq(schema.cortexTaskExternalLinks.workspaceId, workspaceId),
          eq(schema.cortexTaskExternalLinks.provider, provider),
          eq(schema.cortexTaskExternalLinks.resourceType, resourceType),
          eq(schema.cortexTaskExternalLinks.externalId, externalId),
        ),
      )
      .limit(1);

    if (externalLink === undefined) {
      return null;
    }

    const [task] = await db
      .select()
      .from(schema.cortexTasks)
      .where(
        and(
          eq(schema.cortexTasks.workspaceId, workspaceId),
          eq(schema.cortexTasks.id, externalLink.cortexTaskId),
        ),
      )
      .limit(1);

    return task ?? null;
  },
  findGithubRepository: async ({ repoId, workspaceId }) => {
    const [repository] = await db
      .select({
        id: schema.githubRepositories.id,
        repositoryFullName: schema.githubRepositories.repositoryFullName,
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
  findLinearIssueCandidate: async ({ linearIssueCandidateId, workspaceId }) => {
    const [candidate] = await db
      .select()
      .from(schema.linearIssueCandidates)
      .where(
        and(
          eq(schema.linearIssueCandidates.id, linearIssueCandidateId),
          eq(schema.linearIssueCandidates.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return candidate ?? null;
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
  importLinearIssueCandidateWithAudit: async ({ auditEvent, externalLink, task }) =>
    db.transaction(async (tx) => {
      const [insertedTask] = await tx.insert(schema.cortexTasks).values(task).returning();

      if (insertedTask === undefined) {
        throw new Error("Linear import task insert did not return a row.");
      }

      await tx.insert(schema.cortexTaskExternalLinks).values(externalLink);
      await tx.insert(schema.auditEvents).values(auditEvent);

      return insertedTask;
    }),
});

export const createLinearIssueCandidateImportService = (input: {
  createAuditEventId?: () => string;
  createExternalLinkId?: () => string;
  createTaskId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: LinearIssueCandidateImportStore;
}): LinearIssueCandidateImportService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createExternalLinkId = input.createExternalLinkId ?? randomUUID;
  const createTaskId = input.createTaskId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    importLinearIssueCandidate: async (importInput) => {
      const workspaceId = normalizeId(importInput.workspaceId);
      const linearIssueCandidateId = normalizeId(importInput.linearIssueCandidateId);
      const repoId = normalizeId(importInput.repoId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const [candidate, repository] = await Promise.all([
        input.store.findLinearIssueCandidate({
          linearIssueCandidateId,
          workspaceId: scope.workspaceId,
        }),
        input.store.findGithubRepository({
          repoId,
          workspaceId: scope.workspaceId,
        }),
      ]);

      if (candidate === null || repository === null) {
        throw createActionError("validation_error");
      }

      validateReadyCandidate(candidate);

      const externalId = createStableLinearExternalId(candidate);
      const existingTask = await input.store.findCortexTaskByExternalLink({
        externalId,
        provider: "linear",
        resourceType: "linear_issue",
        workspaceId: scope.workspaceId,
      });

      if (existingTask !== null) {
        return toTaskResult(existingTask, 1);
      }

      const currentTime = now();
      const taskId = normalizeId(createTaskId());
      const title = createTaskTitle(candidate);
      const externalLink = createLinearExternalLink({
        candidate,
        externalId,
        title,
      });
      const task = createDraftCortexTask({
        candidate,
        createdAt: currentTime,
        externalId,
        externalLink,
        repoId: repository.id,
        taskId,
        title,
        workspaceId: scope.workspaceId,
      });
      const auditEvent = createAuditEventInsert({
        actorId: scope.actorId,
        createId: createAuditEventId,
        eventType: "linear.issue_candidate_imported",
        message: "Linear issue candidate imported as a Cortex Task draft.",
        metadata: createAuditMetadata({
          candidate,
          externalId,
          importedExistingTask: false,
          task,
        }),
        now: () => currentTime,
        workspaceId: scope.workspaceId,
      });
      const insertedTask = await input.store.importLinearIssueCandidateWithAudit({
        auditEvent,
        externalLink: buildExternalLinkInsert({
          createExternalLinkId,
          link: externalLink,
          repoId: repository.id,
          taskId,
          workspaceId: scope.workspaceId,
        }),
        task: toTaskInsert(task, currentTime),
      });

      return toTaskResult(insertedTask, task.externalLinks.length);
    },
  };
};
