import Link from "next/link";
import { ArrowRight, CheckCircle2, FileWarning, Gauge, ShieldCheck } from "lucide-react";

import {
  FINDING_CATEGORIES,
  type FindingCategory,
  type RepoExecutionReadiness,
  type RepoReadinessReport as RepoReadinessReportData,
} from "@control-plane/shared";

import { safeDisplayText } from "@/components/display-safety";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ReadinessReportRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
};

type ReadinessReportProps = {
  report: RepoReadinessReportData;
  repository?: ReadinessReportRepository | undefined;
};

const categoryLabels: Record<FindingCategory, string> = {
  agent_readiness: "Agent readiness",
  architecture: "Architecture",
  backlog_quality: "Backlog quality",
  ci_cd: "CI/CD",
  execution_risk: "Execution risk",
  integration: "Integration",
  product_clarity: "Product clarity",
  repo_hygiene: "Repo hygiene",
  security: "Security",
  validation: "Validation",
};

const readinessLabels: Record<RepoExecutionReadiness, string> = {
  blocked: "Blocked",
  local_runner_ready: "Local runner ready",
  not_ready: "Not ready",
  planning_ready: "Planning ready",
  setup_pr_ready: "Setup PR ready",
  setup_required: "Setup required",
};

const readinessBadgeVariant = (readiness: RepoExecutionReadiness) =>
  readiness === "blocked" || readiness === "not_ready" ? "destructive" : "secondary";

const scoreTone = (score: number): string => {
  if (score >= 80) {
    return "text-emerald-600";
  }

  if (score >= 60) {
    return "text-amber-600";
  }

  return "text-destructive";
};

const formatTimestamp = (value: string): string => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const scanLink = (scanId: string, suffix = "") =>
  `/dashboard/findings?scan=${encodeURIComponent(scanId)}${suffix}`;

const recommendationLink = (scanId: string, recommendationId?: string) => {
  const params = new URLSearchParams({
    scan: scanId,
  });

  if (recommendationId !== undefined) {
    params.set("recommendation", recommendationId);
  }

  return `/dashboard/task-recommendations?${params.toString()}`;
};

const displayList = (values: readonly string[], fallback: string) =>
  values.length > 0 ? values : [fallback];

const repositoryLabel = (
  report: RepoReadinessReportData,
  repository: ReadinessReportRepository | undefined,
) => safeDisplayText(repository?.repositoryFullName ?? report.repoId);

export function ReadinessReport({ report, repository }: ReadinessReportProps) {
  const safeScanId = safeDisplayText(report.scanId);
  const safeReportId = safeDisplayText(report.reportId);

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="readiness-report"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-muted-foreground">Readiness report</p>
            <h2 id="readiness-report" className="mt-1 text-xl font-semibold tracking-normal">
              {repositoryLabel(report, repository)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {safeDisplayText(report.summary)}
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Improve this score by resolving open findings, approving setup recommendations, and
              re-scanning after the repository metadata changes.
            </p>
          </div>
          <div className="flex min-w-44 flex-col gap-2 rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Gauge aria-hidden="true" className="size-4" />
              Overall score
            </div>
            <p
              className={`text-3xl font-semibold tracking-normal ${scoreTone(report.overallScore)}`}
            >
              {report.overallScore} / 100
            </p>
            <Badge variant={readinessBadgeVariant(report.executionReadiness)}>
              {readinessLabels[report.executionReadiness]}
            </Badge>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Badge variant="outline">{safeReportId}</Badge>
          <Badge variant="outline">{safeScanId}</Badge>
          <Badge variant="secondary">{pluralize(report.findingIds.length, "finding")}</Badge>
          <Badge variant="outline">
            {pluralize(report.taskRecommendationIds.length, "task recommendation")}
          </Badge>
          <Badge variant="outline">Generated {formatTimestamp(report.generatedAt)}</Badge>
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="category-scores"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Category scores</p>
          <h2 id="category-scores" className="text-base font-semibold">
            Readiness by category
          </h2>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {FINDING_CATEGORIES.map((category) => {
            const score = report.categoryScores[category];

            return (
              <div
                className="flex min-h-24 flex-col justify-between rounded-md border border-border bg-background p-3"
                key={category}
              >
                <span className="text-sm font-medium">{categoryLabels[category]}</span>
                <span className={`mt-4 text-2xl font-semibold tracking-normal ${scoreTone(score)}`}>
                  {score}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="strengths"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
            <h2 id="strengths" className="text-base font-semibold">
              Strengths
            </h2>
          </div>
          <ul className="mt-4 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            {displayList(report.strengths, "No strengths recorded yet.").map((strength) => (
              <li key={strength}>{safeDisplayText(strength)}</li>
            ))}
          </ul>
        </section>

        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="weaknesses"
        >
          <div className="flex items-center gap-2">
            <FileWarning aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="weaknesses" className="text-base font-semibold">
              Weaknesses
            </h2>
          </div>
          <ul className="mt-4 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            {displayList(report.weaknesses, "No weaknesses recorded.").map((weakness) => (
              <li key={weakness}>{safeDisplayText(weakness)}</li>
            ))}
          </ul>
        </section>
      </div>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="top-blockers"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
          <h2 id="top-blockers" className="text-base font-semibold">
            Top blockers
          </h2>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
          {displayList(report.blockedReasons, "No hard blockers recorded.").map((blocker) => (
            <li key={blocker}>{safeDisplayText(blocker)}</li>
          ))}
        </ul>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="next-actions"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Recommended next actions</p>
          <h2 id="next-actions" className="text-base font-semibold">
            Move the repo toward safe AI execution
          </h2>
        </div>
        <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-sm leading-6 text-muted-foreground">
          {displayList(
            report.recommendedNextActions,
            "Review findings before enabling execution.",
          ).map((action) => (
            <li key={action}>{safeDisplayText(action)}</li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={scanLink(report.scanId)}>
              <ArrowRight aria-hidden="true" className="size-4" />
              View findings
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={scanLink(report.scanId, "&status=open")}>Open findings</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={recommendationLink(report.scanId)}>Task recommendations</Link>
          </Button>
        </div>
        {report.taskRecommendationIds.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Task recommendation links">
            {report.taskRecommendationIds.map((recommendationId) => (
              <Badge asChild key={recommendationId} variant="outline">
                <Link href={recommendationLink(report.scanId, recommendationId)}>
                  {safeDisplayText(recommendationId)}
                </Link>
              </Badge>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
