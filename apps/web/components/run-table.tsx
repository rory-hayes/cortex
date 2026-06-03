import Link from "next/link";

import { EvidenceSummary, ReviewStateBadge } from "@/components/evidence-summary";
import { PrStatusBadge, RunStatusBadge, prStatusLabels } from "@/components/run-status-badge";
import type { RunListItem } from "@/src/runs/list";
import type { ReviewStateBucket } from "@/src/runs/review-metadata";
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

type RunTableProps = {
  runs: RunListItem[];
  stateFilter?: RunListStateFilter;
};

export type RunListStateFilter = ReviewStateBucket | "all";

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const runModeLabels = {
  dryRun: "Dry run",
  execute: "Execute",
  repair: "Repair",
} satisfies Record<RunListItem["mode"], string>;

const filterLinks = [
  { href: "/dashboard/runs", label: "All work", value: "all" },
  { href: "/dashboard/runs?state=ready", label: "Ready", value: "ready" },
  { href: "/dashboard/runs?state=running", label: "Running", value: "running" },
  { href: "/dashboard/runs?state=blocked", label: "Blocked", value: "blocked" },
  { href: "/dashboard/runs?state=failed", label: "Failed", value: "failed" },
  {
    href: "/dashboard/runs?state=awaiting_approval",
    label: "Awaiting approval",
    value: "awaiting_approval",
  },
  { href: "/dashboard/runs?state=pr_ready", label: "PR-ready", value: "pr_ready" },
] as const;

const bucketCount = (runs: RunListItem[], bucket: (typeof filterLinks)[number]["value"]) =>
  bucket === "all" ? runs.length : runs.filter((run) => run.review.stateBucket === bucket).length;

export function RunTable({ runs, stateFilter = "all" }: RunTableProps) {
  const filteredRuns =
    stateFilter === "all" ? runs : runs.filter((run) => run.review.stateBucket === stateFilter);

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="runs-list">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Workspace runs</p>
        <h2 id="runs-list" className="text-base font-semibold">
          Run coordination
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {filterLinks.map((filter) => (
            <Button
              asChild
              key={filter.value}
              size="xs"
              variant={stateFilter === filter.value ? "secondary" : "outline"}
            >
              <Link href={filter.href}>
                {filter.label}
                <Badge variant="secondary">{bucketCount(runs, filter.value)}</Badge>
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No runs yet.</p>
          <p className="mt-2">Approved task runs will appear after a runner claims a job.</p>
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No runs match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/runs">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filteredRuns.length} of {runs.length} runs.
          </p>
          <Table aria-label="Workspace runs">
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Runner</TableHead>
                <TableHead>Repository mapping</TableHead>
                <TableHead>Review evidence</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>PR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                      <Badge variant="outline">{runModeLabels[run.mode]}</Badge>
                      <Button asChild size="xs" variant="ghost">
                        <Link href={`/dashboard/runs/${encodeURIComponent(run.id)}`}>
                          View timeline
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge state={run.state} />
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span className="font-medium">{run.task.title}</span>
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {run.task.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {run.runner === null ? (
                      <span className="text-muted-foreground">Unassigned</span>
                    ) : (
                      <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                        <span className="font-medium">{run.runner.displayName}</span>
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {run.runner.id}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span className="font-medium">
                        {run.repoMapping.repositoryOwner}/{run.repoMapping.repositoryName}
                      </span>
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {run.repoMapping.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <ReviewStateBadge bucket={run.review.stateBucket} />
                      {run.review.prReady ? <Badge variant="secondary">PR-ready</Badge> : null}
                      <EvidenceSummary
                        blockerCount={run.review.blockerCount}
                        changedFileCount={run.review.changedFileCount}
                        compact
                        riskCategoryCounts={run.review.riskCategoryCounts}
                        validationStatusCounts={run.review.validationStatusCounts}
                        warningCount={run.review.warningCount}
                      />
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(run.updatedAt)}</TableCell>
                  <TableCell>
                    {run.pr === null ? (
                      <span className="text-muted-foreground">No PR yet</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <PrStatusBadge status={run.pr.status} />
                        {run.pr.url === null ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            #{run.pr.number}
                          </span>
                        ) : (
                          <Button asChild size="xs" variant="outline">
                            <a href={run.pr.url} rel="noreferrer" target="_blank">
                              #{run.pr.number}
                            </a>
                          </Button>
                        )}
                        <span className="sr-only">{prStatusLabels[run.pr.status]}</span>
                      </div>
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
