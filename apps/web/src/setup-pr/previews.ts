import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  SetupPrPreviewSchema,
  type CortexTask,
  type SetupPrPreview,
  type SetupPrPreviewFile,
} from "@control-plane/shared";

import { and, desc, eq, inArray, schema, type Database } from "../db";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import { createUsageEventInsert } from "../billing/usage-events";
import { buildSetupPrTemplateFilesForTask } from "./templates";

type SetupPrTaskRow = {
  acceptanceCriteria: CortexTask["acceptanceCriteria"];
  approvalStatus: CortexTask["approvalStatus"];
  contractVersion: CortexTask["contractVersion"];
  createdAt: Date;
  executionMode: CortexTask["executionMode"];
  externalLinks: CortexTask["externalLinks"];
  findingIds: string[];
  id: string;
  latestRunId: string | null;
  metadata: CortexTask["metadata"];
  objective: string;
  originExternalId: string | null;
  originExternalSystem: string | null;
  originType: CortexTask["origin"]["type"];
  prArtifactIds: string[];
  repoId: string;
  riskLevel: CortexTask["riskLevel"];
  runIds: string[];
  status: CortexTask["status"];
  suggestedValidation: CortexTask["suggestedValidation"];
  taskPacketId: string | null;
  taskRecommendationId: string | null;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type SetupPrRepositoryRow = {
  id: string;
  workspaceId: string;
};

export type SetupPrPreviewRow = {
  contractVersion: SetupPrPreview["contractVersion"];
  createdAt: Date;
  excludedTaskIds: string[];
  excludedTemplateIds: string[];
  files: SetupPrPreview["files"];
  id: string;
  metadata: SetupPrPreview["metadata"];
  repoId: string;
  status: SetupPrPreview["status"];
  taskIds: string[];
  updatedAt: Date;
  workspaceId: string;
};

export type CreateSetupPrPreviewInput = {
  excludedTaskIds?: string[];
  excludedTemplateIds?: string[];
  repoId: string;
  taskIds: string[];
  workspaceId: string;
};

export type GetSetupPrPreviewInput = {
  previewId: string;
  workspaceId: string;
};

export type ListSetupPrPreviewsInput = {
  repoId?: string;
  workspaceId: string;
};

export type SetupPrPreviewStore = WorkspaceMembershipStore & {
  findGithubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<SetupPrRepositoryRow | null>;
  getSetupPrPreview: (input: {
    previewId: string;
    workspaceId: string;
  }) => Promise<SetupPrPreviewRow | null>;
  listSetupPrPreviews: (input: {
    repoId?: string;
    workspaceId: string;
  }) => Promise<SetupPrPreviewRow[]>;
  listCortexTasksByIds: (input: {
    repoId: string;
    taskIds: string[];
    workspaceId: string;
  }) => Promise<SetupPrTaskRow[]>;
  persistSetupPrPreviewWithAudit: (input: {
    auditEvent: AuditEventInsert;
    preview: Omit<SetupPrPreviewRow, "createdAt" | "updatedAt"> & {
      createdAt?: Date;
      updatedAt?: Date;
    };
  }) => Promise<SetupPrPreviewRow>;
};

export type SetupPrPreviewService = {
  createSetupPrPreview: (input: CreateSetupPrPreviewInput) => Promise<SetupPrPreview>;
  getSetupPrPreview: (input: GetSetupPrPreviewInput) => Promise<SetupPrPreview>;
  listSetupPrPreviews: (input: ListSetupPrPreviewsInput) => Promise<SetupPrPreview[]>;
};

type SetupPrPreviewInsert = typeof schema.setupPrPreviews.$inferInsert;

const idPattern = /^[A-Za-z0-9._:-]+$/u;

const toIsoString = (value: Date): string => value.toISOString();

const normalizeId = (value: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || normalizedValue.length > 240 || !idPattern.test(value)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const uniquePreservingOrder = (values: readonly string[]): string[] => {
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

const parseCortexTask = (value: unknown): CortexTask => {
  const result = CortexTaskSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const parseSetupPrPreview = (value: unknown): SetupPrPreview => {
  const result = SetupPrPreviewSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const toTask = (row: SetupPrTaskRow): CortexTask =>
  parseCortexTask({
    acceptanceCriteria: row.acceptanceCriteria,
    approvalStatus: row.approvalStatus,
    contractVersion: row.contractVersion,
    createdAt: row.createdAt.toISOString(),
    executionMode: row.executionMode,
    externalLinks: row.externalLinks,
    findingIds: row.findingIds,
    latestRunId: row.latestRunId ?? undefined,
    metadata: row.metadata,
    objective: row.objective,
    origin: {
      externalId: row.originExternalId ?? undefined,
      externalSystem: row.originExternalSystem ?? undefined,
      type: row.originType,
    },
    prArtifactIds: row.prArtifactIds,
    repoId: row.repoId,
    riskLevel: row.riskLevel,
    runIds: row.runIds,
    status: row.status,
    suggestedValidation: row.suggestedValidation,
    taskId: row.id,
    taskPacketId: row.taskPacketId ?? undefined,
    taskRecommendationId: row.taskRecommendationId ?? undefined,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    workspaceId: row.workspaceId,
  });

const toPreview = (row: SetupPrPreviewRow): SetupPrPreview =>
  parseSetupPrPreview({
    contractVersion: row.contractVersion,
    createdAt: toIsoString(row.createdAt),
    excludedTaskIds: row.excludedTaskIds,
    excludedTemplateIds: row.excludedTemplateIds,
    files: row.files,
    metadata: row.metadata,
    previewId: row.id,
    repoId: row.repoId,
    status: row.status,
    taskIds: row.taskIds,
    updatedAt: toIsoString(row.updatedAt),
    workspaceId: row.workspaceId,
  });

const assertPreviewEligibleTask = (task: CortexTask): void => {
  if (
    task.approvalStatus !== "approved" ||
    task.status !== "approved" ||
    task.executionMode !== "setup_pr" ||
    task.riskLevel === "blocked"
  ) {
    throw createActionError("validation_error");
  }
};

const buildPreviewFiles = (input: {
  excludedTemplateIds: readonly string[];
  tasks: readonly CortexTask[];
}): SetupPrPreviewFile[] => {
  const excludedTemplateIds = new Set(input.excludedTemplateIds);
  const filesByTemplateId = new Map<string, SetupPrPreviewFile>();

  for (const task of input.tasks) {
    const taskFiles = buildSetupPrTemplateFilesForTask(task);

    for (const taskFile of taskFiles) {
      if (excludedTemplateIds.has(taskFile.templateId)) {
        continue;
      }

      const existingFile = filesByTemplateId.get(taskFile.templateId);

      if (existingFile !== undefined) {
        if (!existingFile.sourceTaskIds.includes(task.taskId)) {
          existingFile.sourceTaskIds.push(task.taskId);
        }

        continue;
      }

      filesByTemplateId.set(taskFile.templateId, {
        omittedContent: true,
        operation: taskFile.operation,
        path: taskFile.path,
        reviewInstructions: [...taskFile.reviewInstructions],
        reviewRequired: taskFile.reviewRequired,
        sourceTaskIds: [task.taskId],
        summary: taskFile.summary,
        templateId: taskFile.templateId,
      });
    }
  }

  return Array.from(filesByTemplateId.values());
};

export const createDrizzleSetupPrPreviewStore = (db: Database): SetupPrPreviewStore => ({
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
  getSetupPrPreview: async ({ previewId, workspaceId }) => {
    const [preview] = await db
      .select()
      .from(schema.setupPrPreviews)
      .where(
        and(
          eq(schema.setupPrPreviews.id, previewId),
          eq(schema.setupPrPreviews.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return preview ?? null;
  },
  listSetupPrPreviews: async ({ repoId, workspaceId }) => {
    const conditions = [eq(schema.setupPrPreviews.workspaceId, workspaceId)];

    if (repoId !== undefined) {
      conditions.push(eq(schema.setupPrPreviews.repoId, repoId));
    }

    return db
      .select()
      .from(schema.setupPrPreviews)
      .where(and(...conditions))
      .orderBy(desc(schema.setupPrPreviews.updatedAt));
  },
  listCortexTasksByIds: async ({ repoId, taskIds, workspaceId }) => {
    if (taskIds.length === 0) {
      return [];
    }

    return db
      .select()
      .from(schema.cortexTasks)
      .where(
        and(
          eq(schema.cortexTasks.workspaceId, workspaceId),
          eq(schema.cortexTasks.repoId, repoId),
          inArray(schema.cortexTasks.id, taskIds),
        ),
      );
  },
  persistSetupPrPreviewWithAudit: async ({ auditEvent, preview }) =>
    db.transaction(async (tx) => {
      const [persistedPreview] = await tx
        .insert(schema.setupPrPreviews)
        .values(preview as SetupPrPreviewInsert)
        .returning();

      if (persistedPreview === undefined) {
        throw createActionError("validation_error");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);
      await tx
        .insert(schema.usageEvents)
        .values(
          createUsageEventInsert({
            createdAt: persistedPreview.createdAt,
            idempotencyKey: `usage:${persistedPreview.workspaceId}:setup_pr_generation:${persistedPreview.id}`,
            metadata: {
              excludedTaskCount: persistedPreview.excludedTaskIds.length,
              excludedTemplateCount: persistedPreview.excludedTemplateIds.length,
              status: persistedPreview.status,
              taskCount: persistedPreview.taskIds.length,
            },
            occurredAt: persistedPreview.createdAt,
            source: {
              id: persistedPreview.id,
              table: "setup_pr_previews",
            },
            usageEventType: "setup_pr_generation",
            workspaceId: persistedPreview.workspaceId,
          }),
        )
        .onConflictDoNothing({
          target: [schema.usageEvents.workspaceId, schema.usageEvents.idempotencyKey],
        });

      return persistedPreview;
    }),
});

export const createSetupPrPreviewService = (input: {
  createAuditEventId?: () => string;
  createPreviewId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: SetupPrPreviewStore;
}): SetupPrPreviewService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createPreviewId = input.createPreviewId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    createSetupPrPreview: async (createInput) => {
      const workspaceId = normalizeId(createInput.workspaceId);
      const repoId = normalizeId(createInput.repoId);
      const taskIds = uniquePreservingOrder(createInput.taskIds);
      const excludedTaskIds = uniquePreservingOrder(createInput.excludedTaskIds ?? []);
      const excludedTemplateIds = uniquePreservingOrder(createInput.excludedTemplateIds ?? []);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });

      if (taskIds.length === 0) {
        throw createActionError("validation_error");
      }

      const repository = await input.store.findGithubRepository({
        repoId,
        workspaceId: scope.workspaceId,
      });

      if (repository === null) {
        throw createActionError("validation_error");
      }

      const excludedTaskIdSet = new Set(excludedTaskIds);
      const includedTaskIds = taskIds.filter((taskId) => !excludedTaskIdSet.has(taskId));

      if (includedTaskIds.length === 0) {
        throw createActionError("validation_error");
      }

      const taskRows = await input.store.listCortexTasksByIds({
        repoId,
        taskIds: includedTaskIds,
        workspaceId: scope.workspaceId,
      });
      const taskRowsById = new Map(taskRows.map((task) => [task.id, task]));

      if (taskRowsById.size !== includedTaskIds.length) {
        throw createActionError("validation_error");
      }

      const tasks = includedTaskIds.map((taskId) => {
        const taskRow = taskRowsById.get(taskId);

        if (taskRow === undefined) {
          throw createActionError("validation_error");
        }

        const task = toTask(taskRow);
        assertPreviewEligibleTask(task);

        return task;
      });
      const files = buildPreviewFiles({
        excludedTemplateIds,
        tasks,
      });

      if (files.length === 0) {
        throw createActionError("validation_error");
      }

      const currentTime = now();
      const preview = parseSetupPrPreview({
        contractVersion: CONTRACT_VERSION,
        createdAt: currentTime.toISOString(),
        excludedTaskIds,
        excludedTemplateIds,
        files,
        metadata: {
          sourceLabel: "setup_pr_preview_service",
        },
        previewId: normalizeId(createPreviewId()),
        repoId,
        status: "draft",
        taskIds: includedTaskIds,
        updatedAt: currentTime.toISOString(),
        workspaceId: scope.workspaceId,
      });
      const persistedPreview = await input.store.persistSetupPrPreviewWithAudit({
        auditEvent: createAuditEventInsert({
          actorId: scope.actorId,
          createId: createAuditEventId,
          eventType: "setup_pr.preview_created",
          message: "Setup PR preview created.",
          metadata: {
            excludedTaskCount: excludedTaskIds.length,
            excludedTemplateCount: excludedTemplateIds.length,
            fileCount: files.length,
            previewId: preview.previewId,
            repoId,
            taskCount: includedTaskIds.length,
          },
          now: () => currentTime,
          workspaceId: scope.workspaceId,
        }),
        preview: {
          contractVersion: preview.contractVersion,
          createdAt: currentTime,
          excludedTaskIds: preview.excludedTaskIds,
          excludedTemplateIds: preview.excludedTemplateIds,
          files: preview.files,
          id: preview.previewId,
          metadata: preview.metadata,
          repoId: preview.repoId,
          status: preview.status,
          taskIds: preview.taskIds,
          updatedAt: currentTime,
          workspaceId: preview.workspaceId,
        },
      });

      return toPreview(persistedPreview);
    },
    getSetupPrPreview: async (getInput) => {
      const workspaceId = normalizeId(getInput.workspaceId);
      const previewId = normalizeId(getInput.previewId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const preview = await input.store.getSetupPrPreview({
        previewId,
        workspaceId: scope.workspaceId,
      });

      if (preview === null) {
        throw createActionError("validation_error");
      }

      return toPreview(preview);
    },
    listSetupPrPreviews: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const repoId = listInput.repoId === undefined ? undefined : normalizeId(listInput.repoId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const previews = await input.store.listSetupPrPreviews({
        workspaceId: scope.workspaceId,
        ...(repoId === undefined ? {} : { repoId }),
      });

      return previews.map(toPreview);
    },
  };
};
