import "server-only";

import { randomUUID } from "node:crypto";

import {
  CortexTaskSchema,
  RepoPolicySchema,
  ValidationCommandSchema,
  type CortexTask,
  type TaskPacket,
} from "@control-plane/shared";

import { and, eq, inArray, isNotNull, isNull, schema, sql, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import {
  buildCortexTaskPacket,
  type CortexTaskPacketGitHubRepository,
  type CortexTaskPacketRepoMapping,
} from "../task-packets/build-cortex-task-packet";
import { toRunnerJob, type ManualQueueRunRow } from "./manual-queue";

type LegacyTaskInsert = typeof schema.tasks.$inferInsert;
type CortexTaskRow = typeof schema.cortexTasks.$inferSelect;

export type CortexTaskRunnerQueueContext = {
  githubRepository: CortexTaskPacketGitHubRepository | null;
  hasAvailableLocalRunner: boolean;
  repoMapping: CortexTaskPacketRepoMapping | null;
  requiredApprovalExists?: boolean;
  task: CortexTask;
};

export type QueueCortexTaskRunnerJobInput = {
  actorId: string;
  auditEvent: AuditEventInsert;
  cortexTaskId: string;
  jobId: string;
  legacyTask: LegacyTaskInsert;
  queuedAt: Date;
  repoMappingId: string;
  runId: string;
  taskPacket: TaskPacket;
  workspaceId: string;
};

export type QueueCortexTaskRunnerJobResult = {
  run: ManualQueueRunRow;
  task: CortexTask;
};

export type CortexTaskRunnerQueueStore = WorkspaceMembershipStore & {
  findCortexTaskRunnerQueueContext: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<CortexTaskRunnerQueueContext | null>;
  queueCortexTaskRunnerJob: (
    input: QueueCortexTaskRunnerJobInput,
  ) => Promise<QueueCortexTaskRunnerJobResult>;
};

export type QueueApprovedCortexTaskInput = {
  taskId: string;
  workspaceId: string;
};

export type CortexTaskRunnerEligibilityReasonCode =
  | "approval_not_approved"
  | "execution_mode_not_local_runner"
  | "repo_mapping_archived"
  | "repo_mapping_default_branch_missing"
  | "repo_mapping_local_path_missing"
  | "repo_mapping_missing"
  | "repo_mapping_policy_missing"
  | "repository_missing"
  | "repository_unavailable"
  | "required_approval_missing"
  | "risk_blocked"
  | "runner_unavailable"
  | "task_not_approved"
  | "validation_required_missing";

export type CortexTaskRunnerEligibilityReason = {
  code: CortexTaskRunnerEligibilityReasonCode;
  fixHref: string;
  message: string;
};

export type CortexTaskRunnerEligibility = {
  eligible: boolean;
  reasons: CortexTaskRunnerEligibilityReason[];
};

export type CortexTaskRunnerEligibilityData = CortexTaskRunnerEligibility & {
  taskId: string;
  workspaceId: string;
};

export type QueuedCortexTaskRunData = {
  approvalStatus: "approved";
  jobId: string;
  repoId: string;
  repoMappingId: string;
  runId: string;
  runState: "queued";
  status: "queued";
  taskId: string;
  taskPacketId: string;
  workspaceId: string;
};

export type CortexTaskRunnerQueueService = {
  getCortexTaskRunnerEligibility: (
    input: QueueApprovedCortexTaskInput,
  ) => Promise<CortexTaskRunnerEligibilityData>;
  queueApprovedCortexTask: (
    input: QueueApprovedCortexTaskInput,
  ) => Promise<QueuedCortexTaskRunData>;
};

const idMaxLength = 240;

const unsafeInputTextPattern =
  /(?:diff --git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|ghp_[A-Za-z0-9_]+|sk_(?:live|test)_[A-Za-z0-9_]+)/iu;

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const normalizeId = (value: unknown): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > idMaxLength ||
    hasControlCharacter(normalizedValue) ||
    unsafeInputTextPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const toIsoTimestamp = (value: Date | string): string => {
  const timestamp = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw createActionError("validation_error");
  }

  return timestamp.toISOString();
};

const toOptionalValue = <T>(value: T | null | undefined): T | undefined =>
  value === null || value === undefined ? undefined : value;

const createEligibilityReason = (
  code: CortexTaskRunnerEligibilityReasonCode,
): CortexTaskRunnerEligibilityReason => {
  switch (code) {
    case "approval_not_approved":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Approve the task before queueing local execution.",
      };
    case "execution_mode_not_local_runner":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Select local runner execution mode before queueing this task.",
      };
    case "repo_mapping_archived":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Restore or recreate an active local repository mapping.",
      };
    case "repo_mapping_default_branch_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Set the repository mapping default branch before queueing local execution.",
      };
    case "repo_mapping_local_path_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Pair a local repository path before queueing local execution.",
      };
    case "repo_mapping_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Register an active local repository mapping for this GitHub repository.",
      };
    case "repo_mapping_policy_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Refresh the repository policy snapshot before queueing local execution.",
      };
    case "repository_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Connect the GitHub repository before queueing local execution.",
      };
    case "repository_unavailable":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Enable an active GitHub repository before queueing local execution.",
      };
    case "required_approval_missing":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Record explicit approval evidence for high-risk local runner work.",
      };
    case "risk_blocked":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Resolve blocked risk before queueing local runner execution.",
      };
    case "runner_unavailable":
      return {
        code,
        fixHref: "/dashboard/runners",
        message: "Pair an available local runner with dry-run and git support.",
      };
    case "task_not_approved":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Move the task to approved status before queueing local execution.",
      };
    case "validation_required_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Add at least one required validation command to the repository mapping.",
      };
  }
};

const isBlankText = (value: unknown): boolean =>
  typeof value !== "string" || value.trim().length === 0;

const hasRequiredValidationCommand = (commands: unknown): boolean => {
  if (!Array.isArray(commands)) {
    return false;
  }

  return commands.some((command) => {
    const parsedCommand = ValidationCommandSchema.safeParse(command);

    return parsedCommand.success === true && parsedCommand.data.required;
  });
};

export const evaluateCortexTaskRunnerEligibility = (
  input: CortexTaskRunnerQueueContext,
): CortexTaskRunnerEligibility => {
  const reasons: CortexTaskRunnerEligibilityReason[] = [];
  const addReason = (code: CortexTaskRunnerEligibilityReasonCode) => {
    if (!reasons.some((reason) => reason.code === code)) {
      reasons.push(createEligibilityReason(code));
    }
  };

  if (input.task.status !== "approved") {
    addReason("task_not_approved");
  }

  if (input.task.approvalStatus !== "approved") {
    addReason("approval_not_approved");
  }

  if (input.task.executionMode !== "local_runner") {
    addReason("execution_mode_not_local_runner");
  }

  if (input.task.riskLevel === "blocked") {
    addReason("risk_blocked");
  }

  if (input.task.riskLevel === "high" && input.requiredApprovalExists !== true) {
    addReason("required_approval_missing");
  }

  if (!input.hasAvailableLocalRunner) {
    addReason("runner_unavailable");
  }

  if (input.githubRepository === null) {
    addReason("repository_missing");
  } else if (input.githubRepository.archived || input.githubRepository.disabled) {
    addReason("repository_unavailable");
  }

  if (input.repoMapping === null) {
    addReason("repo_mapping_missing");
  } else {
    if (input.repoMapping.archivedAt !== null) {
      addReason("repo_mapping_archived");
    }

    if (isBlankText(input.repoMapping.localPath)) {
      addReason("repo_mapping_local_path_missing");
    }

    if (isBlankText(input.repoMapping.defaultBranch)) {
      addReason("repo_mapping_default_branch_missing");
    }

    if (RepoPolicySchema.safeParse(input.repoMapping.policySnapshot).success !== true) {
      addReason("repo_mapping_policy_missing");
    }

    if (!hasRequiredValidationCommand(input.repoMapping.validationCommands)) {
      addReason("validation_required_missing");
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
};

const toCortexTask = (row: CortexTaskRow): CortexTask =>
  CortexTaskSchema.parse({
    acceptanceCriteria: row.acceptanceCriteria,
    approvalStatus: row.approvalStatus,
    contractVersion: row.contractVersion,
    createdAt: toIsoTimestamp(row.createdAt),
    executionMode: row.executionMode,
    externalLinks: row.externalLinks,
    findingIds: row.findingIds,
    latestRunId: toOptionalValue(row.latestRunId),
    metadata: row.metadata,
    objective: row.objective,
    origin: {
      externalId: toOptionalValue(row.originExternalId),
      externalSystem: toOptionalValue(row.originExternalSystem),
      type: row.originType,
    },
    prArtifactIds: row.prArtifactIds,
    repoId: row.repoId,
    riskLevel: row.riskLevel,
    runIds: row.runIds,
    status: row.status,
    suggestedValidation: row.suggestedValidation,
    taskId: row.id,
    taskPacketId: toOptionalValue(row.taskPacketId),
    taskRecommendationId: toOptionalValue(row.taskRecommendationId),
    title: row.title,
    updatedAt: toIsoTimestamp(row.updatedAt),
    workspaceId: row.workspaceId,
  });

const buildLegacyTask = (input: {
  actorId: string;
  queuedAt: Date;
  repoMappingId: string;
  task: CortexTask;
  taskPacket: TaskPacket;
}): LegacyTaskInsert => ({
  acceptanceCriteria: input.taskPacket.acceptanceCriteria,
  approvedAt: input.queuedAt,
  contextFilePaths: input.taskPacket.context.files,
  contractVersion: input.taskPacket.contractVersion,
  createdAt: input.queuedAt,
  externalId: input.task.taskId,
  externalUrl: input.taskPacket.source.url ?? null,
  id: input.task.taskId,
  mode: input.taskPacket.mode,
  objective: input.taskPacket.objective,
  policySnapshot: input.taskPacket.policy,
  repoMappingId: input.repoMappingId,
  requestedByActorId: input.actorId,
  sourceType: input.taskPacket.source.type,
  status: "approved",
  title: input.taskPacket.source.title,
  updatedAt: input.queuedAt,
  validationCommands: input.taskPacket.validation.commands,
  workspaceId: input.task.workspaceId,
});

const buildQueueAuditEvent = (input: {
  actorId: string;
  createAuditEventId?: () => string;
  jobId: string;
  queuedAt: Date;
  repoMappingId: string;
  runId: string;
  task: CortexTask;
  taskPacket: TaskPacket;
}): AuditEventInsert => {
  const auditEventInput: Parameters<typeof createAuditEventInsert>[0] = {
    actorId: input.actorId,
    eventType: "repo_readiness_cortex_tasks.queued_for_runner",
    message: "Cortex task queued for local runner execution.",
    metadata: {
      acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
      contextFilePathCount: input.taskPacket.context.files.length,
      executionMode: input.task.executionMode,
      jobId: input.jobId,
      mode: input.taskPacket.mode,
      originType: input.task.origin.type,
      packetId: input.taskPacket.id,
      repoId: input.task.repoId,
      repoMappingId: input.repoMappingId,
      requiredValidationCommandCount: input.taskPacket.validation.commands.filter(
        (command) => command.required,
      ).length,
      riskLevel: input.task.riskLevel,
      runId: input.runId,
      runState: "queued",
      sourceType: input.taskPacket.source.type,
      status: "queued",
      taskId: input.task.taskId,
      validationCommandCount: input.taskPacket.validation.commands.length,
    },
    now: () => input.queuedAt,
    runId: input.runId,
    taskId: input.task.taskId,
    workspaceId: input.task.workspaceId,
  };

  if (input.createAuditEventId !== undefined) {
    auditEventInput.createId = input.createAuditEventId;
  }

  return createAuditEventInsert(auditEventInput);
};

const toQueuedCortexTaskRunData = (
  input: QueueCortexTaskRunnerJobInput,
  result: QueueCortexTaskRunnerJobResult,
): QueuedCortexTaskRunData => {
  if (
    result.task.approvalStatus !== "approved" ||
    result.task.status !== "queued" ||
    result.run.state !== "queued"
  ) {
    throw createActionError("validation_error");
  }

  return {
    approvalStatus: "approved",
    jobId: input.jobId,
    repoId: result.task.repoId,
    repoMappingId: input.repoMappingId,
    runId: result.run.id,
    runState: "queued",
    status: "queued",
    taskId: result.task.taskId,
    taskPacketId: input.taskPacket.id,
    workspaceId: result.task.workspaceId,
  };
};

export const createCortexTaskRunnerQueueService = (input: {
  createAuditEventId?: () => string;
  createJobId?: () => string;
  createPacketId?: () => string;
  createRunId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: CortexTaskRunnerQueueStore;
}): CortexTaskRunnerQueueService => {
  const createJobId = input.createJobId ?? randomUUID;
  const createPacketId = input.createPacketId ?? randomUUID;
  const createRunId = input.createRunId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    getCortexTaskRunnerEligibility: async (queueInput) => {
      const taskId = normalizeId(queueInput.taskId);
      const workspaceId = normalizeId(queueInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const context = await input.store.findCortexTaskRunnerQueueContext({
        taskId,
        workspaceId: scope.workspaceId,
      });

      if (context === null) {
        throw createActionError("validation_error");
      }

      return {
        ...evaluateCortexTaskRunnerEligibility(context),
        taskId: context.task.taskId,
        workspaceId: context.task.workspaceId,
      };
    },
    queueApprovedCortexTask: async (queueInput) => {
      const taskId = normalizeId(queueInput.taskId);
      const workspaceId = normalizeId(queueInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const context = await input.store.findCortexTaskRunnerQueueContext({
        taskId,
        workspaceId: scope.workspaceId,
      });

      if (context === null) {
        throw createActionError("validation_error");
      }

      const eligibility = evaluateCortexTaskRunnerEligibility(context);

      if (
        !eligibility.eligible ||
        context.githubRepository === null ||
        context.repoMapping === null
      ) {
        throw createActionError("validation_error");
      }

      const queuedAt = now();
      const runId = createRunId();
      const jobId = createJobId();
      const packetId = createPacketId();
      const taskPacket = buildCortexTaskPacket({
        githubRepository: context.githubRepository,
        now: queuedAt,
        packetId,
        repoMapping: context.repoMapping,
        ...(context.requiredApprovalExists === undefined
          ? {}
          : { requiredApprovalExists: context.requiredApprovalExists }),
        runId,
        task: context.task,
      });
      const queueAuditEventInput: Parameters<typeof buildQueueAuditEvent>[0] = {
        actorId: scope.actorId,
        jobId,
        queuedAt,
        repoMappingId: context.repoMapping.id,
        runId,
        task: context.task,
        taskPacket,
      };

      if (input.createAuditEventId !== undefined) {
        queueAuditEventInput.createAuditEventId = input.createAuditEventId;
      }

      const auditEvent = buildQueueAuditEvent(queueAuditEventInput);
      const queueJobInput: QueueCortexTaskRunnerJobInput = {
        actorId: scope.actorId,
        auditEvent,
        cortexTaskId: context.task.taskId,
        jobId,
        legacyTask: buildLegacyTask({
          actorId: scope.actorId,
          queuedAt,
          repoMappingId: context.repoMapping.id,
          task: context.task,
          taskPacket,
        }),
        queuedAt,
        repoMappingId: context.repoMapping.id,
        runId,
        taskPacket,
        workspaceId: scope.workspaceId,
      };
      const queued = await input.store.queueCortexTaskRunnerJob(queueJobInput);

      return toQueuedCortexTaskRunData(queueJobInput, queued);
    },
  };
};

export const createDrizzleCortexTaskRunnerQueueStore = (
  db: Database,
): CortexTaskRunnerQueueStore => ({
  findCortexTaskRunnerQueueContext: async ({ taskId, workspaceId }) => {
    const [task] = await db
      .select()
      .from(schema.cortexTasks)
      .where(
        and(eq(schema.cortexTasks.id, taskId), eq(schema.cortexTasks.workspaceId, workspaceId)),
      )
      .limit(1);

    if (task === undefined) {
      return null;
    }

    const [githubRepository] = await db
      .select({
        archived: schema.githubRepositories.archived,
        disabled: schema.githubRepositories.disabled,
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

    const [repoMapping] =
      githubRepository === undefined
        ? []
        : await db
            .select({
              archivedAt: schema.repoMappings.archivedAt,
              defaultBranch: schema.repoMappings.defaultBranch,
              id: schema.repoMappings.id,
              localPath: schema.repoMappings.localPath,
              policySnapshot: schema.repoMappings.policySnapshot,
              repositoryName: schema.repoMappings.repositoryName,
              repositoryOwner: schema.repoMappings.repositoryOwner,
              validationCommands: schema.repoMappings.validationCommands,
              workspaceId: schema.repoMappings.workspaceId,
            })
            .from(schema.repoMappings)
            .where(
              and(
                eq(schema.repoMappings.workspaceId, task.workspaceId),
                eq(schema.repoMappings.repositoryOwner, githubRepository.repositoryOwner),
                eq(schema.repoMappings.repositoryName, githubRepository.repositoryName),
                isNull(schema.repoMappings.archivedAt),
              ),
            )
            .limit(1);
    const runnerRows = await db
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
    const hasAvailableLocalRunner = runnerRows.some(
      (runner) =>
        runner.capabilities.supportsDryRun && runner.capabilities.tools.git?.available === true,
    );

    return {
      githubRepository: githubRepository ?? null,
      hasAvailableLocalRunner,
      repoMapping: repoMapping ?? null,
      requiredApprovalExists: task.riskLevel === "high",
      task: toCortexTask(task),
    };
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
  queueCortexTaskRunnerJob: async (input) =>
    db.transaction(async (tx): Promise<QueueCortexTaskRunnerJobResult> => {
      await tx
        .insert(schema.tasks)
        .values(input.legacyTask)
        .onConflictDoUpdate({
          set: {
            acceptanceCriteria: input.legacyTask.acceptanceCriteria,
            approvedAt: input.legacyTask.approvedAt,
            contextFilePaths: input.legacyTask.contextFilePaths,
            contractVersion: input.legacyTask.contractVersion,
            externalId: input.legacyTask.externalId,
            externalUrl: input.legacyTask.externalUrl,
            mode: input.legacyTask.mode,
            objective: input.legacyTask.objective,
            policySnapshot: input.legacyTask.policySnapshot,
            repoMappingId: input.legacyTask.repoMappingId,
            requestedByActorId: input.legacyTask.requestedByActorId,
            sourceType: input.legacyTask.sourceType,
            status: input.legacyTask.status,
            title: input.legacyTask.title,
            updatedAt: input.queuedAt,
            validationCommands: input.legacyTask.validationCommands,
            workspaceId: input.legacyTask.workspaceId,
          },
          target: schema.tasks.id,
        });

      const [insertedRun] = await tx
        .insert(schema.runs)
        .values({
          attemptCount: 0,
          cancellationReason: null,
          cancellationRequestedAt: null,
          cancellationRequestedByActorId: null,
          changedPaths: [],
          claimExpiresAt: null,
          contractVersion: input.taskPacket.contractVersion,
          id: input.runId,
          jobId: input.jobId,
          jobType: "task",
          maxAttempts: 1,
          mode: input.taskPacket.mode,
          policySnapshot: input.taskPacket.policy,
          queuedAt: input.queuedAt,
          repoMappingId: input.repoMappingId,
          riskFindings: [],
          state: "queued",
          taskId: input.legacyTask.id,
          taskPacket: input.taskPacket,
          validationCommands: input.taskPacket.validation.commands,
          workspaceId: input.workspaceId,
        })
        .returning();

      if (insertedRun === undefined) {
        throw createActionError("validation_error");
      }

      toRunnerJob(insertedRun);

      const [updatedTask] = await tx
        .update(schema.cortexTasks)
        .set({
          latestRunId: input.runId,
          runIds: sql<
            CortexTask["runIds"]
          >`case when ${schema.cortexTasks.runIds} ? ${input.runId} then ${schema.cortexTasks.runIds} else ${schema.cortexTasks.runIds} || jsonb_build_array(${input.runId}) end`,
          status: "queued",
          taskPacketId: input.taskPacket.id,
          updatedAt: input.queuedAt,
        })
        .where(
          and(
            eq(schema.cortexTasks.id, input.cortexTaskId),
            eq(schema.cortexTasks.workspaceId, input.workspaceId),
            eq(schema.cortexTasks.status, "approved"),
            eq(schema.cortexTasks.approvalStatus, "approved"),
            eq(schema.cortexTasks.executionMode, "local_runner"),
          ),
        )
        .returning();

      if (updatedTask === undefined) {
        throw createActionError("validation_error");
      }

      await tx.insert(schema.auditEvents).values(input.auditEvent);

      return {
        run: insertedRun,
        task: toCortexTask(updatedTask),
      };
    }),
});
