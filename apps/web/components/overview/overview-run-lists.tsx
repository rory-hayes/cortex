import Link from "next/link";

import { EvidenceSummary } from "@/components/evidence-summary";
import { PrStatusBadge, RunStatusBadge } from "@/components/run-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";

type OverviewRunListsProps = {
  activeRuns: WorkspaceDashboardOverview["activeRuns"];
  awaitingApprovalRuns: WorkspaceDashboardOverview["awaitingApprovalRuns"];
  blockedRuns: WorkspaceDashboardOverview["blockedRuns"];
  recentRuns: WorkspaceDashboardOverview["recentRuns"];
};

type OverviewRunSummary = WorkspaceDashboardOverview["recentRuns"][number];

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const modeLabels = {
  dryRun: "Dry run",
  execute: "Execute",
  repair: "Repair",
} satisfies Record<OverviewRunSummary["mode"], string>;

const renderRunner = (run: OverviewRunSummary) =>
  run.runner === null ? "Unassigned" : `${run.runner.displayName} (${run.runner.id})`;

function OverviewRunRow({
  run,
  showTraceLink = false,
}: {
  run: OverviewRunSummary;
  showTraceLink?: boolean;
}) {
  return (
    <li className="grid gap-4 py-4 first:pt-0 last:pb-0 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge state={run.state} />
          <Badge variant="outline">{modeLabels[run.mode]}</Badge>
        </div>
        <p className="mt-2 font-medium">{run.task.title}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="break-all font-mono">{run.id}</span>
          <span className="break-all font-mono">{run.task.id}</span>
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {run.repository.owner}/{run.repository.name}
        </p>
        <p className="mt-1 break-words text-muted-foreground">{renderRunner(run)}</p>
        <p className="mt-1 text-muted-foreground">Updated {formatDate(run.updatedAt)}</p>
        {run.pr === null ? (
          <p className="mt-2 text-muted-foreground">No PR yet</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PrStatusBadge status={run.pr.status} />
            <span className="font-mono text-xs text-muted-foreground">#{run.pr.number}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <EvidenceSummary
          blockerCount={run.risk.blockerCount}
          changedFileCount={run.changedFileCount}
          compact
          riskCategoryCounts={run.risk.categoryCounts}
          validationStatusCounts={run.validationStatusCounts}
          warningCount={run.risk.warningCount}
        />
        {showTraceLink ? (
          <Button asChild size="xs" variant="outline">
            <Link href={`/dashboard?runId=${encodeURIComponent(run.id)}`}>View trace</Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function OverviewRunSection({
  emptyDescription,
  emptyTitle,
  runs,
  showTraceLinks = false,
  title,
}: {
  emptyDescription: string;
  emptyTitle: string;
  runs: OverviewRunSummary[];
  showTraceLinks?: boolean;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={title} className="text-base font-semibold">
          {title}
        </h2>
        <Badge variant="outline">{runs.length}</Badge>
      </div>
      {runs.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>{emptyTitle}</p>
          <p className="mt-2">{emptyDescription}</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {runs.map((run) => (
            <OverviewRunRow key={run.id} run={run} showTraceLink={showTraceLinks} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function OverviewRunLists({
  activeRuns,
  awaitingApprovalRuns,
  blockedRuns,
  recentRuns,
}: OverviewRunListsProps) {
  return (
    <div className="grid gap-5">
      <OverviewRunSection
        emptyDescription="Approved work appears here after a runner claims a job."
        emptyTitle="No active runs."
        runs={activeRuns}
        title="Active runs"
      />
      <OverviewRunSection
        emptyDescription="Safety gates and validation failures will surface here for review."
        emptyTitle="No blocked or failed runs."
        runs={blockedRuns}
        title="Blocked or failed"
      />
      <OverviewRunSection
        emptyDescription="Validated PR metadata appears here when human review is needed."
        emptyTitle="No approval-needed runs."
        runs={awaitingApprovalRuns}
        title="Approval needed"
      />
      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="recent-runs"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Recent runs</p>
            <h2 id="recent-runs" className="mt-1 text-base font-semibold">
              Latest runner activity
            </h2>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/tasks/new">Create a manual task</Link>
          </Button>
        </div>
        {recentRuns.length === 0 ? (
          <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
            <p>No recent runs.</p>
            <p className="mt-2">
              Create a manual task, approve it into the queue, then pair a runner to start work.
            </p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-border">
            {recentRuns.map((run) => (
              <OverviewRunRow key={run.id} run={run} showTraceLink />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
