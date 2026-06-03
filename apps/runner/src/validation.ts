import {
  CONTRACT_VERSION,
  ValidationResultSchema,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import {
  createValidationCommandRunner,
  runValidationSuite as defaultRunValidationSuite,
  type ValidationAdapter,
  type ValidationExecutionRequest,
  type ValidationSuiteFinding,
  type ValidationSuiteResult,
} from "@control-plane/validation";

import type { RunnerCancellationChecker } from "./cancellation.js";

export type RunValidationForTaskOptions = {
  taskPacket: TaskPacket;
  worktreePath: string;
  adapter?: ValidationAdapter;
  runValidationSuite?: typeof defaultRunValidationSuite;
  checkCancellation?: RunnerCancellationChecker;
};

export const runValidationForTask = async ({
  taskPacket,
  worktreePath,
  adapter = createValidationCommandRunner(),
  runValidationSuite = defaultRunValidationSuite,
  checkCancellation = defaultCancellationChecker,
}: RunValidationForTaskOptions): Promise<ValidationSuiteResult> => {
  const cancellationRequestedBeforeValidation = await checkCancellation({
    boundary: "before_validation",
    runId: taskPacket.runId,
  });
  const guardedAdapter = createCancellationGuardedAdapter({
    adapter,
    checkCancellation,
    cancellationRequestedBeforeValidation,
  });

  const result = await runValidationSuite(
    {
      runId: taskPacket.runId,
      worktreePath,
      commands: taskPacket.validation.commands,
    },
    {
      adapter: guardedAdapter,
    },
  );

  return safeValidationSuiteResult(result);
};

export const safeValidationSuiteResult = (
  validationResult: ValidationSuiteResult,
): ValidationSuiteResult => ({
  status: validationResult.status,
  shouldBlockCommit: validationResult.shouldBlockCommit,
  results: validationResult.results.map(safeValidationResult),
  warnings: validationResult.warnings.map(safeValidationSuiteFinding),
  blockers: validationResult.blockers.map(safeValidationSuiteFinding),
});

const createCancellationGuardedAdapter = ({
  adapter,
  checkCancellation,
  cancellationRequestedBeforeValidation,
}: {
  adapter: ValidationAdapter;
  checkCancellation: RunnerCancellationChecker;
  cancellationRequestedBeforeValidation: boolean;
}): ValidationAdapter => {
  let shouldCancelNextCommand = cancellationRequestedBeforeValidation;

  return {
    async execute(request: ValidationExecutionRequest): Promise<ValidationResult> {
      if (request.skip === true) {
        return safeValidationResult(await adapter.execute(request));
      }

      if (
        shouldCancelNextCommand ||
        (await checkCancellation({
          boundary: "during_validation",
          runId: request.runId,
        }))
      ) {
        shouldCancelNextCommand = true;
        return cancelledValidationResult(request);
      }

      return safeValidationResult(await adapter.execute(request));
    },
  };
};

const defaultCancellationChecker = (): boolean => false;

const safeValidationResult = (result: ValidationResult): ValidationResult =>
  ValidationResultSchema.parse({
    contractVersion: result.contractVersion,
    id: result.id,
    runId: result.runId,
    commandId: result.commandId,
    commandLabel: result.commandLabel,
    command: result.command,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutSummary: result.stdoutSummary,
    stderrSummary: result.stderrSummary,
    redactionApplied: result.redactionApplied,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  });

const safeValidationSuiteFinding = (finding: ValidationSuiteFinding): ValidationSuiteFinding => ({
  commandId: finding.commandId,
  commandLabel: finding.commandLabel,
  status: finding.status,
  message: finding.message,
});

const cancelledValidationResult = (request: ValidationExecutionRequest): ValidationResult => {
  const timestamp = new Date().toISOString();

  return ValidationResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `validation:${request.runId}:${request.command.id}`,
    runId: request.runId,
    commandId: request.command.id,
    commandLabel: request.command.label,
    command: "Validation command not executed.",
    status: "cancelled",
    exitCode: null,
    durationMs: 0,
    stdoutSummary: "",
    stderrSummary: "Validation command was cancelled before execution.",
    redactionApplied: true,
    startedAt: timestamp,
    finishedAt: timestamp,
  });
};
