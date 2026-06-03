import "server-only";

import type { RepoScanInventory } from "@control-plane/shared";

import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { GitHubRepositoryInventoryService } from "../github-inventory";

export type GitHubInventoryScanModuleInput = {
  inventoryService: Pick<GitHubRepositoryInventoryService, "buildRepositoryInventory">;
};

const warningCountFor = (input: { policyReadStatus: string; treeTruncated: boolean }): number => {
  let warningCount = 0;

  if (input.policyReadStatus !== "parsed") {
    warningCount += 1;
  }

  if (input.treeTruncated) {
    warningCount += 1;
  }

  return warningCount;
};

const withPreservedGoalContext = (input: {
  existingInventory: RepoScanInventory | undefined;
  inventory: RepoScanInventory;
}): RepoScanInventory => {
  const existingSummary = input.existingInventory?.productClaritySummary;

  if (existingSummary?.goalContextStatus !== "provided") {
    return input.inventory;
  }

  return {
    ...input.inventory,
    productClaritySummary: {
      ...input.inventory.productClaritySummary,
      goalContextStatus: "provided",
      ...(existingSummary.goalContextSummary === undefined
        ? {}
        : { goalContextSummary: existingSummary.goalContextSummary }),
    },
  };
};

export const createGitHubInventoryScanModule = ({
  inventoryService,
}: GitHubInventoryScanModuleInput): RepoScanModuleDefinition => ({
  id: "github_inventory",
  label: "GitHub inventory",
  order: 0,
  required: true,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const result = await inventoryService.buildRepositoryInventory({
      repoId: context.repoId,
      workspaceId: context.workspaceId,
    });
    const inventory = withPreservedGoalContext({
      existingInventory: context.scan?.inventory,
      inventory: result.repoScanInventory,
    });
    const warningCount = warningCountFor({
      policyReadStatus: result.serviceMetadata.policyReadStatus,
      treeTruncated: result.serviceMetadata.treeTruncated,
    });

    return {
      inventory,
      metadata: {
        agentInstructionCompletenessStatus: inventory.agentInstructionSummary.completenessStatus,
        agentInstructionFileCount: inventory.agentInstructionSummary.instructionFileCount,
        allowlistedFileReadCount: result.serviceMetadata.allowlistedFileReadCount,
        ciProviderLabels: inventory.ciProviderLabels,
        documentationKindCount: inventory.documentationSummaries.length,
        hasTestDirectories: result.serviceMetadata.hasTestDirectories,
        languageCount: inventory.languageSummaries.length,
        omittedFileCount: inventory.omittedFileCount,
        packageManagerLabels: inventory.packageManagerLabels,
        policyReadStatus: result.serviceMetadata.policyReadStatus,
        scannedFileCount: inventory.scannedFileCount,
        skippedOversizedFileCount: result.serviceMetadata.skippedOversizedFileCount,
        totalDirectoryCount: inventory.totalDirectoryCount,
        totalFileCount: inventory.totalFileCount,
        treeTruncated: result.serviceMetadata.treeTruncated,
        warningCount,
      },
      status: warningCount > 0 ? "warning" : "passed",
      summary:
        warningCount > 0
          ? "GitHub inventory completed with safe metadata warnings."
          : "GitHub inventory completed with metadata-only summaries.",
    };
  },
});
