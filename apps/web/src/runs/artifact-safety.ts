import type {
  DryRunResult,
  SubmitDryRunResultRequest,
  SubmitPrArtifactRequest,
  SubmitValidationResultRequest,
} from "@control-plane/shared";

import {
  hasUnsafePayloadPathText,
  hasUnsafePayloadText,
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";

const unsafeLocalPathTextPatterns = [
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\))/i,
] as const;

export const hasUnsafeArtifactText = (value: string): boolean =>
  hasUnsafePayloadText(value) || unsafeLocalPathTextPatterns.some((pattern) => pattern.test(value));

export const hasUnsafePathText = hasUnsafePayloadPathText;

const containsUnsafeArtifactText = (
  value: unknown,
  options: { inspectKeys?: boolean } = {},
  seen: WeakSet<object> = new WeakSet(),
): boolean => {
  if (typeof value === "string") {
    return hasUnsafeArtifactText(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((childValue) => containsUnsafeArtifactText(childValue, options, seen));
  }

  return Object.entries(value).some(
    ([key, childValue]) =>
      (options.inspectKeys === true && hasUnsafeArtifactText(key)) ||
      containsUnsafeArtifactText(childValue, options, seen),
  );
};

const hasUnsafeArtifactValues = (values: unknown[], inspectKeys = false): boolean =>
  values.some(
    (value) =>
      hasUnsafeWebBoundPayload(value, { inspectKeys }) ||
      containsUnsafeArtifactText(value, { inspectKeys }),
  );

const hasUnsafePathValues = (paths: string[]): boolean =>
  paths.some((path) => hasUnsafePathText(path));

const hasUnsafeRiskFindings = (
  findings: Array<Pick<DryRunResult["warnings"][number], "id" | "message" | "paths">>,
): boolean =>
  findings.some(
    (finding) =>
      hasUnsafeArtifactValues([finding.id, finding.message]) ||
      hasUnsafePathValues(finding.paths),
  );

export const hasUnsafeDryRunResultSubmissionRequest = (
  request: SubmitDryRunResultRequest,
): boolean =>
  hasUnsafeArtifactValues([
    request.result.id,
    request.result.status,
    request.result.capabilities,
  ]) ||
  hasUnsafeArtifactValues(request.result.checks, true) ||
  hasUnsafeRiskFindings(request.result.blockers) ||
  hasUnsafeRiskFindings(request.result.warnings);

export const hasUnsafeValidationResultSubmissionRequest = (
  request: SubmitValidationResultRequest,
): boolean =>
  !request.result.redactionApplied ||
  hasUnsafeArtifactValues([
    request.result.id,
    request.result.commandId,
    request.result.commandLabel,
    request.result.command,
    request.result.stdoutSummary,
    request.result.stderrSummary,
  ]);

export const hasUnsafePrArtifactSubmissionRequest = (
  request: SubmitPrArtifactRequest,
): boolean =>
  hasUnsafeArtifactValues([
    request.artifact.id,
    request.artifact.repository.owner,
    request.artifact.repository.name,
    request.artifact.branchName,
    request.artifact.prUrl,
    request.artifact.prTitle,
  ]) ||
  hasUnsafePathValues(request.artifact.changedFilePaths) ||
  hasUnsafeRiskFindings(request.artifact.riskFindings);
