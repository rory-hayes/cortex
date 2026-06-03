import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionSchema,
  CancellationRequestSchema,
  ClaimJobRequestSchema,
  ClaimJobResponseSchema,
  CloseRunRequestSchema,
  CortexTaskSchema,
  DryRunResultSchema,
  FindingSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  LinkRunnerRequestSchema,
  LinkRunnerResponseSchema,
  PollJobsRequestSchema,
  PollJobsResponseSchema,
  PrArtifactSchema,
  RepairRequestSchema,
  RepoPolicySchema,
  RepoReadinessReportSchema,
  RepoScanSchema,
  RiskFindingSchema,
  RunEventSchema,
  RunnerCapabilitiesSchema,
  RunnerJobSchema,
  RunStateSchema,
  SubmitDryRunResultRequestSchema,
  SubmitPrArtifactRequestSchema,
  SubmitRunEventRequestSchema,
  SubmitValidationResultRequestSchema,
  TaskRecommendationSchema,
  TaskPacketSchema,
  ValidationCommandSchema,
  ValidationResultSchema,
} from "@control-plane/shared";

type ZodIssueSummary = {
  path: PropertyKey[];
  message: string;
};

type FixtureSchema = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: ZodIssueSummary[];
        };
      };
};

type ValidFixtureCase = {
  path: string;
  schema: FixtureSchema;
};

type InvalidFixtureCase = ValidFixtureCase & {
  expectedIssuePath: string;
};

type RepoReadinessFixtureCoverageCase = {
  contract: string;
  validPath: string;
  schema: FixtureSchema;
  invalidPaths: readonly string[];
  unsafeInvalidPaths: readonly string[];
};

const fixturesRootUrl = new URL("../fixtures/v1/", import.meta.url);

const validFixtureCases: ValidFixtureCase[] = [
  { path: "valid/run-state.json", schema: RunStateSchema },
  { path: "valid/risk-finding.json", schema: RiskFindingSchema },
  { path: "valid/finding.json", schema: FindingSchema },
  { path: "valid/repo-readiness-report.json", schema: RepoReadinessReportSchema },
  { path: "valid/cortex-task.json", schema: CortexTaskSchema },
  { path: "valid/repo-scan.json", schema: RepoScanSchema },
  { path: "valid/task-recommendation.json", schema: TaskRecommendationSchema },
  { path: "valid/validation-command.json", schema: ValidationCommandSchema },
  { path: "valid/repo-policy.json", schema: RepoPolicySchema },
  { path: "valid/task-packet.json", schema: TaskPacketSchema },
  { path: "valid/run-event.json", schema: RunEventSchema },
  { path: "valid/validation-result.json", schema: ValidationResultSchema },
  { path: "valid/approval-decision.json", schema: ApprovalDecisionSchema },
  { path: "valid/runner-capabilities.json", schema: RunnerCapabilitiesSchema },
  { path: "valid/dry-run-result.json", schema: DryRunResultSchema },
  { path: "valid/runner-protocol-link-request.json", schema: LinkRunnerRequestSchema },
  { path: "valid/runner-protocol-link-response.json", schema: LinkRunnerResponseSchema },
  { path: "valid/runner-protocol-heartbeat-request.json", schema: HeartbeatRequestSchema },
  { path: "valid/runner-protocol-heartbeat-response.json", schema: HeartbeatResponseSchema },
  { path: "valid/runner-protocol-runner-job.json", schema: RunnerJobSchema },
  { path: "valid/runner-protocol-poll-jobs-request.json", schema: PollJobsRequestSchema },
  { path: "valid/runner-protocol-poll-jobs-response.json", schema: PollJobsResponseSchema },
  { path: "valid/runner-protocol-claim-job-request.json", schema: ClaimJobRequestSchema },
  { path: "valid/runner-protocol-claim-job-response.json", schema: ClaimJobResponseSchema },
  {
    path: "valid/runner-protocol-submit-run-event-request.json",
    schema: SubmitRunEventRequestSchema,
  },
  {
    path: "valid/runner-protocol-submit-dry-run-result-request.json",
    schema: SubmitDryRunResultRequestSchema,
  },
  {
    path: "valid/runner-protocol-submit-validation-result-request.json",
    schema: SubmitValidationResultRequestSchema,
  },
  { path: "valid/runner-protocol-pr-artifact.json", schema: PrArtifactSchema },
  {
    path: "valid/runner-protocol-submit-pr-artifact-request.json",
    schema: SubmitPrArtifactRequestSchema,
  },
  { path: "valid/runner-protocol-cancellation-request.json", schema: CancellationRequestSchema },
  { path: "valid/runner-protocol-repair-request.json", schema: RepairRequestSchema },
  { path: "valid/runner-protocol-close-run-request.json", schema: CloseRunRequestSchema },
];

const invalidFixtureCases: InvalidFixtureCase[] = [
  {
    path: "invalid/run-state-unknown.json",
    schema: RunStateSchema,
    expectedIssuePath: "<root>",
  },
  {
    path: "invalid/risk-finding-invalid-category.json",
    schema: RiskFindingSchema,
    expectedIssuePath: "category",
  },
  {
    path: "invalid/finding-invalid-category.json",
    schema: FindingSchema,
    expectedIssuePath: "category",
  },
  {
    path: "invalid/finding-unsafe-metadata.json",
    schema: FindingSchema,
    expectedIssuePath: "evidence.0.metadata.nested.secret",
  },
  {
    path: "invalid/repo-readiness-report-invalid-score.json",
    schema: RepoReadinessReportSchema,
    expectedIssuePath: "overallScore",
  },
  {
    path: "invalid/repo-readiness-report-invalid-category-score.json",
    schema: RepoReadinessReportSchema,
    expectedIssuePath: "categoryScores.validation",
  },
  {
    path: "invalid/repo-readiness-report-unsafe-payload-key.json",
    schema: RepoReadinessReportSchema,
    expectedIssuePath: "weaknesses.0.nested.fileContent",
  },
  {
    path: "invalid/cortex-task-unsafe-payload-key.json",
    schema: CortexTaskSchema,
    expectedIssuePath: "metadata.sourceCode",
  },
  {
    path: "invalid/cortex-task-invalid-status.json",
    schema: CortexTaskSchema,
    expectedIssuePath: "status",
  },
  {
    path: "invalid/cortex-task-invalid-external-link.json",
    schema: CortexTaskSchema,
    expectedIssuePath: "externalLinks.0.url",
  },
  {
    path: "invalid/repo-scan-invalid-status.json",
    schema: RepoScanSchema,
    expectedIssuePath: "status",
  },
  {
    path: "invalid/repo-scan-unsafe-payload-key.json",
    schema: RepoScanSchema,
    expectedIssuePath: "inventory.nested.fileContent",
  },
  {
    path: "invalid/task-recommendation-unsafe-metadata-key.json",
    schema: TaskRecommendationSchema,
    expectedIssuePath: "metadata.nested.sourceCode",
  },
  {
    path: "invalid/task-recommendation-missing-finding-link.json",
    schema: TaskRecommendationSchema,
    expectedIssuePath: "findingIds",
  },
  {
    path: "invalid/task-recommendation-converted-without-task.json",
    schema: TaskRecommendationSchema,
    expectedIssuePath: "cortexTaskId",
  },
  {
    path: "invalid/validation-command-invalid-timeout.json",
    schema: ValidationCommandSchema,
    expectedIssuePath: "timeoutSeconds",
  },
  {
    path: "invalid/repo-policy-invalid-contract-version.json",
    schema: RepoPolicySchema,
    expectedIssuePath: "contractVersion",
  },
  {
    path: "invalid/task-packet-embedded-source-like-context.json",
    schema: TaskPacketSchema,
    expectedIssuePath: "context.files.0",
  },
  {
    path: "invalid/run-event-missing-idempotency.json",
    schema: RunEventSchema,
    expectedIssuePath: "idempotencyKey",
  },
  {
    path: "invalid/validation-result-missing-redaction.json",
    schema: ValidationResultSchema,
    expectedIssuePath: "redactionApplied",
  },
  {
    path: "invalid/approval-decision-missing-reason.json",
    schema: ApprovalDecisionSchema,
    expectedIssuePath: "reason",
  },
  {
    path: "invalid/runner-capabilities-invalid-tool-key.json",
    schema: RunnerCapabilitiesSchema,
    expectedIssuePath: "tools",
  },
  {
    path: "invalid/dry-run-result-unsafe-metadata.json",
    schema: DryRunResultSchema,
    expectedIssuePath: "checks.0.metadata.nested.content",
  },
  {
    path: "invalid/runner-protocol-claim-missing-idempotency.json",
    schema: ClaimJobRequestSchema,
    expectedIssuePath: "idempotencyKey",
  },
  {
    path: "invalid/runner-protocol-submit-event-unsafe-metadata.json",
    schema: SubmitRunEventRequestSchema,
    expectedIssuePath: "metadata.nested.sourceCode",
  },
  {
    path: "invalid/runner-protocol-repair-non-repair-packet.json",
    schema: RepairRequestSchema,
    expectedIssuePath: "taskPacket.mode",
  },
  {
    path: "invalid/runner-protocol-pr-artifact-embedded-source-like-field.json",
    schema: PrArtifactSchema,
    expectedIssuePath: "<root>",
  },
];

const repoReadinessFixtureCoverageCases = [
  {
    contract: "Finding",
    validPath: "valid/finding.json",
    schema: FindingSchema,
    invalidPaths: ["invalid/finding-invalid-category.json", "invalid/finding-unsafe-metadata.json"],
    unsafeInvalidPaths: ["invalid/finding-unsafe-metadata.json"],
  },
  {
    contract: "RepoReadinessReport",
    validPath: "valid/repo-readiness-report.json",
    schema: RepoReadinessReportSchema,
    invalidPaths: [
      "invalid/repo-readiness-report-invalid-score.json",
      "invalid/repo-readiness-report-invalid-category-score.json",
      "invalid/repo-readiness-report-unsafe-payload-key.json",
    ],
    unsafeInvalidPaths: ["invalid/repo-readiness-report-unsafe-payload-key.json"],
  },
  {
    contract: "CortexTask",
    validPath: "valid/cortex-task.json",
    schema: CortexTaskSchema,
    invalidPaths: [
      "invalid/cortex-task-invalid-status.json",
      "invalid/cortex-task-invalid-external-link.json",
      "invalid/cortex-task-unsafe-payload-key.json",
    ],
    unsafeInvalidPaths: ["invalid/cortex-task-unsafe-payload-key.json"],
  },
  {
    contract: "RepoScan",
    validPath: "valid/repo-scan.json",
    schema: RepoScanSchema,
    invalidPaths: [
      "invalid/repo-scan-invalid-status.json",
      "invalid/repo-scan-unsafe-payload-key.json",
    ],
    unsafeInvalidPaths: ["invalid/repo-scan-unsafe-payload-key.json"],
  },
  {
    contract: "TaskRecommendation",
    validPath: "valid/task-recommendation.json",
    schema: TaskRecommendationSchema,
    invalidPaths: [
      "invalid/task-recommendation-missing-finding-link.json",
      "invalid/task-recommendation-converted-without-task.json",
      "invalid/task-recommendation-unsafe-metadata-key.json",
    ],
    unsafeInvalidPaths: ["invalid/task-recommendation-unsafe-metadata-key.json"],
  },
] satisfies readonly RepoReadinessFixtureCoverageCase[];

const unsafeFixtureTextPatterns: { label: string; pattern: RegExp }[] = [
  { label: "private key header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    label: "real-looking API token",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/,
  },
  { label: "git diff header", pattern: /diff --git/ },
  { label: "patch hunk", pattern: /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m },
  { label: "dotenv assignment", pattern: /^[A-Z][A-Z0-9_]{2,}=.+$/m },
  {
    label: "module import/export snippet",
    pattern: /\b(?:import|export)\s+(?:type\s+)?(?:\{|\*|const|function|class)\b/,
  },
  {
    label: "declaration snippet",
    pattern: /\b(?:const|let|var|function|class)\s+[A-Za-z_$][\w$]*\s*(?:=|\(|\{)/,
  },
  { label: "script tag", pattern: /<script\b/i },
];

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

const summarizeIssues = (issues: ZodIssueSummary[]): string =>
  issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`).join("\n");

const loadFixture = async (fixturePath: string): Promise<unknown> => {
  const text = await readFile(new URL(fixturePath, fixturesRootUrl), "utf8");
  return JSON.parse(text) as unknown;
};

const listJsonFixtureUrls = async (directoryUrl: URL): Promise<URL[]> => {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const urls = await Promise.all(
    entries.map((entry) => {
      const entryUrl = new URL(entry.name, directoryUrl);

      if (entry.isDirectory()) {
        return listJsonFixtureUrls(new URL(`${entry.name}/`, directoryUrl));
      }

      return entry.name.endsWith(".json") ? [entryUrl] : [];
    }),
  );

  return urls.flat();
};

describe("contract JSON fixtures", () => {
  it.each(validFixtureCases)("parses valid fixture $path", async ({ path, schema }) => {
    const fixture = await loadFixture(path);
    const result = schema.safeParse(fixture);

    if (!result.success) {
      throw new Error(`Expected ${path} to parse.\n${summarizeIssues(result.error.issues)}`);
    }

    expect(result.success).toBe(true);
  });

  it.each(repoReadinessFixtureCoverageCases)(
    "covers $contract repo-readiness fixtures through the public schema entrypoint",
    async ({ contract, validPath, schema, invalidPaths, unsafeInvalidPaths }) => {
      expect(
        validFixtureCases.filter(
          (fixtureCase) => fixtureCase.path === validPath && fixtureCase.schema === schema,
        ),
        `${contract} must have exactly one valid fixture case.`,
      ).toHaveLength(1);

      const missingInvalidPaths = invalidPaths.filter(
        (invalidPath) =>
          !invalidFixtureCases.some(
            (fixtureCase) => fixtureCase.path === invalidPath && fixtureCase.schema === schema,
          ),
      );
      expect(missingInvalidPaths, `${contract} is missing invalid fixture cases.`).toEqual([]);
      expect(
        invalidPaths.length,
        `${contract} must have invalid fixture coverage.`,
      ).toBeGreaterThan(0);

      const missingUnsafeInvalidPaths = unsafeInvalidPaths.filter(
        (unsafeInvalidPath) =>
          !invalidFixtureCases.some(
            (fixtureCase) =>
              fixtureCase.path === unsafeInvalidPath && fixtureCase.schema === schema,
          ),
      );
      expect(
        missingUnsafeInvalidPaths,
        `${contract} is missing unsafe payload/key invalid fixture cases.`,
      ).toEqual([]);
      expect(
        unsafeInvalidPaths.length,
        `${contract} must have unsafe payload/key invalid fixture coverage.`,
      ).toBeGreaterThan(0);

      const validFixture = await loadFixture(validPath);
      const validResult = schema.safeParse(validFixture);
      if (!validResult.success) {
        throw new Error(
          `Expected ${validPath} to parse through ${contract}.\n${summarizeIssues(
            validResult.error.issues,
          )}`,
        );
      }

      for (const invalidPath of invalidPaths) {
        const invalidFixture = await loadFixture(invalidPath);
        const invalidResult = schema.safeParse(invalidFixture);
        expect(invalidResult.success, `${invalidPath} must fail through ${contract}.`).toBe(false);
      }

      for (const unsafeInvalidPath of unsafeInvalidPaths) {
        const unsafeFixture = await loadFixture(unsafeInvalidPath);
        const unsafeResult = schema.safeParse(unsafeFixture);
        if (unsafeResult.success) {
          throw new Error(`Expected ${unsafeInvalidPath} to fail through ${contract}.`);
        }

        const unsafeIssues = unsafeResult.error.issues.filter((issue) =>
          issue.message.includes("unsafe key"),
        );
        expect(
          unsafeIssues,
          `${unsafeInvalidPath} must fail because an unsafe payload key is rejected.`,
        ).not.toEqual([]);
      }
    },
  );

  it.each(invalidFixtureCases)(
    "rejects invalid fixture $path at $expectedIssuePath",
    async ({ path, schema, expectedIssuePath }) => {
      const fixture = await loadFixture(path);
      const result = schema.safeParse(fixture);

      if (result.success) {
        throw new Error(`Expected ${path} to fail validation, but it parsed successfully.`);
      }

      const issuePaths = result.error.issues.map((issue) => issuePath(issue.path));
      expect(issuePaths, summarizeIssues(result.error.issues)).toContain(expectedIssuePath);
    },
  );

  it("keeps fixture files free of raw secrets, diffs, patches, and code snippets", async () => {
    const fixtureUrls = await listJsonFixtureUrls(fixturesRootUrl);

    expect(fixtureUrls.length).toBe(validFixtureCases.length + invalidFixtureCases.length);

    for (const fixtureUrl of fixtureUrls) {
      const text = await readFile(fixtureUrl, "utf8");
      const relativePath = fixtureUrl.href.slice(fixturesRootUrl.href.length);

      for (const { label, pattern } of unsafeFixtureTextPatterns) {
        expect(pattern.test(text), `${relativePath} contains ${label}`).toBe(false);
      }
    }
  });
});
