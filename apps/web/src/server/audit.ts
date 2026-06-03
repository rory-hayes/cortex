import "server-only";

import { redactLogText } from "@control-plane/logging";

export type SafeAuditMetadata = Record<string, unknown>;

export type AuditEventInsert = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: SafeAuditMetadata;
  runId?: string;
  runnerId?: string;
  taskId?: string;
  workspaceId: string;
};

export type AuditEventStore = {
  insertAuditEvent: (event: AuditEventInsert) => Promise<void>;
};

const unsafeMetadataTextPattern =
  /(?:diff --git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|ghp_[A-Za-z0-9_]+|sk_(?:live|test)_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)/i;
const unsafeMetadataKeyPattern =
  /(?:api[_-]?key|code|content|diff|passwd|password|patch|private[_-]?key|raw[_-]?output|secret|source|std[_-]?err|std[_-]?out|token)/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const sanitizeAuditValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue).filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    return sanitizeAuditMetadata(value);
  }

  if (typeof value === "string") {
    const redacted = redactLogText(value).text;

    if (unsafeMetadataTextPattern.test(redacted)) {
      return "[redacted]";
    }

    return redacted;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return undefined;
};

export const sanitizeAuditMetadata = (
  metadata: Record<string, unknown> | undefined,
): SafeAuditMetadata => {
  if (metadata === undefined) {
    return {};
  }

  const safeMetadata: SafeAuditMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (unsafeMetadataKeyPattern.test(key)) {
      continue;
    }

    const safeValue = sanitizeAuditValue(value);
    if (safeValue !== undefined) {
      safeMetadata[key] = safeValue;
    }
  }

  return safeMetadata;
};

export const createAuditEventInsert = (input: {
  actorId?: string;
  createId?: () => string;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown>;
  now?: () => Date;
  runId?: string;
  runnerId?: string;
  taskId?: string;
  workspaceId: string;
}): AuditEventInsert => {
  const event: AuditEventInsert = {
    createdAt: input.now?.() ?? new Date(),
    eventType: input.eventType,
    id: input.createId?.() ?? crypto.randomUUID(),
    message: input.message,
    metadata: sanitizeAuditMetadata(input.metadata),
    workspaceId: input.workspaceId,
  };

  if (input.actorId !== undefined) {
    event.actorId = input.actorId;
  }

  if (input.runId !== undefined) {
    event.runId = input.runId;
  }

  if (input.runnerId !== undefined) {
    event.runnerId = input.runnerId;
  }

  if (input.taskId !== undefined) {
    event.taskId = input.taskId;
  }

  return event;
};

export const insertAuditEvent = async (
  input: Parameters<typeof createAuditEventInsert>[0] & {
    store: AuditEventStore;
  },
): Promise<void> => {
  const event = createAuditEventInsert(input);

  await input.store.insertAuditEvent(event);
};
