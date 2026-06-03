import { describe, expect, expectTypeOf, test, vi } from "vitest";

import type { UsageEvent } from "./usage-events.js";
import type { WorkspaceUsage } from "./usage.js";
import {
  BILLING_PLAN_LIMITS,
  createBillingPlanLimitService,
  getBillingPlanLimits,
  type BillingPlanLimitDecision,
  type BillingPlanLimitUsageEventType,
} from "./plan-limits.js";

vi.mock("server-only", () => ({}));

const now = new Date("2026-06-02T10:00:00.000Z");
const periodStart = new Date("2026-06-01T00:00:00.000Z");
const periodEnd = new Date("2026-07-01T00:00:00.000Z");

const workspaceUsage = (overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage => ({
  enforcementEnabled: false,
  monthlyRunLimit: 10_000,
  plan: "free",
  repoLimit: 1,
  runnerLimit: 1,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  usageCount: 0,
  workspaceId: "workspace_1",
  ...overrides,
});

const usageEvent = (overrides: Partial<UsageEvent> = {}): UsageEvent => ({
  createdAt: now,
  id: "usage_event_1",
  idempotencyKey: "usage:workspace_1:repo_scan:repo_scan_1",
  metadata: {},
  modelUsageCategory: "scan",
  occurredAt: now,
  quantity: 1,
  sourceId: "repo_scan_1",
  sourceTable: "repo_scans",
  usageEventType: "repo_scan",
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (input: { events?: UsageEvent[]; workspace?: WorkspaceUsage } = {}) => {
  const events = [...(input.events ?? [])];
  const currentWorkspace = input.workspace ?? workspaceUsage();

  return {
    events,
    store: {
      getWorkspaceUsage: vi.fn(async () => currentWorkspace),
      listUsageEvents: vi.fn(
        async (filter: { periodEnd: Date; periodStart: Date; workspaceId: string }) =>
          events.filter(
            (event) =>
              event.workspaceId === filter.workspaceId &&
              event.occurredAt >= filter.periodStart &&
              event.occurredAt < filter.periodEnd,
          ),
      ),
    },
  };
};

const expectNoUnsafeLimitMaterial = (value: unknown) => {
  expect(JSON.stringify(value)).not.toMatch(
    /prompt|sourceCode|diff --git|patch|snippet|secret|token|stdout|stderr|rawOutput|\/Users\/rory|\.env/i,
  );
};

describe("billing plan limits", () => {
  test("defines free and paid scan/task generation caps without Stripe URLs or raw usage gates", () => {
    expectTypeOf<BillingPlanLimitUsageEventType>().toEqualTypeOf<
      | "repo_scan"
      | "readiness_report_generation"
      | "task_recommendation_generation"
      | "setup_pr_generation"
      | "runner_execution"
    >();
    expect(BILLING_PLAN_LIMITS.free.repo_scan).toBe(3);
    expect(BILLING_PLAN_LIMITS.free.task_recommendation_generation).toBe(10);
    expect(BILLING_PLAN_LIMITS.pro.repo_scan).toBeGreaterThan(BILLING_PLAN_LIMITS.free.repo_scan);
    expect(BILLING_PLAN_LIMITS.pro.task_recommendation_generation).toBeGreaterThan(
      BILLING_PLAN_LIMITS.free.task_recommendation_generation,
    );
    expect(BILLING_PLAN_LIMITS.team.repo_scan).toBeGreaterThan(BILLING_PLAN_LIMITS.pro.repo_scan);
    expect(BILLING_PLAN_LIMITS.mvp.runner_execution).toBe(10_000);
    expect(BILLING_PLAN_LIMITS).not.toHaveProperty("stripeCheckoutUrl");
    expect(BILLING_PLAN_LIMITS).not.toHaveProperty("stripePortalUrl");
    expectNoUnsafeLimitMaterial(BILLING_PLAN_LIMITS);
  });

  test("blocks free plan repo scans at the monthly limit with a clear over-limit state", async () => {
    const { store } = createStore({
      events: [
        usageEvent({ id: "usage_event_1", sourceId: "repo_scan_1" }),
        usageEvent({ id: "usage_event_2", sourceId: "repo_scan_2" }),
        usageEvent({ id: "usage_event_3", sourceId: "repo_scan_3" }),
      ],
      workspace: workspaceUsage({ plan: "free" }),
    });
    const service = createBillingPlanLimitService({
      now: () => now,
      store,
    });

    const decision = await service.checkUsageLimit({
      usageEventType: "repo_scan",
      workspaceId: "workspace_1",
    });

    expectTypeOf<typeof decision>().toEqualTypeOf<BillingPlanLimitDecision>();
    expect(decision).toEqual({
      actionLabel: "repo readiness scan",
      adminOverrideApplied: false,
      allowed: false,
      limit: 3,
      message:
        "Free plan monthly repo readiness scan limit reached. Upgrade, request an admin override, or wait until 2026-07-01.",
      periodEnd,
      periodStart,
      plan: "free",
      remaining: 0,
      resetAt: periodEnd,
      status: "over_limit",
      usageEventType: "repo_scan",
      used: 3,
      workspaceId: "workspace_1",
    });
    expectNoUnsafeLimitMaterial(decision);
    await expect(
      service.assertUsageAllowed({
        usageEventType: "repo_scan",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({
      code: "plan_limit_exceeded",
      message:
        "Free plan monthly repo readiness scan limit reached. Upgrade, request an admin override, or wait until 2026-07-01.",
    });
  });

  test("allows paid plans to continue after free caps but still reports remaining usage", async () => {
    const { store } = createStore({
      events: Array.from({ length: BILLING_PLAN_LIMITS.free.repo_scan + 1 }, (_, index) =>
        usageEvent({
          id: `usage_event_${index + 1}`,
          idempotencyKey: `usage:workspace_1:repo_scan:repo_scan_${index + 1}`,
          sourceId: `repo_scan_${index + 1}`,
        }),
      ),
      workspace: workspaceUsage({ plan: "pro" }),
    });
    const service = createBillingPlanLimitService({
      now: () => now,
      store,
    });

    await expect(
      service.checkUsageLimit({
        usageEventType: "repo_scan",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      allowed: true,
      limit: BILLING_PLAN_LIMITS.pro.repo_scan,
      plan: "pro",
      remaining: BILLING_PLAN_LIMITS.pro.repo_scan - (BILLING_PLAN_LIMITS.free.repo_scan + 2),
      status: "allowed",
      used: BILLING_PLAN_LIMITS.free.repo_scan + 1,
    });
  });

  test("summarizes current monthly usage for the pricing placeholder UI", async () => {
    const { store } = createStore({
      events: [
        usageEvent({ id: "usage_event_scan_1", sourceId: "repo_scan_1" }),
        usageEvent({
          id: "usage_event_scan_2",
          idempotencyKey: "usage:workspace_1:repo_scan:repo_scan_2",
          sourceId: "repo_scan_2",
        }),
        usageEvent({
          id: "usage_event_tasks",
          idempotencyKey: "usage:workspace_1:task_recommendation_generation:scan_1",
          modelUsageCategory: "ai_generation",
          quantity: 4,
          sourceId: "task_recommendation_1",
          sourceTable: "task_recommendations",
          usageEventType: "task_recommendation_generation",
        }),
        usageEvent({
          id: "usage_event_setup_pr",
          idempotencyKey: "usage:workspace_1:setup_pr_generation:preview_1",
          modelUsageCategory: "setup_pr",
          sourceId: "setup_pr_preview_1",
          sourceTable: "setup_pr_previews",
          usageEventType: "setup_pr_generation",
        }),
        usageEvent({
          id: "usage_event_report",
          idempotencyKey: "usage:workspace_1:readiness_report_generation:report_1",
          modelUsageCategory: "ai_generation",
          sourceId: "readiness_report_1",
          sourceTable: "repo_readiness_reports",
          usageEventType: "readiness_report_generation",
        }),
      ],
      workspace: workspaceUsage({
        monthlyRunLimit: 8,
        plan: "free",
        repoLimit: 2,
        runnerLimit: 1,
        stripeCustomerId: "cus_DO_NOT_RENDER",
        stripeSubscriptionId: "sub_DO_NOT_RENDER",
        usageCount: 3,
      }),
    });
    const service = createBillingPlanLimitService({
      now: () => now,
      store,
    });

    const summary = await service.getWorkspacePlanUsageSummary({
      workspaceId: "workspace_1",
    });

    expect(summary).toEqual({
      enforcementEnabled: false,
      metrics: [
        {
          id: "repo_scans",
          label: "Repo scans",
          limit: 3,
          remaining: 1,
          unitLabel: "scans",
          usageEventType: "repo_scan",
          used: 2,
        },
        {
          id: "task_generations",
          label: "Task generations",
          limit: 10,
          remaining: 6,
          unitLabel: "generations",
          usageEventType: "task_recommendation_generation",
          used: 4,
        },
        {
          id: "setup_prs",
          label: "Setup PRs created",
          limit: 1,
          remaining: 0,
          unitLabel: "setup PRs",
          usageEventType: "setup_pr_generation",
          used: 1,
        },
      ],
      periodEnd,
      periodStart,
      plan: "free",
      resetAt: periodEnd,
      runnerExecutions: {
        id: "runner_executions",
        label: "Runner executions",
        limit: 8,
        remaining: 5,
        unitLabel: "runs",
        usageEventType: "runner_execution",
        used: 3,
      },
      stripeCustomerConfigured: true,
      stripeSubscriptionConfigured: true,
      workspaceId: "workspace_1",
      workspaceLimits: {
        repoLimit: 2,
        runnerLimit: 1,
      },
    });
    expectNoUnsafeLimitMaterial(summary);
  });

  test("allows safe admin override for testing while preserving the over-limit details", async () => {
    const { store } = createStore({
      events: Array.from(
        { length: BILLING_PLAN_LIMITS.free.task_recommendation_generation },
        (_, index) =>
          usageEvent({
            id: `usage_event_${index + 1}`,
            idempotencyKey: `usage:workspace_1:task_recommendation_generation:${index + 1}`,
            modelUsageCategory: "ai_generation",
            sourceId: `task_recommendation_${index + 1}`,
            sourceTable: "task_recommendations",
            usageEventType: "task_recommendation_generation",
          }),
      ),
      workspace: workspaceUsage({ plan: "free" }),
    });
    const service = createBillingPlanLimitService({
      now: () => now,
      store,
    });

    const decision = await service.checkUsageLimit({
      adminOverride: {
        enabled: true,
        reason: "r073-test",
      },
      usageEventType: "task_recommendation_generation",
      workspaceId: "workspace_1",
    });

    expect(decision).toMatchObject({
      adminOverrideApplied: true,
      allowed: true,
      limit: BILLING_PLAN_LIMITS.free.task_recommendation_generation,
      remaining: 0,
      status: "admin_override",
      used: BILLING_PLAN_LIMITS.free.task_recommendation_generation,
    });
    expectNoUnsafeLimitMaterial(decision);
  });

  test("resolves unknown or legacy plan names to bounded plan defaults", () => {
    expect(getBillingPlanLimits("unknown")).toEqual(BILLING_PLAN_LIMITS.free);
    expect(getBillingPlanLimits("mvp")).toEqual(BILLING_PLAN_LIMITS.mvp);
  });
});
