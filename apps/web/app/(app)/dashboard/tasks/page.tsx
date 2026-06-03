import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ListChecks, PlusCircle, ShieldCheck } from "lucide-react";

import {
  CORTEX_TASK_APPROVAL_STATUSES,
  CORTEX_TASK_EXECUTION_MODES,
  CORTEX_TASK_RISK_LEVELS,
  CORTEX_TASK_STATUSES,
  type CortexTaskApprovalStatus,
  type CortexTaskExecutionMode,
  type CortexTaskRiskLevel,
  type CortexTaskStatus,
} from "@control-plane/shared";

import { CortexTaskQueue, type CortexTaskQueueFilters } from "@/components/cortex-task-queue";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import {
  createCortexTaskRunnerQueueService,
  createDrizzleCortexTaskRunnerQueueStore,
} from "@/src/jobs/cortex-queue";
import {
  createCortexTaskService,
  createDrizzleCortexTaskStore,
} from "@/src/repo-readiness/cortex-tasks";
import {
  createCortexTaskRepairContextService,
  createDrizzleCortexTaskRepairContextStore,
} from "@/src/repairs/task-repair-context";
import {
  createDrizzleRunnerListStore,
  createRunnerListService,
  type RunnerListItem,
} from "@/src/runners/list";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]+$/u;
const approvalStatusFilters = new Set<string>(CORTEX_TASK_APPROVAL_STATUSES);
const executionModeFilters = new Set<string>(CORTEX_TASK_EXECUTION_MODES);
const riskFilters = new Set<string>(CORTEX_TASK_RISK_LEVELS);
const statusFilters = new Set<string>(CORTEX_TASK_STATUSES);

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

const getStatusFilter = (value: string | string[] | undefined): CortexTaskStatus | undefined => {
  const status = getSearchParamValue(value);

  return status !== null && statusFilters.has(status) ? (status as CortexTaskStatus) : undefined;
};

const getRiskFilter = (value: string | string[] | undefined): CortexTaskRiskLevel | undefined => {
  const risk = getSearchParamValue(value);

  return risk !== null && riskFilters.has(risk) ? (risk as CortexTaskRiskLevel) : undefined;
};

const getExecutionModeFilter = (
  value: string | string[] | undefined,
): CortexTaskExecutionMode | undefined => {
  const executionMode = getSearchParamValue(value);

  return executionMode !== null && executionModeFilters.has(executionMode)
    ? (executionMode as CortexTaskExecutionMode)
    : undefined;
};

const getApprovalStatusFilter = (
  value: string | string[] | undefined,
): CortexTaskApprovalStatus | undefined => {
  const approvalStatus = getSearchParamValue(value);

  return approvalStatus !== null && approvalStatusFilters.has(approvalStatus)
    ? (approvalStatus as CortexTaskApprovalStatus)
    : undefined;
};

const getFilters = (
  searchParams: Record<string, string | string[] | undefined>,
): CortexTaskQueueFilters => {
  const filters: CortexTaskQueueFilters = {};
  const approvalStatus = getApprovalStatusFilter(searchParams.approval);
  const executionMode = getExecutionModeFilter(searchParams.mode);
  const repoId = getSafeIdFilter(searchParams.repo);
  const risk = getRiskFilter(searchParams.risk);
  const status = getStatusFilter(searchParams.status);

  if (approvalStatus !== undefined) {
    filters.approvalStatus = approvalStatus;
  }

  if (executionMode !== undefined) {
    filters.executionMode = executionMode;
  }

  if (repoId !== undefined) {
    filters.repoId = repoId;
  }

  if (risk !== undefined) {
    filters.risk = risk;
  }

  if (status !== undefined) {
    filters.status = status;
  }

  return filters;
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    cortexTaskService: createCortexTaskService({
      store: createDrizzleCortexTaskStore(db),
    }),
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    runnerQueueService: createCortexTaskRunnerQueueService({
      store: createDrizzleCortexTaskRunnerQueueStore(db),
    }),
    repairContextService: createCortexTaskRepairContextService({
      store: createDrizzleCortexTaskRepairContextStore(db),
    }),
    runnerListService: createRunnerListService({
      store: createDrizzleRunnerListStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

const hasGitAvailable = (runner: RunnerListItem): boolean =>
  runner.capabilitiesSummary.toolAvailability.some((tool) => tool.name === "git" && tool.available);

const isAvailableLocalRunner = (runner: RunnerListItem): boolean =>
  (runner.status === "idle" || runner.status === "busy") &&
  !runner.isRevoked &&
  runner.lastHeartbeatAt !== null &&
  runner.capabilitiesSummary.supportsDryRun &&
  hasGitAvailable(runner);

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedFilters = getFilters(resolvedSearchParams);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    cortexTaskService,
    githubRepositoryService,
    repairContextService,
    runnerQueueService,
    runnerListService,
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
  const [tasks, githubRepositories, runners] =
    verifiedWorkspace === null
      ? [[], [], []]
      : await Promise.all([
          cortexTaskService.listCortexTasks({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          runnerListService.listWorkspaceRunners({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);
  const hasAvailableLocalRunner = runners.some(isAvailableLocalRunner);
  const runnerEligibilityEntries =
    verifiedWorkspace === null
      ? []
      : await Promise.all(
          tasks
            .filter((task) => task.executionMode === "local_runner")
            .map(async (task) => {
              const eligibility = await runnerQueueService.getCortexTaskRunnerEligibility({
                taskId: task.taskId,
                workspaceId: verifiedWorkspace.workspaceId,
              });

              return [task.taskId, eligibility] as const;
            }),
        );
  const runnerEligibilityByTaskId = Object.fromEntries(runnerEligibilityEntries);
  const repairContextByTaskId =
    verifiedWorkspace === null || tasks.length === 0
      ? {}
      : await repairContextService.listCortexTaskRepairContexts({
          taskIds: tasks.map((task) => task.taskId),
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Tasks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Cortex Tasks</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review approved engineering intent, sync external references, and move ready tasks into
            the gated local-runner queue without exposing repository source to the hosted control
            plane.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks/new">
              <PlusCircle aria-hidden="true" className="size-4" />
              Create manual draft
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/task-recommendations">
              <ArrowRight aria-hidden="true" className="size-4" />
              Review recommendations
            </Link>
          </Button>
        </div>
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
              A verified workspace membership is required before Cortex Tasks can be displayed.
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
            aria-labelledby="task-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="task-boundary" className="text-base font-semibold">
                  Runner execution is gated
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Executing a task for {verifiedWorkspace.name} only moves approved metadata into
                  the local-runner queue. The runner still owns worktree creation, policy checks,
                  dry-run support, validation, commits, pushes, and pull requests.
                </p>
              </div>
            </div>
          </section>
          <CortexTaskQueue
            hasAvailableLocalRunner={hasAvailableLocalRunner}
            repairContextByTaskId={repairContextByTaskId}
            repositories={githubRepositories}
            runnerEligibilityByTaskId={runnerEligibilityByTaskId}
            selectedFilters={selectedFilters}
            tasks={tasks}
            workspaceId={verifiedWorkspace.workspaceId}
          />
        </>
      )}
    </div>
  );
}
