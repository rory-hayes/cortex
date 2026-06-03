import "server-only";

import { randomUUID } from "node:crypto";

import {
  reviewGitHubAppPermissions,
  type CreateGitHubSetupPullRequestOptions,
  type GitHubAppClient,
} from "@control-plane/github";
import {
  CortexTaskExternalLinkSchema,
  CortexTaskSchema,
  FindingSchema,
  type Finding,
  type SetupPrEvidenceSummary,
  SetupPrPreviewSchema,
  type CortexTask,
  type CortexTaskExternalLink,
  type SetupPrPreview,
} from "@control-plane/shared";

import { and, eq, inArray, schema, type Database } from "../db";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import {
  buildSetupPrEvidenceSummary,
  toSetupPrEvidenceFinding,
  type SetupPrEvidenceFindingRow,
} from "./evidence";
import { buildSetupPrTemplateFilesForTask, type RenderedSetupPrTemplateFile } from "./templates";

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

export type SetupPrCreationRepositoryRow = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  githubInstallationId: string;
  id: string;
  installationPermissions: Record<string, string>;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

export type SetupPrCreationPreviewRow = {
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

export type SetupPrTaskPrLinkUpdate = {
  externalLinks: CortexTask["externalLinks"];
  status: Extract<CortexTask["status"], "pr_opened">;
  taskId: string;
};

export type CreateSetupPrFromPreviewInput = {
  previewId: string;
  workspaceId: string;
};

export type SetupPrCreationResult = {
  baseBranch: string;
  branchName: string;
  evidenceSummary: SetupPrEvidenceSummary;
  preview: SetupPrPreview;
  pullRequestNumber: number;
  pullRequestUrl: string;
};

export type SetupPrCreationStore = WorkspaceMembershipStore & {
  findGithubRepositoryForSetupPr: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<SetupPrCreationRepositoryRow | null>;
  getSetupPrPreview: (input: {
    previewId: string;
    workspaceId: string;
  }) => Promise<SetupPrCreationPreviewRow | null>;
  listCortexTasksByIds: (input: {
    repoId: string;
    taskIds: string[];
    workspaceId: string;
  }) => Promise<SetupPrTaskRow[]>;
  listFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    workspaceId: string;
  }) => Promise<SetupPrEvidenceFindingRow[]>;
  markSetupPrPreviewPrCreatedWithAudit: (input: {
    auditEvent: AuditEventInsert;
    metadata: SetupPrPreview["metadata"];
    previewId: string;
    taskPrLinkUpdates: SetupPrTaskPrLinkUpdate[];
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<SetupPrCreationPreviewRow>;
};

export type SetupPrCreationService = {
  createSetupPrFromPreview: (
    input: CreateSetupPrFromPreviewInput,
  ) => Promise<SetupPrCreationResult>;
};

type SetupPrGithubClient = Pick<GitHubAppClient, "createSetupPullRequest">;

const idPattern = /^[A-Za-z0-9._:-]+$/u;

const toIsoString = (value: Date): string => value.toISOString();

const normalizeId = (value: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || normalizedValue.length > 240 || !idPattern.test(value)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const parsePositiveInstallationId = (value: string): number => {
  const installationId = Number(value);

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw createActionError("validation_error");
  }

  return installationId;
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

const toPreview = (row: SetupPrCreationPreviewRow): SetupPrPreview =>
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

const assertRepositoryEligible = (repository: SetupPrCreationRepositoryRow): void => {
  if (repository.archived || repository.disabled) {
    throw createActionError("validation_error");
  }

  const permissionReview = reviewGitHubAppPermissions(repository.installationPermissions);

  if (!permissionReview.profiles.setup_pr.supported) {
    throw createActionError("validation_error");
  }
};

const loadOrderedTasks = async (input: {
  preview: SetupPrPreview;
  store: SetupPrCreationStore;
}): Promise<CortexTask[]> => {
  const rows = await input.store.listCortexTasksByIds({
    repoId: input.preview.repoId,
    taskIds: input.preview.taskIds,
    workspaceId: input.preview.workspaceId,
  });
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  if (rowsById.size !== input.preview.taskIds.length) {
    throw createActionError("validation_error");
  }

  return input.preview.taskIds.map((taskId) => {
    const row = rowsById.get(taskId);

    if (row === undefined) {
      throw createActionError("validation_error");
    }

    const task = toTask(row);

    assertPreviewEligibleTask(task);

    return task;
  });
};

const loadFindings = async (input: {
  store: SetupPrCreationStore;
  tasks: readonly CortexTask[];
}): Promise<Finding[]> => {
  const findingIds = uniqueSorted(input.tasks.flatMap((task) => task.findingIds));

  if (findingIds.length === 0) {
    return [];
  }

  const rows = await input.store.listFindingsByIds({
    findingIds,
    repoId: input.tasks[0]?.repoId ?? "",
    workspaceId: input.tasks[0]?.workspaceId ?? "",
  });
  const findings = rows.map((row) => parseFinding(toSetupPrEvidenceFinding(row)));
  const scopedFindingIds = new Set(findings.map((finding) => finding.findingId));

  if (findingIds.some((findingId) => !scopedFindingIds.has(findingId))) {
    throw createActionError("validation_error");
  }

  return findings;
};

const buildRenderedFilesByTemplateId = (
  tasks: readonly CortexTask[],
): Map<string, RenderedSetupPrTemplateFile> => {
  const renderedFiles = new Map<string, RenderedSetupPrTemplateFile>();

  for (const task of tasks) {
    for (const file of buildSetupPrTemplateFilesForTask(task)) {
      if (!renderedFiles.has(file.templateId)) {
        renderedFiles.set(file.templateId, file);
      }
    }
  }

  return renderedFiles;
};

const buildApprovedGithubFiles = (input: {
  preview: SetupPrPreview;
  tasks: readonly CortexTask[];
}): CreateGitHubSetupPullRequestOptions["files"] => {
  const renderedFiles = buildRenderedFilesByTemplateId(input.tasks);

  return input.preview.files.map((previewFile) => {
    const renderedFile = renderedFiles.get(previewFile.templateId);

    if (
      renderedFile === undefined ||
      renderedFile.path !== previewFile.path ||
      renderedFile.operation !== previewFile.operation
    ) {
      throw createActionError("validation_error");
    }

    return {
      content: renderedFile.content,
      path: renderedFile.path,
    };
  });
};

const buildPullRequestExternalLink = (input: {
  pullRequest: Awaited<ReturnType<SetupPrGithubClient["createSetupPullRequest"]>>;
  syncedAt: Date;
}): CortexTaskExternalLink =>
  CortexTaskExternalLinkSchema.parse({
    externalId: String(input.pullRequest.number),
    provider: "github",
    resourceType: "pull_request",
    status: input.pullRequest.draft ? "draft" : input.pullRequest.state,
    syncedAt: input.syncedAt.toISOString(),
    title: input.pullRequest.title,
    url: input.pullRequest.htmlUrl,
  });

const mergePullRequestExternalLink = (
  links: CortexTask["externalLinks"],
  link: CortexTaskExternalLink,
): CortexTask["externalLinks"] => [
  ...links.filter(
    (item) =>
      !(
        item.provider === link.provider &&
        item.resourceType === link.resourceType &&
        item.externalId === link.externalId
      ),
  ),
  link,
];

const buildTaskPrLinkUpdates = (input: {
  link: CortexTaskExternalLink;
  syncedAt: Date;
  tasks: readonly CortexTask[];
}): SetupPrTaskPrLinkUpdate[] =>
  input.tasks.map((task) => {
    const parsedTask = CortexTaskSchema.parse({
      ...task,
      externalLinks: mergePullRequestExternalLink(task.externalLinks, input.link),
      status: "pr_opened",
      updatedAt: input.syncedAt.toISOString(),
    });

    return {
      externalLinks: parsedTask.externalLinks,
      status: "pr_opened",
      taskId: parsedTask.taskId,
    };
  });

const uniqueSorted = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right));

const slugifyBranchSegment = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/_{1,}/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);

  return slug.length === 0 ? "preview" : slug;
};

export const buildSetupPrBranchName = (previewId: string): string =>
  `cortex/setup-pr/${slugifyBranchSegment(previewId)}`;

const buildSetupPrBody = (input: {
  evidenceSummary: SetupPrEvidenceSummary;
  preview: SetupPrPreview;
  tasks: readonly CortexTask[];
}): string => {
  const findingIds = uniqueSorted(input.tasks.flatMap((task) => task.findingIds));
  const checklistItems = uniqueSorted(
    input.preview.files.flatMap((file) => [
      `Review ${file.path}: ${file.summary}`,
      ...file.reviewInstructions,
    ]),
  );

  return [
    "## Findings addressed",
    ...findingIds.map((findingId) => `- ${findingId}`),
    "",
    "## Setup files",
    ...input.preview.files.map((file) => `- ${file.path}: ${file.summary}`),
    "",
    "## Evidence summary",
    ...input.evidenceSummary.files.flatMap((file) => [
      `### ${file.path}`,
      `- Why generated: ${file.whyGenerated}`,
      `- Tasks: ${file.tasks
        .map((task) => `${task.title} (${task.taskId}, ${task.riskLevel})`)
        .join("; ")}`,
      `- Findings: ${
        file.findings.length === 0
          ? file.findingIds.join("; ")
          : file.findings
              .map(
                (finding) =>
                  `${finding.title} (${finding.findingId}, ${finding.category}, ${finding.severity}, ${finding.status})`,
              )
              .join("; ")
      }`,
    ]),
    "",
    "## Review checklist",
    ...checklistItems.map((item) => `- ${item}`),
    "",
    "No local runner execution occurred for this setup PR.",
  ].join("\n");
};

export const createDrizzleSetupPrCreationStore = (db: Database): SetupPrCreationStore => ({
  findGithubRepositoryForSetupPr: async ({ repoId, workspaceId }) => {
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
          eq(schema.githubRepositories.id, repoId),
          eq(schema.githubRepositories.workspaceId, workspaceId),
          eq(schema.githubAppInstallations.workspaceId, workspaceId),
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
  markSetupPrPreviewPrCreatedWithAudit: async ({
    auditEvent,
    metadata,
    previewId,
    taskPrLinkUpdates,
    updatedAt,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      for (const update of taskPrLinkUpdates) {
        const [task] = await tx
          .update(schema.cortexTasks)
          .set({
            externalLinks: update.externalLinks,
            status: update.status,
            updatedAt,
          })
          .where(
            and(
              eq(schema.cortexTasks.id, update.taskId),
              eq(schema.cortexTasks.workspaceId, workspaceId),
            ),
          )
          .returning({ id: schema.cortexTasks.id });

        if (task === undefined) {
          throw createActionError("validation_error");
        }
      }

      const [preview] = await tx
        .update(schema.setupPrPreviews)
        .set({
          metadata,
          status: "pr_created",
          updatedAt,
        })
        .where(
          and(
            eq(schema.setupPrPreviews.id, previewId),
            eq(schema.setupPrPreviews.workspaceId, workspaceId),
          ),
        )
        .returning();

      if (preview === undefined) {
        throw createActionError("validation_error");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return preview;
    }),
});

export const createSetupPrCreationService = (input: {
  createAuditEventId?: () => string;
  getAuthContext?: GetAuthContext;
  githubClient: SetupPrGithubClient;
  now?: () => Date;
  store: SetupPrCreationStore;
}): SetupPrCreationService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    createSetupPrFromPreview: async (createInput) => {
      const workspaceId = normalizeId(createInput.workspaceId);
      const previewId = normalizeId(createInput.previewId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const previewRow = await input.store.getSetupPrPreview({
        previewId,
        workspaceId: scope.workspaceId,
      });

      if (previewRow === null) {
        throw createActionError("validation_error");
      }

      const preview = toPreview(previewRow);

      if (preview.status !== "draft") {
        throw createActionError("validation_error");
      }

      const repository = await input.store.findGithubRepositoryForSetupPr({
        repoId: preview.repoId,
        workspaceId: scope.workspaceId,
      });

      if (repository === null) {
        throw createActionError("validation_error");
      }

      assertRepositoryEligible(repository);

      const tasks = await loadOrderedTasks({
        preview,
        store: input.store,
      });
      const findings = await loadFindings({
        store: input.store,
        tasks,
      });
      const files = buildApprovedGithubFiles({
        preview,
        tasks,
      });
      const currentTime = now();
      const evidenceSummary = buildSetupPrEvidenceSummary({
        findings,
        generatedAt: currentTime,
        preview,
        tasks,
      });
      const branchName = buildSetupPrBranchName(preview.previewId);
      const pullRequest = await input.githubClient.createSetupPullRequest({
        baseBranch: repository.defaultBranch,
        branchName,
        commitMessage: `Cortex setup PR for ${preview.previewId}`,
        files,
        installationId: parsePositiveInstallationId(repository.githubInstallationId),
        owner: repository.repositoryOwner,
        prBody: buildSetupPrBody({ evidenceSummary, preview, tasks }),
        prTitle: `Cortex setup PR: ${preview.previewId}`,
        repo: repository.repositoryName,
      });
      const pullRequestExternalLink = buildPullRequestExternalLink({
        pullRequest,
        syncedAt: currentTime,
      });
      const taskPrLinkUpdates = buildTaskPrLinkUpdates({
        link: pullRequestExternalLink,
        syncedAt: currentTime,
        tasks,
      });
      const metadata = parseSetupPrPreview({
        ...preview,
        metadata: {
          baseBranch: repository.defaultBranch,
          fileCount: preview.files.length,
          headBranch: branchName,
          pullRequestDraft: pullRequest.draft,
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.htmlUrl,
          repositoryFullName: repository.repositoryFullName,
          sourceLabel: "setup_pr_creation_service",
          taskCount: tasks.length,
        },
        status: "pr_created",
        updatedAt: currentTime.toISOString(),
      }).metadata;
      const persistedPreview = await input.store.markSetupPrPreviewPrCreatedWithAudit({
        auditEvent: createAuditEventInsert({
          actorId: scope.actorId,
          createId: createAuditEventId,
          eventType: "setup_pr.pr_created",
          message: "Setup PR draft created.",
          metadata: {
            baseBranch: repository.defaultBranch,
            fileCount: preview.files.length,
            headBranch: branchName,
            previewId: preview.previewId,
            pullRequestNumber: pullRequest.number,
            repoId: preview.repoId,
            taskCount: tasks.length,
          },
          now: () => currentTime,
          workspaceId: scope.workspaceId,
        }),
        metadata,
        previewId: preview.previewId,
        taskPrLinkUpdates,
        updatedAt: currentTime,
        workspaceId: scope.workspaceId,
      });

      return {
        baseBranch: repository.defaultBranch,
        branchName,
        evidenceSummary,
        preview: toPreview(persistedPreview),
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.htmlUrl,
      };
    },
  };
};
