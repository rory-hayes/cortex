import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { isTerminalRunState } from "@control-plane/shared";

import { CancelRunButton } from "@/components/cancel-run-button";
import { ApprovalReviewPanel } from "@/components/approval-review-panel";
import { DryRunResultDisplay } from "@/components/dry-run-result";
import { PrArtifactDisplay } from "@/components/pr-artifact";
import { RequestRepairDialog } from "@/components/request-repair-dialog";
import { RunCortexTaskContextPanel } from "@/components/run-cortex-task-context";
import { RunTimeline } from "@/components/run-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ValidationResultDisplay } from "@/components/validation-result";
import { getDatabase } from "@/src/db";
import {
  createDrizzleRunDetailStore,
  createRunDetailService,
  type RunDetail,
} from "@/src/runs/detail";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const runStateLabels = {
  awaiting_approval: "Awaiting approval",
  blocked: "Blocked",
  cancel_requested: "Cancel requested",
  cancelled: "Cancelled",
  cancelling: "Cancelling",
  changes_scanned: "Changes scanned",
  claimed: "Claimed",
  codex_running: "Codex running",
  completed: "Completed",
  dry_run_passed: "Dry run passed",
  dry_run_running: "Dry run running",
  failed: "Failed",
  preflight: "Preflight",
  pr_opened: "PR opened",
  pushed: "Pushed",
  queued: "Queued",
  repair_requested: "Repair requested",
  validation_running: "Validation running",
  worktree_created: "Worktree created",
} satisfies Record<RunDetail["state"], string>;

const runModeLabels = {
  dryRun: "Dry run",
  execute: "Execute",
  repair: "Repair",
} satisfies Record<RunDetail["mode"], string>;

const getServices = () => {
  const { db } = getDatabase();

  return {
    runDetailService: createRunDetailService({
      store: createDrizzleRunDetailStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { runDetailService, workspaceService: service } = getServices();
  const verifiedWorkspace =
    cookieWorkspaceId === null
      ? null
      : await service
          .selectWorkspace({ workspaceId: cookieWorkspaceId })
          .catch((error: unknown) => {
            if (
              isServerActionError(error) &&
              (error.code === "forbidden" || error.code === "validation_error")
            ) {
              return null;
            }

            throw error;
          });

  if (verifiedWorkspace === null) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/dashboard/runs">
                <ArrowLeft aria-hidden="true" className="size-4" />
                Runs
              </Link>
            </Button>
            <p className="mt-4 text-sm font-medium text-muted-foreground">Run detail</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Select workspace</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before run metadata can be displayed.
            </p>
          </div>
        </header>

        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <Activity aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before run metadata can be displayed.
            </p>
          </div>
          <Button asChild className="mt-5">
            <Link href="/workspaces">
              <ArrowRight aria-hidden="true" className="size-4" />
              Select workspace
            </Link>
          </Button>
        </section>
      </div>
    );
  }

  const runDetail = await runDetailService
    .getRunDetail({
      runId,
      workspaceId: verifiedWorkspace.workspaceId,
    })
    .catch((error: unknown) => {
      if (
        isServerActionError(error) &&
        (error.code === "forbidden" || error.code === "validation_error")
      ) {
        return null;
      }

      throw error;
    });

  if (runDetail === null) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/dashboard/runs">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Runs
            </Link>
          </Button>
          <p className="mt-4 text-sm font-medium text-muted-foreground">Run detail</p>
          <h1 className="mt-1 break-all text-2xl font-semibold tracking-normal">{runDetail.id}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Inspect the selected workspace timeline for this run. Local execution stays on the
            runner.
          </p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Badge variant="secondary">{runStateLabels[runDetail.state]}</Badge>
            <Badge variant="outline">{runModeLabels[runDetail.mode]}</Badge>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <RequestRepairDialog
              attemptCount={runDetail.repair.attemptCount}
              disabled={!runDetail.repair.canRequestRepair}
              disabledReason={runDetail.repair.disabledReason ?? ""}
              maxAttempts={runDetail.repair.maxAttempts}
              nextAttempt={runDetail.repair.nextAttempt}
              previousRunId={runDetail.id}
              remainingAttempts={runDetail.repair.remainingAttempts}
              workspaceId={runDetail.workspaceId}
            />
            {!isTerminalRunState(runDetail.state) && (
              <CancelRunButton runId={runDetail.id} workspaceId={runDetail.workspaceId} />
            )}
          </div>
        </div>
      </header>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="run-boundary"
      >
        <div className="flex max-w-3xl gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 id="run-boundary" className="text-base font-semibold">
              Run coordination metadata only
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This view shows state, severity, messages, timestamps, event metadata, validation
              labels, validation statuses, exit codes, durations, redacted summaries, dry-run
              readiness, PR metadata, changed file paths, and risk flags for {verifiedWorkspace.name}
              . It does not show raw runner output, full command strings, diffs, patches, source
              snippets, change contents, code excerpts, secrets, or machine-local filesystem paths.
            </p>
          </div>
        </div>
      </section>

      <RunCortexTaskContextPanel
        context={runDetail.cortexTask}
        pr={runDetail.pr}
        validationResults={runDetail.validationResults}
      />

      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="run-summary">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Summary</p>
          <h2 id="run-summary" className="text-base font-semibold">
            Run metadata
          </h2>
        </div>

        <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Task</dt>
            <dd className="mt-1 text-sm font-medium">{runDetail.task.title}</dd>
            <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {runDetail.task.id}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Repository mapping</dt>
            <dd className="mt-1 text-sm font-medium">
              {runDetail.repoMapping.repositoryOwner}/{runDetail.repoMapping.repositoryName}
            </dd>
            <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {runDetail.repoMapping.id}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Runner</dt>
            {runDetail.runner === null ? (
              <dd className="mt-1 text-sm text-muted-foreground">Unassigned</dd>
            ) : (
              <>
                <dd className="mt-1 text-sm font-medium">{runDetail.runner.displayName}</dd>
                <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {runDetail.runner.id}
                </dd>
              </>
            )}
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm font-medium">{formatDate(runDetail.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm font-medium">{formatDate(runDetail.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Repair attempts</dt>
            <dd className="mt-1 text-sm font-medium">
              {runDetail.repair.attemptCount} of {runDetail.repair.maxAttempts}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              {runDetail.repair.remainingAttempts} remaining; next attempt{" "}
              {runDetail.repair.nextAttempt}
            </dd>
          </div>
        </dl>
      </section>

      <DryRunResultDisplay result={runDetail.dryRunResult} />
      <ValidationResultDisplay results={runDetail.validationResults} />
      <PrArtifactDisplay artifact={runDetail.pr} />
      <ApprovalReviewPanel runDetail={runDetail} />

      <RunTimeline events={runDetail.timeline} />
    </div>
  );
}
