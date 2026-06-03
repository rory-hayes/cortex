import { spawn, type ChildProcessByStdio } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";

const DEFAULT_SUMMARY_LIMIT = 4_000;
const TRUNCATION_MARKER = "\n[truncated]";

export type CommandMetadata = {
  executable: string;
  args: string[];
};

export type RunCommandOptions = {
  command: string;
  args?: readonly string[];
  cwd: string;
  throwOnNonZero?: boolean;
  summaryLimit?: number;
};

export type CommandExecutionResult = {
  command: CommandMetadata;
  cwd: string;
  exitCode: number;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  redactionApplied: boolean;
};

export class CommandExecutionError extends Error {
  readonly result: CommandExecutionResult;

  constructor(result: CommandExecutionResult) {
    super(`Command failed with exit code ${result.exitCode}.`);
    this.name = "CommandExecutionError";
    this.result = result;
  }
}

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RedactedText = {
  value: string;
  redactionApplied: boolean;
};

export const runCommand = async (options: RunCommandOptions): Promise<CommandExecutionResult> => {
  const args = [...(options.args ?? [])];
  const summaryLimit = normalizeSummaryLimit(options.summaryLimit);
  const startedAt = performance.now();
  const spawnResult = await spawnDirect(options.command, args, options.cwd);
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const command = redactCommandMetadata(options.command, args);
  const stdoutSummary = summarizeCommandOutput(spawnResult.stdout, summaryLimit);
  const stderrSummary = summarizeCommandOutput(spawnResult.stderr, summaryLimit);
  const result: CommandExecutionResult = {
    command: command.metadata,
    cwd: options.cwd,
    exitCode: spawnResult.exitCode,
    durationMs,
    stdoutSummary: stdoutSummary.value,
    stderrSummary: stderrSummary.value,
    redactionApplied:
      command.redactionApplied || stdoutSummary.redactionApplied || stderrSummary.redactionApplied,
  };

  if (options.throwOnNonZero === true && result.exitCode !== 0) {
    throw new CommandExecutionError(result);
  }

  return result;
};

const spawnDirect = async (
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<SpawnResult> =>
  new Promise((resolve) => {
    let settled = false;
    let child: ChildProcessByStdio<null, Readable, Readable>;

    try {
      child = spawn(command, [...args], {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(formatSpawnFailure(error));
      return;
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(formatSpawnFailure(error));
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });

const formatSpawnFailure = (error: unknown): SpawnResult => ({
  exitCode: getErrorCode(error) === "ENOENT" ? 127 : 1,
  stdout: "",
  stderr:
    getErrorCode(error) === "ENOENT"
      ? "Command failed to start: executable_not_found."
      : "Command failed to start: spawn_failed.",
});

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
};

const redactCommandMetadata = (
  executable: string,
  args: readonly string[],
): {
  metadata: CommandMetadata;
  redactionApplied: boolean;
} => {
  const redactedExecutable = redactText(executable);
  const redactedArgs = args.map((arg) => redactText(arg));

  return {
    metadata: {
      executable: redactedExecutable.value,
      args: redactedArgs.map((arg) => arg.value),
    },
    redactionApplied:
      redactedExecutable.redactionApplied || redactedArgs.some((arg) => arg.redactionApplied),
  };
};

const summarizeCommandOutput = (value: string, limit: number): RedactedText => {
  const redacted = redactText(value);

  return {
    value: truncateSummary(redacted.value, limit),
    redactionApplied: redacted.redactionApplied,
  };
};

const redactText = (value: string): RedactedText => {
  let redacted = value;

  redacted = redacted.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  );
  redacted = redacted.replace(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/gi,
    "[REDACTED_CREDENTIAL_URL]",
  );
  redacted = redacted.replace(
    /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]\s*['"]?[^\s'";,)]+['"]?/gi,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]");

  return {
    value: redacted,
    redactionApplied: redacted !== value,
  };
};

const truncateSummary = (value: string, limit: number): string => {
  if (value.length <= limit) {
    return value;
  }

  if (limit <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, limit);
  }

  return `${value.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
};

const normalizeSummaryLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_SUMMARY_LIMIT;
  }

  return Math.floor(limit);
};
