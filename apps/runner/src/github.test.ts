import type {
  CommitValidatedChangesOptions,
  CommitValidatedChangesResult,
  CreatePullRequestWithGhOptions,
  GhPrAdapter,
  GitPushAdapter,
  PushedBranchArtifact,
} from "@control-plane/github";
import {
  CONTRACT_VERSION,
  PrArtifactSchema,
  ValidationResultSchema,
  type PrArtifact,
  type RiskFinding,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";
import { describe, expect, it, vi } from "vitest";

import type { ChangeScanResult } from "./changes/scan-changes.js";
import type { RunnerCancellationCheckContext } from "./cancellation.js";
import type { RunnerConfig } from "./config.js";
import { isRunnerError } from "./errors.js";
import { runGithubForTask } from "./github.js";

const COMMIT_HASH = "a".repeat(40);

describe("runner GitHub flow", () => {
  it("commits safe changed files, uses mock push and PR mode, renders a safe PR summary, and returns artifacts", async () => {
    const taskPacket = validTaskPacket();
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts", "docs/task.md"],
      warnings: [warningFinding({ paths: ["docs/task.md"] })],
    });
    const validationResult = validationSuiteResult({
      results: [
        createValidationResult({
          runId: taskPacket.runId,
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const commitValidatedChanges = vi.fn(
      async (options: CommitValidatedChangesOptions): Promise<CommitValidatedChangesResult> => {
        expect(options).toEqual({
          worktreePath: "/tmp/aicp/run-081",
          taskId: "TASK-081",
          runId: "run-081",
          changedFilePaths: ["src/app.ts", "docs/task.md"],
          blockers: [],
          validationShouldBlockCommit: false,
        });

        return {
          taskId: "TASK-081",
          runId: "run-081",
          commitHash: COMMIT_HASH,
          changedFileCount: 2,
        };
      },
    );
    const renderPrSummary = vi.fn(() => "Safe PR body generated from metadata.");

    const result = await runGithubForTask(
      {
        config: runnerConfig({ mockGh: true }),
        taskPacket,
        worktreePath: "/tmp/aicp/run-081",
        changeScanResult,
        validationResult,
      },
      {
        commitValidatedChanges,
        renderPrSummary,
        now: () => "2026-05-22T01:00:00.000Z",
      },
    );

    expect(commitValidatedChanges).toHaveBeenCalledTimes(1);
    expect(renderPrSummary).toHaveBeenCalledWith({
      task: taskPacket,
      changedFilePaths: ["src/app.ts", "docs/task.md"],
      validationResults: validationResult.results,
      riskFindings: changeScanResult.warnings,
    });
    expect(result.commitResult).toEqual({
      taskId: "TASK-081",
      runId: "run-081",
      commitHash: COMMIT_HASH,
      changedFileCount: 2,
    });
    expect(result.pushArtifact).toEqual({
      taskId: "TASK-081",
      runId: "run-081",
      branchName: "aicp/task-081-wire-github",
      remoteName: "origin",
      remoteRef: "refs/heads/aicp/task-081-wire-github",
      commitHash: COMMIT_HASH,
    });
    expect(PrArtifactSchema.safeParse(result.prArtifact).success).toBe(true);
    expect(result.prArtifact).toMatchObject({
      runId: "run-081",
      repository: {
        owner: "acme",
        name: "control-plane",
      },
      branchName: "aicp/task-081-wire-github",
      prNumber: 1,
      prUrl: "https://github.example.test/acme/control-plane/pull/1",
      prTitle: "TASK-081: Wire commit/push/PR into runner flow",
      prStatus: "draft",
      changedFilePaths: ["docs/task.md", "src/app.ts"],
      riskFindings: [warningFinding({ paths: ["docs/task.md"] })],
      createdAt: "2026-05-22T01:00:00.000Z",
    });
  });

  it("passes only changed paths, scan warnings, and validation results into push, summary, and PR helpers", async () => {
    const taskPacket = validTaskPacket();
    const unsafeChangeScanExtras = {
      eventMetadata: {
        diff: "diff --git a/src/private.ts b/src/private.ts",
        patch: "@@ -1,1 +1,1 @@",
        stdout: "raw stdout MUST NOT LEAK",
      },
    };
    const changeScanResult = {
      ...safeChangeScanResult({
        changedFilePaths: ["src/app.ts"],
        warnings: [warningFinding({ paths: ["src/app.ts"] })],
      }),
      ...unsafeChangeScanExtras,
    } as unknown as ChangeScanResult;
    const validationResult = {
      ...validationSuiteResult({
        results: [
          createValidationResult({
            runId: taskPacket.runId,
            command: taskPacket.validation.commands[0]!,
            status: "passed",
            stdoutSummary: "safe validation summary",
          }),
        ],
      }),
      stdout: "raw stdout MUST NOT LEAK",
      stderr: "raw stderr MUST NOT LEAK",
      patch: "@@ -1,1 +1,1 @@",
    } as never as ValidationSuiteResult;
    const commitValidatedChanges = vi.fn(async (): Promise<CommitValidatedChangesResult> => {
      return {
        taskId: "TASK-081",
        runId: "run-081",
        commitHash: COMMIT_HASH,
        changedFileCount: 1,
      };
    });
    const pushAdapter: GitPushAdapter = {
      pushCommittedBranch: vi.fn(async (options) => {
        expect(options).toEqual({
          worktreePath: "/tmp/aicp/run-081",
          taskId: "TASK-081",
          runId: "run-081",
          branchName: "aicp/task-081-wire-github",
          commitHash: COMMIT_HASH,
        });

        return {
          taskId: "TASK-081",
          runId: "run-081",
          branchName: "aicp/task-081-wire-github",
          remoteName: "origin",
          remoteRef: "refs/heads/aicp/task-081-wire-github",
          commitHash: COMMIT_HASH,
        };
      }),
    };
    const ghPrAdapter: GhPrAdapter = {
      createPullRequest: vi.fn(async (options): Promise<PrArtifact> => {
        expect(Object.keys(options).sort()).toEqual([
          "baseBranch",
          "body",
          "branchName",
          "changedFilePaths",
          "createdAt",
          "repository",
          "riskFindings",
          "runId",
          "title",
          "worktreePath",
        ]);
        expect(options).toMatchObject({
          worktreePath: "/tmp/aicp/run-081",
          runId: "run-081",
          repository: {
            owner: "acme",
            name: "control-plane",
          },
          branchName: "aicp/task-081-wire-github",
          baseBranch: "main",
          title: "TASK-081: Wire commit/push/PR into runner flow",
          body: "Safe PR body.",
          changedFilePaths: ["src/app.ts"],
          riskFindings: [warningFinding({ paths: ["src/app.ts"] })],
          createdAt: "2026-05-22T01:05:00.000Z",
        });

        return prArtifactFromOptions(options);
      }),
    };
    const renderPrSummary = vi.fn((input) => {
      expect(Object.keys(input).sort()).toEqual([
        "changedFilePaths",
        "riskFindings",
        "task",
        "validationResults",
      ]);
      expect(input.changedFilePaths).toEqual(["src/app.ts"]);
      expect(input.validationResults).toBe(validationResult.results);
      expect(input.riskFindings).toBe(changeScanResult.warnings);
      return "Safe PR body.";
    });

    const result = await runGithubForTask(
      {
        config: runnerConfig({ mockGh: false }),
        taskPacket,
        worktreePath: "/tmp/aicp/run-081",
        changeScanResult,
        validationResult,
      },
      {
        commitValidatedChanges,
        pushAdapter,
        ghPrAdapter,
        renderPrSummary,
        now: () => "2026-05-22T01:05:00.000Z",
      },
    );

    expect(commitValidatedChanges).toHaveBeenCalledWith({
      worktreePath: "/tmp/aicp/run-081",
      taskId: "TASK-081",
      runId: "run-081",
      changedFilePaths: ["src/app.ts"],
      blockers: [],
      validationShouldBlockCommit: false,
    });
    expect(pushAdapter.pushCommittedBranch).toHaveBeenCalledTimes(1);
    expect(ghPrAdapter.createPullRequest).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("diff --git");
    expect(JSON.stringify(result)).not.toContain("@@ -1,1 +1,1 @@");
    expect(JSON.stringify(result)).not.toContain("raw stdout");
  });

  it("rejects task packets whose repositoryId cannot safely resolve to owner/name before mutating git", async () => {
    const commitValidatedChanges = vi.fn();
    const taskPacket = validTaskPacket({ repositoryId: "repo-local-only" });

    await expect(
      runGithubForTask(
        {
          config: runnerConfig({ mockGh: true }),
          taskPacket,
          worktreePath: "/tmp/aicp/run-081",
          changeScanResult: safeChangeScanResult({ changedFilePaths: ["src/app.ts"] }),
          validationResult: validationSuiteResult(),
        },
        {
          commitValidatedChanges,
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isRunnerError(error)).toBe(true);
      expect(error).toMatchObject({
        category: "repo_path",
        metadata: {
          reason: "invalid_repository_id",
        },
      });
      return true;
    });
    expect(commitValidatedChanges).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "before commit",
      cancellationSequence: [true],
      expectedCommitCalls: 0,
      expectedPushCalls: 0,
      expectedPushArtifactCallbacks: 0,
      expectedPrCalls: 0,
      expectedBoundary: "before_commit",
      expectedCancellationContexts: [{ boundary: "before_commit", runId: "run-081" }],
    },
    {
      name: "before push",
      cancellationSequence: [false, true],
      expectedCommitCalls: 1,
      expectedPushCalls: 0,
      expectedPushArtifactCallbacks: 0,
      expectedPrCalls: 0,
      expectedBoundary: "before_push",
      expectedCancellationContexts: [
        { boundary: "before_commit", runId: "run-081" },
        { boundary: "before_push", runId: "run-081" },
      ],
    },
    {
      name: "before PR creation",
      cancellationSequence: [false, false, true],
      expectedCommitCalls: 1,
      expectedPushCalls: 1,
      expectedPushArtifactCallbacks: 1,
      expectedPrCalls: 0,
      expectedBoundary: "before_pr_creation",
      expectedCancellationContexts: [
        { boundary: "before_commit", runId: "run-081" },
        { boundary: "before_push", runId: "run-081" },
        { boundary: "before_pr_creation", runId: "run-081" },
      ],
    },
  ])(
    "stops the GitHub flow when cancellation is requested $name",
    async ({
      cancellationSequence,
      expectedCommitCalls,
      expectedPushCalls,
      expectedPushArtifactCallbacks,
      expectedPrCalls,
      expectedBoundary,
      expectedCancellationContexts,
    }) => {
      const taskPacket = validTaskPacket();
      const commitValidatedChanges = vi.fn(async (): Promise<CommitValidatedChangesResult> => {
        return {
          taskId: "TASK-081",
          runId: "run-081",
          commitHash: COMMIT_HASH,
          changedFileCount: 1,
        };
      });
      const pushAdapter: GitPushAdapter = {
        pushCommittedBranch: vi.fn(async (): Promise<PushedBranchArtifact> => {
          return {
            taskId: "TASK-081",
            runId: "run-081",
            branchName: "aicp/task-081-wire-github",
            remoteName: "origin",
            remoteRef: "refs/heads/aicp/task-081-wire-github",
            commitHash: COMMIT_HASH,
          };
        }),
      };
      const ghPrAdapter: GhPrAdapter = {
        createPullRequest: vi.fn(async (options) => prArtifactFromOptions(options)),
      };
      const onPushArtifact = vi.fn();
      const checkCancellation = vi.fn(async (context: RunnerCancellationCheckContext) => {
        expect(context.runId).toBe("run-081");
        return cancellationSequence.shift() ?? false;
      });

      await expect(
        runGithubForTask(
          {
            config: runnerConfig({ mockGh: false }),
            taskPacket,
            worktreePath: "/tmp/aicp/run-081",
            changeScanResult: safeChangeScanResult({ changedFilePaths: ["src/app.ts"] }),
            validationResult: validationSuiteResult(),
            onPushArtifact,
          },
          {
            commitValidatedChanges,
            pushAdapter,
            ghPrAdapter,
            renderPrSummary: () => "Safe PR body.",
            checkCancellation,
          },
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expect(isRunnerError(error)).toBe(true);
        expect(error).toMatchObject({
          category: "cancelled",
          metadata: {
            boundary: expectedBoundary,
          },
        });
        return true;
      });
      expect(commitValidatedChanges).toHaveBeenCalledTimes(expectedCommitCalls);
      expect(pushAdapter.pushCommittedBranch).toHaveBeenCalledTimes(expectedPushCalls);
      expect(onPushArtifact).toHaveBeenCalledTimes(expectedPushArtifactCallbacks);
      expect(ghPrAdapter.createPullRequest).toHaveBeenCalledTimes(expectedPrCalls);
      expect(checkCancellation.mock.calls.map(([context]) => context)).toEqual(
        expectedCancellationContexts,
      );
    },
  );
});

const runnerConfig = ({ mockGh }: { mockGh: boolean }): RunnerConfig => ({
  worktreeRoot: ".codex-runner-worktrees",
  mockModes: {
    codex: true,
    gh: mockGh,
  },
});

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "TASK-081",
  workspaceId: "workspace-081",
  repositoryId: "acme/control-plane",
  runId: "run-081",
  mode: "execute",
  objective: "Wire commit/push/PR into runner flow.",
  acceptanceCriteria: ["Runner produces a draft PR artifact."],
  source: {
    type: "manual",
    externalId: "manual-081",
    title: "Wire commit/push/PR into runner flow",
    url: "https://example.test/tasks/TASK-081",
  },
  repo: {
    localPath: "/repo/from-task-packet",
    defaultBranch: "main",
    targetBranch: "aicp/task-081-wire-github",
    worktreePath: "/tmp/aicp/run-081",
  },
  context: {
    files: ["BACKLOG.md"],
    notes: ["Use mocked gh in Sprint 1 tests."],
  },
  policy: {
    contractVersion: CONTRACT_VERSION,
    protectedBranches: ["main"],
    protectedPaths: ["SECURITY_MODEL.md"],
    sensitivePaths: [".env", ".env.*"],
    warningPaths: {
      packageLocks: ["pnpm-lock.yaml"],
      migrations: ["db/migrations/**"],
      infrastructure: [".github/**"],
      auth: ["apps/web/src/auth/**"],
      billing: ["apps/web/src/billing/**"],
    },
    validationCommands: [
      {
        id: "test",
        label: "Run tests",
        command: "pnpm test",
        timeoutSeconds: 120,
        required: true,
      },
    ],
    maxChangedFiles: 25,
    maxDiffLines: 1_000,
    allowUntrackedFiles: false,
    dryRunChecks: ["repo_path_exists", "git_repository", "repo_clean"],
  },
  validation: {
    commands: [
      {
        id: "test",
        label: "Run tests",
        command: "pnpm test",
        timeoutSeconds: 120,
        required: true,
      },
    ],
  },
  createdAt: "2026-05-22T01:00:00.000Z",
  ...overrides,
});

const safeChangeScanResult = ({
  changedFilePaths = [],
  blockers = [],
  warnings = [],
}: {
  changedFilePaths?: string[];
  blockers?: RiskFinding[];
  warnings?: RiskFinding[];
} = {}): ChangeScanResult => {
  const counts: ChangeScanResult["counts"] = {
    changedFileCount: changedFilePaths.length,
    addedCount: 0,
    modifiedCount: changedFilePaths.length,
    deletedCount: 0,
    untrackedCount: 0,
    omittedPathCount: 0,
    evaluatedFileCount: changedFilePaths.length,
    trackedDiffLineCount: changedFilePaths.length * 4,
    untrackedDiffLineCount: 0,
    diffLineCount: changedFilePaths.length * 4,
  };

  return {
    changedFiles: {
      paths: changedFilePaths,
      addedPaths: [],
      modifiedPaths: changedFilePaths,
      deletedPaths: [],
      untrackedPaths: [],
      counts: {
        changedFileCount: counts.changedFileCount,
        addedCount: counts.addedCount,
        modifiedCount: counts.modifiedCount,
        deletedCount: counts.deletedCount,
        untrackedCount: counts.untrackedCount,
        omittedPathCount: counts.omittedPathCount,
      },
    },
    counts,
    blockers,
    warnings,
    shouldBlock: blockers.length > 0,
    eventMetadata: {
      changedFilePaths,
      counts,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      shouldBlock: blockers.length > 0,
      blockers: blockers.map(({ id, severity, category, paths }) => ({
        id,
        severity,
        category,
        paths,
      })),
      warnings: warnings.map(({ id, severity, category, paths }) => ({
        id,
        severity,
        category,
        paths,
      })),
    },
  };
};

const validationSuiteResult = ({
  status = "passed",
  shouldBlockCommit = false,
  results = [
    createValidationResult({
      runId: "run-081",
      command: validTaskPacket().validation.commands[0]!,
      status: "passed",
    }),
  ],
  warnings = [],
  blockers = [],
}: Partial<ValidationSuiteResult> = {}): ValidationSuiteResult => ({
  status,
  shouldBlockCommit,
  results,
  warnings,
  blockers,
});

const createValidationResult = ({
  runId,
  command,
  status,
  exitCode,
  durationMs = 12,
  stdoutSummary = "",
  stderrSummary = "",
  redactionApplied = true,
}: {
  runId: string;
  command: TaskPacket["validation"]["commands"][number];
  status: ValidationResult["status"];
  exitCode?: number | null;
  durationMs?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  redactionApplied?: boolean;
}): ValidationResult =>
  ValidationResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `validation:${runId}:${command.id}`,
    runId,
    commandId: command.id,
    commandLabel: command.label,
    command: command.command,
    status,
    exitCode:
      exitCode === undefined
        ? status === "passed"
          ? 0
          : status === "failed"
            ? 1
            : null
        : exitCode,
    durationMs,
    stdoutSummary,
    stderrSummary,
    redactionApplied,
    startedAt: "2026-05-22T01:00:00.000Z",
    finishedAt: "2026-05-22T01:00:01.000Z",
  });

const warningFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk:package_lock",
  severity: "warning",
  category: "package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  ...overrides,
});

const prArtifactFromOptions = (options: CreatePullRequestWithGhOptions): PrArtifact =>
  PrArtifactSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `pr:${options.runId}:81`,
    runId: options.runId,
    repository: options.repository,
    branchName: options.branchName,
    prNumber: 81,
    prUrl: `https://github.example.test/${options.repository.owner}/${options.repository.name}/pull/81`,
    prTitle: options.title,
    prStatus: "draft",
    changedFilePaths: options.changedFilePaths,
    riskFindings: options.riskFindings,
    createdAt: options.createdAt ?? "2026-05-22T01:00:00.000Z",
  });
