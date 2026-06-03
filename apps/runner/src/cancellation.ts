import type { RunEvent } from "@control-plane/shared";

import { cancelledEvent, cancelRequestedEvent, cancellingEvent } from "./events.js";
import type { CleanupWorktreeOptions, CleanupWorktreeResult } from "./git/cleanup-worktree.js";

export const RUNNER_CANCELLATION_BOUNDARIES = [
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
] as const;

export type RunnerCancellationBoundary = (typeof RUNNER_CANCELLATION_BOUNDARIES)[number];

export type RunnerCancellationCheckContext = {
  runId: string;
  boundary: RunnerCancellationBoundary;
};

export type RunnerCancellationChecker = (
  context: RunnerCancellationCheckContext,
) => boolean | Promise<boolean>;

export type RunnerCancellationCleanup = Pick<
  CleanupWorktreeOptions,
  "repoPath" | "worktreeRoot" | "worktreePath"
>;

export type RunnerCancellationCleanupWorktree = (
  options: RunnerCancellationCleanup,
) => Promise<CleanupWorktreeResult>;

export type RunnerCancellationEventMetadata = {
  cleanupAttempted?: boolean;
  cleanupSucceeded?: boolean;
};

export type RunnerCancelledOutcome = {
  status: "cancelled";
  exitCode: 130;
  boundary: RunnerCancellationBoundary;
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean;
};

export type RunnerCancellationCheckpointOptions = {
  cleanup?: RunnerCancellationCleanup;
};

export type RunnerCancellationGuard = {
  check: (
    boundary: RunnerCancellationBoundary,
    options?: RunnerCancellationCheckpointOptions,
  ) => Promise<boolean>;
  checkpoint: (
    boundary: RunnerCancellationBoundary,
    options?: RunnerCancellationCheckpointOptions,
  ) => Promise<RunnerCancelledOutcome | undefined>;
  emit: (
    boundary: RunnerCancellationBoundary,
    options?: RunnerCancellationCheckpointOptions,
  ) => Promise<RunnerCancelledOutcome>;
  hasObservedCancellation: () => boolean;
};

export type BuildRunnerCancellationEventsOptions = {
  runId: string;
  boundary: RunnerCancellationBoundary;
  attempt?: number;
  cleanupAttempted?: boolean;
  cleanupSucceeded?: boolean;
  now: () => string;
};

export type CreateRunnerCancellationGuardOptions = {
  runId: string;
  checkCancellation?: RunnerCancellationChecker;
  cleanupWorktree?: RunnerCancellationCleanupWorktree;
  emitCancellationEvents: (
    boundary: RunnerCancellationBoundary,
    metadata: RunnerCancellationEventMetadata,
  ) => void | Promise<void>;
};

export const buildRunnerCancellationEvents = ({
  runId,
  boundary,
  attempt,
  cleanupAttempted,
  cleanupSucceeded,
  now,
}: BuildRunnerCancellationEventsOptions): RunEvent[] => [
  cancelRequestedEvent({
    taskPacket: { runId, ...(attempt === undefined ? {} : { attempt }) },
    boundary,
    now,
  }),
  cancellingEvent({
    taskPacket: { runId, ...(attempt === undefined ? {} : { attempt }) },
    boundary,
    now,
  }),
  cancelledEvent({
    taskPacket: { runId, ...(attempt === undefined ? {} : { attempt }) },
    boundary,
    ...(cleanupAttempted === undefined ? {} : { cleanupAttempted }),
    ...(cleanupSucceeded === undefined ? {} : { cleanupSucceeded }),
    now,
  }),
];

export const createRunnerCancellationGuard = ({
  runId,
  checkCancellation = defaultRunnerCancellationChecker,
  cleanupWorktree,
  emitCancellationEvents,
}: CreateRunnerCancellationGuardOptions): RunnerCancellationGuard => {
  let observedCancellation = false;
  let outcome: RunnerCancelledOutcome | undefined;

  const cancelOnce = async (
    boundary: RunnerCancellationBoundary,
    options: RunnerCancellationCheckpointOptions = {},
  ): Promise<RunnerCancelledOutcome> => {
    if (outcome !== undefined) {
      return outcome;
    }

    const cleanupOutcome = await runOptionalCleanup({
      ...(options.cleanup === undefined ? {} : { cleanup: options.cleanup }),
      ...(cleanupWorktree === undefined ? {} : { cleanupWorktree }),
    });
    outcome = {
      status: "cancelled",
      exitCode: 130,
      boundary,
      cleanupAttempted: cleanupOutcome.cleanupAttempted,
      cleanupSucceeded: cleanupOutcome.cleanupSucceeded,
    };
    await emitCancellationEvents(boundary, cleanupOutcome);

    return outcome;
  };

  const checkpoint = async (
    boundary: RunnerCancellationBoundary,
    options?: RunnerCancellationCheckpointOptions,
  ): Promise<RunnerCancelledOutcome | undefined> => {
    if (observedCancellation) {
      return cancelOnce(boundary, options);
    }

    const cancelled = await checkCancellation({ boundary, runId });

    if (!cancelled) {
      return undefined;
    }

    observedCancellation = true;
    return cancelOnce(boundary, options);
  };

  return {
    async check(boundary, options) {
      return (await checkpoint(boundary, options)) !== undefined;
    },
    checkpoint,
    async emit(boundary, options) {
      observedCancellation = true;
      return cancelOnce(boundary, options);
    },
    hasObservedCancellation() {
      return observedCancellation;
    },
  };
};

export const isRunnerCancellationBoundary = (value: unknown): value is RunnerCancellationBoundary =>
  typeof value === "string" &&
  (RUNNER_CANCELLATION_BOUNDARIES as readonly string[]).includes(value);

const defaultRunnerCancellationChecker = (): boolean => false;

const runOptionalCleanup = async ({
  cleanup,
  cleanupWorktree,
}: {
  cleanup?: RunnerCancellationCleanup;
  cleanupWorktree?: RunnerCancellationCleanupWorktree;
}): Promise<Required<RunnerCancellationEventMetadata>> => {
  if (cleanup === undefined || cleanupWorktree === undefined) {
    return {
      cleanupAttempted: false,
      cleanupSucceeded: false,
    };
  }

  try {
    await cleanupWorktree(cleanup);

    return {
      cleanupAttempted: true,
      cleanupSucceeded: true,
    };
  } catch {
    return {
      cleanupAttempted: true,
      cleanupSucceeded: false,
    };
  }
};
