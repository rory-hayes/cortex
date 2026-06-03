import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  formatSupabaseLinkReadiness,
  runSupabaseLinkCheck,
  runSupabaseLinkReadiness,
} from "./check-supabase-link.js";

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "cortex-supabase-link-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("Supabase link check command", () => {
  test("reports blocked when local Supabase config is missing", async () => {
    const root = await makeTempRoot();
    const result = await runSupabaseLinkReadiness({ root });

    expect(result.ready).toBe(false);
    expect(result.config).toBe("missing");
    expect(result.projectRef).toBe("missing");
    expect(result.checks).toEqual([
      expect.objectContaining({
        message: "supabase/config.toml is missing. Run supabase init first.",
        name: "local_config",
        status: "blocked",
      }),
    ]);
  });

  test("reports initialized but unlinked without printing project refs", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "supabase"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), 'project_id = "cortex"\n');

    const result = await runSupabaseLinkReadiness({ root });
    const output = formatSupabaseLinkReadiness(result);

    expect(result.ready).toBe(false);
    expect(result.config).toBe("configured");
    expect(result.projectRef).toBe("missing");
    expect(output).toContain("Supabase link readiness: blocked");
    expect(output).toContain("Local config: configured");
    expect(output).toContain("Project ref: missing");
    expect(output).toContain("supabase link --project-ref <project-ref>");
    expect(output).not.toContain("cortex");
  });

  test("reports linked state without leaking the stored project ref", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "supabase", ".temp"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), 'project_id = "cortex"\n');
    await writeFile(join(root, "supabase", ".temp", "project-ref"), "project-ref-secret\n");

    let output = "";
    const exitCode = await runSupabaseLinkCheck([], {
      root,
      stdout: (message) => {
        output += message;
      },
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("Supabase link readiness: ready");
    expect(output).toContain("Project ref: configured");
    expect(output).not.toContain("project-ref-secret");
  });

  test("prints JSON status without raw refs or local paths", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "supabase", ".temp"), { recursive: true });
    await writeFile(join(root, "supabase", "config.toml"), 'project_id = "cortex"\n');
    await writeFile(join(root, "supabase", ".temp", "project-ref"), "project-ref-secret\n");

    let output = "";
    const exitCode = await runSupabaseLinkCheck(["--json"], {
      root,
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      config: string;
      projectRef: string;
      ready: boolean;
    };

    expect(exitCode).toBe(0);
    expect(payload).toEqual({
      config: "configured",
      projectRef: "configured",
      ready: true,
    });
    expect(output).not.toContain(root);
    expect(output).not.toContain("project-ref-secret");
  });
});
