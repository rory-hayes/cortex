import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  FileWarning,
  ListChecks,
  ScanSearch,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  CORTEX_TASK_RISK_LEVELS,
  TASK_RECOMMENDATION_STATUSES,
  type CortexTaskRiskLevel,
  type TaskRecommendation,
  type TaskRecommendationStatus,
} from "@control-plane/shared";

import {
  approveTaskRecommendationAction,
  approveTaskRecommendationsAction,
  updateTaskRecommendationStatusAction,
} from "@/src/server/actions";
import type { PersistedTaskRecommendation } from "@/src/repo-readiness/task-recommendations";
import { hasUnsafeDisplayText, safeDisplayText } from "@/components/display-safety";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

async function submitApproveTaskRecommendationAction(formData: FormData): Promise<void> {
  "use server";

  await approveTaskRecommendationAction(formData);
}

async function submitApproveTaskRecommendationsAction(formData: FormData): Promise<void> {
  "use server";

  await approveTaskRecommendationsAction(formData);
}

async function submitUpdateTaskRecommendationStatusAction(formData: FormData): Promise<void> {
  "use server";

  await updateTaskRecommendationStatusAction(formData);
}

export type TaskRecommendationListRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
};

export type TaskRecommendationCategory =
  | "agent_readiness"
  | "architecture"
  | "backlog_quality"
  | "ci_cd"
  | "execution_risk"
  | "integration"
  | "product_clarity"
  | "repo_hygiene"
  | "security"
  | "uncategorized"
  | "validation";

export type TaskRecommendationListFilters = {
  category?: TaskRecommendationCategory;
  repoId?: string;
  risk?: CortexTaskRiskLevel;
  scanId?: string;
  status?: TaskRecommendationStatus;
};

type TaskRecommendationListProps = {
  recommendations: PersistedTaskRecommendation[];
  repositories: TaskRecommendationListRepository[];
  selectedFilters?: TaskRecommendationListFilters | undefined;
  workspaceId: string;
};

type RecommendationGroup = {
  category: TaskRecommendationCategory;
  recommendations: PersistedTaskRecommendation[];
  risk: CortexTaskRiskLevel;
};

const categoryLabels: Record<TaskRecommendationCategory, string> = {
  agent_readiness: "Agent readiness",
  architecture: "Architecture",
  backlog_quality: "Backlog quality",
  ci_cd: "CI/CD",
  execution_risk: "Execution risk",
  integration: "Integration",
  product_clarity: "Product clarity",
  repo_hygiene: "Repo hygiene",
  security: "Security",
  uncategorized: "Uncategorized",
  validation: "Validation",
};

const riskLabels: Record<CortexTaskRiskLevel, string> = {
  blocked: "Blocked risk",
  high: "High risk",
  low: "Low risk",
  medium: "Medium risk",
};

const statusLabels: Record<TaskRecommendationStatus, string> = {
  approved: "Approved",
  converted: "Converted",
  deferred: "Deferred",
  ignored: "Dismissed",
  open: "Open",
};

const riskRank: Record<CortexTaskRiskLevel, number> = {
  blocked: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const categoryRank = new Map<TaskRecommendationCategory, number>(
  (Object.keys(categoryLabels) as TaskRecommendationCategory[]).map((category, index) => [
    category,
    index,
  ]),
);

const categoryPrefixMap: ReadonlyArray<{
  category: TaskRecommendationCategory;
  prefix: string;
}> = [
  { category: "agent_readiness", prefix: "agent-" },
  { category: "agent_readiness", prefix: "agent-readiness" },
  { category: "architecture", prefix: "architecture" },
  { category: "backlog_quality", prefix: "backlog" },
  { category: "ci_cd", prefix: "ci-" },
  { category: "ci_cd", prefix: "ci_cd" },
  { category: "execution_risk", prefix: "execution-risk" },
  { category: "integration", prefix: "integration" },
  { category: "product_clarity", prefix: "product-" },
  { category: "repo_hygiene", prefix: "repo-hygiene" },
  { category: "security", prefix: "security" },
  { category: "validation", prefix: "validation" },
];

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const countBy = <TValue extends string>(
  recommendations: PersistedTaskRecommendation[],
  getValue: (recommendation: PersistedTaskRecommendation) => TValue,
): Map<TValue, number> => {
  const counts = new Map<TValue, number>();

  for (const recommendation of recommendations) {
    const value = getValue(recommendation);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
};

const getSearchParams = (filters: TaskRecommendationListFilters): URLSearchParams => {
  const params = new URLSearchParams();

  if (filters.category !== undefined) {
    params.set("category", filters.category);
  }

  if (filters.repoId !== undefined) {
    params.set("repo", filters.repoId);
  }

  if (filters.risk !== undefined) {
    params.set("risk", filters.risk);
  }

  if (filters.scanId !== undefined) {
    params.set("scan", filters.scanId);
  }

  if (filters.status !== undefined) {
    params.set("status", filters.status);
  }

  return params;
};

const withFilter = (
  filters: TaskRecommendationListFilters,
  next: TaskRecommendationListFilters,
): string => {
  const merged = {
    ...filters,
    ...next,
  };
  const params = getSearchParams(merged);
  const query = params.toString();

  return query.length > 0
    ? `/dashboard/task-recommendations?${query}`
    : "/dashboard/task-recommendations";
};

const categoryFromRecommendation = (
  recommendation: PersistedTaskRecommendation,
): TaskRecommendationCategory => {
  const validationId = recommendation.recommendation.suggestedValidation[0]?.validationId;

  if (validationId === undefined || hasUnsafeDisplayText(validationId)) {
    return "uncategorized";
  }

  const normalizedValidationId = validationId.toLowerCase();
  const match = categoryPrefixMap.find((item) => normalizedValidationId.startsWith(item.prefix));

  return match?.category ?? "uncategorized";
};

const matchesFilters = (
  recommendation: PersistedTaskRecommendation,
  filters: TaskRecommendationListFilters,
): boolean =>
  (filters.category === undefined ||
    categoryFromRecommendation(recommendation) === filters.category) &&
  (filters.repoId === undefined || recommendation.recommendation.repoId === filters.repoId) &&
  (filters.risk === undefined || recommendation.recommendation.riskLevel === filters.risk) &&
  (filters.scanId === undefined || recommendation.recommendation.scanId === filters.scanId) &&
  (filters.status === undefined || recommendation.recommendation.status === filters.status);

const repositoryLabel = (
  repositories: TaskRecommendationListRepository[],
  repoId: string,
): string => {
  const repository = repositories.find((item) => item.id === repoId);

  if (repository === undefined) {
    return repoId;
  }

  return hasUnsafeDisplayText(repository.repositoryFullName)
    ? "Unavailable"
    : repository.repositoryFullName;
};

const badgeVariantForRisk = (risk: CortexTaskRiskLevel) =>
  risk === "blocked" || risk === "high" ? "destructive" : "outline";

const badgeVariantForStatus = (status: TaskRecommendationStatus) =>
  status === "open" ? "secondary" : "outline";

const isLowRiskSetupRecommendation = (recommendation: PersistedTaskRecommendation): boolean =>
  recommendation.recommendation.riskLevel === "low" &&
  recommendation.recommendation.executionMode === "setup_pr" &&
  recommendation.recommendation.status === "open";

const isSelectableRecommendation = (recommendation: PersistedTaskRecommendation): boolean =>
  recommendation.recommendation.status === "open" ||
  recommendation.recommendation.status === "approved";

const uniqueScanIds = (recommendations: PersistedTaskRecommendation[]): string[] =>
  [...new Set(recommendations.map((item) => item.recommendation.scanId))].sort();

const filterValues = <TValue extends string>(
  recommendations: PersistedTaskRecommendation[],
  getValue: (recommendation: PersistedTaskRecommendation) => TValue,
): TValue[] => [...new Set(recommendations.map(getValue))].sort();

const groupedRecommendations = (
  recommendations: PersistedTaskRecommendation[],
): RecommendationGroup[] => {
  const groups = new Map<string, RecommendationGroup>();

  for (const recommendation of recommendations) {
    const risk = recommendation.recommendation.riskLevel;
    const category = categoryFromRecommendation(recommendation);
    const key = `${risk}:${category}`;
    const existingGroup = groups.get(key);

    if (existingGroup === undefined) {
      groups.set(key, {
        category,
        recommendations: [recommendation],
        risk,
      });
    } else {
      existingGroup.recommendations.push(recommendation);
    }
  }

  return [...groups.values()].sort((left, right) => {
    const riskDelta = riskRank[left.risk] - riskRank[right.risk];

    if (riskDelta !== 0) {
      return riskDelta;
    }

    return (categoryRank.get(left.category) ?? 99) - (categoryRank.get(right.category) ?? 99);
  });
};

const safeTextAreaValue = (value: string): string => safeDisplayText(value, "");

const RecommendationApprovalFields = ({
  recommendation,
}: {
  recommendation: TaskRecommendation;
}) => (
  <>
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      Title
      <Textarea
        aria-label={`Title for ${recommendation.taskRecommendationId}`}
        className="min-h-12 resize-y text-sm text-foreground"
        name="title"
        rows={2}
        defaultValue={safeTextAreaValue(recommendation.title)}
      />
    </label>
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      Objective
      <Textarea
        aria-label={`Objective for ${recommendation.taskRecommendationId}`}
        className="min-h-20 resize-y text-sm text-foreground"
        name="objective"
        rows={3}
        defaultValue={safeTextAreaValue(recommendation.objective)}
      />
    </label>
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Acceptance criteria</span>
      {recommendation.acceptanceCriteria.map((criterion, index) => (
        <Textarea
          aria-label={`Acceptance criterion ${index + 1} for ${
            recommendation.taskRecommendationId
          }`}
          className="min-h-16 resize-y text-sm text-foreground"
          key={`${recommendation.taskRecommendationId}-criterion-${index}`}
          name="acceptanceCriteria"
          rows={2}
          defaultValue={safeTextAreaValue(criterion)}
        />
      ))}
    </div>
  </>
);

const SuggestedValidationBadges = ({ recommendation }: { recommendation: TaskRecommendation }) => (
  <div className="flex flex-wrap gap-1.5">
    {recommendation.suggestedValidation.length === 0 ? (
      <Badge variant="outline">No suggested validation</Badge>
    ) : (
      recommendation.suggestedValidation.map((item) => (
        <Badge key={item.validationId} variant={item.required ? "secondary" : "outline"}>
          {safeDisplayText(item.label)}
        </Badge>
      ))
    )}
  </div>
);

export function TaskRecommendationList({
  recommendations,
  repositories,
  selectedFilters = {},
  workspaceId,
}: TaskRecommendationListProps) {
  const filteredRecommendations = recommendations.filter((recommendation) =>
    matchesFilters(recommendation, selectedFilters),
  );
  const statusCounts = countBy(recommendations, (item) => item.recommendation.status);
  const riskCounts = countBy(recommendations, (item) => item.recommendation.riskLevel);
  const categoryCounts = countBy(recommendations, categoryFromRecommendation);
  const lowRiskSetupRecommendations = recommendations.filter(isLowRiskSetupRecommendation);
  const groups = groupedRecommendations(filteredRecommendations);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="task-recommendations-list"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Task recommendations</p>
            <h2 id="task-recommendations-list" className="mt-1 text-base font-semibold">
              AI-ready setup review
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Approving creates draft Cortex Tasks only. Runner execution stays gated by the task
              queue, local repo mapping, approval, dry run, policy checks, and validation.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">{pluralize(recommendations.length, "recommendation")}</Badge>
              <Badge variant="secondary">{statusCounts.get("open") ?? 0} open</Badge>
              <Badge variant="outline">{statusCounts.get("deferred") ?? 0} deferred</Badge>
              <Badge variant="outline">{statusCounts.get("ignored") ?? 0} dismissed</Badge>
              <Badge variant="outline">{statusCounts.get("converted") ?? 0} converted</Badge>
              <Badge variant="outline">{riskCounts.get("low") ?? 0} low risk</Badge>
              <Badge variant="outline">{riskCounts.get("medium") ?? 0} medium risk</Badge>
            </div>
          </div>
          <form action={submitApproveTaskRecommendationsAction} className="flex flex-wrap gap-2">
            <input name="workspaceId" type="hidden" value={workspaceId} />
            {lowRiskSetupRecommendations.map((recommendation) => (
              <input
                key={recommendation.recommendation.taskRecommendationId}
                name="taskRecommendationId"
                type="hidden"
                value={recommendation.recommendation.taskRecommendationId}
              />
            ))}
            <Button
              disabled={lowRiskSetupRecommendations.length === 0}
              type="submit"
              variant="outline"
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
              Approve all low-risk setup tasks
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Task recommendation filters">
          <Button
            asChild
            size="xs"
            variant={
              Object.keys(selectedFilters).length === 0 ||
              filteredRecommendations.length === recommendations.length
                ? "secondary"
                : "outline"
            }
          >
            <Link href="/dashboard/task-recommendations">All recommendations</Link>
          </Button>
          {TASK_RECOMMENDATION_STATUSES.map((status) => (
            <Button
              asChild
              key={status}
              size="xs"
              variant={selectedFilters.status === status ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { status })}>
                {statusLabels[status]}
                <Badge variant="secondary">{statusCounts.get(status) ?? 0}</Badge>
              </Link>
            </Button>
          ))}
          {CORTEX_TASK_RISK_LEVELS.map((risk) => (
            <Button
              asChild
              key={risk}
              size="xs"
              variant={selectedFilters.risk === risk ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { risk })}>
                {riskLabels[risk]}
                <Badge variant="secondary">{riskCounts.get(risk) ?? 0}</Badge>
              </Link>
            </Button>
          ))}
          {filterValues(recommendations, categoryFromRecommendation).map((category) => (
            <Button
              asChild
              key={category}
              size="xs"
              variant={selectedFilters.category === category ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { category })}>
                {categoryLabels[category]}
                <Badge variant="secondary">{categoryCounts.get(category) ?? 0}</Badge>
              </Link>
            </Button>
          ))}
          {repositories.map((repository) => (
            <Button
              asChild
              key={repository.id}
              size="xs"
              variant={selectedFilters.repoId === repository.id ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { repoId: repository.id })}>
                {repositoryLabel(repositories, repository.id)}
              </Link>
            </Button>
          ))}
          {uniqueScanIds(recommendations).map((scanId) => (
            <Button
              asChild
              key={scanId}
              size="xs"
              variant={selectedFilters.scanId === scanId ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { scanId })}>{scanId}</Link>
            </Button>
          ))}
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <FileWarning aria-hidden="true" className="mb-3 size-5" />
          <p>No task recommendations yet.</p>
          <p className="mt-2">
            Run a repo readiness scan to generate findings and recommended setup work before
            creating Cortex Tasks.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/repositories">
              <ScanSearch aria-hidden="true" className="size-4" />
              Run a repo readiness scan
            </Link>
          </Button>
        </div>
      ) : filteredRecommendations.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No recommendations match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/task-recommendations">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <form action={submitApproveTaskRecommendationsAction} className="mt-5 flex flex-col gap-5">
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-muted-foreground">
              Showing {filteredRecommendations.length} of {recommendations.length} recommendations.
            </p>
            <Button type="submit" variant="outline">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Approve selected
            </Button>
          </div>

          {groups.map((group) => (
            <div
              className="rounded-lg border border-border bg-background p-4"
              key={`${group.risk}-${group.category}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {riskLabels[group.risk]} / {categoryLabels[group.category]}
                </h3>
                <Badge variant={badgeVariantForRisk(group.risk)}>{riskLabels[group.risk]}</Badge>
                <Badge variant="outline">{categoryLabels[group.category]}</Badge>
                <Badge variant="secondary">
                  {pluralize(group.recommendations.length, "recommendation")}
                </Badge>
              </div>

              <div className="mt-4 grid gap-4">
                {group.recommendations.map(({ recommendation }) => (
                  <article
                    className="rounded-md border border-border bg-card p-4"
                    key={recommendation.taskRecommendationId}
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-start gap-2">
                          {isSelectableRecommendation({ recommendation }) ? (
                            <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                              <input
                                className="size-4 rounded border-border"
                                name="taskRecommendationId"
                                type="checkbox"
                                value={recommendation.taskRecommendationId}
                              />
                              Select
                            </label>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <h4 className="text-base font-semibold">
                              {safeDisplayText(recommendation.title)}
                            </h4>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {safeDisplayText(recommendation.objective)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Badge variant={badgeVariantForRisk(recommendation.riskLevel)}>
                            {riskLabels[recommendation.riskLevel]}
                          </Badge>
                          <Badge variant={badgeVariantForStatus(recommendation.status)}>
                            {statusLabels[recommendation.status]}
                          </Badge>
                          <Badge variant="outline">{recommendation.executionMode}</Badge>
                          <Badge variant="outline">{recommendation.effort} effort</Badge>
                          <Badge variant="outline">
                            {pluralize(recommendation.findingIds.length, "linked finding")}
                          </Badge>
                        </div>

                        <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
                          <div className="flex flex-wrap gap-2">
                            <span className="font-medium text-foreground">Repository</span>
                            <span>{repositoryLabel(repositories, recommendation.repoId)}</span>
                            <span className="font-mono text-xs">{recommendation.repoId}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="font-medium text-foreground">Scan</span>
                            <Link
                              className="font-mono text-xs underline-offset-4 hover:underline"
                              href={withFilter(selectedFilters, { scanId: recommendation.scanId })}
                            >
                              {recommendation.scanId}
                            </Link>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="font-medium text-foreground">Recommendation</span>
                            <span className="font-mono text-xs">
                              {recommendation.taskRecommendationId}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <span className="text-sm font-medium">Suggested validation</span>
                          <SuggestedValidationBadges recommendation={recommendation} />
                        </div>

                        <div className="flex flex-col gap-2">
                          <span className="text-sm font-medium">Acceptance criteria</span>
                          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                            {recommendation.acceptanceCriteria.map((criterion, index) => (
                              <li key={`${recommendation.taskRecommendationId}-summary-${index}`}>
                                {safeDisplayText(criterion)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <form
                          action={submitApproveTaskRecommendationAction}
                          className="flex flex-col gap-3 rounded-md border border-border p-3"
                        >
                          <input name="workspaceId" type="hidden" value={workspaceId} />
                          <input
                            name="taskRecommendationId"
                            type="hidden"
                            value={recommendation.taskRecommendationId}
                          />
                          <RecommendationApprovalFields recommendation={recommendation} />
                          <Button
                            disabled={!isSelectableRecommendation({ recommendation })}
                            type="submit"
                            variant="outline"
                          >
                            <CheckCircle2 aria-hidden="true" className="size-4" />
                            Approve edited draft
                          </Button>
                        </form>

                        <div className="flex flex-wrap gap-2">
                          <form action={submitUpdateTaskRecommendationStatusAction}>
                            <input name="workspaceId" type="hidden" value={workspaceId} />
                            <input
                              name="taskRecommendationId"
                              type="hidden"
                              value={recommendation.taskRecommendationId}
                            />
                            <input name="status" type="hidden" value="deferred" />
                            <Button size="sm" type="submit" variant="outline">
                              <Clock3 aria-hidden="true" className="size-4" />
                              Defer
                            </Button>
                          </form>
                          <form action={submitUpdateTaskRecommendationStatusAction}>
                            <input name="workspaceId" type="hidden" value={workspaceId} />
                            <input
                              name="taskRecommendationId"
                              type="hidden"
                              value={recommendation.taskRecommendationId}
                            />
                            <input name="status" type="hidden" value="dismissed" />
                            <Button size="sm" type="submit" variant="outline">
                              {recommendation.status === "ignored" ? (
                                <ListChecks aria-hidden="true" className="size-4" />
                              ) : (
                                <XCircle aria-hidden="true" className="size-4" />
                              )}
                              Dismiss
                            </Button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </form>
      )}
    </section>
  );
}
