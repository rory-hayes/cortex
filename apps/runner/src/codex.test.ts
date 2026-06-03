import { mkdir } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodexExecutionRequest } from "@control-plane/codex";
import { CONTRACT_VERSION, type TaskPacket } from "@control-plane/shared";
import { describe, expect, it, vi } from "vitest";

import {
  getCodexAdapterMode,
  runCodexForTask,
  selectCodexAdapter,
  type RunCodexForTaskResult,
} from "./codex.js";

const OBJECTIVE_TEXT = "OBJECTIVE TEXT IS LOCAL PROMPT ONLY";
const SOURCE_TITLE_TEXT = "SOURCE TITLE IS LOCAL PROMPT ONLY";
const CONTEXT_NOTE_TEXT = "CONTEXT NOTE IS LOCAL PROMPT ONLY";

describe("runner Codex adapter helper", () => {
  it("selects mock mode from runner config", () => {
    const mockAdapter = {
      execute: vi.fn(),
    };
    const localAdapter = {
      execute: vi.fn(),
    };
    const createMockAdapter = vi.fn(() => mockAdapter);
    const createLocalAdapter = vi.fn(() => localAdapter);

    const selection = selectCodexAdapter(
      {
        mockModes: {
          codex: true,
          gh: false,
        },
      },
      {
        createMockAdapter,
        createLocalAdapter,
      },
    );

    expect(selection).toEqual({
      mode: "mock",
      adapter: mockAdapter,
    });
    expect(getCodexAdapterMode({ mockModes: { codex: true, gh: false } })).toBe("mock");
    expect(createMockAdapter).toHaveBeenCalledTimes(1);
    expect(createLocalAdapter).not.toHaveBeenCalled();
  });

  it("selects local mode from runner config without executing Codex", () => {
    const mockAdapter = {
      execute: vi.fn(),
    };
    const localAdapter = {
      execute: vi.fn(),
    };
    const createMockAdapter = vi.fn(() => mockAdapter);
    const createLocalAdapter = vi.fn(() => localAdapter);

    const selection = selectCodexAdapter(
      {
        mockModes: {
          codex: false,
          gh: true,
        },
      },
      {
        createMockAdapter,
        createLocalAdapter,
      },
    );

    expect(selection).toEqual({
      mode: "local",
      adapter: localAdapter,
    });
    expect(getCodexAdapterMode({ mockModes: { codex: false, gh: true } })).toBe("local");
    expect(createLocalAdapter).toHaveBeenCalledTimes(1);
    expect(createMockAdapter).not.toHaveBeenCalled();
    expect(localAdapter.execute).not.toHaveBeenCalled();
  });

  it("renders a local prompt with the actual worktree path and returns safe result metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runner-codex-helper-"));
    const worktreePath = join(workspace, "actual-worktree");
    await mkdir(worktreePath);
    const taskPacket = validTaskPacket({
      repo: {
        localPath: join(workspace, "repo"),
        defaultBranch: "main",
        targetBranch: "aicp/task-060-codex-helper",
        worktreePath: join(workspace, "stale-task-packet-worktree"),
      },
    });
    const adapterResult = {
      status: "succeeded",
      exitCode: 0,
      durationMs: 123,
      stdoutSummary: "adapter stdout summary must stay local",
      stderrSummary: "adapter stderr summary must stay local",
      redactionApplied: true,
    } as const;
    const execute = vi.fn(async (request: CodexExecutionRequest) => {
      void request;

      return adapterResult;
    });

    const result = await runCodexForTask(
      {
        config: {
          mockModes: {
            codex: true,
            gh: false,
          },
        },
        taskPacket,
        worktreePath,
      },
      {
        createMockAdapter: () => ({
          execute,
        }),
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const request = execute.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      runId: "run-codex-helper",
      worktreePath,
    });
    expect(request?.prompt).toContain(`Worktree Path: ${worktreePath}`);
    expect(request?.prompt).not.toContain("stale-task-packet-worktree");
    expect(request?.prompt).toContain(OBJECTIVE_TEXT);
    expect(request?.prompt).toContain(SOURCE_TITLE_TEXT);
    expect(request?.prompt).toContain(CONTEXT_NOTE_TEXT);
    expect(result).toEqual<RunCodexForTaskResult>({
      adapterMode: "mock",
      status: "succeeded",
      exitCode: 0,
      durationMs: 123,
      redactionApplied: true,
    });
    expect(JSON.stringify(result)).not.toContain("stdout");
    expect(JSON.stringify(result)).not.toContain("stderr");
    expect(JSON.stringify(result)).not.toContain(OBJECTIVE_TEXT);
  });
});

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-codex-helper",
  workspaceId: "workspace-codex-helper",
  repositoryId: "repo-codex-helper",
  runId: "run-codex-helper",
  mode: "execute",
  objective: OBJECTIVE_TEXT,
  acceptanceCriteria: ["Invoke Codex after worktree creation."],
  source: {
    type: "manual",
    externalId: "manual-codex-helper",
    title: SOURCE_TITLE_TEXT,
    url: "https://example.test/tasks/codex-helper",
  },
  repo: {
    localPath: "/repo/from-task-packet",
    defaultBranch: "main",
    targetBranch: "aicp/task-060-codex-helper",
  },
  context: {
    files: ["src/private-context-file.ts"],
    notes: [CONTEXT_NOTE_TEXT],
  },
  policy: {
    contractVersion: CONTRACT_VERSION,
    protectedBranches: ["main"],
    protectedPaths: ["SECURITY_MODEL.md"],
    sensitivePaths: [".env", ".env.*"],
    warningPaths: {
      packageLocks: ["pnpm-lock.yaml"],
      migrations: ["db/migrations/**"],
      infrastructure: [".github/**"],
      auth: ["apps/web/src/auth/**"],
      billing: ["apps/web/src/billing/**"],
    },
    validationCommands: [
      {
        id: "test",
        label: "Run tests",
        command: "pnpm test",
        timeoutSeconds: 120,
        required: true,
      },
    ],
    maxChangedFiles: 25,
    maxDiffLines: 1_000,
    allowUntrackedFiles: false,
    dryRunChecks: ["repo_path_exists", "git_repository", "repo_clean"],
  },
  validation: {
    commands: [
      {
        id: "test",
        label: "Run tests",
        command: "pnpm test",
        timeoutSeconds: 120,
        required: true,
      },
    ],
  },
  createdAt: "2026-05-21T07:30:00.000Z",
  ...overrides,
});
