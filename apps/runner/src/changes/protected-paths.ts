import {
  buildRiskFindingsFromPathPolicyEvaluations,
  evaluatePathsAgainstPolicy,
} from "@control-plane/policies";
import { RiskFindingSchema, type RepoPolicy, type RiskFinding } from "@control-plane/shared";

export type ProtectedPathBlockFinding = RiskFinding;

const PROTECTED_PATH_EVALUATION_FAILED_FINDING = {
  id: "risk:protected_path:evaluation_failed",
  severity: "blocked",
  category: "protected_path",
  message: "Protected path policy could not be evaluated.",
  paths: [],
} as const satisfies RiskFinding;

export const detectProtectedPathBlocks = (
  policy: RepoPolicy,
  changedPaths: readonly string[],
): ProtectedPathBlockFinding[] => {
  try {
    const evaluations = evaluatePathsAgainstPolicy(buildProtectedOnlyPolicy(policy), changedPaths);
    const findings = buildRiskFindingsFromPathPolicyEvaluations(evaluations);

    return findings
      .filter(isProtectedPathBlockFinding)
      .map((finding) => RiskFindingSchema.parse(finding));
  } catch {
    return [RiskFindingSchema.parse(PROTECTED_PATH_EVALUATION_FAILED_FINDING)];
  }
};

const buildProtectedOnlyPolicy = (policy: RepoPolicy): RepoPolicy => ({
  ...policy,
  protectedPaths: [...policy.protectedPaths],
  sensitivePaths: [],
  warningPaths: {
    packageLocks: [],
    migrations: [],
    infrastructure: [],
    auth: [],
    billing: [],
  },
});

const isProtectedPathBlockFinding = (finding: RiskFinding): finding is ProtectedPathBlockFinding =>
  finding.category === "protected_path";
