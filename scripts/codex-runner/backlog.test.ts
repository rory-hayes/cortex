import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseBacklog, selectReadyTasks, updateTaskStatus } from "./backlog.js";
import { validationCommandsFromTask } from "./validation.js";

const backlogFixture = `# BACKLOG.md

## 1. Project Foundation

### TASK-001 — Lock package manager and workspace strategy
Status: [x]
Milestone: Project Foundation
Priority: P0
Depends on: None
Goal: Establish pnpm.
Validation: Run pnpm --version.
Completion Notes: Done.

### TASK-002 — Add root script surface
Status: [ ]
Milestone: Project Foundation
Priority: P0
Depends on: TASK-001
Goal: Provide commands.
Acceptance Criteria: Scripts exist.
Validation: Run pnpm test.
Completion Notes: Not started.

### TASK-003 — Add TypeScript config baseline
Status: [ ]
Milestone: Project Foundation
Priority: P1
Depends on: TASK-999
Goal: Establish TS.
Validation: Run pnpm typecheck.
Completion Notes: Not started.
`;

describe("backlog parsing", () => {
  test("parses task metadata from this repository's markdown shape", () => {
    const parsed = parseBacklog(backlogFixture);

    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.tasks[1]).toMatchObject({
      id: "TASK-002",
      title: "Add root script surface",
      status: "[ ]",
      priority: "P0",
      dependsOn: ["TASK-001"],
      validation: "Run pnpm test.",
      acceptanceCriteria: "Scripts exist.",
    });
  });

  test("parses refactor backlog task ids", () => {
    const parsed = parseBacklog(`# BACKLOG.md

### RFB-001 — Create refactor branch
Status: [ ]
Milestone: Refactor Preparation
Priority: P0
Depends on: None
Goal: Start the refactor safely.
Acceptance Criteria: Refactor backlog can run.
Validation: Run pnpm test.
Completion Notes: Not started.
`);

    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]).toMatchObject({
      id: "RFB-001",
      title: "Create refactor branch",
      status: "[ ]",
      priority: "P0",
      dependsOn: [],
    });
  });

  test("selects only incomplete tasks whose dependencies are completed", () => {
    const ready = selectReadyTasks(parseBacklog(backlogFixture), { limit: 5 });

    expect(ready.map((task) => task.id)).toEqual(["TASK-002"]);
  });

  test("honors limit and backlog order for equally prioritized ready tasks", () => {
    const markdown = backlogFixture.replace("Depends on: TASK-999", "Depends on: TASK-001");

    const ready = selectReadyTasks(parseBacklog(markdown), { limit: 1 });

    expect(ready.map((task) => task.id)).toEqual(["TASK-002"]);
  });

  test("updates only the selected task status and appends validation evidence", () => {
    const updated = updateTaskStatus(backlogFixture, "TASK-002", {
      status: "[~]",
      completionNotes:
        "Run run-2026-05-14-TASK-002 started on branch codex/TASK-002-add-root-script-surface.",
      validationResult: "Pending plan approval.",
      nextRecommendedTask: "TASK-003",
    });

    expect(updated).toContain("### TASK-001 — Lock package manager");
    expect(updated).toContain("Status: [x]");
    expect(updated).toContain("### TASK-002 — Add root script surface\nStatus: [~]");
    expect(updated).toContain("Completion Notes: Run run-2026-05-14-TASK-002 started");
    expect(updated).toContain("Validation Result: Pending plan approval.");
    expect(updated).toContain("Next Recommended Task: TASK-003");
  });

  test("RFB-058 declares discoverable validation commands for repair runs", () => {
    const backlog = readFileSync(new URL("../../BACKLOG.md", import.meta.url), "utf8");
    const task = parseBacklog(backlog).tasks.find((candidate) => candidate.id === "RFB-058");

    expect(task).toBeDefined();
    expect(
      validationCommandsFromTask(task?.validation ?? "").map((command) => command.command),
    ).toEqual(["pnpm", "pnpm", "pnpm", "pnpm"]);
    expect(
      validationCommandsFromTask(task?.validation ?? "").map((command) => command.args),
    ).toEqual([["run", "typecheck"], ["run", "lint"], ["run", "format:check"], ["test"]]);
  });
});
