import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  WeeklyEngineeringReviewSchema,
  type WeeklyEngineeringReview,
  type WeeklyEngineeringReviewLink,
  type WeeklyEngineeringReviewRepositorySummary,
  type WeeklyEngineeringReviewTotals,
} from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  schema,
  type CortexTaskRecord,
  type Database,
  type FindingRecord,
  type GitHubRepository,
  type RepoReadinessReportRecord,
  type TaskRecommendationRecord,
} from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import {
  assertSafeWebBoundPayload,
  hasUnsafePayloadText,
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";

export type GenerateWeeklyEngineeringReviewInput = {
  periodEnd?: Date;
  periodStart?: Date;
  workspaceId: string;
};

export type WeeklyReviewRepositoryRow = Pick<
  GitHubRepository,
  "id" | "repositoryFullName" | "repositoryName" | "repositoryOwner" | "workspaceId"
>;
export type WeeklyReviewReportRow = Pick<
  RepoReadinessReportRecord,
  "executionReadiness" | "generatedAt" | "id" | "overallScore" | "repoId" | "scanId" | "workspaceId"
>;
export type WeeklyReviewFindingRow = Pick<
  FindingRecord,
  "id" | "repoId" | "severity" | "status" | "updatedAt" | "workspaceId"
>;
export type WeeklyReviewTaskRecommendationRow = Pick<
  TaskRecommendationRecord,
  "id" | "repoId" | "status" | "updatedAt" | "workspaceId"
>;
export type WeeklyReviewCortexTaskRow = Pick<
  CortexTaskRecord,
  | "approvalStatus"
  | "executionMode"
  | "id"
  | "latestRunId"
  | "prArtifactIds"
  | "repoId"
  | "status"
  | "updatedAt"
  | "workspaceId"
>;

export type WeeklyEngineeringReviewStore = WorkspaceMembershipStore & {
  listWeeklyReviewCortexTasks: (input: {
    workspaceId: string;
  }) => Promise<WeeklyReviewCortexTaskRow[]>;
  listWeeklyReviewFindings: (input: { workspaceId: string }) => Promise<WeeklyReviewFindingRow[]>;
  listWeeklyReviewRepositories: (input: {
    workspaceId: string;
  }) => Promise<WeeklyReviewRepositoryRow[]>;
  listWeeklyReviewReports: (input: { workspaceId: string }) => Promise<WeeklyReviewReportRow[]>;
  listWeeklyReviewTaskRecommendations: (input: {
    workspaceId: string;
  }) => Promise<WeeklyReviewTaskRecommendationRow[]>;
};

export type WeeklyEngineeringReviewService = {
  generateWeeklyEngineeringReview: (
    input: GenerateWeeklyEngineeringReviewInput,
  ) => Promise<WeeklyEngineeringReview>;
};

const weeklyReviewIntervalMs = 7 * 24 * 60 * 60 * 1000;
const textMaxLength = 240;
const idPattern = /^[A-Za-z0-9._:-]+$/u;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const assertSafePayload = (value: unknown): void => {
  try {
    assertSafeWebBoundPayload(value);
  } catch {
    throw createActionError("validation_error");
  }
};

const normalizeId = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > textMaxLength ||
    hasControlCharacter(normalizedValue) ||
    !idPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  assertSafePayload(normalizedValue);

  return normalizedValue;
};

const toIsoString = (value: Date): string => value.toISOString();

const parsePeriod = (input: GenerateWeeklyEngineeringReviewInput, now: Date) => {
  const periodEnd = input.periodEnd ?? now;
  const periodStart = input.periodStart ?? new Date(periodEnd.getTime() - weeklyReviewIntervalMs);

  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodStart.getTime() >= periodEnd.getTime()
  ) {
    throw createActionError("validation_error");
  }

  return { periodEnd, periodStart };
};

const uniquePreservingOrder = <T>(values: readonly T[]): T[] => {
  const seen = new Set<T>();
  const result: T[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural;

const safeRepositoryLabel = (repository: WeeklyReviewRepositoryRow): string => {
  const normalizedFullName = repository.repositoryFullName.trim();

  if (
    normalizedFullName.length > 0 &&
    normalizedFullName.length <= 220 &&
    !hasControlCharacter(normalizedFullName) &&
    !hasUnsafePayloadText(normalizedFullName)
  ) {
    return normalizedFullName;
  }

  return normalizeId(repository.id);
};

const byRepoId = <T extends { repoId: string }>(rows: readonly T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();

  for (const row of rows) {
    const values = map.get(row.repoId) ?? [];
    values.push(row);
    map.set(row.repoId, values);
  }

  return map;
};

const latestReportsForRepo = (
  repoId: string,
  reportsByRepo: Map<string, WeeklyReviewReportRow[]>,
): {
  latestReport: WeeklyReviewReportRow | null;
  previousReport: WeeklyReviewReportRow | null;
} => {
  const reports = [...(reportsByRepo.get(repoId) ?? [])].sort(
    (left, right) => right.generatedAt.getTime() - left.generatedAt.getTime(),
  );

  return {
    latestReport: reports[0] ?? null,
    previousReport: reports[1] ?? null,
  };
};

const createRepositorySummary = (input: {
  findings: readonly WeeklyReviewFindingRow[];
  recommendations: readonly WeeklyReviewTaskRecommendationRow[];
  repository: WeeklyReviewRepositoryRow;
  reportsByRepo: Map<string, WeeklyReviewReportRow[]>;
  tasks: readonly WeeklyReviewCortexTaskRow[];
}): WeeklyEngineeringReviewRepositorySummary => {
  const repoId = normalizeId(input.repository.id);
  const { latestReport, previousReport } = latestReportsForRepo(repoId, input.reportsByRepo);
  const openFindings = input.findings.filter((finding) => finding.status === "open");
  const resolvedFindings = input.findings.filter((finding) => finding.status === "resolved");
  const taskRecommendations = input.recommendations;
  const readyTaskRecommendations = taskRecommendations.filter(
    (recommendation) => recommendation.status === "open",
  );
  const latestOverallScore = latestReport?.overallScore ?? null;
  const previousOverallScore = previousReport?.overallScore ?? null;
  const summary: WeeklyEngineeringReviewRepositorySummary = {
    approvedLocalRunnerTaskCount: input.tasks.filter(
      (task) => task.approvalStatus === "approved" && task.executionMode === "local_runner",
    ).length,
    blockedFindingCount: openFindings.filter((finding) => finding.severity === "blocked").length,
    completedTaskCount: input.tasks.filter((task) => task.status === "completed").length,
    draftTaskCount: input.tasks.filter(
      (task) => task.status === "draft" && task.approvalStatus !== "approved",
    ).length,
    executionReadiness: latestReport?.executionReadiness ?? null,
    latestReportId: latestReport?.id ?? null,
    latestScanId: latestReport?.scanId ?? null,
    openFindingCount: openFindings.length,
    overallScore: latestOverallScore,
    previousOverallScore,
    prOpenedTaskCount: input.tasks.filter((task) => task.status === "pr_opened").length,
    readyTaskRecommendationCount: readyTaskRecommendations.length,
    repoId,
    repositoryLabel: safeRepositoryLabel(input.repository),
    resolvedFindingCount: resolvedFindings.length,
    runningTaskCount: input.tasks.filter((task) => task.status === "running").length,
    scoreDelta:
      latestOverallScore === null || previousOverallScore === null
        ? null
        : Math.round(latestOverallScore - previousOverallScore),
    taskRecommendationCount: taskRecommendations.length,
  };

  assertSafePayload(summary);

  return summary;
};

const emptyTotals = (repositoryCount: number): WeeklyEngineeringReviewTotals => ({
  approvedLocalRunnerTaskCount: 0,
  averageScore: null,
  blockedFindingCount: 0,
  completedTaskCount: 0,
  openFindingCount: 0,
  prOpenedTaskCount: 0,
  readyTaskRecommendationCount: 0,
  repositoryCount,
  repositoryWithReportCount: 0,
  resolvedFindingCount: 0,
  runningTaskCount: 0,
  taskRecommendationCount: 0,
});

const calculateTotals = (
  summaries: readonly WeeklyEngineeringReviewRepositorySummary[],
): WeeklyEngineeringReviewTotals => {
  const totals = summaries.reduce<WeeklyEngineeringReviewTotals>(
    (accumulator, summary) => ({
      approvedLocalRunnerTaskCount:
        accumulator.approvedLocalRunnerTaskCount + summary.approvedLocalRunnerTaskCount,
      averageScore: null,
      blockedFindingCount: accumulator.blockedFindingCount + summary.blockedFindingCount,
      completedTaskCount: accumulator.completedTaskCount + summary.completedTaskCount,
      openFindingCount: accumulator.openFindingCount + summary.openFindingCount,
      prOpenedTaskCount: accumulator.prOpenedTaskCount + summary.prOpenedTaskCount,
      readyTaskRecommendationCount:
        accumulator.readyTaskRecommendationCount + summary.readyTaskRecommendationCount,
      repositoryCount: accumulator.repositoryCount,
      repositoryWithReportCount:
        accumulator.repositoryWithReportCount + (summary.overallScore === null ? 0 : 1),
      resolvedFindingCount: accumulator.resolvedFindingCount + summary.resolvedFindingCount,
      runningTaskCount: accumulator.runningTaskCount + summary.runningTaskCount,
      taskRecommendationCount:
        accumulator.taskRecommendationCount + summary.taskRecommendationCount,
    }),
    emptyTotals(summaries.length),
  );
  const scoredSummaries = summaries.filter((summary) => summary.overallScore !== null);

  return {
    ...totals,
    averageScore:
      scoredSummaries.length === 0
        ? null
        : Math.round(
            scoredSummaries.reduce((total, summary) => total + (summary.overallScore ?? 0), 0) /
              scoredSummaries.length,
          ),
  };
};

const buildSummaryText = (totals: WeeklyEngineeringReviewTotals): string =>
  [
    `Weekly engineering review covered ${totals.repositoryCount} ${pluralize(
      totals.repositoryCount,
      "repository",
      "repositories",
    )}`,
    `with ${totals.repositoryWithReportCount} current readiness ${pluralize(
      totals.repositoryWithReportCount,
      "report",
    )},`,
    `${totals.openFindingCount} open ${pluralize(totals.openFindingCount, "finding")},`,
    `and ${totals.taskRecommendationCount} task ${pluralize(
      totals.taskRecommendationCount,
      "recommendation",
    )}.`,
  ].join(" ");

const buildHighlights = (
  summaries: readonly WeeklyEngineeringReviewRepositorySummary[],
  totals: WeeklyEngineeringReviewTotals,
): string[] => {
  const improvedRepositoryCount = summaries.filter(
    (summary) => summary.scoreDelta !== null && summary.scoreDelta > 0,
  ).length;
  const highlights: string[] = [];

  if (improvedRepositoryCount > 0) {
    highlights.push(
      `${improvedRepositoryCount} ${pluralize(
        improvedRepositoryCount,
        "repository",
        "repositories",
      )} improved its readiness score this week.`,
    );
  }

  if (totals.completedTaskCount > 0) {
    highlights.push(
      `${totals.completedTaskCount} Cortex ${pluralize(
        totals.completedTaskCount,
        "task",
      )} reached completed status.`,
    );
  }

  if (highlights.length === 0) {
    highlights.push("Weekly repo readiness metadata is available for human review.");
  }

  return highlights;
};

const buildRisks = (totals: WeeklyEngineeringReviewTotals): string[] => {
  const risks: string[] = [];

  if (totals.blockedFindingCount > 0) {
    risks.push(
      `${totals.blockedFindingCount} blocked readiness ${pluralize(
        totals.blockedFindingCount,
        "finding",
      )} ${totals.blockedFindingCount === 1 ? "needs" : "need"} review before execution.`,
    );
  }

  if (totals.runningTaskCount > 0) {
    risks.push(
      `${totals.runningTaskCount} local-runner ${pluralize(
        totals.runningTaskCount,
        "task",
      )} still ${totals.runningTaskCount === 1 ? "is" : "are"} running.`,
    );
  }

  if (risks.length === 0) {
    risks.push("No blocked readiness findings were recorded in the weekly metadata.");
  }

  return risks;
};

const buildRecommendedActions = (totals: WeeklyEngineeringReviewTotals): string[] => {
  const actions: string[] = [];

  if (totals.readyTaskRecommendationCount > 0) {
    actions.push(
      `Approve ${totals.readyTaskRecommendationCount} ready task ${pluralize(
        totals.readyTaskRecommendationCount,
        "recommendation",
      )} or convert them into Cortex Tasks.`,
    );
  }

  if (totals.openFindingCount > 0) {
    actions.push(
      `Review ${totals.openFindingCount} open readiness ${pluralize(
        totals.openFindingCount,
        "finding",
      )} before approving local runner execution.`,
    );
  }

  if (actions.length === 0) {
    actions.push("Keep weekly recurring scans enabled and review the next generated summary.");
  }

  return actions;
};

const dashboardLink = (
  href: string,
  label: string,
  targetType: WeeklyEngineeringReviewLink["targetType"],
): WeeklyEngineeringReviewLink => ({ href, label, targetType });

const buildLinks = (
  summaries: readonly WeeklyEngineeringReviewRepositorySummary[],
  totals: WeeklyEngineeringReviewTotals,
): WeeklyEngineeringReviewLink[] => {
  const links = [
    dashboardLink("/dashboard/weekly-review", "Weekly review", "repository"),
    ...summaries.flatMap((summary) =>
      summary.latestReportId === null
        ? []
        : [
            dashboardLink(
              `/dashboard/reports/${encodeURIComponent(summary.latestReportId)}`,
              `${summary.repositoryLabel} readiness report`,
              "readiness_report",
            ),
          ],
    ),
    ...(totals.openFindingCount > 0
      ? [dashboardLink("/dashboard/findings?status=open", "Open findings", "findings")]
      : []),
    ...(totals.readyTaskRecommendationCount > 0
      ? [
          dashboardLink(
            "/dashboard/task-recommendations?status=open",
            "Ready task recommendations",
            "task_recommendations",
          ),
        ]
      : []),
    ...(totals.taskRecommendationCount > 0 || totals.approvedLocalRunnerTaskCount > 0
      ? [dashboardLink("/dashboard/tasks", "Cortex Tasks", "tasks")]
      : []),
    ...(totals.prOpenedTaskCount > 0
      ? [dashboardLink("/dashboard/pull-requests", "Open pull requests", "pull_requests")]
      : []),
    ...(totals.runningTaskCount > 0
      ? [dashboardLink("/dashboard/runs", "Active runs", "runs")]
      : []),
  ];

  return uniquePreservingOrder(links.map((link) => `${link.targetType}:${link.href}`)).map(
    (signature) => links.find((link) => `${link.targetType}:${link.href}` === signature)!,
  );
};

const validateReview = (value: unknown): WeeklyEngineeringReview => {
  if (hasUnsafeWebBoundPayload(value)) {
    throw createActionError("validation_error");
  }

  try {
    const review = WeeklyEngineeringReviewSchema.parse(value);
    assertSafePayload(review);

    return review;
  } catch {
    throw createActionError("validation_error");
  }
};

const toReview = (input: {
  createReviewId: () => string;
  now: Date;
  periodEnd: Date;
  periodStart: Date;
  summaries: WeeklyEngineeringReviewRepositorySummary[];
  workspaceId: string;
}): WeeklyEngineeringReview => {
  const totals = calculateTotals(input.summaries);
  const review = validateReview({
    contractVersion: CONTRACT_VERSION,
    delivery: {
      email: "deferred",
      slack: "deferred",
    },
    generatedAt: toIsoString(input.now),
    highlights: buildHighlights(input.summaries, totals),
    links: buildLinks(input.summaries, totals),
    periodEnd: toIsoString(input.periodEnd),
    periodStart: toIsoString(input.periodStart),
    recommendedNextActions: buildRecommendedActions(totals),
    repositorySummaries: input.summaries,
    reviewId: normalizeId(input.createReviewId()),
    risks: buildRisks(totals),
    summary: buildSummaryText(totals),
    totals,
    workspaceId: normalizeId(input.workspaceId),
  });

  return review;
};

export const createDrizzleWeeklyEngineeringReviewStore = (
  db: Database,
): WeeklyEngineeringReviewStore => ({
  findWorkspaceMembership: async ({ userId, workspaceId }) => {
    const [membership] = await db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);

    return membership ?? null;
  },
  listWeeklyReviewCortexTasks: async ({ workspaceId }) =>
    db
      .select({
        approvalStatus: schema.cortexTasks.approvalStatus,
        executionMode: schema.cortexTasks.executionMode,
        id: schema.cortexTasks.id,
        latestRunId: schema.cortexTasks.latestRunId,
        prArtifactIds: schema.cortexTasks.prArtifactIds,
        repoId: schema.cortexTasks.repoId,
        status: schema.cortexTasks.status,
        updatedAt: schema.cortexTasks.updatedAt,
        workspaceId: schema.cortexTasks.workspaceId,
      })
      .from(schema.cortexTasks)
      .where(eq(schema.cortexTasks.workspaceId, workspaceId))
      .orderBy(desc(schema.cortexTasks.updatedAt)),
  listWeeklyReviewFindings: async ({ workspaceId }) =>
    db
      .select({
        id: schema.findings.id,
        repoId: schema.findings.repoId,
        severity: schema.findings.severity,
        status: schema.findings.status,
        updatedAt: schema.findings.updatedAt,
        workspaceId: schema.findings.workspaceId,
      })
      .from(schema.findings)
      .where(eq(schema.findings.workspaceId, workspaceId))
      .orderBy(desc(schema.findings.updatedAt)),
  listWeeklyReviewRepositories: async ({ workspaceId }) =>
    db
      .select({
        id: schema.githubRepositories.id,
        repositoryFullName: schema.githubRepositories.repositoryFullName,
        repositoryName: schema.githubRepositories.repositoryName,
        repositoryOwner: schema.githubRepositories.repositoryOwner,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .where(
        and(
          eq(schema.githubRepositories.workspaceId, workspaceId),
          eq(schema.githubRepositories.archived, false),
          eq(schema.githubRepositories.disabled, false),
        ),
      )
      .orderBy(desc(schema.githubRepositories.updatedAt)),
  listWeeklyReviewReports: async ({ workspaceId }) =>
    db
      .select({
        executionReadiness: schema.repoReadinessReports.executionReadiness,
        generatedAt: schema.repoReadinessReports.generatedAt,
        id: schema.repoReadinessReports.id,
        overallScore: schema.repoReadinessReports.overallScore,
        repoId: schema.repoReadinessReports.repoId,
        scanId: schema.repoReadinessReports.scanId,
        workspaceId: schema.repoReadinessReports.workspaceId,
      })
      .from(schema.repoReadinessReports)
      .where(eq(schema.repoReadinessReports.workspaceId, workspaceId))
      .orderBy(desc(schema.repoReadinessReports.generatedAt)),
  listWeeklyReviewTaskRecommendations: async ({ workspaceId }) =>
    db
      .select({
        id: schema.taskRecommendations.id,
        repoId: schema.taskRecommendations.repoId,
        status: schema.taskRecommendations.status,
        updatedAt: schema.taskRecommendations.updatedAt,
        workspaceId: schema.taskRecommendations.workspaceId,
      })
      .from(schema.taskRecommendations)
      .where(eq(schema.taskRecommendations.workspaceId, workspaceId))
      .orderBy(desc(schema.taskRecommendations.updatedAt)),
});

export const createWeeklyEngineeringReviewService = (input: {
  createReviewId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: WeeklyEngineeringReviewStore;
}): WeeklyEngineeringReviewService => {
  const createReviewId = input.createReviewId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    generateWeeklyEngineeringReview: async (generateInput) => {
      const workspaceId = normalizeId(generateInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const currentTime = now();
      const period = parsePeriod(generateInput, currentTime);
      const [repositories, reports, findings, recommendations, tasks] = await Promise.all([
        input.store.listWeeklyReviewRepositories({ workspaceId: scope.workspaceId }),
        input.store.listWeeklyReviewReports({ workspaceId: scope.workspaceId }),
        input.store.listWeeklyReviewFindings({ workspaceId: scope.workspaceId }),
        input.store.listWeeklyReviewTaskRecommendations({ workspaceId: scope.workspaceId }),
        input.store.listWeeklyReviewCortexTasks({ workspaceId: scope.workspaceId }),
      ]);
      const findingsByRepo = byRepoId(findings);
      const recommendationsByRepo = byRepoId(recommendations);
      const reportsByRepo = byRepoId(reports);
      const tasksByRepo = byRepoId(tasks);
      const summaries = repositories.map((repository) =>
        createRepositorySummary({
          findings: findingsByRepo.get(repository.id) ?? [],
          recommendations: recommendationsByRepo.get(repository.id) ?? [],
          repository,
          reportsByRepo,
          tasks: tasksByRepo.get(repository.id) ?? [],
        }),
      );

      return toReview({
        createReviewId,
        now: currentTime,
        periodEnd: period.periodEnd,
        periodStart: period.periodStart,
        summaries,
        workspaceId: scope.workspaceId,
      });
    },
  };
};
