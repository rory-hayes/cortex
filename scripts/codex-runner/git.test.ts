import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildBranchName,
  createDraftPr,
  getChangedFiles,
  git,
  isGitClean,
  mergeBranchToMain,
  refreshBranchFromMain,
  runCommand,
} from "./git.js";

let tempRoots: string[] = [];

async function makeGitRepo() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-git-"));
  tempRoots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "runner@example.com"]);
  await git(root, ["config", "user.name", "Codex Runner"]);
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe("git helpers", () => {
  test("builds deterministic codex branch names", () => {
    expect(buildBranchName("TASK-002", "Add root script surface")).toBe(
      "codex/TASK-002-add-root-script-surface",
    );
  });

  test("detects clean and dirty repositories and changed file paths", async () => {
    const root = await makeGitRepo();

    expect(await isGitClean(root)).toBe(true);

    await writeFile(join(root, "README.md"), "# Changed\n");

    expect(await isGitClean(root)).toBe(false);
    expect(await getChangedFiles(root)).toEqual(["README.md"]);
  });

  test("expands untracked directories to individual changed files", async () => {
    const root = await makeGitRepo();
    await mkdir(join(root, "packages", "shared", "src"), { recursive: true });
    await writeFile(join(root, "packages", "shared", "src", "index.ts"), "export {};\n");
    await writeFile(
      join(root, "packages", "shared", "src", "version.test.ts"),
      "test.todo('v');\n",
    );

    expect(await getChangedFiles(root)).toEqual([
      "packages/shared/src/index.ts",
      "packages/shared/src/version.test.ts",
    ]);
  });

  test("creates safe draft PR artifacts through an injected gh adapter", async () => {
    const root = await makeGitRepo();
    const artifact = await createDraftPr(root, {
      branchName: "codex/TASK-001-lock-package-manager",
      title: "TASK-001: Lock package manager",
      body: "Task id: TASK-001\nChanged files:\n- package.json",
      gh: async (args) => {
        await writeFile(join(root, "gh-args.json"), JSON.stringify(args));
        return {
          stdout: "https://github.com/example/repo/pull/12\n",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    expect(artifact).toEqual({
      branchName: "codex/TASK-001-lock-package-manager",
      number: 12,
      url: "https://github.com/example/repo/pull/12",
      draft: true,
    });
    expect(await readFile(join(root, "gh-args.json"), "utf8")).toContain("--draft");
  });

  test("handles child processes that close stdin before prompt write completes", async () => {
    const root = await makeGitRepo();
    const result = await runCommand(
      root,
      "node",
      ["-e", "process.stdin.destroy(); process.exit(0)"],
      "large prompt".repeat(10_000),
    );

    expect(result.exitCode).toBe(0);
  });

  test("times out child processes instead of hanging indefinitely", async () => {
    const root = await makeGitRepo();
    const result = await runCommand(
      root,
      "node",
      ["-e", "setTimeout(() => {}, 10_000)"],
      undefined,
      50,
    );

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
  });

  test("terminates descendant processes when a command times out", async () => {
    const root = await makeGitRepo();
    const marker = join(root, "descendant-survived");
    const childScript = `
      setInterval(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 25);
      setTimeout(() => {}, 10000);
    `;
    const parentScript = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" });
      setTimeout(() => {}, 10000);
    `;
    const result = await runCommand(root, "node", ["-e", parentScript], undefined, 50);

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(result.exitCode).toBe(124);
    await rm(marker, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(access(marker)).rejects.toThrow();
  });

  test("terminates descendants spawned during timeout shutdown", async () => {
    const root = await makeGitRepo();
    const marker = join(root, "late-descendant-survived");
    const childScript = `
      setInterval(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 25);
      setTimeout(() => {}, 10000);
    `;
    const parentScript = `
      const { spawn } = require("node:child_process");
      process.on("SIGTERM", () => {
        spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" });
        setTimeout(() => process.exit(0), 25);
      });
      setTimeout(() => {}, 10000);
    `;
    const result = await runCommand(root, "node", ["-e", parentScript], undefined, 50);

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(result.exitCode).toBe(124);
    await rm(marker, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(access(marker)).rejects.toThrow();
  });

  test("fast-forwards main to a task branch and pushes the merge", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codex-runner-remote-"));
    tempRoots.push(parent);
    const remote = join(parent, "remote.git");
    const repo = join(parent, "repo");

    await runCommand(parent, "git", ["init", "--bare", remote]);
    await runCommand(parent, "git", ["clone", remote, repo]);
    await git(repo, ["config", "user.email", "runner@example.com"]);
    await git(repo, ["config", "user.name", "Codex Runner"]);
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "initial"]);
    await git(repo, ["branch", "-M", "main"]);
    await git(repo, ["push", "-u", "origin", "main"]);

    await git(repo, ["checkout", "-b", "codex/TASK-001-first-task"]);
    await writeFile(join(repo, "TASK.md"), "done\n");
    await git(repo, ["add", "TASK.md"]);
    await git(repo, ["commit", "-m", "task"]);

    await mergeBranchToMain(repo, "codex/TASK-001-first-task");

    const branch = await git(repo, ["branch", "--show-current"]);
    const remoteMain = await git(repo, ["ls-remote", "origin", "refs/heads/main"]);

    expect(branch.stdout.trim()).toBe("main");
    expect(remoteMain.stdout.trim()).toContain("refs/heads/main");
    expect(await readFile(join(repo, "TASK.md"), "utf8")).toBe("done\n");
  });

  test("refreshes a queued task branch onto latest origin main before merge", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codex-runner-refresh-"));
    tempRoots.push(parent);
    const remote = join(parent, "remote.git");
    const repo = join(parent, "repo");

    await runCommand(parent, "git", ["init", "--bare", remote]);
    await runCommand(parent, "git", ["clone", remote, repo]);
    await git(repo, ["config", "user.email", "runner@example.com"]);
    await git(repo, ["config", "user.name", "Codex Runner"]);
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "initial"]);
    await git(repo, ["branch", "-M", "main"]);
    await git(repo, ["push", "-u", "origin", "main"]);

    await git(repo, ["checkout", "-b", "codex/TASK-002-second-task"]);
    await writeFile(join(repo, "TASK2.md"), "done\n");
    await git(repo, ["add", "TASK2.md"]);
    await git(repo, ["commit", "-m", "second task"]);
    await git(repo, ["push", "-u", "origin", "codex/TASK-002-second-task"]);

    await git(repo, ["checkout", "main"]);
    await writeFile(join(repo, "TASK1.md"), "done\n");
    await git(repo, ["add", "TASK1.md"]);
    await git(repo, ["commit", "-m", "first task"]);
    await git(repo, ["push", "origin", "main"]);

    await refreshBranchFromMain(repo, repo, "codex/TASK-002-second-task");

    const currentBranch = await git(repo, ["branch", "--show-current"]);
    const ancestry = await runCommand(repo, "git", [
      "merge-base",
      "--is-ancestor",
      "origin/main",
      "HEAD",
    ]);

    expect(currentBranch.stdout.trim()).toBe("codex/TASK-002-second-task");
    expect(ancestry.exitCode).toBe(0);
    expect(await readFile(join(repo, "TASK1.md"), "utf8")).toBe("done\n");
    expect(await readFile(join(repo, "TASK2.md"), "utf8")).toBe("done\n");
  });

  test("auto-resolves bookkeeping-only rebase conflicts during branch refresh", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codex-runner-bookkeeping-refresh-"));
    tempRoots.push(parent);
    const remote = join(parent, "remote.git");
    const repo = join(parent, "repo");

    await runCommand(parent, "git", ["init", "--bare", remote]);
    await runCommand(parent, "git", ["clone", remote, repo]);
    await git(repo, ["config", "user.email", "runner@example.com"]);
    await git(repo, ["config", "user.name", "Codex Runner"]);
    await writeFile(join(repo, "README.md"), "# Fixture\n\nNext: TASK-001\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "initial"]);
    await git(repo, ["branch", "-M", "main"]);
    await git(repo, ["push", "-u", "origin", "main"]);

    await git(repo, ["checkout", "-b", "codex/TASK-002-second-task"]);
    await writeFile(join(repo, "README.md"), "# Fixture\n\nNext: TASK-003\n");
    await writeFile(join(repo, "TASK2.md"), "done\n");
    await git(repo, ["add", "README.md", "TASK2.md"]);
    await git(repo, ["commit", "-m", "second task"]);
    await git(repo, ["push", "-u", "origin", "codex/TASK-002-second-task"]);

    await git(repo, ["checkout", "main"]);
    await writeFile(join(repo, "README.md"), "# Fixture\n\nNext: TASK-002\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "first task readme"]);
    await git(repo, ["push", "origin", "main"]);

    await refreshBranchFromMain(repo, repo, "codex/TASK-002-second-task");

    const currentBranch = await git(repo, ["branch", "--show-current"]);
    const ancestry = await runCommand(repo, "git", [
      "merge-base",
      "--is-ancestor",
      "origin/main",
      "HEAD",
    ]);

    expect(currentBranch.stdout.trim()).toBe("codex/TASK-002-second-task");
    expect(ancestry.exitCode).toBe(0);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# Fixture\n\nNext: TASK-002\n");
    expect(await readFile(join(repo, "TASK2.md"), "utf8")).toBe("done\n");
  }, 90_000);
});
