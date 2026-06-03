import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  GitBranch,
  GitPullRequest,
  ListChecks,
} from "lucide-react";

import type { CortexTask, SetupPrPreview } from "@control-plane/shared";

import { createSetupPrFromPreviewAction, createSetupPrPreviewAction } from "@/src/server/actions";
import {
  hasUnsafeDisplayText,
  safeDisplayPath,
  safeDisplayText,
} from "@/components/display-safety";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function submitCreateSetupPrPreviewAction(formData: FormData): Promise<void> {
  "use server";

  await createSetupPrPreviewAction(formData);
}

async function submitCreateSetupPrFromPreviewAction(formData: FormData): Promise<void> {
  "use server";

  await createSetupPrFromPreviewAction(formData);
}

export type SetupPrFlowRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
};

type SetupPrFlowProps = {
  previews: SetupPrPreview[];
  repositories: SetupPrFlowRepository[];
  tasks: CortexTask[];
  workspaceId: string;
};

const statusLabels: Record<SetupPrPreview["status"], string> = {
  draft: "Draft",
  pr_created: "PR created",
  superseded: "Superseded",
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const isEligibleSetupTask = (task: CortexTask): boolean =>
  task.approvalStatus === "approved" &&
  task.executionMode === "setup_pr" &&
  task.riskLevel !== "blocked" &&
  task.status === "approved";

const repositoryLabel = (repositories: SetupPrFlowRepository[], repoId: string): string => {
  const repository = repositories.find((item) => item.id === repoId);

  if (repository === undefined) {
    return safeDisplayText(repoId);
  }

  return hasUnsafeDisplayText(repository.repositoryFullName)
    ? "Unavailable"
    : repository.repositoryFullName;
};

const readMetadataString = (metadata: SetupPrPreview["metadata"], key: string): string | null => {
  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readMetadataNumber = (metadata: SetupPrPreview["metadata"], key: string): number | null => {
  const value = metadata[key];

  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
};

const safePullRequestUrl = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

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

const groupTasksByRepo = (tasks: CortexTask[]): Array<{ repoId: string; tasks: CortexTask[] }> => {
  const groups = new Map<string, CortexTask[]>();

  for (const task of tasks) {
    const group = groups.get(task.repoId) ?? [];

    group.push(task);
    groups.set(task.repoId, group);
  }

  return Array.from(groups, ([repoId, group]) => ({
    repoId,
    tasks: group,
  }));
};

const previewStatusVariant = (status: SetupPrPreview["status"]) =>
  status === "pr_created" ? "secondary" : "outline";

export function SetupPrFlow({ previews, repositories, tasks, workspaceId }: SetupPrFlowProps) {
  const eligibleTasks = tasks.filter(isEligibleSetupTask);
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const taskGroups = groupTasksByRepo(eligibleTasks);
  const draftPreviewCount = previews.filter((preview) => preview.status === "draft").length;
  const createdPreviewCount = previews.filter((preview) => preview.status === "pr_created").length;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="setup-prs">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Setup PRs</p>
            <h2 id="setup-prs" className="mt-1 text-lg font-semibold tracking-normal">
              Setup PR generation
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {pluralize(eligibleTasks.length, "approved setup task")}
            </Badge>
            <Badge variant="outline">{pluralize(draftPreviewCount, "draft")}</Badge>
            <Badge variant="outline">
              {pluralize(createdPreviewCount, "PR created", "PR created")}
            </Badge>
          </div>
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="approved-setup-tasks"
      >
        <div className="flex items-center gap-2">
          <ListChecks aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2 id="approved-setup-tasks" className="text-base font-semibold">
            Approved setup tasks
          </h2>
        </div>

        {taskGroups.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No approved setup PR tasks yet.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {taskGroups.map((group) => (
              <form
                action={submitCreateSetupPrPreviewAction}
                className="rounded-lg border border-border bg-background p-4"
                key={group.repoId}
              >
                <input name="workspaceId" type="hidden" value={workspaceId} />
                <input name="repoId" type="hidden" value={group.repoId} />
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">
                      {repositoryLabel(repositories, group.repoId)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pluralize(group.tasks.length, "approved setup task")}
                    </p>
                  </div>
                  <Button type="submit">
                    <FilePlus2 aria-hidden="true" className="size-4" />
                    Create setup PR preview
                  </Button>
                </div>
                <div className="mt-4 grid gap-3">
                  {group.tasks.map((task) => (
                    <label
                      className="flex gap-3 rounded-md border border-border bg-card p-3 text-sm"
                      key={task.taskId}
                    >
                      <input
                        className="mt-1 size-4"
                        defaultChecked
                        name="taskId"
                        type="checkbox"
                        value={task.taskId}
                      />
                      <span>
                        <span className="font-medium">{safeDisplayText(task.title)}</span>
                        <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{safeDisplayText(task.taskId)}</span>
                          {task.findingIds.map((findingId) => (
                            <span key={findingId}>{safeDisplayText(findingId)}</span>
                          ))}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </form>
            ))}
          </div>
        )}
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="setup-pr-previews"
      >
        <div className="flex items-center gap-2">
          <GitPullRequest aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2 id="setup-pr-previews" className="text-base font-semibold">
            Setup PR previews
          </h2>
        </div>

        {previews.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No setup PR previews yet.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {previews.map((preview) => {
              const pullRequestNumber = readMetadataNumber(preview.metadata, "pullRequestNumber");
              const pullRequestUrl = safePullRequestUrl(
                readMetadataString(preview.metadata, "pullRequestUrl"),
              );
              const headBranch = readMetadataString(preview.metadata, "headBranch");

              return (
                <article
                  className="rounded-lg border border-border bg-background p-4"
                  key={preview.previewId}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">
                          {safeDisplayText(preview.previewId)}
                        </h3>
                        <Badge variant={previewStatusVariant(preview.status)}>
                          {statusLabels[preview.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {repositoryLabel(repositories, preview.repoId)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pullRequestUrl !== null && pullRequestNumber !== null ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={pullRequestUrl} rel="noreferrer" target="_blank">
                            <ExternalLink aria-hidden="true" className="size-4" />#
                            {pullRequestNumber}
                          </a>
                        </Button>
                      ) : null}
                      {preview.status === "draft" ? (
                        <form action={submitCreateSetupPrFromPreviewAction}>
                          <input name="workspaceId" type="hidden" value={workspaceId} />
                          <input name="previewId" type="hidden" value={preview.previewId} />
                          <Button size="sm" type="submit">
                            <GitBranch aria-hidden="true" className="size-4" />
                            Create draft setup PR
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>

                  {headBranch !== null ? (
                    <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                      <GitBranch aria-hidden="true" className="size-3" />
                      {safeDisplayText(headBranch)}
                    </p>
                  ) : null}

                  <div className="mt-4 grid gap-3">
                    {preview.files.map((file) => {
                      const filePath = safeDisplayPath(file.path) ?? "Unavailable";
                      const fileTasks = file.sourceTaskIds
                        .map((taskId) => taskById.get(taskId))
                        .filter((task): task is CortexTask => task !== undefined);
                      const fallbackTaskIds = file.sourceTaskIds.filter(
                        (taskId) => !taskById.has(taskId),
                      );

                      return (
                        <div
                          className="rounded-md border border-border bg-card p-3"
                          key={file.templateId}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <CheckCircle2
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                            <p className="text-sm font-medium">{filePath}</p>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {safeDisplayText(file.summary)}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {fileTasks.map((task) => (
                              <Badge key={task.taskId} variant="outline">
                                {safeDisplayText(task.title)}
                              </Badge>
                            ))}
                            {fallbackTaskIds.map((taskId) => (
                              <Badge key={taskId} variant="outline">
                                {safeDisplayText(taskId)}
                              </Badge>
                            ))}
                            {fileTasks.flatMap((task) =>
                              task.findingIds.map((findingId) => (
                                <Badge key={`${task.taskId}:${findingId}`} variant="secondary">
                                  {safeDisplayText(findingId)}
                                </Badge>
                              )),
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href="/dashboard/pull-requests">
            <GitPullRequest aria-hidden="true" className="size-4" />
            Pull Requests
          </Link>
        </Button>
      </div>
    </div>
  );
}
