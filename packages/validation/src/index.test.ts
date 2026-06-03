import { describe, expect, it } from "vitest";

import * as validation from "@control-plane/validation";
import type {
  RedactedValidationOutput,
  ValidationCommand,
  ValidationAdapter,
  ValidationCommandRunnerOptions,
  ValidationExecutionRequest,
  ValidationExecutionResult,
  ValidationEngine,
  ValidationResult,
  ValidationResultStatus,
  ValidationSuiteFinding,
  ValidationSuiteRequest,
  ValidationSuiteResult,
  ValidationSuiteRunner,
  ValidationSuiteRunnerOptions,
  ValidationSuiteStatus,
} from "@control-plane/validation";

const expectedRuntimeExportKeys = [
  "VALIDATION_RESULT_STATUSES",
  "ValidationCommandSchema",
  "ValidationResultSchema",
  "ValidationResultStatusSchema",
  "createValidationCommandRunner",
  "createValidationSuiteRunner",
  "redactValidationOutput",
  "runValidationCommand",
  "runValidationSuite",
] as const;

type PublicValidationTypeImports = readonly [
  RedactedValidationOutput,
  ValidationCommand,
  ValidationAdapter,
  ValidationCommandRunnerOptions,
  ValidationExecutionRequest,
  ValidationExecutionResult,
  ValidationEngine,
  ValidationResult,
  ValidationResultStatus,
  ValidationSuiteFinding,
  ValidationSuiteRequest,
  ValidationSuiteResult,
  ValidationSuiteRunner,
  ValidationSuiteRunnerOptions,
  ValidationSuiteStatus,
];

const publicValidationTypeImports: PublicValidationTypeImports | null = null;

const validCommand = (): ValidationCommand => ({
  id: "test",
  label: "Run tests",
  command: "pnpm test",
  timeoutSeconds: 60,
  required: true,
});

const validValidationResult = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
  contractVersion: "2026-05-10.v1",
  id: "validation-result-1",
  runId: "run-1",
  commandId: "test",
  commandLabel: "Run tests",
  command: "pnpm test",
  status: "passed",
  exitCode: 0,
  durationMs: 1_250,
  stdoutSummary: "Redacted stdout summary.",
  stderrSummary: "",
  redactionApplied: true,
  startedAt: "2026-05-14T20:09:58.606Z",
  finishedAt: "2026-05-14T20:10:00.000Z",
  ...overrides,
});

describe("@control-plane/validation entrypoint", () => {
  it("exports shared validation runtime contracts and redaction wrapper", () => {
    expect(Object.keys(validation).sort()).toEqual([...expectedRuntimeExportKeys].sort());
    expect(validation.VALIDATION_RESULT_STATUSES).toEqual([
      "passed",
      "failed",
      "skipped",
      "cancelled",
    ]);
    expect(validation.ValidationCommandSchema.parse(validCommand())).toEqual(validCommand());
    expect(validation.ValidationResultStatusSchema.safeParse("passed").success).toBe(true);
    expect(typeof validation.redactValidationOutput).toBe("function");
    expect(typeof validation.runValidationCommand).toBe("function");
    expect(typeof validation.createValidationCommandRunner).toBe("function");
    expect(typeof validation.runValidationSuite).toBe("function");
    expect(typeof validation.createValidationSuiteRunner).toBe("function");
  });

  it("parses a shared-style validation result through the package boundary", () => {
    const result = validValidationResult();

    expect(validation.ValidationResultSchema.parse(result)).toEqual(result);
  });

  it("exposes local engine interfaces without command runner behavior", async () => {
    const request: ValidationExecutionRequest = {
      runId: "run-1",
      worktreePath: "/tmp/aicp/run-1",
      command: validCommand(),
    };
    const adapter: ValidationAdapter = {
      async execute(
        receivedRequest: ValidationExecutionRequest,
      ): Promise<ValidationExecutionResult> {
        expect(receivedRequest).toEqual(request);

        return validation.ValidationResultSchema.parse(
          validValidationResult({
            runId: receivedRequest.runId,
            commandId: receivedRequest.command.id,
            commandLabel: receivedRequest.command.label,
            command: receivedRequest.command.command,
          }),
        );
      },
    };
    const engine: ValidationEngine = adapter;

    const result = await engine.execute(request);

    expect(result).toEqual({
      contractVersion: "2026-05-10.v1",
      id: "validation-result-1",
      runId: "run-1",
      commandId: "test",
      commandLabel: "Run tests",
      command: "pnpm test",
      status: "passed",
      exitCode: 0,
      durationMs: 1_250,
      stdoutSummary: "Redacted stdout summary.",
      stderrSummary: "",
      redactionApplied: true,
      startedAt: "2026-05-14T20:09:58.606Z",
      finishedAt: "2026-05-14T20:10:00.000Z",
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "command",
        "commandId",
        "commandLabel",
        "contractVersion",
        "durationMs",
        "exitCode",
        "finishedAt",
        "id",
        "redactionApplied",
        "runId",
        "startedAt",
        "status",
        "stderrSummary",
        "stdoutSummary",
      ].sort(),
    );
    expect(result).not.toHaveProperty("stdout");
    expect(result).not.toHaveProperty("stderr");
    expect(result).not.toHaveProperty("rawOutput");
    expect(result).not.toHaveProperty("diff");
    expect(result).not.toHaveProperty("patch");
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("code");
    expect(() =>
      validation.ValidationResultSchema.parse({
        ...result,
        rawOutput: "raw validation output must stay local",
      }),
    ).toThrow();
    expect(publicValidationTypeImports).toBeNull();
  });

  it("can treat an engine as the local validation boundary", async () => {
    const engine: ValidationEngine = {
      async execute(
        receivedRequest: ValidationExecutionRequest,
      ): Promise<ValidationExecutionResult> {
        return validation.ValidationResultSchema.parse({
          ...validValidationResult(),
          runId: receivedRequest.runId,
          commandId: receivedRequest.command.id,
          commandLabel: receivedRequest.command.label,
          command: receivedRequest.command.command,
        });
      },
    };

    await expect(
      engine.execute({
        runId: "run-1",
        worktreePath: "/tmp/aicp/run-1",
        command: validCommand(),
      }),
    ).resolves.toMatchObject({
      runId: "run-1",
      commandId: "test",
      status: "passed",
      redactionApplied: true,
    });
  });

  it("creates a command runner adapter through the public entrypoint", async () => {
    const engine = validation.createValidationCommandRunner({
      spawn: () => {
        throw new Error("skipped commands must not spawn");
      },
    });

    await expect(
      engine.execute({
        runId: "run-1",
        worktreePath: "/tmp/aicp/run-1",
        command: validCommand(),
        skip: true,
      }),
    ).resolves.toMatchObject({
      runId: "run-1",
      commandId: "test",
      status: "skipped",
      exitCode: null,
      stdoutSummary: "",
      stderrSummary: "",
    });
  });

  it("creates a suite runner through the public entrypoint", async () => {
    const suiteRunner = validation.createValidationSuiteRunner({
      adapter: {
        async execute(
          receivedRequest: ValidationExecutionRequest,
        ): Promise<ValidationExecutionResult> {
          return validation.ValidationResultSchema.parse(
            validValidationResult({
              runId: receivedRequest.runId,
              commandId: receivedRequest.command.id,
              commandLabel: receivedRequest.command.label,
              command: receivedRequest.command.command,
              status: receivedRequest.skip === true ? "skipped" : "passed",
            }),
          );
        },
      },
    });

    await expect(
      suiteRunner.run({
        runId: "run-1",
        worktreePath: "/tmp/aicp/run-1",
        commands: [validCommand()],
      }),
    ).resolves.toMatchObject({
      status: "passed",
      shouldBlockCommit: false,
      blockers: [],
      warnings: [],
    });
  });

  it("exports a validation output redaction wrapper", () => {
    expect(validation.redactValidationOutput("token ghp_abcdefghijklmnopqrstuvwxyz123456")).toEqual(
      {
        text: "token [REDACTED_SECRET]",
        redactionApplied: true,
      },
    );
  });
});
