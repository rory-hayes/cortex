import type { RunEventSeverity } from "@control-plane/shared";

import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";
import { RunStatusBadge } from "@/components/run-status-badge";
import { Badge } from "@/components/ui/badge";

type OverviewRunTraceProps = {
  selectedRunTrace: WorkspaceDashboardOverview["selectedRunTrace"];
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const severityLabels = {
  blocked: "Blocked",
  debug: "Debug",
  error: "Error",
  info: "Info",
  warning: "Warning",
} satisfies Record<RunEventSeverity, string>;

const severityVariant = (severity: RunEventSeverity): "destructive" | "outline" | "secondary" => {
  if (severity === "blocked" || severity === "error") {
    return "destructive";
  }

  return severity === "warning" ? "outline" : "secondary";
};

export function OverviewRunTrace({ selectedRunTrace }: OverviewRunTraceProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="run-trace">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Selected run trace</p>
          <h2 id="run-trace" className="mt-1 text-base font-semibold">
            {selectedRunTrace.runId ?? "No run selected"}
          </h2>
        </div>
      </div>

      {selectedRunTrace.runId === null ? (
        <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          Run trace appears after runner events are submitted.
        </p>
      ) : selectedRunTrace.events.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No events recorded.</p>
          <p className="mt-2">Runner events will appear here after submission.</p>
        </div>
      ) : (
        <ol className="mt-5 divide-y divide-border">
          {selectedRunTrace.events.map((event) => (
            <li
              className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[11rem_minmax(0,1fr)]"
              key={event.id}
            >
              <div className="text-sm text-muted-foreground">
                <time dateTime={event.createdAt.toISOString()}>{formatDate(event.createdAt)}</time>
                <p className="mt-1 break-all font-mono text-xs">
                  {event.runnerId ?? "Runner unavailable"}
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <RunStatusBadge state={event.state} />
                  <Badge variant={severityVariant(event.severity)}>
                    {severityLabels[event.severity]}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6">{event.message}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
