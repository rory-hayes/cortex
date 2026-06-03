import { platform, release, arch, tmpdir } from "node:os";

import {
  CONTRACT_VERSION,
  RunnerCapabilitiesSchema,
  type RunnerCapabilities,
  type ToolCapability,
} from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "./command.js";

const COMMAND_SUMMARY_LIMIT = 512;
const DEFAULT_MAX_CONCURRENT_JOBS = 1;
const UNKNOWN_VALUE = "unknown";

export const RUNNER_CAPABILITY_TOOL_KEYS = [
  "git",
  "gh",
  "codex",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "python",
] as const;

export type RunnerCapabilityToolKey = (typeof RUNNER_CAPABILITY_TOOL_KEYS)[number];

export type RunnerCapabilityCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type RunnerCapabilityPathResolver = (
  tool: RunnerCapabilityToolKey,
  options: {
    cwd: string;
    commandRunner: RunnerCapabilityCommandRunner;
  },
) => Promise<string | undefined>;

export type DetectRunnerCapabilitiesOptions = {
  runnerId?: string;
  cwd?: string;
  probeCwd?: string;
  os?: {
    platform: string;
    release: string;
    arch: string;
  };
  shell?: string;
  now?: () => Date;
  maxConcurrentJobs?: number;
  supportsDryRun?: boolean;
  supportsCancellation?: boolean;
  commandRunner?: RunnerCapabilityCommandRunner;
  pathResolver?: RunnerCapabilityPathResolver;
};

export const detectRunnerCapabilities = async (
  options: DetectRunnerCapabilitiesOptions = {},
): Promise<RunnerCapabilities> => {
  const probeCwd = options.probeCwd ?? tmpdir();
  const commandRunner = options.commandRunner ?? runCommand;
  const pathResolver = options.pathResolver ?? resolveToolPath;
  const toolEntries = await Promise.all(
    RUNNER_CAPABILITY_TOOL_KEYS.map(async (tool) => [
      tool,
      await detectToolCapability(tool, {
        cwd: probeCwd,
        commandRunner,
        pathResolver,
      }),
    ]),
  );
  const capabilities = {
    contractVersion: CONTRACT_VERSION,
    ...(sanitizeCapabilityValue(options.runnerId) === undefined
      ? {}
      : { runnerId: sanitizeCapabilityValue(options.runnerId) }),
    os: sanitizeOs(options.os ?? getLocalOs()),
    shell:
      sanitizeCapabilityValue(options.shell ?? getLocalShell(), { allowPath: true }) ??
      UNKNOWN_VALUE,
    tools: Object.fromEntries(toolEntries) as RunnerCapabilities["tools"],
    maxConcurrentJobs: normalizeMaxConcurrentJobs(options.maxConcurrentJobs),
    supportsDryRun: options.supportsDryRun ?? true,
    supportsCancellation: options.supportsCancellation ?? true,
    reportedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  return RunnerCapabilitiesSchema.parse(capabilities);
};

const detectToolCapability = async (
  tool: RunnerCapabilityToolKey,
  options: {
    cwd: string;
    commandRunner: RunnerCapabilityCommandRunner;
    pathResolver: RunnerCapabilityPathResolver;
  },
): Promise<ToolCapability> => {
  let versionResult: CommandExecutionResult;

  try {
    versionResult = await options.commandRunner({
      command: tool,
      args: ["--version"],
      cwd: options.cwd,
      summaryLimit: COMMAND_SUMMARY_LIMIT,
    });
  } catch {
    return { available: false };
  }

  if (versionResult.exitCode !== 0) {
    return { available: false };
  }

  const capability: ToolCapability = { available: true };
  const version = parseSafeVersionToken(
    `${versionResult.stdoutSummary}\n${versionResult.stderrSummary}`,
  );

  if (version !== undefined) {
    capability.version = version;
  }

  const path = await resolveSafeToolPath(tool, options);

  if (path !== undefined) {
    capability.path = path;
  }

  return capability;
};

const resolveSafeToolPath = async (
  tool: RunnerCapabilityToolKey,
  options: {
    cwd: string;
    commandRunner: RunnerCapabilityCommandRunner;
    pathResolver: RunnerCapabilityPathResolver;
  },
): Promise<string | undefined> => {
  try {
    const path = await options.pathResolver(tool, {
      cwd: options.cwd,
      commandRunner: options.commandRunner,
    });

    return sanitizeCapabilityValue(path, { allowPath: true });
  } catch {
    return undefined;
  }
};

const resolveToolPath: RunnerCapabilityPathResolver = async (tool, options) => {
  const result = await options.commandRunner({
    command: process.platform === "win32" ? "where" : "which",
    args: [tool],
    cwd: options.cwd,
    summaryLimit: COMMAND_SUMMARY_LIMIT,
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  return firstNonEmptyLine(`${result.stdoutSummary}\n${result.stderrSummary}`);
};

const parseSafeVersionToken = (value: string): string | undefined => {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (hasUnsafeCapabilityText(trimmed)) {
      return undefined;
    }

    const version = findVersionToken(trimmed);
    const sanitizedVersion = version === undefined ? undefined : sanitizeVersionToken(version);

    if (sanitizedVersion !== undefined) {
      return sanitizedVersion;
    }
  }

  return undefined;
};

const findVersionToken = (value: string): string | undefined =>
  value.match(/\bv?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];

const sanitizeVersionToken = (value: string): string | undefined => {
  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > 64 ||
    hasUnsafeCapabilityText(trimmed) ||
    !/^[0-9A-Za-z._+-]+$/.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
};

const sanitizeCapabilityValue = (
  value: string | undefined,
  options: { allowPath?: boolean } = {},
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = firstNonEmptyLine(value);

  if (
    trimmed === undefined ||
    hasUnsafeCapabilityText(trimmed, { rejectControlCharacters: true })
  ) {
    return undefined;
  }

  const maxLength = options.allowPath === true ? 512 : 128;

  if (trimmed.length > maxLength) {
    return undefined;
  }

  return trimmed;
};

const sanitizeOs = (value: DetectRunnerCapabilitiesOptions["os"]): RunnerCapabilities["os"] => ({
  platform: sanitizeCapabilityValue(value?.platform) ?? UNKNOWN_VALUE,
  release: sanitizeCapabilityValue(value?.release) ?? UNKNOWN_VALUE,
  arch: sanitizeCapabilityValue(value?.arch) ?? UNKNOWN_VALUE,
});

const getLocalOs = (): Required<DetectRunnerCapabilitiesOptions>["os"] => ({
  platform: platform(),
  release: release(),
  arch: arch(),
});

const getLocalShell = (): string =>
  process.env.SHELL ?? process.env.ComSpec ?? process.env.COMSPEC ?? UNKNOWN_VALUE;

const normalizeMaxConcurrentJobs = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_CONCURRENT_JOBS;
  }

  return Math.floor(value);
};

const firstNonEmptyLine = (value: string): string | undefined =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

const hasUnsafeCapabilityText = (
  value: string,
  options: { rejectControlCharacters?: boolean } = {},
): boolean =>
  hasUnsafeCapabilityControlCharacter(value, options) ||
  /(^|\n)diff --git\b/i.test(value) ||
  /(^|\n)\*\*\* Begin Patch\b/i.test(value) ||
  /(^|\n)@@\s+-\d/i.test(value) ||
  /(^|\n)(?:---|\+\+\+) [ab]\//i.test(value) ||
  /```[^\n]*\n/i.test(value) ||
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i.test(value) ||
  /(^|\n)\s*(?:const|let|var)\s+[$A-Z_][\w$]*\s*(?::[^=\n]+)?=/i.test(value) ||
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i.test(value) ||
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i.test(value) ||
  /(?:^|\n)\s*(?:export\s+)?[A-Z_][A-Z0-9_-]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)[A-Z0-9_-]*\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s'";,)]+/iu.test(
    value,
  ) ||
  /\bprocess\.env\.[A-Z_][A-Z0-9_]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)[A-Z0-9_]*\b/iu.test(
    value,
  ) ||
  /\$\{[A-Z_][A-Z0-9_]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)[A-Z0-9_]*\}/iu.test(
    value,
  ) ||
  /\$[A-Z_][A-Z0-9_]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)[A-Z0-9_]*\b/iu.test(
    value,
  ) ||
  /\$env:[A-Z_][A-Z0-9_]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)[A-Z0-9_]*\b/iu.test(
    value,
  ) ||
  /%[A-Z_][A-Z0-9_]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)[A-Z0-9_]*%/iu.test(
    value,
  ) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/i.test(value) ||
  /\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*\b/i.test(
    value,
  ) ||
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/.test(value) ||
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/.test(value) ||
  /\blin_api_[A-Za-z0-9_]{12,}\b/.test(value) ||
  /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value);

const hasUnsafeCapabilityControlCharacter = (
  value: string,
  options: { rejectControlCharacters?: boolean },
): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    if (codePoint === 127) {
      return true;
    }

    if (codePoint < 32) {
      if (options.rejectControlCharacters === true || ![9, 10, 13].includes(codePoint)) {
        return true;
      }
    }
  }

  return false;
};
