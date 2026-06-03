import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionSchema,
  CancellationRequestSchema,
  ClaimJobRequestSchema,
  ClaimJobResponseSchema,
  CloseRunRequestSchema,
  CONTRACT_VERSION,
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

type CompatibilityFixtureCase = {
  path: string;
  schema: FixtureSchema;
};

type RepoReadinessCompatibilityCase = {
  contract: string;
  path: string;
  schema: FixtureSchema;
};

type CompatibilitySuite = {
  label: string;
  contractVersion: typeof CONTRACT_VERSION;
  fixtureRootUrl: URL;
  validCases: CompatibilityFixtureCase[];
};

type ContractVersionField = {
  path: string;
  value: unknown;
};

const compatibilitySuites: CompatibilitySuite[] = [
  {
    label: "v1",
    contractVersion: CONTRACT_VERSION,
    fixtureRootUrl: new URL("../fixtures/v1/", import.meta.url),
    validCases: [
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
      {
        path: "valid/runner-protocol-cancellation-request.json",
        schema: CancellationRequestSchema,
      },
      { path: "valid/runner-protocol-repair-request.json", schema: RepairRequestSchema },
      { path: "valid/runner-protocol-close-run-request.json", schema: CloseRunRequestSchema },
    ],
  },
];

const repoReadinessCompatibilityCases = [
  { contract: "Finding", path: "valid/finding.json", schema: FindingSchema },
  {
    contract: "RepoReadinessReport",
    path: "valid/repo-readiness-report.json",
    schema: RepoReadinessReportSchema,
  },
  { contract: "CortexTask", path: "valid/cortex-task.json", schema: CortexTaskSchema },
  { contract: "RepoScan", path: "valid/repo-scan.json", schema: RepoScanSchema },
  {
    contract: "TaskRecommendation",
    path: "valid/task-recommendation.json",
    schema: TaskRecommendationSchema,
  },
] satisfies readonly RepoReadinessCompatibilityCase[];

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

const summarizeIssues = (issues: ZodIssueSummary[]): string =>
  issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`).join("\n");

const loadJsonFixture = async (path: string, rootUrl: URL): Promise<unknown> => {
  const text = await readFile(new URL(path, rootUrl), "utf8");
  return JSON.parse(text) as unknown;
};

const listJsonFixturePaths = async (directoryUrl: URL, rootUrl: URL): Promise<string[]> => {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const entryUrl = new URL(entry.name, directoryUrl);

      if (entry.isDirectory()) {
        return listJsonFixturePaths(new URL(`${entry.name}/`, directoryUrl), rootUrl);
      }

      return entry.name.endsWith(".json") ? [entryUrl.href.slice(rootUrl.href.length)] : [];
    }),
  );

  return paths.flat().sort();
};

const collectContractVersionFields = (
  value: unknown,
  path: string[] = [],
  fields: ContractVersionField[] = [],
): ContractVersionField[] => {
  if (typeof value !== "object" || value === null) {
    return fields;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectContractVersionFields(item, [...path, String(index)], fields),
    );
    return fields;
  }

  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, "contractVersion")) {
    fields.push({
      path: [...path, "contractVersion"].join(".") || "contractVersion",
      value: record.contractVersion,
    });
  }

  for (const [key, childValue] of Object.entries(record)) {
    collectContractVersionFields(childValue, [...path, key], fields);
  }

  return fields;
};

describe.each(compatibilitySuites)("$label contract compatibility fixtures", (suite) => {
  it(`parses every valid ${suite.label} fixture with the current schemas`, async () => {
    for (const fixtureCase of suite.validCases) {
      const fixture = await loadJsonFixture(fixtureCase.path, suite.fixtureRootUrl);
      const result = fixtureCase.schema.safeParse(fixture);

      if (!result.success) {
        throw new Error(
          `Expected ${fixtureCase.path} to parse with current schemas.\n${summarizeIssues(
            result.error.issues,
          )}`,
        );
      }

      expect(result.success).toBe(true);
    }
  });

  it(`the ${suite.label} compatibility manifest covers every valid fixture file`, async () => {
    const actualFixturePaths = await listJsonFixturePaths(
      new URL("valid/", suite.fixtureRootUrl),
      suite.fixtureRootUrl,
    );
    const manifestFixturePaths = suite.validCases.map((fixtureCase) => fixtureCase.path).sort();

    expect(manifestFixturePaths).toEqual(actualFixturePaths);
  });

  it(`${suite.label} compatibility manifest keeps repo-readiness fixture coverage complete`, () => {
    for (const expectedCase of repoReadinessCompatibilityCases) {
      const matches = suite.validCases.filter(
        (fixtureCase) =>
          fixtureCase.path === expectedCase.path && fixtureCase.schema === expectedCase.schema,
      );

      expect(
        matches,
        `${expectedCase.contract} must be present in the ${suite.label} manifest with its public schema.`,
      ).toHaveLength(1);
    }
  });

  it(`${suite.label} fixtures that declare contractVersion use the current ${suite.label} contract version`, async () => {
    const mismatches: string[] = [];

    for (const fixtureCase of suite.validCases) {
      const fixture = await loadJsonFixture(fixtureCase.path, suite.fixtureRootUrl);
      const fields = collectContractVersionFields(fixture);

      for (const field of fields) {
        if (field.value !== suite.contractVersion) {
          mismatches.push(
            `${fixtureCase.path}:${field.path} expected ${suite.contractVersion}, received ${String(
              field.value,
            )}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
