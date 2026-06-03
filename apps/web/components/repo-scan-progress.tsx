import Link from "next/link";
import { Activity, ArrowRight, Clock3 } from "lucide-react";

import type {
  RepoScan,
  RepoScanModuleStatus,
  RepoScanModuleStatusValue,
  RepoScanStatus,
} from "@control-plane/shared";

import { safeDisplayText } from "@/components/display-safety";
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

type RepoScanProgressProps = {
  scans: RepoScan[];
};

type CanonicalModuleDefinition = {
  aliases?: string[];
  id: string;
  label: string;
  order: number;
};

type DisplayModuleStatus = Omit<RepoScanModuleStatus, "label" | "metadata" | "order"> & {
  label: string;
  order: number;
};

const canonicalModules: CanonicalModuleDefinition[] = [
  {
    id: "product_clarity",
    label: "Product Clarity",
    order: 10,
  },
  {
    id: "agent_readiness",
    label: "Agent Readiness",
    order: 20,
  },
  {
    id: "architecture",
    label: "Architecture",
    order: 30,
  },
  {
    aliases: ["backlog"],
    id: "backlog_quality",
    label: "Backlog",
    order: 40,
  },
  {
    aliases: ["validation_posture"],
    id: "validation",
    label: "Validation",
    order: 50,
  },
  {
    id: "ci_cd",
    label: "CI/CD",
    order: 60,
  },
  {
    id: "security",
    label: "Security",
    order: 70,
  },
  {
    aliases: ["repo-hygiene", "repo_hygiene"],
    id: "repo_hygiene",
    label: "Repo Hygiene",
    order: 80,
  },
];

const statusLabels: Record<RepoScanModuleStatusValue, string> = {
  blocked: "Blocked",
  failed: "Failed",
  passed: "Passed",
  queued: "Queued",
  running: "Running",
  skipped: "Skipped",
  warning: "Warning",
};

const terminalStatuses = new Set<RepoScanModuleStatusValue>([
  "blocked",
  "failed",
  "passed",
  "skipped",
  "warning",
]);

const terminalScanStatuses = new Set<RepoScanStatus>(["cancelled", "completed", "failed"]);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const formatTimestamp = (value: string | undefined): string => {
  if (value === undefined) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
};

const countStatuses = (scan: RepoScan): Partial<Record<RepoScanModuleStatusValue, number>> => {
  const counts: Partial<Record<RepoScanModuleStatusValue, number>> = {};

  for (const moduleStatus of getDisplayModuleStatuses(scan)) {
    counts[moduleStatus.status] = (counts[moduleStatus.status] ?? 0) + 1;
  }

  return counts;
};

const statusVariant = (status: RepoScanModuleStatusValue) => {
  if (status === "failed" || status === "blocked") {
    return "destructive";
  }

  return terminalStatuses.has(status) ? "secondary" : "outline";
};

const aliasToCanonicalId = new Map(
  canonicalModules.flatMap((module) =>
    [module.id, ...(module.aliases ?? [])].map((alias) => [alias, module.id] as const),
  ),
);

const findPersistedModule = (
  scan: RepoScan,
  module: CanonicalModuleDefinition,
): RepoScanModuleStatus | undefined =>
  scan.moduleStatuses.find((moduleStatus) => {
    const canonicalId = aliasToCanonicalId.get(moduleStatus.id);

    return canonicalId === module.id;
  });

const missingModuleStatus = (
  scan: RepoScan,
  module: CanonicalModuleDefinition,
): DisplayModuleStatus => {
  const terminalScan = terminalScanStatuses.has(scan.status);

  return {
    id: module.id,
    label: module.label,
    order: module.order,
    required: false,
    status: terminalScan ? "skipped" : "queued",
    summary: terminalScan
      ? "No metadata-only status was recorded for this repo scan module."
      : "Queued for repo scan module execution.",
    ...(terminalScan ? { finishedAt: scan.finishedAt ?? scan.updatedAt } : {}),
  };
};

const getDisplayModuleStatuses = (scan: RepoScan): DisplayModuleStatus[] =>
  canonicalModules.map((module) => {
    const persistedModule = findPersistedModule(scan, module);

    if (persistedModule === undefined) {
      return missingModuleStatus(scan, module);
    }

    return {
      finishedAt: persistedModule.finishedAt,
      id: module.id,
      label: module.label,
      order: module.order,
      required: persistedModule.required,
      startedAt: persistedModule.startedAt,
      status: persistedModule.status,
      summary: persistedModule.summary,
    };
  });

export function RepoScanProgress({ scans }: RepoScanProgressProps) {
  const scansWithProgress = scans;

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="scan-progress"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Repository scans</p>
          <h2 id="scan-progress" className="mt-1 text-base font-semibold">
            Scan progress
          </h2>
        </div>
        <Badge variant="outline">{pluralize(scansWithProgress.length, "scan")}</Badge>
      </div>

      {scansWithProgress.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <Activity aria-hidden="true" className="mb-3 size-5" />
          <p>No module progress yet.</p>
          <p className="mt-2">Recent repo scans will show metadata-only module progress here.</p>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {scansWithProgress.map((scan) => {
            const statusCounts = countStatuses(scan);
            const moduleStatuses = getDisplayModuleStatuses(scan);
            const safeScanId = safeDisplayText(scan.scanId);

            return (
              <div className="flex flex-col gap-3" key={scan.scanId}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{safeScanId}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {pluralize(moduleStatuses.length, "module")} ·{" "}
                      {pluralize(scan.inventory.totalFileCount, "file")} ·{" "}
                      {scan.inventory.scannedFileCount} scanned · {scan.inventory.omittedFileCount}{" "}
                      omitted
                    </p>
                    {scan.status === "failed" ? (
                      <div className="mt-2 flex flex-col gap-2 text-sm leading-5 text-muted-foreground">
                        <Badge variant="destructive">Scan failed</Badge>
                        <p>{safeDisplayText(scan.failureSummary ?? "Unavailable")}</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {Object.entries(statusCounts).map(([status, count]) => (
                      <Badge
                        key={status}
                        variant={statusVariant(status as RepoScanModuleStatusValue)}
                      >
                        {count} {status}
                      </Badge>
                    ))}
                    {scan.readinessReportId !== undefined ? (
                      <Button asChild size="xs" variant="outline">
                        <Link
                          href={`/dashboard/reports/${encodeURIComponent(scan.readinessReportId)}`}
                        >
                          <ArrowRight aria-hidden="true" className="size-3" />
                          View report
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Table aria-label={`Repo scan ${safeScanId} module progress`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Timing</TableHead>
                      <TableHead>Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {moduleStatuses.map((moduleStatus) => (
                      <TableRow key={moduleStatus.id}>
                        <TableCell>
                          <div className="flex max-w-xs flex-col gap-1 whitespace-normal">
                            <span className="font-medium">
                              {safeDisplayText(moduleStatus.label)}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {safeDisplayText(moduleStatus.id)}
                            </span>
                            <Badge variant="outline">
                              {moduleStatus.required ? "Required" : "Optional"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(moduleStatus.status)}>
                            {statusLabels[moduleStatus.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex max-w-xs flex-col gap-1 whitespace-normal text-xs text-muted-foreground">
                            <span>
                              <Clock3 aria-hidden="true" className="mr-1 inline size-3" />
                              Started {formatTimestamp(moduleStatus.startedAt)}
                            </span>
                            <span>Finished {formatTimestamp(moduleStatus.finishedAt)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-sm whitespace-normal text-sm leading-5 text-muted-foreground">
                            {safeDisplayText(moduleStatus.summary)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
