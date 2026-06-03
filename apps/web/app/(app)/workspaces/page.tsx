import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Check, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDatabase } from "@/src/db";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { createWorkspaceAction, selectWorkspaceAction } from "@/src/server/actions";
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

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(value);

async function createWorkspaceFormAction(formData: FormData) {
  "use server";

  await createWorkspaceAction(formData);
}

async function selectWorkspaceFormAction(formData: FormData) {
  "use server";

  await selectWorkspaceAction(formData);
}

export default async function WorkspacesPage() {
  const service = getWorkspaceService();
  const [workspaces, cookieStore] = await Promise.all([
    service.listCurrentUserWorkspaces(),
    cookies(),
  ]);
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const selectedWorkspaceId = workspaces.some(
    (workspace) => workspace.workspaceId === cookieWorkspaceId,
  )
    ? cookieWorkspaceId
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Workspaces</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Workspace access</h1>
        </div>
        <Badge variant={selectedWorkspaceId === null ? "outline" : "default"}>
          {selectedWorkspaceId === null ? "No workspace selected" : "Workspace selected"}
        </Badge>
      </header>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="create-workspace"
      >
        <div className="flex flex-col gap-1">
          <h2 id="create-workspace" className="text-base font-semibold">
            Create workspace
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            The workspace owner membership is linked to your signed-in identity.
          </p>
        </div>
        <form action={createWorkspaceFormAction} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Workspace name"
            maxLength={120}
            name="name"
            placeholder="Platform Ops"
            required
          />
          <Button className="sm:w-auto" type="submit">
            <Plus aria-hidden="true" className="size-4" />
            Create
          </Button>
        </form>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="workspace-list"
      >
        <div className="flex flex-col gap-1">
          <h2 id="workspace-list" className="text-base font-semibold">
            Your workspaces
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Only workspaces where your signed-in user has a membership are shown.
          </p>
        </div>

        {workspaces.length === 0 ? (
          <div className="mt-5 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No workspaces yet.
          </div>
        ) : (
          <div className="mt-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((workspace) => {
                  const selected = workspace.workspaceId === selectedWorkspaceId;

                  return (
                    <TableRow
                      data-state={selected ? "selected" : undefined}
                      key={workspace.workspaceId}
                    >
                      <TableCell className="font-medium">{workspace.name}</TableCell>
                      <TableCell>
                        <Badge variant={workspace.role === "owner" ? "default" : "outline"}>
                          {workspace.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(workspace.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <form action={selectWorkspaceFormAction}>
                            <input name="workspaceId" type="hidden" value={workspace.workspaceId} />
                            <Button
                              size="sm"
                              type="submit"
                              variant={selected ? "secondary" : "outline"}
                            >
                              <Check aria-hidden="true" className="size-4" />
                              {selected ? "Selected" : "Select"}
                            </Button>
                          </form>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/workspaces/${workspace.workspaceId}`}>
                              <ArrowRight aria-hidden="true" className="size-4" />
                              Open
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
