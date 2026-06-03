import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  type RepoScanInventory,
  type RepoScanModuleStatus,
} from "@control-plane/shared";

import type { BillingPlanLimitService } from "../billing/plan-limits";
import type { RepoScanRecord } from "../db";
import type { RepoScanStore, TriggerRepoScanInput, UpdateRepoScanStatusInput } from "./repo-scans";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRepoScans = async () => import("./repo-scans");

type StoredGitHubRepository = {
  githubInstallationId: string;
  id: string;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

type StoredRepoScan = RepoScanRecord;
type StoredFindingStatusRow = {
  repoId: string;
  scanId: string;
  severity: "info" | "low" | "medium" | "high" | "blocked";
  status: "open" | "dismissed" | "deferred" | "resolved";
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

const now = new Date("2026-05-25T10:00:00.000Z");
const later = new Date("2026-05-25T10:05:00.000Z");

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

const populatedInventory = (): RepoScanInventory => ({
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
    clarityStatus: "sufficient",
    goalContextStatus: "not_provided",
    hasProductDocs: true,
    missingSignalLabels: [],
    productDocCount: 1,
    readStatus: "read",
    signalLabels: ["problem", "purpose", "scope", "success_criteria", "target_user"],
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
  totalDirectoryCount: 5,
  totalFileCount: 10,
});

const passedModuleStatus = (
  overrides: Partial<RepoScanModuleStatus> = {},
): RepoScanModuleStatus => ({
  id: "github_inventory",
  label: "GitHub inventory",
  metadata: {
    languageCount: 1,
    packageManagerLabels: ["pnpm"],
  },
  order: 0,
  required: true,
  status: "passed",
  summary: "Metadata-only GitHub inventory completed.",
  startedAt: now.toISOString(),
  finishedAt: later.toISOString(),
  ...overrides,
});

const createScanRow = (overrides: Partial<StoredRepoScan> = {}): StoredRepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  failureSummary: null,
  findingIds: [],
  finishedAt: null,
  id: "repo_scan_1",
  inventory: emptyInventory(),
  moduleStatuses: [],
  readinessReportId: null,
  repoId: "github_repository_1",
  startedAt: null,
  status: "queued",
  statusSummary: "Queued for repo readiness scanning.",
  taskRecommendationIds: [],
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  options: {
    findingStatuses?: StoredFindingStatusRow[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredGitHubRepository[];
    scans?: StoredRepoScan[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const repositories = [
    ...(options.repositories ?? [
      {
        githubInstallationId: "42",
        id: "github_repository_1",
        repositoryExternalId: "9001",
        repositoryName: "control-plane",
        repositoryOwner: "acme",
        workspaceId: "workspace_1",
      },
    ]),
  ];
  const scans = [...(options.scans ?? [])];
  const findingStatuses = [...(options.findingStatuses ?? [])];

  return {
    auditEvents,
    createRepoScanWithAudit: vi.fn<RepoScanStore["createRepoScanWithAudit"]>(async (input) => {
      const storedScan = createScanRow(input.scan as Partial<StoredRepoScan>);

      scans.push(storedScan);
      auditEvents.push(input.auditEvent);

      return storedScan;
    }),
    findGitHubRepository: vi.fn(
      async (input: { repoId: string; workspaceId: string }) =>
        repositories.find(
          (repository) =>
            repository.id === input.repoId && repository.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    findGitHubRepositoryForWebhook: vi.fn(
      async (input: {
        githubInstallationId: string;
        repositoryExternalId: string;
        repositoryName: string;
        repositoryOwner: string;
      }) =>
        repositories.find(
          (repository) =>
            repository.githubInstallationId === input.githubInstallationId &&
            repository.repositoryExternalId === input.repositoryExternalId &&
            repository.repositoryName === input.repositoryName &&
            repository.repositoryOwner === input.repositoryOwner,
        ) ?? null,
    ),
    findActiveRepoScanForRepo: vi.fn(
      async (input: { repoId: string; workspaceId: string }) =>
        scans
          .filter(
            (scan) =>
              scan.repoId === input.repoId &&
              scan.workspaceId === input.workspaceId &&
              (scan.status === "queued" || scan.status === "running"),
          )
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null,
    ),
    getRepoScanFindingStatusCounts: vi.fn(
      async (input: { repoId: string; scanId: string; workspaceId: string }) => {
        const scopedFindings = findingStatuses.filter(
          (finding) =>
            finding.repoId === input.repoId &&
            finding.scanId === input.scanId &&
            finding.workspaceId === input.workspaceId,
        );

        return {
          blockedFindingCount: scopedFindings.filter((finding) => finding.severity === "blocked")
            .length,
          openFindingCount: scopedFindings.filter((finding) => finding.status === "open").length,
        };
      },
    ),
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    getRepoScan: vi.fn(
      async (input: { scanId: string; workspaceId: string }) =>
        scans.find((scan) => scan.id === input.scanId && scan.workspaceId === input.workspaceId) ??
        null,
    ),
    listRepoScans: vi.fn(async (input: { repoId?: string; workspaceId: string }) =>
      scans
        .filter(
          (scan) =>
            scan.workspaceId === input.workspaceId &&
            (input.repoId === undefined || scan.repoId === input.repoId),
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    ),
    repositories,
    scans,
    updateRepoScanWithAudit: vi.fn(
      async (input: {
        auditEvent: StoredAuditEvent;
        scanId: string;
        updates: Partial<StoredRepoScan>;
        workspaceId: string;
      }) => {
        const scan = scans.find(
          (candidate) =>
            candidate.id === input.scanId && candidate.workspaceId === input.workspaceId,
        );

        if (scan === undefined) {
          return null;
        }

        Object.assign(scan, input.updates);
        auditEvents.push(input.auditEvent);

        return scan;
      },
    ),
  };
};

const createService = async (input: {
  currentTime?: Date;
  store: ReturnType<typeof createStore>;
  usageLimitService?: Pick<BillingPlanLimitService, "assertUsageAllowed">;
  userId?: string | null;
}) => {
  const { createRepoScanService } = await importRepoScans();

  return createRepoScanService({
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createScanId: () => `repo_scan_${input.store.scans.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: () => input.currentTime ?? now,
    store: input.store,
    ...(input.usageLimitService === undefined
      ? {}
      : { usageLimitService: input.usageLimitService }),
  });
};

const expectNoUnsafeScanMaterial = (value: unknown) => {
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
        /^(?:code|content|diff|filePaths|localPath|patch|pathInventory|rawOutput|secret|source|stderr|stdout|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("const leaked");
  expect(serialized).not.toContain(".env.local");
  expect(serialized).not.toContain("PRIVATE KEY");
  expect(serialized).not.toContain("raw GitHub output");
  expect(serialized).not.toContain("repo-secret-token");
  expect(serialized).not.toContain("/Users/rory/private/repo");
  expect(unsafeKeys).toEqual([]);
};

describe("repo scan service", () => {
  test("triggers a queued scan for a workspace member and registered GitHub repo", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.triggerRepoScan({
      repoId: "github_repository_1",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual({
      created: true,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued",
      workspaceId: "workspace_1",
    });
    expect(store.findActiveRepoScanForRepo).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
    expect(store.createRepoScanWithAudit).toHaveBeenCalledTimes(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_scans.created",
        metadata: {
          findingCount: 0,
          moduleCount: 0,
          moduleStatusCounts: {},
          productGoalContextStatus: "not_provided",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "queued",
          statusSummaryLength: 35,
          taskRecommendationCount: 0,
        },
      }),
    ]);
    expectNoUnsafeScanMaterial({ audit: store.auditEvents, result, stored: store.scans });
  });

  test("saves safe optional product goal context in queued scan inventory", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.triggerRepoScan({
        productGoal: "Build a hosted control room for safe AI-assisted engineering readiness.",
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      } as unknown as TriggerRepoScanInput),
    ).resolves.toEqual({
      created: true,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued",
      workspaceId: "workspace_1",
    });

    expect(store.scans[0]?.inventory.productClaritySummary).toEqual({
      clarityStatus: "missing",
      goalContextStatus: "provided",
      goalContextSummary: "Build a hosted control room for safe AI-assisted engineering readiness.",
      hasProductDocs: false,
      missingSignalLabels: [],
      productDocCount: 0,
      readStatus: "missing",
      signalLabels: [],
    });
    expect(store.auditEvents[0]?.metadata).toEqual(
      expect.objectContaining({
        productGoalContextStatus: "provided",
      }),
    );
    expectNoUnsafeScanMaterial({ audit: store.auditEvents, stored: store.scans });
  });

  test("blocks manual repo scans when the workspace is over its plan limit", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const usageLimitService = {
      assertUsageAllowed: vi.fn(async () => {
        throw Object.assign(
          new Error("Plan limit reached. Upgrade, request an admin override, or wait for reset."),
          { code: "plan_limit_exceeded" },
        );
      }),
    };
    const service = await createService({ store, usageLimitService });

    await expect(
      service.triggerRepoScan({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({
      code: "plan_limit_exceeded",
      message: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
    });

    expect(usageLimitService.assertUsageAllowed).toHaveBeenCalledWith({
      usageEventType: "repo_scan",
      workspaceId: "workspace_1",
    });
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("rejects unsafe optional product goal context before persistence", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.triggerRepoScan({
        productGoal: "const leaked = process.env.SECRET;",
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      } as unknown as TriggerRepoScanInput),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test.each(["queued", "running"] as const)(
    "debounces an existing %s scan for the same workspace and repo",
    async (status) => {
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        scans: [
          createScanRow({
            id: "repo_scan_existing",
            startedAt: status === "running" ? now : null,
            status,
          }),
        ],
      });
      const service = await createService({ store });

      await expect(
        service.triggerRepoScan({
          repoId: "github_repository_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        created: false,
        repoId: "github_repository_1",
        scanId: "repo_scan_existing",
        status,
        workspaceId: "workspace_1",
      });
      expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
      expect(store.auditEvents).toEqual([]);
    },
  );

  test.each(["completed", "failed", "cancelled"] as const)(
    "does not debounce a prior %s scan",
    async (status) => {
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        scans: [
          createScanRow({
            failureSummary: status === "failed" ? "Unable to inspect safe metadata." : null,
            finishedAt: later,
            id: "repo_scan_terminal",
            readinessReportId: status === "completed" ? "readiness_report_1" : null,
            status,
          }),
        ],
      });
      const service = await createService({ store });

      await expect(
        service.triggerRepoScan({
          repoId: "github_repository_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        created: true,
        repoId: "github_repository_1",
        scanId: "repo_scan_2",
        status: "queued",
        workspaceId: "workspace_1",
      });
      expect(store.scans).toHaveLength(2);
      expect(store.scans.at(-1)?.status).toBe("queued");
    },
  );

  test("triggers a queued scan from a scoped GitHub webhook without user membership", async () => {
    const store = createStore();
    const service = await createService({ store, userId: null });

    await expect(
      service.triggerRepoScanForWebhook({
        deliveryId: "123e4567-e89b-42d3-a456-426614174000",
        githubInstallationId: 42,
        reason: "default_branch_push",
        repository: {
          id: 9001,
          name: "control-plane",
          owner: "acme",
        },
      }),
    ).resolves.toEqual({
      created: true,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued",
      workspaceId: "workspace_1",
    });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.findGitHubRepositoryForWebhook).toHaveBeenCalledWith({
      githubInstallationId: "42",
      repositoryExternalId: "9001",
      repositoryName: "control-plane",
      repositoryOwner: "acme",
    });
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_scans.webhook_triggered",
        metadata: expect.objectContaining({
          deliveryId: "123e4567-e89b-42d3-a456-426614174000",
          githubInstallationId: "42",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "queued",
          triggerReason: "default_branch_push",
        }),
      }),
    ]);
    expectNoUnsafeScanMaterial({ audit: store.auditEvents, stored: store.scans });
  });

  test("blocks webhook-triggered repo scans when the workspace is over its plan limit", async () => {
    const store = createStore();
    const usageLimitService = {
      assertUsageAllowed: vi.fn(async () => {
        throw Object.assign(
          new Error("Plan limit reached. Upgrade, request an admin override, or wait for reset."),
          { code: "plan_limit_exceeded" },
        );
      }),
    };
    const service = await createService({ store, usageLimitService, userId: null });

    await expect(
      service.triggerRepoScanForWebhook({
        deliveryId: "123e4567-e89b-42d3-a456-426614174000",
        githubInstallationId: 42,
        reason: "default_branch_push",
        repository: {
          id: 9001,
          name: "control-plane",
          owner: "acme",
        },
      }),
    ).rejects.toMatchObject({
      code: "plan_limit_exceeded",
      message: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
    });

    expect(usageLimitService.assertUsageAllowed).toHaveBeenCalledWith({
      usageEventType: "repo_scan",
      workspaceId: "workspace_1",
    });
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("debounces webhook-triggered scans while a scan is already queued", async () => {
    const store = createStore({
      scans: [createScanRow({ id: "repo_scan_existing", status: "queued" })],
    });
    const service = await createService({ store, userId: null });

    await expect(
      service.triggerRepoScanForWebhook({
        deliveryId: "123e4567-e89b-42d3-a456-426614174000",
        githubInstallationId: 42,
        reason: "pull_request_merged",
        repository: {
          id: 9001,
          name: "control-plane",
          owner: "acme",
        },
      }),
    ).resolves.toEqual({
      created: false,
      repoId: "github_repository_1",
      scanId: "repo_scan_existing",
      status: "queued",
      workspaceId: "workspace_1",
    });
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("ignores webhook scan triggers for repositories that are not installed in a workspace", async () => {
    const store = createStore({ repositories: [] });
    const service = await createService({ store, userId: null });

    await expect(
      service.triggerRepoScanForWebhook({
        deliveryId: "123e4567-e89b-42d3-a456-426614174000",
        githubInstallationId: 42,
        reason: "default_branch_push",
        repository: {
          id: 9001,
          name: "control-plane",
          owner: "acme",
        },
      }),
    ).resolves.toBeNull();
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test.each<
    [
      string,
      TriggerRepoScanInput,
      {
        memberships?: Array<{ userId: string; workspaceId: string }>;
        repositories?: StoredGitHubRepository[];
      },
    ]
  >([
    [
      "non-member",
      { repoId: "github_repository_1", workspaceId: "workspace_1" },
      { memberships: [] },
    ],
    [
      "missing repo",
      { repoId: "github_repository_1", workspaceId: "workspace_1" },
      { memberships: [{ userId: "user_1", workspaceId: "workspace_1" }], repositories: [] },
    ],
    [
      "cross-workspace repo",
      { repoId: "github_repository_1", workspaceId: "workspace_1" },
      {
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        repositories: [
          {
            githubInstallationId: "42",
            id: "github_repository_1",
            repositoryExternalId: "9001",
            repositoryName: "control-plane",
            repositoryOwner: "acme",
            workspaceId: "workspace_2",
          },
        ],
      },
    ],
    [
      "unsafe repo id",
      { repoId: "../github_repository_1", workspaceId: "workspace_1" },
      { memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] },
    ],
    [
      "unsafe workspace id",
      { repoId: "github_repository_1", workspaceId: "workspace_1\nsourceCode" },
      { memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] },
    ],
  ])("rejects trigger for %s before persistence", async (_caseName, input, options) => {
    const store = createStore(options);
    const service = await createService({ store });

    await expect(service.triggerRepoScan(input)).rejects.toMatchObject({
      code: _caseName === "non-member" ? "forbidden" : "validation_error",
    });
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("creates a queued scan only for a workspace member and existing GitHub repo", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const scan = await service.createRepoScan({
      repoId: "github_repository_1",
      workspaceId: " workspace_1 ",
    });

    expect(scan).toEqual({
      contractVersion: CONTRACT_VERSION,
      createdAt: now.toISOString(),
      findingIds: [],
      inventory: emptyInventory(),
      moduleStatuses: [],
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued",
      statusSummary: "Queued for repo readiness scanning.",
      taskRecommendationIds: [],
      updatedAt: now.toISOString(),
      workspaceId: "workspace_1",
    });
    expect(store.scans).toHaveLength(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_scans.created",
        metadata: {
          findingCount: 0,
          moduleCount: 0,
          moduleStatusCounts: {},
          productGoalContextStatus: "not_provided",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "queued",
          statusSummaryLength: 35,
          taskRecommendationCount: 0,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeScanMaterial({ audit: store.auditEvents, scan, stored: store.scans });

    const nonMemberStore = createStore();
    const nonMemberService = await createService({ store: nonMemberStore });
    await expect(
      nonMemberService.createRepoScan({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.createRepoScanWithAudit).not.toHaveBeenCalled();

    const missingRepoStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [],
    });
    const missingRepoService = await createService({ store: missingRepoStore });
    await expect(
      missingRepoService.createRepoScan({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(missingRepoStore.createRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("lists and fetches scans scoped by workspace and optional repo id", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        createScanRow({
          createdAt: new Date("2026-05-25T09:00:00.000Z"),
          id: "repo_scan_older",
          repoId: "github_repository_1",
        }),
        createScanRow({
          createdAt: new Date("2026-05-25T09:30:00.000Z"),
          id: "repo_scan_other_repo",
          repoId: "github_repository_2",
        }),
        createScanRow({
          id: "repo_scan_other_workspace",
          repoId: "github_repository_3",
          workspaceId: "workspace_2",
        }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.listRepoScans({ repoId: "github_repository_1", workspaceId: "workspace_1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        createdAt: "2026-05-25T09:00:00.000Z",
        repoId: "github_repository_1",
        scanId: "repo_scan_older",
        workspaceId: "workspace_1",
      }),
    ]);
    await expect(service.listRepoScans({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({ scanId: "repo_scan_other_repo" }),
      expect.objectContaining({ scanId: "repo_scan_older" }),
    ]);
    await expect(
      service.getRepoScan({ scanId: "repo_scan_other_workspace", workspaceId: "workspace_1" }),
    ).resolves.toBeNull();
  });

  test("returns latest safe scan status by repo id with module, report, finding, and inventory counts", async () => {
    const older = new Date("2026-05-25T09:00:00.000Z");
    const store = createStore({
      findingStatuses: [
        {
          repoId: "github_repository_1",
          scanId: "repo_scan_latest",
          severity: "blocked",
          status: "open",
          workspaceId: "workspace_1",
        },
        {
          repoId: "github_repository_1",
          scanId: "repo_scan_latest",
          severity: "medium",
          status: "deferred",
          workspaceId: "workspace_1",
        },
        {
          repoId: "github_repository_2",
          scanId: "repo_scan_other_repo",
          severity: "blocked",
          status: "open",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        createScanRow({
          createdAt: older,
          id: "repo_scan_older",
          repoId: "github_repository_1",
        }),
        createScanRow({
          createdAt: later,
          findingIds: ["finding_1", "finding_2"],
          id: "repo_scan_latest",
          inventory: populatedInventory(),
          moduleStatuses: [passedModuleStatus()],
          readinessReportId: "readiness_report_1",
          repoId: "github_repository_1",
          startedAt: now,
          status: "running",
          statusSummary: "Repo readiness scan is running.",
          taskRecommendationIds: ["task_recommendation_1", "task_recommendation_2"],
          updatedAt: later,
        }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.getRepoScanStatus({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      blockedFindingCount: 1,
      createdAt: later.toISOString(),
      failureSummary: undefined,
      findingCount: 2,
      finishedAt: undefined,
      inventoryCounts: {
        ciProviderCount: 1,
        documentationCount: 1,
        dryRunCheckCount: 11,
        hasPolicyFile: true,
        languageCount: 1,
        omittedFileCount: 2,
        packageManagerCount: 1,
        presentDocumentationCount: 1,
        protectedPathCount: 2,
        scannedFileCount: 8,
        sensitivePathCount: 3,
        totalDirectoryCount: 5,
        totalFileCount: 10,
        validationCommandCount: 4,
      },
      moduleStatuses: [passedModuleStatus()],
      openFindingCount: 1,
      readinessReportId: "readiness_report_1",
      readinessReportStatus: "available",
      repoId: "github_repository_1",
      scanId: "repo_scan_latest",
      startedAt: now.toISOString(),
      status: "running",
      statusSummary: "Repo readiness scan is running.",
      taskRecommendationCount: 2,
      updatedAt: later.toISOString(),
      workspaceId: "workspace_1",
    });
    expect(store.getRepoScanFindingStatusCounts).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      scanId: "repo_scan_latest",
      workspaceId: "workspace_1",
    });
    expectNoUnsafeScanMaterial(
      await service.getRepoScanStatus({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    );
  });

  test("returns scan status by scan id only when scoped to the requested workspace", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        createScanRow({
          failureSummary: "Unable to inspect repository metadata safely.",
          finishedAt: later,
          id: "repo_scan_failed",
          status: "failed",
          statusSummary: "Scan failed after metadata-only inspection.",
          updatedAt: later,
        }),
        createScanRow({
          id: "repo_scan_other_workspace",
          workspaceId: "workspace_2",
        }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.getRepoScanStatus({
        scanId: "repo_scan_failed",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        failureSummary: "Unable to inspect repository metadata safely.",
        readinessReportStatus: "pending",
        scanId: "repo_scan_failed",
        status: "failed",
        workspaceId: "workspace_1",
      }),
    );
    await expect(
      service.getRepoScanStatus({
        scanId: "repo_scan_other_workspace",
        workspaceId: "workspace_1",
      }),
    ).resolves.toBeNull();
  });

  test("rejects unsafe persisted scan status rows before returning them", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        createScanRow({
          id: "repo_scan_unsafe",
          moduleStatuses: [
            passedModuleStatus({
              metadata: {
                rawOutput: "provider raw output",
              },
            }),
          ],
        }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.getRepoScanStatus({
        scanId: "repo_scan_unsafe",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("updates running, completed, failed, and cancelled statuses with required fields", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [createScanRow()],
    });
    const runningService = await createService({ currentTime: later, store });

    await expect(
      runningService.updateRepoScanStatus({
        scanId: "repo_scan_1",
        status: "running",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        startedAt: later.toISOString(),
        status: "running",
        statusSummary: "Repo readiness scan is running.",
        updatedAt: later.toISOString(),
      }),
    );

    const completed = await runningService.updateRepoScanStatus({
      findingIds: ["finding_1", "finding_2"],
      inventory: populatedInventory(),
      readinessReportId: "readiness_report_1",
      scanId: "repo_scan_1",
      status: "completed",
      statusSummary: "Repo readiness scan completed.",
      taskRecommendationIds: ["task_recommendation_1"],
      workspaceId: "workspace_1",
    });

    expect(completed).toEqual(
      expect.objectContaining({
        findingIds: ["finding_1", "finding_2"],
        finishedAt: later.toISOString(),
        readinessReportId: "readiness_report_1",
        status: "completed",
        taskRecommendationIds: ["task_recommendation_1"],
      }),
    );

    store.scans.push(createScanRow({ id: "repo_scan_failed" }));
    await expect(
      runningService.updateRepoScanStatus({
        failureSummary: "Unable to read safe repo metadata.",
        scanId: "repo_scan_failed",
        status: "failed",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        failureSummary: "Unable to read safe repo metadata.",
        finishedAt: later.toISOString(),
        status: "failed",
      }),
    );

    store.scans.push(createScanRow({ id: "repo_scan_cancelled" }));
    await expect(
      runningService.updateRepoScanStatus({
        scanId: "repo_scan_cancelled",
        status: "cancelled",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        finishedAt: later.toISOString(),
        status: "cancelled",
        statusSummary: "Repo readiness scan was cancelled.",
      }),
    );
    await expect(
      runningService.updateRepoScanStatus({
        scanId: "repo_scan_failed",
        status: "failed",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("persists safe module statuses on repo scan updates", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [createScanRow()],
    });
    const service = await createService({ currentTime: later, store });

    const updated = await service.updateRepoScanStatus({
      moduleStatuses: [
        passedModuleStatus(),
        passedModuleStatus({
          id: "recommendation_builder",
          label: "Recommendation builder",
          metadata: {
            generatedRecommendationCount: 3,
          },
          order: 1,
          required: false,
          status: "warning",
          summary: "Recommendations generated with metadata-only warnings.",
        }),
      ],
      scanId: "repo_scan_1",
      status: "running",
      workspaceId: "workspace_1",
    });

    expect(updated.moduleStatuses).toEqual([
      expect.objectContaining({
        id: "github_inventory",
        metadata: {
          languageCount: 1,
          packageManagerLabels: ["pnpm"],
        },
        status: "passed",
      }),
      expect.objectContaining({
        id: "recommendation_builder",
        metadata: {
          generatedRecommendationCount: 3,
        },
        status: "warning",
      }),
    ]);
    expect(store.scans[0]?.moduleStatuses).toEqual(updated.moduleStatuses);
    expect(store.auditEvents.at(-1)).toEqual(
      expect.objectContaining({
        eventType: "repo_scans.status_updated",
        metadata: expect.objectContaining({
          moduleCount: 2,
          moduleStatusCounts: {
            passed: 1,
            warning: 1,
          },
        }),
      }),
    );
    expect(JSON.stringify(store.auditEvents)).not.toContain("Metadata-only GitHub inventory");
    expect(JSON.stringify(store.auditEvents)).not.toContain("Recommendations generated");
    expectNoUnsafeScanMaterial({ audit: store.auditEvents, updated });
  });

  test("rejects cross-workspace repo ids before persistence", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [
        {
          githubInstallationId: "42",
          id: "github_repository_1",
          repositoryExternalId: "9001",
          repositoryName: "control-plane",
          repositoryOwner: "acme",
          workspaceId: "workspace_2",
        },
      ],
    });
    const service = await createService({ store });

    await expect(
      service.createRepoScan({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.createRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("rejects unsafe payload keys or text before persistence", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [createScanRow()],
    });
    const service = await createService({ store });

    await expect(
      service.updateRepoScanStatus({
        moduleStatuses: [
          passedModuleStatus({
            metadata: {
              rawOutput: "private provider output",
            },
          }),
        ],
        scanId: "repo_scan_1",
        status: "running",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.updateRepoScanStatus({
        moduleStatuses: [
          passedModuleStatus({
            summary: "diff --git a/app.ts b/app.ts",
          }),
        ],
        scanId: "repo_scan_1",
        status: "running",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.updateRepoScanStatus({
        inventory: {
          ...populatedInventory(),
          pathInventory: ["/Users/rory/private/repo/src/app.ts"],
        } as unknown as RepoScanInventory,
        readinessReportId: "readiness_report_1",
        scanId: "repo_scan_1",
        status: "completed",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.updateRepoScanStatus({
        readinessReportId: "readiness_report_1",
        scanId: "repo_scan_1",
        status: "completed",
        statusSummary: "diff --git a/app.ts b/app.ts",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.updateRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test.each<[string, Omit<UpdateRepoScanStatusInput, "scanId" | "workspaceId">, readonly string[]]>(
    [
      [
        "source-like inventory fields",
        {
          inventory: {
            ...populatedInventory(),
            sourceCode: "const leaked = process.env.SECRET;",
          } as unknown as RepoScanInventory,
          readinessReportId: "readiness_report_1",
          status: "completed",
        },
        ["const leaked", "process.env.SECRET"],
      ],
      [
        "raw source in status summary",
        {
          readinessReportId: "readiness_report_1",
          status: "completed",
          statusSummary: "const leaked = process.env.SECRET;",
        },
        ["const leaked", "process.env.SECRET"],
      ],
      [
        ".env.local path text in failure summary",
        {
          failureSummary: "Provider refused to read .env.local during metadata scan.",
          status: "failed",
        },
        [".env.local"],
      ],
      [
        "private key marker in failure summary",
        {
          failureSummary:
            "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
          status: "failed",
        },
        ["PRIVATE KEY", "private-key-material"],
      ],
      [
        "raw GitHub output in failure summary",
        {
          failureSummary:
            "raw GitHub output: diff --git a/src/app.ts b/src/app.ts ghp_scanfailureshouldnotleak1234567890",
          status: "failed",
        },
        ["raw GitHub output", "diff --git", "ghp_scanfailureshouldnotleak"],
      ],
    ],
  )("rejects %s before persistence or audit writes", async (_caseName, update, unsafeValues) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [createScanRow()],
    });
    const service = await createService({ store });

    try {
      await service.updateRepoScanStatus({
        scanId: "repo_scan_1",
        ...update,
        workspaceId: "workspace_1",
      });
      throw new Error("Expected unsafe repo scan update to be rejected.");
    } catch (error) {
      expect(error).toMatchObject({ code: "validation_error" });

      for (const unsafeValue of unsafeValues) {
        expect(String(error)).not.toContain(unsafeValue);
      }
    }
    expect(store.updateRepoScanWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test.each<
    [
      string,
      Omit<UpdateRepoScanStatusInput, "scanId" | "workspaceId"> & {
        scanId?: string;
      },
    ]
  >([
    [
      "statusSummary",
      {
        readinessReportId: "readiness_report_1",
        status: "completed",
        statusSummary: "Scan found setup work under /Users/rory/private/repo/src/app.ts",
      },
    ],
    [
      "failureSummary",
      {
        failureSummary: "Readiness provider failed at /Users/rory/private/repo/src/app.ts",
        scanId: "repo_scan_failed",
        status: "failed",
      },
    ],
  ])("rejects local path text in %s before persistence", async (_field, update) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [createScanRow(), createScanRow({ id: "repo_scan_failed" })],
    });
    const service = await createService({ store });

    await expect(
      service.updateRepoScanStatus({
        scanId: update.scanId ?? "repo_scan_1",
        ...update,
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.updateRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("keeps audit metadata to ids, counts, statuses, and lengths only", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [createScanRow()],
    });
    const service = await createService({ currentTime: later, store });

    await service.updateRepoScanStatus({
      failureSummary: "Unable to inspect repository metadata safely.",
      scanId: "repo_scan_1",
      status: "failed",
      statusSummary: "Scan failed after metadata-only inspection.",
      workspaceId: "workspace_1",
    });

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_scans.status_updated",
        metadata: {
          failureSummaryLength: 45,
          findingCount: 0,
          moduleCount: 0,
          moduleStatusCounts: {},
          productGoalContextStatus: "not_provided",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "failed",
          statusSummaryLength: 43,
          taskRecommendationCount: 0,
        },
      }),
    ]);
    expect(JSON.stringify(store.auditEvents)).not.toContain("Unable to inspect");
    expect(JSON.stringify(store.auditEvents)).not.toContain("metadata-only inspection");
    expectNoUnsafeScanMaterial(store.auditEvents);
  });
});
