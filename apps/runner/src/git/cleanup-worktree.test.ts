import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  DryRunResultSchema,
  type DryRunResult,
  type RunnerCapabilities,
} from "@control-plane/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand, type CommandExecutionResult } from "../command.js";
import {
  cleanupWorktree as cleanupWorktreeFromEntrypoint,
  CleanupWorktreeError as CleanupWorktreeErrorFromEntrypoint,
  createWorktree,
  type CleanupWorktreeOptions as CleanupWorktreeOptionsFromEntrypoint,
} from "../index.js";
import {
  cleanupWorktree,
  CleanupWorktreeError,
  type CleanupWorktreeOptions,
} from "./cleanup-worktree.js";

const RUN_ID = "run-053";
const REPO_PATH = "/private/tmp/control-plane/repo";
const WORKTREE_ROOT = "/private/tmp/control-plane/worktrees";
const WORKTREE_PATH = "/private/tmp/control-plane/worktrees/run-053";
const TARGET_BRANCH = "aicp/task-053-cleanup";
const DEFAULT_BRANCH = "main";
const UNSAFE_STRINGS = [
  "diff --git a/src/private.ts b/src/private.ts",
  "patch contains private code",
  "export const secret = 'source snippet'",
  "OPENAI_API_KEY=sk-test-cleanup-secret",
  "GITHUB_TOKEN=ghp_cleanupsecret1234567890",
  "-----BEGIN PRIVATE KEY-----",
  "raw stdout that must stay local",
  "raw stderr that must stay local",
  "/private/tmp/external-user-repo",
];

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("cleanupWorktree", () => {
  it.each([
    ["empty worktree root", { worktreeRoot: "" }, "invalid_worktree_root"],
    [
      "relative worktree root",
      { worktreeRoot: ".codex-runner-worktrees" },
      "invalid_worktree_root",
    ],
    [
      "control-character worktree root",
      { worktreeRoot: "/private/tmp/control-plane/\u0001worktrees" },
      "invalid_worktree_root",
    ],
    ["empty worktree path", { worktreePath: "" }, "invalid_worktree_path"],
    ["relative worktree path", { worktreePath: "worktrees/run-053" }, "invalid_worktree_path"],
    [
      "control-character worktree path",
      { worktreePath: "/private/tmp/control-plane/worktrees/run-\u0001053" },
      "invalid_worktree_path",
    ],
    ["root-equal worktree path", { worktreePath: WORKTREE_ROOT }, "worktree_path_outside_root"],
    [
      "outside-root worktree path",
      { worktreePath: "/private/tmp/control-plane/external/run-053" },
      "worktree_path_outside_root",
    ],
  ] satisfies [string, Partial<CleanupWorktreeOptions>, CleanupWorktreeError["code"]][])(
    "refuses %s before inspecting or running git",
    async (_label, overrides, expectedCode) => {
      const dependencies = cleanupDependencies();

      const error = await expectCleanupWorktreeError(
        cleanupWorktree({
          ...baseOptions(overrides),
          ...dependencies,
        }),
      );

      expect(error.code).toBe(expectedCode);
      expect(dependencies.lstat).not.toHaveBeenCalled();
      expect(dependencies.realpath).not.toHaveBeenCalled();
      expect(dependencies.commandRunner).not.toHaveBeenCalled();
      expectSafeSerializedValue(error);
    },
  );

  it("refuses a symlinked worktree path that resolves outside the runner root before git runs", async () => {
    const dependencies = cleanupDependencies({
      lstat: vi.fn<NonNullable<CleanupWorktreeOptions["lstat"]>>().mockResolvedValue({}),
      realpath: vi
        .fn<NonNullable<CleanupWorktreeOptions["realpath"]>>()
        .mockImplementation(async (path) =>
          path === WORKTREE_ROOT
            ? WORKTREE_ROOT
            : "/private/tmp/external-user-repo/worktree-owned-by-user",
        ),
    });

    const error = await expectCleanupWorktreeError(
      cleanupWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("worktree_path_outside_root");
    expect(dependencies.commandRunner).not.toHaveBeenCalled();
    expectSafeSerializedValue(error);
  });

  it("does not run git when ownership cannot be inspected safely", async () => {
    const dependencies = cleanupDependencies({
      lstat: vi
        .fn<NonNullable<CleanupWorktreeOptions["lstat"]>>()
        .mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    });

    const error = await expectCleanupWorktreeError(
      cleanupWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("worktree_path_uninspectable");
    expect(dependencies.realpath).not.toHaveBeenCalled();
    expect(dependencies.commandRunner).not.toHaveBeenCalled();
    expectSafeSerializedValue(error);
  });

  it("removes an existing runner-owned worktree and prunes stale entries", async () => {
    const dependencies = cleanupDependencies();

    const result = await cleanupWorktree({
      ...baseOptions(),
      ...dependencies,
    });

    expect(dependencies.commandRunner).toHaveBeenCalledTimes(2);
    expect(dependencies.commandRunner).toHaveBeenNthCalledWith(1, {
      command: "git",
      args: ["worktree", "remove", "--force", WORKTREE_PATH],
      cwd: REPO_PATH,
      summaryLimit: 1,
    });
    expect(dependencies.commandRunner).toHaveBeenNthCalledWith(2, {
      command: "git",
      args: ["worktree", "prune", "--expire", "now"],
      cwd: REPO_PATH,
      summaryLimit: 1,
    });
    expect(result).toEqual({
      worktreePath: WORKTREE_PATH,
      removed: true,
      pruned: true,
      metadata: {
        worktreeRemoved: true,
        gitRemoveExitCode: 0,
        gitPruneExitCode: 0,
      },
    });
    expectSafeSerializedValue(result);
  });

  it("skips removal for a missing worktree path but still prunes stale entries", async () => {
    const dependencies = cleanupDependencies({
      lstat: vi
        .fn<NonNullable<CleanupWorktreeOptions["lstat"]>>()
        .mockImplementation(async (path) => {
          if (path === WORKTREE_ROOT) {
            return {};
          }

          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }),
    });

    const result = await cleanupWorktree({
      ...baseOptions(),
      ...dependencies,
    });

    expect(dependencies.commandRunner).toHaveBeenCalledTimes(1);
    expect(dependencies.commandRunner).toHaveBeenCalledWith({
      command: "git",
      args: ["worktree", "prune", "--expire", "now"],
      cwd: REPO_PATH,
      summaryLimit: 1,
    });
    expect(result).toEqual({
      worktreePath: WORKTREE_PATH,
      removed: false,
      pruned: true,
      metadata: {
        worktreeRemoved: false,
        gitRemoveExitCode: null,
        gitPruneExitCode: 0,
      },
    });
    expectSafeSerializedValue(result);
  });

  it("throws a safe error without command output when worktree removal fails", async () => {
    const dependencies = cleanupDependencies({
      commandRunner: vi
        .fn<NonNullable<CleanupWorktreeOptions["commandRunner"]>>()
        .mockResolvedValue(commandResult({ exitCode: 128 })),
    });

    const error = await expectCleanupWorktreeError(
      cleanupWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("git_worktree_remove_failed");
    expect(error.metadata).toEqual({
      gitExitCode: 128,
      phase: "remove",
    });
    expect("result" in error).toBe(false);
    expect(dependencies.commandRunner).toHaveBeenCalledTimes(1);
    expectSafeSerializedValue(error);
  });

  it("throws a safe error without command output when worktree prune fails", async () => {
    const dependencies = cleanupDependencies({
      commandRunner: vi
        .fn<NonNullable<CleanupWorktreeOptions["commandRunner"]>>()
        .mockResolvedValueOnce(commandResult({ exitCode: 0 }))
        .mockResolvedValueOnce(commandResult({ exitCode: 129 })),
    });

    const error = await expectCleanupWorktreeError(
      cleanupWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("git_worktree_prune_failed");
    expect(error.metadata).toEqual({
      gitExitCode: 129,
      phase: "prune",
    });
    expect("result" in error).toBe(false);
    expectSafeSerializedValue(error);
  });

  it("cleans up a real fixture worktree without deleting the task branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-plane-cleanup-worktree-"));
    temporaryRoots.push(root);
    const repoPath = join(root, "repo");
    const worktreeRoot = join(root, "worktrees");
    const worktreePath = join(worktreeRoot, "task-053");

    await createFixtureRepo(repoPath);
    await createWorktree({
      repoPath,
      runId: RUN_ID,
      dryRunResult: dryRunResult(),
      targetBranch: TARGET_BRANCH,
      defaultBranch: DEFAULT_BRANCH,
      worktreePath,
    });

    await cleanupWorktree({
      repoPath,
      worktreeRoot,
      worktreePath,
    });

    await expect(access(worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
    const worktreeList = await git(repoPath, ["worktree", "list", "--porcelain"]);
    const taskBranch = await git(repoPath, ["show-ref", "--verify", `refs/heads/${TARGET_BRANCH}`]);

    expect(worktreeList.stdoutSummary).not.toContain(worktreePath);
    expect(taskBranch.exitCode).toBe(0);
  });

  it("exports the helper and types from the runner public entrypoint", async () => {
    const typedOptions: CleanupWorktreeOptionsFromEntrypoint = {
      ...baseOptions(),
      ...cleanupDependencies(),
    };

    expect(cleanupWorktreeFromEntrypoint).toBe(cleanupWorktree);
    expect(CleanupWorktreeErrorFromEntrypoint).toBe(CleanupWorktreeError);
    await expect(cleanupWorktreeFromEntrypoint(typedOptions)).resolves.toMatchObject({
      worktreePath: WORKTREE_PATH,
      removed: true,
      pruned: true,
    });
  });
});

const baseOptions = (overrides: Partial<CleanupWorktreeOptions> = {}): CleanupWorktreeOptions => ({
  repoPath: REPO_PATH,
  worktreeRoot: WORKTREE_ROOT,
  worktreePath: WORKTREE_PATH,
  ...overrides,
});

const cleanupDependencies = (
  overrides: Partial<Pick<CleanupWorktreeOptions, "lstat" | "realpath" | "commandRunner">> = {},
): Required<Pick<CleanupWorktreeOptions, "lstat" | "realpath" | "commandRunner">> => ({
  lstat:
    overrides.lstat ?? vi.fn<NonNullable<CleanupWorktreeOptions["lstat"]>>().mockResolvedValue({}),
  realpath:
    overrides.realpath ??
    vi
      .fn<NonNullable<CleanupWorktreeOptions["realpath"]>>()
      .mockImplementation(async (path) => path),
  commandRunner:
    overrides.commandRunner ??
    vi
      .fn<NonNullable<CleanupWorktreeOptions["commandRunner"]>>()
      .mockResolvedValue(commandResult({ exitCode: 0 })),
});

const createFixtureRepo = async (repoPath: string): Promise<void> => {
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init"]);
  await git(repoPath, ["symbolic-ref", "HEAD", `refs/heads/${DEFAULT_BRANCH}`]);
  await git(repoPath, ["config", "user.email", "runner@example.invalid"]);
  await git(repoPath, ["config", "user.name", "Control Plane Runner"]);
  await writeFile(join(repoPath, "README.md"), "fixture repo\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "Initial fixture commit"]);
};

const git = async (cwd: string, args: string[]): Promise<CommandExecutionResult> => {
  const result = await runCommand({
    command: "git",
    args,
    cwd,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Fixture git command failed with exit code ${result.exitCode}.`);
  }

  return result;
};

const dryRunResult = (): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `dry-run:${RUN_ID}`,
    runId: RUN_ID,
    status: "passed",
    checks: [
      {
        id: "repo_path_exists",
        label: "Repo path exists",
        status: "passed",
        message: "Repository path is ready.",
        metadata: {
          ready: true,
        },
      },
    ],
    capabilities: runnerCapabilities(),
    blockers: [],
    warnings: [],
    createdAt: "2026-05-20T12:00:00.000Z",
  });

const runnerCapabilities = (): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  os: {
    platform: "test-platform",
    release: "test-release",
    arch: "test-arch",
  },
  shell: "test-shell",
  tools: {
    git: {
      available: true,
      version: "2.0.0",
    },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: false,
  reportedAt: "2026-05-20T12:00:00.000Z",
});

const commandResult = (
  overrides: Partial<CommandExecutionResult> = {},
): CommandExecutionResult => ({
  command: {
    executable: "git",
    args: ["worktree", "remove", "--force", WORKTREE_PATH],
  },
  cwd: REPO_PATH,
  exitCode: 0,
  durationMs: 1,
  stdoutSummary: UNSAFE_STRINGS.filter((value) => value.includes("stdout")).join("\n"),
  stderrSummary: UNSAFE_STRINGS.filter((value) => !value.includes("stdout")).join("\n"),
  redactionApplied: true,
  ...overrides,
});

const expectCleanupWorktreeError = async (
  promise: Promise<unknown>,
): Promise<CleanupWorktreeError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CleanupWorktreeError);
    return error as CleanupWorktreeError;
  }

  throw new Error("Expected cleanupWorktree to reject.");
};

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeString of UNSAFE_STRINGS) {
    expect(serialized).not.toContain(unsafeString);
  }

  expect(serialized).not.toContain("stdoutSummary");
  expect(serialized).not.toContain("stderrSummary");
  expect(serialized).not.toContain("CommandExecutionResult");
};
