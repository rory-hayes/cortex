import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importErrors = async () => import("./errors");

describe("server action error envelopes", () => {
  test("returns stable public envelopes for known errors", async () => {
    const { createActionError, runServerAction } = await importErrors();

    await expect(
      runServerAction(async () => {
        throw createActionError("unauthenticated");
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
      },
    });

    await expect(
      runServerAction(async () => {
        throw createActionError("forbidden");
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
    });

    await expect(
      runServerAction(async () => {
        throw createActionError("validation_error");
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
    });

    await expect(
      runServerAction(async () => {
        throw createActionError("plan_limit_exceeded");
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "plan_limit_exceeded",
        message: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
      },
    });
  });

  test("hides unknown errors and does not serialize unsafe diagnostic text", async () => {
    const { runServerAction } = await importErrors();

    const result = await runServerAction(async () => {
      throw new Error(
        "duplicate key value violates unique constraint with token=ghp_example, diff --git, patch, source, secret, raw DB error",
      );
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "Something went wrong.",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /stack|duplicate key|raw DB|token|secret|diff|patch|source|ghp_/i,
    );
  });

  test("allows bounded custom public plan-limit messages and rejects unsafe custom text", async () => {
    const { createActionError, runServerAction } = await importErrors();

    await expect(
      runServerAction(async () => {
        throw createActionError(
          "plan_limit_exceeded",
          "Free plan monthly repo readiness scan limit reached. Upgrade, request an admin override, or wait until 2026-07-01.",
        );
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "plan_limit_exceeded",
        message:
          "Free plan monthly repo readiness scan limit reached. Upgrade, request an admin override, or wait until 2026-07-01.",
      },
    });

    await expect(
      runServerAction(async () => {
        throw createActionError("plan_limit_exceeded", "secret token in .env.local");
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "plan_limit_exceeded",
        message: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
      },
    });
  });
});
