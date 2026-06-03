import { describe, expect, it } from "vitest";

import * as codex from "@control-plane/codex";
import type {
  CodexAdapter,
  CodexExecutionRequest,
  CodexExecutionResult,
  CodexExecutionStatus,
  MockCodexAdapterOptions,
  MockCodexFileChange,
} from "@control-plane/codex";

const expectedRuntimeExportKeys = [
  "CODEX_EXECUTION_STATUSES",
  "createCodexExecAdapter",
  "createMockCodexAdapter",
  "renderTaskPacketPrompt",
] as const;

type PublicCodexTypeImports = readonly [
  CodexAdapter,
  CodexExecutionRequest,
  CodexExecutionResult,
  CodexExecutionStatus,
  MockCodexAdapterOptions,
  MockCodexFileChange,
];

const publicCodexTypeImports: PublicCodexTypeImports | null = null;

describe("@control-plane/codex entrypoint", () => {
  it("exports the runtime adapter constants and prompt renderer", () => {
    expect(Object.keys(codex).sort()).toEqual([...expectedRuntimeExportKeys].sort());
    expect(codex.CODEX_EXECUTION_STATUSES).toEqual([
      "succeeded",
      "failed",
      "timed_out",
      "cancelled",
    ]);
    expect(typeof codex.createCodexExecAdapter).toBe("function");
    expect(typeof codex.createMockCodexAdapter).toBe("function");
    expect(typeof codex.renderTaskPacketPrompt).toBe("function");
  });

  it("exposes adapter types so runner tests can inject Codex execution", async () => {
    const adapter: CodexAdapter = {
      async execute(request: CodexExecutionRequest): Promise<CodexExecutionResult> {
        const status: CodexExecutionStatus = "succeeded";

        expect(request).toEqual({
          runId: "run_123",
          worktreePath: "/tmp/aicp/run_123",
          prompt: "local-only prompt",
          timeoutMs: 1_000,
        });

        return {
          status,
          exitCode: 0,
          durationMs: 25,
          stdoutSummary: "redacted stdout summary",
          stderrSummary: "",
          redactionApplied: true,
        };
      },
    };

    const result = await adapter.execute({
      runId: "run_123",
      worktreePath: "/tmp/aicp/run_123",
      prompt: "local-only prompt",
      timeoutMs: 1_000,
    });

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
    expect(result).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      redactionApplied: true,
    });
    expect(publicCodexTypeImports).toBeNull();
  });
});
