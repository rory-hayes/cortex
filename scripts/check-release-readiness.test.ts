import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  formatReleaseReadinessResult,
  parseReleaseReadinessArgs,
  runReleaseReadinessCheck,
} from "./check-release-readiness.js";

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "cortex-release-readiness-"));
  tempRoots.push(root);
  return root;
};

const writeMigration = async (root: string, filename: string): Promise<void> => {
  const migrationsDir = join(root, "packages", "db", "migrations");
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(join(migrationsDir, filename), "-- migration\n");
};

const createResponse = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(body, { headers, status });

const validEnv = {
  APP_BASE_URL: "https://cortex.internal",
  AUTH0_CLIENT_ID: ["auth0", "client", "runtime"].join("-"),
  AUTH0_CLIENT_SECRET: ["auth0", "client", "runtime", "secret"].join("-"),
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_SECRET: "e".repeat(64),
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
  SUPABASE_URL: "https://project-ref.supabase.co",
  WEB_BASE_URL: "https://cortex.internal",
} as const;

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("release readiness check command", () => {
  test("parses supported arguments", () => {
    expect(parseReleaseReadinessArgs([])).toEqual({
      appUrl: undefined,
      help: false,
      json: false,
      supabaseUrl: undefined,
    });
    expect(parseReleaseReadinessArgs(["--json"])).toEqual({
      appUrl: undefined,
      help: false,
      json: true,
      supabaseUrl: undefined,
    });
    expect(
      parseReleaseReadinessArgs([
        "--app-url",
        "https://cortex.internal",
        "--supabase-url",
        "https://project-ref.supabase.co",
      ]),
    ).toEqual({
      appUrl: "https://cortex.internal",
      help: false,
      json: false,
      supabaseUrl: "https://project-ref.supabase.co",
    });
    expect(parseReleaseReadinessArgs(["--help"])).toEqual({
      appUrl: undefined,
      help: true,
      json: false,
      supabaseUrl: undefined,
    });
    expect(() => parseReleaseReadinessArgs(["--app-url"])).toThrow(/requires a value/);
    expect(() => parseReleaseReadinessArgs(["--verbose"])).toThrow(/Unknown argument/);
  });

  test("passes all release gates with safe text output", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    await writeMigration(root, "0001_queue.sql");
    await mkdir(join(root, "supabase", ".temp"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), 'project_id = "cortex"\n');
    await writeFile(join(root, "supabase", ".temp", "project-ref"), "project-ref-secret\n");

    let output = "";
    const exitCode = await runReleaseReadinessCheck([], {
      env: validEnv,
      execPsql: async () => ({ stderr: "", stdout: "1\n" }),
      execSupabaseMigrations: async () => `
         Local | Remote | Time (UTC)
        -------|--------|------------
               | 0000   | 0000
               | 0001   | 0001
      `,
      fetch: (async (url) => {
        const requestUrl = String(url);

        if (requestUrl.endsWith("/dashboard")) {
          return createResponse(302);
        }

        if (requestUrl.endsWith("/sign-up")) {
          return createResponse(307, "", {
            location: "/auth/login?screen_hint=signup&returnTo=%2Fdashboard",
          });
        }

        if (requestUrl.endsWith("/auth/v1/health")) {
          return createResponse(200, "auth body");
        }

        if (requestUrl.endsWith("/rest/v1/")) {
          return createResponse(401, "rest body");
        }

        return createResponse(200, "<html>Cortex</html>", {
          "content-type": "text/html",
        });
      }) satisfies typeof fetch,
      root,
      stdout: (message) => {
        output += message;
      },
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("Release readiness: ready");
    expect(output).toContain("[ready] production_runtime");
    expect(output).toContain("[ready] production_smoke");
    expect(output).toContain("[ready] supabase_link");
    expect(output).toContain("[ready] supabase_migrations");
    expect(output).toContain("[ready] supabase_database");
    expect(output).toContain("[ready] supabase_smoke");
    expect(output).toContain(
      "[warning] LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY - LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY is optional and not configured.",
    );
    expect(output).not.toContain(validEnv.DATABASE_URL);
    expect(output).not.toContain(validEnv.AUTH0_CLIENT_SECRET);
    expect(output).not.toContain(validEnv.AUTH0_SECRET);
    expect(output).not.toContain(validEnv.GITHUB_APP_PRIVATE_KEY);
    expect(output).not.toContain("project-ref");
    expect(output).not.toContain("supabase.co");
  });

  test("blocks when required runtime values, app URL, and Supabase link are missing", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    await writeMigration(root, "0001_queue.sql");
    await mkdir(join(root, "supabase"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), 'project_id = "cortex"\n');

    const placeholderPassword = ["[", "YOUR", "-PASSWORD", "]"].join("");
    let output = "";
    const exitCode = await runReleaseReadinessCheck([], {
      env: {
        ...validEnv,
        AUTH0_CLIENT_SECRET: "",
        AUTH0_SECRET: "",
        DATABASE_URL: [
          "postgresql",
          `://db-user:${placeholderPassword}@db.cortex.internal:5432/postgres`,
        ].join(""),
        GITHUB_APP_PRIVATE_KEY: "",
        SUPABASE_URL: undefined,
        WEB_BASE_URL: undefined,
      },
      execPsql: async () => ({ stderr: "", stdout: "1\n" }),
      execSupabaseMigrations: async () => `
         Local | Remote | Time (UTC)
        -------|--------|------------
               | 0000   | 0000
      `,
      root,
      stdout: (message) => {
        output += message;
      },
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("Release readiness: blocked");
    expect(output).toContain("[blocked] production_runtime");
    expect(output).toContain("[blocked] production_smoke");
    expect(output).toContain("[blocked] supabase_link");
    expect(output).toContain("[blocked] supabase_migrations");
    expect(output).toContain("[blocked] supabase_database");
    expect(output).toContain("[blocked] supabase_smoke");
    expect(output).toContain("DATABASE_URL");
    expect(output).not.toContain(placeholderPassword);
    expect(output).not.toContain(["postgresql", "://db-user:"].join(""));
  });

  test("prints JSON status without raw credentials, URLs, or refs", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    await mkdir(join(root, "supabase", ".temp"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), 'project_id = "cortex"\n');
    await writeFile(join(root, "supabase", ".temp", "project-ref"), "project-ref-secret\n");

    let output = "";
    const exitCode = await runReleaseReadinessCheck(["--json"], {
      env: validEnv,
      execPsql: async () => ({ stderr: "", stdout: "1\n" }),
      execSupabaseMigrations: async () => `
         Local | Remote | Time (UTC)
        -------|--------|------------
               | 0000   | 0000
      `,
      fetch: (async (url) => {
        const requestUrl = String(url);

        if (requestUrl.endsWith("/dashboard")) {
          return createResponse(302);
        }

        if (requestUrl.endsWith("/sign-up")) {
          return createResponse(307, "", {
            location: "/auth/login?screen_hint=signup&returnTo=%2Fdashboard",
          });
        }

        if (requestUrl.endsWith("/auth/v1/health")) {
          return createResponse(200);
        }

        if (requestUrl.endsWith("/rest/v1/")) {
          return createResponse(401);
        }

        return createResponse(200, "<html>Cortex</html>", {
          "content-type": "text/html",
        });
      }) satisfies typeof fetch,
      root,
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      ready: boolean;
      sections: Array<{ name: string; ready: boolean }>;
    };

    expect(exitCode).toBe(0);
    expect(payload.ready).toBe(true);
    expect(payload.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "production_runtime", ready: true }),
        expect.objectContaining({ name: "production_smoke", ready: true }),
        expect.objectContaining({ name: "supabase_link", ready: true }),
        expect.objectContaining({ name: "supabase_migrations", ready: true }),
        expect.objectContaining({ name: "supabase_database", ready: true }),
        expect.objectContaining({ name: "supabase_smoke", ready: true }),
      ]),
    );
    expect(output).not.toContain(validEnv.DATABASE_URL);
    expect(output).not.toContain(validEnv.GITHUB_APP_PRIVATE_KEY);
    expect(output).not.toContain("project-ref");
    expect(output).not.toContain("supabase.co");
  });

  test("formats release readiness without embedding response bodies", () => {
    const output = formatReleaseReadinessResult({
      ready: true,
      sections: [
        {
          checks: [
            {
              message: "Public route is reachable.",
              name: "public_route",
              status: "passed",
              statusCode: 200,
            },
          ],
          name: "production_smoke",
          ready: true,
        },
      ],
    });

    expect(output).toContain("Release readiness: ready");
    expect(output).not.toContain("<html>");
  });
});
