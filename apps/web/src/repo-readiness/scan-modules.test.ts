import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("repo scan modules entrypoint", () => {
  test("exports the module runner and built-in scan module factories", async () => {
    const scanModules = await import("./scan-modules");

    expect(scanModules.runRepoScanModules).toBeTypeOf("function");
    expect(scanModules.createGitHubInventoryScanModule).toBeTypeOf("function");
    expect(scanModules.createArchitectureScanModule).toBeTypeOf("function");
    expect(scanModules.createAgentReadinessScanModule).toBeTypeOf("function");
    expect(scanModules.createBacklogQualityScanModule).toBeTypeOf("function");
    expect(scanModules.createCiCdScanModule).toBeTypeOf("function");
    expect(scanModules.createProductClarityScanModule).toBeTypeOf("function");
    expect(scanModules.createValidationPostureScanModule).toBeTypeOf("function");
    expect(scanModules.createSecurityScanModule).toBeTypeOf("function");
    expect(scanModules.createRepoHygieneScanModule).toBeTypeOf("function");
    expect(scanModules.createRepoReadinessScanModules).toBeTypeOf("function");
  });

  test("composes production scan modules in deterministic inventory, product clarity, agent readiness, architecture, backlog, validation, CI/CD, security, then repo hygiene order", async () => {
    const { createRepoReadinessScanModules } = await import("./scan-modules");
    const modules = createRepoReadinessScanModules({
      findingService: {
        persistFinding: vi.fn(),
      },
      inventoryService: {
        buildRepositoryInventory: vi.fn(),
      },
      taskRecommendationService: {
        persistTaskRecommendation: vi.fn(),
      },
    });

    expect(modules.map((module) => module.id)).toEqual([
      "github_inventory",
      "product_clarity",
      "agent_readiness",
      "architecture",
      "backlog_quality",
      "validation_posture",
      "ci_cd",
      "security",
      "repo_hygiene",
    ]);
    expect(modules.map((module) => module.required)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(modules.map((module) => module.order)).toEqual([0, 5, 10, 15, 18, 19, 20, 20, 25]);
  });
});
