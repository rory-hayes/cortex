import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, FileWarning } from "lucide-react";

import { WeeklyEngineeringReviewSummary } from "@/components/weekly-review";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleWeeklyEngineeringReviewStore,
  createWeeklyEngineeringReviewService,
} from "@/src/repo-readiness/weekly-review";
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
    weeklyReviewService: createWeeklyEngineeringReviewService({
      store: createDrizzleWeeklyEngineeringReviewStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function WeeklyReviewPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { weeklyReviewService, workspaceService: service } = getServices();
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
  const review =
    verifiedWorkspace === null
      ? null
      : await weeklyReviewService.generateWeeklyEngineeringReview({
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Weekly Review</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Weekly engineering review</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review recurring scan outcomes, finding pressure, task readiness, and delivery status
            from safe workspace metadata only.
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
              A verified workspace membership is required before weekly engineering reviews can be
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
      ) : review === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="missing-review"
        >
          <div className="max-w-2xl">
            <FileWarning aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="missing-review" className="mt-3 text-base font-semibold">
              Review unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Run a repository scan before opening the weekly engineering review.
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
        <WeeklyEngineeringReviewSummary review={review} />
      )}
    </div>
  );
}
