import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import * as github from "@control-plane/github";
import type { RiskFinding } from "@control-plane/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GitCommitError,
  commitValidatedChanges,
  type CommitValidatedChangesOptions,
  type CommitValidatedChangesResult,
  type GitCommitCommand,
  type GitCommitCommandRunner,
  type GitCommitErrorCode,
} from "./git-commit.js";

const execFileAsync = promisify(execFile);

const createdRepos: string[] = [];

const defaultOptions = (
  overrides: Partial<CommitValidatedChangesOptions> = {},
): CommitValidatedChangesOptions => ({
  worktreePath: "/tmp/aicp/task-077",
  taskId: "TASK-077",
  runId: "run-077",
  changedFilePaths: ["src/safe.ts"],
  blockers: [],
  validationShouldBlockCommit: false,
  commandRunner: createSuccessfulCommandRunner().runner,
  ...overrides,
});

const blockedFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk:secret",
  severity: "blocked",
  category: "secret",
  message: "Suspected secret detected.",
  paths: ["src/safe.ts"],
  ...overrides,
});

describe("@control-plane/github git commit helper", () => {
  afterEach(async () => {
    await Promise.all(
      createdRepos.map((repoPath) => rm(repoPath, { force: true, recursive: true })),
    );
    createdRepos.length = 0;
  });

  it("exports the helper and public types through the package entrypoint", () => {
    const result: CommitValidatedChangesResult = {
      taskId: "TASK-077",
      runId: "run-077",
      commitHash: "a".repeat(40),
      changedFileCount: 1,
    };
    const code: GitCommitErrorCode = "no_staged_changes";

    expect(typeof github.commitValidatedChanges).toBe("function");
    expect(github.GitCommitError).toBe(GitCommitError);
    expect(result.commitHash).toHaveLength(40);
    expect(code).toBe("no_staged_changes");
  });

  it("commits modified and untracked safe fixture files and returns the current HEAD hash", async () => {
    const repoPath = await createFixtureRepo();

    await writeFile(join(repoPath, "README.md"), "updated safe contents\n", "utf8");
    await mkdir(join(repoPath, "docs"), { recursive: true });
    await writeFile(join(repoPath, "docs", "safe-note.md"), "safe note\n", "utf8");
    await writeFile(join(repoPath, "docs", "not-approved.md"), "left uncommitted\n", "utf8");

    const result = await commitValidatedChanges({
      worktreePath: repoPath,
      taskId: "TASK-077",
      runId: "run-077",
      changedFilePaths: ["README.md", "docs/safe-note.md"],
      blockers: [],
      validationShouldBlockCommit: false,
    });

    const headHash = (await git(repoPath, ["rev-parse", "HEAD"])).trim();
    const lastCommit = await git(repoPath, ["show", "--name-only", "--format=%s%n%b", "HEAD"]);
    const status = await git(repoPath, ["status", "--porcelain=v1"]);

    expect(result).toEqual({
      taskId: "TASK-077",
      runId: "run-077",
      commitHash: headHash,
      changedFileCount: 2,
    });
    expect(result.commitHash).toMatch(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/u);
    expect(lastCommit).toContain("aicp: commit validated task changes");
    expect(lastCommit).toContain("Task: TASK-077");
    expect(lastCommit).toContain("Run: run-077");
    expect(lastCommit).toContain("README.md");
    expect(lastCommit).toContain("docs/safe-note.md");
    expect(lastCommit).not.toContain("updated safe contents");
    expect(status).toContain("?? docs/not-approved.md");
    expect(status).not.toContain("README.md");
    expect(status).not.toContain("docs/safe-note.md");
  });

  it("blocks pre-staged unapproved files before creating a commit", async () => {
    const repoPath = await createFixtureRepo();

    await writeFile(join(repoPath, "README.md"), "approved change\n", "utf8");
    await writeFile(join(repoPath, ".env"), "TOKEN=local-secret\n", "utf8");
    await git(repoPath, ["add", ".env"]);

    const initialHead = (await git(repoPath, ["rev-parse", "HEAD"])).trim();

    await expect(
      commitValidatedChanges({
        worktreePath: repoPath,
        taskId: "TASK-077",
        runId: "run-077",
        changedFilePaths: ["README.md"],
        blockers: [],
        validationShouldBlockCommit: false,
      }),
    ).rejects.toMatchObject({ code: "unapproved_staged_changes" });

    await expect(git(repoPath, ["rev-parse", "HEAD"])).resolves.toBe(`${initialHead}\n`);
    await expect(git(repoPath, ["status", "--porcelain=v1"])).resolves.toContain(" M README.md");
  });

  it("stages glob-like changed paths as literal filenames", async () => {
    const repoPath = await createFixtureRepo();

    await mkdir(join(repoPath, "docs"), { recursive: true });
    await writeFile(join(repoPath, "docs", "*.md"), "literal approved file\n", "utf8");
    await writeFile(join(repoPath, "docs", "other.md"), "unapproved file\n", "utf8");

    await commitValidatedChanges({
      worktreePath: repoPath,
      taskId: "TASK-077",
      runId: "run-077",
      changedFilePaths: ["docs/*.md"],
      blockers: [],
      validationShouldBlockCommit: false,
    });

    const lastCommit = await git(repoPath, ["show", "--name-only", "--format=", "HEAD"]);
    const status = await git(repoPath, ["status", "--porcelain=v1"]);

    expect(lastCommit).toContain("docs/*.md");
    expect(lastCommit).not.toContain("docs/other.md");
    expect(status).toContain("?? docs/other.md");
  });

  it("stages only explicit changedFilePaths with direct argv and never runs git add dot", async () => {
    const harness = createSuccessfulCommandRunner();

    await commitValidatedChanges(
      defaultOptions({
        changedFilePaths: ["src/b.ts", "src/a.ts", "src/a.ts"],
        commandRunner: harness.runner,
      }),
    );

    expect(harness.calls).toEqual([
      {
        command: "git",
        args: ["diff", "--cached", "--name-only", "-z"],
        cwd: "/tmp/aicp/task-077",
      },
      {
        command: "git",
        args: ["--literal-pathspecs", "add", "--", "src/a.ts", "src/b.ts"],
        cwd: "/tmp/aicp/task-077",
      },
      {
        command: "git",
        args: ["diff", "--cached", "--name-only", "-z"],
        cwd: "/tmp/aicp/task-077",
      },
      {
        command: "git",
        args: ["diff", "--cached", "--quiet", "--exit-code"],
        cwd: "/tmp/aicp/task-077",
      },
      {
        command: "git",
        args: [
          "--literal-pathspecs",
          "commit",
          "--only",
          "-m",
          "aicp: commit validated task changes",
          "-m",
          "Task: TASK-077\nRun: run-077",
          "--",
          "src/a.ts",
          "src/b.ts",
        ],
        cwd: "/tmp/aicp/task-077",
      },
      {
        command: "git",
        args: ["rev-parse", "HEAD"],
        cwd: "/tmp/aicp/task-077",
      },
    ]);
    expect(harness.calls[1]?.args).not.toContain(".");
  });

  it("blocks risk findings before any git mutation", async () => {
    const commandRunner = vi.fn<GitCommitCommandRunner>();

    await expect(
      commitValidatedChanges(
        defaultOptions({
          blockers: [blockedFinding()],
          commandRunner,
        }),
      ),
    ).rejects.toMatchObject({ code: "blocked_risk_findings" });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("blocks invalid risk findings before any git mutation", async () => {
    const commandRunner = vi.fn<GitCommitCommandRunner>();

    await expect(
      commitValidatedChanges(
        defaultOptions({
          blockers: [{ ...blockedFinding(), severity: "critical" } as unknown as RiskFinding],
          commandRunner,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_risk_finding" });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("blocks validation failures before any git mutation", async () => {
    const commandRunner = vi.fn<GitCommitCommandRunner>();

    await expect(
      commitValidatedChanges(
        defaultOptions({
          validationShouldBlockCommit: true,
          commandRunner,
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_blocked" });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it.each([
    ["/absolute/path.ts"],
    ["../outside.ts"],
    ["packages/../outside.ts"],
    ["packages\\github\\src\\index.ts"],
    ["C:/repo/file.ts"],
    ["src/\u0000secret.ts"],
    [".env"],
    [".env.production"],
    ["config/.env.local"],
    ["local.env"],
    ["config/local.env"],
    ["config/app.local.env"],
  ])("rejects unsafe changed file path %j before git", async (changedFilePath) => {
    const commandRunner = vi.fn<GitCommitCommandRunner>();

    await expect(
      commitValidatedChanges(
        defaultOptions({
          changedFilePaths: [changedFilePath],
          commandRunner,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_changed_file_path" });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("allows .env.example by path alone while still respecting prior secret scan blockers", async () => {
    const allowedHarness = createSuccessfulCommandRunner();
    const blockedRunner = vi.fn<GitCommitCommandRunner>();

    await expect(
      commitValidatedChanges(
        defaultOptions({
          changedFilePaths: [".env.example"],
          commandRunner: allowedHarness.runner,
        }),
      ),
    ).resolves.toMatchObject({ changedFileCount: 1 });

    await expect(
      commitValidatedChanges(
        defaultOptions({
          changedFilePaths: [".env.example"],
          blockers: [blockedFinding({ paths: [".env.example"] })],
          commandRunner: blockedRunner,
        }),
      ),
    ).rejects.toMatchObject({ code: "blocked_risk_findings" });
    expect(blockedRunner).not.toHaveBeenCalled();
  });

  it("fails without creating an empty commit when staged changes are empty", async () => {
    const harness = createSuccessfulCommandRunner({
      results: {
        stagedPaths: { exitCode: 0, stdoutSummary: "", stderrSummary: "" },
      },
    });

    await expect(
      commitValidatedChanges(defaultOptions({ commandRunner: harness.runner })),
    ).rejects.toMatchObject({ code: "no_staged_changes" });

    expect(harness.calls.map((call) => getGitStep(call))).toEqual([
      "stagedPaths",
      "add",
      "stagedPaths",
    ]);
  });

  it("does not serialize stdout, stderr, diffs, snippets, tokens, command output, or local paths on git failure", async () => {
    const unsafeOutput = [
      "diff --git a/src/secret.ts b/src/secret.ts",
      "patch text with code snippet",
      "const token = 'ghp_rawsecret1234567890';",
      "OPENAI_API_KEY=sk-rawsecret1234567890",
      "/tmp/aicp/task-077/src/secret.ts",
      "raw command output",
    ].join("\n");
    const harness = createSuccessfulCommandRunner({
      results: {
        add: {
          exitCode: 128,
          stdoutSummary: unsafeOutput,
          stderrSummary: unsafeOutput,
        },
      },
    });

    await expect(
      commitValidatedChanges(defaultOptions({ commandRunner: harness.runner })),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GitCommitError);
      expect(error).toMatchObject({
        code: "git_add_failed",
        metadata: { gitExitCode: 128, gitStep: "add" },
      });

      const serialized = JSON.stringify(error);
      const message = String(error);

      for (const unsafeText of [
        "diff --git",
        "patch text",
        "const token",
        "ghp_rawsecret",
        "OPENAI_API_KEY",
        "sk-rawsecret",
        "raw command output",
        "/tmp/aicp/task-077",
      ]) {
        expect(serialized).not.toContain(unsafeText);
        expect(message).not.toContain(unsafeText);
      }

      return true;
    });
  });

  it("rejects unsafe worktree and metadata values before git", async () => {
    const cases: Array<Partial<CommitValidatedChangesOptions>> = [
      { worktreePath: "relative/worktree" },
      { worktreePath: "/tmp/aicp/task-\u0001077" },
      { taskId: "TASK-077\nextra" },
      { runId: "GITHUB_TOKEN=ghp_rawsecret1234567890" },
      { changedFilePaths: [] },
    ];

    for (const overrides of cases) {
      const commandRunner = vi.fn<GitCommitCommandRunner>();

      await expect(
        commitValidatedChanges(defaultOptions({ ...overrides, commandRunner })),
      ).rejects.toBeInstanceOf(GitCommitError);
      expect(commandRunner).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["github_pat_11AA22BB33CC_abcdefghijklmnopqrstuvwxyz1234567890"],
    ["lin_api_fakeLinearApiToken1234567890"],
    ["AKIA1234567890ABCDEF"],
    ["ya29.abcdefghijklmnopqrstuvwx"],
    [["xoxb", "123456789012", "abcdefghijkl"].join("-")],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456"],
  ])("rejects secret-looking metadata value %j before git", async (metadataValue) => {
    const commandRunner = vi.fn<GitCommitCommandRunner>();

    await expect(
      commitValidatedChanges(
        defaultOptions({
          runId: metadataValue,
          commandRunner,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_metadata" });
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

const createSuccessfulCommandRunner = (
  options: {
    commitHash?: string;
    results?: Partial<
      Record<"add" | "stagedPaths" | "diff" | "commit" | "revParse", GitCommitCommandResult>
    >;
  } = {},
): {
  calls: GitCommitCommand[];
  runner: GitCommitCommandRunner;
} => {
  const calls: GitCommitCommand[] = [];
  const commitHash = options.commitHash ?? "a".repeat(40);
  let stagedPaths: string[] = [];
  const runner = vi.fn<GitCommitCommandRunner>(async (command) => {
    calls.push(command);

    const step = getGitStep(command);

    if (step === "add") {
      const separatorIndex = command.args.indexOf("--");
      stagedPaths = separatorIndex === -1 ? [] : command.args.slice(separatorIndex + 1);
    }

    const override = options.results?.[step];

    if (override !== undefined) {
      return override;
    }

    if (step === "stagedPaths") {
      return {
        exitCode: 0,
        stdoutSummary: stagedPaths.map((stagedPath) => `${stagedPath}\0`).join(""),
        stderrSummary: "",
      };
    }

    if (step === "diff") {
      return { exitCode: 1, stdoutSummary: "", stderrSummary: "" };
    }

    if (step === "revParse") {
      return { exitCode: 0, stdoutSummary: `${commitHash}\n`, stderrSummary: "" };
    }

    return { exitCode: 0, stdoutSummary: "", stderrSummary: "" };
  });

  return { calls, runner };
};

type GitCommitCommandResult = Awaited<ReturnType<GitCommitCommandRunner>>;

const getGitStep = (
  command: GitCommitCommand,
): "add" | "stagedPaths" | "diff" | "commit" | "revParse" => {
  const subcommand = command.args.find((arg) =>
    ["add", "diff", "commit", "rev-parse"].includes(arg),
  );

  if (subcommand === "add") {
    return "add";
  }

  if (subcommand === "diff") {
    return command.args.includes("--name-only") ? "stagedPaths" : "diff";
  }

  if (subcommand === "commit") {
    return "commit";
  }

  return "revParse";
};

const createFixtureRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "control-plane-git-commit-"));
  createdRepos.push(repoPath);

  await git(repoPath, ["init"]);
  await git(repoPath, ["config", "user.email", "runner@example.test"]);
  await git(repoPath, ["config", "user.name", "Control Plane Runner"]);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial commit"]);

  return repoPath;
};

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", [...args], { cwd });

  return stdout;
};
