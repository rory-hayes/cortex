import Link from "next/link";
import { ArrowLeft, ExternalLink, Send } from "lucide-react";

import { syncCortexTaskToGitHubIssueAction } from "@/src/server/actions";
import type { GitHubIssueSyncPageData, GitHubIssueSyncTaskOption } from "@/src/github/issues";
import { hasUnsafeDisplayText, safeDisplayText } from "@/components/display-safety";
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

async function submitSyncCortexTaskToGitHubIssueAction(formData: FormData): Promise<void> {
  "use server";

  await syncCortexTaskToGitHubIssueAction(formData);
}

type GitHubIssueSyncListProps = {
  data: GitHubIssueSyncPageData;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const safeTaskTitle = (task: GitHubIssueSyncTaskOption): string =>
  hasUnsafeDisplayText(task.title) ? safeDisplayText(task.taskId) : safeDisplayText(task.title);

export function GitHubIssueSyncList({ data }: GitHubIssueSyncListProps) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="github-issue-task-sync-list"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">GitHub Issues sync</p>
          <h2 id="github-issue-task-sync-list" className="mt-1 text-base font-semibold">
            Sync Cortex Tasks to GitHub Issues
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Push approved scan-generated Cortex Task metadata to GitHub Issues for teams that want
            issue-native tracking.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{pluralize(data.tasks.length, "eligible task")}</Badge>
            <Badge variant="secondary">Issues permission required</Badge>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to tasks
          </Link>
        </Button>
      </div>

      {data.tasks.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No eligible Cortex Tasks.</p>
          <p className="mt-2">
            Approved tasks from repo-readiness findings or task recommendations will appear here
            when the repository installation can create issues.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <Table aria-label="GitHub issue task sync">
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Task state</TableHead>
                <TableHead>Existing issue</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tasks.map((task) => (
                <TableRow key={task.taskId}>
                  <TableCell>
                    <div className="flex max-w-sm flex-col gap-2 whitespace-normal">
                      <span className="font-medium">{safeTaskTitle(task)}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {safeDisplayText(task.taskId)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{safeDisplayText(task.repositoryFullName)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{safeDisplayText(task.status)}</Badge>
                      <Badge variant="outline">{safeDisplayText(task.originType)}</Badge>
                      <Badge variant="outline">{safeDisplayText(task.executionMode)}</Badge>
                      <Badge variant={task.riskLevel === "high" ? "destructive" : "outline"}>
                        {safeDisplayText(task.riskLevel)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {task.existingGitHubIssueLink === null ? (
                      <Badge variant="outline">Not synced</Badge>
                    ) : (
                      <div className="flex max-w-xs flex-col gap-2 whitespace-normal">
                        <span className="text-sm font-medium">Existing GitHub issue</span>
                        <Badge variant="secondary">
                          {safeDisplayText(task.existingGitHubIssueLink.status)}
                        </Badge>
                        <a
                          className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                          href={task.existingGitHubIssueLink.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {safeDisplayText(task.existingGitHubIssueLink.title)}
                          <ExternalLink aria-hidden="true" className="size-3" />
                        </a>
                        {task.existingGitHubIssueLink.syncedAt === null ? null : (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(task.existingGitHubIssueLink.syncedAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.existingGitHubIssueLink === null ? (
                      <form
                        action={submitSyncCortexTaskToGitHubIssueAction}
                        className="flex flex-col gap-2"
                      >
                        <input name="workspaceId" type="hidden" value={data.workspaceId} />
                        <input name="taskId" type="hidden" value={task.taskId} />
                        <Button size="sm" type="submit">
                          <Send aria-hidden="true" className="size-4" />
                          Push to GitHub Issues
                        </Button>
                      </form>
                    ) : (
                      <Badge variant="outline">Already synced</Badge>
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
