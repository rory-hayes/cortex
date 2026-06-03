import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parseBacklog, selectReadyTasks } from "./backlog.js";
import type { BacklogTask, ExecutedTaskSummary, RunTaskStatus } from "./types.js";

export type DashboardRunnerState = "running" | "stopped" | "stale_lock";

export type DashboardTaskSummary = {
  id: string;
  title: string;
  priority: string;
  status: string;
  dependsOn: string[];
};

export type DashboardRunSummary = {
  runId: string;
  taskId: string;
  title: string;
  status: RunTaskStatus | "active" | "unknown";
  phase: string;
  runDirectory: string;
  branchName?: string;
  prUrl?: string;
  warningCount: number;
  hardBlockCount: number;
  latestWarning?: string;
  latestHardBlock?: string;
  startedAt?: string;
  updatedAt?: string;
  durationMinutes?: number;
};

export type DashboardSnapshot = {
  generatedAt: string;
  repoRoot: string;
  runner: {
    state: DashboardRunnerState;
    lockPresent: boolean;
    pid?: number;
    startedAt?: string;
    uptimeSeconds?: number;
    command?: string;
  };
  backlog: {
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
    open: number;
    completionPercent: number;
    ready: DashboardTaskSummary[];
    blockedByDependencies: DashboardTaskSummary[];
    latestCompleted?: DashboardTaskSummary;
  };
  runs: {
    total: number;
    latest?: DashboardRunSummary;
    latestMerged?: DashboardRunSummary;
    active: DashboardRunSummary[];
    failed: DashboardRunSummary[];
    recent: DashboardRunSummary[];
  };
  worktrees: {
    count: number;
    items: {
      path: string;
      name: string;
      taskId?: string;
    }[];
  };
  git: {
    branch?: string;
    head?: string;
    taskCommitCount: number;
    codeAdditions: number;
    codeDeletions: number;
    latestTaskCommit?: {
      hash: string;
      subject: string;
    };
  };
  productivity: {
    mergedRunCount: number;
    heuristicMinutesPerTask: number;
    estimatedManualMinutes: number;
    observedAutomationMinutes: number;
    estimatedSavedMinutes: number;
  };
};

export type DashboardCollectorOptions = {
  now?: Date;
  isProcessAlive?: (pid: number) => boolean;
};

type RunnerLock = {
  pid?: number;
  startedAt?: string;
};

type RunDirectory = {
  name: string;
  absolutePath: string;
  mtimeMs: number;
  updatedAt: string;
};

const MAX_RECENT_RUNS = 20;
const MAX_READY_TASKS = 8;
const MANUAL_MINUTES_PER_TASK = 45;

export const collectDashboardSnapshot = async (
  repoRoot: string,
  options: DashboardCollectorOptions = {},
): Promise<DashboardSnapshot> => {
  const now = options.now ?? new Date();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const [runner, backlog, runs, worktrees, git] = await Promise.all([
    collectRunnerStatus(repoRoot, now, isProcessAlive),
    collectBacklogStatus(repoRoot),
    collectRunStatus(repoRoot),
    collectWorktrees(repoRoot),
    collectGitStatus(repoRoot),
  ]);

  return {
    generatedAt: now.toISOString(),
    repoRoot,
    runner,
    backlog,
    runs,
    worktrees,
    git,
    productivity: collectProductivity(runs),
  };
};

const collectRunnerStatus = async (
  repoRoot: string,
  now: Date,
  isProcessAlive: (pid: number) => boolean,
): Promise<DashboardSnapshot["runner"]> => {
  const lockPath = path.join(repoRoot, ".codex-runner.lock");
  const lock = await readJsonFile<RunnerLock>(lockPath);

  if (lock === undefined) {
    return { state: "stopped", lockPresent: false };
  }

  const pid = typeof lock.pid === "number" ? lock.pid : undefined;
  const startedAt = typeof lock.startedAt === "string" ? lock.startedAt : undefined;
  const running = pid !== undefined && isProcessAlive(pid);
  const command = pid !== undefined && running ? readProcessCommand(pid) : undefined;
  const uptimeSeconds =
    running && startedAt !== undefined
      ? Math.max(0, Math.round((now.getTime() - Date.parse(startedAt)) / 1000))
      : undefined;

  return {
    state: running ? "running" : "stale_lock",
    lockPresent: true,
    ...(pid !== undefined ? { pid } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
    ...(command !== undefined ? { command } : {}),
  };
};

const collectBacklogStatus = async (repoRoot: string): Promise<DashboardSnapshot["backlog"]> => {
  const backlogPath = path.join(repoRoot, "BACKLOG.md");
  const markdown = await readTextFile(backlogPath);

  if (markdown === undefined) {
    return {
      total: 0,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      open: 0,
      completionPercent: 0,
      ready: [],
      blockedByDependencies: [],
    };
  }

  const parsed = parseBacklog(markdown);
  const completedIds = new Set(
    parsed.tasks.filter((task) => task.status === "[x]").map((task) => task.id),
  );
  const ready = selectReadyTasks(parsed, { limit: MAX_READY_TASKS }).map(toTaskSummary);
  const incomplete = parsed.tasks.filter((task) => task.status === "[ ]");
  const blockedByDependencies = incomplete
    .filter((task) => task.dependsOn.some((dependency) => !completedIds.has(dependency)))
    .slice(0, MAX_READY_TASKS)
    .map(toTaskSummary);
  const completedTasks = parsed.tasks.filter((task) => task.status === "[x]");
  const completed = completedTasks.length;
  const total = parsed.tasks.length;

  return {
    total,
    completed,
    inProgress: parsed.tasks.filter((task) => task.status === "[~]").length,
    blocked: parsed.tasks.filter((task) => task.status === "[!]").length,
    open: incomplete.length,
    completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
    ready,
    blockedByDependencies,
    ...(completedTasks.at(-1) ? { latestCompleted: toTaskSummary(completedTasks.at(-1)!) } : {}),
  };
};

const collectRunStatus = async (repoRoot: string): Promise<DashboardSnapshot["runs"]> => {
  const runDirectories = await listRunDirectories(path.join(repoRoot, "runs"));
  const recent = (
    await Promise.all(runDirectories.slice(0, MAX_RECENT_RUNS).map(readDashboardRunSummary))
  ).filter((run): run is DashboardRunSummary => run !== undefined);
  const active = recent.filter((run) => run.status === "active");
  const failed = recent.filter(
    (run) => run.status === "failed" || run.status === "merge_blocked" || run.status === "blocked",
  );
  const latestMerged = recent.find((run) => run.status === "merged");

  return {
    total: runDirectories.length,
    ...(recent[0] ? { latest: recent[0] } : {}),
    ...(latestMerged !== undefined ? { latestMerged } : {}),
    active,
    failed,
    recent,
  };
};

const collectWorktrees = async (repoRoot: string): Promise<DashboardSnapshot["worktrees"]> => {
  const worktreeRoot = path.join(repoRoot, ".codex-runner-worktrees");
  const entries = await safeReaddir(worktreeRoot);
  const items = entries
    .filter((entry) => entry.isDirectory() && entry.name.includes("TASK-"))
    .map((entry) => {
      const taskId = extractTaskId(entry.name);
      return {
        path: path.join(worktreeRoot, entry.name),
        name: entry.name,
        ...(taskId ? { taskId } : {}),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    count: items.length,
    items,
  };
};

const collectGitStatus = async (repoRoot: string): Promise<DashboardSnapshot["git"]> => {
  const taskCommits = gitLines(repoRoot, [
    "log",
    "--format=%H%x09%s",
    "--grep=^TASK-[0-9]",
    "--regexp-ignore-case",
  ]);
  const latestTaskCommit = parseLatestTaskCommit(taskCommits[0]);
  const { additions, deletions } = parseNumstat(
    gitLines(repoRoot, [
      "log",
      "--numstat",
      "--pretty=format:",
      "--grep=^TASK-[0-9]",
      "--regexp-ignore-case",
      "--",
      "apps",
      "packages",
      "scripts",
    ]),
  );
  const branch = gitText(repoRoot, ["branch", "--show-current"]);
  const head = gitText(repoRoot, ["rev-parse", "--short", "HEAD"]);

  return {
    ...(branch !== undefined ? { branch } : {}),
    ...(head !== undefined ? { head } : {}),
    taskCommitCount: taskCommits.length,
    codeAdditions: additions,
    codeDeletions: deletions,
    ...(latestTaskCommit ? { latestTaskCommit } : {}),
  };
};

const collectProductivity = (
  runs: DashboardSnapshot["runs"],
): DashboardSnapshot["productivity"] => {
  const mergedRuns = runs.recent.filter((run) => run.status === "merged");
  const observedAutomationMinutes = Math.round(
    mergedRuns.reduce((total, run) => total + (run.durationMinutes ?? 0), 0),
  );
  const estimatedManualMinutes = mergedRuns.length * MANUAL_MINUTES_PER_TASK;

  return {
    mergedRunCount: mergedRuns.length,
    heuristicMinutesPerTask: MANUAL_MINUTES_PER_TASK,
    estimatedManualMinutes,
    observedAutomationMinutes,
    estimatedSavedMinutes: Math.max(0, estimatedManualMinutes - observedAutomationMinutes),
  };
};

const readDashboardRunSummary = async (
  runDirectory: RunDirectory,
): Promise<DashboardRunSummary | undefined> => {
  const summaryPath = path.join(runDirectory.absolutePath, "summary.json");
  const summary = await readJsonFile<Partial<ExecutedTaskSummary>>(summaryPath);
  const taskId = summary?.taskId ?? extractTaskId(runDirectory.name) ?? "UNKNOWN";
  const title = summary?.title ?? titleFromRunName(runDirectory.name, taskId);
  const status = summary?.status ?? "active";
  const startedAt = startedAtFromRunId(runDirectory.name);
  const durationMinutes =
    startedAt === undefined
      ? undefined
      : Math.max(0, (runDirectory.mtimeMs - Date.parse(startedAt)) / 60_000);
  const warnings = Array.isArray(summary?.warnings) ? summary.warnings : [];
  const hardBlocks = Array.isArray(summary?.hardBlocks) ? summary.hardBlocks : [];
  const latestWarning = safeFindingMessage(warnings.at(-1));
  const latestHardBlock = safeFindingMessage(hardBlocks.at(-1));

  return {
    runId: summary?.runId ?? runDirectory.name,
    taskId,
    title,
    status,
    phase: summary?.status ?? (await inferRunPhase(runDirectory.absolutePath)),
    runDirectory: runDirectory.absolutePath,
    ...(summary?.branchName ? { branchName: summary.branchName } : {}),
    ...(summary?.prUrl ? { prUrl: summary.prUrl } : {}),
    warningCount: warnings.length,
    hardBlockCount: hardBlocks.length,
    ...(latestWarning !== undefined ? { latestWarning } : {}),
    ...(latestHardBlock !== undefined ? { latestHardBlock } : {}),
    ...(startedAt ? { startedAt } : {}),
    updatedAt: runDirectory.updatedAt,
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  };
};

const listRunDirectories = async (runsRoot: string): Promise<RunDirectory[]> => {
  const entries = await safeReaddir(runsRoot);
  const directories = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("20"))
      .map(async (entry) => {
        const absolutePath = path.join(runsRoot, entry.name);
        const stats = await stat(absolutePath);

        return {
          name: entry.name,
          absolutePath,
          mtimeMs: stats.mtimeMs,
          updatedAt: stats.mtime.toISOString(),
        };
      }),
  );

  return directories.sort((left, right) => right.mtimeMs - left.mtimeMs);
};

const inferRunPhase = async (runDirectory: string): Promise<string> => {
  const entries = (await safeReaddir(runDirectory)).map((entry) => entry.name);

  if (entries.includes("merge-validation.json")) {
    return "merge validation";
  }
  if (entries.some((entry) => entry.startsWith("validation-attempt-"))) {
    return "validation";
  }
  if (entries.some((entry) => entry.startsWith("quality-attempt-"))) {
    return "quality gate";
  }
  if (entries.some((entry) => entry.startsWith("review-attempt-"))) {
    return "review";
  }
  if (entries.includes("implementation-summary.txt")) {
    return "implemented";
  }
  if (entries.includes("plan.md")) {
    return "planning";
  }

  return "created";
};

const readJsonFile = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const readTextFile = async (filePath: string): Promise<string | undefined> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
};

const safeReaddir = async (directoryPath: string) => {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
};

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readProcessCommand = (pid: number): string | undefined => {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return undefined;
  }

  const command = result.stdout.trim();
  return command.length > 0 ? truncate(command, 240) : undefined;
};

const gitText = (repoRoot: string, args: string[]): string | undefined => {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });

  if (result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
};

const gitLines = (repoRoot: string, args: string[]): string[] => {
  const value = gitText(repoRoot, args);
  return value === undefined ? [] : value.split("\n").filter(Boolean);
};

const parseNumstat = (lines: string[]): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    const [rawAdditions, rawDeletions] = line.split("\t");
    const nextAdditions = Number.parseInt(rawAdditions ?? "", 10);
    const nextDeletions = Number.parseInt(rawDeletions ?? "", 10);

    if (Number.isSafeInteger(nextAdditions)) {
      additions += nextAdditions;
    }
    if (Number.isSafeInteger(nextDeletions)) {
      deletions += nextDeletions;
    }
  }

  return { additions, deletions };
};

const parseLatestTaskCommit = (
  line: string | undefined,
): DashboardSnapshot["git"]["latestTaskCommit"] | undefined => {
  if (line === undefined) {
    return undefined;
  }

  const [hash, subject] = line.split("\t");
  return hash && subject ? { hash: hash.slice(0, 12), subject } : undefined;
};

const toTaskSummary = (task: BacklogTask): DashboardTaskSummary => ({
  id: task.id,
  title: task.title,
  priority: task.priority,
  status: task.status,
  dependsOn: task.dependsOn,
});

const safeFindingMessage = (finding: unknown): string | undefined => {
  if (typeof finding !== "object" || finding === null) {
    return undefined;
  }

  const message = "message" in finding ? finding.message : undefined;
  return typeof message === "string"
    ? truncate(message.replace(/\s+/g, " ").trim(), 240)
    : undefined;
};

const startedAtFromRunId = (runId: string): string | undefined => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(runId);

  if (match === null) {
    return undefined;
  }

  const [, date, hour, minute, second, millisecond] = match;
  return `${date}T${hour}:${minute}:${second}.${millisecond}Z`;
};

const extractTaskId = (value: string): string | undefined => value.match(/TASK-\d+/)?.[0];

const titleFromRunName = (name: string, taskId: string): string =>
  name
    .slice(name.indexOf(taskId) + taskId.length)
    .replace(/^-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim() || taskId;

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
