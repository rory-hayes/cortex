import Link from "next/link";
import { cookies, headers } from "next/headers";
import { ArrowRight, Cable } from "lucide-react";

import { RunnerList } from "@/components/runner-list";
import { RunnerPairing } from "@/components/runner-pairing";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@/src/db";
import {
  createDrizzleRunnerListStore,
  createRunnerListService,
  type RunnerStatus,
} from "@/src/runners/list";
import { SELECTED_WORKSPACE_COOKIE_NAME } from "@/src/server/action-factories";
import { revokeRunnerAction } from "@/src/server/actions";
import { isServerActionError } from "@/src/server/errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
} from "@/src/server/workspace-mutations";

export const dynamic = "force-dynamic";

type RunnerStatusFilter = RunnerStatus | "all" | "no_heartbeat";

const runnerStatusFilters = new Set<RunnerStatusFilter>([
  "busy",
  "idle",
  "no_heartbeat",
  "offline",
  "revoked",
]);

const getSearchParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getRunnerStatusFilter = (value: string | string[] | undefined): RunnerStatusFilter => {
  const status = getSearchParamValue(value);

  return status !== null && runnerStatusFilters.has(status as RunnerStatusFilter)
    ? (status as RunnerStatusFilter)
    : "all";
};

const getServices = () => {
  const { db } = getDatabase();

  return {
    runnerListService: createRunnerListService({
      store: createDrizzleRunnerListStore(db),
    }),
    workspaceService: createWorkspaceMutationService({
      store: createDrizzleWorkspaceMutationStore(db),
    }),
  };
};

const revokeRunner = async (formData: FormData) => {
  "use server";

  await revokeRunnerAction(formData);
};

const FALLBACK_RUNNER_API_BASE_URL = "http://localhost:3000/api";

const getFirstHeaderValue = (value: string | null): string | null =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => item.length > 0) ?? null;

const getRunnerApiBaseUrl = async (): Promise<string> => {
  const requestHeaders = await headers();
  const host =
    getFirstHeaderValue(requestHeaders.get("x-forwarded-host")) ??
    getFirstHeaderValue(requestHeaders.get("host"));
  const forwardedProtocol = getFirstHeaderValue(requestHeaders.get("x-forwarded-proto"));
  const protocol =
    forwardedProtocol === "https" || forwardedProtocol === "http" ? forwardedProtocol : "http";

  if (host === null) {
    return FALLBACK_RUNNER_API_BASE_URL;
  }

  try {
    const url = new URL(`${protocol}://${host}`);

    if (url.username.length > 0 || url.password.length > 0) {
      return FALLBACK_RUNNER_API_BASE_URL;
    }

    url.pathname = "/api";
    url.search = "";
    url.hash = "";

    return url.toString().replace(/\/$/, "");
  } catch {
    return FALLBACK_RUNNER_API_BASE_URL;
  }
};

export default async function RunnersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const statusFilter = getRunnerStatusFilter(resolvedSearchParams.status);
  const cookieStore = await cookies();
  const runnerApiBaseUrl = await getRunnerApiBaseUrl();
  const cookieWorkspaceId = cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)?.value ?? null;
  const { runnerListService, workspaceService: service } = getServices();
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
  const runners =
    verifiedWorkspace === null
      ? []
      : await runnerListService.listWorkspaceRunners({
          workspaceId: verifiedWorkspace.workspaceId,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Runners</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Runner operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Pair local executors, inspect Connection status, and scan Stored heartbeat metadata
            without exposing credentials, shell paths, tool paths, versions, or raw capability
            payloads.
          </p>
        </div>
      </header>

      {verifiedWorkspace === null ? (
        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="select-workspace"
        >
          <div className="max-w-2xl">
            <Cable aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="select-workspace" className="mt-3 text-base font-semibold">
              Select a workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A verified workspace membership is required before a runner pairing code can be
              generated.
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
            aria-labelledby="runner-connection-boundary"
          >
            <h2 id="runner-connection-boundary" className="text-base font-semibold">
              Connection status
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Stored heartbeat metadata is displayed as reported by the runner. This page does not
              add live heartbeat behavior; it shows the current stored status, last heartbeat,
              support flags, and safe tool availability for {verifiedWorkspace.name}.
            </p>
          </section>
          <RunnerPairing
            apiBaseUrl={runnerApiBaseUrl}
            workspaceId={verifiedWorkspace.workspaceId}
            workspaceName={verifiedWorkspace.name}
          />
          <RunnerList
            revokeRunner={revokeRunner}
            runners={runners}
            statusFilter={statusFilter}
            workspaceId={verifiedWorkspace.workspaceId}
          />
        </>
      )}
    </div>
  );
}
