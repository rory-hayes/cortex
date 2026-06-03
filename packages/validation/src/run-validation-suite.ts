import {
  ValidationResultSchema,
  type ValidationCommand,
  type ValidationResult,
} from "@control-plane/shared";

import { createValidationCommandRunner } from "./run-command.js";
import type {
  ValidationAdapter,
  ValidationSuiteFinding,
  ValidationSuiteRequest,
  ValidationSuiteResult,
  ValidationSuiteRunner,
  ValidationSuiteRunnerOptions,
  ValidationSuiteStatus,
} from "./types.js";

const REQUIRED_FAILURE_MESSAGE = "Required validation command failed.";
const OPTIONAL_FAILURE_MESSAGE = "Optional validation command failed.";
const CANCELLED_MESSAGE = "Validation command was cancelled.";

export const createValidationSuiteRunner = (
  options: ValidationSuiteRunnerOptions = {},
): ValidationSuiteRunner => ({
  async run(request: ValidationSuiteRequest): Promise<ValidationSuiteResult> {
    return runValidationSuite(request, options);
  },
});

export const runValidationSuite = async (
  request: ValidationSuiteRequest,
  options: ValidationSuiteRunnerOptions = {},
): Promise<ValidationSuiteResult> => {
  const adapter = options.adapter ?? createValidationCommandRunner();
  const results: ValidationResult[] = [];
  const warnings: ValidationSuiteFinding[] = [];
  const blockers: ValidationSuiteFinding[] = [];
  let skipRemaining = false;

  for (const command of request.commands) {
    const result = await runSuiteCommand({
      adapter,
      request,
      command,
      skip: skipRemaining,
    });
    results.push(result);

    if (skipRemaining) {
      continue;
    }

    if (result.status === "cancelled") {
      blockers.push(createFinding(result, "cancelled", CANCELLED_MESSAGE));
      skipRemaining = true;
      continue;
    }

    if (result.status === "failed") {
      if (command.required) {
        blockers.push(createFinding(result, "failed", REQUIRED_FAILURE_MESSAGE));
        skipRemaining = true;
      } else {
        warnings.push(createFinding(result, "failed", OPTIONAL_FAILURE_MESSAGE));
      }
    }
  }

  return {
    status: resolveSuiteStatus({ warnings, blockers }),
    shouldBlockCommit: blockers.length > 0,
    results,
    warnings,
    blockers,
  };
};

const runSuiteCommand = async (params: {
  adapter: ValidationAdapter;
  request: ValidationSuiteRequest;
  command: ValidationCommand;
  skip: boolean;
}): Promise<ValidationResult> =>
  ValidationResultSchema.parse(
    await params.adapter.execute({
      runId: params.request.runId,
      worktreePath: params.request.worktreePath,
      command: params.command,
      skip: params.skip,
    }),
  );

const createFinding = (
  result: ValidationResult,
  status: ValidationSuiteFinding["status"],
  message: string,
): ValidationSuiteFinding => ({
  commandId: result.commandId,
  commandLabel: result.commandLabel,
  status,
  message,
});

const resolveSuiteStatus = (params: {
  warnings: ValidationSuiteFinding[];
  blockers: ValidationSuiteFinding[];
}): ValidationSuiteStatus => {
  if (params.blockers.length > 0) {
    return "failed";
  }

  if (params.warnings.length > 0) {
    return "warning";
  }

  return "passed";
};
