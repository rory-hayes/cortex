import {
  CLAIM_JOB_STATUSES,
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  ClaimJobRequestSchema,
  PollJobsRequestSchema,
  SubmitDryRunResultRequestSchema,
  SubmitPrArtifactRequestSchema,
  SubmitRunEventRequestSchema,
  SubmitValidationResultRequestSchema,
  createClaimJobIdempotencyKey,
  createRunEventIdempotencyKey,
  type ClaimJobResponse,
  type ClaimJobStatus,
  type DryRunCheckResult,
  type DryRunResult,
  type PollJobsResponse,
  type PrArtifact,
  type RunEvent,
  type RunnerCapabilities,
  type RunnerJob,
  type TaskPacket,
  type ValidationResult,
} from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import type {
  RunRunnerDependencies,
  RunRunnerForTaskPacketOptions,
  RunRunnerResult,
} from "../run.js";
import type { RunnerCredentialRecord } from "../credential-store.js";
import { RunnerError, isRunnerError } from "../errors.js";
import { createTaskWorktreePath } from "../git/worktree-path.js";
import type { RunnerProtocolFetch, RunnerProtocolFetchInit } from "./client.js";
import {
  claimRunnerJob,
  pollRunnerJobs,
  runRunnerPollIteration,
  runRunnerPollLoop,
  submitDryRunResult,
  submitPrArtifact,
  submitRunEvent,
  submitValidationResult,
} from "./poll-loop.js";

const runnerCredential = "runner-credential-must-stay-in-auth-header";
const TASK_OBJECTIVE_TEXT = "TASK OBJECTIVE SENTINEL MUST NOT LEAK";
const TASK_ACCEPTANCE_TEXT = "TASK ACCEPTANCE SENTINEL MUST NOT LEAK";
const TASK_CONTEXT_NOTE_TEXT = "TASK CONTEXT NOTE SENTINEL MUST NOT LEAK";
const SOURCE_SNIPPET_TEXT = "const sourceSnippetMustNotLeak = true;";

describe("runner protocol poll loop", () => {
  test("exports granular polling, claim, submission, and iteration helpers", () => {
    expect(typeof pollRunnerJobs).toBe("function");
    expect(typeof claimRunnerJob).toBe("function");
    expect(typeof submitRunEvent).toBe("function");
    expect(typeof submitDryRunResult).toBe("function");
    expect(typeof submitValidationResult).toBe("function");
    expect(typeof submitPrArtifact).toBe("function");
    expect(typeof runRunnerPollIteration).toBe("function");
  });

  test("posts a schema-valid no-job poll request and does not claim or execute", async () => {
    const { calls, fetch } = createProtocolFetch(({ pathname }) => {
      expect(pathname).toBe("/api/runner/jobs/poll");
      return pollResponse([]);
    });
    const runRunnerForTaskPacket = vi.fn();

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(calls).toHaveLength(1);
    expect(PollJobsRequestSchema.safeParse(parseBody(calls[0])).success).toBe(true);
    expect(parseBody(calls[0])).toEqual({
      availableConcurrency: 1,
      capabilities: runnerCapabilities(),
      contractVersion: CONTRACT_VERSION,
      knownCurrentRunIds: [],
      runnerId: "runner_1",
    });
    expect(runRunnerForTaskPacket).not.toHaveBeenCalled();
    expect(result).toEqual({
      claimStatus: null,
      executedRunId: null,
      exitCode: null,
      jobsClaimed: 0,
      jobsExecuted: 0,
      jobsReceived: 0,
      lastPollIntervalSeconds: 15,
      lastServerTime: "2026-05-23T11:00:01.000Z",
      polls: 1,
      runnerId: "runner_1",
      submissions: {
        dryRunResults: 0,
        prArtifacts: 0,
        runEvents: 0,
        validationResults: 0,
      },
    });
    expect(JSON.stringify(result)).not.toContain(runnerCredential);
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });

  test("polls, claims, and executes repair jobs with protocol submissions", async () => {
    const repairJob = repairRunnerJob();
    const repairEvent = {
      ...safeRunEvent(repairJob.runId),
      idempotencyKey: createRunEventIdempotencyKey({
        attempt: 1,
        runId: repairJob.runId,
        stableStepName: "repair_started",
      }),
      metadata: {
        packetMode: "repair",
        repairAttempt: 1,
      },
      state: "repair_requested",
    } satisfies RunEvent;
    const artifact = {
      ...prArtifact(repairJob.runId),
      branchName: repairJob.taskPacket.repo.targetBranch,
      changedFilePaths: ["src/protocol/poll-loop.ts"],
      id: `pr:${repairJob.runId}:120`,
      runId: repairJob.runId,
    } satisfies PrArtifact;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([repairJob]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: repairJob.jobId,
          runId: repairJob.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      if (pathname === "/api/runner/runs/pr-artifact") {
        return SubmitPrArtifactRequestSchema.parse(body).artifact;
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        expect(options).toEqual({
          dryRun: false,
          repo: "/repos/control-plane",
          taskPacket: repairJob.taskPacket,
        });
        await dependencies.emitRunEvent?.(repairEvent);
        await dependencies.onPrArtifact?.(artifact);

        return {
          exitCode: 0,
          runId: repairJob.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        loadRunnerConfig: async () => ({
          mockModes: {
            codex: true,
            gh: true,
          },
          worktreeRoot: "/runner/worktrees",
        }),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
      "/api/runner/runs/events",
      "/api/runner/runs/pr-artifact",
    ]);
    expect(SubmitRunEventRequestSchema.parse(parseBody(calls[2])).state).toBe("claimed");
    expect(SubmitRunEventRequestSchema.parse(parseBody(calls[3])).metadata).toEqual({
      packetMode: "repair",
      repairAttempt: 1,
    });
    expect(SubmitPrArtifactRequestSchema.safeParse(parseBody(calls[4])).success).toBe(true);
    expect(runRunnerForTaskPacket).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: repairJob.runId,
      exitCode: 0,
      jobsClaimed: 1,
      jobsExecuted: 1,
      jobsReceived: 1,
      polls: 1,
      runnerId: "runner_1",
      submissions: {
        dryRunResults: 0,
        prArtifacts: 1,
        runEvents: 2,
        validationResults: 0,
      },
    });
    expectBodiesStayInsideTrustBoundary(calls);
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });

  test("polls, claims with the canonical key, executes the local runner flow, and submits safe payloads", async () => {
    const job = runnerJob();
    const runEvent = safeRunEvent(job.runId);
    const dryRun = dryRunResult(job.runId);
    const validation = validationResult(job.runId);
    const artifact = prArtifact(job.runId);
    const { calls, fetch } = createProtocolFetch(({ pathname, body }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([job]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        const request = ClaimJobRequestSchema.parse(body);

        expect(request.idempotencyKey).toBe(
          createClaimJobIdempotencyKey({
            jobId: job.jobId,
            runId: job.runId,
            runnerId: "runner_1",
          }),
        );

        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      if (pathname === "/api/runner/runs/dry-run-result") {
        return SubmitDryRunResultRequestSchema.parse(body).result;
      }

      if (pathname === "/api/runner/runs/validation-result") {
        return SubmitValidationResultRequestSchema.parse(body).result;
      }

      if (pathname === "/api/runner/runs/pr-artifact") {
        return SubmitPrArtifactRequestSchema.parse(body).artifact;
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        expect(options).toEqual({
          dryRun: false,
          repo: "/repos/control-plane",
          taskPacket: job.taskPacket,
        });
        await dependencies.emitRunEvent?.(runEvent);
        await dependencies.onDryRunResult?.(dryRun);
        await dependencies.onValidationResult?.(validation);
        await dependencies.onPrArtifact?.(artifact);

        return {
          dryRunResult: dryRun,
          exitCode: 0,
          runId: job.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        runRunnerForTaskPacket,
        now: fixedClock([
          "2026-05-23T11:00:00.000Z",
          "2026-05-23T11:00:01.000Z",
          "2026-05-23T11:00:02.000Z",
          "2026-05-23T11:00:03.000Z",
          "2026-05-23T11:00:04.000Z",
        ]),
      },
    );

    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
      "/api/runner/runs/events",
      "/api/runner/runs/dry-run-result",
      "/api/runner/runs/validation-result",
      "/api/runner/runs/pr-artifact",
    ]);
    expect(PollJobsRequestSchema.safeParse(parseBody(calls[0])).success).toBe(true);
    expect(ClaimJobRequestSchema.safeParse(parseBody(calls[1])).success).toBe(true);
    expect(SubmitRunEventRequestSchema.safeParse(parseBody(calls[2])).success).toBe(true);
    expect(SubmitRunEventRequestSchema.safeParse(parseBody(calls[3])).success).toBe(true);
    expect(SubmitRunEventRequestSchema.parse(parseBody(calls[2])).state).toBe("claimed");
    expect(SubmitRunEventRequestSchema.parse(parseBody(calls[3])).state).toBe("dry_run_running");
    expect(SubmitDryRunResultRequestSchema.safeParse(parseBody(calls[4])).success).toBe(true);
    expect(SubmitValidationResultRequestSchema.safeParse(parseBody(calls[5])).success).toBe(true);
    expect(SubmitPrArtifactRequestSchema.safeParse(parseBody(calls[6])).success).toBe(true);
    expect(runRunnerForTaskPacket).toHaveBeenCalledWith(
      {
        dryRun: false,
        repo: "/repos/control-plane",
        taskPacket: job.taskPacket,
      },
      expect.objectContaining({
        onDryRunResult: expect.any(Function),
        emitRunEvent: expect.any(Function),
        onPrArtifact: expect.any(Function),
        onValidationResult: expect.any(Function),
      }),
    );
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: "run_1",
      exitCode: 0,
      jobsClaimed: 1,
      jobsExecuted: 1,
      jobsReceived: 1,
      polls: 1,
      runnerId: "runner_1",
      submissions: {
        dryRunResults: 1,
        prArtifacts: 1,
        runEvents: 2,
        validationResults: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain(runnerCredential);
    expectBodiesStayInsideTrustBoundary(calls);
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });

  test("passes a protocol-backed active-run cancellation checker into local execution", async () => {
    const job = runnerJob();
    const activePollJob = {
      ...runnerJob(),
      jobId: "job_unrelated",
      runId: "run_unrelated",
      taskPacket: {
        ...taskPacket(),
        runId: "run_unrelated",
      },
    } satisfies RunnerJob;
    let activeCancellationPollCount = 0;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        const request = PollJobsRequestSchema.parse(body);

        if (request.availableConcurrency === 1) {
          return pollResponse([job]);
        }

        activeCancellationPollCount += 1;
        expect(request.availableConcurrency).toBe(0);
        expect(request.knownCurrentRunIds).toEqual([job.runId]);

        return {
          ...pollResponse([activePollJob]),
          cancellation: cancellationRequest({ runId: job.runId }),
        } satisfies PollJobsResponse;
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        _options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        await expect(
          dependencies.checkCancellation?.({
            boundary: "before_commit",
            runId: job.runId,
          }),
        ).resolves.toBe(true);
        await expect(
          dependencies.checkCancellation?.({
            boundary: "before_push",
            runId: job.runId,
          }),
        ).resolves.toBe(true);

        return {
          dryRunResult: dryRunResult(job.runId),
          exitCode: 130,
          runId: job.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(activeCancellationPollCount).toBe(1);
    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
      "/api/runner/jobs/poll",
    ]);
    expect(PollJobsRequestSchema.parse(parseBody(calls[3]))).toMatchObject({
      availableConcurrency: 0,
      knownCurrentRunIds: [job.runId],
      runnerId: "runner_1",
    });
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: job.runId,
      exitCode: 130,
      jobsClaimed: 1,
      jobsExecuted: 1,
    });
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });

  test("honors matching cancellation from the initial job poll before active-run polling", async () => {
    const job = runnerJob();
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        const request = PollJobsRequestSchema.parse(body);

        expect(request.availableConcurrency).toBe(1);

        return {
          ...pollResponse([job]),
          cancellation: cancellationRequest({ runId: job.runId }),
        } satisfies PollJobsResponse;
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        _options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        await expect(
          dependencies.checkCancellation?.({
            boundary: "before_dry_run",
            runId: job.runId,
          }),
        ).resolves.toBe(true);
        await expect(
          dependencies.checkCancellation?.({
            boundary: "before_worktree",
            runId: job.runId,
          }),
        ).resolves.toBe(true);

        return {
          dryRunResult: dryRunResult(job.runId),
          exitCode: 130,
          runId: job.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(runRunnerForTaskPacket).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
    ]);
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: job.runId,
      exitCode: 130,
      jobsClaimed: 1,
      jobsExecuted: 1,
    });
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });

  test("ignores mismatched cancellation from the initial job poll", async () => {
    const job = runnerJob();
    let activeCancellationPollCount = 0;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        const request = PollJobsRequestSchema.parse(body);

        if (request.availableConcurrency === 1) {
          return {
            ...pollResponse([job]),
            cancellation: cancellationRequest({ runId: "run_unrelated" }),
          } satisfies PollJobsResponse;
        }

        activeCancellationPollCount += 1;
        expect(request.availableConcurrency).toBe(0);
        expect(request.knownCurrentRunIds).toEqual([job.runId]);

        return pollResponse([]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        _options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        await expect(
          dependencies.checkCancellation?.({
            boundary: "before_dry_run",
            runId: job.runId,
          }),
        ).resolves.toBe(false);

        return {
          dryRunResult: dryRunResult(job.runId),
          exitCode: 0,
          runId: job.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(activeCancellationPollCount).toBe(1);
    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
      "/api/runner/jobs/poll",
    ]);
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: job.runId,
      exitCode: 0,
      jobsClaimed: 1,
      jobsExecuted: 1,
    });
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });

  test("computes a runner-owned worktree path before executing hosted packets that omit one", async () => {
    const hostedPacket = taskPacketWithoutWorktreePath();
    const job = {
      ...runnerJob(),
      taskPacket: hostedPacket,
    } satisfies RunnerJob;
    const expectedWorktreePath = createTaskWorktreePath({
      config: {
        worktreeRoot: "/runner/worktrees",
      },
      policy: hostedPacket.policy,
      repoPath: hostedPacket.repo.localPath,
      task: hostedPacket,
    }).worktreePath;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([job]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (options: RunRunnerForTaskPacketOptions): Promise<RunRunnerResult> => {
        expect(options.taskPacket).toEqual({
          ...hostedPacket,
          repo: {
            ...hostedPacket.repo,
            worktreePath: expectedWorktreePath,
          },
        });

        return {
          dryRunResult: dryRunResult(job.runId),
          exitCode: 0,
          runId: job.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        loadRunnerConfig: async () => ({
          mockModes: {
            codex: true,
            gh: true,
          },
          worktreeRoot: "/runner/worktrees",
        }),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(runRunnerForTaskPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        taskPacket: expect.objectContaining({
          repo: expect.objectContaining({
            worktreePath: expectedWorktreePath,
          }),
        }),
      }),
      expect.any(Object),
    );
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: "run_1",
      jobsClaimed: 1,
      jobsExecuted: 1,
    });
    expectBodiesStayInsideTrustBoundary(calls);
  });

  test("computes a runner-owned worktree path before executing hosted repair packets that omit one", async () => {
    const hostedRepairPacket = repairTaskPacketWithoutWorktreePath();
    const repairJob = {
      ...repairRunnerJob(),
      runId: hostedRepairPacket.runId,
      taskPacket: hostedRepairPacket,
    } satisfies RunnerJob;
    const expectedWorktreePath = createTaskWorktreePath({
      config: {
        worktreeRoot: "/runner/worktrees",
      },
      policy: hostedRepairPacket.policy,
      repoPath: hostedRepairPacket.repo.localPath,
      task: hostedRepairPacket,
    }).worktreePath;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([repairJob]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: repairJob.jobId,
          runId: repairJob.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (options: RunRunnerForTaskPacketOptions): Promise<RunRunnerResult> => {
        expect(options).toEqual({
          dryRun: false,
          repo: "/repos/control-plane",
          taskPacket: {
            ...hostedRepairPacket,
            repo: {
              ...hostedRepairPacket.repo,
              worktreePath: expectedWorktreePath,
            },
          },
        });

        return {
          exitCode: 0,
          runId: repairJob.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        loadRunnerConfig: async () => ({
          mockModes: {
            codex: true,
            gh: true,
          },
          worktreeRoot: "/runner/worktrees",
        }),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(runRunnerForTaskPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        taskPacket: expect.objectContaining({
          mode: "repair",
          repo: expect.objectContaining({
            worktreePath: expectedWorktreePath,
          }),
        }),
      }),
      expect.any(Object),
    );
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: "run_repair_1",
      jobsClaimed: 1,
      jobsExecuted: 1,
    });
    expectBodiesStayInsideTrustBoundary(calls);
  });

  test("preserves packet-supplied repair worktree paths so existing clean repair worktrees can be reused", async () => {
    const suppliedWorktreePath = "/runner/worktrees/existing-repair-worktree";
    const hostedRepairPacket = {
      ...repairTaskPacket(),
      repo: {
        ...repairTaskPacket().repo,
        worktreePath: suppliedWorktreePath,
      },
    };
    const repairJob = {
      ...repairRunnerJob(),
      runId: hostedRepairPacket.runId,
      taskPacket: hostedRepairPacket,
    } satisfies RunnerJob;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([repairJob]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: repairJob.jobId,
          runId: repairJob.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const loadRunnerConfig = vi.fn(async () => {
      throw new Error("repair packets with supplied worktree paths should not need local config");
    });
    const runRunnerForTaskPacket = vi.fn(
      async (options: RunRunnerForTaskPacketOptions): Promise<RunRunnerResult> => {
        expect(options).toEqual({
          dryRun: false,
          repo: "/repos/control-plane",
          taskPacket: hostedRepairPacket,
        });

        return {
          exitCode: 0,
          runId: repairJob.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        loadRunnerConfig,
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(runRunnerForTaskPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        taskPacket: expect.objectContaining({
          mode: "repair",
          repo: expect.objectContaining({
            worktreePath: suppliedWorktreePath,
          }),
        }),
      }),
      expect.any(Object),
    );
    expect(loadRunnerConfig).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimStatus: "claimed",
      executedRunId: "run_repair_1",
      jobsClaimed: 1,
      jobsExecuted: 1,
    });
    expectBodiesStayInsideTrustBoundary(calls);
  });

  test.each([
    ["claimed", "runner_1", true],
    ["already_claimed", "runner_1", true],
    ["already_claimed", undefined, true],
    ["already_claimed", "runner_2", false],
    ["conflict", "runner_2", false],
    ["not_found", undefined, false],
  ] satisfies [ClaimJobStatus, string | undefined, boolean][])(
    "executes only executable claim results: %s claimed by %s",
    async (status, claimedByRunnerId, shouldExecute) => {
      const job = runnerJob();
      const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
        if (pathname === "/api/runner/jobs/poll") {
          return pollResponse([job]);
        }

        if (pathname === "/api/runner/jobs/claim") {
          return claimResponse(status, {
            jobId: job.jobId,
            runId: job.runId,
            ...(claimedByRunnerId === undefined ? {} : { claimedByRunnerId }),
          });
        }

        if (pathname === "/api/runner/runs/events") {
          return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
        }

        throw new Error(`Unexpected endpoint ${pathname}`);
      });
      const runRunnerForTaskPacket = vi.fn(async () => ({
        dryRunResult: dryRunResult(job.runId),
        exitCode: 0,
        runId: job.runId,
      }));

      const result = await runRunnerPollLoop(
        { maxPolls: 1 },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
          loadCredential: async () => credentialRecord(),
          runRunnerForTaskPacket,
          now: () => new Date("2026-05-23T11:00:00.000Z"),
        },
      );

      expect(runRunnerForTaskPacket).toHaveBeenCalledTimes(shouldExecute ? 1 : 0);
      expect(calls).toHaveLength(shouldExecute ? 3 : 2);
      expect(result.jobsExecuted).toBe(shouldExecute ? 1 : 0);
      expect(result.claimStatus).toBe(status);
    },
  );

  test.each([
    [
      "jobId",
      {
        jobId: "job_stale",
        runId: "run_1",
      },
    ],
    [
      "runId",
      {
        jobId: "job_1",
        runId: "run_stale",
      },
    ],
  ])(
    "returns a safe non-execution result for claim responses with a mismatched %s",
    async (_fieldName, claimIds) => {
      const job = runnerJob();
      const { calls, fetch } = createProtocolFetch(({ pathname }) => {
        if (pathname === "/api/runner/jobs/poll") {
          return pollResponse([job]);
        }

        if (pathname === "/api/runner/jobs/claim") {
          return claimResponse("claimed", claimIds);
        }

        throw new Error(`Mismatched claim should not reach ${pathname}`);
      });
      const runRunnerForTaskPacket = vi.fn(async () => ({
        dryRunResult: dryRunResult(job.runId),
        exitCode: 0,
        runId: job.runId,
      }));

      const result = await runRunnerPollLoop(
        { maxPolls: 1 },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
          loadCredential: async () => credentialRecord(),
          runRunnerForTaskPacket,
          now: () => new Date("2026-05-23T11:00:00.000Z"),
        },
      );

      expect(runRunnerForTaskPacket).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        claimStatus: "claimed",
        executedRunId: null,
        jobsClaimed: 0,
        jobsExecuted: 0,
        jobsReceived: 1,
      });
      expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
        "/api/runner/jobs/poll",
        "/api/runner/jobs/claim",
      ]);
      expect(JSON.stringify(result)).not.toContain(runnerCredential);
      expectBodiesDoNotContainCredential(calls);
      expectAuthHeadersContainCredential(calls);
    },
  );

  test("submits schema-valid multiline validation summaries", async () => {
    const validation = {
      ...validationResult("run_1"),
      exitCode: 1,
      status: "failed",
      stderrSummary: "diagnostic summary\n\tline two with tab\nexit code 1",
      stdoutSummary:
        "vitest reported 1 failed test\n\tapps/runner poll loop\nredacted marker present",
    } satisfies ValidationResult;
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      expect(pathname).toBe("/api/runner/runs/validation-result");

      return SubmitValidationResultRequestSchema.parse(body).result;
    });

    await submitValidationResult(
      {
        credential: credentialRecord(),
        fetch,
        now: () => new Date("2026-05-23T11:00:06.000Z"),
      },
      validation,
    );

    expect(calls).toHaveLength(1);
    const request = SubmitValidationResultRequestSchema.parse(parseBody(calls[0]));
    expect(request.result.stdoutSummary).toBe(validation.stdoutSummary);
    expect(request.result.stderrSummary).toBe(validation.stderrSummary);
  });

  test("normalizes safe validation results that did not need textual redaction", async () => {
    const job = runnerJob();
    const validation = {
      ...validationResult(job.runId),
      redactionApplied: false,
      stdoutSummary: "Tests passed.",
      stderrSummary: "",
    } satisfies ValidationResult;
    const artifact = prArtifact(job.runId);
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([job]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      if (pathname === "/api/runner/runs/validation-result") {
        return SubmitValidationResultRequestSchema.parse(body).result;
      }

      if (pathname === "/api/runner/runs/pr-artifact") {
        return SubmitPrArtifactRequestSchema.parse(body).artifact;
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        _options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        await dependencies.onValidationResult?.(validation);
        await dependencies.onPrArtifact?.(artifact);

        return {
          dryRunResult: dryRunResult(job.runId),
          exitCode: 0,
          runId: job.runId,
        };
      },
    );

    const result = await runRunnerPollLoop(
      { maxPolls: 1 },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch,
        loadCredential: async () => credentialRecord(),
        runRunnerForTaskPacket,
        now: () => new Date("2026-05-23T11:00:00.000Z"),
      },
    );

    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
      "/api/runner/runs/validation-result",
      "/api/runner/runs/pr-artifact",
    ]);
    const request = SubmitValidationResultRequestSchema.parse(parseBody(calls[3]));
    expect(request.result).toEqual({
      ...validation,
      redactionApplied: true,
    });
    expect(result).toMatchObject({
      exitCode: 0,
      jobsExecuted: 1,
      submissions: {
        prArtifacts: 1,
        runEvents: 1,
        validationResults: 1,
      },
    });
  });

  test("strips local execution paths from web-bound events and dry-run capabilities", async () => {
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/runs/events") {
        return runEventFromSubmitRequest(SubmitRunEventRequestSchema.parse(body));
      }

      if (pathname === "/api/runner/runs/dry-run-result") {
        return SubmitDryRunResultRequestSchema.parse(body).result;
      }

      throw new Error(`Unexpected endpoint ${pathname}`);
    });
    const context = {
      credential: credentialRecord(),
      fetch,
      now: () => new Date("2026-05-23T11:00:06.000Z"),
    };

    await submitRunEvent(context, {
      ...safeRunEvent("run_1"),
      metadata: {
        branchName: "aicp/task-120-poll-loop",
        changedFilePaths: ["src/protocol/poll-loop.ts"],
        nested: {
          path: "/private/tmp/control-plane/worktrees/run_1",
          worktreePath: "relative-runner-worktree/run_1",
        },
        summary: "Created worktree at /Users/rory/worktrees/run_1",
        worktreePath: "/Users/rory/worktrees/run_1",
      },
    });
    await submitDryRunResult(context, {
      ...dryRunResult("run_1"),
      capabilities: {
        ...runnerCapabilities(),
        tools: {
          ...runnerCapabilities().tools,
          git: { available: true, path: "/usr/bin/git", version: "2.49.0" },
          pnpm: { available: true, path: "/opt/homebrew/bin/pnpm", version: "9.15.9" },
        },
      },
    });

    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/runs/events",
      "/api/runner/runs/dry-run-result",
    ]);
    const eventRequest = SubmitRunEventRequestSchema.parse(parseBody(calls[0]));
    expect(eventRequest.metadata).toEqual({
      branchName: "aicp/task-120-poll-loop",
      changedFilePaths: ["src/protocol/poll-loop.ts"],
      nested: {},
    });
    expect(JSON.stringify(eventRequest)).not.toContain("/Users/rory/worktrees/run_1");
    expect(JSON.stringify(eventRequest)).not.toContain("/private/tmp/control-plane");

    const dryRunRequest = SubmitDryRunResultRequestSchema.parse(parseBody(calls[1]));
    expect(dryRunRequest.result.capabilities.tools.git).toEqual({
      available: true,
      version: "2.49.0",
    });
    expect(dryRunRequest.result.capabilities.tools.pnpm).toEqual({
      available: true,
      version: "9.15.9",
    });
    expect(JSON.stringify(dryRunRequest)).not.toContain("/usr/bin/git");
    expect(JSON.stringify(dryRunRequest)).not.toContain("/opt/homebrew/bin/pnpm");
  });

  test.each([
    [
      "poll request capabilities",
      async (fetch: RunnerProtocolFetch) => {
        await pollRunnerJobs({
          capabilities: {
            ...runnerCapabilities(),
            shell: "diff --git a/src/private.ts b/src/private.ts",
          },
          credential: credentialRecord(),
          fetch,
        });
      },
    ],
    [
      "poll request capability tool path",
      async (fetch: RunnerProtocolFetch) => {
        await pollRunnerJobs({
          capabilities: {
            ...runnerCapabilities(),
            tools: {
              ...runnerCapabilities().tools,
              git: {
                available: true,
                path: "OPENAI_API_KEY=sk-capability-secret-value",
                version: "2.49.0",
              },
            },
          },
          credential: credentialRecord(),
          fetch,
        });
      },
    ],
    [
      "claim request capabilities snapshot",
      async (fetch: RunnerProtocolFetch) => {
        await claimRunnerJob({
          capabilities: {
            ...runnerCapabilities(),
            shell: "raw stdout: private command output",
          },
          credential: credentialRecord(),
          fetch,
          job: runnerJob(),
        });
      },
    ],
    [
      "claim request capabilities snapshot tool path",
      async (fetch: RunnerProtocolFetch) => {
        await claimRunnerJob({
          capabilities: {
            ...runnerCapabilities(),
            tools: {
              ...runnerCapabilities().tools,
              gh: {
                available: true,
                path: "raw stdout: private command output",
                version: "2.72.0",
              },
            },
          },
          credential: credentialRecord(),
          fetch,
          job: runnerJob(),
        });
      },
    ],
    [
      "dry-run result capabilities",
      async (fetch: RunnerProtocolFetch) => {
        await submitDryRunResult(
          {
            credential: credentialRecord(),
            fetch,
            now: () => new Date("2026-05-23T11:00:06.000Z"),
          },
          {
            ...dryRunResult("run_1"),
            capabilities: {
              ...runnerCapabilities(),
              shell: "OPENAI_API_KEY=sk-capability-secret-value",
            },
          },
        );
      },
    ],
    [
      "dry-run result capability tool path",
      async (fetch: RunnerProtocolFetch) => {
        await submitDryRunResult(
          {
            credential: credentialRecord(),
            fetch,
            now: () => new Date("2026-05-23T11:00:06.000Z"),
          },
          {
            ...dryRunResult("run_1"),
            capabilities: {
              ...runnerCapabilities(),
              tools: {
                ...runnerCapabilities().tools,
                codex: {
                  available: true,
                  path: "diff --git a/src/private.ts b/src/private.ts",
                  version: "0.12.0",
                },
              },
            },
          },
        );
      },
    ],
  ])("rejects unsafe %s before fetch", async (_caseName, submitUnsafeCapabilities) => {
    const { calls, fetch } = createProtocolFetch(({ pathname }) => {
      throw new Error(`Unsafe capability payload should not reach ${pathname}`);
    });
    let caughtError: unknown;

    try {
      await submitUnsafeCapabilities(fetch);
    } catch (error) {
      caughtError = error;
    }

    expect(isRunnerError(caughtError)).toBe(true);
    expect(caughtError).toMatchObject({
      message: expect.stringMatching(
        /Runner (?:poll|claim) request could not be validated|Runner protocol submission payload is not safe to send/,
      ),
    });
    expect(JSON.stringify(caughtError)).not.toMatch(
      /diff --git|raw stdout|OPENAI_API_KEY|sk-capability-secret-value|runner-secret-credential/i,
    );
    expect(calls).toEqual([]);
  });

  test.each([
    [
      "event metadata",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          metadata: {
            diff: "diff --git a/private.ts b/private.ts",
          },
        } as RunEvent);
      },
    ],
    [
      "event patch metadata",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          metadata: {
            patch: "*** Begin Patch\n*** Update File: src/private.ts\n",
          },
        } as RunEvent);
      },
    ],
    [
      "event source metadata",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          metadata: {
            source: "export const privateSource = true;",
          },
        } as RunEvent);
      },
    ],
    [
      "event snippet metadata",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          metadata: {
            snippet: SOURCE_SNIPPET_TEXT,
          },
        } as RunEvent);
      },
    ],
    [
      "event raw log text",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          message: "raw stdout: private execution output",
        } as RunEvent);
      },
    ],
    [
      "event secret text",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          metadata: {
            summary: "OPENAI_API_KEY=sk-1234567890123456",
          },
        } as RunEvent);
      },
    ],
    [
      "event message local path",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.emitRunEvent?.({
          ...safeRunEvent(runId),
          message: "Worktree created at /Users/rory/worktrees/run_1",
        } as RunEvent);
      },
    ],
    [
      "validation raw output without redaction",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.onValidationResult?.({
          ...validationResult(runId),
          redactionApplied: false,
          stdoutSummary: "raw output: private execution output",
        });
      },
    ],
    [
      "validation stdout local path",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.onValidationResult?.({
          ...validationResult(runId),
          stdoutSummary: "Tests failed in /Users/rory/worktrees/run_1/src/private.ts",
        });
      },
    ],
    [
      "validation stderr local path",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.onValidationResult?.({
          ...validationResult(runId),
          stderrSummary: "See /private/tmp/control-plane/worktrees/run_1/test.log",
        });
      },
    ],
    [
      "validation command local path",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.onValidationResult?.({
          ...validationResult(runId),
          command: "pnpm --dir /Users/rory/private-repo test",
        });
      },
    ],
    [
      "PR artifact path",
      async (dependencies: RunRunnerDependencies, runId: string) => {
        await dependencies.onPrArtifact?.({
          ...prArtifact(runId),
          changedFilePaths: [".env.local"],
        } as PrArtifact);
      },
    ],
  ])("rejects unsafe %s before calling a submission endpoint", async (_caseName, callSink) => {
    const job = runnerJob();
    const { calls, fetch } = createProtocolFetch(({ body, pathname }) => {
      if (pathname === "/api/runner/jobs/poll") {
        return pollResponse([job]);
      }

      if (pathname === "/api/runner/jobs/claim") {
        return claimResponse("claimed", {
          jobId: job.jobId,
          runId: job.runId,
        });
      }

      if (pathname === "/api/runner/runs/events") {
        const request = SubmitRunEventRequestSchema.parse(body);

        expect(request.state).toBe("claimed");

        return runEventFromSubmitRequest(request);
      }

      throw new Error(`Unsafe payload should not reach ${pathname}`);
    });
    const runRunnerForTaskPacket = vi.fn(
      async (
        _options: RunRunnerForTaskPacketOptions,
        dependencies: RunRunnerDependencies = {},
      ): Promise<RunRunnerResult> => {
        await callSink(dependencies, job.runId);

        return {
          dryRunResult: dryRunResult(job.runId),
          exitCode: 0,
          runId: job.runId,
        };
      },
    );

    let caughtError: unknown;

    try {
      await runRunnerPollLoop(
        { maxPolls: 1 },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
          loadCredential: async () => credentialRecord(),
          runRunnerForTaskPacket,
          now: () => new Date("2026-05-23T11:00:00.000Z"),
        },
      );
    } catch (error) {
      caughtError = error;
    }

    expect(isRunnerError(caughtError)).toBe(true);
    expect(caughtError).toMatchObject({
      category: "usage",
      message: "Runner protocol submission payload is not safe to send.",
    });
    expect(JSON.stringify(caughtError)).not.toContain(runnerCredential);
    expect(calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/runner/jobs/poll",
      "/api/runner/jobs/claim",
      "/api/runner/runs/events",
    ]);
  });

  test("keeps runner credentials out of returned summaries, thrown errors, and JSON request bodies", async () => {
    const { calls, fetch } = createProtocolFetch(() => {
      throw new Error(`network failure ${runnerCredential}`);
    });

    let caughtError: unknown;

    try {
      await runRunnerPollLoop(
        { maxPolls: 1 },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
          loadCredential: async () => credentialRecord(),
          runRunnerForTaskPacket: vi.fn(),
          now: () => new Date("2026-05-23T11:00:00.000Z"),
        },
      );
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(RunnerError);
    expect(JSON.stringify(caughtError)).not.toContain(runnerCredential);
    expectBodiesDoNotContainCredential(calls);
    expectAuthHeadersContainCredential(calls);
  });
});

type FetchCall = [string, RunnerProtocolFetchInit];

const createProtocolFetch = (
  handler: (input: { body: unknown; pathname: string; url: string }) => unknown,
): {
  calls: FetchCall[];
  fetch: RunnerProtocolFetch;
} => {
  const calls: FetchCall[] = [];
  const fetch: RunnerProtocolFetch = async (url, init) => {
    calls.push([url, init]);

    const data = handler({
      body: JSON.parse(init.body),
      pathname: new URL(url).pathname,
      url,
    });

    return jsonResponse({ data, ok: true });
  };

  return { calls, fetch };
};

const jsonResponse = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
});

const parseBody = (call: FetchCall | undefined): unknown => {
  if (call === undefined) {
    throw new Error("Expected fetch call.");
  }

  return JSON.parse(call[1].body);
};

const credentialRecord = (): RunnerCredentialRecord => ({
  contractVersion: CONTRACT_VERSION,
  linkedAt: "2026-05-23T10:59:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "https://control-plane.test/api",
  runnerCredential,
  runnerId: "runner_1",
  storedAt: "2026-05-23T10:59:01.000Z",
  workspaceId: "workspace_1",
});

const runnerCapabilities = (): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  maxConcurrentJobs: 1,
  os: {
    arch: "arm64",
    platform: "darwin",
    release: "25.0.0",
  },
  reportedAt: "2026-05-23T11:00:00.000Z",
  runnerId: "runner_1",
  shell: "/bin/zsh",
  supportsCancellation: true,
  supportsDryRun: true,
  tools: {
    codex: { available: true, version: "1.2.3" },
    gh: { available: true, version: "2.72.0" },
    git: { available: true, version: "2.49.0" },
    node: { available: true, version: "24.0.0" },
    npm: { available: false },
    pnpm: { available: true, version: "9.15.9" },
    python: { available: false },
    yarn: { available: false },
  },
});

const pollResponse = (jobs: RunnerJob[]): PollJobsResponse => ({
  contractVersion: CONTRACT_VERSION,
  jobs,
  pollIntervalSeconds: 15,
  serverTime: "2026-05-23T11:00:01.000Z",
});

const cancellationRequest = (
  overrides: {
    runId?: string;
  } = {},
) => ({
  contractVersion: CONTRACT_VERSION,
  runId: overrides.runId ?? "run_1",
  requestedByActorId: "user_1",
  reason: "User requested cancellation.",
  requestedAt: "2026-05-23T11:00:02.000Z",
});

const claimResponse = (
  status: ClaimJobStatus,
  input: {
    claimedByRunnerId?: string;
    jobId: string;
    runId: string;
  },
): ClaimJobResponse => {
  expect(CLAIM_JOB_STATUSES).toContain(status);

  return {
    contractVersion: CONTRACT_VERSION,
    jobId: input.jobId,
    runId: input.runId,
    status,
    ...(input.claimedByRunnerId === undefined
      ? {}
      : { claimedByRunnerId: input.claimedByRunnerId }),
    ...(status === "claimed" || status === "already_claimed"
      ? { claimExpiresAt: "2026-05-23T11:15:00.000Z" }
      : {}),
  };
};

const runnerJob = (): RunnerJob => ({
  contractVersion: CONTRACT_VERSION,
  jobId: "job_1",
  queuedAt: "2026-05-23T10:58:00.000Z",
  runId: "run_1",
  taskPacket: taskPacket(),
  type: "task",
});

const repairRunnerJob = (): RunnerJob => {
  const packet = repairTaskPacket();

  return {
    contractVersion: CONTRACT_VERSION,
    jobId: "job_repair_1",
    queuedAt: "2026-05-23T10:58:00.000Z",
    runId: packet.runId,
    taskPacket: packet,
    type: "repair",
  };
};

const taskPacket = (): TaskPacket => ({
  acceptanceCriteria: [TASK_ACCEPTANCE_TEXT],
  context: {
    files: ["src/protocol/poll-loop.ts"],
    notes: [TASK_CONTEXT_NOTE_TEXT, SOURCE_SNIPPET_TEXT],
  },
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-23T10:57:00.000Z",
  id: "task_1",
  mode: "execute",
  objective: TASK_OBJECTIVE_TEXT,
  policy: {
    allowUntrackedFiles: true,
    contractVersion: CONTRACT_VERSION,
    dryRunChecks: ["repo_path_exists", "git_repository", "repo_clean"],
    maxChangedFiles: 25,
    protectedBranches: ["main"],
    protectedPaths: ["SECURITY_MODEL.md"],
    sensitivePaths: [".env", ".env.*"],
    validationCommands: [validationCommand()],
    warningPaths: {
      auth: [],
      billing: [],
      infrastructure: [],
      migrations: [],
      packageLocks: ["pnpm-lock.yaml"],
    },
  },
  repo: {
    defaultBranch: "main",
    localPath: "/repos/control-plane",
    targetBranch: "aicp/task-120-poll-loop",
    worktreePath: "/runner/worktrees/run_1",
  },
  repositoryId: "acme/control-plane",
  runId: "run_1",
  source: {
    externalId: "manual-120",
    title: "Add runner polling loop client",
    type: "manual",
    url: "https://control-plane.test/tasks/task_1",
  },
  validation: {
    commands: [validationCommand()],
  },
  workspaceId: "workspace_1",
});

const taskPacketWithoutWorktreePath = (): TaskPacket => {
  const packet = taskPacket();
  const repo = {
    defaultBranch: packet.repo.defaultBranch,
    localPath: packet.repo.localPath,
    targetBranch: packet.repo.targetBranch,
  };

  return {
    ...packet,
    repo,
  };
};

const repairTaskPacketWithoutWorktreePath = (): TaskPacket => {
  const packet = repairTaskPacket();
  const repo = {
    defaultBranch: packet.repo.defaultBranch,
    localPath: packet.repo.localPath,
    targetBranch: packet.repo.targetBranch,
  };

  return {
    ...packet,
    repo,
  };
};

const repairTaskPacket = (): TaskPacket => ({
  ...taskPacket(),
  id: "task_repair_1",
  mode: "repair",
  repair: {
    attempt: 1,
    feedback: "Retry with safe metadata only.",
    maxAttempts: 2,
    previousRunId: "run_1",
  },
  repo: {
    defaultBranch: "main",
    localPath: "/repos/control-plane",
    targetBranch: "aicp/repair-task-120-poll-loop",
    worktreePath: "/runner/worktrees/run_repair_1",
  },
  runId: "run_repair_1",
  source: {
    externalId: "repair_request_1",
    title: "Repair prior run",
    type: "repair",
    url: "https://control-plane.test/repairs/repair_request_1",
  },
});

const validationCommand = () => ({
  command: "pnpm test",
  id: "test",
  label: "Tests",
  required: true,
  timeoutSeconds: 120,
});

const safeRunEvent = (runId: string): RunEvent => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-23T11:00:02.000Z",
  id: `${runId}:dry_run_running:1`,
  idempotencyKey: createRunEventIdempotencyKey({
    attempt: 1,
    runId,
    stableStepName: "dry_run_running",
  }),
  message: "Runner dry run started.",
  metadata: {
    checkCount: 1,
  },
  runId,
  severity: "info",
  state: "dry_run_running",
});

const runEventFromSubmitRequest = (
  request: ReturnType<typeof SubmitRunEventRequestSchema.parse>,
): RunEvent => ({
  contractVersion: request.contractVersion,
  createdAt: request.createdAt,
  id: request.eventId,
  idempotencyKey: request.idempotencyKey,
  message: request.message,
  metadata: request.metadata,
  runId: request.runId,
  runnerId: request.runnerId,
  severity: request.severity,
  state: request.state,
});

const dryRunResult = (runId: string): DryRunResult => ({
  blockers: [],
  capabilities: runnerCapabilities(),
  checks: DRY_RUN_CHECKS.map(
    (id): DryRunCheckResult => ({
      id,
      label: id,
      message: `${id} passed.`,
      metadata: {
        verified: true,
      },
      status: "passed",
    }),
  ),
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-23T11:00:03.000Z",
  id: `dry-run:${runId}`,
  runId,
  status: "passed",
  warnings: [],
});

const validationResult = (runId: string): ValidationResult => ({
  command: "pnpm test",
  commandId: "test",
  commandLabel: "Tests",
  contractVersion: CONTRACT_VERSION,
  durationMs: 1200,
  exitCode: 0,
  finishedAt: "2026-05-23T11:00:05.000Z",
  id: `validation:${runId}:test`,
  redactionApplied: true,
  runId,
  startedAt: "2026-05-23T11:00:04.000Z",
  status: "passed",
  stderrSummary: "",
  stdoutSummary: "Tests passed.",
});

const prArtifact = (runId: string): PrArtifact => ({
  branchName: "aicp/task-120-poll-loop",
  changedFilePaths: ["src/protocol/poll-loop.ts"],
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-23T11:00:06.000Z",
  id: `pr:${runId}:120`,
  prNumber: 120,
  prStatus: "draft",
  prTitle: "TASK-120: Metadata-only runner update",
  prUrl: "https://github.example.test/acme/control-plane/pull/120",
  repository: {
    name: "control-plane",
    owner: "acme",
  },
  riskFindings: [],
  runId,
});

const fixedClock = (timestamps: string[]): (() => Date) => {
  let index = 0;

  return () => new Date(timestamps[index++] ?? timestamps[timestamps.length - 1] ?? 0);
};

const expectBodiesDoNotContainCredential = (calls: FetchCall[]): void => {
  for (const [, init] of calls) {
    expect(init.body).not.toContain(runnerCredential);
  }
};

const expectBodiesStayInsideTrustBoundary = (calls: FetchCall[]): void => {
  for (const [, init] of calls) {
    for (const unsafeText of [
      TASK_OBJECTIVE_TEXT,
      TASK_ACCEPTANCE_TEXT,
      TASK_CONTEXT_NOTE_TEXT,
      SOURCE_SNIPPET_TEXT,
      "diff --git",
      "*** Begin Patch",
      "raw stdout",
      "raw stderr",
      "raw output",
    ]) {
      expect(init.body).not.toContain(unsafeText);
    }
  }
};

const expectAuthHeadersContainCredential = (calls: FetchCall[]): void => {
  for (const [, init] of calls) {
    expect(init.headers.authorization).toBe(`Bearer ${runnerCredential}`);
  }
};
