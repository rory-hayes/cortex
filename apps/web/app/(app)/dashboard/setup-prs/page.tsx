import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, GitPullRequest, ListChecks } from "lucide-react";

import { SetupPrFlow } from "@/components/setup-pr-flow";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import {
  createCortexTaskService,
  createDrizzleCortexTaskStore,
} from "@/src/repo-readiness/cortex-tasks";
import {
  createDrizzleSetupPrPreviewStore,
  createSetupPrPreviewService,
} from "@/src/setup-pr/previews";
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
    cortexTaskService: createCortexTaskService({
      store: createDrizzleCortexTaskStore(db),
    }),
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    setupPrPreviewService: createSetupPrPreviewService({
      store: createDrizzleSetupPrPreviewStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function SetupPrsPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    cortexTaskService,
    githubRepositoryService,
    setupPrPreviewService,
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
  const [tasks, githubRepositories, previews] =
    verifiedWorkspace === null
      ? [[], [], []]
      : await Promise.all([
          cortexTaskService.listCortexTasks({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          setupPrPreviewService.listSetupPrPreviews({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Setup PRs</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Setup PR flow</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Preview approved setup tasks, create draft GitHub setup PRs, and review the task and
            finding coverage before local runner execution is considered.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <ArrowRight aria-hidden="true" className="size-4" />
            View tasks
          </Link>
        </Button>
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
              A verified workspace membership is required before setup PR previews can be displayed.
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
            aria-labelledby="setup-pr-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ListChecks aria-hidden="true" className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <h2 id="setup-pr-boundary" className="text-base font-semibold">
                  Human-reviewed setup path
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Setup PR previews carry filenames, summaries, review instructions, task IDs,
                  finding IDs, and PR metadata. Generated file bodies are sent only to GitHub when a
                  draft PR is created.
                </p>
              </div>
            </div>
          </section>
          <SetupPrFlow
            previews={previews}
            repositories={githubRepositories}
            tasks={tasks}
            workspaceId={verifiedWorkspace.workspaceId}
          />
        </>
      )}
    </div>
  );
}
