import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runValidationCommands, validationCommandsFromTask } from "./validation.js";

let tempRoots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-validation-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe("validation runner", () => {
  test("extracts explicit shell commands but ignores natural-language validation guidance", () => {
    expect(validationCommandsFromTask("Run `pnpm test`.")).toMatchObject([
      {
        id: "task-validation",
        command: "pnpm",
        args: ["test"],
        required: true,
      },
    ]);

    expect(
      validationCommandsFromTask("Run `pnpm run format:check`, `pnpm run lint`, and `pnpm test`."),
    ).toMatchObject([
      {
        id: "task-validation-1",
        command: "pnpm",
        args: ["run", "format:check"],
      },
      {
        id: "task-validation-2",
        command: "pnpm",
        args: ["run", "lint"],
      },
      {
        id: "task-validation-3",
        command: "pnpm",
        args: ["test"],
      },
    ]);

    expect(
      validationCommandsFromTask("Run `pnpm run typecheck && pnpm run lint && pnpm test` locally."),
    ).toMatchObject([
      {
        id: "task-validation",
        command: "sh",
        args: ["-lc", "pnpm run typecheck && pnpm run lint && pnpm test"],
      },
    ]);

    expect(
      validationCommandsFromTask(
        "Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.",
      ),
    ).toMatchObject([
      {
        id: "task-validation-1",
        command: "pnpm",
        args: ["run", "typecheck"],
      },
      {
        id: "task-validation-2",
        command: "pnpm",
        args: ["run", "lint"],
      },
      {
        id: "task-validation-3",
        command: "pnpm",
        args: ["run", "format:check"],
      },
      {
        id: "task-validation-4",
        command: "pnpm",
        args: ["test"],
      },
    ]);

    expect(
      validationCommandsFromTask(
        "Inspect files and run placeholder scan for real-looking secrets.",
      ),
    ).toEqual([]);
  });

  test("captures passing and failing commands with redacted output", async () => {
    const root = await makeRoot();
    const results = await runValidationCommands(root, [
      {
        id: "pass",
        label: "Passing command",
        command: "node",
        args: ["-e", "console.log('ok')"],
        required: true,
        timeoutMs: 5_000,
      },
      {
        id: "fail",
        label: "Failing command",
        command: "node",
        args: ["-e", "console.error('OPENAI_API_KEY=sk-secret'); process.exit(2)"],
        required: true,
        timeoutMs: 5_000,
      },
    ]);

    expect(results).toMatchObject([
      { id: "pass", status: "passed", exitCode: 0, required: true },
      { id: "fail", status: "failed", exitCode: 2, required: true },
    ]);
    expect(results[1]?.stderrSummary).not.toContain("sk-secret");
    expect(results[1]?.stderrSummary).toContain("[REDACTED]");
  });

  test("times out commands and marks required validation as failed", async () => {
    const root = await makeRoot();
    const [result] = await runValidationCommands(root, [
      {
        id: "timeout",
        label: "Timeout command",
        command: "node",
        args: ["-e", "setTimeout(() => {}, 1000)"],
        required: true,
        timeoutMs: 50,
      },
    ]);

    expect(result).toMatchObject({
      id: "timeout",
      status: "timed_out",
      required: true,
    });
  });
});
