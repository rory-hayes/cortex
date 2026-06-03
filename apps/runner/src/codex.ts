import {
  createCodexExecAdapter,
  createMockCodexAdapter,
  renderTaskPacketPrompt,
  type CodexAdapter,
  type CodexExecutionResult,
  type CodexExecutionStatus,
} from "@control-plane/codex";
import type { TaskPacket } from "@control-plane/shared";

import type { RunnerConfig } from "./config.js";

export type RunnerCodexAdapterMode = "mock" | "local";

export type RunnerCodexAdapterSelection = {
  mode: RunnerCodexAdapterMode;
  adapter: CodexAdapter;
};

export type RunnerCodexAdapterFactories = {
  createLocalAdapter?: () => CodexAdapter;
  createMockAdapter?: () => CodexAdapter;
};

export type RunCodexForTaskOptions = {
  config: Pick<RunnerConfig, "mockModes">;
  taskPacket: TaskPacket;
  worktreePath: string;
};

export type RunCodexForTaskResult = {
  adapterMode: RunnerCodexAdapterMode;
  status: CodexExecutionStatus;
  exitCode: number | null;
  durationMs: number;
  redactionApplied: boolean;
};

export const getCodexAdapterMode = (
  config: Pick<RunnerConfig, "mockModes">,
): RunnerCodexAdapterMode => (config.mockModes.codex ? "mock" : "local");

export const selectCodexAdapter = (
  config: Pick<RunnerConfig, "mockModes">,
  factories: RunnerCodexAdapterFactories = {},
): RunnerCodexAdapterSelection => {
  const mode = getCodexAdapterMode(config);

  if (mode === "mock") {
    return {
      mode,
      adapter: (factories.createMockAdapter ?? createMockCodexAdapter)(),
    };
  }

  return {
    mode,
    adapter: (factories.createLocalAdapter ?? createCodexExecAdapter)(),
  };
};

export const runCodexForTask = async (
  options: RunCodexForTaskOptions,
  factories: RunnerCodexAdapterFactories = {},
): Promise<RunCodexForTaskResult> => {
  const selection = selectCodexAdapter(options.config, factories);
  const prompt = renderTaskPacketPrompt({
    ...options.taskPacket,
    repo: {
      ...options.taskPacket.repo,
      worktreePath: options.worktreePath,
    },
  });
  const adapterResult = await selection.adapter.execute({
    runId: options.taskPacket.runId,
    worktreePath: options.worktreePath,
    prompt,
  });

  return safeCodexResult(selection.mode, adapterResult);
};

const safeCodexResult = (
  adapterMode: RunnerCodexAdapterMode,
  result: CodexExecutionResult,
): RunCodexForTaskResult => ({
  adapterMode,
  status: result.status,
  exitCode: result.exitCode,
  durationMs: result.durationMs,
  redactionApplied: result.redactionApplied,
});
