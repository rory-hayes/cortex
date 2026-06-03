import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CodexAdapter, CodexExecutionRequest } from "@control-plane/codex";
import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../../src/index.js";
import { createFixtureRepo, type FixtureRepo } from "../fixtures/create-fixture-repo.js";

type FixtureMockCodexModule = {
  FIXTURE_CODEX_CHANGED_PATH?: string;
  createFixtureMockCodexAdapter?: () => CodexAdapter;
};

const fixtures: FixtureRepo[] = [];

const REQUEST_PROMPT = [
  "PROMPT_SENTINEL",
  "Apply fixture behavior only.",
  "OPENAI_API_KEY=sk-test-prompt-sentinel",
].join("\n");

describe("createFixtureMockCodexAdapter", () => {
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  });

  it("applies one deterministic validation-safe fixture change without leaking local details", async () => {
    const codexMock = await getFixtureMockModule();
    expect(codexMock.FIXTURE_CODEX_CHANGED_PATH).toBe("src/app.txt");
    expect(codexMock.createFixtureMockCodexAdapter).toBeTypeOf("function");
    if (codexMock.createFixtureMockCodexAdapter === undefined) {
      throw new Error("Fixture Codex mock factory is missing.");
    }

    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    const request = createRequest(fixture.repoPath);
    const adapter = codexMock.createFixtureMockCodexAdapter();
    const result = await adapter.execute(request);

    expect(result).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      stdoutSummary: "Mock Codex applied 1 file change.",
      stderrSummary: "",
      redactionApplied: true,
    });

    await expect(readFile(join(fixture.repoPath, "src", "app.txt"), "utf8")).resolves.toBe(
      "fixture application\nmock codex fixture behavior applied\n",
    );

    const status = await runCommand({
      command: "git",
      args: ["status", "--porcelain=v1"],
      cwd: fixture.repoPath,
      throwOnNonZero: true,
    });
    expect(status.stdoutSummary).toBe(" M src/app.txt\n");
    expect(status.stderrSummary).toBe("");

    const validation = await runCommand({
      command: "node",
      args: ["scripts/validate.mjs"],
      cwd: fixture.repoPath,
      throwOnNonZero: true,
    });
    expect(validation.stdoutSummary).toBe("fixture valid\n");
    expect(validation.stderrSummary).toBe("");

    expect(Object.keys(result).sort()).toEqual(
      [
        "durationMs",
        "exitCode",
        "redactionApplied",
        "status",
        "stderrSummary",
        "stdoutSummary",
      ].sort(),
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(30_000);

    const changedContents = await readFile(join(fixture.repoPath, "src", "app.txt"), "utf8");
    const serializedResult = JSON.stringify(result);
    for (const unsafeFragment of [
      fixture.rootPath,
      fixture.repoPath,
      request.worktreePath,
      request.prompt,
      changedContents,
      "diff --git",
      "*** Begin Patch",
      "source",
      "OPENAI_API_KEY",
      "sk-test-prompt-sentinel",
    ]) {
      expect(serializedResult).not.toContain(unsafeFragment);
    }
  });
});

const getFixtureMockModule = async (): Promise<FixtureMockCodexModule> => {
  try {
    return (await import("./codex.js")) as FixtureMockCodexModule;
  } catch {
    return {};
  }
};

const createRequest = (worktreePath: string): CodexExecutionRequest => ({
  runId: "run_093",
  worktreePath,
  prompt: REQUEST_PROMPT,
  timeoutMs: 5_000,
});
