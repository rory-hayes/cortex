import { z } from "zod";

export const RUN_STATES = [
  "queued",
  "claimed",
  "dry_run_running",
  "dry_run_passed",
  "preflight",
  "worktree_created",
  "codex_running",
  "changes_scanned",
  "validation_running",
  "blocked",
  "cancel_requested",
  "cancelling",
  "cancelled",
  "pushed",
  "pr_opened",
  "awaiting_approval",
  "repair_requested",
  "completed",
  "failed",
] as const;

export const RunStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof RunStateSchema>;

export const TERMINAL_RUN_STATES = [
  "cancelled",
  "completed",
  "failed",
  "blocked",
] as const satisfies readonly RunState[];

const terminalRunStateSet = new Set<RunState>(TERMINAL_RUN_STATES);

export const isTerminalRunState = (state: RunState): boolean => terminalRunStateSet.has(state);
