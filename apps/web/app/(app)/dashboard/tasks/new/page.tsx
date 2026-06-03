import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, ArrowRight, FolderGit2, ListChecks } from "lucide-react";

import { TaskForm, type TaskFormRepoMapping } from "@/components/task-form";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleRepoMappingStore,
  createRepoMappingService,
} from "@/src/repo-mappings/repo-mappings";
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
    repoMappingService: createRepoMappingService({
      store: createDrizzleRepoMappingStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

const toSafeRepoMapping = (mapping: {
  defaultBranch: string;
  id: string;
  repositoryName: string;
  repositoryOwner: string;
}): TaskFormRepoMapping => ({
  defaultBranch: mapping.defaultBranch,
  id: mapping.id,
  label: `${mapping.repositoryOwner}/${mapping.repositoryName}`,
});

export default async function NewTaskPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { repoMappingService, workspaceService: service } = getServices();
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
  const repoMappings =
    verifiedWorkspace === null
      ? []
      : await repoMappingService.listRepoMappings({
          workspaceId: verifiedWorkspace.workspaceId,
        });
  const safeRepoMappings = repoMappings.map(toSafeRepoMapping);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Tasks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">New manual task</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Capture engineering intent as metadata for a mapped local repository. The runner remains
            the executor.
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
              A verified workspace membership is required before manual task creation can load
              repository mappings.
            </p>
          </div>
          <Button asChild className="mt-5">
            <Link href="/workspaces">
              <ArrowRight aria-hidden="true" className="size-4" />
              Select workspace
            </Link>
          </Button>
        </section>
      ) : repoMappings.length === 0 ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="no-repo-mappings"
        >
          <div className="max-w-2xl">
            <FolderGit2 aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="no-repo-mappings" className="mt-3 text-base font-semibold">
              No repository mappings
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Map a local repository from a paired runner before creating manual tasks. Task
              creation uses existing mapping metadata only.
            </p>
          </div>
          <Button asChild className="mt-5" variant="outline">
            <Link href="/dashboard/repositories">
              <ArrowRight aria-hidden="true" className="size-4" />
              View repositories
            </Link>
          </Button>
        </section>
      ) : (
        <TaskForm
          repoMappings={safeRepoMappings}
          workspaceId={verifiedWorkspace.workspaceId}
          workspaceName={verifiedWorkspace.name}
        />
      )}
    </div>
  );
}
