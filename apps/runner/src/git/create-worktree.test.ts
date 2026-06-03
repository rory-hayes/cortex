import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  DryRunResultSchema,
  RiskFindingSchema,
  type DryRunResult,
  type RiskFinding,
  type RunnerCapabilities,
} from "@control-plane/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand, type CommandExecutionResult } from "../command.js";
import {
  createWorktree as createWorktreeFromEntrypoint,
  CreateWorktreeError as CreateWorktreeErrorFromEntrypoint,
  type CreateWorktreeOptions as CreateWorktreeOptionsFromEntrypoint,
} from "../index.js";
import {
  createWorktree,
  CreateWorktreeError,
  type CreateWorktreeOptions,
} from "./create-worktree.js";

const RUN_ID = "run-052";
const REPO_PATH = "/private/tmp/control-plane/repo";
const WORKTREE_PATH = "/private/tmp/control-plane/worktrees/run-052";
const TARGET_BRANCH = "aicp/task-052-worktree";
const DEFAULT_BRANCH = "main";
const UNSAFE_STRINGS = [
  "diff --git a/src/private.ts b/src/private.ts",
  "patch contains private code",
  "export const secret = 'source snippet'",
  "OPENAI_API_KEY=sk-test-worktree-secret",
  "GITHUB_TOKEN=ghp_createworktreesecret1234567890",
  "-----BEGIN PRIVATE KEY-----",
  "raw stdout that must stay local",
  "raw stderr that must stay local",
];

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("createWorktree", () => {
  it("creates a real fixture worktree from a passed dry run", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-plane-create-worktree-"));
    temporaryRoots.push(root);
    const repoPath = join(root, "repo");
    const worktreePath = join(root, "worktrees", "task-052");

    await createFixtureRepo(repoPath);

    const result = await createWorktree({
      repoPath,
      runId: RUN_ID,
      dryRunResult: dryRunResult(),
      targetBranch: TARGET_BRANCH,
      defaultBranch: DEFAULT_BRANCH,
      worktreePath,
    });

    await expect(access(worktreePath)).resolves.toBeUndefined();
    const branchResult = await git(worktreePath, ["branch", "--show-current"]);

    expect(branchResult.stdoutSummary.trim()).toBe(TARGET_BRANCH);
    expect(result).toEqual({
      runId: RUN_ID,
      branchName: TARGET_BRANCH,
      baseBranch: DEFAULT_BRANCH,
      worktreePath,
      metadata: {
        branchName: TARGET_BRANCH,
        baseBranch: DEFAULT_BRANCH,
        worktreeCreated: true,
        gitExitCode: 0,
      },
    });
    expectSafeSerializedValue(result);
  });

  it.each([
    ["failed status", dryRunResult({ status: "failed" })],
    ["dry-run blocker", dryRunResult({ blockers: [riskFinding()] })],
  ])("refuses before mutation when dry run has a %s", async (_label, result) => {
    const dependencies = mutationDependencies();

    const error = await expectCreateWorktreeError(
      createWorktree({
        ...baseOptions({ dryRunResult: result }),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("dry_run_blocked");
    expect(dependencies.lstat).not.toHaveBeenCalled();
    expect(dependencies.mkdir).not.toHaveBeenCalled();
    expect(dependencies.commandRunner).not.toHaveBeenCalled();
    expectSafeSerializedValue(error);
  });

  it("refuses before mutation when the dry-run result belongs to a different run", async () => {
    const dependencies = mutationDependencies();

    const error = await expectCreateWorktreeError(
      createWorktree({
        ...baseOptions({ dryRunResult: dryRunResult({ runId: "different-run" }) }),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("dry_run_mismatch");
    expect(dependencies.lstat).not.toHaveBeenCalled();
    expect(dependencies.mkdir).not.toHaveBeenCalled();
    expect(dependencies.commandRunner).not.toHaveBeenCalled();
    expectSafeSerializedValue(error);
  });

  it("fails safely before git when the worktree path already exists", async () => {
    const dependencies = mutationDependencies({
      lstat: vi.fn<NonNullable<CreateWorktreeOptions["lstat"]>>().mockResolvedValue({}),
    });

    const error = await expectCreateWorktreeError(
      createWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("worktree_path_exists");
    expect(dependencies.mkdir).not.toHaveBeenCalled();
    expect(dependencies.commandRunner).not.toHaveBeenCalled();
    expectSafeSerializedValue(error);
  });

  it.each([
    ["target branch", { targetBranch: "feature branch" }, "invalid_branch"],
    ["default branch", { defaultBranch: "main;rm-rf" }, "invalid_branch"],
    ["missing worktree path", { worktreePath: "" }, "invalid_worktree_path"],
    [
      "relative worktree path",
      { worktreePath: ".codex-runner-worktrees/task" },
      "invalid_worktree_path",
    ],
  ] satisfies [string, Partial<CreateWorktreeOptions>, CreateWorktreeError["code"]][])(
    "rejects invalid or unsafe %s before filesystem or git mutation",
    async (_label, overrides, expectedCode) => {
      const dependencies = mutationDependencies();

      const error = await expectCreateWorktreeError(
        createWorktree({
          ...baseOptions(overrides),
          ...dependencies,
        }),
      );

      expect(error.code).toBe(expectedCode);
      expect(dependencies.lstat).not.toHaveBeenCalled();
      expect(dependencies.mkdir).not.toHaveBeenCalled();
      expect(dependencies.commandRunner).not.toHaveBeenCalled();
      expectSafeSerializedValue(error);
    },
  );

  it("fails safely when the worktree path cannot be inspected", async () => {
    const dependencies = mutationDependencies({
      lstat: vi
        .fn<NonNullable<CreateWorktreeOptions["lstat"]>>()
        .mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    });

    const error = await expectCreateWorktreeError(
      createWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("worktree_path_uninspectable");
    expect(dependencies.mkdir).not.toHaveBeenCalled();
    expect(dependencies.commandRunner).not.toHaveBeenCalled();
    expectSafeSerializedValue(error);
  });

  it("throws a safe error without command output when git worktree fails", async () => {
    const dependencies = mutationDependencies({
      commandRunner: vi
        .fn<NonNullable<CreateWorktreeOptions["commandRunner"]>>()
        .mockResolvedValue(commandResult({ exitCode: 128 })),
    });

    const error = await expectCreateWorktreeError(
      createWorktree({
        ...baseOptions(),
        ...dependencies,
      }),
    );

    expect(error.code).toBe("git_worktree_failed");
    expect(error.metadata).toEqual({
      branchName: TARGET_BRANCH,
      baseBranch: DEFAULT_BRANCH,
      gitExitCode: 128,
    });
    expect("result" in error).toBe(false);
    expectSafeSerializedValue(error);
  });

  it("exports the helper and types from the runner public entrypoint", async () => {
    const typedOptions: CreateWorktreeOptionsFromEntrypoint = {
      ...baseOptions(),
      ...mutationDependencies(),
    };

    expect(createWorktreeFromEntrypoint).toBe(createWorktree);
    expect(CreateWorktreeErrorFromEntrypoint).toBe(CreateWorktreeError);
    await expect(createWorktreeFromEntrypoint(typedOptions)).resolves.toMatchObject({
      runId: RUN_ID,
      branchName: TARGET_BRANCH,
      baseBranch: DEFAULT_BRANCH,
    });
  });
});

const baseOptions = (overrides: Partial<CreateWorktreeOptions> = {}): CreateWorktreeOptions => ({
  repoPath: REPO_PATH,
  runId: RUN_ID,
  dryRunResult: dryRunResult(),
  targetBranch: TARGET_BRANCH,
  defaultBranch: DEFAULT_BRANCH,
  worktreePath: WORKTREE_PATH,
  ...overrides,
});

const mutationDependencies = (
  overrides: Partial<Pick<CreateWorktreeOptions, "lstat" | "mkdir" | "commandRunner">> = {},
): Required<Pick<CreateWorktreeOptions, "lstat" | "mkdir" | "commandRunner">> => ({
  lstat:
    overrides.lstat ??
    vi
      .fn<NonNullable<CreateWorktreeOptions["lstat"]>>()
      .mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
  mkdir:
    overrides.mkdir ??
    vi.fn<NonNullable<CreateWorktreeOptions["mkdir"]>>().mockResolvedValue(undefined),
  commandRunner:
    overrides.commandRunner ??
    vi
      .fn<NonNullable<CreateWorktreeOptions["commandRunner"]>>()
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

const dryRunResult = (overrides: Partial<DryRunResult> = {}): DryRunResult =>
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
    ...overrides,
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

const riskFinding = (): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:dirty_repo",
    severity: "blocked",
    category: "dirty_repo",
    message: "Repository is not clean.",
    paths: [],
  });

const commandResult = (
  overrides: Partial<CommandExecutionResult> = {},
): CommandExecutionResult => ({
  command: {
    executable: "git",
    args: ["worktree", "add", "-b", TARGET_BRANCH, WORKTREE_PATH, DEFAULT_BRANCH],
  },
  cwd: REPO_PATH,
  exitCode: 0,
  durationMs: 1,
  stdoutSummary: UNSAFE_STRINGS.filter((value) => value.includes("stdout")).join("\n"),
  stderrSummary: UNSAFE_STRINGS.filter((value) => !value.includes("stdout")).join("\n"),
  redactionApplied: true,
  ...overrides,
});

const expectCreateWorktreeError = async (
  promise: Promise<unknown>,
): Promise<CreateWorktreeError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CreateWorktreeError);
    return error as CreateWorktreeError;
  }

  throw new Error("Expected createWorktree to reject.");
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
