import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ClipboardCheck, ShieldCheck } from "lucide-react";

import { ApprovalQueueTable } from "@/components/approval-queue-table";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import { createApprovalQueueService, createDrizzleApprovalQueueStore } from "@/src/approvals/list";
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
    approvalQueueService: createApprovalQueueService({
      store: createDrizzleApprovalQueueStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { approvalQueueService, workspaceService: service } = getServices();
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
  const approvals =
    verifiedWorkspace === null
      ? []
      : await approvalQueueService.listWorkspaceApprovals({
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Approvals</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Review decisions</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review awaiting runs with validation evidence, PR metadata, changed-file counts, and
            risk flags before recording a human decision.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <ClipboardCheck aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before approval metadata can be displayed.
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
            aria-labelledby="approval-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="approval-boundary" className="text-base font-semibold">
                  Approval metadata only
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This page shows metadata only for {verifiedWorkspace.name}. Review controls live
                  on the run detail page and never include merge actions.
                </p>
              </div>
            </div>
          </section>
          <ApprovalQueueTable approvals={approvals} />
        </>
      )}
    </div>
  );
}
