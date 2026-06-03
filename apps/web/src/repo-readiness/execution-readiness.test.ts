import { describe, expect, test } from "vitest";

import type { Finding, RepoScanInventory } from "@control-plane/shared";

import { classifyExecutionReadiness } from "./execution-readiness";

type ClassifierFinding = Pick<Finding, "category" | "deterministicRuleId" | "severity" | "status">;

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

const finding = (overrides: Partial<ClassifierFinding> = {}): ClassifierFinding => ({
  category: "validation",
  deterministicRuleId: "validation_posture.partial",
  severity: "medium",
  status: "open",
  ...overrides,
});

describe("execution readiness classifier", () => {
  test("keeps local runner unavailable when policy and validation are missing while exposing setup PR readiness", () => {
    const classification = classifyExecutionReadiness({
      findings: [
        finding({
          category: "security",
          deterministicRuleId: "security.policy_coverage_missing",
          severity: "high",
        }),
        finding({
          deterministicRuleId: "validation_posture.missing",
          severity: "high",
        }),
      ],
      inventory: readyInventory({
        policySummary: {
          dryRunCheckCount: 0,
          hasPolicyFile: false,
          protectedPathCount: 0,
          sensitivePathCount: 0,
          validationCommandCount: 0,
        },
        validationPostureSummary: {
          detectedCommandLabels: [],
          dryRunCheckCount: 0,
          hasPolicyFile: false,
          missingCommandLabels: ["format", "lint", "test", "typecheck"],
          postureStatus: "missing",
          suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
          validationCommandCount: 0,
        },
      }),
      taskRecommendationIds: [
        "task_recommendation:repo_scan_1:security_policy_coverage",
        "task_recommendation:repo_scan_1:validation_posture",
      ],
    });

    expect(classification.executionReadiness).toBe("setup_pr_ready");
    expect(classification.blockedReasons).toEqual([
      "Local runner execution requires complete repository policy coverage.",
      "Local runner execution requires a complete validation command map.",
      "High-severity readiness findings require setup before local runner execution.",
    ]);
    expect(classification.recommendedNextActions).toContain(
      "Create a setup PR from the open readiness recommendations before enabling local runner execution.",
    );
  });

  test("marks a repo local-runner ready only when policy, validation, and open findings are clear", () => {
    const classification = classifyExecutionReadiness({
      findings: [
        finding({
          category: "security",
          deterministicRuleId: "security.policy_coverage_missing",
          severity: "high",
          status: "resolved",
        }),
      ],
      inventory: readyInventory(),
      taskRecommendationIds: [],
    });

    expect(classification).toEqual({
      blockedReasons: [],
      executionReadiness: "local_runner_ready",
      recommendedNextActions: [
        "Repository is ready for local runner execution after normal human approval.",
      ],
    });
  });

  test("hard-blocks open blocked findings regardless of setup recommendations", () => {
    const classification = classifyExecutionReadiness({
      findings: [
        finding({
          category: "execution_risk",
          deterministicRuleId: "execution_risk.secret_like_payload",
          severity: "blocked",
        }),
      ],
      inventory: readyInventory(),
      taskRecommendationIds: ["task_recommendation:repo_scan_1:execution_risk"],
    });

    expect(classification.executionReadiness).toBe("blocked");
    expect(classification.blockedReasons).toEqual([
      "Blocked readiness findings must be resolved before AI execution can continue.",
    ]);
    expect(classification.recommendedNextActions).toEqual([
      "Resolve blocked readiness findings before creating setup PRs or local runner tasks.",
    ]);
  });

  test("falls back to planning readiness when setup gaps exist without a setup recommendation path", () => {
    const classification = classifyExecutionReadiness({
      findings: [finding({ category: "agent_readiness", severity: "medium" })],
      inventory: readyInventory(),
      taskRecommendationIds: [],
    });

    expect(classification.executionReadiness).toBe("planning_ready");
    expect(classification.blockedReasons).toEqual([]);
    expect(classification.recommendedNextActions).toEqual([
      "Review open readiness findings before approving local runner execution.",
    ]);
  });
});
