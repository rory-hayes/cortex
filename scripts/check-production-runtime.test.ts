import { describe, expect, test } from "vitest";

import {
  formatProductionRuntimeReadiness,
  parseProductionRuntimeCheckArgs,
  runProductionRuntimeCheck,
} from "./check-production-runtime.js";

const validEnv = {
  APP_BASE_URL: "https://cortex.internal",
  AUTH0_CLIENT_ID: ["auth0", "client", "runtime"].join("-"),
  AUTH0_CLIENT_SECRET: ["auth0", "client", "runtime", "secret"].join("-"),
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_SECRET: "b".repeat(64),
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
  GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
  WEB_BASE_URL: "https://cortex.internal",
} as const;

describe("production runtime check command", () => {
  test("parses supported arguments", () => {
    expect(parseProductionRuntimeCheckArgs([])).toEqual({ help: false, json: false });
    expect(parseProductionRuntimeCheckArgs(["--json"])).toEqual({ help: false, json: true });
    expect(parseProductionRuntimeCheckArgs(["--help"])).toEqual({ help: true, json: false });
    expect(() => parseProductionRuntimeCheckArgs(["--verbose"])).toThrow(/Unknown argument/);
  });

  test("returns success with safe text output when required values are configured", () => {
    let output = "";
    const exitCode = runProductionRuntimeCheck([], {
      env: validEnv,
      stdout: (message: string) => {
        output += message;
      },
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("Production runtime readiness: ready");
    expect(output).toContain("[configured] database/DATABASE_URL");
    expect(output).not.toContain(validEnv.DATABASE_URL);
    expect(output).not.toContain(validEnv.AUTH0_CLIENT_SECRET);
    expect(output).not.toContain(validEnv.AUTH0_SECRET);
    expect(output).not.toContain(validEnv.GITHUB_APP_PRIVATE_KEY);
  });

  test("returns blocked with safe text output when required values are missing or placeholders", () => {
    const placeholderPassword = ["[", "YOUR", "-PASSWORD", "]"].join("");
    let output = "";
    const exitCode = runProductionRuntimeCheck([], {
      env: {
        ...validEnv,
        AUTH0_CLIENT_SECRET: "<auth0-client-secret-placeholder>",
        AUTH0_SECRET: "not-a-64-character-hex-session-secret",
        DATABASE_URL: [
          "postgresql",
          `://db-user:${placeholderPassword}@db.cortex.internal:5432/postgres`,
        ].join(""),
        GITHUB_WEBHOOK_SECRET: undefined,
      },
      stdout: (message: string) => {
        output += message;
      },
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("Production runtime readiness: blocked");
    expect(output).toContain("AUTH0_CLIENT_SECRET");
    expect(output).toContain("AUTH0_SECRET");
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain("GITHUB_WEBHOOK_SECRET");
    expect(output).not.toContain(placeholderPassword);
    expect(output).not.toContain(["postgresql", "://db-user:"].join(""));
  });

  test("returns JSON output without raw environment values", () => {
    let output = "";
    const exitCode = runProductionRuntimeCheck(["--json"], {
      env: validEnv,
      stdout: (message: string) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      blockedKeys: string[];
      checks: Array<{ key: string; status: string }>;
      ready: boolean;
    };

    expect(exitCode).toBe(0);
    expect(payload.ready).toBe(true);
    expect(payload.blockedKeys).toEqual([]);
    expect(payload.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "DATABASE_URL" })]),
    );
    expect(output).not.toContain(validEnv.DATABASE_URL);
    expect(output).not.toContain(validEnv.GITHUB_APP_PRIVATE_KEY);
  });

  test("formats readiness without leaking values from an assessed environment", () => {
    const output = formatProductionRuntimeReadiness({
      blockedKeys: ["DATABASE_URL"],
      checks: [
        {
          description: "Database",
          group: "database",
          key: "DATABASE_URL",
          message: "DATABASE_URL must be a valid Postgres connection URL.",
          required: true,
          status: "invalid",
        },
      ],
      ready: false,
    });

    expect(output).toContain("Blocked keys: DATABASE_URL");
    expect(output).not.toContain(["postgresql", "://"].join(""));
  });
});
