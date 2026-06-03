import { describe, expect, test } from "vitest";
import {
  buildCodexExecArgs,
  extractFinalAgentMessage,
  parseReviewFromCodexOutput,
} from "./codex.js";

describe("codex adapter", () => {
  test("builds exec arguments supported by the local Codex CLI", () => {
    const args = buildCodexExecArgs("/repo", { sandbox: "read-only" });

    expect(args).toEqual(["exec", "--json", "--cd", "/repo", "--sandbox", "read-only", "-"]);
    expect(args).not.toContain("--ask-for-approval");
  });

  test("extracts only the final agent message from Codex JSONL output", () => {
    const jsonl = [
      JSON.stringify({ type: "thread.started", thread_id: "thread" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          aggregated_output: "raw command output",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Final implementation plan",
        },
      }),
    ].join("\n");

    expect(extractFinalAgentMessage(jsonl)).toBe("Final implementation plan");
  });

  test("trusts explicit review verdict before scanning explanatory text", () => {
    expect(
      parseReviewFromCodexOutput(
        "PASS\n\nNo code-review blockers found. Vitest was blocked by read-only sandbox.",
      ),
    ).toMatchObject({ passed: true });

    expect(parseReviewFromCodexOutput("BLOCKED\n\nMust fix package exports.")).toMatchObject({
      passed: false,
    });
  });
});
