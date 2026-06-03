import { RiskFindingSchema, type RiskFinding } from "@control-plane/shared";

export const createMissingMappingRiskFinding = (): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:missing_mapping",
    severity: "blocked",
    category: "missing_mapping",
    message: "Runner job is blocked because an active usable repo mapping is required.",
    paths: [],
  });

export const withMissingMappingRiskFinding = (
  riskFindings: RiskFinding[] | null | undefined,
  finding: RiskFinding = createMissingMappingRiskFinding(),
): RiskFinding[] => {
  return [...(riskFindings ?? []).filter((riskFinding) => riskFinding.id !== finding.id), finding];
};
