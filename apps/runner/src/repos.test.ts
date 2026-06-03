import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTRACT_VERSION } from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import { runRunnerReposAdd, type RunnerRepoMappingGitRunner } from "./repos.js";

const runnerCredential = "runner-credential-must-stay-local";

describe("runner repo mapping registration", () => {
  test("validates a git repo, detects safe metadata, and registers the mapping", async () => {
    const repoPath = await createTempRepoPath("control-plane");
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const runGit: RunnerRepoMappingGitRunner = async (args, { cwd }) => {
      calls.push({ args, cwd });

      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: "https://github.com/rory/control-plane.git\n" };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath }));

    const result = await runRunnerReposAdd(
      { path: repoPath },
      {
        loadCredential: async () => credentialRecord(),
        postRepoMapping,
        realpath: async (path) => path,
        runGit,
      },
    );

    expect(result).toEqual(responseData({ localPath: repoPath }));
    expect(postRepoMapping).toHaveBeenCalledWith({
      credential: credentialRecord(),
      mapping: {
        defaultBranch: "main",
        localPath: repoPath,
        provider: "github",
        remoteUrl: "https://github.com/rory/control-plane.git",
        repositoryName: "control-plane",
        repositoryOwner: "rory",
      },
    });
    expect(calls).toEqual([
      { args: ["rev-parse", "--is-inside-work-tree"], cwd: repoPath },
      { args: ["remote", "get-url", "origin"], cwd: repoPath },
      {
        args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        cwd: repoPath,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(runnerCredential);
  });

  test("falls back to the current branch and safe local owner/name when origin metadata is absent", async () => {
    const repoPath = await createTempRepoPath("local-only");
    const calls: readonly string[][] = [];
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      (calls as string[][]).push([...args]);

      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 2, stderr: "no remote", stdout: "" };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 1, stderr: "no origin head", stdout: "" };
      }

      if (args.join("\0") === "rev-parse\0--abbrev-ref\0HEAD") {
        return { exitCode: 0, stderr: "", stdout: "trunk\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };
    const postRepoMapping = vi.fn(async () =>
      responseData({
        defaultBranch: "trunk",
        localPath: repoPath,
        provider: "local",
        remoteUrl: null,
        repositoryName: "local-only",
        repositoryOwner: "local",
      }),
    );

    await runRunnerReposAdd(
      { path: repoPath },
      {
        loadCredential: async () => credentialRecord(),
        postRepoMapping,
        realpath: async (path) => path,
        runGit,
      },
    );

    expect(postRepoMapping).toHaveBeenCalledWith({
      credential: credentialRecord(),
      mapping: {
        defaultBranch: "trunk",
        localPath: repoPath,
        provider: "local",
        remoteUrl: null,
        repositoryName: "local-only",
        repositoryOwner: "local",
      },
    });
    expect(calls).toEqual([
      ["rev-parse", "--is-inside-work-tree"],
      ["remote", "get-url", "origin"],
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      ["rev-parse", "--abbrev-ref", "HEAD"],
    ]);
  });

  test("blocks credentialed or secret-looking remote URLs before submission", async () => {
    const repoPath = await createTempRepoPath("control-plane");
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath }));
    const tokenLikeRemote = `https://runner:${"ghp_"}${"secret".repeat(
      4,
    )}@git.example/control-plane.git`;
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${tokenLikeRemote}\n`,
        };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await expect(
      runRunnerReposAdd(
        { path: repoPath },
        {
          loadCredential: async () => credentialRecord(),
          postRepoMapping,
          realpath: async (path) => path,
          runGit,
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Repository remote URL is not safe to register.",
    });
    expect(postRepoMapping).not.toHaveBeenCalled();
  });

  test("blocks credential-like SCP-style remote userinfo before submission", async () => {
    const repoPath = await createTempRepoPath("control-plane");
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath }));
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: "user:pass@github.com:rory/control-plane.git\n",
        };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await expect(
      runRunnerReposAdd(
        { path: repoPath },
        {
          loadCredential: async () => credentialRecord(),
          postRepoMapping,
          realpath: async (path) => path,
          runGit,
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Repository remote URL is not safe to register.",
    });
    expect(postRepoMapping).not.toHaveBeenCalled();
  });

  test("blocks unsafe origin HEAD branch names before falling back to current branch", async () => {
    const repoPath = await createTempRepoPath("control-plane");
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath }));
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: "https://github.com/rory/control-plane.git\n" };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main.lock\n" };
      }

      if (args.join("\0") === "rev-parse\0--abbrev-ref\0HEAD") {
        return { exitCode: 0, stderr: "", stdout: "main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await expect(
      runRunnerReposAdd(
        { path: repoPath },
        {
          loadCredential: async () => credentialRecord(),
          postRepoMapping,
          realpath: async (path) => path,
          runGit,
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Repository metadata is not safe to register.",
    });
    expect(postRepoMapping).not.toHaveBeenCalled();
  });

  test("blocks remotes whose owner and repository name cannot be parsed", async () => {
    const repoPath = await createTempRepoPath("control-plane");
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath }));
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: "https://github.com/rory\n" };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await expect(
      runRunnerReposAdd(
        { path: repoPath },
        {
          loadCredential: async () => credentialRecord(),
          postRepoMapping,
          realpath: async (path) => path,
          runGit,
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Repository remote metadata could not be parsed.",
    });
    expect(postRepoMapping).not.toHaveBeenCalled();
  });

  test.each([
    ["https remote", "https://github.com/rory/control-plane.git"],
    ["ssh URL remote", "ssh://git@github.com/rory/control-plane.git"],
    ["scp-style remote", "git@github.com:rory/control-plane.git"],
  ])("parses GitHub owner and repository name from %s", async (_caseName, remoteUrl) => {
    const repoPath = await createTempRepoPath("control-plane");
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath, remoteUrl }));
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: `${remoteUrl}\n` };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await runRunnerReposAdd(
      { path: repoPath },
      {
        loadCredential: async () => credentialRecord(),
        postRepoMapping,
        realpath: async (path) => path,
        runGit,
      },
    );

    expect(postRepoMapping).toHaveBeenCalledWith({
      credential: credentialRecord(),
      mapping: {
        defaultBranch: "main",
        localPath: repoPath,
        provider: "github",
        remoteUrl,
        repositoryName: "control-plane",
        repositoryOwner: "rory",
      },
    });
  });

  test.each([
    ["absolute path remote", "/tmp/control-plane.git"],
    ["relative path remote", "../control-plane.git"],
    ["file URL remote", "file:///tmp/control-plane.git"],
  ])("parses safe local metadata from %s", async (_caseName, remoteUrl) => {
    const repoPath = await createTempRepoPath("control-plane");
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath, remoteUrl }));
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: `${remoteUrl}\n` };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await runRunnerReposAdd(
      { path: repoPath },
      {
        loadCredential: async () => credentialRecord(),
        postRepoMapping,
        realpath: async (path) => path,
        runGit,
      },
    );

    expect(postRepoMapping).toHaveBeenCalledWith({
      credential: credentialRecord(),
      mapping: {
        defaultBranch: "main",
        localPath: repoPath,
        provider: "local",
        remoteUrl,
        repositoryName: "control-plane",
        repositoryOwner: "local",
      },
    });
  });

  test.each([
    {
      name: "source-like local path",
      repoName: "function leak() { return true; }",
      remoteUrl: "https://github.com/rory/control-plane.git",
    },
    {
      name: "source-like remote URL",
      repoName: "control-plane",
      remoteUrl: "https://github.com/rory/function leak() {}.git",
    },
    {
      name: "patch-like remote URL",
      repoName: "control-plane",
      remoteUrl: "https://github.com/rory/@@ -1,2 +1,2 @@.git",
    },
  ])("blocks $name before submission", async ({ remoteUrl, repoName }) => {
    const repoPath = await createTempRepoPath(repoName);
    const postRepoMapping = vi.fn(async () => responseData({ localPath: repoPath }));
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: `${remoteUrl}\n` };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    await expect(
      runRunnerReposAdd(
        { path: repoPath },
        {
          loadCredential: async () => credentialRecord(),
          postRepoMapping,
          realpath: async (path) => path,
          runGit,
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Repository metadata is not safe to register.",
    });
    expect(postRepoMapping).not.toHaveBeenCalled();
  });

  test("does not invoke file tree, source listing, package-manager, or file-read commands", async () => {
    const repoPath = await createTempRepoPath("control-plane");
    const unsafeCommandPattern = /\b(?:ls-files|show|cat-file|grep|find|npm|pnpm|yarn|node)\b/i;
    const runGit: RunnerRepoMappingGitRunner = async (args) => {
      expect(args.join(" ")).not.toMatch(unsafeCommandPattern);

      if (args.join("\0") === "rev-parse\0--is-inside-work-tree") {
        return { exitCode: 0, stderr: "", stdout: "true\n" };
      }

      if (args.join("\0") === "remote\0get-url\0origin") {
        return { exitCode: 0, stderr: "", stdout: "git@github.com:rory/control-plane.git\n" };
      }

      if (args.join("\0") === "symbolic-ref\0--quiet\0--short\0refs/remotes/origin/HEAD") {
        return { exitCode: 0, stderr: "", stdout: "origin/main\n" };
      }

      throw new Error(`unexpected git command ${args.join(" ")}`);
    };

    const result = await runRunnerReposAdd(
      { path: repoPath },
      {
        loadCredential: async () => credentialRecord(),
        postRepoMapping: async () => responseData({ localPath: repoPath }),
        realpath: async (path) => path,
        runGit,
      },
    );

    expect(result.repositoryOwner).toBe("rory");
    expect(result.repositoryName).toBe("control-plane");
    expect(JSON.stringify(result)).not.toMatch(/source|diff|patch|snippet|dependency/i);
  });
});

const createTempRepoPath = async (name: string): Promise<string> => {
  const repoPath = join(tmpdir(), `control-plane-runner-repos-${crypto.randomUUID()}`, name);
  await mkdir(repoPath, { recursive: true });
  return repoPath;
};

const credentialRecord = () => ({
  contractVersion: CONTRACT_VERSION,
  linkedAt: "2026-05-22T14:00:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "https://control-plane.test/api",
  runnerCredential,
  runnerId: "runner_1",
  storedAt: "2026-05-22T14:30:00.000Z",
  workspaceId: "workspace_1",
});

const responseData = (
  overrides: Partial<{
    defaultBranch: string;
    localPath: string;
    provider: string;
    remoteUrl: string | null;
    repositoryName: string;
    repositoryOwner: string;
  }> = {},
) => ({
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/repos/control-plane",
  provider: "github",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
  ...overrides,
});
