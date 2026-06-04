import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  TaskRecommendationSchema,
  TaskRecommendationStatusSchema,
  type CortexTask,
  type CortexTaskSuggestedValidation,
  type TaskRecommendation,
  type TaskRecommendationStatus,
} from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  type CortexTaskRecord,
  type Database,
  type FindingRecord,
  type GitHubRepository,
  type RepoScanRecord,
  type TaskRecommendationRecord,
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
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";
import { createUsageEventInsert } from "../billing/usage-events";
import { buildFindingTaskLinkRows } from "./finding-task-links";

type TaskRecommendationInsert = typeof schema.taskRecommendations.$inferInsert;
type CortexTaskInsert = typeof schema.cortexTasks.$inferInsert;
type TaskRecommendationRepositoryRow = Pick<GitHubRepository, "id" | "workspaceId">;
type TaskRecommendationScanRow = Pick<
  RepoScanRecord,
  "id" | "repoId" | "taskRecommendationIds" | "workspaceId"
>;
type TaskRecommendationFindingRow = Pick<
  FindingRecord,
  "id" | "repoId" | "scanId" | "taskIds" | "workspaceId"
>;

export type PersistTaskRecommendationInput = {
  recommendation: TaskRecommendation;
  repoId: string;
  scanId: string;
  workspaceId: string;
};

export type ListTaskRecommendationsInput = {
  repoId?: string;
  scanId?: string;
  status?: TaskRecommendationStatus;
  workspaceId: string;
};

export type TaskRecommendationStatusUpdate = "deferred" | "dismissed" | "ignored";

export type UpdateTaskRecommendationStatusInput = {
  status: TaskRecommendationStatusUpdate;
  taskRecommendationId: string;
  workspaceId: string;
};

export type TaskRecommendationApprovalEdits = {
  acceptanceCriteria?: readonly string[];
  objective?: string;
  title?: string;
};

export type TaskRecommendationApprovalRequest = TaskRecommendationApprovalEdits & {
  taskRecommendationId: string;
};

export type ApproveTaskRecommendationInput = TaskRecommendationApprovalRequest & {
  workspaceId: string;
};

export type ApproveTaskRecommendationsInput = {
  recommendations: readonly TaskRecommendationApprovalRequest[];
  workspaceId: string;
};

export type PersistedTaskRecommendation = {
  recommendation: TaskRecommendation;
};

export type ApprovedTaskRecommendation = {
  recommendation: PersistedTaskRecommendation;
  task: CortexTask;
};

export type RepoTaskRecommendationStore = WorkspaceMembershipStore & {
  approveTaskRecommendationWithAudit: (input: {
    auditEvents: AuditEventInsert[];
    task: CortexTaskInsert;
    taskId: string;
    taskRecommendationId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<{ recommendation: TaskRecommendationRecord; task: CortexTaskRecord } | null>;
  findFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    scanId: string;
    workspaceId: string;
  }) => Promise<TaskRecommendationFindingRow[]>;
  findGithubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<TaskRecommendationRepositoryRow | null>;
  findRepoScan: (input: {
    scanId: string;
    workspaceId: string;
  }) => Promise<TaskRecommendationScanRow | null>;
  getCortexTask: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<CortexTaskRecord | null>;
  getTaskRecommendation: (input: {
    taskRecommendationId: string;
    workspaceId: string;
  }) => Promise<TaskRecommendationRecord | null>;
  listTaskRecommendations: (input: {
    repoId?: string;
    scanId?: string;
    status?: TaskRecommendationStatus;
    workspaceId: string;
  }) => Promise<TaskRecommendationRecord[]>;
  updateTaskRecommendationStatusWithAudit: (input: {
    auditEvent: AuditEventInsert;
    status: "deferred" | "ignored";
    taskRecommendationId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<TaskRecommendationRecord | null>;
  upsertTaskRecommendationWithAuditAndScanUpdate: (input: {
    createAuditEvent: (recommendation: TaskRecommendationRecord) => AuditEventInsert;
    recommendation: TaskRecommendationInsert;
  }) => Promise<TaskRecommendationRecord>;
};

export type TaskRecommendationService = {
  approveTaskRecommendation: (
    input: ApproveTaskRecommendationInput,
  ) => Promise<ApprovedTaskRecommendation>;
  approveTaskRecommendations: (
    input: ApproveTaskRecommendationsInput,
  ) => Promise<ApprovedTaskRecommendation[]>;
  listTaskRecommendations: (
    input: ListTaskRecommendationsInput,
  ) => Promise<PersistedTaskRecommendation[]>;
  persistTaskRecommendation: (
    input: PersistTaskRecommendationInput,
  ) => Promise<PersistedTaskRecommendation>;
  updateTaskRecommendationStatus: (
    input: UpdateTaskRecommendationStatusInput,
  ) => Promise<PersistedTaskRecommendation>;
};

const textMaxLength = 1_000;
const titleMaxLength = 240;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const unsafeCommandTextPattern =
  /\b(?:pnpm|npm|yarn|node|python|pytest|vitest|tsc|eslint|git|gh)\s+(?:run\s+)?[A-Za-z0-9:_/-]+/iu;

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

const hasUnsafeRecommendationText = (value: string): boolean =>
  hasUnsafePayloadPathText(value) || unsafeCommandTextPattern.test(value);

const assertNoUnsafeText = (value: unknown, seen: WeakSet<object> = new WeakSet()): void => {
  if (typeof value === "string") {
    if (hasUnsafeRecommendationText(value)) {
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
    value.forEach((item) => assertNoUnsafeText(item, seen));

    return;
  }

  Object.values(value).forEach((item) => assertNoUnsafeText(item, seen));
};

const assertSafeText = (value: string, maxLength = textMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafeRecommendationText(normalizedValue)
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

const normalizeApprovalAcceptanceCriteria = (values: readonly string[]): string[] => {
  if (values.length === 0) {
    throw createActionError("validation_error");
  }

  return normalizeTextArray(values);
};

type NormalizedTaskRecommendationApprovalRequest = {
  acceptanceCriteria?: string[];
  objective?: string;
  taskRecommendationId: string;
  title?: string;
};

const normalizeApprovalRequest = (
  input: TaskRecommendationApprovalRequest,
): NormalizedTaskRecommendationApprovalRequest => {
  const request: NormalizedTaskRecommendationApprovalRequest = {
    taskRecommendationId: normalizeId(input.taskRecommendationId),
  };

  if (input.title !== undefined) {
    request.title = assertSafeText(input.title, titleMaxLength);
  }

  if (input.objective !== undefined) {
    request.objective = assertSafeText(input.objective);
  }

  if (input.acceptanceCriteria !== undefined) {
    request.acceptanceCriteria = normalizeApprovalAcceptanceCriteria(input.acceptanceCriteria);
  }

  return request;
};

const hasApprovalEdits = (request: NormalizedTaskRecommendationApprovalRequest): boolean =>
  request.title !== undefined ||
  request.objective !== undefined ||
  request.acceptanceCriteria !== undefined;

const normalizeSuggestedValidation = (
  suggestedValidation: readonly CortexTaskSuggestedValidation[],
): CortexTaskSuggestedValidation[] =>
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

const normalizeStatus = (value: TaskRecommendationStatus): TaskRecommendationStatus => {
  const result = TaskRecommendationStatusSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeStatusUpdate = (value: TaskRecommendationStatusUpdate): "deferred" | "ignored" => {
  if (value === "dismissed" || value === "ignored") {
    return "ignored";
  }

  if (value === "deferred") {
    return "deferred";
  }

  throw createActionError("validation_error");
};

const validateRecommendationInput = (value: unknown): TaskRecommendation => {
  assertValidationSafe(value);

  try {
    const recommendation = TaskRecommendationSchema.parse(value);
    assertSafePayload({
      metadata: recommendation.metadata,
      suggestedValidation: recommendation.suggestedValidation,
    });
    assertNoUnsafeText(recommendation);

    return {
      ...recommendation,
      acceptanceCriteria: normalizeTextArray(recommendation.acceptanceCriteria),
      cortexTaskId: normalizeOptionalId(recommendation.cortexTaskId),
      createdAt: normalizeTimestamp(recommendation.createdAt),
      findingIds: normalizeIdArray(recommendation.findingIds),
      objective: assertSafeText(recommendation.objective),
      repoId: normalizeId(recommendation.repoId),
      scanId: normalizeId(recommendation.scanId),
      suggestedValidation: normalizeSuggestedValidation(recommendation.suggestedValidation),
      taskRecommendationId: normalizeId(recommendation.taskRecommendationId),
      title: assertSafeText(recommendation.title, titleMaxLength),
      updatedAt: normalizeTimestamp(recommendation.updatedAt),
      workspaceId: normalizeId(recommendation.workspaceId),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

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
    assertNoUnsafeText(task);

    return {
      ...task,
      acceptanceCriteria: normalizeTextArray(task.acceptanceCriteria),
      createdAt: normalizeTimestamp(task.createdAt),
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

const toRecommendation = (row: TaskRecommendationRecord): PersistedTaskRecommendation => ({
  recommendation: validateRecommendationInput({
    acceptanceCriteria: row.acceptanceCriteria,
    contractVersion: row.contractVersion,
    ...(row.cortexTaskId === null ? {} : { cortexTaskId: row.cortexTaskId }),
    createdAt: toIsoString(row.createdAt),
    effort: row.effort,
    executionMode: row.executionMode,
    findingIds: row.findingIds,
    metadata: row.metadata,
    objective: row.objective,
    repoId: row.repoId,
    riskLevel: row.riskLevel,
    scanId: row.scanId,
    status: row.status,
    suggestedValidation: row.suggestedValidation,
    taskRecommendationId: row.id,
    title: row.title,
    updatedAt: toIsoString(row.updatedAt),
    workspaceId: row.workspaceId,
  }),
});

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

const assertMatchingRecommendationScope = (input: {
  recommendation: TaskRecommendation;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): void => {
  if (
    input.recommendation.workspaceId !== input.workspaceId ||
    input.recommendation.repoId !== input.repoId ||
    input.recommendation.scanId !== input.scanId
  ) {
    throw createActionError("validation_error");
  }
};

const assertFindingScope = async (input: {
  recommendation: TaskRecommendation;
  store: RepoTaskRecommendationStore;
}): Promise<void> => {
  const findings = await input.store.findFindingsByIds({
    findingIds: input.recommendation.findingIds,
    repoId: input.recommendation.repoId,
    scanId: input.recommendation.scanId,
    workspaceId: input.recommendation.workspaceId,
  });
  const scopedFindingIds = new Set(findings.map((finding) => finding.id));

  if (
    findings.length !== input.recommendation.findingIds.length ||
    input.recommendation.findingIds.some((findingId) => !scopedFindingIds.has(findingId))
  ) {
    throw createActionError("validation_error");
  }
};

const auditMetadataForRecommendation = (
  recommendation: TaskRecommendation,
): Record<string, unknown> => {
  const metadata = {
    acceptanceCriteriaCount: recommendation.acceptanceCriteria.length,
    ...(recommendation.cortexTaskId === undefined
      ? {}
      : { cortexTaskId: recommendation.cortexTaskId }),
    effort: recommendation.effort,
    executionMode: recommendation.executionMode,
    findingCount: recommendation.findingIds.length,
    objectiveLength: recommendation.objective.length,
    recommendationId: recommendation.taskRecommendationId,
    repoId: recommendation.repoId,
    riskLevel: recommendation.riskLevel,
    scanId: recommendation.scanId,
    status: recommendation.status,
    suggestedValidationCount: recommendation.suggestedValidation.length,
    titleLength: recommendation.title.length,
  };

  assertSafePayload(metadata);

  return metadata;
};

const auditMetadataForTask = (input: {
  recommendationId: string;
  task: CortexTask;
}): Record<string, unknown> => {
  const metadata = {
    acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
    approvalStatus: input.task.approvalStatus,
    executionMode: input.task.executionMode,
    findingCount: input.task.findingIds.length,
    objectiveLength: input.task.objective.length,
    originType: input.task.origin.type,
    recommendationId: input.recommendationId,
    repoId: input.task.repoId,
    riskLevel: input.task.riskLevel,
    runCount: input.task.runIds.length,
    status: input.task.status,
    taskId: input.task.taskId,
    titleLength: input.task.title.length,
  };

  assertSafePayload(metadata);

  return metadata;
};

const buildRecommendationAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  eventType: string;
  message: string;
  now: Date;
  recommendation: TaskRecommendation;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: input.eventType,
    message: input.message,
    metadata: auditMetadataForRecommendation(input.recommendation),
    now: () => input.now,
    workspaceId: input.recommendation.workspaceId,
  });

const buildTaskAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  now: Date;
  recommendationId: string;
  task: CortexTask;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: "repo_readiness_cortex_tasks.created_from_recommendation",
    message: "Cortex task created from task recommendation.",
    metadata: auditMetadataForTask({
      recommendationId: input.recommendationId,
      task: input.task,
    }),
    now: () => input.now,
    workspaceId: input.task.workspaceId,
  });

const buildCortexTaskFromRecommendation = (input: {
  currentTime: Date;
  recommendation: TaskRecommendation;
  taskId: string;
}): CortexTask => {
  const timestamp = toIsoString(input.currentTime);

  return validateTaskInput({
    acceptanceCriteria: input.recommendation.acceptanceCriteria,
    approvalStatus: "not_requested",
    contractVersion: CONTRACT_VERSION,
    createdAt: timestamp,
    executionMode: input.recommendation.executionMode,
    externalLinks: [],
    findingIds: input.recommendation.findingIds,
    metadata: {
      effort: input.recommendation.effort,
      recommendationStatus: input.recommendation.status,
      scanId: input.recommendation.scanId,
      sourceLabel: "task_recommendation",
    },
    objective: input.recommendation.objective,
    origin: {
      externalId: input.recommendation.taskRecommendationId,
      type: "task_recommendation",
    },
    prArtifactIds: [],
    repoId: input.recommendation.repoId,
    riskLevel: input.recommendation.riskLevel,
    runIds: [],
    status: "draft",
    suggestedValidation: input.recommendation.suggestedValidation,
    taskId: input.taskId,
    taskRecommendationId: input.recommendation.taskRecommendationId,
    title: input.recommendation.title,
    updatedAt: timestamp,
    workspaceId: input.recommendation.workspaceId,
  });
};

const applyApprovalEdits = (input: {
  recommendation: TaskRecommendation;
  request: NormalizedTaskRecommendationApprovalRequest;
}): TaskRecommendation =>
  validateRecommendationInput({
    ...input.recommendation,
    ...(input.request.acceptanceCriteria === undefined
      ? {}
      : { acceptanceCriteria: input.request.acceptanceCriteria }),
    ...(input.request.objective === undefined ? {} : { objective: input.request.objective }),
    ...(input.request.title === undefined ? {} : { title: input.request.title }),
  });

const taskInsertFromCortexTask = (task: CortexTask, currentTime: Date): CortexTaskInsert => ({
  acceptanceCriteria: task.acceptanceCriteria,
  approvalStatus: task.approvalStatus,
  contractVersion: task.contractVersion,
  createdAt: currentTime,
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
  updatedAt: currentTime,
  workspaceId: task.workspaceId,
});

const recommendationInsertFromRecommendation = (
  recommendation: TaskRecommendation,
  currentTime: Date,
): TaskRecommendationInsert => ({
  acceptanceCriteria: recommendation.acceptanceCriteria,
  contractVersion: recommendation.contractVersion,
  cortexTaskId: recommendation.cortexTaskId ?? null,
  createdAt: currentTime,
  effort: recommendation.effort,
  executionMode: recommendation.executionMode,
  findingIds: recommendation.findingIds,
  id: recommendation.taskRecommendationId,
  metadata: recommendation.metadata,
  objective: recommendation.objective,
  repoId: recommendation.repoId,
  riskLevel: recommendation.riskLevel,
  scanId: recommendation.scanId,
  status: recommendation.status,
  suggestedValidation: recommendation.suggestedValidation,
  title: recommendation.title,
  updatedAt: currentTime,
  workspaceId: recommendation.workspaceId,
});

export const createDrizzleTaskRecommendationStore = (
  db: Database,
): RepoTaskRecommendationStore => ({
  approveTaskRecommendationWithAudit: async ({
    auditEvents,
    task,
    taskId,
    taskRecommendationId,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [existingRecommendation] = await tx
        .select()
        .from(schema.taskRecommendations)
        .where(
          and(
            eq(schema.taskRecommendations.id, taskRecommendationId),
            eq(schema.taskRecommendations.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (existingRecommendation === undefined) {
        return null;
      }

      if (existingRecommendation.cortexTaskId !== null) {
        const [existingTask] = await tx
          .select()
          .from(schema.cortexTasks)
          .where(
            and(
              eq(schema.cortexTasks.id, existingRecommendation.cortexTaskId),
              eq(schema.cortexTasks.workspaceId, workspaceId),
            ),
          )
          .limit(1);

        return existingTask === undefined
          ? null
          : { recommendation: existingRecommendation, task: existingTask };
      }

      if (
        existingRecommendation.status !== "open" &&
        existingRecommendation.status !== "approved"
      ) {
        return null;
      }

      const [createdTask] = await tx
        .insert(schema.cortexTasks)
        .values(task)
        .onConflictDoNothing({
          target: schema.cortexTasks.taskRecommendationId,
        })
        .returning();
      const [taskForRecommendation] =
        createdTask === undefined
          ? await tx
              .select()
              .from(schema.cortexTasks)
              .where(
                and(
                  eq(schema.cortexTasks.workspaceId, workspaceId),
                  eq(schema.cortexTasks.taskRecommendationId, taskRecommendationId),
                ),
              )
              .limit(1)
          : [createdTask];

      if (taskForRecommendation === undefined) {
        return null;
      }

      const [updatedRecommendation] = await tx
        .update(schema.taskRecommendations)
        .set({
          cortexTaskId: taskForRecommendation.id,
          status: "converted",
          updatedAt,
        })
        .where(
          and(
            eq(schema.taskRecommendations.id, taskRecommendationId),
            eq(schema.taskRecommendations.workspaceId, workspaceId),
            isNull(schema.taskRecommendations.cortexTaskId),
            inArray(schema.taskRecommendations.status, ["open", "approved"]),
          ),
        )
        .returning();

      if (updatedRecommendation === undefined) {
        if (createdTask !== undefined) {
          await tx.delete(schema.cortexTasks).where(eq(schema.cortexTasks.id, taskId));
        }

        const [currentRecommendation] = await tx
          .select()
          .from(schema.taskRecommendations)
          .where(
            and(
              eq(schema.taskRecommendations.id, taskRecommendationId),
              eq(schema.taskRecommendations.workspaceId, workspaceId),
            ),
          )
          .limit(1);

        if (currentRecommendation === undefined || currentRecommendation.cortexTaskId === null) {
          return null;
        }

        const [currentTask] = await tx
          .select()
          .from(schema.cortexTasks)
          .where(
            and(
              eq(schema.cortexTasks.id, currentRecommendation.cortexTaskId),
              eq(schema.cortexTasks.workspaceId, workspaceId),
            ),
          )
          .limit(1);

        return currentTask === undefined
          ? null
          : { recommendation: currentRecommendation, task: currentTask };
      }

      if (updatedRecommendation.findingIds.length > 0) {
        const linkedFindings = await tx
          .select()
          .from(schema.findings)
          .where(
            and(
              eq(schema.findings.workspaceId, updatedRecommendation.workspaceId),
              eq(schema.findings.repoId, updatedRecommendation.repoId),
              inArray(schema.findings.id, updatedRecommendation.findingIds),
            ),
          );

        for (const finding of linkedFindings) {
          await tx
            .update(schema.findings)
            .set({
              taskIds: uniquePreservingOrder([...finding.taskIds, taskForRecommendation.id]),
              updatedAt,
            })
            .where(
              and(
                eq(schema.findings.id, finding.id),
                eq(schema.findings.workspaceId, updatedRecommendation.workspaceId),
              ),
            );
        }
      }

      const findingTaskLinkRows = buildFindingTaskLinkRows(taskForRecommendation, updatedAt);
      if (findingTaskLinkRows.length > 0) {
        await tx
          .insert(schema.findingTaskLinks)
          .values(findingTaskLinkRows)
          .onConflictDoNothing({
            target: [
              schema.findingTaskLinks.workspaceId,
              schema.findingTaskLinks.findingId,
              schema.findingTaskLinks.cortexTaskId,
            ],
          });
      }

      await tx.insert(schema.auditEvents).values(auditEvents);

      return {
        recommendation: updatedRecommendation,
        task: taskForRecommendation,
      };
    }),
  findFindingsByIds: async ({ findingIds, repoId, scanId, workspaceId }) => {
    if (findingIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: schema.findings.id,
        repoId: schema.findings.repoId,
        scanId: schema.findings.scanId,
        taskIds: schema.findings.taskIds,
        workspaceId: schema.findings.workspaceId,
      })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.workspaceId, workspaceId),
          eq(schema.findings.repoId, repoId),
          eq(schema.findings.scanId, scanId),
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
  findRepoScan: async ({ scanId, workspaceId }) => {
    const [scan] = await db
      .select({
        id: schema.repoScans.id,
        repoId: schema.repoScans.repoId,
        taskRecommendationIds: schema.repoScans.taskRecommendationIds,
        workspaceId: schema.repoScans.workspaceId,
      })
      .from(schema.repoScans)
      .where(and(eq(schema.repoScans.id, scanId), eq(schema.repoScans.workspaceId, workspaceId)))
      .limit(1);

    return scan ?? null;
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
  getTaskRecommendation: async ({ taskRecommendationId, workspaceId }) => {
    const [recommendation] = await db
      .select()
      .from(schema.taskRecommendations)
      .where(
        and(
          eq(schema.taskRecommendations.id, taskRecommendationId),
          eq(schema.taskRecommendations.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return recommendation ?? null;
  },
  listTaskRecommendations: async ({ repoId, scanId, status, workspaceId }) => {
    const conditions = [eq(schema.taskRecommendations.workspaceId, workspaceId)];

    if (repoId !== undefined) {
      conditions.push(eq(schema.taskRecommendations.repoId, repoId));
    }

    if (scanId !== undefined) {
      conditions.push(eq(schema.taskRecommendations.scanId, scanId));
    }

    if (status !== undefined) {
      conditions.push(eq(schema.taskRecommendations.status, status));
    }

    return db
      .select()
      .from(schema.taskRecommendations)
      .where(and(...conditions))
      .orderBy(desc(schema.taskRecommendations.updatedAt));
  },
  updateTaskRecommendationStatusWithAudit: async ({
    auditEvent,
    status,
    taskRecommendationId,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [updatedRecommendation] = await tx
        .update(schema.taskRecommendations)
        .set({ status, updatedAt })
        .where(
          and(
            eq(schema.taskRecommendations.id, taskRecommendationId),
            eq(schema.taskRecommendations.workspaceId, workspaceId),
          ),
        )
        .returning();

      if (updatedRecommendation === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return updatedRecommendation;
    }),
  upsertTaskRecommendationWithAuditAndScanUpdate: async ({ createAuditEvent, recommendation }) =>
    db.transaction(async (tx) => {
      const [upsertedRecommendation] = await tx
        .insert(schema.taskRecommendations)
        .values(recommendation)
        .onConflictDoUpdate({
          set: {
            acceptanceCriteria: recommendation.acceptanceCriteria,
            contractVersion: recommendation.contractVersion,
            effort: recommendation.effort,
            executionMode: recommendation.executionMode,
            findingIds: recommendation.findingIds,
            metadata: recommendation.metadata,
            objective: recommendation.objective,
            repoId: recommendation.repoId,
            riskLevel: recommendation.riskLevel,
            scanId: recommendation.scanId,
            suggestedValidation: recommendation.suggestedValidation,
            title: recommendation.title,
            updatedAt: recommendation.updatedAt,
          },
          target: schema.taskRecommendations.id,
        })
        .returning();

      if (upsertedRecommendation === undefined) {
        throw new Error("Task recommendation upsert did not return a row.");
      }

      const [scan] = await tx
        .select({
          id: schema.repoScans.id,
          taskRecommendationIds: schema.repoScans.taskRecommendationIds,
          workspaceId: schema.repoScans.workspaceId,
        })
        .from(schema.repoScans)
        .where(
          and(
            eq(schema.repoScans.id, upsertedRecommendation.scanId),
            eq(schema.repoScans.workspaceId, upsertedRecommendation.workspaceId),
          ),
        )
        .limit(1);

      if (scan !== undefined) {
        await tx
          .update(schema.repoScans)
          .set({
            taskRecommendationIds: uniquePreservingOrder([
              ...scan.taskRecommendationIds,
              upsertedRecommendation.id,
            ]),
            updatedAt: recommendation.updatedAt,
          })
          .where(
            and(
              eq(schema.repoScans.id, scan.id),
              eq(schema.repoScans.workspaceId, scan.workspaceId),
            ),
          );
      }

      await tx.insert(schema.auditEvents).values(createAuditEvent(upsertedRecommendation));
      await tx
        .insert(schema.usageEvents)
        .values(
          createUsageEventInsert({
            createdAt: upsertedRecommendation.createdAt,
            idempotencyKey: `usage:${upsertedRecommendation.workspaceId}:task_recommendation_generation:${upsertedRecommendation.id}`,
            metadata: {
              effort: upsertedRecommendation.effort,
              executionMode: upsertedRecommendation.executionMode,
              riskLevel: upsertedRecommendation.riskLevel,
              status: upsertedRecommendation.status,
            },
            occurredAt: upsertedRecommendation.createdAt,
            source: {
              id: upsertedRecommendation.id,
              table: "task_recommendations",
            },
            usageEventType: "task_recommendation_generation",
            workspaceId: upsertedRecommendation.workspaceId,
          }),
        )
        .onConflictDoNothing({
          target: [schema.usageEvents.workspaceId, schema.usageEvents.idempotencyKey],
        });

      return upsertedRecommendation;
    }),
});

export const createTaskRecommendationService = (input: {
  createAuditEventId?: () => string;
  createTaskId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RepoTaskRecommendationStore;
}): TaskRecommendationService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createTaskId = input.createTaskId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  const approveTaskRecommendationForScope = async (inputForScope: {
    actorId: string;
    request: NormalizedTaskRecommendationApprovalRequest;
    workspaceId: string;
  }): Promise<ApprovedTaskRecommendation> => {
    const { request } = inputForScope;
    const { taskRecommendationId } = request;
    const existingRecommendation = await input.store.getTaskRecommendation({
      taskRecommendationId,
      workspaceId: inputForScope.workspaceId,
    });

    if (existingRecommendation === null) {
      throw createActionError("validation_error");
    }

    const persistedRecommendation = toRecommendation(existingRecommendation);

    if (persistedRecommendation.recommendation.cortexTaskId !== undefined) {
      if (hasApprovalEdits(request)) {
        throw createActionError("validation_error");
      }

      const existingTask = await input.store.getCortexTask({
        taskId: persistedRecommendation.recommendation.cortexTaskId,
        workspaceId: inputForScope.workspaceId,
      });

      if (existingTask === null) {
        throw createActionError("validation_error");
      }

      const task = toTask(existingTask);

      if (
        task.repoId !== persistedRecommendation.recommendation.repoId ||
        task.taskRecommendationId !== persistedRecommendation.recommendation.taskRecommendationId
      ) {
        throw createActionError("validation_error");
      }

      return {
        recommendation: persistedRecommendation,
        task,
      };
    }

    if (
      persistedRecommendation.recommendation.status === "deferred" ||
      persistedRecommendation.recommendation.status === "ignored" ||
      persistedRecommendation.recommendation.status === "converted"
    ) {
      throw createActionError("validation_error");
    }

    await assertFindingScope({
      recommendation: persistedRecommendation.recommendation,
      store: input.store,
    });

    const currentTime = now();
    const taskId = normalizeId(createTaskId());
    const taskRecommendation = applyApprovalEdits({
      recommendation: persistedRecommendation.recommendation,
      request,
    });
    const task = buildCortexTaskFromRecommendation({
      currentTime,
      recommendation: taskRecommendation,
      taskId,
    });
    const convertedRecommendation = validateRecommendationInput({
      ...persistedRecommendation.recommendation,
      cortexTaskId: task.taskId,
      status: "converted",
      updatedAt: toIsoString(currentTime),
    });
    const result = await input.store.approveTaskRecommendationWithAudit({
      auditEvents: [
        buildTaskAuditEvent({
          actorId: inputForScope.actorId,
          createAuditEventId,
          now: currentTime,
          recommendationId: persistedRecommendation.recommendation.taskRecommendationId,
          task,
        }),
        buildRecommendationAuditEvent({
          actorId: inputForScope.actorId,
          createAuditEventId,
          eventType: "repo_readiness_task_recommendations.converted",
          message: "Task recommendation converted to a draft Cortex task.",
          now: currentTime,
          recommendation: convertedRecommendation,
        }),
      ],
      task: taskInsertFromCortexTask(task, currentTime),
      taskId: task.taskId,
      taskRecommendationId,
      updatedAt: currentTime,
      workspaceId: inputForScope.workspaceId,
    });

    if (result === null) {
      throw createActionError("validation_error");
    }

    return {
      recommendation: toRecommendation(result.recommendation),
      task: toTask(result.task),
    };
  };

  return {
    approveTaskRecommendation: async (approveInput) => {
      const workspaceId = normalizeId(approveInput.workspaceId);
      const request = normalizeApprovalRequest(approveInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });

      return approveTaskRecommendationForScope({
        actorId: scope.actorId,
        request,
        workspaceId: scope.workspaceId,
      });
    },
    approveTaskRecommendations: async (approveInput) => {
      const workspaceId = normalizeId(approveInput.workspaceId);
      const requests = approveInput.recommendations.map(normalizeApprovalRequest);

      if (requests.length === 0 || requests.length > 20) {
        throw createActionError("validation_error");
      }

      const requestIds = new Set<string>();

      for (const request of requests) {
        if (requestIds.has(request.taskRecommendationId)) {
          throw createActionError("validation_error");
        }

        requestIds.add(request.taskRecommendationId);
      }

      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const approvals: ApprovedTaskRecommendation[] = [];

      for (const request of requests) {
        approvals.push(
          await approveTaskRecommendationForScope({
            actorId: scope.actorId,
            request,
            workspaceId: scope.workspaceId,
          }),
        );
      }

      return approvals;
    },
    listTaskRecommendations: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const repoId = listInput.repoId === undefined ? undefined : normalizeId(listInput.repoId);
      const scanId = listInput.scanId === undefined ? undefined : normalizeId(listInput.scanId);
      const status = listInput.status === undefined ? undefined : normalizeStatus(listInput.status);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const recommendations = await input.store.listTaskRecommendations({
        workspaceId: scope.workspaceId,
        ...(repoId === undefined ? {} : { repoId }),
        ...(scanId === undefined ? {} : { scanId }),
        ...(status === undefined ? {} : { status }),
      });

      return recommendations.map(toRecommendation);
    },
    persistTaskRecommendation: async (persistInput) => {
      const workspaceId = normalizeId(persistInput.workspaceId);
      const repoId = normalizeId(persistInput.repoId);
      const scanId = normalizeId(persistInput.scanId);
      const recommendation = validateRecommendationInput(persistInput.recommendation);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });

      assertMatchingRecommendationScope({
        recommendation,
        repoId,
        scanId,
        workspaceId: scope.workspaceId,
      });

      const repository = await input.store.findGithubRepository({
        repoId,
        workspaceId: scope.workspaceId,
      });

      if (repository === null) {
        throw createActionError("validation_error");
      }

      const scan = await input.store.findRepoScan({
        scanId,
        workspaceId: scope.workspaceId,
      });

      if (scan === null || scan.repoId !== repoId) {
        throw createActionError("validation_error");
      }

      await assertFindingScope({
        recommendation,
        store: input.store,
      });

      const currentTime = now();
      const rowRecommendation = validateRecommendationInput({
        ...recommendation,
        createdAt: toIsoString(currentTime),
        updatedAt: toIsoString(currentTime),
      });
      const upsertedRecommendation =
        await input.store.upsertTaskRecommendationWithAuditAndScanUpdate({
          createAuditEvent: (storedRecommendation) =>
            buildRecommendationAuditEvent({
              actorId: scope.actorId,
              createAuditEventId,
              eventType: "repo_readiness_task_recommendations.upserted",
              message: "Task recommendation persisted.",
              now: currentTime,
              recommendation: toRecommendation(storedRecommendation).recommendation,
            }),
          recommendation: recommendationInsertFromRecommendation(rowRecommendation, currentTime),
        });

      return toRecommendation(upsertedRecommendation);
    },
    updateTaskRecommendationStatus: async (updateInput) => {
      const workspaceId = normalizeId(updateInput.workspaceId);
      const taskRecommendationId = normalizeId(updateInput.taskRecommendationId);
      const status = normalizeStatusUpdate(updateInput.status);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const existingRecommendation = await input.store.getTaskRecommendation({
        taskRecommendationId,
        workspaceId: scope.workspaceId,
      });

      if (existingRecommendation === null || existingRecommendation.status === "converted") {
        throw createActionError("validation_error");
      }

      const currentTime = now();
      const nextRecommendation = toRecommendation({
        ...existingRecommendation,
        status,
        updatedAt: currentTime,
      }).recommendation;
      const auditEvent = buildRecommendationAuditEvent({
        actorId: scope.actorId,
        createAuditEventId,
        eventType: "repo_readiness_task_recommendations.status_updated",
        message: "Task recommendation status updated.",
        now: currentTime,
        recommendation: nextRecommendation,
      });
      const updatedRecommendation = await input.store.updateTaskRecommendationStatusWithAudit({
        auditEvent,
        status,
        taskRecommendationId,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (updatedRecommendation === null) {
        throw createActionError("validation_error");
      }

      return toRecommendation(updatedRecommendation);
    },
  };
};
