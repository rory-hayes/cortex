import { describe, expect, test } from "vitest";

import {
  formatVercelProductionEnvReadiness,
  runVercelProductionEnvCheck,
  runVercelProductionEnvReadiness,
} from "./check-vercel-production-env.js";

const realishDatabaseUrl = [
  "postgresql",
  "://db-user:runtime-db-password@db.cortex.internal:5432/postgres",
].join("");

const realishPrivateKey = [
  "-----BEGIN ",
  "PRIVATE KEY-----\\nabc123abc123abc123\\n-----END ",
  "PRIVATE KEY-----",
].join("");

describe("Vercel production environment readiness check", () => {
  test("reports configured and missing production runtime variable names without values", async () => {
    const result = await runVercelProductionEnvReadiness({
      execVercelEnvList: async () =>
        JSON.stringify([
          {
            key: "WEB_BASE_URL",
            target: ["production"],
            type: "encrypted",
            value: "https://cortex.internal",
          },
          {
            key: "APP_BASE_URL",
            target: ["production"],
            type: "encrypted",
            value: "https://cortex.internal",
          },
          {
            key: "AUTH0_DOMAIN",
            target: ["production"],
            type: "encrypted",
            value: "tenant.auth0.com",
          },
          {
            key: "AUTH0_SECRET",
            target: ["production"],
            type: "encrypted",
            value: "c".repeat(64),
          },
          {
            key: "DATABASE_URL",
            target: ["preview"],
            type: "encrypted",
            value: realishDatabaseUrl,
          },
          {
            key: "GITHUB_APP_PRIVATE_KEY",
            target: ["production"],
            type: "encrypted",
            value: realishPrivateKey,
          },
        ]),
    });
    const output = formatVercelProductionEnvReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.configuredRequiredKeys).toEqual([
      "WEB_BASE_URL",
      "APP_BASE_URL",
      "AUTH0_DOMAIN",
      "AUTH0_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
    ]);
    expect(result.missingRequiredKeys).toEqual([
      "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET",
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_WEBHOOK_SECRET",
    ]);
    expect(output).toContain("Vercel production env readiness: blocked");
    expect(output).toContain("[configured] WEB_BASE_URL");
    expect(output).toContain("[missing] DATABASE_URL");
    expect(output).not.toContain("https://cortex.internal");
    expect(output).not.toContain(realishDatabaseUrl);
    expect(output).not.toContain(realishPrivateKey);
  });

  test("prints JSON readiness without raw Vercel env values", async () => {
    let output = "";
    const exitCode = await runVercelProductionEnvCheck(["--json"], {
      execVercelEnvList: async () =>
        JSON.stringify({
          envs: [
            { key: "WEB_BASE_URL", target: "production", value: "https://cortex.internal" },
            { key: "APP_BASE_URL", target: "production", value: "https://cortex.internal" },
            { key: "AUTH0_DOMAIN", target: "production", value: "tenant.auth0.com" },
            { key: "AUTH0_CLIENT_ID", target: "production", value: "auth0-client-id" },
            {
              key: "AUTH0_CLIENT_SECRET",
              target: "production",
              value: "auth0-client-secret",
            },
            { key: "AUTH0_SECRET", target: "production", value: "d".repeat(64) },
            { key: "DATABASE_URL", target: "production", value: realishDatabaseUrl },
            { key: "GITHUB_APP_ID", target: "production", value: "123456" },
            { key: "GITHUB_APP_PRIVATE_KEY", target: "production", value: realishPrivateKey },
            { key: "GITHUB_WEBHOOK_SECRET", target: "production", value: "webhook-secret" },
          ],
        }),
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      configuredRequiredKeys: string[];
      missingRequiredKeys: string[];
      ready: boolean;
    };

    expect(exitCode).toBe(0);
    expect(payload.ready).toBe(true);
    expect(payload.missingRequiredKeys).toEqual([]);
    expect(payload.configuredRequiredKeys).toEqual([
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
    expect(output).not.toContain(realishDatabaseUrl);
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain("auth0-client-secret");
  });

  test("fails closed without printing raw CLI output when Vercel env list cannot be parsed", async () => {
    const result = await runVercelProductionEnvReadiness({
      execVercelEnvList: async () => `not json with ${realishDatabaseUrl}`,
    });
    const output = formatVercelProductionEnvReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.missingRequiredKeys).toEqual([
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
    expect(output).toContain("Vercel production env readiness: blocked");
    expect(output).toContain("Vercel production environment names could not be read.");
    expect(output).not.toContain("not json");
    expect(output).not.toContain(realishDatabaseUrl);
  });

  test("fails closed without printing raw CLI errors when Vercel env list throws", async () => {
    const result = await runVercelProductionEnvReadiness({
      execVercelEnvList: async () => {
        throw new Error(`Vercel CLI failed with ${realishDatabaseUrl}`);
      },
    });
    const output = formatVercelProductionEnvReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.configuredRequiredKeys).toEqual([]);
    expect(result.missingRequiredKeys).toEqual([
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
    expect(output).toContain("Vercel production env readiness: blocked");
    expect(output).toContain("Vercel production environment names could not be read.");
    expect(output).not.toContain("Vercel CLI failed");
    expect(output).not.toContain(realishDatabaseUrl);
  });
});
