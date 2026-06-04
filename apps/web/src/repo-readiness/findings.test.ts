import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  type CortexTask,
  type Finding,
  type FindingCategory,
  type FindingEvidence,
  type FindingSeverity,
  type FindingStatus,
} from "@control-plane/shared";

import type { PersistedFinding, RepoFindingStore } from "./findings";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importFindings = async () => import("./findings");

type StoredRepoScan = {
  id: string;
  repoId: string;
  workspaceId: string;
};

type StoredFinding = {
  category: Finding["category"];
  confidence: number;
  contractVersion: Finding["contractVersion"];
  createdAt: Date;
  dedupeKey: string;
  deterministicRuleId: string;
  evidence: Finding["evidence"];
  id: string;
  recommendation: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  source: Finding["source"];
  status: Finding["status"];
  summary: string;
  taskIds: string[];
  title: string;
  updatedAt: Date;
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

type StoredCortexTask = {
  acceptanceCriteria: string[];
  approvalStatus: CortexTask["approvalStatus"];
  contractVersion: CortexTask["contractVersion"];
  createdAt: Date;
  executionMode: CortexTask["executionMode"];
  externalLinks: CortexTask["externalLinks"];
  findingIds: string[];
  id: string;
  latestRunId: string | null;
  metadata: CortexTask["metadata"];
  objective: string;
  originExternalId: string | null;
  originExternalSystem: string | null;
  originType: CortexTask["origin"]["type"];
  prArtifactIds: string[];
  repoId: string;
  riskLevel: CortexTask["riskLevel"];
  runIds: string[];
  status: CortexTask["status"];
  suggestedValidation: CortexTask["suggestedValidation"];
  taskPacketId: string | null;
  taskRecommendationId: string | null;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type FindingStoreInsert = Parameters<RepoFindingStore["upsertFindingWithAudit"]>[0]["finding"];
type FindingTaskInsert = Parameters<RepoFindingStore["convertFindingToTaskWithAudit"]>[0]["task"];

const now = new Date("2026-05-25T10:00:00.000Z");
const later = new Date("2026-05-25T10:05:00.000Z");

const validEvidence = (overrides: Partial<FindingEvidence> = {}): FindingEvidence => ({
  metadata: {
    pathCount: 2,
    referencedPaths: [".aicp/policy.json", ".github/workflows/ci.yml"],
    ruleKind: "validation-metadata",
  },
  paths: [".aicp/policy.json", ".github/workflows/ci.yml"],
  summary: "Validation command metadata is not configured.",
  ...overrides,
});

const validFinding = (overrides: Partial<Finding> = {}): Finding => ({
  category: "validation",
  confidence: 0.94,
  contractVersion: CONTRACT_VERSION,
  createdAt: now.toISOString(),
  deterministicRuleId: "validation.commands.missing",
  evidence: [validEvidence()],
  findingId: "finding_1",
  recommendation: "Add explicit validation metadata before enabling local execution.",
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  severity: "high",
  source: "deterministic_rule",
  status: "open",
  summary: "The repository does not declare validation commands for Cortex.",
  title: "Validation commands are missing",
  updatedAt: now.toISOString(),
  workspaceId: "workspace_1",
  ...overrides,
});

const createFindingRow = (overrides: Partial<StoredFinding> = {}): StoredFinding => {
  const finding = validFinding({
    findingId: overrides.id ?? "finding_1",
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
    ...(overrides.repoId === undefined ? {} : { repoId: overrides.repoId }),
    ...(overrides.scanId === undefined ? {} : { scanId: overrides.scanId }),
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
  });

  return {
    category: finding.category,
    confidence: finding.confidence,
    contractVersion: finding.contractVersion,
    createdAt: now,
    dedupeKey: "fd_0".padEnd(67, "0"),
    deterministicRuleId: finding.deterministicRuleId,
    evidence: finding.evidence,
    id: finding.findingId,
    recommendation: finding.recommendation,
    repoId: finding.repoId,
    scanId: finding.scanId,
    severity: finding.severity,
    source: finding.source,
    status: finding.status,
    summary: finding.summary,
    taskIds: [],
    title: finding.title,
    updatedAt: now,
    workspaceId: finding.workspaceId,
    ...overrides,
  };
};

const createFindingRowFromInsert = (insert: FindingStoreInsert): StoredFinding => ({
  category: insert.category,
  confidence: insert.confidence,
  contractVersion: insert.contractVersion,
  createdAt: insert.createdAt ?? now,
  dedupeKey: insert.dedupeKey,
  deterministicRuleId: insert.deterministicRuleId,
  evidence: insert.evidence,
  id: insert.id,
  recommendation: insert.recommendation,
  repoId: insert.repoId,
  scanId: insert.scanId,
  severity: insert.severity,
  source: insert.source,
  status: insert.status ?? "open",
  summary: insert.summary,
  taskIds: insert.taskIds ?? [],
  title: insert.title,
  updatedAt: insert.updatedAt ?? now,
  workspaceId: insert.workspaceId,
});

const createTaskRowFromInsert = (insert: FindingTaskInsert): StoredCortexTask => ({
  acceptanceCriteria: insert.acceptanceCriteria ?? [],
  approvalStatus: insert.approvalStatus ?? "not_requested",
  contractVersion: insert.contractVersion,
  createdAt: insert.createdAt ?? now,
  executionMode: insert.executionMode,
  externalLinks: insert.externalLinks ?? [],
  findingIds: insert.findingIds ?? [],
  id: insert.id,
  latestRunId: insert.latestRunId ?? null,
  metadata: insert.metadata ?? {},
  objective: insert.objective,
  originExternalId: insert.originExternalId ?? null,
  originExternalSystem: insert.originExternalSystem ?? null,
  originType: insert.originType,
  prArtifactIds: insert.prArtifactIds ?? [],
  repoId: insert.repoId,
  riskLevel: insert.riskLevel,
  runIds: insert.runIds ?? [],
  status: insert.status ?? "draft",
  suggestedValidation: insert.suggestedValidation ?? [],
  taskPacketId: insert.taskPacketId ?? null,
  taskRecommendationId: insert.taskRecommendationId ?? null,
  title: insert.title,
  updatedAt: insert.updatedAt ?? now,
  workspaceId: insert.workspaceId,
});

const createStore = (
  options: {
    findings?: StoredFinding[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    scans?: StoredRepoScan[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const scans = [
    ...(options.scans ?? [
      { id: "repo_scan_1", repoId: "github_repository_1", workspaceId: "workspace_1" },
    ]),
  ];
  const findings = [...(options.findings ?? [])];
  const tasks = [...(options.tasks ?? [])];

  return {
    auditEvents,
    convertFindingToTaskWithAudit: vi.fn<RepoFindingStore["convertFindingToTaskWithAudit"]>(
      async (input) => {
        const finding = findings.find(
          (candidate) =>
            candidate.id === input.findingId && candidate.workspaceId === input.workspaceId,
        );

        if (finding === undefined || tasks.some((task) => task.id === input.taskId)) {
          return null;
        }

        const task = createTaskRowFromInsert(input.task);

        finding.taskIds = [...finding.taskIds, input.taskId];
        finding.updatedAt = input.updatedAt;
        tasks.push(task);
        auditEvents.push(...input.auditEvents);

        return {
          finding,
          task,
        };
      },
    ),
    findRepoScan: vi.fn<RepoFindingStore["findRepoScan"]>(
      async (input: { scanId: string; workspaceId: string }) =>
        scans.find((scan) => scan.id === input.scanId && scan.workspaceId === input.workspaceId) ??
        null,
    ),
    findWorkspaceMembership: vi.fn<RepoFindingStore["findWorkspaceMembership"]>(
      async (input: { userId: string; workspaceId: string }) =>
        options.memberships?.some(
          (membership) =>
            membership.userId === input.userId && membership.workspaceId === input.workspaceId,
        )
          ? { id: "membership_1", role: "member" }
          : null,
    ),
    findings,
    getFinding: vi.fn<RepoFindingStore["getFinding"]>(
      async (input: { findingId: string; workspaceId: string }) =>
        findings.find(
          (finding) => finding.id === input.findingId && finding.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    getFindingByDedupeKey: vi.fn<RepoFindingStore["getFindingByDedupeKey"]>(
      async (input: { dedupeKey: string; repoId: string; workspaceId: string }) =>
        findings.find(
          (finding) =>
            finding.dedupeKey === input.dedupeKey &&
            finding.repoId === input.repoId &&
            finding.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    getCortexTask: vi.fn<RepoFindingStore["getCortexTask"]>(
      async (input: { taskId: string; workspaceId: string }) =>
        tasks.find((task) => task.id === input.taskId && task.workspaceId === input.workspaceId) ??
        null,
    ),
    listFindings: vi.fn<RepoFindingStore["listFindings"]>(
      async (filter: {
        category?: FindingCategory;
        repoId?: string;
        scanId?: string;
        severity?: FindingSeverity;
        status?: FindingStatus;
        workspaceId: string;
      }) =>
        findings
          .filter(
            (finding) =>
              finding.workspaceId === filter.workspaceId &&
              (filter.category === undefined || finding.category === filter.category) &&
              (filter.repoId === undefined || finding.repoId === filter.repoId) &&
              (filter.scanId === undefined || finding.scanId === filter.scanId) &&
              (filter.severity === undefined || finding.severity === filter.severity) &&
              (filter.status === undefined || finding.status === filter.status),
          )
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    ),
    scans,
    tasks,
    updateFindingStatusWithAudit: vi.fn<RepoFindingStore["updateFindingStatusWithAudit"]>(
      async (input: {
        auditEvent: StoredAuditEvent;
        findingId: string;
        status: FindingStatus;
        updatedAt: Date;
        workspaceId: string;
      }) => {
        const finding = findings.find(
          (candidate) =>
            candidate.id === input.findingId && candidate.workspaceId === input.workspaceId,
        );

        if (finding === undefined) {
          return null;
        }

        finding.status = input.status;
        finding.updatedAt = input.updatedAt;
        auditEvents.push(input.auditEvent);

        return finding;
      },
    ),
    upsertFindingWithAudit: vi.fn<RepoFindingStore["upsertFindingWithAudit"]>(async (input) => {
      const nextFinding = createFindingRowFromInsert(input.finding);
      const existing = findings.find(
        (finding) =>
          finding.workspaceId === nextFinding.workspaceId &&
          finding.repoId === nextFinding.repoId &&
          finding.dedupeKey === nextFinding.dedupeKey,
      );

      if (existing === undefined) {
        findings.push(nextFinding);
        auditEvents.push(input.createAuditEvent(nextFinding));

        return nextFinding;
      }

      Object.assign(existing, {
        ...nextFinding,
        createdAt: existing.createdAt,
        id: existing.id,
      });
      auditEvents.push(input.createAuditEvent(existing));

      return existing;
    }),
  };
};

type ConvertFindingToTaskService = {
  convertFindingToTask: (input: { findingId: string; workspaceId: string }) => Promise<{
    finding: PersistedFinding;
    task: CortexTask;
  }>;
};

const createService = async (input: {
  currentTime?: Date;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createRepoFindingService } = await importFindings();

  return createRepoFindingService({
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createFindingId: () => `finding_${input.store.findings.length + 1}`,
    createTaskId: () => `cortex_task_${input.store.tasks.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: () => input.currentTime ?? now,
    store: input.store,
  });
};

const expectNoUnsafeFindingMaterial = (value: unknown) => {
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
        /^(?:code|content|diff|fileContent|localPath|patch|rawOutput|secret|sourceCode|stderr|stdout|token)$/u.test(
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
  expect(serialized).not.toContain("repo-secret-token");
  expect(serialized).not.toContain("/Users/rory/private/repo");
  expect(unsafeKeys).toEqual([]);
};

describe("repo readiness finding service", () => {
  test("persists a valid shared finding only for a workspace member", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.persistFinding({
      finding: validFinding({ findingId: "client_supplied_id" }),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual({
      dedupeKey: expect.stringMatching(/^fd_[a-f0-9]{64}$/u),
      finding: expect.objectContaining({
        findingId: "finding_1",
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
      taskIds: [],
    });
    expect(result.dedupeKey).not.toContain("validation");
    expect(result.dedupeKey).not.toContain(".aicp");
    expect(store.findings).toHaveLength(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_findings.upserted",
        metadata: {
          category: "validation",
          dedupeKeyLength: 67,
          evidenceCount: 1,
          findingId: "finding_1",
          lifecycleState: "new",
          recommendationLength: 65,
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          severity: "high",
          status: "open",
          summaryLength: 63,
          taskIdCount: 0,
          titleLength: 31,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeFindingMaterial({ audit: store.auditEvents, result, stored: store.findings });

    const nonMemberStore = createStore();
    const nonMemberService = await createService({ store: nonMemberStore });
    await expect(
      nonMemberService.persistFinding({
        finding: validFinding(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.upsertFindingWithAudit).not.toHaveBeenCalled();
  });

  test("rejects missing, cross-workspace, or repo-mismatched scans before persistence", async () => {
    const missingScanStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [],
    });
    const missingScanService = await createService({ store: missingScanStore });

    await expect(
      missingScanService.persistFinding({
        finding: validFinding(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(missingScanStore.upsertFindingWithAudit).not.toHaveBeenCalled();

    const crossWorkspaceStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [{ id: "repo_scan_1", repoId: "github_repository_1", workspaceId: "workspace_2" }],
    });
    const crossWorkspaceService = await createService({ store: crossWorkspaceStore });

    await expect(
      crossWorkspaceService.persistFinding({
        finding: validFinding(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(crossWorkspaceStore.upsertFindingWithAudit).not.toHaveBeenCalled();

    const repoMismatchStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [{ id: "repo_scan_1", repoId: "github_repository_2", workspaceId: "workspace_1" }],
    });
    const repoMismatchService = await createService({ store: repoMismatchStore });

    await expect(
      repoMismatchService.persistFinding({
        finding: validFinding(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(repoMismatchStore.upsertFindingWithAudit).not.toHaveBeenCalled();
  });

  test("generates a stable opaque dedupe key and upserts duplicate findings", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });
    const first = await service.persistFinding({
      finding: validFinding({
        evidence: [
          validEvidence({
            paths: ["src/zeta.ts", "src/alpha.ts", "src/alpha.ts"],
          }),
        ],
        findingId: "first_id",
      }),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
    const second = await service.persistFinding({
      finding: validFinding({
        evidence: [
          validEvidence({
            paths: ["src/alpha.ts", "src/zeta.ts"],
          }),
        ],
        findingId: "second_id",
        summary: "Updated safe summary for the same finding.",
      }),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(second.dedupeKey).toBe(first.dedupeKey);
    expect(first.dedupeKey).toMatch(/^fd_[a-f0-9]{64}$/u);
    expect(first.dedupeKey).not.toContain("src");
    expect(first.dedupeKey).not.toContain("validation.commands.missing");
    expect(store.findings).toHaveLength(1);
    expect(second.finding.findingId).toBe("finding_1");
    expect(second.finding.summary).toBe("Updated safe summary for the same finding.");
    expect(store.auditEvents).toHaveLength(2);
    expect(store.auditEvents[1]?.metadata).toEqual(
      expect.objectContaining({
        findingId: "finding_1",
        status: "open",
        summaryLength: 42,
      }),
    );
  });

  test("annotates recurring worsened findings and preserves linked task ids", async () => {
    const { createFindingDedupeKey } = await importFindings();
    const recurringFinding = validFinding({
      evidence: [
        validEvidence({
          metadata: {
            pathCount: 1,
            ruleKind: "validation-metadata",
          },
          paths: ["docs/validation.md"],
          summary: "Validation command metadata is still incomplete.",
        }),
      ],
      findingId: "incoming_worsened",
      scanId: "repo_scan_2",
      severity: "blocked",
      summary: "Validation posture has worsened since the previous scan.",
    });
    const dedupeKey = createFindingDedupeKey(recurringFinding);
    const store = createStore({
      findings: [
        createFindingRow({
          dedupeKey,
          evidence: recurringFinding.evidence,
          id: "finding_existing",
          scanId: "repo_scan_1",
          severity: "medium",
          taskIds: ["cortex_task_existing"],
          updatedAt: new Date("2026-05-24T10:00:00.000Z"),
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        { id: "repo_scan_1", repoId: "github_repository_1", workspaceId: "workspace_1" },
        { id: "repo_scan_2", repoId: "github_repository_1", workspaceId: "workspace_1" },
      ],
    });
    const service = await createService({ currentTime: later, store });

    const result = await service.persistFinding({
      finding: recurringFinding,
      repoId: "github_repository_1",
      scanId: "repo_scan_2",
      taskIds: ["cortex_task_new"],
      workspaceId: "workspace_1",
    });

    expect(result.finding.findingId).toBe("finding_existing");
    expect(result.finding.scanId).toBe("repo_scan_2");
    expect(result.finding.severity).toBe("blocked");
    expect(result.finding.evidence[0]?.metadata).toEqual(
      expect.objectContaining({
        lifecycleState: "worsened",
        previousSeverity: "medium",
        previousStatus: "open",
      }),
    );
    expect(result.taskIds).toEqual(["cortex_task_existing", "cortex_task_new"]);
    expect(store.auditEvents.at(-1)?.metadata).toEqual(
      expect.objectContaining({
        findingId: "finding_existing",
        lifecycleState: "worsened",
        previousSeverity: "medium",
        status: "open",
      }),
    );
    expectNoUnsafeFindingMaterial({ audit: store.auditEvents, result, stored: store.findings });
  });

  test("reconciles missing open findings as resolved and summarizes lifecycle drift", async () => {
    const currentNew = createFindingRow({
      dedupeKey: "fd_current_new",
      evidence: [
        validEvidence({
          metadata: {
            lifecycleState: "new",
          },
        }),
      ],
      id: "finding_current_new",
      scanId: "repo_scan_2",
      updatedAt: later,
    });
    const currentRecurring = createFindingRow({
      dedupeKey: "fd_current_recurring",
      evidence: [
        validEvidence({
          metadata: {
            lifecycleState: "recurring",
          },
        }),
      ],
      id: "finding_current_recurring",
      scanId: "repo_scan_2",
      updatedAt: later,
    });
    const currentWorsened = createFindingRow({
      dedupeKey: "fd_current_worsened",
      evidence: [
        validEvidence({
          metadata: {
            lifecycleState: "worsened",
            previousSeverity: "medium",
          },
        }),
      ],
      id: "finding_current_worsened",
      scanId: "repo_scan_2",
      severity: "blocked",
      updatedAt: later,
    });
    const currentStale = createFindingRow({
      dedupeKey: "fd_current_stale",
      evidence: [
        validEvidence({
          metadata: {
            lifecycleState: "stale",
            previousStatus: "deferred",
          },
        }),
      ],
      id: "finding_current_stale",
      scanId: "repo_scan_2",
      updatedAt: later,
    });
    const store = createStore({
      findings: [
        currentNew,
        currentRecurring,
        currentWorsened,
        currentStale,
        createFindingRow({
          dedupeKey: "fd_missing_from_current_scan",
          id: "finding_resolved_by_rescan",
          scanId: "repo_scan_1",
          status: "open",
          updatedAt: new Date("2026-05-24T10:00:00.000Z"),
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        { id: "repo_scan_1", repoId: "github_repository_1", workspaceId: "workspace_1" },
        { id: "repo_scan_2", repoId: "github_repository_1", workspaceId: "workspace_1" },
      ],
    });
    const service = (await createService({ currentTime: later, store })) as Awaited<
      ReturnType<typeof createService>
    > & {
      reconcileFindingLifecycle: (input: {
        repoId: string;
        scanId: string;
        workspaceId: string;
      }) => Promise<{
        currentFindingIds: string[];
        newCount: number;
        recurringCount: number;
        resolvedCount: number;
        resolvedFindingIds: string[];
        staleCount: number;
        worsenedCount: number;
      }>;
    };

    await expect(
      service.reconcileFindingLifecycle({
        repoId: "github_repository_1",
        scanId: "repo_scan_2",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      currentFindingIds: [
        "finding_current_new",
        "finding_current_recurring",
        "finding_current_worsened",
        "finding_current_stale",
      ],
      newCount: 1,
      recurringCount: 1,
      resolvedCount: 1,
      resolvedFindingIds: ["finding_resolved_by_rescan"],
      staleCount: 1,
      worsenedCount: 1,
    });
    expect(store.findings.find((finding) => finding.id === "finding_resolved_by_rescan")).toEqual(
      expect.objectContaining({
        status: "resolved",
        updatedAt: later,
      }),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_readiness_findings.status_updated",
        metadata: expect.objectContaining({
          findingId: "finding_resolved_by_rescan",
          status: "resolved",
        }),
      }),
    ]);
    expectNoUnsafeFindingMaterial({ audit: store.auditEvents, stored: store.findings });
  });

  test("lists findings by workspace, scan, repo, and status", async () => {
    const store = createStore({
      findings: [
        createFindingRow({ id: "finding_old", updatedAt: now }),
        createFindingRow({
          id: "finding_resolved",
          status: "resolved",
          updatedAt: later,
        }),
        createFindingRow({
          id: "finding_other_scan",
          scanId: "repo_scan_2",
          updatedAt: new Date("2026-05-25T10:03:00.000Z"),
        }),
        createFindingRow({
          id: "finding_other_repo",
          repoId: "github_repository_2",
          updatedAt: new Date("2026-05-25T10:04:00.000Z"),
        }),
        createFindingRow({
          id: "finding_other_workspace",
          workspaceId: "workspace_2",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.listFindings({
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "open",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        finding: expect.objectContaining({
          findingId: "finding_old",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "open",
        }),
        taskIds: [],
      }),
    ]);
    await expect(service.listFindings({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        finding: expect.objectContaining({ findingId: "finding_resolved" }),
      }),
      expect.objectContaining({
        finding: expect.objectContaining({ findingId: "finding_other_repo" }),
      }),
      expect.objectContaining({
        finding: expect.objectContaining({ findingId: "finding_other_scan" }),
      }),
      expect.objectContaining({ finding: expect.objectContaining({ findingId: "finding_old" }) }),
    ]);
  });

  test("lists findings by severity and category with repo, scan, and status filters", async () => {
    const store = createStore({
      findings: [
        createFindingRow({
          category: "security",
          id: "finding_security_blocked",
          severity: "blocked",
          updatedAt: later,
        }),
        createFindingRow({
          category: "security",
          id: "finding_security_low",
          severity: "low",
          updatedAt: new Date("2026-05-25T10:04:00.000Z"),
        }),
        createFindingRow({
          category: "validation",
          id: "finding_validation_blocked",
          severity: "blocked",
          updatedAt: new Date("2026-05-25T10:03:00.000Z"),
        }),
        createFindingRow({
          category: "security",
          id: "finding_security_other_scan",
          scanId: "repo_scan_2",
          severity: "blocked",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.listFindings({
        category: "security",
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        severity: "blocked",
        status: "open",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        finding: expect.objectContaining({
          category: "security",
          findingId: "finding_security_blocked",
          severity: "blocked",
        }),
      }),
    ]);
    expect(store.listFindings).toHaveBeenCalledWith({
      category: "security",
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      severity: "blocked",
      status: "open",
      workspaceId: "workspace_1",
    });
  });

  test.each(["dismissed", "deferred"] as const)(
    "audits %s status updates with safe metadata only",
    async (status) => {
      const store = createStore({
        findings: [
          createFindingRow({
            evidence: [
              validEvidence({
                metadata: {
                  safeCount: 1,
                },
                paths: ["docs/validation.md"],
                summary: "Validation documentation is missing safe setup detail.",
              }),
            ],
            recommendation: "Add setup documentation before local execution.",
            summary: "Safe summary for audit metadata.",
            title: "Safe audit finding",
          }),
        ],
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      });
      const service = await createService({ currentTime: later, store });

      await expect(
        service.updateFindingStatus({
          findingId: "finding_1",
          status,
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          finding: expect.objectContaining({
            findingId: "finding_1",
            status,
            updatedAt: later.toISOString(),
          }),
        }),
      );

      expect(store.auditEvents).toEqual([
        expect.objectContaining({
          actorId: "user_1",
          eventType: "repo_readiness_findings.status_updated",
          metadata: {
            category: "validation",
            dedupeKeyLength: 67,
            evidenceCount: 1,
            findingId: "finding_1",
            recommendationLength: 47,
            repoId: "github_repository_1",
            scanId: "repo_scan_1",
            severity: "high",
            status,
            summaryLength: 32,
            taskIdCount: 0,
            titleLength: 18,
          },
          workspaceId: "workspace_1",
        }),
      ]);
      expect(JSON.stringify(store.auditEvents)).not.toContain("Safe audit finding");
      expect(JSON.stringify(store.auditEvents)).not.toContain("docs/validation.md");
      expect(JSON.stringify(store.auditEvents)).not.toContain("Validation documentation");
      expectNoUnsafeFindingMaterial(store.auditEvents);
    },
  );

  test("converts a scoped finding to a draft Cortex Task without approval or runner queueing", async () => {
    const store = createStore({
      findings: [
        createFindingRow({
          category: "security",
          evidence: [
            validEvidence({
              metadata: {
                pathCount: 1,
              },
              paths: ["docs/security.md"],
              summary: "Security model setup is incomplete.",
            }),
          ],
          id: "finding_security",
          recommendation: "Create a setup PR that documents the missing security control.",
          severity: "high",
          summary: "Security control documentation is missing.",
          title: "Document security control",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = (await createService({ currentTime: later, store })) as Awaited<
      ReturnType<typeof createService>
    > &
      ConvertFindingToTaskService;

    const result = await service.convertFindingToTask({
      findingId: "finding_security",
      workspaceId: "workspace_1",
    });

    expect(result.task).toEqual(
      expect.objectContaining({
        approvalStatus: "not_requested",
        executionMode: "setup_pr",
        findingIds: ["finding_security"],
        origin: { type: "finding" },
        repoId: "github_repository_1",
        riskLevel: "high",
        runIds: [],
        status: "draft",
        taskId: "cortex_task_1",
        title: "Document security control",
        workspaceId: "workspace_1",
      }),
    );
    expect(result.task.objective).toBe(
      "Create a setup PR that documents the missing security control.",
    );
    expect(result.task.acceptanceCriteria).toEqual([
      "Security control documentation is missing.",
      "Security model setup is incomplete.",
      "Finding remains linked to the draft Cortex Task for human review before execution.",
    ]);
    expect(result.finding.taskIds).toEqual(["cortex_task_1"]);
    expect(store.findings[0]?.taskIds).toEqual(["cortex_task_1"]);
    expect(store.tasks).toHaveLength(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_cortex_tasks.created_from_finding",
        metadata: expect.objectContaining({
          approvalStatus: "not_requested",
          executionMode: "setup_pr",
          findingId: "finding_security",
          repoId: "github_repository_1",
          riskLevel: "high",
          status: "draft",
          taskId: "cortex_task_1",
        }),
        workspaceId: "workspace_1",
      }),
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_findings.task_linked",
        metadata: expect.objectContaining({
          findingId: "finding_security",
          taskIdCount: 1,
        }),
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.auditEvents[0]).not.toHaveProperty("taskId");
    expectNoUnsafeFindingMaterial({ audit: store.auditEvents, result, stored: store });
  });

  test("returns an already linked finding Cortex Task idempotently", async () => {
    const existingTask: StoredCortexTask = {
      acceptanceCriteria: ["Existing task remains draft and human-reviewed."],
      approvalStatus: "not_requested",
      contractVersion: CONTRACT_VERSION,
      createdAt: now,
      executionMode: "setup_pr",
      externalLinks: [],
      findingIds: ["finding_1"],
      id: "cortex_task_existing",
      latestRunId: null,
      metadata: {
        sourceLabel: "finding_conversion",
      },
      objective: "Existing safe objective.",
      originExternalId: null,
      originExternalSystem: null,
      originType: "finding",
      prArtifactIds: [],
      repoId: "github_repository_1",
      riskLevel: "medium",
      runIds: [],
      status: "draft",
      suggestedValidation: [],
      taskPacketId: null,
      taskRecommendationId: null,
      title: "Existing Cortex task",
      updatedAt: now,
      workspaceId: "workspace_1",
    };
    const store = createStore({
      findings: [createFindingRow({ taskIds: ["cortex_task_existing"] })],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [existingTask],
    });
    const service = (await createService({ store })) as Awaited<ReturnType<typeof createService>> &
      ConvertFindingToTaskService;

    await expect(
      service.convertFindingToTask({
        findingId: "finding_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      finding: expect.objectContaining({
        taskIds: ["cortex_task_existing"],
      }),
      task: expect.objectContaining({
        taskId: "cortex_task_existing",
        status: "draft",
      }),
    });
    expect(store.convertFindingToTaskWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
    expect(store.tasks).toHaveLength(1);
  });

  test("rejects finding conversion for non-members and cross-workspace findings", async () => {
    const memberStore = createStore({
      findings: [createFindingRow({ workspaceId: "workspace_2" })],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const memberService = (await createService({ store: memberStore })) as Awaited<
      ReturnType<typeof createService>
    > &
      ConvertFindingToTaskService;

    await expect(
      memberService.convertFindingToTask({
        findingId: "finding_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(memberStore.convertFindingToTaskWithAudit).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      findings: [createFindingRow()],
    });
    const nonMemberService = (await createService({ store: nonMemberStore })) as Awaited<
      ReturnType<typeof createService>
    > &
      ConvertFindingToTaskService;

    await expect(
      nonMemberService.convertFindingToTask({
        findingId: "finding_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.convertFindingToTaskWithAudit).not.toHaveBeenCalled();
  });

  test("updates finding status and links safe task ids via taskIds", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ currentTime: later, store });

    const persisted = await service.persistFinding({
      finding: validFinding({ findingId: "task_linked" }),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      taskIds: [" task_2 ", "task_1", "task_1"],
      workspaceId: "workspace_1",
    });

    expect(persisted.taskIds).toEqual(["task_2", "task_1"]);
    expect(store.findings).toHaveLength(1);
    expect(store.findings[0]?.taskIds).toEqual(["task_2", "task_1"]);

    await expect(
      service.updateFindingStatus({
        findingId: "finding_1",
        status: "resolved",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        finding: expect.objectContaining({
          findingId: "finding_1",
          status: "resolved",
          updatedAt: later.toISOString(),
        }),
        taskIds: ["task_2", "task_1"],
      }),
    );

    await expect(
      service.persistFinding({
        finding: validFinding({ findingId: "unsafe_task_link" }),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        taskIds: ["../task"],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test.each([
    [
      "unsafe evidence metadata key",
      validFinding({
        evidence: [
          validEvidence({
            metadata: { sourceCode: "placeholder" },
          }),
        ],
      }),
    ],
    ["raw diff text", validFinding({ summary: "diff --git a/app.ts b/app.ts" })],
    [
      "source-like text",
      validFinding({
        evidence: [validEvidence({ summary: "const leaked = true;" })],
      }),
    ],
    [
      "absolute path",
      validFinding({
        evidence: [validEvidence({ paths: ["/Users/rory/private/repo/src/app.ts"] })],
      }),
    ],
    [
      "windows absolute path",
      validFinding({
        evidence: [validEvidence({ paths: ["C:\\Users\\rory\\repo\\src\\app.ts"] })],
      }),
    ],
    [
      "embedded posix local path in finding summary",
      validFinding({
        summary: "See /Users/rory/private/repo/src/app.ts before approving this finding.",
      }),
    ],
    [
      "embedded windows local path in finding recommendation",
      validFinding({
        recommendation:
          "Inspect C:\\Users\\rory\\private\\repo\\src\\app.ts before enabling execution.",
      }),
    ],
    [
      "embedded posix local path in evidence metadata",
      validFinding({
        evidence: [
          validEvidence({
            metadata: { note: "Scanner referenced /Users/rory/private/repo/src/app.ts" },
          }),
        ],
      }),
    ],
    [
      "embedded windows local path in evidence path text",
      validFinding({
        evidence: [validEvidence({ paths: ["scan noted C:\\Users\\rory\\repo\\src\\app.ts"] })],
      }),
    ],
    [
      "traversal path",
      validFinding({
        evidence: [validEvidence({ paths: ["../src/app.ts"] })],
      }),
    ],
    [
      "real env path",
      validFinding({
        evidence: [validEvidence({ paths: ["apps/web/.env.local"] })],
      }),
    ],
    [
      "secret text",
      validFinding({
        evidence: [validEvidence({ summary: `Token ${"ghp_"}${"a".repeat(24)}` })],
      }),
    ],
    [
      "raw output label",
      validFinding({
        evidence: [validEvidence({ metadata: { label: "raw stdout: failed command output" } })],
      }),
    ],
  ])("rejects %s before persistence", async (_name, finding) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.persistFinding({
        finding,
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.upsertFindingWithAudit).not.toHaveBeenCalled();
  });

  test.each([
    [
      "raw command output alias",
      validFinding({
        evidence: [
          validEvidence({
            metadata: {
              nested: [{ rawCommandOutput: "command completed with private diagnostics" }],
            },
          }),
        ],
      }),
    ],
    [
      "stdout summary alias",
      validFinding({
        evidence: [
          validEvidence({
            metadata: {
              stdoutSummary: "validation output summary must not be attached to findings",
            },
          }),
        ],
      }),
    ],
    [
      "file contents alias",
      validFinding({
        evidence: [
          validEvidence({
            metadata: {
              fileContents: "metadata-only findings must never carry file bodies",
            },
          }),
        ],
      }),
    ],
    [
      "credential URL text",
      validFinding({
        recommendation: "Review https://user:repo-secret-token@example.test/private.git.",
      }),
    ],
    [
      "patch marker text",
      validFinding({
        summary: "*** Begin Patch\n*** Update File: app.ts",
      }),
    ],
    [
      "code fence text",
      validFinding({
        evidence: [validEvidence({ summary: "```ts\nconst leaked = true;\n```" })],
      }),
    ],
  ])("rejects widened hostile finding payload: %s", async (_name, finding) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    let thrown: unknown;
    try {
      await service.persistFinding({
        finding,
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "validation_error" });
    expect(JSON.stringify(thrown)).not.toMatch(
      /rawCommandOutput|stdoutSummary|fileContents|repo-secret-token|Begin Patch|const leaked/i,
    );
    expect(store.upsertFindingWithAudit).not.toHaveBeenCalled();
  });

  test("rejects unsafe stored finding rows before returning list results", async () => {
    const store = createStore({
      findings: [
        createFindingRow({
          evidence: [
            validEvidence({
              metadata: {
                nested: [{ rawCommandOutput: "stored command output must not return" }],
              },
            }),
          ],
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(service.listFindings({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  test("rejects unsafe stored finding rows before conversion creates tasks or audit events", async () => {
    const store = createStore({
      findings: [
        createFindingRow({
          evidence: [
            validEvidence({
              summary: "stdout: raw validation log must not become acceptance criteria",
            }),
          ],
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = (await createService({ store })) as Awaited<ReturnType<typeof createService>> &
      ConvertFindingToTaskService;

    await expect(
      service.convertFindingToTask({
        findingId: "finding_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.convertFindingToTaskWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
    expect(store.tasks).toEqual([]);
  });

  test("keeps audit metadata to ids, statuses, counts, and lengths only", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await service.persistFinding({
      finding: validFinding(),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      taskIds: ["task_1"],
      workspaceId: "workspace_1",
    });

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_readiness_findings.upserted",
        metadata: {
          category: "validation",
          dedupeKeyLength: 67,
          evidenceCount: 1,
          findingId: "finding_1",
          lifecycleState: "new",
          recommendationLength: 65,
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          severity: "high",
          status: "open",
          summaryLength: 63,
          taskIdCount: 1,
          titleLength: 31,
        },
      }),
    ]);
    expect(JSON.stringify(store.auditEvents)).not.toContain("Validation commands are missing");
    expect(JSON.stringify(store.auditEvents)).not.toContain(".aicp/policy.json");
    expectNoUnsafeFindingMaterial(store.auditEvents);
  });
});
