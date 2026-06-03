import { z } from "zod";

export const RISK_FINDING_SEVERITIES = ["warning", "blocked"] as const;

export const RiskFindingSeveritySchema = z.enum(RISK_FINDING_SEVERITIES);
export type RiskFindingSeverity = z.infer<typeof RiskFindingSeveritySchema>;

export const RISK_FINDING_CATEGORIES = [
  "dirty_repo",
  "protected_branch",
  "missing_mapping",
  "missing_validation",
  "missing_capability",
  "sensitive_path",
  "secret",
  "protected_path",
  "validation_failed",
  "stale_lock",
  "duplicate_assignment",
  "large_diff",
  "package_lock",
  "migration",
  "infrastructure",
  "auth",
  "billing",
  "generated_files",
  "validation_skipped",
] as const;

export const RiskFindingCategorySchema = z.enum(RISK_FINDING_CATEGORIES);
export type RiskFindingCategory = z.infer<typeof RiskFindingCategorySchema>;

export const RiskFindingSchema = z
  .object({
    id: z.string().min(1),
    severity: RiskFindingSeveritySchema,
    category: RiskFindingCategorySchema,
    message: z.string().min(1),
    paths: z.array(z.string()),
  })
  .strict();

export type RiskFinding = z.infer<typeof RiskFindingSchema>;
