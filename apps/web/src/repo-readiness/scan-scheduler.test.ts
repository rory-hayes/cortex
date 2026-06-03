import { describe, expect, test, vi } from "vitest";

import type { RepoScanStatus } from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const importScheduler = async () => import("./scan-scheduler");

type Candidate = {
  latestScanCreatedAt: Date | null;
  latestScanFinishedAt: Date | null;
  latestScanId: string | null;
  latestScanStatus: RepoScanStatus | null;
  monthlyRunLimit: number;
  plan: string;
  repoId: string;
  usageCount: number;
  workspaceId: string;
};

const now = new Date("2026-06-02T09:30:00.000Z");
const oneDayMs = 24 * 60 * 60 * 1000;

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  latestScanCreatedAt: new Date(now.getTime() - 8 * oneDayMs),
  latestScanFinishedAt: new Date(now.getTime() - 8 * oneDayMs + 60_000),
  latestScanId: "repo_scan_previous",
  latestScanStatus: "completed",
  monthlyRunLimit: 10_000,
  plan: "mvp",
  repoId: "github_repository_1",
  usageCount: 12,
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (candidates: Candidate[]) => {
  const createdScans: Array<{
    auditEvent: { eventType: string; metadata: Record<string, unknown>; workspaceId: string };
    scan: { id: string; repoId: string; statusSummary: string; workspaceId: string };
  }> = [];

  return {
    createdScans,
    createRecurringRepoScanWithAudit: vi.fn(async (input) => {
      createdScans.push(input);

      return {
        ...input.scan,
        contractVersion: "2026-05-10.v1" as const,
        createdAt: now,
        failureSummary: null,
        findingIds: [],
        finishedAt: null,
        inventory: input.scan.inventory,
        moduleStatuses: [],
        readinessReportId: null,
        startedAt: null,
        taskRecommendationIds: [],
        updatedAt: now,
      };
    }),
    listRecurringRepoScanCandidates: vi.fn(async () => candidates),
  };
};

describe("repo scan scheduler", () => {
  test("queues weekly scans for due active repositories", async () => {
    const store = createStore([
      candidate({ repoId: "github_repository_due" }),
      candidate({
        latestScanCreatedAt: new Date(now.getTime() - 6 * oneDayMs),
        latestScanFinishedAt: new Date(now.getTime() - 6 * oneDayMs + 60_000),
        repoId: "github_repository_recent",
      }),
      candidate({
        latestScanCreatedAt: null,
        latestScanFinishedAt: null,
        latestScanId: null,
        latestScanStatus: null,
        repoId: "github_repository_never_scanned",
      }),
    ]);
    const { createRepoScanScheduler } = await importScheduler();
    const scheduler = createRepoScanScheduler({
      createAuditEventId: () => `audit_${store.createdScans.length + 1}`,
      createScanId: () => `repo_scan_${store.createdScans.length + 1}`,
      now: () => now,
      store,
    });

    await expect(scheduler.runWeeklyRepoScans()).resolves.toEqual({
      dueCount: 2,
      planLimitedCount: 0,
      queued: [
        {
          created: true,
          reason: "weekly_due",
          repoId: "github_repository_due",
          scanId: "repo_scan_1",
          status: "queued",
          workspaceId: "workspace_1",
        },
        {
          created: true,
          reason: "never_scanned",
          repoId: "github_repository_never_scanned",
          scanId: "repo_scan_2",
          status: "queued",
          workspaceId: "workspace_1",
        },
      ],
      skipped: [
        {
          reason: "recent_scan",
          repoId: "github_repository_recent",
          workspaceId: "workspace_1",
        },
      ],
      skippedCount: 1,
    });
    expect(store.listRecurringRepoScanCandidates).toHaveBeenCalledWith({ limit: 100 });
    expect(store.createdScans).toHaveLength(2);
    expect(store.createdScans[0]?.auditEvent).toEqual(
      expect.objectContaining({
        eventType: "repo_scans.recurring_queued",
        metadata: expect.objectContaining({
          repoId: "github_repository_due",
          scanId: "repo_scan_1",
          triggerReason: "weekly_due",
        }),
        workspaceId: "workspace_1",
      }),
    );
  });

  test("avoids duplicate scans when a candidate already has a queued or running scan", async () => {
    const store = createStore([
      candidate({
        latestScanCreatedAt: new Date(now.getTime() - 8 * oneDayMs),
        latestScanFinishedAt: null,
        latestScanId: "repo_scan_active",
        latestScanStatus: "running",
      }),
    ]);
    const { createRepoScanScheduler } = await importScheduler();
    const scheduler = createRepoScanScheduler({
      createScanId: () => "repo_scan_duplicate",
      now: () => now,
      store,
    });

    await expect(scheduler.runWeeklyRepoScans()).resolves.toEqual({
      dueCount: 0,
      planLimitedCount: 0,
      queued: [],
      skipped: [
        {
          reason: "active_scan",
          repoId: "github_repository_1",
          scanId: "repo_scan_active",
          workspaceId: "workspace_1",
        },
      ],
      skippedCount: 1,
    });
    expect(store.createRecurringRepoScanWithAudit).not.toHaveBeenCalled();
  });

  test("respects per-plan scan limits when usage enforcement is enabled", async () => {
    const store = createStore([
      candidate({
        monthlyRunLimit: 10_000,
        plan: "free",
        repoId: "github_repository_free_over_limit",
        usageCount: 3,
      }),
      candidate({
        monthlyRunLimit: 10_000,
        plan: "pro",
        repoId: "github_repository_pro_allowed",
        usageCount: 3,
      }),
    ]);
    const { createRepoScanScheduler } = await importScheduler();
    const scheduler = createRepoScanScheduler({
      createScanId: () => `repo_scan_${store.createdScans.length + 1}`,
      enforcementEnabled: true,
      now: () => now,
      store,
    });

    await expect(scheduler.runWeeklyRepoScans()).resolves.toEqual({
      dueCount: 1,
      planLimitedCount: 1,
      queued: [
        {
          created: true,
          reason: "weekly_due",
          repoId: "github_repository_pro_allowed",
          scanId: "repo_scan_1",
          status: "queued",
          workspaceId: "workspace_1",
        },
      ],
      skipped: [
        {
          reason: "plan_limit",
          repoId: "github_repository_free_over_limit",
          workspaceId: "workspace_1",
        },
      ],
      skippedCount: 1,
    });
    expect(store.createRecurringRepoScanWithAudit).toHaveBeenCalledTimes(1);
  });

  test("manual scan API remains the explicit manual rescan surface", async () => {
    const routeSource = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../../app/api/repo-readiness/scans/route.ts", import.meta.url), "utf8"),
    );

    expect(routeSource).toContain("triggerRepoScan(input)");
    expect(routeSource).toContain("scan.created ? 201 : 200");
  });
});
