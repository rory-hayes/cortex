import { describe, expect, test } from "vitest";

import { assessProductionRuntimeEnv, productionRuntimeRequirements } from "./env";

const validRuntimeEnv = {
  APP_BASE_URL: "https://cortex.internal",
  AUTH0_CLIENT_ID: ["auth0", "client", "runtime"].join("-"),
  AUTH0_CLIENT_SECRET: ["auth0", "client", "runtime", "secret"].join("-"),
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_SECRET: "a".repeat(64),
  DATABASE_URL: [
    "postgresql",
    "://db-user:runtime-db-password@db.cortex.internal:5432/postgres",
  ].join(""),
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: [
    "-----BEGIN ",
    "PRIVATE KEY-----\\nabc123abc123abc123\\n-----END ",
    "PRIVATE KEY-----",
  ].join(""),
  GITHUB_WEBHOOK_SECRET: "github-webhook-runtime-secret",
  WEB_BASE_URL: "https://cortex.internal",
} as const;

const serializeReadiness = (value: unknown): string => JSON.stringify(value);

describe("production runtime environment readiness", () => {
  test("tracks the required MVP production credential set", () => {
    expect(
      productionRuntimeRequirements
        .filter((requirement) => requirement.required)
        .map((requirement) => requirement.key),
    ).toEqual([
      "WEB_BASE_URL",
      "APP_BASE_URL",
      "AUTH0_DOMAIN",
      "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET",
      "AUTH0_SECRET",
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]);
  });

  test("marks production runtime ready when all required values are configured", () => {
    const result = assessProductionRuntimeEnv(validRuntimeEnv);

    expect(result.ready).toBe(true);
    expect(result.blockedKeys).toEqual([]);
    expect(result.checks.filter((check) => check.required)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "DATABASE_URL", status: "configured" }),
        expect.objectContaining({ key: "GITHUB_APP_PRIVATE_KEY", status: "configured" }),
      ]),
    );
  });

  test("reports missing, placeholder, and invalid required values without echoing secrets", () => {
    const placeholderPassword = ["[", "YOUR", "-PASSWORD", "]"].join("");
    const result = assessProductionRuntimeEnv({
      ...validRuntimeEnv,
      APP_BASE_URL: "http://cortex.internal",
      AUTH0_CLIENT_SECRET: "<auth0-client-secret-placeholder>",
      AUTH0_DOMAIN: "https://tenant.auth0.com/path",
      AUTH0_SECRET: "not-a-64-byte-hex-session-secret",
      DATABASE_URL: [
        "postgresql",
        `://db-user:${placeholderPassword}@db.cortex.internal:5432/postgres`,
      ].join(""),
      GITHUB_APP_ID: "not-numeric",
      GITHUB_APP_PRIVATE_KEY: "runtime-secret-without-pem-markers",
      GITHUB_WEBHOOK_SECRET: undefined,
      WEB_BASE_URL: "http://cortex.internal",
    });
    const serialized = serializeReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.blockedKeys).toEqual([
      "WEB_BASE_URL",
      "APP_BASE_URL",
      "AUTH0_DOMAIN",
      "AUTH0_CLIENT_SECRET",
      "AUTH0_SECRET",
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "APP_BASE_URL", status: "invalid" }),
        expect.objectContaining({ key: "AUTH0_CLIENT_SECRET", status: "placeholder" }),
        expect.objectContaining({ key: "AUTH0_DOMAIN", status: "invalid" }),
        expect.objectContaining({ key: "AUTH0_SECRET", status: "invalid" }),
        expect.objectContaining({ key: "DATABASE_URL", status: "placeholder" }),
        expect.objectContaining({ key: "GITHUB_APP_ID", status: "invalid" }),
        expect.objectContaining({ key: "GITHUB_APP_PRIVATE_KEY", status: "invalid" }),
        expect.objectContaining({ key: "GITHUB_WEBHOOK_SECRET", status: "missing" }),
        expect.objectContaining({ key: "WEB_BASE_URL", status: "invalid" }),
      ]),
    );
    expect(serialized).not.toContain("runtime-secret-without-pem-markers");
    expect(serialized).not.toContain(["postgresql", "://db-user:"].join(""));
    expect(serialized).not.toContain(placeholderPassword);
  });

  test("keeps optional Linear OAuth sealing variables outside the production blocker set", () => {
    const result = assessProductionRuntimeEnv(validRuntimeEnv);

    expect(result.ready).toBe(true);
    expect(
      result.checks.filter((check) => check.group === "linear").map((check) => check.status),
    ).toEqual(["missing", "missing"]);
  });
});
