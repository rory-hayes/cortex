import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import {
  DryRunResultSchema,
  PrArtifactSchema,
  TaskPacketSchema,
  type DryRunResult,
  type PrArtifact,
  type RunEvent,
  type RiskFinding,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";

import {
  scanChanges as defaultScanChanges,
  type ChangeScanResult,
} from "./changes/scan-changes.js";
import {
  buildRunnerCancellationEvents,
  createRunnerCancellationGuard,
  isRunnerCancellationBoundary,
  type RunnerCancellationBoundary,
  type RunnerCancellationChecker,
  type RunnerCancellationGuard,
} from "./cancellation.js";
import { type RunnerConfig, loadRunnerConfig } from "./config.js";
import {
  getCodexAdapterMode,
  runCodexForTask as defaultRunCodex,
  type RunCodexForTaskResult,
} from "./codex.js";
import { runDryRun as defaultRunDryRun } from "./dry-run/run-dry-run.js";
import {
  changeScanBlockedEvent,
  changesScannedEvent,
  codexFinishedEvent,
  codexRunningEvent,
  dryRunRunningEvent,
  terminalDryRunEvent,
  validationBlockedEvent,
  validationCompletedEvent,
  validationRunningEvent,
  worktreeCreatedEvent,
  awaitingApprovalEvent,
  prOpenedEvent,
  pushedEvent,
  repairBlockedEvent,
  repairStartedEvent,
} from "./events.js";
import { appendRunEvent } from "./event-writer.js";
import { isRunnerError, RunnerError } from "./errors.js";
import {
  runGithubForTask as defaultRunGithubForTask,
  type RunGithubForTaskResult,
} from "./github.js";
import { createWorktree as defaultCreateWorktree } from "./git/create-worktree.js";
import { createTaskWorktreePath as defaultCreateTaskWorktreePath } from "./git/worktree-path.js";
import {
  cleanupWorktree as defaultCleanupWorktree,
  type CleanupWorktreeOptions,
  type CleanupWorktreeResult,
} from "./git/cleanup-worktree.js";
import type { CreateWorktreeResult } from "./git/create-worktree.js";
import {
  PrepareRepairWorktreeError,
  prepareRepairWorktree as defaultPrepareRepairWorktree,
  type PrepareRepairWorktreeResult,
} from "./repair.js";
import { loadTaskPacket } from "./task-packet-loader.js";
import {
  runValidationForTask as defaultRunValidationForTask,
  safeValidationSuiteResult,
} from "./validation.js";

type RunRunnerBaseOptions = {
  command: "run";
  repo: string;
  dryRun: boolean;
  eventsOut?: string;
  configPath?: string;
};

export type RunRunnerOptions = RunRunnerBaseOptions &
  (
    | {
        task: string;
        taskPacket?: never;
      }
    | {
        task?: never;
        taskPacket: TaskPacket;
      }
  );

export type RunRunnerForTaskPacketOptions = Omit<RunRunnerBaseOptions, "command"> & {
  taskPacket: TaskPacket;
};

export type RunRunnerResult = {
  exitCode: number;
  runId: string;
  dryRunResult?: DryRunResult;
  worktreeResult?: CreateWorktreeResult;
  codexResult?: RunCodexForTaskResult;
  changeScanResult?: ChangeScanResult;
  validationResult?: ValidationSuiteResult;
  githubResult?: RunGithubForTaskResult;
  eventsOut?: string;
};

export type RunRunnerDependencies = {
  loadRunnerConfig?: (options?: { configPath?: string }) => Promise<RunnerConfig>;
  loadTaskPacket?: (taskPacketPath: string) => Promise<TaskPacket>;
  runDryRun?: typeof defaultRunDryRun;
  createWorktree?: typeof defaultCreateWorktree;
  createTaskWorktreePath?: typeof defaultCreateTaskWorktreePath;
  prepareRepairWorktree?: typeof defaultPrepareRepairWorktree;
  runCodex?: typeof defaultRunCodex;
  scanChanges?: typeof defaultScanChanges;
  runValidation?: typeof defaultRunValidationForTask;
  runGithub?: typeof defaultRunGithubForTask;
  checkCancellation?: RunnerCancellationChecker;
  cleanupWorktree?: (options: CleanupWorktreeOptions) => Promise<CleanupWorktreeResult>;
  appendRunEvent?: (eventsOutPath: string, event: unknown) => Promise<RunEvent>;
  emitRunEvent?: (event: RunEvent) => void | Promise<void>;
  onRunEvent?: (event: RunEvent) => void | Promise<void>;
  onDryRunResult?: (result: DryRunResult) => void | Promise<void>;
  onValidationResult?: (result: ValidationResult) => void | Promise<void>;
  onPrArtifact?: (artifact: PrArtifact) => void | Promise<void>;
  now?: () => string;
};

export const runRunner = async (
  options: RunRunnerOptions,
  dependencies: RunRunnerDependencies = {},
): Promise<RunRunnerResult> => {
  const config = await loadConfig(options, dependencies);
  const loadedTaskPacket = await loadTask(options, dependencies);
  const taskPacket = prepareTaskPacketForLocalRun({
    config,
    createTaskWorktreePath: dependencies.createTaskWorktreePath ?? defaultCreateTaskWorktreePath,
    repoPath: options.repo,
    taskPacket: loadedTaskPacket,
  });
  const eventsOut = options.eventsOut ?? config.eventsOut;
  const now = dependencies.now ?? currentIsoTimestamp;
  const eventAttempt = runEventAttempt(taskPacket);

  if (eventsOut !== undefined && (await isPathInside(eventsOut, options.repo))) {
    throw new RunnerError({
      category: "repo_path",
      userSafeMessage: "Event output path must be outside the target repository.",
      metadata: {
        reason: "events_out_inside_repo",
      },
    });
  }

  const emitRunEvent = createRunEventEmitter({
    eventsOut,
    appendRunEvent: dependencies.appendRunEvent ?? appendRunEvent,
    ...(dependencies.emitRunEvent === undefined ? {} : { emitRunEvent: dependencies.emitRunEvent }),
    ...(dependencies.onRunEvent === undefined ? {} : { onRunEvent: dependencies.onRunEvent }),
  });
  const cancellationGuard = createRunnerCancellationGuard({
    runId: taskPacket.runId,
    ...(dependencies.checkCancellation === undefined
      ? {}
      : { checkCancellation: dependencies.checkCancellation }),
    cleanupWorktree: dependencies.cleanupWorktree ?? defaultCleanupWorktree,
    emitCancellationEvents: async (boundary, metadata) => {
      for (const event of buildRunnerCancellationEvents({
        boundary,
        ...metadata,
        attempt: eventAttempt,
        now,
        runId: taskPacket.runId,
      })) {
        await emitRunEvent(event);
      }
    },
  });

  if (taskPacket.mode === "repair" && !options.dryRun) {
    return runRepairExecution({
      cancellationGuard,
      config,
      dependencies,
      emitRunEvent,
      eventsOut,
      now,
      repoPath: options.repo,
      taskPacket,
    });
  }

  if (await cancellationGuard.check("before_dry_run")) {
    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
    });
  }

  await emitRunEvent(dryRunRunningEvent({ taskPacket, now }));

  const dryRunResult = await (dependencies.runDryRun ?? defaultRunDryRun)(
    {
      repoPath: options.repo,
      taskPacket,
    },
    {
      now,
    },
  );
  DryRunResultSchema.parse(dryRunResult);
  await callLifecycleCallback(dependencies.onDryRunResult, dryRunResult, {
    userSafeMessage: "Runner dry-run result callback failed.",
  });

  await emitRunEvent(terminalDryRunEvent({ taskPacket, dryRunResult, now }));

  if (await cancellationGuard.check("after_dry_run")) {
    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
    });
  }

  if (
    options.dryRun ||
    taskPacket.mode === "dryRun" ||
    dryRunResult.status === "failed" ||
    dryRunResult.blockers.length > 0
  ) {
    return {
      exitCode: dryRunResult.status === "failed" || dryRunResult.blockers.length > 0 ? 1 : 0,
      runId: taskPacket.runId,
      dryRunResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  if (await cancellationGuard.check("before_worktree")) {
    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
    });
  }

  const worktreePath = requireWorktreePath(taskPacket);
  const worktreeResult = await (dependencies.createWorktree ?? defaultCreateWorktree)({
    repoPath: options.repo,
    runId: taskPacket.runId,
    dryRunResult,
    targetBranch: taskPacket.repo.targetBranch,
    defaultBranch: taskPacket.repo.defaultBranch,
    worktreePath,
  });

  await emitRunEvent(worktreeCreatedEvent({ taskPacket, worktree: worktreeResult, now }));
  const cancellationCleanup = {
    cleanup: {
      repoPath: options.repo,
      worktreeRoot: resolveCleanupWorktreeRoot(options.repo, config.worktreeRoot),
      worktreePath: worktreeResult.worktreePath,
    },
  };

  if (await cancellationGuard.check("before_codex", cancellationCleanup)) {
    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
    });
  }

  await emitRunEvent(
    codexRunningEvent({
      taskPacket,
      adapterMode: getCodexAdapterMode(config),
      now,
    }),
  );

  const rawCodexResult = await (dependencies.runCodex ?? defaultRunCodex)({
    config,
    taskPacket,
    worktreePath: worktreeResult.worktreePath,
  });
  const codexResult = safeRunCodexResult(rawCodexResult);

  await emitRunEvent(codexFinishedEvent({ taskPacket, codexResult, now }));

  if (await cancellationGuard.check("after_codex", cancellationCleanup)) {
    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
    });
  }

  if (codexResult.status !== "succeeded") {
    return {
      exitCode: 1,
      runId: taskPacket.runId,
      dryRunResult,
      worktreeResult,
      codexResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  const changeScanResult = await runChangeScan({
    scanChanges: dependencies.scanChanges ?? defaultScanChanges,
    worktreePath: worktreeResult.worktreePath,
    taskPacket,
  });

  await emitRunEvent(changesScannedEvent({ taskPacket, changeScanResult, now }));

  if (changeScanResult.shouldBlock || changeScanResult.blockers.length > 0) {
    await emitRunEvent(changeScanBlockedEvent({ taskPacket, changeScanResult, now }));

    return {
      exitCode: 1,
      runId: taskPacket.runId,
      dryRunResult,
      worktreeResult,
      codexResult,
      changeScanResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  if (await cancellationGuard.check("before_validation", cancellationCleanup)) {
    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
    });
  }

  await emitRunEvent(validationRunningEvent({ taskPacket, now }));

  const rawValidationResult = await (dependencies.runValidation ?? defaultRunValidationForTask)({
    taskPacket,
    worktreePath: worktreeResult.worktreePath,
    ...(dependencies.checkCancellation === undefined
      ? {}
      : {
          checkCancellation: ({ boundary }: { boundary: RunnerCancellationBoundary }) =>
            cancellationGuard.check(boundary, cancellationCleanup),
        }),
  });
  const validationResult = safeValidationSuiteResult(rawValidationResult);
  for (const result of validationResult.results) {
    await callLifecycleCallback(dependencies.onValidationResult, result, {
      userSafeMessage: "Runner validation result callback failed.",
    });
  }

  if (hasCancelledValidation(validationResult)) {
    await cancellationGuard.emit("during_validation", cancellationCleanup);

    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
    });
  }

  if (shouldBlockValidation(validationResult)) {
    await emitRunEvent(validationBlockedEvent({ taskPacket, validationResult, now }));

    return {
      exitCode: 1,
      runId: taskPacket.runId,
      dryRunResult,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  await emitRunEvent(validationCompletedEvent({ taskPacket, validationResult, now }));

  let githubResult: RunGithubForTaskResult;
  let pushedEventEmitted = false;
  const emitPushedEvent = async (
    pushArtifact: RunGithubForTaskResult["pushArtifact"],
  ): Promise<void> => {
    await emitRunEvent(pushedEvent({ taskPacket, pushArtifact, now }));
    pushedEventEmitted = true;
  };

  if (await cancellationGuard.check("before_commit", cancellationCleanup)) {
    return cancelledRunResult({
      dryRunResult,
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
    });
  }

  try {
    githubResult = await (dependencies.runGithub ?? defaultRunGithubForTask)({
      config,
      taskPacket,
      worktreePath: worktreeResult.worktreePath,
      changeScanResult,
      validationResult,
      ...(dependencies.checkCancellation === undefined
        ? {}
        : {
            checkCancellation: ({ boundary }: { boundary: RunnerCancellationBoundary }) =>
              cancellationGuard.check(boundary, cancellationCleanup),
          }),
      onPushArtifact: emitPushedEvent,
    });
  } catch (error) {
    if (isRunnerError(error) && error.category === "cancelled") {
      await cancellationGuard.emit(
        cancellationBoundaryFromError(error) ?? "before_commit",
        cancellationCleanup,
      );

      return cancelledRunResult({
        runId: taskPacket.runId,
        dryRunResult,
        eventsOut,
        worktreeResult,
        codexResult,
        changeScanResult,
        validationResult,
      });
    }

    throw error;
  }

  const safePrArtifact = validatePrArtifact(githubResult.prArtifact);

  if (!pushedEventEmitted) {
    await emitPushedEvent(githubResult.pushArtifact);
  }
  await emitRunEvent(prOpenedEvent({ taskPacket, prArtifact: safePrArtifact, now }));
  await callLifecycleCallback(dependencies.onPrArtifact, safePrArtifact, {
    userSafeMessage: "Runner PR artifact callback failed.",
  });
  await emitRunEvent(awaitingApprovalEvent({ taskPacket, prArtifact: safePrArtifact, now }));

  return {
    exitCode: 0,
    runId: taskPacket.runId,
    dryRunResult,
    worktreeResult,
    codexResult,
    changeScanResult,
    validationResult,
    githubResult,
    ...(eventsOut === undefined ? {} : { eventsOut }),
  };
};

const runRepairExecution = async ({
  cancellationGuard,
  config,
  dependencies,
  emitRunEvent,
  eventsOut,
  now,
  repoPath,
  taskPacket,
}: {
  cancellationGuard: RunnerCancellationGuard;
  config: RunnerConfig;
  dependencies: RunRunnerDependencies;
  emitRunEvent: (event: RunEvent) => Promise<void>;
  eventsOut: string | undefined;
  now: () => string;
  repoPath: string;
  taskPacket: TaskPacket;
}): Promise<RunRunnerResult> => {
  if (await cancellationGuard.check("before_repair")) {
    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
    });
  }

  let worktreeResult: PrepareRepairWorktreeResult;
  try {
    worktreeResult = await (dependencies.prepareRepairWorktree ?? defaultPrepareRepairWorktree)({
      repoPath,
      taskPacket,
      worktreeRoot: resolveCleanupWorktreeRoot(repoPath, config.worktreeRoot),
    });
  } catch (error) {
    if (error instanceof PrepareRepairWorktreeError) {
      await emitRunEvent(repairBlockedEvent({ taskPacket, error, now }));

      return {
        exitCode: 1,
        runId: taskPacket.runId,
        ...(eventsOut === undefined ? {} : { eventsOut }),
      };
    }

    throw error;
  }

  await emitRunEvent(repairStartedEvent({ taskPacket, now }));

  await emitRunEvent(worktreeCreatedEvent({ taskPacket, worktree: worktreeResult, now }));

  const cancellationCleanup = repairCancellationCleanup({
    config,
    repoPath,
    worktreeResult,
  });

  if (await cancellationGuard.check("before_codex", cancellationCleanup)) {
    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
    });
  }

  await emitRunEvent(
    codexRunningEvent({
      taskPacket,
      adapterMode: getCodexAdapterMode(config),
      now,
    }),
  );

  const rawCodexResult = await (dependencies.runCodex ?? defaultRunCodex)({
    config,
    taskPacket,
    worktreePath: worktreeResult.worktreePath,
  });
  const codexResult = safeRunCodexResult(rawCodexResult);

  await emitRunEvent(codexFinishedEvent({ taskPacket, codexResult, now }));

  if (await cancellationGuard.check("after_codex", cancellationCleanup)) {
    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
    });
  }

  if (codexResult.status !== "succeeded") {
    return {
      exitCode: 1,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  const changeScanResult = await runChangeScan({
    scanChanges: dependencies.scanChanges ?? defaultScanChanges,
    worktreePath: worktreeResult.worktreePath,
    taskPacket,
  });

  await emitRunEvent(changesScannedEvent({ taskPacket, changeScanResult, now }));

  if (changeScanResult.shouldBlock || changeScanResult.blockers.length > 0) {
    await emitRunEvent(changeScanBlockedEvent({ taskPacket, changeScanResult, now }));

    return {
      exitCode: 1,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  if (await cancellationGuard.check("before_validation", cancellationCleanup)) {
    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
    });
  }

  await emitRunEvent(validationRunningEvent({ taskPacket, now }));

  const rawValidationResult = await (dependencies.runValidation ?? defaultRunValidationForTask)({
    taskPacket,
    worktreePath: worktreeResult.worktreePath,
    ...(dependencies.checkCancellation === undefined
      ? {}
      : {
          checkCancellation: ({ boundary }: { boundary: RunnerCancellationBoundary }) =>
            cancellationGuard.check(boundary, cancellationCleanup),
        }),
  });
  const validationResult = safeValidationSuiteResult(rawValidationResult);
  for (const result of validationResult.results) {
    await callLifecycleCallback(dependencies.onValidationResult, result, {
      userSafeMessage: "Runner validation result callback failed.",
    });
  }

  if (hasCancelledValidation(validationResult)) {
    await cancellationGuard.emit("during_validation", cancellationCleanup);

    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
    });
  }

  if (shouldBlockValidation(validationResult)) {
    await emitRunEvent(validationBlockedEvent({ taskPacket, validationResult, now }));

    return {
      exitCode: 1,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
      ...(eventsOut === undefined ? {} : { eventsOut }),
    };
  }

  await emitRunEvent(validationCompletedEvent({ taskPacket, validationResult, now }));

  let githubResult: RunGithubForTaskResult;

  if (await cancellationGuard.check("before_commit", cancellationCleanup)) {
    return cancelledRunResult({
      eventsOut,
      runId: taskPacket.runId,
      worktreeResult,
      codexResult,
      changeScanResult,
      validationResult,
    });
  }

  try {
    githubResult = await (dependencies.runGithub ?? defaultRunGithubForTask)({
      config,
      taskPacket,
      worktreePath: worktreeResult.worktreePath,
      changeScanResult,
      validationResult,
      ...(dependencies.checkCancellation === undefined
        ? {}
        : {
            checkCancellation: ({ boundary }: { boundary: RunnerCancellationBoundary }) =>
              cancellationGuard.check(boundary, cancellationCleanup),
          }),
    });
  } catch (error) {
    if (isRunnerError(error) && error.category === "cancelled") {
      await cancellationGuard.emit(
        cancellationBoundaryFromError(error) ?? "before_commit",
        cancellationCleanup,
      );

      return cancelledRunResult({
        runId: taskPacket.runId,
        eventsOut,
        worktreeResult,
        codexResult,
        changeScanResult,
        validationResult,
      });
    }

    throw error;
  }

  const safePrArtifact = validatePrArtifact(githubResult.prArtifact);

  await emitRunEvent(pushedEvent({ taskPacket, pushArtifact: githubResult.pushArtifact, now }));
  await emitRunEvent(prOpenedEvent({ taskPacket, prArtifact: safePrArtifact, now }));
  await callLifecycleCallback(dependencies.onPrArtifact, safePrArtifact, {
    userSafeMessage: "Runner PR artifact callback failed.",
  });
  await emitRunEvent(awaitingApprovalEvent({ taskPacket, prArtifact: safePrArtifact, now }));

  return {
    exitCode: 0,
    runId: taskPacket.runId,
    worktreeResult,
    codexResult,
    changeScanResult,
    validationResult,
    githubResult,
    ...(eventsOut === undefined ? {} : { eventsOut }),
  };
};

export const runRunnerForTaskPacket = async (
  options: RunRunnerForTaskPacketOptions,
  dependencies: RunRunnerDependencies = {},
): Promise<RunRunnerResult> =>
  runRunner(
    {
      command: "run",
      repo: options.repo,
      dryRun: options.dryRun,
      taskPacket: options.taskPacket,
      ...(options.eventsOut === undefined ? {} : { eventsOut: options.eventsOut }),
      ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    },
    dependencies,
  );

const loadConfig = async (
  options: RunRunnerOptions,
  dependencies: RunRunnerDependencies,
): Promise<RunnerConfig> => {
  try {
    return await (dependencies.loadRunnerConfig ?? loadRunnerConfig)(
      options.configPath === undefined ? {} : { configPath: options.configPath },
    );
  } catch (error) {
    if (isRunnerError(error)) {
      throw error;
    }

    throw new RunnerError({
      category: "config",
      cause: error,
    });
  }
};

const loadTask = async (
  options: RunRunnerOptions,
  dependencies: RunRunnerDependencies,
): Promise<TaskPacket> => {
  if (options.taskPacket !== undefined) {
    const parsedTaskPacket = TaskPacketSchema.safeParse(options.taskPacket);

    if (!parsedTaskPacket.success) {
      throw new RunnerError({
        category: "task_packet",
        userSafeMessage: "Task packet could not be loaded or validated.",
      });
    }

    return parsedTaskPacket.data;
  }

  if (options.task === undefined) {
    throw new RunnerError({
      category: "task_packet",
      userSafeMessage: "Task packet could not be loaded or validated.",
      metadata: {
        reason: "missing_task_packet",
      },
    });
  }

  try {
    return await (dependencies.loadTaskPacket ?? loadTaskPacket)(options.task);
  } catch (error) {
    if (isRunnerError(error)) {
      throw error;
    }

    throw new RunnerError({
      category: "task_packet",
      cause: error,
    });
  }
};

const createRunEventEmitter = ({
  eventsOut,
  appendRunEvent: appendEvent,
  emitRunEvent: emitRunEventCallback,
  onRunEvent,
}: {
  eventsOut: string | undefined;
  appendRunEvent: (eventsOutPath: string, event: unknown) => Promise<RunEvent>;
  emitRunEvent?: (event: RunEvent) => void | Promise<void>;
  onRunEvent?: (event: RunEvent) => void | Promise<void>;
}) => {
  const emitRunEvent = async (event: RunEvent): Promise<void> => {
    if (eventsOut !== undefined) {
      try {
        await appendEvent(eventsOut, event);
      } catch (error) {
        if (isRunnerError(error)) {
          throw error;
        }

        throw new RunnerError({
          category: "internal",
          userSafeMessage: "Runner event output could not be written.",
          metadata: {
            eventsOutConfigured: true,
          },
          cause: error,
        });
      }
    }

    await callLifecycleCallback(emitRunEventCallback, event, {
      userSafeMessage: "Runner event callback failed.",
    });
    await callLifecycleCallback(onRunEvent, event, {
      userSafeMessage: "Runner event callback failed.",
    });
  };

  return emitRunEvent;
};

const callLifecycleCallback = async <TValue>(
  callback: ((value: TValue) => void | Promise<void>) | undefined,
  value: TValue,
  options: { userSafeMessage: string },
): Promise<void> => {
  if (callback === undefined) {
    return;
  }

  try {
    await callback(value);
  } catch (error) {
    if (isRunnerError(error)) {
      throw error;
    }

    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: options.userSafeMessage,
    });
  }
};

const validatePrArtifact = (artifact: PrArtifact): PrArtifact => {
  const parsed = PrArtifactSchema.safeParse(artifact);

  if (!parsed.success) {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner PR artifact could not be validated.",
    });
  }

  return artifact;
};

const cancelledRunResult = ({
  eventsOut,
  runId,
  dryRunResult,
  worktreeResult,
  codexResult,
  changeScanResult,
  validationResult,
}: {
  eventsOut: string | undefined;
  runId: string;
  dryRunResult?: DryRunResult;
  worktreeResult?: CreateWorktreeResult;
  codexResult?: RunCodexForTaskResult;
  changeScanResult?: ChangeScanResult;
  validationResult?: ValidationSuiteResult;
}): RunRunnerResult => ({
  exitCode: 130,
  runId,
  ...(dryRunResult === undefined ? {} : { dryRunResult }),
  ...(worktreeResult === undefined ? {} : { worktreeResult }),
  ...(codexResult === undefined ? {} : { codexResult }),
  ...(changeScanResult === undefined ? {} : { changeScanResult }),
  ...(validationResult === undefined ? {} : { validationResult }),
  ...(eventsOut === undefined ? {} : { eventsOut }),
});

const repairCancellationCleanup = ({
  config,
  repoPath,
  worktreeResult,
}: {
  config: RunnerConfig;
  repoPath: string;
  worktreeResult: PrepareRepairWorktreeResult;
}): { cleanup: CleanupWorktreeOptions } | undefined => {
  if (!worktreeResult.metadata.worktreeCreated) {
    return undefined;
  }

  return {
    cleanup: {
      repoPath,
      worktreeRoot: resolveCleanupWorktreeRoot(repoPath, config.worktreeRoot),
      worktreePath: worktreeResult.worktreePath,
    },
  };
};

const hasCancelledValidation = (validationResult: ValidationSuiteResult): boolean =>
  validationResult.results.some((result) => result.status === "cancelled") ||
  validationResult.blockers.some((blocker) => blocker.status === "cancelled");

const cancellationBoundaryFromError = (
  error: RunnerError,
): RunnerCancellationBoundary | undefined => {
  const boundary = error.metadata.boundary;

  return isRunnerCancellationBoundary(boundary) ? boundary : undefined;
};

const isPathInside = async (candidatePath: string, parentPath: string): Promise<boolean> => {
  if (isLexicallyPathInside(candidatePath, parentPath)) {
    return true;
  }

  const [realCandidate, realParent] = await Promise.all([
    resolveRealPathForPotentialOutput(candidatePath),
    resolveRealPath(parentPath),
  ]);

  return isLexicallyPathInside(realCandidate, realParent);
};

const isLexicallyPathInside = (candidatePath: string, parentPath: string): boolean => {
  const resolvedCandidate = resolve(candidatePath);
  const resolvedParent = resolve(parentPath);
  const relativePath = relative(resolvedParent, resolvedCandidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const resolveRealPath = async (targetPath: string): Promise<string> => {
  try {
    return await realpath(targetPath);
  } catch {
    return resolve(targetPath);
  }
};

const resolveRealPathForPotentialOutput = async (targetPath: string): Promise<string> => {
  const resolvedTargetPath = resolve(targetPath);
  const unresolvedParts: string[] = [];
  let currentPath = resolvedTargetPath;

  while (true) {
    try {
      const realExistingPath = await realpath(currentPath);

      return unresolvedParts.length === 0
        ? realExistingPath
        : resolve(realExistingPath, ...[...unresolvedParts].reverse());
    } catch {
      const parentPath = dirname(currentPath);

      if (parentPath === currentPath) {
        return resolvedTargetPath;
      }

      unresolvedParts.push(basename(currentPath));
      currentPath = parentPath;
    }
  }
};

const currentIsoTimestamp = (): string => new Date().toISOString();

const safeRunCodexResult = (codexResult: RunCodexForTaskResult): RunCodexForTaskResult => ({
  adapterMode: codexResult.adapterMode,
  status: codexResult.status,
  exitCode: codexResult.exitCode,
  durationMs: codexResult.durationMs,
  redactionApplied: codexResult.redactionApplied,
});

const shouldBlockValidation = (validationResult: ValidationSuiteResult): boolean =>
  validationResult.shouldBlockCommit || validationResult.blockers.length > 0;

const runChangeScan = async ({
  scanChanges,
  worktreePath,
  taskPacket,
}: {
  scanChanges: typeof defaultScanChanges;
  worktreePath: string;
  taskPacket: TaskPacket;
}): Promise<ChangeScanResult> => {
  try {
    return await scanChanges({
      worktreePath,
      policy: taskPacket.policy,
    });
  } catch {
    return failedChangeScanResult();
  }
};

const failedChangeScanResult = (): ChangeScanResult => {
  const blocker: RiskFinding = {
    id: "risk:large_diff:change_scan_failed",
    severity: "blocked",
    category: "large_diff",
    message: "Change scan could not be trusted.",
    paths: [],
  };
  const counts = emptyChangeScanCounts();

  return {
    changedFiles: {
      paths: [],
      addedPaths: [],
      modifiedPaths: [],
      deletedPaths: [],
      untrackedPaths: [],
      counts: {
        changedFileCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        omittedPathCount: 0,
      },
    },
    counts,
    blockers: [blocker],
    warnings: [],
    shouldBlock: true,
    eventMetadata: {
      changedFilePaths: [],
      counts,
      blockerCount: 1,
      warningCount: 0,
      shouldBlock: true,
      blockers: [
        {
          id: blocker.id,
          severity: blocker.severity,
          category: blocker.category,
          paths: blocker.paths,
        },
      ],
      warnings: [],
    },
  };
};

const emptyChangeScanCounts = (): ChangeScanResult["counts"] => ({
  changedFileCount: 0,
  addedCount: 0,
  modifiedCount: 0,
  deletedCount: 0,
  untrackedCount: 0,
  omittedPathCount: 0,
  evaluatedFileCount: 0,
  trackedDiffLineCount: 0,
  untrackedDiffLineCount: 0,
  diffLineCount: 0,
});

const requireWorktreePath = (taskPacket: TaskPacket): string => {
  const { worktreePath } = taskPacket.repo;

  if (typeof worktreePath === "string" && worktreePath.trim().length > 0) {
    return worktreePath;
  }

  throw new RunnerError({
    category: "internal",
    userSafeMessage: "Worktree path is unavailable after dry run.",
    metadata: {
      reason: "missing_worktree_path",
    },
  });
};

const prepareTaskPacketForLocalRun = ({
  config,
  createTaskWorktreePath,
  repoPath,
  taskPacket,
}: {
  config: Pick<RunnerConfig, "worktreeRoot">;
  createTaskWorktreePath: typeof defaultCreateTaskWorktreePath;
  repoPath: string;
  taskPacket: TaskPacket;
}): TaskPacket => {
  if (typeof taskPacket.repo.worktreePath === "string" && taskPacket.repo.worktreePath.length > 0) {
    return taskPacket;
  }

  if (taskPacket.mode === "repair") {
    return taskPacket;
  }

  const worktree = createTaskWorktreePath({
    config,
    policy: taskPacket.policy,
    repoPath,
    task: taskPacket,
  });

  return TaskPacketSchema.parse({
    ...taskPacket,
    repo: {
      ...taskPacket.repo,
      worktreePath: worktree.worktreePath,
    },
  });
};

const resolveCleanupWorktreeRoot = (repoPath: string, worktreeRoot: string): string => {
  const trimmedRoot = worktreeRoot.trim();

  return isAbsolute(trimmedRoot) ? resolve(trimmedRoot) : resolve(repoPath, trimmedRoot);
};

const runEventAttempt = (taskPacket: TaskPacket): number =>
  taskPacket.mode === "repair" && taskPacket.repair !== undefined ? taskPacket.repair.attempt : 1;
