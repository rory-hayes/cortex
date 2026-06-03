import "server-only";

import { redactLogText } from "@control-plane/logging";
import {
  CONTRACT_VERSION,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  RunnerCapabilitiesSchema,
  type HeartbeatResponse,
  type RunnerCapabilities,
  type RunnerHeartbeatStatus,
} from "@control-plane/shared";

import { and, eq, isNull, schema, type Database } from "../db";
import {
  toCancellationInstruction,
  type CancellationInstructionRow,
} from "../runs/cancellation-instruction";

export const RUNNER_HEARTBEAT_POLL_INTERVAL_SECONDS = 15;

export class RunnerHeartbeatRequestError extends Error {
  readonly code = "invalid_request" as const;

  constructor() {
    super("The heartbeat request is invalid.");
    this.name = "RunnerHeartbeatRequestError";
  }
}

export type RunnerHeartbeatUpdate = {
  capabilities: RunnerCapabilities;
  lastHeartbeatAt: Date;
  runnerId: string;
  status: RunnerHeartbeatStatus;
  updatedAt: Date;
  workspaceId: string;
};

export type RunnerHeartbeatUpdateResult = {
  runnerId: string;
  workspaceId: string;
};

export type RunnerHeartbeatCancellationLookup = {
  runnerId: string;
  runId: string;
  workspaceId: string;
};

export type RunnerHeartbeatCancellationRow = CancellationInstructionRow;

export type RunnerHeartbeatStore = {
  findCancellationForCurrentRun: (
    input: RunnerHeartbeatCancellationLookup,
  ) => Promise<RunnerHeartbeatCancellationRow | null>;
  updateRunnerHeartbeat: (
    input: RunnerHeartbeatUpdate,
  ) => Promise<RunnerHeartbeatUpdateResult | null>;
};

export type RunnerHeartbeatService = {
  recordHeartbeat: (input: {
    authenticatedRunnerId: string;
    payload: unknown;
    workspaceId: string;
  }) => Promise<HeartbeatResponse>;
};

const unsafeCapabilityTextPatterns = [
  /(?:^|\n)\s*(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*\S+/,
  /\bprocess\.env\.[A-Z0-9_]+\b/i,
  /\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*\b/,
  /\$env:[A-Z_][A-Z0-9_]*\b/i,
  /%[A-Z_][A-Z0-9_]*%/i,
  /\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}/i,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
] as const;

const hasUnsafeCapabilityText = (value: string): boolean => {
  if (unsafeCapabilityTextPatterns.some((pattern) => pattern.test(value))) {
    return true;
  }

  return redactLogText(value).redactionApplied;
};

const assertSafeCapabilityStrings = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): void => {
  if (typeof value === "string") {
    if (hasUnsafeCapabilityText(value)) {
      throw new RunnerHeartbeatRequestError();
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => assertSafeCapabilityStrings(item, seen));

    return;
  }

  Object.values(value).forEach((childValue) => assertSafeCapabilityStrings(childValue, seen));
};

const parseHeartbeatPayload = (payload: unknown) => {
  const parsedPayload = HeartbeatRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    throw new RunnerHeartbeatRequestError();
  }

  return parsedPayload.data;
};

const parseNormalizedCapabilities = (
  capabilities: RunnerCapabilities,
  runnerId: string,
): RunnerCapabilities => {
  if (capabilities.runnerId !== undefined && capabilities.runnerId !== runnerId) {
    throw new RunnerHeartbeatRequestError();
  }

  const parsedCapabilities = RunnerCapabilitiesSchema.safeParse({
    ...capabilities,
    runnerId,
  });

  if (!parsedCapabilities.success) {
    throw new RunnerHeartbeatRequestError();
  }

  assertSafeCapabilityStrings(parsedCapabilities.data);

  return parsedCapabilities.data;
};

export const createDrizzleRunnerHeartbeatStore = (db: Database): RunnerHeartbeatStore => ({
  findCancellationForCurrentRun: async ({ runnerId, runId, workspaceId }) => {
    const run = await db.query.runs.findFirst({
      columns: {
        cancellationReason: true,
        cancellationRequestedAt: true,
        cancellationRequestedByActorId: true,
        id: true,
      },
      where: (fields, { and, eq }) =>
        and(
          eq(fields.workspaceId, workspaceId),
          eq(fields.runnerId, runnerId),
          eq(fields.id, runId),
          eq(fields.state, "cancel_requested"),
        ),
    });

    if (run === undefined) {
      return null;
    }

    return {
      cancellationReason: run.cancellationReason,
      cancellationRequestedAt: run.cancellationRequestedAt,
      cancellationRequestedByActorId: run.cancellationRequestedByActorId,
      runId: run.id,
    };
  },
  updateRunnerHeartbeat: async ({
    capabilities,
    lastHeartbeatAt,
    runnerId,
    status,
    updatedAt,
    workspaceId,
  }) => {
    const [runner] = await db
      .update(schema.runners)
      .set({
        capabilities,
        lastHeartbeatAt,
        status,
        updatedAt,
      })
      .where(
        and(
          eq(schema.runners.id, runnerId),
          eq(schema.runners.workspaceId, workspaceId),
          isNull(schema.runners.revokedAt),
        ),
      )
      .returning({
        runnerId: schema.runners.id,
        workspaceId: schema.runners.workspaceId,
      });

    return runner ?? null;
  },
});

export const createRunnerHeartbeatService = (input: {
  now?: () => Date;
  pollIntervalSeconds?: number;
  store: RunnerHeartbeatStore;
}): RunnerHeartbeatService => {
  const now = input.now ?? (() => new Date());
  const pollIntervalSeconds = input.pollIntervalSeconds ?? RUNNER_HEARTBEAT_POLL_INTERVAL_SECONDS;

  return {
    recordHeartbeat: async ({ authenticatedRunnerId, payload, workspaceId }) => {
      const heartbeat = parseHeartbeatPayload(payload);

      if (heartbeat.runnerId !== authenticatedRunnerId) {
        throw new RunnerHeartbeatRequestError();
      }

      const heartbeatAt = now();
      const capabilities = parseNormalizedCapabilities(
        heartbeat.capabilities,
        authenticatedRunnerId,
      );
      const runner = await input.store.updateRunnerHeartbeat({
        capabilities,
        lastHeartbeatAt: heartbeatAt,
        runnerId: authenticatedRunnerId,
        status: heartbeat.status,
        updatedAt: heartbeatAt,
        workspaceId,
      });

      if (runner === null) {
        throw new RunnerHeartbeatRequestError();
      }

      const cancellation =
        heartbeat.currentRunId === null
          ? undefined
          : toCancellationInstruction(
              await input.store.findCancellationForCurrentRun({
                runnerId: authenticatedRunnerId,
                runId: heartbeat.currentRunId,
                workspaceId,
              }),
            );

      return HeartbeatResponseSchema.parse({
        contractVersion: CONTRACT_VERSION,
        ...(cancellation === undefined ? {} : { cancellation }),
        pollIntervalSeconds,
        serverTime: heartbeatAt.toISOString(),
      });
    },
  };
};
