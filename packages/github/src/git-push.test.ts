import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import * as github from "@control-plane/github";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GitPushError,
  createMockGitPushAdapter,
  pushCommittedBranch,
  type GitPushCommand,
  type GitPushCommandResult,
  type GitPushCommandRunner,
  type GitPushErrorCode,
  type PushedBranchArtifact,
  type PushCommittedBranchOptions,
} from "./git-push.js";

const execFileAsync = promisify(execFile);

const createdRepos: string[] = [];

const defaultOptions = (
  overrides: Partial<PushCommittedBranchOptions> = {},
): PushCommittedBranchOptions => ({
  worktreePath: "/tmp/aicp/task-078",
  taskId: "TASK-078",
  runId: "run-078",
  branchName: "aicp/task-078-implement-git-push",
  remoteName: "origin",
  commitHash: "a".repeat(40),
  commandRunner: createSuccessfulCommandRunner().runner,
  ...overrides,
});

describe("@control-plane/github git push helper", () => {
  afterEach(async () => {
    await Promise.all(
      createdRepos.map((repoPath) => rm(repoPath, { force: true, recursive: true })),
    );
    createdRepos.length = 0;
  });

  it("exports the helper, mock adapter, error, and public types through the package entrypoint", () => {
    const artifact: PushedBranchArtifact = {
      taskId: "TASK-078",
      runId: "run-078",
      branchName: "aicp/task-078-implement-git-push",
      remoteName: "origin",
      remoteRef: "refs/heads/aicp/task-078-implement-git-push",
      commitHash: "a".repeat(40),
    };
    const code: GitPushErrorCode = "git_push_failed";

    expect(typeof github.pushCommittedBranch).toBe("function");
    expect(typeof github.createMockGitPushAdapter).toBe("function");
    expect(github.GitPushError).toBe(GitPushError);
    expect(artifact.remoteRef).toBe("refs/heads/aicp/task-078-implement-git-push");
    expect(code).toBe("git_push_failed");
  });

  it("mock push returns a deterministic branch artifact without invoking git", async () => {
    const commandRunner = vi.fn<GitPushCommandRunner>();
    const adapter = createMockGitPushAdapter();

    await expect(adapter.pushCommittedBranch(defaultOptions({ commandRunner }))).resolves.toEqual({
      taskId: "TASK-078",
      runId: "run-078",
      branchName: "aicp/task-078-implement-git-push",
      remoteName: "origin",
      remoteRef: "refs/heads/aicp/task-078-implement-git-push",
      commitHash: "a".repeat(40),
    });
    expect(commandRunner).not.toHaveBeenCalled();
    expect(adapter.calls).toEqual([
      {
        taskId: "TASK-078",
        runId: "run-078",
        branchName: "aicp/task-078-implement-git-push",
        remoteName: "origin",
        remoteRef: "refs/heads/aicp/task-078-implement-git-push",
        commitHash: "a".repeat(40),
      },
    ]);
  });

  it("pushes with direct argv git calls and never inspects remote URLs or force-pushes", async () => {
    const harness = createSuccessfulCommandRunner();

    await pushCommittedBranch(defaultOptions({ commandRunner: harness.runner }));

    expect(harness.calls).toEqual([
      {
        command: "git",
        args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
        cwd: "/tmp/aicp/task-078",
      },
      {
        command: "git",
        args: ["rev-parse", "HEAD"],
        cwd: "/tmp/aicp/task-078",
      },
      {
        command: "git",
        args: ["push", "-u", "origin", "HEAD:refs/heads/aicp/task-078-implement-git-push"],
        cwd: "/tmp/aicp/task-078",
      },
    ]);

    for (const call of harness.calls) {
      expect(call.command).toBe("git");
      expect(call.args).not.toContain("--force");
      expect(call.args).not.toContain("--force-with-lease");
      expect(call.args).not.toContain("remote");
      expect(call.args).not.toContain("get-url");
      expect(call.args.join(" ")).not.toContain("://");
    }
  });

  it("rejects unsafe inputs before invoking git", async () => {
    const cases: Array<Partial<PushCommittedBranchOptions>> = [
      { worktreePath: "relative/worktree" },
      { worktreePath: "/tmp/aicp/task-\u0001078" },
      { taskId: "TASK-078\nextra" },
      { runId: "GITHUB_TOKEN=ghp_rawsecret1234567890" },
      { branchName: "../outside" },
      { branchName: "aicp/task-078.lock" },
      { branchName: "-aicp/task-078" },
      { branchName: "aicp/task 078" },
      { branchName: "https://example.test/repo.git" },
      { remoteName: "https://example.test/repo.git" },
      { remoteName: "../origin" },
      { remoteName: "-origin" },
      { commitHash: "not-a-commit" },
    ];

    for (const overrides of cases) {
      const commandRunner = vi.fn<GitPushCommandRunner>();

      await expect(
        pushCommittedBranch(defaultOptions({ ...overrides, commandRunner })),
      ).rejects.toBeInstanceOf(GitPushError);
      expect(commandRunner).not.toHaveBeenCalled();
    }
  });

  it("rejects branch mismatch before push", async () => {
    const harness = createSuccessfulCommandRunner({ branchName: "aicp/other-branch" });

    await expect(
      pushCommittedBranch(defaultOptions({ commandRunner: harness.runner })),
    ).rejects.toMatchObject({ code: "branch_mismatch" });
    expect(harness.calls.map((call) => getGitStep(call))).toEqual(["branch"]);
  });

  it("rejects HEAD commit mismatch before push", async () => {
    const harness = createSuccessfulCommandRunner({ commitHash: "b".repeat(40) });

    await expect(
      pushCommittedBranch(defaultOptions({ commandRunner: harness.runner })),
    ).rejects.toMatchObject({ code: "head_mismatch" });
    expect(harness.calls.map((call) => getGitStep(call))).toEqual(["branch", "revParse"]);
  });

  it("does not serialize stdout, stderr, remote URLs, local paths, diffs, snippets, or tokens on push failure", async () => {
    const unsafeOutput = [
      "remote: https://token@example.test/private/repo.git",
      "diff --git a/src/secret.ts b/src/secret.ts",
      "patch text with code snippet",
      "const token = 'ghp_rawsecret1234567890';",
      "OPENAI_API_KEY=sk-rawsecret1234567890",
      "/tmp/aicp/task-078/src/secret.ts",
      "raw command output",
    ].join("\n");
    const harness = createSuccessfulCommandRunner({
      results: {
        push: {
          exitCode: 128,
          stdoutSummary: unsafeOutput,
          stderrSummary: unsafeOutput,
        },
      },
    });

    await expect(
      pushCommittedBranch(defaultOptions({ commandRunner: harness.runner })),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GitPushError);
      expect(error).toMatchObject({
        code: "git_push_failed",
        metadata: { gitExitCode: 128, gitStep: "push" },
      });

      const serialized = JSON.stringify(error);
      const message = String(error);

      for (const unsafeText of [
        "https://token@example.test",
        "diff --git",
        "patch text",
        "const token",
        "ghp_rawsecret",
        "OPENAI_API_KEY",
        "sk-rawsecret",
        "raw command output",
        "/tmp/aicp/task-078",
      ]) {
        expect(serialized).not.toContain(unsafeText);
        expect(message).not.toContain(unsafeText);
      }

      return true;
    });
  });

  it("pushes a committed fixture branch to a local bare remote using local git auth", async () => {
    const { repoPath, remotePath } = await createFixtureRepoWithBareRemote();
    const branchName = "aicp/task-078-fixture-push";

    await git(repoPath, ["checkout", "-b", branchName]);
    await mkdir(join(repoPath, "src"), { recursive: true });
    await writeFile(join(repoPath, "src", "push-proof.txt"), "synthetic push proof\n", "utf8");
    await git(repoPath, ["add", "src/push-proof.txt"]);
    await git(repoPath, ["commit", "-m", "Add push proof"]);

    const commitHash = (await git(repoPath, ["rev-parse", "HEAD"])).trim();

    const artifact = await pushCommittedBranch({
      worktreePath: repoPath,
      taskId: "TASK-078",
      runId: "run-078",
      branchName,
      remoteName: "origin",
      commitHash,
    });
    const remoteHead = (
      await git(repoPath, ["--git-dir", remotePath, "rev-parse", `refs/heads/${branchName}`])
    ).trim();

    expect(artifact).toEqual({
      taskId: "TASK-078",
      runId: "run-078",
      branchName,
      remoteName: "origin",
      remoteRef: `refs/heads/${branchName}`,
      commitHash,
    });
    expect(remoteHead).toBe(commitHash);
  });
});

const createSuccessfulCommandRunner = (
  options: {
    branchName?: string;
    commitHash?: string;
    results?: Partial<Record<"branch" | "revParse" | "push", GitPushCommandResult>>;
  } = {},
): {
  calls: GitPushCommand[];
  runner: GitPushCommandRunner;
} => {
  const calls: GitPushCommand[] = [];
  const branchName = options.branchName ?? "aicp/task-078-implement-git-push";
  const commitHash = options.commitHash ?? "a".repeat(40);
  const runner = vi.fn<GitPushCommandRunner>(async (command) => {
    calls.push(command);

    const step = getGitStep(command);
    const override = options.results?.[step];

    if (override !== undefined) {
      return override;
    }

    if (step === "branch") {
      return { exitCode: 0, stdoutSummary: `${branchName}\n`, stderrSummary: "" };
    }

    if (step === "revParse") {
      return { exitCode: 0, stdoutSummary: `${commitHash}\n`, stderrSummary: "" };
    }

    return { exitCode: 0, stdoutSummary: "", stderrSummary: "" };
  });

  return { calls, runner };
};

const getGitStep = (command: GitPushCommand): "branch" | "revParse" | "push" => {
  const subcommand = command.args.find((arg) =>
    ["symbolic-ref", "rev-parse", "push"].includes(arg),
  );

  if (subcommand === "symbolic-ref") {
    return "branch";
  }

  if (subcommand === "rev-parse") {
    return "revParse";
  }

  return "push";
};

const createFixtureRepoWithBareRemote = async (): Promise<{
  repoPath: string;
  remotePath: string;
}> => {
  const rootPath = await mkdtemp(join(tmpdir(), "control-plane-git-push-"));
  createdRepos.push(rootPath);

  const repoPath = join(rootPath, "repo");
  const remotePath = join(rootPath, "remote.git");

  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init", "--initial-branch=main"]);
  await git(repoPath, ["config", "user.email", "runner@example.test"]);
  await git(repoPath, ["config", "user.name", "Control Plane Runner"]);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial commit"]);
  await git(repoPath, ["init", "--bare", remotePath]);
  await git(repoPath, ["remote", "add", "origin", remotePath]);
  await git(repoPath, ["push", "-u", "origin", "main"]);

  return { repoPath, remotePath };
};

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", [...args], { cwd });

  return stdout;
};
