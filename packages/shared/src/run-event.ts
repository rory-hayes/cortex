import { z } from "zod";

import { RunStateSchema } from "./run-state.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

const UNSAFE_METADATA_KEYS = new Set(["diff", "patch", "source", "code"]);

const normalizeMetadataKey = (key: string): string => key.trim().toLowerCase();

const addUnsafeMetadataKeyIssues = (
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
) => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addUnsafeMetadataKeyIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (UNSAFE_METADATA_KEYS.has(normalizeMetadataKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Run event metadata cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafeMetadataKeyIssues(childValue, context, childPath, seen);
  }
};

export const RUN_EVENT_SEVERITIES = ["debug", "info", "warning", "error", "blocked"] as const;

export const RunEventSeveritySchema = z.enum(RUN_EVENT_SEVERITIES);
export type RunEventSeverity = z.infer<typeof RunEventSeveritySchema>;

export const RunEventMetadataSchema = z
  .record(z.string(), z.unknown())
  .superRefine((metadata, context) => {
    addUnsafeMetadataKeyIssues(metadata, context);
  });

export const RunEventSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    id: NonEmptyStringSchema,
    idempotencyKey: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    runnerId: NonEmptyStringSchema.optional(),
    state: RunStateSchema,
    severity: RunEventSeveritySchema,
    message: NonEmptyStringSchema,
    metadata: RunEventMetadataSchema,
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export type RunEvent = z.infer<typeof RunEventSchema>;

export const createRunEventIdempotencyKey = ({
  runId,
  stableStepName,
  attempt,
}: {
  runId: string;
  stableStepName: string;
  attempt: number;
}): string => `run:${runId}:event:${stableStepName}:${attempt}`;
