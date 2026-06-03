import Link from "next/link";
import { ArrowLeft, ExternalLink, RefreshCw, Send } from "lucide-react";

import { syncCortexTaskToLinearAction } from "@/src/server/actions";
import type { LinearTaskSyncPageData, LinearTaskSyncTaskOption } from "@/src/linear/task-sync";
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

async function submitSyncCortexTaskToLinearAction(formData: FormData): Promise<void> {
  "use server";

  await syncCortexTaskToLinearAction(formData);
}

type LinearTaskSyncListProps = {
  data: LinearTaskSyncPageData;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const safeTaskTitle = (task: LinearTaskSyncTaskOption): string =>
  hasUnsafeDisplayText(task.title) ? safeDisplayText(task.taskId) : safeDisplayText(task.title);

const hasSelectableOptions = (data: LinearTaskSyncPageData): boolean =>
  data.connections.length > 0 && data.selectedConnectionId !== null && data.teams.length > 0;

export function LinearTaskSyncList({ data }: LinearTaskSyncListProps) {
  const canSync = hasSelectableOptions(data);
  const selectedConnectionId = data.selectedConnectionId ?? data.connections[0]?.id ?? "";
  const selectedConnection = data.connections.find(
    (connection) => connection.id === selectedConnectionId,
  );

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="linear-task-sync-list"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Linear sync</p>
          <h2 id="linear-task-sync-list" className="mt-1 text-base font-semibold">
            Sync Cortex Tasks to Linear
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Push approved scan-generated Cortex Task metadata to Linear after selecting the
            connection, team, optional project, and status.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={data.connections.length > 0 ? "secondary" : "destructive"}>
              {data.connections.length > 0
                ? pluralize(data.connections.length, "connection")
                : "Active Linear connection required"}
            </Badge>
            <Badge variant="outline">{pluralize(data.tasks.length, "eligible task")}</Badge>
            <Badge variant={data.teams.length > 0 ? "outline" : "destructive"}>
              {data.teams.length > 0 ? pluralize(data.teams.length, "team") : "Team required"}
            </Badge>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to tasks
          </Link>
        </Button>
      </div>

      {data.connections.length === 0 ? null : (
        <form
          action="/dashboard/tasks/sync-linear"
          className="mt-5 flex flex-col gap-3 border-y border-border py-4 md:flex-row md:items-end"
          method="get"
        >
          <label className="min-w-72 text-xs font-medium text-muted-foreground">
            Connection
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={selectedConnectionId}
              name="linearConnectionId"
            >
              {data.connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {safeDisplayText(connection.linearWorkspaceName)}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" type="submit" variant="outline">
            <RefreshCw aria-hidden="true" className="size-4" />
            Load options
          </Button>
          {selectedConnection === undefined ? null : (
            <span className="text-sm text-muted-foreground">
              Selected: {safeDisplayText(selectedConnection.linearWorkspaceName)}
            </span>
          )}
        </form>
      )}

      {data.tasks.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No eligible Cortex Tasks.</p>
          <p className="mt-2">
            Approved tasks from repo-readiness findings or task recommendations will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <Table aria-label="Linear task sync">
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Task state</TableHead>
                <TableHead>Linear selection</TableHead>
                <TableHead>Existing link</TableHead>
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
                    <form
                      action={submitSyncCortexTaskToLinearAction}
                      className="grid min-w-64 gap-2"
                    >
                      <input name="workspaceId" type="hidden" value={data.workspaceId} />
                      <input name="taskId" type="hidden" value={task.taskId} />
                      <input name="linearConnectionId" type="hidden" value={selectedConnectionId} />
                      <label className="text-xs font-medium text-muted-foreground">
                        Team
                        <select
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          disabled={data.teams.length === 0}
                          name="teamId"
                        >
                          {data.teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.key === undefined
                                ? safeDisplayText(team.name)
                                : `${safeDisplayText(team.key)} ${safeDisplayText(team.name)}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-muted-foreground">
                        Project
                        <select
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          name="projectId"
                        >
                          <option value="">No project</option>
                          {data.projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {safeDisplayText(project.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-muted-foreground">
                        Status
                        <select
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          name="statusId"
                        >
                          <option value="">Leave unchanged</option>
                          {data.workflowStates.map((state) => (
                            <option key={state.id} value={state.id}>
                              {safeDisplayText(state.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button disabled={!canSync} size="sm" type="submit">
                        <Send aria-hidden="true" className="size-4" />
                        {task.existingLinearLink === null ? "Push to Linear" : "Update Linear"}
                      </Button>
                    </form>
                  </TableCell>
                  <TableCell>
                    {task.existingLinearLink === null ? (
                      <Badge variant="outline">Not synced</Badge>
                    ) : (
                      <div className="flex max-w-xs flex-col gap-2 whitespace-normal">
                        <span className="text-sm font-medium">Existing Linear link</span>
                        <Badge variant="secondary">
                          {safeDisplayText(task.existingLinearLink.status)}
                        </Badge>
                        <a
                          className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                          href={task.existingLinearLink.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {safeDisplayText(task.existingLinearLink.title)}
                          <ExternalLink aria-hidden="true" className="size-3" />
                        </a>
                        {task.existingLinearLink.syncedAt === null ? null : (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(task.existingLinearLink.syncedAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {task.existingLinearLink === null ? "Create issue" : "Update status"}
                    </Badge>
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
