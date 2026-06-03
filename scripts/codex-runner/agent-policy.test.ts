import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildPromptContext,
  ensureAgentInstructions,
  resolveAgentInstructionNames,
} from "./agent-policy.js";

let tempRoots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-agent-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe("agent policy", () => {
  test("repository AGENTS.md includes required refactor principles", async () => {
    const content = await readFile(join(process.cwd(), "AGENTS.md"), "utf8");

    expectRefactorPrinciples(content);
  });

  test("prefers AGENTS.md and includes it in prompt context", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "AGENTS.md"), "# AGENTS.md\n\nFollow strict gates.\n");
    await writeFile(join(root, "BACKLOG.md"), "# BACKLOG\n");

    const policy = await ensureAgentInstructions(root);

    expect(policy.relativePath).toBe("AGENTS.md");
    expect(policy.content).toContain("Follow strict gates.");
  });

  test("hard-blocks ambiguous duplicate agent instruction files", () => {
    expect(resolveAgentInstructionNames(["AGENTS.md", "agents.md"])).toBe("duplicate");
  });

  test("creates canonical AGENTS.md when no instruction file exists", async () => {
    const root = await makeRoot();

    const policy = await ensureAgentInstructions(root);
    const created = await readFile(join(root, "AGENTS.md"), "utf8");

    expect(policy.relativePath).toBe("AGENTS.md");
    expect(created).toContain("Work one backlog task at a time.");
    expect(created).toContain("Never send raw source code");
    expectRefactorPrinciples(created);
  });

  test("builds prompt context with required docs and selected task", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "AGENTS.md"), "# AGENTS\nAgent rules");
    await writeFile(
      join(root, "BACKLOG.md"),
      "# Backlog\n\n### TASK-999 — Unrelated task\nDo not include this whole file.",
    );
    await writeFile(join(root, "SECURITY_MODEL.md"), "# Security");
    await writeFile(join(root, "RUNNER_PROTOCOL.md"), "# Protocol");

    const context = await buildPromptContext(root, {
      id: "TASK-001",
      title: "Lock package manager",
      raw: "### TASK-001\nStatus: [ ]",
      status: "[ ]",
      priority: "P0",
      dependsOn: [],
      validation: "Run pnpm --version.",
      filesLikelyTouched: [],
      order: 0,
      start: 0,
      end: 1,
    });

    expect(context).toContain('<agent_instructions path="AGENTS.md">');
    expect(context).toContain('<doc path="SECURITY_MODEL.md">');
    expect(context).toContain('<selected_task id="TASK-001">');
    expect(context).not.toContain("TASK-999");
  });
});

function expectRefactorPrinciples(content: string) {
  expect(content).toContain(
    "Do not rebuild, replace, or remove the existing local runner unless explicitly directed.",
  );
  expect(content).toContain("Preserve source-boundary safety for all new work.");
  expect(content).toContain(
    "Initial repo-readiness scan value must not require runner installation.",
  );
  expect(content).toContain(
    "Every new task must update `README.md`, `SPRINT.md`, and relevant tests.",
  );
}
