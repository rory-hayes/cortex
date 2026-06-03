import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  DryRunResultSchema,
  type DryRunCheckResult,
  type DryRunCheckResultStatus,
  type RepoPolicy,
  type RiskFinding,
  type RunnerCapabilities,
  type TaskPacket,
} from "@control-plane/shared";
import { describe, expect, it, vi } from "vitest";

import { RepoPathValidationError } from "../repo-path.js";
import {
  runDryRun,
  type RunDryRunCheckResult,
  type RunDryRunDependencies,
  type RunDryRunOptions,
} from "./run-dry-run.js";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const REPO_PATH = "/private/tmp/control-plane/repo";
const OBJECTIVE_TEXT = "OBJECTIVE TEXT MUST NOT LEAK";
const SOURCE_TITLE_TEXT = "SOURCE TITLE MUST NOT LEAK";
const CONTEXT_NOTE_TEXT = "CONTEXT NOTE MUST NOT LEAK";
const RAW_COMMAND_OUTPUT = "raw command output MUST NOT LEAK";
const DIFF_TEXT = "diff --git a/src/private.ts b/src/private.ts MUST NOT LEAK";
const PATCH_TEXT = "patch contains private code MUST NOT LEAK";
const FILE_CONTENT_TEXT = "export const privateValue = 'MUST NOT LEAK';";

const BASE_POLICY: RepoPolicy = {
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["apps/**"],
  sensitivePaths: ["secrets/**"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["db/migrations/**"],
    infrastructure: [".github/**"],
    auth: ["apps/web/auth/**"],
    billing: ["apps/web/billing/**"],
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
  dryRunChecks: [...DRY_RUN_CHECKS],
};

const BASE_TASK: TaskPacket = {
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-dry-run",
  repositoryId: "repo-dry-run",
  runId: "run-dry-run",
  mode: "execute",
  objective: OBJECTIVE_TEXT,
  acceptanceCriteria: ["Dry run result is schema valid."],
  source: {
    type: "manual",
    title: SOURCE_TITLE_TEXT,
  },
  repo: {
    localPath: REPO_PATH,
    defaultBranch: "main",
    targetBranch: "codex/TASK-047-compose-dry-run-result",
    worktreePath: "/private/tmp/control-plane/worktrees/TASK-047",
  },
  context: {
    files: ["src/private-context-file.ts"],
    notes: [CONTEXT_NOTE_TEXT],
  },
  policy: BASE_POLICY,
  validation: {
    commands: BASE_POLICY.validationCommands,
  },
  createdAt: "2026-05-20T11:00:00.000Z",
};

describe("runDryRun", () => {
  it("returns a schema-valid result with every documented check in canonical order and capabilities", async () => {
    const capabilities = runnerCapabilities();
    const dependencies = passingDependencies({ capabilities });

    const result = await runDryRun(runOptions(), dependencies);

    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      id: "dry-run:run-dry-run",
      runId: "run-dry-run",
      status: "passed",
      capabilities,
      blockers: [],
      warnings: [],
      createdAt: FIXED_NOW,
    });
    expect(result.checks.map((check) => check.id)).toEqual([...DRY_RUN_CHECKS]);
    expect(result.checks.map((check) => check.status)).toEqual(DRY_RUN_CHECKS.map(() => "passed"));
    expect(dependencies.validateRepoPath).toHaveBeenCalledWith(REPO_PATH);
    expect(dependencies.parseRepoPolicy).toHaveBeenCalledWith(REPO_PATH);
    expect(dependencies.detectRunnerCapabilities).toHaveBeenCalledWith({ cwd: REPO_PATH });
    expect(dependencies.checkCleanRepo).toHaveBeenCalledWith(REPO_PATH);
    expect(dependencies.checkProtectedBranch).toHaveBeenCalledWith(REPO_PATH, BASE_POLICY);
    expect(dependencies.checkValidationConfig).toHaveBeenCalledWith(BASE_POLICY);
    expect(dependencies.checkRequiredTools).toHaveBeenCalledWith(capabilities, {
      mode: BASE_TASK.mode,
      validation: BASE_TASK.validation,
    });
    expect(dependencies.checkWorktreeReadiness).toHaveBeenCalledWith(REPO_PATH, BASE_TASK.repo);
    expect(dependencies.checkPathPolicyReadiness).toHaveBeenCalledWith(BASE_POLICY);
    expectSafeSerializedResult(result);
  });

  it("derives failed status when any check returns a blocker", async () => {
    const blocker = riskFinding({
      id: "risk:dirty_repo",
      severity: "blocked",
      category: "dirty_repo",
      message: "Repository is dirty.",
    });
    const result = await runDryRun(
      runOptions(),
      passingDependencies({
        checkCleanRepo: async () => checkResult("repo_clean", "failed", { blockers: [blocker] }),
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual([blocker]);
    expect(result.warnings).toEqual([]);
    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
  });

  it("derives warning status when warnings exist without blockers", async () => {
    const warning = riskFinding({
      id: "risk:sensitive_path:explicit_patterns",
      severity: "warning",
      category: "sensitive_path",
      message: "Explicit sensitive path patterns are not configured.",
    });
    const result = await runDryRun(
      runOptions(),
      passingDependencies({
        checkPathPolicyReadiness: () =>
          checkResult("protected_and_sensitive_paths_configured", "warning", {
            warnings: [warning],
          }),
      }),
    );

    expect(result.status).toBe("warning");
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([warning]);
    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
  });

  it("derives passed status when no blockers or warnings exist", async () => {
    const result = await runDryRun(runOptions(), passingDependencies());

    expect(result.status).toBe("passed");
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("fails repo_path_exists, skips repo-dependent checks, and adds a blocker when the repo path is missing", async () => {
    const dependencies = passingDependencies({
      validateRepoPath: async () => {
        throw new RepoPathValidationError({
          code: "path_missing",
          repoPath: REPO_PATH,
          message: "Repository path does not exist.",
        });
      },
    });

    const result = await runDryRun(runOptions(), dependencies);

    expect(result.status).toBe("failed");
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ["repo_path_exists", "failed"],
      ["git_repository", "skipped"],
      ["repo_clean", "skipped"],
      ["current_branch_not_protected", "skipped"],
      ["repo_policy_exists_and_parses", "skipped"],
      ["validation_commands_configured", "skipped"],
      ["required_tools_available", "passed"],
      ["branch_name_available", "skipped"],
      ["worktree_path_available", "skipped"],
      ["protected_and_sensitive_paths_configured", "skipped"],
      ["runner_capabilities_satisfied", "passed"],
    ]);
    expect(result.blockers).toEqual([
      riskFinding({
        id: "risk:missing_mapping:repo_path",
        severity: "blocked",
        category: "missing_mapping",
        message: "Repository path does not exist or is not a readable directory.",
      }),
    ]);
    expect(dependencies.parseRepoPolicy).not.toHaveBeenCalled();
    expect(dependencies.checkCleanRepo).not.toHaveBeenCalled();
    expect(dependencies.checkWorktreeReadiness).not.toHaveBeenCalled();
    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
  });

  it("passes repo_path_exists, fails git_repository, and skips git and policy-dependent checks for a non-git repo", async () => {
    const dependencies = passingDependencies({
      validateRepoPath: async () => {
        throw new RepoPathValidationError({
          code: "not_git_repository",
          repoPath: REPO_PATH,
          message: "Repository path is not a Git working tree.",
        });
      },
    });

    const result = await runDryRun(runOptions(), dependencies);

    expect(result.status).toBe("failed");
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ["repo_path_exists", "passed"],
      ["git_repository", "failed"],
      ["repo_clean", "skipped"],
      ["current_branch_not_protected", "skipped"],
      ["repo_policy_exists_and_parses", "skipped"],
      ["validation_commands_configured", "skipped"],
      ["required_tools_available", "passed"],
      ["branch_name_available", "skipped"],
      ["worktree_path_available", "skipped"],
      ["protected_and_sensitive_paths_configured", "skipped"],
      ["runner_capabilities_satisfied", "passed"],
    ]);
    expect(result.blockers).toEqual([
      riskFinding({
        id: "risk:missing_mapping:git_repository",
        severity: "blocked",
        category: "missing_mapping",
        message: "Repository path is not a Git working tree.",
      }),
    ]);
    expect(dependencies.parseRepoPolicy).not.toHaveBeenCalled();
    expect(dependencies.checkCleanRepo).not.toHaveBeenCalled();
    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
  });

  it("fails repo_policy_exists_and_parses and skips policy-dependent checks when policy parsing fails", async () => {
    const dependencies = passingDependencies({
      parseRepoPolicy: async () => {
        throw new Error("policy body must not leak");
      },
    });

    const result = await runDryRun(runOptions(), dependencies);

    expect(result.status).toBe("failed");
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ["repo_path_exists", "passed"],
      ["git_repository", "passed"],
      ["repo_clean", "passed"],
      ["current_branch_not_protected", "skipped"],
      ["repo_policy_exists_and_parses", "failed"],
      ["validation_commands_configured", "skipped"],
      ["required_tools_available", "passed"],
      ["branch_name_available", "passed"],
      ["worktree_path_available", "passed"],
      ["protected_and_sensitive_paths_configured", "skipped"],
      ["runner_capabilities_satisfied", "passed"],
    ]);
    expect(result.blockers).toEqual([
      riskFinding({
        id: "risk:missing_validation:repo_policy",
        severity: "blocked",
        category: "missing_validation",
        message: "Repo policy file is missing or invalid.",
      }),
    ]);
    expect(dependencies.checkProtectedBranch).not.toHaveBeenCalled();
    expect(dependencies.checkValidationConfig).not.toHaveBeenCalled();
    expect(dependencies.checkPathPolicyReadiness).not.toHaveBeenCalled();
    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
  });

  it("does not include task prose, raw command output, diffs, patches, or file contents in the result", async () => {
    const result = await runDryRun(runOptions(), passingDependencies());

    expectSafeSerializedResult(result);
  });

  it("rejects unsafe metadata returned by an injected check through final schema validation", async () => {
    await expect(
      runDryRun(
        runOptions(),
        passingDependencies({
          checkCleanRepo: async () => ({
            check: {
              ...dryRunCheck("repo_clean", "passed"),
              metadata: {
                diff: DIFF_TEXT,
                nested: {
                  sourceCode: FILE_CONTENT_TEXT,
                },
              },
            },
            blockers: [],
            warnings: [],
          }),
        }),
      ),
    ).rejects.toThrow(/unsafe key/i);
  });

  it("exports runDryRun and related types from the runner entrypoint", () => {
    const options: RunDryRunOptions = runOptions();
    const dependencies: RunDryRunDependencies = passingDependencies();
    const check: RunDryRunCheckResult = checkResult("repo_clean", "passed");

    expect(options.repoPath).toBe(REPO_PATH);
    expect(dependencies.detectRunnerCapabilities).toBeDefined();
    expect(check.check.id).toBe("repo_clean");
  });
});

const runOptions = (overrides: Partial<RunDryRunOptions> = {}): RunDryRunOptions => ({
  repoPath: REPO_PATH,
  taskPacket: BASE_TASK,
  ...overrides,
});

const passingDependencies = (
  overrides: Partial<RunDryRunDependencies> & {
    capabilities?: RunnerCapabilities;
  } = {},
): RunDryRunDependencies => {
  const capabilities = overrides.capabilities ?? runnerCapabilities();

  return {
    now: () => FIXED_NOW,
    validateRepoPath: vi.fn(async () => ({ repoPath: REPO_PATH })),
    parseRepoPolicy: vi.fn(async () => BASE_POLICY),
    detectRunnerCapabilities: vi.fn(async () => capabilities),
    checkCleanRepo: vi.fn(async () => checkResult("repo_clean", "passed")),
    checkProtectedBranch: vi.fn(async () => checkResult("current_branch_not_protected", "passed")),
    checkValidationConfig: vi.fn(() => checkResult("validation_commands_configured", "passed")),
    checkRequiredTools: vi.fn(() => checkResult("required_tools_available", "passed")),
    checkWorktreeReadiness: vi.fn(async () => ({
      checks: [
        dryRunCheck("branch_name_available", "passed"),
        dryRunCheck("worktree_path_available", "passed"),
      ],
      blockers: [],
      warnings: [],
    })),
    checkPathPolicyReadiness: vi.fn(() =>
      checkResult("protected_and_sensitive_paths_configured", "passed"),
    ),
    ...overrides,
  };
};

const runnerCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-local",
  os: {
    platform: "darwin",
    release: "25.0.0",
    arch: "arm64",
  },
  shell: "/bin/zsh",
  tools: {
    git: {
      available: true,
      version: "2.49.0",
    },
    gh: {
      available: true,
      version: "2.72.0",
    },
    codex: {
      available: true,
      version: "1.2.3",
    },
    node: {
      available: true,
      version: "24.0.0",
    },
    npm: {
      available: false,
    },
    pnpm: {
      available: true,
      version: "9.15.9",
    },
    yarn: {
      available: false,
    },
    python: {
      available: false,
    },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: false,
  reportedAt: FIXED_NOW,
  ...overrides,
});

const checkResult = (
  id: DryRunCheckResult["id"],
  status: DryRunCheckResultStatus,
  options: {
    blockers?: RiskFinding[];
    warnings?: RiskFinding[];
  } = {},
): RunDryRunCheckResult => ({
  check: dryRunCheck(id, status),
  blockers: options.blockers ?? [],
  warnings: options.warnings ?? [],
});

const dryRunCheck = (
  id: DryRunCheckResult["id"],
  status: DryRunCheckResultStatus,
): DryRunCheckResult => ({
  id,
  label: labelForCheck(id),
  status,
  message: `${labelForCheck(id)} ${status}.`,
  metadata: {
    verified: status === "passed",
  },
});

const labelForCheck = (id: DryRunCheckResult["id"]): string =>
  id
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const riskFinding = (
  input: Omit<RiskFinding, "paths"> & {
    paths?: string[];
  },
): RiskFinding => ({
  ...input,
  paths: input.paths ?? [],
});

const expectSafeSerializedResult = (result: unknown) => {
  const serialized = JSON.stringify(result);
  const unsafeValues = [
    OBJECTIVE_TEXT,
    SOURCE_TITLE_TEXT,
    CONTEXT_NOTE_TEXT,
    RAW_COMMAND_OUTPUT,
    DIFF_TEXT,
    PATCH_TEXT,
    FILE_CONTENT_TEXT,
    "policy body must not leak",
    "objective",
    "sourceCode",
    "stdoutSummary",
    "stderrSummary",
  ];

  for (const unsafe of unsafeValues) {
    expect(serialized).not.toContain(unsafe);
  }
};
