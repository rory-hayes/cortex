import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  PrArtifactSchema,
  RepoPolicySchema,
  RunEventSchema,
  TaskPacketSchema,
  type CortexTask,
  type PrArtifact,
  type RepoPolicy,
  type RunEvent,
  type TaskPacket,
} from "@control-plane/shared";
import type { PushedBranchArtifact } from "@control-plane/github";
import type { ValidationSuiteResult } from "@control-plane/validation";
import { describe, expect, it } from "vitest";

import { createBareRemote } from "../fixtures/create-bare-remote.js";
import { createFixtureRepo, type FixtureRepo } from "../fixtures/create-fixture-repo.js";
import {
  createFixtureMockCodexAdapter,
  FIXTURE_CODEX_CHANGED_PATH,
  FIXTURE_CODEX_FILE_CONTENTS,
} from "../mocks/codex.js";
import { withMockGhOnPath, type MockGhInvocation } from "../mocks/gh.js";
import { runCodexForTask, runCommand, runRunner } from "../../src/index.js";

const TASK_ID = "packet_cortex_task_runner_e2e";
const CORTEX_TASK_ID = "cortex_task_runner_e2e";
const RUN_ID = "run_cortex_task_runner_e2e";
const REPOSITORY_ID = "acme/fixture-runner";
const TARGET_BRANCH = `aicp/cortex-task-${CORTEX_TASK_ID}-${RUN_ID}`;
const PR_TITLE = "Run Cortex Task through local runner E2E";
const CREATED_AT = "2026-05-22T02:16:08.828Z";

describe("runner happy-path E2E", () => {
  it("rejects diff hunk markers embedded in serialized web-bound text", () => {
    expect(() =>
      assertNoUnsafeText(JSON.stringify({ message: "safe prefix @@ -1 +1 @@ safe suffix" })),
    ).toThrow();
  });

  it("runs a Cortex Task-derived packet to the mocked PR artifact loop without leaking raw source artifacts", async () => {
    const fixture = await createFixtureRepo({ defaultBranch: "fixture-main" });
    const remote = await createBareRemote({ fixture });
    const workspace = await mkdtemp(join(tmpdir(), "aicp-runner-happy-path-"));

    try {
      const taskPath = join(workspace, "task-packet.json");
      const configPath = join(workspace, "runner-config.json");
      const eventsOutPath = join(workspace, "events.jsonl");
      const policy = await readFixturePolicy(fixture);
      const taskPacket = createHappyPathCortexTaskPacket({
        fixture,
        policy,
      });

      expect(TaskPacketSchema.safeParse(taskPacket).success).toBe(true);
      expect(taskPacket).toMatchObject({
        acceptanceCriteria: ["The fixture validation command passes."],
        context: {
          files: [],
          notes: expect.arrayContaining([
            `Cortex task id: ${CORTEX_TASK_ID}.`,
            "Risk level: medium.",
            "Origin type: finding.",
            "Finding count: 1.",
          ]),
        },
        id: TASK_ID,
        mode: "execute",
        objective: "Update the fixture app marker for the runner happy-path proof.",
        repo: {
          defaultBranch: fixture.defaultBranch,
          localPath: fixture.repoPath,
          targetBranch: TARGET_BRANCH,
        },
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        source: {
          title: PR_TITLE,
          type: "manual",
        },
        workspaceId: "workspace-runner-e2e",
      });
      expect(taskPacket.repo).not.toHaveProperty("worktreePath");

      await writeJsonFile(taskPath, taskPacket);
      await writeJsonFile(configPath, {
        worktreeRoot: join(workspace, "worktrees"),
        eventsOut: eventsOutPath,
        mockModes: {
          codex: true,
          gh: false,
        },
      });

      await withCodexVersionOnPath(async () =>
        withMockGhOnPath(
          {
            owner: "acme",
            repo: "fixture-runner",
            prNumber: 94,
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
                runCodex: (options) =>
                  runCodexForTask(options, {
                    createMockAdapter: createFixtureMockCodexAdapter,
                  }),
              },
            );

            expect(result.exitCode).toBe(0);
            expect(result.eventsOut).toBe(eventsOutPath);
            expect(result.dryRunResult?.status).toBe("passed");
            expect(result.dryRunResult?.blockers).toEqual([]);
            expect(result.dryRunResult?.capabilities.tools.codex?.available).toBe(true);
            expect(result.dryRunResult?.capabilities.tools.gh?.available).toBe(true);
            const worktreePath = expectDefined(
              result.worktreeResult?.worktreePath,
              "missing worktree path",
            );
            expect(worktreePath).toMatch(/\/run-cortex-task-runner-e2e-[a-f0-9]{12}$/u);
            expect(result.codexResult).toMatchObject({
              adapterMode: "mock",
              status: "succeeded",
              exitCode: 0,
              redactionApplied: true,
            });
            expect(result.changeScanResult?.changedFiles.paths).toEqual([
              FIXTURE_CODEX_CHANGED_PATH,
            ]);
            expect(result.changeScanResult?.blockers).toEqual([]);
            expect(result.changeScanResult?.shouldBlock).toBe(false);
            expect(result.validationResult?.status).toBe("passed");
            expect(result.validationResult?.shouldBlockCommit).toBe(false);
            expect(result.validationResult?.blockers).toEqual([]);

            const githubResult = expectDefined(result.githubResult, "missing GitHub result");
            const commitHash = githubResult.commitResult.commitHash;
            expect(commitHash).toMatch(/^[a-f0-9]{40}$/u);
            expect(githubResult.pushArtifact).toMatchObject({
              branchName: TARGET_BRANCH,
              remoteName: "origin",
              remoteRef: `refs/heads/${TARGET_BRANCH}`,
              commitHash,
            });

            const prArtifact = PrArtifactSchema.parse(githubResult.prArtifact);
            expect(prArtifact).toMatchObject({
              runId: RUN_ID,
              repository: {
                owner: "acme",
                name: "fixture-runner",
              },
              branchName: TARGET_BRANCH,
              prNumber: 94,
              prUrl: "https://github.example.test/acme/fixture-runner/pull/94",
              prTitle: `${TASK_ID}: ${PR_TITLE}`,
              prStatus: "draft",
              changedFilePaths: [FIXTURE_CODEX_CHANGED_PATH],
              riskFindings: [],
            });

            const events = await readRunEvents(eventsOutPath);
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
              "pr_opened",
              "awaiting_approval",
            ]);
            expect(new Set(events.map((event) => event.idempotencyKey)).size).toBe(events.length);
            for (const event of events) {
              expect(event.idempotencyKey).toMatch(/^run:run_cortex_task_runner_e2e:event:/u);
            }

            expect(events[5]?.metadata).toMatchObject({
              changedFilePaths: [FIXTURE_CODEX_CHANGED_PATH],
              blockerCount: 0,
              warningCount: 0,
              shouldBlock: false,
            });
            expect(events[8]?.metadata).toMatchObject({
              branchName: TARGET_BRANCH,
              remoteName: "origin",
              remoteRef: `refs/heads/${TARGET_BRANCH}`,
              commitHash,
            });
            expect(events[9]?.metadata).toMatchObject({
              branchName: TARGET_BRANCH,
              prNumber: 94,
              prStatus: "draft",
              changedFilePaths: [FIXTURE_CODEX_CHANGED_PATH],
              riskFindings: [],
            });
            expect(events[10]?.metadata).toEqual(events[9]?.metadata);

            await assertGitState({
              fixture,
              remotePath: remote.remotePath,
              worktreePath,
              commitHash,
            });

            const ghInvocations = await ghHarness.readInvocations();
            expect(ghInvocations).toEqual([
              {
                command: "gh",
                args: ["--version"],
                stdinLength: 0,
                stdinSha256: sha256(""),
              },
              {
                command: "gh",
                args: [
                  "pr",
                  "create",
                  "--draft",
                  "--base",
                  "fixture-main",
                  "--head",
                  TARGET_BRANCH,
                  "--title",
                  `${TASK_ID}: ${PR_TITLE}`,
                  "--body-file",
                  "-",
                ],
                stdinLength: expect.any(Number),
                stdinSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
              },
            ]);
            expect(ghInvocations[1]?.stdinLength).toBeGreaterThan(0);

            assertSafeWebBoundArtifacts({
              events,
              validationResult: expectDefined(result.validationResult, "missing validation result"),
              prArtifact,
              pushArtifact: githubResult.pushArtifact,
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
  }, 60_000);
});

const readFixturePolicy = async (fixture: FixtureRepo): Promise<RepoPolicy> =>
  RepoPolicySchema.parse(JSON.parse(await readFile(fixture.policyPath, "utf8")));

const createHappyPathCortexTaskPacket = ({
  fixture,
  policy,
}: {
  fixture: FixtureRepo;
  policy: RepoPolicy;
}): TaskPacket => {
  const cortexTask = CortexTaskSchema.parse({
    acceptanceCriteria: ["The fixture validation command passes."],
    approvalStatus: "approved",
    contractVersion: CONTRACT_VERSION,
    createdAt: CREATED_AT,
    executionMode: "local_runner",
    externalLinks: [],
    findingIds: ["finding_runner_e2e"],
    metadata: {},
    objective: "Update the fixture app marker for the runner happy-path proof.",
    origin: {
      type: "finding",
    },
    prArtifactIds: [],
    repoId: "github_repo_runner_e2e",
    riskLevel: "medium",
    runIds: [],
    status: "approved",
    suggestedValidation: policy.validationCommands.map((command) => ({
      label: command.label,
      required: command.required,
      validationId: command.id,
    })),
    taskId: CORTEX_TASK_ID,
    title: PR_TITLE,
    updatedAt: CREATED_AT,
    workspaceId: "workspace-runner-e2e",
  } satisfies CortexTask);

  return convertCortexTaskFixtureToTaskPacket({
    cortexTask,
    fixture,
    policy,
  });
};

const convertCortexTaskFixtureToTaskPacket = ({
  cortexTask,
  fixture,
  policy,
}: {
  cortexTask: CortexTask;
  fixture: FixtureRepo;
  policy: RepoPolicy;
}): TaskPacket =>
  TaskPacketSchema.parse({
    acceptanceCriteria: cortexTask.acceptanceCriteria,
    context: {
      files: [],
      notes: [
        `Cortex task id: ${cortexTask.taskId}.`,
        `Risk level: ${cortexTask.riskLevel}.`,
        `Origin type: ${cortexTask.origin.type}.`,
        `Finding count: ${cortexTask.findingIds.length}.`,
        `Suggested validation labels: ${cortexTask.suggestedValidation
          .map(
            (validation) =>
              `${validation.label} (${validation.required ? "required" : "optional"})`,
          )
          .join(", ")}.`,
      ],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: CREATED_AT,
    id: TASK_ID,
    mode: "execute",
    objective: cortexTask.objective,
    policy,
    repo: {
      defaultBranch: fixture.defaultBranch,
      localPath: fixture.repoPath,
      targetBranch: TARGET_BRANCH,
    },
    repositoryId: REPOSITORY_ID,
    runId: RUN_ID,
    source: {
      title: cortexTask.title,
      type: "manual",
    },
    validation: {
      commands: policy.validationCommands,
    },
    workspaceId: cortexTask.workspaceId,
  });

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const readRunEvents = async (eventsOutPath: string): Promise<RunEvent[]> =>
  (await readFile(eventsOutPath, "utf8"))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => RunEventSchema.parse(JSON.parse(line)));

const assertGitState = async ({
  fixture,
  remotePath,
  worktreePath,
  commitHash,
}: {
  fixture: FixtureRepo;
  remotePath: string;
  worktreePath: string;
  commitHash: string;
}): Promise<void> => {
  await expect(runGitStdout(fixture.repoPath, ["rev-parse", "HEAD"])).resolves.toBe(
    fixture.baseCommit,
  );
  await expect(
    runGitStdout(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
  ).resolves.toBe(TARGET_BRANCH);
  await expect(runGitStdout(worktreePath, ["rev-parse", "HEAD"])).resolves.toBe(commitHash);
  await expect(
    runGitStdout(fixture.rootPath, [
      "--git-dir",
      remotePath,
      "rev-parse",
      `refs/heads/${TARGET_BRANCH}`,
    ]),
  ).resolves.toBe(commitHash);

  const committedFiles = (
    await runGitStdout(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
  )
    .split("\n")
    .filter((path) => path.length > 0);

  expect(committedFiles).toEqual([FIXTURE_CODEX_CHANGED_PATH]);
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
  events,
  validationResult,
  prArtifact,
  pushArtifact,
  ghInvocations,
}: {
  events: RunEvent[];
  validationResult: ValidationSuiteResult;
  prArtifact: PrArtifact;
  pushArtifact: PushedBranchArtifact;
  ghInvocations: MockGhInvocation[];
}): void => {
  const webBoundArtifacts = {
    events,
    validationResults: validationResult.results,
    validationWarnings: validationResult.warnings,
    validationBlockers: validationResult.blockers,
    prArtifact,
    pushArtifact,
    ghInvocations,
  };

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
  "fixture application",
  "mock codex fixture behavior applied",
  FIXTURE_CODEX_FILE_CONTENTS,
];

const UNSAFE_TEXT_PATTERNS = [
  /diff --git/iu,
  /@@\s+[-+0-9, ]+@@/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u,
  /\bsk-[A-Za-z0-9_-]{12,}\b/u,
  /\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]/iu,
  /\braw\s+(?:stdout|stderr|output|log)\b/iu,
  /\bunredacted command output\b/iu,
];

const expectDefined = <Value>(value: Value | undefined, message: string): Value => {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
