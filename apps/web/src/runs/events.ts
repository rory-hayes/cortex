import "server-only";

import {
  RunEventSchema,
  SubmitRunEventRequestSchema,
  isTerminalRunState,
  type RunEvent,
  type RunState,
} from "@control-plane/shared";

import { and, eq, schema, type Database } from "../db";
import type { AuthenticatedRunnerContext } from "../runner-auth";
import {
  hasUnsafePayloadText as hasUnsafeRunEventText,
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";

export type PersistRunEventInput = {
  event: RunEvent;
  eventCreatedAt: Date;
  receivedAt: Date;
  runnerId: string;
  workspaceId: string;
};

export type PersistRunEventResult =
  | {
      event: RunEvent;
      inserted: boolean;
      status: "stored";
    }
  | {
      status: "event_id_conflict";
    }
  | {
      status: "run_not_found";
    }
  | {
      status: "runner_conflict";
    };

export type RunEventSubmissionStore = {
  persistRunEvent: (input: PersistRunEventInput) => Promise<PersistRunEventResult>;
};

export type SubmitRunEventStore = RunEventSubmissionStore;

export type SubmitRunEventInput = {
  context: AuthenticatedRunnerContext;
  request: unknown;
};

export type RunEventSubmissionService = {
  submitRunEvent: (input: SubmitRunEventInput) => Promise<RunEvent>;
};

export type SubmitRunEventService = RunEventSubmissionService;

export class SubmitRunEventRequestError extends Error {
  readonly code = "invalid_run_event_submission" as const;

  constructor() {
    super("Invalid run event submission.");
    this.name = "SubmitRunEventRequestError";
  }
}

export { SubmitRunEventRequestError as RunEventSubmissionRequestError };

export class RunEventSubmissionError extends SubmitRunEventRequestError {
  constructor() {
    super();
    this.name = "RunEventSubmissionError";
  }
}

export const isSubmitRunEventRequestError = (
  error: unknown,
): error is SubmitRunEventRequestError => error instanceof SubmitRunEventRequestError;

export const isRunEventSubmissionRequestError = isSubmitRunEventRequestError;

export const isRunEventSubmissionError = (
  error: unknown,
): error is SubmitRunEventRequestError => isSubmitRunEventRequestError(error);

const createRunEventSubmissionError = (): RunEventSubmissionError => new RunEventSubmissionError();

export const getConservativeRunEventRunState = (input: {
  currentState: RunState;
  eventState: RunState;
}): RunState => {
  if (isTerminalRunState(input.currentState) && !isTerminalRunState(input.eventState)) {
    return input.currentState;
  }

  return input.eventState;
};

export const shouldUpdateRunAggregateForEvent = (input: {
  currentLastEventAt: Date | null;
  eventCreatedAt: Date;
}): boolean =>
  input.currentLastEventAt === null ||
  input.eventCreatedAt.getTime() >= input.currentLastEventAt.getTime();

const assertCanonicalRunEventIdempotencyKey = (input: {
  idempotencyKey: string;
  runId: string;
}): void => {
  const expectedPrefix = `run:${input.runId}:event:`;
  const attemptMatch = /:([1-9][0-9]*)$/.exec(input.idempotencyKey);

  if (attemptMatch === null || !input.idempotencyKey.startsWith(expectedPrefix)) {
    throw createRunEventSubmissionError();
  }

  const stableStepName = input.idempotencyKey.slice(
    expectedPrefix.length,
    attemptMatch.index,
  );

  if (stableStepName.length === 0 || hasUnsafeRunEventText(stableStepName)) {
    throw createRunEventSubmissionError();
  }
};

const parseEventCreatedAt = (createdAt: string): Date => {
  const timestampMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(createdAt);

  if (timestampMatch === null) {
    throw createRunEventSubmissionError();
  }

  const eventCreatedAt = new Date(createdAt);

  if (Number.isNaN(eventCreatedAt.getTime())) {
    throw createRunEventSubmissionError();
  }

  const [, year, month, day, hour, minute, second, millisecond = "000"] = timestampMatch;

  if (
    eventCreatedAt.getUTCFullYear() !== Number(year) ||
    eventCreatedAt.getUTCMonth() + 1 !== Number(month) ||
    eventCreatedAt.getUTCDate() !== Number(day) ||
    eventCreatedAt.getUTCHours() !== Number(hour) ||
    eventCreatedAt.getUTCMinutes() !== Number(minute) ||
    eventCreatedAt.getUTCSeconds() !== Number(second) ||
    eventCreatedAt.getUTCMilliseconds() !== Number(millisecond)
  ) {
    throw createRunEventSubmissionError();
  }

  return eventCreatedAt;
};

const assertSafeRunEventValues = (input: {
  eventId: string;
  message: string;
  metadata: unknown;
}): void => {
  if (
    hasUnsafeRunEventText(input.eventId) ||
    hasUnsafeRunEventText(input.message) ||
    hasUnsafeWebBoundPayload(input.metadata)
  ) {
    throw createRunEventSubmissionError();
  }
};

const toIsoTimestamp = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Run event row has an invalid timestamp.");
  }

  return date.toISOString();
};

type RunEventRow = typeof schema.runEvents.$inferSelect;

const toRunEvent = (row: RunEventRow): RunEvent =>
  RunEventSchema.parse({
    contractVersion: row.contractVersion,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    runId: row.runId,
    ...(row.runnerId === null ? {} : { runnerId: row.runnerId }),
    state: row.state,
    severity: row.severity,
    message: row.message,
    metadata: row.metadata,
    createdAt: toIsoTimestamp(row.createdAt),
  });

const runEventReturningColumns = {
  contractVersion: schema.runEvents.contractVersion,
  createdAt: schema.runEvents.createdAt,
  id: schema.runEvents.id,
  idempotencyKey: schema.runEvents.idempotencyKey,
  message: schema.runEvents.message,
  metadata: schema.runEvents.metadata,
  receivedAt: schema.runEvents.receivedAt,
  runId: schema.runEvents.runId,
  runnerId: schema.runEvents.runnerId,
  severity: schema.runEvents.severity,
  state: schema.runEvents.state,
  workspaceId: schema.runEvents.workspaceId,
} satisfies Record<keyof RunEventRow, unknown>;

export const createDrizzleRunEventSubmissionStore = (
  db: Database,
): RunEventSubmissionStore => ({
  persistRunEvent: async (input) =>
    db.transaction(async (tx): Promise<PersistRunEventResult> => {
      const [run] = await tx
        .select({
          id: schema.runs.id,
          lastEventAt: schema.runs.lastEventAt,
          runnerId: schema.runs.runnerId,
          state: schema.runs.state,
          workspaceId: schema.runs.workspaceId,
        })
        .from(schema.runs)
        .where(and(eq(schema.runs.id, input.event.runId), eq(schema.runs.workspaceId, input.workspaceId)))
        .limit(1);

      if (run === undefined) {
        return { status: "run_not_found" };
      }

      if (run.runnerId !== null && run.runnerId !== input.runnerId) {
        return { status: "runner_conflict" };
      }

      const [existingIdempotentEvent] = await tx
        .select(runEventReturningColumns)
        .from(schema.runEvents)
        .where(
          and(
            eq(schema.runEvents.runId, input.event.runId),
            eq(schema.runEvents.workspaceId, input.workspaceId),
            eq(schema.runEvents.idempotencyKey, input.event.idempotencyKey),
          ),
        )
        .limit(1);

      if (existingIdempotentEvent !== undefined) {
        return {
          event: toRunEvent(existingIdempotentEvent),
          inserted: false,
          status: "stored",
        };
      }

      const [existingEventId] = await tx
        .select({ id: schema.runEvents.id })
        .from(schema.runEvents)
        .where(eq(schema.runEvents.id, input.event.id))
        .limit(1);

      if (existingEventId !== undefined) {
        return { status: "event_id_conflict" };
      }

      const [insertedEvent] = await tx
        .insert(schema.runEvents)
        .values({
          contractVersion: input.event.contractVersion,
          createdAt: input.eventCreatedAt,
          id: input.event.id,
          idempotencyKey: input.event.idempotencyKey,
          message: input.event.message,
          metadata: input.event.metadata,
          receivedAt: input.receivedAt,
          runId: input.event.runId,
          runnerId: input.event.runnerId,
          severity: input.event.severity,
          state: input.event.state,
          workspaceId: input.workspaceId,
        })
        .onConflictDoNothing()
        .returning(runEventReturningColumns);

      if (insertedEvent !== undefined) {
        if (
          shouldUpdateRunAggregateForEvent({
            currentLastEventAt: run.lastEventAt,
            eventCreatedAt: input.eventCreatedAt,
          })
        ) {
          const runState = getConservativeRunEventRunState({
            currentState: run.state,
            eventState: input.event.state,
          });

          await tx
            .update(schema.runs)
            .set({
              lastEventAt: input.eventCreatedAt,
              state: runState,
              updatedAt: input.receivedAt,
            })
            .where(
              and(
                eq(schema.runs.id, input.event.runId),
                eq(schema.runs.workspaceId, input.workspaceId),
              ),
            );
        }

        return {
          event: toRunEvent(insertedEvent),
          inserted: true,
          status: "stored",
        };
      }

      const [existingEvent] = await tx
        .select(runEventReturningColumns)
        .from(schema.runEvents)
        .where(
          and(
            eq(schema.runEvents.runId, input.event.runId),
            eq(schema.runEvents.workspaceId, input.workspaceId),
            eq(schema.runEvents.idempotencyKey, input.event.idempotencyKey),
          ),
        )
        .limit(1);

      if (existingEvent === undefined) {
        return { status: "event_id_conflict" };
      }

      return {
        event: toRunEvent(existingEvent),
        inserted: false,
        status: "stored",
      };
    }),
});

export const createDrizzleRunEventStore = createDrizzleRunEventSubmissionStore;
export const createDrizzleSubmitRunEventStore = createDrizzleRunEventSubmissionStore;

export const createRunEventSubmissionService = (input: {
  now?: () => Date;
  store: RunEventSubmissionStore;
}): RunEventSubmissionService => {
  const now = input.now ?? (() => new Date());

  return {
    submitRunEvent: async ({ context, request }) => {
      const parsedRequest = SubmitRunEventRequestSchema.safeParse(request);

      if (!parsedRequest.success) {
        throw createRunEventSubmissionError();
      }

      if (
        parsedRequest.data.runnerId !== undefined &&
        parsedRequest.data.runnerId !== context.runnerId
      ) {
        throw createRunEventSubmissionError();
      }

      assertCanonicalRunEventIdempotencyKey({
        idempotencyKey: parsedRequest.data.idempotencyKey,
        runId: parsedRequest.data.runId,
      });

      assertSafeRunEventValues({
        eventId: parsedRequest.data.eventId,
        message: parsedRequest.data.message,
        metadata: parsedRequest.data.metadata,
      });

      const eventCreatedAt = parseEventCreatedAt(parsedRequest.data.createdAt);
      const event = RunEventSchema.parse({
        contractVersion: parsedRequest.data.contractVersion,
        id: parsedRequest.data.eventId,
        idempotencyKey: parsedRequest.data.idempotencyKey,
        runId: parsedRequest.data.runId,
        runnerId: context.runnerId,
        state: parsedRequest.data.state,
        severity: parsedRequest.data.severity,
        message: parsedRequest.data.message,
        metadata: parsedRequest.data.metadata,
        createdAt: eventCreatedAt.toISOString(),
      });
      const result = await input.store.persistRunEvent({
        event,
        eventCreatedAt,
        receivedAt: now(),
        runnerId: context.runnerId,
        workspaceId: context.workspaceId,
      });

      if (result.status !== "stored") {
        throw createRunEventSubmissionError();
      }

      return RunEventSchema.parse(result.event);
    },
  };
};

export const createSubmitRunEventService = createRunEventSubmissionService;
