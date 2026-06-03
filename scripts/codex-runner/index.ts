import { open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPromptContext, ensureAgentInstructions } from "./agent-policy.js";
import {
  findNextReadyTaskId,
  parseBacklog,
  selectReadyTasks,
  updateTaskStatus,
} from "./backlog.js";
import { parseReviewFromCodexOutput, renderPrompt, runCodexExec } from "./codex.js";
import {
  buildBranchName,
  commitAll,
  createDraftPr,
  createWorktree,
  cleanupMergedTaskResources,
  findExistingDraftPr,
  getChangedFiles,
  isGitClean,
  preparePnpmWorktree,
  pushBranch,
  restoreBookkeepingFiles,
  refreshBranchFromMain,
  mergeBranchToMain,
} from "./git.js";
import { createRunLogger, safeJson } from "./logger.js";
import { sanitizeArtifactText, scanQualityGates } from "./quality-gates.js";
import type {
  BacklogTask,
  ExecutedTaskSummary,
  QualityGateResult,
  RunnerAdapters,
  RunnerMode,
  RunnerOptions,
  RunnerSummary,
  ValidationCommand,
  ValidationResult,
} from "./types.js";
import { runValidationCommands, validationCommandsFromTask } from "./validation.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const minimumCodexTimeoutMs = 60_000;

type TaskExecutionResult = ExecutedTaskSummary & {
  task?: BacklogTask;
  validationResults?: ValidationResult[];
  deferredBookkeeping?: boolean;
  worktreeRoot?: string;
};

const bookkeepingFiles = new Set(["BACKLOG.md", "README.md"]);

export async function runBacklogRunner(options: RunnerOptions): Promise<RunnerSummary> {
  validateConcurrencyOptions(options);
  const repoRoot = options.repoRoot ?? repositoryRoot;
  const adapters = options.adapters
    ? createInjectedAdapters(options.adapters, options.codexTimeoutMs)
    : createProductionAdapters(options.codexTimeoutMs);
  const lock = await acquireRunnerLock(repoRoot);
  if (!lock.acquired) {
    return {
      mode: options.mode,
      executed: [],
      stoppedReason: "runner_locked",
    };
  }

  try {
    const maxTasks = options.mode.kind === "all" ? Number.POSITIVE_INFINITY : options.mode.value;
    const concurrency = options.concurrency ?? 1;
    const executed: ExecutedTaskSummary[] = [];

    await ensureAgentInstructions(repoRoot);

    if (concurrency > 1) {
      return await runConcurrentBacklogRunner(repoRoot, options, adapters, maxTasks);
    }

    while (executed.length < maxTasks) {
      const backlogPath = resolve(repoRoot, "BACKLOG.md");
      const backlog = await readFile(backlogPath, "utf8");
      const [task] = selectReadyTasks(parseBacklog(backlog), { limit: 1 });

      if (!task) {
        return {
          mode: options.mode,
          executed,
          stoppedReason: executed.length === 0 ? "no_ready_tasks" : "completed_ready_tasks",
        };
      }

      const clean = await adapters.ensureClean(repoRoot);
      if (!clean) {
        return {
          mode: options.mode,
          executed,
          stoppedReason: "dirty_repo",
        };
      }

      const result = await executeTask(repoRoot, backlogPath, task, options, adapters);
      executed.push(publicTaskSummary(result));

      if (result.status === "pr_opened") {
        return {
          mode: options.mode,
          executed,
          stoppedReason: "awaiting_manual_merge",
        };
      }

      if (result.status === "merged") {
        continue;
      }

      return {
        mode: options.mode,
        executed,
        stoppedReason: stopReasonFor(result.status),
      };
    }

    return {
      mode: options.mode,
      executed,
      stoppedReason: "limit_reached",
    };
  } finally {
    await lock.release();
  }
}

function validateConcurrencyOptions(options: RunnerOptions): void {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (concurrency > 1 && !options.autoMerge) {
    throw new Error("--concurrency greater than 1 requires --auto-merge.");
  }
  if (concurrency > 1 && !options.approvePlan) {
    throw new Error("--concurrency greater than 1 requires --approve-plan.");
  }
}

function canRunWithActiveTasks(candidate: BacklogTask, activeTasks: BacklogTask[]): boolean {
  const candidateFiles = conflictRelevantFiles(candidate);
  if (candidateFiles.size === 0) {
    return true;
  }

  return activeTasks.every((activeTask) => {
    const activeFiles = conflictRelevantFiles(activeTask);
    return ![...candidateFiles].some((file) => activeFiles.has(file));
  });
}

function conflictRelevantFiles(task: BacklogTask): Set<string> {
  return new Set(
    task.filesLikelyTouched
      .map(normalizeRepoPath)
      .filter((file) => file && !bookkeepingFiles.has(file)),
  );
}

async function runConcurrentBacklogRunner(
  repoRoot: string,
  options: RunnerOptions,
  adapters: RunnerAdapters,
  maxTasks: number,
): Promise<RunnerSummary> {
  const concurrency = options.concurrency ?? 1;
  const backlogPath = resolve(repoRoot, "BACKLOG.md");
  const active: Array<{
    taskId: string;
    task: BacklogTask;
    promise: Promise<TaskExecutionResult>;
  }> = [];
  const startedTaskIds = new Set<string>();
  const executed: ExecutedTaskSummary[] = [];
  let stopLaunching = false;
  let terminalReason: string | undefined;

  const launchMore = async (): Promise<void> => {
    while (
      !stopLaunching &&
      active.length < concurrency &&
      executed.length + active.length < maxTasks
    ) {
      const clean = await adapters.ensureClean(repoRoot);
      if (!clean) {
        stopLaunching = true;
        terminalReason = "dirty_repo";
        return;
      }

      const backlog = await readFile(backlogPath, "utf8");
      const activeTasks = active.map((entry) => entry.task);
      const task = selectReadyTasks(parseBacklog(backlog))
        .filter((candidate) => !startedTaskIds.has(candidate.id))
        .find((candidate) => canRunWithActiveTasks(candidate, activeTasks));

      if (!task) {
        return;
      }

      startedTaskIds.add(task.id);
      active.push({
        taskId: task.id,
        task,
        promise: executeTask(
          repoRoot,
          backlogPath,
          task,
          { ...options, autoMerge: false, concurrency: 1, deferBookkeeping: true },
          adapters,
        ),
      });
    }
  };

  await launchMore();

  while (active.length > 0) {
    const completed = await Promise.race(
      active.map((entry, index) =>
        entry.promise.then((result) => ({
          index,
          result,
        })),
      ),
    );
    active.splice(completed.index, 1);

    let result = completed.result;
    if (result.status === "pr_opened" && options.autoMerge && !terminalReason) {
      result = await mergeQueuedTask(repoRoot, result, adapters);
      if (result.status === "merge_blocked") {
        stopLaunching = true;
        terminalReason = "merge_blocked";
      }
    } else if (result.status === "pr_opened" && !options.autoMerge) {
      stopLaunching = true;
      terminalReason = "awaiting_manual_merge";
    }

    executed.push(publicTaskSummary(result));

    if (!terminalReason && (result.status === "planned" || result.status === "dry_run_passed")) {
      stopLaunching = true;
      terminalReason = stopReasonFor(result.status);
    }

    await launchMore();
  }

  if (terminalReason) {
    return {
      mode: options.mode,
      executed,
      stoppedReason: terminalReason,
    };
  }

  const failedTask = executed.find(
    (task) => task.status !== "merged" && task.status !== "pr_opened",
  );
  if (failedTask) {
    return {
      mode: options.mode,
      executed,
      stoppedReason: stopReasonFor(failedTask.status),
    };
  }

  if (executed.length >= maxTasks) {
    return {
      mode: options.mode,
      executed,
      stoppedReason: "limit_reached",
    };
  }

  return {
    mode: options.mode,
    executed,
    stoppedReason: executed.length === 0 ? "no_ready_tasks" : "completed_ready_tasks",
  };
}

async function executeTask(
  repoRoot: string,
  backlogPath: string,
  task: BacklogTask,
  options: RunnerOptions,
  adapters: RunnerAdapters,
): Promise<TaskExecutionResult> {
  const logger = await createRunLogger(repoRoot, task);
  const branchName = buildBranchName(task.id, task.title);
  const maxCodexAttempts = options.codexAttempts ?? 2;
  const deferBookkeeping = options.deferBookkeeping ?? false;
  let phase = "setup";
  let worktreeRoot = repoRoot;

  try {
    if (options.dryRun) {
      await logger.writeArtifact(
        "summary.json",
        safeJson({ taskId: task.id, status: "dry_run_passed" }),
      );
      return emptyTaskSummary(task, branchName, logger.runId, logger.directory, "dry_run_passed");
    }

    const promptContext = await buildPromptContext(repoRoot, task);
    const planPrompt = await renderPrompt("plan-task.md", {
      promptContext,
      taskId: task.id,
      taskTitle: task.title,
    });
    phase = "plan";
    const plan = await runCodexPhase({
      phase,
      logger,
      maxAttempts: maxCodexAttempts,
      operation: () =>
        adapters.codexPlan(planPrompt, {
          repoRoot,
          task,
          runId: logger.runId,
        }),
    });
    await logger.writeArtifact("plan.md", sanitizeArtifactText(plan));

    if (!options.approvePlan) {
      await logger.writeArtifact(
        "summary.json",
        safeJson({ taskId: task.id, status: "planned", approvalRequired: true }),
      );
      return emptyTaskSummary(task, branchName, logger.runId, logger.directory, "planned");
    }

    phase = "worktree";
    worktreeRoot = await adapters.createWorktree(repoRoot, task, branchName, logger.runId);
    phase = "prepare-worktree";
    await adapters.prepareWorktree(worktreeRoot);
    if (!deferBookkeeping) {
      await markTaskStarted(worktreeRoot, task, logger.runId, branchName);
    }

    const implementPrompt = await renderPrompt("implement-task.md", {
      promptContext,
      taskId: task.id,
      taskTitle: task.title,
      plan,
      bookkeepingInstructions: bookkeepingInstructions(deferBookkeeping),
    });
    phase = "implement";
    const implementationOutput = await runCodexPhase({
      phase,
      logger,
      maxAttempts: maxCodexAttempts,
      operation: () =>
        adapters.codexImplement(implementPrompt, {
          repoRoot: worktreeRoot,
          task,
          runId: logger.runId,
        }),
    });
    if (deferBookkeeping) {
      await adapters.resetBookkeepingFiles(worktreeRoot);
    }
    await logger.writeArtifact(
      "implementation-summary.txt",
      [
        "Implementation phase completed.",
        `Codex output bytes: ${Buffer.byteLength(implementationOutput, "utf8")}.`,
        "Raw implementation output is intentionally not persisted because it may contain source code or patches.",
      ].join("\n"),
    );

    const commands = validationCommandsFromTask(task.validation);
    const maxFixAttempts = options.fixAttempts ?? 2;
    let validationResults: ValidationResult[] = [];
    let qualityResult: QualityGateResult = {
      canProceed: false,
      hardBlocks: [],
      warnings: [],
    };
    let reviewSummary = "";

    for (let attempt = 0; attempt <= maxFixAttempts; attempt += 1) {
      const reviewPrompt = await renderPrompt("review-task.md", {
        promptContext,
        taskId: task.id,
        taskTitle: task.title,
        plan,
        bookkeepingReviewInstructions: bookkeepingReviewInstructions(deferBookkeeping),
      });
      phase = "review";
      const review = await runCodexPhase({
        phase,
        logger,
        maxAttempts: maxCodexAttempts,
        operation: () =>
          adapters.codexReview(reviewPrompt, {
            repoRoot: worktreeRoot,
            task,
            runId: logger.runId,
          }),
      });
      reviewSummary = review.summary;
      phase = "validate";
      validationResults = await adapters.validate(worktreeRoot, commands);
      const changedFiles = await adapters.getChangedFiles(worktreeRoot);
      qualityResult = adapters.qualityGate({
        changedFiles,
        artifactText: safeArtifactText(review.summary, validationResults),
        validationResults,
        protectedPaths: ["SECURITY_MODEL.md", "RUNNER_PROTOCOL.md", "DATA_MODEL.md"],
        requiresTests: requiresTests(changedFiles),
        maxChangedFiles: 40,
      });

      await logger.writeArtifact(
        `review-attempt-${attempt + 1}.txt`,
        sanitizeArtifactText(review.summary),
      );
      await logger.writeArtifact(
        `validation-attempt-${attempt + 1}.json`,
        sanitizeArtifactText(safeJson(validationResults)),
      );
      await logger.writeArtifact(`quality-attempt-${attempt + 1}.json`, safeJson(qualityResult));

      if (review.passed && qualityResult.canProceed) {
        break;
      }

      if (attempt === maxFixAttempts) {
        await markTaskBlocked(worktreeRoot, task, qualityResult, validationResults);
        return {
          taskId: task.id,
          title: task.title,
          status: "blocked",
          branchName,
          runId: logger.runId,
          runDirectory: logger.directory,
          warnings: qualityResult.warnings,
          hardBlocks: qualityResult.hardBlocks,
        };
      }

      const fixPrompt = await renderPrompt("fix-task.md", {
        promptContext,
        taskId: task.id,
        taskTitle: task.title,
        plan,
        review: reviewSummary,
        validation: summarizeValidation(validationResults),
        fixAttempt: String(attempt + 1),
      });
      phase = "fix";
      await runCodexPhase({
        phase,
        logger,
        maxAttempts: maxCodexAttempts,
        operation: () =>
          adapters.codexFix(fixPrompt, {
            repoRoot: worktreeRoot,
            task,
            runId: logger.runId,
          }),
      });
      if (deferBookkeeping) {
        await adapters.resetBookkeepingFiles(worktreeRoot);
      }
    }

    phase = "commit";
    const changedFiles = await adapters.getChangedFiles(worktreeRoot);
    const prBody = buildPrBody({
      task,
      runId: logger.runId,
      changedFiles,
      validationResults,
      qualityResult,
    });
    if (deferBookkeeping && changedFiles.length === 0) {
      const summary: TaskExecutionResult = {
        taskId: task.id,
        title: task.title,
        status: "pr_opened",
        branchName,
        runId: logger.runId,
        runDirectory: logger.directory,
        warnings: qualityResult.warnings,
        hardBlocks: qualityResult.hardBlocks,
        task,
        validationResults,
        deferredBookkeeping: true,
        worktreeRoot,
      };
      await logger.writeArtifact(
        "deferred-bookkeeping-only.json",
        safeJson({ status: "queued", reason: "no_source_changes" }),
      );
      await logger.writeArtifact("summary.json", safeJson(publicTaskSummary(summary)));
      return summary;
    }
    if (!deferBookkeeping) {
      await markTaskCompleted(worktreeRoot, task, validationResults);
    }
    await adapters.commitChanges(worktreeRoot, `${task.id}: ${task.title}`, prBody);
    phase = "push";
    await adapters.pushBranch(worktreeRoot, branchName);
    phase = "pr";
    const pr =
      (await adapters.findExistingPr(worktreeRoot, branchName)) ??
      (await adapters.createPr(worktreeRoot, {
        branchName,
        title: `${task.id}: ${task.title}`,
        body: prBody,
      }));

    let taskStatus: "pr_opened" | "merge_blocked" | "merged" = "pr_opened";
    let hardBlocks = qualityResult.hardBlocks;
    let warnings = qualityResult.warnings;

    if (options.autoMerge) {
      phase = "merge-validation";
      const mergeValidationResults = await adapters.mergeValidate(
        worktreeRoot,
        mergeValidationCommands(),
      );
      await logger.writeArtifact(
        "merge-validation.json",
        sanitizeArtifactText(safeJson(mergeValidationResults)),
      );

      const failedMergeValidation = mergeValidationResults.filter(
        (result) => result.required && result.status !== "passed",
      );

      if (failedMergeValidation.length > 0) {
        taskStatus = "merge_blocked";
        hardBlocks = [
          ...hardBlocks,
          {
            code: "AUTO_MERGE_VALIDATION_FAILED",
            severity: "blocked",
            message: "Auto-merge stopped because full repository validation failed before merge.",
            paths: [],
          },
        ];
      } else {
        phase = "merge";
        await adapters.mergeBranchToMain(repoRoot, branchName);
        taskStatus = "merged";
        try {
          phase = "cleanup";
          await adapters.cleanupTaskResources(repoRoot, worktreeRoot, branchName);
          await logger.writeArtifact(
            "cleanup.json",
            safeJson({ status: "passed", worktreeRoot, branchName }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings = [
            ...warnings,
            {
              code: "AUTO_MERGE_CLEANUP_FAILED",
              severity: "warning",
              message: "Auto-merge succeeded, but local/remote cleanup failed.",
              paths: [worktreeRoot, branchName],
            },
          ];
          await logger.writeArtifact(
            "cleanup.json",
            safeJson({
              status: "failed",
              worktreeRoot,
              branchName,
              message: sanitizeArtifactText(message),
            }),
          );
        }
      }
    }

    const summary: TaskExecutionResult = {
      taskId: task.id,
      title: task.title,
      status: taskStatus,
      branchName,
      runId: logger.runId,
      runDirectory: logger.directory,
      prUrl: pr.url,
      warnings,
      hardBlocks,
      task,
      validationResults,
      deferredBookkeeping: deferBookkeeping,
      worktreeRoot,
    };
    await logger.writeArtifact("summary.json", safeJson(publicTaskSummary(summary)));
    return summary;
  } catch (error) {
    const failure = classifyFailure(error, phase);
    const summary: ExecutedTaskSummary = {
      taskId: task.id,
      title: task.title,
      status: "failed",
      branchName,
      runId: logger.runId,
      runDirectory: logger.directory,
      warnings: [],
      hardBlocks: [
        {
          code: failure.code,
          severity: "blocked",
          message: failure.message,
          paths: worktreeRoot === repoRoot ? [] : [worktreeRoot],
        },
      ],
    };
    await logger.writeArtifact("failure.json", safeJson(failure));
    await logger.writeArtifact("summary.json", safeJson(summary));
    return summary;
  }
}

async function mergeQueuedTask(
  repoRoot: string,
  result: TaskExecutionResult,
  adapters: RunnerAdapters,
): Promise<TaskExecutionResult> {
  const worktreeRoot = result.worktreeRoot ?? repoRoot;
  let warnings = result.warnings;
  let hardBlocks = result.hardBlocks;
  let status: TaskExecutionResult["status"] = "merge_blocked";
  let prUrl = result.prUrl;

  try {
    await adapters.refreshBranchFromMain(repoRoot, worktreeRoot, result.branchName);
    await adapters.prepareWorktree(worktreeRoot);
    await applyMergeQueueBookkeeping(worktreeRoot, result, adapters);
    if (!prUrl && result.task) {
      const changedFiles = await adapters.getChangedFiles(worktreeRoot);
      const prBody = buildPrBody({
        task: result.task,
        runId: result.runId,
        changedFiles,
        validationResults: result.validationResults ?? [],
        qualityResult: { canProceed: hardBlocks.length === 0, hardBlocks, warnings },
      });
      const pr =
        (await adapters.findExistingPr(worktreeRoot, result.branchName)) ??
        (await adapters.createPr(worktreeRoot, {
          branchName: result.branchName,
          title: `${result.task.id}: ${result.task.title}`,
          body: prBody,
        }));
      prUrl = pr.url;
    }
    const mergeValidationResults = await adapters.mergeValidate(
      worktreeRoot,
      mergeValidationCommands(),
    );
    await writeRunArtifact(
      result.runDirectory,
      "merge-validation.json",
      sanitizeArtifactText(safeJson(mergeValidationResults)),
    );

    const failedMergeValidation = mergeValidationResults.filter(
      (validationResult) => validationResult.required && validationResult.status !== "passed",
    );

    if (failedMergeValidation.length > 0) {
      hardBlocks = [
        ...hardBlocks,
        {
          code: "AUTO_MERGE_VALIDATION_FAILED",
          severity: "blocked",
          message: "Auto-merge stopped because full repository validation failed before merge.",
          paths: [],
        },
      ];
    } else {
      await adapters.mergeBranchToMain(repoRoot, result.branchName);
      status = "merged";
      try {
        await adapters.cleanupTaskResources(repoRoot, worktreeRoot, result.branchName);
        await writeRunArtifact(
          result.runDirectory,
          "cleanup.json",
          safeJson({ status: "passed", worktreeRoot, branchName: result.branchName }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings = [
          ...warnings,
          {
            code: "AUTO_MERGE_CLEANUP_FAILED",
            severity: "warning",
            message: "Auto-merge succeeded, but local/remote cleanup failed.",
            paths: [worktreeRoot, result.branchName],
          },
        ];
        await writeRunArtifact(
          result.runDirectory,
          "cleanup.json",
          safeJson({
            status: "failed",
            worktreeRoot,
            branchName: result.branchName,
            message: sanitizeArtifactText(message),
          }),
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeRunArtifact(
      result.runDirectory,
      "merge-failure.json",
      safeJson({ message: sanitizeArtifactText(message) }),
    );
    hardBlocks = [
      ...hardBlocks,
      {
        code: "AUTO_MERGE_QUEUE_FAILED",
        severity: "blocked",
        message: "Auto-merge stopped because the queued branch could not be refreshed or merged.",
        paths: [],
      },
    ];
  }

  const summary: TaskExecutionResult = {
    ...result,
    status,
    ...(prUrl ? { prUrl } : {}),
    warnings,
    hardBlocks,
    worktreeRoot,
  };
  await writeRunArtifact(result.runDirectory, "summary.json", safeJson(publicTaskSummary(summary)));
  return summary;
}

async function applyMergeQueueBookkeeping(
  worktreeRoot: string,
  result: TaskExecutionResult,
  adapters: RunnerAdapters,
): Promise<void> {
  if (!result.task) {
    return;
  }

  await markTaskCompleted(worktreeRoot, result.task, result.validationResults ?? []);
  const backlog = await readFile(resolve(worktreeRoot, "BACKLOG.md"), "utf8");
  const nextTaskId = findNextReadyTaskId(backlog);
  await markReadmeTaskCompleted(worktreeRoot, result.task, nextTaskId);

  const changedFiles = await adapters.getChangedFiles(worktreeRoot);
  if (!changedFiles.some((file) => bookkeepingFiles.has(normalizeRepoPath(file)))) {
    return;
  }

  await adapters.commitChanges(
    worktreeRoot,
    `${result.task.id}: Record backlog completion`,
    buildBookkeepingCommitBody(
      result.task,
      result.runId,
      nextTaskId,
      result.validationResults ?? [],
    ),
  );
  await adapters.pushBranch(worktreeRoot, result.branchName);
}

async function markReadmeTaskCompleted(
  worktreeRoot: string,
  task: BacklogTask,
  nextTaskId: string,
): Promise<void> {
  const readmePath = resolve(worktreeRoot, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const updated = updateReadmeTaskStatus(readme, task, nextTaskId);
  if (updated !== readme) {
    await writeFile(readmePath, updated, "utf8");
  }
}

function updateReadmeTaskStatus(readme: string, task: BacklogTask, nextTaskId: string): string {
  const lastCompletedLine = `Last completed task: \`${task.id}\` — ${task.title}.`;
  const nextLine =
    nextTaskId === "None"
      ? "- None: no Ready backlog task remains."
      : `- \`${nextTaskId}\`: Ready for runner selection.`;

  let updated = readme;
  if (/Last completed task: `(?:TASK|RFB)-\d+` .*/.test(updated)) {
    updated = updated.replace(/Last completed task: `(?:TASK|RFB)-\d+` .*/, lastCompletedLine);
  } else {
    updated = `${updated.trimEnd()}\n\n${lastCompletedLine}\n`;
  }

  if (/Current next implementation task:\n\n- .*/m.test(updated)) {
    updated = updated.replace(
      /Current next implementation task:\n\n- .*/m,
      `Current next implementation task:\n\n${nextLine}`,
    );
  } else {
    updated = `${updated.trimEnd()}\n\nCurrent next implementation task:\n\n${nextLine}\n`;
  }

  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

function buildBookkeepingCommitBody(
  task: BacklogTask,
  runId: string,
  nextTaskId: string,
  validationResults: ValidationResult[],
): string {
  return `## Task
${task.id}: ${task.title}

## Bookkeeping
- BACKLOG.md completion status recorded
- README.md current status refreshed
- Next task: ${nextTaskId}

## Validation
${summarizeValidation(validationResults)}

## Run
${runId}
`;
}

async function writeRunArtifact(
  runDirectory: string,
  artifactName: string,
  content: string,
): Promise<void> {
  await writeFile(resolve(runDirectory, artifactName), content, "utf8");
}

function createProductionAdapters(codexTimeoutMs?: number): RunnerAdapters {
  return {
    ensureClean: isGitClean,
    createWorktree,
    prepareWorktree: preparePnpmWorktree,
    getChangedFiles,
    commitChanges: commitAll,
    pushBranch,
    resetBookkeepingFiles: restoreBookkeepingFiles,
    findExistingPr: findExistingDraftPr,
    createPr: (repoRoot, input) => createDraftPr(repoRoot, input),
    mergeValidate: runValidationCommands,
    refreshBranchFromMain,
    mergeBranchToMain,
    cleanupTaskResources: cleanupMergedTaskResources,
    codexPlan: async (prompt, input) =>
      runCodexExec(input.repoRoot, prompt, codexExecOptions("read-only", codexTimeoutMs)),
    codexImplement: async (prompt, input) =>
      runCodexExec(input.repoRoot, prompt, codexExecOptions("workspace-write", codexTimeoutMs)),
    codexReview: async (prompt, input) =>
      parseReviewFromCodexOutput(
        await runCodexExec(input.repoRoot, prompt, codexExecOptions("read-only", codexTimeoutMs)),
      ),
    codexFix: async (prompt, input) =>
      runCodexExec(input.repoRoot, prompt, codexExecOptions("workspace-write", codexTimeoutMs)),
    validate: runValidationCommands,
    qualityGate: scanQualityGates,
  };
}

function codexExecOptions(
  sandbox: "read-only" | "workspace-write",
  timeoutMs: number | undefined,
): { sandbox: "read-only" | "workspace-write"; timeoutMs?: number } {
  return timeoutMs === undefined ? { sandbox } : { sandbox, timeoutMs };
}

function createInjectedAdapters(
  adapters: Partial<RunnerAdapters>,
  codexTimeoutMs?: number,
): RunnerAdapters {
  const production = createProductionAdapters(codexTimeoutMs);
  return {
    ...production,
    prepareWorktree: async () => undefined,
    commitChanges: async () => undefined,
    pushBranch: async () => undefined,
    resetBookkeepingFiles: async () => undefined,
    createPr: async (_repoRoot, input) => ({
      branchName: input.branchName,
      number: 0,
      url: "https://github.com/example/repo/pull/0",
      draft: true,
    }),
    findExistingPr: async () => null,
    mergeValidate: async (_repoRoot, commands) =>
      commands.map((command) => ({
        ...command,
        status: "passed" as const,
        exitCode: 0,
        durationMs: 0,
        stdoutSummary: "",
        stderrSummary: "",
        timedOut: false,
      })),
    refreshBranchFromMain: async () => undefined,
    mergeBranchToMain: async () => undefined,
    cleanupTaskResources: async () => undefined,
    ...adapters,
  };
}

type RunnerLock =
  | { acquired: true; release: () => Promise<void> }
  | { acquired: false; release: () => Promise<void> };

async function acquireRunnerLock(repoRoot: string): Promise<RunnerLock> {
  const lockPath = resolve(repoRoot, ".codex-runner.lock");
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      safeJson({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    await handle.close();
    return {
      acquired: true,
      release: async () => {
        await rm(lockPath, { force: true });
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (await isStaleRunnerLock(lockPath)) {
        await rm(lockPath, { force: true });
        return await acquireRunnerLock(repoRoot);
      }
      return {
        acquired: false,
        release: async () => undefined,
      };
    }
    throw error;
  }
}

async function isStaleRunnerLock(lockPath: string): Promise<boolean> {
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number };
    if (!lock.pid || lock.pid === process.pid) {
      return true;
    }
    process.kill(lock.pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return true;
    }
    return false;
  }
}

type CodexPhaseInput<T> = {
  phase: string;
  logger: Awaited<ReturnType<typeof createRunLogger>>;
  maxAttempts: number;
  operation: () => Promise<T>;
};

async function runCodexPhase<T>(input: CodexPhaseInput<T>): Promise<T> {
  const maxAttempts = Math.max(1, input.maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.operation();
    } catch (error) {
      const failure = classifyFailure(error, input.phase);
      const retrying = failure.retryable && attempt < maxAttempts;
      await input.logger.writeArtifact(
        `codex-${input.phase}-attempt-${attempt}.json`,
        safeJson({
          ...failure,
          attempt,
          maxAttempts,
          retrying,
        }),
      );

      if (!retrying) {
        throw new RunnerPhaseError(failure);
      }
    }
  }

  throw new Error(`Codex ${input.phase} failed without a captured error.`);
}

type ClassifiedFailure = {
  phase: string;
  classification: "timed_out" | "failed";
  code: "CODEX_PHASE_TIMEOUT" | "RUNNER_PHASE_FAILED";
  message: string;
  retryable: boolean;
};

class RunnerPhaseError extends Error {
  readonly failure: ClassifiedFailure;

  constructor(failure: ClassifiedFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

function classifyFailure(error: unknown, phase: string): ClassifiedFailure {
  if (error instanceof RunnerPhaseError) {
    return error.failure;
  }

  const fullMessage = sanitizeArtifactText(error instanceof Error ? error.message : String(error));
  const timedOut = /\b(timed out|timeout|exit code 124)\b/i.test(fullMessage);
  return {
    phase,
    classification: timedOut ? "timed_out" : "failed",
    code: timedOut ? "CODEX_PHASE_TIMEOUT" : "RUNNER_PHASE_FAILED",
    message: summarizeFailureMessage(fullMessage),
    retryable:
      timedOut ||
      /\b(temporar(?:y|ily)|network|ECONNRESET|ETIMEDOUT|rate limit)\b/i.test(fullMessage),
  };
}

function summarizeFailureMessage(message: string): string {
  const maxFailureMessageLength = 1_600;
  if (message.length <= maxFailureMessageLength) {
    return message;
  }

  const lines = message.split("\n");
  const first = lines.find((line) => line.trim()) ?? message.slice(0, 300);
  const timeout = [...lines]
    .reverse()
    .find((line) => /\b(timed out|timeout|exit code 124)\b/i.test(line));
  const suffix = timeout && timeout !== first ? `\n${timeout}` : "";

  return [
    first.slice(0, 400),
    `[omitted ${message.length - first.length - suffix.length} characters of runner command output]`,
    suffix.trimEnd(),
  ]
    .filter(Boolean)
    .join("\n");
}

async function markTaskStarted(
  worktreeRoot: string,
  task: BacklogTask,
  runId: string,
  branchName: string,
): Promise<void> {
  const backlogPath = resolve(worktreeRoot, "BACKLOG.md");
  const backlog = await readFile(backlogPath, "utf8");
  await writeFile(
    backlogPath,
    updateTaskStatus(backlog, task.id, {
      status: "[~]",
      completionNotes: `Run ${runId} started on branch ${branchName}.`,
      validationResult: "Pending implementation and validation.",
      nextRecommendedTask: "Pending current task completion.",
    }),
    "utf8",
  );
}

async function markTaskCompleted(
  worktreeRoot: string,
  task: BacklogTask,
  validationResults: ValidationResult[],
): Promise<void> {
  const backlogPath = resolve(worktreeRoot, "BACKLOG.md");
  const backlog = await readFile(backlogPath, "utf8");
  const withCompletion = updateTaskStatus(backlog, task.id, {
    status: "[x]",
    completionNotes: `Completed by local Codex backlog runner.`,
    validationResult: validationResults.every((result) => result.status === "passed")
      ? "Passed"
      : "Completed with warnings",
    nextRecommendedTask: "Pending recalculation.",
  });
  const next = findNextReadyTaskId(withCompletion);
  await writeFile(
    backlogPath,
    updateTaskStatus(withCompletion, task.id, {
      status: "[x]",
      completionNotes: `Completed by local Codex backlog runner.`,
      validationResult: validationResults.every((result) => result.status === "passed")
        ? "Passed"
        : "Completed with warnings",
      nextRecommendedTask: next,
    }),
    "utf8",
  );
}

async function markTaskBlocked(
  worktreeRoot: string,
  task: BacklogTask,
  qualityResult: QualityGateResult,
  validationResults: ValidationResult[],
): Promise<void> {
  const backlogPath = resolve(worktreeRoot, "BACKLOG.md");
  const backlog = await readFile(backlogPath, "utf8");
  const blockers =
    qualityResult.hardBlocks.map((finding) => finding.code).join(", ") ||
    validationResults
      .filter((result) => result.required && result.status !== "passed")
      .map((result) => result.id)
      .join(", ") ||
    "Unknown blocker";

  await writeFile(
    backlogPath,
    updateTaskStatus(backlog, task.id, {
      status: "[!]",
      completionNotes: `Blocked by local Codex backlog runner: ${blockers}.`,
      validationResult: summarizeValidation(validationResults),
      nextRecommendedTask: "Resolve blocker before continuing.",
    }),
    "utf8",
  );
}

function emptyTaskSummary(
  task: BacklogTask,
  branchName: string,
  runId: string,
  runDirectory: string,
  status: "planned" | "dry_run_passed",
): ExecutedTaskSummary {
  return {
    taskId: task.id,
    title: task.title,
    status,
    branchName,
    runId,
    runDirectory,
    warnings: [],
    hardBlocks: [],
  };
}

function publicTaskSummary(summary: TaskExecutionResult): ExecutedTaskSummary {
  return {
    taskId: summary.taskId,
    title: summary.title,
    status: summary.status,
    branchName: summary.branchName,
    runId: summary.runId,
    runDirectory: summary.runDirectory,
    ...(summary.prUrl ? { prUrl: summary.prUrl } : {}),
    warnings: summary.warnings,
    hardBlocks: summary.hardBlocks,
  };
}

function requiresTests(changedFiles: string[]): boolean {
  return changedFiles.some(
    (file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  );
}

function bookkeepingInstructions(deferBookkeeping: boolean): string {
  if (deferBookkeeping) {
    return [
      "- Do not edit BACKLOG.md or README.md in this concurrent run.",
      "- The merge queue records final BACKLOG.md and README.md status after the branch refreshes from latest main.",
    ].join("\n");
  }

  return [
    "- Update BACKLOG.md only for this task.",
    "- Update README.md current state/status whenever this task changes BACKLOG.md or will be pushed to main.",
  ].join("\n");
}

function bookkeepingReviewInstructions(deferBookkeeping: boolean): string {
  return deferBookkeeping
    ? "- Do not require BACKLOG.md or README.md edits; the merge queue owns concurrent bookkeeping."
    : "- README.md current-state/status update whenever BACKLOG.md changed.";
}

function safeArtifactText(reviewSummary: string, validationResults: ValidationResult[]): string {
  return [
    reviewSummary,
    ...validationResults.map(
      (result) =>
        `${result.id}: ${result.status}\n${result.stdoutSummary}\n${result.stderrSummary}`,
    ),
  ].join("\n");
}

function summarizeValidation(results: ValidationResult[]): string {
  if (results.length === 0) {
    return "No validation commands were discovered for this task.";
  }

  return results.map((result) => `${result.id}:${result.status}`).join(", ");
}

function normalizeRepoPath(file: string): string {
  const unwrapped = file.trim().replace(/^[`'"]+|[`'"]+$/g, "");
  return unwrapped.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function buildPrBody(input: {
  task: BacklogTask;
  runId: string;
  changedFiles: string[];
  validationResults: ValidationResult[];
  qualityResult: QualityGateResult;
}): string {
  const validation = input.validationResults.length
    ? input.validationResults.map((result) => `- ${result.label}: ${result.status}`).join("\n")
    : "- No validation commands discovered";
  const warnings = input.qualityResult.warnings.length
    ? input.qualityResult.warnings
        .map((finding) => `- ${finding.code}: ${finding.message}`)
        .join("\n")
    : "- None";

  return `## Task
${input.task.id}: ${input.task.title}

## Acceptance Criteria
${input.task.acceptanceCriteria ?? "See BACKLOG.md task section."}

## Changed Files
${input.changedFiles.map((file) => `- ${file}`).join("\n") || "- None reported"}

## Validation
${validation}

## Warnings
${warnings}

## Run
${input.runId}
`;
}

function stopReasonFor(status: string): string {
  if (status === "planned") {
    return "plan_approval_required";
  }
  if (status === "dry_run_passed") {
    return "dry_run_complete";
  }
  return status;
}

function mergeValidationCommands(): ValidationCommand[] {
  return [
    {
      id: "typecheck",
      label: "Full TypeScript typecheck",
      command: "pnpm",
      args: ["run", "typecheck"],
      required: true,
      timeoutMs: 120_000,
    },
    {
      id: "lint",
      label: "Full lint suite",
      command: "pnpm",
      args: ["run", "lint"],
      required: true,
      timeoutMs: 120_000,
    },
    {
      id: "format:check",
      label: "Full format check",
      command: "pnpm",
      args: ["run", "format:check"],
      required: true,
      timeoutMs: 120_000,
    },
    {
      id: "test",
      label: "Full test suite",
      command: "pnpm",
      args: ["test"],
      required: true,
      timeoutMs: 120_000,
    },
  ];
}

export function parseArgs(args: string[]): RunnerOptions {
  let mode: RunnerMode | undefined;
  let approvePlan = false;
  let autoMerge = false;
  let dryRun = false;
  let fixAttempts = 2;
  let codexAttempts = 2;
  let codexTimeoutMs: number | undefined;
  let concurrency = 1;

  for (const arg of args) {
    if (arg === "--") {
      continue;
    } else if (arg === "--all") {
      mode = { kind: "all" };
    } else if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.replace("--limit=", ""), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      mode = { kind: "limit", value };
    } else if (arg === "--approve-plan") {
      approvePlan = true;
    } else if (arg === "--auto-merge") {
      autoMerge = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--fix-attempts=")) {
      fixAttempts = Number.parseInt(arg.replace("--fix-attempts=", ""), 10);
      if (!Number.isFinite(fixAttempts) || fixAttempts < 0) {
        throw new Error("--fix-attempts must be zero or a positive integer.");
      }
    } else if (arg.startsWith("--codex-attempts=")) {
      codexAttempts = Number.parseInt(arg.replace("--codex-attempts=", ""), 10);
      if (!Number.isFinite(codexAttempts) || codexAttempts <= 0) {
        throw new Error("--codex-attempts must be a positive integer.");
      }
    } else if (arg.startsWith("--codex-timeout-ms=")) {
      codexTimeoutMs = Number.parseInt(arg.replace("--codex-timeout-ms=", ""), 10);
      if (!Number.isFinite(codexTimeoutMs) || codexTimeoutMs < minimumCodexTimeoutMs) {
        throw new Error("--codex-timeout-ms must be at least 60000 milliseconds.");
      }
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = Number.parseInt(arg.replace("--concurrency=", ""), 10);
      if (!Number.isFinite(concurrency) || concurrency <= 0) {
        throw new Error("--concurrency must be a positive integer.");
      }
    } else if (arg === "--help" || arg === "-h") {
      throw new HelpRequested();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!mode) {
    mode = { kind: "limit", value: 1 };
  }

  if (concurrency > 1 && !autoMerge) {
    throw new Error("--concurrency greater than 1 requires --auto-merge.");
  }

  if (concurrency > 1 && !approvePlan) {
    throw new Error("--concurrency greater than 1 requires --approve-plan.");
  }

  const parsed: RunnerOptions = {
    mode,
    approvePlan,
    autoMerge,
    dryRun,
    fixAttempts,
    codexAttempts,
    concurrency,
  };
  if (codexTimeoutMs !== undefined) {
    parsed.codexTimeoutMs = codexTimeoutMs;
  }
  return parsed;
}

function usage(): string {
  return `Usage:
  pnpm codex-runner -- --limit=1 [--approve-plan] [--auto-merge] [--dry-run] [--codex-attempts=2] [--codex-timeout-ms=600000]
  pnpm codex-runner -- --limit=5 [--approve-plan] [--auto-merge] [--dry-run] [--codex-attempts=2] [--codex-timeout-ms=600000]
  pnpm codex-runner -- --all [--approve-plan] [--auto-merge] [--dry-run] [--codex-attempts=2] [--codex-timeout-ms=600000]
  pnpm codex-runner -- --all --approve-plan --auto-merge --concurrency=2

This runner is repository-specific. It always reads BACKLOG.md and AGENTS.md/agents.md from this repository.`;
}

class HelpRequested extends Error {}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = await runBacklogRunner(options);
    process.stdout.write(`${safeJson(summary)}`);
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
