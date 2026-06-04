import { describe, expect, test } from "vitest";

import {
  applyVercelProductionEnv,
  formatApplyVercelProductionEnvResult,
  parseApplyVercelProductionEnvArgs,
  runApplyVercelProductionEnvCommand,
} from "./apply-vercel-production-env.js";

const realishDatabaseUrl = [
  "postgresql",
  "://db-user:runtime-db-password@db.cortex.internal:5432/postgres",
].join("");

const realishPrivateKey = [
  "-----BEGIN ",
  "PRIVATE KEY-----\\nabc123abc123abc123\\n-----END ",
  "PRIVATE KEY-----",
].join("");

const validEnv = {
  APP_BASE_URL: "https://cortex.internal",
  AUTH0_CLIENT_ID: ["auth0", "client", "runtime"].join("-"),
  AUTH0_CLIENT_SECRET: ["auth0", "client", "runtime", "secret"].join("-"),
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_SECRET: "e".repeat(64),
  DATABASE_URL: realishDatabaseUrl,
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: realishPrivateKey,
  GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
  WEB_BASE_URL: "https://cortex.internal",
} as const;

const makeVercelEnvList = (keys: readonly string[]): string =>
  JSON.stringify(keys.map((key) => ({ key, target: ["production"] })));

describe("Vercel production env apply command", () => {
  test("parses supported arguments", () => {
    expect(parseApplyVercelProductionEnvArgs([])).toEqual({
      allRequired: false,
      dryRun: false,
      help: false,
      json: false,
    });
    expect(parseApplyVercelProductionEnvArgs(["--dry-run", "--json"])).toEqual({
      allRequired: false,
      dryRun: true,
      help: false,
      json: true,
    });
    expect(parseApplyVercelProductionEnvArgs(["--all-required"])).toEqual({
      allRequired: true,
      dryRun: false,
      help: false,
      json: false,
    });
    expect(parseApplyVercelProductionEnvArgs(["--help"])).toEqual({
      allRequired: false,
      dryRun: false,
      help: true,
      json: false,
    });
    expect(() => parseApplyVercelProductionEnvArgs(["--environment", "production"])).toThrow(
      /Unknown argument/,
    );
  });

  test("dry-runs only required keys missing from Vercel production without printing values", async () => {
    const result = await applyVercelProductionEnv(
      { allRequired: false, dryRun: true, help: false, json: false },
      {
        env: validEnv,
        execVercelEnvList: async () =>
          makeVercelEnvList([
            "WEB_BASE_URL",
            "APP_BASE_URL",
            "AUTH0_DOMAIN",
            "AUTH0_CLIENT_ID",
            "AUTH0_CLIENT_SECRET",
            "AUTH0_SECRET",
          ]),
      },
    );
    const output = formatApplyVercelProductionEnvResult(result);

    expect(result.ready).toBe(true);
    expect(result.targetKeys).toEqual([
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]);
    expect(output).toContain("[would_apply] DATABASE_URL");
    expect(output).toContain("[would_apply] GITHUB_APP_PRIVATE_KEY");
    expect(output).not.toContain(realishDatabaseUrl);
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain("github-webhook-secret");
  });

  test("blocks before writing when a required shell value is missing or placeholder-like", async () => {
    const result = await applyVercelProductionEnv(
      { allRequired: false, dryRun: false, help: false, json: false },
      {
        env: {
          ...validEnv,
          DATABASE_URL: [
            "postgresql",
            "://db-user:<remote-db-password-placeholder>@db.cortex.internal:5432/postgres",
          ].join(""),
          GITHUB_APP_PRIVATE_KEY: "",
        },
        execVercelEnvAdd: async () => {
          throw new Error("should not be called");
        },
        execVercelEnvList: async () => makeVercelEnvList(["WEB_BASE_URL"]),
      },
    );
    const output = formatApplyVercelProductionEnvResult(result);

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "DATABASE_URL", status: "blocked" }),
        expect.objectContaining({ key: "GITHUB_APP_PRIVATE_KEY", status: "blocked" }),
      ]),
    );
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(output).not.toContain("<remote-db-password-placeholder>");
    expect(output).not.toContain("postgresql://db-user");
  });

  test("applies validated missing values through injected Vercel calls without outputting values", async () => {
    const calls: Array<{ key: string; sensitive: boolean; value: string }> = [];
    let output = "";
    const exitCode = await runApplyVercelProductionEnvCommand(["--json"], {
      env: validEnv,
      execVercelEnvAdd: async (input) => {
        calls.push(input);
      },
      execVercelEnvList: async () =>
        makeVercelEnvList([
          "WEB_BASE_URL",
          "APP_BASE_URL",
          "AUTH0_DOMAIN",
          "AUTH0_CLIENT_ID",
          "AUTH0_CLIENT_SECRET",
          "AUTH0_SECRET",
        ]),
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      ready: boolean;
      targetKeys: string[];
    };

    expect(exitCode).toBe(0);
    expect(payload.ready).toBe(true);
    expect(payload.targetKeys).toEqual([
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]);
    expect(calls.map((call) => call.key)).toEqual(payload.targetKeys);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "DATABASE_URL", sensitive: true }),
        expect.objectContaining({ key: "GITHUB_APP_ID", sensitive: false }),
        expect.objectContaining({ key: "GITHUB_APP_PRIVATE_KEY", sensitive: true }),
        expect.objectContaining({ key: "GITHUB_WEBHOOK_SECRET", sensitive: true }),
      ]),
    );
    expect(output).not.toContain(realishDatabaseUrl);
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain("github-webhook-secret");
  });

  test("does nothing when all required Vercel production names are already configured", async () => {
    const result = await applyVercelProductionEnv(
      { allRequired: false, dryRun: false, help: false, json: false },
      {
        env: validEnv,
        execVercelEnvAdd: async () => {
          throw new Error("should not be called");
        },
        execVercelEnvList: async () => makeVercelEnvList(Object.keys(validEnv)),
      },
    );
    const output = formatApplyVercelProductionEnvResult(result);

    expect(result.ready).toBe(true);
    expect(result.targetKeys).toEqual([]);
    expect(output).toContain("No required Vercel production variables need applying.");
  });
});
