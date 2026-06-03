import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, ArrowRight, FileDown, ListChecks } from "lucide-react";

import { LinearImportList, type LinearImportRepository } from "@/components/linear-import-list";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import { filterReadyLinearIssueCandidates } from "@/src/linear/eligibility";
import {
  createDrizzleLinearIssueSyncStore,
  createLinearIssueSyncService,
} from "@/src/linear/sync-issues";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const getServices = () => {
  const { db } = getDatabase();

  return {
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    linearIssueSyncService: createLinearIssueSyncService({
      client: {
        listIssues: async () => [],
      },
      store: createDrizzleLinearIssueSyncStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

const toSafeRepository = (repository: {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
}): LinearImportRepository => ({
  id: repository.id,
  repositoryFullName: repository.repositoryFullName,
  repositoryName: repository.repositoryName,
  repositoryOwner: repository.repositoryOwner,
});

export default async function ImportLinearPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    githubRepositoryService,
    linearIssueSyncService,
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
  const [linearCandidates, githubRepositories] =
    verifiedWorkspace === null
      ? [[], []]
      : await Promise.all([
          linearIssueSyncService.listLinearIssueCandidates({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);
  const readyCandidates = filterReadyLinearIssueCandidates(linearCandidates);
  const safeRepositories = githubRepositories.map(toSafeRepository);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Tasks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Import from Linear</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Turn selected Ready-for-AI Linear issue metadata into draft Cortex Tasks linked to an
            explicit GitHub repository.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to tasks
          </Link>
        </Button>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <ListChecks aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before Linear candidates can be imported.
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
        <LinearImportList
          candidates={readyCandidates}
          repositories={safeRepositories}
          workspaceId={verifiedWorkspace.workspaceId}
        />
      )}

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="import-note"
      >
        <div className="max-w-3xl">
          <FileDown aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2 id="import-note" className="mt-3 text-base font-semibold">
            Drafts only
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Imported work remains a Cortex Task draft. Queueing and local runner execution require a
            separate approval step.
          </p>
        </div>
      </section>
    </div>
  );
}
