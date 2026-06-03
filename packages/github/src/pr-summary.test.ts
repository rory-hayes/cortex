import { describe, expect, it } from "vitest";

import * as github from "@control-plane/github";
import type { RenderPrSummaryInput } from "@control-plane/github";
import type { RiskFinding, TaskPacket, ValidationResult } from "@control-plane/shared";

const contractVersion = "2026-05-10.v1";

const taskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion,
  id: "task-080",
  workspaceId: "workspace-1",
  repositoryId: "repo-1",
  runId: "run-1",
  mode: "execute",
  objective: "Add a metadata-only PR summary.",
  acceptanceCriteria: [
    "Show task metadata.",
    "Do not include raw logs, diffs, patches, snippets, or source.",
  ],
  source: {
    type: "manual",
    externalId: "TASK-080",
    title: "Add PR summary renderer",
    url: "https://example.test/tasks/TASK-080",
  },
  repo: {
    localPath: "/local/repo",
    defaultBranch: "main",
    targetBranch: "codex/TASK-080-add-pr-summary-renderer",
    worktreePath: "/local/worktree",
  },
  context: {
    files: ["packages/github/src/pr-summary.ts"],
    notes: ["Only render safe metadata."],
  },
  policy: {
    contractVersion,
    protectedBranches: ["main"],
    protectedPaths: [],
    sensitivePaths: [".env", ".env.*"],
    warningPaths: {
      packageLocks: ["pnpm-lock.yaml"],
      migrations: ["migrations/**"],
      infrastructure: [".github/**"],
      auth: ["**/auth/**"],
      billing: ["**/billing/**"],
    },
    validationCommands: [
      {
        id: "github-tests",
        label: "GitHub package tests",
        command: "pnpm --filter @control-plane/github test",
        timeoutSeconds: 60,
        required: true,
      },
    ],
    maxChangedFiles: 25,
    allowUntrackedFiles: true,
    dryRunChecks: [
      "repo_path_exists",
      "git_repository",
      "repo_clean",
      "current_branch_not_protected",
      "repo_policy_exists_and_parses",
      "validation_commands_configured",
      "required_tools_available",
      "branch_name_available",
      "worktree_path_available",
      "protected_and_sensitive_paths_configured",
      "runner_capabilities_satisfied",
    ],
  },
  validation: {
    commands: [
      {
        id: "github-tests",
        label: "GitHub package tests",
        command: "pnpm --filter @control-plane/github test",
        timeoutSeconds: 60,
        required: true,
      },
    ],
  },
  createdAt: "2026-05-21T23:04:16.164Z",
  ...overrides,
});

const validationResult = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
  contractVersion,
  id: "validation-1",
  runId: "run-1",
  commandId: "github-tests",
  commandLabel: "GitHub package tests",
  command: "pnpm --filter @control-plane/github test && echo local-output",
  status: "passed",
  exitCode: 0,
  durationMs: 1_250,
  stdoutSummary: "Raw stdout summary must stay out.",
  stderrSummary: "Raw stderr summary must stay out.",
  redactionApplied: true,
  startedAt: "2026-05-21T23:05:00.000Z",
  finishedAt: "2026-05-21T23:05:01.250Z",
  ...overrides,
});

const riskFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk:package_lock",
  severity: "warning",
  category: "package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  ...overrides,
});

const renderInput = (overrides: Partial<RenderPrSummaryInput> = {}): RenderPrSummaryInput => ({
  task: taskPacket(),
  changedFilePaths: ["packages/github/src/pr-summary.ts", "packages/github/src/index.ts"],
  validationResults: [validationResult()],
  riskFindings: [riskFinding()],
  ...overrides,
});

describe("@control-plane/github PR summary renderer", () => {
  it("exports renderPrSummary through the public package entrypoint", () => {
    expect(typeof github.renderPrSummary).toBe("function");
  });

  it("renders deterministic safe sections for task metadata, changed files, validation, and risk flags", () => {
    const summary = github.renderPrSummary(renderInput());

    expect(summary).toContain("## Task");
    expect(summary).toContain("Add a metadata-only PR summary.");
    expect(summary).toContain("### Acceptance Criteria");
    expect(summary).toContain("- Show task metadata.");
    expect(summary).toContain("## Changed Files");
    expect(summary).toContain("- `packages/github/src/index.ts`");
    expect(summary).toContain("- `packages/github/src/pr-summary.ts`");
    expect(summary).toContain("## Validation");
    expect(summary).toContain("| GitHub package tests | passed | 0 | 1250ms | yes |");
    expect(summary).toContain("## Risk Flags");
    expect(summary).toContain(
      "| warning | package_lock | Package lock changed. | `pnpm-lock.yaml` |",
    );
  });

  it("does not render validation commands or output summaries", () => {
    const summary = github.renderPrSummary(renderInput());

    expect(summary).not.toContain("pnpm --filter @control-plane/github test");
    expect(summary).not.toContain("Raw stdout summary must stay out.");
    expect(summary).not.toContain("Raw stderr summary must stay out.");
    expect(summary).not.toContain("local-output");
  });

  it("rejects source-like payload fields at the top level and inside structured metadata", () => {
    const inputWithRawOutput = {
      ...renderInput(),
      rawOutput: "raw command output",
    };
    const inputWithValidationStdout = {
      ...renderInput(),
      validationResults: [
        {
          ...validationResult(),
          stdout: "raw stdout",
        },
      ],
    };
    const inputWithRiskPatch = {
      ...renderInput(),
      riskFindings: [
        {
          ...riskFinding(),
          patch: "patch text",
        },
      ],
    };

    expect(() => github.renderPrSummary(inputWithRawOutput)).toThrow(/Invalid PR summary input/);
    expect(() => github.renderPrSummary(inputWithValidationStdout)).toThrow(
      /Invalid PR summary input/,
    );
    expect(() => github.renderPrSummary(inputWithRiskPatch)).toThrow(/Invalid PR summary input/);
  });

  it.each([
    "/absolute/path.ts",
    "../outside.ts",
    "packages/../outside.ts",
    "packages\\github\\src\\index.ts",
    "C:/repo/file.ts",
    "packages/github/src/\u0000index.ts",
    "packages/github/src/index.ts\nREADME.md",
    "",
  ])("rejects unsafe changed file path %j", (unsafePath) => {
    expect(() => github.renderPrSummary(renderInput({ changedFilePaths: [unsafePath] }))).toThrow(
      /Invalid changed file path/,
    );
  });

  it("omits source-like task prose from source title, objective, and acceptance criteria", () => {
    const summary = github.renderPrSummary(
      renderInput({
        task: taskPacket({
          source: {
            type: "manual",
            externalId: "TASK-080",
            title: "Fix `const leaked = true;` handling",
            url: "https://example.test/tasks/TASK-080",
          },
          objective: "Review diff --git a/src/private.ts b/src/private.ts\n@@ -1 +1 @@",
          acceptanceCriteria: [
            "Keep validation metadata visible.",
            'Do not send router.get("/admin", handler); snippets.',
            "*** Begin Patch\n*** Update File: src/private.ts",
          ],
        }),
      }),
    );

    expect(summary).toContain("- Source: manual / [omitted: unsafe task prose]");
    expect(summary).toContain("- Objective: [omitted: unsafe task prose]");
    expect(summary).toContain("- Keep validation metadata visible.");
    expect(summary).toContain("- [omitted: unsafe task prose]");
    expect(summary).not.toContain("const leaked");
    expect(summary).not.toContain("diff --git");
    expect(summary).not.toContain("@@ -1");
    expect(summary).not.toContain("router.get");
    expect(summary).not.toContain("*** Begin Patch");
  });

  it("escapes non-source markdown task prose without omitting it", () => {
    const summary = github.renderPrSummary(
      renderInput({
        task: taskPacket({
          objective: "Render `inline` labels without opening code spans.",
          acceptanceCriteria: ["Escape pipes | and backticks ` safely."],
        }),
      }),
    );

    expect(summary).not.toContain("```");
    expect(summary).not.toContain("`inline`");
    expect(summary).toContain("\\`inline\\`");
    expect(summary).toContain("pipes \\| and backticks \\` safely");
  });
});
