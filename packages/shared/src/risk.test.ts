import { describe, expect, it } from "vitest";

const DOCUMENTED_RISK_FINDING_SEVERITIES = ["warning", "blocked"] as const;

const DOCUMENTED_RISK_FINDING_CATEGORIES = [
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

type RiskFindingSeverity = (typeof DOCUMENTED_RISK_FINDING_SEVERITIES)[number];
type RiskFindingCategory = (typeof DOCUMENTED_RISK_FINDING_CATEGORIES)[number];

type RiskFinding = {
  id: string;
  severity: RiskFindingSeverity;
  category: RiskFindingCategory;
  message: string;
  paths: string[];
};

type RiskFindingModule = {
  RISK_FINDING_SEVERITIES: readonly RiskFindingSeverity[];
  RiskFindingSeveritySchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RISK_FINDING_CATEGORIES: readonly RiskFindingCategory[];
  RiskFindingCategorySchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RiskFindingSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadRiskFindingModule = async () => (await import("./risk.js")) as RiskFindingModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RiskFindingModule>;

const validFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk-1",
  severity: "blocked",
  category: "sensitive_path",
  message: "Sensitive path changed.",
  paths: [".env"],
  ...overrides,
});

describe("RiskFinding", () => {
  it("exports the documented severity values in canonical order", async () => {
    const { RISK_FINDING_SEVERITIES, RiskFindingSeveritySchema } = await loadRiskFindingModule();

    expect(RISK_FINDING_SEVERITIES).toEqual(DOCUMENTED_RISK_FINDING_SEVERITIES);
    for (const severity of DOCUMENTED_RISK_FINDING_SEVERITIES) {
      expect(RiskFindingSeveritySchema.safeParse(severity).success).toBe(true);
    }
  });

  it("exports every documented category in canonical order", async () => {
    const { RISK_FINDING_CATEGORIES, RiskFindingCategorySchema } = await loadRiskFindingModule();

    expect(RISK_FINDING_CATEGORIES).toEqual(DOCUMENTED_RISK_FINDING_CATEGORIES);
    for (const category of DOCUMENTED_RISK_FINDING_CATEGORIES) {
      expect(RiskFindingCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("validates security-critical blocked findings", async () => {
    const { RiskFindingSchema } = await loadRiskFindingModule();

    const findings: RiskFinding[] = [
      validFinding({
        id: "risk-env",
        severity: "blocked",
        category: "sensitive_path",
        message: ".env changes are blocked.",
        paths: [".env"],
      }),
      validFinding({
        id: "risk-secret",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected.",
        paths: ["src/config.ts"],
      }),
      validFinding({
        id: "risk-protected-path",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path changed.",
        paths: ["SECURITY_MODEL.md"],
      }),
      validFinding({
        id: "risk-duplicate-assignment",
        severity: "blocked",
        category: "duplicate_assignment",
        message: "Job was already claimed by another runner.",
        paths: [],
      }),
      validFinding({
        id: "risk-validation-failed",
        severity: "blocked",
        category: "validation_failed",
        message: "Required validation failed.",
        paths: [],
      }),
    ];

    for (const finding of findings) {
      expect(RiskFindingSchema.safeParse(finding).success).toBe(true);
    }
  });

  it("rejects invalid severities, invalid categories, and missing required fields", async () => {
    const { RiskFindingSchema } = await loadRiskFindingModule();

    expect(RiskFindingSchema.safeParse(validFinding({ severity: "error" as never })).success).toBe(
      false,
    );
    expect(RiskFindingSchema.safeParse(validFinding({ category: "env" as never })).success).toBe(
      false,
    );
    expect(RiskFindingSchema.safeParse({ ...validFinding(), id: undefined }).success).toBe(false);
    expect(RiskFindingSchema.safeParse({ ...validFinding(), message: undefined }).success).toBe(
      false,
    );
    expect(RiskFindingSchema.safeParse({ ...validFinding(), paths: undefined }).success).toBe(
      false,
    );
  });

  it("exports the risk finding contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.RISK_FINDING_SEVERITIES).toEqual(DOCUMENTED_RISK_FINDING_SEVERITIES);
    expect(shared.RiskFindingSeveritySchema?.safeParse("blocked").success).toBe(true);
    expect(shared.RISK_FINDING_CATEGORIES).toEqual(DOCUMENTED_RISK_FINDING_CATEGORIES);
    expect(shared.RiskFindingCategorySchema?.safeParse("secret").success).toBe(true);
    expect(shared.RiskFindingSchema?.safeParse(validFinding()).success).toBe(true);
  });
});
