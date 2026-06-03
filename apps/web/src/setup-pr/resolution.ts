import "server-only";

import { randomUUID } from "node:crypto";

import type {
  GitHubWebhookPullRequestMetadata,
  GitHubWebhookRepositoryMetadata,
} from "@control-plane/github";
import {
  CortexTaskSchema,
  FindingSchema,
  SetupPrPreviewSchema,
  type CortexTask,
  type Finding,
  type SetupPrPreview,
} from "@control-plane/shared";

import { and, eq, inArray, schema, sql, type Database } from "../db";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export type SetupPrResolutionPreviewRow = {
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

export type SetupPrResolutionTaskRow = {
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

export type SetupPrResolutionFindingRow = {
  category: Finding["category"];
  confidence: number;
  contractVersion: Finding["contractVersion"];
  createdAt: Date;
  deterministicRuleId: string;
  evidence: Finding["evidence"];
  id: string;
  recommendation: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  source: Finding["source"];
  status: Finding["status"];
  summary: string;
  taskIds: string[];
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type ResolveSetupPrMergeMutationInput = {
  auditEvents: AuditEventInsert[];
  findingIds: string[];
  findings: SetupPrResolutionFindingRow[];
  metadata: SetupPrPreview["metadata"];
  previewId: string;
  taskIds: string[];
  tasks: SetupPrResolutionTaskRow[];
  updatedAt: Date;
  workspaceId: string;
};

export type SetupPrMergeResolutionStore = {
  findSetupPrPreviewForPullRequest: (input: {
    githubInstallationId: number;
    pullRequestNumber: number;
    repositoryName: string;
    repositoryOwner: string;
  }) => Promise<SetupPrResolutionPreviewRow | null>;
  listCortexTasksByIds: (input: {
    repoId: string;
    taskIds: string[];
    workspaceId: string;
  }) => Promise<SetupPrResolutionTaskRow[]>;
  listFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    workspaceId: string;
  }) => Promise<SetupPrResolutionFindingRow[]>;
  resolveSetupPrMergeWithAudit: (input: ResolveSetupPrMergeMutationInput) => Promise<{
    resolvedFindingCount: number;
    resolvedTaskCount: number;
  }>;
};

export type ResolveMergedSetupPrForWebhookInput = {
  deliveryId: string;
  installationId: number;
  pullRequest: GitHubWebhookPullRequestMetadata;
  repository: GitHubWebhookRepositoryMetadata;
};

export type SetupPrMergeResolutionResult =
  | {
      findingIds: string[];
      previewId: string;
      repoId: string;
      resolvedFindingCount: number;
      resolvedTaskCount: number;
      status: "resolved";
      taskIds: string[];
      workspaceId: string;
    }
  | {
      previewId?: string;
      pullRequestNumber?: number;
      reason: "already_resolved" | "missing_preview" | "not_merged";
      status: "ignored";
    };

export type SetupPrMergeResolutionService = {
  resolveMergedSetupPrForWebhook: (
    input: ResolveMergedSetupPrForWebhookInput,
  ) => Promise<SetupPrMergeResolutionResult>;
};

type CortexTaskUpdate = typeof schema.cortexTasks.$inferInsert;

const idPattern = /^[A-Za-z0-9._:-]+$/u;

const toIsoString = (value: Date): string => value.toISOString();

const normalizeId = (value: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || normalizedValue.length > 240 || !idPattern.test(value)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeRepositoryPart = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > 100 ||
    normalizedValue !== value ||
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.includes("/") ||
    normalizedValue.includes("\\") ||
    normalizedValue.includes(":") ||
    normalizedValue.includes("@") ||
    !/^[A-Za-z0-9._-]+$/u.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizePositiveInteger = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createActionError("validation_error");
  }

  return value;
};

const parseSetupPrPreview = (value: unknown): SetupPrPreview => {
  const result = SetupPrPreviewSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const parseCortexTask = (value: unknown): CortexTask => {
  const result = CortexTaskSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const parseFinding = (value: unknown): Finding => {
  const result = FindingSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const toPreview = (row: SetupPrResolutionPreviewRow): SetupPrPreview =>
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

const toTask = (row: SetupPrResolutionTaskRow): CortexTask =>
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

const toFinding = (row: SetupPrResolutionFindingRow): Finding =>
  parseFinding({
    category: row.category,
    confidence: row.confidence,
    contractVersion: row.contractVersion,
    createdAt: row.createdAt.toISOString(),
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
    updatedAt: row.updatedAt.toISOString(),
    workspaceId: row.workspaceId,
  });

const uniqueSorted = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right));

const toCompletedTaskRow = (
  task: SetupPrResolutionTaskRow,
  updatedAt: Date,
): SetupPrResolutionTaskRow => ({
  ...task,
  approvalStatus: "approved",
  status: "completed",
  updatedAt,
});

const toResolvedFindingRow = (
  finding: SetupPrResolutionFindingRow,
  updatedAt: Date,
): SetupPrResolutionFindingRow => ({
  ...finding,
  status: "resolved",
  updatedAt,
});

const assertEligibleTask = (task: CortexTask): void => {
  const eligibleStatus = task.status === "approved" || task.status === "pr_opened";

  if (
    task.approvalStatus !== "approved" ||
    task.executionMode !== "setup_pr" ||
    task.riskLevel === "blocked" ||
    !eligibleStatus
  ) {
    throw createActionError("validation_error");
  }
};

const loadTasks = async (input: {
  preview: SetupPrPreview;
  store: SetupPrMergeResolutionStore;
}): Promise<SetupPrResolutionTaskRow[]> => {
  const rows = await input.store.listCortexTasksByIds({
    repoId: input.preview.repoId,
    taskIds: input.preview.taskIds,
    workspaceId: input.preview.workspaceId,
  });
  const rowsById = new Map(rows.map((task) => [task.id, task]));

  if (rowsById.size !== input.preview.taskIds.length) {
    throw createActionError("validation_error");
  }

  return input.preview.taskIds.map((taskId) => {
    const row = rowsById.get(taskId);

    if (row === undefined) {
      throw createActionError("validation_error");
    }

    const task = toTask(row);
    assertEligibleTask(task);

    if (task.workspaceId !== input.preview.workspaceId || task.repoId !== input.preview.repoId) {
      throw createActionError("validation_error");
    }

    return row;
  });
};

const loadFindings = async (input: {
  preview: SetupPrPreview;
  store: SetupPrMergeResolutionStore;
  tasks: readonly SetupPrResolutionTaskRow[];
}): Promise<SetupPrResolutionFindingRow[]> => {
  const findingIds = uniqueSorted(input.tasks.flatMap((task) => task.findingIds));

  if (findingIds.length === 0) {
    return [];
  }

  const rows = await input.store.listFindingsByIds({
    findingIds,
    repoId: input.preview.repoId,
    workspaceId: input.preview.workspaceId,
  });
  const rowsById = new Map(rows.map((finding) => [finding.id, finding]));

  if (rowsById.size !== findingIds.length) {
    throw createActionError("validation_error");
  }

  return findingIds.map((findingId) => {
    const row = rowsById.get(findingId);

    if (row === undefined) {
      throw createActionError("validation_error");
    }

    const finding = toFinding(row);

    if (
      finding.workspaceId !== input.preview.workspaceId ||
      finding.repoId !== input.preview.repoId
    ) {
      throw createActionError("validation_error");
    }

    return row;
  });
};

const isAlreadyResolved = (preview: SetupPrPreview): boolean =>
  preview.metadata.pullRequestMerged === true;

const getMergedAt = (pullRequest: GitHubWebhookPullRequestMetadata, fallback: Date): string =>
  pullRequest.updatedAt ?? fallback.toISOString();

const buildMetadata = (input: {
  currentTime: Date;
  preview: SetupPrPreview;
  pullRequest: GitHubWebhookPullRequestMetadata;
}): SetupPrPreview["metadata"] =>
  parseSetupPrPreview({
    ...input.preview,
    metadata: {
      ...input.preview.metadata,
      pullRequestMerged: true,
      pullRequestMergedAt: getMergedAt(input.pullRequest, input.currentTime),
      pullRequestNumber: input.pullRequest.number,
      pullRequestState: input.pullRequest.state,
      pullRequestUrl: input.pullRequest.htmlUrl,
      resolvedTaskCount: input.preview.taskIds.length,
      sourceLabel: "setup_pr_merge_resolution_service",
      syncedBy: "github_webhook",
    },
    updatedAt: input.currentTime.toISOString(),
  }).metadata;

const buildAuditEvents = (input: {
  createAuditEventId: () => string;
  deliveryId: string;
  findingIds: readonly string[];
  now: Date;
  preview: SetupPrPreview;
  pullRequest: GitHubWebhookPullRequestMetadata;
  taskIds: readonly string[];
}): AuditEventInsert[] => [
  createAuditEventInsert({
    createId: input.createAuditEventId,
    eventType: "setup_pr.merged",
    message: "Setup PR merge detected.",
    metadata: {
      deliveryId: input.deliveryId,
      findingCount: input.findingIds.length,
      previewId: input.preview.previewId,
      pullRequestNumber: input.pullRequest.number,
      repoId: input.preview.repoId,
      taskCount: input.taskIds.length,
    },
    now: () => input.now,
    workspaceId: input.preview.workspaceId,
  }),
  createAuditEventInsert({
    createId: input.createAuditEventId,
    eventType: "setup_pr.findings_resolved",
    message: "Setup PR findings resolved pending the next repo scan.",
    metadata: {
      findingCount: input.findingIds.length,
      previewId: input.preview.previewId,
      repoId: input.preview.repoId,
      taskCount: input.taskIds.length,
    },
    now: () => input.now,
    workspaceId: input.preview.workspaceId,
  }),
];

export const createDrizzleSetupPrMergeResolutionStore = (
  db: Database,
): SetupPrMergeResolutionStore => ({
  findSetupPrPreviewForPullRequest: async ({
    githubInstallationId,
    pullRequestNumber,
    repositoryName,
    repositoryOwner,
  }) => {
    const [preview] = await db
      .select({
        contractVersion: schema.setupPrPreviews.contractVersion,
        createdAt: schema.setupPrPreviews.createdAt,
        excludedTaskIds: schema.setupPrPreviews.excludedTaskIds,
        excludedTemplateIds: schema.setupPrPreviews.excludedTemplateIds,
        files: schema.setupPrPreviews.files,
        id: schema.setupPrPreviews.id,
        metadata: schema.setupPrPreviews.metadata,
        repoId: schema.setupPrPreviews.repoId,
        status: schema.setupPrPreviews.status,
        taskIds: schema.setupPrPreviews.taskIds,
        updatedAt: schema.setupPrPreviews.updatedAt,
        workspaceId: schema.setupPrPreviews.workspaceId,
      })
      .from(schema.setupPrPreviews)
      .innerJoin(
        schema.githubRepositories,
        eq(schema.setupPrPreviews.repoId, schema.githubRepositories.id),
      )
      .where(
        and(
          eq(schema.githubRepositories.githubInstallationId, String(githubInstallationId)),
          eq(schema.githubRepositories.repositoryName, repositoryName),
          eq(schema.githubRepositories.repositoryOwner, repositoryOwner),
          eq(schema.setupPrPreviews.status, "pr_created"),
          sql`${schema.setupPrPreviews.metadata}->>'pullRequestNumber' = ${String(
            pullRequestNumber,
          )}`,
        ),
      )
      .limit(1);

    return preview ?? null;
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
  listFindingsByIds: async ({ findingIds, repoId, workspaceId }) => {
    if (findingIds.length === 0) {
      return [];
    }

    return db
      .select()
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.workspaceId, workspaceId),
          eq(schema.findings.repoId, repoId),
          inArray(schema.findings.id, findingIds),
        ),
      );
  },
  resolveSetupPrMergeWithAudit: async ({
    auditEvents,
    findingIds,
    findings,
    metadata,
    previewId,
    taskIds,
    tasks,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [preview] = await tx
        .update(schema.setupPrPreviews)
        .set({
          metadata,
          updatedAt,
        })
        .where(
          and(
            eq(schema.setupPrPreviews.id, previewId),
            eq(schema.setupPrPreviews.workspaceId, workspaceId),
          ),
        )
        .returning({ id: schema.setupPrPreviews.id });

      if (preview === undefined) {
        throw createActionError("validation_error");
      }

      let resolvedTaskCount = 0;
      let resolvedFindingCount = 0;

      if (taskIds.length > 0) {
        const updatedTasks = await tx
          .update(schema.cortexTasks)
          .set({
            approvalStatus: "approved",
            status: "completed",
            updatedAt,
          } satisfies Partial<CortexTaskUpdate>)
          .where(
            and(
              eq(schema.cortexTasks.workspaceId, workspaceId),
              inArray(schema.cortexTasks.id, taskIds),
            ),
          )
          .returning({ id: schema.cortexTasks.id });

        resolvedTaskCount = updatedTasks.length;
      }

      if (findingIds.length > 0) {
        const updatedFindings = await tx
          .update(schema.findings)
          .set({
            status: "resolved",
            updatedAt,
          })
          .where(
            and(
              eq(schema.findings.workspaceId, workspaceId),
              inArray(schema.findings.id, findingIds),
            ),
          )
          .returning({ id: schema.findings.id });

        resolvedFindingCount = updatedFindings.length;
      }

      if (resolvedTaskCount !== tasks.length || resolvedFindingCount !== findings.length) {
        throw createActionError("validation_error");
      }

      for (const auditEvent of auditEvents) {
        await tx.insert(schema.auditEvents).values(auditEvent);
      }

      return {
        resolvedFindingCount,
        resolvedTaskCount,
      };
    }),
});

export const createSetupPrMergeResolutionService = (input: {
  createAuditEventId?: () => string;
  now?: () => Date;
  store: SetupPrMergeResolutionStore;
}): SetupPrMergeResolutionService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const now = input.now ?? (() => new Date());

  return {
    resolveMergedSetupPrForWebhook: async (resolveInput) => {
      const pullRequestNumber = normalizePositiveInteger(resolveInput.pullRequest.number);

      if (!resolveInput.pullRequest.merged) {
        return {
          pullRequestNumber,
          reason: "not_merged",
          status: "ignored",
        };
      }

      const repositoryOwner = normalizeRepositoryPart(resolveInput.repository.owner);
      const repositoryName = normalizeRepositoryPart(resolveInput.repository.name);
      const githubInstallationId = normalizePositiveInteger(resolveInput.installationId);
      const previewRow = await input.store.findSetupPrPreviewForPullRequest({
        githubInstallationId,
        pullRequestNumber,
        repositoryName,
        repositoryOwner,
      });

      if (previewRow === null) {
        return {
          pullRequestNumber,
          reason: "missing_preview",
          status: "ignored",
        };
      }

      const preview = toPreview(previewRow);

      if (isAlreadyResolved(preview)) {
        return {
          previewId: preview.previewId,
          reason: "already_resolved",
          status: "ignored",
        };
      }

      const currentTime = now();
      const tasks = await loadTasks({
        preview,
        store: input.store,
      });
      const findings = await loadFindings({
        preview,
        store: input.store,
        tasks,
      });
      const taskIds = tasks.map((task) => normalizeId(task.id));
      const findingIds = findings.map((finding) => normalizeId(finding.id));
      const completedTasks = tasks.map((task) => toCompletedTaskRow(task, currentTime));
      const resolvedFindings = findings.map((finding) =>
        toResolvedFindingRow(finding, currentTime),
      );
      const metadata = buildMetadata({
        currentTime,
        preview,
        pullRequest: resolveInput.pullRequest,
      });
      const mutationResult = await input.store.resolveSetupPrMergeWithAudit({
        auditEvents: buildAuditEvents({
          createAuditEventId,
          deliveryId: normalizeId(resolveInput.deliveryId),
          findingIds,
          now: currentTime,
          preview,
          pullRequest: resolveInput.pullRequest,
          taskIds,
        }),
        findingIds,
        findings: resolvedFindings,
        metadata,
        previewId: preview.previewId,
        taskIds,
        tasks: completedTasks,
        updatedAt: currentTime,
        workspaceId: preview.workspaceId,
      });

      return {
        findingIds,
        previewId: preview.previewId,
        repoId: preview.repoId,
        resolvedFindingCount: mutationResult.resolvedFindingCount,
        resolvedTaskCount: mutationResult.resolvedTaskCount,
        status: "resolved",
        taskIds,
        workspaceId: preview.workspaceId,
      };
    },
  };
};
