import {
  CONTRACT_VERSION,
  ValidationResultSchema,
  type TaskPacket,
  type ValidationCommand,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationAdapter, ValidationExecutionRequest } from "@control-plane/validation";
import { describe, expect, it, vi } from "vitest";

import type { RunnerCancellationCheckContext } from "./cancellation.js";
import { runValidationForTask } from "./validation.js";

describe("runner validation boundary", () => {
  it("runs the validation suite for task-packet commands in the worktree", async () => {
    const taskPacket = validTaskPacket();
    const adapter = createAdapter({
      unit: "passed",
      lint: "passed",
    });

    const result = await runValidationForTask({
      taskPacket,
      worktreePath: "/tmp/aicp/run-validation-boundary",
      adapter,
    });

    expect(result.status).toBe("passed");
    expect(result.shouldBlockCommit).toBe(false);
    expect(result.results.map((validationResult) => validationResult.commandId)).toEqual([
      "unit",
      "lint",
    ]);
    expect(adapter.execute).toHaveBeenCalledWith({
      runId: "run-validation-boundary",
      worktreePath: "/tmp/aicp/run-validation-boundary",
      command: taskPacket.validation.commands[0],
      skip: false,
    });
    expectNoRawValidationKeys(result);
  });

  it("checks cancellation before validation and before each non-skipped command", async () => {
    const taskPacket = validTaskPacket();
    const adapter = createAdapter({
      unit: "passed",
      lint: "passed",
      typecheck: "passed",
    });
    const checkCancellation = vi.fn(async (context: RunnerCancellationCheckContext) => {
      return context.boundary === "during_validation" && context.runId === taskPacket.runId
        ? checkCancellation.mock.calls.length >= 3
        : false;
    });

    const result = await runValidationForTask({
      taskPacket: {
        ...taskPacket,
        validation: {
          commands: [
            ...taskPacket.validation.commands,
            {
              id: "typecheck",
              label: "Typecheck",
              command: "pnpm typecheck",
              timeoutSeconds: 120,
              required: true,
            },
          ],
        },
      },
      worktreePath: "/tmp/aicp/run-validation-cancel-between",
      adapter,
      checkCancellation,
    });

    expect(result.status).toBe("failed");
    expect(result.shouldBlockCommit).toBe(true);
    expect(result.results.map((validationResult) => validationResult.status)).toEqual([
      "passed",
      "cancelled",
      "skipped",
    ]);
    expect(result.blockers).toEqual([
      {
        commandId: "lint",
        commandLabel: "Lint",
        status: "cancelled",
        message: "Validation command was cancelled.",
      },
    ]);
    expect(checkCancellation).toHaveBeenCalledTimes(3);
    expect(checkCancellation.mock.calls.map(([context]) => context)).toEqual([
      { boundary: "before_validation", runId: "run-validation-boundary" },
      { boundary: "during_validation", runId: "run-validation-boundary" },
      { boundary: "during_validation", runId: "run-validation-boundary" },
    ]);
    expect(
      vi.mocked(adapter.execute).mock.calls.map((call) => ({
        commandId: call[0].command.id,
        skip: call[0].skip === true,
      })),
    ).toEqual([
      { commandId: "unit", skip: false },
      { commandId: "typecheck", skip: true },
    ]);
    expectNoRawValidationKeys(result);
  });

  it("returns a cancelled suite without executing commands when cancellation is already requested", async () => {
    const taskPacket = validTaskPacket();
    const adapter = createAdapter({
      unit: "passed",
      lint: "passed",
    });
    const checkCancellation = vi.fn(async (context: RunnerCancellationCheckContext) => {
      expect(context).toEqual({
        boundary: "before_validation",
        runId: "run-validation-boundary",
      });
      return true;
    });

    const result = await runValidationForTask({
      taskPacket,
      worktreePath: "/tmp/aicp/run-validation-cancel-before",
      adapter,
      checkCancellation,
    });

    expect(result.status).toBe("failed");
    expect(result.shouldBlockCommit).toBe(true);
    expect(result.results.map((validationResult) => validationResult.status)).toEqual([
      "cancelled",
      "skipped",
    ]);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(adapter.execute).toHaveBeenCalledWith({
      runId: "run-validation-boundary",
      worktreePath: "/tmp/aicp/run-validation-cancel-before",
      command: taskPacket.validation.commands[1],
      skip: true,
    });
    expect(checkCancellation).toHaveBeenCalledTimes(1);
    expectNoRawValidationKeys(result);
  });
});

const createAdapter = (
  statuses: Record<string, ValidationResult["status"]>,
): ValidationAdapter => ({
  execute: vi.fn(async (request: ValidationExecutionRequest) =>
    ValidationResultSchema.parse(
      createValidationResult({
        runId: request.runId,
        command: request.command,
        status: request.skip === true ? "skipped" : (statuses[request.command.id] ?? "passed"),
      }),
    ),
  ),
});

const createValidationResult = ({
  runId,
  command,
  status,
}: {
  runId: string;
  command: ValidationCommand;
  status: ValidationResult["status"];
}): ValidationResult => ({
  contractVersion: CONTRACT_VERSION,
  id: `validation:${runId}:${command.id}`,
  runId,
  commandId: command.id,
  commandLabel: command.label,
  command: command.command,
  status,
  exitCode: status === "passed" ? 0 : status === "failed" ? 1 : null,
  durationMs: status === "skipped" ? 0 : 12,
  stdoutSummary: "",
  stderrSummary: "",
  redactionApplied: true,
  startedAt: "2026-05-21T21:00:00.000Z",
  finishedAt: "2026-05-21T21:00:01.000Z",
});

const expectNoRawValidationKeys = (value: unknown): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      expectNoRawValidationKeys(item);
    }
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    expect(["stdout", "stderr", "diff", "patch", "source", "code", "prompt"]).not.toContain(key);
    expectNoRawValidationKeys(childValue);
  }
};

const validTaskPacket = (): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-validation-boundary",
  workspaceId: "workspace-validation-boundary",
  repositoryId: "repo-validation-boundary",
  runId: "run-validation-boundary",
  mode: "execute",
  objective: "Objective text stays local.",
  acceptanceCriteria: ["Run validation safely."],
  source: {
    type: "manual",
    externalId: "manual-validation-boundary",
    title: "Validation boundary",
    url: "https://example.test/tasks/validation-boundary",
  },
  repo: {
    localPath: "/repo/from-task-packet",
    defaultBranch: "main",
    targetBranch: "aicp/task-074-validation-boundary",
    worktreePath: "/tmp/aicp/run-validation-boundary",
  },
  context: {
    files: ["README.md"],
    notes: ["No raw source in events."],
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
        id: "unit",
        label: "Unit tests",
        command: "pnpm test",
        timeoutSeconds: 120,
        required: true,
      },
      {
        id: "lint",
        label: "Lint",
        command: "pnpm lint",
        timeoutSeconds: 120,
        required: false,
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
        id: "unit",
        label: "Unit tests",
        command: "pnpm test",
        timeoutSeconds: 120,
        required: true,
      },
      {
        id: "lint",
        label: "Lint",
        command: "pnpm lint",
        timeoutSeconds: 120,
        required: false,
      },
    ],
  },
  createdAt: "2026-05-21T21:00:00.000Z",
});
