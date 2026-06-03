export type LinearIssueEligibilityConfig = {
  readonly labels: readonly string[];
  readonly statuses: readonly string[];
};

export type LinearIssueEligibilityCandidate = {
  readonly labels?: readonly string[] | null;
  readonly status?: string | null;
};

export const DEFAULT_LINEAR_ISSUE_ELIGIBILITY: LinearIssueEligibilityConfig = {
  labels: ["Ready for AI"],
  statuses: ["Ready for AI"],
};

const normalizeEligibilityValue = (value: string): string => value.trim().toLowerCase();

const buildEligibilitySet = (values: readonly string[]): ReadonlySet<string> =>
  new Set(
    values.map(normalizeEligibilityValue).filter((normalizedValue) => normalizedValue.length > 0),
  );

export const isLinearIssueReadyForAi = (
  candidate: LinearIssueEligibilityCandidate,
  config: LinearIssueEligibilityConfig = DEFAULT_LINEAR_ISSUE_ELIGIBILITY,
): boolean => {
  const eligibleStatuses = buildEligibilitySet(config.statuses);
  const eligibleLabels = buildEligibilitySet(config.labels);

  if (eligibleStatuses.size === 0 && eligibleLabels.size === 0) {
    return false;
  }

  const status = candidate.status;

  if (
    typeof status === "string" &&
    status.trim().length > 0 &&
    eligibleStatuses.has(normalizeEligibilityValue(status))
  ) {
    return true;
  }

  for (const label of candidate.labels ?? []) {
    if (eligibleLabels.has(normalizeEligibilityValue(label))) {
      return true;
    }
  }

  return false;
};

export const filterReadyLinearIssueCandidates = <Candidate extends LinearIssueEligibilityCandidate>(
  candidates: readonly Candidate[],
  config: LinearIssueEligibilityConfig = DEFAULT_LINEAR_ISSUE_ELIGIBILITY,
): Candidate[] => candidates.filter((candidate) => isLinearIssueReadyForAi(candidate, config));
