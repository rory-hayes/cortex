import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, LayoutDashboard } from "lucide-react";

import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { Button } from "@/components/ui/button";
import { getWorkspaceDashboardOverview } from "@/src/dashboard/overview";
import { getDatabase } from "@/src/db";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getSelectedRunId = (value: string | string[] | undefined): string | undefined => {
  const selectedRunId = getSearchParamValue(value)?.trim();

  return selectedRunId === undefined || selectedRunId.length === 0 ? undefined : selectedRunId;
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedRunId = getSelectedRunId(resolvedSearchParams.runId);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { workspaceService: service } = getServices();
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
  const overview =
    verifiedWorkspace === null
      ? null
      : await getWorkspaceDashboardOverview({
          workspaceId: verifiedWorkspace.workspaceId,
          selectedRunId,
        });

  return verifiedWorkspace === null || overview === null ? (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Operational overview</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Select a workspace before loading runner, queue, review, and run trace metadata.
          </p>
        </div>
      </header>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="select-workspace"
      >
        <div className="max-w-2xl">
          <LayoutDashboard aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2 id="select-workspace" className="mt-3 text-base font-semibold">
            Select a workspace
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A verified workspace membership is required before overview metadata can be displayed.
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
  ) : (
    <OverviewDashboard overview={overview} workspaceName={verifiedWorkspace.name} />
  );
}
