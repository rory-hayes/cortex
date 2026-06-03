import Link from "next/link";

import type { RunnerListItem, RunnerStatus } from "@/src/runners/list";
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

export type RunnerListStatusFilter = RunnerStatus | "all" | "no_heartbeat";

type RunnerListProps = {
  filterBasePath?: string;
  revokeRunner: (formData: FormData) => Promise<void> | void;
  runners: RunnerListItem[];
  statusFilter?: RunnerListStatusFilter;
  workspaceId: string;
};

const formatDate = (value: Date | null) =>
  value === null
    ? "No heartbeat yet"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);

const formatRevokedAt = (value: Date | null) =>
  value === null ? "Revoked" : `Revoked ${formatDate(value)}`;

const statusVariant = (runner: RunnerListItem) => {
  if (runner.status === "revoked") {
    return "destructive";
  }

  return runner.status === "offline" ? "outline" : "secondary";
};

const statusLabels = {
  busy: "Busy",
  idle: "Idle",
  offline: "Offline",
  revoked: "Revoked",
} satisfies Record<RunnerStatus, string>;

const filterOptions = [
  { label: "All", value: "all" },
  { label: "Idle", value: "idle" },
  { label: "Busy", value: "busy" },
  { label: "Offline", value: "offline" },
  { label: "Revoked", value: "revoked" },
  { label: "No heartbeat", value: "no_heartbeat" },
] satisfies Array<{ label: string; value: RunnerListStatusFilter }>;

const getFilterHref = (basePath: string, filter: RunnerListStatusFilter) =>
  filter === "all" ? basePath : `${basePath}?status=${filter}`;

const formatToolSummary = (runner: RunnerListItem) =>
  runner.capabilitiesSummary.availableTools.length === 0
    ? "No tools reported"
    : runner.capabilitiesSummary.availableTools.join(", ");

export function RunnerList({
  filterBasePath = "/dashboard/runners",
  revokeRunner,
  runners,
  statusFilter = "all",
  workspaceId,
}: RunnerListProps) {
  const counts = {
    all: runners.length,
    busy: runners.filter((runner) => runner.status === "busy").length,
    idle: runners.filter((runner) => runner.status === "idle").length,
    no_heartbeat: runners.filter((runner) => runner.lastHeartbeatAt === null).length,
    offline: runners.filter((runner) => runner.status === "offline").length,
    revoked: runners.filter((runner) => runner.status === "revoked").length,
  } satisfies Record<RunnerListStatusFilter, number>;
  const filteredRunners =
    statusFilter === "all"
      ? runners
      : statusFilter === "no_heartbeat"
        ? runners.filter((runner) => runner.lastHeartbeatAt === null)
        : runners.filter((runner) => runner.status === statusFilter);

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="runners-list">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Workspace runners</p>
        <h2 id="runners-list" className="text-base font-semibold">
          Paired runners
        </h2>
      </div>

      <div className="mt-5 grid gap-3 border-y border-border py-3 text-sm md:grid-cols-5">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Total</p>
          <p className="mt-1 font-medium">
            {counts.all} {counts.all === 1 ? "paired runner" : "paired runners"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Idle</p>
          <p className="mt-1 font-medium">{counts.idle} idle</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Busy</p>
          <p className="mt-1 font-medium">{counts.busy} busy</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Offline</p>
          <p className="mt-1 font-medium">{counts.offline} offline</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Revoked</p>
          <p className="mt-1 font-medium">{counts.revoked} revoked</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Runner status filters">
        {filterOptions.map((filter) => (
          <Button
            asChild
            key={filter.value}
            size="xs"
            variant={statusFilter === filter.value ? "secondary" : "outline"}
          >
            <Link href={getFilterHref(filterBasePath, filter.value)}>
              {filter.label} {counts[filter.value]}
            </Link>
          </Button>
        ))}
      </div>

      {runners.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No runners paired.</p>
          <p className="mt-2">
            Pair a local runner from this page. The web app coordinates metadata; execution stays on
            the runner.
          </p>
        </div>
      ) : filteredRunners.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No runners match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={filterBasePath}>Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <Table aria-label="Paired runners">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Connection status</TableHead>
                <TableHead>Last heartbeat</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Linked</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRunners.map((runner) => (
                <TableRow key={runner.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{runner.displayName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{runner.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={statusVariant(runner)}>{statusLabels[runner.status]}</Badge>
                      {runner.isRevoked ? (
                        <span className="text-xs text-muted-foreground">
                          {formatRevokedAt(runner.revokedAt)}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(runner.lastHeartbeatAt)}</TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-col gap-2 whitespace-normal">
                      <span className="text-xs text-muted-foreground">
                        Reported tools: {formatToolSummary(runner)}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {runner.capabilitiesSummary.toolAvailability.map((tool) => (
                          <Badge key={tool.name} variant={tool.available ? "secondary" : "outline"}>
                            {tool.available ? tool.name : `${tool.name} missing`}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={
                            runner.capabilitiesSummary.supportsDryRun ? "secondary" : "outline"
                          }
                        >
                          {runner.capabilitiesSummary.supportsDryRun
                            ? "Dry run"
                            : "Dry run unsupported"}
                        </Badge>
                        <Badge
                          variant={
                            runner.capabilitiesSummary.supportsCancellation
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {runner.capabilitiesSummary.supportsCancellation
                            ? "Cancellation"
                            : "Cancellation unsupported"}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Max concurrency {runner.capabilitiesSummary.maxConcurrentJobs}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(runner.linkedAt)}</TableCell>
                  <TableCell className="text-right">
                    <form action={revokeRunner} className="flex justify-end">
                      <input name="workspaceId" type="hidden" value={workspaceId} />
                      <input name="runnerId" type="hidden" value={runner.id} />
                      <Button disabled={runner.isRevoked} type="submit" variant="outline">
                        {runner.isRevoked ? "Revoked" : "Revoke"}
                      </Button>
                    </form>
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
