import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  DryRunResultSchema,
  RunEventSchema,
  ValidationResultSchema,
  type DryRunCheckResult,
  type DryRunCheckResultStatus,
  type DryRunResult,
  type RunEvent,
  type RunnerCapabilities,
  type RiskFinding,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";
import { describe, expect, it, vi } from "vitest";

import type { ChangeScanResult } from "../changes/scan-changes.js";
import type { RunGithubForTaskResult } from "../github.js";
import { runRunner } from "../run.js";

const OBJECTIVE_TEXT = "OBJECTIVE TEXT MUST NOT LEAK";
const SOURCE_TITLE_TEXT = "SOURCE TITLE MUST NOT LEAK";
const CONTEXT_FILE_TEXT = "src/private-context-file.ts";
const CONTEXT_NOTE_TEXT = "CONTEXT NOTE MUST NOT LEAK";
const RAW_COMMAND_OUTPUT_TEXT = "RAW COMMAND OUTPUT MUST NOT LEAK";
const RAW_DIFF_TEXT = "diff --git a/src/private.ts b/src/private.ts";
const RAW_PATCH_TEXT = "@@ -1,1 +1,1 @@";
const COMMIT_HASH = "a".repeat(40);

describe("runner event stream ordering", () => {
  it("emits dry-run events in readiness order", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPacket = validTaskPacket({ runId: "run-event-order-dry-run" });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-event-order-dry-run",
      status: "passed",
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
        runDryRun: vi.fn(async () => readinessResult),
        now: createClock(["2026-05-21T20:00:00.000Z", "2026-05-21T20:00:01.000Z"]),
      },
    );

    expect(result.exitCode).toBe(0);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "dry_run_passed"]);
    expectSchemaValidEvents(events);
  });

  it("emits readiness-blocked events in order with metadata-only blocker summaries", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const taskPacket = validTaskPacket({ runId: "run-event-order-readiness-blocked" });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const blocker = riskFinding({
      id: "risk:missing_mapping:git_repository",
      severity: "blocked",
      category: "missing_mapping",
      message: `Repository readiness failed. ${RAW_COMMAND_OUTPUT_TEXT} ${RAW_DIFF_TEXT}`,
      paths: ["README.md"],
    });
    const readinessResult = dryRunResult({
      runId: "run-event-order-readiness-blocked",
      status: "failed",
      blockers: [blocker],
      checks: dryRunChecks("failed"),
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
        runDryRun: vi.fn(async () => readinessResult),
        now: createClock(["2026-05-21T20:05:00.000Z", "2026-05-21T20:05:01.000Z"]),
      },
    );

    expect(result.exitCode).toBe(1);

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual(["dry_run_running", "blocked"]);
    expectSchemaValidEvents(events);

    const blockedMetadata = events[1]?.metadata;
    expect(blockedMetadata).toMatchObject({
      blockerCount: 1,
      blockers: [
        {
          id: "risk:missing_mapping:git_repository",
          severity: "blocked",
          category: "missing_mapping",
          paths: ["README.md"],
        },
      ],
    });
    expect(blockedMetadata).toHaveProperty("checkStatuses");
    const blockerSummary = extractFirstBlockerSummary(blockedMetadata);
    expect(Object.keys(blockerSummary).sort()).toEqual(["category", "id", "paths", "severity"]);
  });

  it("emits change-scan-blocked events in implemented execution order", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-event-order-change-scan-blocked");
    const taskPacket = validTaskPacket({
      runId: "run-event-order-change-scan-blocked",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-085-event-order-change-scan-blocked",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-event-order-change-scan-blocked",
      status: "passed",
    });
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: [".env.local", "src/config.ts"],
      blockers: [
        riskFinding({
          id: "risk:sensitive_path:env_files",
          severity: "blocked",
          category: "sensitive_path",
          message: `Environment file changed. ${RAW_COMMAND_OUTPUT_TEXT} ${RAW_PATCH_TEXT}`,
          paths: [".env.local"],
        }),
        riskFinding({
          id: "risk:secret:provider_token",
          severity: "blocked",
          category: "secret",
          message: "Suspected secret detected.",
          paths: ["src/config.ts"],
        }),
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
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => changeScanResult),
        now: createClock([
          "2026-05-21T20:10:00.000Z",
          "2026-05-21T20:10:01.000Z",
          "2026-05-21T20:10:02.000Z",
          "2026-05-21T20:10:03.000Z",
          "2026-05-21T20:10:04.000Z",
          "2026-05-21T20:10:05.000Z",
          "2026-05-21T20:10:06.000Z",
        ]),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.changeScanResult).toBe(changeScanResult);

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
    expect(events.map((event) => event.state)).not.toContain("pushed");
    expect(events.map((event) => event.state)).not.toContain("pr_opened");
    expect(events.map((event) => event.state)).not.toContain("awaiting_approval");
    expectSchemaValidEvents(events);
  });

  it("emits Codex failure events in order and stops before change scanning", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-event-order-codex-failed");
    const taskPacket = validTaskPacket({
      runId: "run-event-order-codex-failed",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-088-event-order-codex-failed",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-event-order-codex-failed",
      status: "passed",
    });
    const scanChanges = vi.fn(async () => safeChangeScanResult());
    const unsafeCodexResult = {
      adapterMode: "local",
      status: "failed",
      exitCode: 1,
      durationMs: 25,
      redactionApplied: true,
      stdoutSummary: RAW_COMMAND_OUTPUT_TEXT,
      stderrSummary: RAW_DIFF_TEXT,
      prompt: OBJECTIVE_TEXT,
      patch: RAW_PATCH_TEXT,
    } as const;

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
        runCodex: vi.fn(async () => unsafeCodexResult),
        scanChanges,
        now: createClock([
          "2026-05-21T20:15:00.000Z",
          "2026-05-21T20:15:01.000Z",
          "2026-05-21T20:15:02.000Z",
          "2026-05-21T20:15:03.000Z",
          "2026-05-21T20:15:04.000Z",
        ]),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(scanChanges).not.toHaveBeenCalled();

    const events = await readRunEvents(eventsOutPath);
    expect(events.map((event) => event.state)).toEqual([
      "dry_run_running",
      "dry_run_passed",
      "worktree_created",
      "codex_running",
      "failed",
    ]);
    expect(events[4]).toMatchObject({
      severity: "error",
      metadata: {
        adapterMode: "local",
        status: "failed",
        exitCode: 1,
        durationMs: 25,
        redactionApplied: true,
      },
    });
    expect(events[4]?.idempotencyKey).toBe(
      "run:run-event-order-codex-failed:event:codex_finished:1",
    );
    expect(events.map((event) => event.state)).not.toContain("changes_scanned");
    expect(events.map((event) => event.state)).not.toContain("validation_running");
    expectSchemaValidEvents(events);
  });

  it("emits the successful implemented execution path through PR approval in order", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-event-order-success");
    const taskPacket = validTaskPacket({
      runId: "run-event-order-success",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-088-event-order-success",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-event-order-success",
      status: "passed",
    });
    const changeScanResult = safeChangeScanResult({
      changedFilePaths: ["src/app.ts", "pnpm-lock.yaml"],
      warnings: [
        riskFinding({
          id: "risk:package_lock",
          severity: "warning",
          category: "package_lock",
          message: `Package lock changed. ${RAW_COMMAND_OUTPUT_TEXT}`,
          paths: ["pnpm-lock.yaml"],
        }),
      ],
    });
    const validationResult = validationSuiteResult({
      runId: "run-event-order-success",
      results: [
        createValidationResult({
          runId: "run-event-order-success",
          command: taskPacket.validation.commands[0]!,
          status: "passed",
        }),
      ],
    });
    const githubResult = githubResultFor(taskPacket, changeScanResult.warnings);

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
        runValidation: vi.fn(async () => validationResult),
        runGithub: vi.fn(async () => githubResult),
        now: createClock([
          "2026-05-21T20:20:00.000Z",
          "2026-05-21T20:20:01.000Z",
          "2026-05-21T20:20:02.000Z",
          "2026-05-21T20:20:03.000Z",
          "2026-05-21T20:20:04.000Z",
          "2026-05-21T20:20:05.000Z",
          "2026-05-21T20:20:06.000Z",
          "2026-05-21T20:20:07.000Z",
          "2026-05-21T20:20:08.000Z",
          "2026-05-21T20:20:09.000Z",
          "2026-05-21T20:20:10.000Z",
        ]),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.changeScanResult).toBe(changeScanResult);
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
    expect(events[5]).toMatchObject({
      severity: "warning",
      metadata: {
        changedFilePaths: ["src/app.ts", "pnpm-lock.yaml"],
        blockerCount: 0,
        warningCount: 1,
        shouldBlock: false,
      },
    });
    expect(events[6]).toMatchObject({
      severity: "info",
      metadata: {
        commandCount: 1,
        requiredCommandCount: 1,
      },
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
    expect(events[8]).toMatchObject({
      severity: "info",
      metadata: {
        branchName: "aicp/task-088-event-order-success",
        remoteName: "origin",
        remoteRef: "refs/heads/aicp/task-088-event-order-success",
        commitHash: COMMIT_HASH,
      },
    });
    expect(events[9]).toMatchObject({
      severity: "info",
      metadata: {
        prNumber: 81,
        prUrl: "https://github.example.test/acme/control-plane/pull/81",
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
      idempotencyKey: "run:run-event-order-success:event:awaiting_approval:1",
    });
    expectSchemaValidEvents(events);
  });

  it("emits failed validation events in order and stops before push, PR, or approval", async () => {
    const workspace = await createWorkspace();
    const repoPath = await createRepoDirectory(workspace);
    const eventsOutPath = join(workspace, "events.jsonl");
    const worktreePath = join(workspace, "worktrees", "run-event-order-validation-failed");
    const taskPacket = validTaskPacket({
      runId: "run-event-order-validation-failed",
      mode: "execute",
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-074-event-order-validation-failed",
        worktreePath,
      },
    });
    const taskPath = await writeTaskPacketFile(join(workspace, "task.json"), taskPacket);
    const readinessResult = dryRunResult({
      runId: "run-event-order-validation-failed",
      status: "passed",
    });
    const validationResult = validationSuiteResult({
      runId: "run-event-order-validation-failed",
      status: "failed",
      shouldBlockCommit: true,
      results: [
        createValidationResult({
          runId: "run-event-order-validation-failed",
          command: taskPacket.validation.commands[0]!,
          status: "failed",
          exitCode: 1,
          stderrSummary: "required validation failed",
        }),
      ],
      blockers: [
        {
          commandId: "test",
          commandLabel: "Run tests",
          status: "failed",
          message: `Required validation failed. ${RAW_COMMAND_OUTPUT_TEXT} ${RAW_PATCH_TEXT}`,
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
        runDryRun: vi.fn(async () => readinessResult),
        createWorktree: vi.fn(async () => worktreeResultFor(taskPacket)),
        runCodex: vi.fn(async () => safeCodexResult()),
        scanChanges: vi.fn(async () => safeChangeScanResult({ changedFilePaths: ["src/app.ts"] })),
        runValidation: vi.fn(async () => validationResult),
        now: createClock([
          "2026-05-21T20:25:00.000Z",
          "2026-05-21T20:25:01.000Z",
          "2026-05-21T20:25:02.000Z",
          "2026-05-21T20:25:03.000Z",
          "2026-05-21T20:25:04.000Z",
          "2026-05-21T20:25:05.000Z",
          "2026-05-21T20:25:06.000Z",
          "2026-05-21T20:25:07.000Z",
        ]),
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
      idempotencyKey: "run:run-event-order-validation-failed:event:validation_blocked:1",
      metadata: {
        status: "failed",
        shouldBlockCommit: true,
        warningCount: 0,
        blockerCount: 1,
      },
    });
    expectSchemaValidEvents(events);
  });
});

const createWorkspace = async (): Promise<string> => mkdtemp(join(tmpdir(), "event-order-"));

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

const expectSchemaValidEvents = (events: RunEvent[]): void => {
  for (const event of events) {
    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expectSafeRunEventPayload(event);
  }
};

const expectSafeRunEventPayload = (event: RunEvent): void => {
  const eventText = JSON.stringify(event);

  for (const unsafeText of [
    OBJECTIVE_TEXT,
    SOURCE_TITLE_TEXT,
    CONTEXT_FILE_TEXT,
    CONTEXT_NOTE_TEXT,
    RAW_COMMAND_OUTPUT_TEXT,
    RAW_DIFF_TEXT,
    RAW_PATCH_TEXT,
    "prompt",
    "raw stdout",
    "raw stderr",
  ]) {
    expect(eventText).not.toContain(unsafeText);
  }

  expectUnsafeMetadataKeysAbsent(event.metadata);
};

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

const extractFirstBlockerSummary = (metadata: unknown): Record<string, unknown> => {
  expect(metadata).toEqual(
    expect.objectContaining({
      blockers: expect.any(Array),
    }),
  );
  const blockers = (metadata as { blockers: unknown[] }).blockers;
  expect(blockers).toHaveLength(1);
  expect(typeof blockers[0]).toBe("object");
  expect(blockers[0]).not.toBeNull();

  return blockers[0] as Record<string, unknown>;
};

const dryRunResult = (
  overrides: Partial<Omit<DryRunResult, "contractVersion" | "capabilities" | "createdAt">> & {
    capabilities?: RunnerCapabilities;
    createdAt?: string;
  } = {},
): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `dry-run:${overrides.runId ?? "run-event-order"}`,
    runId: "run-event-order",
    status: "passed",
    checks: dryRunChecks("passed"),
    capabilities: runnerCapabilities(),
    blockers: [],
    warnings: [],
    createdAt: "2026-05-21T20:00:00.000Z",
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
    createdAt: "2026-05-21T20:20:08.000Z",
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
  runId = "run-event-order",
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
    startedAt: "2026-05-21T20:30:00.000Z",
    finishedAt: "2026-05-21T20:30:01.000Z",
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
  reportedAt: "2026-05-21T20:00:00.000Z",
  ...overrides,
});

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-event-order",
  workspaceId: "workspace-event-order",
  repositoryId: "repo-event-order",
  runId: "run-event-order",
  mode: "dryRun",
  objective: OBJECTIVE_TEXT,
  acceptanceCriteria: ["Emit metadata-only ordered events."],
  source: {
    type: "manual",
    externalId: "manual-event-order",
    title: SOURCE_TITLE_TEXT,
    url: "https://example.test/tasks/event-order",
  },
  repo: {
    localPath: "/repo/from-task-packet",
    defaultBranch: "main",
    targetBranch: "aicp/task-085-event-order",
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
  createdAt: "2026-05-21T20:00:00.000Z",
  ...overrides,
});
