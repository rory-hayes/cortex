import "server-only";

import { randomUUID } from "node:crypto";

import {
  CortexTaskExecutionModeSchema,
  CortexTaskTransitionActorSchema,
  CortexTaskSchema,
  CortexTaskStatusSchema,
  evaluateCortexTaskStatusTransition,
  type CortexTask,
  type CortexTaskApprovalStatus,
  type CortexTaskExecutionMode,
  type CortexTaskExternalLink,
  type CortexTaskStatus,
  type CortexTaskTransitionActor,
} from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  schema,
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
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";
import { buildFindingTaskLinkRows } from "./finding-task-links";

type CortexTaskInsert = typeof schema.cortexTasks.$inferInsert;
type CortexTaskExternalLinkInsert = typeof schema.cortexTaskExternalLinks.$inferInsert;
type CortexTaskRepositoryRow = Pick<GitHubRepository, "id" | "workspaceId">;
type CortexTaskFindingRow = {
  id: string;
  repoId: string;
  workspaceId: string;
};

export type PersistCortexTaskInput = {
  repoId: string;
  task: CortexTask;
  workspaceId: string;
};

export type ListCortexTasksInput = {
  repoId?: string;
  status?: CortexTaskStatus;
  workspaceId: string;
};

export type TransitionCortexTaskStatusInput = {
  actor?: CortexTaskTransitionActor;
  actorId?: string;
  status: CortexTaskStatus;
  taskId: string;
  workspaceId: string;
};

export type UpdateCortexTaskExecutionModeInput = {
  executionMode: CortexTaskExecutionMode;
  taskId: string;
  workspaceId: string;
};

export type CortexTaskStore = WorkspaceMembershipStore & {
  findFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    workspaceId: string;
  }) => Promise<CortexTaskFindingRow[]>;
  findGithubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<CortexTaskRepositoryRow | null>;
  getCortexTask: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<CortexTaskRecord | null>;
  listCortexTasks: (input: {
    repoId?: string;
    status?: CortexTaskStatus;
    workspaceId: string;
  }) => Promise<CortexTaskRecord[]>;
  hasAvailableLocalRunner: (input: { workspaceId: string }) => Promise<boolean>;
  updateCortexTaskExecutionModeWithAudit: (input: {
    auditEvent: AuditEventInsert;
    executionMode: CortexTaskExecutionMode;
    expectedCurrentApprovalStatus: CortexTaskApprovalStatus;
    expectedCurrentExecutionMode: CortexTaskExecutionMode;
    expectedCurrentStatus: CortexTaskStatus;
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<CortexTaskRecord | null>;
  transitionCortexTaskStatusWithAudit: (input: {
    approvalStatus: CortexTaskApprovalStatus;
    auditEvent: AuditEventInsert;
    expectedCurrentApprovalStatus: CortexTaskApprovalStatus;
    expectedCurrentStatus: CortexTaskStatus;
    status: CortexTaskStatus;
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<CortexTaskRecord | null>;
  upsertCortexTaskWithAudit: (input: {
    createAuditEvent: (task: CortexTaskRecord) => AuditEventInsert;
    task: CortexTaskInsert;
  }) => Promise<CortexTaskRecord>;
};

export type CortexTaskService = {
  listCortexTasks: (input: ListCortexTasksInput) => Promise<CortexTask[]>;
  persistCortexTask: (input: PersistCortexTaskInput) => Promise<CortexTask>;
  transitionCortexTaskStatus: (input: TransitionCortexTaskStatusInput) => Promise<CortexTask>;
  updateCortexTaskExecutionMode: (input: UpdateCortexTaskExecutionModeInput) => Promise<CortexTask>;
};

const textMaxLength = 1_000;
const titleMaxLength = 240;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
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

const assertValidationSafe = (value: unknown): void => {
  if (hasUnsafeWebBoundPayload(value, { inspectKeys: false })) {
    throw createActionError("validation_error");
  }
};

const assertSafePayload = (value: unknown): void => {
  try {
    assertSafeWebBoundPayload(value);
  } catch {
    throw createActionError("validation_error");
  }
};

const assertNoUnsafePathText = (value: unknown, seen: WeakSet<object> = new WeakSet()): void => {
  if (typeof value === "string") {
    if (hasUnsafePayloadPathText(value)) {
      throw createActionError("validation_error");
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => assertNoUnsafePathText(item, seen));

    return;
  }

  Object.values(value).forEach((item) => assertNoUnsafePathText(item, seen));
};

const assertSafeText = (value: string, maxLength = textMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafePayloadPathText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeId = (value: string): string => {
  const normalizedValue = assertSafeText(value, 240);

  if (!idPattern.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalId = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : normalizeId(value);

const normalizeNullableId = (value: string | null): string | undefined =>
  value === null ? undefined : normalizeId(value);

const uniquePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

const normalizeIdArray = (values: readonly string[]): string[] =>
  uniquePreservingOrder(values.map(normalizeId));

const normalizeTextArray = (values: readonly string[]): string[] =>
  values.map((value) => assertSafeText(value));

const assertSafeExternalUrl = (value: string): string => {
  const normalizedValue = assertSafeText(value, 2_048);
  let url: URL;

  try {
    url = new URL(normalizedValue);
  } catch {
    throw createActionError("validation_error");
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    hasUnsafePayloadText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  for (const key of url.searchParams.keys()) {
    if (secretUrlParameterPattern.test(key)) {
      throw createActionError("validation_error");
    }
  }

  return url.toString();
};

const normalizeExternalLinks = (
  links: readonly CortexTaskExternalLink[],
): CortexTaskExternalLink[] => {
  const seen = new Set<string>();
  const normalizedLinks: CortexTaskExternalLink[] = [];

  for (const link of links) {
    const normalizedLink = {
      provider: link.provider,
      resourceType: link.resourceType,
      status: assertSafeText(link.status, 120),
      title: assertSafeText(link.title, 240),
      url: assertSafeExternalUrl(link.url),
      ...(link.externalId === undefined
        ? {}
        : { externalId: assertSafeText(link.externalId, 240) }),
      ...(link.syncedAt === undefined ? {} : { syncedAt: normalizeTimestamp(link.syncedAt) }),
    } satisfies CortexTaskExternalLink;
    const dedupeKey = [
      normalizedLink.provider,
      normalizedLink.resourceType,
      normalizedLink.externalId ?? normalizedLink.url,
    ].join("\u0000");

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalizedLinks.push(normalizedLink);
  }

  return normalizedLinks;
};

const normalizeSuggestedValidation = (
  suggestedValidation: CortexTask["suggestedValidation"],
): CortexTask["suggestedValidation"] =>
  suggestedValidation.map((item) => ({
    label: assertSafeText(item.label, 160),
    required: item.required,
    validationId: normalizeId(item.validationId),
  }));

const normalizeTimestamp = (value: string): string => {
  const normalizedValue = assertSafeText(value, 80);
  const timestamp = new Date(normalizedValue);

  if (Number.isNaN(timestamp.getTime())) {
    throw createActionError("validation_error");
  }

  return timestamp.toISOString();
};

const normalizeStatus = (value: CortexTaskStatus): CortexTaskStatus => {
  const result = CortexTaskStatusSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeExecutionMode = (value: CortexTaskExecutionMode): CortexTaskExecutionMode => {
  const result = CortexTaskExecutionModeSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeTransitionActor = (
  value: CortexTaskTransitionActor | undefined,
): CortexTaskTransitionActor => {
  const result = CortexTaskTransitionActorSchema.safeParse(value ?? "user");

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const assertDirectPersistenceStatusSafe = (task: CortexTask): void => {
  if (task.status !== "draft" || task.approvalStatus !== "not_requested") {
    throw createActionError("validation_error");
  }
};

const validateTaskInput = (value: unknown): CortexTask => {
  assertValidationSafe(value);

  try {
    const task = CortexTaskSchema.parse(value);
    assertSafePayload({
      externalLinks: task.externalLinks,
      metadata: task.metadata,
      suggestedValidation: task.suggestedValidation,
    });
    assertNoUnsafePathText(task);

    return {
      ...task,
      acceptanceCriteria: normalizeTextArray(task.acceptanceCriteria),
      createdAt: normalizeTimestamp(task.createdAt),
      externalLinks: normalizeExternalLinks(task.externalLinks),
      findingIds: normalizeIdArray(task.findingIds),
      latestRunId: normalizeOptionalId(task.latestRunId),
      objective: assertSafeText(task.objective),
      origin: {
        type: task.origin.type,
        ...(task.origin.externalId === undefined
          ? {}
          : { externalId: assertSafeText(task.origin.externalId, 240) }),
        ...(task.origin.externalSystem === undefined
          ? {}
          : { externalSystem: assertSafeText(task.origin.externalSystem, 120) }),
      },
      prArtifactIds: normalizeIdArray(task.prArtifactIds),
      repoId: normalizeId(task.repoId),
      runIds: normalizeIdArray(task.runIds),
      suggestedValidation: normalizeSuggestedValidation(task.suggestedValidation),
      taskId: normalizeId(task.taskId),
      taskPacketId: normalizeOptionalId(task.taskPacketId),
      taskRecommendationId: normalizeOptionalId(task.taskRecommendationId),
      title: assertSafeText(task.title, titleMaxLength),
      updatedAt: normalizeTimestamp(task.updatedAt),
      workspaceId: normalizeId(task.workspaceId),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createActionError("validation_error");
  }
};

const toIsoString = (value: Date): string => value.toISOString();

const toTask = (row: CortexTaskRecord): CortexTask =>
  validateTaskInput({
    acceptanceCriteria: row.acceptanceCriteria,
    approvalStatus: row.approvalStatus,
    contractVersion: row.contractVersion,
    createdAt: toIsoString(row.createdAt),
    executionMode: row.executionMode,
    externalLinks: row.externalLinks,
    findingIds: row.findingIds,
    latestRunId: normalizeNullableId(row.latestRunId),
    metadata: row.metadata,
    objective: row.objective,
    origin: {
      type: row.originType,
      ...(row.originExternalId === null ? {} : { externalId: row.originExternalId }),
      ...(row.originExternalSystem === null ? {} : { externalSystem: row.originExternalSystem }),
    },
    prArtifactIds: row.prArtifactIds,
    repoId: row.repoId,
    riskLevel: row.riskLevel,
    runIds: row.runIds,
    status: row.status,
    suggestedValidation: row.suggestedValidation,
    taskId: row.id,
    ...(row.taskPacketId === null ? {} : { taskPacketId: row.taskPacketId }),
    ...(row.taskRecommendationId === null
      ? {}
      : { taskRecommendationId: row.taskRecommendationId }),
    title: row.title,
    updatedAt: toIsoString(row.updatedAt),
    workspaceId: row.workspaceId,
  });

const assertMatchingTaskScope = (input: {
  repoId: string;
  task: CortexTask;
  workspaceId: string;
}): void => {
  if (input.task.workspaceId !== input.workspaceId || input.task.repoId !== input.repoId) {
    throw createActionError("validation_error");
  }
};

const assertFindingScope = async (input: {
  repoId: string;
  store: CortexTaskStore;
  task: CortexTask;
  workspaceId: string;
}): Promise<void> => {
  if (input.task.findingIds.length === 0) {
    return;
  }

  const findings = await input.store.findFindingsByIds({
    findingIds: input.task.findingIds,
    repoId: input.repoId,
    workspaceId: input.workspaceId,
  });
  const scopedFindingIds = new Set(findings.map((finding) => finding.id));

  if (
    findings.length !== input.task.findingIds.length ||
    input.task.findingIds.some((findingId) => !scopedFindingIds.has(findingId))
  ) {
    throw createActionError("validation_error");
  }
};

const auditMetadataForTask = (task: CortexTask): Record<string, unknown> => {
  const metadata = {
    acceptanceCriteriaCount: task.acceptanceCriteria.length,
    approvalStatus: task.approvalStatus,
    executionMode: task.executionMode,
    externalLinkCount: task.externalLinks.length,
    externalLinkProviders: uniquePreservingOrder(
      task.externalLinks.map((externalLink) => externalLink.provider),
    ),
    externalLinkStatusLabels: uniquePreservingOrder(
      task.externalLinks.map((externalLink) => externalLink.status),
    ),
    findingCount: task.findingIds.length,
    objectiveLength: task.objective.length,
    originType: task.origin.type,
    prArtifactCount: task.prArtifactIds.length,
    repoId: task.repoId,
    riskLevel: task.riskLevel,
    runCount: task.runIds.length,
    status: task.status,
    suggestedValidationCount: task.suggestedValidation.length,
    taskId: task.taskId,
    titleLength: task.title.length,
  };

  assertSafePayload(metadata);

  return metadata;
};

const auditMetadataForTaskTransition = (input: {
  actorId: string;
  actorType: CortexTaskTransitionActor;
  nextApprovalStatus: CortexTaskApprovalStatus;
  nextStatus: CortexTaskStatus;
  previousApprovalStatus: CortexTaskApprovalStatus;
  previousStatus: CortexTaskStatus;
  repoId: string;
  taskId: string;
}): Record<string, unknown> => {
  const metadata = {
    actorId: input.actorId,
    actorType: input.actorType,
    nextApprovalStatus: input.nextApprovalStatus,
    nextStatus: input.nextStatus,
    previousApprovalStatus: input.previousApprovalStatus,
    previousStatus: input.previousStatus,
    repoId: input.repoId,
    taskId: input.taskId,
  };

  assertSafePayload(metadata);

  return metadata;
};

const auditMetadataForTaskExecutionModeUpdate = (input: {
  actorId: string;
  nextExecutionMode: CortexTaskExecutionMode;
  previousExecutionMode: CortexTaskExecutionMode;
  repoId: string;
  riskLevel: CortexTask["riskLevel"];
  status: CortexTaskStatus;
  taskId: string;
}): Record<string, unknown> => {
  const metadata = {
    actorId: input.actorId,
    nextExecutionMode: input.nextExecutionMode,
    previousExecutionMode: input.previousExecutionMode,
    repoId: input.repoId,
    riskLevel: input.riskLevel,
    status: input.status,
    taskId: input.taskId,
  };

  assertSafePayload(metadata);

  return metadata;
};

const buildAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  eventType: string;
  message: string;
  now: Date;
  task: CortexTask;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: input.eventType,
    message: input.message,
    metadata: auditMetadataForTask(input.task),
    now: () => input.now,
    workspaceId: input.task.workspaceId,
  });

const buildTransitionAuditEvent = (input: {
  actorId: string;
  actorType: CortexTaskTransitionActor;
  createAuditEventId: () => string;
  nextTask: CortexTask;
  now: Date;
  previousTask: CortexTask;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: "repo_readiness_cortex_tasks.status_updated",
    message: "Cortex task status updated.",
    metadata: auditMetadataForTaskTransition({
      actorId: input.actorId,
      actorType: input.actorType,
      nextApprovalStatus: input.nextTask.approvalStatus,
      nextStatus: input.nextTask.status,
      previousApprovalStatus: input.previousTask.approvalStatus,
      previousStatus: input.previousTask.status,
      repoId: input.nextTask.repoId,
      taskId: input.nextTask.taskId,
    }),
    now: () => input.now,
    taskId: input.nextTask.taskId,
    workspaceId: input.nextTask.workspaceId,
  });

const buildExecutionModeAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  nextTask: CortexTask;
  now: Date;
  previousTask: CortexTask;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: "repo_readiness_cortex_tasks.execution_mode_updated",
    message: "Cortex task execution mode updated.",
    metadata: auditMetadataForTaskExecutionModeUpdate({
      actorId: input.actorId,
      nextExecutionMode: input.nextTask.executionMode,
      previousExecutionMode: input.previousTask.executionMode,
      repoId: input.nextTask.repoId,
      riskLevel: input.nextTask.riskLevel,
      status: input.nextTask.status,
      taskId: input.nextTask.taskId,
    }),
    now: () => input.now,
    taskId: input.nextTask.taskId,
    workspaceId: input.nextTask.workspaceId,
  });

const buildExternalLinkRows = (task: CortexTaskRecord): CortexTaskExternalLinkInsert[] =>
  task.externalLinks.map((link, index) => ({
    cortexTaskId: task.id,
    externalId: link.externalId ?? null,
    externalStatus: link.status,
    id: `${task.id}:external-link:${index + 1}`,
    metadata: {},
    provider: link.provider,
    repoId: task.repoId,
    resourceType: link.resourceType,
    syncedAt: link.syncedAt === undefined ? null : new Date(link.syncedAt),
    title: link.title,
    url: link.url,
    workspaceId: task.workspaceId,
  }));

export const createDrizzleCortexTaskStore = (db: Database): CortexTaskStore => ({
  findFindingsByIds: async ({ findingIds, repoId, workspaceId }) => {
    if (findingIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: schema.findings.id,
        repoId: schema.findings.repoId,
        workspaceId: schema.findings.workspaceId,
      })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.workspaceId, workspaceId),
          eq(schema.findings.repoId, repoId),
          inArray(schema.findings.id, findingIds),
        ),
      );
  },
  findGithubRepository: async ({ repoId, workspaceId }) => {
    const [repository] = await db
      .select({
        id: schema.githubRepositories.id,
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
  getCortexTask: async ({ taskId, workspaceId }) => {
    const [task] = await db
      .select()
      .from(schema.cortexTasks)
      .where(
        and(eq(schema.cortexTasks.id, taskId), eq(schema.cortexTasks.workspaceId, workspaceId)),
      )
      .limit(1);

    return task ?? null;
  },
  listCortexTasks: async ({ repoId, status, workspaceId }) => {
    const conditions = [eq(schema.cortexTasks.workspaceId, workspaceId)];

    if (repoId !== undefined) {
      conditions.push(eq(schema.cortexTasks.repoId, repoId));
    }

    if (status !== undefined) {
      conditions.push(eq(schema.cortexTasks.status, status));
    }

    return db
      .select()
      .from(schema.cortexTasks)
      .where(and(...conditions))
      .orderBy(desc(schema.cortexTasks.updatedAt));
  },
  hasAvailableLocalRunner: async ({ workspaceId }) => {
    const runners = await db
      .select({
        capabilities: schema.runners.capabilities,
      })
      .from(schema.runners)
      .where(
        and(
          eq(schema.runners.workspaceId, workspaceId),
          inArray(schema.runners.status, ["idle", "busy"]),
          isNotNull(schema.runners.lastHeartbeatAt),
          isNull(schema.runners.revokedAt),
        ),
      );

    return runners.some(
      (runner) =>
        runner.capabilities.supportsDryRun && runner.capabilities.tools.git?.available === true,
    );
  },
  updateCortexTaskExecutionModeWithAudit: async ({
    auditEvent,
    executionMode,
    expectedCurrentApprovalStatus,
    expectedCurrentExecutionMode,
    expectedCurrentStatus,
    taskId,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [updatedTask] = await tx
        .update(schema.cortexTasks)
        .set({ executionMode, updatedAt })
        .where(
          and(
            eq(schema.cortexTasks.id, taskId),
            eq(schema.cortexTasks.workspaceId, workspaceId),
            eq(schema.cortexTasks.status, expectedCurrentStatus),
            eq(schema.cortexTasks.approvalStatus, expectedCurrentApprovalStatus),
            eq(schema.cortexTasks.executionMode, expectedCurrentExecutionMode),
          ),
        )
        .returning();

      if (updatedTask === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return updatedTask;
    }),
  transitionCortexTaskStatusWithAudit: async ({
    approvalStatus,
    auditEvent,
    expectedCurrentApprovalStatus,
    expectedCurrentStatus,
    status,
    taskId,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [updatedTask] = await tx
        .update(schema.cortexTasks)
        .set({ approvalStatus, status, updatedAt })
        .where(
          and(
            eq(schema.cortexTasks.id, taskId),
            eq(schema.cortexTasks.workspaceId, workspaceId),
            eq(schema.cortexTasks.status, expectedCurrentStatus),
            eq(schema.cortexTasks.approvalStatus, expectedCurrentApprovalStatus),
          ),
        )
        .returning();

      if (updatedTask === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return updatedTask;
    }),
  upsertCortexTaskWithAudit: async ({ createAuditEvent, task }) =>
    db.transaction(async (tx) => {
      const [upsertedTask] = await tx
        .insert(schema.cortexTasks)
        .values(task)
        .onConflictDoUpdate({
          set: {
            acceptanceCriteria: task.acceptanceCriteria,
            contractVersion: task.contractVersion,
            executionMode: task.executionMode,
            externalLinks: task.externalLinks,
            findingIds: task.findingIds,
            latestRunId: task.latestRunId,
            metadata: task.metadata,
            objective: task.objective,
            originExternalId: task.originExternalId,
            originExternalSystem: task.originExternalSystem,
            originType: task.originType,
            prArtifactIds: task.prArtifactIds,
            repoId: task.repoId,
            riskLevel: task.riskLevel,
            runIds: task.runIds,
            suggestedValidation: task.suggestedValidation,
            taskPacketId: task.taskPacketId,
            taskRecommendationId: task.taskRecommendationId,
            title: task.title,
            updatedAt: task.updatedAt,
            workspaceId: task.workspaceId,
          },
          target: schema.cortexTasks.id,
        })
        .returning();

      if (upsertedTask === undefined) {
        throw new Error("Cortex task upsert did not return a row.");
      }

      await tx
        .delete(schema.cortexTaskExternalLinks)
        .where(
          and(
            eq(schema.cortexTaskExternalLinks.workspaceId, upsertedTask.workspaceId),
            eq(schema.cortexTaskExternalLinks.cortexTaskId, upsertedTask.id),
          ),
        );

      const externalLinkRows = buildExternalLinkRows(upsertedTask);
      if (externalLinkRows.length > 0) {
        await tx.insert(schema.cortexTaskExternalLinks).values(externalLinkRows);
      }

      await tx
        .delete(schema.findingTaskLinks)
        .where(
          and(
            eq(schema.findingTaskLinks.workspaceId, upsertedTask.workspaceId),
            eq(schema.findingTaskLinks.cortexTaskId, upsertedTask.id),
          ),
        );

      const findingTaskLinkRows = buildFindingTaskLinkRows(upsertedTask, upsertedTask.updatedAt);
      if (findingTaskLinkRows.length > 0) {
        await tx.insert(schema.findingTaskLinks).values(findingTaskLinkRows);
      }

      await tx.insert(schema.auditEvents).values(createAuditEvent(upsertedTask));

      return upsertedTask;
    }),
});

export const createCortexTaskService = (input: {
  createAuditEventId?: () => string;
  createTaskId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: CortexTaskStore;
}): CortexTaskService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createTaskId = input.createTaskId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    listCortexTasks: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const repoId = listInput.repoId === undefined ? undefined : normalizeId(listInput.repoId);
      const status = listInput.status === undefined ? undefined : normalizeStatus(listInput.status);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const tasks = await input.store.listCortexTasks({
        workspaceId: scope.workspaceId,
        ...(repoId === undefined ? {} : { repoId }),
        ...(status === undefined ? {} : { status }),
      });

      return tasks.map(toTask);
    },
    persistCortexTask: async (persistInput) => {
      const workspaceId = normalizeId(persistInput.workspaceId);
      const repoId = normalizeId(persistInput.repoId);
      const task = validateTaskInput(persistInput.task);
      assertDirectPersistenceStatusSafe(task);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });

      assertMatchingTaskScope({
        repoId,
        task,
        workspaceId: scope.workspaceId,
      });

      const repository = await input.store.findGithubRepository({
        repoId,
        workspaceId: scope.workspaceId,
      });

      if (repository === null) {
        throw createActionError("validation_error");
      }

      await assertFindingScope({
        repoId,
        store: input.store,
        task,
        workspaceId: scope.workspaceId,
      });

      const currentTime = now();
      const rowTask = validateTaskInput({
        ...task,
        createdAt: toIsoString(currentTime),
        taskId: normalizeId(createTaskId()),
        updatedAt: toIsoString(currentTime),
      });
      const row: CortexTaskInsert = {
        acceptanceCriteria: rowTask.acceptanceCriteria,
        approvalStatus: rowTask.approvalStatus,
        contractVersion: rowTask.contractVersion,
        createdAt: currentTime,
        executionMode: rowTask.executionMode,
        externalLinks: rowTask.externalLinks,
        findingIds: rowTask.findingIds,
        id: rowTask.taskId,
        latestRunId: rowTask.latestRunId ?? null,
        metadata: rowTask.metadata,
        objective: rowTask.objective,
        originExternalId: rowTask.origin.externalId ?? null,
        originExternalSystem: rowTask.origin.externalSystem ?? null,
        originType: rowTask.origin.type,
        prArtifactIds: rowTask.prArtifactIds,
        repoId: rowTask.repoId,
        riskLevel: rowTask.riskLevel,
        runIds: rowTask.runIds,
        status: rowTask.status,
        suggestedValidation: rowTask.suggestedValidation,
        taskPacketId: rowTask.taskPacketId ?? null,
        taskRecommendationId: rowTask.taskRecommendationId ?? null,
        title: rowTask.title,
        updatedAt: currentTime,
        workspaceId: rowTask.workspaceId,
      };
      const upsertedTask = await input.store.upsertCortexTaskWithAudit({
        createAuditEvent: (persistedTask) =>
          buildAuditEvent({
            actorId: scope.actorId,
            createAuditEventId,
            eventType: "repo_readiness_cortex_tasks.upserted",
            message: "Cortex task persisted.",
            now: currentTime,
            task: toTask(persistedTask),
          }),
        task: row,
      });

      return toTask(upsertedTask);
    },
    updateCortexTaskExecutionMode: async (modeInput) => {
      const workspaceId = normalizeId(modeInput.workspaceId);
      const taskId = normalizeId(modeInput.taskId);
      const executionMode = normalizeExecutionMode(modeInput.executionMode);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const existingTask = await input.store.getCortexTask({
        taskId,
        workspaceId: scope.workspaceId,
      });

      if (existingTask === null) {
        throw createActionError("validation_error");
      }

      if (
        (existingTask.status !== "draft" && existingTask.status !== "needs_review") ||
        (existingTask.approvalStatus !== "not_requested" &&
          existingTask.approvalStatus !== "pending")
      ) {
        throw createActionError("validation_error");
      }

      if (existingTask.riskLevel === "blocked" && executionMode !== "planning_only") {
        throw createActionError("validation_error");
      }

      if (executionMode === "local_runner") {
        const hasAvailableLocalRunner = await input.store.hasAvailableLocalRunner({
          workspaceId: scope.workspaceId,
        });

        if (!hasAvailableLocalRunner) {
          throw createActionError("validation_error");
        }
      }

      const currentTime = now();
      const previousTask = toTask(existingTask);
      const nextTask = toTask({
        ...existingTask,
        executionMode,
        updatedAt: currentTime,
      });
      const auditEvent = buildExecutionModeAuditEvent({
        actorId: scope.actorId,
        createAuditEventId,
        nextTask,
        now: currentTime,
        previousTask,
      });
      const updatedTask = await input.store.updateCortexTaskExecutionModeWithAudit({
        auditEvent,
        executionMode,
        expectedCurrentApprovalStatus: existingTask.approvalStatus,
        expectedCurrentExecutionMode: existingTask.executionMode,
        expectedCurrentStatus: existingTask.status,
        taskId,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (updatedTask === null) {
        throw createActionError("validation_error");
      }

      return toTask(updatedTask);
    },
    transitionCortexTaskStatus: async (transitionInput) => {
      const workspaceId = normalizeId(transitionInput.workspaceId);
      const taskId = normalizeId(transitionInput.taskId);
      const status = normalizeStatus(transitionInput.status);
      const actor = normalizeTransitionActor(transitionInput.actor);
      const scope =
        actor === "user"
          ? await requireWorkspaceMembership({
              getAuthContext,
              store: input.store,
              workspaceId,
            })
          : {
              actorId:
                transitionInput.actorId === undefined
                  ? undefined
                  : normalizeId(transitionInput.actorId),
              workspaceId,
            };
      const existingTask = await input.store.getCortexTask({
        taskId,
        workspaceId: scope.workspaceId,
      });

      if (existingTask === null) {
        throw createActionError("validation_error");
      }

      const evaluation = evaluateCortexTaskStatusTransition({
        actor,
        currentApprovalStatus: existingTask.approvalStatus,
        currentStatus: existingTask.status,
        nextStatus: status,
      });

      if (!evaluation.allowed || scope.actorId === undefined) {
        throw createActionError("validation_error");
      }

      const currentTime = now();
      const approvalStatus = evaluation.nextApprovalStatus;
      const previousTask = toTask(existingTask);
      const nextTask = toTask({
        ...existingTask,
        approvalStatus,
        status,
        updatedAt: currentTime,
      });
      const auditEvent = buildTransitionAuditEvent({
        actorId: scope.actorId,
        actorType: actor,
        createAuditEventId,
        nextTask,
        now: currentTime,
        previousTask,
      });
      const updatedTask = await input.store.transitionCortexTaskStatusWithAudit({
        approvalStatus,
        auditEvent,
        expectedCurrentApprovalStatus: existingTask.approvalStatus,
        expectedCurrentStatus: existingTask.status,
        status,
        taskId,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (updatedTask === null) {
        throw createActionError("validation_error");
      }

      return toTask(updatedTask);
    },
  };
};
