import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexReviewResult } from "./types.js";
import { runCommand } from "./git.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CODEX_TIMEOUT_MS = 10 * 60 * 1000;

export async function renderPrompt(
  templateName: string,
  values: Record<string, string>,
): Promise<string> {
  const template = await readFile(join(scriptDir, "prompts", templateName), "utf8");

  return Object.entries(values).reduce(
    (content, [key, value]) => content.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export async function runCodexExec(
  repoRoot: string,
  prompt: string,
  options: { sandbox: "read-only" | "workspace-write"; timeoutMs?: number },
): Promise<string> {
  const result = await runCommand(
    repoRoot,
    "codex",
    buildCodexExecArgs(repoRoot, options),
    prompt,
    options.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS,
  );

  if (result.exitCode !== 0) {
    throw new Error(`codex exec failed: ${result.stderr || result.stdout}`);
  }

  return extractFinalAgentMessage(result.stdout);
}

export function buildCodexExecArgs(
  repoRoot: string,
  options: { sandbox: "read-only" | "workspace-write" },
): string[] {
  return ["exec", "--json", "--cd", repoRoot, "--sandbox", options.sandbox, "-"];
}

export function parseReviewFromCodexOutput(output: string): CodexReviewResult {
  const summary = output.trim() || "Review completed without a final message.";
  const verdict = summary
    .split("\n")
    .find((line) => line.trim())
    ?.trim()
    .replace(/[:.]+$/, "")
    .toUpperCase();
  const failed =
    verdict === "PASS"
      ? false
      : verdict === "BLOCKED" || verdict === "FAIL" || verdict === "FAILED"
        ? true
        : /\b(fail|failed|block|blocked|must fix)\b/i.test(summary);

  return {
    passed: !failed,
    summary,
  };
}

export function extractFinalAgentMessage(jsonl: string): string {
  let finalMessage = "";

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        finalMessage = event.item.text;
      }
    } catch {
      // If a future Codex version emits non-JSON lines, ignore them and keep
      // looking for the final structured message.
    }
  }

  return finalMessage || jsonl.trim();
}
