import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileWarning,
  GitBranch,
  GitPullRequest,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  ScanSearch,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  CORTEX_TASK_APPROVAL_STATUSES,
  CORTEX_TASK_EXECUTION_MODES,
  CORTEX_TASK_RISK_LEVELS,
  CORTEX_TASK_STATUSES,
  CORTEX_TASK_STATUS_TRANSITION_TABLE,
  evaluateCortexTaskStatusTransition,
  type CortexTask,
  type CortexTaskApprovalStatus,
  type CortexTaskExecutionMode,
  type CortexTaskExternalLink,
  type CortexTaskRiskLevel,
  type CortexTaskStatus,
} from "@control-plane/shared";

import {
  transitionCortexTaskStatusAction,
  updateCortexTaskExecutionModeAction,
} from "@/src/server/actions";
import type {
  CortexTaskRunnerEligibility,
  CortexTaskRunnerEligibilityReason,
  CortexTaskRunnerEligibilityReasonCode,
} from "@/src/jobs/cortex-queue";
import type { CortexTaskRepairContext } from "@/src/repairs/task-repair-context";
import { hasUnsafeDisplayText, safeDisplayText } from "@/components/display-safety";
import { RequestRepairDialog } from "@/components/request-repair-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function submitTransitionCortexTaskStatusAction(formData: FormData): Promise<void> {
  "use server";

  await transitionCortexTaskStatusAction(formData);
}

async function submitUpdateCortexTaskExecutionModeAction(formData: FormData): Promise<void> {
  "use server";

  await updateCortexTaskExecutionModeAction(formData);
}

export type CortexTaskQueueRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
};

export type CortexTaskQueueFilters = {
  approvalStatus?: CortexTaskApprovalStatus;
  executionMode?: CortexTaskExecutionMode;
  repoId?: string;
  risk?: CortexTaskRiskLevel;
  status?: CortexTaskStatus;
};

type CortexTaskQueueProps = {
  hasAvailableLocalRunner?: boolean;
  repairContextByTaskId?: Record<string, CortexTaskRepairContext>;
  repositories: CortexTaskQueueRepository[];
  runnerEligibilityByTaskId?: Record<string, CortexTaskRunnerEligibility>;
  selectedFilters?: CortexTaskQueueFilters;
  tasks: CortexTask[];
  workspaceId: string;
};

type TaskAction = {
  icon: typeof CheckCircle2;
  label: string;
  status: CortexTaskStatus;
  variant: "default" | "destructive" | "outline" | "secondary";
};

const statusLabels: Record<CortexTaskStatus, string> = {
  approved: "Approved",
  blocked: "Blocked",
  completed: "Completed",
  deferred: "Deferred",
  draft: "Draft",
  needs_review: "Needs review",
  pr_opened: "PR opened",
  queued: "Queued",
  rejected: "Rejected",
  running: "Running",
};

const approvalStatusLabels: Record<CortexTaskApprovalStatus, string> = {
  approved: "Approval approved",
  deferred: "Approval deferred",
  not_requested: "Approval not requested",
  pending: "Pending approval",
  rejected: "Approval rejected",
};

const executionModeLabels: Record<CortexTaskExecutionMode, string> = {
  local_runner: "local_runner",
  planning_only: "planning_only",
  setup_pr: "setup_pr",
};

const executionModeDisplayLabels: Record<CortexTaskExecutionMode, string> = {
  local_runner: "Local runner",
  planning_only: "Planning only",
  setup_pr: "Setup PR",
};

const riskLabels: Record<CortexTaskRiskLevel, string> = {
  blocked: "blocked",
  high: "high",
  low: "low",
  medium: "medium",
};

const validationStatusLabels: Record<
  CortexTaskRepairContext["validationEvidence"]["statusCounts"][number]["status"],
  string
> = {
  cancelled: "cancelled",
  failed: "failed",
  passed: "passed",
  skipped: "skipped",
};

const prStatusLabels: Record<NonNullable<CortexTaskRepairContext["pr"]>["status"], string> = {
  closed: "closed",
  draft: "draft",
  merged: "merged",
  open: "open",
};

const actionPresentation: Record<CortexTaskStatus, TaskAction> = {
  approved: {
    icon: CheckCircle2,
    label: "Approve",
    status: "approved",
    variant: "default",
  },
  blocked: {
    icon: XCircle,
    label: "Block",
    status: "blocked",
    variant: "destructive",
  },
  completed: {
    icon: CheckCircle2,
    label: "Complete",
    status: "completed",
    variant: "secondary",
  },
  deferred: {
    icon: PauseCircle,
    label: "Defer",
    status: "deferred",
    variant: "outline",
  },
  draft: {
    icon: RotateCcw,
    label: "Return to draft",
    status: "draft",
    variant: "outline",
  },
  needs_review: {
    icon: GitBranch,
    label: "Review",
    status: "needs_review",
    variant: "outline",
  },
  pr_opened: {
    icon: GitBranch,
    label: "PR opened",
    status: "pr_opened",
    variant: "secondary",
  },
  queued: {
    icon: PlayCircle,
    label: "Execute locally",
    status: "queued",
    variant: "default",
  },
  rejected: {
    icon: XCircle,
    label: "Reject",
    status: "rejected",
    variant: "destructive",
  },
  running: {
    icon: PlayCircle,
    label: "Running",
    status: "running",
    variant: "secondary",
  },
};

const localRunnerSetupStatuses = new Set<CortexTaskStatus>([
  "approved",
  "blocked",
  "pr_opened",
  "queued",
  "running",
]);

const executionModeEditableStatuses = new Set<CortexTaskStatus>(["draft", "needs_review"]);
const executionModeEditableApprovalStatuses = new Set<CortexTaskApprovalStatus>([
  "not_requested",
  "pending",
]);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const countBy = <TValue extends string>(
  tasks: CortexTask[],
  getValue: (task: CortexTask) => TValue,
): Map<TValue, number> => {
  const counts = new Map<TValue, number>();

  for (const task of tasks) {
    const value = getValue(task);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
};

const getSearchParams = (filters: CortexTaskQueueFilters): URLSearchParams => {
  const params = new URLSearchParams();

  if (filters.approvalStatus !== undefined) {
    params.set("approval", filters.approvalStatus);
  }

  if (filters.executionMode !== undefined) {
    params.set("mode", filters.executionMode);
  }

  if (filters.repoId !== undefined) {
    params.set("repo", filters.repoId);
  }

  if (filters.risk !== undefined) {
    params.set("risk", filters.risk);
  }

  if (filters.status !== undefined) {
    params.set("status", filters.status);
  }

  return params;
};

const withFilter = (filters: CortexTaskQueueFilters, next: CortexTaskQueueFilters): string => {
  const params = getSearchParams({
    ...filters,
    ...next,
  });
  const query = params.toString();

  return query.length > 0 ? `/dashboard/tasks?${query}` : "/dashboard/tasks";
};

const matchesFilters = (task: CortexTask, filters: CortexTaskQueueFilters): boolean =>
  (filters.approvalStatus === undefined || task.approvalStatus === filters.approvalStatus) &&
  (filters.executionMode === undefined || task.executionMode === filters.executionMode) &&
  (filters.repoId === undefined || task.repoId === filters.repoId) &&
  (filters.risk === undefined || task.riskLevel === filters.risk) &&
  (filters.status === undefined || task.status === filters.status);

const badgeVariantForRisk = (risk: CortexTaskRiskLevel) =>
  risk === "blocked" || risk === "high" ? "destructive" : "outline";

const badgeVariantForStatus = (status: CortexTaskStatus) => {
  if (status === "blocked" || status === "rejected") {
    return "destructive";
  }

  return status === "approved" || status === "queued" ? "secondary" : "outline";
};

const repositoryLabel = (repositories: CortexTaskQueueRepository[], repoId: string): string => {
  const repository = repositories.find((item) => item.id === repoId);

  if (repository === undefined) {
    return safeDisplayText(repoId);
  }

  return hasUnsafeDisplayText(repository.repositoryFullName)
    ? "Unavailable"
    : repository.repositoryFullName;
};

const safeExternalLinkUrl = (value: string): string | null => {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
      return null;
    }

    for (const key of url.searchParams.keys()) {
      if (
        /^(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret)$/iu.test(
          key,
        )
      ) {
        return null;
      }
    }

    return url.toString();
  } catch {
    return null;
  }
};

const allowedActionsForTask = (task: CortexTask): TaskAction[] =>
  CORTEX_TASK_STATUS_TRANSITION_TABLE.user[task.status]
    .map((status) => ({
      evaluation: evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: task.approvalStatus,
        currentStatus: task.status,
        nextStatus: status,
      }),
      status,
    }))
    .filter((item) => item.evaluation.allowed)
    .map((item) => actionPresentation[item.status]);

const needsLocalRunnerSetup = (task: CortexTask): boolean =>
  task.executionMode === "local_runner" &&
  task.approvalStatus === "approved" &&
  localRunnerSetupStatuses.has(task.status);

const canEditExecutionMode = (task: CortexTask): boolean =>
  executionModeEditableStatuses.has(task.status) &&
  executionModeEditableApprovalStatuses.has(task.approvalStatus);

const createRunnerEligibilityReason = (
  code: CortexTaskRunnerEligibilityReasonCode,
): CortexTaskRunnerEligibilityReason => {
  switch (code) {
    case "approval_not_approved":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Approve the task before queueing local execution.",
      };
    case "execution_mode_not_local_runner":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Select local runner execution mode before queueing this task.",
      };
    case "repo_mapping_archived":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Restore or recreate an active local repository mapping.",
      };
    case "repo_mapping_default_branch_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Set the repository mapping default branch before queueing local execution.",
      };
    case "repo_mapping_local_path_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Pair a local repository path before queueing local execution.",
      };
    case "repo_mapping_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Register an active local repository mapping for this GitHub repository.",
      };
    case "repo_mapping_policy_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Refresh the repository policy snapshot before queueing local execution.",
      };
    case "repository_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Connect the GitHub repository before queueing local execution.",
      };
    case "repository_unavailable":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Enable an active GitHub repository before queueing local execution.",
      };
    case "required_approval_missing":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Record explicit approval evidence for high-risk local runner work.",
      };
    case "risk_blocked":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Resolve blocked risk before queueing local runner execution.",
      };
    case "runner_unavailable":
      return {
        code,
        fixHref: "/dashboard/runners",
        message: "Pair an available local runner with dry-run and git support.",
      };
    case "task_not_approved":
      return {
        code,
        fixHref: "/dashboard/tasks",
        message: "Move the task to approved status before queueing local execution.",
      };
    case "validation_required_missing":
      return {
        code,
        fixHref: "/dashboard/repositories",
        message: "Add at least one required validation command to the repository mapping.",
      };
  }
};

const getFallbackRunnerEligibility = (input: {
  hasAvailableLocalRunner: boolean;
  task: CortexTask;
}): CortexTaskRunnerEligibility => {
  const reasons: CortexTaskRunnerEligibilityReason[] = [];
  const addReason = (code: CortexTaskRunnerEligibilityReasonCode) => {
    if (!reasons.some((reason) => reason.code === code)) {
      reasons.push(createRunnerEligibilityReason(code));
    }
  };

  if (input.task.status !== "approved") {
    addReason("task_not_approved");
  }

  if (input.task.approvalStatus !== "approved") {
    addReason("approval_not_approved");
  }

  if (input.task.executionMode !== "local_runner") {
    addReason("execution_mode_not_local_runner");
  }

  if (input.task.riskLevel === "blocked") {
    addReason("risk_blocked");
  }

  if (!input.hasAvailableLocalRunner) {
    addReason("runner_unavailable");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
};

const getRunnerEligibilityForTask = (input: {
  hasAvailableLocalRunner: boolean;
  runnerEligibilityByTaskId: Record<string, CortexTaskRunnerEligibility> | undefined;
  task: CortexTask;
}): CortexTaskRunnerEligibility =>
  input.runnerEligibilityByTaskId?.[input.task.taskId] ??
  getFallbackRunnerEligibility({
    hasAvailableLocalRunner: input.hasAvailableLocalRunner,
    task: input.task,
  });

const safeFixHref = (href: string): string | null => {
  if (href === "/dashboard" || href.startsWith("/dashboard/")) {
    return href;
  }

  return null;
};

const getRepairContextForTask = (
  repairContextByTaskId: Record<string, CortexTaskRepairContext> | undefined,
  task: CortexTask,
): CortexTaskRepairContext | null => {
  if (task.status !== "pr_opened") {
    return null;
  }

  return repairContextByTaskId?.[task.taskId] ?? null;
};

const formatValidationEvidence = (
  validationEvidence: CortexTaskRepairContext["validationEvidence"],
): string => pluralize(validationEvidence.totalCount, "record");

const TaskRepairRequestPanel = ({
  context,
  workspaceId,
}: {
  context: CortexTaskRepairContext;
  workspaceId: string;
}) => {
  const prUrl = context.pr?.url === undefined ? null : safeExternalLinkUrl(context.pr.url ?? "");

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h4 className="text-sm font-medium">Repair request</h4>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Queue repair attempt {context.nextAttempt} of {context.maxAttempts}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">Run {safeDisplayText(context.previousRunId)}</Badge>
            {context.pr === null ? (
              <Badge variant="outline">No PR metadata</Badge>
            ) : prUrl === null ? (
              <Badge variant="outline">
                PR #{context.pr.number} {prStatusLabels[context.pr.status]}
              </Badge>
            ) : (
              <Button asChild size="xs" variant="outline">
                <Link href={prUrl} rel="noreferrer" target="_blank">
                  <GitPullRequest aria-hidden="true" className="size-3" />
                  PR #{context.pr.number}
                  <ExternalLink aria-hidden="true" className="size-3" />
                </Link>
              </Button>
            )}
            <Badge variant="outline">Validation evidence</Badge>
            <span className="text-muted-foreground">
              {formatValidationEvidence(context.validationEvidence)}
            </span>
            {context.validationEvidence.statusCounts.map((statusCount) => (
              <Badge key={statusCount.status} variant="secondary">
                {statusCount.count} {validationStatusLabels[statusCount.status]}
              </Badge>
            ))}
          </div>
        </div>
        <RequestRepairDialog
          attemptCount={context.attemptCount}
          disabled={!context.canRequestRepair}
          disabledReason={context.disabledReason ?? ""}
          maxAttempts={context.maxAttempts}
          nextAttempt={context.nextAttempt}
          previousRunId={context.previousRunId}
          remainingAttempts={context.remainingAttempts}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
};

const ExternalLinkList = ({ links }: { links: readonly CortexTaskExternalLink[] }) => {
  if (links.length === 0) {
    return <Badge variant="outline">No external links</Badge>;
  }

  return (
    <div className="flex flex-col gap-2">
      {links.map((link, index) => {
        const safeUrl = safeExternalLinkUrl(link.url);
        const key = `${link.provider}:${link.resourceType}:${link.externalId ?? index}`;
        const linkTitle = safeDisplayText(link.title);
        const linkStatus = safeDisplayText(link.status);

        if (safeUrl === null || linkTitle.length === 0 || linkStatus.length === 0) {
          return (
            <Badge key={key} variant="outline">
              External metadata unavailable
            </Badge>
          );
        }

        return (
          <div className="flex flex-wrap items-center gap-2 text-sm" key={key}>
            <Badge variant="outline">{safeDisplayText(link.provider)}</Badge>
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={safeUrl}
              rel="noreferrer"
              target="_blank"
            >
              {linkTitle}
            </Link>
            <Badge variant="secondary">{linkStatus}</Badge>
          </div>
        );
      })}
    </div>
  );
};

const RunnerEligibilityPanel = ({ eligibility }: { eligibility: CortexTaskRunnerEligibility }) => {
  return (
    <div>
      <h4 className="text-sm font-medium">Runner eligibility</h4>
      {eligibility.eligible ? (
        <Badge className="mt-2" variant="secondary">
          Ready for local runner queue
        </Badge>
      ) : (
        <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
          {eligibility.reasons.map((reason) => {
            const href = safeFixHref(reason.fixHref);
            const message = safeDisplayText(reason.message, "Resolve the listed setup gap.");

            return (
              <li className="flex flex-wrap items-center gap-2" key={reason.code}>
                <span>{message}</span>
                {href === null ? null : (
                  <Link
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    href={href}
                  >
                    Fix
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const TaskStatusActionForm = ({
  action,
  runnerEligibility,
  task,
}: {
  action: TaskAction;
  runnerEligibility: CortexTaskRunnerEligibility;
  task: CortexTask;
}) => {
  const Icon = action.icon;

  if (action.status === "queued" && !runnerEligibility.eligible) {
    return (
      <Button disabled size="sm" type="button" variant="outline">
        <XCircle aria-hidden="true" className="size-4" />
        Cannot execute locally
      </Button>
    );
  }

  return (
    <form action={submitTransitionCortexTaskStatusAction}>
      <input name="workspaceId" type="hidden" value={task.workspaceId} />
      <input name="taskId" type="hidden" value={task.taskId} />
      <input name="status" type="hidden" value={action.status} />
      <Button size="sm" type="submit" variant={action.variant}>
        <Icon aria-hidden="true" className="size-4" />
        {action.label}
      </Button>
    </form>
  );
};

const TaskExecutionModeForm = ({
  hasAvailableLocalRunner,
  task,
}: {
  hasAvailableLocalRunner: boolean;
  task: CortexTask;
}) => {
  const blockedRiskMode = task.riskLevel === "blocked";
  const editable = canEditExecutionMode(task);

  return (
    <div>
      <h4 className="text-sm font-medium">Execution mode</h4>
      {editable ? (
        <>
          <form
            action={submitUpdateCortexTaskExecutionModeAction}
            className="mt-2 flex flex-col gap-2 sm:flex-row"
          >
            <input name="workspaceId" type="hidden" value={task.workspaceId} />
            <input name="taskId" type="hidden" value={task.taskId} />
            <select
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={task.executionMode}
              name="executionMode"
            >
              <option value="planning_only">{executionModeDisplayLabels.planning_only}</option>
              <option value="setup_pr" disabled={blockedRiskMode}>
                {executionModeDisplayLabels.setup_pr}
              </option>
              <option value="local_runner" disabled={!hasAvailableLocalRunner || blockedRiskMode}>
                {executionModeDisplayLabels.local_runner}
              </option>
            </select>
            <Button size="sm" type="submit" variant="outline">
              <ArrowRight aria-hidden="true" className="size-4" />
              Update mode
            </Button>
          </form>
          {!hasAvailableLocalRunner ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pair an available runner before selecting local runner.
            </p>
          ) : null}
          {blockedRiskMode ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Blocked-risk tasks can stay planning-only until risk is resolved.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Mode locked after approval.</p>
      )}
    </div>
  );
};

export function CortexTaskQueue({
  hasAvailableLocalRunner = false,
  repairContextByTaskId,
  repositories,
  runnerEligibilityByTaskId,
  selectedFilters = {},
  tasks,
  workspaceId,
}: CortexTaskQueueProps) {
  const filteredTasks = tasks.filter((task) => matchesFilters(task, selectedFilters));
  const statusCounts = countBy(tasks, (task) => task.status);
  const approvalCounts = countBy(tasks, (task) => task.approvalStatus);
  const riskCounts = countBy(tasks, (task) => task.riskLevel);
  const executionModeCounts = countBy(tasks, (task) => task.executionMode);
  const localRunnerSetupCount = tasks.filter(needsLocalRunnerSetup).length;
  const executionModeSummaries = [
    {
      description:
        "Keep intent and acceptance criteria in hosted review before any repository changes are requested.",
      href: withFilter(selectedFilters, { executionMode: "planning_only" }),
      label: "Planning only",
      mode: "planning_only" as const,
    },
    {
      description:
        "Create repository setup files through the GitHub setup PR flow when no local execution is required.",
      href: withFilter(selectedFilters, { executionMode: "setup_pr" }),
      label: "Setup PR",
      mode: "setup_pr" as const,
    },
    {
      description:
        "Pair a local runner only for approved tasks that must execute against source; source stays local.",
      href: withFilter(selectedFilters, { executionMode: "local_runner" }),
      label: "Local runner",
      mode: "local_runner" as const,
    },
  ];

  return (
    <section aria-labelledby="cortex-task-queue">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Cortex Tasks queue</p>
          <h2 id="cortex-task-queue" className="mt-1 text-base font-semibold">
            Execution-readiness queue
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Queueing marks approved intent for the local runner queue only. The web app coordinates
            metadata and keeps source access, worktrees, policy checks, validation, and execution
            inside the local runner boundary.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{pluralize(tasks.length, "task")}</Badge>
            <Badge variant="outline">{statusCounts.get("draft") ?? 0} draft</Badge>
            <Badge variant="outline">{statusCounts.get("needs_review") ?? 0} in review</Badge>
            <Badge variant="secondary">{statusCounts.get("approved") ?? 0} approved</Badge>
            <Badge variant="secondary">{statusCounts.get("queued") ?? 0} queued</Badge>
            <Badge variant="outline">
              {approvalCounts.get("not_requested") ?? 0} approval not requested
            </Badge>
            <Badge variant="outline">{approvalCounts.get("pending") ?? 0} pending approval</Badge>
            <Badge variant="outline">{approvalCounts.get("approved") ?? 0} approval approved</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks/sync-github-issues">
              <Send aria-hidden="true" className="size-4" />
              GitHub Issues
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks/sync-linear">
              <Send aria-hidden="true" className="size-4" />
              Sync external links
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/task-recommendations">
              <ShieldCheck aria-hidden="true" className="size-4" />
              Review recommendations
            </Link>
          </Button>
        </div>
      </div>

      <div
        aria-labelledby="runner-gate-title"
        className="mt-5 rounded-lg border border-border bg-muted/20 p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Runner gate</p>
            <h3 id="runner-gate-title" className="mt-1 text-base font-semibold">
              Local execution is optional
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Continue planning and setup work without pairing a runner. Add a local runner only
              after approved intent requires repository execution; hosted surfaces keep metadata,
              while source stays local.
            </p>
            <p className="mt-3 text-sm font-medium text-foreground">
              {localRunnerSetupCount > 0
                ? `${pluralize(localRunnerSetupCount, "task")} needs local runner setup`
                : "No approved tasks require a runner yet."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/dashboard/task-recommendations">
                <ArrowRight aria-hidden="true" className="size-4" />
                Continue without runner
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/setup-prs">
                <GitBranch aria-hidden="true" className="size-4" />
                Open setup PR flow
              </Link>
            </Button>
            {localRunnerSetupCount > 0 ? (
              <Button asChild>
                <Link href="/dashboard/runners">
                  <ShieldCheck aria-hidden="true" className="size-4" />
                  Set up local runner
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {executionModeSummaries.map((item) => (
            <div className="border-l border-border pl-4" key={item.mode}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">{item.label}</h4>
                <Badge variant="outline">
                  {pluralize(executionModeCounts.get(item.mode) ?? 0, "task")}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
              <Link
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                href={item.href}
              >
                View mode
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Cortex Task filters">
        <Button
          asChild
          size="xs"
          variant={Object.keys(selectedFilters).length === 0 ? "secondary" : "outline"}
        >
          <Link href="/dashboard/tasks">All tasks</Link>
        </Button>
        {CORTEX_TASK_STATUSES.map((status) => (
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
        {CORTEX_TASK_EXECUTION_MODES.map((executionMode) => (
          <Button
            asChild
            key={executionMode}
            size="xs"
            variant={selectedFilters.executionMode === executionMode ? "secondary" : "outline"}
          >
            <Link href={withFilter(selectedFilters, { executionMode })}>
              {executionModeLabels[executionMode]}
              <Badge variant="secondary">{executionModeCounts.get(executionMode) ?? 0}</Badge>
            </Link>
          </Button>
        ))}
        {CORTEX_TASK_APPROVAL_STATUSES.map((approvalStatus) => (
          <Button
            asChild
            key={approvalStatus}
            size="xs"
            variant={selectedFilters.approvalStatus === approvalStatus ? "secondary" : "outline"}
          >
            <Link href={withFilter(selectedFilters, { approvalStatus })}>
              {approvalStatusLabels[approvalStatus]}
              <Badge variant="secondary">{approvalCounts.get(approvalStatus) ?? 0}</Badge>
            </Link>
          </Button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <FileWarning aria-hidden="true" className="mb-3 size-5" />
          <p>No Cortex Tasks yet.</p>
          <p className="mt-2">
            Run a repo readiness scan, review recommendations, import external issues, or create
            manual task drafts before queueing local runner work.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/repositories">
                <ScanSearch aria-hidden="true" className="size-4" />
                Run a repo readiness scan
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/task-recommendations">
                <ShieldCheck aria-hidden="true" className="size-4" />
                Review recommendations
              </Link>
            </Button>
          </div>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No Cortex Tasks match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/tasks">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          <p className="text-sm text-muted-foreground">
            Showing {filteredTasks.length} of {tasks.length} tasks.
          </p>
          {filteredTasks.map((task) => {
            const actions = allowedActionsForTask(task);
            const repairContext = getRepairContextForTask(repairContextByTaskId, task);
            const runnerEligibility = getRunnerEligibilityForTask({
              hasAvailableLocalRunner,
              runnerEligibilityByTaskId,
              task,
            });
            const showRunnerEligibility =
              task.executionMode === "local_runner" ||
              actions.some((action) => action.status === "queued" && !runnerEligibility.eligible);

            return (
              <article className="rounded-lg border border-border bg-card p-4" key={task.taskId}>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badgeVariantForStatus(task.status)}>
                        {statusLabels[task.status]}
                      </Badge>
                      <Badge variant="outline">{approvalStatusLabels[task.approvalStatus]}</Badge>
                      <Badge variant={badgeVariantForRisk(task.riskLevel)}>
                        {riskLabels[task.riskLevel]}
                      </Badge>
                      <Badge variant="outline">{executionModeLabels[task.executionMode]}</Badge>
                    </div>
                    <h3 className="mt-3 text-base font-semibold">{safeDisplayText(task.title)}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {safeDisplayText(task.objective)}
                    </p>
                    <div className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
                      <div className="flex flex-wrap gap-2">
                        <span className="font-medium text-foreground">Task</span>
                        <span className="font-mono text-xs">{safeDisplayText(task.taskId)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="font-medium text-foreground">Repository</span>
                        <span>{repositoryLabel(repositories, task.repoId)}</span>
                        <span className="font-mono text-xs">{safeDisplayText(task.repoId)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="font-medium text-foreground">Origin</span>
                        <Badge variant="outline">{safeDisplayText(task.origin.type)}</Badge>
                        {task.origin.externalId === undefined ? null : (
                          <span className="font-mono text-xs">
                            {safeDisplayText(task.origin.externalId)}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Linked findings</span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {task.findingIds.length === 0 ? (
                            <Badge variant="outline">No linked findings</Badge>
                          ) : (
                            task.findingIds.map((findingId) => (
                              <Badge key={findingId} variant="outline">
                                {safeDisplayText(findingId)}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <h4 className="text-sm font-medium">Suggested validation</h4>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {task.suggestedValidation.length === 0 ? (
                          <Badge variant="outline">No suggested validation</Badge>
                        ) : (
                          task.suggestedValidation.map((item) => (
                            <Badge
                              key={item.validationId}
                              variant={item.required ? "secondary" : "outline"}
                            >
                              {safeDisplayText(item.label)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium">Acceptance criteria</h4>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                        {task.acceptanceCriteria.map((criterion, index) => (
                          <li key={`${task.taskId}-criterion-${index}`}>
                            {safeDisplayText(criterion, "")}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium">External links</h4>
                      <div className="mt-2">
                        <ExternalLinkList links={task.externalLinks} />
                      </div>
                    </div>

                    <TaskExecutionModeForm
                      hasAvailableLocalRunner={hasAvailableLocalRunner}
                      task={task}
                    />

                    {showRunnerEligibility ? (
                      <RunnerEligibilityPanel eligibility={runnerEligibility} />
                    ) : null}

                    {repairContext === null ? null : (
                      <TaskRepairRequestPanel context={repairContext} workspaceId={workspaceId} />
                    )}

                    <div>
                      <h4 className="text-sm font-medium">Actions</h4>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {actions.length === 0 ? (
                          <Badge variant="outline">No direct user action</Badge>
                        ) : (
                          actions.map((action) => (
                            <TaskStatusActionForm
                              action={action}
                              key={`${task.taskId}:${action.status}`}
                              runnerEligibility={runnerEligibility}
                              task={task}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
