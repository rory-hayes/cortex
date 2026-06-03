import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  DryRunResultSchema,
  RunEventSchema,
  ValidationResultSchema,
  createRunEventIdempotencyKey,
  type DryRunCheckResult,
  type DryRunCheckResultStatus,
  type DryRunResult,
  type PrArtifact,
  type RunEvent,
  type RunnerCapabilities,
  type RiskFinding,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";
import { describe, expect, it, vi } from "vitest";

import { RunnerConfigLoaderError } from "./config.js";
import type { ChangeScanResult } from "./changes/scan-changes.js";
import type { RunnerCancellationBoundary } from "./cancellation.js";
import { isRunnerError, RunnerError } from "./errors.js";
import { PrepareRepairWorktreeError } from "./repair.js";
import type { RunGithubForTaskResult } from "./github.js";
import { runRunner, runRunnerForTaskPacket } from "./run.js";
import { TaskPacketLoaderError } from "./task-packet-loader.js";

const OBJECTIVE_TEXT = "OBJECTIVE TEXT MUST NOT LEAK";
const SOURCE_TITLE_TEXT = "SOURCE TITLE MUST NOT LEAK";
const CONTEXT_FILE_TEXT = "src/private-context-file.ts";
const CONTEXT_NOTE_TEXT = "CONTEXT NOTE MUST NOT LEAK";
const COMMIT_HASH = "a".repeat(40);

describe("runner dry-run flow", () => {
  it("loads config and task packet, runs readiness dry run, and writes dry-run start and success events", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const configPath = await writeJsonFile(join(workspace, "runner-config.json"), {
      eventsOut: eventsOutPath,
    });
    const taskPacket = validTaskPacket({ runId: "run-skeleton-success" });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-skeleton-success",
      status: "passed",
    });
    const runDryRun = vi.fn(async (options: { repoPath: string; taskPacket: TaskPacket }) => {
      void options;
      return readinessResult;
    });
    const dependencies = {
      runDryRun,
      now: createClock(["2026-05-20T08:00:00.000Z", "2026-05-20T08:00:01.000Z"]),
    };

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: true,
        configPath,
      },
      dependencies,
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-skeleton-success",
      eventsOut: eventsOutPath,
      dryRunResult: readinessResult,
    });
    expect(runDryRun).toHaveBeenCalledTimes(1);
    const dryRunCall = expectRunDryRunCall(runDryRun);
    expect(dryRunCall.repoPath).toBe(repoPath);
    expect(dryRunCall.taskPacket).toMatchObject(taskPacket);
    expectComputedWorktreePath({
      repoPath,
      runDirectoryPrefix: "run-skeleton-success",
      taskPacket: dryRunCall.taskPacket,
    });

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "dry_run_passed"]);
    expect(events.map((event) => event.idempotencyKey)).toEqual([
      createRunEventIdempotencyKey({
        runId: "run-skeleton-success",
        stableStepName: "dry_run_running",
        attempt: 1,
      }),
      createRunEventIdempotencyKey({
        runId: "run-skeleton-success",
        stableStepName: "dry_run_passed",
        attempt: 1,
      }),
    ]);

    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expect(event.runId).toBe("run-skeleton-success");
      expect(event.metadata).toMatchObject({
        taskPacketId: "task-packet-skeleton",
        repositoryId: "repo-skeleton",
        dryRun: true,
      });
      expectSafeRunEventPayload(event);
    }
    expect(events[1]).toMatchObject({
      severity: "info",
      metadata: {
        resultId: "dry-run:run-skeleton-success",
        resultStatus: "passed",
        checkCount: DRY_RUN_CHECKS.length,
        blockerCount: 0,
        warningCount: 0,
      },
    });
  });

  it("uses CLI events output before config events output", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const cliEventsOutPath = join(workspace, "cli-events.jsonl");
    const configEventsOutPath = join(workspace, "config-events.jsonl");
    const configPath = await writeJsonFile(join(workspace, "runner-config.json"), {
      eventsOut: configEventsOutPath,
    });
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({ runId: "run-events-precedence" }),
    );
    const readinessResult = dryRunResult({
      runId: "run-events-precedence",
      status: "passed",
    });
    const dependencies = {
      runDryRun: async () => readinessResult,
    };

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: true,
        eventsOut: cliEventsOutPath,
        configPath,
      },
      dependencies,
    );

    expect(result.eventsOut).toBe(cliEventsOutPath);
    await expect(readRunEvents(cliEventsOutPath)).resolves.toHaveLength(2);
    await expect(access(configEventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("executes with an injected task packet without reading a task file", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPacket = validTaskPacket({
      runId: "run-in-memory-task-packet",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "codex/TASK-120-in-memory-task-packet",
      },
    });
    const readinessResult = dryRunResult({
      runId: "run-in-memory-task-packet",
      status: "passed",
    });
    const loadTaskPacket = vi.fn(async () => {
      throw new Error("task file loader should not be called");
    });
    const runDryRun = vi.fn(async () => readinessResult);

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        taskPacket,
        dryRun: true,
        eventsOut: eventsOutPath,
      },
      {
        loadTaskPacket,
        runDryRun,
        now: createClock(["2026-05-23T10:30:00.000Z", "2026-05-23T10:30:01.000Z"]),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-in-memory-task-packet",
      eventsOut: eventsOutPath,
      dryRunResult: readinessResult,
    });
    expect(loadTaskPacket).not.toHaveBeenCalled();
    const dryRunCall = expectRunDryRunCall(runDryRun);
    expect(dryRunCall.repoPath).toBe(repoPath);
    expect(dryRunCall.taskPacket).toMatchObject(taskPacket);
    expectComputedWorktreePath({
      repoPath,
      runDirectoryPrefix: "run-in-memory-task-packet",
      taskPacket: dryRunCall.taskPacket,
    });

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.runId)).toEqual([
      "run-in-memory-task-packet",
      "run-in-memory-task-packet",
    ]);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "dry_run_passed"]);
  });

  it("exposes a direct task-packet helper for hosted protocol jobs", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPacket = validTaskPacket({
      runId: "run-direct-task-packet-helper",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "codex/TASK-120-direct-task-packet-helper",
      },
    });
    const readinessResult = dryRunResult({
      runId: "run-direct-task-packet-helper",
      status: "passed",
    });
    const loadTaskPacket = vi.fn(async () => {
      throw new Error("task file loader should not be called");
    });
    const runDryRun = vi.fn(async () => readinessResult);

    const result = await runRunnerForTaskPacket(
      {
        repo: repoPath,
        taskPacket,
        dryRun: true,
        eventsOut: eventsOutPath,
      },
      {
        loadTaskPacket,
        runDryRun,
        now: createClock(["2026-05-23T10:31:00.000Z", "2026-05-23T10:31:01.000Z"]),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-direct-task-packet-helper",
      eventsOut: eventsOutPath,
      dryRunResult: readinessResult,
    });
    expect(loadTaskPacket).not.toHaveBeenCalled();
    const dryRunCall = expectRunDryRunCall(runDryRun);
    expect(dryRunCall.repoPath).toBe(repoPath);
    expect(dryRunCall.taskPacket).toMatchObject(taskPacket);
    expectComputedWorktreePath({
      repoPath,
      runDirectoryPrefix: "run-direct-task-packet-helper",
      taskPacket: dryRunCall.taskPacket,
    });
  });

  it("writes dry-run start and blocked events for a failed readiness result without throwing", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const configPath = await writeJsonFile(join(workspace, "runner-config.json"), {
      eventsOut: eventsOutPath,
    });
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({ runId: "run-repo-blocked" }),
    );
    const blocker = riskFinding({
      id: "risk:missing_mapping:git_repository",
      severity: "blocked",
      category: "missing_mapping",
      message: "Repository path is not a Git working tree.",
    });
    const readinessResult = dryRunResult({
      runId: "run-repo-blocked",
      status: "failed",
      blockers: [blocker],
      checks: dryRunChecks("failed"),
    });
    const runDryRun = vi.fn(async () => readinessResult);
    const dependencies = {
      runDryRun,
      now: createClock(["2026-05-20T08:10:00.000Z", "2026-05-20T08:10:01.000Z"]),
    };

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: true,
        configPath,
      },
      dependencies,
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.dryRunResult).toBe(readinessResult);
    expect(runDryRun).toHaveBeenCalledTimes(1);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "blocked"]);
    expect(events[1]).toMatchObject({
      severity: "blocked",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-repo-blocked",
        stableStepName: "dry_run_blocked",
        attempt: 1,
      }),
      metadata: {
        taskPacketId: "task-packet-skeleton",
        repositoryId: "repo-skeleton",
        dryRun: true,
        resultId: "dry-run:run-repo-blocked",
        resultStatus: "failed",
        blockerCount: 1,
        warningCount: 0,
        blockers: [
          {
            id: "risk:missing_mapping:git_repository",
            severity: "blocked",
            category: "missing_mapping",
            paths: [],
          },
        ],
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("treats warning readiness results as passed with warning severity and safe terminal metadata", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({ runId: "run-warning-result" }),
    );
    const warning = riskFinding({
      id: "risk:missing_capability:optional_tool",
      severity: "warning",
      category: "missing_capability",
      message: "Optional tool is unavailable.",
    });
    const readinessResult = dryRunResult({
      runId: "run-warning-result",
      status: "warning",
      warnings: [warning],
      checks: dryRunChecks("warning"),
    });
    const dependencies = {
      runDryRun: async () => readinessResult,
      now: createClock(["2026-05-20T08:20:00.000Z", "2026-05-20T08:20:01.000Z"]),
    };

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: true,
        eventsOut: eventsOutPath,
      },
      dependencies,
    );

    expect(result.exitCode).toBe(0);
    expect(result.dryRunResult).toBe(readinessResult);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "dry_run_passed"]);
    expect(events[1]).toMatchObject({
      severity: "warning",
      metadata: {
        resultId: "dry-run:run-warning-result",
        resultStatus: "warning",
        checkCount: DRY_RUN_CHECKS.length,
        blockerCount: 0,
        warningCount: 1,
        warnings: [
          {
            id: "risk:missing_capability:optional_tool",
            severity: "warning",
            category: "missing_capability",
            paths: [],
          },
        ],
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("runs validation after successful change scanning and emits safe validation metadata", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-worktree-event");
    const taskPacket = validTaskPacket({
      runId: "run-worktree-event",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-054-worktree-event",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-worktree-event",
      status: "passed",
    });
    const worktreeResult = {
      runId: "run-worktree-event",
      branchName: "aicp/task-054-worktree-event",
      baseBranch: "main",
      worktreePath,
      metadata: {
        branchName: "aicp/task-054-worktree-event",
        baseBranch: "main",
        worktreeCreated: true,
        gitExitCode: 0,
        stdoutSummary: "raw stdout MUST NOT LEAK",
        stderrSummary: "raw stderr MUST NOT LEAK",
        patch: "diff --git a/src/private.ts b/src/private.ts",
      },
    };
    const runDryRun = vi.fn(async () => readinessResult);
    const createWorktree = vi.fn(async () => worktreeResult);
    const codexResult = {
      adapterMode: "local",
      status: "succeeded",
      exitCode: 0,
      durationMs: 17,
      redactionApplied: true,
    } as const;
    const runCodex = vi.fn(async () => codexResult);
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts", "docs/readme.md"],
    });
    const scanChanges = vi.fn(async () => changeScanResult);
    const validationResult = validationSuiteResult({
      runId: "run-worktree-event",
      results: [
        createValidationResult({
          runId: "run-worktree-event",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
          stdoutSummary: "tests passed",
        }),
      ],
    });
    const runValidation = vi.fn(async () => validationResult);
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runGithub = vi.fn(async () => githubResult);
    const dependencies = {
      runDryRun,
      createWorktree,
      runCodex,
      scanChanges,
      runValidation,
      runGithub,
      now: createClock([
        "2026-05-20T09:00:00.000Z",
        "2026-05-20T09:00:01.000Z",
        "2026-05-20T09:00:02.000Z",
        "2026-05-20T09:00:03.000Z",
        "2026-05-20T09:00:04.000Z",
        "2026-05-20T09:00:05.000Z",
        "2026-05-20T09:00:06.000Z",
        "2026-05-20T09:00:07.000Z",
        "2026-05-20T09:00:08.000Z",
        "2026-05-20T09:00:09.000Z",
        "2026-05-20T09:00:10.000Z",
      ]),
    };

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      dependencies,
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-worktree-event",
      eventsOut: eventsOutPath,
      dryRunResult: readinessResult,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
      githubResult,
    });
    expect(createWorktree).toHaveBeenCalledTimes(1);
    expect(createWorktree).toHaveBeenCalledWith({
      repoPath,
      runId: "run-worktree-event",
      dryRunResult: readinessResult,
      targetBranch: "aicp/task-054-worktree-event",
      defaultBranch: "main",
      worktreePath,
    });
    expect(runCodex).toHaveBeenCalledWith({
      config: {
        worktreeRoot: ".codex-runner-worktrees",
        mockModes: {
          codex: false,
          gh: false,
        },
      },
      taskPacket,
      worktreePath,
    });
    expect(scanChanges).toHaveBeenCalledTimes(1);
    expect(scanChanges).toHaveBeenCalledWith({
      worktreePath,
      policy: taskPacket.policy,
    });
    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(runValidation).toHaveBeenCalledWith({
      taskPacket,
      worktreePath,
    });
    expect(runGithub).toHaveBeenCalledWith({
      config: {
        worktreeRoot: ".codex-runner-worktrees",
        mockModes: {
          codex: false,
          gh: false,
        },
      },
      taskPacket,
      worktreePath,
      changeScanResult,
      validationResult,
      onPushArtifact: expect.any(Function),
    });

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);

    const worktreeEvent = events[2];
    expect(RunEventSchema.safeParse(worktreeEvent).success).toBe(true);
    expect(worktreeEvent?.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event",
        stableStepName: "worktree_created",
        attempt: 1,
      }),
    );
    expect(worktreeEvent?.metadata).toEqual({
      branchName: "aicp/task-054-worktree-event",
      worktreePath,
    });
    expect(events[3]?.metadata).toEqual({
      adapterMode: "local",
    });
    expect(events[4]?.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event",
        stableStepName: "codex_finished",
        attempt: 1,
      }),
    );
    expect(events[4]?.metadata).toEqual({
      adapterMode: "local",
      status: "succeeded",
      exitCode: 0,
      durationMs: 17,
      redactionApplied: true,
    });
    expect(events[5]).toMatchObject({
      severity: "info",
      metadata: {
        changedFilePaths: ["src/app.ts", "docs/readme.md"],
        blockerCount: 0,
        warningCount: 0,
        shouldBlock: false,
      },
    });
    expect(events[6]).toMatchObject({
      severity: "info",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-worktree-event",
        stableStepName: "validation_running",
        attempt: 1,
      }),
      metadata: {
        commandCount: 1,
        requiredCommandCount: 1,
      },
    });
    expect(events[7]).toMatchObject({
      severity: "info",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-worktree-event",
        stableStepName: "validation_completed",
        attempt: 1,
      }),
      metadata: {
        status: "passed",
        shouldBlockCommit: false,
        warningCount: 0,
        blockerCount: 0,
        results: [
          {
            commandId: "test",
            commandLabel: "Run tests",
            status: "passed",
            exitCode: 0,
            durationMs: 12,
            stdoutSummary: "tests passed",
            stderrSummary: "",
            redactionApplied: true,
          },
        ],
      },
    });

    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("calls the GitHub flow after successful validation and emits push, PR, and approval events", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-github-success");
    const taskPacket = validTaskPacket({
      id: "TASK-081",
      repositoryId: "acme/control-plane",
      runId: "run-github-success",
      mode: "execute",
      source: {
        type: "manual",
        externalId: "manual-081",
        title: "Wire commit/push/PR into runner flow",
      },
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-081-runner-flow",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-github-success",
      status: "passed",
    });
    const worktreeResult = worktreeResultFor(taskPacket);
    const codexResult = safeCodexResult();
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts", "pnpm-lock.yaml"],
      warnings: [
        riskFinding({
          id: "risk:package_lock",
          severity: "warning",
          category: "package_lock",
          message: "Package lock changes require review.",
          paths: ["pnpm-lock.yaml"],
        }),
      ],
    });
    const validationResult = validationSuiteResult({
      runId: "run-github-success",
      results: [
        createValidationResult({
          runId: "run-github-success",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runGithub = vi.fn(async () => githubResult);

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResult),
        runCodex: vi.fn(async () => codexResult),
        scanChanges: vi.fn(async () => changeScanResult),
        runValidation: vi.fn(async () => validationResult),
        runGithub,
        now: createClock([
          "2026-05-22T01:10:00.000Z",
          "2026-05-22T01:10:01.000Z",
          "2026-05-22T01:10:02.000Z",
          "2026-05-22T01:10:03.000Z",
          "2026-05-22T01:10:04.000Z",
          "2026-05-22T01:10:05.000Z",
          "2026-05-22T01:10:06.000Z",
          "2026-05-22T01:10:07.000Z",
          "2026-05-22T01:10:08.000Z",
          "2026-05-22T01:10:09.000Z",
          "2026-05-22T01:10:10.000Z",
        ]),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-github-success",
      eventsOut: eventsOutPath,
      dryRunResult: readinessResult,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
      githubResult,
    });
    expect(runGithub).toHaveBeenCalledTimes(1);
    expect(runGithub).toHaveBeenCalledWith({
      config: {
        worktreeRoot: ".codex-runner-worktrees",
        mockModes: {
          codex: false,
          gh: false,
        },
      },
      taskPacket,
      worktreePath,
      changeScanResult,
      validationResult,
      onPushArtifact: expect.any(Function),
    });

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    expect(events[8]).toMatchObject({
      severity: "info",
      metadata: {
        branchName: "aicp/task-081-runner-flow",
        remoteName: "origin",
        remoteRef: "refs/heads/aicp/task-081-runner-flow",
        commitHash: COMMIT_HASH,
      },
    });
    expect(events[9]).toMatchObject({
      severity: "info",
      metadata: {
        repository: {
          owner: "acme",
          name: "control-plane",
        },
        branchName: "aicp/task-081-runner-flow",
        prNumber: 81,
        prUrl: "https://github.example.test/acme/control-plane/pull/81",
        prTitle: "TASK-081: Wire commit/push/PR into runner flow",
        prStatus: "draft",
        changedFilePaths: ["src/app.ts", "pnpm-lock.yaml"],
        riskFindings: [
          {
            id: "risk:package_lock",
            severity: "warning",
            category: "package_lock",
            paths: ["pnpm-lock.yaml"],
          },
        ],
      },
    });
    expect(events[10]).toMatchObject({
      severity: "info",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-github-success",
        stableStepName: "awaiting_approval",
        attempt: 1,
      }),
      metadata: events[9]?.metadata,
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("invokes optional protocol sinks for emitted events, results, and PR artifacts", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const worktreePath = join(workspace, "worktrees", "run-protocol-sinks");
    const taskPacket = validTaskPacket({
      id: "TASK-120",
      repositoryId: "acme/control-plane",
      runId: "run-protocol-sinks",
      mode: "execute",
      source: {
        type: "manual",
        externalId: "manual-120",
        title: "Add runner polling loop client",
      },
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-120-poll-loop",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-protocol-sinks",
      status: "passed",
    });
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts"],
    });
    const validationResult = validationSuiteResult({
      runId: "run-protocol-sinks",
      results: [
        createValidationResult({
          runId: "run-protocol-sinks",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const callbackOrder: string[] = [];
    const onRunEvent = vi.fn(async (event: RunEvent) => {
      callbackOrder.push(`event:${event.idempotencyKey}`);
      expect(RunEventSchema.safeParse(event).success).toBe(true);
    });
    const onDryRunResult = vi.fn(async (result: DryRunResult) => {
      callbackOrder.push("dry-run-result");
      expect(DryRunResultSchema.safeParse(result).success).toBe(true);
    });
    const onValidationResult = vi.fn(async (result: ValidationResult) => {
      callbackOrder.push(`validation-result:${result.commandId}`);
      expect(ValidationResultSchema.safeParse(result).success).toBe(true);
    });
    const onPrArtifact = vi.fn(async (artifact: PrArtifact) => {
      callbackOrder.push("pr-artifact");
      expect(artifact.runId).toBe("run-protocol-sinks");
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
      },
      {
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => changeScanResult),
        runValidation: vi.fn(async () => validationResult),
        runGithub: vi.fn(async () => githubResult),
        onRunEvent,
        onDryRunResult,
        onValidationResult,
        onPrArtifact,
        now: createClock([
          "2026-05-23T10:00:00.000Z",
          "2026-05-23T10:00:01.000Z",
          "2026-05-23T10:00:02.000Z",
          "2026-05-23T10:00:03.000Z",
          "2026-05-23T10:00:04.000Z",
          "2026-05-23T10:00:05.000Z",
          "2026-05-23T10:00:06.000Z",
          "2026-05-23T10:00:07.000Z",
          "2026-05-23T10:00:08.000Z",
          "2026-05-23T10:00:09.000Z",
          "2026-05-23T10:00:10.000Z",
        ]),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-protocol-sinks",
      dryRunResult: readinessResult,
      worktreeResult: worktreeResultFor(taskPacket),
      codexResult: safeCodexResult(),
      changeScanResult,
      validationResult,
      githubResult,
    });
    expect(onRunEvent).toHaveBeenCalledTimes(11);
    expect(onRunEvent.mock.calls.map(([event]) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    for (const [event] of onRunEvent.mock.calls) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
    expect(onDryRunResult).toHaveBeenCalledTimes(1);
    expect(onDryRunResult).toHaveBeenCalledWith(readinessResult);
    expect(onValidationResult).toHaveBeenCalledTimes(1);
    expect(onValidationResult).toHaveBeenCalledWith(validationResult.results[0]);
    expect(onPrArtifact).toHaveBeenCalledTimes(1);
    expect(onPrArtifact).toHaveBeenCalledWith(githubResult.prArtifact);
    expect(callbackOrder).toEqual([
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "dry_run_running",
        attempt: 1,
      })}`,
      "dry-run-result",
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "dry_run_passed",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "worktree_created",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "codex_running",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "codex_finished",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "changes_scanned",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "validation_running",
        attempt: 1,
      })}`,
      "validation-result:test",
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "validation_completed",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "pushed",
        attempt: 1,
      })}`,
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "pr_opened",
        attempt: 1,
      })}`,
      "pr-artifact",
      `event:${createRunEventIdempotencyKey({
        runId: "run-protocol-sinks",
        stableStepName: "awaiting_approval",
        attempt: 1,
      })}`,
    ]);
  });

  it("streams generated run events through emitRunEvent when eventsOut is unset", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const taskPacket = validTaskPacket({
      runId: "run-emit-callback-no-events-out",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-120-emit-callback",
      },
    });
    const readinessResult = dryRunResult({
      runId: "run-emit-callback-no-events-out",
      status: "passed",
    });
    const emitRunEvent = vi.fn(async (event: RunEvent) => {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        taskPacket,
        dryRun: true,
      },
      {
        runDryRun: vi.fn(async () => readinessResult),
        emitRunEvent,
        now: createClock(["2026-05-23T10:32:00.000Z", "2026-05-23T10:32:01.000Z"]),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-emit-callback-no-events-out",
      dryRunResult: readinessResult,
    });
    expect(emitRunEvent).toHaveBeenCalledTimes(2);
    expect(emitRunEvent.mock.calls.map(([event]) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
    ]);
  });

  it("stops before worktree creation when the dry-run result callback rejects", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const worktreePath = join(workspace, "worktrees", "run-dry-run-callback-rejects");
    const taskPacket = validTaskPacket({
      runId: "run-dry-run-callback-rejects",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-120-dry-run-callback-rejects",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-dry-run-callback-rejects",
      status: "passed",
    });
    const createWorktree = vi.fn(async () => worktreeResultFor(taskPacket));

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: repoPath,
          task: taskPath,
          dryRun: false,
        },
        {
          runDryRun: vi.fn(async () => readinessResult),
          createWorktree,
          onDryRunResult: async () => {
            throw new Error(`${OBJECTIVE_TEXT} ${CONTEXT_NOTE_TEXT}`);
          },
        },
      ),
    );

    expect(error.category).toBe("command_execution");
    expect(error.message).toBe("Runner dry-run result callback failed.");
    expect(JSON.stringify(error)).not.toContain(OBJECTIVE_TEXT);
    expect(JSON.stringify(error)).not.toContain(CONTEXT_NOTE_TEXT);
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it("stops before GitHub execution when a validation result callback rejects", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const worktreePath = join(workspace, "worktrees", "run-validation-callback-rejects");
    const taskPacket = validTaskPacket({
      runId: "run-validation-callback-rejects",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-120-validation-callback-rejects",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts"],
    });
    const validationResult = validationSuiteResult({
      runId: "run-validation-callback-rejects",
      results: [
        createValidationResult({
          runId: "run-validation-callback-rejects",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const runGithub = vi.fn(async () => githubResultFor(taskPacket, changeScanResult.warnings));

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: repoPath,
          task: taskPath,
          dryRun: false,
        },
        {
          runDryRun: vi.fn(async () =>
            dryRunResult({
              runId: "run-validation-callback-rejects",
              status: "passed",
            }),
          ),
          createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
          runCodex: vi.fn(async () => safeCodexResult()),
          scanChanges: vi.fn(async () => changeScanResult),
          runValidation: vi.fn(async () => validationResult),
          runGithub,
          onValidationResult: async () => {
            throw new Error(`${OBJECTIVE_TEXT} ${CONTEXT_NOTE_TEXT}`);
          },
        },
      ),
    );

    expect(error.category).toBe("command_execution");
    expect(error.message).toBe("Runner validation result callback failed.");
    expect(JSON.stringify(error)).not.toContain(OBJECTIVE_TEXT);
    expect(JSON.stringify(error)).not.toContain(CONTEXT_NOTE_TEXT);
    expect(runGithub).not.toHaveBeenCalled();
  });

  it("stops before PR events and artifact callbacks when the PR artifact is invalid", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const worktreePath = join(workspace, "worktrees", "run-invalid-pr-artifact");
    const taskPacket = validTaskPacket({
      runId: "run-invalid-pr-artifact",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-120-invalid-pr-artifact",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts"],
    });
    const validationResult = validationSuiteResult({
      runId: "run-invalid-pr-artifact",
      results: [
        createValidationResult({
          runId: "run-invalid-pr-artifact",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const invalidGithubResult: RunGithubForTaskResult = {
      ...githubResult,
      prArtifact: {
        ...githubResult.prArtifact,
        prNumber: 0,
      } as PrArtifact,
    };
    const onRunEvent = vi.fn();
    const onPrArtifact = vi.fn();

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: repoPath,
          task: taskPath,
          dryRun: false,
        },
        {
          runDryRun: vi.fn(async () =>
            dryRunResult({
              runId: "run-invalid-pr-artifact",
              status: "passed",
            }),
          ),
          createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
          runCodex: vi.fn(async () => safeCodexResult()),
          scanChanges: vi.fn(async () => changeScanResult),
          runValidation: vi.fn(async () => validationResult),
          runGithub: vi.fn(async () => invalidGithubResult),
          onPrArtifact,
          onRunEvent,
        },
      ),
    );

    expect(error.category).toBe("command_execution");
    expect(error.message).toBe("Runner PR artifact could not be validated.");
    expect(onPrArtifact).not.toHaveBeenCalled();
    expect(onRunEvent.mock.calls.map(([event]) => (event as RunEvent).state)).not.toContain(
      "pr_opened",
    );
    expect(onRunEvent.mock.calls.map(([event]) => (event as RunEvent).state)).not.toContain(
      "awaiting_approval",
    );
  });

  it("runs the default mock Codex adapter after worktree creation and emits Codex events", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const configPath = await writeJsonFile(join(workspace, "runner-config.json"), {
      mockModes: {
        codex: true,
        gh: false,
      },
    });
    const worktreePath = join(workspace, "worktrees", "run-codex-success");
    const taskPacket = validTaskPacket({
      runId: "run-codex-success",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-060-codex-success",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-codex-success",
      status: "passed",
    });
    const worktreeResult = {
      runId: "run-codex-success",
      branchName: "aicp/task-060-codex-success",
      baseBranch: "main",
      worktreePath,
      metadata: {
        branchName: "aicp/task-060-codex-success",
        baseBranch: "main",
        worktreeCreated: true,
        gitExitCode: 0,
      },
    };
    const runDryRun = vi.fn(async () => readinessResult);
    const createWorktree = vi.fn(async () => {
      await mkdir(worktreePath, { recursive: true });
      return worktreeResult;
    });
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["docs/mock-codex-result.txt"],
    });
    const scanChanges = vi.fn(async () => changeScanResult);
    const validationResult = validationSuiteResult({
      runId: "run-codex-success",
      results: [
        createValidationResult({
          runId: "run-codex-success",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const runValidation = vi.fn(async () => validationResult);
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runGithub = vi.fn(async () => githubResult);

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
        configPath,
      },
      {
        runDryRun,
        createWorktree,
        scanChanges,
        runValidation,
        runGithub,
        now: createClock([
          "2026-05-21T07:40:00.000Z",
          "2026-05-21T07:40:01.000Z",
          "2026-05-21T07:40:02.000Z",
          "2026-05-21T07:40:03.000Z",
          "2026-05-21T07:40:04.000Z",
          "2026-05-21T07:40:05.000Z",
          "2026-05-21T07:40:06.000Z",
          "2026-05-21T07:40:07.000Z",
          "2026-05-21T07:40:08.000Z",
          "2026-05-21T07:40:09.000Z",
          "2026-05-21T07:40:10.000Z",
        ]),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.codexResult).toMatchObject({
      adapterMode: "mock",
      status: "succeeded",
      exitCode: 0,
      redactionApplied: true,
    });
    expect(result.changeScanResult).toBe(changeScanResult);
    expect(result.validationResult).toEqual(validationResult);
    expect(result.githubResult).toBe(githubResult);
    expect(scanChanges).toHaveBeenCalledWith({
      worktreePath,
      policy: taskPacket.policy,
    });
    expect(runValidation).toHaveBeenCalledWith({
      taskPacket,
      worktreePath,
    });
    await expect(
      readFile(join(worktreePath, "docs", "mock-codex-result.txt"), "utf8"),
    ).resolves.toBe("Mock Codex fixture change.\n");

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    expect(events[3]?.metadata).toEqual({
      adapterMode: "mock",
    });
    expect(events[4]?.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-codex-success",
        stableStepName: "codex_finished",
        attempt: 1,
      }),
    );
    expect(events[4]?.metadata).toMatchObject({
      adapterMode: "mock",
      status: "succeeded",
      exitCode: 0,
      redactionApplied: true,
    });
    expect(events[5]).toMatchObject({
      severity: "info",
      metadata: {
        changedFilePaths: ["docs/mock-codex-result.txt"],
        blockerCount: 0,
        warningCount: 0,
        shouldBlock: false,
      },
    });
    expect(events[6]?.metadata).toEqual({
      commandCount: 1,
      requiredCommandCount: 1,
    });
    expect(events[7]).toMatchObject({
      severity: "info",
      metadata: {
        status: "passed",
        shouldBlockCommit: false,
        warningCount: 0,
        blockerCount: 0,
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("returns nonzero and emits a metadata-only failed event when Codex fails", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-codex-failure");
    const taskPacket = validTaskPacket({
      runId: "run-codex-failure",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-060-codex-failure",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-codex-failure",
      status: "passed",
    });
    const worktreeResult = {
      runId: "run-codex-failure",
      branchName: "aicp/task-060-codex-failure",
      baseBranch: "main",
      worktreePath,
      metadata: {
        branchName: "aicp/task-060-codex-failure",
        baseBranch: "main",
        worktreeCreated: true,
        gitExitCode: 0,
      },
    };
    const unsafeCodexResult = {
      adapterMode: "mock",
      status: "failed",
      exitCode: 2,
      durationMs: 31,
      redactionApplied: true,
      stdoutSummary: "raw stdout MUST NOT LEAK",
      stderrSummary: "raw stderr MUST NOT LEAK",
      prompt: OBJECTIVE_TEXT,
      objective: OBJECTIVE_TEXT,
      sourceTitle: SOURCE_TITLE_TEXT,
      contextNotes: CONTEXT_NOTE_TEXT,
      diff: "diff --git a/src/private.ts b/src/private.ts",
      patch: "@@ -1,1 +1,1 @@",
    } as never;
    const runDryRun = vi.fn(async () => readinessResult);
    const createWorktree = vi.fn(async () => worktreeResult);
    const runCodex = vi.fn(async () => unsafeCodexResult);
    const scanChanges = vi.fn(async () => {
      throw new Error("scanChanges must not be called after Codex failure");
    });
    const runValidation = vi.fn(async () => {
      throw new Error("runValidation must not be called after Codex failure");
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun,
        createWorktree,
        runCodex,
        scanChanges,
        runValidation,
        now: createClock([
          "2026-05-21T07:45:00.000Z",
          "2026-05-21T07:45:01.000Z",
          "2026-05-21T07:45:02.000Z",
          "2026-05-21T07:45:03.000Z",
          "2026-05-21T07:45:04.000Z",
        ]),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.codexResult).toEqual({
      adapterMode: "mock",
      status: "failed",
      exitCode: 2,
      durationMs: 31,
      redactionApplied: true,
    });
    expect(runCodex).toHaveBeenCalledTimes(1);
    expect(scanChanges).not.toHaveBeenCalled();
    expect(runValidation).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "failed",
    ]);
    expect(events.map((event) => event.state)).not.toContain("changes_scanned");
    expect(events.map((event) => event.state)).not.toContain("validation_running");
    expect(events[4]?.metadata).toEqual({
      adapterMode: "mock",
      status: "failed",
      exitCode: 2,
      durationMs: 31,
      redactionApplied: true,
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("keeps dry-run execution non-mutating and does not create or clean up worktrees", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({ runId: "run-dry-run-non-mutating" }),
    );
    const readinessResult = dryRunResult({
      runId: "run-dry-run-non-mutating",
      status: "passed",
    });
    const runDryRun = vi.fn(async () => readinessResult);
    const createWorktree = vi.fn(async () => {
      throw new Error("createWorktree must not be called for dry run");
    });
    const scanChanges = vi.fn(async () => {
      throw new Error("scanChanges must not be called for dry run");
    });
    const cleanupWorktree = vi.fn(async () => {
      throw new Error("cleanupWorktree must not be called for dry run");
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: true,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun,
        createWorktree,
        scanChanges,
        cleanupWorktree,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.dryRunResult).toBe(readinessResult);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(scanChanges).not.toHaveBeenCalled();
    expect(cleanupWorktree).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "dry_run_passed"]);
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("keeps task-packet dry-run mode non-mutating even when the caller requests execution setup", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-packet-dry-run-mode");
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({
        runId: "run-packet-dry-run-mode",
        mode: "dryRun",
        repo: {
          localPath: repoPath,
          defaultBranch: "main",
          targetBranch: "aicp/task-054-packet-dry-run-mode",
          worktreePath,
        },
      }),
    );
    const readinessResult = dryRunResult({
      runId: "run-packet-dry-run-mode",
      status: "passed",
    });
    const runDryRun = vi.fn(async () => readinessResult);
    const createWorktree = vi.fn(async () => {
      throw new Error("createWorktree must not be called for dry-run task packets");
    });
    const scanChanges = vi.fn(async () => {
      throw new Error("scanChanges must not be called for dry-run task packets");
    });
    const cleanupWorktree = vi.fn(async () => {
      throw new Error("cleanupWorktree must not be called for dry-run task packets");
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun,
        createWorktree,
        scanChanges,
        cleanupWorktree,
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-packet-dry-run-mode",
      eventsOut: eventsOutPath,
      dryRunResult: readinessResult,
    });
    expect(runDryRun).toHaveBeenCalledTimes(1);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(scanChanges).not.toHaveBeenCalled();
    expect(cleanupWorktree).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "dry_run_passed"]);
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("continues past warning-only change scans without emitting a blocked event", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-change-scan-warning");
    const taskPacket = validTaskPacket({
      runId: "run-change-scan-warning",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-068-change-scan-warning",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-change-scan-warning",
      status: "passed",
    });
    const worktreeResult = worktreeResultFor(taskPacket);
    const codexResult = safeCodexResult();
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["pnpm-lock.yaml"],
      warnings: [
        riskFinding({
          id: "risk:package_lock",
          severity: "warning",
          category: "package_lock",
          message: "Package lock changes require review.",
          paths: ["pnpm-lock.yaml"],
        }),
      ],
    });
    const scanChanges = vi.fn(async () => changeScanResult);
    const validationResult = validationSuiteResult({
      runId: "run-change-scan-warning",
      results: [
        createValidationResult({
          runId: "run-change-scan-warning",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const runValidation = vi.fn(async () => validationResult);
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runGithub = vi.fn(async () => githubResult);

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResult),
        runCodex: vi.fn(async () => codexResult),
        scanChanges,
        runValidation,
        runGithub,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.changeScanResult).toBe(changeScanResult);
    expect(result.validationResult).toEqual(validationResult);
    expect(result.githubResult).toBe(githubResult);
    expect(runValidation).toHaveBeenCalledWith({
      taskPacket,
      worktreePath,
    });

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    expect(events[5]).toMatchObject({
      severity: "warning",
      metadata: {
        warningCount: 1,
        shouldBlock: false,
        warnings: [
          {
            id: "risk:package_lock",
            severity: "warning",
            category: "package_lock",
            paths: ["pnpm-lock.yaml"],
          },
        ],
      },
    });
    expect(events.map((event) => event.state)).not.toContain("blocked");
    expect(events[6]?.metadata).toEqual({
      commandCount: 1,
      requiredCommandCount: 1,
    });
    expect(events[7]).toMatchObject({
      severity: "info",
      metadata: {
        status: "passed",
        shouldBlockCommit: false,
        warningCount: 0,
        blockerCount: 0,
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("returns nonzero and emits a blocked validation event when required validation fails", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-validation-required-failed");
    const taskPacket = validTaskPacket({
      runId: "run-validation-required-failed",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-074-validation-required-failed",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const validationResult = validationSuiteResult({
      runId: "run-validation-required-failed",
      status: "failed",
      shouldBlockCommit: true,
      results: [
        createValidationResult({
          runId: "run-validation-required-failed",
          command: taskPacket.validation.commands[0]!,
          status: "failed",
          exitCode: 1,
          stderrSummary: "required test failed",
        }),
      ],
      blockers: [
        {
          commandId: "test",
          commandLabel: "Run tests",
          status: "failed",
          message: "Required validation command failed.",
        },
      ],
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () =>
          dryRunResult({
            runId: "run-validation-required-failed",
            status: "passed",
          }),
        ),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => safeChangeScanResult({ changedFilePaths: ["src/app.ts"] })),
        runValidation: vi.fn(async () => validationResult),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.validationResult).toEqual(validationResult);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "blocked",
    ]);
    expect(events.map((event) => event.state)).not.toContain("pushed");
    expect(events.map((event) => event.state)).not.toContain("pr_opened");
    expect(events.map((event) => event.state)).not.toContain("awaiting_approval");
    expect(events[7]).toMatchObject({
      severity: "blocked",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-validation-required-failed",
        stableStepName: "validation_blocked",
        attempt: 1,
      }),
      metadata: {
        status: "failed",
        shouldBlockCommit: true,
        warningCount: 0,
        blockerCount: 1,
        results: [
          {
            commandId: "test",
            commandLabel: "Run tests",
            status: "failed",
            exitCode: 1,
            durationMs: 12,
            stdoutSummary: "",
            stderrSummary: "required test failed",
            redactionApplied: true,
          },
        ],
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("returns success with warning metadata when optional validation fails", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-validation-optional-failed");
    const optionalCommand = {
      id: "lint",
      label: "Lint",
      command: "pnpm lint",
      timeoutSeconds: 120,
      required: false,
    };
    const taskPacket = validTaskPacket({
      runId: "run-validation-optional-failed",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-074-validation-optional-failed",
        worktreePath,
      },
      validation: {
        commands: [optionalCommand],
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const validationResult = validationSuiteResult({
      runId: "run-validation-optional-failed",
      status: "warning",
      shouldBlockCommit: false,
      results: [
        createValidationResult({
          runId: "run-validation-optional-failed",
          command: optionalCommand,
          status: "failed",
          exitCode: 1,
          stderrSummary: "optional lint failed",
        }),
      ],
      warnings: [
        {
          commandId: "lint",
          commandLabel: "Lint",
          status: "failed",
          message: "Optional validation command failed.",
        },
      ],
    });
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts"],
    });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runGithub = vi.fn(async () => githubResult);

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () =>
          dryRunResult({
            runId: "run-validation-optional-failed",
            status: "passed",
          }),
        ),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => changeScanResult),
        runValidation: vi.fn(async () => validationResult),
        runGithub,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.validationResult).toEqual(validationResult);
    expect(result.githubResult).toBe(githubResult);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    expect(events[6]?.metadata).toEqual({
      commandCount: 1,
      requiredCommandCount: 0,
    });
    expect(events[7]).toMatchObject({
      severity: "warning",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-validation-optional-failed",
        stableStepName: "validation_completed",
        attempt: 1,
      }),
      metadata: {
        status: "warning",
        shouldBlockCommit: false,
        warningCount: 1,
        blockerCount: 0,
        results: [
          {
            commandId: "lint",
            commandLabel: "Lint",
            status: "failed",
            exitCode: 1,
            durationMs: 12,
            stdoutSummary: "",
            stderrSummary: "optional lint failed",
            redactionApplied: true,
          },
        ],
      },
    });
    expect(events.map((event) => event.state)).not.toContain("blocked");
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("does not trust unsafe validation result extras when emitting run events", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-validation-unsafe-extra");
    const taskPacket = validTaskPacket({
      runId: "run-validation-unsafe-extra",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-074-validation-unsafe-extra",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const validationResult = {
      ...validationSuiteResult({
        runId: "run-validation-unsafe-extra",
        results: [
          {
            ...createValidationResult({
              runId: "run-validation-unsafe-extra",
              command: taskPacket.validation.commands[0]!,
              status: "passed",
              stdoutSummary: "safe redacted output summary",
              stderrSummary: "safe redacted error summary",
            }),
            stdout: "raw stdout MUST NOT LEAK",
            stderr: "raw stderr MUST NOT LEAK",
            diff: "diff --git a/src/private.ts b/src/private.ts",
            patch: "@@ -1,1 +1,1 @@",
            source: "export const source = true;",
            code: "const privateCode = true;",
            prompt: OBJECTIVE_TEXT,
          } as never,
        ],
      }),
      stdout: "raw stdout MUST NOT LEAK",
      stderr: "raw stderr MUST NOT LEAK",
      diff: "diff --git a/src/private.ts b/src/private.ts",
      patch: "@@ -1,1 +1,1 @@",
      source: "export const source = true;",
      code: "const privateCode = true;",
      prompt: OBJECTIVE_TEXT,
    } as never;
    const changeScanResult = safeChangeScanResult({ changedFilePaths: ["src/app.ts"] });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runGithub = vi.fn(async () => githubResult);

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () =>
          dryRunResult({
            runId: "run-validation-unsafe-extra",
            status: "passed",
          }),
        ),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => changeScanResult),
        runValidation: vi.fn(async () => validationResult),
        runGithub,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.githubResult).toBe(githubResult);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    expect(events[7]?.metadata).toMatchObject({
      results: [
        {
          commandId: "test",
          commandLabel: "Run tests",
          status: "passed",
          exitCode: 0,
          durationMs: 12,
          stdoutSummary: "safe redacted output summary",
          stderrSummary: "safe redacted error summary",
          redactionApplied: true,
        },
      ],
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("blocks hard change-scan findings before any validation boundary", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-change-scan-blocked");
    const taskPacket = validTaskPacket({
      runId: "run-change-scan-blocked",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-068-change-scan-blocked",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-change-scan-blocked",
      status: "passed",
    });
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: [".env.local", "src/config.ts", "SECURITY_MODEL.md"],
      blockers: [
        riskFinding({
          id: "risk:sensitive_path:env_files",
          severity: "blocked",
          category: "sensitive_path",
          message: "Changed environment files are blocked.",
          paths: [".env.local"],
        }),
        riskFinding({
          id: "risk:secret:provider_token",
          severity: "blocked",
          category: "secret",
          message: "Suspected secret detected: provider_token.",
          paths: ["src/config.ts"],
        }),
        riskFinding({
          id: "risk:protected_path",
          severity: "blocked",
          category: "protected_path",
          message: "Protected path changes are blocked by repository policy.",
          paths: ["SECURITY_MODEL.md"],
        }),
      ],
    });
    const runValidation = vi.fn(async () => {
      throw new Error("runValidation must not be called after change-scan blockers");
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => changeScanResult),
        runValidation,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.changeScanResult).toBe(changeScanResult);
    expect(runValidation).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "blocked",
    ]);
    expect(events.map((event) => event.state)).not.toContain("validation_running");
    expect(events[5]).toMatchObject({
      severity: "blocked",
      metadata: {
        blockerCount: 3,
        warningCount: 0,
        shouldBlock: true,
      },
    });
    expect(events[6]).toMatchObject({
      severity: "blocked",
      idempotencyKey: createRunEventIdempotencyKey({
        runId: "run-change-scan-blocked",
        stableStepName: "change_scan_blocked",
        attempt: 1,
      }),
      metadata: {
        changedFilePaths: [".env.local", "src/config.ts", "SECURITY_MODEL.md"],
        blockerCount: 3,
        warningCount: 0,
        shouldBlock: true,
        blockers: [
          {
            id: "risk:sensitive_path:env_files",
            severity: "blocked",
            category: "sensitive_path",
            paths: [".env.local"],
          },
          {
            id: "risk:secret:provider_token",
            severity: "blocked",
            category: "secret",
            paths: ["src/config.ts"],
          },
          {
            id: "risk:protected_path",
            severity: "blocked",
            category: "protected_path",
            paths: ["SECURITY_MODEL.md"],
          },
        ],
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("fails closed with safe blocked events when change scanning throws", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-change-scan-failure");
    const taskPacket = validTaskPacket({
      runId: "run-change-scan-failure",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-068-change-scan-failure",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-change-scan-failure",
      status: "passed",
    });
    const unsafeErrorText =
      "git failed with diff --git a/private.ts b/private.ts and SECRET_TOKEN=do-not-print";
    const runValidation = vi.fn(async () => {
      throw new Error("runValidation must not be called after failed change scanning");
    });

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => {
          throw new Error(unsafeErrorText);
        }),
        runValidation,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(runValidation).not.toHaveBeenCalled();
    expect(result.changeScanResult).toMatchObject({
      shouldBlock: true,
      blockers: [
        {
          id: "risk:large_diff:change_scan_failed",
          severity: "blocked",
          category: "large_diff",
          paths: [],
        },
      ],
    });

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "blocked",
    ]);
    expect(events[5]).toMatchObject({
      severity: "blocked",
      metadata: {
        changedFilePaths: [],
        blockerCount: 1,
        warningCount: 0,
        shouldBlock: true,
      },
    });
    expect(events[6]).toMatchObject({
      severity: "blocked",
      metadata: {
        blockerCount: 1,
        shouldBlock: true,
        blockers: [
          {
            id: "risk:large_diff:change_scan_failed",
            severity: "blocked",
            category: "large_diff",
            paths: [],
          },
        ],
      },
    });
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
      expect(JSON.stringify(event)).not.toContain(unsafeErrorText);
      expect(JSON.stringify(event)).not.toContain("SECRET_TOKEN");
    }
  });

  it("maps config loader failures to a config RunnerError without writing events", async () => {
    const workspace = await createWorkspace();
    const eventsOutPath = join(workspace, "events.jsonl");
    const loaderError = new RunnerConfigLoaderError({
      code: "invalid_config",
      configPath: join(workspace, "runner-config.json"),
      message: "Invalid runner config file: invalid_config.",
    });

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: workspace,
          task: join(workspace, "task.json"),
          dryRun: true,
          eventsOut: eventsOutPath,
        },
        {
          loadRunnerConfig: async () => {
            throw loaderError;
          },
        },
      ),
    );

    expect(error.category).toBe("config");
    expect(error.cause).toBe(loaderError);
    await expect(access(eventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps task packet loader failures to a task_packet RunnerError without writing events", async () => {
    const workspace = await createWorkspace();
    const eventsOutPath = join(workspace, "events.jsonl");
    const loaderError = new TaskPacketLoaderError({
      code: "invalid_task_packet",
      taskPacketPath: join(workspace, "task.json"),
      message: "Invalid task packet file: invalid_task_packet.",
    });

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: workspace,
          task: join(workspace, "task.json"),
          dryRun: true,
          eventsOut: eventsOutPath,
        },
        {
          loadRunnerConfig: async () => ({
            worktreeRoot: ".codex-runner-worktrees",
            mockModes: {
              codex: false,
              gh: false,
            },
          }),
          loadTaskPacket: async () => {
            throw loaderError;
          },
        },
      ),
    );

    expect(error.category).toBe("task_packet");
    expect(error.cause).toBe(loaderError);
    await expect(access(eventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects event output inside the target repo before writing events", async () => {
    const workspace = await createWorkspace();
    const repoPath = join(workspace, "repo");
    await mkdir(repoPath);
    const eventsOutPath = join(repoPath, "events.jsonl");
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({ runId: "run-events-inside-repo" }),
    );
    const runDryRun = vi.fn(async () => dryRunResult({ runId: "run-events-inside-repo" }));

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: repoPath,
          task: taskPath,
          dryRun: true,
          eventsOut: eventsOutPath,
        },
        {
          runDryRun,
        },
      ),
    );

    expect(error.category).toBe("repo_path");
    expect(error.metadata).toMatchObject({
      reason: "events_out_inside_repo",
    });
    expect(runDryRun).not.toHaveBeenCalled();
    await expect(access(eventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects event output inside a symlinked target repo before writing events", async () => {
    const workspace = await createWorkspace();
    const realRepoPath = join(workspace, "repo");
    const repoSymlinkPath = join(workspace, "repo-link");
    await mkdir(realRepoPath);
    await symlink(realRepoPath, repoSymlinkPath, "dir");
    const eventsOutPath = join(realRepoPath, "events.jsonl");
    const taskPath = await writeTaskPacketFile(
      join(workspace, "task.json"),
      validTaskPacket({ runId: "run-events-inside-symlinked-repo" }),
    );
    const runDryRun = vi.fn(async () =>
      dryRunResult({ runId: "run-events-inside-symlinked-repo" }),
    );

    const error = await expectRunnerError(
      runRunner(
        {
          command: "run",
          repo: repoSymlinkPath,
          task: taskPath,
          dryRun: true,
          eventsOut: eventsOutPath,
        },
        {
          runDryRun,
        },
      ),
    );

    expect(error.category).toBe("repo_path");
    expect(error.metadata).toMatchObject({
      reason: "events_out_inside_repo",
    });
    expect(runDryRun).not.toHaveBeenCalled();
    await expect(access(eventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("runner repair flow", () => {
  it("runs a bounded repair packet through Codex, scan, validation, push, and PR artifact callbacks with attempt-aware events", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-repair-flow");
    const taskPacket = validRepairTaskPacket({
      id: "TASK-147",
      repositoryId: "acme/control-plane",
      runId: "run-repair-flow",
      repair: {
        attempt: 2,
        feedback: "Do not leak this repair feedback or raw logs.",
        maxAttempts: 2,
        previousRunId: "run-original-flow",
      },
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-existing-pr",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const worktreeResult = {
      ...worktreeResultFor(taskPacket),
      metadata: {
        ...worktreeResultFor(taskPacket).metadata,
        repair: true as const,
        repairAttempt: 2,
        reusedExistingWorktree: false,
      },
    };
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts"],
    });
    const validationResult = validationSuiteResult({
      runId: "run-repair-flow",
      results: [
        createValidationResult({
          runId: "run-repair-flow",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);
    const runDryRun = vi.fn(async () => dryRunResult({ runId: "run-repair-flow" }));
    const createWorktree = vi.fn(async () => worktreeResultFor(taskPacket));
    const prepareRepairWorktree = vi.fn(async () => worktreeResult);
    const onPrArtifact = vi.fn();

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        runDryRun,
        createWorktree,
        prepareRepairWorktree,
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => changeScanResult),
        runValidation: vi.fn(async () => validationResult),
        runGithub: vi.fn(async () => githubResult),
        onPrArtifact,
        now: createClock([
          "2026-05-24T09:20:00.000Z",
          "2026-05-24T09:20:01.000Z",
          "2026-05-24T09:20:02.000Z",
          "2026-05-24T09:20:03.000Z",
          "2026-05-24T09:20:04.000Z",
          "2026-05-24T09:20:05.000Z",
          "2026-05-24T09:20:06.000Z",
          "2026-05-24T09:20:07.000Z",
          "2026-05-24T09:20:08.000Z",
          "2026-05-24T09:20:09.000Z",
        ]),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runId: "run-repair-flow",
      eventsOut: eventsOutPath,
      worktreeResult,
      codexResult: safeCodexResult(),
      changeScanResult,
      validationResult,
      githubResult,
    });
    expect(runDryRun).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
    expect(prepareRepairWorktree).toHaveBeenCalledWith({
      repoPath,
      taskPacket,
      worktreeRoot: join(repoPath, ".codex-runner-worktrees"),
    });
    expect(onPrArtifact).toHaveBeenCalledWith(githubResult.prArtifact);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "repair_requested",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "validation_running",
      "pushed",
      "pr_opened",
      "awaiting_approval",
    ]);
    expect(events[0]).toMatchObject({
      severity: "info",
      metadata: {
        taskPacketId: "TASK-147",
        repositoryId: "acme/control-plane",
        packetMode: "repair",
        repairAttempt: 2,
        maxRepairAttempts: 2,
        previousRunId: "run-original-flow",
      },
    });
    expect(JSON.stringify(events)).not.toContain(taskPacket.repair?.feedback);
    expect(events[2]?.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-repair-flow",
        stableStepName: "codex_running",
        attempt: 2,
      }),
    );
    expect(events[9]?.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-repair-flow",
        stableStepName: "awaiting_approval",
        attempt: 2,
      }),
    );
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("emits a terminal blocked event when repair preparation fails before local execution starts", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPacket = validRepairTaskPacket({
      runId: "run-repair-prep-blocked",
      repair: {
        attempt: 99,
        feedback: "Do not leak this feedback.",
        maxAttempts: 99,
        previousRunId: "run-original-prep-blocked",
      },
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-prep-blocked",
        worktreePath: join(workspace, "worktrees", "run-repair-prep-blocked"),
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const prepareRepairWorktree = vi.fn(async () => {
      throw new PrepareRepairWorktreeError(
        "attempt_limit_exceeded",
        "Repair attempt exceeds the configured limit.",
        {
          repairAttempt: 99,
        },
      );
    });
    const runCodex = vi.fn(async () => safeCodexResult());
    const scanChanges = vi.fn(async () => safeChangeScanResult());
    const runValidation = vi.fn(async () => validationSuiteResult({ runId: taskPacket.runId }));
    const runGithub = vi.fn(async () =>
      githubResultFor(taskPacket, safeChangeScanResult().warnings),
    );

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        prepareRepairWorktree,
        runCodex,
        scanChanges,
        runValidation,
        runGithub,
        now: createClock(["2026-05-24T09:25:00.000Z"]),
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      runId: "run-repair-prep-blocked",
      eventsOut: eventsOutPath,
    });
    expect(prepareRepairWorktree).toHaveBeenCalledWith({
      repoPath,
      taskPacket,
      worktreeRoot: join(repoPath, ".codex-runner-worktrees"),
    });
    expect(runCodex).not.toHaveBeenCalled();
    expect(scanChanges).not.toHaveBeenCalled();
    expect(runValidation).not.toHaveBeenCalled();
    expect(runGithub).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["blocked"]);
    expect(events[0]).toMatchObject({
      severity: "blocked",
      metadata: {
        taskPacketId: "TASK-147",
        packetMode: "repair",
        repairBlockReason: "attempt_limit_exceeded",
        repairAttempt: 99,
        maxRepairAttempts: 99,
        previousRunId: "run-original-prep-blocked",
        blockedRepairAttempt: 99,
      },
    });
    expect(events[0]?.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-repair-prep-blocked",
        stableStepName: "repair_blocked",
        attempt: 99,
      }),
    );
    expect(JSON.stringify(events)).not.toContain(taskPacket.repair?.feedback);
    expect(JSON.stringify(events)).not.toContain("Repair attempt exceeds");
    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectSafeRunEventPayload(event);
    }
  });

  it("stops repair execution at before_repair cancellation before branch preparation or local execution", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPacket = validRepairTaskPacket({
      runId: "run-repair-cancel-before-repair",
      repair: {
        attempt: 2,
        feedback: "Do not run repair.",
        maxAttempts: 2,
        previousRunId: "run-original-cancel",
      },
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-cancel-before-repair",
        worktreePath: join(workspace, "worktrees", "run-repair-cancel-before-repair"),
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const prepareRepairWorktree = vi.fn(async () => ({
      ...worktreeResultFor(taskPacket),
      metadata: {
        ...worktreeResultFor(taskPacket).metadata,
        repair: true as const,
        repairAttempt: 2,
        reusedExistingWorktree: false,
      },
    }));
    const runCodex = vi.fn(async () => safeCodexResult());
    const scanChanges = vi.fn(async () =>
      safeChangeScanResult({ changedFilePaths: ["src/app.ts"] }),
    );
    const runValidation = vi.fn(async () =>
      validationSuiteResult({
        runId: "run-repair-cancel-before-repair",
      }),
    );
    const runGithub = vi.fn(async () =>
      githubResultFor(taskPacket, safeChangeScanResult().warnings),
    );

    const result = await runRunner(
      {
        command: "run",
        repo: repoPath,
        task: taskPath,
        dryRun: false,
        eventsOut: eventsOutPath,
      },
      {
        checkCancellation: async ({ boundary }) => boundary === "before_repair",
        prepareRepairWorktree,
        runCodex,
        scanChanges,
        runValidation,
        runGithub,
        now: createClock([
          "2026-05-24T09:30:00.000Z",
          "2026-05-24T09:30:01.000Z",
          "2026-05-24T09:30:02.000Z",
        ]),
      },
    );

    expect(result).toEqual({
      exitCode: 130,
      runId: "run-repair-cancel-before-repair",
      eventsOut: eventsOutPath,
    });
    expect(prepareRepairWorktree).not.toHaveBeenCalled();
    expect(runCodex).not.toHaveBeenCalled();
    expect(scanChanges).not.toHaveBeenCalled();
    expect(runValidation).not.toHaveBeenCalled();
    expect(runGithub).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "cancel_requested",
      "cancelling",
      "cancelled",
    ]);
    expectCancellationEvents(events, "before_repair", {
      cleanupAttempted: false,
      cleanupSucceeded: false,
      attempt: 2,
    });
    expect(events.map((event) => event.idempotencyKey)).toEqual([
      createRunEventIdempotencyKey({
        runId: "run-repair-cancel-before-repair",
        stableStepName: "cancel_requested_before_repair",
        attempt: 2,
      }),
      createRunEventIdempotencyKey({
        runId: "run-repair-cancel-before-repair",
        stableStepName: "cancelling_before_repair",
        attempt: 2,
      }),
      createRunEventIdempotencyKey({
        runId: "run-repair-cancel-before-repair",
        stableStepName: "cancelled_before_repair",
        attempt: 2,
      }),
    ]);
  });
});

describe("runner cancellation checkpoints", () => {
  it.each([
    {
      boundary: "before_dry_run",
      expectedCalls: {
        runDryRun: 0,
        createWorktree: 0,
        runCodex: 0,
        scanChanges: 0,
        runValidation: 0,
        runGithub: 0,
      },
      expectedStates: ["cancel_requested", "cancelling", "cancelled"],
      expectedResultKeys: [],
    },
    {
      boundary: "after_dry_run",
      expectedCalls: {
        runDryRun: 1,
        createWorktree: 0,
        runCodex: 0,
        scanChanges: 0,
        runValidation: 0,
        runGithub: 0,
      },
      expectedStates: [
        "dry_run_running",
        "dry_run_passed",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ],
      expectedResultKeys: ["dryRunResult"],
    },
    {
      boundary: "before_worktree",
      expectedCalls: {
        runDryRun: 1,
        createWorktree: 0,
        runCodex: 0,
        scanChanges: 0,
        runValidation: 0,
        runGithub: 0,
      },
      expectedStates: [
        "dry_run_running",
        "dry_run_passed",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ],
      expectedResultKeys: ["dryRunResult"],
    },
    {
      boundary: "before_codex",
      expectedCalls: {
        runDryRun: 1,
        createWorktree: 1,
        runCodex: 0,
        scanChanges: 0,
        runValidation: 0,
        runGithub: 0,
      },
      expectedStates: [
        "dry_run_running",
        "dry_run_passed",
        "worktree_created",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ],
      expectedResultKeys: ["dryRunResult", "worktreeResult"],
    },
    {
      boundary: "after_codex",
      expectedCalls: {
        runDryRun: 1,
        createWorktree: 1,
        runCodex: 1,
        scanChanges: 0,
        runValidation: 0,
        runGithub: 0,
      },
      expectedStates: [
        "dry_run_running",
        "dry_run_passed",
        "worktree_created",
        "codex_running",
        "codex_running",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ],
      expectedResultKeys: ["dryRunResult", "worktreeResult", "codexResult"],
    },
    {
      boundary: "before_validation",
      expectedCalls: {
        runDryRun: 1,
        createWorktree: 1,
        runCodex: 1,
        scanChanges: 1,
        runValidation: 0,
        runGithub: 0,
      },
      expectedStates: [
        "dry_run_running",
        "dry_run_passed",
        "worktree_created",
        "codex_running",
        "codex_running",
        "changes_scanned",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ],
      expectedResultKeys: ["dryRunResult", "worktreeResult", "codexResult", "changeScanResult"],
    },
    {
      boundary: "before_commit",
      expectedCalls: {
        runDryRun: 1,
        createWorktree: 1,
        runCodex: 1,
        scanChanges: 1,
        runValidation: 1,
        runGithub: 0,
      },
      expectedStates: [
        "dry_run_running",
        "dry_run_passed",
        "worktree_created",
        "codex_running",
        "codex_running",
        "changes_scanned",
        "validation_running",
        "validation_running",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ],
      expectedResultKeys: [
        "dryRunResult",
        "worktreeResult",
        "codexResult",
        "changeScanResult",
        "validationResult",
      ],
    },
  ] satisfies {
    boundary: RunnerCancellationBoundary;
    expectedCalls: Record<
      "createWorktree" | "runCodex" | "runDryRun" | "runGithub" | "runValidation" | "scanChanges",
      number
    >;
    expectedResultKeys: string[];
    expectedStates: RunEvent["state"][];
  }[])(
    "stops at the $boundary cancellation checkpoint",
    async ({ boundary, expectedCalls, expectedResultKeys, expectedStates }) => {
      const scenario = await createRunnerCancellationScenario(`run-cancel-${boundary}`);
      const checkCancellation = vi.fn(
        async (context: { boundary: RunnerCancellationBoundary }) => context.boundary === boundary,
      );
      const onDryRunResult = vi.fn();

      const result = await runRunner(
        {
          command: "run",
          repo: scenario.repoPath,
          task: scenario.taskPath,
          dryRun: false,
          eventsOut: scenario.eventsOutPath,
        },
        {
          ...scenario.dependencies,
          checkCancellation,
          onDryRunResult,
          now: scenario.now,
        },
      );

      expect(result.exitCode).toBe(130);
      expect(scenario.dependencies.runDryRun).toHaveBeenCalledTimes(expectedCalls.runDryRun);
      expect(scenario.dependencies.createWorktree).toHaveBeenCalledTimes(
        expectedCalls.createWorktree,
      );
      expect(scenario.dependencies.runCodex).toHaveBeenCalledTimes(expectedCalls.runCodex);
      expect(scenario.dependencies.scanChanges).toHaveBeenCalledTimes(expectedCalls.scanChanges);
      expect(scenario.dependencies.runValidation).toHaveBeenCalledTimes(
        expectedCalls.runValidation,
      );
      expect(scenario.dependencies.runGithub).toHaveBeenCalledTimes(expectedCalls.runGithub);
      expect(onDryRunResult).toHaveBeenCalledTimes(expectedCalls.runDryRun);
      const shouldCleanupWorktree = expectedCalls.createWorktree > 0;
      expect(scenario.dependencies.cleanupWorktree).toHaveBeenCalledTimes(
        shouldCleanupWorktree ? 1 : 0,
      );
      if (shouldCleanupWorktree) {
        expect(scenario.dependencies.cleanupWorktree).toHaveBeenCalledWith({
          repoPath: scenario.repoPath,
          worktreeRoot: join(scenario.repoPath, ".codex-runner-worktrees"),
          worktreePath: scenario.worktreePath,
        });
      }

      for (const key of [
        "dryRunResult",
        "worktreeResult",
        "codexResult",
        "changeScanResult",
        "validationResult",
        "githubResult",
      ]) {
        expect(Object.hasOwn(result, key)).toBe(
          (expectedResultKeys as readonly string[]).includes(key),
        );
      }

      const events = await readRunEvents(scenario.eventsOutPath);
      expect(events.map((event) => event.state)).toEqual(expectedStates);
      expectCancellationEvents(events.slice(-3), boundary, {
        cleanupAttempted: shouldCleanupWorktree,
        cleanupSucceeded: shouldCleanupWorktree,
      });
      expect(events.map((event) => event.state)).not.toContain("pushed");
      expect(events.map((event) => event.state)).not.toContain("pr_opened");
      expect(events.map((event) => event.state)).not.toContain("awaiting_approval");
      for (const event of events) {
        expect(RunEventSchema.safeParse(event).success).toBe(true);
        expectSafeRunEventPayload(event);
      }
    },
  );

  it("emits cancellation events and returns 130 when validation reports cancellation", async () => {
    const scenario = await createRunnerCancellationScenario("run-validation-cancelled");
    const cancelledValidation = validationSuiteResult({
      runId: "run-validation-cancelled",
      status: "failed",
      shouldBlockCommit: true,
      results: [
        createValidationResult({
          runId: "run-validation-cancelled",
          command: scenario.taskPacket.validation.commands[0]!,
          status: "cancelled",
          exitCode: null,
          durationMs: 0,
          stderrSummary: "Validation command was cancelled before execution.",
        }),
      ],
      blockers: [
        {
          commandId: "test",
          commandLabel: "Run tests",
          status: "cancelled",
          message: "Validation command was cancelled.",
        },
      ],
    });
    const onValidationResult = vi.fn();

    const result = await runRunner(
      {
        command: "run",
        repo: scenario.repoPath,
        task: scenario.taskPath,
        dryRun: false,
        eventsOut: scenario.eventsOutPath,
      },
      {
        ...scenario.dependencies,
        runValidation: vi.fn(async () => cancelledValidation),
        onValidationResult,
        now: scenario.now,
      },
    );

    expect(result.exitCode).toBe(130);
    expect(result.validationResult).toEqual(cancelledValidation);
    expect(result.githubResult).toBeUndefined();
    expect(onValidationResult).toHaveBeenCalledWith(cancelledValidation.results[0]);

    const events = await readRunEvents(scenario.eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "codex_running",
      "changes_scanned",
      "validation_running",
      "cancel_requested",
      "cancelling",
      "cancelled",
    ]);
    expect(scenario.dependencies.cleanupWorktree).toHaveBeenCalledTimes(1);
    expectCancellationEvents(events.slice(-3), "during_validation", {
      cleanupAttempted: true,
      cleanupSucceeded: true,
    });
    expect(events.map((event) => event.state)).not.toContain("blocked");
    expect(events.map((event) => event.state)).not.toContain("pushed");
  });

  it.each(["before_push", "before_pr_creation"] satisfies RunnerCancellationBoundary[])(
    "emits cancellation events when GitHub flow stops at %s",
    async (boundary) => {
      const scenario = await createRunnerCancellationScenario(`run-cancel-${boundary}`);
      const runGithub = vi.fn(async () => {
        throw new RunnerError({
          category: "cancelled",
          metadata: { boundary },
        });
      });

      const result = await runRunner(
        {
          command: "run",
          repo: scenario.repoPath,
          task: scenario.taskPath,
          dryRun: false,
          eventsOut: scenario.eventsOutPath,
        },
        {
          ...scenario.dependencies,
          runGithub,
          now: scenario.now,
        },
      );

      expect(result.exitCode).toBe(130);
      expect(result.githubResult).toBeUndefined();
      expect(runGithub).toHaveBeenCalledTimes(1);
      expect(scenario.dependencies.cleanupWorktree).toHaveBeenCalledTimes(1);

      const events = await readRunEvents(scenario.eventsOutPath);
      expect(events.map((event) => event.state)).toEqual([
        "dry_run_running",
        "dry_run_passed",
        "worktree_created",
        "codex_running",
        "codex_running",
        "changes_scanned",
        "validation_running",
        "validation_running",
        "cancel_requested",
        "cancelling",
        "cancelled",
      ]);
      expectCancellationEvents(events.slice(-3), boundary, {
        cleanupAttempted: true,
        cleanupSucceeded: true,
      });
      expect(events.map((event) => event.state)).not.toContain("pushed");
      expect(events.map((event) => event.state)).not.toContain("pr_opened");
      expect(events.map((event) => event.state)).not.toContain("awaiting_approval");
    },
  );
});

const createWorkspace = async (): Promise<string> => mkdtemp(join(tmpdir(), "runner-flow-"));

const createRepoDirectory = async (workspace: string): Promise<string> => {
  const repoPath = join(workspace, "repo");
  await mkdir(repoPath);
  return repoPath;
};

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () =>
    timestamps[index++] ?? timestamps[timestamps.length - 1] ?? new Date(0).toISOString();
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<string> => {
  await writeFile(filePath, JSON.stringify(value), "utf8");
  return filePath;
};

const writeTaskPacketFile = async (filePath: string, packet: TaskPacket): Promise<string> =>
  writeJsonFile(filePath, packet);

const readRunEvents = async (eventsOutPath: string): Promise<RunEvent[]> => {
  const contents = await readFile(eventsOutPath, "utf8");

  return contents
    .trimEnd()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => RunEventSchema.parse(JSON.parse(line)));
};

const createRunnerCancellationScenario = async (runId: string) => {
  const workspace = await createWorkspace();
  const repoPath = await createRepoDirectory(workspace);
  const eventsOutPath = join(workspace, "events.jsonl");
  const worktreePath = join(repoPath, ".codex-runner-worktrees", runId);
  const taskPacket = validTaskPacket({
    id: "TASK-140",
    repositoryId: "acme/control-plane",
    runId,
    mode: "execute",
    source: {
      type: "manual",
      externalId: "manual-140",
      title: "Add runner cancellation checkpoints",
    },
    repo: {
      localPath: repoPath,
      defaultBranch: "main",
      targetBranch: `aicp/${runId}`,
      worktreePath,
    },
  });
  const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
  const dryRun = dryRunResult({
    runId,
    status: "passed",
  });
  const worktree = worktreeResultFor(taskPacket);
  const codex = safeCodexResult();
  const changeScan = safeChangeScanResult({
    changedFilePaths: ["src/app.ts"],
  });
  const validation = validationSuiteResult({
    runId,
    results: [
      createValidationResult({
        runId,
        command: taskPacket.validation.commands[0]!,
        status: "passed",
      }),
    ],
  });
  const github = githubResultFor(taskPacket, changeScan.warnings);

  return {
    taskPacket,
    repoPath,
    worktreePath,
    taskPath,
    eventsOutPath,
    dependencies: {
      runDryRun: vi.fn(async () => dryRun),
      createWorktree: vi.fn(async () => worktree),
      runCodex: vi.fn(async () => codex),
      scanChanges: vi.fn(async () => changeScan),
      runValidation: vi.fn(async () => validation),
      runGithub: vi.fn(async () => github),
      cleanupWorktree: vi.fn(async () => cleanupWorktreeResultFor(taskPacket)),
    },
    now: createClock([
      "2026-05-24T08:41:00.000Z",
      "2026-05-24T08:41:01.000Z",
      "2026-05-24T08:41:02.000Z",
      "2026-05-24T08:41:03.000Z",
      "2026-05-24T08:41:04.000Z",
      "2026-05-24T08:41:05.000Z",
      "2026-05-24T08:41:06.000Z",
      "2026-05-24T08:41:07.000Z",
      "2026-05-24T08:41:08.000Z",
      "2026-05-24T08:41:09.000Z",
      "2026-05-24T08:41:10.000Z",
      "2026-05-24T08:41:11.000Z",
    ]),
  };
};

const expectCancellationEvents = (
  events: RunEvent[],
  boundary: RunnerCancellationBoundary,
  cleanupMetadata: {
    attempt?: number;
    cleanupAttempted: boolean;
    cleanupSucceeded: boolean;
  } = {
    attempt: 1,
    cleanupAttempted: false,
    cleanupSucceeded: false,
  },
): void => {
  const attempt = cleanupMetadata.attempt ?? 1;

  expect(events).toHaveLength(3);
  expect(events.map((event) => event.state)).toEqual([
    "cancel_requested",
    "cancelling",
    "cancelled",
  ]);
  expect(events.map((event) => event.metadata)).toEqual([
    { boundary },
    { boundary },
    {
      boundary,
      cleanupAttempted: cleanupMetadata.cleanupAttempted,
      cleanupSucceeded: cleanupMetadata.cleanupSucceeded,
    },
  ]);
  expect(events.map((event) => event.idempotencyKey)).toEqual([
    createRunEventIdempotencyKey({
      runId: events[0]?.runId ?? "",
      stableStepName: `cancel_requested_${boundary}`,
      attempt,
    }),
    createRunEventIdempotencyKey({
      runId: events[0]?.runId ?? "",
      stableStepName: `cancelling_${boundary}`,
      attempt,
    }),
    createRunEventIdempotencyKey({
      runId: events[0]?.runId ?? "",
      stableStepName: `cancelled_${boundary}`,
      attempt,
    }),
  ]);
  expect(JSON.stringify(events)).not.toContain("reason");
  expect(JSON.stringify(events)).not.toContain("raw stdout");
  expect(JSON.stringify(events)).not.toContain("diff --git");
};

const expectRunnerError = async (promise: Promise<unknown>): Promise<RunnerError> => {
  try {
    await promise;
  } catch (error) {
    expect(isRunnerError(error)).toBe(true);
    return error as RunnerError;
  }

  throw new Error("Expected runRunner to reject.");
};

const expectSafeRunEventPayload = (event: RunEvent): void => {
  const eventText = JSON.stringify(event);

  for (const unsafeText of [
    OBJECTIVE_TEXT,
    SOURCE_TITLE_TEXT,
    CONTEXT_FILE_TEXT,
    CONTEXT_NOTE_TEXT,
    "prompt",
    "raw stdout",
    "raw stderr",
    "diff --git",
    "@@ -1,1 +1,1 @@",
  ]) {
    expect(eventText).not.toContain(unsafeText);
  }

  expectUnsafeMetadataKeysAbsent(event.metadata);
};

const expectRunDryRunCall = (
  runDryRun: ReturnType<typeof vi.fn>,
): {
  repoPath: string;
  taskPacket: TaskPacket;
} => {
  const call = runDryRun.mock.calls[0]?.[0] as
    | {
        repoPath: string;
        taskPacket: TaskPacket;
      }
    | undefined;

  if (call === undefined) {
    throw new Error("Expected runDryRun to be called.");
  }

  return call;
};

const expectComputedWorktreePath = ({
  repoPath,
  runDirectoryPrefix,
  taskPacket,
}: {
  repoPath: string;
  runDirectoryPrefix: string;
  taskPacket: TaskPacket;
}): void => {
  const { worktreePath } = taskPacket.repo;

  if (worktreePath === undefined) {
    throw new Error("Expected task packet to include computed worktree path.");
  }

  expect(worktreePath).toContain(join(repoPath, ".codex-runner-worktrees"));
  expect(worktreePath).toMatch(
    new RegExp(`${escapeRegExp(runDirectoryPrefix)}-[a-f0-9]{12}$`, "u"),
  );
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const expectUnsafeMetadataKeysAbsent = (value: unknown): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      expectUnsafeMetadataKeysAbsent(item);
    }
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    expect([
      "source",
      "diff",
      "patch",
      "prompt",
      "objective",
      "sourceTitle",
      "contextNotes",
      "stdout",
      "stderr",
      "rawStdout",
      "rawStderr",
    ]).not.toContain(key);
    expectUnsafeMetadataKeysAbsent(childValue);
  }
};

const dryRunResult = (
  overrides: Partial<Omit<DryRunResult, "contractVersion" | "capabilities" | "createdAt">> & {
    capabilities?: RunnerCapabilities;
    createdAt?: string;
  } = {},
): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `dry-run:${overrides.runId ?? "run-skeleton"}`,
    runId: "run-skeleton",
    status: "passed",
    checks: dryRunChecks("passed"),
    capabilities: runnerCapabilities(),
    blockers: [],
    warnings: [],
    createdAt: "2026-05-20T08:00:00.000Z",
    ...overrides,
  });

const dryRunChecks = (defaultStatus: DryRunCheckResultStatus): DryRunCheckResult[] =>
  DRY_RUN_CHECKS.map((id, index) =>
    dryRunCheck(
      id,
      index === 0 ? defaultStatus : defaultStatus === "failed" ? "skipped" : "passed",
    ),
  );

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

const worktreeResultFor = (taskPacket: TaskPacket) => {
  if (taskPacket.repo.worktreePath === undefined) {
    throw new Error("Expected task packet to include a worktree path.");
  }

  return {
    runId: taskPacket.runId,
    branchName: taskPacket.repo.targetBranch,
    baseBranch: taskPacket.repo.defaultBranch,
    worktreePath: taskPacket.repo.worktreePath,
    metadata: {
      branchName: taskPacket.repo.targetBranch,
      baseBranch: taskPacket.repo.defaultBranch,
      worktreeCreated: true,
      gitExitCode: 0,
    },
  };
};

const cleanupWorktreeResultFor = (taskPacket: TaskPacket) => {
  if (taskPacket.repo.worktreePath === undefined) {
    throw new Error("Expected task packet to include a worktree path.");
  }

  return {
    worktreePath: taskPacket.repo.worktreePath,
    removed: true,
    pruned: true,
    metadata: {
      worktreeRemoved: true,
      gitRemoveExitCode: 0,
      gitPruneExitCode: 0,
    },
  };
};

const safeCodexResult = () =>
  ({
    adapterMode: "mock",
    status: "succeeded",
    exitCode: 0,
    durationMs: 20,
    redactionApplied: true,
  }) as const;

const githubResultFor = (
  taskPacket: TaskPacket,
  riskFindings: RiskFinding[] = [],
): RunGithubForTaskResult => ({
  commitResult: {
    taskId: taskPacket.id,
    runId: taskPacket.runId,
    commitHash: COMMIT_HASH,
    changedFileCount: 2,
  },
  pushArtifact: {
    taskId: taskPacket.id,
    runId: taskPacket.runId,
    branchName: taskPacket.repo.targetBranch,
    remoteName: "origin",
    remoteRef: `refs/heads/${taskPacket.repo.targetBranch}`,
    commitHash: COMMIT_HASH,
  },
  prArtifact: {
    contractVersion: CONTRACT_VERSION,
    id: `pr:${taskPacket.runId}:81`,
    runId: taskPacket.runId,
    repository: {
      owner: "acme",
      name: "control-plane",
    },
    branchName: taskPacket.repo.targetBranch,
    prNumber: 81,
    prUrl: "https://github.example.test/acme/control-plane/pull/81",
    prTitle: "TASK-081: Wire commit/push/PR into runner flow",
    prStatus: "draft",
    changedFilePaths: ["src/app.ts", "pnpm-lock.yaml"],
    riskFindings,
    createdAt: "2026-05-22T01:10:08.000Z",
  },
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
  runId = "run-skeleton",
  status = "passed",
  shouldBlockCommit = false,
  results = [],
  warnings = [],
  blockers = [],
}: Partial<ValidationSuiteResult> & { runId?: string } = {}): ValidationSuiteResult => ({
  status,
  shouldBlockCommit,
  results:
    results.length > 0
      ? results
      : [
          createValidationResult({
            runId,
            command: validTaskPacket().validation.commands[0]!,
            status: "passed",
          }),
        ],
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
    startedAt: "2026-05-20T09:30:00.000Z",
    finishedAt: "2026-05-20T09:30:01.000Z",
  });

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
    git: { available: true, version: "2.49.0" },
    gh: { available: true, version: "2.72.0" },
    codex: { available: true, version: "1.2.3" },
    node: { available: true, version: "24.0.0" },
    npm: { available: false },
    pnpm: { available: true, version: "9.15.9" },
    yarn: { available: false },
    python: { available: false },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: false,
  reportedAt: "2026-05-20T08:00:00.000Z",
  ...overrides,
});

const validRepairTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  validTaskPacket({
    id: "TASK-147",
    mode: "repair",
    repair: {
      attempt: 1,
      feedback: "Retry with safe metadata only.",
      maxAttempts: 2,
      previousRunId: "run-original",
    },
    repo: {
      localPath: "/repo/from-task-packet",
      defaultBranch: "main",
      targetBranch: "aicp/task-147-existing-pr",
      worktreePath: "/runner/worktrees/run-repair",
    },
    runId: "run-repair",
    source: {
      externalId: "repair-147",
      title: "Repair prior run",
      type: "repair",
    },
    ...overrides,
  });

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-skeleton",
  workspaceId: "workspace-skeleton",
  repositoryId: "repo-skeleton",
  runId: "run-skeleton",
  mode: "dryRun",
  objective: OBJECTIVE_TEXT,
  acceptanceCriteria: ["Emit metadata-only dry-run events."],
  source: {
    type: "manual",
    externalId: "manual-skeleton",
    title: SOURCE_TITLE_TEXT,
    url: "https://example.test/tasks/skeleton",
  },
  repo: {
    localPath: "/repo/from-task-packet",
    defaultBranch: "main",
    targetBranch: "codex/TASK-033-wire-runner-skeleton-flow",
  },
  context: {
    files: [CONTEXT_FILE_TEXT],
    notes: [CONTEXT_NOTE_TEXT],
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
  createdAt: "2026-05-20T08:00:00.000Z",
  ...overrides,
});
