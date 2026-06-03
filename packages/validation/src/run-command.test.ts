import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as validation from "@control-plane/validation";
import type {
  ValidationCommand,
  ValidationExecutionRequest,
  ValidationResult,
} from "@control-plane/validation";

type RunValidationCommandOptions = {
  spawn?: SpawnFactory;
  summaryLimit?: number;
  captureLimit?: number;
  timeoutKillGraceMs?: number;
  detached?: boolean;
};

type SpawnFactory = (command: string, options: unknown) => FakeChildProcess;

type RunValidationCommand = (
  request: ValidationExecutionRequest,
  options?: RunValidationCommandOptions,
) => Promise<ValidationResult>;

const forbiddenResultKeys = [
  "stdout",
  "stderr",
  "rawOutput",
  "diff",
  "patch",
  "source",
  "code",
] as const;

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();

  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("runValidationCommand", () => {
  it("runs a command in the worktree and returns a schema-valid passed result", async () => {
    const worktreePath = await createTempWorktree();
    await writeFile(join(worktreePath, "cwd-marker.txt"), "present\n", "utf8");

    const result = await getRunValidationCommand()({
      runId: "run-072-success",
      worktreePath,
      command: createCommand({
        command: "test -f cwd-marker.txt && printf validation-ok",
      }),
    });

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stdoutSummary).toBe("validation-ok");
    expect(result.stderrSummary).toBe("");
    expectValidTimestamps(result);
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it("returns a failed result with redacted and bounded summaries for nonzero exits", async () => {
    const worktreePath = await createTempWorktree();
    const stdoutSecret = "validation-stdout-secret-12345";
    const stderrSecret = "validation-stderr-secret-12345";
    const stdoutPayload = [
      "failure stdout start",
      `API_TOKEN=${stdoutSecret}`,
      "stdout-tail ".repeat(30),
    ].join("\n");
    const stderrPayload = [
      "failure stderr start",
      `password=${stderrSecret}`,
      "stderr-tail ".repeat(30),
    ].join("\n");

    const result = await getRunValidationCommand()(
      {
        runId: "run-072-failed",
        worktreePath,
        command: createCommand({
          command: [
            `printf %s ${shellSingleQuote(stdoutPayload)}`,
            `printf %s ${shellSingleQuote(stderrPayload)} >&2`,
            "exit 7",
          ].join("; "),
        }),
      },
      { summaryLimit: 120 },
    );

    const serializedResult = JSON.stringify(result);

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(7);
    expect(result.stdoutSummary.length).toBeLessThanOrEqual(120);
    expect(result.stderrSummary.length).toBeLessThanOrEqual(120);
    expect(result.stdoutSummary).toContain("[REDACTED_SECRET]");
    expect(result.stderrSummary).toContain("[REDACTED_SECRET]");
    expect(result.redactionApplied).toBe(true);
    expect(serializedResult).not.toContain(stdoutSecret);
    expect(serializedResult).not.toContain(stderrSecret);
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it("suppresses diff, patch, and source-like output before returning summaries", async () => {
    const worktreePath = await createTempWorktree();
    const stdoutPayload = [
      "diff --git a/src/app.ts b/src/app.ts",
      "@@ -1 +1 @@",
      "+const leakedSource = 'do not serialize';",
    ].join("\n");
    const stderrPayload = [
      "```ts",
      "function shouldNotLeak() {",
      "  return 'source-like output';",
      "}",
      "```",
    ].join("\n");

    const result = await getRunValidationCommand()({
      runId: "run-072-source-like-output",
      worktreePath,
      command: createCommand({
        command: [
          `printf %s ${shellSingleQuote(stdoutPayload)}`,
          `printf %s ${shellSingleQuote(stderrPayload)} >&2`,
          "exit 1",
        ].join("; "),
      }),
    });

    const serializedResult = JSON.stringify(result);

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.stdoutSummary).toBe(
      "Validation output suppressed because it resembled source, diff, or patch.",
    );
    expect(result.stderrSummary).toBe(
      "Validation output suppressed because it resembled source, diff, or patch.",
    );
    expect(result.redactionApplied).toBe(true);
    expect(serializedResult).not.toContain("diff --git");
    expect(serializedResult).not.toContain("@@ -1 +1 @@");
    expect(serializedResult).not.toContain("leakedSource");
    expect(serializedResult).not.toContain("shouldNotLeak");
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it.each([
    {
      label: "code frame",
      stdoutPayload: [
        "src/example.ts:12:7",
        '12 | const leakedSource = "do-not-send";',
        "   |       ^",
      ].join("\n"),
      unsafeFragments: ["leakedSource", "do-not-send"],
    },
    {
      label: "YAML config snippet",
      stdoutPayload: ["Config preview:", "services:", "  web:", "    image: app:latest"].join("\n"),
      unsafeFragments: ["services:", "web:", "image: app"],
    },
  ])(
    "suppresses $label output before returning summaries",
    async ({ stdoutPayload, unsafeFragments }) => {
      const worktreePath = await createTempWorktree();

      const result = await getRunValidationCommand()({
        runId: "run-072-source-like-regression",
        worktreePath,
        command: createCommand({
          command: [`printf %s ${shellSingleQuote(stdoutPayload)}`, "exit 1"].join("; "),
        }),
      });

      const serializedResult = JSON.stringify(result);

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(1);
      expect(result.stdoutSummary).toBe(
        "Validation output suppressed because it resembled source, diff, or patch.",
      );
      expect(result.redactionApplied).toBe(true);
      for (const fragment of unsafeFragments) {
        expect(serializedResult).not.toContain(fragment);
      }
      expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
      expectNoForbiddenResultFields(result);
    },
  );

  it("suppresses assignment-shaped source snippets before returning summaries", async () => {
    const worktreePath = await createTempWorktree();
    const stdoutPayload = [
      "module.exports = { handler: loadHandler }",
      "exports.handler = async () => runTask()",
      "settings.DEBUG = true",
      "featureFlag = true",
    ].join("\n");

    const result = await getRunValidationCommand()({
      runId: "run-072-assignment-snippets",
      worktreePath,
      command: createCommand({
        command: [`printf %s ${shellSingleQuote(stdoutPayload)}`, "exit 1"].join("; "),
      }),
    });

    const serializedResult = JSON.stringify(result);

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.stdoutSummary).toBe(
      "Validation output suppressed because it resembled source, diff, or patch.",
    );
    expect(result.redactionApplied).toBe(true);
    expect(serializedResult).not.toContain("module.exports");
    expect(serializedResult).not.toContain("exports.handler");
    expect(serializedResult).not.toContain("settings.DEBUG");
    expect(serializedResult).not.toContain("featureFlag");
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it("kills a timed-out command and returns a safe failed result", async () => {
    vi.useFakeTimers();

    const worktreePath = await createTempWorktree();
    const child = createFakeChildProcess({ closeOnKill: true });
    const spawn = vi.fn<SpawnFactory>(() => child);

    const execution = getRunValidationCommand()(
      {
        runId: "run-072-timeout",
        worktreePath,
        command: createCommand({
          command: "sleep 10",
          timeoutSeconds: 1,
        }),
      },
      { detached: false, spawn, timeoutKillGraceMs: 25 },
    );

    await vi.advanceTimersByTimeAsync(1_001);
    const result = await execution;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("Validation command timed out.");
    expect(result.redactionApplied).toBe(true);
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it("returns a schema-valid skipped result without spawning", async () => {
    const worktreePath = await createTempWorktree();
    const spawn = vi.fn<SpawnFactory>(() => createFakeChildProcess());

    const result = await getRunValidationCommand()(
      {
        runId: "run-072-skipped",
        worktreePath,
        command: createCommand(),
        skip: true,
      },
      { spawn },
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.exitCode).toBeNull();
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("");
    expect(result.durationMs).toBe(0);
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it("resolves command cwd relative to the worktree", async () => {
    const worktreePath = await createTempWorktree();
    const packagePath = join(worktreePath, "packages", "app");
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, "scoped-marker.txt"), "present\n", "utf8");

    const result = await getRunValidationCommand()({
      runId: "run-072-relative-cwd",
      worktreePath,
      command: createCommand({
        command: "test -f scoped-marker.txt && printf scoped-ok",
        cwd: "packages/app",
      }),
    });

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.stdoutSummary).toBe("scoped-ok");
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it.each([
    { label: "traversal", cwd: "../outside" },
    { label: "absolute outside path", cwd: "__ABSOLUTE_OUTSIDE__" },
  ])("fails safely without spawning when cwd escapes by $label", async ({ cwd }) => {
    const worktreePath = await createTempWorktree();
    const outsidePath = await createTempWorktree();
    const spawn = vi.fn<SpawnFactory>(() => {
      const child = createFakeChildProcess();
      child.stdout.write("raw output that must not appear");
      return child;
    });

    const result = await getRunValidationCommand()(
      {
        runId: "run-072-outside-cwd",
        worktreePath,
        command: createCommand({
          command: "printf safe",
          cwd: cwd === "__ABSOLUTE_OUTSIDE__" ? outsidePath : cwd,
        }),
      },
      { spawn },
    );

    const serializedResult = JSON.stringify(result);

    expect(spawn).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("Validation command cwd is outside the worktree.");
    expect(result.stderrSummary).not.toContain(worktreePath);
    expect(result.stderrSummary).not.toContain(outsidePath);
    expect(serializedResult).not.toContain(resolve(worktreePath));
    expect(serializedResult).not.toContain(resolve(outsidePath));
    expect(serializedResult).not.toContain("raw output that must not appear");
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });

  it("fails safely without spawning when relative cwd escapes through a symlink", async () => {
    const worktreePath = await createTempWorktree();
    const outsidePath = await createTempWorktree();
    await symlink(outsidePath, join(worktreePath, "linked-outside"), "dir");
    const spawn = vi.fn<SpawnFactory>(() => createFakeChildProcess());

    const result = await getRunValidationCommand()(
      {
        runId: "run-072-symlink-cwd",
        worktreePath,
        command: createCommand({
          command: "printf safe",
          cwd: "linked-outside",
        }),
      },
      { spawn },
    );

    const serializedResult = JSON.stringify(result);

    expect(spawn).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("Validation command cwd is outside the worktree.");
    expect(serializedResult).not.toContain(resolve(worktreePath));
    expect(serializedResult).not.toContain(resolve(outsidePath));
    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
    expectNoForbiddenResultFields(result);
  });
});

const getRunValidationCommand = (): RunValidationCommand => {
  const candidate = (validation as { runValidationCommand?: unknown }).runValidationCommand;

  expect(candidate).toBeTypeOf("function");

  return candidate as RunValidationCommand;
};

const createTempWorktree = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "aicp-validation-"));
  tempDirs.push(directory);

  return directory;
};

const createCommand = (overrides: Partial<ValidationCommand> = {}): ValidationCommand => ({
  id: "unit",
  label: "Unit validation",
  command: "printf validation-ok",
  timeoutSeconds: 5,
  required: true,
  ...overrides,
});

const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const expectValidTimestamps = (result: ValidationResult): void => {
  const startedAt = Date.parse(result.startedAt);
  const finishedAt = Date.parse(result.finishedAt);

  expect(Number.isNaN(startedAt)).toBe(false);
  expect(Number.isNaN(finishedAt)).toBe(false);
  expect(finishedAt).toBeGreaterThanOrEqual(startedAt);
};

const expectNoForbiddenResultFields = (result: ValidationResult): void => {
  for (const key of forbiddenResultKeys) {
    expect(result).not.toHaveProperty(key);
  }
};

type FakeChildProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals | number) => boolean>>;
  pid?: number;
  emitClose(exitCode: number | null, signal?: NodeJS.Signals | null): void;
};

const createFakeChildProcess = (options: { closeOnKill?: boolean } = {}): FakeChildProcess => {
  const child = new EventEmitter() as FakeChildProcess;

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.emitClose = (exitCode: number | null, signal: NodeJS.Signals | null = null): void => {
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
