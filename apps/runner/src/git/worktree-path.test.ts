import { isAbsolute, join, relative, resolve } from "node:path";

import { CONTRACT_VERSION, type RepoPolicy } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { DEFAULT_RUNNER_CONFIG, type RunnerConfig } from "../config.js";
import {
  createTaskWorktreePath,
  WorktreePathError,
  type WorktreePathTaskInput,
} from "./worktree-path.js";
import {
  createTaskWorktreePath as createTaskWorktreePathFromEntrypoint,
  type WorktreePathTaskInput as WorktreePathTaskInputFromEntrypoint,
} from "../index.js";

const REPO_PATH = "/private/tmp/control-plane/repo";
const ABSOLUTE_WORKTREE_ROOT = "/private/tmp/control-plane/worktrees";

const BASE_TASK = {
  contractVersion: CONTRACT_VERSION,
  id: "TASK-051",
  repositoryId: "repo-alpha",
  runId: "run-051",
} satisfies WorktreePathTaskInput;

const BASE_CONFIG = {
  ...DEFAULT_RUNNER_CONFIG,
  worktreeRoot: ".codex-runner-worktrees",
} satisfies RunnerConfig;

const BASE_POLICY = {
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["src/**"],
  sensitivePaths: ["secrets/**"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["migrations/**"],
    infrastructure: [".github/**"],
    auth: ["auth/**"],
    billing: ["billing/**"],
  },
  validationCommands: [
    {
      id: "test",
      label: "Test",
      command: "pnpm test",
      timeoutSeconds: 60,
      required: true,
    },
  ],
  maxChangedFiles: 20,
  allowUntrackedFiles: false,
  dryRunChecks: ["repo_path_exists"],
} satisfies RepoPolicy;

describe("worktree path helper", () => {
  it("creates stable repeated output for the same task and run id", () => {
    const first = createTaskWorktreePath({
      repoPath: REPO_PATH,
      config: BASE_CONFIG,
      task: BASE_TASK,
    });
    const second = createTaskWorktreePath({
      repoPath: REPO_PATH,
      config: { ...BASE_CONFIG },
      task: { ...BASE_TASK },
    });

    expect(second).toEqual(first);
    expect(first.worktreePath).toBe(second.worktreePath);
    expect(first.worktreePath).toMatch(/\/run-051-[a-f0-9]{12}$/u);
  });

  it("resolves relative worktree roots under the validated repo path", () => {
    const result = createTaskWorktreePath({
      repoPath: REPO_PATH,
      config: BASE_CONFIG,
      task: BASE_TASK,
    });

    expect(result.worktreeRoot).toBe(resolve(REPO_PATH, ".codex-runner-worktrees"));
    expect(result.worktreePath).toBe(join(result.worktreeRoot, result.worktreeDirectoryName));
    expect(result.worktreeDirectoryName).toMatch(/^run-051-[a-f0-9]{12}$/u);
    expect(isPathInside(result.worktreeRoot, result.worktreePath)).toBe(true);
  });

  it("resolves absolute worktree roots under that absolute root", () => {
    const result = createTaskWorktreePath({
      repoPath: REPO_PATH,
      config: {
        ...BASE_CONFIG,
        worktreeRoot: ABSOLUTE_WORKTREE_ROOT,
      },
      task: BASE_TASK,
    });

    expect(result.worktreeRoot).toBe(ABSOLUTE_WORKTREE_ROOT);
    expect(result.worktreePath).toBe(join(ABSOLUTE_WORKTREE_ROOT, result.worktreeDirectoryName));
    expect(isPathInside(ABSOLUTE_WORKTREE_ROOT, result.worktreePath)).toBe(true);
  });

  it.each(["../outside", ".codex-runner-worktrees/../../outside"])(
    "rejects traversal worktree roots: %s",
    (worktreeRoot) => {
      expect(() =>
        createTaskWorktreePath({
          repoPath: REPO_PATH,
          config: {
            ...BASE_CONFIG,
            worktreeRoot,
          },
          task: BASE_TASK,
        }),
      ).toThrowWorktreePathError("unsafe_worktree_root");
    },
  );

  it.each(["", ".", "./", "   "])(
    "rejects empty or dot-only worktree roots: %s",
    (worktreeRoot) => {
      expect(() =>
        createTaskWorktreePath({
          repoPath: REPO_PATH,
          config: {
            ...BASE_CONFIG,
            worktreeRoot,
          },
          task: BASE_TASK,
        }),
      ).toThrowWorktreePathError("unsafe_worktree_root");
    },
  );

  it.each([".env/worktrees", ".env.local/worktrees"])(
    "rejects env-like worktree roots: %s",
    (worktreeRoot) => {
      expect(() =>
        createTaskWorktreePath({
          repoPath: REPO_PATH,
          config: {
            ...BASE_CONFIG,
            worktreeRoot,
          },
          task: BASE_TASK,
        }),
      ).toThrowWorktreePathError("unsafe_worktree_root");
    },
  );

  it.each([
    ["protected source path", "src/worktrees", { protectedPaths: ["src/**"] }],
    ["sensitive source path", "secrets/worktrees", { sensitivePaths: ["secrets/**"] }],
    [
      "configured runner root path",
      ".codex-runner-worktrees",
      { protectedPaths: [".codex-runner-worktrees/**"] },
    ],
  ])(
    "rejects a computed worktree path covered by a %s policy",
    (_label, worktreeRoot, policyOverrides) => {
      expect(() =>
        createTaskWorktreePath({
          repoPath: REPO_PATH,
          config: {
            ...BASE_CONFIG,
            worktreeRoot,
          },
          task: BASE_TASK,
          policy: policy(policyOverrides),
        }),
      ).toThrowWorktreePathError("blocked_by_policy");
    },
  );

  it("fails closed when policy pattern evaluation fails", () => {
    expect(() =>
      createTaskWorktreePath({
        repoPath: REPO_PATH,
        config: BASE_CONFIG,
        task: BASE_TASK,
        policy: policy({ protectedPaths: ["src/{unsupported}"] }),
      }),
    ).toThrowWorktreePathError("policy_evaluation_failed");
  });

  it("does not visibly leak unsafe or secret-looking run ids and does not escape the root", () => {
    const secretLookingRunId = `../GITHUB_TOKEN=${["ghp", "worktreepathsecret1234567890"].join(
      "_",
    )}/../../escape`;
    const result = createTaskWorktreePath({
      repoPath: REPO_PATH,
      config: BASE_CONFIG,
      task: {
        ...BASE_TASK,
        runId: secretLookingRunId,
      },
    });

    expect(result.worktreeDirectoryName).toMatch(/^run-[a-f0-9]{12}$/u);
    expect(result.worktreeDirectoryName).not.toContain("github");
    expect(result.worktreeDirectoryName).not.toContain("ghp");
    expect(result.worktreeDirectoryName).not.toContain("secret");
    expect(result.worktreeDirectoryName).not.toContain("escape");
    expect(isPathInside(result.worktreeRoot, result.worktreePath)).toBe(true);
  });

  it("exports the helper and task input type through the runner public entrypoint", () => {
    const typedTask: WorktreePathTaskInputFromEntrypoint = BASE_TASK;

    expect(
      createTaskWorktreePathFromEntrypoint({
        repoPath: REPO_PATH,
        config: BASE_CONFIG,
        task: typedTask,
      }),
    ).toEqual(
      createTaskWorktreePath({
        repoPath: REPO_PATH,
        config: BASE_CONFIG,
        task: BASE_TASK,
      }),
    );
  });
});

const isPathInside = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate);

  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

const policy = (
  overrides: Partial<Pick<RepoPolicy, "protectedPaths" | "sensitivePaths">> = {},
): RepoPolicy => ({
  ...BASE_POLICY,
  ...overrides,
});

expect.extend({
  toThrowWorktreePathError(received: () => unknown, expectedCode: string) {
    try {
      received();
    } catch (error) {
      const pass = error instanceof WorktreePathError && error.code === expectedCode;

      return {
        pass,
        message: () =>
          `expected function to throw WorktreePathError with code ${expectedCode}, received ${
            error instanceof WorktreePathError ? error.code : String(error)
          }`,
      };
    }

    return {
      pass: false,
      message: () => `expected function to throw WorktreePathError with code ${expectedCode}`,
    };
  },
});

declare module "vitest" {
  interface Assertion<T> {
    toThrowWorktreePathError(expectedCode: string): T;
  }
  interface AsymmetricMatchersContaining {
    toThrowWorktreePathError(expectedCode: string): unknown;
  }
}
