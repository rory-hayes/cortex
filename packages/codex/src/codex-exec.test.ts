import { once } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createCodexExecAdapter } from "./codex-exec.js";

const WORKTREE_PATH = "/tmp/aicp/run_058";
const PROMPT = "PROMPT_SENTINEL local implementation instructions";
const PROMPT_WITH_DETAILS = [
  "Task Objective: implement PROMPT_OBJECTIVE_SENTINEL adapter behavior",
  "Acceptance Criteria:",
  "- preserve PROMPT_ACCEPTANCE_SENTINEL validation behavior",
  "Context Files:",
  "- /tmp/aicp/PROMPT_PATH_SENTINEL.ts",
  "Validation Commands:",
  "- pnpm PROMPT_COMMAND_SENTINEL test",
].join("\n");

const SECRET_OUTPUT = [
  "OPENAI_API_KEY=sk-test-openai-secret",
  "github_pat_1234567890ABCDEFGH",
  "GITHUB_TOKEN=ghp_testgithubsecret1234567890",
  'password="correct-horse-battery-staple"',
  "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
  "https://user:credential@example.com/private.git",
];

const ENV_SECRET_OUTPUT = [
  "DATABASE_URL=postgres://user:db-password@example.com/app",
  "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
  "SESSION_JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sentinelSignatureValue",
];

describe("createCodexExecAdapter", () => {
  it("spawns codex exec with direct argv, worktree cwd, shell disabled, and prompt over stdin", async () => {
    const { adapter, child, spawns } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toEqual({
      command: "codex",
      args: ["exec", "--cd", WORKTREE_PATH, "--color", "never", "-"],
      options: {
        cwd: WORKTREE_PATH,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    });
    expect(spawns[0]?.args).not.toContain(PROMPT);
    expect(child.stdinText()).toBe(PROMPT);

    child.emitClose(0);

    await expect(execution).resolves.toMatchObject({
      status: "succeeded",
      exitCode: 0,
    });
  });

  it("maps exit code 0 to succeeded", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stdout.write("Codex completed local changes.");
    child.emitClose(0);

    const result = await execution;

    expect(result.status).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    expect(result.stdoutSummary).toBe("Codex completed local changes.");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("maps nonzero exits to failed with the exit code", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stderr.write("Codex exited with validation feedback.");
    child.emitClose(7);

    const result = await execution;

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(7);
    expect(result.stderrSummary).toBe("Codex exited with validation feedback.");
  });

  it("returns a safe failed result when the executable cannot start", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.emit(
      "error",
      Object.assign(new Error("spawn ENOENT with GITHUB_TOKEN=ghp_rawsecret1234567890"), {
        code: "ENOENT",
      }),
    );

    const result = await execution;

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(127);
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("Codex failed to start: executable_not_found.");
    expect(result.redactionApplied).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ghp_rawsecret1234567890");
  });

  it("returns a safe failed result when stdin fails asynchronously", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    child.stdin.emit(
      "error",
      Object.assign(new Error("write EPIPE with GITHUB_TOKEN=ghp_rawsecret1234567890"), {
        code: "EPIPE",
      }),
    );

    const result = await execution;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("Codex failed to start: stdin_unavailable.");
    expect(result.redactionApplied).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ghp_rawsecret1234567890");
  });

  it("kills the child process and returns timed_out when timeoutMs elapses", async () => {
    vi.useFakeTimers();

    try {
      const { adapter, child } = createAdapterHarness({ closeOnKill: true });

      const execution = adapter.execute(createRequest({ timeoutMs: 10 }));
      await once(child.stdin, "finish");
      await vi.advanceTimersByTimeAsync(11);

      const result = await execution;

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(result.status).toBe("timed_out");
      expect(result.exitCode).toBeNull();
      expect(result.stderrSummary).toBe("Codex execution timed out.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts secrets from stdout and stderr summaries", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stdout.write(SECRET_OUTPUT.join("\n"));
    child.stderr.write(SECRET_OUTPUT.join("\n"));
    child.emitClose(0);

    const result = await execution;
    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    expect(result.stdoutSummary).toContain("[REDACTED_SECRET]");
    expect(result.stdoutSummary).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.stdoutSummary).toContain("[REDACTED_CREDENTIAL_URL]");
    expect(result.stderrSummary).toContain("[REDACTED_SECRET]");
    expect(result.stderrSummary).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.stderrSummary).toContain("[REDACTED_CREDENTIAL_URL]");

    for (const unsafeValue of SECRET_OUTPUT) {
      expect(serializedResult).not.toContain(unsafeValue);
    }
  });

  it("suppresses prompt fragments even when the full prompt is not echoed", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest({ prompt: PROMPT_WITH_DETAILS }));
    await once(child.stdin, "finish");

    child.stdout.write(
      [
        "Started task: implement PROMPT_OBJECTIVE_SENTINEL adapter behavior",
        "Using /tmp/aicp/PROMPT_PATH_SENTINEL.ts",
        "Next command: pnpm PROMPT_COMMAND_SENTINEL test",
      ].join("\n"),
    );
    child.emitClose(0);

    const result = await execution;
    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    expect(result.stdoutSummary).toBe("[REDACTED_PROMPT_OUTPUT]");
    expect(serializedResult).not.toContain("PROMPT_OBJECTIVE_SENTINEL");
    expect(serializedResult).not.toContain("PROMPT_PATH_SENTINEL");
    expect(serializedResult).not.toContain("PROMPT_COMMAND_SENTINEL");
  });

  it("suppresses plain source-like snippets without diff markers", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stdout.write(
      [
        "Codex reported this file excerpt:",
        "function updateConfig() {",
        "  const token = 'SOURCE_SNIPPET_SENTINEL';",
        "  return token;",
        "}",
      ].join("\n"),
    );
    child.emitClose(0);

    const result = await execution;
    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    expect(result.stdoutSummary).toBe("[REDACTED_SOURCE_LIKE_OUTPUT]");
    expect(serializedResult).not.toContain("SOURCE_SNIPPET_SENTINEL");
    expect(serializedResult).not.toContain("function updateConfig");
    expect(serializedResult).not.toContain("const token");
  });

  it.each([
    {
      label: "python",
      output: ["Codex reported this file excerpt:", "def run():", "    return value"].join("\n"),
      unsafeFragments: ["def run()", "return value"],
    },
    {
      label: "sql",
      output: ["Query preview:", "SELECT id, email FROM users WHERE active = true;"].join("\n"),
      unsafeFragments: ["SELECT id", "FROM users"],
    },
    {
      label: "yaml",
      output: ["Config preview:", "services:", "  web:", "    image: app:latest"].join("\n"),
      unsafeFragments: ["services:", "image: app"],
    },
    {
      label: "html",
      output: ["Rendered snippet:", '<main data-secret="SOURCE_SNIPPET_SENTINEL">'].join("\n"),
      unsafeFragments: ["<main", "SOURCE_SNIPPET_SENTINEL"],
    },
    {
      label: "standalone return statement",
      output: ["Partial line:", "return value;"].join("\n"),
      unsafeFragments: ["return value"],
    },
  ])("suppresses non-JS source-like output: $label", async ({ output, unsafeFragments }) => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stdout.write(output);
    child.emitClose(0);

    const result = await execution;
    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    expect(result.stdoutSummary).toBe("[REDACTED_SOURCE_LIKE_OUTPUT]");

    for (const unsafeFragment of unsafeFragments) {
      expect(serializedResult).not.toContain(unsafeFragment);
    }
  });

  it("redacts dotenv-style assignments, access keys, and JWT-like tokens from summaries", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stdout.write(ENV_SECRET_OUTPUT.join("\n"));
    child.emitClose(0);

    const result = await execution;
    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    expect(result.stdoutSummary).toContain("[REDACTED_SECRET]");

    for (const unsafeValue of ENV_SECRET_OUTPUT) {
      expect(serializedResult).not.toContain(unsafeValue);
    }

    expect(serializedResult).not.toContain("DATABASE_URL");
    expect(serializedResult).not.toContain("AWS_ACCESS_KEY_ID");
    expect(serializedResult).not.toContain("SESSION_JWT");
    expect(serializedResult).not.toContain("AKIA1234567890ABCDEF");
    expect(serializedResult).not.toContain("eyJhbGciOiJIUzI1Ni");
  });

  it("does not expose raw streams, prompt text, command blobs, diffs, patches, or source-like payloads", async () => {
    const { adapter, child } = createAdapterHarness();

    const execution = adapter.execute(createRequest());
    await once(child.stdin, "finish");

    child.stdout.write(
      [
        PROMPT,
        "diff --git a/src/secret.ts b/src/secret.ts",
        "*** Begin Patch",
        "+const SOURCE_SENTINEL = 'must not leak';",
      ].join("\n"),
    );
    child.stderr.write("@@ -1 +1 @@\nPATCH_SENTINEL");
    child.emitClose(1);

    const result = await execution;
    const serializedResult = JSON.stringify(result);

    expect(Object.keys(result).sort()).toEqual(
      [
        "durationMs",
        "exitCode",
        "redactionApplied",
        "status",
        "stderrSummary",
        "stdoutSummary",
      ].sort(),
    );
    expect("stdout" in result).toBe(false);
    expect("stderr" in result).toBe(false);
    expect("prompt" in result).toBe(false);
    expect("command" in result).toBe(false);
    expect(serializedResult).not.toContain(PROMPT);
    expect(serializedResult).not.toContain("diff --git");
    expect(serializedResult).not.toContain("*** Begin Patch");
    expect(serializedResult).not.toContain("SOURCE_SENTINEL");
    expect(serializedResult).not.toContain("PATCH_SENTINEL");
    expect(serializedResult).toContain("[REDACTED_SOURCE_LIKE_OUTPUT]");
  });

  it("waits for child process closure after timeout and escalates if needed", async () => {
    vi.useFakeTimers();

    try {
      const { adapter, child } = createAdapterHarness({
        adapterOptions: { timeoutKillGraceMs: 25 },
      });

      const execution = adapter.execute(createRequest({ timeoutMs: 10 }));
      let settled = false;
      void execution.then(() => {
        settled = true;
      });

      await once(child.stdin, "finish");
      await vi.advanceTimersByTimeAsync(11);
      await Promise.resolve();

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(25);
      await Promise.resolve();

      expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
      expect(settled).toBe(false);

      child.emitClose(null, "SIGKILL");

      const result = await execution;

      expect(result.status).toBe("timed_out");
      expect(result.exitCode).toBeNull();
      expect(result.stderrSummary).toBe("Codex execution timed out.");
    } finally {
      vi.useRealTimers();
    }
  });
});

const createRequest = (
  overrides: Partial<Parameters<ReturnType<typeof createCodexExecAdapter>["execute"]>[0]> = {},
): Parameters<ReturnType<typeof createCodexExecAdapter>["execute"]>[0] => ({
  runId: "run_058",
  worktreePath: WORKTREE_PATH,
  prompt: PROMPT,
  timeoutMs: 5_000,
  ...overrides,
});

type CapturedSpawn = {
  command: string;
  args: string[];
  options: {
    cwd?: string;
    shell?: boolean;
    stdio?: unknown;
  };
};

type AdapterHarness = {
  adapter: ReturnType<typeof createCodexExecAdapter>;
  child: FakeChildProcess;
  spawns: CapturedSpawn[];
};

type AdapterHarnessOptions = {
  closeOnKill?: boolean;
  adapterOptions?: Omit<NonNullable<Parameters<typeof createCodexExecAdapter>[0]>, "spawn">;
};

const createAdapterHarness = (options: AdapterHarnessOptions = {}): AdapterHarness => {
  const child = createFakeChildProcess(options);
  const spawns: CapturedSpawn[] = [];

  const spawn = vi.fn((command: string, args: readonly string[], spawnOptions: unknown) => {
    spawns.push({
      command,
      args: [...args],
      options: spawnOptions as CapturedSpawn["options"],
    });

    return child as never;
  });

  return {
    adapter: createCodexExecAdapter({ ...options.adapterOptions, spawn }),
    child,
    spawns,
  };
};

type FakeChildProcess = NodeJS.EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals | number) => boolean>>;
  emitClose(exitCode: number | null, signal?: NodeJS.Signals | null): void;
  stdinText(): string;
};

const createFakeChildProcess = (options: AdapterHarnessOptions): FakeChildProcess => {
  const child = new PassThrough() as unknown as FakeChildProcess;
  const stdin = new PassThrough();
  const stdinChunks: string[] = [];

  child.stdin = stdin;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  child.stdin.on("data", (chunk: Buffer | string) => {
    stdinChunks.push(String(chunk));
  });

  child.stdinText = () => stdinChunks.join("");
  child.emitClose = (exitCode: number | null, signal: NodeJS.Signals | null = null) => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", exitCode, signal);
  };
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    if (options.closeOnKill === true) {
      queueMicrotask(() => {
        child.emitClose(null, typeof signal === "string" ? signal : null);
      });
    }

    return true;
  });

  return child;
};
