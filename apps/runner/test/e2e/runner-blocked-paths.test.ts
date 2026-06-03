import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import {
  CONTRACT_VERSION,
  RepoPolicySchema,
  RunEventSchema,
  TaskPacketSchema,
  type RepoPolicy,
  type RunEvent,
  type TaskPacket,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { createBareRemote } from "../fixtures/create-bare-remote.js";
import { createFixtureRepo, type FixtureRepo } from "../fixtures/create-fixture-repo.js";
import { withMockGhOnPath, type MockGhInvocation } from "../mocks/gh.js";
import {
  runCommand,
  runRunner,
  type RunCodexForTaskOptions,
  type RunCodexForTaskResult,
  type RunnerCancellationChecker,
  type RunRunnerResult,
} from "../../src/index.js";

const TASK_ID = "TASK-095";
const REPOSITORY_ID = "acme/fixture-runner";
const CREATED_AT = "2026-05-22T02:51:43.764Z";

describe("runner blocked-path E2E", () => {
  it("blocks .env changes before validation, commit, push, PR, or approval", async () => {
    await runBlockedScenario({
      runId: "run-task-095-env-change",
      targetBranch: "aicp/task-095-env-change",
      runCodex: writeWorktreeFile(".env.local", "EXAMPLE_VALUE=placeholder\n"),
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(1);
        expect(result.dryRunResult?.status).toBe("passed");
        expect(result.changeScanResult?.blockers.map((finding) => finding.category)).toContain(
          "sensitive_path",
        );
        expect(result.changeScanResult?.shouldBlock).toBe(true);
        expect(result.validationResult).toBeUndefined();
        expect(result.githubResult).toBeUndefined();
        expect(events.map((event) => event.state)).toEqual([
          "dry_run_running",
          "dry_run_passed",
          "worktree_created",
          "codex_running",
          "codex_running",
          "changes_scanned",
          "blocked",
        ]);
        await assertNoCommitOrPr({
          fixture,
          remotePath,
          worktreePath,
          targetBranch: "aicp/task-095-env-change",
          result,
          events,
          ghInvocations,
          expectWorktree: true,
        });
      },
    });
  }, 60_000);

  it("blocks suspected provider tokens before commit, push, PR, or approval", async () => {
    await runBlockedScenario({
      runId: "run-task-095-secret-change",
      targetBranch: "aicp/task-095-secret-change",
      runCodex: writeWorktreeFile("src/config.txt", buildProviderTokenFixtureContents()),
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(1);
        expect(result.changeScanResult?.blockers.map((finding) => finding.category)).toContain(
          "secret",
        );
        expect(result.validationResult).toBeUndefined();
        expect(result.githubResult).toBeUndefined();
        await assertNoCommitOrPr({
          fixture,
          remotePath,
          worktreePath,
          targetBranch: "aicp/task-095-secret-change",
          result,
          events,
          ghInvocations,
          expectWorktree: true,
        });
      },
    });
  }, 60_000);

  it("blocks protected paths before commit, push, PR, or approval", async () => {
    await runBlockedScenario({
      runId: "run-task-095-protected-path",
      targetBranch: "aicp/task-095-protected-path",
      runCodex: writeWorktreeFile(
        ".github/workflows/blocked.yml",
        "name: blocked\non: workflow_dispatch\njobs: {}\n",
      ),
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(1);
        expect(result.changeScanResult?.blockers.map((finding) => finding.category)).toContain(
          "protected_path",
        );
        expect(result.validationResult).toBeUndefined();
        expect(result.githubResult).toBeUndefined();
        await assertNoCommitOrPr({
          fixture,
          remotePath,
          worktreePath,
          targetBranch: "aicp/task-095-protected-path",
          result,
          events,
          ghInvocations,
          expectWorktree: true,
        });
      },
    });
  }, 60_000);

  it("blocks failed required validation before commit, push, PR, or approval", async () => {
    await runBlockedScenario({
      runId: "run-task-095-validation-failed",
      targetBranch: "aicp/task-095-validation-failed",
      runCodex: writeWorktreeFile("src/app.txt", "validation marker intentionally missing\n"),
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(1);
        expect(result.changeScanResult?.blockers).toEqual([]);
        expect(result.validationResult?.status).toBe("failed");
        expect(result.validationResult?.shouldBlockCommit).toBe(true);
        expect(result.validationResult?.blockers).toEqual([
          {
            commandId: "fixture-validate",
            commandLabel: "Fixture validation",
            status: "failed",
            message: "Required validation command failed.",
          },
        ]);
        expect(result.githubResult).toBeUndefined();
        expect(events.map((event) => event.state)).toEqual([
          "dry_run_running",
          "dry_run_passed",
          "worktree_created",
          "codex_running",
          "codex_running",
          "changes_scanned",
          "validation_running",
          "blocked",
        ]);
        await assertNoCommitOrPr({
          fixture,
          remotePath,
          worktreePath,
          targetBranch: "aicp/task-095-validation-failed",
          result,
          events,
          ghInvocations,
          expectWorktree: true,
        });
      },
    });
  }, 60_000);

  it("blocks dirty repos during readiness without creating a worktree branch or PR artifact", async () => {
    await runBlockedScenario({
      runId: "run-task-095-dirty-repo",
      targetBranch: "aicp/task-095-dirty-repo",
      beforeRun: async ({ fixture }) => {
        await writeFile(join(fixture.repoPath, "local-dirty-file.txt"), "local-only dirty file\n");
      },
      runCodex: async () => {
        throw new Error("Codex must not run when dry-run readiness fails.");
      },
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(1);
        expect(result.dryRunResult?.status).toBe("failed");
        expect(result.dryRunResult?.blockers.map((finding) => finding.category)).toContain(
          "dirty_repo",
        );
        expect(result.worktreeResult).toBeUndefined();
        expect(result.codexResult).toBeUndefined();
        expect(result.changeScanResult).toBeUndefined();
        expect(result.validationResult).toBeUndefined();
        expect(result.githubResult).toBeUndefined();
        expect(events.map((event) => event.state)).toEqual(["dry_run_running", "blocked"]);
        await assertNoCommitOrPr({
          fixture,
          remotePath,
          worktreePath,
          targetBranch: "aicp/task-095-dirty-repo",
          result,
          events,
          ghInvocations,
          expectWorktree: false,
        });
        await expect(
          runGitExitCode(fixture.repoPath, [
            "show-ref",
            "--verify",
            "refs/heads/aicp/task-095-dirty-repo",
          ]),
        ).resolves.not.toBe(0);
      },
    });
  }, 60_000);

  it("honors cancellation before commit, cleans up the worktree, and does not push or open a PR", async () => {
    await runBlockedScenario({
      runId: "run-task-095-cancel-before-commit",
      targetBranch: "aicp/task-095-cancel-before-commit",
      runCodex: writeWorktreeFile(
        "src/app.txt",
        "fixture application\nsafe cancellation proof change\n",
      ),
      checkCancellation: async (context) => context.boundary === "before_commit",
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(130);
        expect(result.changeScanResult?.blockers).toEqual([]);
        expect(result.validationResult?.status).toBe("passed");
        expect(result.validationResult?.shouldBlockCommit).toBe(false);
        expect(result.githubResult).toBeUndefined();
        expect(events.map((event) => event.state)).toEqual([
          "dry_run_running",
          "dry_run_passed",
          "worktree_created",
          "codex_running",
          "codex_running",
          "changes_scanned",
          "validation_running",
          "validation_running",
          "cancel_requested",
          "cancelling",
          "cancelled",
        ]);
        expect(events.slice(-3).map((event) => event.metadata)).toEqual([
          { boundary: "before_commit" },
          { boundary: "before_commit" },
          {
            boundary: "before_commit",
            cleanupAttempted: true,
            cleanupSucceeded: true,
          },
        ]);
        await assertNoCommitOrPr({
          fixture,
          remotePath,
          worktreePath,
          targetBranch: "aicp/task-095-cancel-before-commit",
          result,
          events,
          ghInvocations,
          expectWorktree: false,
        });
      },
    });
  }, 60_000);

  it("honors cancellation before PR creation and does not open a PR", async () => {
    const targetBranch = "aicp/task-095-cancel-before-pr";

    await runBlockedScenario({
      runId: "run-task-095-cancel-before-pr",
      targetBranch,
      runCodex: writeWorktreeFile(
        "src/app.txt",
        "fixture application\nsafe before PR cancellation proof change\n",
      ),
      checkCancellation: async (context) => context.boundary === "before_pr_creation",
      assertResult: async ({
        fixture,
        remotePath,
        worktreePath,
        result,
        events,
        ghInvocations,
      }) => {
        expect(result.exitCode).toBe(130);
        expect(result.changeScanResult?.blockers).toEqual([]);
        expect(result.validationResult?.status).toBe("passed");
        expect(result.validationResult?.shouldBlockCommit).toBe(false);
        expect(result.githubResult).toBeUndefined();
        expect(events.map((event) => event.state)).toEqual([
          "dry_run_running",
          "dry_run_passed",
          "worktree_created",
          "codex_running",
          "codex_running",
          "changes_scanned",
          "validation_running",
          "validation_running",
          "pushed",
          "cancel_requested",
          "cancelling",
          "cancelled",
        ]);
        expect(events.slice(-3).map((event) => event.metadata)).toEqual([
          { boundary: "before_pr_creation" },
          { boundary: "before_pr_creation" },
          {
            boundary: "before_pr_creation",
            cleanupAttempted: true,
            cleanupSucceeded: true,
          },
        ]);
        await assertNoPrAfterBeforePrCancellation({
          fixture,
          remotePath,
          worktreePath,
          targetBranch,
          result,
          events,
          ghInvocations,
        });
      },
    });
  }, 120_000);
});

type BlockedScenarioContext = {
  fixture: FixtureRepo;
  workspace: string;
  worktreePath: string;
  taskPath: string;
  configPath: string;
  eventsOutPath: string;
  policy: RepoPolicy;
};

type BlockedScenarioResultContext = {
  fixture: FixtureRepo;
  remotePath: string;
  worktreePath: string;
  result: RunRunnerResult;
  events: RunEvent[];
  ghInvocations: MockGhInvocation[];
};

type BlockedScenarioOptions = {
  runId: string;
  targetBranch: string;
  runCodex: (options: RunCodexForTaskOptions) => Promise<RunCodexForTaskResult>;
  beforeRun?: (context: BlockedScenarioContext) => Promise<void>;
  checkCancellation?: RunnerCancellationChecker;
  assertResult: (context: BlockedScenarioResultContext) => Promise<void>;
};

const runBlockedScenario = async ({
  runId,
  targetBranch,
  runCodex,
  beforeRun,
  checkCancellation,
  assertResult,
}: BlockedScenarioOptions): Promise<void> => {
  const fixture = await createFixtureRepo({ defaultBranch: "fixture-main" });
  const remote = await createBareRemote({ fixture });
  const workspace = await mkdtemp(join(tmpdir(), "aicp-runner-blocked-paths-"));

  try {
    const worktreePath = join(workspace, "worktrees", runId);
    const taskPath = join(workspace, "task-packet.json");
    const configPath = join(workspace, "runner-config.json");
    const eventsOutPath = join(workspace, "events.jsonl");
    const policy = await readFixturePolicy(fixture);
    const taskPacket = createTaskPacket({
      fixture,
      runId,
      targetBranch,
      worktreePath,
      policy,
    });

    await writeTaskPacket(taskPath, taskPacket);
    await writeJsonFile(configPath, {
      worktreeRoot: join(workspace, "worktrees"),
      eventsOut: eventsOutPath,
      mockModes: {
        codex: true,
        gh: false,
      },
    });
    await beforeRun?.({
      fixture,
      workspace,
      worktreePath,
      taskPath,
      configPath,
      eventsOutPath,
      policy,
    });

    await withCodexVersionOnPath(async () =>
      withMockGhOnPath(
        {
          owner: "acme",
          repo: "fixture-runner",
          prNumber: 95,
        },
        async (ghHarness) => {
          const result = await runRunner(
            {
              command: "run",
              repo: fixture.repoPath,
              task: taskPath,
              dryRun: false,
              configPath,
            },
            {
              runCodex,
              ...(checkCancellation === undefined ? {} : { checkCancellation }),
            },
          );
          const events = await readRunEvents(eventsOutPath);
          const ghInvocations = await ghHarness.readInvocations();

          assertSafeWebBoundArtifacts({
            result,
            events,
            ghInvocations,
          });
          await assertResult({
            fixture,
            remotePath: remote.remotePath,
            worktreePath,
            result,
            events,
            ghInvocations,
          });
        },
      ),
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
    await remote.cleanup();
    await fixture.cleanup();
  }
};

const readFixturePolicy = async (fixture: FixtureRepo): Promise<RepoPolicy> =>
  RepoPolicySchema.parse(JSON.parse(await readFile(fixture.policyPath, "utf8")));

const createTaskPacket = ({
  fixture,
  runId,
  targetBranch,
  worktreePath,
  policy,
}: {
  fixture: FixtureRepo;
  runId: string;
  targetBranch: string;
  worktreePath: string;
  policy: RepoPolicy;
}): TaskPacket =>
  TaskPacketSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: TASK_ID,
    workspaceId: "workspace-runner-e2e",
    repositoryId: REPOSITORY_ID,
    runId,
    mode: "execute",
    objective: "Prove runner hard-block paths stop before commit, push, and PR creation.",
    acceptanceCriteria: ["Unsafe fixture changes do not cross the GitHub boundary."],
    source: {
      type: "manual",
      externalId: "manual-task-095",
      title: "Add runner blocked-path integration tests",
    },
    repo: {
      localPath: fixture.repoPath,
      defaultBranch: fixture.defaultBranch,
      targetBranch,
      worktreePath,
    },
    context: {
      files: ["src/app.txt"],
      notes: ["Use local fixture changes only."],
    },
    policy,
    validation: {
      commands: policy.validationCommands,
    },
    createdAt: CREATED_AT,
  });

const writeTaskPacket = async (filePath: string, taskPacket: TaskPacket): Promise<void> => {
  await writeJsonFile(filePath, taskPacket);
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const readRunEvents = async (eventsOutPath: string): Promise<RunEvent[]> =>
  (await readFile(eventsOutPath, "utf8"))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => RunEventSchema.parse(JSON.parse(line)));

const writeWorktreeFile =
  (
    relativePath: string,
    contents: string,
  ): ((options: RunCodexForTaskOptions) => Promise<RunCodexForTaskResult>) =>
  async ({ worktreePath }) => {
    const absolutePath = join(worktreePath, relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");

    return {
      adapterMode: "mock",
      status: "succeeded",
      exitCode: 0,
      durationMs: 1,
      redactionApplied: true,
    };
  };

const buildProviderTokenFixtureContents = (): string => {
  const prefix = ["g", "h", "p", "_"].join("");
  const tokenBody = Array.from({ length: 16 }, (_, index) =>
    String.fromCharCode("A".charCodeAt(0) + (index % 26)),
  ).join("");

  return `provider token fixture: ${prefix}${tokenBody}\n`;
};

const assertNoCommitOrPr = async ({
  fixture,
  remotePath,
  worktreePath,
  targetBranch,
  result,
  events,
  ghInvocations,
  expectWorktree,
}: {
  fixture: FixtureRepo;
  remotePath: string;
  worktreePath: string;
  targetBranch: string;
  result: RunRunnerResult;
  events: RunEvent[];
  ghInvocations: MockGhInvocation[];
  expectWorktree: boolean;
}): Promise<void> => {
  expect(result.githubResult).toBeUndefined();
  expect(events.map((event) => event.state)).not.toContain("pushed");
  expect(events.map((event) => event.state)).not.toContain("pr_opened");
  expect(events.map((event) => event.state)).not.toContain("awaiting_approval");
  expect(ghInvocations.some((invocation) => isGhPrCreateInvocation(invocation))).toBe(false);
  await expect(runGitStdout(fixture.repoPath, ["rev-parse", "HEAD"])).resolves.toBe(
    fixture.baseCommit,
  );
  await expect(
    runGitExitCode(fixture.rootPath, [
      "--git-dir",
      remotePath,
      "rev-parse",
      `refs/heads/${targetBranch}`,
    ]),
  ).resolves.not.toBe(0);

  if (expectWorktree) {
    await expect(runGitStdout(worktreePath, ["rev-parse", "HEAD"])).resolves.toBe(
      fixture.baseCommit,
    );
    await expect(
      runGitStdout(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    ).resolves.toBe(targetBranch);
  } else {
    await expect(
      runGitExitCode(worktreePath, ["rev-parse", "--is-inside-work-tree"]),
    ).resolves.not.toBe(0);
  }
};

const assertNoPrAfterBeforePrCancellation = async ({
  fixture,
  remotePath,
  worktreePath,
  targetBranch,
  result,
  events,
  ghInvocations,
}: {
  fixture: FixtureRepo;
  remotePath: string;
  worktreePath: string;
  targetBranch: string;
  result: RunRunnerResult;
  events: RunEvent[];
  ghInvocations: MockGhInvocation[];
}): Promise<void> => {
  expect(result.githubResult).toBeUndefined();
  expect(events.map((event) => event.state)).toContain("pushed");
  expect(events.map((event) => event.state)).not.toContain("pr_opened");
  expect(events.map((event) => event.state)).not.toContain("awaiting_approval");
  expect(ghInvocations.some((invocation) => isGhPrCreateInvocation(invocation))).toBe(false);
  await expect(runGitStdout(fixture.repoPath, ["rev-parse", "HEAD"])).resolves.toBe(
    fixture.baseCommit,
  );
  await expect(
    runGitExitCode(worktreePath, ["rev-parse", "--is-inside-work-tree"]),
  ).resolves.not.toBe(0);
  await expect(
    runGitExitCode(fixture.rootPath, [
      "--git-dir",
      remotePath,
      "rev-parse",
      `refs/heads/${targetBranch}`,
    ]),
  ).resolves.toBe(0);
};

const runGitStdout = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await runCommand({
    command: "git",
    args,
    cwd,
    throwOnNonZero: true,
  });

  return result.stdoutSummary.trim();
};

const runGitExitCode = async (cwd: string, args: readonly string[]): Promise<number> => {
  const result = await runCommand({
    command: "git",
    args,
    cwd,
  });

  return result.exitCode;
};

const withCodexVersionOnPath = async <Result>(
  callback: () => Result | Promise<Result>,
): Promise<Result> => {
  const rootPath = await mkdtemp(join(tmpdir(), "aicp-mock-codex-version-"));
  const binDir = join(rootPath, "bin");
  const codexPath = join(binDir, "codex");
  const originalPath = process.env.PATH;

  await mkdir(binDir, { recursive: true });
  await writeFile(
    codexPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("codex 1.2.3\\n");
  process.exit(0);
}
process.stderr.write("mock codex: unsupported command\\n");
process.exit(2);
`,
    { encoding: "utf8", mode: 0o700 },
  );
  await chmod(codexPath, 0o700);
  process.env.PATH =
    typeof originalPath === "string" && originalPath.length > 0
      ? `${binDir}${delimiter}${originalPath}`
      : binDir;

  try {
    return await callback();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }

    await rm(rootPath, { force: true, recursive: true });
  }
};

const assertSafeWebBoundArtifacts = ({
  result,
  events,
  ghInvocations,
}: {
  result: RunRunnerResult;
  events: RunEvent[];
  ghInvocations: MockGhInvocation[];
}): void => {
  const webBoundArtifacts = {
    dryRunResult: result.dryRunResult,
    codexResult: result.codexResult,
    changeScanResult: result.changeScanResult,
    validationResult: result.validationResult,
    githubResult: result.githubResult,
    events,
    ghInvocations,
  };

  for (const event of events) {
    expect(RunEventSchema.safeParse(event).success).toBe(true);
  }

  assertNoUnsafeKeys(webBoundArtifacts);
  assertNoUnsafeText(JSON.stringify(webBoundArtifacts));
};

const assertNoUnsafeKeys = (value: unknown, path: string[] = []): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnsafeKeys(item, [...path, String(index)]));
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    expect(UNSAFE_PAYLOAD_KEYS, `unsafe key at ${[...path, key].join(".")}`).not.toContain(
      normalizedKey,
    );
    assertNoUnsafeKeys(childValue, [...path, key]);
  }
};

const assertNoUnsafeText = (serialized: string): void => {
  for (const rawFixtureContent of RAW_FIXTURE_CONTENT_MARKERS) {
    expect(serialized).not.toContain(rawFixtureContent);
  }

  for (const pattern of UNSAFE_TEXT_PATTERNS) {
    expect(serialized).not.toMatch(pattern);
  }
};

const isGhPrCreateInvocation = (invocation: MockGhInvocation): boolean =>
  invocation.args[0] === "pr" && invocation.args[1] === "create";

const UNSAFE_PAYLOAD_KEYS = [
  "diff",
  "patch",
  "source",
  "sourcecode",
  "snippet",
  "content",
  "contents",
  "rawoutput",
];

const RAW_FIXTURE_CONTENT_MARKERS = [
  "EXAMPLE_VALUE=placeholder",
  "fixture application",
  "jobs: {}",
  "local-only dirty file",
  "name: blocked",
  "on: workflow_dispatch",
  "safe before PR cancellation proof change",
  "provider token fixture",
  "safe cancellation proof change",
  "validation marker intentionally missing",
];

const UNSAFE_TEXT_PATTERNS = [
  /diff --git/iu,
  /@@\s+[-+0-9, ]+@@/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u,
  /\bsk-[A-Za-z0-9_-]{12,}\b/u,
  /(?:^|[\s"'`{,])(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]\s*['"]?[^\s'",;})]+/imu,
  /\braw\s+(?:stdout|stderr|output|log)\b/iu,
  /\bunredacted command output\b/iu,
];
