import Link from "next/link";

import type {
  AuditLogCategory,
  AuditLogCategoryFilter,
  AuditLogRow,
  AuditLogSource,
  AuditLogSourceFilter,
} from "@/src/audit-log/list";
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

type AuditLogTableProps = {
  categoryFilter?: AuditLogCategoryFilter;
  filterBasePath?: string;
  rows: AuditLogRow[];
  sourceFilter?: AuditLogSourceFilter;
};

const categoryLabels = {
  approval: "Approvals",
  cancellation: "Cancellations",
  integration: "Integrations",
  job: "Jobs",
  policy: "Policy blocks",
  repository: "Repositories",
  repair: "Repairs",
  runner: "Runners",
  task: "Tasks",
  workspace: "Workspace",
} satisfies Record<AuditLogCategory, string>;

const categoryBadgeLabels = {
  approval: "Approval",
  cancellation: "Cancellation",
  integration: "Integration",
  job: "Job",
  policy: "Policy",
  repository: "Repository",
  repair: "Repair",
  runner: "Runner",
  task: "Task",
  workspace: "Workspace",
} satisfies Record<AuditLogCategory, string>;

const categoryVariants = {
  approval: "secondary",
  cancellation: "outline",
  integration: "outline",
  job: "secondary",
  policy: "destructive",
  repository: "outline",
  repair: "outline",
  runner: "secondary",
  task: "outline",
  workspace: "outline",
} satisfies Record<AuditLogCategory, "destructive" | "outline" | "secondary">;

const filterOptions = [
  { label: "All", value: "all" },
  { label: categoryLabels.runner, value: "runner" },
  { label: categoryLabels.job, value: "job" },
  { label: categoryLabels.cancellation, value: "cancellation" },
  { label: categoryLabels.approval, value: "approval" },
  { label: categoryLabels.repair, value: "repair" },
  { label: categoryLabels.integration, value: "integration" },
  { label: categoryLabels.policy, value: "policy" },
  { label: categoryLabels.repository, value: "repository" },
  { label: categoryLabels.task, value: "task" },
  { label: categoryLabels.workspace, value: "workspace" },
] satisfies Array<{ label: string; value: AuditLogCategoryFilter }>;

const sourceLabels = {
  audit_event: "App audit rows",
  run_event: "Runner events",
} satisfies Record<AuditLogSource, string>;

const sourceFilterOptions = [
  { label: "All sources", value: "all" },
  { label: sourceLabels.audit_event, value: "audit_event" },
  { label: sourceLabels.run_event, value: "run_event" },
] satisfies Array<{ label: string; value: AuditLogSourceFilter }>;

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const getFilterHref = (
  basePath: string,
  categoryFilter: AuditLogCategoryFilter,
  sourceFilter: AuditLogSourceFilter,
) => {
  const params = new URLSearchParams();

  if (categoryFilter !== "all") {
    params.set("category", categoryFilter);
  }

  if (sourceFilter !== "all") {
    params.set("source", sourceFilter);
  }

  const query = params.toString();

  return query.length === 0 ? basePath : `${basePath}?${query}`;
};

const formatNullableId = (value: string | null, fallback: string) => value ?? fallback;

export function AuditLogTable({
  categoryFilter = "all",
  filterBasePath = "/dashboard/audit-log",
  rows,
  sourceFilter = "all",
}: AuditLogTableProps) {
  const policyRows = rows.filter((row) => row.category === "policy");
  const approvalRows = rows.filter((row) => row.category === "approval");
  const runnerRows = rows.filter((row) => row.category === "runner");
  const categoryScopedRows =
    sourceFilter === "all" ? rows : rows.filter((row) => row.source === sourceFilter);
  const sourceScopedRows =
    categoryFilter === "all" ? rows : rows.filter((row) => row.category === categoryFilter);
  const categoryCounts = {
    all: categoryScopedRows.length,
    approval: categoryScopedRows.filter((row) => row.category === "approval").length,
    cancellation: categoryScopedRows.filter((row) => row.category === "cancellation").length,
    integration: categoryScopedRows.filter((row) => row.category === "integration").length,
    job: categoryScopedRows.filter((row) => row.category === "job").length,
    policy: categoryScopedRows.filter((row) => row.category === "policy").length,
    repository: categoryScopedRows.filter((row) => row.category === "repository").length,
    repair: categoryScopedRows.filter((row) => row.category === "repair").length,
    runner: categoryScopedRows.filter((row) => row.category === "runner").length,
    task: categoryScopedRows.filter((row) => row.category === "task").length,
    workspace: categoryScopedRows.filter((row) => row.category === "workspace").length,
  } satisfies Record<AuditLogCategoryFilter, number>;
  const sourceCounts = {
    all: sourceScopedRows.length,
    audit_event: sourceScopedRows.filter((row) => row.source === "audit_event").length,
    run_event: sourceScopedRows.filter((row) => row.source === "run_event").length,
  } satisfies Record<AuditLogSourceFilter, number>;
  const filteredRows = rows.filter(
    (row) =>
      (categoryFilter === "all" || row.category === categoryFilter) &&
      (sourceFilter === "all" || row.source === sourceFilter),
  );

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="audit-list">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Workspace audit trail</p>
        <h2 id="audit-list" className="text-base font-semibold">
          Consequential events
        </h2>
      </div>

      <div className="mt-5 grid gap-3 border-y border-border py-3 text-sm md:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Total</p>
          <p className="mt-1 font-medium">
            {formatCount(rows.length, "audit event", "audit events")}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Policy blocks</p>
          <p className="mt-1 font-medium">{policyRows.length} blocked</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Human decisions</p>
          <p className="mt-1 font-medium">{formatCount(approvalRows.length, "approval event")}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Runner activity</p>
          <p className="mt-1 font-medium">{formatCount(runnerRows.length, "runner event")}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Audit category filters">
        {filterOptions.map((filter) => (
          <Button
            asChild
            key={filter.value}
            size="xs"
            variant={categoryFilter === filter.value ? "secondary" : "outline"}
          >
            <Link href={getFilterHref(filterBasePath, filter.value, sourceFilter)}>
              {filter.label} {categoryCounts[filter.value]}
            </Link>
          </Button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2" aria-label="Audit source filters">
        {sourceFilterOptions.map((filter) => (
          <Button
            asChild
            key={filter.value}
            size="xs"
            variant={sourceFilter === filter.value ? "secondary" : "outline"}
          >
            <Link href={getFilterHref(filterBasePath, categoryFilter, filter.value)}>
              {filter.label} {sourceCounts[filter.value]}
            </Link>
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No audit events yet.</p>
          <p className="mt-2">
            Events appear after runner pairing, job claims, cancellation requests, approval
            decisions, repair requests, integration activity, repository updates, task creation, and
            policy blocks.
          </p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No audit events match this filter.</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={filterBasePath}>Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filteredRows.length} of {rows.length} events.
          </p>
          <Table aria-label="Audit events">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Runner</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>Task</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(row.occurredAt)}</TableCell>
                  <TableCell>
                    <Badge variant={categoryVariants[row.category]}>
                      {categoryBadgeLabels[row.category]}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.sourceLabel}</TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-col gap-1 whitespace-normal">
                      <span className="font-medium">{row.message}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.eventType}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.details.length === 0 ? (
                      <span className="text-muted-foreground">No summary</span>
                    ) : (
                      <div className="flex max-w-lg flex-wrap gap-1">
                        {row.details.map((item) => (
                          <Badge key={`${row.id}:${item.label}:${item.value}`} variant="outline">
                            {item.label}: {item.value}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatNullableId(row.actorId, "System")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatNullableId(row.runnerId, "None")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatNullableId(row.runId, "None")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatNullableId(row.taskId, "None")}
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
