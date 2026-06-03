import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BacklogTask, CommandResult, PrArtifact } from "./types.js";

const bookkeepingFiles = new Set(["BACKLOG.md", "README.md"]);

export async function git(cwd: string, args: string[]): Promise<CommandResult> {
  const result = await runCommand(cwd, "git", args);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result;
}

export async function isGitClean(repoRoot: string): Promise<boolean> {
  const result = await git(repoRoot, ["status", "--porcelain"]);
  return result.stdout.trim() === "";
}

export async function getChangedFiles(repoRoot: string): Promise<string[]> {
  const result = await git(repoRoot, ["status", "--porcelain", "--untracked-files=all"]);
  const files = result.stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim())
    .map((file) => file.split(" -> ").at(-1) ?? file)
    .sort();

  return [...new Set(files)];
}

export function buildBranchName(taskId: string, title: string): string {
  return `codex/${taskId}-${slugify(title)}`;
}

export async function createWorktree(
  repoRoot: string,
  task: BacklogTask,
  branchName: string,
  runId: string,
): Promise<string> {
  const existingWorktree = await findWorktreeForBranch(repoRoot, branchName);
  if (existingWorktree) {
    return existingWorktree;
  }

  const worktreePath = join(repoRoot, ".codex-runner-worktrees", runId);
  await mkdir(dirname(worktreePath), { recursive: true });
  const addArgs = (await branchExists(repoRoot, branchName))
    ? ["worktree", "add", worktreePath, branchName]
    : ["worktree", "add", "-b", branchName, worktreePath];
  await git(repoRoot, addArgs);
  return worktreePath;
}

export async function preparePnpmWorktree(worktreeRoot: string): Promise<void> {
  const args = ["install"];
  if (await fileExists(join(worktreeRoot, "pnpm-lock.yaml"))) {
    args.push("--frozen-lockfile");
  }
  args.push("--ignore-scripts");

  const result = await runCommand(worktreeRoot, "pnpm", args, undefined, 300_000);
  if (result.exitCode !== 0) {
    throw new Error(`pnpm ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

export async function commitAll(repoRoot: string, message: string, body: string): Promise<void> {
  await git(repoRoot, ["add", "-A"]);
  await git(repoRoot, ["commit", "-m", message, "-m", body]);
}

export async function pushBranch(repoRoot: string, branchName: string): Promise<void> {
  await git(repoRoot, ["push", "-u", "origin", branchName]);
}

export async function refreshBranchFromMain(
  repoRoot: string,
  worktreeRoot: string,
  branchName: string,
): Promise<void> {
  await git(repoRoot, ["fetch", "origin", "main"]);
  await git(worktreeRoot, ["checkout", branchName]);
  const rebase = await runCommand(worktreeRoot, "git", ["rebase", "origin/main"]);
  if (rebase.exitCode !== 0) {
    const conflictedFiles = await listConflictedFiles(worktreeRoot);
    if (isBookkeepingOnlyConflict(conflictedFiles)) {
      await git(worktreeRoot, ["checkout", "--ours", "--", ...conflictedFiles]);
      await git(worktreeRoot, ["add", ...conflictedFiles]);
      const continued = await runCommand(worktreeRoot, "git", [
        "-c",
        "core.editor=true",
        "rebase",
        "--continue",
      ]);
      if (continued.exitCode !== 0) {
        throw new Error(
          `git rebase --continue failed after bookkeeping conflict repair: ${
            continued.stderr || continued.stdout
          }`,
        );
      }
    } else {
      throw new Error(`git rebase origin/main failed: ${rebase.stderr || rebase.stdout}`);
    }
  }
  await git(worktreeRoot, ["push", "--force-with-lease", "origin", branchName]);
}

export async function restoreBookkeepingFiles(worktreeRoot: string): Promise<void> {
  await git(worktreeRoot, ["checkout", "--", ...bookkeepingFiles]);
}

export async function mergeBranchToMain(repoRoot: string, branchName: string): Promise<void> {
  await git(repoRoot, ["checkout", "main"]);
  await git(repoRoot, ["pull", "--ff-only", "origin", "main"]);
  await git(repoRoot, ["merge", "--ff-only", branchName]);
  await git(repoRoot, ["push", "origin", "main"]);
}

export async function createDraftPr(
  repoRoot: string,
  input: {
    branchName: string;
    title: string;
    body: string;
    gh?: (args: string[]) => Promise<CommandResult>;
  },
): Promise<PrArtifact> {
  const args = [
    "pr",
    "create",
    "--draft",
    "--head",
    input.branchName,
    "--title",
    input.title,
    "--body",
    input.body,
  ];
  const gh = input.gh ?? ((ghArgs: string[]) => runCommand(repoRoot, "gh", ghArgs));
  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`gh pr create failed: ${result.stderr || result.stdout}`);
  }

  const url = result.stdout.match(/https:\/\/\S+/)?.[0]?.trim();
  const number = url?.match(/\/pull\/(\d+)/)?.[1];

  if (!url || !number) {
    throw new Error("gh pr create did not return a pull request URL.");
  }

  return {
    branchName: input.branchName,
    number: Number.parseInt(number, 10),
    url,
    draft: true,
  };
}

export async function findExistingDraftPr(
  repoRoot: string,
  branchName: string,
  gh?: (args: string[]) => Promise<CommandResult>,
): Promise<PrArtifact | null> {
  const runGh = gh ?? ((ghArgs: string[]) => runCommand(repoRoot, "gh", ghArgs));
  const result = await runGh([
    "pr",
    "view",
    branchName,
    "--json",
    "number,url,isDraft,state,headRefName",
  ]);

  if (result.exitCode !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      number?: number;
      url?: string;
      isDraft?: boolean;
      state?: string;
      headRefName?: string;
    };
    if (
      parsed.state === "CLOSED" ||
      parsed.headRefName !== branchName ||
      typeof parsed.number !== "number" ||
      typeof parsed.url !== "string"
    ) {
      return null;
    }

    return {
      branchName,
      number: parsed.number,
      url: parsed.url,
      draft: parsed.isDraft ?? true,
    };
  } catch {
    return null;
  }
}

export async function cleanupMergedTaskResources(
  repoRoot: string,
  worktreeRoot: string,
  branchName: string,
): Promise<void> {
  await runBestEffort(repoRoot, "git", ["worktree", "remove", "--force", worktreeRoot]);
  await runBestEffort(repoRoot, "git", ["branch", "-D", branchName]);
  await runBestEffort(repoRoot, "git", ["push", "origin", "--delete", branchName]);
}

export async function runCommand(
  cwd: string,
  command: string,
  args: string[],
  stdin?: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      shell: false,
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const timeout = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          terminateProcessTree(child.pid, "SIGTERM");
          forceKillTimeout = setTimeout(() => {
            terminateProcessTree(child.pid, "SIGKILL");
          }, 2_000);
        }, timeoutMs)
      : undefined;

    if (stdin && child.stdin) {
      child.stdin.on("error", () => {
        // Child processes such as failed CLI invocations can close stdin before
        // a large prompt finishes writing. The close event still carries the
        // real exit code/stderr, so this stream error should not crash runner.
      });
      child.stdin.write(stdin, () => {
        child.stdin?.end();
      });
    }

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      resolve({ stdout: "", stderr: error.message, exitCode: 127 });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timedOut) {
        // A child can spawn descendants while handling SIGTERM. Sweep the
        // process group again before clearing timeout cleanup.
        terminateProcessTree(child.pid, "SIGKILL");
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: timedOut
          ? `${Buffer.concat(stderr).toString("utf8")}\n${command} timed out after ${timeoutMs}ms`.trim()
          : Buffer.concat(stderr).toString("utf8"),
        exitCode: timedOut ? 124 : (exitCode ?? 1),
        timedOut,
      });
    });
  });
}

async function branchExists(repoRoot: string, branchName: string): Promise<boolean> {
  const result = await runCommand(repoRoot, "git", ["branch", "--list", branchName]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function findWorktreeForBranch(repoRoot: string, branchName: string): Promise<string | null> {
  const result = await runCommand(repoRoot, "git", ["worktree", "list", "--porcelain"]);
  if (result.exitCode !== 0) {
    return null;
  }

  let currentPath: string | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.replace("worktree ", "").trim();
    } else if (line === `branch refs/heads/${branchName}` && currentPath) {
      return currentPath;
    } else if (!line.trim()) {
      currentPath = null;
    }
  }

  return null;
}

async function listConflictedFiles(worktreeRoot: string): Promise<string[]> {
  const result = await runCommand(worktreeRoot, "git", ["diff", "--name-only", "--diff-filter=U"]);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

function isBookkeepingOnlyConflict(files: string[]): boolean {
  return files.length > 0 && files.every((file) => bookkeepingFiles.has(file));
}

async function runBestEffort(cwd: string, command: string, args: string[]): Promise<void> {
  await runCommand(cwd, command, args);
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may already have exited.
    }
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
