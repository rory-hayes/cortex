import { describe, expect, it } from "vitest";

const DOCUMENTED_RUN_STATES = [
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

const TERMINAL_RUN_STATES = ["cancelled", "completed", "failed", "blocked"] as const;

const UNKNOWN_RUN_STATES = ["canceling", "dry-run-running", "done", "repair_running"] as const;

type RunState = (typeof DOCUMENTED_RUN_STATES)[number];

type RunStateModule = {
  RUN_STATES: readonly RunState[];
  RunStateSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  TERMINAL_RUN_STATES: readonly RunState[];
  isTerminalRunState: (state: RunState) => boolean;
};

const loadRunStateModule = async () => (await import("./run-state.js")) as RunStateModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RunStateModule>;

describe("RunState", () => {
  it("validates every documented state in canonical order", async () => {
    const { RUN_STATES, RunStateSchema } = await loadRunStateModule();

    expect(RUN_STATES).toEqual(DOCUMENTED_RUN_STATES);
    for (const state of DOCUMENTED_RUN_STATES) {
      expect(RunStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("rejects unknown and misspelled states", async () => {
    const { RunStateSchema } = await loadRunStateModule();

    for (const state of UNKNOWN_RUN_STATES) {
      expect(RunStateSchema.safeParse(state).success).toBe(false);
    }
  });

  it("recognizes only documented terminal states", async () => {
    const { TERMINAL_RUN_STATES: exportedTerminalStates, isTerminalRunState } =
      await loadRunStateModule();
    const terminalStateSet = new Set<RunState>(TERMINAL_RUN_STATES);

    expect(exportedTerminalStates).toEqual(TERMINAL_RUN_STATES);
    for (const state of DOCUMENTED_RUN_STATES) {
      expect(isTerminalRunState(state)).toBe(terminalStateSet.has(state));
    }
  });

  it("exports the run state contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.RUN_STATES).toEqual(DOCUMENTED_RUN_STATES);
    expect(shared.RunStateSchema?.safeParse("queued").success).toBe(true);
    expect(shared.TERMINAL_RUN_STATES).toEqual(TERMINAL_RUN_STATES);
    expect(shared.isTerminalRunState?.("completed")).toBe(true);
  });
});
