import { z } from "zod";

import { FINDING_CATEGORIES, FindingCategorySchema, type FindingCategory } from "./finding.js";
import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

const UNSAFE_REPO_READINESS_REPORT_KEYS = new Set([
  "diff",
  "patch",
  "source",
  "sourcecode",
  "snippet",
  "code",
  "content",
  "filecontent",
  "secret",
  "token",
  "password",
  "privatekey",
  "rawlog",
  "stdout",
  "stderr",
  "rawoutput",
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

    if (UNSAFE_REPO_READINESS_REPORT_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Repo readiness report cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

const createCategoryScoreShape = (): Record<FindingCategory, typeof RepoReadinessScoreSchema> =>
  Object.fromEntries(
    FINDING_CATEGORIES.map((category) => [
      FindingCategorySchema.parse(category),
      RepoReadinessScoreSchema,
    ]),
  ) as Record<FindingCategory, typeof RepoReadinessScoreSchema>;

export const RepoReadinessScoreSchema = z.number().min(0).max(100);

export const RepoReadinessCategoryScoresSchema = z.object(createCategoryScoreShape()).strict();
export type RepoReadinessCategoryScores = z.infer<typeof RepoReadinessCategoryScoresSchema>;

export const REPO_EXECUTION_READINESS_STATUSES = [
  "not_ready",
  "setup_required",
  "planning_ready",
  "setup_pr_ready",
  "local_runner_ready",
  "blocked",
] as const;

export const RepoExecutionReadinessSchema = z.enum(REPO_EXECUTION_READINESS_STATUSES);
export type RepoExecutionReadiness = z.infer<typeof RepoExecutionReadinessSchema>;

const RepoReadinessReportShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    reportId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    scanId: NonEmptyStringSchema,
    overallScore: RepoReadinessScoreSchema,
    categoryScores: RepoReadinessCategoryScoresSchema,
    summary: NonEmptyStringSchema,
    strengths: z.array(NonEmptyStringSchema),
    weaknesses: z.array(NonEmptyStringSchema),
    blockedReasons: z.array(NonEmptyStringSchema),
    recommendedNextActions: z.array(NonEmptyStringSchema),
    findingIds: z.array(NonEmptyStringSchema),
    taskRecommendationIds: z.array(NonEmptyStringSchema),
    executionReadiness: RepoExecutionReadinessSchema,
    generatedAt: NonEmptyStringSchema,
  })
  .strict();

export const RepoReadinessReportSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(
      payload,
      context,
      "Repo readiness report cannot include unsafe text values.",
    );
  })
  .pipe(RepoReadinessReportShapeSchema);

export type RepoReadinessReport = z.infer<typeof RepoReadinessReportSchema>;
