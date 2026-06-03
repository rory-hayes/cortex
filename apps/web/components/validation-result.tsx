import type { ValidationResultStatus } from "@control-plane/shared";

import { Badge } from "@/components/ui/badge";
import type { RunDetailValidationResult } from "@/src/runs/detail";

type ValidationResultDisplayProps = {
  results: RunDetailValidationResult[];
};

const statusLabels = {
  cancelled: "Cancelled",
  failed: "Failed",
  passed: "Passed",
  skipped: "Skipped",
} satisfies Record<ValidationResultStatus, string>;

const statusVariant = (status: ValidationResultStatus): "destructive" | "outline" | "secondary" => {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "skipped" || status === "cancelled") {
    return "outline";
  }

  return "secondary";
};

const formatDuration = (durationMs: number): string => {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
};

const unsafeSummaryTextPattern =
  /(?:\braw\s+(?:stdout|stderr|output|log|logs)\b|diff --git|@@ -\d|-----BEGIN|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[a-z]:[\\/]|\\\\)|\b(?:const|let|var|function|class|import|export)\s+[A-Za-z_$]|process\.env|=>)/i;

const visibleSummary = (summary: string): string | null => {
  const trimmedSummary = summary.trim();

  if (trimmedSummary.length === 0 || unsafeSummaryTextPattern.test(trimmedSummary)) {
    return null;
  }

  return trimmedSummary;
};

const summaryEntries = (
  result: RunDetailValidationResult,
): Array<{ label: string; value: string }> => {
  if (!result.redactionApplied) {
    return [];
  }

  return [
    { label: "Output summary", value: result.stdoutSummary },
    { label: "Error summary", value: result.stderrSummary },
  ]
    .map(({ label, value }) => ({ label, value: visibleSummary(value) }))
    .filter((entry): entry is { label: string; value: string } => entry.value !== null);
};

export function ValidationResultDisplay({ results }: ValidationResultDisplayProps) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="validation-results"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Validation</p>
        <h2 id="validation-results" className="text-base font-semibold">
          Validation results
        </h2>
      </div>

      {results.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No validation results submitted yet.</p>
        </div>
      ) : (
        <ol className="mt-5 flex flex-col gap-4">
          {results.map((result) => {
            const summaries = summaryEntries(result);

            return (
              <li className="rounded-md border border-border bg-background p-4" key={result.id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(result.status)}>
                        {statusLabels[result.status]}
                      </Badge>
                      <Badge variant={result.redactionApplied ? "secondary" : "outline"}>
                        {result.redactionApplied
                          ? "Redaction confirmed"
                          : "Summaries hidden; redaction not confirmed."}
                      </Badge>
                    </div>
                    <h3 className="mt-3 break-words text-sm font-semibold leading-6">
                      {result.commandLabel}
                    </h3>
                  </div>

                  <dl className="grid shrink-0 gap-2 font-mono text-xs text-muted-foreground">
                    <div>
                      <dt className="font-sans font-medium text-foreground">Exit code</dt>
                      <dd>Exit code: {result.exitCode ?? "none"}</dd>
                    </div>
                    <div>
                      <dt className="font-sans font-medium text-foreground">Duration</dt>
                      <dd>Duration: {formatDuration(result.durationMs)}</dd>
                    </div>
                  </dl>
                </div>

                {result.redactionApplied ? (
                  summaries.length > 0 ? (
                    <dl className="mt-4 grid gap-3 rounded-md border border-border bg-muted p-3 text-xs leading-5 text-muted-foreground md:grid-cols-2">
                      {summaries.map((summary) => (
                        <div className="min-w-0" key={summary.label}>
                          <dt className="font-mono font-medium text-foreground">{summary.label}</dt>
                          <dd className="mt-1 break-words font-mono">{summary.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No redacted summaries submitted.
                    </p>
                  )
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
