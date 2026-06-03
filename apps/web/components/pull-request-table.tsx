import Link from "next/link";
import { GitPullRequest } from "lucide-react";
import type { PrArtifactStatus } from "@control-plane/shared";

import { EvidenceSummary } from "@/components/evidence-summary";
import { PrStatusBadge, RunStatusBadge } from "@/components/run-status-badge";
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
import type { PullRequestListItem } from "@/src/pull-requests/list";

type PullRequestTableProps = {
  pullRequests: PullRequestListItem[];
  statusFilter?: PullRequestStatusFilter;
};

export type PullRequestStatusFilter = PrArtifactStatus | "all" | "attention";

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const reviewStateLabels = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  unknown: "Review unknown",
} satisfies Record<PullRequestListItem["reviewState"], string>;

const checksConclusionLabels = {
  failing: "Checks failing",
  passing: "Checks passing",
  pending: "Checks pending",
  unknown: "Checks unknown",
} satisfies Record<PullRequestListItem["checks"]["conclusion"], string>;

const filterLinks = [
  { href: "/dashboard/pull-requests", label: "All PRs", value: "all" },
  { href: "/dashboard/pull-requests?status=draft", label: "Draft", value: "draft" },
  { href: "/dashboard/pull-requests?status=open", label: "Open", value: "open" },
  { href: "/dashboard/pull-requests?status=closed", label: "Closed", value: "closed" },
  { href: "/dashboard/pull-requests?status=merged", label: "Merged", value: "merged" },
  {
    href: "/dashboard/pull-requests?status=attention",
    label: "Attention needed",
    value: "attention",
  },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  value: PullRequestStatusFilter;
}>;

const needsAttention = (pullRequest: PullRequestListItem): boolean =>
  pullRequest.risk.blockerCount > 0 ||
  pullRequest.risk.warningCount > 0 ||
  pullRequest.reviewState === "changes_requested" ||
  pullRequest.checks.conclusion === "failing" ||
  pullRequest.validationStatusCounts.some((entry) => entry.status === "failed");

const filterPullRequests = (
  pullRequests: PullRequestListItem[],
  statusFilter: PullRequestStatusFilter,
): PullRequestListItem[] => {
  if (statusFilter === "all") {
    return pullRequests;
  }

  if (statusFilter === "attention") {
    return pullRequests.filter(needsAttention);
  }

  return pullRequests.filter((pullRequest) => pullRequest.status === statusFilter);
};

const filterCount = (
  pullRequests: PullRequestListItem[],
  statusFilter: PullRequestStatusFilter,
): number => filterPullRequests(pullRequests, statusFilter).length;

export function PullRequestTable({ pullRequests, statusFilter = "all" }: PullRequestTableProps) {
  const filteredPullRequests = filterPullRequests(pullRequests, statusFilter);

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="pr-list">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">GitHub visibility</p>
        <h2 id="pr-list" className="text-base font-semibold">
          Pull request artifacts
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {filterLinks.map((filter) => (
            <Button
              asChild
              key={filter.value}
              size="xs"
              variant={statusFilter === filter.value ? "secondary" : "outline"}
            >
              <Link href={filter.href}>
                {filter.label}
                <Badge variant="secondary">{filterCount(pullRequests, filter.value)}</Badge>
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {pullRequests.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <GitPullRequest aria-hidden="true" className="mb-3 size-5" />
          <p>No pull requests.</p>
          <p className="mt-2">
            Stored PR artifacts appear after the local runner opens a validated pull request.
          </p>
        </div>
      ) : filteredPullRequests.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No pull requests match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/pull-requests">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filteredPullRequests.length} of {pullRequests.length} pull requests.
          </p>
          <Table aria-label="Pull request artifacts">
            <TableHeader>
              <TableRow>
                <TableHead>PR</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPullRequests.map((pullRequest) => (
                <TableRow key={pullRequest.id}>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-2 whitespace-normal">
                      <span className="font-medium">{pullRequest.title}</span>
                      <div className="flex flex-wrap gap-2">
                        <PrStatusBadge status={pullRequest.status} />
                        <Badge variant="outline">
                          {reviewStateLabels[pullRequest.reviewState]}
                        </Badge>
                        <Badge variant="outline">
                          {checksConclusionLabels[pullRequest.checks.conclusion]}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">
                          #{pullRequest.number}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {pullRequest.repository.owner}/{pullRequest.repository.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {pullRequest.branchName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-2 whitespace-normal">
                      <RunStatusBadge state={pullRequest.run.state} />
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {pullRequest.run.id}
                      </span>
                      <Button asChild size="xs" variant="ghost">
                        <Link href={`/dashboard/runs/${encodeURIComponent(pullRequest.run.id)}`}>
                          View run
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EvidenceSummary
                      blockerCount={pullRequest.risk.blockerCount}
                      changedFileCount={pullRequest.changedFileCount}
                      compact
                      riskCategoryCounts={pullRequest.risk.categoryCounts}
                      validationStatusCounts={pullRequest.validationStatusCounts}
                      warningCount={pullRequest.risk.warningCount}
                    />
                    <div className="mt-3 flex max-w-sm flex-col gap-1 whitespace-normal">
                      <p className="text-xs font-medium text-muted-foreground">Changed paths</p>
                      {pullRequest.changedFilePaths.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          No changed paths reported.
                        </span>
                      ) : (
                        pullRequest.changedFilePaths.map((changedFilePath) => (
                          <code
                            className="break-all rounded bg-muted px-1.5 py-1 font-mono text-xs"
                            key={changedFilePath}
                          >
                            {changedFilePath}
                          </code>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span>{formatDate(pullRequest.updatedAt)}</span>
                      <span className="text-xs text-muted-foreground">
                        Last GitHub sync{" "}
                        {pullRequest.githubSyncedAt === null
                          ? "not yet synced"
                          : formatDate(pullRequest.githubSyncedAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {pullRequest.url === null ? (
                      <span className="text-sm text-muted-foreground">Link unavailable</span>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <a href={pullRequest.url} rel="noreferrer" target="_blank">
                          Open PR
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
