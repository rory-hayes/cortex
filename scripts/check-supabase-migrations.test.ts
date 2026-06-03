import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  formatSupabaseMigrationReadiness,
  runSupabaseMigrationCheck,
  runSupabaseMigrationReadiness,
} from "./check-supabase-migrations.js";

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "cortex-supabase-migrations-"));
  tempRoots.push(root);
  return root;
};

const writeMigration = async (root: string, filename: string): Promise<void> => {
  const migrationsDir = join(root, "packages", "db", "migrations");
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(join(migrationsDir, filename), "-- migration\n");
};

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("Supabase migration readiness check", () => {
  test("reports ready when linked remote history includes every canonical local migration", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    await writeMigration(root, "0001_queue.sql");

    const result = await runSupabaseMigrationReadiness({
      execSupabase: async () => `
         Local | Remote | Time (UTC)
        -------|--------|------------
               | 0000   | 0000
               | 0001   | 0001
      `,
      root,
    });
    const output = formatSupabaseMigrationReadiness(result);

    expect(result.ready).toBe(true);
    expect(result.local.latest).toBe("0001");
    expect(result.remote.latest).toBe("0001");
    expect(result.missingRemoteVersions).toEqual([]);
    expect(output).toContain("Supabase migration readiness: ready");
    expect(output).toContain("[passed] remote_history");
  });

  test("blocks when linked remote history is missing the latest canonical local migration", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    await writeMigration(root, "0001_queue.sql");
    await writeMigration(root, "0002_links.sql");

    const result = await runSupabaseMigrationReadiness({
      execSupabase: async () => `
         Local | Remote | Time (UTC)
        -------|--------|------------
               | 0000   | 0000
               | 0001   | 0001
      `,
      root,
    });
    const output = formatSupabaseMigrationReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.local.latest).toBe("0002");
    expect(result.remote.latest).toBe("0001");
    expect(result.missingRemoteVersions).toEqual(["0002"]);
    expect(output).toContain("Supabase migration readiness: blocked");
    expect(output).toContain("Latest local: 0002");
    expect(output).toContain("Latest remote: 0001");
    expect(output).toContain("[blocked] remote_history");
  });

  test("returns safe blocked output when the remote history command fails", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    const secretUrl = ["postgresql://", "postgres", ":secret@", "db.example.test/postgres"].join(
      "",
    );

    const result = await runSupabaseMigrationReadiness({
      execSupabase: async () => {
        throw new Error(`failed with ${secretUrl}`);
      },
      root,
    });
    const output = formatSupabaseMigrationReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.remote.available).toBe(false);
    expect(output).toContain("Linked remote migration history could not be read.");
    expect(output).not.toContain(secretUrl);
    expect(output).not.toContain("secret@");
  });

  test("prints JSON without raw command output or local paths", async () => {
    const root = await makeTempRoot();
    await writeMigration(root, "0000_core.sql");
    await writeMigration(root, "0001_queue.sql");

    let output = "";
    const exitCode = await runSupabaseMigrationCheck(["--json"], {
      execSupabase: async () => `
         Local | Remote | Time (UTC)
        -------|--------|------------
               | 0000   | 0000
      `,
      root,
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      local: { latest: string };
      missingRemoteVersions: string[];
      ready: boolean;
      remote: { latest: string };
    };

    expect(exitCode).toBe(1);
    expect(payload.ready).toBe(false);
    expect(payload.local.latest).toBe("0001");
    expect(payload.remote.latest).toBe("0000");
    expect(payload.missingRemoteVersions).toEqual(["0001"]);
    expect(output).not.toContain(root);
    expect(output).not.toContain("Local | Remote");
  });
});
