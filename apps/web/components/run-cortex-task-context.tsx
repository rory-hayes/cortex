import { ClipboardCheck, FileWarning, GitPullRequest, ListChecks } from "lucide-react";

import type { RunDetail, RunDetailCortexFinding } from "@/src/runs/detail";
import { hasUnsafeDisplayText, safeDisplayText } from "@/components/display-safety";
import { Badge } from "@/components/ui/badge";

type RunCortexTaskContextPanelProps = {
  context: RunDetail["cortexTask"];
  pr: RunDetail["pr"];
  validationResults: RunDetail["validationResults"];
};

const riskLabels: Record<NonNullable<RunDetail["cortexTask"]>["riskLevel"], string> = {
  blocked: "Blocked risk",
  high: "High risk",
  low: "Low risk",
  medium: "Medium risk",
};

const executionModeLabels: Record<NonNullable<RunDetail["cortexTask"]>["executionMode"], string> = {
  local_runner: "Local runner",
  planning_only: "Planning only",
  setup_pr: "Setup PR",
};

const statusLabels: Record<NonNullable<RunDetail["cortexTask"]>["status"], string> = {
  approved: "Approved",
  blocked: "Blocked",
  completed: "Completed",
  deferred: "Deferred",
  draft: "Draft",
  needs_review: "Needs review",
  pr_opened: "PR opened",
  queued: "Queued",
  rejected: "Rejected",
  running: "Running",
};

const approvalLabels: Record<NonNullable<RunDetail["cortexTask"]>["approvalStatus"], string> = {
  approved: "Approval approved",
  deferred: "Approval deferred",
  not_requested: "Approval not requested",
  pending: "Pending approval",
  rejected: "Approval rejected",
};

const findingCategoryLabels: Record<RunDetailCortexFinding["category"], string> = {
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

const findingSeverityLabels: Record<RunDetailCortexFinding["severity"], string> = {
  blocked: "Blocked",
  high: "High",
  info: "Info",
  low: "Low",
  medium: "Medium",
};

const findingStatusLabels: Record<RunDetailCortexFinding["status"], string> = {
  deferred: "Deferred",
  dismissed: "Dismissed",
  open: "Open",
  resolved: "Resolved",
};

const validationStatusLabels: Record<RunDetail["validationResults"][number]["status"], string> = {
  cancelled: "Cancelled",
  failed: "Failed",
  passed: "Passed",
  skipped: "Skipped",
};

const checksLabels: Record<NonNullable<RunDetail["pr"]>["checks"]["conclusion"], string> = {
  failing: "Checks failing",
  passing: "Checks passing",
  pending: "Checks pending",
  unknown: "Checks unknown",
};

const riskBadgeVariant = (riskLevel: NonNullable<RunDetail["cortexTask"]>["riskLevel"]) =>
  riskLevel === "blocked" || riskLevel === "high" ? "destructive" : "outline";

const statusBadgeVariant = (status: NonNullable<RunDetail["cortexTask"]>["status"]) =>
  status === "blocked" || status === "rejected"
    ? "destructive"
    : status === "approved" || status === "queued"
      ? "secondary"
      : "outline";

const safeOptionalText = (value: string): string | null =>
  hasUnsafeDisplayText(value) ? null : safeDisplayText(value);

const safeTextList = (values: readonly string[]): string[] =>
  values.map(safeOptionalText).filter((value): value is string => value !== null);

const safeFinding = (finding: RunDetailCortexFinding): RunDetailCortexFinding | null => {
  const title = safeOptionalText(finding.title);
  const summary = safeOptionalText(finding.summary);

  if (title === null || summary === null) {
    return null;
  }

  return {
    ...finding,
    summary,
    title,
  };
};

export function RunCortexTaskContextPanel({
  context,
  pr,
  validationResults,
}: RunCortexTaskContextPanelProps) {
  if (context === null) {
    return null;
  }

  const title = safeDisplayText(context.title);
  const taskId = safeDisplayText(context.taskId);
  const acceptanceCriteria = safeTextList(context.acceptanceCriteria);
  const findings = context.findings
    .map(safeFinding)
    .filter((finding): finding is RunDetailCortexFinding => finding !== null);
  const validationSuggestions = context.suggestedValidation
    .map((validation) => {
      const label = safeOptionalText(validation.label);
      const validationId = safeOptionalText(validation.validationId);

      if (label === null || validationId === null) {
        return null;
      }

      return {
        label,
        required: validation.required,
        validationId,
      };
    })
    .filter(
      (
        validation,
      ): validation is NonNullable<RunDetail["cortexTask"]>["suggestedValidation"][number] =>
        validation !== null,
    );

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="cortex-task-context"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <ClipboardCheck aria-hidden="true" className="size-5 text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Cortex Task context</p>
          </div>
          <h2 id="cortex-task-context" className="mt-2 text-base font-semibold">
            {title}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{taskId}</p>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Badge variant={riskBadgeVariant(context.riskLevel)}>
            {riskLabels[context.riskLevel]}
          </Badge>
          <Badge variant="outline">{executionModeLabels[context.executionMode]}</Badge>
          <Badge variant={statusBadgeVariant(context.status)}>{statusLabels[context.status]}</Badge>
          <Badge variant="secondary">{approvalLabels[context.approvalStatus]}</Badge>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Acceptance criteria</h3>
          {acceptanceCriteria.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No displayable criteria.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
              {acceptanceCriteria.map((criterion) => (
                <li className="flex gap-2" key={criterion}>
                  <span aria-hidden="true" className="mt-2 size-1.5 rounded-full bg-primary" />
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium">Suggested validation</h3>
          {validationSuggestions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No suggested validation metadata.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {validationSuggestions.map((validation) => (
                <Badge
                  key={validation.validationId}
                  variant={validation.required ? "secondary" : "outline"}
                >
                  {validation.label} · {validation.required ? "Required" : "Optional"}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <FileWarning aria-hidden="true" className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Linked findings</h3>
          </div>
          {findings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No displayable linked findings.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {findings.map((finding) => (
                <li className="rounded-md border border-border p-3" key={finding.findingId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{finding.title}</p>
                    <Badge variant="outline">{findingCategoryLabels[finding.category]}</Badge>
                    <Badge variant="outline">{findingSeverityLabels[finding.severity]}</Badge>
                    <Badge variant="secondary">{findingStatusLabels[finding.status]}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4">
          <div>
            <div className="flex items-center gap-2">
              <GitPullRequest aria-hidden="true" className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">PR evidence</h3>
            </div>
            {pr === null ? (
              <p className="mt-2 text-sm text-muted-foreground">No PR evidence yet.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary">Pull request #{pr.number}</Badge>
                <Badge variant="outline">{safeDisplayText(pr.status)}</Badge>
                <Badge variant="outline">{checksLabels[pr.checks.conclusion]}</Badge>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <ListChecks aria-hidden="true" className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Validation evidence</h3>
            </div>
            {validationResults.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No validation evidence yet.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {validationResults.map((result) => (
                  <Badge key={result.id} variant="outline">
                    {safeDisplayText(result.commandLabel)} · {validationStatusLabels[result.status]}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
