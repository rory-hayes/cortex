import type { ValidationCommand, ValidationResult } from "@control-plane/shared";

export interface ValidationExecutionRequest {
  runId: string;
  worktreePath: string;
  command: ValidationCommand;
  skip?: boolean;
}

export type ValidationExecutionResult = ValidationResult;

export interface ValidationAdapter {
  execute(request: ValidationExecutionRequest): Promise<ValidationExecutionResult>;
}

export type ValidationEngine = ValidationAdapter;

export type ValidationSuiteStatus = "passed" | "warning" | "failed";

export interface ValidationSuiteRequest {
  runId: string;
  worktreePath: string;
  commands: ValidationCommand[];
}

export interface ValidationSuiteFinding {
  commandId: string;
  commandLabel: string;
  status: Extract<ValidationResult["status"], "failed" | "cancelled">;
  message: string;
}

export interface ValidationSuiteResult {
  status: ValidationSuiteStatus;
  shouldBlockCommit: boolean;
  results: ValidationResult[];
  warnings: ValidationSuiteFinding[];
  blockers: ValidationSuiteFinding[];
}

export interface ValidationSuiteRunnerOptions {
  adapter?: ValidationAdapter;
}

export interface ValidationSuiteRunner {
  run(request: ValidationSuiteRequest): Promise<ValidationSuiteResult>;
}
