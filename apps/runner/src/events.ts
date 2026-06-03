import {
  type DryRunCheckResult,
  type DryRunResult,
  type PrArtifact,
  type RunEvent,
  type RunState,
  type RiskFinding,
  type TaskPacket,
  type ValidationCommand,
  type ValidationResult,
} from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";
import type { PushedBranchArtifact } from "@control-plane/github";

import type { ChangeScanResult } from "./changes/scan-changes.js";
import type { RunCodexForTaskResult, RunnerCodexAdapterMode } from "./codex.js";
import type { RunnerCancellationBoundary } from "./cancellation.js";
import { buildRunEvent } from "./events/build-event.js";
import type { CreateWorktreeResult } from "./git/create-worktree.js";
import type { PrepareRepairWorktreeError } from "./repair.js";

type EventTaskPacket = Pick<TaskPacket, "id" | "repositoryId" | "mode" | "runId">;
type EventAttemptTaskPacket = Pick<TaskPacket, "runId"> &
  Partial<Pick<TaskPacket, "mode" | "repair">>;
type RepairEventTaskPacket = Pick<TaskPacket, "id" | "repositoryId" | "mode" | "repair" | "runId">;
type ValidationTaskPacket = Pick<TaskPacket, "runId" | "validation"> &
  Partial<Pick<TaskPacket, "mode" | "repair">>;
type WorktreeEventMetadata = Pick<CreateWorktreeResult, "branchName" | "worktreePath">;
export type WorktreeCleanupEventState = Extract<RunState, "cancelled" | "completed" | "failed">;
type CancellationEventTaskPacket = Pick<TaskPacket, "runId"> & { attempt?: number };
type CancellationEventOptions = {
  taskPacket: CancellationEventTaskPacket;
  boundary: RunnerCancellationBoundary;
  cleanupAttempted?: boolean;
  cleanupSucceeded?: boolean;
  now: () => string;
};

type RunEventInput = {
  taskPacket: Pick<TaskPacket, "runId">;
  state: RunState;
  stableStepName: string;
  severity: RunEvent["severity"];
  message: string;
  metadata?: Record<string, unknown>;
  now: () => string;
  attempt?: number;
};

export const createRunEvent = ({
  taskPacket,
  state,
  stableStepName,
  severity,
  message,
  metadata = {},
  now,
  attempt = 1,
}: RunEventInput): RunEvent =>
  buildRunEvent({
    runId: taskPacket.runId,
    state,
    stableStepName,
    severity,
    message,
    metadata,
    now,
    attempt,
  });

export const dryRunRunningEvent = ({
  taskPacket,
  now,
}: {
  taskPacket: EventTaskPacket;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "dry_run_running",
    stableStepName: "dry_run_running",
    severity: "info",
    message: "Runner dry run started.",
    metadata: dryRunBaseMetadata(taskPacket),
    now,
  });

export const repairStartedEvent = ({
  taskPacket,
  now,
}: {
  taskPacket: RepairEventTaskPacket;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "repair_requested",
    stableStepName: "repair_started",
    severity: "info",
    message: "Runner repair execution started.",
    metadata: repairMetadata(taskPacket),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const repairBlockedEvent = ({
  taskPacket,
  error,
  now,
}: {
  taskPacket: RepairEventTaskPacket;
  error: PrepareRepairWorktreeError;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "blocked",
    stableStepName: "repair_blocked",
    severity: "blocked",
    message: "Runner repair preparation blocked execution.",
    metadata: repairBlockedMetadata(taskPacket, error),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const claimedEvent = ({
  taskPacket,
  jobId,
  now,
}: {
  taskPacket: EventTaskPacket;
  jobId: string;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "claimed",
    stableStepName: "claimed",
    severity: "info",
    message: "Runner claimed the job.",
    metadata: {
      jobId,
      taskPacketId: taskPacket.id,
      repositoryId: taskPacket.repositoryId,
      packetMode: taskPacket.mode,
    },
    now,
  });

export const terminalDryRunEvent = ({
  taskPacket,
  dryRunResult,
  now,
}: {
  taskPacket: EventTaskPacket;
  dryRunResult: DryRunResult;
  now: () => string;
}): RunEvent => {
  if (dryRunResult.status === "failed") {
    return createRunEvent({
      taskPacket,
      state: "blocked",
      stableStepName: "dry_run_blocked",
      severity: "blocked",
      message: "Runner dry run blocked by readiness checks.",
      metadata: dryRunEventMetadata(taskPacket, dryRunResult),
      now,
    });
  }

  return createRunEvent({
    taskPacket,
    state: "dry_run_passed",
    stableStepName: "dry_run_passed",
    severity: dryRunResult.status === "warning" ? "warning" : "info",
    message:
      dryRunResult.status === "warning"
        ? "Runner dry run completed with warnings."
        : "Runner dry run passed readiness checks.",
    metadata: dryRunEventMetadata(taskPacket, dryRunResult),
    now,
  });
};

export const worktreeCreatedEvent = ({
  taskPacket,
  worktree,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  worktree: WorktreeEventMetadata;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "worktree_created",
    stableStepName: "worktree_created",
    severity: "info",
    message: "Runner worktree created.",
    metadata: safeWorktreeMetadata(worktree),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const cancelRequestedEvent = ({
  taskPacket,
  boundary,
  now,
}: CancellationEventOptions): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "cancel_requested",
    stableStepName: `cancel_requested_${boundary}`,
    severity: "warning",
    message: "Run cancellation was requested.",
    metadata: safeCancellationMetadata({ boundary }),
    now,
    attempt: taskPacket.attempt ?? 1,
  });

export const cancellingEvent = ({
  taskPacket,
  boundary,
  now,
}: CancellationEventOptions): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "cancelling",
    stableStepName: `cancelling_${boundary}`,
    severity: "warning",
    message: "Runner is stopping at a safe cancellation boundary.",
    metadata: safeCancellationMetadata({ boundary }),
    now,
    attempt: taskPacket.attempt ?? 1,
  });

export const cancelledEvent = ({
  taskPacket,
  boundary,
  cleanupAttempted,
  cleanupSucceeded,
  now,
}: CancellationEventOptions): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "cancelled",
    stableStepName: `cancelled_${boundary}`,
    severity: "info",
    message: "Runner execution cancelled.",
    metadata: safeCancellationMetadata({
      boundary,
      ...(cleanupAttempted === undefined ? {} : { cleanupAttempted }),
      ...(cleanupSucceeded === undefined ? {} : { cleanupSucceeded }),
    }),
    now,
    attempt: taskPacket.attempt ?? 1,
  });

export const codexRunningEvent = ({
  taskPacket,
  adapterMode,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  adapterMode: RunnerCodexAdapterMode;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "codex_running",
    stableStepName: "codex_running",
    severity: "info",
    message: "Codex execution started.",
    metadata: {
      adapterMode,
    },
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const codexFinishedEvent = ({
  taskPacket,
  codexResult,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  codexResult: RunCodexForTaskResult;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: codexResult.status === "succeeded" ? "codex_running" : "failed",
    stableStepName: "codex_finished",
    severity: codexResult.status === "succeeded" ? "info" : "error",
    message:
      codexResult.status === "succeeded" ? "Codex execution completed." : "Codex execution failed.",
    metadata: safeCodexMetadata(codexResult),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const changesScannedEvent = ({
  taskPacket,
  changeScanResult,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  changeScanResult: ChangeScanResult;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "changes_scanned",
    stableStepName: "changes_scanned",
    severity: changeScanSeverity(changeScanResult),
    message: changeScanMessage(changeScanResult),
    metadata: safeChangeScanMetadata(changeScanResult),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const changeScanBlockedEvent = ({
  taskPacket,
  changeScanResult,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  changeScanResult: ChangeScanResult;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "blocked",
    stableStepName: "change_scan_blocked",
    severity: "blocked",
    message: "Change scan blocked unsafe changes.",
    metadata: safeChangeScanMetadata(changeScanResult),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const validationRunningEvent = ({
  taskPacket,
  now,
}: {
  taskPacket: ValidationTaskPacket;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "validation_running",
    stableStepName: "validation_running",
    severity: "info",
    message: "Validation started.",
    metadata: validationStartMetadata(taskPacket.validation.commands),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const validationCompletedEvent = ({
  taskPacket,
  validationResult,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  validationResult: ValidationSuiteResult;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "validation_running",
    stableStepName: "validation_completed",
    severity: validationCompletionSeverity(validationResult),
    message:
      validationResult.status === "warning"
        ? "Validation completed with warnings."
        : "Validation completed.",
    metadata: safeValidationMetadata(validationResult),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const validationBlockedEvent = ({
  taskPacket,
  validationResult,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  validationResult: ValidationSuiteResult;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "blocked",
    stableStepName: "validation_blocked",
    severity: "blocked",
    message: "Validation blocked commit.",
    metadata: safeValidationMetadata(validationResult),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const pushedEvent = ({
  taskPacket,
  pushArtifact,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  pushArtifact: PushedBranchArtifact;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "pushed",
    stableStepName: "pushed",
    severity: "info",
    message: "Runner pushed the task branch.",
    metadata: safePushMetadata(pushArtifact),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const prOpenedEvent = ({
  taskPacket,
  prArtifact,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  prArtifact: PrArtifact;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "pr_opened",
    stableStepName: "pr_opened",
    severity: "info",
    message:
      taskPacket.mode === "repair"
        ? "Runner refreshed pull request metadata."
        : "Runner opened a draft pull request.",
    metadata: safePrArtifactMetadata(prArtifact),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const awaitingApprovalEvent = ({
  taskPacket,
  prArtifact,
  now,
}: {
  taskPacket: EventAttemptTaskPacket;
  prArtifact: PrArtifact;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state: "awaiting_approval",
    stableStepName: "awaiting_approval",
    severity: "info",
    message: "Runner is awaiting human approval.",
    metadata: safePrArtifactMetadata(prArtifact),
    now,
    attempt: attemptForTaskPacket(taskPacket),
  });

export const worktreeCleanupEvent = ({
  taskPacket,
  state,
  branchName,
  worktreePath,
  now,
}: {
  taskPacket: Pick<TaskPacket, "runId">;
  state: WorktreeCleanupEventState;
  branchName: string;
  worktreePath: string;
  now: () => string;
}): RunEvent =>
  createRunEvent({
    taskPacket,
    state,
    stableStepName: `${state}_worktree_cleanup`,
    severity: state === "failed" ? "error" : "info",
    message: worktreeCleanupMessage(state),
    metadata: safeWorktreeMetadata({ branchName, worktreePath }),
    now,
  });

const dryRunBaseMetadata = (taskPacket: EventTaskPacket): Record<string, unknown> => ({
  taskPacketId: taskPacket.id,
  repositoryId: taskPacket.repositoryId,
  packetMode: taskPacket.mode,
  dryRun: true,
});

const repairMetadata = (taskPacket: RepairEventTaskPacket): Record<string, unknown> => ({
  taskPacketId: taskPacket.id,
  repositoryId: taskPacket.repositoryId,
  packetMode: taskPacket.mode,
  repairAttempt: taskPacket.repair?.attempt,
  maxRepairAttempts: taskPacket.repair?.maxAttempts,
  previousRunId: taskPacket.repair?.previousRunId,
});

const repairBlockedMetadata = (
  taskPacket: RepairEventTaskPacket,
  error: PrepareRepairWorktreeError,
): Record<string, unknown> => ({
  ...repairMetadata(taskPacket),
  repairBlockReason: error.code,
  ...(error.metadata.branchName === undefined ? {} : { branchName: error.metadata.branchName }),
  ...(error.metadata.gitExitCode === undefined ? {} : { gitExitCode: error.metadata.gitExitCode }),
  ...(error.metadata.repairAttempt === undefined
    ? {}
    : { blockedRepairAttempt: error.metadata.repairAttempt }),
});

const attemptForTaskPacket = (taskPacket: EventAttemptTaskPacket): number => {
  if (taskPacket.mode !== "repair" || taskPacket.repair === undefined) {
    return 1;
  }

  return taskPacket.repair.attempt;
};

const dryRunEventMetadata = (
  taskPacket: EventTaskPacket,
  dryRunResult: DryRunResult,
): Record<string, unknown> => ({
  ...dryRunBaseMetadata(taskPacket),
  resultId: dryRunResult.id,
  resultStatus: dryRunResult.status,
  checkCount: dryRunResult.checks.length,
  blockerCount: dryRunResult.blockers.length,
  warningCount: dryRunResult.warnings.length,
  checkStatuses: dryRunResult.checks.map(checkStatusSummary),
  blockers: dryRunResult.blockers.map(riskFindingSummary),
  warnings: dryRunResult.warnings.map(riskFindingSummary),
});

const checkStatusSummary = (
  check: DryRunCheckResult,
): Pick<DryRunCheckResult, "id" | "status"> => ({
  id: check.id,
  status: check.status,
});

const riskFindingSummary = (
  finding: RiskFinding,
): Pick<RiskFinding, "id" | "severity" | "category" | "paths"> => ({
  id: finding.id,
  severity: finding.severity,
  category: finding.category,
  paths: safePathList(finding.paths),
});

const safeWorktreeMetadata = (worktree: WorktreeEventMetadata): Record<string, unknown> => ({
  branchName: worktree.branchName,
  worktreePath: worktree.worktreePath,
});

const safeCancellationMetadata = ({
  boundary,
  cleanupAttempted,
  cleanupSucceeded,
}: {
  boundary: RunnerCancellationBoundary;
  cleanupAttempted?: boolean;
  cleanupSucceeded?: boolean;
}): Record<string, unknown> => ({
  boundary,
  ...(cleanupAttempted === undefined ? {} : { cleanupAttempted }),
  ...(cleanupSucceeded === undefined ? {} : { cleanupSucceeded }),
});

const safeCodexMetadata = (codexResult: RunCodexForTaskResult): Record<string, unknown> => ({
  adapterMode: codexResult.adapterMode,
  status: codexResult.status,
  exitCode: codexResult.exitCode,
  durationMs: codexResult.durationMs,
  redactionApplied: codexResult.redactionApplied,
});

const safeChangeScanMetadata = (changeScanResult: ChangeScanResult): Record<string, unknown> => ({
  changedFilePaths: safePathList(changeScanResult.changedFiles.paths),
  counts: {
    changedFileCount: changeScanResult.counts.changedFileCount,
    addedCount: changeScanResult.counts.addedCount,
    modifiedCount: changeScanResult.counts.modifiedCount,
    deletedCount: changeScanResult.counts.deletedCount,
    untrackedCount: changeScanResult.counts.untrackedCount,
    omittedPathCount: changeScanResult.counts.omittedPathCount,
    evaluatedFileCount: changeScanResult.counts.evaluatedFileCount,
    trackedDiffLineCount: changeScanResult.counts.trackedDiffLineCount,
    untrackedDiffLineCount: changeScanResult.counts.untrackedDiffLineCount,
    diffLineCount: changeScanResult.counts.diffLineCount,
  },
  blockerCount: changeScanResult.blockers.length,
  warningCount: changeScanResult.warnings.length,
  shouldBlock: shouldBlockChangeScan(changeScanResult),
  blockers: changeScanResult.blockers.map(riskFindingSummary),
  warnings: changeScanResult.warnings.map(riskFindingSummary),
});

const validationStartMetadata = (
  commands: readonly ValidationCommand[],
): Record<string, unknown> => ({
  commandCount: commands.length,
  requiredCommandCount: commands.filter((command) => command.required).length,
});

const safeValidationMetadata = (
  validationResult: ValidationSuiteResult,
): Record<string, unknown> => ({
  status: validationResult.status,
  shouldBlockCommit: validationResult.shouldBlockCommit,
  warningCount: validationResult.warnings.length,
  blockerCount: validationResult.blockers.length,
  results: validationResult.results.map(validationResultSummary),
});

const validationResultSummary = (
  result: ValidationResult,
): Pick<
  ValidationResult,
  | "commandId"
  | "commandLabel"
  | "status"
  | "exitCode"
  | "durationMs"
  | "stdoutSummary"
  | "stderrSummary"
  | "redactionApplied"
> => {
  const stdoutSummary = safeValidationSummary(result.stdoutSummary);
  const stderrSummary = safeValidationSummary(result.stderrSummary);

  return {
    commandId: result.commandId,
    commandLabel: result.commandLabel,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutSummary: stdoutSummary.value,
    stderrSummary: stderrSummary.value,
    redactionApplied:
      result.redactionApplied || stdoutSummary.redactionApplied || stderrSummary.redactionApplied,
  };
};

const safePushMetadata = (pushArtifact: PushedBranchArtifact): Record<string, unknown> => ({
  branchName: pushArtifact.branchName,
  remoteName: pushArtifact.remoteName,
  remoteRef: pushArtifact.remoteRef,
  commitHash: pushArtifact.commitHash,
});

const safePrArtifactMetadata = (prArtifact: PrArtifact): Record<string, unknown> => ({
  repository: {
    owner: prArtifact.repository.owner,
    name: prArtifact.repository.name,
  },
  branchName: prArtifact.branchName,
  prNumber: prArtifact.prNumber,
  prUrl: prArtifact.prUrl,
  prTitle: prArtifact.prTitle,
  prStatus: prArtifact.prStatus,
  changedFilePaths: safePathList(prArtifact.changedFilePaths),
  riskFindings: prArtifact.riskFindings.map(riskFindingSummary),
});

const safeValidationSummary = (
  value: string,
): {
  value: string;
  redactionApplied: boolean;
} => {
  if (hasUnsafeValidationSummaryText(value)) {
    return {
      value: "Validation output summary suppressed by runner event safety filter.",
      redactionApplied: true,
    };
  }

  return {
    value,
    redactionApplied: false,
  };
};

const validationCompletionSeverity = (
  validationResult: ValidationSuiteResult,
): RunEvent["severity"] => (validationResult.status === "warning" ? "warning" : "info");

const changeScanSeverity = (changeScanResult: ChangeScanResult): RunEvent["severity"] => {
  if (shouldBlockChangeScan(changeScanResult)) {
    return "blocked";
  }

  if (changeScanResult.warnings.length > 0) {
    return "warning";
  }

  return "info";
};

const changeScanMessage = (changeScanResult: ChangeScanResult): string => {
  if (shouldBlockChangeScan(changeScanResult)) {
    return "Change scan completed with blockers.";
  }

  if (changeScanResult.warnings.length > 0) {
    return "Change scan completed with warnings.";
  }

  return "Change scan completed.";
};

const shouldBlockChangeScan = (changeScanResult: ChangeScanResult): boolean =>
  changeScanResult.shouldBlock || changeScanResult.blockers.length > 0;

const safePathList = (paths: readonly string[]): string[] => paths.filter(isSafePathText);

const isSafePathText = (value: string): boolean => {
  if (value.length === 0 || value.length > 512 || value.trim() !== value) {
    return false;
  }

  if ([...value].some(hasControlCharacter)) {
    return false;
  }

  const normalized = value.replace(/\\/g, "/");

  if (
    normalized.startsWith("/") ||
    normalized.includes("://") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return false;
  }

  return !hasUnsafePathText(normalized);
};

const hasControlCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0);

  return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
};

const hasUnsafePathText = (value: string): boolean =>
  /\[REDACTED_(?:SECRET|PRIVATE_KEY|CREDENTIAL_URL)\]/i.test(value) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/i.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/.test(value) ||
  /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
  /diff --git\s+/i.test(value) ||
  /^@@\s+[-+0-9, ]+@@/m.test(value) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/.test(value) ||
  /(?:=>|[{};])/.test(value);

const hasUnsafeValidationSummaryText = (value: string): boolean =>
  /\braw\s+(?:stdout|stderr)\b/i.test(value) ||
  /diff --git\s+/i.test(value) ||
  /^@@\s+[-+0-9, ]+@@/m.test(value) ||
  /(^|\n)\*\*\* Begin Patch\b/i.test(value) ||
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i.test(value) ||
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i.test(value) ||
  /```[^\n]*\n/i.test(value);

const worktreeCleanupMessage = (state: WorktreeCleanupEventState): string => {
  if (state === "cancelled") {
    return "Runner worktree cleanup completed after cancellation.";
  }

  if (state === "completed") {
    return "Runner worktree cleanup completed.";
  }

  return "Runner worktree cleanup completed after failure.";
};
