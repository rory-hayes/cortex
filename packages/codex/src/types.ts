export const CODEX_EXECUTION_STATUSES = ["succeeded", "failed", "timed_out", "cancelled"] as const;

export type CodexExecutionStatus = (typeof CODEX_EXECUTION_STATUSES)[number];

export type CodexExecutionRequest = {
  runId: string;
  worktreePath: string;
  prompt: string;
  timeoutMs?: number;
};

export type CodexExecutionResult = {
  status: CodexExecutionStatus;
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  redactionApplied: boolean;
};

export type CodexAdapter = {
  execute(request: CodexExecutionRequest): Promise<CodexExecutionResult>;
};
