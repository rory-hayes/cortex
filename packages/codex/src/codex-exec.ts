import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { performance } from "node:perf_hooks";

import type {
  CodexAdapter,
  CodexExecutionRequest,
  CodexExecutionResult,
  CodexExecutionStatus,
} from "./types.js";

const CODEX_EXECUTABLE = "codex";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TIMEOUT_KILL_GRACE_MS = 5_000;
const DEFAULT_SUMMARY_LIMIT = 4_000;
const DEFAULT_CAPTURE_LIMIT = 64_000;
const TRUNCATION_MARKER = "\n[truncated]";
const CAPTURE_TRUNCATION_MARKER = "\n[output truncated before summary]";
const SOURCE_LIKE_REDACTION = "[REDACTED_SOURCE_LIKE_OUTPUT]";
const PROMPT_LIKE_REDACTION = "[REDACTED_PROMPT_OUTPUT]";
const PROMPT_FRAGMENT_MIN_LENGTH = 8;

type SpawnFactory = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export type CodexExecAdapterOptions = {
  spawn?: SpawnFactory;
  defaultTimeoutMs?: number;
  summaryLimit?: number;
  captureLimit?: number;
  killSignal?: NodeJS.Signals;
  timeoutKillGraceMs?: number;
};

type CapturedOutput = {
  value: string;
  truncated: boolean;
};

type RedactedText = {
  value: string;
  redactionApplied: boolean;
};

type ChildOutcome =
  | {
      type: "closed";
      exitCode: number | null;
    }
  | {
      type: "start_failed";
      exitCode: number;
      stderrSummary: string;
    }
  | {
      type: "timed_out";
    };

export const createCodexExecAdapter = (options: CodexExecAdapterOptions = {}): CodexAdapter => ({
  async execute(request: CodexExecutionRequest): Promise<CodexExecutionResult> {
    return executeCodex(request, options);
  },
});

const executeCodex = async (
  request: CodexExecutionRequest,
  options: CodexExecAdapterOptions,
): Promise<CodexExecutionResult> => {
  const startedAt = performance.now();
  const spawn = options.spawn ?? defaultSpawn;
  const args = ["exec", "--cd", request.worktreePath, "--color", "never", "-"] as const;
  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd: request.worktreePath,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  };
  const timeoutMs = normalizePositiveInteger(request.timeoutMs ?? options.defaultTimeoutMs, {
    fallback: DEFAULT_TIMEOUT_MS,
  });
  const summaryLimit = normalizePositiveInteger(options.summaryLimit, {
    fallback: DEFAULT_SUMMARY_LIMIT,
  });
  const captureLimit = normalizePositiveInteger(options.captureLimit, {
    fallback: DEFAULT_CAPTURE_LIMIT,
  });
  const timeoutKillGraceMs = normalizePositiveInteger(options.timeoutKillGraceMs, {
    fallback: DEFAULT_TIMEOUT_KILL_GRACE_MS,
  });

  let child: ChildProcessWithoutNullStreams;

  try {
    child = spawn(CODEX_EXECUTABLE, args, spawnOptions);
  } catch (error) {
    return createStartFailureResult(error, startedAt);
  }

  return new Promise<CodexExecutionResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let killEscalationTimer: ReturnType<typeof setTimeout> | undefined;
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(options.killSignal ?? "SIGTERM");
      killEscalationTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutKillGraceMs);
    }, timeoutMs);

    const settle = (outcome: ChildOutcome): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (killEscalationTimer !== undefined) {
        clearTimeout(killEscalationTimer);
      }
      resolve(createResultFromOutcome(outcome, stdout, stderr, request, startedAt, summaryLimit));
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: Buffer | string) => {
      appendCapturedOutput(stdout, String(chunk), captureLimit);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      appendCapturedOutput(stderr, String(chunk), captureLimit);
    });

    const settleStdinFailure = (): void => {
      if (timedOut || settled) {
        return;
      }

      child.kill(options.killSignal ?? "SIGTERM");
      settle({
        type: "start_failed",
        exitCode: 1,
        stderrSummary: "Codex failed to start: stdin_unavailable.",
      });
    };

    child.stdin.on("error", settleStdinFailure);

    child.on("error", (error) => {
      if (timedOut) {
        return;
      }

      settle({
        type: "start_failed",
        exitCode: getErrorCode(error) === "ENOENT" ? 127 : 1,
        stderrSummary:
          getErrorCode(error) === "ENOENT"
            ? "Codex failed to start: executable_not_found."
            : "Codex failed to start: spawn_failed.",
      });
    });

    child.on("close", (exitCode) => {
      settle(
        timedOut
          ? {
              type: "timed_out",
            }
          : {
              type: "closed",
              exitCode,
            },
      );
    });

    try {
      child.stdin.write(request.prompt);
      child.stdin.end();
    } catch {
      settleStdinFailure();
    }
  });
};

const defaultSpawn: SpawnFactory = (command, args, options) =>
  nodeSpawn(command, [...args], options);

const createResultFromOutcome = (
  outcome: ChildOutcome,
  stdout: CapturedOutput,
  stderr: CapturedOutput,
  request: CodexExecutionRequest,
  startedAt: number,
  summaryLimit: number,
): CodexExecutionResult => {
  if (outcome.type === "timed_out") {
    return {
      status: "timed_out",
      exitCode: null,
      durationMs: durationSince(startedAt),
      stdoutSummary: "",
      stderrSummary: "Codex execution timed out.",
      redactionApplied: true,
    };
  }

  if (outcome.type === "start_failed") {
    return {
      status: "failed",
      exitCode: outcome.exitCode,
      durationMs: durationSince(startedAt),
      stdoutSummary: "",
      stderrSummary: outcome.stderrSummary,
      redactionApplied: true,
    };
  }

  const stdoutSummary = summarizeOutput(stdout, request.prompt, summaryLimit);
  const stderrSummary = summarizeOutput(stderr, request.prompt, summaryLimit);
  const status: CodexExecutionStatus = outcome.exitCode === 0 ? "succeeded" : "failed";

  return {
    status,
    exitCode: outcome.exitCode,
    durationMs: durationSince(startedAt),
    stdoutSummary: stdoutSummary.value,
    stderrSummary: stderrSummary.value,
    redactionApplied: stdoutSummary.redactionApplied || stderrSummary.redactionApplied,
  };
};

const createStartFailureResult = (error: unknown, startedAt: number): CodexExecutionResult => ({
  status: "failed",
  exitCode: getErrorCode(error) === "ENOENT" ? 127 : 1,
  durationMs: durationSince(startedAt),
  stdoutSummary: "",
  stderrSummary:
    getErrorCode(error) === "ENOENT"
      ? "Codex failed to start: executable_not_found."
      : "Codex failed to start: spawn_failed.",
  redactionApplied: true,
});

const summarizeOutput = (output: CapturedOutput, prompt: string, limit: number): RedactedText => {
  const capturedValue = output.truncated
    ? `${output.value}${CAPTURE_TRUNCATION_MARKER}`
    : output.value;
  const secretSafe = redactSecrets(capturedValue);
  const sourceSafe = redactSourceLikeOutput(secretSafe.value);
  const promptSafe = redactPrompt(sourceSafe.value, prompt);

  return {
    value: truncateSummary(promptSafe.value, limit),
    redactionApplied:
      output.truncated ||
      secretSafe.redactionApplied ||
      sourceSafe.redactionApplied ||
      promptSafe.redactionApplied,
  };
};

const redactSourceLikeOutput = (value: string): RedactedText => {
  if (SOURCE_LIKE_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      value: SOURCE_LIKE_REDACTION,
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
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\([^)]*\))?\s*:/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /(^|\n)\s*[$A-Z_][\w$]*(?:\.[\w$]+)?\s*=\s*[^=\n]+;?\s*(?=\n|$)/i,
  /(^|\n)\s*(?:SELECT\b[^\n]*\bFROM\b|INSERT\s+INTO\b|UPDATE\b[^\n]*\bSET\b|DELETE\s+FROM\b|CREATE\s+(?:TABLE|INDEX|VIEW)\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|INDEX|VIEW)\b)/i,
  /(^|\n)\s*[A-Z0-9_-]+:\s*\n\s{2,}[A-Z0-9_-]+:/i,
  /(^|\n)\s*<\/?[A-Z][\w:-]*(?:\s+[^>\n]*)?>/i,
  /```[^\n]*\n/i,
];

const redactPrompt = (value: string, prompt: string): RedactedText => {
  if (prompt.length === 0) {
    return {
      value,
      redactionApplied: false,
    };
  }

  if (value.includes(prompt) || containsPromptFragment(value, prompt)) {
    return {
      value: PROMPT_LIKE_REDACTION,
      redactionApplied: true,
    };
  }

  return {
    value,
    redactionApplied: false,
  };
};

const containsPromptFragment = (value: string, prompt: string): boolean => {
  const normalizedValue = normalizePromptFragment(value).toLowerCase();

  if (normalizedValue.length === 0) {
    return false;
  }

  return collectPromptFragments(prompt).some((fragment) =>
    normalizedValue.includes(fragment.toLowerCase()),
  );
};

const collectPromptFragments = (prompt: string): string[] => {
  const fragments = new Set<string>();

  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = normalizePromptFragment(rawLine.replace(/^\s*[-*]\s+/, ""));
    addPromptFragment(fragments, line);

    const colonIndex = line.indexOf(":");
    if (colonIndex >= 0) {
      addPromptFragment(fragments, line.slice(colonIndex + 1));
    }

    for (const token of line.match(/[^\s"'`]+/g) ?? []) {
      const cleanedToken = token.replace(/^[([{<]+|[)\]}>.,;:]+$/g, "");
      if (/[/_.:-]/.test(cleanedToken)) {
        addPromptFragment(fragments, cleanedToken);
      }
    }

    for (const phrase of collectPromptPhraseWindows(line)) {
      addPromptFragment(fragments, phrase);
    }
  }

  return [...fragments];
};

const collectPromptPhraseWindows = (line: string): string[] => {
  const words = line.split(" ").filter(Boolean);
  const phrases: string[] = [];

  for (let start = 0; start < words.length; start += 1) {
    for (let length = 3; length <= Math.min(8, words.length - start); length += 1) {
      phrases.push(words.slice(start, start + length).join(" "));
    }
  }

  return phrases;
};

const addPromptFragment = (fragments: Set<string>, value: string): void => {
  const fragment = normalizePromptFragment(value);

  if (fragment.length >= PROMPT_FRAGMENT_MIN_LENGTH) {
    fragments.add(fragment);
  }
};

const normalizePromptFragment = (value: string): string => value.trim().replace(/\s+/g, " ");

const redactSecrets = (value: string): RedactedText => {
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
    /^\s*(?:export\s+)?[A-Z_][A-Z0-9_]{1,80}\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\n#]*).*$/gim,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(
    /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]\s*['"]?[^\s'";,)]+['"]?/gi,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\b[A-Za-z0-9/+_-]{40,}={0,2}\b/g, (token) =>
    /[A-Za-z]/.test(token) && /\d/.test(token) ? "[REDACTED_SECRET]" : token,
  );

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

const durationSince = (startedAt: number): number =>
  Math.max(0, Math.round(performance.now() - startedAt));

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
};
