import { randomUUID } from "node:crypto";

import { and, eq, schema, sql, type Database, type UsageEventRecord } from "@control-plane/db";
import { redactLogText } from "@control-plane/logging";
import { getWorkspaceUsage, type WorkspaceUsage } from "./usage";

export const USAGE_EVENT_TYPES = [
  "repo_scan",
  "readiness_report_generation",
  "task_recommendation_generation",
  "setup_pr_generation",
  "runner_execution",
] as const;

export const USAGE_MODEL_CATEGORIES = [
  "scan",
  "ai_generation",
  "setup_pr",
  "runner_execution",
] as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];
export type UsageModelCategory = (typeof USAGE_MODEL_CATEGORIES)[number];

const usageCategoryByEvent = {
  readiness_report_generation: "ai_generation",
  repo_scan: "scan",
  runner_execution: "runner_execution",
  setup_pr_generation: "setup_pr",
  task_recommendation_generation: "ai_generation",
} satisfies Record<UsageEventType, UsageModelCategory>;

const usageEventSourceTables = [
  "repo_scans",
  "repo_readiness_reports",
  "task_recommendations",
  "setup_pr_previews",
  "runs",
] as const;

export type UsageEventSourceTable = (typeof usageEventSourceTables)[number];

export type UsageEvent = {
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  modelUsageCategory: UsageModelCategory;
  occurredAt: Date;
  quantity: number;
  sourceId: string | null;
  sourceTable: UsageEventSourceTable | null;
  usageEventType: UsageEventType;
  workspaceId: string;
};

export type RecordUsageEventInput = {
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  quantity?: number;
  source?: {
    id: string;
    table: UsageEventSourceTable;
  };
  usageEventType: UsageEventType;
  workspaceId: string;
};

export type UsageEventInsert = typeof schema.usageEvents.$inferInsert;

export type CreateUsageEventInsertInput = RecordUsageEventInput & {
  createdAt?: Date;
  eventId?: string;
};

export type UsageEventSummary = {
  byModelUsageCategory: Record<UsageModelCategory, number>;
  byUsageEventType: Record<UsageEventType, number>;
  enforcementEnabled: WorkspaceUsage["enforcementEnabled"];
  monthlyRunLimit: number;
  periodEnd: Date;
  periodStart: Date;
  plan: string;
  remainingMonthlyQuantity: number;
  totalQuantity: number;
  workspaceId: string;
};

export type UsageEventStore = {
  findUsageEventByIdempotencyKey: (input: {
    idempotencyKey: string;
    workspaceId: string;
  }) => Promise<UsageEvent | null>;
  getWorkspaceUsage: (input: { workspaceId: string }) => Promise<WorkspaceUsage | null>;
  insertUsageEvent: (event: UsageEvent) => Promise<UsageEvent>;
  listUsageEvents: (input: {
    periodEnd: Date;
    periodStart: Date;
    workspaceId: string;
  }) => Promise<UsageEvent[]>;
};

export type CreateUsageEventServiceInput = {
  createEventId?: () => string;
  now?: () => Date;
  store: UsageEventStore;
};

const safeIdentifierPattern = /^[A-Za-z0-9._:-]{1,240}$/u;
const unsafeUsageMetadataKeys = new Set([
  "code",
  "content",
  "diff",
  "log",
  "output",
  "patch",
  "prompt",
  "rawoutput",
  "rawsource",
  "secret",
  "snippet",
  "source",
  "sourcecode",
  "stderr",
  "stdout",
  "token",
]);
const unsafeUsageMetadataTextPatterns = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /\b(?:sourceCode|rawSource|rawDiff|patchText|codeSnippet|rawOutput|rawLog)\b/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /(?:^|[/\\])\.env(?:\.[A-Za-z0-9_.-]+)?(?:$|[/\\\s])/i,
] as const;

class UsageEventValidationError extends Error {
  readonly code = "validation_error" as const;

  constructor() {
    super("Check the submitted fields and try again.");
    this.name = "UsageEventValidationError";
  }
}

const createUsageEventValidationError = () => new UsageEventValidationError();

const isUsageEventType = (value: string): value is UsageEventType =>
  USAGE_EVENT_TYPES.includes(value as UsageEventType);

const isUsageEventSourceTable = (value: string): value is UsageEventSourceTable =>
  usageEventSourceTables.includes(value as UsageEventSourceTable);

const normalizeUsageMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const hasUnsafeUsageText = (value: string): boolean =>
  redactLogText(value).redactionApplied ||
  unsafeUsageMetadataTextPatterns.some((pattern) => pattern.test(value));

const isSafeIdentifier = (value: string): boolean =>
  safeIdentifierPattern.test(value) && !hasUnsafeUsageText(value);

const assertSafeIdentifier = (value: string): void => {
  if (!isSafeIdentifier(value)) {
    throw createUsageEventValidationError();
  }
};

const hasUnsafeUsageMetadata = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (typeof value === "string") {
    return hasUnsafeUsageText(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeUsageMetadata(item, seen));
  }

  return Object.entries(value).some(
    ([key, childValue]) =>
      unsafeUsageMetadataKeys.has(normalizeUsageMetadataKey(key)) ||
      hasUnsafeUsageText(key) ||
      hasUnsafeUsageMetadata(childValue, seen),
  );
};

const assertSafeMetadata = (metadata: Record<string, unknown>): void => {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.getPrototypeOf(metadata) !== Object.prototype
  ) {
    throw createUsageEventValidationError();
  }

  if (hasUnsafeUsageMetadata(metadata)) {
    throw createUsageEventValidationError();
  }
};

const createEmptyEventCounts = (): Record<UsageEventType, number> => ({
  readiness_report_generation: 0,
  repo_scan: 0,
  runner_execution: 0,
  setup_pr_generation: 0,
  task_recommendation_generation: 0,
});

const createEmptyCategoryCounts = (): Record<UsageModelCategory, number> => ({
  ai_generation: 0,
  runner_execution: 0,
  scan: 0,
  setup_pr: 0,
});

const toUsageEvent = (row: UsageEventRecord): UsageEvent => ({
  createdAt: row.createdAt,
  id: row.id,
  idempotencyKey: row.idempotencyKey,
  metadata: row.metadata,
  modelUsageCategory: row.modelUsageCategory,
  occurredAt: row.occurredAt,
  quantity: row.quantity,
  sourceId: row.sourceId,
  sourceTable: row.sourceTable as UsageEventSourceTable | null,
  usageEventType: row.usageEventType,
  workspaceId: row.workspaceId,
});

export const createUsageEventInsert = (input: CreateUsageEventInsertInput): UsageEventInsert => {
  assertSafeIdentifier(input.workspaceId);
  assertSafeIdentifier(input.idempotencyKey);

  if (!isUsageEventType(input.usageEventType)) {
    throw createUsageEventValidationError();
  }

  const quantity = input.quantity ?? 1;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createUsageEventValidationError();
  }

  const metadata = input.metadata ?? {};
  assertSafeMetadata(metadata);

  const sourceTable = input.source?.table ?? null;
  const sourceId = input.source?.id ?? null;

  if (sourceTable !== null) {
    if (!isUsageEventSourceTable(sourceTable)) {
      throw createUsageEventValidationError();
    }

    assertSafeIdentifier(sourceTable);
  }

  if (sourceId !== null) {
    assertSafeIdentifier(sourceId);
  }

  const timestamp = input.createdAt ?? new Date();

  return {
    createdAt: timestamp,
    id: input.eventId ?? `usage_event_${randomUUID()}`,
    idempotencyKey: input.idempotencyKey,
    metadata,
    modelUsageCategory: usageCategoryByEvent[input.usageEventType],
    occurredAt: input.occurredAt ?? timestamp,
    quantity,
    sourceId,
    sourceTable,
    usageEventType: input.usageEventType,
    workspaceId: input.workspaceId,
  };
};

const usageEventReturning = {
  createdAt: schema.usageEvents.createdAt,
  id: schema.usageEvents.id,
  idempotencyKey: schema.usageEvents.idempotencyKey,
  metadata: schema.usageEvents.metadata,
  modelUsageCategory: schema.usageEvents.modelUsageCategory,
  occurredAt: schema.usageEvents.occurredAt,
  quantity: schema.usageEvents.quantity,
  sourceId: schema.usageEvents.sourceId,
  sourceTable: schema.usageEvents.sourceTable,
  usageEventType: schema.usageEvents.usageEventType,
  workspaceId: schema.usageEvents.workspaceId,
};

export const createDrizzleUsageEventStore = (db: Pick<Database, "insert" | "select">) => ({
  findUsageEventByIdempotencyKey: async (input: {
    idempotencyKey: string;
    workspaceId: string;
  }): Promise<UsageEvent | null> => {
    const [event] = await db
      .select(usageEventReturning)
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.workspaceId, input.workspaceId),
          eq(schema.usageEvents.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    return event === undefined ? null : toUsageEvent(event);
  },
  getWorkspaceUsage: (input: { workspaceId: string }) =>
    getWorkspaceUsage(db as Pick<Database, "select" | "update">, input),
  insertUsageEvent: async (event: UsageEvent): Promise<UsageEvent> => {
    const [insertedEvent] = await db
      .insert(schema.usageEvents)
      .values({
        createdAt: event.createdAt,
        id: event.id,
        idempotencyKey: event.idempotencyKey,
        metadata: event.metadata,
        modelUsageCategory: event.modelUsageCategory,
        occurredAt: event.occurredAt,
        quantity: event.quantity,
        sourceId: event.sourceId,
        sourceTable: event.sourceTable,
        usageEventType: event.usageEventType,
        workspaceId: event.workspaceId,
      })
      .returning(usageEventReturning);

    if (insertedEvent === undefined) {
      throw createUsageEventValidationError();
    }

    return toUsageEvent(insertedEvent);
  },
  listUsageEvents: async (input: {
    periodEnd: Date;
    periodStart: Date;
    workspaceId: string;
  }): Promise<UsageEvent[]> => {
    const events = await db
      .select(usageEventReturning)
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.workspaceId, input.workspaceId),
          sql`${schema.usageEvents.occurredAt} >= ${input.periodStart}`,
          sql`${schema.usageEvents.occurredAt} < ${input.periodEnd}`,
        ),
      );

    return events.map(toUsageEvent);
  },
});

export const createUsageEventService = ({
  createEventId = () => `usage_event_${randomUUID()}`,
  now = () => new Date(),
  store,
}: CreateUsageEventServiceInput) => ({
  recordUsageEvent: async (input: RecordUsageEventInput): Promise<UsageEvent> => {
    assertSafeIdentifier(input.workspaceId);
    assertSafeIdentifier(input.idempotencyKey);

    if (!isUsageEventType(input.usageEventType)) {
      throw createUsageEventValidationError();
    }

    const existingEvent = await store.findUsageEventByIdempotencyKey({
      idempotencyKey: input.idempotencyKey,
      workspaceId: input.workspaceId,
    });

    if (existingEvent !== null) {
      return existingEvent;
    }

    const timestamp = now();
    const event = createUsageEventInsert({
      ...input,
      createdAt: timestamp,
      eventId: createEventId(),
      occurredAt: input.occurredAt ?? timestamp,
    }) as UsageEvent;

    return store.insertUsageEvent(event);
  },
  summarizeWorkspaceUsageEvents: async (input: {
    periodEnd: Date;
    periodStart: Date;
    workspaceId: string;
  }): Promise<UsageEventSummary> => {
    assertSafeIdentifier(input.workspaceId);

    if (input.periodStart >= input.periodEnd) {
      throw createUsageEventValidationError();
    }

    const [workspaceUsage, events] = await Promise.all([
      store.getWorkspaceUsage({ workspaceId: input.workspaceId }),
      store.listUsageEvents(input),
    ]);

    if (workspaceUsage === null) {
      throw createUsageEventValidationError();
    }

    const byUsageEventType = createEmptyEventCounts();
    const byModelUsageCategory = createEmptyCategoryCounts();
    let totalQuantity = 0;

    for (const event of events) {
      totalQuantity += event.quantity;
      byUsageEventType[event.usageEventType] += event.quantity;
      byModelUsageCategory[event.modelUsageCategory] += event.quantity;
    }

    return {
      byModelUsageCategory,
      byUsageEventType,
      enforcementEnabled: workspaceUsage.enforcementEnabled,
      monthlyRunLimit: workspaceUsage.monthlyRunLimit,
      periodEnd: input.periodEnd,
      periodStart: input.periodStart,
      plan: workspaceUsage.plan,
      remainingMonthlyQuantity: Math.max(workspaceUsage.monthlyRunLimit - totalQuantity, 0),
      totalQuantity,
      workspaceId: input.workspaceId,
    };
  },
});
