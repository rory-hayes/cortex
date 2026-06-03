import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { RepoPolicySchema } from "@control-plane/shared";
import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../../src/index.js";
import { createFixtureRepo, type FixtureRepo } from "./create-fixture-repo.js";

const temporaryRoots: string[] = [];
const fixtures: FixtureRepo[] = [];

describe("createFixtureRepo", () => {
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
    await Promise.all(
      temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
    );
  });

  it("creates a clean main-branch git repo with policy and validation script", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "control-plane-fixture-test-"));
    temporaryRoots.push(rootPath);

    const fixture = await createFixtureRepo({ rootPath });
    fixtures.push(fixture);

    expect(fixture.rootPath).toBe(rootPath);
    expect(relative(rootPath, fixture.repoPath)).not.toBe("");
    expect(relative(rootPath, fixture.repoPath).startsWith("..")).toBe(false);
    expect(fixture.defaultBranch).toBe("main");
    expect(fixture.policyPath).toBe(join(fixture.repoPath, ".aicp", "policy.json"));
    expect(fixture.validationScriptPath).toBe(join(fixture.repoPath, "scripts", "validate.mjs"));
    expect(fixture.baseCommit).toMatch(/^[a-f0-9]{40}$/);

    await expectCommand(["git", "rev-parse", "--is-inside-work-tree"], fixture.repoPath, "true\n");
    await expectCommand(["git", "branch", "--show-current"], fixture.repoPath, "main\n");

    const policy = RepoPolicySchema.parse(
      JSON.parse(await readFile(fixture.policyPath, "utf8")) as unknown,
    );
    expect(policy.validationCommands).toContainEqual({
      id: "fixture-validate",
      label: "Fixture validation",
      command: "node scripts/validate.mjs",
      timeoutSeconds: 30,
      required: true,
    });

    await expectCommand(["node", "scripts/validate.mjs"], fixture.repoPath, "fixture valid\n");
    await expectCleanStatus(fixture.repoPath);
  });

  it("creates reusable independent repos across repeated calls", async () => {
    const first = await createFixtureRepo();
    const second = await createFixtureRepo();
    fixtures.push(first, second);

    expect(first.repoPath).not.toBe(second.repoPath);
    expect(first.rootPath).not.toBe(second.rootPath);

    await expectCleanStatus(first.repoPath);
    await expectCleanStatus(second.repoPath);
    await expectCommand(["git", "rev-list", "--count", "HEAD"], first.repoPath, "1\n");
    await expectCommand(["git", "rev-list", "--count", "HEAD"], second.repoPath, "1\n");
  });

  it("writes only tiny synthetic fixture files without env or credential-looking text", async () => {
    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    const files = await runCommand({
      command: "git",
      args: ["ls-files"],
      cwd: fixture.repoPath,
      throwOnNonZero: true,
    });
    const trackedFiles = files.stdoutSummary.trim().split("\n").sort();

    expect(trackedFiles).toEqual([
      ".aicp/policy.json",
      "README.md",
      "scripts/validate.mjs",
      "src/app.txt",
    ]);
    expect(trackedFiles.some((filePath) => filePath.split("/").includes(".env"))).toBe(false);
    expect(trackedFiles.some((filePath) => filePath.endsWith(".env"))).toBe(false);

    const combinedText = (
      await Promise.all(
        trackedFiles.map((filePath) => readFile(join(fixture.repoPath, filePath), "utf8")),
      )
    ).join("\n");

    expect(combinedText.length).toBeLessThan(4_000);
    expect(combinedText).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(combinedText).not.toMatch(/\b(?:api[_-]?key|token|secret|password)\b/i);
    expect(combinedText).not.toMatch(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]{12,}\b/);
    expect(combinedText).not.toMatch(/\b[A-Za-z0-9+/]{32,}={0,2}\b/);
  });
});

const expectCommand = async (
  command: readonly [string, ...string[]],
  cwd: string,
  expectedStdout: string,
): Promise<void> => {
  const [executable, ...args] = command;
  const result = await runCommand({
    command: executable,
    args,
    cwd,
    throwOnNonZero: true,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdoutSummary).toBe(expectedStdout);
  expect(result.stderrSummary).toBe("");
};

const expectCleanStatus = async (repoPath: string): Promise<void> => {
  await expectCommand(["git", "status", "--porcelain=v1"], repoPath, "");
};
