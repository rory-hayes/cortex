import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as validation from "@control-plane/validation";
import type {
  ValidationAdapter,
  ValidationCommand,
  ValidationExecutionRequest,
  ValidationResult,
} from "@control-plane/validation";

const forbiddenAggregateKeys = [
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
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("runValidationSuite", () => {
  it("blocks on a required failure and skips later commands in configured order", async () => {
    const commands = [
      createCommand({ id: "required-fail", label: "Required fail", required: true }),
      createCommand({ id: "required-pass", label: "Required pass", required: true }),
      createCommand({ id: "optional-pass", label: "Optional pass", required: false }),
    ];
    const calls: ValidationExecutionRequest[] = [];
    const adapter = createFakeAdapter(
      {
        "required-fail": "failed",
        "required-pass": "passed",
        "optional-pass": "passed",
      },
      calls,
    );

    const result = await validation.runValidationSuite(
      {
        runId: "run-073-required-failure",
        worktreePath: "/tmp/aicp/run-073-required-failure",
        commands,
      },
      { adapter },
    );

    expect(result.status).toBe("failed");
    expect(result.shouldBlockCommit).toBe(true);
    expect(result.blockers).toEqual([
      {
        commandId: "required-fail",
        commandLabel: "Required fail",
        status: "failed",
        message: "Required validation command failed.",
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.results.map((suiteResult) => suiteResult.commandId)).toEqual([
      "required-fail",
      "required-pass",
      "optional-pass",
    ]);
    expect(result.results.map((suiteResult) => suiteResult.status)).toEqual([
      "failed",
      "skipped",
      "skipped",
    ]);
    expect(calls.map((call) => ({ commandId: call.command.id, skip: call.skip === true }))).toEqual(
      [
        { commandId: "required-fail", skip: false },
        { commandId: "required-pass", skip: true },
        { commandId: "optional-pass", skip: true },
      ],
    );
    expectNoForbiddenAggregateKeys(result);
  });

  it("continues after an optional failure and reports it as a warning", async () => {
    const commands = [
      createCommand({ id: "optional-fail", label: "Optional fail", required: false }),
      createCommand({ id: "required-pass", label: "Required pass", required: true }),
    ];
    const calls: ValidationExecutionRequest[] = [];
    const adapter = createFakeAdapter(
      {
        "optional-fail": "failed",
        "required-pass": "passed",
      },
      calls,
    );

    const result = await validation.runValidationSuite(
      {
        runId: "run-073-optional-failure",
        worktreePath: "/tmp/aicp/run-073-optional-failure",
        commands,
      },
      { adapter },
    );

    expect(result.status).toBe("warning");
    expect(result.shouldBlockCommit).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([
      {
        commandId: "optional-fail",
        commandLabel: "Optional fail",
        status: "failed",
        message: "Optional validation command failed.",
      },
    ]);
    expect(result.results.map((suiteResult) => suiteResult.status)).toEqual(["failed", "passed"]);
    expect(calls.map((call) => ({ commandId: call.command.id, skip: call.skip === true }))).toEqual(
      [
        { commandId: "optional-fail", skip: false },
        { commandId: "required-pass", skip: false },
      ],
    );
    expectNoForbiddenAggregateKeys(result);
  });

  it("passes when every configured command passes", async () => {
    const commands = [
      createCommand({ id: "unit", label: "Unit tests" }),
      createCommand({ id: "typecheck", label: "Typecheck" }),
    ];
    const adapter = createFakeAdapter({
      unit: "passed",
      typecheck: "passed",
    });

    const result = await validation.runValidationSuite(
      {
        runId: "run-073-all-pass",
        worktreePath: "/tmp/aicp/run-073-all-pass",
        commands,
      },
      { adapter },
    );

    expect(result.status).toBe("passed");
    expect(result.shouldBlockCommit).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.results.map((suiteResult) => suiteResult.status)).toEqual(["passed", "passed"]);
    expectNoForbiddenAggregateKeys(result);
  });

  it("treats cancellation as blocking even for optional commands", async () => {
    const commands = [
      createCommand({ id: "optional-cancelled", label: "Optional cancelled", required: false }),
      createCommand({ id: "required-pass", label: "Required pass", required: true }),
    ];
    const calls: ValidationExecutionRequest[] = [];
    const adapter = createFakeAdapter(
      {
        "optional-cancelled": "cancelled",
        "required-pass": "passed",
      },
      calls,
    );

    const result = await validation.runValidationSuite(
      {
        runId: "run-073-cancelled",
        worktreePath: "/tmp/aicp/run-073-cancelled",
        commands,
      },
      { adapter },
    );

    expect(result.status).toBe("failed");
    expect(result.shouldBlockCommit).toBe(true);
    expect(result.blockers).toEqual([
      {
        commandId: "optional-cancelled",
        commandLabel: "Optional cancelled",
        status: "cancelled",
        message: "Validation command was cancelled.",
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.results.map((suiteResult) => suiteResult.status)).toEqual([
      "cancelled",
      "skipped",
    ]);
    expect(calls.map((call) => ({ commandId: call.command.id, skip: call.skip === true }))).toEqual(
      [
        { commandId: "optional-cancelled", skip: false },
        { commandId: "required-pass", skip: true },
      ],
    );
    expectNoForbiddenAggregateKeys(result);
  });

  it("preserves command runner redaction in aggregate optional failure output", async () => {
    const worktreePath = await createTempWorktree();
    const secretValue = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    const command = createCommand({
      id: "optional-token-output",
      label: "Optional token output",
      command: `printf %s ${shellSingleQuote(`token ${secretValue}`)}; exit 1`,
      required: false,
    });

    const result = await validation.runValidationSuite({
      runId: "run-073-redaction",
      worktreePath,
      commands: [command],
    });
    const serializedResult = JSON.stringify(result);

    expect(result.status).toBe("warning");
    expect(result.shouldBlockCommit).toBe(false);
    expect(result.warnings).toEqual([
      {
        commandId: "optional-token-output",
        commandLabel: "Optional token output",
        status: "failed",
        message: "Optional validation command failed.",
      },
    ]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.stdoutSummary).toContain("[REDACTED_SECRET]");
    expect(result.results[0]?.redactionApplied).toBe(true);
    expect(serializedResult).not.toContain(secretValue);
    expect(validation.ValidationResultSchema.parse(result.results[0])).toEqual(result.results[0]);
    expectNoForbiddenAggregateKeys(result);
  });
});

const createFakeAdapter = (
  statuses: Record<string, ValidationResult["status"]>,
  calls: ValidationExecutionRequest[] = [],
): ValidationAdapter => ({
  execute: vi.fn(async (request: ValidationExecutionRequest) => {
    calls.push(request);

    return validation.ValidationResultSchema.parse(
      createValidationResult({
        runId: request.runId,
        command: request.command,
        status: request.skip === true ? "skipped" : (statuses[request.command.id] ?? "passed"),
      }),
    );
  }),
});

const createCommand = (overrides: Partial<ValidationCommand> = {}): ValidationCommand => ({
  id: "unit",
  label: "Unit validation",
  command: "printf validation-ok",
  timeoutSeconds: 5,
  required: true,
  ...overrides,
});

const createValidationResult = (params: {
  runId: string;
  command: ValidationCommand;
  status: ValidationResult["status"];
}): ValidationResult => ({
  contractVersion: "2026-05-10.v1",
  id: `validation:${params.runId}:${params.command.id}`,
  runId: params.runId,
  commandId: params.command.id,
  commandLabel: params.command.label,
  command: params.command.command,
  status: params.status,
  exitCode: params.status === "passed" ? 0 : params.status === "failed" ? 1 : null,
  durationMs: params.status === "skipped" ? 0 : 12,
  stdoutSummary: "",
  stderrSummary: "",
  redactionApplied: true,
  startedAt: "2026-05-21T20:00:00.000Z",
  finishedAt: "2026-05-21T20:00:01.000Z",
});

const createTempWorktree = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "aicp-validation-suite-"));
  tempDirs.push(directory);

  return directory;
};

const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const expectNoForbiddenAggregateKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      expectNoForbiddenAggregateKeys(item);
    }

    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    expect(forbiddenAggregateKeys).not.toContain(key);
    expectNoForbiddenAggregateKeys(childValue);
  }
};
