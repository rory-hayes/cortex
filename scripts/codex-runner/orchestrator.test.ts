import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseArgs, runBacklogRunner } from "./index.js";
import type { ValidationCommand } from "./types.js";

let tempRoots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-orchestrator-"));
  tempRoots.push(root);
  await writeFile(join(root, "AGENTS.md"), "# AGENTS\nFollow rules.\n");
  await writeFile(
    join(root, "README.md"),
    "# Fixture\n\nCurrent next implementation task:\n\n- `TASK-001`: First task.\n",
  );
  await writeFile(
    join(root, "BACKLOG.md"),
    `# BACKLOG.md

### TASK-001 — First task
Status: [ ]
Priority: P0
Depends on: None
Goal: Do the first thing.
Validation: Run node --version.
Completion Notes: Not started.

### TASK-002 — Second task
Status: [ ]
Priority: P0
Depends on: TASK-001
Goal: Do the second thing.
Validation: Run node --version.
Completion Notes: Not started.
`,
  );
  return root;
}

async function makeIndependentRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-orchestrator-"));
  tempRoots.push(root);
  await writeFile(join(root, "AGENTS.md"), "# AGENTS\nFollow rules.\n");
  await writeFile(
    join(root, "README.md"),
    "# Fixture\n\nCurrent next implementation task:\n\n- `TASK-001`: First independent task.\n",
  );
  await writeFile(
    join(root, "BACKLOG.md"),
    `# BACKLOG.md

### TASK-001 — First independent task
Status: [ ]
Priority: P0
Depends on: None
Goal: Do the first thing.
Validation: Run node --version.
Completion Notes: Not started.

### TASK-002 — Second independent task
Status: [ ]
Priority: P0
Depends on: None
Goal: Do the second thing.
Validation: Run node --version.
Completion Notes: Not started.
`,
  );
  return root;
}

async function makeLikelyTouchedRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-orchestrator-"));
  tempRoots.push(root);
  await writeFile(join(root, "AGENTS.md"), "# AGENTS\nFollow rules.\n");
  await writeFile(
    join(root, "README.md"),
    "# Fixture\n\nCurrent next implementation task:\n\n- `TASK-001`: Shared package task.\n",
  );
  await writeFile(
    join(root, "BACKLOG.md"),
    `# BACKLOG.md

### TASK-001 — Shared package task
Status: [ ]
Priority: P0
Depends on: None
Goal: Change shared package exports.
Validation: Run node --version.
Files Likely Touched: packages/shared/src/index.ts, BACKLOG.md, README.md
Completion Notes: Not started.

### TASK-002 — Shared package follow-up
Status: [ ]
Priority: P0
Depends on: None
Goal: Change the same shared package exports.
Validation: Run node --version.
Files Likely Touched: packages/shared/src/index.ts, BACKLOG.md, README.md
Completion Notes: Not started.

### TASK-003 — Independent runner task
Status: [ ]
Priority: P0
Depends on: None
Goal: Change an independent runner file.
Validation: Run node --version.
Files Likely Touched: apps/runner/src/independent.ts, BACKLOG.md, README.md
Completion Notes: Not started.
`,
  );
  return root;
}

async function makeMarkdownWrappedBookkeepingRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-orchestrator-"));
  tempRoots.push(root);
  await writeFile(join(root, "AGENTS.md"), "# AGENTS\nFollow rules.\n");
  await writeFile(
    join(root, "README.md"),
    "# Fixture\n\nCurrent next implementation task:\n\n- `TASK-001`: First markdown task.\n",
  );
  await writeFile(
    join(root, "BACKLOG.md"),
    `# BACKLOG.md

### TASK-001 — First markdown task
Status: [ ]
Priority: P0
Depends on: None
Goal: Change the first independent file.
Validation: Run node --version.
Files Likely Touched: \`apps/runner/src/first.ts\`, \`BACKLOG.md\`, \`README.md\`
Completion Notes: Not started.

### TASK-002 — Second markdown task
Status: [ ]
Priority: P0
Depends on: None
Goal: Change the second independent file.
Validation: Run node --version.
Files Likely Touched: \`packages/logging/src/second.ts\`, \`BACKLOG.md\`, \`README.md\`
Completion Notes: Not started.
`,
  );
  return root;
}

async function makeVerificationMilestoneRoot() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-orchestrator-"));
  tempRoots.push(root);
  await writeFile(join(root, "AGENTS.md"), "# AGENTS\nFollow rules.\n");
  await writeFile(
    join(root, "README.md"),
    "# Fixture\n\nCurrent next implementation task:\n\n- `TASK-001`: Verification milestone.\n",
  );
  await writeFile(
    join(root, "BACKLOG.md"),
    `# BACKLOG.md

### TASK-001 — Verification milestone
Status: [ ]
Priority: P0
Depends on: None
Goal: Confirm an already-implemented milestone.
Validation: Run node --version.
Files Likely Touched: \`BACKLOG.md\`
Completion Notes: Not started.
`,
  );
  return root;
}

async function createMockWorktree(root: string, taskId: string): Promise<string> {
  const worktreeRoot = join(root, "worktrees", taskId);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(
    join(worktreeRoot, "BACKLOG.md"),
    await readFile(join(root, "BACKLOG.md"), "utf8"),
  );
  await writeFile(join(worktreeRoot, "README.md"), await readFile(join(root, "README.md"), "utf8"));
  return worktreeRoot;
}

function passedValidation() {
  return [
    {
      id: "node",
      label: "Node",
      command: "node",
      args: ["--version"],
      timeoutMs: 5_000,
      required: true,
      status: "passed" as const,
      exitCode: 0,
      durationMs: 10,
      stdoutSummary: "v25",
      stderrSummary: "",
      timedOut: false,
    },
  ];
}

function passedMergeValidation(commands: ValidationCommand[]) {
  return commands.map((command) => ({
    ...command,
    status: "passed" as const,
    exitCode: 0,
    durationMs: 10,
    stdoutSummary: "ok",
    stderrSummary: "",
    timedOut: false,
  }));
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe("runner orchestration", () => {
  test("ignores pnpm's literal argument separator", () => {
    expect(parseArgs(["--", "--limit=5", "--approve-plan", "--auto-merge"])).toMatchObject({
      mode: { kind: "limit", value: 5 },
      approvePlan: true,
      autoMerge: true,
    });
  });

  test("parses bounded Codex retry attempts", () => {
    expect(parseArgs(["--limit=1", "--codex-attempts=3"])).toMatchObject({
      codexAttempts: 3,
    });
    expect(() => parseArgs(["--limit=1", "--codex-attempts=0"])).toThrow(
      "--codex-attempts must be a positive integer.",
    );
  });

  test("parses a bounded Codex phase timeout override", () => {
    expect(parseArgs(["--limit=1", "--codex-timeout-ms=1800000"])).toMatchObject({
      codexTimeoutMs: 1_800_000,
    });
    expect(() => parseArgs(["--limit=1", "--codex-timeout-ms=999"])).toThrow(
      "--codex-timeout-ms must be at least 60000 milliseconds.",
    );
  });

  test("parses conservative worker concurrency", () => {
    expect(
      parseArgs(["--limit=5", "--approve-plan", "--auto-merge", "--concurrency=2"]),
    ).toMatchObject({
      concurrency: 2,
    });

    expect(() =>
      parseArgs(["--limit=5", "--approve-plan", "--auto-merge", "--concurrency=0"]),
    ).toThrow("--concurrency must be a positive integer.");
    expect(() => parseArgs(["--limit=5", "--approve-plan", "--concurrency=2"])).toThrow(
      "--concurrency greater than 1 requires --auto-merge.",
    );
    expect(() => parseArgs(["--limit=5", "--auto-merge", "--concurrency=2"])).toThrow(
      "--concurrency greater than 1 requires --approve-plan.",
    );
  });

  test("stops after planning when plan approval is not provided", async () => {
    const root = await makeRoot();

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: false,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => join(root, "worktree"),
        getChangedFiles: async () => [],
        pushBranch: async () => undefined,
        createPr: async () => ({
          branchName: "codex/TASK-001-first-task",
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => {
          throw new Error("implementation should not run");
        },
        codexReview: async () => ({ passed: true, summary: "ok" }),
        validate: async () => [],
      },
    });

    expect(summary.executed).toHaveLength(1);
    expect(summary.executed[0]?.status).toBe("planned");
    expect(await readFile(join(root, "BACKLOG.md"), "utf8")).toContain("Status: [ ]");
  });

  test("dry-run does not invoke Codex", async () => {
    const root = await makeRoot();

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: false,
      dryRun: true,
      adapters: {
        ensureClean: async () => true,
        codexPlan: async () => {
          throw new Error("codex should not run during dry-run");
        },
      },
    });

    expect(summary.executed[0]?.status).toBe("dry_run_passed");
  });

  test("runs approved tasks through validation and updates backlog notes", async () => {
    const root = await makeRoot();
    const order: string[] = [];

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => {
          order.push("create-worktree");
          return root;
        },
        prepareWorktree: async () => {
          order.push("prepare-worktree");
        },
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async () => ({
          branchName: "codex/TASK-001-first-task",
          number: 7,
          url: "https://github.com/example/repo/pull/7",
          draft: true,
        }),
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    const backlog = await readFile(join(root, "BACKLOG.md"), "utf8");

    expect(summary.executed[0]).toMatchObject({
      taskId: "TASK-001",
      status: "pr_opened",
      prUrl: "https://github.com/example/repo/pull/7",
    });
    expect(backlog).toContain("### TASK-001 — First task\nStatus: [x]");
    expect(backlog).toContain("Validation Result: Passed");
    expect(backlog).toContain("Next Recommended Task: TASK-002");
    expect(order.slice(0, 2)).toEqual(["create-worktree", "prepare-worktree"]);
  });

  test("limit mode stops after opening a PR so main can be reviewed and merged manually", async () => {
    const root = await makeRoot();

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 5 },
      approvePlan: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: input.branchName.includes("TASK-001") ? 1 : 2,
          url: `https://github.com/example/repo/pull/${
            input.branchName.includes("TASK-001") ? 1 : 2
          }`,
          draft: true,
        }),
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    expect(summary.executed.map((task) => task.taskId)).toEqual(["TASK-001"]);
    expect(summary.stoppedReason).toBe("awaiting_manual_merge");
  });

  test("auto-merge validates, merges, and continues to the next ready task", async () => {
    const root = await makeRoot();
    const mergedBranches: string[] = [];
    const mergeValidationRuns: string[] = [];

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 5 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: input.branchName.includes("TASK-001") ? 1 : 2,
          url: `https://github.com/example/repo/pull/${
            input.branchName.includes("TASK-001") ? 1 : 2
          }`,
          draft: true,
        }),
        mergeValidate: async (_repoRoot, commands) => {
          mergeValidationRuns.push(commands.map((command) => command.id).join(","));
          return commands.map((command) => ({
            ...command,
            status: "passed" as const,
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "ok",
            stderrSummary: "",
            timedOut: false,
          }));
        },
        mergeBranchToMain: async (_repoRoot, branchName) => {
          mergedBranches.push(branchName);
        },
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    expect(summary.executed.map((task) => task.status)).toEqual(["merged", "merged"]);
    expect(summary.executed.map((task) => task.taskId)).toEqual(["TASK-001", "TASK-002"]);
    expect(mergeValidationRuns).toEqual([
      "typecheck,lint,format:check,test",
      "typecheck,lint,format:check,test",
    ]);
    expect(mergedBranches).toEqual(["codex/TASK-001-first-task", "codex/TASK-002-second-task"]);
    expect(summary.stoppedReason).toBe("completed_ready_tasks");
  });

  test("runs independent tasks in parallel and merges them through a serial queue", async () => {
    const root = await makeIndependentRoot();
    const events: string[] = [];
    const mergedBranches: string[] = [];
    const startedTasks = new Set<string>();
    let resolveBothStarted: () => void = () => undefined;
    let releaseImplementations: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const releaseGate = new Promise<void>((resolve) => {
      releaseImplementations = resolve;
    });

    const running = runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 2 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: input.branchName.includes("TASK-001") ? 1 : 2,
          url: `https://github.com/example/repo/pull/${
            input.branchName.includes("TASK-001") ? 1 : 2
          }`,
          draft: true,
        }),
        refreshBranchFromMain: async (_repoRoot, _worktreeRoot, branchName) => {
          events.push(`refresh:${branchName}`);
        },
        mergeValidate: async (_repoRoot, commands) => {
          events.push("merge-validate");
          return passedMergeValidation(commands);
        },
        mergeBranchToMain: async (_repoRoot, branchName) => {
          events.push(`merge:${branchName}`);
          mergedBranches.push(branchName);
        },
        cleanupTaskResources: async () => undefined,
        codexPlan: async () => "Implementation plan",
        codexImplement: async (_prompt, input) => {
          events.push(`implement-start:${input.task.id}`);
          startedTasks.add(input.task.id);
          if (startedTasks.size === 2) {
            resolveBothStarted();
          }
          await releaseGate;
          events.push(`implement-end:${input.task.id}`);
          return "Implemented";
        },
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => passedValidation(),
      },
    });

    const startupState = await Promise.race([
      bothStarted.then(() => "both-started"),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 2_000)),
    ]);

    if (startupState !== "both-started") {
      releaseImplementations();
      await running.catch(() => undefined);
    }

    expect(startupState).toBe("both-started");
    expect([...events].sort()).toEqual(["implement-start:TASK-001", "implement-start:TASK-002"]);
    expect(events.some((event) => event.startsWith("merge:"))).toBe(false);

    releaseImplementations();
    const summary = await running;

    expect(summary.executed.map((task) => task.taskId).sort()).toEqual(["TASK-001", "TASK-002"]);
    expect(summary.executed.map((task) => task.status).sort()).toEqual(["merged", "merged"]);
    expect(mergedBranches.sort()).toEqual([
      "codex/TASK-001-first-independent-task",
      "codex/TASK-002-second-independent-task",
    ]);
    for (const branchName of mergedBranches) {
      expect(events.indexOf(`refresh:${branchName}`)).toBeGreaterThan(-1);
      expect(events.indexOf(`refresh:${branchName}`)).toBeLessThan(
        events.indexOf(`merge:${branchName}`),
      );
    }
  });

  test("avoids launching ready tasks with overlapping likely-touched files", async () => {
    const root = await makeLikelyTouchedRoot();
    const startedTasks = new Set<string>();
    let resolveBothStarted: () => void = () => undefined;
    let releaseImplementations: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const releaseGate = new Promise<void>((resolve) => {
      releaseImplementations = resolve;
    });

    const running = runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 2 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        refreshBranchFromMain: async () => undefined,
        mergeValidate: async (_repoRoot, commands) => passedMergeValidation(commands),
        mergeBranchToMain: async () => undefined,
        cleanupTaskResources: async () => undefined,
        codexPlan: async () => "Implementation plan",
        codexImplement: async (_prompt, input) => {
          startedTasks.add(input.task.id);
          if (startedTasks.size === 2) {
            resolveBothStarted();
          }
          await releaseGate;
          return "Implemented";
        },
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => passedValidation(),
      },
    });

    const startupState = await Promise.race([
      bothStarted.then(() => "both-started"),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 2_000)),
    ]);

    if (startupState !== "both-started") {
      releaseImplementations();
      await running.catch(() => undefined);
    }

    expect(startupState).toBe("both-started");
    expect([...startedTasks].sort()).toEqual(["TASK-001", "TASK-003"]);

    releaseImplementations();
    await running;
  });

  test("ignores markdown-wrapped bookkeeping paths when scheduling concurrent tasks", async () => {
    const root = await makeMarkdownWrappedBookkeepingRoot();
    const startedTasks = new Set<string>();
    let resolveBothStarted: () => void = () => undefined;
    let releaseImplementations: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const releaseGate = new Promise<void>((resolve) => {
      releaseImplementations = resolve;
    });

    const running = runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 2 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: input.branchName.includes("TASK-001") ? 1 : 2,
          url: `https://github.com/example/repo/pull/${
            input.branchName.includes("TASK-001") ? 1 : 2
          }`,
          draft: true,
        }),
        refreshBranchFromMain: async () => undefined,
        mergeValidate: async (_repoRoot, commands) => passedMergeValidation(commands),
        mergeBranchToMain: async () => undefined,
        cleanupTaskResources: async () => undefined,
        codexPlan: async () => "Implementation plan",
        codexImplement: async (_prompt, input) => {
          startedTasks.add(input.task.id);
          if (startedTasks.size === 2) {
            resolveBothStarted();
          }
          await releaseGate;
          return "Implemented";
        },
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => passedValidation(),
      },
    });

    const startupState = await Promise.race([
      bothStarted.then(() => "both-started"),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 2_000)),
    ]);

    if (startupState !== "both-started") {
      releaseImplementations();
      await running.catch(() => undefined);
    }

    expect(startupState).toBe("both-started");
    expect([...startedTasks].sort()).toEqual(["TASK-001", "TASK-002"]);

    releaseImplementations();
    await running;
  });

  test("defers concurrent backlog and README bookkeeping to the merge queue", async () => {
    const root = await makeIndependentRoot();
    const initialBacklog = await readFile(join(root, "BACKLOG.md"), "utf8");
    const initialReadme = await readFile(join(root, "README.md"), "utf8");
    const commitMessages: string[] = [];
    const commitBodies: string[] = [];
    const events: string[] = [];
    let resetBookkeepingCalled = false;

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        getChangedFiles: async (worktreeRoot) => {
          const changed = ["src/task.ts", "src/task.test.ts"];
          const backlog = await readFile(join(worktreeRoot, "BACKLOG.md"), "utf8");
          const readme = await readFile(join(worktreeRoot, "README.md"), "utf8");
          if (backlog !== initialBacklog) {
            changed.push("BACKLOG.md");
          }
          if (readme !== initialReadme) {
            changed.push("README.md");
          }
          return changed;
        },
        resetBookkeepingFiles: async (worktreeRoot) => {
          resetBookkeepingCalled = true;
          await writeFile(join(worktreeRoot, "BACKLOG.md"), initialBacklog);
          await writeFile(join(worktreeRoot, "README.md"), initialReadme);
        },
        commitChanges: async (_worktreeRoot, message, body) => {
          commitMessages.push(message);
          commitBodies.push(body);
          events.push(`commit:${message}`);
        },
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        refreshBranchFromMain: async () => undefined,
        mergeValidate: async (worktreeRoot, commands) => {
          events.push("merge-validate");
          expect(await readFile(join(worktreeRoot, "BACKLOG.md"), "utf8")).toContain(
            "### TASK-001 — First independent task\nStatus: [x]",
          );
          expect(await readFile(join(worktreeRoot, "README.md"), "utf8")).toContain(
            "Last completed task: `TASK-001` — First independent task.",
          );
          return passedMergeValidation(commands);
        },
        mergeBranchToMain: async () => undefined,
        cleanupTaskResources: async () => undefined,
        codexPlan: async () => "Implementation plan",
        codexImplement: async (_prompt, input) => {
          expect(_prompt).toContain("Do not edit BACKLOG.md or README.md");
          await writeFile(join(input.repoRoot, "BACKLOG.md"), "worker backlog edit\n");
          await writeFile(join(input.repoRoot, "README.md"), "worker readme edit\n");
          await mkdir(join(input.repoRoot, "src"), { recursive: true });
          await writeFile(join(input.repoRoot, "src", "task.ts"), "export const task = true;\n");
          await writeFile(join(input.repoRoot, "src", "task.test.ts"), "test.todo('task');\n");
          return "Implemented";
        },
        codexReview: async (_prompt) => {
          expect(_prompt).toContain("Do not require BACKLOG.md or README.md edits");
          return { passed: true, summary: "Review passed" };
        },
        validate: async () => passedValidation(),
      },
    });

    expect(summary.executed[0]?.status).toBe("merged");
    expect(resetBookkeepingCalled).toBe(true);
    expect(commitMessages[0]).toBe("TASK-001: First independent task");
    expect(commitBodies[0]).not.toContain("- BACKLOG.md");
    expect(commitBodies[0]).not.toContain("- README.md");
    expect(commitMessages[1]).toBe("TASK-001: Record backlog completion");
    expect(events.indexOf("commit:TASK-001: Record backlog completion")).toBeLessThan(
      events.indexOf("merge-validate"),
    );
  });

  test("prepares a queued worktree again after refreshing from main", async () => {
    const root = await makeIndependentRoot();
    const events: string[] = [];

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        prepareWorktree: async () => {
          events.push("prepare");
        },
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        commitChanges: async (_worktreeRoot, message) => {
          events.push(`commit:${message}`);
        },
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        refreshBranchFromMain: async () => {
          events.push("refresh");
        },
        mergeValidate: async (_repoRoot, commands) => {
          events.push("merge-validate");
          return passedMergeValidation(commands);
        },
        mergeBranchToMain: async () => {
          events.push("merge");
        },
        cleanupTaskResources: async () => undefined,
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => passedValidation(),
      },
    });

    expect(summary.executed[0]?.status).toBe("merged");
    expect(events).toContain("prepare");
    expect(events.indexOf("refresh")).toBeGreaterThan(-1);
    expect(events.indexOf("refresh")).toBeLessThan(events.lastIndexOf("prepare"));
    expect(events.lastIndexOf("prepare")).toBeLessThan(events.indexOf("merge-validate"));
  });

  test("merges no-change milestone tasks through bookkeeping-only queue commits", async () => {
    const root = await makeVerificationMilestoneRoot();
    const initialBacklog = await readFile(join(root, "BACKLOG.md"), "utf8");
    const initialReadme = await readFile(join(root, "README.md"), "utf8");
    const commitMessages: string[] = [];
    const createdPrBodies: string[] = [];

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        getChangedFiles: async (worktreeRoot) => {
          const changed: string[] = [];
          const backlog = await readFile(join(worktreeRoot, "BACKLOG.md"), "utf8");
          const readme = await readFile(join(worktreeRoot, "README.md"), "utf8");
          if (backlog !== initialBacklog) {
            changed.push("BACKLOG.md");
          }
          if (readme !== initialReadme) {
            changed.push("README.md");
          }
          return changed;
        },
        resetBookkeepingFiles: async (worktreeRoot) => {
          await writeFile(join(worktreeRoot, "BACKLOG.md"), initialBacklog);
          await writeFile(join(worktreeRoot, "README.md"), initialReadme);
        },
        commitChanges: async (_worktreeRoot, message) => {
          if (message === "TASK-001: Verification milestone") {
            throw new Error("source commit should be skipped for no-change milestones");
          }
          commitMessages.push(message);
        },
        pushBranch: async () => undefined,
        findExistingPr: async () => null,
        createPr: async (_repoRoot, input) => {
          createdPrBodies.push(input.body);
          return {
            branchName: input.branchName,
            number: 1,
            url: "https://github.com/example/repo/pull/1",
            draft: true,
          };
        },
        refreshBranchFromMain: async () => undefined,
        mergeValidate: async (_repoRoot, commands) => passedMergeValidation(commands),
        mergeBranchToMain: async () => undefined,
        cleanupTaskResources: async () => undefined,
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "No source changes required",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => passedValidation(),
      },
    });

    expect(summary.executed[0]?.status).toBe("merged");
    expect(commitMessages).toEqual(["TASK-001: Record backlog completion"]);
    expect(createdPrBodies[0]).toContain("- BACKLOG.md");
    expect(createdPrBodies[0]).toContain("- README.md");
  });

  test("keeps merging completed independent work when one worker fails", async () => {
    const root = await makeIndependentRoot();
    const mergedBranches: string[] = [];

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 2 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      codexAttempts: 1,
      concurrency: 2,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async (_repoRoot, task) => createMockWorktree(root, task.id),
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: input.branchName.includes("TASK-001") ? 1 : 2,
          url: `https://github.com/example/repo/pull/${
            input.branchName.includes("TASK-001") ? 1 : 2
          }`,
          draft: true,
        }),
        refreshBranchFromMain: async () => undefined,
        mergeValidate: async (_repoRoot, commands) => passedMergeValidation(commands),
        mergeBranchToMain: async (_repoRoot, branchName) => {
          mergedBranches.push(branchName);
        },
        cleanupTaskResources: async () => undefined,
        codexPlan: async (_prompt, input) => {
          if (input.task.id === "TASK-001") {
            throw new Error("codex timed out after 600000ms");
          }
          return "Implementation plan";
        },
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => passedValidation(),
      },
    });

    expect(summary.executed).toHaveLength(2);
    expect(summary.executed.find((task) => task.taskId === "TASK-001")?.status).toBe("failed");
    expect(summary.executed.find((task) => task.taskId === "TASK-002")?.status).toBe("merged");
    expect(summary.stoppedReason).toBe("failed");
    expect(mergedBranches).toEqual(["codex/TASK-002-second-independent-task"]);
  });

  test("auto-merge blocks when full merge validation fails", async () => {
    const root = await makeRoot();
    let mergeCalled = false;

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 5 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        mergeValidate: async (_repoRoot, commands) =>
          commands.map((command) => ({
            ...command,
            status: command.id === "test" ? ("failed" as const) : ("passed" as const),
            exitCode: command.id === "test" ? 1 : 0,
            durationMs: 10,
            stdoutSummary: "",
            stderrSummary: command.id === "test" ? "test failed" : "",
            timedOut: false,
          })),
        mergeBranchToMain: async () => {
          mergeCalled = true;
        },
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    expect(summary.executed).toHaveLength(1);
    expect(summary.executed[0]?.status).toBe("merge_blocked");
    expect(summary.stoppedReason).toBe("merge_blocked");
    expect(mergeCalled).toBe(false);
  });

  test("uses a runner lock so concurrent runs cannot touch the same backlog", async () => {
    const root = await makeRoot();
    await writeFile(join(root, ".codex-runner.lock"), "existing run\n");

    const locked = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: false,
      dryRun: true,
      adapters: {
        ensureClean: async () => {
          throw new Error("clean check should not run while locked");
        },
      },
    });

    expect(locked.stoppedReason).toBe("runner_locked");
    expect(locked.executed).toEqual([]);

    await rm(join(root, ".codex-runner.lock"));

    const unlocked = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: false,
      dryRun: true,
      adapters: {
        ensureClean: async () => true,
      },
    });

    expect(unlocked.stoppedReason).toBe("dry_run_complete");
    await expect(readFile(join(root, ".codex-runner.lock"), "utf8")).rejects.toThrow();
  });

  test("recovers stale runner locks for dead processes", async () => {
    const root = await makeRoot();
    await writeFile(
      join(root, ".codex-runner.lock"),
      JSON.stringify({ pid: 999_999_999, startedAt: "2020-01-01T00:00:00.000Z" }),
    );

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: false,
      dryRun: true,
      adapters: {
        ensureClean: async () => true,
      },
    });

    expect(summary.stoppedReason).toBe("dry_run_complete");
    await expect(readFile(join(root, ".codex-runner.lock"), "utf8")).rejects.toThrow();
  });

  test("retries transient Codex implementation failures before blocking the task", async () => {
    const root = await makeRoot();
    let implementAttempts = 0;

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => {
          implementAttempts += 1;
          if (implementAttempts === 1) {
            throw new Error("codex timed out after 600000ms");
          }
          return "Implemented after retry";
        },
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    expect(implementAttempts).toBe(2);
    expect(summary.executed[0]?.status).toBe("pr_opened");
    const retryArtifact = await readFile(
      join(summary.executed[0]!.runDirectory, "codex-implement-attempt-1.json"),
      "utf8",
    );
    expect(retryArtifact).toContain("timed_out");
  });

  test("records timeout artifacts and stops cleanly when a Codex phase exhausts retries", async () => {
    const root = await makeRoot();
    const noisyTimeout = `codex exec failed: ${Array.from(
      { length: 250 },
      (_, index) => `WARN codex startup noise ${index}`,
    ).join("\n")}\n\ncodex timed out after 600000ms`;

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      dryRun: false,
      codexAttempts: 1,
      adapters: {
        ensureClean: async () => true,
        codexPlan: async () => {
          throw new Error(noisyTimeout);
        },
      },
    });

    expect(summary.executed[0]?.status).toBe("failed");
    expect(summary.stoppedReason).toBe("failed");
    expect(summary.executed[0]?.hardBlocks[0]?.code).toBe("CODEX_PHASE_TIMEOUT");
    const failure = await readFile(join(summary.executed[0]!.runDirectory, "failure.json"), "utf8");
    expect(failure).toContain('"phase": "plan"');
    expect(failure).toContain('"classification": "timed_out"');
    expect(failure).toContain("codex timed out after 600000ms");
    expect(failure).toContain("[omitted");
    expect(failure.length).toBeLessThan(2_500);
  });

  test("reuses an existing task PR instead of creating a duplicate", async () => {
    const root = await makeRoot();
    let createPrCalled = false;

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        findExistingPr: async (_repoRoot, branchName) => ({
          branchName,
          number: 42,
          url: "https://github.com/example/repo/pull/42",
          draft: true,
        }),
        createPr: async () => {
          createPrCalled = true;
          throw new Error("duplicate PR should not be created");
        },
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    expect(createPrCalled).toBe(false);
    expect(summary.executed[0]?.prUrl).toBe("https://github.com/example/repo/pull/42");
  });

  test("cleans task worktrees and branches after successful auto-merge", async () => {
    const root = await makeRoot();
    const cleaned: string[] = [];

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      autoMerge: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        mergeValidate: async (_repoRoot, commands) =>
          commands.map((command) => ({
            ...command,
            status: "passed" as const,
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "",
            stderrSummary: "",
            timedOut: false,
          })),
        mergeBranchToMain: async () => undefined,
        cleanupTaskResources: async (_repoRoot, worktreeRoot, branchName) => {
          cleaned.push(`${worktreeRoot}:${branchName}`);
        },
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    expect(summary.executed[0]?.status).toBe("merged");
    expect(cleaned).toEqual([`${root}:codex/TASK-001-first-task`]);
  });

  test("does not persist raw implementation diffs in run artifacts", async () => {
    const root = await makeRoot();

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      dryRun: false,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        pushBranch: async () => undefined,
        createPr: async (_repoRoot, input) => ({
          branchName: input.branchName,
          number: 1,
          url: "https://github.com/example/repo/pull/1",
          draft: true,
        }),
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "diff --git a/src/task.ts b/src/task.ts",
        codexReview: async () => ({ passed: true, summary: "Review passed" }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    const files = await readdir(summary.executed[0]!.runDirectory);
    const artifactText = (
      await Promise.all(
        files.map((file) => readFile(join(summary.executed[0]!.runDirectory, file), "utf8")),
      )
    ).join("\n");

    expect(artifactText).not.toContain("diff --git");
  });

  test("does not persist raw review diffs in run artifacts", async () => {
    const root = await makeRoot();

    const summary = await runBacklogRunner({
      repoRoot: root,
      mode: { kind: "limit", value: 1 },
      approvePlan: true,
      dryRun: false,
      fixAttempts: 0,
      adapters: {
        ensureClean: async () => true,
        createWorktree: async () => root,
        getChangedFiles: async () => ["src/task.ts", "src/task.test.ts"],
        codexPlan: async () => "Implementation plan",
        codexImplement: async () => "Implemented",
        codexReview: async () => ({
          passed: false,
          summary: "diff --git a/src/task.ts b/src/task.ts",
        }),
        validate: async () => [
          {
            id: "node",
            label: "Node",
            command: "node",
            args: ["--version"],
            timeoutMs: 5_000,
            required: true,
            status: "passed",
            exitCode: 0,
            durationMs: 10,
            stdoutSummary: "v25",
            stderrSummary: "",
            timedOut: false,
          },
        ],
      },
    });

    const files = await readdir(summary.executed[0]!.runDirectory);
    const artifactText = (
      await Promise.all(
        files.map((file) => readFile(join(summary.executed[0]!.runDirectory, file), "utf8")),
      )
    ).join("\n");

    expect(summary.executed[0]?.status).toBe("blocked");
    expect(artifactText).not.toContain("diff --git");
  });
});
