import { RunEventSchema, createRunEventIdempotencyKey, type RunEvent } from "@control-plane/shared";
import { describe, expect, it, vi } from "vitest";

import {
  RUNNER_CANCELLATION_BOUNDARIES,
  buildRunnerCancellationEvents,
  createRunnerCancellationGuard,
  isRunnerCancellationBoundary,
  type RunnerCancellationCheckContext,
} from "./cancellation.js";

describe("runner cancellation helpers", () => {
  it("builds schema-valid metadata-only cancellation events", () => {
    const events = buildRunnerCancellationEvents({
      boundary: "before_commit",
      now: createClock([
        "2026-05-24T08:40:00.000Z",
        "2026-05-24T08:40:01.000Z",
        "2026-05-24T08:40:02.000Z",
      ]),
      runId: "run-cancel-events",
    });

    expect(events.map((event) => event.state)).toEqual([
      "cancel_requested",
      "cancelling",
      "cancelled",
    ]);
    expect(events.map((event) => event.idempotencyKey)).toEqual([
      createRunEventIdempotencyKey({
        attempt: 1,
        runId: "run-cancel-events",
        stableStepName: "cancel_requested_before_commit",
      }),
      createRunEventIdempotencyKey({
        attempt: 1,
        runId: "run-cancel-events",
        stableStepName: "cancelling_before_commit",
      }),
      createRunEventIdempotencyKey({
        attempt: 1,
        runId: "run-cancel-events",
        stableStepName: "cancelled_before_commit",
      }),
    ]);

    for (const event of events) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expect(event.metadata).toEqual({ boundary: "before_commit" });
      expectCancellationEventIsMetadataOnly(event);
    }
  });

  it("defines the approved runner-wide cancellation boundaries", () => {
    expect(RUNNER_CANCELLATION_BOUNDARIES).toEqual([
      "before_dry_run",
      "after_dry_run",
      "before_worktree",
      "before_codex",
      "after_codex",
      "before_validation",
      "during_validation",
      "before_commit",
      "before_push",
      "before_pr_creation",
      "before_repair",
    ]);
    expect(isRunnerCancellationBoundary("during_validation")).toBe(true);
    expect(isRunnerCancellationBoundary("before_validation_command")).toBe(false);
  });

  it("defaults to not-cancelled without emitting cancellation events", async () => {
    const emitCancellationEvents = vi.fn();
    const guard = createRunnerCancellationGuard({
      emitCancellationEvents,
      runId: "run-default-not-cancelled",
    });

    await expect(guard.check("before_dry_run")).resolves.toBe(false);
    await expect(guard.checkpoint("before_dry_run")).resolves.toBeUndefined();

    expect(emitCancellationEvents).not.toHaveBeenCalled();
    expect(guard.hasObservedCancellation()).toBe(false);
  });

  it("caches observed cancellation and emits terminal events only once", async () => {
    const emitted: Array<{
      boundary: string;
      cleanupAttempted?: boolean;
      cleanupSucceeded?: boolean;
    }> = [];
    const checkCancellation = vi.fn(
      async (context: RunnerCancellationCheckContext) => context.boundary === "before_commit",
    );
    const guard = createRunnerCancellationGuard({
      checkCancellation,
      emitCancellationEvents: async (boundary, metadata) => {
        emitted.push({
          boundary,
          ...metadata,
        });
      },
      runId: "run-cancel-once",
    });

    await expect(guard.check("before_validation")).resolves.toBe(false);
    await expect(guard.check("before_commit")).resolves.toBe(true);
    await expect(guard.check("before_push")).resolves.toBe(true);

    expect(checkCancellation).toHaveBeenCalledTimes(2);
    expect(checkCancellation.mock.calls.map(([context]) => context)).toEqual([
      { boundary: "before_validation", runId: "run-cancel-once" },
      { boundary: "before_commit", runId: "run-cancel-once" },
    ]);
    expect(emitted).toEqual([
      {
        boundary: "before_commit",
        cleanupAttempted: false,
        cleanupSucceeded: false,
      },
    ]);
  });

  it("returns a typed cancelled outcome and only cleans up when a worktree exists", async () => {
    const cleanupWorktree = vi.fn(async () => ({
      worktreePath: "/runner/worktrees/run-cancel-cleanup",
      removed: true,
      pruned: true,
      metadata: {
        worktreeRemoved: true,
        gitRemoveExitCode: 0,
        gitPruneExitCode: 0,
      },
    }));
    const emitted: Array<{
      boundary: string;
      cleanupAttempted?: boolean;
      cleanupSucceeded?: boolean;
    }> = [];
    const guard = createRunnerCancellationGuard({
      checkCancellation: async () => true,
      cleanupWorktree,
      emitCancellationEvents: async (boundary, metadata) => {
        emitted.push({
          boundary,
          ...metadata,
        });
      },
      runId: "run-cancel-cleanup",
    });

    await expect(guard.checkpoint("before_dry_run")).resolves.toEqual({
      boundary: "before_dry_run",
      cleanupAttempted: false,
      cleanupSucceeded: false,
      exitCode: 130,
      status: "cancelled",
    });
    expect(cleanupWorktree).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      {
        boundary: "before_dry_run",
        cleanupAttempted: false,
        cleanupSucceeded: false,
      },
    ]);

    const secondGuard = createRunnerCancellationGuard({
      checkCancellation: async () => true,
      cleanupWorktree,
      emitCancellationEvents: async () => {},
      runId: "run-cancel-cleanup",
    });
    await expect(
      secondGuard.checkpoint("before_commit", {
        cleanup: {
          repoPath: "/repo/local",
          worktreeRoot: "/runner/worktrees",
          worktreePath: "/runner/worktrees/run-cancel-cleanup",
        },
      }),
    ).resolves.toEqual({
      boundary: "before_commit",
      cleanupAttempted: true,
      cleanupSucceeded: true,
      exitCode: 130,
      status: "cancelled",
    });
    expect(cleanupWorktree).toHaveBeenCalledTimes(1);
    expect(cleanupWorktree).toHaveBeenCalledWith({
      repoPath: "/repo/local",
      worktreeRoot: "/runner/worktrees",
      worktreePath: "/runner/worktrees/run-cancel-cleanup",
    });
  });

  it("suppresses cleanup failure details from cancellation outcomes and events", async () => {
    const unsafeError = new Error(
      "git failed with raw stdout, diff --git a/src/private.ts b/src/private.ts",
    );
    unsafeError.stack =
      "Error: unsafe\n    at cleanup (/Users/example/private/repo/src/private.ts:1:1)";
    const emittedEvents: RunEvent[] = [];
    const guard = createRunnerCancellationGuard({
      checkCancellation: async () => true,
      cleanupWorktree: async () => {
        throw unsafeError;
      },
      emitCancellationEvents: async (boundary, metadata) => {
        emittedEvents.push(
          ...buildRunnerCancellationEvents({
            boundary,
            ...metadata,
            now: createClock([
              "2026-05-24T08:43:00.000Z",
              "2026-05-24T08:43:01.000Z",
              "2026-05-24T08:43:02.000Z",
            ]),
            runId: "run-cleanup-failed",
          }),
        );
      },
      runId: "run-cleanup-failed",
    });

    await expect(
      guard.checkpoint("before_commit", {
        cleanup: {
          repoPath: "/repo/local",
          worktreeRoot: "/runner/worktrees",
          worktreePath: "/runner/worktrees/run-cleanup-failed",
        },
      }),
    ).resolves.toEqual({
      boundary: "before_commit",
      cleanupAttempted: true,
      cleanupSucceeded: false,
      exitCode: 130,
      status: "cancelled",
    });

    expect(emittedEvents.map((event) => event.metadata)).toEqual([
      {
        boundary: "before_commit",
      },
      {
        boundary: "before_commit",
      },
      {
        boundary: "before_commit",
        cleanupAttempted: true,
        cleanupSucceeded: false,
      },
    ]);
    for (const event of emittedEvents) {
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expectCancellationEventIsMetadataOnly(event);
    }
  });
});

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () =>
    timestamps[index++] ?? timestamps[timestamps.length - 1] ?? new Date(0).toISOString();
};

const expectCancellationEventIsMetadataOnly = (event: RunEvent): void => {
  const serialized = JSON.stringify(event).toLowerCase();

  for (const unsafeText of [
    "reason",
    "raw stdout",
    "raw stderr",
    "diff --git",
    "@@ -1,1 +1,1 @@",
    "patch",
    "source",
    "snippet",
    "local file contents",
    "secret_token",
    "/users/",
    "/private/tmp",
  ]) {
    expect(serialized).not.toContain(unsafeText);
  }
};
