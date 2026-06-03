import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectDashboardSnapshot } from "./dashboard-data.js";

describe("codex runner dashboard data", () => {
  it("summarizes backlog progress, runs, worktrees, stale locks, and git productivity metrics", async () => {
    const repoRoot = await createFixtureRepo();
    await writeBacklog(repoRoot);
    await writeRunSummary(repoRoot, "2026-05-21T10-00-00-000Z-TASK-001-first", {
      taskId: "TASK-001",
      title: "First task",
      status: "merged",
      branchName: "codex/TASK-001-first",
      runId: "2026-05-21T10-00-00-000Z-TASK-001-first",
      runDirectory: path.join(repoRoot, "runs/2026-05-21T10-00-00-000Z-TASK-001-first"),
      prUrl: "https://github.test/pull/1",
      warnings: [],
      hardBlocks: [],
    });
    await writeRunSummary(repoRoot, "2026-05-21T10-10-00-000Z-TASK-002-second", {
      taskId: "TASK-002",
      title: "Second task",
      status: "failed",
      branchName: "codex/TASK-002-second",
      runId: "2026-05-21T10-10-00-000Z-TASK-002-second",
      runDirectory: path.join(repoRoot, "runs/2026-05-21T10-10-00-000Z-TASK-002-second"),
      warnings: [],
      hardBlocks: [
        {
          code: "VALIDATION_FAILED",
          severity: "blocked",
          message: "Validation failed.",
          paths: [],
        },
      ],
    });
    const activeRunPath = path.join(repoRoot, "runs/2026-05-21T10-20-00-000Z-TASK-004-fourth");
    await mkdir(activeRunPath, { recursive: true });
    await writeFile(path.join(activeRunPath, "plan.md"), "Plan only");
    await touch(activeRunPath, new Date("2026-05-21T10:20:00Z"));
    await mkdir(
      path.join(repoRoot, ".codex-runner-worktrees/2026-05-21T10-20-00-000Z-TASK-004-fourth"),
      { recursive: true },
    );
    await writeFile(
      path.join(repoRoot, ".codex-runner.lock"),
      JSON.stringify({ pid: 999_999, startedAt: "2026-05-21T10:19:00.000Z" }),
    );
    await writeFile(path.join(repoRoot, "apps/example.ts"), "export const answer = 42;\n");
    await git(repoRoot, ["add", "."]);
    await git(repoRoot, ["commit", "-m", "TASK-001: First task"]);

    const snapshot = await collectDashboardSnapshot(repoRoot, {
      now: new Date("2026-05-21T10:30:00Z"),
      isProcessAlive: () => false,
    });

    expect(snapshot.runner.state).toBe("stale_lock");
    expect(snapshot.backlog.total).toBe(4);
    expect(snapshot.backlog.completed).toBe(1);
    expect(snapshot.backlog.ready.map((task) => task.id)).toEqual(["TASK-002", "TASK-004"]);
    expect(snapshot.backlog.blockedByDependencies.map((task) => task.id)).toEqual(["TASK-003"]);
    expect(snapshot.runs.latest?.taskId).toBe("TASK-004");
    expect(snapshot.runs.latest?.phase).toBe("planning");
    expect(snapshot.runs.failed[0]?.taskId).toBe("TASK-002");
    expect(snapshot.runs.latestMerged?.taskId).toBe("TASK-001");
    expect(snapshot.worktrees.count).toBe(1);
    expect(snapshot.worktrees.items[0]?.taskId).toBe("TASK-004");
    expect(snapshot.git.taskCommitCount).toBe(1);
    expect(snapshot.git.codeAdditions).toBe(1);
    expect(snapshot.productivity.estimatedManualMinutes).toBe(45);
    expect(snapshot.productivity.estimatedSavedMinutes).toBeGreaterThanOrEqual(0);
  });

  it("marks a locked live runner as running", async () => {
    const repoRoot = await createFixtureRepo();
    await writeBacklog(repoRoot);
    await writeFile(
      path.join(repoRoot, ".codex-runner.lock"),
      JSON.stringify({ pid: 1234, startedAt: "2026-05-21T10:00:00.000Z" }),
    );

    const snapshot = await collectDashboardSnapshot(repoRoot, {
      now: new Date("2026-05-21T10:05:00Z"),
      isProcessAlive: (pid) => pid === 1234,
    });

    expect(snapshot.runner.state).toBe("running");
    expect(snapshot.runner.pid).toBe(1234);
    expect(snapshot.runner.uptimeSeconds).toBe(300);
  });
});

const createFixtureRepo = async (): Promise<string> => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "codex-runner-dashboard-"));
  await mkdir(path.join(repoRoot, "apps"), { recursive: true });
  await mkdir(path.join(repoRoot, "runs"), { recursive: true });
  await git(repoRoot, ["init"]);
  await git(repoRoot, ["config", "user.email", "runner@example.test"]);
  await git(repoRoot, ["config", "user.name", "Runner Test"]);
  return repoRoot;
};

const writeBacklog = async (repoRoot: string): Promise<void> => {
  await writeFile(
    path.join(repoRoot, "BACKLOG.md"),
    [
      "### TASK-001 — First task",
      "Status: [x]",
      "Priority: P0",
      "Depends on: None",
      "Validation: Run tests.",
      "",
      "### TASK-002 — Second task",
      "Status: [ ]",
      "Priority: P0",
      "Depends on: TASK-001",
      "Validation: Run tests.",
      "",
      "### TASK-003 — Third task",
      "Status: [ ]",
      "Priority: P0",
      "Depends on: TASK-002",
      "Validation: Run tests.",
      "",
      "### TASK-004 — Fourth task",
      "Status: [ ]",
      "Priority: P1",
      "Depends on: None",
      "Validation: Run tests.",
      "",
    ].join("\n"),
  );
};

const writeRunSummary = async (
  repoRoot: string,
  runId: string,
  summary: Record<string, unknown>,
): Promise<void> => {
  const runPath = path.join(repoRoot, "runs", runId);
  await mkdir(runPath, { recursive: true });
  await writeFile(path.join(runPath, "summary.json"), JSON.stringify(summary, null, 2));
  await touch(runPath, runDate(runId));
};

const runDate = (runId: string): Date => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(runId);

  if (match === null) {
    throw new Error(`Invalid run id ${runId}`);
  }

  const [, date, hour, minute, second, millisecond] = match;
  return new Date(`${date}T${hour}:${minute}:${second}.${millisecond}Z`);
};

const touch = async (targetPath: string, date: Date): Promise<void> => {
  await utimes(targetPath, date, date);
};

const git = async (cwd: string, args: string[]): Promise<void> => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
};
