export type BillingLimits = {
  monthlyRunLimit: number;
  plan: "mvp";
  repoLimit: number;
  runnerLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  usageCount: number;
};

export const MVP_BILLING_LIMITS: BillingLimits = {
  monthlyRunLimit: 10_000,
  plan: "mvp",
  repoLimit: 25,
  runnerLimit: 10,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  usageCount: 0,
};
