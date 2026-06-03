import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BacklogTask } from "./types.js";

export type RunLogger = {
  runId: string;
  directory: string;
  writeArtifact: (name: string, content: string) => Promise<void>;
};

export async function createRunLogger(repoRoot: string, task: BacklogTask): Promise<RunLogger> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${timestamp}-${task.id}-${slugify(task.title)}`;
  const directory = join(repoRoot, "runs", runId);
  await mkdir(directory, { recursive: true });

  return {
    runId,
    directory,
    writeArtifact: async (name, content) => {
      await writeFile(join(directory, safeName(name)), content, "utf8");
    },
  };
}

export function safeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
