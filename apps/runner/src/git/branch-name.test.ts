import { describe, expect, it } from "vitest";

import {
  BRANCH_NAME_PREFIX,
  createTaskBranchName,
  isSafeBranchName,
  sanitizeBranchNameSegment,
  type BranchNameTaskPacketInput,
} from "./branch-name.js";
import {
  createTaskBranchName as createTaskBranchNameFromEntrypoint,
  type BranchNameTaskPacketInput as BranchNameTaskPacketInputFromEntrypoint,
} from "../index.js";

const BASE_TASK = {
  contractVersion: "2026-05-10.v1",
  id: "TASK-050",
  repositoryId: "repo-alpha",
  runId: "run-001",
} satisfies BranchNameTaskPacketInput;

const branchSuffix = (branchName: string): string =>
  branchName.slice(branchName.lastIndexOf("-") + 1);

describe("branch name helper", () => {
  it("creates a deterministic aicp-prefixed branch name from task identity", () => {
    expect(createTaskBranchName(BASE_TASK)).toBe("aicp/task-050-run-001-9dec52fae849");
    expect(createTaskBranchName({ ...BASE_TASK })).toBe(createTaskBranchName(BASE_TASK));
    expect(createTaskBranchName(BASE_TASK).startsWith(`${BRANCH_NAME_PREFIX}/`)).toBe(true);
    expect(isSafeBranchName(createTaskBranchName(BASE_TASK))).toBe(true);
  });

  it("changes the hash suffix when the task id or run id changes", () => {
    const baseSuffix = branchSuffix(createTaskBranchName(BASE_TASK));
    const changedTaskSuffix = branchSuffix(
      createTaskBranchName({
        ...BASE_TASK,
        id: "TASK-051",
      }),
    );
    const changedRunSuffix = branchSuffix(
      createTaskBranchName({
        ...BASE_TASK,
        runId: "run-002",
      }),
    );

    expect(changedTaskSuffix).not.toBe(baseSuffix);
    expect(changedRunSuffix).not.toBe(baseSuffix);
    expect(changedTaskSuffix).toMatch(/^[a-f0-9]{12}$/u);
    expect(changedRunSuffix).toMatch(/^[a-f0-9]{12}$/u);
  });

  it.each([
    ["spaces and slashes", "Task 050/run branch", "task-050-run-branch"],
    ["punctuation and git metacharacters", "TASK@{050}:feature?*[x]^~\\", "task-050-feature-x"],
    ["unicode and control characters", "TÂSK-\u0001-東京-\u007F-050", "task-050"],
    ["dot traversal and lock suffix", "../TASK..050.lock", "task-050"],
  ])("normalizes %s inside visible branch segments", (_label, value, expected) => {
    const segment = sanitizeBranchNameSegment(value, "fallback");

    expect(segment).toBe(expected);
    expect(segment.startsWith("-")).toBe(false);
    expect(segment.endsWith("-")).toBe(false);
    expect(segment.includes("..")).toBe(false);
    expect(segment.includes("@{")).toBe(false);
    expect(segment.endsWith(".lock")).toBe(false);
  });

  it("creates generated names without unsafe separators or edge characters", () => {
    const branchName = createTaskBranchName({
      ...BASE_TASK,
      id: "/.. weird TASK.lock @{ value //",
      runId: "/// run id with spaces ///",
    });

    expect(branchName).toMatch(
      /^aicp\/[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{12}$/u,
    );
    expect(branchName.startsWith("/")).toBe(false);
    expect(branchName.endsWith("/")).toBe(false);
    expect(branchName.endsWith("-")).toBe(false);
    expect(branchName.endsWith(".")).toBe(false);
    expect(branchName.includes("//")).toBe(false);
    expect(isSafeBranchName(branchName)).toBe(true);
  });

  it("does not include task prose, source metadata, notes, or file context from extra object fields", () => {
    const branchName = createTaskBranchName({
      ...BASE_TASK,
      objective: "OBJECTIVE TEXT MUST NOT LEAK",
      acceptanceCriteria: ["ACCEPTANCE CRITERIA MUST NOT LEAK"],
      source: {
        title: "SOURCE TITLE MUST NOT LEAK",
        url: "https://example.invalid/private-source",
      },
      context: {
        files: ["src/private-context-file.ts"],
        notes: ["CONTEXT NOTE MUST NOT LEAK"],
      },
    } as BranchNameTaskPacketInput);

    expect(branchName).not.toContain("objective");
    expect(branchName).not.toContain("acceptance");
    expect(branchName).not.toContain("source");
    expect(branchName).not.toContain("private-source");
    expect(branchName).not.toContain("private-context-file");
    expect(branchName).not.toContain("context-note");
    expect(branchName).toBe("aicp/task-050-run-001-9dec52fae849");
  });

  it.each([
    ["GITHUB_TOKEN=ghp_secretbranch1234567890", "run-001"],
    ["TASK-050", "sk-secretbranch1234567890"],
    ["https://user:password@example.invalid/repo.git", "run-001"],
    ["-----BEGIN OPENSSH PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----"],
  ])("uses fallback visible segments for secret-looking identifiers", (taskId, runId) => {
    const branchName = createTaskBranchName({
      ...BASE_TASK,
      id: taskId,
      runId,
    });

    expect(branchName).toMatch(/^aicp\/(?:task|task-050)-(?:run|run-001)-[a-f0-9]{12}$/u);
    expect(branchName).not.toContain("github");
    expect(branchName).not.toContain("ghp");
    expect(branchName).not.toContain("sk-secretbranch");
    expect(branchName).not.toContain("password");
    expect(branchName).not.toContain("private-key");
    expect(isSafeBranchName(branchName)).toBe(true);
  });

  it("truncates long identifiers while keeping a stable fixed-length suffix", () => {
    const longTask = {
      ...BASE_TASK,
      id: `TASK-${"1234567890".repeat(10)}`,
      runId: `RUN-${"abcdefghij".repeat(10)}`,
    };

    const firstBranchName = createTaskBranchName(longTask);
    const secondBranchName = createTaskBranchName(longTask);

    expect(firstBranchName).toBe(secondBranchName);
    expect(firstBranchName.length).toBeLessThanOrEqual(120);
    expect(branchSuffix(firstBranchName)).toMatch(/^[a-f0-9]{12}$/u);
    expect(isSafeBranchName(firstBranchName)).toBe(true);
  });

  it("exports the helper and task input type through the runner public entrypoint", () => {
    const typedTask: BranchNameTaskPacketInputFromEntrypoint = BASE_TASK;

    expect(createTaskBranchNameFromEntrypoint(typedTask)).toBe(createTaskBranchName(BASE_TASK));
  });
});
