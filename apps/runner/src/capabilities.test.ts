import { RunnerCapabilitiesSchema } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import type { CommandExecutionResult, RunCommandOptions } from "./command.js";
import {
  detectRunnerCapabilities,
  RUNNER_CAPABILITY_TOOL_KEYS,
  type DetectRunnerCapabilitiesOptions,
  type RunnerCapabilityPathResolver,
} from "./capabilities.js";
import {
  detectRunnerCapabilities as detectRunnerCapabilitiesFromEntrypoint,
  RUNNER_CAPABILITY_TOOL_KEYS as RUNNER_CAPABILITY_TOOL_KEYS_FROM_ENTRYPOINT,
  type DetectRunnerCapabilitiesOptions as DetectRunnerCapabilitiesOptionsFromEntrypoint,
} from "./index.js";

const FIXED_NOW = new Date("2026-05-20T09:00:00.000Z");
const TEST_OS = {
  platform: "test-platform",
  release: "1.2.3",
  arch: "arm64",
};
const TEST_PROBE_CWD = "/safe/probe-cwd";

const UNSAFE_OUTPUT = [
  "GITHUB_TOKEN=ghp_capabilitysecret1234567890",
  "OPENAI_API_KEY=sk-capability-secret-value",
  "sk-capability-secret-value",
  "raw stdout line that should not be copied",
];

const UNSAFE_CAPABILITY_INPUT = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "const leakedSource = true;",
  "raw stdout: private command output",
  "https://runner:secret@example.test/repo.git",
  "process.env.OPENAI_API_KEY",
  "runner\u0000id",
] as const;

describe("runner capability detection", () => {
  it("returns a deterministic RunnerCapabilities payload that validates against the shared schema", async () => {
    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        maxConcurrentJobs: 3,
        commandRunner: commandRunnerFromVersions({}),
      }),
    );

    expect(capabilities).toMatchObject({
      os: TEST_OS,
      shell: "/bin/test-shell",
      maxConcurrentJobs: 3,
      supportsDryRun: true,
      supportsCancellation: true,
      reportedAt: FIXED_NOW.toISOString(),
    });
    expect(RunnerCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
  });

  it("reports every documented tool key even when tools are unavailable", async () => {
    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner: commandRunnerFromVersions({}),
      }),
    );

    expect(RUNNER_CAPABILITY_TOOL_KEYS).toEqual([
      "git",
      "gh",
      "codex",
      "node",
      "npm",
      "pnpm",
      "yarn",
      "python",
    ]);
    expect(Object.keys(capabilities.tools)).toEqual([...RUNNER_CAPABILITY_TOOL_KEYS]);
    for (const tool of RUNNER_CAPABILITY_TOOL_KEYS) {
      expect(capabilities.tools[tool]).toEqual({ available: false });
    }
  });

  it("parses safe short version tokens from successful version commands instead of copying stdout", async () => {
    const commandRunner = commandRunnerFromVersions({
      git: { stdoutSummary: "git version 2.49.0\nraw stdout line that should not be copied" },
      gh: { stdoutSummary: "gh version 2.72.0 (2026-05-01)\nhttps://github.com/cli/cli" },
      codex: { stdoutSummary: "codex-cli 1.2.3\nextra details" },
      node: { stdoutSummary: "v24.0.0\n" },
      npm: { stdoutSummary: "11.3.0\n" },
      pnpm: { stdoutSummary: "10.11.0\n" },
      yarn: { stdoutSummary: "1.22.22\n" },
      python: { stderrSummary: "Python 3.13.3\n" },
    });

    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        cwd: "/safe/cwd",
        commandRunner,
      }),
    );

    expect(capabilities.tools.git).toMatchObject({ available: true, version: "2.49.0" });
    expect(capabilities.tools.gh).toMatchObject({ available: true, version: "2.72.0" });
    expect(capabilities.tools.codex).toMatchObject({ available: true, version: "1.2.3" });
    expect(capabilities.tools.node).toMatchObject({ available: true, version: "v24.0.0" });
    expect(capabilities.tools.npm).toMatchObject({ available: true, version: "11.3.0" });
    expect(capabilities.tools.pnpm).toMatchObject({ available: true, version: "10.11.0" });
    expect(capabilities.tools.yarn).toMatchObject({ available: true, version: "1.22.22" });
    expect(capabilities.tools.python).toMatchObject({ available: true, version: "3.13.3" });
    expect(JSON.stringify(capabilities)).not.toContain("raw stdout line");
    expect(commandRunner.calls).toEqual(
      RUNNER_CAPABILITY_TOOL_KEYS.map((tool) => ({
        command: tool,
        args: ["--version"],
        cwd: TEST_PROBE_CWD,
        summaryLimit: 512,
      })),
    );
  });

  it("does not run tool version probes inside the target repository", async () => {
    const commandRunner = commandRunnerFromVersions({
      yarn: { stdoutSummary: "1.22.22\n" },
    });

    await detectRunnerCapabilities(
      deterministicOptions({
        cwd: "/customer/repo",
        commandRunner,
      }),
    );

    expect(commandRunner.calls.filter((call) => call.args[0] === "--version")).not.toContainEqual(
      expect.objectContaining({ cwd: "/customer/repo" }),
    );
  });

  it("reports missing tools as unavailable without throwing", async () => {
    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner: commandRunnerFromVersions({
          git: { exitCode: 127 },
          gh: { exitCode: 127 },
          codex: { exitCode: 127 },
          node: { exitCode: 127 },
          npm: { exitCode: 127 },
          pnpm: { exitCode: 127 },
          yarn: { exitCode: 127 },
          python: { exitCode: 127 },
        }),
      }),
    );

    for (const tool of RUNNER_CAPABILITY_TOOL_KEYS) {
      expect(capabilities.tools[tool]).toEqual({ available: false });
    }
    expect(RunnerCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
  });

  it("does not leak token-like version or path output into serialized capabilities", async () => {
    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner: commandRunnerFromVersions({
          git: {
            stdoutSummary: `git version 2.49.0\n${UNSAFE_OUTPUT.join("\n")}`,
          },
          node: {
            stdoutSummary: `v24.0.0 ${UNSAFE_OUTPUT[1]}`,
          },
        }),
        pathResolver: async (tool) =>
          tool === "git" ? `/tmp/${UNSAFE_OUTPUT[0]}/bin/git` : undefined,
      }),
    );

    expect(capabilities.tools.git).toEqual({ available: true, version: "2.49.0" });
    expect(capabilities.tools.node).toEqual({ available: true });
    const serialized = JSON.stringify(capabilities);
    for (const unsafe of UNSAFE_OUTPUT) {
      expect(serialized).not.toContain(unsafe);
    }
    expect(serialized).not.toContain("GITHUB_TOKEN");
    expect(serialized).not.toContain("OPENAI_API_KEY");
  });

  it("does not parse semver-shaped secret values from unsafe-only version output", async () => {
    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner: commandRunnerFromVersions({
          git: {
            stdoutSummary: "GITHUB_TOKEN=2.49.0",
          },
        }),
      }),
    );

    expect(capabilities.tools.git).toEqual({ available: true });
    expect(JSON.stringify(capabilities)).not.toContain("2.49.0");
  });

  it("sanitizes unsafe option and command-derived capability values before schema parsing", async () => {
    const commandRunner = commandRunnerFromVersions({
      git: {
        stdoutSummary: "diff --git a/src/private.ts b/src/private.ts\n2.49.0",
      },
      gh: {
        stdoutSummary: "gh version 2.72.0",
      },
    });

    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner,
        os: {
          arch: "process.env.OPENAI_API_KEY",
          platform: "diff --git a/src/private.ts b/src/private.ts",
          release: "raw stdout: private command output",
        },
        pathResolver: async (tool) =>
          tool === "gh" ? "https://runner:secret@example.test/bin/gh" : undefined,
        runnerId: "const leakedSource = true;",
        shell: "*** Begin Patch\n*** Update File: src/private.ts",
      }),
    );

    expect(capabilities).toMatchObject({
      os: {
        arch: "unknown",
        platform: "unknown",
        release: "unknown",
      },
      shell: "unknown",
    });
    expect(capabilities.runnerId).toBeUndefined();
    expect(capabilities.tools.git).toEqual({ available: true });
    expect(capabilities.tools.gh).toEqual({ available: true, version: "2.72.0" });
    expect(RunnerCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
    const serialized = JSON.stringify(capabilities);
    for (const unsafeValue of UNSAFE_CAPABILITY_INPUT) {
      expect(serialized).not.toContain(unsafeValue);
    }
  });

  it("includes best-effort safe paths and omits paths when resolution fails", async () => {
    const capabilities = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner: commandRunnerFromVersions({
          git: { stdoutSummary: "git version 2.49.0" },
          node: { stdoutSummary: "v24.0.0" },
        }),
        pathResolver: pathResolverFromResults({
          git: "/usr/local/bin/git",
          node: new Error("resolver failed"),
        }),
      }),
    );

    expect(capabilities.tools.git).toEqual({
      available: true,
      version: "2.49.0",
      path: "/usr/local/bin/git",
    });
    expect(capabilities.tools.node).toEqual({
      available: true,
      version: "v24.0.0",
    });
  });

  it("defaults dry-run and cancellation support to true unless configured", async () => {
    const defaults = await detectRunnerCapabilities(
      deterministicOptions({
        commandRunner: commandRunnerFromVersions({}),
      }),
    );
    const configured: DetectRunnerCapabilitiesOptionsFromEntrypoint = deterministicOptions({
      commandRunner: commandRunnerFromVersions({}),
      supportsCancellation: false,
    });

    expect(defaults.supportsDryRun).toBe(true);
    expect(defaults.supportsCancellation).toBe(true);
    await expect(detectRunnerCapabilities(configured)).resolves.toMatchObject({
      supportsDryRun: true,
      supportsCancellation: false,
    });
  });

  it("exports the detector and constants from the runner package entrypoint", () => {
    const options: DetectRunnerCapabilitiesOptionsFromEntrypoint =
      {} satisfies DetectRunnerCapabilitiesOptions;

    expect(options).toEqual({});
    expect(detectRunnerCapabilitiesFromEntrypoint).toBe(detectRunnerCapabilities);
    expect(RUNNER_CAPABILITY_TOOL_KEYS_FROM_ENTRYPOINT).toBe(RUNNER_CAPABILITY_TOOL_KEYS);
  });
});

type ToolKey = (typeof RUNNER_CAPABILITY_TOOL_KEYS)[number];

type VersionResult = {
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
};

type RecordingCommandRunner = {
  (options: RunCommandOptions): Promise<CommandExecutionResult>;
  calls: {
    command: string;
    args: string[];
    cwd: string;
    summaryLimit: number | undefined;
  }[];
};

const deterministicOptions = (
  overrides: Partial<DetectRunnerCapabilitiesOptions> = {},
): DetectRunnerCapabilitiesOptions => ({
  os: TEST_OS,
  shell: "/bin/test-shell",
  now: () => FIXED_NOW,
  pathResolver: async () => undefined,
  probeCwd: TEST_PROBE_CWD,
  ...overrides,
});

const commandRunnerFromVersions = (
  versions: Partial<Record<ToolKey, VersionResult>>,
): RecordingCommandRunner => {
  const calls: RecordingCommandRunner["calls"] = [];
  const runner = (async (options: RunCommandOptions): Promise<CommandExecutionResult> => {
    calls.push({
      command: options.command,
      args: [...(options.args ?? [])],
      cwd: options.cwd,
      summaryLimit: options.summaryLimit,
    });

    const tool = options.command as ToolKey;
    const result = versions[tool] ?? { exitCode: 127 };

    return commandResult(options, {
      exitCode: result.exitCode ?? 0,
      stdoutSummary: result.stdoutSummary ?? "",
      stderrSummary: result.stderrSummary ?? "",
    });
  }) as RecordingCommandRunner;

  runner.calls = calls;
  return runner;
};

const pathResolverFromResults =
  (results: Partial<Record<ToolKey, string | Error>>): RunnerCapabilityPathResolver =>
  async (tool) => {
    const result = results[tool];

    if (result instanceof Error) {
      throw result;
    }

    return result;
  };

const commandResult = (
  options: RunCommandOptions,
  overrides: Pick<CommandExecutionResult, "exitCode" | "stdoutSummary" | "stderrSummary">,
): CommandExecutionResult => ({
  command: {
    executable: options.command,
    args: [...(options.args ?? [])],
  },
  cwd: options.cwd,
  exitCode: overrides.exitCode,
  durationMs: 1,
  stdoutSummary: overrides.stdoutSummary,
  stderrSummary: overrides.stderrSummary,
  redactionApplied: false,
});
