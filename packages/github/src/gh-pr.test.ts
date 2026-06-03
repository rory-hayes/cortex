import * as github from "@control-plane/github";
import { CONTRACT_VERSION, PrArtifactSchema, type RiskFinding } from "@control-plane/shared";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { withMockGhOnPath } from "../../../apps/runner/test/mocks/gh.js";
import {
  GhPrError,
  createMockGhPrAdapter,
  getPullRequestWithGh,
  createPullRequestWithGh,
  type CreatePullRequestWithGhOptions,
  type GetPullRequestWithGhOptions,
  type GhPrAdapter,
  type GhPrCommand,
  type GhPrCommandResult,
  type GhPrCommandRunner,
  type GhPrErrorCode,
  type GhPrErrorMetadata,
  type MockGhPrAdapter,
} from "./gh-pr.js";

const fixedCreatedAt = "2026-05-22T00:00:00.000Z";
const mockDefaultCreatedAt = "2026-05-10T00:00:00.000Z";

const warningFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk:package_lock",
  severity: "warning",
  category: "package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  ...overrides,
});

const defaultOptions = (
  overrides: Partial<CreatePullRequestWithGhOptions> = {},
): CreatePullRequestWithGhOptions => ({
  worktreePath: "/tmp/aicp/task-079",
  runId: "run-079",
  repository: {
    owner: "acme",
    name: "control-plane",
  },
  branchName: "aicp/task-079-implement-gh-pr-helper",
  baseBranch: "main",
  title: "TASK-079: Implement gh PR creation helper",
  body: "Pull request summary generated from safe metadata.",
  changedFilePaths: ["packages/github/src/gh-pr.ts", "packages/github/src/gh-pr.test.ts"],
  riskFindings: [warningFinding()],
  createdAt: fixedCreatedAt,
  commandRunner: createGhCommandRunner().runner,
  ...overrides,
});

const defaultGetOptions = (
  overrides: Partial<GetPullRequestWithGhOptions> = {},
): GetPullRequestWithGhOptions => ({
  worktreePath: "/tmp/aicp/task-147",
  runId: "run-147",
  repository: {
    owner: "acme",
    name: "control-plane",
  },
  branchName: "aicp/task-147-existing-pr",
  changedFilePaths: ["apps/runner/src/repair.ts"],
  riskFindings: [],
  createdAt: fixedCreatedAt,
  commandRunner: createGhCommandRunner({
    result: {
      exitCode: 0,
      stdoutSummary: JSON.stringify({
        isDraft: true,
        number: 147,
        state: "OPEN",
        title: "TASK-147: Existing PR",
        url: "https://github.example.test/acme/control-plane/pull/147",
      }),
      stderrSummary: "",
    },
  }).runner,
  ...overrides,
});

describe("@control-plane/github gh PR helper", () => {
  it("exports the helper, mock adapter, error, and public types through the package entrypoint", () => {
    const code: GhPrErrorCode = "gh_create_failed";
    const metadata: GhPrErrorMetadata = { ghExitCode: 1 };
    const command: GhPrCommand = {
      command: "gh",
      args: ["pr", "create"],
      cwd: "/tmp/aicp/task-079",
      stdin: "safe body",
    };
    const result: GhPrCommandResult = {
      exitCode: 0,
      stdoutSummary: "https://github.example.test/acme/control-plane/pull/79\n",
      stderrSummary: "",
    };
    const runner: GhPrCommandRunner = async () => result;
    const adapter: GhPrAdapter = {
      createPullRequest: createPullRequestWithGh,
      getPullRequest: getPullRequestWithGh,
    };
    const mockAdapter: MockGhPrAdapter = createMockGhPrAdapter();

    expect(typeof github.createPullRequestWithGh).toBe("function");
    expect(typeof github.getPullRequestWithGh).toBe("function");
    expect(typeof github.createMockGhPrAdapter).toBe("function");
    expect(github.GhPrError).toBe(GhPrError);
    expect(code).toBe("gh_create_failed");
    expect(metadata.ghExitCode).toBe(1);
    expect(command.command).toBe("gh");
    expect(typeof runner).toBe("function");
    expect(typeof adapter.createPullRequest).toBe("function");
    expect(typeof adapter.getPullRequest).toBe("function");
    expect(mockAdapter.calls).toEqual([]);
  });

  it("mock adapter returns a deterministic schema-valid PR artifact without invoking gh", async () => {
    const commandRunner = vi.fn<GhPrCommandRunner>();
    const riskA = warningFinding({
      id: "risk:auth",
      category: "auth",
      message: "Auth path changed.",
      paths: ["apps/web/auth/login.ts", "apps/web/auth/login.ts", "apps/web/auth/index.ts"],
    });
    const riskB = warningFinding({
      id: "risk:package_lock",
      category: "package_lock",
      paths: ["pnpm-lock.yaml"],
    });
    const adapter = createMockGhPrAdapter();
    const optionsWithoutCreatedAt = defaultOptions({
      changedFilePaths: [
        "packages/github/src/gh-pr.test.ts",
        "packages/github/src/gh-pr.ts",
        "packages/github/src/gh-pr.ts",
        ".env.example",
      ],
      riskFindings: [riskB, riskA, riskA],
      commandRunner,
    });

    delete optionsWithoutCreatedAt.createdAt;

    const artifact = await adapter.createPullRequest(optionsWithoutCreatedAt);

    expect(PrArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact).toEqual({
      contractVersion: CONTRACT_VERSION,
      id: "pr:run-079:1",
      runId: "run-079",
      repository: {
        owner: "acme",
        name: "control-plane",
      },
      branchName: "aicp/task-079-implement-gh-pr-helper",
      prNumber: 1,
      prUrl: "https://github.example.test/acme/control-plane/pull/1",
      prTitle: "TASK-079: Implement gh PR creation helper",
      prStatus: "draft",
      changedFilePaths: [
        ".env.example",
        "packages/github/src/gh-pr.test.ts",
        "packages/github/src/gh-pr.ts",
      ],
      riskFindings: [
        {
          ...riskA,
          paths: ["apps/web/auth/index.ts", "apps/web/auth/login.ts"],
        },
        riskB,
      ],
      createdAt: mockDefaultCreatedAt,
    });
    expect(adapter.calls).toEqual([artifact]);
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("creates a draft PR with direct gh argv and passes the body through stdin", async () => {
    const harness = createGhCommandRunner();
    const body = "Safe PR body that must not appear in argv.";

    await createPullRequestWithGh(defaultOptions({ body, commandRunner: harness.runner }));

    expect(harness.calls).toEqual([
      {
        command: "gh",
        args: [
          "pr",
          "create",
          "--draft",
          "--base",
          "main",
          "--head",
          "aicp/task-079-implement-gh-pr-helper",
          "--title",
          "TASK-079: Implement gh PR creation helper",
          "--body-file",
          "-",
        ],
        cwd: "/tmp/aicp/task-079",
        stdin: body,
      },
    ]);
    expect(harness.calls[0]?.args).not.toContain(body);
  });

  it("parses gh stdout into a shared-contract-valid draft PR artifact", async () => {
    const harness = createGhCommandRunner({
      result: {
        exitCode: 0,
        stdoutSummary: "https://github.example.test/org/repo/pull/79\n",
        stderrSummary: "",
      },
    });

    const artifact = await createPullRequestWithGh(
      defaultOptions({
        repository: { owner: "org", name: "repo" },
        branchName: "aicp/task-079",
        changedFilePaths: ["b.ts", "a.ts", "a.ts"],
        riskFindings: [warningFinding({ paths: ["b.ts", "a.ts", "a.ts"] })],
        commandRunner: harness.runner,
      }),
    );

    expect(PrArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact).toEqual({
      contractVersion: CONTRACT_VERSION,
      id: "pr:run-079:79",
      runId: "run-079",
      repository: {
        owner: "org",
        name: "repo",
      },
      branchName: "aicp/task-079",
      prNumber: 79,
      prUrl: "https://github.example.test/org/repo/pull/79",
      prTitle: "TASK-079: Implement gh PR creation helper",
      prStatus: "draft",
      changedFilePaths: ["a.ts", "b.ts"],
      riskFindings: [warningFinding({ paths: ["a.ts", "b.ts"] })],
      createdAt: fixedCreatedAt,
    });
  });

  it("creates a draft PR through a mocked gh executable on PATH without an injected runner", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "aicp-gh-pr-"));
    const body = "Safe PR body passed through stdin for the PATH shim.";

    try {
      await withMockGhOnPath(
        {
          owner: "acme",
          repo: "control-plane",
          prNumber: 92,
        },
        async (harness) => {
          const optionsWithoutCommandRunner = defaultOptions({
            worktreePath,
            runId: "run-092",
            title: "TASK-092: Add mocked gh harness",
            body,
            branchName: "aicp/task-092-add-mocked-gh-harness",
            changedFilePaths: ["apps/runner/test/mocks/gh.ts", "packages/github/src/gh-pr.test.ts"],
          });
          delete optionsWithoutCommandRunner.commandRunner;

          const artifact = await createPullRequestWithGh(optionsWithoutCommandRunner);

          expect(PrArtifactSchema.safeParse(artifact).success).toBe(true);
          expect(artifact).toMatchObject({
            id: "pr:run-092:92",
            runId: "run-092",
            repository: {
              owner: "acme",
              name: "control-plane",
            },
            branchName: "aicp/task-092-add-mocked-gh-harness",
            prNumber: 92,
            prUrl: "https://github.example.test/acme/control-plane/pull/92",
            prTitle: "TASK-092: Add mocked gh harness",
            prStatus: "draft",
          });

          const invocations = await harness.readInvocations();
          expect(invocations).toEqual([
            {
              command: "gh",
              args: [
                "pr",
                "create",
                "--draft",
                "--base",
                "main",
                "--head",
                "aicp/task-092-add-mocked-gh-harness",
                "--title",
                "TASK-092: Add mocked gh harness",
                "--body-file",
                "-",
              ],
              stdinLength: Buffer.byteLength(body, "utf8"),
              stdinSha256: sha256(body),
            },
          ]);
          expect(JSON.stringify(invocations)).not.toContain(body);
        },
      );
    } finally {
      await rm(worktreePath, { force: true, recursive: true });
    }
  });

  it("loads existing PR metadata for a repair branch without creating a new pull request", async () => {
    const harness = createGhCommandRunner({
      result: {
        exitCode: 0,
        stdoutSummary: JSON.stringify({
          isDraft: true,
          number: 147,
          state: "OPEN",
          title: "TASK-147: Existing PR",
          url: "https://github.example.test/acme/control-plane/pull/147",
        }),
        stderrSummary: "",
      },
    });

    const artifact = await getPullRequestWithGh(
      defaultGetOptions({
        changedFilePaths: ["b.ts", "a.ts", "a.ts"],
        riskFindings: [warningFinding({ paths: ["b.ts", "a.ts", "a.ts"] })],
        commandRunner: harness.runner,
      }),
    );

    expect(PrArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact).toEqual({
      contractVersion: CONTRACT_VERSION,
      id: "pr:run-147:147",
      runId: "run-147",
      repository: {
        owner: "acme",
        name: "control-plane",
      },
      branchName: "aicp/task-147-existing-pr",
      prNumber: 147,
      prUrl: "https://github.example.test/acme/control-plane/pull/147",
      prTitle: "TASK-147: Existing PR",
      prStatus: "draft",
      changedFilePaths: ["a.ts", "b.ts"],
      riskFindings: [warningFinding({ paths: ["a.ts", "b.ts"] })],
      createdAt: fixedCreatedAt,
    });
    expect(harness.calls).toEqual([
      {
        command: "gh",
        args: [
          "pr",
          "view",
          "aicp/task-147-existing-pr",
          "--json",
          "number,url,title,state,isDraft",
        ],
        cwd: "/tmp/aicp/task-147",
        stdin: "",
      },
    ]);
  });

  it("throws safe errors when existing PR lookup fails or returns malformed output", async () => {
    const unsafeOutput = [
      "https://token@example.test/private/repo.git",
      "diff --git a/src/secret.ts b/src/secret.ts",
      "const token = 'ghp_rawsecret1234567890';",
      "OPENAI_API_KEY=sk-rawsecret1234567890",
      "/tmp/aicp/task-147/src/secret.ts",
      "raw command output",
    ].join("\n");
    const failureCases: Array<{
      result: GhPrCommandResult;
      code: GhPrErrorCode;
      metadata: GhPrErrorMetadata;
    }> = [
      {
        result: {
          exitCode: 1,
          stdoutSummary: unsafeOutput,
          stderrSummary: unsafeOutput,
        },
        code: "gh_view_failed",
        metadata: { ghExitCode: 1 },
      },
      {
        result: {
          exitCode: 0,
          stdoutSummary: unsafeOutput,
          stderrSummary: unsafeOutput,
        },
        code: "invalid_pr_output",
        metadata: {},
      },
    ];

    for (const failureCase of failureCases) {
      const harness = createGhCommandRunner({ result: failureCase.result });

      await expect(
        getPullRequestWithGh(defaultGetOptions({ commandRunner: harness.runner })),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GhPrError);
        expect(error).toMatchObject({
          code: failureCase.code,
          metadata: failureCase.metadata,
        });

        const serialized = JSON.stringify(error);
        const message = String(error);

        for (const unsafeText of [
          "https://token@example.test",
          "diff --git",
          "const token",
          "ghp_rawsecret",
          "OPENAI_API_KEY",
          "sk-rawsecret",
          "raw command output",
          "/tmp/aicp/task-147",
        ]) {
          expect(serialized).not.toContain(unsafeText);
          expect(message).not.toContain(unsafeText);
        }

        return true;
      });
    }
  });

  it("rejects unsafe inputs before invoking gh", async () => {
    const cases: Array<Partial<CreatePullRequestWithGhOptions>> = [
      { worktreePath: "relative/worktree" },
      { worktreePath: "/" },
      { worktreePath: "/tmp/aicp/task-\u0001079" },
      { repository: { owner: "org/name", name: "repo" } },
      { repository: { owner: "org", name: "../repo" } },
      { repository: { owner: "GITHUB_TOKEN=ghp_rawsecret1234567890", name: "repo" } },
      { branchName: "../outside" },
      { branchName: "aicp/task-079.lock" },
      { branchName: "-aicp/task-079" },
      { branchName: "aicp/task 079" },
      { baseBranch: "../main" },
      { baseBranch: "main lock" },
      { runId: "OPENAI_API_KEY=sk-rawsecret1234567890" },
      { title: "" },
      { title: "TASK-079\nextra" },
      { title: "GitHub token ghp_rawsecret1234567890" },
      { title: "TASK-079: const leaked = true;" },
      { body: "" },
      { body: "diff --git a/src/secret.ts b/src/secret.ts" },
      { body: 'The task prose included router.get("/admin", handler);' },
      { body: "OPENAI_API_KEY=sk-rawsecret1234567890" },
      { changedFilePaths: ["/absolute/path.ts"] },
      { changedFilePaths: ["../escape.ts"] },
      { changedFilePaths: ["src/../escape.ts"] },
      { changedFilePaths: ["src\\escape.ts"] },
      { changedFilePaths: [".env"] },
      { changedFilePaths: ["config/.env.local"] },
      { changedFilePaths: ["local.env"] },
      { changedFilePaths: ["app.local.env"] },
      { riskFindings: [{ ...warningFinding(), severity: "critical" } as unknown as RiskFinding] },
      { riskFindings: [warningFinding({ paths: ["../secret.ts"] })] },
      { riskFindings: [warningFinding({ paths: [".env"] })] },
    ];

    for (const overrides of cases) {
      const commandRunner = vi.fn<GhPrCommandRunner>();

      await expect(
        createPullRequestWithGh(defaultOptions({ ...overrides, commandRunner })),
      ).rejects.toBeInstanceOf(GhPrError);
      expect(commandRunner).not.toHaveBeenCalled();
    }
  });

  it("rejects unsafe text in changed file paths and risk finding paths before invoking gh", async () => {
    const unsafePaths = [
      "diff --git a/src/secret.ts b/src/secret.ts",
      "patch/file.txt",
      "function leakedSource() { return token; }",
      "src/ghp_rawsecret1234567890.ts",
      "src/sk-rawsecret1234567890.ts",
    ];

    for (const unsafePath of unsafePaths) {
      const unsafeCases: Array<{
        overrides: Partial<CreatePullRequestWithGhOptions>;
        code: GhPrErrorCode;
      }> = [
        {
          overrides: { changedFilePaths: [unsafePath] },
          code: "invalid_changed_file_path",
        },
        {
          overrides: { riskFindings: [warningFinding({ paths: [unsafePath] })] },
          code: "invalid_risk_finding",
        },
      ];

      for (const { overrides, code } of unsafeCases) {
        const commandRunner = vi.fn<GhPrCommandRunner>();

        await expect(
          createPullRequestWithGh(defaultOptions({ ...overrides, commandRunner })),
        ).rejects.toSatisfy((error: unknown) => {
          expect(error).toBeInstanceOf(GhPrError);
          expect(error).toMatchObject({ code });

          const serialized = JSON.stringify(error);
          const message = String(error);

          expect(serialized).not.toContain(unsafePath);
          expect(message).not.toContain(unsafePath);

          return true;
        });
        expect(commandRunner).not.toHaveBeenCalled();
      }
    }
  });

  it("allows ordinary metadata paths that contain source, code, or content segments", async () => {
    const harness = createGhCommandRunner();
    const artifact = await createPullRequestWithGh(
      defaultOptions({
        changedFilePaths: ["docs/content.md", "src/code-editor.ts", "src/source-map.ts"],
        riskFindings: [
          warningFinding({
            paths: ["docs/content.md", "src/code-editor.ts", "src/source-map.ts"],
          }),
        ],
        commandRunner: harness.runner,
      }),
    );

    expect(artifact.changedFilePaths).toEqual([
      "docs/content.md",
      "src/code-editor.ts",
      "src/source-map.ts",
    ]);
    expect(artifact.riskFindings[0]?.paths).toEqual([
      "docs/content.md",
      "src/code-editor.ts",
      "src/source-map.ts",
    ]);
    expect(harness.calls).toHaveLength(1);
  });

  it("rejects schema-valid risk finding id and message text that could leak unsafe content", async () => {
    const unsafeRiskFindings = [
      warningFinding({ id: "OPENAI_API_KEY=sk-rawsecret1234567890" }),
      warningFinding({ id: "diff --git a/src/secret.ts b/src/secret.ts" }),
      warningFinding({ message: "OPENAI_API_KEY=sk-rawsecret1234567890" }),
      warningFinding({ message: "diff --git a/src/secret.ts b/src/secret.ts" }),
      warningFinding({ message: "--- a/src/secret.ts\n+++ b/src/secret.ts" }),
      warningFinding({ message: "const token = readLocalSecret();" }),
      warningFinding({ message: "```ts\nconst token = readLocalSecret();\n```" }),
    ];

    for (const riskFinding of unsafeRiskFindings) {
      const commandRunner = vi.fn<GhPrCommandRunner>();

      await expect(
        createPullRequestWithGh(
          defaultOptions({
            riskFindings: [riskFinding],
            commandRunner,
          }),
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GhPrError);
        expect(error).toMatchObject({ code: "invalid_risk_finding" });

        const serialized = JSON.stringify(error);
        const message = String(error);

        for (const unsafeText of [
          "OPENAI_API_KEY",
          "sk-rawsecret",
          "diff --git",
          "--- a/src/secret.ts",
          "+++ b/src/secret.ts",
          "const token",
          "readLocalSecret",
        ]) {
          expect(serialized).not.toContain(unsafeText);
          expect(message).not.toContain(unsafeText);
        }

        return true;
      });
      expect(commandRunner).not.toHaveBeenCalled();
    }
  });

  it("throws safe errors when gh fails or returns malformed PR output", async () => {
    const unsafeOutput = [
      "https://token@example.test/private/repo.git",
      "diff --git a/src/secret.ts b/src/secret.ts",
      "patch text with code snippet",
      "const token = 'ghp_rawsecret1234567890';",
      "OPENAI_API_KEY=sk-rawsecret1234567890",
      "/tmp/aicp/task-079/src/secret.ts",
      "raw command output",
    ].join("\n");
    const failureBody = "Safe body with unique phrase body-text-not-leaked.";
    const failureCases: Array<{
      result: GhPrCommandResult;
      code: GhPrErrorCode;
      metadata: GhPrErrorMetadata;
    }> = [
      {
        result: {
          exitCode: 1,
          stdoutSummary: unsafeOutput,
          stderrSummary: unsafeOutput,
        },
        code: "gh_create_failed",
        metadata: { ghExitCode: 1 },
      },
      {
        result: {
          exitCode: 0,
          stdoutSummary: unsafeOutput,
          stderrSummary: unsafeOutput,
        },
        code: "invalid_pr_output",
        metadata: {},
      },
    ];

    for (const failureCase of failureCases) {
      const harness = createGhCommandRunner({ result: failureCase.result });

      await expect(
        createPullRequestWithGh(
          defaultOptions({
            body: failureBody,
            commandRunner: harness.runner,
          }),
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GhPrError);
        expect(error).toMatchObject({
          code: failureCase.code,
          metadata: failureCase.metadata,
        });

        const serialized = JSON.stringify(error);
        const message = String(error);

        for (const unsafeText of [
          "https://token@example.test",
          "diff --git",
          "patch text",
          "code snippet",
          "const token",
          "ghp_rawsecret",
          "OPENAI_API_KEY",
          "sk-rawsecret",
          "body-text-not-leaked",
          "raw command output",
          "/tmp/aicp/task-079",
        ]) {
          expect(serialized).not.toContain(unsafeText);
          expect(message).not.toContain(unsafeText);
        }

        return true;
      });
    }
  });
});

const createGhCommandRunner = (
  options: {
    result?: GhPrCommandResult;
  } = {},
): {
  calls: GhPrCommand[];
  runner: GhPrCommandRunner;
} => {
  const calls: GhPrCommand[] = [];
  const result = options.result ?? {
    exitCode: 0,
    stdoutSummary: "https://github.example.test/acme/control-plane/pull/79\n",
    stderrSummary: "",
  };
  const runner = vi.fn<GhPrCommandRunner>(async (command) => {
    calls.push(command);

    return result;
  });

  return { calls, runner };
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
