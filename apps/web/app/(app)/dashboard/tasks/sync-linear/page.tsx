import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, ArrowRight, ListChecks, Send } from "lucide-react";

import { LinearTaskSyncList } from "@/components/linear-task-sync-list";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleLinearTaskSyncStore,
  createLinearTaskSyncService,
} from "@/src/linear/task-sync";
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
    linearTaskSyncService: createLinearTaskSyncService({
      store: createDrizzleLinearTaskSyncStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

const getSearchParamValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function SyncLinearTasksPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const linearConnectionId = getSearchParamValue(resolvedSearchParams.linearConnectionId);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { linearTaskSyncService, workspaceService: service } = getServices();
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
  const syncData =
    verifiedWorkspace === null
      ? null
      : await linearTaskSyncService.listLinearTaskSyncPageData({
          ...(linearConnectionId === undefined ? {} : { linearConnectionId }),
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Tasks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">
            Sync Cortex Tasks to Linear
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Create or update Linear issues from approved scan-generated Cortex Task metadata.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to tasks
          </Link>
        </Button>
      </header>

      {verifiedWorkspace === null || syncData === null ? (
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
              A verified workspace membership is required before Cortex Tasks can be synced to
              Linear.
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
        <LinearTaskSyncList data={syncData} />
      )}

      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="sync-note">
        <div className="max-w-3xl">
          <Send aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2 id="sync-note" className="mt-3 text-base font-semibold">
            Metadata-only sync
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Linear sync links approved Cortex Tasks to Linear issues. It does not queue runner work,
            create runs, create task packets, or expose local execution artifacts.
          </p>
        </div>
      </section>
    </div>
  );
}
