import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ListChecks, ShieldCheck } from "lucide-react";

import {
  CORTEX_TASK_RISK_LEVELS,
  TASK_RECOMMENDATION_STATUSES,
  type CortexTaskRiskLevel,
  type TaskRecommendationStatus,
} from "@control-plane/shared";

import {
  TaskRecommendationList,
  type TaskRecommendationCategory,
  type TaskRecommendationListFilters,
} from "@/components/task-recommendation-list";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import {
  createDrizzleTaskRecommendationStore,
  createTaskRecommendationService,
} from "@/src/repo-readiness/task-recommendations";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]+$/u;
const riskFilters = new Set<string>(CORTEX_TASK_RISK_LEVELS);
const statusFilters = new Set<string>(TASK_RECOMMENDATION_STATUSES);
const categoryFilters = new Set<string>([
  "agent_readiness",
  "architecture",
  "backlog_quality",
  "ci_cd",
  "execution_risk",
  "integration",
  "product_clarity",
  "repo_hygiene",
  "security",
  "uncategorized",
  "validation",
]);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getSafeIdFilter = (value: string | string[] | undefined): string | undefined => {
  const selectedValue = getSearchParamValue(value)?.trim();

  return selectedValue !== undefined &&
    selectedValue.length > 0 &&
    selectedValue.length <= 240 &&
    idPattern.test(selectedValue)
    ? selectedValue
    : undefined;
};

const getRiskFilter = (value: string | string[] | undefined): CortexTaskRiskLevel | undefined => {
  const risk = getSearchParamValue(value);

  return risk !== null && riskFilters.has(risk) ? (risk as CortexTaskRiskLevel) : undefined;
};

const getStatusFilter = (
  value: string | string[] | undefined,
): TaskRecommendationStatus | undefined => {
  const status = getSearchParamValue(value);

  return status !== null && statusFilters.has(status)
    ? (status as TaskRecommendationStatus)
    : undefined;
};

const getCategoryFilter = (
  value: string | string[] | undefined,
): TaskRecommendationCategory | undefined => {
  const category = getSearchParamValue(value);

  return category !== null && categoryFilters.has(category)
    ? (category as TaskRecommendationCategory)
    : undefined;
};

const getFilters = (
  searchParams: Record<string, string | string[] | undefined>,
): TaskRecommendationListFilters => {
  const filters: TaskRecommendationListFilters = {};
  const category = getCategoryFilter(searchParams.category);
  const repoId = getSafeIdFilter(searchParams.repo);
  const risk = getRiskFilter(searchParams.risk);
  const scanId = getSafeIdFilter(searchParams.scan);
  const status = getStatusFilter(searchParams.status);

  if (category !== undefined) {
    filters.category = category;
  }

  if (repoId !== undefined) {
    filters.repoId = repoId;
  }

  if (risk !== undefined) {
    filters.risk = risk;
  }

  if (scanId !== undefined) {
    filters.scanId = scanId;
  }

  if (status !== undefined) {
    filters.status = status;
  }

  return filters;
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    taskRecommendationService: createTaskRecommendationService({
      store: createDrizzleTaskRecommendationStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function TaskRecommendationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedFilters = getFilters(resolvedSearchParams);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    githubRepositoryService,
    taskRecommendationService,
    workspaceService: service,
  } = getServices();
  const verifiedWorkspace =
    cookieWorkspaceId === null
      ? null
      : await service
          .selectWorkspace({ workspaceId: cookieWorkspaceId })
          .catch((error: unknown) => {
            if (
              isServerActionError(error) &&
              (error.code === "forbidden" || error.code === "validation_error")
            ) {
              return null;
            }

            throw error;
          });
  const [recommendations, githubRepositories] =
    verifiedWorkspace === null
      ? [[], []]
      : await Promise.all([
          taskRecommendationService.listTaskRecommendations({
            workspaceId: verifiedWorkspace.workspaceId,
            ...(selectedFilters.repoId === undefined ? {} : { repoId: selectedFilters.repoId }),
            ...(selectedFilters.scanId === undefined ? {} : { scanId: selectedFilters.scanId }),
            ...(selectedFilters.status === undefined ? {} : { status: selectedFilters.status }),
          }),
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Recommendations</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">
            Repo readiness task recommendations
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review scan-generated setup recommendations, edit task wording, and approve selected
            items into draft Cortex Tasks before local runner execution is considered.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <ArrowRight aria-hidden="true" className="size-4" />
            View task queue
          </Link>
        </Button>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <ListChecks aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before task recommendations can be
              displayed.
            </p>
          </div>
          <Button asChild className="mt-5">
            <Link href="/workspaces">
              <ArrowRight aria-hidden="true" className="size-4" />
              Select workspace
            </Link>
          </Button>
        </section>
      ) : (
        <>
          <section
            className="rounded-lg border border-border bg-card p-5"
            aria-labelledby="recommendation-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="recommendation-boundary" className="text-base font-semibold">
                  Approval creates drafts, not runner jobs
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Approved recommendations for {verifiedWorkspace.name} become draft Cortex Tasks.
                  Queueing and local execution remain separate human-gated steps.
                </p>
              </div>
            </div>
          </section>
          <TaskRecommendationList
            recommendations={recommendations}
            repositories={githubRepositories}
            selectedFilters={selectedFilters}
            workspaceId={verifiedWorkspace.workspaceId}
          />
        </>
      )}
    </div>
  );
}
