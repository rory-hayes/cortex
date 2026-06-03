import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { BillingPlanUsageSummary } from "../src/billing/plan-limits";
import type { WorkspaceUsage } from "../src/billing/usage";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const createUsage = (overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage => ({
  enforcementEnabled: false,
  monthlyRunLimit: 10_000,
  plan: "mvp",
  repoLimit: 25,
  runnerLimit: 10,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  usageCount: 42,
  workspaceId: "workspace_1",
  ...overrides,
});

const createPlanUsage = (
  overrides: Partial<BillingPlanUsageSummary> = {},
): BillingPlanUsageSummary => ({
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
  periodEnd: new Date("2026-07-01T00:00:00.000Z"),
  periodStart: new Date("2026-06-01T00:00:00.000Z"),
  plan: "free",
  resetAt: new Date("2026-07-01T00:00:00.000Z"),
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
    repoLimit: 25,
    runnerLimit: 10,
  },
  ...overrides,
});

const unsafeBillingPattern =
  /Stripe Checkout|customer portal|checkout|payment|credit card|invoice|subscribe|manage billing|stripeCheckoutUrl|stripePortalUrl|process\.env|STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|NEXT_PUBLIC_STRIPE|stripeClientSecret|client_secret/i;

const unsafeSourceBoundaryPattern =
  /raw source|source code|diff --git|patch|snippet|raw log|raw output|stdout|stderr|secret|token|private key/i;

describe("billing settings UI source conventions", () => {
  test("renders plan usage counters, limits, remaining usage, and disabled billing metadata", async () => {
    const { BillingSettings } = await import("../components/billing-settings");

    const html = renderToStaticMarkup(
      createElement(BillingSettings, {
        planUsage: createPlanUsage(),
        usage: createUsage({
          stripeCustomerId: "cus_DO_NOT_RENDER",
          stripeSubscriptionId: "sub_DO_NOT_RENDER",
          usageCount: 42,
        }),
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("Billing settings");
    expect(html).toContain("Control Plane");
    expect(html).toContain("free");
    expect(html).toContain("Plan usage");
    expect(html).toContain("Repo scans");
    expect(html).toContain("Task generations");
    expect(html).toContain("Setup PRs created");
    expect(html).toContain("2 used");
    expect(html).toContain("1 remaining");
    expect(html).toContain("4 used");
    expect(html).toContain("6 remaining");
    expect(html).toContain("0 remaining");
    expect(html).toContain("Limit 3 / month");
    expect(html).toContain("Limit 10 / month");
    expect(html).toContain("Limit 1 / month");
    expect(html).toContain("Resets 2026-07-01");
    expect(html).toContain("Runner executions");
    expect(html).toContain("3 used");
    expect(html).toContain("5 remaining");
    expect(html).toContain("10 runners");
    expect(html).toContain("25 repositories");
    expect(html).toContain("Usage enforcement disabled");
    expect(html).toContain("Stripe disabled");
    expect(html).toContain("No Stripe required");
    expect(html).toContain("Customer status");
    expect(html).toContain("Subscription status");
    expect(html).toContain("Configured");
    expect(html).not.toContain("cus_DO_NOT_RENDER");
    expect(html).not.toContain("sub_DO_NOT_RENDER");
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(unsafeBillingPattern);
    expect(html).not.toMatch(unsafeSourceBoundaryPattern);
  });

  test("defines a server billing settings component without Stripe action material", async () => {
    await expectFile("../components/billing-settings.tsx");

    const source = await readAppFile("../components/billing-settings.tsx");

    expect(source.trimStart()).not.toMatch(/^"use client";/);
    expect(source).toContain("WorkspaceUsage");
    expect(source).toContain("BillingPlanUsageSummary");
    expect(source).toContain('from "@/src/billing/plan-limits"');
    expect(source).toContain('from "@/src/billing/usage"');
    expect(source).toMatch(/usage:\s*WorkspaceUsage;/);
    expect(source).toMatch(/planUsage:\s*BillingPlanUsageSummary;/);
    expect(source).not.toMatch(/usage:\s*WorkspaceUsage\s*\|\s*null/);
    expect(source).toContain("usage.enforcementEnabled");
    expect(source).toContain("planUsage.metrics");
    expect(source).toContain("planUsage.stripeCustomerConfigured");
    expect(source).toContain("planUsage.stripeSubscriptionConfigured");
    expect(source).not.toContain("usage.stripeCustomerId");
    expect(source).not.toContain("usage.stripeSubscriptionId");
    expect(source).not.toContain("<form");
    expect(source).not.toMatch(unsafeBillingPattern);
    expect(source).not.toMatch(unsafeSourceBoundaryPattern);
  });

  test("loads billing usage only after selected workspace membership is verified", async () => {
    await expectFile("./(app)/dashboard/settings/billing/page.tsx");

    const source = await readAppFile("./(app)/dashboard/settings/billing/page.tsx");
    const selectWorkspaceIndex = source.indexOf(
      "selectWorkspace({ workspaceId: cookieWorkspaceId })",
    );
    const usageLookupIndex = source.indexOf("getWorkspaceUsage(db,");
    const planUsageLookupIndex = source.indexOf("getWorkspacePlanUsageSummary");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createWorkspaceMutationService");
    expect(source).toContain("createDrizzleWorkspaceMutationStore");
    expect(source).toContain("getWorkspaceUsage");
    expect(source).toContain("createBillingPlanLimitService");
    expect(source).toContain("createDrizzleUsageEventStore");
    expect(source).toContain("getWorkspacePlanUsageSummary");
    expect(source).toContain("const verifiedWorkspace");
    expect(selectWorkspaceIndex).toBeGreaterThanOrEqual(0);
    expect(usageLookupIndex).toBeGreaterThan(selectWorkspaceIndex);
    expect(planUsageLookupIndex).toBeGreaterThan(selectWorkspaceIndex);
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(
      /getWorkspaceUsage\(db,\s*\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /getWorkspaceUsage\(db,\s*\{\s*workspaceId: cookieWorkspaceId,?\s*\}\)/,
    );
    expect(source).toMatch(
      /getWorkspacePlanUsageSummary\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toContain('href="/workspaces"');
    expect(source).toMatch(
      /usage === null \|\| planUsage === null[\s\S]*Usage snapshot unavailable/,
    );
    expect(source).toMatch(
      /<BillingSettings[\s\S]*usage={usage}[\s\S]*planUsage={planUsage}[\s\S]*workspaceName={verifiedWorkspace\.name}/,
    );
    expect(source).not.toContain("<form");
    expect(source).not.toMatch(unsafeBillingPattern);
    expect(source).not.toMatch(unsafeSourceBoundaryPattern);
  });

  test("links settings landing users to billing hooks", async () => {
    const source = await readAppFile("./(app)/dashboard/settings/page.tsx");

    expect(source).toContain('href="/dashboard/settings/billing"');
    expect(source).toContain("Billing hooks");
    expect(source).toContain("billing is inactive in MVP");
    expect(source).not.toContain("<form");
    expect(source).not.toMatch(unsafeBillingPattern);
    expect(source).not.toMatch(unsafeSourceBoundaryPattern);
  });
});
