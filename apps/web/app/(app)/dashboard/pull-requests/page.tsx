import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, GitPullRequest, ShieldCheck } from "lucide-react";

import { PullRequestTable, type PullRequestStatusFilter } from "@/components/pull-request-table";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzlePullRequestListStore,
  createPullRequestListService,
} from "@/src/pull-requests/list";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const pullRequestStatusFilters = new Set<PullRequestStatusFilter>([
  "all",
  "attention",
  "closed",
  "draft",
  "merged",
  "open",
]);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getPullRequestStatusFilter = (
  value: string | string[] | undefined,
): PullRequestStatusFilter => {
  const status = getSearchParamValue(value);

  return status !== null && pullRequestStatusFilters.has(status as PullRequestStatusFilter)
    ? (status as PullRequestStatusFilter)
    : "all";
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    pullRequestListService: createPullRequestListService({
      store: createDrizzlePullRequestListStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function PullRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const pullRequestStatusFilter = getPullRequestStatusFilter(resolvedSearchParams.status);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { pullRequestListService, workspaceService: service } = getServices();
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
  const pullRequests =
    verifiedWorkspace === null
      ? []
      : await pullRequestListService.listWorkspacePullRequests({
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Pull requests</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Stored PR artifacts</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Inspect pull request metadata, branch state, validation summary, changed-file counts,
            and risk flags from local runner submissions.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <GitPullRequest aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before PR metadata can be displayed.
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
            aria-labelledby="pr-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="pr-boundary" className="text-base font-semibold">
                  Stored PR artifacts only
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This page shows stored PR artifacts and review metadata only for{" "}
                  {verifiedWorkspace.name}; diffs and code contents stay local.
                </p>
              </div>
            </div>
          </section>
          <PullRequestTable pullRequests={pullRequests} statusFilter={pullRequestStatusFilter} />
        </>
      )}
    </div>
  );
}
