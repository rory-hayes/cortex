import Link from "next/link";
import { cookies } from "next/headers";
import { Activity, ArrowRight, ShieldCheck } from "lucide-react";

import { RunTable, type RunListStateFilter } from "@/components/run-table";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import { createDrizzleRunListStore, createRunListService } from "@/src/runs/list";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const runStateFilters = new Set<RunListStateFilter>([
  "all",
  "awaiting_approval",
  "blocked",
  "cancelled",
  "completed",
  "failed",
  "pr_ready",
  "ready",
  "running",
]);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getRunStateFilter = (value: string | string[] | undefined): RunListStateFilter => {
  const state = getSearchParamValue(value);

  return state !== null && runStateFilters.has(state as RunListStateFilter)
    ? (state as RunListStateFilter)
    : "all";
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    runListService: createRunListService({
      store: createDrizzleRunListStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function RunsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const runStateFilter = getRunStateFilter(resolvedSearchParams.state);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { runListService, workspaceService: service } = getServices();
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
  const runs =
    verifiedWorkspace === null
      ? []
      : await runListService.listWorkspaceRuns({
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Runs</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Run operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Inspect run status, assigned task, runner, repository mapping, update time, and pull
            request state for the selected workspace.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
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
      ) : (
        <>
          <section
            className="rounded-lg border border-border bg-card p-5"
            aria-labelledby="run-list-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="run-list-boundary" className="text-base font-semibold">
                  Run coordination metadata only
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This page shows safe run coordination metadata for {verifiedWorkspace.name}.
                  Local execution details remain on the runner.
                </p>
              </div>
            </div>
          </section>
          <RunTable runs={runs} stateFilter={runStateFilter} />
        </>
      )}
    </div>
  );
}
