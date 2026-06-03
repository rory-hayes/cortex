import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, FolderGit2, ShieldCheck } from "lucide-react";

import { RepoMappingTable } from "@/components/repo-mapping-table";
import { RepoScanProgress } from "@/components/repo-scan-progress";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import {
  createDrizzleRepoMappingStore,
  createRepoMappingService,
  type RepoMappingPolicyStatus,
} from "@/src/repo-mappings/repo-mappings";
import { createDrizzleRepoScanStore, createRepoScanService } from "@/src/repo-readiness/repo-scans";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const policyStatusFilters = new Set<RepoMappingPolicyStatus>([
  "missing_validation",
  "not_reported",
  "ready",
]);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getPolicyStatusFilter = (
  value: string | string[] | undefined,
): RepoMappingPolicyStatus | "all" => {
  const status = getSearchParamValue(value);

  return status !== null && policyStatusFilters.has(status as RepoMappingPolicyStatus)
    ? (status as RepoMappingPolicyStatus)
    : "all";
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    repoMappingService: createRepoMappingService({
      store: createDrizzleRepoMappingStore(db),
    }),
    repoScanService: createRepoScanService({
      store: createDrizzleRepoScanStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const policyStatusFilter = getPolicyStatusFilter(resolvedSearchParams.status);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    githubRepositoryService,
    repoMappingService,
    repoScanService,
    workspaceService: service,
  } = getServices();
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
  const [githubRepositories, repoMappings, repoScans] =
    verifiedWorkspace === null
      ? [[], [], []]
      : await Promise.all([
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          repoMappingService.listRepoMappings({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          repoScanService.listRepoScans({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Repositories</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Repository operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Scan local mappings by policy posture, validation coverage, and runner association.
            Runner executes locally; the dashboard stores only coordination metadata.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <FolderGit2 aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before local repository mappings can be
              displayed.
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
            aria-labelledby="repo-mapping-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="repo-mapping-boundary" className="text-base font-semibold">
                  Source code stays local
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Runner executes locally for {verifiedWorkspace.name}. This page shows repository
                  identity, safe policy counts, validation labels, and runner-scoped path metadata;
                  it does not display source, diffs, patches, snippets, credentials, or raw policy
                  JSON.
                </p>
              </div>
            </div>
          </section>
          <RepoMappingTable
            githubRepositories={githubRepositories}
            policyStatusFilter={policyStatusFilter}
            repoMappings={repoMappings}
            workspaceId={verifiedWorkspace.workspaceId}
          />
          <RepoScanProgress scans={repoScans} />
        </>
      )}
    </div>
  );
}
