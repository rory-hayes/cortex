import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  type DryRunCheckResult,
  type DryRunResult,
  type RunnerCapabilities,
} from "@control-plane/shared";
import { describe, expect, it, vi } from "vitest";

import { getRunnerCliHelp, parseRunnerCliArgs, runCli, type RunnerCliStreams } from "./cli.js";
import { RunnerError } from "./errors.js";
import type { RunnerLinkSafeSummary } from "./link.js";

const createStreams = (): RunnerCliStreams & {
  stdoutText: () => string;
  stderrText: () => string;
} => {
  let stdout = "";
  let stderr = "";

  return {
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr += chunk;
      },
    },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  };
};

describe("runner CLI", () => {
  it("prints global help for --help and exits 0", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["--help"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toContain("Usage: control-plane-runner <command>");
    expect(streams.stdoutText()).toContain("Commands:");
    expect(streams.stdoutText()).toContain("run");
    expect(streams.stdoutText()).toContain("link");
    expect(streams.stdoutText()).toContain("repos");
    expect(streams.stderrText()).toBe("");
  });

  it("prints global help for -h and exits 0", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["-h"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toBe(getRunnerCliHelp());
    expect(streams.stderrText()).toBe("");
  });

  it("prints link command help and exits 0", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["link", "--help"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toContain(
      "Usage: control-plane-runner link --code <pairing-code> --base-url <api-base-url>",
    );
    expect(streams.stdoutText()).toContain("--code <pairing-code>");
    expect(streams.stdoutText()).toContain("--base-url <api-base-url>");
    expect(streams.stderrText()).toBe("");
  });

  it("prints repos command help and exits 0", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["repos", "--help"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toContain("Usage: control-plane-runner repos <command>");
    expect(streams.stdoutText()).toContain("add");
    expect(streams.stderrText()).toBe("");
  });

  it("prints repos add command help and exits 0", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["repos", "add", "--help"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toContain("Usage: control-plane-runner repos add --path <repo>");
    expect(streams.stdoutText()).toContain("--path <repo>");
    expect(streams.stderrText()).toBe("");
  });

  it("accepts the package-script argument separator before global help", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["--", "--help"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toBe(getRunnerCliHelp());
    expect(streams.stderrText()).toBe("");
  });

  it("prints run command help and exits 0", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["run", "--help"], streams);

    expect(exitCode).toBe(0);
    expect(streams.stdoutText()).toContain(
      "Usage: control-plane-runner run --repo <path> --task <path> --dry-run",
    );
    expect(streams.stdoutText()).toContain("--events-out <path>");
    expect(streams.stdoutText()).toContain("--config <path>");
    expect(streams.stderrText()).toBe("");
  });

  it("rejects a missing command with exit code 2", async () => {
    const streams = createStreams();

    const exitCode = await runCli([], streams);

    expect(exitCode).toBe(2);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toContain("Missing command.");
    expect(streams.stderrText()).toContain("Usage: control-plane-runner <command>");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["status"], streams);

    expect(exitCode).toBe(2);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toContain("Unknown command: status.");
  });

  it("rejects repos without a subcommand with exit code 2", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["repos"], streams);

    expect(exitCode).toBe(2);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toContain("Missing repos command.");
    expect(streams.stderrText()).toContain("Usage: control-plane-runner repos <command>");
  });

  it("rejects unknown repos subcommands with exit code 2", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["repos", "sync"], streams);

    expect(exitCode).toBe(2);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toContain("Unknown repos command: sync.");
    expect(streams.stderrText()).toContain("Usage: control-plane-runner repos <command>");
  });

  it("rejects run --dry-run when --repo and --task are missing", () => {
    const result = parseRunnerCliArgs(["run", "--dry-run"]);

    expect(result).toEqual({
      type: "error",
      exitCode: 2,
      message: "Missing required options: --repo, --task.",
      help: expect.stringContaining("Usage: control-plane-runner run"),
    });
  });

  it("rejects link when required flags are missing", () => {
    const result = parseRunnerCliArgs(["link", "--code", "PAIR-123"]);

    expect(result).toEqual({
      type: "error",
      exitCode: 2,
      message: "Missing required options: --base-url.",
      help: expect.stringContaining("Usage: control-plane-runner link"),
    });
  });

  it("rejects repos add when --path is missing", async () => {
    const streams = createStreams();

    const exitCode = await runCli(["repos", "add"], streams);

    expect(exitCode).toBe(2);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toContain("Missing required options: --path.");
    expect(streams.stderrText()).toContain("Usage: control-plane-runner repos add");
  });

  it("rejects malformed link arguments without echoing positional pairing codes", async () => {
    const streams = createStreams();
    const pairingCode = "PAIR-CODE-MUST-NOT-PRINT";

    const exitCode = await runCli(
      ["link", pairingCode, "--base-url", "http://localhost:3000/api"],
      streams,
    );

    expect(exitCode).toBe(2);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toContain("Invalid link command options.");
    expect(streams.stderrText()).not.toContain(pairingCode);
  });

  it("parses a valid link command without contacting the web app", () => {
    const result = parseRunnerCliArgs([
      "link",
      "--code",
      "PAIR-123",
      "--base-url",
      "http://localhost:3000/api",
    ]);

    expect(result).toEqual({
      type: "link",
      options: {
        baseUrl: "http://localhost:3000/api",
        code: "PAIR-123",
      },
    });
  });

  it("parses a valid repos add command without reading or validating paths", () => {
    const result = parseRunnerCliArgs(["repos", "add", "--path", "/repos/control-plane"]);

    expect(result).toEqual({
      type: "reposAdd",
      options: {
        path: "/repos/control-plane",
      },
    });
  });

  it("rejects missing flag values safely", () => {
    const result = parseRunnerCliArgs(["run", "--repo", "--task", "task.json", "--dry-run"]);

    expect(result).toEqual({
      type: "error",
      exitCode: 2,
      message: "Missing value for --repo.",
      help: expect.stringContaining("Usage: control-plane-runner run"),
    });
  });

  it("parses a valid dry-run command with events output without reading or validating paths", () => {
    const result = parseRunnerCliArgs([
      "run",
      "--repo",
      "/does/not/exist",
      "--task",
      "/also/missing/task.json",
      "--dry-run",
      "--events-out",
      "/tmp/events.ndjson",
    ]);

    expect(result).toEqual({
      type: "run",
      options: {
        command: "run",
        repo: "/does/not/exist",
        task: "/also/missing/task.json",
        dryRun: true,
        eventsOut: "/tmp/events.ndjson",
      },
    });
  });

  it("parses a valid dry-run command with a runner config path", () => {
    const result = parseRunnerCliArgs([
      "run",
      "--repo",
      "/repo",
      "--task",
      "/task.json",
      "--dry-run",
      "--config",
      "/runner-config.json",
    ]);

    expect(result).toEqual({
      type: "run",
      options: {
        command: "run",
        repo: "/repo",
        task: "/task.json",
        dryRun: true,
        configPath: "/runner-config.json",
      },
    });
  });

  it("calls the runner flow, prints the dry-run result, and returns its exit code", async () => {
    const streams = createStreams();
    const readinessResult = dryRunResult({
      runId: "run-cli-test",
      status: "warning",
    });
    const runRunner = vi.fn(async () => ({
      exitCode: 7,
      runId: "run-cli-test",
      eventsOut: "/tmp/events.jsonl",
      dryRunResult: readinessResult,
    }));

    const exitCode = await runCli(
      [
        "run",
        "--repo",
        "/repo",
        "--task",
        "/task.json",
        "--dry-run",
        "--config",
        "/runner-config.json",
      ],
      streams,
      { runRunner },
    );

    expect(exitCode).toBe(7);
    expect(runRunner).toHaveBeenCalledWith({
      command: "run",
      repo: "/repo",
      task: "/task.json",
      dryRun: true,
      configPath: "/runner-config.json",
    });
    expect(streams.stdoutText()).toBe(`${JSON.stringify(readinessResult)}\n`);
    expect(streams.stderrText()).not.toContain("raw-task-body");
    expect(streams.stderrText()).not.toContain("raw-config-body");
  });

  it("calls the link flow and prints only safe linked-runner metadata", async () => {
    const streams = createStreams();
    const safeSummary = linkSummary();
    const linkRunner = vi.fn(async () => safeSummary);

    const exitCode = await runCli(
      ["link", "--code", "PAIR-CODE-MUST-NOT-PRINT", "--base-url", "http://localhost:3000/api"],
      streams,
      { linkRunner },
    );

    expect(exitCode).toBe(0);
    expect(linkRunner).toHaveBeenCalledWith({
      baseUrl: "http://localhost:3000/api",
      code: "PAIR-CODE-MUST-NOT-PRINT",
    });
    expect(JSON.parse(streams.stdoutText())).toEqual(safeSummary);
    expect(streams.stdoutText()).not.toContain("PAIR-CODE-MUST-NOT-PRINT");
    expect(streams.stdoutText()).not.toContain("runner-credential-secret");
    expect(streams.stderrText()).not.toContain("PAIR-CODE-MUST-NOT-PRINT");
    expect(streams.stderrText()).not.toContain("runner-credential-secret");
  });

  it("calls the repos add flow and prints only safe mapping metadata", async () => {
    const streams = createStreams();
    const mappingResult = repoMappingResult();
    const reposAdd = vi.fn(async () => mappingResult);

    const exitCode = await runCli(["repos", "add", "--path", "/repos/control-plane"], streams, {
      reposAdd,
    });

    expect(exitCode).toBe(0);
    expect(reposAdd).toHaveBeenCalledWith({
      path: "/repos/control-plane",
    });
    expect(JSON.parse(streams.stdoutText())).toEqual(mappingResult);
    expect(streams.stdoutText()).not.toContain("runner-credential-secret");
    expect(streams.stdoutText()).not.toContain("raw repo file contents");
    expect(streams.stdoutText()).not.toMatch(/source|diff|patch|snippet|dependencyGraph/i);
    expect(streams.stderrText()).toBe("");
  });

  it("writes only safe error summaries to stderr when the runner fails before producing a result", async () => {
    const streams = createStreams();
    const runRunner = vi.fn(async () => {
      throw new RunnerError({
        category: "task_packet",
        userSafeMessage: "Task packet could not be loaded or validated.",
        metadata: {
          rawStdout: "raw stdout MUST NOT LEAK",
          rawStderr: "raw stderr MUST NOT LEAK",
        },
      });
    });

    const exitCode = await runCli(
      ["run", "--repo", "/repo", "--task", "/task.json", "--dry-run"],
      streams,
      { runRunner },
    );

    expect(exitCode).toBe(3);
    expect(streams.stdoutText()).toBe("");
    expect(streams.stderrText()).toBe("Task packet could not be loaded or validated.\n");
    expect(streams.stderrText()).not.toContain("raw stdout");
    expect(streams.stderrText()).not.toContain("raw stderr");
  });
});

const linkSummary = (): RunnerLinkSafeSummary => ({
  contractVersion: CONTRACT_VERSION,
  credentialStored: true,
  linkedAt: "2026-05-22T13:01:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "http://localhost:3000/api",
  runnerId: "runner_1",
  storedAt: "2026-05-22T13:02:00.000Z",
  workspaceId: "workspace_1",
});

const repoMappingResult = () => ({
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/repos/control-plane",
  provider: "github",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
});

const dryRunResult = (
  overrides: Partial<Omit<DryRunResult, "contractVersion" | "capabilities" | "createdAt">> & {
    capabilities?: RunnerCapabilities;
    createdAt?: string;
  } = {},
): DryRunResult => ({
  contractVersion: CONTRACT_VERSION,
  id: `dry-run:${overrides.runId ?? "run-cli-test"}`,
  runId: "run-cli-test",
  status: "passed",
  checks: DRY_RUN_CHECKS.map(
    (id): DryRunCheckResult => ({
      id,
      label: id,
      status: "passed",
      message: `${id} passed.`,
      metadata: {},
    }),
  ),
  capabilities: runnerCapabilities(),
  blockers: [],
  warnings: [],
  createdAt: "2026-05-20T08:00:00.000Z",
  ...overrides,
});

const runnerCapabilities = (): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-local",
  os: {
    platform: "darwin",
    release: "25.0.0",
    arch: "arm64",
  },
  shell: "/bin/zsh",
  tools: {
    git: { available: true, version: "2.49.0" },
    gh: { available: true, version: "2.72.0" },
    codex: { available: true, version: "1.2.3" },
    node: { available: true, version: "24.0.0" },
    npm: { available: false },
    pnpm: { available: true, version: "9.15.9" },
    yarn: { available: false },
    python: { available: false },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: false,
  reportedAt: "2026-05-20T08:00:00.000Z",
});
