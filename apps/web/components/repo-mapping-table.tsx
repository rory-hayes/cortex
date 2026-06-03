import Link from "next/link";
import { Archive } from "lucide-react";

import type { GitHubRepositoryData } from "@/src/github/repositories";
import type { RepoMappingData, RepoMappingPolicyStatus } from "@/src/repo-mappings/repo-mappings";
import { deleteRepoMappingAction } from "@/src/server/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type RepoMappingStatusFilter = RepoMappingPolicyStatus | "all";

type RepoMappingTableProps = {
  filterBasePath?: string;
  githubRepositories?: GitHubRepositoryData[];
  policyStatusFilter?: RepoMappingStatusFilter;
  repoMappings: RepoMappingData[];
  workspaceId: string;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const policyLabels = {
  missing_validation: "Missing validation",
  not_reported: "Not reported",
  ready: "Ready",
} satisfies Record<RepoMappingData["policyStatus"], string>;

const policyVariants = {
  missing_validation: "destructive",
  not_reported: "outline",
  ready: "secondary",
} satisfies Record<RepoMappingData["policyStatus"], "destructive" | "outline" | "secondary">;

const statusFilters = [
  { label: "All", value: "all" },
  { label: "Ready", value: "ready" },
  { label: "Missing validation", value: "missing_validation" },
  { label: "Not reported", value: "not_reported" },
] satisfies Array<{ label: string; value: RepoMappingStatusFilter }>;

const formatValidationCount = (count: number) =>
  count === 1 ? "1 validation command" : `${count} validation commands`;

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const formatMaxChangedFiles = (value: number | null) =>
  value === null ? "Max files not reported" : `Max ${value} files`;

const formatUntrackedPosture = (value: RepoMappingData["policySummary"]["untrackedFiles"]) => {
  if (value === "not_reported") {
    return "Untracked not reported";
  }

  return value === "allowed" ? "Untracked allowed" : "Untracked blocked";
};

const getFilterHref = (basePath: string, filter: RepoMappingStatusFilter) =>
  filter === "all" ? basePath : `${basePath}?status=${filter}`;

const formatVisibility = (repository: GitHubRepositoryData): string => {
  if (repository.visibility === "internal") {
    return "Internal";
  }

  return repository.isPrivate ? "Private" : "Public";
};

async function archiveRepoMappingFormAction(formData: FormData) {
  "use server";

  await deleteRepoMappingAction(formData);
}

export function RepoMappingTable({
  filterBasePath = "/dashboard/repositories",
  githubRepositories = [],
  policyStatusFilter = "all",
  repoMappings,
  workspaceId,
}: RepoMappingTableProps) {
  const counts = {
    all: repoMappings.length,
    missing_validation: repoMappings.filter(
      (mapping) => mapping.policyStatus === "missing_validation",
    ).length,
    not_reported: repoMappings.filter((mapping) => mapping.policyStatus === "not_reported").length,
    ready: repoMappings.filter((mapping) => mapping.policyStatus === "ready").length,
  } satisfies Record<RepoMappingStatusFilter, number>;
  const filteredMappings =
    policyStatusFilter === "all"
      ? repoMappings
      : repoMappings.filter((mapping) => mapping.policyStatus === policyStatusFilter);
  const githubRepositoryByMappingId = new Map(
    githubRepositories
      .filter((repository) => repository.matchedRepoMappingId !== null)
      .map((repository) => [repository.matchedRepoMappingId, repository]),
  );
  const matchedGitHubRepositoryCount = githubRepositoryByMappingId.size;
  const unmatchedGitHubRepositories = githubRepositories.filter(
    (repository) => repository.matchedRepoMappingId === null,
  );

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="repo-mappings-list"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Workspace repositories</p>
        <h2 id="repo-mappings-list" className="text-base font-semibold">
          Registered local mappings
        </h2>
      </div>

      <div className="mt-5 grid gap-3 border-y border-border py-3 text-sm md:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Total</p>
          <p className="mt-1 font-medium">
            {formatCount(counts.all, "mapped repository", "mapped repositories")}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Ready</p>
          <p className="mt-1 font-medium">{counts.ready} ready</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Needs policy</p>
          <p className="mt-1 font-medium">
            {counts.missing_validation + counts.not_reported} attention
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Boundary</p>
          <p className="mt-1 font-medium">Local source only</p>
        </div>
      </div>

      <div className="mt-5 border-y border-border py-3 text-sm" aria-label="GitHub visibility">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">GitHub visibility</p>
            <p className="mt-1 font-medium">
              {formatCount(
                githubRepositories.length,
                "synced GitHub repository",
                "synced GitHub repositories",
              )}
              {" · "}
              {matchedGitHubRepositoryCount} matched to local mappings
            </p>
          </div>
          {unmatchedGitHubRepositories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unmatched GitHub repositories.</p>
          ) : (
            <div className="grid gap-2 text-sm md:min-w-80">
              {unmatchedGitHubRepositories.map((repository) => (
                <div className="flex flex-wrap items-center gap-2" key={repository.id}>
                  <span className="font-medium">{repository.repositoryFullName}</span>
                  <Badge variant="outline">{formatVisibility(repository)}</Badge>
                  <Badge variant="outline">Unmatched</Badge>
                  <span className="text-xs text-muted-foreground">
                    {repository.defaultBranch}
                    {" · "}
                    Synced {formatDate(repository.lastSyncedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Repository status filters">
        {statusFilters.map((filter) => (
          <Button
            asChild
            key={filter.value}
            size="xs"
            variant={policyStatusFilter === filter.value ? "secondary" : "outline"}
          >
            <Link href={getFilterHref(filterBasePath, filter.value)}>
              {filter.label} {counts[filter.value]}
            </Link>
          </Button>
        ))}
      </div>

      {repoMappings.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No repositories mapped.</p>
          <p className="mt-2">
            Register one from a paired runner with{" "}
            <code className="rounded bg-muted px-1.5 py-1 font-mono text-xs text-foreground">
              control-plane-runner repos add --path /absolute/path/to/repo
            </code>
          </p>
        </div>
      ) : filteredMappings.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No repositories match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={filterBasePath}>Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filteredMappings.length} of {repoMappings.length} mappings.
          </p>
          <Table aria-label="Repository mappings">
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>Runner</TableHead>
                <TableHead>Local path</TableHead>
                <TableHead>Remote</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>GitHub visibility</TableHead>
                <TableHead>Policy posture</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMappings.map((mapping) => {
                const githubRepository = githubRepositoryByMappingId.get(mapping.id);

                return (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">
                      {mapping.repositoryOwner}/{mapping.repositoryName}
                    </TableCell>
                    <TableCell className="font-medium">{mapping.runnerId}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      <code className="block break-all font-mono text-xs leading-5">
                        {mapping.localPath}
                      </code>
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      {mapping.remoteUrl === null ? (
                        <span className="text-muted-foreground">No remote reported</span>
                      ) : (
                        <span className="break-all">{mapping.remoteUrl}</span>
                      )}
                    </TableCell>
                    <TableCell>{mapping.defaultBranch}</TableCell>
                    <TableCell>
                      {githubRepository === undefined ? (
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline">Unmatched</Badge>
                          <span className="text-xs text-muted-foreground">
                            No GitHub App metadata
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary">{formatVisibility(githubRepository)}</Badge>
                            <Badge variant="outline">Matched</Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {githubRepository.defaultBranch}
                            {" · "}
                            Synced {formatDate(githubRepository.lastSyncedAt)}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={policyVariants[mapping.policyStatus]}>
                          {policyLabels[mapping.policyStatus]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatCount(
                            mapping.policySummary.protectedPathCount,
                            "protected path",
                            "protected paths",
                          )}
                          {" · "}
                          {formatCount(
                            mapping.policySummary.sensitivePathCount,
                            "sensitive path",
                            "sensitive paths",
                          )}
                          {" · "}
                          {formatCount(
                            mapping.policySummary.warningPathCount,
                            "warning path",
                            "warning paths",
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatMaxChangedFiles(mapping.policySummary.maxChangedFiles)}
                          {" · "}
                          {formatUntrackedPosture(mapping.policySummary.untrackedFiles)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                        <span className="text-sm">
                          {formatValidationCount(mapping.validationCommandCount)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {mapping.validationSummary.requiredCount} required
                          {" · "}
                          {mapping.validationSummary.optionalCount} optional
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {mapping.validationSummary.labels.length > 0
                            ? mapping.validationSummary.labels.join(", ")
                            : "No validation labels reported"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(mapping.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <form action={archiveRepoMappingFormAction}>
                        <input name="workspaceId" type="hidden" value={workspaceId} />
                        <input name="repoMappingId" type="hidden" value={mapping.id} />
                        <Button size="sm" type="submit" variant="outline">
                          <Archive aria-hidden="true" className="size-4" />
                          Archive
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
