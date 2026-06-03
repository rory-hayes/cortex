import { describe, expect, expectTypeOf, test, vi } from "vitest";

import { schema } from "@control-plane/db";

import {
  BILLING_USAGE_ENFORCEMENT_ENABLED,
  getWorkspaceUsage,
  incrementWorkspaceUsageForClaim,
  type WorkspaceUsage,
} from "./usage.js";

const now = new Date("2026-05-23T09:00:00.000Z");

type WorkspaceUsageFixture = {
  id: string;
  monthlyRunLimit: number;
  plan: string;
  repoLimit: number;
  runnerLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  updatedAt: Date;
  usageCount: number;
};

const workspaceUsageRow = (
  overrides: Partial<WorkspaceUsageFixture> = {},
): WorkspaceUsageFixture => ({
  id: "workspace_1",
  monthlyRunLimit: 10_000,
  plan: "mvp",
  repoLimit: 25,
  runnerLimit: 10,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  updatedAt: new Date("2026-05-23T08:55:00.000Z"),
  usageCount: 7,
  ...overrides,
});

const createUsageDb = (workspace: WorkspaceUsageFixture | null = workspaceUsageRow()) => {
  const state = {
    selectWherePredicates: [] as unknown[],
    updateSetValues: [] as Record<string, unknown>[],
    updateTables: [] as unknown[],
    workspace: workspace ?? undefined,
  };

  return {
    state,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            state.selectWherePredicates.push(condition);

            return {
              limit: vi.fn(async () => (state.workspace === undefined ? [] : [state.workspace])),
            };
          }),
        })),
      })),
      update: vi.fn((table: unknown) => {
        state.updateTables.push(table);

        return {
          set: vi.fn((values: Record<string, unknown>) => {
            state.updateSetValues.push(values);

            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => {
                  if (state.workspace === undefined) {
                    return [];
                  }

                  state.workspace = {
                    ...state.workspace,
                    updatedAt: values.updatedAt as Date,
                    usageCount: state.workspace.usageCount + 1,
                  };

                  return [state.workspace];
                }),
              })),
            };
          }),
        };
      }),
    },
  };
};

const unsafeUsageFieldPattern = /checkout|portal|source|diff|patch|logs?|token|secret|gate/i;

const collectUnsafeUsageKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUnsafeUsageKeys(item, keys));

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (unsafeUsageFieldPattern.test(key)) {
      keys.push(key);
    }

    collectUnsafeUsageKeys(childValue, keys);
  }

  return keys;
};

describe("billing usage service", () => {
  test("getWorkspaceUsage returns metadata-only workspace usage with enforcement disabled", async () => {
    const { db } = createUsageDb(
      workspaceUsageRow({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        usageCount: 41,
      }),
    );

    const snapshot = await getWorkspaceUsage(db as never, {
      workspaceId: "workspace_1",
    });

    expectTypeOf<typeof snapshot>().toEqualTypeOf<WorkspaceUsage | null>();
    expect(BILLING_USAGE_ENFORCEMENT_ENABLED).toBe(false);
    expect(snapshot).toEqual({
      enforcementEnabled: false,
      monthlyRunLimit: 10_000,
      plan: "mvp",
      repoLimit: 25,
      runnerLimit: 10,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      usageCount: 41,
      workspaceId: "workspace_1",
    });
  });

  test("getWorkspaceUsage returns null when the workspace is missing", async () => {
    const { db } = createUsageDb(null);

    await expect(
      getWorkspaceUsage(db as never, {
        workspaceId: "workspace_missing",
      }),
    ).resolves.toBeNull();
  });

  test("incrementWorkspaceUsageForClaim increments usage once and returns the updated snapshot", async () => {
    const { db, state } = createUsageDb(workspaceUsageRow({ usageCount: 7 }));
    const input = {
      updatedAt: now,
      workspaceId: "workspace_1",
    };

    const snapshot = await incrementWorkspaceUsageForClaim(db as never, input);

    expect(Object.keys(input).sort()).toEqual(["updatedAt", "workspaceId"]);
    expect(snapshot).toEqual({
      enforcementEnabled: false,
      monthlyRunLimit: 10_000,
      plan: "mvp",
      repoLimit: 25,
      runnerLimit: 10,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      usageCount: 8,
      workspaceId: "workspace_1",
    });
    expect(state.workspace?.usageCount).toBe(8);
    expect(state.updateTables).toEqual([schema.workspaces]);
    expect(state.updateSetValues).toHaveLength(1);
    expect(Object.keys(state.updateSetValues[0] ?? {}).sort()).toEqual(["updatedAt", "usageCount"]);
    expect(state.updateSetValues[0]).not.toHaveProperty("runId");
    expect(state.updateSetValues[0]).not.toHaveProperty("jobId");
    expect(state.updateSetValues[0]).not.toHaveProperty("runnerId");
    expect(state.updateSetValues[0]).not.toHaveProperty("capabilitiesSnapshot");
    expect(state.updateSetValues[0]).not.toHaveProperty("taskPacket");
  });

  test("incrementWorkspaceUsageForClaim returns null when the workspace is missing", async () => {
    const { db, state } = createUsageDb(null);

    await expect(
      incrementWorkspaceUsageForClaim(db as never, {
        updatedAt: now,
        workspaceId: "workspace_missing",
      }),
    ).resolves.toBeNull();

    expect(state.updateTables).toEqual([schema.workspaces]);
  });

  test("returned usage data contains no checkout, portal, enforcement gate, source, diff, patch, log, token, or secret fields", async () => {
    const { db } = createUsageDb(workspaceUsageRow({ usageCount: 7 }));

    const snapshot = await getWorkspaceUsage(db as never, {
      workspaceId: "workspace_1",
    });

    expect(snapshot).not.toBeNull();
    expect(collectUnsafeUsageKeys(snapshot)).toEqual([]);
    expect(snapshot).not.toHaveProperty("checkoutUrl");
    expect(snapshot).not.toHaveProperty("customerPortalUrl");
    expect(snapshot).not.toHaveProperty("enforcementGate");
    expect(snapshot).not.toHaveProperty("hardLimitExceeded");
    expect(snapshot).not.toHaveProperty("paymentRequired");
    expect(snapshot).not.toHaveProperty("stripeCheckoutUrl");
    expect(snapshot).not.toHaveProperty("stripePortalUrl");
  });
});
