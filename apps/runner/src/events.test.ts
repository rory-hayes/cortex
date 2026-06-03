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
  type RunnerCapabilities,
  type PrArtifact,
  type RunEvent,
  type RiskFinding,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";
import { describe, expect, it } from "vitest";

import {
  claimedEvent,
  codexFinishedEvent,
  codexRunningEvent,
  cancelRequestedEvent,
  changeScanBlockedEvent,
  changesScannedEvent,
  cancelledEvent,
  cancellingEvent,
  dryRunRunningEvent,
  awaitingApprovalEvent,
  prOpenedEvent,
  pushedEvent,
  terminalDryRunEvent,
  validationBlockedEvent,
  validationCompletedEvent,
  validationRunningEvent,
  worktreeCleanupEvent,
  worktreeCreatedEvent,
} from "./events.js";
import type { ChangeScanResult } from "./changes/scan-changes.js";
import type { RunnerCancellationBoundary } from "./cancellation.js";

const OBJECTIVE_TEXT = "OBJECTIVE TEXT MUST NOT LEAK INTO WORKTREE EVENTS";
const SOURCE_TITLE_TEXT = "SOURCE TITLE MUST NOT LEAK INTO WORKTREE EVENTS";
const CONTEXT_FILE_TEXT = "src/private-worktree-context.ts";
const CONTEXT_NOTE_TEXT = "CONTEXT NOTE MUST NOT LEAK INTO WORKTREE EVENTS";
const PR_BODY_TEXT = "PR BODY MUST NOT LEAK INTO RUN EVENTS";
const BRANCH_NAME = "aicp/task-054-worktree-event";
const WORKTREE_PATH = "/private/tmp/control-plane/worktrees/run-054";
const COMMIT_HASH = "a".repeat(40);

describe("runner run event helpers", () => {
  it("builds a schema-valid claimed event with job metadata only", () => {
    const event = claimedEvent({
      taskPacket: validTaskPacket(),
      jobId: "job_120",
      now: () => "2026-05-23T11:00:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("claimed");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "claimed",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      jobId: "job_120",
      taskPacketId: "task-packet-worktree-event-helper",
      repositoryId: "repo-worktree-event-helper",
      packetMode: "execute",
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a schema-valid dry_run_running event with task metadata only", () => {
    const event = dryRunRunningEvent({
      taskPacket: validTaskPacket(),
      now: () => "2026-05-20T08:55:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("dry_run_running");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "dry_run_running",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      taskPacketId: "task-packet-worktree-event-helper",
      repositoryId: "repo-worktree-event-helper",
      packetMode: "execute",
      dryRun: true,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a dry-run blocked event with a specific idempotency step and summaries only", () => {
    const event = terminalDryRunEvent({
      taskPacket: validTaskPacket(),
      dryRunResult: dryRunResult({
        status: "failed",
        blockers: [
          riskFinding({
            id: "risk:missing_validation",
            severity: "blocked",
            category: "missing_validation",
            message: "Validation command missing. raw stdout MUST NOT LEAK",
            paths: ["README.md"],
          }),
        ],
        checks: dryRunChecks("failed"),
      }),
      now: () => "2026-05-20T08:56:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("blocked");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "dry_run_blocked",
        attempt: 1,
      }),
    );
    expect(event.metadata).toMatchObject({
      resultStatus: "failed",
      blockerCount: 1,
      blockers: [
        {
          id: "risk:missing_validation",
          severity: "blocked",
          category: "missing_validation",
          paths: ["README.md"],
        },
      ],
    });
    expect(JSON.stringify(event)).not.toContain("Validation command missing");
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a schema-valid worktree_created event with only safe worktree metadata", () => {
    const taskPacket = validTaskPacket();
    const worktreeResult = {
      runId: taskPacket.runId,
      branchName: BRANCH_NAME,
      baseBranch: "main",
      worktreePath: WORKTREE_PATH,
      metadata: {
        branchName: BRANCH_NAME,
        baseBranch: "main",
        worktreeCreated: true,
        gitExitCode: 0,
        diff: "diff --git a/src/private.ts b/src/private.ts",
        patch: "@@ -1,1 +1,1 @@",
        source: "export const source = true;",
        code: "const privateCode = true;",
        stdoutSummary: "raw stdout MUST NOT LEAK",
        stderrSummary: "raw stderr MUST NOT LEAK",
      },
    };

    const event = worktreeCreatedEvent({
      taskPacket,
      worktree: worktreeResult,
      now: () => "2026-05-20T09:00:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("worktree_created");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "worktree_created",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds cleanup events with canonical existing run states only", () => {
    const event = worktreeCleanupEvent({
      taskPacket: validTaskPacket(),
      state: "failed",
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      now: () => "2026-05-20T09:05:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("failed");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "failed_worktree_cleanup",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it.each([
    {
      boundary: "before_commit",
      state: "cancel_requested",
      stableStepName: "cancel_requested_before_commit",
      buildEvent: cancelRequestedEvent,
      expectedMetadata: {
        boundary: "before_commit",
      },
    },
    {
      boundary: "before_commit",
      state: "cancelling",
      stableStepName: "cancelling_before_commit",
      buildEvent: cancellingEvent,
      expectedMetadata: {
        boundary: "before_commit",
      },
    },
    {
      boundary: "before_commit",
      state: "cancelled",
      stableStepName: "cancelled_before_commit",
      buildEvent: cancelledEvent,
      expectedMetadata: {
        boundary: "before_commit",
        cleanupAttempted: true,
        cleanupSucceeded: false,
      },
    },
  ] satisfies {
    boundary: RunnerCancellationBoundary;
    buildEvent: (input: {
      taskPacket: Pick<TaskPacket, "runId">;
      boundary: RunnerCancellationBoundary;
      cleanupAttempted?: boolean;
      cleanupSucceeded?: boolean;
      now: () => string;
    }) => RunEvent;
    expectedMetadata: Record<string, unknown>;
    stableStepName: string;
    state: RunEvent["state"];
  }[])(
    "builds a schema-valid $state cancellation event with a boundary-specific idempotency key",
    ({ boundary, buildEvent, expectedMetadata, stableStepName, state }) => {
      const event = buildEvent({
        taskPacket: validTaskPacket(),
        boundary,
        cleanupAttempted: true,
        cleanupSucceeded: false,
        now: () => "2026-05-24T08:42:00.000Z",
      });

      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expect(event.state).toBe(state);
      expect(event.idempotencyKey).toBe(
        createRunEventIdempotencyKey({
          runId: "run-worktree-event-helper",
          stableStepName,
          attempt: 1,
        }),
      );
      expect(event.metadata).toEqual(expectedMetadata);
      expectSafeWorktreeEventPayload(event);
    },
  );

  it("builds a schema-valid codex_running start event with adapter metadata only", () => {
    const event = codexRunningEvent({
      taskPacket: validTaskPacket(),
      adapterMode: "mock",
      now: () => "2026-05-20T09:10:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("codex_running");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "codex_running",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      adapterMode: "mock",
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a schema-valid successful Codex finish event without a new run state", () => {
    const event = codexFinishedEvent({
      taskPacket: validTaskPacket(),
      codexResult: {
        adapterMode: "mock",
        status: "succeeded",
        exitCode: 0,
        durationMs: 42,
        redactionApplied: true,
      },
      now: () => "2026-05-20T09:11:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("codex_running");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "codex_finished",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      adapterMode: "mock",
      status: "succeeded",
      exitCode: 0,
      durationMs: 42,
      redactionApplied: true,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a failed Codex finish event with metadata-only failure details", () => {
    const event = codexFinishedEvent({
      taskPacket: validTaskPacket(),
      codexResult: {
        adapterMode: "local",
        status: "failed",
        exitCode: 1,
        durationMs: 99,
        redactionApplied: true,
        stdoutSummary: "raw stdout MUST NOT LEAK",
        stderrSummary: "raw stderr MUST NOT LEAK",
        prompt: OBJECTIVE_TEXT,
        patch: "@@ -1,1 +1,1 @@",
      } as never,
      now: () => "2026-05-20T09:12:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("failed");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "codex_finished",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      adapterMode: "local",
      status: "failed",
      exitCode: 1,
      durationMs: 99,
      redactionApplied: true,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a schema-valid changes_scanned event with safe scan metadata", () => {
    const event = changesScannedEvent({
      taskPacket: validTaskPacket(),
      changeScanResult: changeScanResult({
        changedFilePaths: ["src/app.ts", "docs/readme.md"],
      }),
      now: () => "2026-05-20T09:20:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("changes_scanned");
    expect(event.severity).toBe("info");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "changes_scanned",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      changedFilePaths: ["src/app.ts", "docs/readme.md"],
      counts: {
        changedFileCount: 2,
        addedCount: 0,
        modifiedCount: 2,
        deletedCount: 0,
        untrackedCount: 0,
        omittedPathCount: 0,
        evaluatedFileCount: 2,
        trackedDiffLineCount: 8,
        untrackedDiffLineCount: 0,
        diffLineCount: 8,
      },
      blockerCount: 0,
      warningCount: 0,
      shouldBlock: false,
      blockers: [],
      warnings: [],
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a warning-severity changes_scanned event when scan warnings exist", () => {
    const event = changesScannedEvent({
      taskPacket: validTaskPacket(),
      changeScanResult: changeScanResult({
        changedFilePaths: ["pnpm-lock.yaml"],
        warnings: [
          {
            id: "risk:package_lock",
            severity: "warning",
            category: "package_lock",
            message: "Package lock changes require review.",
            paths: ["pnpm-lock.yaml"],
          },
        ],
      }),
      now: () => "2026-05-20T09:21:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("changes_scanned");
    expect(event.severity).toBe("warning");
    expect(event.metadata).toMatchObject({
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
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds blocked scan metadata without trusting raw scan extras", () => {
    const event = changesScannedEvent({
      taskPacket: validTaskPacket(),
      changeScanResult: {
        ...changeScanResult({
          changedFilePaths: [".env.local", "src/config.ts", "SECURITY_MODEL.md"],
          blockers: [
            {
              id: "risk:sensitive_path:env_files",
              severity: "blocked",
              category: "sensitive_path",
              message: "Changed environment files are blocked.",
              paths: [".env.local"],
            },
            {
              id: "risk:secret:provider_token",
              severity: "blocked",
              category: "secret",
              message: "Suspected secret detected: provider_token.",
              paths: ["src/config.ts"],
            },
            {
              id: "risk:protected_path",
              severity: "blocked",
              category: "protected_path",
              message: "Protected path changes are blocked by repository policy.",
              paths: ["SECURITY_MODEL.md"],
            },
          ],
        }),
        eventMetadata: {
          changedFilePaths: [".env.local"],
          counts: safeChangeScanCounts(1),
          blockerCount: 1,
          warningCount: 0,
          shouldBlock: true,
          blockers: [],
          warnings: [],
          diff: "diff --git a/src/private.ts b/src/private.ts",
          patch: "@@ -1,1 +1,1 @@",
          source: "export const source = true;",
          code: "const privateCode = true;",
          prompt: OBJECTIVE_TEXT,
          stdout: "raw stdout MUST NOT LEAK",
          stderr: "raw stderr MUST NOT LEAK",
        },
      } as never,
      now: () => "2026-05-20T09:22:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("changes_scanned");
    expect(event.severity).toBe("blocked");
    expect(event.metadata).toMatchObject({
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
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a terminal blocked event for hard change-scan blockers", () => {
    const event = changeScanBlockedEvent({
      taskPacket: validTaskPacket(),
      changeScanResult: changeScanResult({
        changedFilePaths: [".env.local"],
        blockers: [
          {
            id: "risk:sensitive_path:env_files",
            severity: "blocked",
            category: "sensitive_path",
            message: "Changed environment files are blocked.",
            paths: [".env.local"],
          },
        ],
      }),
      now: () => "2026-05-20T09:23:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("blocked");
    expect(event.severity).toBe("blocked");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "change_scan_blocked",
        attempt: 1,
      }),
    );
    expect(event.metadata).toMatchObject({
      changedFilePaths: [".env.local"],
      blockerCount: 1,
      warningCount: 0,
      shouldBlock: true,
      blockers: [
        {
          id: "risk:sensitive_path:env_files",
          severity: "blocked",
          category: "sensitive_path",
          paths: [".env.local"],
        },
      ],
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a validation_running start event with command counts only", () => {
    const taskPacket = validTaskPacket({
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
    });

    const event = validationRunningEvent({
      taskPacket,
      now: () => "2026-05-20T09:30:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("validation_running");
    expect(event.severity).toBe("info");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "validation_running",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      commandCount: 2,
      requiredCommandCount: 1,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a validation completion event with redacted command result summaries only", () => {
    const taskPacket = validTaskPacket();
    const result = validationSuiteResult({
      results: [
        {
          ...createValidationResult({
            runId: taskPacket.runId,
            command: taskPacket.validation.commands[0]!,
            status: "passed",
            stdoutSummary: "safe redacted validation summary",
          }),
          command: "pnpm test -- SECRET_TOKEN=do-not-print",
          stdout: "raw stdout MUST NOT LEAK",
          stderr: "raw stderr MUST NOT LEAK",
          diff: "diff --git a/src/private.ts b/src/private.ts",
          patch: "@@ -1,1 +1,1 @@",
          source: "export const source = true;",
          code: "const privateCode = true;",
          prompt: OBJECTIVE_TEXT,
        } as never,
      ],
    });

    const event = validationCompletedEvent({
      taskPacket,
      validationResult: result,
      now: () => "2026-05-20T09:31:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("validation_running");
    expect(event.severity).toBe("info");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "validation_completed",
        attempt: 1,
      }),
    );
    expect(event.metadata).toMatchObject({
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
          stdoutSummary: "safe redacted validation summary",
          stderrSummary: "",
          redactionApplied: true,
        },
      ],
    });
    const firstResult = extractFirstValidationResultSummary(event.metadata);
    expect(Object.keys(firstResult).sort()).toEqual([
      "commandId",
      "commandLabel",
      "durationMs",
      "exitCode",
      "redactionApplied",
      "status",
      "stderrSummary",
      "stdoutSummary",
    ]);
    expect(JSON.stringify(event)).not.toContain("pnpm test");
    expect(JSON.stringify(event)).not.toContain("SECRET_TOKEN");
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a blocked validation event with a stable validation_blocked idempotency key", () => {
    const taskPacket = validTaskPacket();
    const result = validationSuiteResult({
      status: "failed",
      shouldBlockCommit: true,
      results: [
        createValidationResult({
          runId: taskPacket.runId,
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
          message: "Required validation command failed.",
        },
      ],
    });

    const event = validationBlockedEvent({
      taskPacket,
      validationResult: result,
      now: () => "2026-05-20T09:32:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("blocked");
    expect(event.severity).toBe("blocked");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "validation_blocked",
        attempt: 1,
      }),
    );
    expect(event.metadata).toMatchObject({
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
          stderrSummary: "required validation failed",
          redactionApplied: true,
        },
      ],
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("keeps warning validation finish events in validation_running state", () => {
    const taskPacket = validTaskPacket();
    const result = validationSuiteResult({
      status: "warning",
      shouldBlockCommit: false,
      results: [
        createValidationResult({
          runId: taskPacket.runId,
          command: taskPacket.validation.commands[0]!,
          status: "failed",
          exitCode: 1,
          stderrSummary: "optional validation failed",
        }),
      ],
      warnings: [
        {
          commandId: "test",
          commandLabel: "Run tests",
          status: "failed",
          message: "Optional validation command failed.",
        },
      ],
    });

    const event = validationCompletedEvent({
      taskPacket,
      validationResult: result,
      now: () => "2026-05-20T09:33:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("validation_running");
    expect(event.severity).toBe("warning");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "validation_completed",
        attempt: 1,
      }),
    );
    expect(event.metadata).toMatchObject({
      status: "warning",
      shouldBlockCommit: false,
      warningCount: 1,
      blockerCount: 0,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a pushed event with branch and commit metadata only", () => {
    const event = pushedEvent({
      taskPacket: validTaskPacket(),
      pushArtifact: {
        taskId: "task-packet-worktree-event-helper",
        runId: "run-worktree-event-helper",
        branchName: BRANCH_NAME,
        remoteName: "origin",
        remoteRef: `refs/heads/${BRANCH_NAME}`,
        commitHash: COMMIT_HASH,
        stdout: "raw stdout MUST NOT LEAK",
        patch: "@@ -1,1 +1,1 @@",
      } as never,
      now: () => "2026-05-20T09:40:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("pushed");
    expect(event.severity).toBe("info");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "pushed",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      branchName: BRANCH_NAME,
      remoteName: "origin",
      remoteRef: `refs/heads/${BRANCH_NAME}`,
      commitHash: COMMIT_HASH,
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds a pr_opened event with PR artifact metadata and risk summaries only", () => {
    const event = prOpenedEvent({
      taskPacket: validTaskPacket(),
      prArtifact: {
        ...prArtifact(),
        body: PR_BODY_TEXT,
        diff: "diff --git a/src/private.ts b/src/private.ts",
        riskFindings: [
          {
            id: "risk:package_lock",
            severity: "warning",
            category: "package_lock",
            message: "Package lock changed. raw stdout MUST NOT LEAK",
            paths: ["pnpm-lock.yaml"],
          },
        ],
      } as never,
      now: () => "2026-05-20T09:41:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("pr_opened");
    expect(event.severity).toBe("info");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "pr_opened",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      repository: {
        owner: "acme",
        name: "control-plane",
      },
      branchName: BRANCH_NAME,
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
    });
    expectSafeWorktreeEventPayload(event);
  });

  it("builds an awaiting_approval event from the same safe PR metadata", () => {
    const event = awaitingApprovalEvent({
      taskPacket: validTaskPacket(),
      prArtifact: prArtifact(),
      now: () => "2026-05-20T09:42:00.000Z",
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.state).toBe("awaiting_approval");
    expect(event.severity).toBe("info");
    expect(event.idempotencyKey).toBe(
      createRunEventIdempotencyKey({
        runId: "run-worktree-event-helper",
        stableStepName: "awaiting_approval",
        attempt: 1,
      }),
    );
    expect(event.metadata).toEqual({
      repository: {
        owner: "acme",
        name: "control-plane",
      },
      branchName: BRANCH_NAME,
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
    });
    expectSafeWorktreeEventPayload(event);
  });
});

const expectSafeWorktreeEventPayload = (event: unknown): void => {
  const eventText = JSON.stringify(event);

  for (const unsafeText of [
    OBJECTIVE_TEXT,
    SOURCE_TITLE_TEXT,
    CONTEXT_FILE_TEXT,
    CONTEXT_NOTE_TEXT,
    PR_BODY_TEXT,
    "raw stdout",
    "raw stderr",
    "diff --git",
    "@@ -1,1 +1,1 @@",
    "export const source",
    "const privateCode",
    "prompt",
  ]) {
    expect(eventText).not.toContain(unsafeText);
  }
};

const prArtifact = (): PrArtifact => ({
  contractVersion: CONTRACT_VERSION,
  id: "pr:run-worktree-event-helper:81",
  runId: "run-worktree-event-helper",
  repository: {
    owner: "acme",
    name: "control-plane",
  },
  branchName: BRANCH_NAME,
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
      message: "Package lock changed.",
      paths: ["pnpm-lock.yaml"],
    },
  ],
  createdAt: "2026-05-20T09:41:00.000Z",
});

const extractFirstValidationResultSummary = (metadata: unknown): Record<string, unknown> => {
  expect(metadata).toEqual(
    expect.objectContaining({
      results: expect.any(Array),
    }),
  );
  const results = (metadata as { results: unknown[] }).results;
  expect(results).toHaveLength(1);
  expect(typeof results[0]).toBe("object");
  expect(results[0]).not.toBeNull();

  return results[0] as Record<string, unknown>;
};

const safeChangeScanCounts = (changedFileCount: number): ChangeScanResult["counts"] => ({
  changedFileCount,
  addedCount: 0,
  modifiedCount: changedFileCount,
  deletedCount: 0,
  untrackedCount: 0,
  omittedPathCount: 0,
  evaluatedFileCount: changedFileCount,
  trackedDiffLineCount: changedFileCount * 4,
  untrackedDiffLineCount: 0,
  diffLineCount: changedFileCount * 4,
});

const changeScanResult = ({
  changedFilePaths = [],
  blockers = [],
  warnings = [],
}: {
  changedFilePaths?: string[];
  blockers?: ChangeScanResult["blockers"];
  warnings?: ChangeScanResult["warnings"];
} = {}): ChangeScanResult => {
  const counts = safeChangeScanCounts(changedFilePaths.length);

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
  results = [],
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
    startedAt: "2026-05-20T09:30:00.000Z",
    finishedAt: "2026-05-20T09:30:01.000Z",
  });

const dryRunResult = (
  overrides: Partial<Omit<DryRunResult, "contractVersion" | "capabilities" | "createdAt">> & {
    capabilities?: RunnerCapabilities;
    createdAt?: string;
  } = {},
): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `dry-run:${overrides.runId ?? "run-worktree-event-helper"}`,
    runId: "run-worktree-event-helper",
    status: "passed",
    checks: dryRunChecks("passed"),
    capabilities: runnerCapabilities(),
    blockers: [],
    warnings: [],
    createdAt: "2026-05-20T08:56:00.000Z",
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
  label: id,
  status,
  message: `${id} ${status}.`,
  metadata: {
    status,
  },
});

const riskFinding = (
  input: Omit<RiskFinding, "paths"> & {
    paths?: string[];
  },
): RiskFinding => ({
  ...input,
  paths: input.paths ?? [],
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
  reportedAt: "2026-05-20T08:56:00.000Z",
  ...overrides,
});

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-worktree-event-helper",
  workspaceId: "workspace-worktree-event-helper",
  repositoryId: "repo-worktree-event-helper",
  runId: "run-worktree-event-helper",
  mode: "execute",
  objective: OBJECTIVE_TEXT,
  acceptanceCriteria: ["Emit safe worktree events."],
  source: {
    type: "manual",
    externalId: "manual-worktree-event-helper",
    title: SOURCE_TITLE_TEXT,
    url: "https://example.test/tasks/worktree-event-helper",
  },
  repo: {
    localPath: "/repo/from-task-packet",
    defaultBranch: "main",
    targetBranch: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
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
  createdAt: "2026-05-20T09:00:00.000Z",
  ...overrides,
});
