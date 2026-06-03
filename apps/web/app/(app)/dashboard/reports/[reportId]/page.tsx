import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, FileWarning } from "lucide-react";

import { ReadinessReport } from "@/components/readiness-report";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import {
  createDrizzleRepoReadinessReportStore,
  createRepoReadinessReportService,
} from "@/src/repo-readiness/reports";
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
    githubRepositoryService: createGitHubRepositoryService({
      store: createDrizzleGitHubRepositoryStore(db),
    }),
    readinessReportService: createRepoReadinessReportService({
      store: createDrizzleRepoReadinessReportStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

export default async function ReadinessReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const {
    githubRepositoryService,
    readinessReportService,
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
  const [report, githubRepositories] =
    verifiedWorkspace === null
      ? [null, []]
      : await Promise.all([
          readinessReportService.getReadinessReport({
            reportId,
            workspaceId: verifiedWorkspace.workspaceId,
          }),
          githubRepositoryService.listGitHubRepositories({
            workspaceId: verifiedWorkspace.workspaceId,
          }),
        ]);
  const repository =
    report === null
      ? undefined
      : githubRepositories.find((candidate) => candidate.id === report.repoId);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Reports</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Repo readiness report</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review the scan score, blockers, and recommended setup path before any local execution
            is approved.
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
              A verified workspace membership is required before readiness reports can be displayed.
            </p>
          </div>
          <Button asChild className="mt-5">
            <Link href="/workspaces">
              <ArrowRight aria-hidden="true" className="size-4" />
              Select workspace
            </Link>
          </Button>
        </section>
      ) : report === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="missing-report"
        >
          <div className="max-w-2xl">
            <FileWarning aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="missing-report" className="mt-3 text-base font-semibold">
              Report unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This workspace does not have a matching readiness report. Run a repository scan or
              open a report from scan progress.
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
        <ReadinessReport report={report} repository={repository} />
      )}
    </div>
  );
}
