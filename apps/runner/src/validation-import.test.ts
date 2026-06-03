import { describe, expect, it } from "vitest";

import { ValidationResultSchema } from "@control-plane/validation";
import type {
  ValidationExecutionRequest,
  ValidationExecutionResult,
  ValidationEngine,
} from "@control-plane/validation";

const validationResult = (
  overrides: Partial<ValidationExecutionResult> = {},
): ValidationExecutionResult => ({
  contractVersion: "2026-05-10.v1",
  id: "validation-result-1",
  runId: "run-1",
  commandId: "test",
  commandLabel: "Run tests",
  command: "pnpm test",
  status: "passed",
  exitCode: 0,
  durationMs: 1_000,
  stdoutSummary: "",
  stderrSummary: "",
  redactionApplied: true,
  startedAt: "2026-05-14T20:09:58.606Z",
  finishedAt: "2026-05-14T20:10:00.000Z",
  ...overrides,
});

describe("validation package import boundary", () => {
  it("lets runner tests import validation schemas and command interfaces", async () => {
    const request: ValidationExecutionRequest = {
      runId: "run-1",
      worktreePath: "/tmp/aicp/run-1",
      command: {
        id: "test",
        label: "Run tests",
        command: "pnpm test",
        timeoutSeconds: 60,
        required: true,
      },
    };
    const executor: ValidationEngine = {
      async execute(): Promise<ValidationExecutionResult> {
        return validationResult();
      },
    };

    expect(ValidationResultSchema.safeParse(await executor.execute(request)).success).toBe(true);
  });
});
