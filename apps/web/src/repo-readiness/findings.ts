import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  FindingCategorySchema,
  FindingSchema,
  FindingSeveritySchema,
  FindingStatusSchema,
  type CortexTask,
  type CortexTaskRiskLevel,
  type Finding,
  type FindingCategory,
  type FindingEvidence,
  type FindingSeverity,
  type FindingStatus,
} from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  schema,
  type CortexTaskRecord,
  type Database,
  type FindingRecord,
  type RepoScanRecord,
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
import { buildFindingTaskLinkRows } from "./finding-task-links";

type RepoScanFindingRow = Pick<RepoScanRecord, "id" | "repoId" | "workspaceId">;
type FindingInsert = typeof schema.findings.$inferInsert;
type CortexTaskInsert = typeof schema.cortexTasks.$inferInsert;

export type PersistFindingInput = {
  finding: Finding;
  repoId: string;
  scanId: string;
  taskIds?: string[];
  workspaceId: string;
};

export type ListFindingsInput = {
  category?: FindingCategory;
  repoId?: string;
  scanId?: string;
  severity?: FindingSeverity;
  status?: FindingStatus;
  workspaceId: string;
};

export type UpdateFindingStatusInput = {
  findingId: string;
  status: FindingStatus;
  workspaceId: string;
};

export type ConvertFindingToTaskInput = {
  findingId: string;
  workspaceId: string;
};

export type PersistedFinding = {
  dedupeKey: string;
  finding: Finding;
  taskIds: string[];
};

export type ConvertedFindingTask = {
  finding: PersistedFinding;
  task: CortexTask;
};

export type FindingLifecycleState = "new" | "recurring" | "resolved" | "stale" | "worsened";

export type FindingLifecycleMetadata = {
  lifecycleState: Exclude<FindingLifecycleState, "resolved">;
  previousSeverity?: FindingSeverity;
  previousStatus?: FindingStatus;
};

export type FindingLifecycleSummary = {
  currentFindingIds: string[];
  newCount: number;
  recurringCount: number;
  resolvedCount: number;
  resolvedFindingIds: string[];
  staleCount: number;
  worsenedCount: number;
};

export type RepoFindingStore = WorkspaceMembershipStore & {
  convertFindingToTaskWithAudit: (input: {
    auditEvents: AuditEventInsert[];
    findingId: string;
    task: CortexTaskInsert;
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<{ finding: FindingRecord; task: CortexTaskRecord } | null>;
  findRepoScan: (input: {
    scanId: string;
    workspaceId: string;
  }) => Promise<RepoScanFindingRow | null>;
  getCortexTask: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<CortexTaskRecord | null>;
  getFinding: (input: { findingId: string; workspaceId: string }) => Promise<FindingRecord | null>;
  getFindingByDedupeKey: (input: {
    dedupeKey: string;
    repoId: string;
    workspaceId: string;
  }) => Promise<FindingRecord | null>;
  listFindings: (input: {
    category?: FindingCategory;
    repoId?: string;
    scanId?: string;
    severity?: FindingSeverity;
    status?: FindingStatus;
    workspaceId: string;
  }) => Promise<FindingRecord[]>;
  updateFindingStatusWithAudit: (input: {
    auditEvent: AuditEventInsert;
    findingId: string;
    status: FindingStatus;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<FindingRecord | null>;
  upsertFindingWithAudit: (input: {
    createAuditEvent: (finding: FindingRecord) => AuditEventInsert;
    finding: FindingInsert;
  }) => Promise<FindingRecord>;
};

export type RepoFindingService = {
  convertFindingToTask: (input: ConvertFindingToTaskInput) => Promise<ConvertedFindingTask>;
  listFindings: (input: ListFindingsInput) => Promise<PersistedFinding[]>;
  persistFinding: (input: PersistFindingInput) => Promise<PersistedFinding>;
  reconcileFindingLifecycle: (input: {
    repoId: string;
    scanId: string;
    workspaceId: string;
  }) => Promise<FindingLifecycleSummary>;
  updateFindingStatus: (input: UpdateFindingStatusInput) => Promise<PersistedFinding>;
};

const textMaxLength = 1_000;
const titleMaxLength = 240;
const idPattern = /^[A-Za-z0-9._:-]+$/u;

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

const assertSafeEvidencePayload = (value: unknown): void => {
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

const normalizeStatus = (value: FindingStatus): FindingStatus => {
  const result = FindingStatusSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeCategory = (value: FindingCategory): FindingCategory => {
  const result = FindingCategorySchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeSeverity = (value: FindingSeverity): FindingSeverity => {
  const result = FindingSeveritySchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const normalizeEvidencePath = (path: string): string => {
  const normalizedText = assertSafeText(path, 512).replace(/\\/g, "/").replace(/\/+/g, "/");
  const segments = normalizedText.split("/").filter((segment) => segment.length > 0);

  if (
    normalizedText.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalizedText) ||
    segments.length === 0 ||
    segments.some((segment) => segment === "..")
  ) {
    throw createActionError("validation_error");
  }

  const normalizedPath = segments.filter((segment) => segment !== ".").join("/");

  if (normalizedPath.length === 0 || hasUnsafePayloadPathText(normalizedPath)) {
    throw createActionError("validation_error");
  }

  return normalizedPath;
};

const normalizeEvidence = (evidence: readonly FindingEvidence[]): FindingEvidence[] =>
  evidence.map((item) => ({
    metadata: item.metadata,
    paths: item.paths.map(normalizeEvidencePath),
    summary: assertSafeText(item.summary),
  }));

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

const normalizeTaskIds = (taskIds: readonly string[] | undefined): string[] =>
  uniquePreservingOrder((taskIds ?? []).map(normalizeId));

const allFindingEvidencePaths = (evidence: readonly FindingEvidence[]): string[] =>
  [...new Set(evidence.flatMap((item) => item.paths.map(normalizeEvidencePath)))].sort();

const findingSeverityRank: Record<FindingSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

const isFindingLifecycleState = (value: unknown): value is FindingLifecycleState =>
  value === "new" ||
  value === "recurring" ||
  value === "resolved" ||
  value === "stale" ||
  value === "worsened";

const classifyFindingLifecycle = (
  existingFinding: FindingRecord | null,
  nextFinding: Finding,
): FindingLifecycleMetadata => {
  if (existingFinding === null) {
    return { lifecycleState: "new" };
  }

  if (existingFinding.status === "deferred" || existingFinding.status === "dismissed") {
    return {
      lifecycleState: "stale",
      previousSeverity: existingFinding.severity,
      previousStatus: existingFinding.status,
    };
  }

  if (findingSeverityRank[nextFinding.severity] > findingSeverityRank[existingFinding.severity]) {
    return {
      lifecycleState: "worsened",
      previousSeverity: existingFinding.severity,
      previousStatus: existingFinding.status,
    };
  }

  return {
    lifecycleState: "recurring",
    previousSeverity: existingFinding.severity,
    previousStatus: existingFinding.status,
  };
};

const withLifecycleEvidenceMetadata = (
  evidence: readonly FindingEvidence[],
  lifecycle: FindingLifecycleMetadata,
): FindingEvidence[] => {
  const [firstEvidence, ...remainingEvidence] = evidence;

  if (firstEvidence === undefined) {
    return [];
  }

  return [
    {
      ...firstEvidence,
      metadata: {
        ...firstEvidence.metadata,
        lifecycleState: lifecycle.lifecycleState,
        ...(lifecycle.previousSeverity === undefined
          ? {}
          : { previousSeverity: lifecycle.previousSeverity }),
        ...(lifecycle.previousStatus === undefined
          ? {}
          : { previousStatus: lifecycle.previousStatus }),
      },
    },
    ...remainingEvidence,
  ];
};

const lifecycleStateForFinding = (finding: Finding): FindingLifecycleState => {
  for (const evidence of finding.evidence) {
    const lifecycleState = evidence.metadata.lifecycleState;

    if (isFindingLifecycleState(lifecycleState)) {
      return lifecycleState;
    }
  }

  return finding.createdAt === finding.updatedAt ? "new" : "recurring";
};

export const createFindingDedupeKey = (
  finding: Pick<Finding, "category" | "deterministicRuleId" | "evidence" | "repoId" | "source">,
): string => {
  const payload = {
    category: finding.category,
    deterministicRuleId: finding.deterministicRuleId,
    evidencePaths: allFindingEvidencePaths(finding.evidence),
    repoId: finding.repoId,
    source: finding.source,
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  return `fd_${digest}`;
};

const validateFindingInput = (value: unknown): Finding => {
  assertValidationSafe(value);

  try {
    const finding = FindingSchema.parse(value);
    assertValidationSafe(finding);
    assertSafeEvidencePayload(finding.evidence);
    assertNoUnsafePathText(finding);

    return {
      ...finding,
      deterministicRuleId: normalizeId(finding.deterministicRuleId),
      evidence: normalizeEvidence(finding.evidence),
      recommendation: assertSafeText(finding.recommendation),
      summary: assertSafeText(finding.summary),
      title: assertSafeText(finding.title, titleMaxLength),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createActionError("validation_error");
  }
};

const toIsoString = (value: Date): string => value.toISOString();

const toFinding = (row: FindingRecord): PersistedFinding => {
  const finding = validateFindingInput({
    category: row.category,
    confidence: row.confidence,
    contractVersion: row.contractVersion,
    createdAt: toIsoString(row.createdAt),
    deterministicRuleId: row.deterministicRuleId,
    evidence: row.evidence,
    findingId: row.id,
    recommendation: row.recommendation,
    repoId: row.repoId,
    scanId: row.scanId,
    severity: row.severity,
    source: row.source,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: toIsoString(row.updatedAt),
    workspaceId: row.workspaceId,
  });

  return {
    dedupeKey: row.dedupeKey,
    finding,
    taskIds: row.taskIds.map(normalizeId),
  };
};

const validateCortexTaskInput = (value: unknown): CortexTask => {
  assertValidationSafe(value);

  try {
    const task = CortexTaskSchema.parse(value);
    assertSafeEvidencePayload({
      externalLinks: task.externalLinks,
      metadata: task.metadata,
      suggestedValidation: task.suggestedValidation,
    });
    assertNoUnsafePathText(task);

    return task;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createActionError("validation_error");
  }
};

const toCortexTask = (row: CortexTaskRecord): CortexTask =>
  validateCortexTaskInput({
    acceptanceCriteria: row.acceptanceCriteria,
    approvalStatus: row.approvalStatus,
    contractVersion: row.contractVersion,
    createdAt: toIsoString(row.createdAt),
    executionMode: row.executionMode,
    externalLinks: row.externalLinks,
    findingIds: row.findingIds,
    ...(row.latestRunId === null ? {} : { latestRunId: row.latestRunId }),
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

const assertMatchingFindingScope = (input: {
  finding: Finding;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): void => {
  if (
    input.finding.workspaceId !== input.workspaceId ||
    input.finding.repoId !== input.repoId ||
    input.finding.scanId !== input.scanId
  ) {
    throw createActionError("validation_error");
  }
};

const auditMetadataForFinding = (
  finding: PersistedFinding,
  lifecycle?: FindingLifecycleMetadata,
): Record<string, unknown> => {
  const metadata = {
    category: finding.finding.category,
    dedupeKeyLength: finding.dedupeKey.length,
    evidenceCount: finding.finding.evidence.length,
    findingId: finding.finding.findingId,
    ...(lifecycle === undefined
      ? {}
      : {
          lifecycleState: lifecycle.lifecycleState,
          ...(lifecycle.previousSeverity === undefined
            ? {}
            : { previousSeverity: lifecycle.previousSeverity }),
          ...(lifecycle.previousStatus === undefined
            ? {}
            : { previousStatus: lifecycle.previousStatus }),
        }),
    recommendationLength: finding.finding.recommendation.length,
    repoId: finding.finding.repoId,
    scanId: finding.finding.scanId,
    severity: finding.finding.severity,
    status: finding.finding.status,
    summaryLength: finding.finding.summary.length,
    taskIdCount: finding.taskIds.length,
    titleLength: finding.finding.title.length,
  };

  assertSafeEvidencePayload(metadata);

  return metadata;
};

const auditMetadataForConvertedTask = (input: {
  findingId: string;
  task: CortexTask;
}): Record<string, unknown> => {
  const metadata = {
    acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
    approvalStatus: input.task.approvalStatus,
    executionMode: input.task.executionMode,
    findingCount: input.task.findingIds.length,
    findingId: input.findingId,
    objectiveLength: input.task.objective.length,
    originType: input.task.origin.type,
    repoId: input.task.repoId,
    riskLevel: input.task.riskLevel,
    runCount: input.task.runIds.length,
    status: input.task.status,
    taskId: input.task.taskId,
    titleLength: input.task.title.length,
  };

  assertSafeEvidencePayload(metadata);

  return metadata;
};

const buildAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  eventType: string;
  finding: PersistedFinding;
  lifecycle?: FindingLifecycleMetadata;
  message: string;
  now: Date;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: input.eventType,
    message: input.message,
    metadata: auditMetadataForFinding(input.finding, input.lifecycle),
    now: () => input.now,
    workspaceId: input.finding.finding.workspaceId,
  });

const buildConvertedTaskAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  findingId: string;
  now: Date;
  task: CortexTask;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: "repo_readiness_cortex_tasks.created_from_finding",
    message: "Cortex task created from repo readiness finding.",
    metadata: auditMetadataForConvertedTask({
      findingId: input.findingId,
      task: input.task,
    }),
    now: () => input.now,
    workspaceId: input.task.workspaceId,
  });

const riskLevelForFindingSeverity = (severity: FindingSeverity): CortexTaskRiskLevel => {
  switch (severity) {
    case "info":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "blocked":
      return "blocked";
  }
};

const acceptanceCriteriaForFinding = (finding: Finding): string[] =>
  uniquePreservingOrder([
    finding.summary,
    ...finding.evidence.map((item) => item.summary),
    "Finding remains linked to the draft Cortex Task for human review before execution.",
  ]).map((item) => assertSafeText(item));

const buildCortexTaskFromFinding = (input: {
  currentTime: Date;
  finding: Finding;
  taskId: string;
}): CortexTask => {
  const timestamp = toIsoString(input.currentTime);

  return validateCortexTaskInput({
    acceptanceCriteria: acceptanceCriteriaForFinding(input.finding),
    approvalStatus: "not_requested",
    contractVersion: CONTRACT_VERSION,
    createdAt: timestamp,
    executionMode: "setup_pr",
    externalLinks: [],
    findingIds: [input.finding.findingId],
    metadata: {
      evidenceCount: input.finding.evidence.length,
      findingCategory: input.finding.category,
      findingSeverity: input.finding.severity,
      pathCount: allFindingEvidencePaths(input.finding.evidence).length,
      scanId: input.finding.scanId,
    },
    objective: input.finding.recommendation,
    origin: {
      type: "finding",
    },
    prArtifactIds: [],
    repoId: input.finding.repoId,
    riskLevel: riskLevelForFindingSeverity(input.finding.severity),
    runIds: [],
    status: "draft",
    suggestedValidation: [],
    taskId: input.taskId,
    title: input.finding.title,
    updatedAt: timestamp,
    workspaceId: input.finding.workspaceId,
  });
};

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

export const createDrizzleRepoFindingStore = (db: Database): RepoFindingStore => ({
  convertFindingToTaskWithAudit: async ({
    auditEvents,
    findingId,
    task,
    taskId,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [existingFinding] = await tx
        .select()
        .from(schema.findings)
        .where(and(eq(schema.findings.id, findingId), eq(schema.findings.workspaceId, workspaceId)))
        .limit(1);

      if (existingFinding === undefined || existingFinding.taskIds.length > 0) {
        return null;
      }

      const [createdTask] = await tx.insert(schema.cortexTasks).values(task).returning();

      if (createdTask === undefined) {
        return null;
      }

      const [updatedFinding] = await tx
        .update(schema.findings)
        .set({
          taskIds: uniquePreservingOrder([...existingFinding.taskIds, taskId]),
          updatedAt,
        })
        .where(and(eq(schema.findings.id, findingId), eq(schema.findings.workspaceId, workspaceId)))
        .returning();

      if (updatedFinding === undefined) {
        return null;
      }

      const findingTaskLinkRows = buildFindingTaskLinkRows(createdTask, updatedAt);
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
        finding: updatedFinding,
        task: createdTask,
      };
    }),
  findRepoScan: async ({ scanId, workspaceId }) => {
    const [scan] = await db
      .select({
        id: schema.repoScans.id,
        repoId: schema.repoScans.repoId,
        workspaceId: schema.repoScans.workspaceId,
      })
      .from(schema.repoScans)
      .where(and(eq(schema.repoScans.id, scanId), eq(schema.repoScans.workspaceId, workspaceId)))
      .limit(1);

    return scan ?? null;
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
  getFinding: async ({ findingId, workspaceId }) => {
    const [finding] = await db
      .select()
      .from(schema.findings)
      .where(and(eq(schema.findings.id, findingId), eq(schema.findings.workspaceId, workspaceId)))
      .limit(1);

    return finding ?? null;
  },
  getFindingByDedupeKey: async ({ dedupeKey, repoId, workspaceId }) => {
    const [finding] = await db
      .select()
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.dedupeKey, dedupeKey),
          eq(schema.findings.repoId, repoId),
          eq(schema.findings.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return finding ?? null;
  },
  listFindings: async ({ category, repoId, scanId, severity, status, workspaceId }) => {
    const conditions = [eq(schema.findings.workspaceId, workspaceId)];

    if (category !== undefined) {
      conditions.push(eq(schema.findings.category, category));
    }

    if (repoId !== undefined) {
      conditions.push(eq(schema.findings.repoId, repoId));
    }

    if (scanId !== undefined) {
      conditions.push(eq(schema.findings.scanId, scanId));
    }

    if (severity !== undefined) {
      conditions.push(eq(schema.findings.severity, severity));
    }

    if (status !== undefined) {
      conditions.push(eq(schema.findings.status, status));
    }

    return db
      .select()
      .from(schema.findings)
      .where(and(...conditions))
      .orderBy(desc(schema.findings.updatedAt));
  },
  updateFindingStatusWithAudit: async ({ auditEvent, findingId, status, updatedAt, workspaceId }) =>
    db.transaction(async (tx) => {
      const [updatedFinding] = await tx
        .update(schema.findings)
        .set({ status, updatedAt })
        .where(and(eq(schema.findings.id, findingId), eq(schema.findings.workspaceId, workspaceId)))
        .returning();

      if (updatedFinding === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return updatedFinding;
    }),
  upsertFindingWithAudit: async ({ createAuditEvent, finding }) =>
    db.transaction(async (tx) => {
      const [upsertedFinding] = await tx
        .insert(schema.findings)
        .values(finding)
        .onConflictDoUpdate({
          set: {
            category: finding.category,
            confidence: finding.confidence,
            contractVersion: finding.contractVersion,
            deterministicRuleId: finding.deterministicRuleId,
            evidence: finding.evidence,
            recommendation: finding.recommendation,
            scanId: finding.scanId,
            severity: finding.severity,
            source: finding.source,
            status: finding.status,
            summary: finding.summary,
            taskIds: finding.taskIds,
            title: finding.title,
            updatedAt: finding.updatedAt,
          },
          target: [schema.findings.workspaceId, schema.findings.repoId, schema.findings.dedupeKey],
        })
        .returning();

      if (upsertedFinding === undefined) {
        throw new Error("Finding upsert did not return a row.");
      }

      const auditEvent = createAuditEvent(upsertedFinding);

      await tx.insert(schema.auditEvents).values(auditEvent);

      return upsertedFinding;
    }),
});

export const createRepoFindingService = (input: {
  createAuditEventId?: () => string;
  createFindingId?: () => string;
  createTaskId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RepoFindingStore;
}): RepoFindingService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createFindingId = input.createFindingId ?? randomUUID;
  const createTaskId = input.createTaskId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    convertFindingToTask: async (convertInput) => {
      const workspaceId = normalizeId(convertInput.workspaceId);
      const findingId = normalizeId(convertInput.findingId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const existingFinding = await input.store.getFinding({
        findingId,
        workspaceId: scope.workspaceId,
      });

      if (existingFinding === null) {
        throw createActionError("validation_error");
      }

      const persistedFinding = toFinding(existingFinding);
      const existingTaskId = persistedFinding.taskIds[0];

      if (existingTaskId !== undefined) {
        const existingTask = await input.store.getCortexTask({
          taskId: existingTaskId,
          workspaceId: scope.workspaceId,
        });

        if (existingTask === null) {
          throw createActionError("validation_error");
        }

        const task = toCortexTask(existingTask);

        if (
          task.repoId !== persistedFinding.finding.repoId ||
          !task.findingIds.includes(persistedFinding.finding.findingId)
        ) {
          throw createActionError("validation_error");
        }

        return {
          finding: persistedFinding,
          task,
        };
      }

      const currentTime = now();
      const taskId = normalizeId(createTaskId());
      const task = buildCortexTaskFromFinding({
        currentTime,
        finding: persistedFinding.finding,
        taskId,
      });
      const findingWithTask = {
        ...persistedFinding,
        finding: {
          ...persistedFinding.finding,
          updatedAt: toIsoString(currentTime),
        },
        taskIds: uniquePreservingOrder([...persistedFinding.taskIds, task.taskId]),
      };
      const result = await input.store.convertFindingToTaskWithAudit({
        auditEvents: [
          buildConvertedTaskAuditEvent({
            actorId: scope.actorId,
            createAuditEventId,
            findingId: persistedFinding.finding.findingId,
            now: currentTime,
            task,
          }),
          buildAuditEvent({
            actorId: scope.actorId,
            createAuditEventId,
            eventType: "repo_readiness_findings.task_linked",
            finding: findingWithTask,
            message: "Repo readiness finding linked to Cortex task.",
            now: currentTime,
          }),
        ],
        findingId,
        task: taskInsertFromCortexTask(task, currentTime),
        taskId: task.taskId,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (result === null) {
        throw createActionError("validation_error");
      }

      return {
        finding: toFinding(result.finding),
        task: toCortexTask(result.task),
      };
    },
    listFindings: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const category =
        listInput.category === undefined ? undefined : normalizeCategory(listInput.category);
      const repoId = listInput.repoId === undefined ? undefined : normalizeId(listInput.repoId);
      const scanId = listInput.scanId === undefined ? undefined : normalizeId(listInput.scanId);
      const severity =
        listInput.severity === undefined ? undefined : normalizeSeverity(listInput.severity);
      const status = listInput.status === undefined ? undefined : normalizeStatus(listInput.status);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const findings = await input.store.listFindings({
        workspaceId: scope.workspaceId,
        ...(category === undefined ? {} : { category }),
        ...(repoId === undefined ? {} : { repoId }),
        ...(scanId === undefined ? {} : { scanId }),
        ...(severity === undefined ? {} : { severity }),
        ...(status === undefined ? {} : { status }),
      });

      return findings.map(toFinding);
    },
    persistFinding: async (persistInput) => {
      const workspaceId = normalizeId(persistInput.workspaceId);
      const repoId = normalizeId(persistInput.repoId);
      const scanId = normalizeId(persistInput.scanId);
      const finding = validateFindingInput(persistInput.finding);
      const taskIds = normalizeTaskIds(persistInput.taskIds);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });

      assertMatchingFindingScope({
        finding,
        repoId,
        scanId,
        workspaceId: scope.workspaceId,
      });

      const scan = await input.store.findRepoScan({
        scanId,
        workspaceId: scope.workspaceId,
      });

      if (scan === null || scan.repoId !== repoId) {
        throw createActionError("validation_error");
      }

      const currentTime = now();
      const dedupeKey = createFindingDedupeKey(finding);
      const existingFinding = await input.store.getFindingByDedupeKey({
        dedupeKey,
        repoId,
        workspaceId: scope.workspaceId,
      });
      const lifecycle = classifyFindingLifecycle(existingFinding, finding);
      const rowFinding = validateFindingInput({
        ...finding,
        createdAt: toIsoString(currentTime),
        evidence: withLifecycleEvidenceMetadata(finding.evidence, lifecycle),
        findingId: normalizeId(createFindingId()),
        updatedAt: toIsoString(currentTime),
      });
      const mergedTaskIds = uniquePreservingOrder([
        ...(existingFinding?.taskIds.map(normalizeId) ?? []),
        ...taskIds,
      ]);
      const row: FindingInsert = {
        category: rowFinding.category,
        confidence: rowFinding.confidence,
        contractVersion: rowFinding.contractVersion,
        createdAt: currentTime,
        dedupeKey,
        deterministicRuleId: rowFinding.deterministicRuleId,
        evidence: rowFinding.evidence,
        id: rowFinding.findingId,
        recommendation: rowFinding.recommendation,
        repoId: rowFinding.repoId,
        scanId: rowFinding.scanId,
        severity: rowFinding.severity,
        source: rowFinding.source,
        status: rowFinding.status,
        summary: rowFinding.summary,
        taskIds: mergedTaskIds,
        title: rowFinding.title,
        updatedAt: currentTime,
        workspaceId: rowFinding.workspaceId,
      };
      const upsertedFinding = await input.store.upsertFindingWithAudit({
        createAuditEvent: (persistedFinding) =>
          buildAuditEvent({
            actorId: scope.actorId,
            createAuditEventId,
            eventType: "repo_readiness_findings.upserted",
            finding: toFinding(persistedFinding),
            lifecycle,
            message: "Repo readiness finding persisted.",
            now: currentTime,
          }),
        finding: row,
      });

      return toFinding(upsertedFinding);
    },
    reconcileFindingLifecycle: async (reconcileInput) => {
      const workspaceId = normalizeId(reconcileInput.workspaceId);
      const repoId = normalizeId(reconcileInput.repoId);
      const scanId = normalizeId(reconcileInput.scanId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const scan = await input.store.findRepoScan({
        scanId,
        workspaceId: scope.workspaceId,
      });

      if (scan === null || scan.repoId !== repoId) {
        throw createActionError("validation_error");
      }

      const currentTime = now();
      const currentFindings = (
        await input.store.listFindings({
          repoId,
          scanId,
          workspaceId: scope.workspaceId,
        })
      ).map(toFinding);
      const currentDedupeKeys = new Set(currentFindings.map((finding) => finding.dedupeKey));
      const openRepoFindings = (
        await input.store.listFindings({
          repoId,
          status: "open",
          workspaceId: scope.workspaceId,
        })
      ).map(toFinding);
      const resolvedFindingIds: string[] = [];

      for (const openFinding of openRepoFindings) {
        if (openFinding.finding.scanId === scanId || currentDedupeKeys.has(openFinding.dedupeKey)) {
          continue;
        }

        const resolvedFinding = {
          ...openFinding,
          finding: {
            ...openFinding.finding,
            status: "resolved" as const,
            updatedAt: toIsoString(currentTime),
          },
        };
        const updatedFinding = await input.store.updateFindingStatusWithAudit({
          auditEvent: buildAuditEvent({
            actorId: scope.actorId,
            createAuditEventId,
            eventType: "repo_readiness_findings.status_updated",
            finding: resolvedFinding,
            message: "Repo readiness finding status updated.",
            now: currentTime,
          }),
          findingId: openFinding.finding.findingId,
          status: "resolved",
          updatedAt: currentTime,
          workspaceId: scope.workspaceId,
        });

        if (updatedFinding === null) {
          throw createActionError("validation_error");
        }

        resolvedFindingIds.push(openFinding.finding.findingId);
      }

      const lifecycleStates = currentFindings.map((finding) =>
        lifecycleStateForFinding(finding.finding),
      );

      return {
        currentFindingIds: currentFindings.map((finding) => finding.finding.findingId),
        newCount: lifecycleStates.filter((state) => state === "new").length,
        recurringCount: lifecycleStates.filter((state) => state === "recurring").length,
        resolvedCount: resolvedFindingIds.length,
        resolvedFindingIds,
        staleCount: lifecycleStates.filter((state) => state === "stale").length,
        worsenedCount: lifecycleStates.filter((state) => state === "worsened").length,
      };
    },
    updateFindingStatus: async (updateInput) => {
      const workspaceId = normalizeId(updateInput.workspaceId);
      const findingId = normalizeId(updateInput.findingId);
      const status = normalizeStatus(updateInput.status);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const currentTime = now();
      const existingFinding = await input.store.getFinding({
        findingId,
        workspaceId: scope.workspaceId,
      });

      if (existingFinding === null) {
        throw createActionError("validation_error");
      }

      const nextFinding = toFinding({
        ...existingFinding,
        status,
        updatedAt: currentTime,
      });
      const auditEvent = buildAuditEvent({
        actorId: scope.actorId,
        createAuditEventId,
        eventType: "repo_readiness_findings.status_updated",
        finding: nextFinding,
        message: "Repo readiness finding status updated.",
        now: currentTime,
      });
      const updatedFinding = await input.store.updateFindingStatusWithAudit({
        auditEvent,
        findingId,
        status,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      if (updatedFinding === null) {
        throw createActionError("validation_error");
      }

      return toFinding(updatedFinding);
    },
  };
};
