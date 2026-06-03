import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  RepoScanInventorySchema,
  type RepoScanInventory,
} from "@control-plane/shared";

import type { GitHubRepositoryInventoryService } from "../github-inventory";

vi.mock("server-only", () => ({}));

const importModule = async () => import("./github-inventory");

const inventory = (overrides: Partial<RepoScanInventory> = {}): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: ["GitHub Actions"],
  documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
  documentSummaries: [],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 2,
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
    contributionDocCount: 0,
    hasContributionDocs: false,
    hasRootGitignore: false,
    hygieneStatus: "unknown",
    issueLabels: [],
    issueTemplateCount: 0,
    jsLockfileCount: 0,
    monorepoSignalCount: 0,
    monorepoStructureStatus: "unknown",
    packageManagerCount: 0,
    packageManagerStatus: "unknown",
    workspaceConfigCount: 0,
  },
  scannedFileCount: 8,
  totalDirectoryCount: 5,
  totalFileCount: 10,
  ...overrides,
});

const createInventoryService = (
  overrides: Partial<
    Awaited<ReturnType<GitHubRepositoryInventoryService["buildRepositoryInventory"]>>
  > = {},
) => {
  const buildRepositoryInventory = vi.fn<
    GitHubRepositoryInventoryService["buildRepositoryInventory"]
  >(async (input) => ({
    repoId: input.repoId,
    repoScanInventory: inventory(),
    repository: {
      defaultBranch: "main",
      name: "control-plane",
      owner: "acme",
    },
    serviceMetadata: {
      allowlistedFileReadCount: 2,
      githubInstallationId: "12345",
      hasTestDirectories: true,
      policyReadStatus: "parsed",
      skippedOversizedFileCount: 0,
      treeTruncated: false,
    },
    workspaceId: input.workspaceId,
    ...overrides,
  }));

  return {
    buildRepositoryInventory,
  };
};

const expectNoUnsafeInventoryModuleMaterial = (value: unknown) => {
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
        /^(?:content|contents|diff|filePaths|localPath|patch|paths|rawOutput|secret|snippet|source|stderr|stdout|token)$/u.test(
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
  expect(serialized).not.toContain("src/app.ts");
  expect(serialized).not.toContain("/Users/rory");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("ghp_");
  expect(serialized).not.toContain("raw GitHub");
};

describe("GitHub inventory scan module", () => {
  test("calls the GitHub inventory facade and returns inventory plus safe counts and labels", async () => {
    const { createGitHubInventoryScanModule } = await importModule();
    const inventoryService = createInventoryService();
    const module = createGitHubInventoryScanModule({ inventoryService });
    const scanInventory = inventory({
      productClaritySummary: {
        ...inventory().productClaritySummary,
        goalContextStatus: "provided",
        goalContextSummary:
          "Build a hosted control room for safe AI-assisted engineering readiness.",
      } as RepoScanInventory["productClaritySummary"],
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: {
        contractVersion: CONTRACT_VERSION,
        createdAt: "2026-05-25T12:00:00.000Z",
        findingIds: [],
        inventory: scanInventory,
        moduleStatuses: [],
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "running",
        statusSummary: "Repo readiness scan is running.",
        taskRecommendationIds: [],
        updatedAt: "2026-05-25T12:00:00.000Z",
        workspaceId: "workspace_1",
      },
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "github_inventory",
      label: "GitHub inventory",
      order: 0,
      required: true,
    });
    expect(inventoryService.buildRepositoryInventory).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
    expect(result.status).toBe("passed");
    expect(result.inventory).toEqual({
      ...inventory(),
      productClaritySummary: {
        ...inventory().productClaritySummary,
        goalContextStatus: "provided",
        goalContextSummary:
          "Build a hosted control room for safe AI-assisted engineering readiness.",
      },
    });
    expect(
      (result.inventory?.productClaritySummary as Record<string, unknown>).goalContextSummary,
    ).toBe("Build a hosted control room for safe AI-assisted engineering readiness.");
    expect(RepoScanInventorySchema.safeParse(result.inventory).success).toBe(true);
    expect(result.metadata).toEqual({
      agentInstructionCompletenessStatus: "complete",
      agentInstructionFileCount: 1,
      allowlistedFileReadCount: 2,
      ciProviderLabels: ["GitHub Actions"],
      documentationKindCount: 1,
      hasTestDirectories: true,
      languageCount: 1,
      omittedFileCount: 2,
      packageManagerLabels: ["pnpm"],
      policyReadStatus: "parsed",
      scannedFileCount: 8,
      skippedOversizedFileCount: 0,
      totalDirectoryCount: 5,
      totalFileCount: 10,
      treeTruncated: false,
      warningCount: 0,
    });
    expectNoUnsafeInventoryModuleMaterial(result);
  });

  test.each([
    ["missing" as const, false],
    ["unreadable" as const, false],
    ["invalid" as const, false],
    ["parsed" as const, true],
  ])(
    "maps policy status %s and tree truncation %s to warning metadata",
    async (policyReadStatus, treeTruncated) => {
      const { createGitHubInventoryScanModule } = await importModule();
      const inventoryService = createInventoryService({
        serviceMetadata: {
          allowlistedFileReadCount: 0,
          githubInstallationId: "12345",
          hasTestDirectories: false,
          policyReadStatus,
          skippedOversizedFileCount: 1,
          treeTruncated,
        },
      });
      const module = createGitHubInventoryScanModule({ inventoryService });

      const result = await module.run({
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      });

      expect(result.status).toBe("warning");
      expect(result.metadata).toEqual(
        expect.objectContaining({
          policyReadStatus,
          skippedOversizedFileCount: 1,
          treeTruncated,
          warningCount: expect.any(Number),
        }),
      );
      expect(JSON.stringify(result)).not.toContain(".aicp/policy.json");
      expect(JSON.stringify(result)).not.toContain("raw GitHub");
      expectNoUnsafeInventoryModuleMaterial(result);
    },
  );
});
