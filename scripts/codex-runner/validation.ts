import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ValidationCommand, ValidationResult } from "./types.js";
import { redactSensitiveOutput } from "./quality-gates.js";

const defaultTimeoutMs = 120_000;
const maxSummaryLength = 4_000;

export async function runValidationCommands(
  repoRoot: string,
  commands: ValidationCommand[],
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const command of commands) {
    results.push(await runValidationCommand(repoRoot, command));
  }

  return results;
}

export function validationCommandsFromTask(validation: string): ValidationCommand[] {
  const commandLines = extractValidationCommands(validation);

  return commandLines.flatMap((commandLine, index) => {
    const [command, ...args] = commandForLine(commandLine);
    if (!command) {
      return [];
    }

    return [
      {
        id: commandLines.length === 1 ? "task-validation" : `task-validation-${String(index + 1)}`,
        label: validation,
        command,
        args,
        required: true,
        timeoutMs: defaultTimeoutMs,
      },
    ];
  });
}

async function runValidationCommand(
  repoRoot: string,
  command: ValidationCommand,
): Promise<ValidationResult> {
  const startedAt = Date.now();
  const cwd = command.cwd ? join(repoRoot, command.cwd) : repoRoot;

  return await new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, "SIGTERM");
    }, command.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        ...command,
        status: "failed",
        exitCode: 127,
        durationMs: Date.now() - startedAt,
        stdoutSummary: "",
        stderrSummary: summarize(error.message),
        timedOut: false,
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        ...command,
        status: timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed",
        exitCode,
        durationMs: Date.now() - startedAt,
        stdoutSummary: summarize(Buffer.concat(stdout).toString("utf8")),
        stderrSummary: summarize(Buffer.concat(stderr).toString("utf8")),
        timedOut,
      });
    });
  });
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may already have exited.
    }
  }
}

function extractValidationCommands(validation: string): string[] {
  const explicitCommands = Array.from(validation.matchAll(/`([^`]+)`/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);

  if (explicitCommands.length > 0) {
    return explicitCommands;
  }

  return Array.from(validation.matchAll(/\bpnpm\s+(?:run\s+)?[A-Za-z0-9:_-]+/g))
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean);
}

function commandForLine(commandLine: string): string[] {
  if (requiresShell(commandLine)) {
    return ["sh", "-lc", commandLine];
  }

  return splitCommandLine(commandLine);
}

function requiresShell(commandLine: string): boolean {
  return /(?:&&|\|\||;|[<>|])/.test(commandLine);
}

function splitCommandLine(commandLine: string): string[] {
  const parts = commandLine.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function summarize(output: string): string {
  const redacted = redactSensitiveOutput(output);
  return redacted.length > maxSummaryLength
    ? `${redacted.slice(0, maxSummaryLength)}\n[truncated]`
    : redacted;
}
