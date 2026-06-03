import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { selectWorkspaceAction } from "@/src/server/actions";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const getWorkspaceService = () => {
  const { db } = getDatabase();

  return createWorkspaceMutationService({
    store: createDrizzleWorkspaceMutationStore(db),
  });
};

async function selectWorkspaceFormAction(formData: FormData) {
  "use server";

  await selectWorkspaceAction(formData);
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const service = getWorkspaceService();
  const workspace = await service.selectWorkspace({ workspaceId }).catch((error: unknown) => {
    if (
      isServerActionError(error) &&
      (error.code === "forbidden" || error.code === "validation_error")
    ) {
      notFound();
    }

    throw error;
  });
  const cookieStore = await cookies();
  const selected = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value === workspace.workspaceId;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/workspaces">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Workspaces
            </Link>
          </Button>
          <p className="mt-4 text-sm font-medium text-muted-foreground">Selected workspace</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">{workspace.name}</h1>
        </div>
        <Badge variant={selected ? "default" : "outline"}>
          {selected ? "Selected" : "Membership verified"}
        </Badge>
      </header>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="workspace-state"
      >
        <div className="flex flex-col gap-1">
          <h2 id="workspace-state" className="text-base font-semibold">
            Workspace state
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This route is available only after membership verification for your signed-in user.
          </p>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Workspace ID</dt>
            <dd className="mt-1 break-all text-sm font-medium">{workspace.workspaceId}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Membership role</dt>
            <dd className="mt-1 text-sm font-medium">{workspace.role}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Current state</dt>
            <dd className="mt-1 text-sm font-medium">
              {selected ? "Selected for this browser" : "Not selected for this browser"}
            </dd>
          </div>
        </dl>

        {!selected && (
          <form action={selectWorkspaceFormAction} className="mt-5">
            <input name="workspaceId" type="hidden" value={workspace.workspaceId} />
            <Button type="submit">
              <Check aria-hidden="true" className="size-4" />
              Select workspace
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
