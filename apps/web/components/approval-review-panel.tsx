import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";

import { EvidenceSummary } from "@/components/evidence-summary";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveRunAction, rejectRunAction, requestRepairAction } from "@/src/server/actions";
import type { RunDetail } from "@/src/runs/detail";
import { summarizeRiskFindings } from "@/src/runs/review-metadata";

type ApprovalReviewPanelProps = {
  runDetail: RunDetail;
};

async function submitApproveRunAction(formData: FormData): Promise<void> {
  "use server";

  await approveRunAction(formData);
}

async function submitRejectRunAction(formData: FormData): Promise<void> {
  "use server";

  await rejectRunAction(formData);
}

async function submitRequestRepairAction(formData: FormData): Promise<void> {
  "use server";

  await requestRepairAction(formData);
}

const hasPolicyRiskEvidence = (runDetail: RunDetail): boolean =>
  runDetail.dryRunResult !== null ||
  (runDetail.mode === "repair" && Array.isArray(runDetail.pr?.riskFlags));

const getEvidenceState = (runDetail: RunDetail) => {
  const hasValidationEvidence = runDetail.validationResults.length > 0;
  const hasPrMetadata = runDetail.pr !== null;
  const hasChangedPathMetadata = (runDetail.pr?.changedFilePaths.length ?? 0) > 0;
  const hasRiskEvidence = hasPolicyRiskEvidence(runDetail);
  const riskSummary = summarizeRiskFindings(
    runDetail.dryRunResult?.blockers,
    runDetail.dryRunResult?.warnings,
    runDetail.pr?.riskFlags,
  );

  return {
    blockerCount: riskSummary.blockerCount,
    changedFileCount: runDetail.pr?.changedFilePaths.length ?? 0,
    complete: hasValidationEvidence && hasPrMetadata && hasChangedPathMetadata && hasRiskEvidence,
    hasChangedPathMetadata,
    hasPrMetadata,
    hasRiskEvidence,
    hasValidationEvidence,
    riskCategoryCounts: riskSummary.categoryCounts,
    warningCount: riskSummary.warningCount,
  };
};

export function ApprovalReviewPanel({ runDetail }: ApprovalReviewPanelProps) {
  const evidence = getEvidenceState(runDetail);
  const isReviewableState = runDetail.state === "awaiting_approval";
  const canRecordDecision = isReviewableState && evidence.complete;
  const missingEvidence = [
    isReviewableState ? null : "Run is not awaiting approval",
    evidence.hasValidationEvidence ? null : "Missing validation evidence",
    evidence.hasPrMetadata ? null : "Missing PR metadata",
    evidence.hasChangedPathMetadata ? null : "Missing changed path metadata",
    evidence.hasRiskEvidence ? null : "Missing policy and risk evidence",
  ].filter((item): item is string => item !== null);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="approval-decision"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Human review</p>
          <h2 id="approval-decision" className="mt-1 text-base font-semibold">
            Approval decision
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Decisions record human review only. Merge remains outside this hosted control surface.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          {canRecordDecision ? (
            <>
              <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
              Evidence complete
            </>
          ) : !isReviewableState ? (
            <>
              <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
              Run is not awaiting approval
            </>
          ) : (
            <>
              <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
              Review evidence incomplete
            </>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Validation evidence", evidence.hasValidationEvidence],
            ["PR metadata", evidence.hasPrMetadata],
            ["Changed path metadata", evidence.hasChangedPathMetadata],
            ["Policy and risk evidence", evidence.hasRiskEvidence],
          ].map(([label, present]) => (
            <div className="rounded-md border border-border bg-background p-3" key={String(label)}>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {present ? "Submitted" : "Not submitted"}
              </p>
            </div>
          ))}
        </div>

        <EvidenceSummary
          blockerCount={evidence.blockerCount}
          changedFileCount={evidence.changedFileCount}
          riskCategoryCounts={evidence.riskCategoryCounts}
          validationStatusCounts={runDetail.validationResults.map((result) => ({
            count: 1,
            status: result.status,
          }))}
          warningCount={evidence.warningCount}
        />
      </div>

      {canRecordDecision ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <form action={submitApproveRunAction} className="rounded-md border border-border p-4">
            <input name="workspaceId" type="hidden" value={runDetail.workspaceId} />
            <input name="runId" type="hidden" value={runDetail.id} />
            <label className="text-sm font-medium" htmlFor="approve-reason">
              Approve
            </label>
            <Textarea
              className="mt-3 min-h-20"
              defaultValue="Evidence reviewed for PR approval."
              id="approve-reason"
              maxLength={1000}
              name="reason"
              required
            />
            <Button className="mt-3" size="sm" type="submit">
              Approve
            </Button>
          </form>

          <form action={submitRejectRunAction} className="rounded-md border border-border p-4">
            <input name="workspaceId" type="hidden" value={runDetail.workspaceId} />
            <input name="runId" type="hidden" value={runDetail.id} />
            <label className="text-sm font-medium" htmlFor="reject-reason">
              Reject
            </label>
            <Textarea
              className="mt-3 min-h-20"
              id="reject-reason"
              maxLength={1000}
              name="reason"
              placeholder="Summarize the review decision without code or logs."
              required
            />
            <Button className="mt-3" size="sm" type="submit" variant="outline">
              Reject
            </Button>
          </form>

          <form action={submitRequestRepairAction} className="rounded-md border border-border p-4">
            <input name="workspaceId" type="hidden" value={runDetail.workspaceId} />
            <input name="previousRunId" type="hidden" value={runDetail.id} />
            <label
              className="flex items-center gap-2 text-sm font-medium"
              htmlFor="repair-feedback"
            >
              <Wrench aria-hidden="true" className="size-4" />
              Request repair
            </label>
            <Textarea
              className="mt-3 min-h-20"
              id="repair-feedback"
              maxLength={2000}
              name="feedback"
              placeholder="Describe the required repair without code, diffs, logs, or secrets."
              required
            />
            <Button className="mt-3" size="sm" type="submit" variant="outline">
              Request repair
            </Button>
          </form>
        </div>
      ) : (
        <div className="mt-5 rounded-md border border-border bg-muted p-4 text-sm leading-6 text-muted-foreground">
          <p>
            Decision controls stay unavailable until the runner has submitted validation evidence,
            PR metadata, changed path metadata, and policy/risk evidence.
          </p>
          <ul className="mt-3 grid gap-1">
            {missingEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
