import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScan,
  type RepoScanInventory,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { TaskRecommendationService } from "../task-recommendations";

vi.mock("server-only", () => ({}));

const importModule = async () => import("./agent-readiness");

const inventory = (
  agentInstructionSummary: RepoScanInventory["agentInstructionSummary"],
): RepoScanInventory => ({
  agentInstructionSummary,
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: ["GitHub Actions"],
  documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
  documentSummaries: [],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 0,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 11,
    hasPolicyFile: true,
    protectedPathCount: 2,
    sensitivePathCount: 3,
    validationCommandCount: 4,
  },
  productClaritySummary: {
    clarityStatus: "missing",
    goalContextStatus: "not_provided",
    hasProductDocs: false,
    missingSignalLabels: [],
    productDocCount: 0,
    readStatus: "missing",
    signalLabels: [],
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
  totalDirectoryCount: 4,
  totalFileCount: 8,
});

const scan = (agentInstructionSummary: RepoScanInventory["agentInstructionSummary"]): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-28T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(agentInstructionSummary),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  statusSummary: "Repo readiness scan is running.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-28T12:00:00.000Z",
  workspaceId: "workspace_1",
});

const missingSummary = (): RepoScanInventory["agentInstructionSummary"] => ({
  completenessStatus: "missing",
  hasAgentInstructions: false,
  instructionFileCount: 0,
  missingSectionLabels: ["agent instructions"],
  readStatus: "missing",
});

const completeSummary = (): RepoScanInventory["agentInstructionSummary"] => ({
  completenessStatus: "complete",
  hasAgentInstructions: true,
  instructionFileCount: 1,
  missingSectionLabels: [],
  readStatus: "read",
});

const createServices = () => {
  const persistedFindings: Finding[] = [];
  const persistedRecommendations: TaskRecommendation[] = [];
  const findingService = {
    persistFinding: vi.fn<RepoFindingService["persistFinding"]>(async (input) => {
      const finding = {
        ...input.finding,
        findingId: `finding_${persistedFindings.length + 1}`,
      };
      persistedFindings.push(finding);

      return {
        dedupeKey: `dedupe_${persistedFindings.length}`,
        finding,
        taskIds: [],
      };
    }),
  };
  const taskRecommendationService = {
    persistTaskRecommendation: vi.fn<TaskRecommendationService["persistTaskRecommendation"]>(
      async (input) => {
        persistedRecommendations.push(input.recommendation);

        return {
          recommendation: input.recommendation,
        };
      },
    ),
  };

  return {
    findingService,
    persistedFindings,
    persistedRecommendations,
    taskRecommendationService,
  };
};

const expectNoUnsafeAgentModuleMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);
      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      if (
        /^(?:content|contents|diff|filePaths|localPath|patch|rawOutput|secret|snippet|stderr|stdout|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(unsafeKeys).toEqual([]);
  expect(serialized).not.toContain("export const");
  expect(serialized).not.toContain("process.env");
  expect(serialized).not.toContain("ghp_");
  expect(serialized).not.toContain("-----BEGIN");
  expect(serialized).not.toContain("diff --git");
};

describe("agent readiness scan module", () => {
  test("persists a high agent_readiness finding and setup recommendation when AGENTS.md is missing", async () => {
    const { createAgentReadinessScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createAgentReadinessScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(missingSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "agent_readiness",
      label: "Agent readiness",
      order: 10,
      required: false,
    });
    expect(result.status).toBe("warning");
    expect(result.findingIds).toEqual(["finding_1"]);
    expect(result.taskRecommendationIds).toEqual([
      "task_recommendation:repo_scan_1:agent_readiness",
    ]);
    expect(persistedFindings[0]).toMatchObject({
      category: "agent_readiness",
      confidence: 1,
      deterministicRuleId: "agent_readiness.missing_agents_md",
      severity: "high",
      title: "Add root agent instructions",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      findingIds: ["finding_1"],
      riskLevel: "medium",
      status: "open",
      title: "Generate root AGENTS.md",
    });
    expect(FindingSchema.safeParse(persistedFindings[0]).success).toBe(true);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expect(findingService.persistFinding).toHaveBeenCalledWith({
      finding: expect.objectContaining({
        deterministicRuleId: "agent_readiness.missing_agents_md",
      }),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
    expect(taskRecommendationService.persistTaskRecommendation).toHaveBeenCalled();
    expect(result.metadata).toEqual({
      completenessStatus: "missing",
      findingCount: 1,
      hasAgentInstructions: false,
      instructionFileCount: 0,
      missingSectionCount: 1,
      readStatus: "missing",
      taskRecommendationCount: 1,
    });
    expectNoUnsafeAgentModuleMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("persists an incomplete finding and recommendation with safe missing-section labels", async () => {
    const { createAgentReadinessScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, ...services } = createServices();
    const module = createAgentReadinessScanModule(services);

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan({
        completenessStatus: "incomplete",
        hasAgentInstructions: true,
        instructionFileCount: 1,
        missingSectionLabels: ["architecture", "security"],
        readStatus: "read",
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(persistedFindings[0]).toMatchObject({
      deterministicRuleId: "agent_readiness.incomplete_agents_md",
      severity: "medium",
      title: "Improve root agent instructions",
    });
    expect(persistedFindings[0]?.evidence[0]?.metadata).toEqual({
      completenessStatus: "incomplete",
      instructionFileCount: 1,
      missingSectionLabels: ["architecture", "security"],
      missingSectionCount: 2,
      readStatus: "read",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      title: "Improve root AGENTS.md",
    });
    expectNoUnsafeAgentModuleMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("returns no finding or recommendation when agent instructions are complete", async () => {
    const { createAgentReadinessScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createAgentReadinessScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(completeSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      metadata: {
        completenessStatus: "complete",
        findingCount: 0,
        hasAgentInstructions: true,
        instructionFileCount: 1,
        missingSectionCount: 0,
        readStatus: "read",
        taskRecommendationCount: 0,
      },
      status: "passed",
      summary: "Agent readiness scan found complete root instructions.",
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
  });

  test("uses only inventory metadata when hostile source-like strings were present in scanned content", async () => {
    const { createAgentReadinessScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, ...services } = createServices();
    const module = createAgentReadinessScanModule(services);

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan({
        completenessStatus: "incomplete",
        hasAgentInstructions: true,
        instructionFileCount: 1,
        missingSectionLabels: ["security"],
        readStatus: "read",
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.findingIds).toEqual(["finding_1"]);
    expectNoUnsafeAgentModuleMaterial({
      persistedFindings,
      persistedRecommendations,
      result,
    });
  });
});
