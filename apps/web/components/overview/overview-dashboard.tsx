import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";

import { OverviewActionability } from "./overview-actionability";
import { OverviewBuildPhases } from "./overview-build-phases";
import { OverviewRunLists } from "./overview-run-lists";
import { OverviewRunTrace } from "./overview-run-trace";
import { OverviewRunnerHealth } from "./overview-runner-health";
import { OverviewSummaryCards } from "./overview-summary-cards";
import { RepoReadinessOnboarding } from "./repo-readiness-onboarding";

type OverviewDashboardProps = {
  overview: WorkspaceDashboardOverview;
  workspaceName: string;
};

export function OverviewDashboard({ overview, workspaceName }: OverviewDashboardProps) {
  if (!overview.repoReadinessOnboarding.hasAnyScans) {
    return (
      <RepoReadinessOnboarding
        onboarding={overview.repoReadinessOnboarding}
        workspaceName={workspaceName}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">
            What can safely move forward today?
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {workspaceName} scan findings, AI-ready tasks, runner readiness, and human approvals in
            one metadata-only view.
          </p>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          Local execution boundary intact
        </div>
      </header>

      <OverviewActionability actionability={overview.actionability} />
      <OverviewSummaryCards summaryCards={overview.summaryCards} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <OverviewRunLists
          activeRuns={overview.activeRuns}
          awaitingApprovalRuns={overview.awaitingApprovalRuns}
          blockedRuns={overview.blockedRuns}
          recentRuns={overview.recentRuns}
        />
        <aside className="flex flex-col gap-5">
          <OverviewRunnerHealth runnerHealth={overview.runnerHealth} />
          <OverviewRunTrace selectedRunTrace={overview.selectedRunTrace} />
          <OverviewBuildPhases buildPhases={overview.buildPhases} />
        </aside>
      </div>
    </div>
  );
}
