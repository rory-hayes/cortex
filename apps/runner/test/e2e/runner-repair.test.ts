import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CONTRACT_VERSION,
  PrArtifactSchema,
  RepoPolicySchema,
  RunEventSchema,
  TaskPacketSchema,
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

const TASK_ID = "TASK-147";
const RUN_ID = "run-task-147-repair";
const PREVIOUS_RUN_ID = "run-task-147-original";
const REPOSITORY_ID = "acme/fixture-runner";
const TARGET_BRANCH = "aicp/task-147-existing-pr";
const PR_TITLE = "TASK-094: Existing fixture PR";
const REPAIR_FEEDBACK = "REPAIR FEEDBACK SENTINEL MUST NOT LEAK";
const CREATED_AT = "2026-05-24T09:44:00.000Z";

describe("runner repair E2E", () => {
  it("updates the existing PR branch and submits metadata-only PR artifact output", async () => {
    const fixture = await createFixtureRepo({ defaultBranch: "fixture-main" });
    const remote = await createBareRemote({ fixture });
    const workspace = await mkdtemp(join(tmpdir(), "aicp-runner-repair-"));

    try {
      await createExistingTaskBranch(fixture);
      const previousBranchHead = await runGitStdout(fixture.repoPath, ["rev-parse", TARGET_BRANCH]);
      const worktreePath = join(workspace, "worktrees", RUN_ID);
      const taskPath = join(workspace, "repair-packet.json");
      const configPath = join(workspace, "runner-config.json");
      const eventsOutPath = join(workspace, "events.jsonl");
      const policy = await readFixturePolicy(fixture);
      const taskPacket = createRepairTaskPacket({
        fixture,
        policy,
        worktreePath,
      });

      await writeJsonFile(taskPath, taskPacket);
      await writeJsonFile(configPath, {
        worktreeRoot: join(workspace, "worktrees"),
        eventsOut: eventsOutPath,
        mockModes: {
          codex: true,
          gh: false,
        },
      });

      await withMockGhOnPath(
        {
          owner: "acme",
          repo: "fixture-runner",
          prNumber: 147,
          prTitle: PR_TITLE,
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
          expect(result.dryRunResult).toBeUndefined();
          expect(result.worktreeResult).toMatchObject({
            branchName: TARGET_BRANCH,
            worktreePath,
            metadata: {
              repair: true,
              repairAttempt: 1,
            },
          });
          expect(result.codexResult).toMatchObject({
            adapterMode: "mock",
            status: "succeeded",
            exitCode: 0,
            redactionApplied: true,
          });
          expect(result.changeScanResult?.changedFiles.paths).toEqual([FIXTURE_CODEX_CHANGED_PATH]);
          expect(result.changeScanResult?.blockers).toEqual([]);
          expect(result.validationResult?.status).toBe("passed");

          const githubResult = expectDefined(result.githubResult, "missing GitHub result");
          const commitHash = githubResult.commitResult.commitHash;
          expect(commitHash).toMatch(/^[a-f0-9]{40}$/u);
          expect(commitHash).not.toBe(previousBranchHead);
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
            prNumber: 147,
            prUrl: "https://github.example.test/acme/fixture-runner/pull/147",
            prTitle: PR_TITLE,
            prStatus: "draft",
            changedFilePaths: [FIXTURE_CODEX_CHANGED_PATH],
            riskFindings: [],
          });

          const events = await readRunEvents(eventsOutPath);
          expect(events.map((event) => event.state)).toEqual([
            "repair_requested",
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
          expect(events[0]?.metadata).toMatchObject({
            packetMode: "repair",
            repairAttempt: 1,
            maxRepairAttempts: 2,
            previousRunId: PREVIOUS_RUN_ID,
          });

          await assertGitState({
            commitHash,
            fixture,
            remotePath: remote.remotePath,
            worktreePath,
          });

          const ghInvocations = await ghHarness.readInvocations();
          expect(ghInvocations).toEqual([
            {
              command: "gh",
              args: ["pr", "view", TARGET_BRANCH, "--json", "number,url,title,state,isDraft"],
              stdinLength: 0,
              stdinSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            },
          ]);

          assertSafeWebBoundArtifacts({
            events,
            ghInvocations,
            prArtifact,
            pushArtifact: githubResult.pushArtifact,
            validationResult: expectDefined(result.validationResult, "missing validation result"),
          });
        },
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

const createExistingTaskBranch = async (fixture: FixtureRepo): Promise<void> => {
  await runGitStdout(fixture.repoPath, ["checkout", "-b", TARGET_BRANCH]);
  await writeFile(
    join(fixture.repoPath, FIXTURE_CODEX_CHANGED_PATH),
    "fixture application\nprevious repair attempt\n",
    "utf8",
  );
  await runGitStdout(fixture.repoPath, ["add", FIXTURE_CODEX_CHANGED_PATH]);
  await runGitStdout(fixture.repoPath, ["commit", "-m", "Existing task branch"]);
  await runGitStdout(fixture.repoPath, ["push", "-u", "origin", TARGET_BRANCH]);
  await runGitStdout(fixture.repoPath, ["checkout", fixture.defaultBranch]);
};

const createRepairTaskPacket = ({
  fixture,
  policy,
  worktreePath,
}: {
  fixture: FixtureRepo;
  policy: RepoPolicy;
  worktreePath: string;
}): TaskPacket =>
  TaskPacketSchema.parse({
    acceptanceCriteria: ["The fixture validation command passes after repair."],
    context: {
      files: [FIXTURE_CODEX_CHANGED_PATH],
      notes: ["Use the deterministic fixture Codex adapter for this repair proof."],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: CREATED_AT,
    id: TASK_ID,
    mode: "repair",
    objective: "Repair the existing fixture pull request branch.",
    policy,
    repair: {
      attempt: 1,
      feedback: REPAIR_FEEDBACK,
      maxAttempts: 2,
      previousRunId: PREVIOUS_RUN_ID,
    },
    repo: {
      defaultBranch: fixture.defaultBranch,
      localPath: fixture.repoPath,
      targetBranch: TARGET_BRANCH,
      worktreePath,
    },
    repositoryId: REPOSITORY_ID,
    runId: RUN_ID,
    source: {
      externalId: "repair-request-147",
      title: "Repair existing fixture PR",
      type: "repair",
    },
    validation: {
      commands: policy.validationCommands,
    },
    workspaceId: "workspace-runner-e2e",
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
  commitHash,
  fixture,
  remotePath,
  worktreePath,
}: {
  commitHash: string;
  fixture: FixtureRepo;
  remotePath: string;
  worktreePath: string;
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

const assertSafeWebBoundArtifacts = ({
  events,
  ghInvocations,
  prArtifact,
  pushArtifact,
  validationResult,
}: {
  events: RunEvent[];
  ghInvocations: MockGhInvocation[];
  prArtifact: PrArtifact;
  pushArtifact: PushedBranchArtifact;
  validationResult: ValidationSuiteResult;
}): void => {
  const webBoundArtifacts = {
    events,
    ghInvocations,
    prArtifact,
    pushArtifact,
    validationBlockers: validationResult.blockers,
    validationResults: validationResult.results,
    validationWarnings: validationResult.warnings,
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
  "content",
  "contents",
  "diff",
  "patch",
  "rawoutput",
  "source",
  "sourcecode",
  "snippet",
];

const RAW_FIXTURE_CONTENT_MARKERS = [
  "fixture application",
  "previous repair attempt",
  "mock codex fixture behavior applied",
  FIXTURE_CODEX_FILE_CONTENTS,
  REPAIR_FEEDBACK,
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
