import { describe, expect, it } from "vitest";

import { FINDING_CATEGORIES } from "./finding.js";
import { CONTRACT_VERSION } from "./version.js";

const DOCUMENTED_EXECUTION_READINESS_STATUSES = [
  "not_ready",
  "setup_required",
  "planning_ready",
  "setup_pr_ready",
  "local_runner_ready",
  "blocked",
] as const;

const UNSAFE_REPO_READINESS_REPORT_KEYS = [
  "sourceCode",
  "rawOutput",
  "patch",
  "secret",
  "stdout",
  "fileContent",
] as const;

const UNSAFE_REPO_READINESS_REPORT_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw stderr: private validation output",
  "https://runner:secret@example.test/repo.git",
  "GITHUB_TOKEN=ghp_readinesssecret1234567890",
  "${GITHUB_TOKEN}",
] as const;

type RepoExecutionReadiness = (typeof DOCUMENTED_EXECUTION_READINESS_STATUSES)[number];
type FindingCategory =
  | "product_clarity"
  | "agent_readiness"
  | "architecture"
  | "backlog_quality"
  | "validation"
  | "ci_cd"
  | "security"
  | "repo_hygiene"
  | "execution_risk"
  | "integration";

type RepoReadinessCategoryScores = Record<FindingCategory, number>;

type RepoReadinessReport = {
  contractVersion: typeof CONTRACT_VERSION;
  reportId: string;
  workspaceId: string;
  repoId: string;
  scanId: string;
  overallScore: number;
  categoryScores: RepoReadinessCategoryScores;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  blockedReasons: string[];
  recommendedNextActions: string[];
  findingIds: string[];
  taskRecommendationIds: string[];
  executionReadiness: RepoExecutionReadiness;
  generatedAt: string;
};

type ZodIssueSummary = {
  path: PropertyKey[];
  message: string;
};

type SchemaLike = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: ZodIssueSummary[];
        };
      };
};

type RepoReadinessReportModule = {
  REPO_EXECUTION_READINESS_STATUSES: readonly RepoExecutionReadiness[];
  RepoReadinessScoreSchema: SchemaLike;
  RepoReadinessCategoryScoresSchema: SchemaLike;
  RepoExecutionReadinessSchema: SchemaLike;
  RepoReadinessReportSchema: SchemaLike;
};

const loadRepoReadinessReportModule = async () =>
  (await import("./repo-readiness-report.js")) as RepoReadinessReportModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RepoReadinessReportModule>;

const validCategoryScores = (): RepoReadinessCategoryScores => ({
  product_clarity: 76,
  agent_readiness: 82,
  architecture: 74,
  backlog_quality: 68,
  validation: 58,
  ci_cd: 63,
  security: 71,
  repo_hygiene: 79,
  execution_risk: 61,
  integration: 66,
});

const validReport = (overrides: Partial<RepoReadinessReport> = {}): RepoReadinessReport => ({
  contractVersion: CONTRACT_VERSION,
  reportId: "report-001",
  workspaceId: "workspace-001",
  repoId: "repo-001",
  scanId: "scan-001",
  overallScore: 70,
  categoryScores: validCategoryScores(),
  summary: "The repository is close to planning-ready but needs validation and policy setup.",
  strengths: ["Architecture notes and runner safety conventions are documented."],
  weaknesses: ["Validation command metadata is incomplete."],
  blockedReasons: ["Local execution should wait for explicit validation commands."],
  recommendedNextActions: [
    "Add validation command metadata.",
    "Review protected path coverage before enabling runner execution.",
  ],
  findingIds: ["finding-validation-001", "finding-security-001"],
  taskRecommendationIds: ["task-recommendation-validation-001"],
  executionReadiness: "setup_required",
  generatedAt: "2026-05-25T10:15:00.000Z",
  ...overrides,
});

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

describe("RepoReadinessReport", () => {
  it("validates a metadata-only repo readiness report", async () => {
    const { RepoReadinessReportSchema } = await loadRepoReadinessReportModule();

    expect(RepoReadinessReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it("requires overall scores to stay within the 0..100 range", async () => {
    const { RepoReadinessReportSchema, RepoReadinessScoreSchema } =
      await loadRepoReadinessReportModule();

    expect(RepoReadinessScoreSchema.safeParse(0).success).toBe(true);
    expect(RepoReadinessScoreSchema.safeParse(100).success).toBe(true);
    expect(RepoReadinessScoreSchema.safeParse(-1).success).toBe(false);
    expect(RepoReadinessScoreSchema.safeParse(101).success).toBe(false);

    expect(RepoReadinessReportSchema.safeParse(validReport({ overallScore: 0 })).success).toBe(
      true,
    );
    expect(RepoReadinessReportSchema.safeParse(validReport({ overallScore: 100 })).success).toBe(
      true,
    );
    expect(RepoReadinessReportSchema.safeParse(validReport({ overallScore: -1 })).success).toBe(
      false,
    );
    expect(RepoReadinessReportSchema.safeParse(validReport({ overallScore: 101 })).success).toBe(
      false,
    );
  });

  it("requires category score keys to exactly match finding categories", async () => {
    const { RepoReadinessCategoryScoresSchema } = await loadRepoReadinessReportModule();
    const scores = validCategoryScores();

    expect(Object.keys(scores)).toEqual([...FINDING_CATEGORIES]);
    expect(RepoReadinessCategoryScoresSchema.safeParse(scores).success).toBe(true);
  });

  it("rejects unknown category score keys", async () => {
    const { RepoReadinessCategoryScoresSchema, RepoReadinessReportSchema } =
      await loadRepoReadinessReportModule();
    const categoryScores = {
      ...validCategoryScores(),
      documentation: 88,
    };

    const scoresResult = RepoReadinessCategoryScoresSchema.safeParse(categoryScores);
    const reportResult = RepoReadinessReportSchema.safeParse(
      validReport({ categoryScores: categoryScores as RepoReadinessCategoryScores }),
    );

    expect(scoresResult.success).toBe(false);
    expect(reportResult.success).toBe(false);
  });

  it("rejects missing category score keys", async () => {
    const { RepoReadinessCategoryScoresSchema, RepoReadinessReportSchema } =
      await loadRepoReadinessReportModule();
    const categoryScores: Partial<RepoReadinessCategoryScores> = validCategoryScores();
    delete categoryScores.integration;

    const scoresResult = RepoReadinessCategoryScoresSchema.safeParse(categoryScores);
    const reportResult = RepoReadinessReportSchema.safeParse(
      validReport({ categoryScores: categoryScores as RepoReadinessCategoryScores }),
    );

    expect(scoresResult.success).toBe(false);
    expect(reportResult.success).toBe(false);
  });

  it("rejects unsafe payload keys recursively", async () => {
    const { RepoReadinessReportSchema } = await loadRepoReadinessReportModule();

    for (const key of UNSAFE_REPO_READINESS_REPORT_KEYS) {
      const result = RepoReadinessReportSchema.safeParse({
        ...validReport(),
        weaknesses: [
          {
            safeSummary: "Only report metadata is allowed.",
            nested: { [key]: "placeholder value" },
          },
        ],
      });

      expect(result.success, `Expected unsafe report key ${key} to be rejected.`).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issuePath(issue.path))).toContain(
          `weaknesses.0.nested.${key}`,
        );
      }
    }
  });

  it("rejects source-like, raw-log, and secret-like text values across reports", async () => {
    const { RepoReadinessReportSchema } = await loadRepoReadinessReportModule();

    for (const unsafeValue of UNSAFE_REPO_READINESS_REPORT_VALUES) {
      expect(
        RepoReadinessReportSchema.safeParse(
          validReport({
            summary: unsafeValue,
          }),
        ).success,
        `Expected report summary value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        RepoReadinessReportSchema.safeParse(
          validReport({
            recommendedNextActions: [unsafeValue],
          }),
        ).success,
        `Expected report action value to reject ${unsafeValue}`,
      ).toBe(false);
    }
  });

  it("accepts only documented execution readiness statuses", async () => {
    const { REPO_EXECUTION_READINESS_STATUSES, RepoExecutionReadinessSchema } =
      await loadRepoReadinessReportModule();

    expect(REPO_EXECUTION_READINESS_STATUSES).toEqual(DOCUMENTED_EXECUTION_READINESS_STATUSES);
    for (const status of DOCUMENTED_EXECUTION_READINESS_STATUSES) {
      expect(RepoExecutionReadinessSchema.safeParse(status).success).toBe(true);
    }

    expect(RepoExecutionReadinessSchema.safeParse("ready").success).toBe(false);
    expect(RepoExecutionReadinessSchema.safeParse("runner_ready").success).toBe(false);
  });

  it("exports the report contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.REPO_EXECUTION_READINESS_STATUSES).toEqual(
      DOCUMENTED_EXECUTION_READINESS_STATUSES,
    );
    expect(shared.RepoReadinessScoreSchema?.safeParse(72).success).toBe(true);
    expect(shared.RepoReadinessCategoryScoresSchema?.safeParse(validCategoryScores()).success).toBe(
      true,
    );
    expect(shared.RepoExecutionReadinessSchema?.safeParse("planning_ready").success).toBe(true);
    expect(shared.RepoReadinessReportSchema?.safeParse(validReport()).success).toBe(true);
  });
});
