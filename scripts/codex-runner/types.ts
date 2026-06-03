export type TaskStatus = "[ ]" | "[~]" | "[x]" | "[!]" | "[>]" | string;

export type BacklogTask = {
  id: string;
  title: string;
  raw: string;
  status: TaskStatus;
  priority: string;
  dependsOn: string[];
  validation: string;
  acceptanceCriteria?: string;
  goal?: string;
  filesLikelyTouched: string[];
  order: number;
  start: number;
  end: number;
};

export type ParsedBacklog = {
  markdown: string;
  tasks: BacklogTask[];
};

export type RunnerMode = { kind: "limit"; value: number } | { kind: "all" };

export type ValidationCommand = {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  required: boolean;
  timeoutMs: number;
};

export type ValidationStatus = "passed" | "failed" | "timed_out" | "skipped";

export type ValidationResult = ValidationCommand & {
  status: ValidationStatus;
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  timedOut: boolean;
};

export type QualityFinding = {
  code: string;
  severity: "warning" | "blocked";
  message: string;
  paths: string[];
};

export type QualityGateInput = {
  changedFiles: string[];
  artifactText: string;
  validationResults: ValidationResult[];
  protectedPaths: string[];
  requiresTests: boolean;
  maxChangedFiles?: number;
};

export type QualityGateResult = {
  canProceed: boolean;
  hardBlocks: QualityFinding[];
  warnings: QualityFinding[];
};

export type AgentInstructions = {
  relativePath: "AGENTS.md" | "agents.md";
  absolutePath: string;
  content: string;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
};

export type PrArtifact = {
  branchName: string;
  number: number;
  url: string;
  draft: boolean;
};

export type CodexReviewResult = {
  passed: boolean;
  summary: string;
};

export type RunTaskStatus =
  | "planned"
  | "dry_run_passed"
  | "blocked"
  | "failed"
  | "pr_opened"
  | "merge_blocked"
  | "merged";

export type ExecutedTaskSummary = {
  taskId: string;
  title: string;
  status: RunTaskStatus;
  branchName: string;
  runId: string;
  runDirectory: string;
  prUrl?: string;
  warnings: QualityFinding[];
  hardBlocks: QualityFinding[];
};

export type RunnerSummary = {
  mode: RunnerMode;
  executed: ExecutedTaskSummary[];
  stoppedReason: string;
};

export type RunnerAdapters = {
  ensureClean: (repoRoot: string) => Promise<boolean>;
  createWorktree: (
    repoRoot: string,
    task: BacklogTask,
    branchName: string,
    runId: string,
  ) => Promise<string>;
  prepareWorktree: (repoRoot: string) => Promise<void>;
  getChangedFiles: (repoRoot: string) => Promise<string[]>;
  commitChanges: (repoRoot: string, message: string, body: string) => Promise<void>;
  pushBranch: (repoRoot: string, branchName: string) => Promise<void>;
  resetBookkeepingFiles: (repoRoot: string) => Promise<void>;
  createPr: (
    repoRoot: string,
    input: { branchName: string; title: string; body: string },
  ) => Promise<PrArtifact>;
  findExistingPr: (repoRoot: string, branchName: string) => Promise<PrArtifact | null>;
  mergeValidate: (repoRoot: string, commands: ValidationCommand[]) => Promise<ValidationResult[]>;
  refreshBranchFromMain: (
    repoRoot: string,
    worktreeRoot: string,
    branchName: string,
  ) => Promise<void>;
  mergeBranchToMain: (repoRoot: string, branchName: string) => Promise<void>;
  cleanupTaskResources: (
    repoRoot: string,
    worktreeRoot: string,
    branchName: string,
  ) => Promise<void>;
  codexPlan: (
    prompt: string,
    input: { repoRoot: string; task: BacklogTask; runId: string },
  ) => Promise<string>;
  codexImplement: (
    prompt: string,
    input: { repoRoot: string; task: BacklogTask; runId: string },
  ) => Promise<string>;
  codexReview: (
    prompt: string,
    input: { repoRoot: string; task: BacklogTask; runId: string },
  ) => Promise<CodexReviewResult>;
  codexFix: (
    prompt: string,
    input: { repoRoot: string; task: BacklogTask; runId: string },
  ) => Promise<string>;
  validate: (repoRoot: string, commands: ValidationCommand[]) => Promise<ValidationResult[]>;
  qualityGate: (input: QualityGateInput) => QualityGateResult;
};

export type RunnerOptions = {
  repoRoot?: string;
  mode: RunnerMode;
  approvePlan: boolean;
  autoMerge?: boolean;
  dryRun: boolean;
  fixAttempts?: number;
  codexAttempts?: number;
  codexTimeoutMs?: number;
  concurrency?: number;
  deferBookkeeping?: boolean;
  adapters?: Partial<RunnerAdapters>;
};
