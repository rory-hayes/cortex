import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

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
import type { ApprovalQueueItem } from "@/src/approvals/list";

type ApprovalQueueTableProps = {
  approvals: ApprovalQueueItem[];
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const formatRepairAttempts = (approval: ApprovalQueueItem): string => {
  if (approval.repair.maxAttempts === null) {
    return `${approval.repair.attemptCount} repairs`;
  }

  return `${approval.repair.attemptCount}/${approval.repair.maxAttempts} repairs`;
};

export function ApprovalQueueTable({ approvals }: ApprovalQueueTableProps) {
  const readyCount = approvals.filter((approval) => approval.evidence.reviewReady).length;
  const blockedCount = approvals.filter((approval) => approval.evidence.blockerCount > 0).length;

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="approval-list"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Human review</p>
          <h2 id="approval-list" className="mt-1 text-base font-semibold">
            Approval queue
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Awaiting-review runs are shown with validation, PR, changed-file, policy, and risk
            evidence before any decision.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{readyCount} review ready</Badge>
            <Badge variant={blockedCount > 0 ? "destructive" : "outline"}>
              {blockedCount} blocked by policy
            </Badge>
          </div>
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <ClipboardCheck aria-hidden="true" className="mb-3 size-5" />
          <p>No approvals waiting.</p>
          <p className="mt-2">
            Runs appear here after validation, changed-file metadata, risk flags, and PR metadata
            are submitted.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <Table aria-label="Approval queue">
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Runner</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>PR</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((approval) => (
                <TableRow key={approval.id}>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {approval.id}
                      </span>
                      <RunStatusBadge state={approval.state} />
                      <Badge variant="outline">{approval.mode}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span className="font-medium">{approval.task.title}</span>
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {approval.task.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span className="font-medium">
                        {approval.repoMapping.repositoryOwner}/{approval.repoMapping.repositoryName}
                      </span>
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {approval.repoMapping.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {approval.runner === null ? (
                      <span className="text-muted-foreground">Unassigned</span>
                    ) : (
                      <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                        <span className="font-medium">{approval.runner.displayName}</span>
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {approval.runner.id}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <Badge variant={approval.evidence.reviewReady ? "secondary" : "outline"}>
                        {approval.evidence.reviewReady ? "Review ready" : "Evidence incomplete"}
                      </Badge>
                      <EvidenceSummary
                        blockerCount={approval.evidence.blockerCount}
                        changedFileCount={approval.evidence.changedFileCount}
                        compact
                        riskCategoryCounts={approval.evidence.riskCategoryCounts}
                        validationStatusCounts={approval.evidence.validationStatusCounts}
                        warningCount={approval.evidence.warningCount}
                      />
                      <span className="text-xs text-muted-foreground">
                        {formatRepairAttempts(approval)}
                      </span>
                      {approval.repair.latestRequestedAt === null ? null : (
                        <span className="text-xs text-muted-foreground">
                          Last repair {formatDate(approval.repair.latestRequestedAt)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {approval.pr === null ? (
                      <span className="text-muted-foreground">No PR yet</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <PrStatusBadge status={approval.pr.status} />
                        {approval.pr.url === null ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            #{approval.pr.number}
                          </span>
                        ) : (
                          <Button asChild size="xs" variant="outline">
                            <a href={approval.pr.url} rel="noreferrer" target="_blank">
                              #{approval.pr.number}
                            </a>
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(approval.updatedAt)}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/dashboard/runs/${encodeURIComponent(approval.id)}`}>
                        Review run
                      </Link>
                    </Button>
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
