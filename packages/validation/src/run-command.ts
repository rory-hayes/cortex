import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";

import {
  CONTRACT_VERSION,
  ValidationResultSchema,
  type ValidationResult,
} from "@control-plane/shared";

import { redactValidationOutput } from "./redact.js";
import type { ValidationAdapter, ValidationExecutionRequest } from "./types.js";

const DEFAULT_SUMMARY_LIMIT = 4_000;
const DEFAULT_CAPTURE_LIMIT = 64_000;
const DEFAULT_TIMEOUT_KILL_GRACE_MS = 5_000;
const TRUNCATION_MARKER = "\n[truncated]";
const CAPTURE_TRUNCATION_MARKER = "\n[output truncated before summary]";
const SOURCE_LIKE_SUPPRESSION =
  "Validation output suppressed because it resembled source, diff, or patch.";

type ChildProcessLike = {
  pid?: number;
  stdout?: Readable;
  stderr?: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): ChildProcessLike;
  on(event: "error", listener: (error: Error) => void): ChildProcessLike;
};

export type ValidationCommandSpawn = (command: string, options: SpawnOptions) => ChildProcessLike;

export type ValidationCommandRunnerOptions = {
  spawn?: ValidationCommandSpawn;
  summaryLimit?: number;
  captureLimit?: number;
  timeoutKillGraceMs?: number;
  detached?: boolean;
};

type CapturedOutput = {
  value: string;
  truncated: boolean;
};

type Summary = {
  value: string;
  redactionApplied: boolean;
};

type ResolvedCwd =
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      reason: "outside" | "unavailable";
    };

type ChildOutcome =
  | {
      type: "closed";
      exitCode: number | null;
    }
  | {
      type: "start_failed";
    }
  | {
      type: "timed_out";
    };

export const createValidationCommandRunner = (
  options: ValidationCommandRunnerOptions = {},
): ValidationAdapter => ({
  async execute(request: ValidationExecutionRequest): Promise<ValidationResult> {
    return runValidationCommand(request, options);
  },
});

export const runValidationCommand = async (
  request: ValidationExecutionRequest,
  options: ValidationCommandRunnerOptions = {},
): Promise<ValidationResult> => {
  const startedAt = new Date();
  const startedAtMs = performance.now();

  if (request.skip === true) {
    return parseValidationResult({
      request,
      status: "skipped",
      exitCode: null,
      durationMs: 0,
      stdoutSummary: "",
      stderrSummary: "",
      redactionApplied: false,
      startedAt,
      finishedAt: startedAt,
    });
  }

  const cwd = resolveValidationCwd(request.worktreePath, request.command.cwd);

  if (!cwd.ok) {
    return parseValidationResult({
      request,
      status: "failed",
      exitCode: null,
      durationMs: durationSince(startedAtMs),
      stdoutSummary: "",
      stderrSummary:
        cwd.reason === "outside"
          ? "Validation command cwd is outside the worktree."
          : "Validation command cwd is unavailable.",
      redactionApplied: true,
      startedAt,
      finishedAt: new Date(),
    });
  }

  const spawn = options.spawn ?? defaultSpawn;
  const spawnOptions: SpawnOptions = {
    cwd: cwd.path,
    detached: options.detached ?? process.platform !== "win32",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  };

  let child: ChildProcessLike;

  try {
    child = spawn(request.command.command, spawnOptions);
  } catch {
    return parseValidationResult({
      request,
      status: "failed",
      exitCode: null,
      durationMs: durationSince(startedAtMs),
      stdoutSummary: "",
      stderrSummary: "Validation command failed to start.",
      redactionApplied: true,
      startedAt,
      finishedAt: new Date(),
    });
  }

  return waitForCommandOutcome({
    child,
    request,
    options,
    startedAt,
    startedAtMs,
  });
};

const waitForCommandOutcome = async (params: {
  child: ChildProcessLike;
  request: ValidationExecutionRequest;
  options: ValidationCommandRunnerOptions;
  startedAt: Date;
  startedAtMs: number;
}): Promise<ValidationResult> =>
  new Promise((resolveResult) => {
    let settled = false;
    let timedOut = false;
    let killEscalationTimer: ReturnType<typeof setTimeout> | undefined;
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();
    const captureLimit = normalizePositiveInteger(params.options.captureLimit, {
      fallback: DEFAULT_CAPTURE_LIMIT,
    });
    const summaryLimit = normalizePositiveInteger(params.options.summaryLimit, {
      fallback: DEFAULT_SUMMARY_LIMIT,
    });
    const timeoutMs = params.request.command.timeoutSeconds * 1_000;
    const timeoutKillGraceMs = normalizePositiveInteger(params.options.timeoutKillGraceMs, {
      fallback: DEFAULT_TIMEOUT_KILL_GRACE_MS,
    });
    const detached = params.options.detached ?? process.platform !== "win32";

    const settle = (outcome: ChildOutcome): void => {
      if (settled) {
        return;
      }

      settled = true;

      clearTimeout(timeoutTimer);
      if (killEscalationTimer !== undefined) {
        clearTimeout(killEscalationTimer);
      }

      resolveResult(
        createResultFromOutcome({
          outcome,
          stdout,
          stderr,
          request: params.request,
          startedAt: params.startedAt,
          startedAtMs: params.startedAtMs,
          summaryLimit,
        }),
      );
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killChildProcess(params.child, "SIGTERM", detached);
      killEscalationTimer = setTimeout(() => {
        killChildProcess(params.child, "SIGKILL", detached);
        settle({ type: "timed_out" });
      }, timeoutKillGraceMs);
    }, timeoutMs);

    params.child.stdout?.setEncoding("utf8");
    params.child.stderr?.setEncoding("utf8");

    params.child.stdout?.on("data", (chunk: Buffer | string) => {
      appendCapturedOutput(stdout, String(chunk), captureLimit);
    });

    params.child.stderr?.on("data", (chunk: Buffer | string) => {
      appendCapturedOutput(stderr, String(chunk), captureLimit);
    });

    params.child.on("error", () => {
      if (!timedOut) {
        settle({ type: "start_failed" });
      }
    });

    params.child.on("close", (exitCode) => {
      settle(timedOut ? { type: "timed_out" } : { type: "closed", exitCode });
    });
  });

const defaultSpawn: ValidationCommandSpawn = (command, options) =>
  nodeSpawn(command, options) as ChildProcessLike;

const createResultFromOutcome = (params: {
  outcome: ChildOutcome;
  stdout: CapturedOutput;
  stderr: CapturedOutput;
  request: ValidationExecutionRequest;
  startedAt: Date;
  startedAtMs: number;
  summaryLimit: number;
}): ValidationResult => {
  if (params.outcome.type === "timed_out") {
    return parseValidationResult({
      request: params.request,
      status: "failed",
      exitCode: null,
      durationMs: durationSince(params.startedAtMs),
      stdoutSummary: "",
      stderrSummary: "Validation command timed out.",
      redactionApplied: true,
      startedAt: params.startedAt,
      finishedAt: new Date(),
    });
  }

  if (params.outcome.type === "start_failed") {
    return parseValidationResult({
      request: params.request,
      status: "failed",
      exitCode: null,
      durationMs: durationSince(params.startedAtMs),
      stdoutSummary: "",
      stderrSummary: "Validation command failed to start.",
      redactionApplied: true,
      startedAt: params.startedAt,
      finishedAt: new Date(),
    });
  }

  const stdoutSummary = summarizeOutput(params.stdout, params.summaryLimit);
  const stderrSummary = summarizeOutput(params.stderr, params.summaryLimit);
  const exitCode = normalizeExitCode(params.outcome.exitCode);

  return parseValidationResult({
    request: params.request,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs: durationSince(params.startedAtMs),
    stdoutSummary: stdoutSummary.value,
    stderrSummary: stderrSummary.value,
    redactionApplied: stdoutSummary.redactionApplied || stderrSummary.redactionApplied,
    startedAt: params.startedAt,
    finishedAt: new Date(),
  });
};

const resolveValidationCwd = (
  worktreePath: string,
  commandCwd: string | undefined,
): ResolvedCwd => {
  if (commandCwd !== undefined && isAbsolute(commandCwd)) {
    return { ok: false, reason: "outside" };
  }

  try {
    const worktreeRealPath = realpathSync(worktreePath);
    const worktreeStats = statSync(worktreeRealPath);

    if (!worktreeStats.isDirectory()) {
      return { ok: false, reason: "unavailable" };
    }

    const candidatePath =
      commandCwd === undefined ? worktreeRealPath : resolve(worktreeRealPath, commandCwd);

    if (!isInsideOrEqual(worktreeRealPath, candidatePath)) {
      return { ok: false, reason: "outside" };
    }

    const candidateRealPath = realpathSync(candidatePath);
    const candidateStats = statSync(candidateRealPath);

    if (!candidateStats.isDirectory()) {
      return { ok: false, reason: "unavailable" };
    }

    if (!isInsideOrEqual(worktreeRealPath, candidateRealPath)) {
      return { ok: false, reason: "outside" };
    }

    return { ok: true, path: candidateRealPath };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
};

const isInsideOrEqual = (rootPath: string, candidatePath: string): boolean => {
  const pathFromRoot = relative(rootPath, candidatePath);

  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
};

const summarizeOutput = (output: CapturedOutput, limit: number): Summary => {
  const capturedValue = output.truncated
    ? `${output.value}${CAPTURE_TRUNCATION_MARKER}`
    : output.value;
  const redacted = redactValidationOutput(capturedValue);
  const sourceSafe = suppressSourceLikeOutput(redacted.text);
  const truncated = truncateSummary(sourceSafe.value, limit);

  return {
    value: truncated.value,
    redactionApplied:
      output.truncated ||
      redacted.redactionApplied ||
      sourceSafe.redactionApplied ||
      truncated.truncated,
  };
};

const summarizeCommandText = (command: string): Summary => {
  const redacted = redactValidationOutput(command);
  const sourceSafe = suppressSourceLikeOutput(redacted.text);
  const truncated = truncateSummary(sourceSafe.value, DEFAULT_SUMMARY_LIMIT);

  return {
    value: truncated.value,
    redactionApplied:
      redacted.redactionApplied || sourceSafe.redactionApplied || truncated.truncated,
  };
};

const suppressSourceLikeOutput = (value: string): Summary => {
  if (SOURCE_LIKE_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      value: SOURCE_LIKE_SUPPRESSION,
      redactionApplied: true,
    };
  }

  return {
    value,
    redactionApplied: false,
  };
};

const SOURCE_LIKE_PATTERNS = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)[+-]\s*(?:import|export|const|let|var|function|class|type|interface)\b/i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:async\s+)?function\s+[$A-Z_][\w$]*\s*\(/i,
  /(^|\n)\s*(?:const|let|var)\s+[$A-Z_][\w$]*\s*(?::[^=\n]+)?=/i,
  /(^|\n)\s*[$A-Za-z_][\w$]*(?:\s*\.\s*[$A-Za-z_][\w$]*)+\s*=\s*[^\n]+/,
  /(^|\n)\s*(?![A-Z0-9_]+\s*=)[$A-Za-z_][\w$]*\s+=\s+[^\n]+/,
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\([^)]*\))?\s*:/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /(^|\n)\s*>?\s*\d+\s*\|[^\n]*(?:\b(?:import|export|const|let|var|function|class|type|interface|enum|return|throw|yield|await|async|expect|describe|it|test)\b|[{};=]|=>)/i,
  /(^|\n)\s*(?:SELECT\b[^\n]*\bFROM\b|INSERT\s+INTO\b|UPDATE\b[^\n]*\bSET\b|DELETE\s+FROM\b|CREATE\s+(?:TABLE|INDEX|VIEW)\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|INDEX|VIEW)\b)/i,
  /(^|\n)\s*[A-Z0-9_-]+:\s*\n\s{2,}[A-Z0-9_-]+:/i,
  /(^|\n)\s*<\/?[A-Z][\w:-]*(?:\s+[^>\n]*)?>/i,
  /```[^\n]*\n/i,
];

const createCapturedOutput = (): CapturedOutput => ({
  value: "",
  truncated: false,
});

const appendCapturedOutput = (output: CapturedOutput, chunk: string, limit: number): void => {
  if (output.value.length >= limit) {
    output.truncated = true;
    return;
  }

  const remaining = limit - output.value.length;

  if (chunk.length > remaining) {
    output.value += chunk.slice(0, remaining);
    output.truncated = true;
    return;
  }

  output.value += chunk;
};

const truncateSummary = (
  value: string,
  limit: number,
): {
  value: string;
  truncated: boolean;
} => {
  if (value.length <= limit) {
    return { value, truncated: false };
  }

  if (limit <= TRUNCATION_MARKER.length) {
    return { value: TRUNCATION_MARKER.slice(0, limit), truncated: true };
  }

  return {
    value: `${value.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`,
    truncated: true,
  };
};

const normalizePositiveInteger = (
  value: number | undefined,
  options: {
    fallback: number;
  },
): number => {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return options.fallback;
  }

  return Math.floor(value);
};

const normalizeExitCode = (exitCode: number | null): number | null => {
  if (exitCode === null || !Number.isInteger(exitCode) || exitCode < 0) {
    return null;
  }

  return exitCode;
};

const durationSince = (startedAtMs: number): number =>
  Math.max(0, Math.round(performance.now() - startedAtMs));

const killChildProcess = (
  child: ChildProcessLike,
  signal: NodeJS.Signals,
  detached: boolean,
): void => {
  if (detached && typeof child.pid === "number" && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to killing the direct process below.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Process termination is best-effort once timeout has already been recorded.
  }
};

const parseValidationResult = (params: {
  request: ValidationExecutionRequest;
  status: ValidationResult["status"];
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  redactionApplied: boolean;
  startedAt: Date;
  finishedAt: Date;
}): ValidationResult => {
  const command = summarizeCommandText(params.request.command.command);

  return ValidationResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `validation:${params.request.runId}:${params.request.command.id}`,
    runId: params.request.runId,
    commandId: params.request.command.id,
    commandLabel: params.request.command.label,
    command: command.value,
    status: params.status,
    exitCode: params.exitCode,
    durationMs: params.durationMs,
    stdoutSummary: params.stdoutSummary,
    stderrSummary: params.stderrSummary,
    redactionApplied: params.redactionApplied || command.redactionApplied,
    startedAt: params.startedAt.toISOString(),
    finishedAt: params.finishedAt.toISOString(),
  });
};
