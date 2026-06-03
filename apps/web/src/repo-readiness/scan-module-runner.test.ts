import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  type RepoScan,
  type RepoScanInventory,
} from "@control-plane/shared";

import type { RepoScanService } from "./repo-scans";

vi.mock("server-only", () => ({}));

const importRunner = async () => import("./scan-module-runner");

const emptyInventory = (): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "missing",
    hasAgentInstructions: false,
    instructionFileCount: 0,
    missingSectionLabels: ["agent instructions"],
    readStatus: "missing",
  },
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: [],
  documentationSummaries: [],
  documentSummaries: [],
  languageSummaries: [],
  omittedFileCount: 0,
  packageManagerLabels: [],
  policySummary: {
    dryRunCheckCount: 0,
    hasPolicyFile: false,
    protectedPathCount: 0,
    sensitivePathCount: 0,
    validationCommandCount: 0,
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
  scannedFileCount: 0,
  totalDirectoryCount: 0,
  totalFileCount: 0,
});

const createScan = (overrides: Partial<RepoScan> = {}): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-25T12:00:00.000Z",
  findingIds: [],
  inventory: emptyInventory(),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "queued",
  statusSummary: "Queued for repo readiness scanning.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-25T12:00:00.000Z",
  workspaceId: "workspace_1",
  ...overrides,
});

const createService = (initialScan: RepoScan = createScan()) => {
  let scan = initialScan;
  const updates: Parameters<RepoScanService["updateRepoScanStatus"]>[0][] = [];
  const service: RepoScanService = {
    createRepoScan: vi.fn<RepoScanService["createRepoScan"]>(),
    getRepoScan: vi.fn<RepoScanService["getRepoScan"]>(async () => scan),
    getRepoScanStatus: vi.fn<RepoScanService["getRepoScanStatus"]>(),
    listRepoScans: vi.fn<RepoScanService["listRepoScans"]>(),
    triggerRepoScanForWebhook: vi.fn<RepoScanService["triggerRepoScanForWebhook"]>(),
    triggerRepoScan: vi.fn<RepoScanService["triggerRepoScan"]>(),
    updateRepoScanStatus: vi.fn<RepoScanService["updateRepoScanStatus"]>(async (input) => {
      updates.push(input);
      scan = {
        ...scan,
        failureSummary: input.failureSummary ?? scan.failureSummary,
        findingIds: input.findingIds ?? scan.findingIds,
        finishedAt: input.status === "failed" ? "2026-05-25T12:10:00.000Z" : scan.finishedAt,
        inventory: input.inventory ?? scan.inventory,
        moduleStatuses: input.moduleStatuses ?? scan.moduleStatuses,
        readinessReportId: input.readinessReportId ?? scan.readinessReportId,
        startedAt: scan.startedAt ?? "2026-05-25T12:00:01.000Z",
        status: input.status,
        statusSummary: input.statusSummary ?? scan.statusSummary,
        taskRecommendationIds: input.taskRecommendationIds ?? scan.taskRecommendationIds,
        updatedAt: "2026-05-25T12:00:01.000Z",
      };

      return scan;
    }),
  };

  return { service, updates };
};

const createNow = () => {
  const dates = [
    "2026-05-25T12:01:00.000Z",
    "2026-05-25T12:01:10.000Z",
    "2026-05-25T12:02:00.000Z",
    "2026-05-25T12:02:10.000Z",
    "2026-05-25T12:03:00.000Z",
    "2026-05-25T12:03:10.000Z",
    "2026-05-25T12:04:00.000Z",
    "2026-05-25T12:04:10.000Z",
  ].map((value) => new Date(value));
  let index = 0;

  return () => dates[index++] ?? new Date("2026-05-25T12:09:00.000Z");
};

const expectNoUnsafeModuleMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toMatch(
    /diff --git|rawOutput|stdout|stderr|sourceCode|patch|snippet|ghp_moduleSecret|\/Users\/rory/i,
  );
};

describe("repo scan module runner", () => {
  test("runs modules by order and stable id while persisting running then terminal status", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService();
    const runOrder: string[] = [];

    await runRepoScanModules({
      modules: [
        {
          id: "zeta",
          label: "Zeta",
          order: 2,
          required: false,
          run: async () => {
            runOrder.push("zeta");
            return { status: "passed", summary: "Zeta completed.", metadata: { count: 1 } };
          },
        },
        {
          id: "alpha",
          label: "Alpha",
          order: 1,
          required: true,
          run: async () => {
            runOrder.push("alpha");
            return { status: "passed", summary: "Alpha completed.", metadata: { count: 2 } };
          },
        },
        {
          id: "beta",
          label: "Beta",
          order: 1,
          required: false,
          run: async () => {
            runOrder.push("beta");
            return { status: "warning", summary: "Beta completed with warnings." };
          },
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(runOrder).toEqual(["alpha", "beta", "zeta"]);
    expect(updates).toHaveLength(6);
    expect(
      updates.map(
        (update) =>
          update.moduleStatuses?.find((status) => status.id === update.moduleStatuses?.[0]?.id)
            ?.status,
      ),
    ).toEqual(["running", "passed", "passed", "passed", "passed", "passed"]);
    expect(updates[0]?.moduleStatuses?.map((status) => status.id)).toEqual([
      "alpha",
      "beta",
      "zeta",
    ]);
    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.status)).toEqual([
      "passed",
      "warning",
      "passed",
    ]);
    expect(updates.at(-1)?.status).toBe("running");
    expectNoUnsafeModuleMaterial(updates);
  });

  test("runs GitHub inventory before agent readiness and persists safe finding and recommendation ids", async () => {
    const { runRepoScanModules } = await importRunner();
    const inventoryWithMissingAgents: RepoScanInventory = {
      ...emptyInventory(),
      scannedFileCount: 4,
      totalFileCount: 4,
    };
    const { service, updates } = createService();

    await runRepoScanModules({
      modules: [
        {
          id: "agent_readiness",
          label: "Agent readiness",
          order: 10,
          required: false,
          run: async (context) => {
            expect(context.scan?.inventory.agentInstructionSummary.completenessStatus).toBe(
              "missing",
            );

            return {
              findingIds: [...(context.scan?.findingIds ?? []), "finding_agent_1"],
              metadata: {
                completenessStatus:
                  context.scan?.inventory.agentInstructionSummary.completenessStatus,
                findingCount: 1,
                taskRecommendationCount: 1,
              },
              status: "warning",
              summary: "Agent readiness generated safe setup recommendations.",
              taskRecommendationIds: [
                ...(context.scan?.taskRecommendationIds ?? []),
                "task_recommendation_agent_1",
              ],
            };
          },
        },
        {
          id: "github_inventory",
          label: "GitHub inventory",
          order: 0,
          required: true,
          run: async () => ({
            inventory: inventoryWithMissingAgents,
            metadata: {
              scannedFileCount: 4,
            },
            status: "passed",
            summary: "GitHub inventory completed with metadata-only summaries.",
          }),
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.id)).toEqual([
      "github_inventory",
      "agent_readiness",
    ]);
    expect(updates.at(-1)?.findingIds).toEqual(["finding_agent_1"]);
    expect(updates.at(-1)?.taskRecommendationIds).toEqual(["task_recommendation_agent_1"]);
    expectNoUnsafeModuleMaterial(updates);
  });

  test("continues after optional module failures", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService();
    const runOrder: string[] = [];

    await runRepoScanModules({
      modules: [
        {
          id: "optional",
          label: "Optional",
          order: 0,
          required: false,
          run: async () => {
            runOrder.push("optional");
            return { status: "failed", summary: "Optional module failed safely." };
          },
        },
        {
          id: "later",
          label: "Later",
          order: 1,
          required: true,
          run: async () => {
            runOrder.push("later");
            return { status: "passed", summary: "Later module passed." };
          },
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(runOrder).toEqual(["optional", "later"]);
    expect(updates.at(-1)?.status).toBe("running");
    expect(updates.at(-1)?.failureSummary).toBeUndefined();
    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.status)).toEqual([
      "failed",
      "passed",
    ]);
  });

  test("carries optional product clarity finding ids into repo scan persistence", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService(
      createScan({
        inventory: {
          ...emptyInventory(),
          documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
        },
      }),
    );

    await runRepoScanModules({
      modules: [
        {
          id: "github_inventory",
          label: "GitHub inventory",
          order: 0,
          required: true,
          run: async () => ({ status: "passed", summary: "Inventory passed." }),
        },
        {
          id: "product_clarity",
          label: "Product clarity",
          order: 1,
          required: false,
          run: async () => ({
            findingIds: ["finding_product_doc_1"],
            metadata: {
              findingCount: 1,
              hasProductDoc: false,
              hasReadme: true,
              ruleIds: ["product_clarity.product_doc.missing"],
            },
            status: "warning",
            summary: "Product clarity scan found missing documentation signals.",
          }),
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(updates.at(-1)?.findingIds).toEqual(["finding_product_doc_1"]);
    expect(updates.at(-1)?.status).toBe("running");
    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.status)).toEqual([
      "passed",
      "warning",
    ]);
    expectNoUnsafeModuleMaterial(updates);
  });

  test("accumulates finding and recommendation ids emitted by multiple modules", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService(
      createScan({
        findingIds: ["finding_existing"],
        taskRecommendationIds: ["task_existing"],
      }),
    );

    await runRepoScanModules({
      modules: [
        {
          id: "first_findings",
          label: "First findings",
          order: 0,
          required: false,
          run: async () => ({
            findingIds: ["finding_first"],
            status: "warning",
            summary: "First module emitted findings.",
            taskRecommendationIds: ["task_first"],
          }),
        },
        {
          id: "second_findings",
          label: "Second findings",
          order: 1,
          required: false,
          run: async () => ({
            findingIds: ["finding_second", "finding_first"],
            status: "warning",
            summary: "Second module emitted findings.",
            taskRecommendationIds: ["task_second", "task_first"],
          }),
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(updates.at(-1)?.findingIds).toEqual([
      "finding_existing",
      "finding_first",
      "finding_second",
    ]);
    expect(updates.at(-1)?.taskRecommendationIds).toEqual([
      "task_existing",
      "task_first",
      "task_second",
    ]);
    expectNoUnsafeModuleMaterial(updates);
  });

  test("accumulates architecture finding and recommendation ids with existing scan ids", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService(
      createScan({
        findingIds: ["finding_existing"],
        inventory: {
          ...emptyInventory(),
          documentationSummaries: [],
        },
        taskRecommendationIds: ["task_existing"],
      }),
    );

    await runRepoScanModules({
      modules: [
        {
          id: "architecture",
          label: "Architecture",
          order: 15,
          required: false,
          run: async (context) => ({
            findingIds: [...(context.scan?.findingIds ?? []), "finding_architecture"],
            metadata: {
              architectureDocCount: 0,
              hasArchitectureDocs: false,
              taskRecommendationCount: 1,
            },
            status: "warning",
            summary: "Architecture scan found no architecture documentation summary.",
            taskRecommendationIds: [
              ...(context.scan?.taskRecommendationIds ?? []),
              "task_recommendation_architecture",
            ],
          }),
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(updates.at(-1)?.findingIds).toEqual(["finding_existing", "finding_architecture"]);
    expect(updates.at(-1)?.taskRecommendationIds).toEqual([
      "task_existing",
      "task_recommendation_architecture",
    ]);
    expect(updates.at(-1)?.moduleStatuses?.[0]).toMatchObject({
      id: "architecture",
      status: "warning",
    });
    expectNoUnsafeModuleMaterial(updates);
  });

  test("fails closed on required module failure and skips remaining modules", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService();
    const laterRun = vi.fn(async () => ({
      status: "passed" as const,
      summary: "Should not run.",
    }));

    await runRepoScanModules({
      modules: [
        {
          id: "required",
          label: "Required",
          order: 0,
          required: true,
          run: async () => ({ status: "failed", summary: "Required module failed safely." }),
        },
        {
          id: "later",
          label: "Later",
          order: 1,
          required: false,
          run: laterRun,
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(laterRun).not.toHaveBeenCalled();
    expect(updates.at(-1)?.status).toBe("failed");
    expect(updates.at(-1)?.failureSummary).toBe("Required repo scan module failed.");
    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(updates.at(-1)?.moduleStatuses?.[1]).toEqual(
      expect.objectContaining({
        finishedAt: expect.any(String),
        summary: "Skipped because a required repo scan module failed.",
      }),
    );
  });

  test("treats blocked as a valid module result instead of a technical failure", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService();
    const laterRun = vi.fn(async () => ({ status: "passed" as const, summary: "Later passed." }));

    await runRepoScanModules({
      modules: [
        {
          id: "blocked_optional",
          label: "Blocked optional",
          order: 0,
          required: false,
          run: async () => ({
            status: "blocked",
            summary: "Optional module produced a safe blocked result.",
          }),
        },
        {
          id: "later",
          label: "Later",
          order: 1,
          required: true,
          run: laterRun,
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(laterRun).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.status).toBe("running");
    expect(updates.at(-1)?.failureSummary).toBeUndefined();
    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.status)).toEqual([
      "blocked",
      "passed",
    ]);
  });

  test("fails closed on required blocked module result and skips remaining modules", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService();
    const laterRun = vi.fn(async () => ({ status: "passed" as const, summary: "Later passed." }));

    await runRepoScanModules({
      modules: [
        {
          id: "blocked_required",
          label: "Blocked required",
          order: 0,
          required: true,
          run: async () => ({
            status: "blocked",
            summary: "Required module blocked on safe metadata.",
          }),
        },
        {
          id: "later",
          label: "Later",
          order: 1,
          required: false,
          run: laterRun,
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(laterRun).not.toHaveBeenCalled();
    expect(updates.at(-1)?.status).toBe("failed");
    expect(updates.at(-1)?.failureSummary).toBe("Required repo scan module blocked.");
    expect(updates.at(-1)?.moduleStatuses?.map((status) => status.status)).toEqual([
      "blocked",
      "skipped",
    ]);
    expectNoUnsafeModuleMaterial(updates);
  });

  test("converts thrown errors to generic safe summaries without leaking error text", async () => {
    const { runRepoScanModules } = await importRunner();
    const { service, updates } = createService();

    await runRepoScanModules({
      modules: [
        {
          id: "required",
          label: "Required",
          order: 0,
          required: true,
          run: async () => {
            throw new Error("diff --git ghp_moduleSecret /Users/rory/private/repo");
          },
        },
        {
          id: "later",
          label: "Later",
          order: 1,
          required: false,
          run: async () => ({ status: "passed", summary: "Later passed." }),
        },
      ],
      now: createNow(),
      scanId: "repo_scan_1",
      service,
      workspaceId: "workspace_1",
    });

    expect(updates.at(-1)?.status).toBe("failed");
    expect(updates.at(-1)?.moduleStatuses?.[0]).toEqual(
      expect.objectContaining({
        metadata: { errorKind: "module_execution_failed" },
        status: "failed",
        summary: "Repo scan module failed without exposing provider details.",
      }),
    );
    expectNoUnsafeModuleMaterial(updates);
  });
});
