import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RepoPathValidationError,
  validateRepoPath,
  type RunGitForRepoPathValidation,
} from "./repo-path.js";

const UNSAFE_GIT_OUTPUT = [
  "fatal: not a git repository",
  "SECRET_TOKEN=do-not-print",
  "function leakedSource()",
  "diff --git a/file.ts b/file.ts",
  "patch contains private code",
];

describe("repo path validation", () => {
  it("rejects a missing path with a structured path_missing error before Git runs", async () => {
    const missingPath = join(tmpdir(), "control-plane-missing-repo-path");
    const gitCalls: GitCall[] = [];

    const error = await expectRepoPathValidationError(
      validateRepoPath(missingPath, { runGit: recordGitCalls(gitCalls) }),
    );

    expect(error.code).toBe("path_missing");
    expect(error.repoPath).toBe(missingPath);
    expect(error.message).toContain(missingPath);
    expect(error.message).toContain("path_missing");
    expect(gitCalls).toEqual([]);
    expectSafeRepoPathErrorText(error);
  });

  it("rejects a file path with a structured not_directory error before Git runs", async () => {
    const filePath = await writeTempFile("repo-path-file-", "not-a-repo", "plain file");
    const gitCalls: GitCall[] = [];

    const error = await expectRepoPathValidationError(
      validateRepoPath(filePath, { runGit: recordGitCalls(gitCalls) }),
    );

    expect(error.code).toBe("not_directory");
    expect(error.repoPath).toBe(filePath);
    expect(error.message).toContain(filePath);
    expect(error.message).toContain("not_directory");
    expect(gitCalls).toEqual([]);
    expectSafeRepoPathErrorText(error);
  });

  it("rejects a non-Git directory with a structured not_git_repository error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "repo-path-non-git-"));

    const error = await expectRepoPathValidationError(
      validateRepoPath(directory, {
        runGit: async () => ({
          exitCode: 128,
          stdout: "SECRET_TOKEN=do-not-print",
          stderr: "fatal: not a git repository: function leakedSource()",
        }),
      }),
    );

    expect(error.code).toBe("not_git_repository");
    expect(error.repoPath).toBe(directory);
    expect(error.message).toContain(directory);
    expect(error.message).toContain("not_git_repository");
    expectSafeRepoPathErrorText(error);
  });

  it("resolves a validated repo path when the directory is inside a Git working tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "repo-path-valid-"));

    await expect(
      validateRepoPath(directory, {
        runGit: async () => ({
          exitCode: 0,
          stdout: "true\n",
          stderr: "",
        }),
      }),
    ).resolves.toEqual({
      repoPath: directory,
    });
  });

  it("checks the repo with git rev-parse --is-inside-work-tree in the supplied directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "repo-path-git-call-"));
    const gitCalls: GitCall[] = [];

    await validateRepoPath(directory, {
      runGit: recordGitCalls(gitCalls),
    });

    expect(gitCalls).toEqual([
      {
        cwd: directory,
        args: ["rev-parse", "--is-inside-work-tree"],
      },
    ]);
  });

  it("does not include Git stdout, stderr, or source-like content in error text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "repo-path-safe-error-"));

    const error = await expectRepoPathValidationError(
      validateRepoPath(directory, {
        runGit: async () => ({
          exitCode: 128,
          stdout: `${UNSAFE_GIT_OUTPUT[1]}\n${UNSAFE_GIT_OUTPUT[3]}`,
          stderr: `${UNSAFE_GIT_OUTPUT[0]}\n${UNSAFE_GIT_OUTPUT[2]}\n${UNSAFE_GIT_OUTPUT[4]}`,
        }),
      }),
    );

    expect(error.code).toBe("not_git_repository");
    expectSafeRepoPathErrorText(error);
  });
});

type GitCall = {
  cwd: string;
  args: string[];
};

const recordGitCalls =
  (calls: GitCall[]): RunGitForRepoPathValidation =>
  async (args, options) => {
    calls.push({
      cwd: options.cwd,
      args: [...args],
    });

    return {
      exitCode: 0,
      stdout: "true\n",
      stderr: "",
    };
  };

const writeTempFile = async (
  prefix: string,
  fileName: string,
  contents: string,
): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, fileName);
  await writeFile(filePath, contents, "utf8");
  return filePath;
};

const expectRepoPathValidationError = async (
  promise: Promise<unknown>,
): Promise<RepoPathValidationError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RepoPathValidationError);
    return error as RepoPathValidationError;
  }

  throw new Error("Expected repo path validation to reject.");
};

const expectSafeRepoPathErrorText = (error: RepoPathValidationError): void => {
  const safeText = `${error.message}\n${JSON.stringify({
    code: error.code,
    repoPath: error.repoPath,
  })}`;

  for (const unsafeText of UNSAFE_GIT_OUTPUT) {
    expect(safeText).not.toContain(unsafeText);
  }
};
