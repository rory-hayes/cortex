import "server-only";

import {
  CortexTaskSchema,
  FindingSchema,
  type CortexTask,
  type Finding,
} from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  schema,
  type CortexTaskRecord,
  type Database,
  type FindingRecord,
} from "../db";
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
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";

type FindingTaskLinkInsert = typeof schema.findingTaskLinks.$inferInsert;

export type FindingTaskLinkTaskSource = Pick<
  CortexTaskRecord,
  "findingIds" | "id" | "repoId" | "taskRecommendationId" | "workspaceId"
>;

export type FindingTaskLinkStore = WorkspaceMembershipStore & {
  listCortexTasksForFinding: (input: {
    findingId: string;
    workspaceId: string;
  }) => Promise<CortexTaskRecord[]>;
  listFindingsForCortexTask: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<FindingRecord[]>;
};

export type FindingTaskLinkService = {
  listCortexTasksForFinding: (input: {
    findingId: string;
    workspaceId: string;
  }) => Promise<CortexTask[]>;
  listFindingsForCortexTask: (input: { taskId: string; workspaceId: string }) => Promise<Finding[]>;
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

const normalizeTimestamp = (value: string): string => {
  const normalizedValue = assertSafeText(value, 80);
  const timestamp = new Date(normalizedValue);

  if (Number.isNaN(timestamp.getTime())) {
    throw createActionError("validation_error");
  }

  return timestamp.toISOString();
};

const normalizeIdArray = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = normalizeId(value);

    if (!seen.has(normalizedValue)) {
      seen.add(normalizedValue);
      result.push(normalizedValue);
    }
  }

  return result;
};

const normalizeTextArray = (values: readonly string[]): string[] =>
  values.map((value) => assertSafeText(value));

const toIsoString = (value: Date): string => value.toISOString();

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
      findingIds: normalizeIdArray(task.findingIds),
      objective: assertSafeText(task.objective),
      prArtifactIds: normalizeIdArray(task.prArtifactIds),
      repoId: normalizeId(task.repoId),
      runIds: normalizeIdArray(task.runIds),
      taskId: normalizeId(task.taskId),
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

const validateFindingInput = (value: unknown): Finding => {
  assertValidationSafe(value);

  try {
    const finding = FindingSchema.parse(value);
    assertSafePayload(finding.evidence);
    assertNoUnsafePathText(finding);

    return {
      ...finding,
      createdAt: normalizeTimestamp(finding.createdAt),
      deterministicRuleId: normalizeId(finding.deterministicRuleId),
      findingId: normalizeId(finding.findingId),
      recommendation: assertSafeText(finding.recommendation),
      repoId: normalizeId(finding.repoId),
      scanId: normalizeId(finding.scanId),
      summary: assertSafeText(finding.summary),
      title: assertSafeText(finding.title, titleMaxLength),
      updatedAt: normalizeTimestamp(finding.updatedAt),
      workspaceId: normalizeId(finding.workspaceId),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createActionError("validation_error");
  }
};

const toTask = (row: CortexTaskRecord): CortexTask =>
  validateTaskInput({
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

const toFinding = (row: FindingRecord): Finding =>
  validateFindingInput({
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

export const buildFindingTaskLinkRows = (
  task: FindingTaskLinkTaskSource,
  timestamp: Date,
): FindingTaskLinkInsert[] => {
  const seen = new Set<string>();
  const rows: FindingTaskLinkInsert[] = [];

  for (const findingId of task.findingIds) {
    const normalizedFindingId = normalizeId(findingId);

    if (seen.has(normalizedFindingId)) {
      continue;
    }
    seen.add(normalizedFindingId);

    rows.push({
      cortexTaskId: normalizeId(task.id),
      createdAt: timestamp,
      findingId: normalizedFindingId,
      id: `finding_task_link:${normalizedFindingId}:${normalizeId(task.id)}`,
      repoId: normalizeId(task.repoId),
      taskRecommendationId:
        task.taskRecommendationId === null ? null : normalizeId(task.taskRecommendationId),
      updatedAt: timestamp,
      workspaceId: normalizeId(task.workspaceId),
    });
  }

  return rows;
};

export const createDrizzleFindingTaskLinkStore = (db: Database): FindingTaskLinkStore => ({
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
  listCortexTasksForFinding: async ({ findingId, workspaceId }) => {
    const rows = await db
      .select({
        task: schema.cortexTasks,
      })
      .from(schema.findingTaskLinks)
      .innerJoin(
        schema.cortexTasks,
        and(
          eq(schema.cortexTasks.workspaceId, schema.findingTaskLinks.workspaceId),
          eq(schema.cortexTasks.repoId, schema.findingTaskLinks.repoId),
          eq(schema.cortexTasks.id, schema.findingTaskLinks.cortexTaskId),
        ),
      )
      .where(
        and(
          eq(schema.findingTaskLinks.workspaceId, workspaceId),
          eq(schema.findingTaskLinks.findingId, findingId),
        ),
      )
      .orderBy(desc(schema.cortexTasks.updatedAt));

    return rows.map((row) => row.task);
  },
  listFindingsForCortexTask: async ({ taskId, workspaceId }) => {
    const rows = await db
      .select({
        finding: schema.findings,
      })
      .from(schema.findingTaskLinks)
      .innerJoin(
        schema.findings,
        and(
          eq(schema.findings.workspaceId, schema.findingTaskLinks.workspaceId),
          eq(schema.findings.repoId, schema.findingTaskLinks.repoId),
          eq(schema.findings.id, schema.findingTaskLinks.findingId),
        ),
      )
      .where(
        and(
          eq(schema.findingTaskLinks.workspaceId, workspaceId),
          eq(schema.findingTaskLinks.cortexTaskId, taskId),
        ),
      )
      .orderBy(desc(schema.findings.updatedAt));

    return rows.map((row) => row.finding);
  },
});

export const createFindingTaskLinkService = (input: {
  getAuthContext?: GetAuthContext;
  store: FindingTaskLinkStore;
}): FindingTaskLinkService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listCortexTasksForFinding: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const findingId = normalizeId(listInput.findingId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const tasks = await input.store.listCortexTasksForFinding({
        findingId,
        workspaceId: scope.workspaceId,
      });

      return tasks.map(toTask);
    },
    listFindingsForCortexTask: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const taskId = normalizeId(listInput.taskId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const findings = await input.store.listFindingsForCortexTask({
        taskId,
        workspaceId: scope.workspaceId,
      });

      return findings.map(toFinding);
    },
  };
};
