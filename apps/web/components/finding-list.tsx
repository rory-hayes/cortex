import Link from "next/link";
import { CheckCircle2, Clock3, FileWarning, PlusCircle, ScanSearch, XCircle } from "lucide-react";

import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type FindingCategory,
  type FindingSeverity,
  type FindingStatus,
} from "@control-plane/shared";

import { convertFindingToTaskAction, updateFindingStatusAction } from "@/src/server/actions";
import type { PersistedFinding } from "@/src/repo-readiness/findings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeDisplayPath, safeDisplayText } from "@/components/display-safety";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

async function submitUpdateFindingStatusAction(formData: FormData): Promise<void> {
  "use server";

  await updateFindingStatusAction(formData);
}

async function submitConvertFindingToTaskAction(formData: FormData): Promise<void> {
  "use server";

  await convertFindingToTaskAction(formData);
}

export type FindingListRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
};

export type FindingListFilters = {
  category?: FindingCategory;
  repoId?: string;
  scanId?: string;
  severity?: FindingSeverity;
  status?: FindingStatus;
};

type FindingListProps = {
  findings: PersistedFinding[];
  repositories: FindingListRepository[];
  selectedFilters?: FindingListFilters;
  workspaceId: string;
};

const categoryLabels: Record<FindingCategory, string> = {
  agent_readiness: "Agent readiness",
  architecture: "Architecture",
  backlog_quality: "Backlog quality",
  ci_cd: "CI/CD",
  execution_risk: "Execution risk",
  integration: "Integration",
  product_clarity: "Product clarity",
  repo_hygiene: "Repo hygiene",
  security: "Security",
  validation: "Validation",
};

const severityLabels: Record<FindingSeverity, string> = {
  blocked: "Blocked",
  high: "High",
  info: "Info",
  low: "Low",
  medium: "Medium",
};

const statusLabels: Record<FindingStatus, string> = {
  deferred: "Deferred",
  dismissed: "Dismissed",
  open: "Open",
  resolved: "Resolved",
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const countBy = <TValue extends string>(
  findings: PersistedFinding[],
  getValue: (finding: PersistedFinding) => TValue,
): Map<TValue, number> => {
  const counts = new Map<TValue, number>();

  for (const finding of findings) {
    const value = getValue(finding);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
};

const withFilter = (filters: FindingListFilters, next: FindingListFilters): string => {
  const merged = {
    ...filters,
    ...next,
  };
  const params = new URLSearchParams();

  if (merged.category !== undefined) {
    params.set("category", merged.category);
  }

  if (merged.repoId !== undefined) {
    params.set("repo", merged.repoId);
  }

  if (merged.scanId !== undefined) {
    params.set("scan", merged.scanId);
  }

  if (merged.severity !== undefined) {
    params.set("severity", merged.severity);
  }

  if (merged.status !== undefined) {
    params.set("status", merged.status);
  }

  const query = params.toString();

  return query.length > 0 ? `/dashboard/findings?${query}` : "/dashboard/findings";
};

const matchesFilters = (finding: PersistedFinding, filters: FindingListFilters): boolean =>
  (filters.category === undefined || finding.finding.category === filters.category) &&
  (filters.repoId === undefined || finding.finding.repoId === filters.repoId) &&
  (filters.scanId === undefined || finding.finding.scanId === filters.scanId) &&
  (filters.severity === undefined || finding.finding.severity === filters.severity) &&
  (filters.status === undefined || finding.finding.status === filters.status);

const repositoryLabel = (repositories: FindingListRepository[], repoId: string): string => {
  const repository = repositories.find((item) => item.id === repoId);

  return repository?.repositoryFullName ?? repoId;
};

const badgeVariantForSeverity = (severity: FindingSeverity) =>
  severity === "blocked" || severity === "high" ? "destructive" : "outline";

const badgeVariantForStatus = (status: FindingStatus) =>
  status === "open" ? "secondary" : "outline";

const taskLinkText = (count: number) => pluralize(count, "linked task");

const uniqueScanIds = (findings: PersistedFinding[]): string[] =>
  [...new Set(findings.map((finding) => finding.finding.scanId))].sort();

const safeEvidencePaths = (paths: string[]): string[] => {
  const safePaths = paths.flatMap((path) => {
    const displayPath = safeDisplayPath(path);

    return displayPath === null ? [] : [displayPath];
  });

  return safePaths.length > 0 ? safePaths : ["Unavailable"];
};

export function FindingList({
  findings,
  repositories,
  selectedFilters = {},
  workspaceId,
}: FindingListProps) {
  const filteredFindings = findings.filter((finding) => matchesFilters(finding, selectedFilters));
  const statusCounts = countBy(findings, (finding) => finding.finding.status);
  const severityCounts = countBy(findings, (finding) => finding.finding.severity);
  const categoryCounts = countBy(findings, (finding) => finding.finding.category);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="findings-list"
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Readiness findings</p>
          <h2 id="findings-list" className="mt-1 text-base font-semibold">
            Findings review
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review scan findings by repository, scan, severity, category, and workflow state.
            Conversion creates a draft Cortex Task for human review before any runner execution.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{pluralize(findings.length, "finding")}</Badge>
            <Badge variant="secondary">{statusCounts.get("open") ?? 0} open</Badge>
            <Badge variant="outline">{statusCounts.get("deferred") ?? 0} deferred</Badge>
            <Badge variant="outline">{statusCounts.get("dismissed") ?? 0} dismissed</Badge>
            <Badge variant="outline">{statusCounts.get("resolved") ?? 0} resolved</Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Finding filters">
          <Button
            asChild
            size="xs"
            variant={
              Object.keys(selectedFilters).length === 0 ||
              filteredFindings.length === findings.length
                ? "secondary"
                : "outline"
            }
          >
            <Link href="/dashboard/findings">All findings</Link>
          </Button>
          {FINDING_STATUSES.map((status) => (
            <Button
              asChild
              key={status}
              size="xs"
              variant={selectedFilters.status === status ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { status })}>
                {statusLabels[status]}
                <Badge variant="secondary">{statusCounts.get(status) ?? 0}</Badge>
              </Link>
            </Button>
          ))}
          {FINDING_SEVERITIES.map((severity) => (
            <Button
              asChild
              key={severity}
              size="xs"
              variant={selectedFilters.severity === severity ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { severity })}>
                {severityLabels[severity]}
                <Badge variant="secondary">{severityCounts.get(severity) ?? 0}</Badge>
              </Link>
            </Button>
          ))}
          {FINDING_CATEGORIES.map((category) => (
            <Button
              asChild
              key={category}
              size="xs"
              variant={selectedFilters.category === category ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { category })}>
                {categoryLabels[category]}
                <Badge variant="secondary">{categoryCounts.get(category) ?? 0}</Badge>
              </Link>
            </Button>
          ))}
          {repositories.map((repository) => (
            <Button
              asChild
              key={repository.id}
              size="xs"
              variant={selectedFilters.repoId === repository.id ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { repoId: repository.id })}>
                {repository.repositoryFullName}
              </Link>
            </Button>
          ))}
          {uniqueScanIds(findings).map((scanId) => (
            <Button
              asChild
              key={scanId}
              size="xs"
              variant={selectedFilters.scanId === scanId ? "secondary" : "outline"}
            >
              <Link href={withFilter(selectedFilters, { scanId })}>{scanId}</Link>
            </Button>
          ))}
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <FileWarning aria-hidden="true" className="mb-3 size-5" />
          <p>No findings yet.</p>
          <p className="mt-2">
            Run a repo readiness scan to generate findings before converting them into AI-ready
            tasks.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/repositories">
              <ScanSearch aria-hidden="true" className="size-4" />
              Run a repo readiness scan
            </Link>
          </Button>
        </div>
      ) : filteredFindings.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No findings match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/dashboard/findings">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filteredFindings.length} of {findings.length} findings.
          </p>
          <Table aria-label="Repo readiness findings">
            <TableHeader>
              <TableRow>
                <TableHead>Finding</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFindings.map((finding) => (
                <TableRow key={finding.finding.findingId}>
                  <TableCell>
                    <div className="flex max-w-sm flex-col gap-2 whitespace-normal">
                      <span className="font-medium">{safeDisplayText(finding.finding.title)}</span>
                      <span className="text-sm leading-5 text-muted-foreground">
                        {safeDisplayText(finding.finding.summary)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {finding.finding.findingId}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={badgeVariantForSeverity(finding.finding.severity)}>
                          {severityLabels[finding.finding.severity]}
                        </Badge>
                        <Badge variant="outline">{categoryLabels[finding.finding.category]}</Badge>
                        <Badge variant={badgeVariantForStatus(finding.finding.status)}>
                          {statusLabels[finding.finding.status]}
                        </Badge>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                      <span className="font-medium">
                        {repositoryLabel(repositories, finding.finding.repoId)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {finding.finding.repoId}
                      </span>
                      <Link
                        className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
                        href={withFilter(selectedFilters, { scanId: finding.finding.scanId })}
                      >
                        {finding.finding.scanId}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-sm flex-col gap-3 whitespace-normal">
                      {finding.finding.evidence.map((evidence, index) => (
                        <div
                          className="flex flex-col gap-2"
                          key={`${finding.finding.findingId}-${index}`}
                        >
                          <span className="text-sm leading-5 text-muted-foreground">
                            {safeDisplayText(evidence.summary)}
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {safeEvidencePaths(evidence.paths).map((path) => (
                              <Badge
                                className="max-w-full break-all font-mono"
                                key={path}
                                variant="outline"
                              >
                                {path}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-sm whitespace-normal text-sm leading-5 text-muted-foreground">
                      {safeDisplayText(finding.finding.recommendation)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={finding.taskIds.length > 0 ? "secondary" : "outline"}>
                      {taskLinkText(finding.taskIds.length)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-40 flex-col gap-2">
                      <form action={submitConvertFindingToTaskAction}>
                        <input name="workspaceId" type="hidden" value={workspaceId} />
                        <input name="findingId" type="hidden" value={finding.finding.findingId} />
                        <Button size="sm" type="submit" variant="outline">
                          <PlusCircle aria-hidden="true" className="size-4" />
                          Convert to task
                        </Button>
                      </form>
                      <form action={submitUpdateFindingStatusAction}>
                        <input name="workspaceId" type="hidden" value={workspaceId} />
                        <input name="findingId" type="hidden" value={finding.finding.findingId} />
                        <input name="status" type="hidden" value="deferred" />
                        <Button size="sm" type="submit" variant="outline">
                          <Clock3 aria-hidden="true" className="size-4" />
                          Defer
                        </Button>
                      </form>
                      <form action={submitUpdateFindingStatusAction}>
                        <input name="workspaceId" type="hidden" value={workspaceId} />
                        <input name="findingId" type="hidden" value={finding.finding.findingId} />
                        <input name="status" type="hidden" value="dismissed" />
                        <Button size="sm" type="submit" variant="outline">
                          {finding.finding.status === "dismissed" ? (
                            <CheckCircle2 aria-hidden="true" className="size-4" />
                          ) : (
                            <XCircle aria-hidden="true" className="size-4" />
                          )}
                          Dismiss
                        </Button>
                      </form>
                    </div>
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
