import { schema, type Database } from "@control-plane/db";
import {
  RunnerJobSchema,
  TaskPacketSchema,
  type RunnerJob,
  type TaskPacket,
} from "@control-plane/shared";

const { runs } = schema;

type DatabaseRunRow = typeof runs.$inferSelect;
type ManualQueueRunInsert = typeof runs.$inferInsert;

export type ManualQueueRunRow = Pick<
  DatabaseRunRow,
  | "contractVersion"
  | "id"
  | "jobId"
  | "jobType"
  | "queuedAt"
  | "repoMappingId"
  | "state"
  | "taskPacket"
  | "workspaceId"
> &
  Partial<DatabaseRunRow>;

export type QueueManualJobInput = {
  jobId: string;
  runId: string;
  taskId: string;
  workspaceId: string;
  repoMappingId: string;
  taskPacket: unknown;
  maxAttempts?: number;
  queuedAt?: Date;
};

export type ListQueuedJobsForRepoMappingInput = {
  workspaceId: string;
  repoMappingId: string;
  limit?: number;
};

export type ManualQueueListFilter = {
  workspaceId: string;
  repoMappingId: string;
  state: "queued";
  limit: number;
};

export type ManualQueueTestDatabase = {
  insertRun: (row: ManualQueueRunInsert) => Promise<ManualQueueRunRow>;
  listQueuedRuns: (filter: ManualQueueListFilter) => Promise<ManualQueueRunRow[]>;
};

export type ManualQueueDatabase = Database | ManualQueueTestDatabase;

const unsafeTaskPacketKeys = new Set([
  "content",
  "contents",
  "diff",
  "filecontent",
  "filecontents",
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

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const unsafeTaskPacketTextPatterns = [
  /\bdiff --git\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Za-z0-9._%+-]+:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*(?!(?:\[REDACTED_SECRET\]|"\[REDACTED_SECRET\]"|'\[REDACTED_SECRET\]')(?:\s|$|[,;}]))["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;/m,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
];

const findUnsafeTaskPacketKey = (
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
    for (const childValue of value) {
      const unsafeKey = findUnsafeTaskPacketKey(childValue, seen);
      if (unsafeKey !== undefined) {
        return unsafeKey;
      }
    }

    return undefined;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (unsafeTaskPacketKeys.has(normalizeKey(key))) {
      return key;
    }

    const unsafeKey = findUnsafeTaskPacketKey(childValue, seen);
    if (unsafeKey !== undefined) {
      return unsafeKey;
    }
  }

  return undefined;
};

const hasUnsafeTaskPacketText = (value: string): boolean =>
  unsafeTaskPacketTextPatterns.some((pattern) => pattern.test(value));

const findUnsafeTaskPacketText = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): boolean => {
  if (typeof value === "string") {
    return hasUnsafeTaskPacketText(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((childValue) => findUnsafeTaskPacketText(childValue, seen));
  }

  return Object.values(value).some((childValue) => findUnsafeTaskPacketText(childValue, seen));
};

const parseSafeManualTaskPacket = (taskPacket: unknown): TaskPacket => {
  const unsafeKey = findUnsafeTaskPacketKey(taskPacket);
  if (unsafeKey !== undefined) {
    throw new Error(`Manual task packets must not include raw payload field "${unsafeKey}".`);
  }

  const parsedPacket = TaskPacketSchema.safeParse(taskPacket);
  if (!parsedPacket.success) {
    throw new Error("Invalid task packet for manual queue.");
  }

  if (findUnsafeTaskPacketText(parsedPacket.data)) {
    throw new Error("Manual task packets must not include unsafe text values.");
  }

  return parsedPacket.data;
};

const parseManualTaskPacket = (input: QueueManualJobInput): TaskPacket => {
  const packet = parseSafeManualTaskPacket(input.taskPacket);

  if (packet.runId !== input.runId) {
    throw new Error("Manual queue run id must match taskPacket.runId.");
  }

  if (packet.workspaceId !== input.workspaceId) {
    throw new Error("Manual queue workspace must match taskPacket.workspaceId.");
  }

  if (packet.mode === "repair") {
    throw new Error("Repair-mode task packets are not accepted by the manual queue.");
  }

  if (packet.source.type !== "manual") {
    throw new Error("Manual queue only accepts manual-source task packets.");
  }

  return packet;
};

const parseMaxAttempts = (maxAttempts: number | undefined): number => {
  const parsedMaxAttempts = maxAttempts ?? 1;

  if (!Number.isInteger(parsedMaxAttempts) || parsedMaxAttempts < 1) {
    throw new Error("Manual queue maxAttempts must be a positive integer.");
  }

  return parsedMaxAttempts;
};

const insertRun = async (
  db: ManualQueueDatabase,
  row: ManualQueueRunInsert,
): Promise<ManualQueueRunRow> => {
  if ("insertRun" in db) {
    return db.insertRun(row);
  }

  const insertedRows = await db.insert(runs).values(row).returning();
  const insertedRow = insertedRows[0];
  if (insertedRow === undefined) {
    throw new Error("Manual queue insert did not return a run row.");
  }

  return insertedRow;
};

const listQueuedRuns = async (
  db: ManualQueueDatabase,
  filter: ManualQueueListFilter,
): Promise<ManualQueueRunRow[]> => {
  if ("listQueuedRuns" in db) {
    return db.listQueuedRuns(filter);
  }

  return db.query.runs.findMany({
    where: (fields, { and, eq }) =>
      and(
        eq(fields.workspaceId, filter.workspaceId),
        eq(fields.repoMappingId, filter.repoMappingId),
        eq(fields.state, filter.state),
      ),
    orderBy: (fields, { asc }) => [asc(fields.queuedAt)],
    limit: filter.limit,
  });
};

const toIsoTimestamp = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Manual queue run row has an invalid queuedAt timestamp.");
  }

  return date.toISOString();
};

export const toRunnerJob = (row: ManualQueueRunRow): RunnerJob => {
  if (row.taskPacket === null) {
    throw new Error("Manual queue run row is missing taskPacket.");
  }

  const taskPacket = parseSafeManualTaskPacket(row.taskPacket);

  return RunnerJobSchema.parse({
    contractVersion: row.contractVersion,
    jobId: row.jobId,
    runId: row.id,
    type: row.jobType,
    taskPacket,
    queuedAt: toIsoTimestamp(row.queuedAt),
  });
};

export const queueManualJob = async (
  db: ManualQueueDatabase,
  input: QueueManualJobInput,
): Promise<ManualQueueRunRow> => {
  const taskPacket = parseManualTaskPacket(input);
  const maxAttempts = parseMaxAttempts(input.maxAttempts);
  const queuedAt = input.queuedAt ?? new Date();

  const row = await insertRun(db, {
    id: input.runId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    repoMappingId: input.repoMappingId,
    contractVersion: taskPacket.contractVersion,
    jobId: input.jobId,
    jobType: "task",
    state: "queued",
    mode: taskPacket.mode,
    taskPacket,
    attemptCount: 0,
    maxAttempts,
    claimExpiresAt: null,
    policySnapshot: taskPacket.policy,
    validationCommands: taskPacket.validation.commands,
    changedPaths: [],
    riskFindings: [],
    queuedAt,
    cancellationRequestedAt: null,
    cancellationRequestedByActorId: null,
    cancellationReason: null,
  });

  toRunnerJob(row);

  return row;
};

export const listQueuedJobsForRepoMapping = async (
  db: ManualQueueDatabase,
  input: ListQueuedJobsForRepoMappingInput,
): Promise<RunnerJob[]> => {
  const limit = input.limit ?? 10;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Manual queue limit must be a positive integer.");
  }

  const rows = await listQueuedRuns(db, {
    workspaceId: input.workspaceId,
    repoMappingId: input.repoMappingId,
    state: "queued",
    limit,
  });

  return rows.map(toRunnerJob);
};
