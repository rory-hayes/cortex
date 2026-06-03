import { describe, expect, test } from "vitest";

import {
  formatSupabaseDatabaseReadiness,
  runSupabaseDatabaseCheck,
  runSupabaseDatabaseReadiness,
} from "./check-supabase-db.js";

const validDatabaseUrl = [
  "postgresql",
  "://postgres:runtime-db-password@db.project-ref.supabase.co:5432/postgres",
].join("");

const placeholderDatabaseUrl = [
  "postgresql",
  "://postgres:",
  "[",
  "YOUR",
  "-PASSWORD",
  "]",
  "@db.project-ref.supabase.co:5432/postgres",
].join("");

describe("Supabase direct database readiness check", () => {
  test("blocks when DATABASE_URL is missing without printing secrets", async () => {
    const result = await runSupabaseDatabaseReadiness({
      env: {},
      execPsql: async () => ({ stderr: "", stdout: "1\n" }),
    });
    const output = formatSupabaseDatabaseReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual([
      {
        message: "DATABASE_URL is required before direct database verification can run.",
        name: "database_url",
        status: "blocked",
      },
    ]);
    expect(output).toContain("Supabase database readiness: blocked");
    expect(output).toContain("Database URL: missing");
    expect(output).not.toContain("postgres");
  });

  test("blocks placeholder DATABASE_URL values without printing the URL", async () => {
    const result = await runSupabaseDatabaseReadiness({
      env: {
        DATABASE_URL: placeholderDatabaseUrl,
      },
      execPsql: async () => ({ stderr: "", stdout: "1\n" }),
    });
    const output = formatSupabaseDatabaseReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.databaseUrl).toBe("configured");
    expect(output).toContain("[blocked] database_url");
    expect(output).toContain("DATABASE_URL must contain the real database password.");
    expect(output).not.toContain(placeholderDatabaseUrl);
    expect(output).not.toContain("project-ref");
    expect(output).not.toContain("YOUR-PASSWORD");
  });

  test("verifies direct connectivity with psql without passing the URL in argv", async () => {
    const calls: Array<{
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }> = [];
    const result = await runSupabaseDatabaseReadiness({
      env: {
        DATABASE_URL: validDatabaseUrl,
      },
      execPsql: async (args, env) => {
        calls.push({ args, env });
        return { stderr: "NOTICE: ignored", stdout: "1\n" };
      },
    });
    const output = formatSupabaseDatabaseReadiness(result);

    expect(result.ready).toBe(true);
    expect(result.checks).toEqual([
      {
        message: "DATABASE_URL is present and uses a Postgres connection string.",
        name: "database_url",
        status: "passed",
      },
      {
        message: "Direct database query completed successfully.",
        name: "psql_connectivity",
        status: "passed",
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.join(" ")).not.toContain(validDatabaseUrl);
    expect(calls[0]?.args).toContain("--no-psqlrc");
    expect(calls[0]?.env.PGPASSWORD).toBe("runtime-db-password");
    expect(calls[0]?.env.PGSSLMODE).toBe("require");
    expect(output).toContain("Supabase database readiness: ready");
    expect(output).not.toContain(validDatabaseUrl);
    expect(output).not.toContain("runtime-db-password");
    expect(output).not.toContain("project-ref");
    expect(output).not.toContain("NOTICE");
  });

  test("fails closed without printing raw psql errors or output", async () => {
    const result = await runSupabaseDatabaseReadiness({
      env: {
        DATABASE_URL: validDatabaseUrl,
      },
      execPsql: async () => {
        throw new Error(`psql failed for ${validDatabaseUrl}`);
      },
    });
    const output = formatSupabaseDatabaseReadiness(result);

    expect(result.ready).toBe(false);
    expect(output).toContain("[blocked] psql_connectivity");
    expect(output).toContain("Direct database query could not be completed.");
    expect(output).not.toContain(validDatabaseUrl);
    expect(output).not.toContain("runtime-db-password");
    expect(output).not.toContain("project-ref");
    expect(output).not.toContain("psql failed");
  });

  test("prints JSON readiness without raw database credentials", async () => {
    let output = "";
    const exitCode = await runSupabaseDatabaseCheck(["--json"], {
      env: {
        DATABASE_URL: validDatabaseUrl,
      },
      execPsql: async () => ({ stderr: "", stdout: "1\n" }),
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      databaseUrl: string;
      ready: boolean;
    };

    expect(exitCode).toBe(0);
    expect(payload.ready).toBe(true);
    expect(payload.databaseUrl).toBe("configured");
    expect(output).not.toContain(validDatabaseUrl);
    expect(output).not.toContain("runtime-db-password");
    expect(output).not.toContain("project-ref");
  });
});
