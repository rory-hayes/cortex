import {
  CONTRACT_VERSION,
  RunEventSchema,
  createRunEventIdempotencyKey,
  type RunEvent,
  type RunEventSeverity,
  type RunState,
} from "@control-plane/shared";

import { redactRunEvent } from "./redact-event.js";

export type BuildRunEventInput = {
  runId: string;
  runnerId?: string;
  state: RunState;
  stableStepName: string;
  severity: RunEventSeverity;
  message: string;
  metadata?: Record<string, unknown>;
  now: () => string;
  attempt?: number;
};

export const buildRunEvent = ({
  runId,
  runnerId,
  state,
  stableStepName,
  severity,
  message,
  metadata = {},
  now,
  attempt = 1,
}: BuildRunEventInput): RunEvent => {
  const event = {
    contractVersion: CONTRACT_VERSION,
    id: `${runId}:${stableStepName}:${attempt}`,
    idempotencyKey: createRunEventIdempotencyKey({
      runId,
      stableStepName,
      attempt,
    }),
    runId,
    state,
    severity,
    message,
    metadata,
    createdAt: now(),
    ...(runnerId === undefined ? {} : { runnerId }),
  };

  return RunEventSchema.parse(redactRunEvent(event));
};
