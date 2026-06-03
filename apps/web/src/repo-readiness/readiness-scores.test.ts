import { describe, expect, test } from "vitest";

import type { Finding, RepoScanInventory } from "@control-plane/shared";

import { calculateReadinessScores } from "./readiness-scores";

type ScoreFinding = Pick<Finding, "category" | "severity" | "status">;

const readyInventory = (overrides: Partial<RepoScanInventory> = {}): RepoScanInventory => ({
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
  documentSummaries: [],
  languageSummaries: [{ fileCount: 6, name: "TypeScript" }],
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
  scannedFileCount: 8,
  totalDirectoryCount: 3,
  totalFileCount: 10,
  validationPostureSummary: {
    detectedCommandLabels: ["format", "lint", "test", "typecheck"],
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    missingCommandLabels: [],
    postureStatus: "ready",
    suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
    validationCommandCount: 4,
  },
  ...overrides,
});

const finding = (overrides: Partial<ScoreFinding> = {}): ScoreFinding => ({
  category: "validation",
  severity: "medium",
  status: "open",
  ...overrides,
});

describe("readiness score calculation", () => {
  test("calculates explainable category and overall scores from open findings", () => {
    const scores = calculateReadinessScores({
      findings: [
        finding({ category: "validation", severity: "medium" }),
        finding({ category: "security", severity: "blocked" }),
      ],
      inventory: readyInventory(),
    });

    expect(scores.categoryScores.validation).toBe(82);
    expect(scores.categoryScores.security).toBe(30);
    expect(scores.overallScore).toBe(30);
    expect(scores.weaknesses).toContain("Security score reduced by blocked readiness finding.");
    expect(scores.explanations.security).toEqual([
      "Started from 100.",
      "Reduced by 70 for 1 open blocked finding.",
    ]);
  });

  test("reduces product clarity and agent readiness when setup documentation is missing", () => {
    const scores = calculateReadinessScores({
      findings: [],
      inventory: readyInventory({
        agentInstructionSummary: {
          completenessStatus: "missing",
          hasAgentInstructions: false,
          instructionFileCount: 0,
          missingSectionLabels: ["agent instructions"],
          readStatus: "missing",
        },
        productClaritySummary: {
          clarityStatus: "missing",
          goalContextStatus: "not_provided",
          hasProductDocs: false,
          missingSignalLabels: ["purpose", "scope", "target_user"],
          productDocCount: 0,
          readStatus: "missing",
          signalLabels: [],
        },
      }),
    });

    expect(scores.categoryScores.product_clarity).toBe(45);
    expect(scores.categoryScores.agent_readiness).toBe(55);
    expect(scores.overallScore).toBe(45);
    expect(scores.weaknesses).toEqual(
      expect.arrayContaining([
        "Product clarity score reduced because product documentation is missing.",
        "Agent readiness score reduced because root agent instructions are missing.",
      ]),
    );
  });

  test("recalculates upward when findings are resolved", () => {
    const blockedOpen = calculateReadinessScores({
      findings: [finding({ category: "security", severity: "blocked", status: "open" })],
      inventory: readyInventory(),
    });
    const blockedResolved = calculateReadinessScores({
      findings: [finding({ category: "security", severity: "blocked", status: "resolved" })],
      inventory: readyInventory(),
    });

    expect(blockedOpen.overallScore).toBe(30);
    expect(blockedResolved.overallScore).toBe(100);
    expect(blockedResolved.categoryScores.security).toBe(100);
  });
});
