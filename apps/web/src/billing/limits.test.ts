import { describe, expect, expectTypeOf, test } from "vitest";

import { MVP_BILLING_LIMITS, type BillingLimits } from "./limits";

describe("MVP billing limits", () => {
  test("exposes generous non-enforcing billing hook defaults", () => {
    expectTypeOf<typeof MVP_BILLING_LIMITS>().toEqualTypeOf<BillingLimits>();

    expect(MVP_BILLING_LIMITS).toEqual({
      monthlyRunLimit: 10_000,
      plan: "mvp",
      repoLimit: 25,
      runnerLimit: 10,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      usageCount: 0,
    });
    expect(MVP_BILLING_LIMITS).not.toHaveProperty("enforcementEnabled");
    expect(MVP_BILLING_LIMITS).not.toHaveProperty("gate");
    expect(MVP_BILLING_LIMITS).not.toHaveProperty("stripeCheckoutUrl");
    expect(MVP_BILLING_LIMITS).not.toHaveProperty("stripePortalUrl");
  });
});
