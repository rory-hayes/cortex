import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTRACT_VERSION, type TaskPacket } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

type PromptRenderer = (taskPacket: TaskPacket) => string;

const requiredValidationCommand = {
  id: "test",
  label: "Unit tests",
  command: "pnpm --filter @control-plane/codex test",
  cwd: "packages/codex",
  timeoutSeconds: 120,
  required: true,
} satisfies TaskPacket["validation"]["commands"][number];

const optionalValidationCommand = {
  id: "typecheck",
  label: "Typecheck",
  command: "pnpm --filter @control-plane/codex typecheck",
  timeoutSeconds: 90,
  required: false,
} satisfies TaskPacket["validation"]["commands"][number];

const basePolicy = {
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main", "release/*"],
  protectedPaths: ["SECURITY_MODEL.md"],
  sensitivePaths: [".env", ".env.*"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["db/migrations/**"],
    infrastructure: [".github/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [requiredValidationCommand],
  maxChangedFiles: 12,
  maxDiffLines: 500,
  allowUntrackedFiles: false,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "validation_commands_configured",
  ],
} satisfies TaskPacket["policy"];

const createTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task_057",
  workspaceId: "workspace_123",
  repositoryId: "repo_abc",
  runId: "run_057",
  mode: "execute",
  objective: "Add a local-only prompt renderer for validated task packets.",
  acceptanceCriteria: [
    "Prompt includes operational context needed by Codex.",
    "Prompt references files by path without embedding file contents.",
  ],
  source: {
    type: "manual",
    externalId: "manual-057",
    title: "Add task-packet prompt renderer",
    url: "https://control-plane.example/tasks/task_057",
  },
  repo: {
    localPath: "/work/repos/control-plane",
    defaultBranch: "main",
    targetBranch: "aicp/task-057-renderer",
    worktreePath: "/tmp/aicp/run_057",
  },
  context: {
    files: ["packages/codex/src/index.ts", "packages/shared/src/task-packet.ts"],
    notes: [
      "Keep the renderer pure and deterministic.",
      "The prompt is consumed locally by codex exec only.",
    ],
  },
  policy: basePolicy,
  validation: {
    commands: [requiredValidationCommand, optionalValidationCommand],
  },
  createdAt: "2026-05-20T20:37:05.422Z",
  ...overrides,
});

const getRenderer = async (): Promise<PromptRenderer> => {
  const codexModule: Record<string, unknown> = await import("@control-plane/codex");

  expect(typeof codexModule.renderTaskPacketPrompt).toBe("function");

  return codexModule.renderTaskPacketPrompt as PromptRenderer;
};

describe("renderTaskPacketPrompt", () => {
  it("renders task, repository, context, policy, and validation details", async () => {
    const renderTaskPacketPrompt = await getRenderer();
    const prompt = renderTaskPacketPrompt(createTaskPacket());

    expect(prompt).toContain("Local-only Codex execution prompt");
    expect(prompt).toContain("Do not send this prompt, source code, diffs, patches, or logs");
    expect(prompt).toContain("Task ID: task_057");
    expect(prompt).toContain("Run ID: run_057");
    expect(prompt).toContain("Mode: execute");
    expect(prompt).toContain("Repository ID: repo_abc");
    expect(prompt).toContain("Workspace ID: workspace_123");
    expect(prompt).toContain("Add a local-only prompt renderer for validated task packets.");
    expect(prompt).toContain("- Prompt includes operational context needed by Codex.");
    expect(prompt).toContain("- Prompt references files by path without embedding file contents.");
    expect(prompt).toContain("Source Type: manual");
    expect(prompt).toContain("Source External ID: manual-057");
    expect(prompt).toContain("Source Title: Add task-packet prompt renderer");
    expect(prompt).toContain("Source URL: https://control-plane.example/tasks/task_057");
    expect(prompt).toContain("Local Path: /work/repos/control-plane");
    expect(prompt).toContain("Default Branch: main");
    expect(prompt).toContain("Target Branch: aicp/task-057-renderer");
    expect(prompt).toContain("Worktree Path: /tmp/aicp/run_057");
    expect(prompt).toContain("- packages/codex/src/index.ts");
    expect(prompt).toContain("- packages/shared/src/task-packet.ts");
    expect(prompt).toContain("- Keep the renderer pure and deterministic.");
    expect(prompt).toContain("- The prompt is consumed locally by codex exec only.");
    expect(prompt).toContain("Protected Branches: main, release/*");
    expect(prompt).toContain("Protected Paths: SECURITY_MODEL.md");
    expect(prompt).toContain("Sensitive Paths: .env, .env.*");
    expect(prompt).toContain("Package Locks: pnpm-lock.yaml");
    expect(prompt).toContain("Migrations: db/migrations/**");
    expect(prompt).toContain("Infrastructure: .github/**");
    expect(prompt).toContain("Auth: apps/web/src/auth/**");
    expect(prompt).toContain("Billing: apps/web/src/billing/**");
    expect(prompt).toContain("Max Changed Files: 12");
    expect(prompt).toContain("Max Diff Lines: 500");
    expect(prompt).toContain("Allow Untracked Files: false");
    expect(prompt).toContain(
      "Dry Run Checks: repo_path_exists, git_repository, repo_clean, validation_commands_configured",
    );
  });

  it("does not read or embed referenced file contents", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "aicp-prompt-renderer-"));
    const referencedFile = join(tempDirectory, "referenced.ts");
    const sentinel = "SECRET_SOURCE_SENTINEL";

    await writeFile(referencedFile, sentinel, "utf8");

    try {
      const renderTaskPacketPrompt = await getRenderer();
      const prompt = renderTaskPacketPrompt(
        createTaskPacket({
          context: {
            files: [referencedFile],
            notes: ["Reference the path only."],
          },
        }),
      );

      expect(prompt).toContain(referencedFile);
      expect(prompt).not.toContain(sentinel);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("renders validation command fields", async () => {
    const renderTaskPacketPrompt = await getRenderer();
    const prompt = renderTaskPacketPrompt(createTaskPacket());

    expect(prompt).toContain("ID: test");
    expect(prompt).toContain("Label: Unit tests");
    expect(prompt).toContain("Command: pnpm --filter @control-plane/codex test");
    expect(prompt).toContain("CWD: packages/codex");
    expect(prompt).toContain("Timeout Seconds: 120");
    expect(prompt).toContain("Required: true");
    expect(prompt).toContain("ID: typecheck");
    expect(prompt).toContain("Label: Typecheck");
    expect(prompt).toContain("Command: pnpm --filter @control-plane/codex typecheck");
    expect(prompt).toContain("CWD: <repo root>");
    expect(prompt).toContain("Timeout Seconds: 90");
    expect(prompt).toContain("Required: false");
  });

  it("renders repair context only for repair packets", async () => {
    const renderTaskPacketPrompt = await getRenderer();

    const executePrompt = renderTaskPacketPrompt(createTaskPacket());
    expect(executePrompt).not.toContain("## Repair Context");

    const repairPrompt = renderTaskPacketPrompt(
      createTaskPacket({
        mode: "repair",
        source: {
          type: "repair",
          externalId: "repair-057",
          title: "Repair task-packet prompt renderer",
        },
        repair: {
          attempt: 1,
          maxAttempts: 2,
          feedback: "Address validation feedback without expanding scope.",
          previousRunId: "run_056",
        },
      }),
    );

    expect(repairPrompt).toContain("## Repair Context");
    expect(repairPrompt).toContain("Attempt: 1");
    expect(repairPrompt).toContain("Max Attempts: 2");
    expect(repairPrompt).toContain("Previous Run ID: run_056");
    expect(repairPrompt).toContain(
      "Feedback: Address validation feedback without expanding scope.",
    );
  });
});
