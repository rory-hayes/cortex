import "server-only";

import { randomUUID } from "node:crypto";

import type { TaskPacket } from "@control-plane/shared";

import { and, eq, isNull, schema, type Database } from "../db";
import {
  queueManualJob,
  type ManualQueueDatabase,
  type ManualQueueRunRow,
} from "../jobs/manual-queue";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import {
  buildManualTaskPacket,
  type ManualTaskPacketRepoMapping,
  type ManualTaskPacketTask,
} from "../task-packets/build-task-packet";

export const APPROVE_MANUAL_TASK_ID_MAX_LENGTH = 240;
export const APPROVE_MANUAL_TASK_WORKSPACE_ID_MAX_LENGTH = 240;

export type ApproveManualTaskInput = {
  taskId: string;
  workspaceId: string;
};

export type ApprovedManualTaskData = {
  approvedAt: Date;
  jobId: string;
  repoMappingId: string;
  runId: string;
  runState: "queued";
  status: "approved";
  taskId: string;
  workspaceId: string;
};

export type ManualTaskApprovalTask = typeof schema.tasks.$inferSelect;

export type ManualTaskApprovalRepoMapping = ManualTaskPacketRepoMapping;

export type ManualTaskApprovalSelection = {
  repoMapping: ManualTaskApprovalRepoMapping;
  task: ManualTaskApprovalTask;
};

export type ApproveManualTaskWithQueueInput = {
  approvedAt: Date;
  auditEvent: AuditEventInsert;
  jobId: string;
  repoMappingId: string;
  runId: string;
  taskId: string;
  taskPacket: TaskPacket;
  workspaceId: string;
};

export type ApproveManualTaskWithQueueResult = {
  run: ManualQueueRunRow;
  task: ManualTaskApprovalTask;
};

export type ApproveManualTaskStore = WorkspaceMembershipStore & {
  approveManualTaskWithQueue: (
    input: ApproveManualTaskWithQueueInput,
  ) => Promise<ApproveManualTaskWithQueueResult>;
  findManualDraftTaskForApproval: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<ManualTaskApprovalSelection | null>;
};

export type ApproveManualTaskService = {
  approveManualTask: (input: ApproveManualTaskInput) => Promise<ApprovedManualTaskData>;
};

type NormalizedApproveManualTaskInput = {
  taskId: string;
  workspaceId: string;
};

const unsafePayloadKeys = new Set([
  "acceptancecriteria",
  "content",
  "contents",
  "contextfilepaths",
  "dependencygraph",
  "dependencygraphs",
  "diff",
  "filecontent",
  "filecontents",
  "filetree",
  "filetrees",
  "localpath",
  "log",
  "logs",
  "objective",
  "output",
  "patch",
  "policysnapshot",
  "rawdiff",
  "rawlog",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "rawstderr",
  "rawstdout",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stdout",
  "snippet",
  "snippets",
  "title",
  "validationcommands",
]);

const unsafeTextPatterns = [
  /\bdiff --git\b/i,
  /@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
] as const;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const hasUnsafeText = (value: string): boolean =>
  unsafeTextPatterns.some((pattern) => pattern.test(value));

const findUnsafePayloadKey = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const unsafeKey = findUnsafePayloadKey(item, seen);
      if (unsafeKey !== undefined) {
        return unsafeKey;
      }
    }

    return undefined;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (unsafePayloadKeys.has(normalizeKey(key))) {
      return key;
    }

    const unsafeKey = findUnsafePayloadKey(childValue, seen);
    if (unsafeKey !== undefined) {
      return unsafeKey;
    }
  }

  return undefined;
};

const assertNoUnsafePayloadKeys = (value: unknown): void => {
  if (findUnsafePayloadKey(value) !== undefined) {
    throw createActionError("validation_error");
  }
};

const assertSafeBoundedText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafeText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const parseApproveManualTaskInput = (
  input: ApproveManualTaskInput,
): NormalizedApproveManualTaskInput => {
  assertNoUnsafePayloadKeys(input);

  return {
    taskId: assertSafeBoundedText(input.taskId, APPROVE_MANUAL_TASK_ID_MAX_LENGTH),
    workspaceId: assertSafeBoundedText(
      input.workspaceId,
      APPROVE_MANUAL_TASK_WORKSPACE_ID_MAX_LENGTH,
    ),
  };
};

const toTaskPacketTask = (task: ManualTaskApprovalTask): ManualTaskPacketTask => ({
  acceptanceCriteria: task.acceptanceCriteria,
  contextFilePaths: task.contextFilePaths,
  contractVersion: task.contractVersion,
  externalId: task.externalId,
  externalUrl: task.externalUrl,
  id: task.id,
  mode: task.mode,
  objective: task.objective,
  repoMappingId: task.repoMappingId,
  sourceType: task.sourceType,
  status: task.status,
  title: task.title,
  workspaceId: task.workspaceId,
});

const toApprovedManualTaskData = (
  task: ManualTaskApprovalTask,
  run: ManualQueueRunRow,
): ApprovedManualTaskData => {
  if (task.approvedAt === null || task.status !== "approved" || run.state !== "queued") {
    throw createActionError("validation_error");
  }

  return {
    approvedAt: task.approvedAt,
    jobId: run.jobId,
    repoMappingId: task.repoMappingId,
    runId: run.id,
    runState: "queued",
    status: "approved",
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
};

const createApprovalAuditEvent = (input: {
  actorId: string;
  approvedAt: Date;
  createAuditEventId?: () => string;
  jobId: string;
  packetId: string;
  repoMappingId: string;
  runId: string;
  task: ManualTaskApprovalTask;
  taskPacket: TaskPacket;
  workspaceId: string;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId ?? randomUUID,
    eventType: "task.manual.approved",
    message: "Manual task approved for runner queue.",
    metadata: {
      acceptanceCriteriaCount: input.task.acceptanceCriteria.length,
      contextFilePathCount: input.task.contextFilePaths.length,
      jobId: input.jobId,
      mode: input.task.mode,
      originType: "manual",
      packetId: input.packetId,
      repoMappingId: input.repoMappingId,
      requiredValidationCommandCount: input.taskPacket.validation.commands.filter(
        (command) => command.required,
      ).length,
      runId: input.runId,
      runState: "queued",
      status: "approved",
      taskId: input.task.id,
      validationCommandCount: input.taskPacket.validation.commands.length,
    },
    now: () => input.approvedAt,
    runId: input.runId,
    taskId: input.task.id,
    workspaceId: input.workspaceId,
  });

export const createDrizzleApproveManualTaskStore = (db: Database): ApproveManualTaskStore => ({
  approveManualTaskWithQueue: async (input) =>
    db.transaction(async (tx) => {
      const [task] = await tx
        .update(schema.tasks)
        .set({
          approvedAt: input.approvedAt,
          policySnapshot: input.taskPacket.policy,
          status: "approved",
          updatedAt: input.approvedAt,
          validationCommands: input.taskPacket.validation.commands,
        })
        .where(
          and(
            eq(schema.tasks.id, input.taskId),
            eq(schema.tasks.workspaceId, input.workspaceId),
            eq(schema.tasks.sourceType, "manual"),
            eq(schema.tasks.status, "draft"),
          ),
        )
        .returning();

      if (task === undefined) {
        throw createActionError("validation_error");
      }

      const run = await queueManualJob(tx as ManualQueueDatabase, {
        jobId: input.jobId,
        queuedAt: input.approvedAt,
        repoMappingId: input.repoMappingId,
        runId: input.runId,
        taskId: input.taskId,
        taskPacket: input.taskPacket,
        workspaceId: input.workspaceId,
      });

      await tx.insert(schema.auditEvents).values(input.auditEvent);

      return {
        run,
        task,
      };
    }),
  findManualDraftTaskForApproval: async ({ taskId, workspaceId }) => {
    const [row] = await db
      .select({
        repoMapping: {
          archivedAt: schema.repoMappings.archivedAt,
          defaultBranch: schema.repoMappings.defaultBranch,
          id: schema.repoMappings.id,
          localPath: schema.repoMappings.localPath,
          policySnapshot: schema.repoMappings.policySnapshot,
          validationCommands: schema.repoMappings.validationCommands,
          workspaceId: schema.repoMappings.workspaceId,
        },
        task: schema.tasks,
      })
      .from(schema.tasks)
      .innerJoin(
        schema.repoMappings,
        and(
          eq(schema.repoMappings.id, schema.tasks.repoMappingId),
          eq(schema.repoMappings.workspaceId, schema.tasks.workspaceId),
          isNull(schema.repoMappings.archivedAt),
        ),
      )
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.workspaceId, workspaceId),
          eq(schema.tasks.sourceType, "manual"),
          eq(schema.tasks.status, "draft"),
        ),
      )
      .limit(1);

    return row ?? null;
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
});

export const createApproveManualTaskService = (input: {
  createAuditEventId?: () => string;
  createJobId?: () => string;
  createPacketId?: () => string;
  createRunId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: ApproveManualTaskStore;
}): ApproveManualTaskService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    approveManualTask: async (approveInput) => {
      const parsedInput = parseApproveManualTaskInput(approveInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: parsedInput.workspaceId,
      });
      const selection = await input.store.findManualDraftTaskForApproval({
        taskId: parsedInput.taskId,
        workspaceId: scope.workspaceId,
      });

      if (selection === null) {
        throw createActionError("validation_error");
      }

      const approvedAt = input.now?.() ?? new Date();
      const runId = input.createRunId?.() ?? randomUUID();
      const jobId = input.createJobId?.() ?? randomUUID();
      const packetId = input.createPacketId?.() ?? randomUUID();
      const taskPacket = buildManualTaskPacket({
        now: approvedAt,
        packetId,
        repoMapping: selection.repoMapping,
        runId,
        task: toTaskPacketTask(selection.task),
      });
      const auditEventInput: Parameters<typeof createApprovalAuditEvent>[0] = {
        actorId: scope.actorId,
        approvedAt,
        jobId,
        packetId,
        repoMappingId: selection.repoMapping.id,
        runId,
        task: selection.task,
        taskPacket,
        workspaceId: scope.workspaceId,
      };

      if (input.createAuditEventId !== undefined) {
        auditEventInput.createAuditEventId = input.createAuditEventId;
      }

      const auditEvent = createApprovalAuditEvent(auditEventInput);
      const { run, task } = await input.store.approveManualTaskWithQueue({
        approvedAt,
        auditEvent,
        jobId,
        repoMappingId: selection.repoMapping.id,
        runId,
        taskId: selection.task.id,
        taskPacket,
        workspaceId: scope.workspaceId,
      });

      return toApprovedManualTaskData(task, run);
    },
  };
};
