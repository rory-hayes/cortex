import { describe, expect, expectTypeOf, test, vi } from "vitest";

import {
  createUsageEventService,
  USAGE_EVENT_TYPES,
  USAGE_MODEL_CATEGORIES,
  type RecordUsageEventInput,
  type UsageEvent,
  type UsageEventSummary,
  type UsageEventType,
  type UsageModelCategory,
} from "./usage-events.js";

const periodStart = new Date("2026-06-01T00:00:00.000Z");
const periodEnd = new Date("2026-07-01T00:00:00.000Z");
const now = new Date("2026-06-02T10:00:00.000Z");

const workspaceUsage = {
  enforcementEnabled: false,
  monthlyRunLimit: 10_000,
  plan: "mvp",
  repoLimit: 25,
  runnerLimit: 10,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  usageCount: 0,
  workspaceId: "workspace_1",
} as const;

const createStore = () => {
  const events: UsageEvent[] = [];

  return {
    events,
    store: {
      findUsageEventByIdempotencyKey: vi.fn(
        async (input: { idempotencyKey: string; workspaceId: string }) =>
          events.find(
            (event) =>
              event.workspaceId === input.workspaceId &&
              event.idempotencyKey === input.idempotencyKey,
          ) ?? null,
      ),
      getWorkspaceUsage: vi.fn(async () => workspaceUsage),
      insertUsageEvent: vi.fn(async (event: UsageEvent) => {
        events.push(event);

        return event;
      }),
      listUsageEvents: vi.fn(
        async (input: { periodEnd: Date; periodStart: Date; workspaceId: string }) =>
          events.filter(
            (event) =>
              event.workspaceId === input.workspaceId &&
              event.occurredAt >= input.periodStart &&
              event.occurredAt < input.periodEnd,
          ),
      ),
    },
  };
};

const safeInput = (overrides: Partial<RecordUsageEventInput> = {}): RecordUsageEventInput => ({
  idempotencyKey: "usage:workspace_1:repo_scan:repo_scan_1",
  metadata: {
    trigger: "manual",
  },
  occurredAt: now,
  quantity: 1,
  source: {
    id: "repo_scan_1",
    table: "repo_scans",
  },
  usageEventType: "repo_scan",
  workspaceId: "workspace_1",
  ...overrides,
});

const expectNoUnsafeUsageMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toMatch(
    /prompt|sourceCode|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|rawOutput|\/Users\/rory|\.env\.local/i,
  );
};

describe("usage event service", () => {
  test("exports the supported usage event and model categories", () => {
    expect(USAGE_EVENT_TYPES).toEqual([
      "repo_scan",
      "readiness_report_generation",
      "task_recommendation_generation",
      "setup_pr_generation",
      "runner_execution",
    ]);
    expect(USAGE_MODEL_CATEGORIES).toEqual([
      "scan",
      "ai_generation",
      "setup_pr",
      "runner_execution",
    ]);
    expectTypeOf<UsageEventType>().toEqualTypeOf<(typeof USAGE_EVENT_TYPES)[number]>();
    expectTypeOf<UsageModelCategory>().toEqualTypeOf<(typeof USAGE_MODEL_CATEGORIES)[number]>();
  });

  test("records workspace-scoped usage events with derived safe model usage category", async () => {
    const { events, store } = createStore();
    const service = createUsageEventService({
      createEventId: () => "usage_event_1",
      now: () => now,
      store,
    });

    const event = await service.recordUsageEvent(
      safeInput({
        metadata: {
          findingCount: 3,
          trigger: "manual",
        },
      }),
    );

    expect(event).toEqual({
      createdAt: now,
      id: "usage_event_1",
      idempotencyKey: "usage:workspace_1:repo_scan:repo_scan_1",
      metadata: {
        findingCount: 3,
        trigger: "manual",
      },
      modelUsageCategory: "scan",
      occurredAt: now,
      quantity: 1,
      sourceId: "repo_scan_1",
      sourceTable: "repo_scans",
      usageEventType: "repo_scan",
      workspaceId: "workspace_1",
    });
    expect(events).toEqual([event]);
    expectNoUnsafeUsageMaterial(event);
  });

  test("returns existing usage events for repeated idempotency keys", async () => {
    const { events, store } = createStore();
    const service = createUsageEventService({
      createEventId: () => `usage_event_${events.length + 1}`,
      now: () => now,
      store,
    });

    const firstEvent = await service.recordUsageEvent(safeInput());
    const secondEvent = await service.recordUsageEvent(
      safeInput({
        metadata: {
          trigger: "webhook",
        },
      }),
    );

    expect(secondEvent).toBe(firstEvent);
    expect(events).toHaveLength(1);
    expect(store.insertUsageEvent).toHaveBeenCalledTimes(1);
  });

  test("summarizes usage events for plan limit checks without enabling enforcement", async () => {
    const { store } = createStore();
    const service = createUsageEventService({
      createEventId: () => "usage_event",
      now: () => now,
      store,
    });

    await service.recordUsageEvent(safeInput({ quantity: 2 }));
    await service.recordUsageEvent(
      safeInput({
        idempotencyKey: "usage:workspace_1:report:repo_scan_1",
        quantity: 1,
        source: {
          id: "readiness_report_1",
          table: "repo_readiness_reports",
        },
        usageEventType: "readiness_report_generation",
      }),
    );
    await service.recordUsageEvent(
      safeInput({
        idempotencyKey: "usage:workspace_1:runner:run_1",
        quantity: 1,
        source: {
          id: "run_1",
          table: "runs",
        },
        usageEventType: "runner_execution",
      }),
    );

    const summary = await service.summarizeWorkspaceUsageEvents({
      periodEnd,
      periodStart,
      workspaceId: "workspace_1",
    });

    expectTypeOf<typeof summary>().toEqualTypeOf<UsageEventSummary>();
    expect(summary).toEqual({
      byModelUsageCategory: {
        ai_generation: 1,
        runner_execution: 1,
        scan: 2,
        setup_pr: 0,
      },
      byUsageEventType: {
        readiness_report_generation: 1,
        repo_scan: 2,
        runner_execution: 1,
        setup_pr_generation: 0,
        task_recommendation_generation: 0,
      },
      enforcementEnabled: false,
      monthlyRunLimit: 10_000,
      periodEnd,
      periodStart,
      plan: "mvp",
      remainingMonthlyQuantity: 9_996,
      totalQuantity: 4,
      workspaceId: "workspace_1",
    });
    expectNoUnsafeUsageMaterial(summary);
  });

  test("rejects unsafe usage metadata before persistence", async () => {
    const { store } = createStore();
    const service = createUsageEventService({
      createEventId: () => "usage_event_unsafe",
      now: () => now,
      store,
    });

    await expect(
      service.recordUsageEvent(
        safeInput({
          metadata: {
            prompt: "Generate code for this repository.",
            sourceCode: "const leaked = process.env.SECRET",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.insertUsageEvent).not.toHaveBeenCalled();
  });
});
