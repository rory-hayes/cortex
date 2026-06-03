import Link from "next/link";

import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type OverviewRunnerHealthProps = {
  runnerHealth: WorkspaceDashboardOverview["runnerHealth"];
};

const formatDate = (value: Date | null) =>
  value === null
    ? "No heartbeat yet"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);

const statusLabels = {
  busy: "Busy",
  idle: "Idle",
  offline: "Offline",
  revoked: "Revoked",
} satisfies Record<WorkspaceDashboardOverview["runnerHealth"]["runners"][number]["status"], string>;

const statusVariant = (
  status: WorkspaceDashboardOverview["runnerHealth"]["runners"][number]["status"],
): "destructive" | "outline" | "secondary" => {
  if (status === "revoked") {
    return "destructive";
  }

  return status === "offline" ? "outline" : "secondary";
};

const formatToolSummary = (
  runner: WorkspaceDashboardOverview["runnerHealth"]["runners"][number],
) =>
  runner.capabilitiesSummary.availableTools.length === 0
    ? "No tools reported"
    : runner.capabilitiesSummary.availableTools.join(", ");

export function OverviewRunnerHealth({ runnerHealth }: OverviewRunnerHealthProps) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="runner-health"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Runner health</p>
          <h2 id="runner-health" className="mt-1 text-base font-semibold">
            Local executors
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{runnerHealth.online} online</Badge>
          <Badge variant="outline">{runnerHealth.offline} offline</Badge>
          <Badge variant={runnerHealth.revoked > 0 ? "destructive" : "outline"}>
            {runnerHealth.revoked} revoked
          </Badge>
        </div>
      </div>

      {runnerHealth.runners.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No runners paired.</p>
          <p className="mt-2">
            Pair a local runner before approving work into the execution queue.
          </p>
          <Button asChild className="mt-4" size="sm" variant="outline">
            <Link href="/dashboard/runners">Pair a local runner</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {runnerHealth.runners.map((runner) => (
            <li
              className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[1fr_1.4fr]"
              key={runner.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{runner.displayName}</p>
                  <Badge variant={statusVariant(runner.status)}>
                    {statusLabels[runner.status]}
                  </Badge>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {runner.id}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Last heartbeat: {formatDate(runner.lastHeartbeatAt)}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Reported tools: {formatToolSummary(runner)}
                </p>
                <div className="flex flex-wrap gap-1">
                  {runner.capabilitiesSummary.toolAvailability.map((tool) => (
                    <Badge key={tool.name} variant={tool.available ? "secondary" : "outline"}>
                      {tool.available ? tool.name : `${tool.name} missing`}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge
                    variant={runner.capabilitiesSummary.supportsDryRun ? "secondary" : "outline"}
                  >
                    {runner.capabilitiesSummary.supportsDryRun ? "Dry run" : "Dry run unsupported"}
                  </Badge>
                  <Badge
                    variant={
                      runner.capabilitiesSummary.supportsCancellation ? "secondary" : "outline"
                    }
                  >
                    {runner.capabilitiesSummary.supportsCancellation
                      ? "Cancellation"
                      : "Cancellation unsupported"}
                  </Badge>
                  <Badge variant="outline">
                    Max concurrency {runner.capabilitiesSummary.maxConcurrentJobs}
                  </Badge>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
