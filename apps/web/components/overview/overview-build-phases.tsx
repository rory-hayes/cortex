import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";
import { Badge } from "@/components/ui/badge";

type OverviewBuildPhasesProps = {
  buildPhases: WorkspaceDashboardOverview["buildPhases"];
};

const statusLabels = {
  completed: "Completed",
  current: "Current",
  upcoming: "Upcoming",
} satisfies Record<WorkspaceDashboardOverview["buildPhases"][number]["status"], string>;

const statusVariant = (
  status: WorkspaceDashboardOverview["buildPhases"][number]["status"],
): "outline" | "secondary" =>
  status === "completed" || status === "current" ? "secondary" : "outline";

export function OverviewBuildPhases({ buildPhases }: OverviewBuildPhasesProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="build-phases">
      <p className="text-sm font-medium text-muted-foreground">Build phase status</p>
      <h2 id="build-phases" className="mt-1 text-base font-semibold">
        MVP sequence
      </h2>
      <ol className="mt-5 divide-y divide-border">
        {buildPhases.map((phase) => (
          <li
            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            key={phase.id}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{phase.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">Phase {phase.order}</p>
            </div>
            <Badge variant={statusVariant(phase.status)}>{statusLabels[phase.status]}</Badge>
          </li>
        ))}
      </ol>
    </section>
  );
}
