import type { UsageEventStore, UsageEventType } from "./usage-events";
import { createActionError } from "../server/errors";

export type BillingPlanLimitUsageEventType = UsageEventType;

export type BillingPlanLimitAdminOverride = {
  enabled: true;
  reason: string;
};

export type BillingPlanLimitDecisionStatus = "admin_override" | "allowed" | "over_limit";

export type BillingPlanLimitDecision = {
  actionLabel: string;
  adminOverrideApplied: boolean;
  allowed: boolean;
  limit: number;
  message: string;
  periodEnd: Date;
  periodStart: Date;
  plan: string;
  remaining: number;
  resetAt: Date;
  status: BillingPlanLimitDecisionStatus;
  usageEventType: BillingPlanLimitUsageEventType;
  used: number;
  workspaceId: string;
};

export type BillingPlanUsageMetricId =
  | "repo_scans"
  | "runner_executions"
  | "setup_prs"
  | "task_generations";

export type BillingPlanUsageMetric = {
  id: BillingPlanUsageMetricId;
  label: string;
  limit: number;
  remaining: number;
  unitLabel: string;
  usageEventType: BillingPlanLimitUsageEventType;
  used: number;
};

export type BillingPlanUsageSummary = {
  enforcementEnabled: boolean;
  metrics: BillingPlanUsageMetric[];
  periodEnd: Date;
  periodStart: Date;
  plan: string;
  resetAt: Date;
  runnerExecutions: BillingPlanUsageMetric;
  stripeCustomerConfigured: boolean;
  stripeSubscriptionConfigured: boolean;
  workspaceId: string;
  workspaceLimits: {
    repoLimit: number;
    runnerLimit: number;
  };
};

export type CheckBillingPlanLimitInput = {
  adminOverride?: BillingPlanLimitAdminOverride;
  quantity?: number;
  usageEventType: BillingPlanLimitUsageEventType;
  workspaceId: string;
};

export type BillingPlanLimitService = {
  assertUsageAllowed: (input: CheckBillingPlanLimitInput) => Promise<BillingPlanLimitDecision>;
  checkUsageLimit: (input: CheckBillingPlanLimitInput) => Promise<BillingPlanLimitDecision>;
  getWorkspacePlanUsageSummary: (input: {
    workspaceId: string;
  }) => Promise<BillingPlanUsageSummary | null>;
};

export type BillingPlanLimitStore = Pick<UsageEventStore, "getWorkspaceUsage" | "listUsageEvents">;

const usageEventTypes = [
  "repo_scan",
  "readiness_report_generation",
  "task_recommendation_generation",
  "setup_pr_generation",
  "runner_execution",
] as const satisfies readonly BillingPlanLimitUsageEventType[];

export const BILLING_PLAN_LIMITS = {
  free: {
    readiness_report_generation: 3,
    repo_scan: 3,
    runner_execution: 5,
    setup_pr_generation: 1,
    task_recommendation_generation: 10,
  },
  mvp: {
    readiness_report_generation: 10_000,
    repo_scan: 10_000,
    runner_execution: 10_000,
    setup_pr_generation: 10_000,
    task_recommendation_generation: 10_000,
  },
  pro: {
    readiness_report_generation: 100,
    repo_scan: 100,
    runner_execution: 100,
    setup_pr_generation: 25,
    task_recommendation_generation: 300,
  },
  team: {
    readiness_report_generation: 500,
    repo_scan: 500,
    runner_execution: 500,
    setup_pr_generation: 100,
    task_recommendation_generation: 1_500,
  },
} as const satisfies Record<string, Record<BillingPlanLimitUsageEventType, number>>;

const actionLabels = {
  readiness_report_generation: "readiness report generation",
  repo_scan: "repo readiness scan",
  runner_execution: "runner execution",
  setup_pr_generation: "setup PR generation",
  task_recommendation_generation: "task recommendation generation",
} as const satisfies Record<BillingPlanLimitUsageEventType, string>;

const safeIdentifierPattern = /^[A-Za-z0-9._:-]{1,240}$/u;
const safeOverrideReasonPattern = /^[A-Za-z0-9 ._:-]{1,160}$/u;

const isUsageEventType = (value: string): value is BillingPlanLimitUsageEventType =>
  usageEventTypes.includes(value as BillingPlanLimitUsageEventType);

const assertSafeIdentifier = (value: string): void => {
  if (!safeIdentifierPattern.test(value)) {
    throw createActionError("validation_error");
  }
};

const assertAdminOverride = (override: BillingPlanLimitAdminOverride | undefined): void => {
  if (override === undefined) {
    return;
  }

  if (override.enabled !== true || !safeOverrideReasonPattern.test(override.reason.trim())) {
    throw createActionError("validation_error");
  }
};

const normalizeQuantity = (value: number | undefined): number => {
  const quantity = value ?? 1;

  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 10_000) {
    throw createActionError("validation_error");
  }

  return quantity;
};

const capitalizePlan = (value: string): string =>
  value.length === 0 ? "Free" : `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

const getMonthlyPeriod = (now: Date): { periodEnd: Date; periodStart: Date } => {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return { periodEnd, periodStart };
};

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

const isKnownBillingPlan = (value: string): value is keyof typeof BILLING_PLAN_LIMITS =>
  value in BILLING_PLAN_LIMITS;

export const getBillingPlanLimits = (
  plan: string,
): Readonly<Record<BillingPlanLimitUsageEventType, number>> => {
  const normalizedPlan = plan.trim().toLowerCase();

  if (normalizedPlan === "paid") {
    return BILLING_PLAN_LIMITS.pro;
  }

  return isKnownBillingPlan(normalizedPlan)
    ? BILLING_PLAN_LIMITS[normalizedPlan]
    : BILLING_PLAN_LIMITS.free;
};

const getNormalizedPlan = (plan: string): keyof typeof BILLING_PLAN_LIMITS => {
  const normalizedPlan = plan.trim().toLowerCase();

  if (normalizedPlan === "paid") {
    return "pro";
  }

  return isKnownBillingPlan(normalizedPlan) ? normalizedPlan : "free";
};

const messageFor = (input: {
  actionLabel: string;
  plan: string;
  resetAt: Date;
  status: BillingPlanLimitDecisionStatus;
}): string => {
  if (input.status === "admin_override") {
    return `${capitalizePlan(input.plan)} plan monthly ${input.actionLabel} limit overridden by an admin.`;
  }

  if (input.status === "over_limit") {
    return `${capitalizePlan(input.plan)} plan monthly ${input.actionLabel} limit reached. Upgrade, request an admin override, or wait until ${formatDate(input.resetAt)}.`;
  }

  return `${capitalizePlan(input.plan)} plan monthly ${input.actionLabel} usage is within limit.`;
};

const createUsageMetric = (input: {
  id: BillingPlanUsageMetricId;
  label: string;
  limit: number;
  unitLabel: string;
  usageEventType: BillingPlanLimitUsageEventType;
  used: number;
}): BillingPlanUsageMetric => ({
  id: input.id,
  label: input.label,
  limit: input.limit,
  remaining: Math.max(input.limit - input.used, 0),
  unitLabel: input.unitLabel,
  usageEventType: input.usageEventType,
  used: input.used,
});

export const createBillingPlanLimitService = (input: {
  now?: () => Date;
  store: BillingPlanLimitStore;
}): BillingPlanLimitService => {
  const now = input.now ?? (() => new Date());

  const checkUsageLimit = async (
    checkInput: CheckBillingPlanLimitInput,
  ): Promise<BillingPlanLimitDecision> => {
    assertSafeIdentifier(checkInput.workspaceId);
    assertAdminOverride(checkInput.adminOverride);

    if (!isUsageEventType(checkInput.usageEventType)) {
      throw createActionError("validation_error");
    }

    const quantity = normalizeQuantity(checkInput.quantity);
    const currentTime = now();
    const { periodEnd, periodStart } = getMonthlyPeriod(currentTime);
    const [workspaceUsage, usageEvents] = await Promise.all([
      input.store.getWorkspaceUsage({ workspaceId: checkInput.workspaceId }),
      input.store.listUsageEvents({
        periodEnd,
        periodStart,
        workspaceId: checkInput.workspaceId,
      }),
    ]);

    if (workspaceUsage === null) {
      throw createActionError("validation_error");
    }

    const plan = getNormalizedPlan(workspaceUsage.plan);
    const limits = getBillingPlanLimits(plan);
    const limit = limits[checkInput.usageEventType];
    const used = usageEvents
      .filter((event) => event.usageEventType === checkInput.usageEventType)
      .reduce((total, event) => total + event.quantity, 0);
    const wouldUse = used + quantity;
    const overLimit = wouldUse > limit;
    const adminOverrideApplied = checkInput.adminOverride?.enabled === true && overLimit;
    const status: BillingPlanLimitDecisionStatus = adminOverrideApplied
      ? "admin_override"
      : overLimit
        ? "over_limit"
        : "allowed";
    const actionLabel = actionLabels[checkInput.usageEventType];
    const remaining = Math.max(limit - wouldUse, 0);
    const decision: BillingPlanLimitDecision = {
      actionLabel,
      adminOverrideApplied,
      allowed: status !== "over_limit",
      limit,
      message: messageFor({
        actionLabel,
        plan,
        resetAt: periodEnd,
        status,
      }),
      periodEnd,
      periodStart,
      plan,
      remaining,
      resetAt: periodEnd,
      status,
      usageEventType: checkInput.usageEventType,
      used,
      workspaceId: checkInput.workspaceId,
    };

    return decision;
  };

  return {
    assertUsageAllowed: async (checkInput) => {
      const decision = await checkUsageLimit(checkInput);

      if (!decision.allowed) {
        throw createActionError("plan_limit_exceeded", decision.message);
      }

      return decision;
    },
    checkUsageLimit,
    getWorkspacePlanUsageSummary: async (summaryInput) => {
      assertSafeIdentifier(summaryInput.workspaceId);

      const currentTime = now();
      const { periodEnd, periodStart } = getMonthlyPeriod(currentTime);
      const [workspaceUsage, usageEvents] = await Promise.all([
        input.store.getWorkspaceUsage({ workspaceId: summaryInput.workspaceId }),
        input.store.listUsageEvents({
          periodEnd,
          periodStart,
          workspaceId: summaryInput.workspaceId,
        }),
      ]);

      if (workspaceUsage === null) {
        return null;
      }

      const plan = getNormalizedPlan(workspaceUsage.plan);
      const limits = getBillingPlanLimits(plan);
      const usedByType = new Map<BillingPlanLimitUsageEventType, number>(
        usageEventTypes.map((usageEventType) => [usageEventType, 0]),
      );

      for (const event of usageEvents) {
        usedByType.set(
          event.usageEventType,
          (usedByType.get(event.usageEventType) ?? 0) + event.quantity,
        );
      }

      const metrics = [
        createUsageMetric({
          id: "repo_scans",
          label: "Repo scans",
          limit: limits.repo_scan,
          unitLabel: "scans",
          usageEventType: "repo_scan",
          used: usedByType.get("repo_scan") ?? 0,
        }),
        createUsageMetric({
          id: "task_generations",
          label: "Task generations",
          limit: limits.task_recommendation_generation,
          unitLabel: "generations",
          usageEventType: "task_recommendation_generation",
          used: usedByType.get("task_recommendation_generation") ?? 0,
        }),
        createUsageMetric({
          id: "setup_prs",
          label: "Setup PRs created",
          limit: limits.setup_pr_generation,
          unitLabel: "setup PRs",
          usageEventType: "setup_pr_generation",
          used: usedByType.get("setup_pr_generation") ?? 0,
        }),
      ];

      return {
        enforcementEnabled: workspaceUsage.enforcementEnabled,
        metrics,
        periodEnd,
        periodStart,
        plan,
        resetAt: periodEnd,
        runnerExecutions: createUsageMetric({
          id: "runner_executions",
          label: "Runner executions",
          limit: workspaceUsage.monthlyRunLimit,
          unitLabel: "runs",
          usageEventType: "runner_execution",
          used: workspaceUsage.usageCount,
        }),
        stripeCustomerConfigured: workspaceUsage.stripeCustomerId !== null,
        stripeSubscriptionConfigured: workspaceUsage.stripeSubscriptionId !== null,
        workspaceId: summaryInput.workspaceId,
        workspaceLimits: {
          repoLimit: workspaceUsage.repoLimit,
          runnerLimit: workspaceUsage.runnerLimit,
        },
      };
    },
  };
};
