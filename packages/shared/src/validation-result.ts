import { z } from "zod";

import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

export const VALIDATION_RESULT_STATUSES = ["passed", "failed", "skipped", "cancelled"] as const;

export const ValidationResultStatusSchema = z.enum(VALIDATION_RESULT_STATUSES);
export type ValidationResultStatus = z.infer<typeof ValidationResultStatusSchema>;

export const ValidationResultSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    id: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    commandId: NonEmptyStringSchema,
    commandLabel: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
    status: ValidationResultStatusSchema,
    exitCode: z.number().int().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative(),
    stdoutSummary: z.string(),
    stderrSummary: z.string(),
    redactionApplied: z.boolean(),
    startedAt: NonEmptyStringSchema,
    finishedAt: NonEmptyStringSchema,
  })
  .strict();

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
