import Link from "next/link";
import { CheckCircle2, FileDown, PlusCircle, Send } from "lucide-react";

import { approveManualTaskAction } from "@/src/server/actions";
import type {
  TaskWorkflowBucket,
  TaskWorkflowFilter,
  TaskWorkflowItem,
} from "@/src/tasks/workflow";
import { EvidenceSummary } from "@/components/evidence-summary";
import { hasUnsafeDisplayText, safeDisplayText } from "@/components/display-safety";
import { RunStatusBadge } from "@/components/run-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

async function submitApproveManualTaskAction(formData: FormData): Promise<void> {
  "use server";

  await approveManualTaskAction(formData);
}

export type TaskListRepoMapping = {
  id: string;
  label: string;
};

type TaskListProps = {
  repoMappings?: TaskListRepoMapping[];
  tasks: TaskWorkflowItem[];
  workflowFilter?: TaskWorkflowFilter;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const modeLabels: Record<TaskWorkflowItem["mode"], string> = {
  dryRun: "Dry run",
  execute: "Execute",
  repair: "Repair",
};

const sourceTypeLabels: Record<string, string> = {
  linear: "Linear",
  manual: "Manual",
  repair: "Repair",
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const workflowFilterLinks = [
  { href: "/dashboard/tasks", label: "All work", value: "all" },
  { href: "/dashboard/tasks?workflow=draft", label: "Drafts", value: "draft" },
  { href: "/dashboard/tasks?workflow=queued", label: "Queued", value: "queued" },
  { href: "/dashboard/tasks?workflow=running", label: "Running", value: "running" },
  {
    href: "/dashboard/tasks?workflow=blocked_failed",
    label: "Blocked/failed",
    value: "blocked_failed",
  },
  {
    href: "/dashboard/tasks?workflow=awaiting_approval",
    label: "Awaiting approval",
    value: "awaiting_approval",
  },
  { href: "/dashboard/tasks?workflow=pr_ready", label: "PR-ready", value: "pr_ready" },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  value: TaskWorkflowFilter;
}>;

const bucketCount = (tasks: TaskWorkflowItem[], bucket: TaskWorkflowFilter): number =>
  bucket === "all" ? tasks.length : tasks.filter((task) => task.workflow.bucket === bucket).length;

const summaryCount = (tasks: TaskWorkflowItem[], bucket: TaskWorkflowBucket): number =>
  tasks.filter((task) => task.workflow.bucket === bucket).length;

const filterTasks = (
  tasks: TaskWorkflowItem[],
  workflowFilter: TaskWorkflowFilter,
): TaskWorkflowItem[] =>
  workflowFilter === "all"
    ? tasks
    : tasks.filter((task) => task.workflow.bucket === workflowFilter);

const safeRepositoryLabel = (task: TaskWorkflowItem): string => {
  const owner = task.repoMapping.repositoryOwner;
  const name = task.repoMapping.repositoryName;

  return hasUnsafeDisplayText(owner) || hasUnsafeDisplayText(name)
    ? "Unavailable"
    : `${owner}/${name}`;
};

export function TaskList({ tasks, workflowFilter = "all" }: TaskListProps) {
  const filteredTasks = filterTasks(tasks, workflowFilter);
  const draftCount = summaryCount(tasks, "draft");
  const queuedCount = summaryCount(tasks, "queued");
  const runningCount = summaryCount(tasks, "running");
  const blockedOrFailedCount = summaryCount(tasks, "blocked_failed");
  const awaitingApprovalCount = summaryCount(tasks, "awaiting_approval");
  const prReadyCount = summaryCount(tasks, "pr_ready");

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="tasks-list">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Workspace tasks</p>
          <h2 id="tasks-list" className="mt-1 text-base font-semibold">
            Workflow queue
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Manual tasks remain visible with approval, queue, run, review, and PR-ready state.
            Source files and runner execution stay local.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{pluralize(draftCount, "draft")}</Badge>
            <Badge variant="secondary">{pluralize(queuedCount, "queued", "queued")}</Badge>
            <Badge variant="outline">{pluralize(runningCount, "running", "running")}</Badge>
            <Badge variant={blockedOrFailedCount > 0 ? "destructive" : "outline"}>
              {blockedOrFailedCount} blocked/failed
            </Badge>
            <Badge variant="outline">{awaitingApprovalCount} awaiting approval</Badge>
            <Badge variant="secondary">{prReadyCount} PR-ready</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {workflowFilterLinks.map((filter) => (
              <Button
                asChild
                key={filter.value}
                size="xs"
                variant={workflowFilter === filter.value ? "secondary" : "outline"}
              >
                <Link href={filter.href}>
                  {filter.label}
                  <Badge variant="secondary">{bucketCount(tasks, filter.value)}</Badge>
                </Link>
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks/sync-github-issues">
              <Send aria-hidden="true" className="size-4" />
              Sync to GitHub Issues
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks/sync-linear">
              <Send aria-hidden="true" className="size-4" />
              Sync to Linear
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks/import-linear">
              <FileDown aria-hidden="true" className="size-4" />
              Import from Linear
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/tasks/new">
              <PlusCircle aria-hidden="true" className="size-4" />
              Create manual task
            </Link>
          </Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No manual tasks yet.</p>
          <p className="mt-2">
            Create a draft from mapped repository metadata. Source files and execution stay local.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/dashboard/tasks/new">
              <PlusCircle aria-hidden="true" className="size-4" />
              Create first manual task
            </Link>
          </Button>
          <Button asChild className="ml-2 mt-4" variant="outline">
            <Link href="/dashboard/tasks/import-linear">
              <FileDown aria-hidden="true" className="size-4" />
              Import from Linear
            </Link>
          </Button>
          <Button asChild className="ml-2 mt-4" variant="outline">
            <Link href="/dashboard/tasks/sync-github-issues">
              <Send aria-hidden="true" className="size-4" />
              Sync to GitHub Issues
            </Link>
          </Button>
          <Button asChild className="ml-2 mt-4" variant="outline">
            <Link href="/dashboard/tasks/sync-linear">
              <Send aria-hidden="true" className="size-4" />
              Sync to Linear
            </Link>
          </Button>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No tasks match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/tasks">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filteredTasks.length} of {tasks.length} tasks.
          </p>
          <Table aria-label="Manual tasks">
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{safeDisplayText(task.title)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span className="font-medium">{safeRepositoryLabel(task)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <Badge
                        variant={
                          task.workflow.bucket === "blocked_failed" ? "destructive" : "outline"
                        }
                      >
                        {safeDisplayText(task.workflow.label)}
                      </Badge>
                      {task.latestRun === null ? null : (
                        <>
                          <RunStatusBadge state={task.latestRun.state} />
                          <EvidenceSummary
                            blockerCount={task.latestRun.risk.blockerCount}
                            changedFileCount={0}
                            compact
                            riskCategoryCounts={task.latestRun.risk.riskCategoryCounts}
                            validationStatusCounts={task.latestRun.validationStatusCounts}
                            warningCount={task.latestRun.risk.warningCount}
                          />
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{modeLabels[task.mode]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {sourceTypeLabels[task.sourceType] ?? task.sourceType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {task.requestedByActorId === null
                      ? "Unknown actor"
                      : safeDisplayText(task.requestedByActorId)}
                  </TableCell>
                  <TableCell>{formatDate(task.updatedAt)}</TableCell>
                  <TableCell>
                    {task.status === "draft" ? (
                      <form action={submitApproveManualTaskAction}>
                        <input name="workspaceId" type="hidden" value={task.workspaceId} />
                        <input name="taskId" type="hidden" value={task.id} />
                        <Button size="sm" type="submit" variant="outline">
                          <CheckCircle2 aria-hidden="true" className="size-4" />
                          Approve to run
                        </Button>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="text-sm text-muted-foreground">
                          {safeDisplayText(task.workflow.label)}
                        </span>
                        {task.latestRun === null ? null : (
                          <Button asChild size="xs" variant="ghost">
                            <Link href={`/dashboard/runs/${encodeURIComponent(task.latestRun.id)}`}>
                              View run
                            </Link>
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
