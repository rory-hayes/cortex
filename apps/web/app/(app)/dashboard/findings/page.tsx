import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, FileWarning, ShieldCheck } from "lucide-react";

import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type FindingCategory,
  type FindingSeverity,
  type FindingStatus,
} from "@control-plane/shared";

import { FindingList, type FindingListFilters } from "@/components/finding-list";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import {
  createDrizzleRepoFindingStore,
  createRepoFindingService,
} from "@/src/repo-readiness/findings";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]+$/u;
const categoryFilters = new Set<string>(FINDING_CATEGORIES);
const severityFilters = new Set<string>(FINDING_SEVERITIES);
const statusFilters = new Set<string>(FINDING_STATUSES);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getSafeIdFilter = (value: string | string[] | undefined): string | undefined => {
  const selectedValue = getSearchParamValue(value)?.trim();

  return selectedValue !== undefined &&
    selectedValue.length > 0 &&
    selectedValue.length <= 240 &&
    idPattern.test(selectedValue)
    ? selectedValue
    : undefined;
};

const getFindingCategoryFilter = (
  value: string | string[] | undefined,
): FindingCategory | undefined => {
  const category = getSearchParamValue(value);

  return category !== null && categoryFilters.has(category)
    ? (category as FindingCategory)
    : undefined;
};

const getFindingSeverityFilter = (
  value: string | string[] | undefined,
): FindingSeverity | undefined => {
  const severity = getSearchParamValue(value);

  return severity !== null && severityFilters.has(severity)
    ? (severity as FindingSeverity)
    : undefined;
};

const getFindingStatusFilter = (
  value: string | string[] | undefined,
): FindingStatus | undefined => {
  const status = getSearchParamValue(value);

  return status !== null && statusFilters.has(status) ? (status as FindingStatus) : undefined;
};

const getFindingFilters = (
  searchParams: Record<string, string | string[] | undefined>,
): FindingListFilters => {
  const filters: FindingListFilters = {};
  const category = getFindingCategoryFilter(searchParams.category);
  const repoId = getSafeIdFilter(searchParams.repo);
  const scanId = getSafeIdFilter(searchParams.scan);
  const severity = getFindingSeverityFilter(searchParams.severity);
  const status = getFindingStatusFilter(searchParams.status);

  if (category !== undefined) {
    filters.category = category;
  }

  if (repoId !== undefined) {
    filters.repoId = repoId;
  }

  if (scanId !== undefined) {
    filters.scanId = scanId;
  }

  if (severity !== undefined) {
    filters.severity = severity;
  }

  if (status !== undefined) {
    filters.status = status;
  }

  return filters;
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    repoFindingService: createRepoFindingService({
      store: createDrizzleRepoFindingStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function FindingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedFilters = getFindingFilters(resolvedSearchParams);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { githubRepositoryService, repoFindingService, workspaceService: service } = getServices();
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
  const [findings, githubRepositories] =
    verifiedWorkspace === null
      ? [[], []]
      : await Promise.all([
          repoFindingService.listFindings({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Findings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Repo readiness findings</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review readiness scan results, dismiss or defer findings, and convert eligible findings
            into draft Cortex Tasks before any approval or runner execution.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <FileWarning aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before repo readiness findings can be
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
            aria-labelledby="findings-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="findings-boundary" className="text-base font-semibold">
                  Local execution remains gated
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Converting a finding creates a draft Cortex Task for {verifiedWorkspace.name}.
                  Draft tasks are not approved, queued, or assigned to a runner until a human takes
                  the next explicit action.
                </p>
              </div>
            </div>
          </section>
          <FindingList
            findings={findings}
            repositories={githubRepositories}
            selectedFilters={selectedFilters}
            workspaceId={verifiedWorkspace.workspaceId}
          />
        </>
      )}
    </div>
  );
}
