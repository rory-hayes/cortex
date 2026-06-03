import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  FINDING_CATEGORIES,
  type Finding,
  type RepoReadinessReport,
  type RepoScan,
  type RepoScanInventory,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const importPromptContract = async () => import("./report-summarization-prompt");

const now = "2026-05-26T10:00:00.000Z";

const categoryScores = (): RepoReadinessReport["categoryScores"] =>
  Object.fromEntries(
    FINDING_CATEGORIES.map((category) => [category, 80]),
  ) as RepoReadinessReport["categoryScores"];

const inventory = (overrides: Partial<RepoScanInventory> = {}): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary: {
    backlogFileCount: 1,
    hasBacklog: true,
    missingSignalLabels: [],
    readStatus: "read",
    signalLabels: ["acceptance criteria", "dependencies", "task ids", "validation"],
    structureStatus: "ai_executable",
  },
  backlogSummary: {
    backlogFileCount: 1,
    hasBacklog: true,
    missingStructureLabels: [],
    readStatus: "read",
    structureStatus: "complete",
  },
  ciPostureSummary: {
    detectedCommandLabels: ["test", "typecheck"],
    hasCi: true,
    missingCommandLabels: [],
    postureStatus: "aligned",
    providerLabels: ["github_actions"],
    requiredCommandLabels: ["test", "typecheck"],
    workflowFileCount: 1,
  },
  ciProviderLabels: ["github_actions"],
  documentationSummaries: [{ kind: "architecture", pathCount: 1, present: true }],
  documentSummaries: [
    {
      documentByteCount: 512,
      inputCharacterCount: 420,
      kind: "product",
      label: "Product brief",
      redactedCharacterCount: 420,
      redactionApplied: false,
      summary: "Product docs describe the scan, approve, validate, and review workflow.",
      topicLabels: ["product_scope", "security", "validation", "workflow"],
    },
  ],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 2,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    protectedPathCount: 1,
    sensitivePathCount: 1,
    validationCommandCount: 4,
  },
  productClaritySummary: {
    clarityStatus: "sufficient",
    goalContextStatus: "provided",
    hasProductDocs: true,
    missingSignalLabels: [],
    productDocCount: 1,
    readStatus: "read",
    signalLabels: ["purpose", "scope", "target_user"],
  },
  repoHygieneSummary: {
    contributionDocCount: 1,
    hasContributionDocs: true,
    hasRootGitignore: true,
    hygieneStatus: "healthy",
    issueLabels: [],
    issueTemplateCount: 1,
    jsLockfileCount: 1,
    monorepoSignalCount: 0,
    monorepoStructureStatus: "single_project",
    packageManagerCount: 1,
    packageManagerStatus: "single",
    workspaceConfigCount: 0,
  },
  scannedFileCount: 10,
  totalDirectoryCount: 3,
  totalFileCount: 12,
  validationPostureSummary: {
    detectedCommandLabels: ["format", "test", "typecheck"],
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    missingCommandLabels: ["lint"],
    postureStatus: "partial",
    suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
    validationCommandCount: 3,
  },
  ...overrides,
});

const scan = (overrides: Partial<RepoScan> = {}): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  findingIds: ["finding_1"],
  finishedAt: now,
  inventory: inventory(),
  moduleStatuses: [
    {
      finishedAt: now,
      id: "github_inventory",
      label: "GitHub inventory",
      metadata: { providerRequestCount: 4 },
      order: 0,
      required: true,
      startedAt: now,
      status: "passed",
      summary: "GitHub inventory completed with metadata-only summaries.",
    },
  ],
  readinessReportId: "report_1",
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  startedAt: now,
  status: "completed",
  statusSummary: "Repo readiness scan completed.",
  taskRecommendationIds: ["task_recommendation_1"],
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  confidence: 0.92,
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  deterministicRuleId: "validation_posture.partial",
  evidence: [
    {
      metadata: { missingCommandLabels: ["lint"] },
      paths: ["apps/web/src/api/unsafe-route.ts"],
      summary: "Validation metadata is missing the lint command label.",
    },
  ],
  findingId: "finding_1",
  category: "validation",
  recommendation: "Add lint to the validation metadata before local runner execution.",
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  severity: "medium",
  source: "deterministic_rule",
  status: "open",
  summary: "The repository has a partial validation posture.",
  title: "Validation command map is partial",
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const report = (overrides: Partial<RepoReadinessReport> = {}): RepoReadinessReport => ({
  blockedReasons: [],
  categoryScores: categoryScores(),
  contractVersion: CONTRACT_VERSION,
  executionReadiness: "setup_pr_ready",
  findingIds: ["finding_1"],
  generatedAt: now,
  overallScore: 72,
  recommendedNextActions: ["Create a setup PR task for missing validation metadata."],
  repoId: "github_repository_1",
  reportId: "report_1",
  scanId: "repo_scan_1",
  strengths: ["Product and agent-readiness metadata are present."],
  summary: "Repository is nearly ready for AI-assisted execution.",
  taskRecommendationIds: ["task_recommendation_1"],
  weaknesses: ["Validation metadata needs lint coverage."],
  workspaceId: "workspace_1",
  ...overrides,
});

describe("repo readiness report summarization prompt contract", () => {
  test("builds a safe LLM input from scan metadata, document summaries, and finding summaries only", async () => {
    const { buildRepoReadinessSummaryPrompt } = await importPromptContract();
    const prompt = buildRepoReadinessSummaryPrompt({
      findings: [finding()],
      report: report(),
      scan: scan(),
    });

    expect(prompt.safeInput).toMatchObject({
      expectedReport: {
        executionReadiness: "setup_pr_ready",
        reportId: "report_1",
      },
      findingSummaries: [
        {
          category: "validation",
          evidenceSummaries: ["Validation metadata is missing the lint command label."],
          findingId: "finding_1",
          recommendation: "Add lint to the validation metadata before local runner execution.",
          severity: "medium",
          status: "open",
          summary: "The repository has a partial validation posture.",
          title: "Validation command map is partial",
        },
      ],
      inventorySummary: {
        documentSummaries: [
          {
            label: "Product brief",
            summary: "Product docs describe the scan, approve, validate, and review workflow.",
          },
        ],
      },
      scanMetadata: {
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "completed",
        statusSummary: "Repo readiness scan completed.",
        workspaceId: "workspace_1",
      },
    });
    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0]).toMatchObject({ role: "system" });
    expect(prompt.messages[0]!.content).toContain("concise");
    expect(prompt.messages[0]!.content).toContain("evidence-backed");
    expect(prompt.messages[1]!.content).toContain("RepoReadinessReport");

    const serializedInput = JSON.stringify(prompt.safeInput);
    expect(serializedInput).toContain("Product docs describe the scan, approve");
    expect(serializedInput).toContain("Validation command map is partial");
    expect(serializedInput).not.toContain("apps/web/src/api/unsafe-route.ts");
    expect(serializedInput).not.toContain("providerRequestCount");
  });

  test("rejects unsafe input before building an LLM request", async () => {
    const { buildRepoReadinessSummaryPrompt } = await importPromptContract();

    expect(() =>
      buildRepoReadinessSummaryPrompt({
        findings: [finding()],
        report: report(),
        scan: scan({
          inventory: inventory({
            documentSummaries: [
              {
                documentByteCount: 120,
                inputCharacterCount: 90,
                kind: "readme",
                label: "README",
                redactedCharacterCount: 90,
                redactionApplied: false,
                summary: "```ts\nconst leakedSource = true;\n```",
                topicLabels: ["setup"],
              },
            ],
          }),
        }),
      }),
    ).toThrow();
  });

  test("validates model output against the report contract and expected scope", async () => {
    const { parseRepoReadinessSummaryOutput } = await importPromptContract();
    const expectedReport = report();

    expect(
      parseRepoReadinessSummaryOutput(report({ summary: "Concise evidence-backed summary." }), {
        expectedReport,
      }),
    ).toMatchObject({
      reportId: "report_1",
      summary: "Concise evidence-backed summary.",
    });

    expect(() =>
      parseRepoReadinessSummaryOutput(report({ repoId: "github_repository_2" }), {
        expectedReport,
      }),
    ).toThrow(/scope/i);
    expect(() =>
      parseRepoReadinessSummaryOutput(
        report({ summary: "```ts\nconst leakedSource = true;\n```" }),
        {
          expectedReport,
        },
      ),
    ).toThrow();
  });
});
