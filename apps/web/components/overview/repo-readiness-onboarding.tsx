import Link from "next/link";
import { AlertTriangle, GitBranch, Globe2, ScanSearch, ShieldCheck } from "lucide-react";

import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";
import { safeDisplayText } from "@/components/display-safety";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { triggerPublicRepoScanAction, triggerRepoScanAction } from "@/src/server/actions";

type RepoReadinessOnboardingProps = {
  onboarding: WorkspaceDashboardOverview["repoReadinessOnboarding"];
  workspaceName: string;
};

async function submitRepoReadinessScanAction(formData: FormData): Promise<void> {
  "use server";

  await triggerRepoScanAction(formData);
}

async function submitPublicRepoReadinessScanAction(formData: FormData): Promise<void> {
  "use server";

  await triggerPublicRepoScanAction(formData);
}

const formatVisibility = (
  visibility: WorkspaceDashboardOverview["repoReadinessOnboarding"]["repositoryOptions"][number]["visibility"],
) => {
  if (visibility === "internal") {
    return "Internal";
  }

  if (visibility === "private") {
    return "Private";
  }

  return "Public";
};

const canScanRepository = (
  repository: WorkspaceDashboardOverview["repoReadinessOnboarding"]["repositoryOptions"][number],
) => repository.scanPermissionStatus === "ready";

const scanPermissionBadgeVariant = (
  status: WorkspaceDashboardOverview["repoReadinessOnboarding"]["repositoryOptions"][number]["scanPermissionStatus"],
) => {
  if (status === "blocked" || status === "suspended") {
    return "destructive";
  }

  if (status === "ready") {
    return "secondary";
  }

  return "outline";
};

export function RepoReadinessOnboarding({
  onboarding,
  workspaceName,
}: RepoReadinessOnboardingProps) {
  const repositoryOptions = onboarding.repositoryOptions;
  const firstScannableRepository = repositoryOptions.find(canScanRepository);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-lg border border-border bg-card p-5 md:p-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Repo readiness</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal">
            Start with a repository scan
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {safeDisplayText(workspaceName)} can connect GitHub repository metadata, run a readiness
            scan, and review AI-ready setup work before execution is paired.
          </p>
        </div>
        <div className="mt-5 grid gap-3 border-t border-border pt-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Scan mode</p>
            <p className="mt-1 text-sm font-semibold">Metadata-only repo readiness</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">GitHub access</p>
            <p className="mt-1 text-sm font-semibold">Scan-only before setup PRs</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Execution</p>
            <p className="mt-1 text-sm font-semibold text-emerald-800">
              Local execution boundary intact
            </p>
          </div>
        </div>
      </header>

      <section
        className="rounded-lg border border-border bg-card p-5 shadow-sm"
        aria-labelledby="repo-readiness-onboarding"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <ScanSearch aria-hidden="true" className="size-5 text-muted-foreground" />
            <h2 id="repo-readiness-onboarding" className="mt-3 text-base font-semibold">
              Connect a GitHub repo first
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The local runner is optional later. Begin with a hosted readiness scan so findings,
              recommendations, and queue visibility are available before any local executor is
              paired.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Metadata-only scan</Badge>
            <Badge variant="outline">Scan-only access</Badge>
            <Badge variant="secondary">Runner optional later</Badge>
          </div>
        </div>

        {repositoryOptions.length === 0 ? (
          <div className="mt-6 grid gap-5 border-t border-border pt-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <h3 className="text-sm font-semibold">
                  {onboarding.connectionStatus === "not_connected"
                    ? "No GitHub connection"
                    : onboarding.connectionStatus === "suspended"
                      ? "GitHub installation suspended"
                      : "No repository access"}
                </h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {onboarding.connectionStatus === "not_connected"
                    ? "Connect GitHub to sync selectable repositories for the first readiness scan."
                    : onboarding.connectionStatus === "suspended"
                      ? "Reactivate the GitHub App installation before selecting repositories for scan."
                      : "GitHub is connected, but no active repositories are available for this workspace. Adjust repository selection or sync repo access before scanning."}
                </p>
              </div>
              <Button asChild variant="outline">
                <Link href="/dashboard/settings/github">
                  <GitBranch aria-hidden="true" className="size-4" />
                  {onboarding.connectionStatus === "not_connected"
                    ? "Connect GitHub repo"
                    : "Adjust GitHub repo access"}
                </Link>
              </Button>
            </div>
            <form action={submitPublicRepoReadinessScanAction} className="grid gap-4">
              <input name="workspaceId" type="hidden" value={onboarding.workspaceId} />
              <fieldset className="grid gap-3 rounded-md border border-border p-4">
                <legend className="text-sm font-medium">Scan public GitHub repo</legend>
                <label className="grid gap-2" htmlFor="repo-readiness-public-url">
                  <span className="text-sm font-medium">Public repository URL</span>
                  <Input
                    id="repo-readiness-public-url"
                    maxLength={512}
                    name="repositoryUrl"
                    placeholder="https://github.com/rory-hayes/payslip-peeks-and-probes.git"
                    type="url"
                  />
                </label>
                <label className="grid gap-2" htmlFor="repo-readiness-public-product-goal">
                  <span className="text-sm font-medium">Product goal</span>
                  <Textarea
                    id="repo-readiness-public-product-goal"
                    maxLength={500}
                    name="productGoal"
                    placeholder="Review this repository for AI-ready setup tasks."
                    rows={3}
                  />
                </label>
              </fieldset>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Public scans use bounded GitHub metadata reads and keep execution local.
                </p>
                <Button className="w-fit" type="submit">
                  <Globe2 aria-hidden="true" className="size-4" />
                  Scan public repo
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <form
            action={submitRepoReadinessScanAction}
            className="mt-6 grid gap-4 border-t border-border pt-5"
          >
            <input
              name="workspaceId"
              type="hidden"
              value={firstScannableRepository?.workspaceId ?? repositoryOptions[0]!.workspaceId}
            />
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium">Select repository</legend>
              <div className="grid overflow-hidden rounded-md border border-border bg-background/40">
                {repositoryOptions.map((repository, index) => {
                  const isScannable = canScanRepository(repository);

                  return (
                    <label
                      className="grid gap-3 border-b border-border bg-card p-4 transition-colors last:border-b-0 hover:bg-secondary/40 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                      htmlFor={`repo-readiness-repo-${repository.id}`}
                      key={repository.id}
                    >
                      <div className="flex min-w-0 gap-3">
                        <input
                          className="mt-1 size-4 shrink-0 accent-primary disabled:opacity-60"
                          defaultChecked={repository.id === firstScannableRepository?.id}
                          disabled={!isScannable}
                          id={`repo-readiness-repo-${repository.id}`}
                          name="repoId"
                          type="radio"
                          value={repository.id}
                        />
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-semibold">
                            {safeDisplayText(repository.repositoryFullName)}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{safeDisplayText(repository.defaultBranch)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatVisibility(repository.visibility)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{index === 0 ? "First available repo" : "Installed repo"}</span>
                          </span>
                        </span>
                      </div>
                      <div className="grid gap-2 md:max-w-80">
                        <Badge
                          className="w-fit"
                          variant={scanPermissionBadgeVariant(repository.scanPermissionStatus)}
                        >
                          {safeDisplayText(repository.scanPermissionLabel)}
                        </Badge>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {safeDisplayText(repository.scanPermissionDetail)}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="grid gap-3 rounded-md border border-border p-4">
              <legend className="text-sm font-medium">Describe product goal</legend>
              <p className="text-sm leading-6 text-muted-foreground">
                Share the intended product or repo outcome before scanning. Skip for now with
                reduced scan quality if you want Cortex to rely only on repository documentation.
              </p>
              <Textarea
                id="repo-readiness-product-goal"
                maxLength={500}
                name="productGoal"
                placeholder="Example: Help a SaaS team turn repo readiness findings into safe AI-ready engineering tasks."
                rows={4}
              />
            </fieldset>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Scan-only access uses GitHub repository metadata and bounded contents reads for
                readiness signals. It does not install or invoke the local runner.
              </p>
              {firstScannableRepository === undefined ? (
                <Button asChild className="w-fit" variant="outline">
                  <Link href="/dashboard/settings/github">
                    <AlertTriangle aria-hidden="true" className="size-4" />
                    Review GitHub access
                  </Link>
                </Button>
              ) : (
                <Button className="w-fit" type="submit">
                  <ShieldCheck aria-hidden="true" className="size-4" />
                  Start repo scan
                </Button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
