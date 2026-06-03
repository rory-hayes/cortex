import { z } from "zod";

import { RepoExecutionReadinessSchema, RepoReadinessScoreSchema } from "./repo-readiness-report.js";
import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const NonNegativeIntegerSchema = z.number().int().min(0);

const UNSAFE_WEEKLY_REVIEW_PAYLOAD_KEYS = new Set([
  "command",
  "content",
  "contents",
  "code",
  "codesnippet",
  "diff",
  "filecontent",
  "filecontents",
  "localpath",
  "patch",
  "patchtext",
  "path",
  "paths",
  "privatekey",
  "rawcommandoutput",
  "rawdiff",
  "rawlog",
  "rawlogs",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "secret",
  "snippet",
  "snippets",
  "source",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stderrsummary",
  "stdout",
  "stdoutsummary",
  "token",
]);

const normalizePayloadKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");

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

    if (UNSAFE_WEEKLY_REVIEW_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Weekly engineering review cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

export const WEEKLY_ENGINEERING_REVIEW_LINK_TARGETS = [
  "findings",
  "pull_requests",
  "readiness_report",
  "repository",
  "runs",
  "task_recommendations",
  "tasks",
] as const;

export const WeeklyEngineeringReviewLinkTargetSchema = z.enum(
  WEEKLY_ENGINEERING_REVIEW_LINK_TARGETS,
);
export type WeeklyEngineeringReviewLinkTarget = z.infer<
  typeof WeeklyEngineeringReviewLinkTargetSchema
>;

export const WEEKLY_ENGINEERING_REVIEW_DELIVERY_STATUSES = ["deferred"] as const;

export const WeeklyEngineeringReviewDeliveryStatusSchema = z.enum(
  WEEKLY_ENGINEERING_REVIEW_DELIVERY_STATUSES,
);
export type WeeklyEngineeringReviewDeliveryStatus = z.infer<
  typeof WeeklyEngineeringReviewDeliveryStatusSchema
>;

export const WeeklyEngineeringReviewLinkSchema = z
  .object({
    href: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    targetType: WeeklyEngineeringReviewLinkTargetSchema,
  })
  .strict();
export type WeeklyEngineeringReviewLink = z.infer<typeof WeeklyEngineeringReviewLinkSchema>;

export const WeeklyEngineeringReviewRepositorySummarySchema = z
  .object({
    approvedLocalRunnerTaskCount: NonNegativeIntegerSchema,
    blockedFindingCount: NonNegativeIntegerSchema,
    completedTaskCount: NonNegativeIntegerSchema,
    draftTaskCount: NonNegativeIntegerSchema,
    executionReadiness: RepoExecutionReadinessSchema.nullable(),
    latestReportId: NonEmptyStringSchema.nullable(),
    latestScanId: NonEmptyStringSchema.nullable(),
    openFindingCount: NonNegativeIntegerSchema,
    overallScore: RepoReadinessScoreSchema.nullable(),
    previousOverallScore: RepoReadinessScoreSchema.nullable(),
    prOpenedTaskCount: NonNegativeIntegerSchema,
    readyTaskRecommendationCount: NonNegativeIntegerSchema,
    repoId: NonEmptyStringSchema,
    repositoryLabel: NonEmptyStringSchema,
    resolvedFindingCount: NonNegativeIntegerSchema,
    runningTaskCount: NonNegativeIntegerSchema,
    scoreDelta: z.number().nullable(),
    taskRecommendationCount: NonNegativeIntegerSchema,
  })
  .strict();
export type WeeklyEngineeringReviewRepositorySummary = z.infer<
  typeof WeeklyEngineeringReviewRepositorySummarySchema
>;

export const WeeklyEngineeringReviewTotalsSchema = z
  .object({
    approvedLocalRunnerTaskCount: NonNegativeIntegerSchema,
    averageScore: RepoReadinessScoreSchema.nullable(),
    blockedFindingCount: NonNegativeIntegerSchema,
    completedTaskCount: NonNegativeIntegerSchema,
    openFindingCount: NonNegativeIntegerSchema,
    prOpenedTaskCount: NonNegativeIntegerSchema,
    readyTaskRecommendationCount: NonNegativeIntegerSchema,
    repositoryCount: NonNegativeIntegerSchema,
    repositoryWithReportCount: NonNegativeIntegerSchema,
    resolvedFindingCount: NonNegativeIntegerSchema,
    runningTaskCount: NonNegativeIntegerSchema,
    taskRecommendationCount: NonNegativeIntegerSchema,
  })
  .strict();
export type WeeklyEngineeringReviewTotals = z.infer<typeof WeeklyEngineeringReviewTotalsSchema>;

const WeeklyEngineeringReviewShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    delivery: z
      .object({
        email: WeeklyEngineeringReviewDeliveryStatusSchema,
        slack: WeeklyEngineeringReviewDeliveryStatusSchema,
      })
      .strict(),
    generatedAt: NonEmptyStringSchema,
    highlights: z.array(NonEmptyStringSchema),
    links: z.array(WeeklyEngineeringReviewLinkSchema),
    periodEnd: NonEmptyStringSchema,
    periodStart: NonEmptyStringSchema,
    recommendedNextActions: z.array(NonEmptyStringSchema),
    repositorySummaries: z.array(WeeklyEngineeringReviewRepositorySummarySchema),
    reviewId: NonEmptyStringSchema,
    risks: z.array(NonEmptyStringSchema),
    summary: NonEmptyStringSchema,
    totals: WeeklyEngineeringReviewTotalsSchema,
    workspaceId: NonEmptyStringSchema,
  })
  .strict();

export const WeeklyEngineeringReviewSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(
      payload,
      context,
      "Weekly engineering review cannot include unsafe text values.",
    );
  })
  .pipe(WeeklyEngineeringReviewShapeSchema);

export type WeeklyEngineeringReview = z.infer<typeof WeeklyEngineeringReviewSchema>;
