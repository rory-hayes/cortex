import { describe, expect, it } from "vitest";
import type {
  ValidationResult as SharedValidationResult,
  ValidationResultStatus as SharedValidationResultStatus,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const DOCUMENTED_VALIDATION_RESULT_STATUSES = ["passed", "failed", "skipped", "cancelled"] as const;

type ValidationResultStatus = (typeof DOCUMENTED_VALIDATION_RESULT_STATUSES)[number];

type ValidationResult = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  runId: string;
  commandId: string;
  commandLabel: string;
  command: string;
  status: ValidationResultStatus;
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  redactionApplied: boolean;
  startedAt: string;
  finishedAt: string;
};

type ValidationResultModule = {
  VALIDATION_RESULT_STATUSES: readonly ValidationResultStatus[];
  ValidationResultStatusSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  ValidationResultSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadValidationResultModule = async () =>
  (await import("./validation-result.js")) as ValidationResultModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<ValidationResultModule>;

const validValidationResult = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
  contractVersion: CONTRACT_VERSION,
  id: "validation-result-1",
  runId: "run-1",
  commandId: "test",
  commandLabel: "Run tests",
  command: "pnpm test",
  status: "passed",
  exitCode: 0,
  durationMs: 1_250,
  stdoutSummary: "Redacted stdout summary.",
  stderrSummary: "Redacted stderr summary.",
  redactionApplied: true,
  startedAt: "2026-05-14T20:09:58.606Z",
  finishedAt: "2026-05-14T20:10:00.000Z",
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  result: SharedValidationResult;
  status: SharedValidationResultStatus;
}) => value;

describe("ValidationResult", () => {
  it("exports the documented statuses in canonical order", async () => {
    const { VALIDATION_RESULT_STATUSES, ValidationResultStatusSchema } =
      await loadValidationResultModule();

    expect(VALIDATION_RESULT_STATUSES).toEqual(DOCUMENTED_VALIDATION_RESULT_STATUSES);
    for (const status of DOCUMENTED_VALIDATION_RESULT_STATUSES) {
      expect(ValidationResultStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("validates every documented status", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    for (const status of DOCUMENTED_VALIDATION_RESULT_STATUSES) {
      expect(ValidationResultSchema.safeParse(validValidationResult({ status })).success).toBe(
        true,
      );
    }
  });

  it("rejects unknown statuses", async () => {
    const { ValidationResultStatusSchema, ValidationResultSchema } =
      await loadValidationResultModule();
    const unknownStatus = "timed_out" as ValidationResultStatus;

    expect(ValidationResultStatusSchema.safeParse(unknownStatus).success).toBe(false);
    expect(
      ValidationResultSchema.safeParse(validValidationResult({ status: unknownStatus })).success,
    ).toBe(false);
  });

  it("requires redactionApplied", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();
    const resultWithoutRedactionFlag: Record<string, unknown> = { ...validValidationResult() };
    delete resultWithoutRedactionFlag.redactionApplied;

    expect(ValidationResultSchema.safeParse(resultWithoutRedactionFlag).success).toBe(false);
  });

  it("rejects non-boolean redactionApplied values", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    expect(
      ValidationResultSchema.safeParse(validValidationResult({ redactionApplied: "true" as never }))
        .success,
    ).toBe(false);
  });

  it("rejects missing or wrong contract versions", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();
    const resultWithoutContractVersion: Record<string, unknown> = { ...validValidationResult() };
    delete resultWithoutContractVersion.contractVersion;

    expect(ValidationResultSchema.safeParse(resultWithoutContractVersion).success).toBe(false);
    expect(
      ValidationResultSchema.safeParse(
        validValidationResult({
          contractVersion: "2026-05-10.v0" as typeof CONTRACT_VERSION,
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    expect(
      ValidationResultSchema.safeParse({
        ...validValidationResult(),
        rawOutput: "not allowed",
      }).success,
    ).toBe(false);
  });

  it("rejects empty required identifiers, command metadata, and timestamps", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    for (const key of [
      "id",
      "runId",
      "commandId",
      "commandLabel",
      "command",
      "startedAt",
      "finishedAt",
    ] satisfies (keyof ValidationResult)[]) {
      expect(ValidationResultSchema.safeParse(validValidationResult({ [key]: "" })).success).toBe(
        false,
      );
    }
  });

  it("rejects invalid exit codes and durations", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    expect(
      ValidationResultSchema.safeParse(validValidationResult({ exitCode: null })).success,
    ).toBe(true);
    for (const exitCode of [-1, 1.5]) {
      expect(ValidationResultSchema.safeParse(validValidationResult({ exitCode })).success).toBe(
        false,
      );
    }
    for (const durationMs of [-1, 1.5]) {
      expect(ValidationResultSchema.safeParse(validValidationResult({ durationMs })).success).toBe(
        false,
      );
    }
  });

  it("validates empty output summaries", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    expect(
      ValidationResultSchema.safeParse(
        validValidationResult({
          stdoutSummary: "",
          stderrSummary: "",
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects non-string output summaries", async () => {
    const { ValidationResultSchema } = await loadValidationResultModule();

    expect(
      ValidationResultSchema.safeParse(validValidationResult({ stdoutSummary: [] as never }))
        .success,
    ).toBe(false);
    expect(
      ValidationResultSchema.safeParse(validValidationResult({ stderrSummary: {} as never }))
        .success,
    ).toBe(false);
  });

  it("exports validation result schemas, constants, and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();
    const result: SharedValidationResult = validValidationResult();
    const status: SharedValidationResultStatus = "cancelled";

    expect(shared.VALIDATION_RESULT_STATUSES).toEqual(DOCUMENTED_VALIDATION_RESULT_STATUSES);
    expect(shared.ValidationResultStatusSchema?.safeParse(status).success).toBe(true);
    expect(shared.ValidationResultSchema?.safeParse(result).success).toBe(true);

    assertEntrypointTypeExports({
      result,
      status,
    });
  });
});
