import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ScrollText, ShieldCheck } from "lucide-react";

import { AuditLogTable } from "@/components/audit-log-table";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_SOURCES,
  createAuditLogService,
  createDrizzleAuditLogStore,
  type AuditLogCategory,
  type AuditLogCategoryFilter,
  type AuditLogSource,
  type AuditLogSourceFilter,
} from "@/src/audit-log/list";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

const auditCategoryFilters = new Set<AuditLogCategory>(AUDIT_LOG_CATEGORIES);
const auditSourceFilters = new Set<AuditLogSource>(AUDIT_LOG_SOURCES);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getCategoryFilter = (value: string | string[] | undefined): AuditLogCategoryFilter => {
  const category = getSearchParamValue(value);

  return category !== null && auditCategoryFilters.has(category as AuditLogCategory)
    ? (category as AuditLogCategory)
    : "all";
};

const getSourceFilter = (value: string | string[] | undefined): AuditLogSourceFilter => {
  const source = getSearchParamValue(value);

  return source !== null && auditSourceFilters.has(source as AuditLogSource)
    ? (source as AuditLogSource)
    : "all";
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    auditLogService: createAuditLogService({
      store: createDrizzleAuditLogStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const categoryFilter = getCategoryFilter(resolvedSearchParams.category);
  const sourceFilter = getSourceFilter(resolvedSearchParams.source);
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { auditLogService, workspaceService: service } = getServices();
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
  const auditRows =
    verifiedWorkspace === null
      ? []
      : await auditLogService.listAuditLog({ workspaceId: verifiedWorkspace.workspaceId });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Audit Log</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Operational audit</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review runner access, job claims, human decisions, repairs, integration activity, and
            policy blocks from immutable coordination records.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/backend-handover">Internal handover</Link>
        </Button>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <ScrollText aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before audit events can be displayed.
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
            aria-labelledby="audit-boundary"
          >
            <div className="flex max-w-3xl gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 id="audit-boundary" className="text-base font-semibold">
                  Metadata-only record
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This page is scoped to {verifiedWorkspace.name}. It displays event type, time,
                  actor, runner, run identity, category, and allowlisted summaries; code payloads,
                  credentials, and unredacted logs stay outside the dashboard.
                </p>
              </div>
            </div>
          </section>
          <AuditLogTable
            categoryFilter={categoryFilter}
            rows={auditRows}
            sourceFilter={sourceFilter}
          />
        </>
      )}
    </div>
  );
}
