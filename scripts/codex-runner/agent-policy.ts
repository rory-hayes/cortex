import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentInstructions, BacklogTask } from "./types.js";

const requiredDocs = [
  "README.md",
  "MVP_PLAN.md",
  "ARCHITECTURE.md",
  "DATA_MODEL.md",
  "RUNNER_PROTOCOL.md",
  "SECURITY_MODEL.md",
  "SPRINT.md",
];

export async function ensureAgentInstructions(repoRoot: string): Promise<AgentInstructions> {
  const canonicalPath = join(repoRoot, "AGENTS.md");
  const lowercasePath = join(repoRoot, "agents.md");
  const entries = await readdir(repoRoot);
  const resolved = resolveAgentInstructionNames(entries);

  if (resolved === "duplicate") {
    throw new Error(
      "Both AGENTS.md and agents.md exist. Consolidate into one canonical instruction file before running.",
    );
  }

  if (resolved === "AGENTS.md") {
    return readAgentInstructions("AGENTS.md", canonicalPath);
  }

  if (resolved === "agents.md") {
    return readAgentInstructions("agents.md", lowercasePath);
  }

  await writeFile(canonicalPath, defaultAgentInstructions(), "utf8");
  return readAgentInstructions("AGENTS.md", canonicalPath);
}

export function resolveAgentInstructionNames(
  entries: string[],
): "AGENTS.md" | "agents.md" | "duplicate" | "missing" {
  const hasCanonical = entries.includes("AGENTS.md");
  const hasLowercase = entries.includes("agents.md");

  if (hasCanonical && hasLowercase) {
    return "duplicate";
  }

  if (hasCanonical) {
    return "AGENTS.md";
  }

  if (hasLowercase) {
    return "agents.md";
  }

  return "missing";
}

export async function buildPromptContext(repoRoot: string, task: BacklogTask): Promise<string> {
  const agent = await ensureAgentInstructions(repoRoot);
  const sections = [
    "Instruction precedence: AGENTS.md/agents.md first, then SECURITY_MODEL.md, then RUNNER_PROTOCOL.md, then the selected BACKLOG.md task.",
    tagged("agent_instructions", agent.content, { path: agent.relativePath }),
  ];

  for (const docPath of requiredDocs) {
    const absolutePath = join(repoRoot, docPath);
    const content = (await exists(absolutePath))
      ? await readFile(absolutePath, "utf8")
      : "[missing]";
    sections.push(tagged("doc", content, { path: docPath }));
  }

  sections.push(tagged("selected_task", task.raw.trim(), { id: task.id }));
  return sections.join("\n\n");
}

async function readAgentInstructions(
  relativePath: "AGENTS.md" | "agents.md",
  absolutePath: string,
): Promise<AgentInstructions> {
  const content = await readFile(absolutePath, "utf8");

  if (!content.trim()) {
    throw new Error(`${relativePath} is empty. Add execution rules before running.`);
  }

  return { relativePath, absolutePath, content };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function tagged(name: string, content: string, attributes: Record<string, string>): string {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ");
  return `<${name} ${attrs}>\n${content.trim()}\n</${name}>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function defaultAgentInstructions(): string {
  return `# AGENTS.md

## Purpose

This repository builds an AI Engineering Control Plane with a local Codex runner and a hosted coordinator. The runner is the executor; the web app is the coordinator.

## Required Reading

Before starting any task, read \`MVP_PLAN.md\`, \`ARCHITECTURE.md\`, \`DATA_MODEL.md\`, \`RUNNER_PROTOCOL.md\`, \`SECURITY_MODEL.md\`, \`SPRINT.md\`, \`BACKLOG.md\`, and this file.

## Operating Rules

- Work one backlog task at a time.
- Plan before implementation.
- Do not start another backlog task until the current task is implemented, tested, documented, and reflected in \`BACKLOG.md\`.
- Never send raw source code, diffs, patches, code snippets, .env contents, secrets, private keys, or unredacted command output outside the local runner boundary.
- Preserve human review and draft pull requests by default.
- Never weaken security, validation, or approval requirements to make implementation easier.
- Run the validation listed in \`BACKLOG.md\` before marking a task complete.

## Refactor Principles

- Do not rebuild, replace, or remove the existing local runner unless explicitly directed.
- Preserve source-boundary safety for all new work. The runner may inspect source locally, but hosted surfaces and web-bound payloads must stay metadata-only.
- Initial repo-readiness scan value must not require runner installation. Users should receive readiness findings, AI-ready tasks, queue visibility, and setup recommendations before runner pairing.
- Every new task must update \`README.md\`, \`SPRINT.md\`, and relevant tests. In concurrent runner mode, defer only merge-queue-owned \`BACKLOG.md\` and \`README.md\` bookkeeping when explicitly instructed; keep task-relevant docs and tests current in the worker branch.
`;
}
