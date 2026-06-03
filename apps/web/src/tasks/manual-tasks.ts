import "server-only";

import { randomUUID } from "node:crypto";

import { CONTRACT_VERSION } from "@control-plane/shared";

import { and, desc, eq, inArray, isNull, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export type ManualTaskRow = typeof schema.tasks.$inferSelect;

export type ManualTaskMode = "dryRun" | "execute";
export const visibleManualTaskStatuses = ["draft", "approved"] as const;
export type ManualTaskVisibleStatus = (typeof visibleManualTaskStatuses)[number];

export type CreateManualTaskInput = {
  acceptanceCriteria: string[];
  contextFilePaths?: string[];
  mode?: ManualTaskMode;
  objective: string;
  repoMappingId: string;
  source?: {
    externalId?: string;
    url?: string;
  };
  title: string;
  workspaceId: string;
};

export type ListManualTasksInput = {
  limit?: number;
  repoMappingId?: string;
  workspaceId: string;
};

export type ManualTaskData = Omit<ManualTaskRow, "policySnapshot" | "validationCommands">;

export type RepoMappingForManualTask = {
  archivedAt: Date | null;
  id: string;
  workspaceId: string;
};

export type ManualTaskCreateInsert = {
  acceptanceCriteria: string[];
  auditEvent: AuditEventInsert;
  contextFilePaths: string[];
  contractVersion: string;
  externalId: string | null;
  externalUrl: string | null;
  id: string;
  mode: ManualTaskMode;
  objective: string;
  policySnapshot: null;
  repoMappingId: string;
  requestedByActorId: string;
  sourceType: "manual";
  status: "draft";
  title: string;
  validationCommands: null;
  workspaceId: string;
};

export type ManualTaskListFilter = {
  limit: number;
  repoMappingId?: string;
  sourceType: "manual";
  statuses: readonly ManualTaskVisibleStatus[];
  workspaceId: string;
};

export type ManualTaskStore = WorkspaceMembershipStore & {
  createManualTaskWithAudit: (insert: ManualTaskCreateInsert) => Promise<ManualTaskRow>;
  findActiveRepoMapping: (input: {
    repoMappingId: string;
    workspaceId: string;
  }) => Promise<RepoMappingForManualTask | null>;
  listManualTasks: (filter: ManualTaskListFilter) => Promise<ManualTaskRow[]>;
};

export type ManualTaskService = {
  createManualTask: (input: CreateManualTaskInput) => Promise<ManualTaskData>;
  listManualTasks: (input: ListManualTasksInput) => Promise<ManualTaskData[]>;
};

type NormalizedCreateManualTaskInput = {
  acceptanceCriteria: string[];
  contextFilePaths: string[];
  externalId: string | null;
  externalUrl: string | null;
  mode: ManualTaskMode;
  objective: string;
  repoMappingId: string;
  title: string;
  workspaceId: string;
};

type NormalizedListManualTasksInput = {
  limit: number;
  repoMappingId?: string;
  workspaceId: string;
};

const requiredTextMaxLength = 240;
const titleMaxLength = 240;
const objectiveMaxLength = 4_000;
const acceptanceCriterionMaxLength = 1_000;
const maxAcceptanceCriteria = 20;
const contextFilePathMaxLength = 512;
const externalUrlMaxLength = 2_048;
const defaultListLimit = 25;
const maxListLimit = 100;

const unsafePayloadKeys = new Set([
  "content",
  "contents",
  "dependencygraph",
  "dependencygraphs",
  "diff",
  "filecontent",
  "filecontents",
  "filetree",
  "filetrees",
  "log",
  "logs",
  "output",
  "patch",
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
]);

const unsafeTextPatterns = [
  /\bdiff --git\b/i,
  /@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bxox[a-z]-[A-Za-z0-9-]{20,}\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Za-z0-9._%+-]+:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+|;)/m,
  /^\s*(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/m,
  /^\s*(?:try|else)\s*\{/m,
  /^\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)]*\)\s*;?\s*$/m,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
] as const;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

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

const hasUnsafeText = (value: string): boolean =>
  unsafeTextPatterns.some((pattern) => pattern.test(value));

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

const normalizeOptionalText = (value: unknown, maxLength: number): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  if (value.trim().length === 0) {
    return null;
  }

  return assertSafeBoundedText(value, maxLength);
};

const normalizeMode = (mode: unknown): ManualTaskMode => {
  if (mode === undefined || mode === null) {
    return "execute";
  }

  if (mode === "execute" || mode === "dryRun") {
    return mode;
  }

  throw createActionError("validation_error");
};

const normalizeAcceptanceCriteria = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxAcceptanceCriteria) {
    throw createActionError("validation_error");
  }

  return value.map((criterion) => assertSafeBoundedText(criterion, acceptanceCriterionMaxLength));
};

const hasCredentialUrlParts = (url: URL): boolean => Boolean(url.username || url.password);

const normalizeSource = (
  value: unknown,
): {
  externalId: string | null;
  externalUrl: string | null;
} => {
  if (value === undefined || value === null) {
    return {
      externalId: null,
      externalUrl: null,
    };
  }

  if (!isRecord(value)) {
    throw createActionError("validation_error");
  }

  const externalId = normalizeOptionalText(value.externalId, requiredTextMaxLength);
  const externalUrl = normalizeOptionalText(value.url, externalUrlMaxLength);

  if (externalUrl !== null) {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(externalUrl);
    } catch {
      throw createActionError("validation_error");
    }

    if (
      (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") ||
      hasCredentialUrlParts(parsedUrl)
    ) {
      throw createActionError("validation_error");
    }
  }

  return {
    externalId,
    externalUrl,
  };
};

const isEnvLikeContextPath = (path: string): boolean => {
  const segments = path.split("/");
  const basename = segments.at(-1) ?? "";

  if (basename === ".env.example") {
    return false;
  }

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "local.env" ||
    basename.endsWith(".local.env")
  );
};

const normalizeContextFilePath = (value: unknown): string => {
  const path = assertSafeBoundedText(value, contextFilePathMaxLength);

  if (
    path.startsWith("/") ||
    path === "~" ||
    path.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    isEnvLikeContextPath(path)
  ) {
    throw createActionError("validation_error");
  }

  return path;
};

const normalizeContextFilePaths = (value: unknown): string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createActionError("validation_error");
  }

  return value.map(normalizeContextFilePath);
};

const parseCreateManualTaskInput = (
  input: CreateManualTaskInput,
): NormalizedCreateManualTaskInput => {
  assertNoUnsafePayloadKeys(input);

  if (!isRecord(input)) {
    throw createActionError("validation_error");
  }

  const source = normalizeSource(input.source);

  return {
    acceptanceCriteria: normalizeAcceptanceCriteria(input.acceptanceCriteria),
    contextFilePaths: normalizeContextFilePaths(input.contextFilePaths),
    externalId: source.externalId,
    externalUrl: source.externalUrl,
    mode: normalizeMode(input.mode),
    objective: assertSafeBoundedText(input.objective, objectiveMaxLength),
    repoMappingId: assertSafeBoundedText(input.repoMappingId, requiredTextMaxLength),
    title: assertSafeBoundedText(input.title, titleMaxLength),
    workspaceId: assertSafeBoundedText(input.workspaceId, requiredTextMaxLength),
  };
};

const normalizeListLimit = (limit: number | undefined): number => {
  const normalizedLimit = limit ?? defaultListLimit;

  if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > maxListLimit) {
    throw createActionError("validation_error");
  }

  return normalizedLimit;
};

const parseListManualTasksInput = (input: ListManualTasksInput): NormalizedListManualTasksInput => {
  assertNoUnsafePayloadKeys(input);

  const parsedInput: NormalizedListManualTasksInput = {
    limit: normalizeListLimit(input.limit),
    workspaceId: assertSafeBoundedText(input.workspaceId, requiredTextMaxLength),
  };

  if (input.repoMappingId !== undefined) {
    parsedInput.repoMappingId = assertSafeBoundedText(input.repoMappingId, requiredTextMaxLength);
  }

  return parsedInput;
};

export const toManualTaskData = (row: ManualTaskData): ManualTaskData => ({
  acceptanceCriteria: row.acceptanceCriteria,
  approvedAt: row.approvedAt,
  contextFilePaths: row.contextFilePaths,
  contractVersion: row.contractVersion,
  createdAt: row.createdAt,
  externalId: row.externalId,
  externalUrl: row.externalUrl,
  id: row.id,
  mode: row.mode,
  objective: row.objective,
  repoMappingId: row.repoMappingId,
  requestedByActorId: row.requestedByActorId,
  sourceType: row.sourceType,
  status: row.status,
  title: row.title,
  updatedAt: row.updatedAt,
  workspaceId: row.workspaceId,
});

const assertActiveRepoMapping = async (
  store: ManualTaskStore,
  input: {
    repoMappingId: string;
    workspaceId: string;
  },
): Promise<RepoMappingForManualTask> => {
  const mapping = await store.findActiveRepoMapping(input);

  if (mapping === null) {
    throw createActionError("validation_error");
  }

  return mapping;
};

export const createDrizzleManualTaskStore = (db: Database): ManualTaskStore => ({
  createManualTaskWithAudit: async ({ auditEvent, ...taskInsert }) =>
    db.transaction(async (tx) => {
      const [task] = await tx.insert(schema.tasks).values(taskInsert).returning();

      if (task === undefined) {
        throw new Error("Manual task insert did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return task;
    }),
  findActiveRepoMapping: async ({ repoMappingId, workspaceId }) => {
    const [mapping] = await db
      .select({
        archivedAt: schema.repoMappings.archivedAt,
        id: schema.repoMappings.id,
        workspaceId: schema.repoMappings.workspaceId,
      })
      .from(schema.repoMappings)
      .where(
        and(
          eq(schema.repoMappings.id, repoMappingId),
          eq(schema.repoMappings.workspaceId, workspaceId),
          isNull(schema.repoMappings.archivedAt),
        ),
      )
      .limit(1);

    return mapping ?? null;
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
  listManualTasks: async (filter) => {
    const conditions = [
      eq(schema.tasks.workspaceId, filter.workspaceId),
      eq(schema.tasks.sourceType, filter.sourceType),
      inArray(schema.tasks.status, [...filter.statuses]),
    ];

    if (filter.repoMappingId !== undefined) {
      conditions.push(eq(schema.tasks.repoMappingId, filter.repoMappingId));
    }

    const rows = await db
      .select({
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
      .where(and(...conditions))
      .orderBy(desc(schema.tasks.createdAt), desc(schema.tasks.id))
      .limit(filter.limit);

    return rows.map(({ task }) => task);
  },
});

export const createManualTaskService = (input: {
  createAuditEventId?: () => string;
  createTaskId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: ManualTaskStore;
}): ManualTaskService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    createManualTask: async (createInput) => {
      const parsedInput = parseCreateManualTaskInput(createInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: parsedInput.workspaceId,
      });
      const mapping = await assertActiveRepoMapping(input.store, {
        repoMappingId: parsedInput.repoMappingId,
        workspaceId: scope.workspaceId,
      });
      const taskId = input.createTaskId?.() ?? randomUUID();
      const auditInput: Parameters<typeof createAuditEventInsert>[0] = {
        actorId: scope.actorId,
        createId: input.createAuditEventId ?? randomUUID,
        eventType: "task.manual.created",
        message: "Manual task created.",
        metadata: {
          acceptanceCriteriaCount: parsedInput.acceptanceCriteria.length,
          acceptanceCriteriaTotalLength: parsedInput.acceptanceCriteria.reduce(
            (total, criterion) => total + criterion.length,
            0,
          ),
          contextFilePathCount: parsedInput.contextFilePaths.length,
          externalIdLength: parsedInput.externalId?.length ?? 0,
          externalUrlLength: parsedInput.externalUrl?.length ?? 0,
          mode: parsedInput.mode,
          objectiveLength: parsedInput.objective.length,
          originType: "manual",
          repoMappingId: mapping.id,
          status: "draft",
          taskId,
          titleLength: parsedInput.title.length,
        },
        taskId,
        workspaceId: scope.workspaceId,
      };

      if (input.now !== undefined) {
        auditInput.now = input.now;
      }

      const task = await input.store.createManualTaskWithAudit({
        acceptanceCriteria: parsedInput.acceptanceCriteria,
        auditEvent: createAuditEventInsert(auditInput),
        contextFilePaths: parsedInput.contextFilePaths,
        contractVersion: CONTRACT_VERSION,
        externalId: parsedInput.externalId,
        externalUrl: parsedInput.externalUrl,
        id: taskId,
        mode: parsedInput.mode,
        objective: parsedInput.objective,
        policySnapshot: null,
        repoMappingId: mapping.id,
        requestedByActorId: scope.actorId,
        sourceType: "manual",
        status: "draft",
        title: parsedInput.title,
        validationCommands: null,
        workspaceId: scope.workspaceId,
      });

      return toManualTaskData(task);
    },
    listManualTasks: async (listInput) => {
      const parsedInput = parseListManualTasksInput(listInput);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: parsedInput.workspaceId,
      });

      if (parsedInput.repoMappingId !== undefined) {
        await assertActiveRepoMapping(input.store, {
          repoMappingId: parsedInput.repoMappingId,
          workspaceId: scope.workspaceId,
        });
      }

      const filter: ManualTaskListFilter = {
        limit: parsedInput.limit,
        sourceType: "manual",
        statuses: visibleManualTaskStatuses,
        workspaceId: scope.workspaceId,
      };

      if (parsedInput.repoMappingId !== undefined) {
        filter.repoMappingId = parsedInput.repoMappingId;
      }

      const tasks = await input.store.listManualTasks(filter);

      return tasks.map(toManualTaskData);
    },
  };
};
