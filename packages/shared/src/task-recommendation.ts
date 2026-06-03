import { z } from "zod";

import {
  CortexTaskExecutionModeSchema,
  CortexTaskRiskLevelSchema,
  CortexTaskSuggestedValidationSchema,
} from "./cortex-task.js";
import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

const UNSAFE_TASK_RECOMMENDATION_PAYLOAD_KEYS = new Set([
  "command",
  "diff",
  "patch",
  "rawdiff",
  "patchtext",
  "source",
  "rawsource",
  "sourcecode",
  "snippet",
  "codesnippet",
  "code",
  "content",
  "filecontent",
  "filecontents",
  "localpath",
  "path",
  "paths",
  "filepath",
  "filepaths",
  "secret",
  "token",
  "password",
  "privatekey",
  "rawlog",
  "rawlogs",
  "stdout",
  "stdoutsummary",
  "stderr",
  "stderrsummary",
  "rawoutput",
  "rawcommandoutput",
]);

const normalizePayloadKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const addUnsafePayloadKeyIssues = (
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
      addUnsafePayloadKeyIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];

    if (UNSAFE_TASK_RECOMMENDATION_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Task recommendation cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

export const TASK_RECOMMENDATION_STATUSES = [
  "open",
  "approved",
  "ignored",
  "deferred",
  "converted",
] as const;

export const TaskRecommendationStatusSchema = z.enum(TASK_RECOMMENDATION_STATUSES);
export type TaskRecommendationStatus = z.infer<typeof TaskRecommendationStatusSchema>;

export const TASK_RECOMMENDATION_EFFORTS = ["small", "medium", "large"] as const;

export const TaskRecommendationEffortSchema = z.enum(TASK_RECOMMENDATION_EFFORTS);
export type TaskRecommendationEffort = z.infer<typeof TaskRecommendationEffortSchema>;

export const TaskRecommendationMetadataSchema = z
  .record(z.string(), z.json())
  .superRefine((metadata, context) => {
    addUnsafePayloadKeyIssues(metadata, context);
    addUnsafePayloadValueIssues(
      metadata,
      context,
      "Task recommendation metadata cannot include unsafe text values.",
    );
  });

export type TaskRecommendationMetadata = z.infer<typeof TaskRecommendationMetadataSchema>;

const TaskRecommendationShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    taskRecommendationId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    scanId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    findingIds: z.array(NonEmptyStringSchema).min(1),
    acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
    riskLevel: CortexTaskRiskLevelSchema,
    effort: TaskRecommendationEffortSchema,
    executionMode: CortexTaskExecutionModeSchema,
    suggestedValidation: z.array(CortexTaskSuggestedValidationSchema),
    status: TaskRecommendationStatusSchema,
    cortexTaskId: NonEmptyStringSchema.optional(),
    metadata: TaskRecommendationMetadataSchema,
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((recommendation, context) => {
    if (recommendation.status === "converted" && !recommendation.cortexTaskId) {
      context.addIssue({
        code: "custom",
        message: "Converted task recommendations require cortexTaskId.",
        path: ["cortexTaskId"],
      });
    }

    if (recommendation.status !== "converted" && recommendation.cortexTaskId) {
      context.addIssue({
        code: "custom",
        message: "Only converted task recommendations can include cortexTaskId.",
        path: ["cortexTaskId"],
      });
    }
  });

export const TaskRecommendationSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(
      payload,
      context,
      "Task recommendation cannot include unsafe text values.",
    );
  })
  .pipe(TaskRecommendationShapeSchema);

export type TaskRecommendation = z.infer<typeof TaskRecommendationSchema>;
