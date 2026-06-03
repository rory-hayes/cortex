import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  FileWarning,
  Gauge,
  ListChecks,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import type { RepoExecutionReadiness, WeeklyEngineeringReview } from "@control-plane/shared";

import { safeDisplayText } from "@/components/display-safety";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type WeeklyEngineeringReviewSummaryProps = {
  review: WeeklyEngineeringReview;
};

const readinessLabels: Record<RepoExecutionReadiness, string> = {
  blocked: "Blocked",
  local_runner_ready: "Local runner ready",
  not_ready: "Not ready",
  planning_ready: "Planning ready",
  setup_pr_ready: "Setup PR ready",
  setup_required: "Setup required",
};

const formatTimestamp = (value: string): string => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const displayList = (values: readonly string[], fallback: string) =>
  values.length > 0 ? values : [fallback];

const formatScore = (score: number | null): string => (score === null ? "No score" : String(score));

const scoreDeltaLabel = (delta: number | null): string => {
  if (delta === null) {
    return "No prior score";
  }

  return delta > 0 ? `+${delta}` : String(delta);
};

const getTrendCounts = (review: WeeklyEngineeringReview) =>
  review.repositorySummaries.reduce(
    (counts, summary) => {
      if (summary.scoreDelta === null) {
        return {
          ...counts,
          withoutPriorScore: counts.withoutPriorScore + 1,
        };
      }

      if (summary.scoreDelta > 0) {
        return {
          ...counts,
          improved: counts.improved + 1,
        };
      }

      if (summary.scoreDelta < 0) {
        return {
          ...counts,
          regressed: counts.regressed + 1,
        };
      }

      return {
        ...counts,
        unchanged: counts.unchanged + 1,
      };
    },
    {
      improved: 0,
      regressed: 0,
      unchanged: 0,
      withoutPriorScore: 0,
    },
  );

const firstLinkForTarget = (
  review: WeeklyEngineeringReview,
  targetType: WeeklyEngineeringReview["links"][number]["targetType"],
): string | null => review.links.find((link) => link.targetType === targetType)?.href ?? null;

export function WeeklyEngineeringReviewSummary({ review }: WeeklyEngineeringReviewSummaryProps) {
  const trendCounts = getTrendCounts(review);
  const taskRecommendationHref =
    firstLinkForTarget(review, "task_recommendations") ??
    (review.totals.readyTaskRecommendationCount > 0
      ? "/dashboard/task-recommendations?status=open"
      : "/dashboard/task-recommendations");
  const taskRecommendationCta =
    review.totals.readyTaskRecommendationCount > 0
      ? "Approve next recommended tasks"
      : "Review task recommendations";

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="weekly-engineering-review"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-muted-foreground">Latest review</p>
            <h2
              id="weekly-engineering-review"
              className="mt-1 text-xl font-semibold tracking-normal"
            >
              Weekly engineering review
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {safeDisplayText(review.summary)}
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Generated from {formatTimestamp(review.periodStart)} through{" "}
              {formatTimestamp(review.periodEnd)}. Email deferred. Slack deferred.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild>
                <Link href={taskRecommendationHref}>
                  <ListChecks aria-hidden="true" className="size-4" />
                  {taskRecommendationCta}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={firstLinkForTarget(review, "findings") ?? "/dashboard/findings"}>
                  <ArrowRight aria-hidden="true" className="size-4" />
                  Review findings
                </Link>
              </Button>
            </div>
          </div>
          <div className="flex min-w-48 flex-col gap-2 rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Gauge aria-hidden="true" className="size-4" />
              Average score
            </div>
            <p className="text-3xl font-semibold tracking-normal">
              {review.totals.averageScore === null
                ? "Unavailable"
                : `${review.totals.averageScore} average score`}
            </p>
            <Badge variant="secondary">
              {pluralize(review.totals.repositoryWithReportCount, "current report")}
            </Badge>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Badge variant="outline">{safeDisplayText(review.reviewId)}</Badge>
          <Badge variant="secondary">
            {pluralize(review.totals.openFindingCount, "open finding")}
          </Badge>
          <Badge variant="outline">
            {pluralize(review.totals.readyTaskRecommendationCount, "ready recommendation")}
          </Badge>
          <Badge variant="outline">
            {pluralize(review.totals.approvedLocalRunnerTaskCount, "approved local task")}
          </Badge>
          <Badge variant="outline">Generated {formatTimestamp(review.generatedAt)}</Badge>
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="weekly-trend"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Trend from previous review</p>
          <h2 id="weekly-trend" className="text-base font-semibold">
            Repository score movement
          </h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp aria-hidden="true" className="size-4 text-primary" />
              Improved
            </div>
            <p className="mt-2 text-xl font-semibold tracking-normal">
              {pluralize(trendCounts.improved, "improved", "improved")}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingDown aria-hidden="true" className="size-4 text-muted-foreground" />
              Regressed
            </div>
            <p className="mt-2 text-xl font-semibold tracking-normal">
              {pluralize(trendCounts.regressed, "regressed", "regressed")}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 aria-hidden="true" className="size-4 text-muted-foreground" />
              Unchanged
            </div>
            <p className="mt-2 text-xl font-semibold tracking-normal">
              {pluralize(trendCounts.unchanged, "unchanged", "unchanged")}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarCheck aria-hidden="true" className="size-4 text-muted-foreground" />
              No prior score
            </div>
            <p className="mt-2 text-xl font-semibold tracking-normal">
              {pluralize(
                trendCounts.withoutPriorScore,
                "without prior score",
                "without prior score",
              )}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="weekly-highlights"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
            <h2 id="weekly-highlights" className="text-base font-semibold">
              Highlights
            </h2>
          </div>
          <ul className="mt-4 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            {displayList(review.highlights, "No highlights recorded yet.").map((highlight) => (
              <li key={highlight}>{safeDisplayText(highlight)}</li>
            ))}
          </ul>
        </section>

        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="weekly-risks"
        >
          <div className="flex items-center gap-2">
            <FileWarning aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="weekly-risks" className="text-base font-semibold">
              Risks
            </h2>
          </div>
          <ul className="mt-4 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            {displayList(review.risks, "No risks recorded.").map((risk) => (
              <li key={risk}>{safeDisplayText(risk)}</li>
            ))}
          </ul>
        </section>
      </div>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="weekly-repositories"
      >
        <div className="flex items-center gap-2">
          <CalendarCheck aria-hidden="true" className="size-5 text-primary" />
          <h2 id="weekly-repositories" className="text-base font-semibold">
            Repository summaries
          </h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="py-3 pr-4 font-medium">Repository</th>
                <th className="py-3 pr-4 font-medium">Score</th>
                <th className="py-3 pr-4 font-medium">Trend</th>
                <th className="py-3 pr-4 font-medium">Readiness</th>
                <th className="py-3 pr-4 font-medium">Findings</th>
                <th className="py-3 pr-4 font-medium">Tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {review.repositorySummaries.map((summary) => (
                <tr key={summary.repoId}>
                  <td className="py-3 pr-4 font-medium">
                    {safeDisplayText(summary.repositoryLabel)}
                  </td>
                  <td className="py-3 pr-4">{formatScore(summary.overallScore)}</td>
                  <td className="py-3 pr-4">{scoreDeltaLabel(summary.scoreDelta)}</td>
                  <td className="py-3 pr-4">
                    {summary.executionReadiness === null
                      ? "Not scanned"
                      : readinessLabels[summary.executionReadiness]}
                  </td>
                  <td className="py-3 pr-4">
                    {summary.openFindingCount} open, {summary.blockedFindingCount} blocked
                  </td>
                  <td className="py-3 pr-4">
                    {summary.readyTaskRecommendationCount} ready, {summary.prOpenedTaskCount} PRs
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="weekly-actions"
      >
        <h2 id="weekly-actions" className="text-base font-semibold">
          Recommended next actions
        </h2>
        <ul className="mt-4 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
          {displayList(review.recommendedNextActions, "No actions recorded.").map((action) => (
            <li key={action}>{safeDisplayText(action)}</li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          {review.links.map((link) => (
            <Button asChild key={`${link.targetType}:${link.href}`} size="sm" variant="outline">
              <Link href={link.href}>
                <ArrowRight aria-hidden="true" className="size-4" />
                {safeDisplayText(link.label)}
              </Link>
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
