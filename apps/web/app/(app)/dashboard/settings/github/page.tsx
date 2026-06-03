import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, GitBranch, Settings } from "lucide-react";

import { GitHubSettings } from "@/components/github-settings";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubInstallationStore,
  createGitHubInstallationService,
} from "@/src/github/installations";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
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
    githubInstallationService: createGitHubInstallationService({
      store: createDrizzleGitHubInstallationStore(db),
    }),
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function GitHubSettingsPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    githubInstallationService,
    githubRepositoryService,
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
  const [installations, repositories] =
    verifiedWorkspace === null
      ? [[], []]
      : await Promise.all([
          githubInstallationService.listGitHubInstallations({
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
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">GitHub connection</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review GitHub App installation status and synced repository metadata. GitHub visibility
            is coordination metadata; execution stays with local runners.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <Settings aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before GitHub visibility metadata can be
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
            aria-labelledby="github-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <GitBranch aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="github-boundary" className="text-base font-semibold">
                  Visibility only in v1
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  GitHub App metadata helps {verifiedWorkspace.name} see installations, repository
                  selection, and matched local mappings. It does not execute code in v1.
                </p>
              </div>
            </div>
          </section>
          <GitHubSettings
            installations={installations}
            repositories={repositories}
            workspaceName={verifiedWorkspace.name}
          />
        </>
      )}
    </div>
  );
}
