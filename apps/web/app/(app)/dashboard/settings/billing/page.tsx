import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Settings } from "lucide-react";

import { BillingSettings } from "@/components/billing-settings";
import { Button } from "@/components/ui/button";
import { createBillingPlanLimitService } from "@/src/billing/plan-limits";
import { createDrizzleUsageEventStore } from "@/src/billing/usage-events";
import { getWorkspaceUsage } from "@/src/billing/usage";
import { getDatabase } from "@/src/db";
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
    billingPlanService: createBillingPlanLimitService({
      store: createDrizzleUsageEventStore(db),
    }),
    db,
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function BillingSettingsPage() {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { billingPlanService, db, workspaceService: service } = getServices();
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
  const [usage, planUsage] =
    verifiedWorkspace === null
      ? [null, null]
      : await Promise.all([
          getWorkspaceUsage(db, {
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          billingPlanService.getWorkspacePlanUsageSummary({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Billing hooks</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review plan, usage, and limit metadata for the selected workspace. Billing is inactive
            in MVP.
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
              A verified workspace membership is required before billing metadata can be displayed.
            </p>
          </div>
          <Button asChild className="mt-5">
            <Link href="/workspaces">
              <ArrowRight aria-hidden="true" className="size-4" />
              Select workspace
            </Link>
          </Button>
        </section>
      ) : usage === null || planUsage === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="billing-unavailable"
        >
          <div className="max-w-2xl">
            <Settings aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="billing-unavailable" className="mt-3 text-base font-semibold">
              Usage snapshot unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Billing hook metadata is temporarily unavailable for the selected workspace. Stripe
              remains disabled and no billing actions are available in MVP.
            </p>
          </div>
        </section>
      ) : (
        <BillingSettings
          usage={usage}
          planUsage={planUsage}
          workspaceName={verifiedWorkspace.name}
        />
      )}
    </div>
  );
}
