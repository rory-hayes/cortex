import { describe, expect, test, vi } from "vitest";

import { schema } from "@control-plane/db";
import {
  CONTRACT_VERSION,
  PollJobsResponseSchema,
  RunnerCapabilitiesSchema,
  type PollJobsRequest,
  type RepoPolicy,
  type RiskFinding,
  type RunnerCapabilities,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import {
  createPollJobsService,
  createDrizzlePollJobsStore,
  RUNNER_JOB_POLL_INTERVAL_SECONDS,
  RUNNER_POLL_MAX_JOBS,
  PollJobsRequestError,
  type PollJobsStore,
  type PollRepoMappingRow,
  type PollRunRow,
} from "./poll.js";

const now = new Date("2026-05-22T13:00:00.000Z");

const validationCommand: ValidationCommand = {
  id: "test",
  label: "Unit tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
};

const policy: RepoPolicy = {
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["infra/**"],
  sensitivePaths: [".env", ".env.*"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["packages/db/migrations/**"],
    infrastructure: ["infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [validationCommand],
  maxChangedFiles: 20,
  maxDiffLines: 400,
  allowUntrackedFiles: true,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
  ],
};

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    runnerId: "runner_1",
    os: {
      platform: "darwin",
      release: "25.5.0",
      arch: "arm64",
    },
    shell: "/bin/zsh",
    tools: {
      codex: {
        available: true,
        path: "/opt/homebrew/bin/codex",
        version: "0.12.0",
      },
      gh: {
        available: true,
        path: "/opt/homebrew/bin/gh",
        version: "2.72.0",
      },
      git: {
        available: true,
        path: "/usr/bin/git",
        version: "2.49.0",
      },
      node: {
        available: true,
        path: "/opt/homebrew/bin/node",
        version: "24.0.0",
      },
      pnpm: {
        available: true,
        path: "/opt/homebrew/bin/pnpm",
        version: "10.11.0",
      },
    },
    maxConcurrentJobs: 2,
    reportedAt: "2026-05-22T12:59:30.000Z",
    supportsCancellation: true,
    supportsDryRun: true,
    ...overrides,
  });

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "packet_1",
  workspaceId: "workspace_1",
  repositoryId: "repo_mapping_1",
  runId: "run_1",
  mode: "execute",
  objective: "Update queue metadata for the local runner.",
  acceptanceCriteria: ["The runner can poll a metadata-only queued job."],
  source: {
    type: "manual",
    title: "Poll queued runner job",
  },
  repo: {
    localPath: "/repos/control-plane",
    defaultBranch: "main",
    targetBranch: "aicp/poll-queued-runner-job",
  },
  context: {
    files: ["apps/web/src/jobs/poll.ts"],
    notes: ["Use path references only."],
  },
  policy,
  validation: {
    commands: [validationCommand],
  },
  createdAt: "2026-05-22T12:59:00.000Z",
  ...overrides,
});

const validRepairPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  validTaskPacket({
    id: "packet_repair",
    mode: "repair",
    runId: "run_repair",
    source: {
      type: "repair",
      title: "Repair queued runner job",
    },
    repair: {
      attempt: 1,
      feedback: "Repair the previous metadata-only attempt.",
      maxAttempts: 2,
      previousRunId: "run_previous",
    },
    ...overrides,
  });

const createRequest = (overrides: Partial<PollJobsRequest> = {}): PollJobsRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  capabilities: validCapabilities(),
  availableConcurrency: 1,
  knownCurrentRunIds: [],
  ...overrides,
});

const repoMapping = (overrides: Partial<PollRepoMappingRow> = {}): PollRepoMappingRow =>
  ({
    archivedAt: null,
    defaultBranch: "main",
    id: "repo_mapping_1",
    localPath: "/repos/control-plane",
    runnerId: "runner_1",
    workspaceId: "workspace_1",
    ...overrides,
  }) as PollRepoMappingRow;

const runRow = (overrides: Partial<PollRunRow> = {}): PollRunRow =>
  ({
    attemptCount: 0,
    capabilitiesSnapshot: null,
    claimExpiresAt: null,
    claimIdempotencyKey: null,
    claimedAt: null,
    contractVersion: CONTRACT_VERSION,
    createdAt: now,
    id: "run_1",
    jobId: "job_1",
    jobType: "task",
    maxAttempts: 1,
    mode: "execute",
    queuedAt: now,
    repoMappingId: "repo_mapping_1",
    runnerId: null,
    state: "queued",
    taskId: "task_1",
    taskPacket: validTaskPacket(),
    updatedAt: now,
    workspaceId: "workspace_1",
    ...overrides,
  }) as PollRunRow;

type CancellationLookupInput = {
  runnerId: string;
  runIds: string[];
  workspaceId: string;
};

type CancellationRow = {
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  cancellationRequestedByActorId: string | null;
  runId: string;
};

const createStore = (input: {
  cancellation?: CancellationRow | null;
  repoMappings?: PollRepoMappingRow[];
  runs?: PollRunRow[];
}): PollJobsStore & {
  cancellationLookups: CancellationLookupInput[];
  listRepoMappingsCalls: Array<{ workspaceId: string }>;
  blockRunForMissingMappingCalls: Array<{
    finding: RiskFinding;
    runId: string;
    updatedAt: Date;
    workspaceId: string;
  }>;
  listQueuedRunsCalls: Array<{
    excludedRunIds: string[];
    limit: number;
    repoMappingIds?: string[];
    workspaceId: string;
  }>;
} => {
  const cancellation = input.cancellation ?? null;
  const cancellationLookups: CancellationLookupInput[] = [];
  const repoMappings = input.repoMappings ?? [repoMapping()];
  const runs = input.runs ?? [runRow()];
  const store: PollJobsStore & {
    cancellationLookups: CancellationLookupInput[];
    listRepoMappingsCalls: Array<{ workspaceId: string }>;
    blockRunForMissingMappingCalls: Array<{
      finding: RiskFinding;
      runId: string;
      updatedAt: Date;
      workspaceId: string;
    }>;
    listQueuedRunsCalls: Array<{
      excludedRunIds: string[];
      limit: number;
      repoMappingIds?: string[];
      workspaceId: string;
    }>;
  } = {
    cancellationLookups,
    listRepoMappingsCalls: [],
    blockRunForMissingMappingCalls: [],
    findCancellationForCurrentRuns: async (lookup: CancellationLookupInput) => {
      cancellationLookups.push(lookup);

      if (
        cancellation === null ||
        !lookup.runIds.includes(cancellation.runId) ||
        lookup.runnerId !== "runner_1" ||
        lookup.workspaceId !== "workspace_1"
      ) {
        return null;
      }

      return cancellation;
    },
    listQueuedRunsCalls: [],
    blockRunForMissingMapping: async ({ finding, runId, updatedAt, workspaceId }) => {
      store.blockRunForMissingMappingCalls.push({
        finding,
        runId,
        updatedAt,
        workspaceId,
      });

      const run = runs.find(
        (candidate) => candidate.id === runId && candidate.workspaceId === workspaceId,
      );

      if (run !== undefined) {
        run.state = "blocked";
        run.riskFindings = [
          ...((run.riskFindings as RiskFinding[] | null | undefined) ?? []).filter(
            (riskFinding) => riskFinding.id !== finding.id,
          ),
          finding,
        ];
        run.updatedAt = updatedAt;
      }
    },
    listRepoMappingsForWorkspace: async ({ workspaceId }) => {
      const call = { workspaceId };

      store.listRepoMappingsCalls.push(call);

      return repoMappings.filter((mapping) => mapping.workspaceId === workspaceId);
    },
    listQueuedRuns: async ({ excludedRunIds, limit, repoMappingIds, workspaceId }) => {
      const call = {
        excludedRunIds,
        limit,
        ...(repoMappingIds === undefined ? {} : { repoMappingIds }),
        workspaceId,
      };

      store.listQueuedRunsCalls.push(call);

      return runs
        .filter(
          (run) =>
            run.workspaceId === workspaceId &&
            run.state === "queued" &&
            !excludedRunIds.includes(run.id) &&
            (repoMappingIds === undefined || repoMappingIds.includes(run.repoMappingId)),
        )
        .sort((left, right) => left.queuedAt.getTime() - right.queuedAt.getTime())
        .slice(0, limit);
    },
  };

  return store;
};

const createService = (store: PollJobsStore) =>
  createPollJobsService({
    now: () => now,
    pollIntervalSeconds: 15,
    store,
  });

const expectInvalidRequest = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toBeInstanceOf(PollJobsRequestError);
  await expect(promise).rejects.toMatchObject({
    code: "invalid_request",
  });
};

const collectUnsafeKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUnsafeKeys(item, keys));

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      [
        "credential",
        "credentialhash",
        "diff",
        "filecontent",
        "filecontents",
        "logs",
        "output",
        "patch",
        "rawdiff",
        "rawlog",
        "rawoutput",
        "rawpatch",
        "rawstderr",
        "rawstdout",
        "rawsource",
        "privatekey",
        "secret",
        "snippet",
        "snippets",
        "sourcecode",
        "token",
      ].includes(normalizedKey)
    ) {
      keys.push(key);
    }

    collectUnsafeKeys(childValue, keys);
  }

  return keys;
};

describe("poll jobs service", () => {
  test("exports the v1 polling cadence and max-job constants", () => {
    expect(RUNNER_JOB_POLL_INTERVAL_SECONDS).toBe(15);
    expect(RUNNER_POLL_MAX_JOBS).toBe(1);
  });

  test("uses repo mapping columns that match the real runner-scoped Drizzle schema", async () => {
    const repoMappingTable = schema.repoMappings as typeof schema.repoMappings & {
      localPath?: unknown;
      runnerId?: unknown;
    };

    expect(repoMappingTable.runnerId).toBeDefined();
    expect(repoMappingTable.localPath).toBeDefined();

    type RepoMappingRow = typeof schema.repoMappings.$inferSelect;

    const activeMapping = {
      archivedAt: null,
      createdAt: now,
      defaultBranch: "main",
      githubInstallationId: null,
      id: "repo_mapping_1",
      localPath: "/repos/control-plane",
      policySnapshot: null,
      provider: "github",
      remoteUrl: null,
      repositoryExternalId: null,
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      updatedAt: now,
      validationCommands: null,
      workspaceId: "workspace_1",
    } satisfies RepoMappingRow;
    const store = createDrizzlePollJobsStore({
      query: {
        repoMappings: {
          findMany: async () => [activeMapping],
        },
        runs: {
          findMany: async () => [],
        },
      },
    } as unknown as Parameters<typeof createDrizzlePollJobsStore>[0]);

    await expect(
      store.listRepoMappingsForWorkspace({
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([activeMapping]);
  });

  test("drizzle store selects cancellation metadata scoped to workspace runner active runs and cancel_requested state", async () => {
    const cancellationRequestedAt = new Date("2026-05-22T13:01:00.000Z");
    const findMany = vi.fn(async (query: unknown) => {
      void query;

      return [
        {
          cancellationReason: "Stop before validation.",
          cancellationRequestedAt,
          cancellationRequestedByActorId: "user_1",
          id: "run_current",
        },
      ];
    });
    const store = createDrizzlePollJobsStore({
      query: {
        repoMappings: {
          findMany: async () => [],
        },
        runs: {
          findMany,
        },
      },
    } as unknown as Parameters<typeof createDrizzlePollJobsStore>[0]);

    await expect(
      store.findCancellationForCurrentRuns({
        runnerId: "runner_1",
        runIds: ["run_current", "run_other"],
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      cancellationReason: "Stop before validation.",
      cancellationRequestedAt,
      cancellationRequestedByActorId: "user_1",
      runId: "run_current",
    });

    expect(findMany).toHaveBeenCalledWith({
      columns: {
        cancellationReason: true,
        cancellationRequestedAt: true,
        cancellationRequestedByActorId: true,
        id: true,
      },
      where: expect.any(Function),
    });

    const and = vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" }));
    const eq = vi.fn((column: unknown, value: unknown) => ({ column, type: "eq", value }));
    const inArray = vi.fn((column: unknown, values: unknown[]) => ({
      column,
      type: "inArray",
      values,
    }));
    const findManyOptions = findMany.mock.calls[0]?.[0] as
      | {
          where: (
            fields: unknown,
            operators: {
              and: typeof and;
              eq: typeof eq;
              inArray: typeof inArray;
            },
          ) => unknown;
        }
      | undefined;

    if (findManyOptions === undefined) {
      throw new Error("Expected cancellation lookup query options.");
    }

    const where = findManyOptions.where(schema.runs, {
      and,
      eq,
      inArray,
    });

    expect(eq).toHaveBeenCalledWith(schema.runs.workspaceId, "workspace_1");
    expect(eq).toHaveBeenCalledWith(schema.runs.runnerId, "runner_1");
    expect(inArray).toHaveBeenCalledWith(schema.runs.id, ["run_current", "run_other"]);
    expect(eq).toHaveBeenCalledWith(schema.runs.state, "cancel_requested");
    expect(where).toMatchObject({ type: "and" });
  });

  test("drizzle store chooses cancellation metadata in known-current-run request order", async () => {
    const firstRequestedAt = new Date("2026-05-22T13:01:00.000Z");
    const secondRequestedAt = new Date("2026-05-22T13:02:00.000Z");
    const findFirst = vi.fn(async () => ({
      cancellationReason: "Cancel the second reported run.",
      cancellationRequestedAt: secondRequestedAt,
      cancellationRequestedByActorId: "user_2",
      id: "run_second",
    }));
    const findMany = vi.fn(async (query: unknown) => {
      void query;

      return [
        {
          cancellationReason: "Cancel the second reported run.",
          cancellationRequestedAt: secondRequestedAt,
          cancellationRequestedByActorId: "user_2",
          id: "run_second",
        },
        {
          cancellationReason: "Cancel the first reported run.",
          cancellationRequestedAt: firstRequestedAt,
          cancellationRequestedByActorId: "user_1",
          id: "run_first",
        },
      ];
    });
    const store = createDrizzlePollJobsStore({
      query: {
        repoMappings: {
          findMany: async () => [],
        },
        runs: {
          findFirst,
          findMany,
        },
      },
    } as unknown as Parameters<typeof createDrizzlePollJobsStore>[0]);

    await expect(
      store.findCancellationForCurrentRuns({
        runnerId: "runner_1",
        runIds: ["run_first", "run_second"],
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      cancellationReason: "Cancel the first reported run.",
      cancellationRequestedAt: firstRequestedAt,
      cancellationRequestedByActorId: "user_1",
      runId: "run_first",
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith({
      columns: {
        cancellationReason: true,
        cancellationRequestedAt: true,
        cancellationRequestedByActorId: true,
        id: true,
      },
      where: expect.any(Function),
    });
  });

  test("returns the oldest eligible queued job for the authenticated runner workspace", async () => {
    const older = runRow({
      id: "run_older",
      jobId: "job_older",
      queuedAt: new Date("2026-05-22T12:58:00.000Z"),
      taskPacket: validTaskPacket({ runId: "run_older" }),
    });
    const newer = runRow({
      id: "run_newer",
      jobId: "job_newer",
      queuedAt: new Date("2026-05-22T12:59:00.000Z"),
      taskPacket: validTaskPacket({ runId: "run_newer" }),
    });
    const store = createStore({ runs: [newer, older] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({ availableConcurrency: 2 }),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_older"]);
    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobs: [
        {
          contractVersion: CONTRACT_VERSION,
          jobId: "job_older",
          queuedAt: "2026-05-22T12:58:00.000Z",
          runId: "run_older",
          taskPacket: validTaskPacket({ runId: "run_older" }),
          type: "task",
        },
      ],
      pollIntervalSeconds: RUNNER_JOB_POLL_INTERVAL_SECONDS,
      serverTime: now.toISOString(),
    });
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("returns no jobs when the runner reports a current run because v1 polls at most one active job", async () => {
    const store = createStore({ runs: [runRow()] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({ knownCurrentRunIds: ["run_current"] }),
    });

    expect(response.jobs).toEqual([]);
    expect(response).not.toHaveProperty("cancellation");
    expect(store.cancellationLookups).toEqual([
      {
        runnerId: "runner_1",
        runIds: ["run_current"],
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.listRepoMappingsCalls).toEqual([]);
    expect(store.listQueuedRunsCalls).toEqual([]);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("returns cancellation for a reported active run without assigning new jobs", async () => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: new Date("2026-05-22T13:01:00.000Z"),
        cancellationRequestedByActorId: "user_1",
        runId: "run_current",
      },
      runs: [runRow()],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({ knownCurrentRunIds: ["run_current"] }),
    });

    expect(response).toEqual({
      cancellation: {
        contractVersion: CONTRACT_VERSION,
        reason: "Stop before validation.",
        requestedAt: "2026-05-22T13:01:00.000Z",
        requestedByActorId: "user_1",
        runId: "run_current",
      },
      contractVersion: CONTRACT_VERSION,
      jobs: [],
      pollIntervalSeconds: RUNNER_JOB_POLL_INTERVAL_SECONDS,
      serverTime: now.toISOString(),
    });
    expect(store.cancellationLookups).toEqual([
      {
        runnerId: "runner_1",
        runIds: ["run_current"],
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.listRepoMappingsCalls).toEqual([]);
    expect(store.listQueuedRunsCalls).toEqual([]);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("does not require reported cancellation support to deliver cancellation", async () => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: new Date("2026-05-22T13:01:00.000Z"),
        cancellationRequestedByActorId: "user_1",
        runId: "run_current",
      },
      runs: [runRow()],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        capabilities: validCapabilities({ supportsCancellation: false }),
        knownCurrentRunIds: ["run_current"],
      }),
    });

    expect(response.jobs).toEqual([]);
    expect(response.cancellation).toEqual({
      contractVersion: CONTRACT_VERSION,
      reason: "Stop before validation.",
      requestedAt: "2026-05-22T13:01:00.000Z",
      requestedByActorId: "user_1",
      runId: "run_current",
    });
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test.each([
    {
      cancellationRequestedAt: null,
      cancellationRequestedByActorId: "user_1",
      name: "missing requested timestamp",
    },
    {
      cancellationRequestedAt: new Date("2026-05-22T13:01:00.000Z"),
      cancellationRequestedByActorId: null,
      name: "missing requesting actor",
    },
  ])("omits cancellation for incomplete current-run metadata: $name", async (metadata) => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: metadata.cancellationRequestedAt,
        cancellationRequestedByActorId: metadata.cancellationRequestedByActorId,
        runId: "run_current",
      },
      runs: [runRow()],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({ knownCurrentRunIds: ["run_current"] }),
    });

    expect(response.jobs).toEqual([]);
    expect(response).not.toHaveProperty("cancellation");
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("blocks archived, unusable, and missing repo mappings while filtering other workspaces and non-queued runs", async () => {
    const archivedRun = runRow({
      id: "run_archived_repo",
      jobId: "job_archived_repo",
      queuedAt: new Date("2026-05-22T12:57:00.000Z"),
      repoMappingId: "repo_archived",
      riskFindings: [],
      taskPacket: validTaskPacket({ runId: "run_archived_repo" }),
    });
    const unusableRun = runRow({
      id: "run_unusable_repo",
      jobId: "job_unusable_repo",
      queuedAt: new Date("2026-05-22T12:57:10.000Z"),
      repoMappingId: "repo_unusable",
      riskFindings: [],
      taskPacket: validTaskPacket({ runId: "run_unusable_repo" }),
    });
    const unmappedRun = runRow({
      id: "run_unmapped_repo",
      jobId: "job_unmapped_repo",
      queuedAt: new Date("2026-05-22T12:57:20.000Z"),
      repoMappingId: "repo_unmapped",
      riskFindings: [],
      taskPacket: validTaskPacket({ runId: "run_unmapped_repo" }),
    });
    const store = createStore({
      repoMappings: [
        repoMapping({ id: "repo_mapping_1" }),
        repoMapping({
          archivedAt: new Date("2026-05-22T12:00:00.000Z"),
          id: "repo_archived",
        }),
        repoMapping({
          id: "repo_unusable",
          localPath: "",
        }),
        repoMapping({ id: "repo_other_workspace", workspaceId: "workspace_2" }),
      ],
      runs: [
        runRow({
          id: "run_current",
          jobId: "job_current",
          queuedAt: new Date("2026-05-22T12:58:00.000Z"),
          taskPacket: validTaskPacket({ runId: "run_current" }),
        }),
        archivedRun,
        unusableRun,
        unmappedRun,
        runRow({
          id: "run_other_workspace",
          jobId: "job_other_workspace",
          repoMappingId: "repo_other_workspace",
          taskPacket: validTaskPacket({
            runId: "run_other_workspace",
            workspaceId: "workspace_2",
          }),
          workspaceId: "workspace_2",
        }),
        runRow({
          id: "run_claimed",
          jobId: "job_claimed",
          state: "claimed",
          taskPacket: validTaskPacket({ runId: "run_claimed" }),
        }),
        runRow({
          id: "run_eligible",
          jobId: "job_eligible",
          queuedAt: new Date("2026-05-22T12:59:30.000Z"),
          taskPacket: validTaskPacket({ runId: "run_eligible" }),
        }),
      ],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_current"]);
    expect(store.blockRunForMissingMappingCalls).toEqual([
      {
        finding: {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
        runId: "run_archived_repo",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
      {
        finding: {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
        runId: "run_unusable_repo",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
      {
        finding: {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
        runId: "run_unmapped_repo",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
    ]);
    for (const run of [archivedRun, unusableRun, unmappedRun]) {
      expect(run).toMatchObject({
        riskFindings: [
          {
            id: "risk:missing_mapping",
            severity: "blocked",
            category: "missing_mapping",
            paths: [],
          },
        ],
        runnerId: null,
        state: "blocked",
      });
    }
    expect(collectUnsafeKeys(store.blockRunForMissingMappingCalls)).toEqual([]);
    expect(store.listRepoMappingsCalls).toEqual([
      {
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.listQueuedRunsCalls[0]).toEqual({
      excludedRunIds: [],
      limit: 25,
      workspaceId: "workspace_1",
    });
  });

  test("blocks queued runs with missing_mapping when the runner has no active usable mappings", async () => {
    const archivedRun = runRow({
      id: "run_archived_repo",
      jobId: "job_archived_repo",
      queuedAt: new Date("2026-05-22T12:58:00.000Z"),
      repoMappingId: "repo_archived",
      riskFindings: [],
      taskPacket: validTaskPacket({ runId: "run_archived_repo" }),
    });
    const unmappedRun = runRow({
      id: "run_unmapped_repo",
      jobId: "job_unmapped_repo",
      queuedAt: new Date("2026-05-22T12:58:30.000Z"),
      repoMappingId: "repo_unmapped",
      riskFindings: [],
      taskPacket: validTaskPacket({ runId: "run_unmapped_repo" }),
    });
    const store = createStore({
      repoMappings: [
        repoMapping({
          archivedAt: new Date("2026-05-22T12:00:00.000Z"),
          id: "repo_archived",
        }),
      ],
      runs: [archivedRun, unmappedRun],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs).toEqual([]);
    expect(store.blockRunForMissingMappingCalls.map((call) => call.runId)).toEqual([
      "run_archived_repo",
      "run_unmapped_repo",
    ]);
    for (const run of [archivedRun, unmappedRun]) {
      expect(run).toMatchObject({
        riskFindings: [
          {
            id: "risk:missing_mapping",
            severity: "blocked",
            category: "missing_mapping",
            paths: [],
          },
        ],
        runnerId: null,
        state: "blocked",
      });
    }
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("excludes jobs for repo mappings assigned to another runner", async () => {
    const store = createStore({
      repoMappings: [
        repoMapping({ id: "repo_mapping_1", runnerId: "runner_1" }),
        repoMapping({
          id: "repo_mapping_2",
          localPath: "/repos/other",
          runnerId: "runner_2",
        }),
      ],
      runs: [
        runRow({
          id: "run_other_runner",
          jobId: "job_other_runner",
          queuedAt: new Date("2026-05-22T12:58:00.000Z"),
          repoMappingId: "repo_mapping_2",
          taskPacket: validTaskPacket({
            repo: {
              ...validTaskPacket().repo,
              localPath: "/repos/other",
            },
            runId: "run_other_runner",
          }),
        }),
        runRow({
          id: "run_eligible",
          jobId: "job_eligible",
          queuedAt: new Date("2026-05-22T12:59:00.000Z"),
          taskPacket: validTaskPacket({ runId: "run_eligible" }),
        }),
      ],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_eligible"]);
    expect(store.listQueuedRunsCalls[0]).toEqual({
      excludedRunIds: [],
      limit: 25,
      workspaceId: "workspace_1",
    });
  });

  test("does not let older jobs for another runner exhaust the poll candidate window", async () => {
    const otherRunnerRows = Array.from({ length: 25 }, (_, index) =>
      runRow({
        id: `run_other_runner_${index}`,
        jobId: `job_other_runner_${index}`,
        queuedAt: new Date(`2026-05-22T12:${String(index).padStart(2, "0")}:00.000Z`),
        repoMappingId: "repo_other_runner",
        taskPacket: validTaskPacket({
          repo: {
            ...validTaskPacket().repo,
            localPath: "/repos/other-runner",
          },
          runId: `run_other_runner_${index}`,
        }),
      }),
    );
    const eligibleRun = runRow({
      id: "run_eligible_after_other_runner_window",
      jobId: "job_eligible_after_other_runner_window",
      queuedAt: new Date("2026-05-22T12:59:00.000Z"),
      repoMappingId: "repo_mapping_1",
      taskPacket: validTaskPacket({
        runId: "run_eligible_after_other_runner_window",
      }),
    });
    const store = createStore({
      repoMappings: [
        repoMapping({ id: "repo_mapping_1", runnerId: "runner_1" }),
        repoMapping({
          id: "repo_other_runner",
          localPath: "/repos/other-runner",
          runnerId: "runner_2",
        }),
      ],
      runs: [...otherRunnerRows, eligibleRun],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual([
      "run_eligible_after_other_runner_window",
    ]);
    expect(store.blockRunForMissingMappingCalls).toEqual([]);
    expect(
      store.listQueuedRunsCalls.some((call) => call.repoMappingIds?.includes("repo_mapping_1")),
    ).toBe(true);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("does not require taskPacket repository id to equal the row mapping when repo metadata matches", async () => {
    const store = createStore({
      runs: [
        runRow({
          id: "run_external_repo_id",
          jobId: "job_external_repo_id",
          taskPacket: validTaskPacket({
            repositoryId: "rory/control-plane",
            runId: "run_external_repo_id",
          }),
        }),
      ],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_external_repo_id"]);
  });

  test("blocks queued rows when task packet repo metadata differs from the active mapping", async () => {
    const mismatchedLocalPath = runRow({
      id: "run_mismatched_local_path",
      jobId: "job_mismatched_local_path",
      queuedAt: new Date("2026-05-22T12:58:00.000Z"),
      repoMappingId: "repo_mapping_1",
      riskFindings: [],
      taskPacket: validTaskPacket({
        repo: {
          ...validTaskPacket().repo,
          localPath: "/repos/other",
        },
        runId: "run_mismatched_local_path",
      }),
    });
    const mismatchedDefaultBranch = runRow({
      id: "run_mismatched_default_branch",
      jobId: "job_mismatched_default_branch",
      queuedAt: new Date("2026-05-22T12:58:30.000Z"),
      repoMappingId: "repo_mapping_1",
      riskFindings: [],
      taskPacket: validTaskPacket({
        repo: {
          ...validTaskPacket().repo,
          defaultBranch: "develop",
        },
        runId: "run_mismatched_default_branch",
      }),
    });
    const mismatchedWorkspace = runRow({
      id: "run_mismatched_workspace",
      jobId: "job_mismatched_workspace",
      queuedAt: new Date("2026-05-22T12:58:45.000Z"),
      repoMappingId: "repo_mapping_1",
      riskFindings: [],
      taskPacket: validTaskPacket({
        runId: "run_mismatched_workspace",
        workspaceId: "workspace_2",
      }),
    });
    const store = createStore({
      repoMappings: [repoMapping({ id: "repo_mapping_1" })],
      runs: [
        mismatchedLocalPath,
        mismatchedDefaultBranch,
        mismatchedWorkspace,
        runRow({
          id: "run_eligible",
          jobId: "job_eligible",
          queuedAt: new Date("2026-05-22T12:59:00.000Z"),
          repoMappingId: "repo_mapping_1",
          taskPacket: validTaskPacket({ runId: "run_eligible" }),
        }),
      ],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_eligible"]);
    expect(store.blockRunForMissingMappingCalls).toEqual([
      {
        finding: {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
        runId: "run_mismatched_local_path",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
      {
        finding: {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
        runId: "run_mismatched_default_branch",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
      {
        finding: {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
        runId: "run_mismatched_workspace",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
    ]);
    expect(mismatchedLocalPath).toMatchObject({
      riskFindings: [
        {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          paths: [],
        },
      ],
      runnerId: null,
      state: "blocked",
    });
    expect(mismatchedDefaultBranch).toMatchObject({
      riskFindings: [
        {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          paths: [],
        },
      ],
      runnerId: null,
      state: "blocked",
    });
    expect(mismatchedWorkspace).toMatchObject({
      riskFindings: [
        {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          paths: [],
        },
      ],
      runnerId: null,
      state: "blocked",
    });
    expect(collectUnsafeKeys(response)).toEqual([]);
    expect(
      collectUnsafeKeys(store.blockRunForMissingMappingCalls.map((call) => call.finding)),
    ).toEqual([]);
    expect(JSON.stringify(store.blockRunForMissingMappingCalls)).not.toMatch(
      /\/repos|diff --git|raw|patch|snippet|secret|token|private key/i,
    );
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("returns no jobs when availableConcurrency is zero", async () => {
    const store = createStore({ runs: [runRow()] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({ availableConcurrency: 0 }),
    });

    expect(response.jobs).toEqual([]);
    expect(store.cancellationLookups).toEqual([]);
    expect(store.listRepoMappingsCalls).toEqual([]);
    expect(store.listQueuedRunsCalls).toEqual([]);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("availableConcurrency zero does not suppress cancellation for a known current run", async () => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: new Date("2026-05-22T13:01:00.000Z"),
        cancellationRequestedByActorId: "user_1",
        runId: "run_current",
      },
      runs: [runRow()],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        availableConcurrency: 0,
        knownCurrentRunIds: ["run_current"],
      }),
    });

    expect(response.jobs).toEqual([]);
    expect(response.cancellation).toEqual({
      contractVersion: CONTRACT_VERSION,
      reason: "Stop before validation.",
      requestedAt: "2026-05-22T13:01:00.000Z",
      requestedByActorId: "user_1",
      runId: "run_current",
    });
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("cancellation lookup is scoped to authenticated runner and workspace", async () => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: new Date("2026-05-22T13:01:00.000Z"),
        cancellationRequestedByActorId: "user_1",
        runId: "run_current",
      },
      runs: [runRow()],
    });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_2",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        capabilities: validCapabilities({ runnerId: "runner_2" }),
        knownCurrentRunIds: ["run_current"],
        runnerId: "runner_2",
      }),
    });

    expect(response.jobs).toEqual([]);
    expect(response).not.toHaveProperty("cancellation");
    expect(store.cancellationLookups).toEqual([
      {
        runnerId: "runner_2",
        runIds: ["run_current"],
        workspaceId: "workspace_1",
      },
    ]);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test.each([
    ["supportsDryRun", validCapabilities({ supportsDryRun: false })],
    [
      "git",
      validCapabilities({
        tools: {
          ...validCapabilities().tools,
          git: {
            available: false,
          },
        },
      }),
    ],
    [
      "codex",
      validCapabilities({
        tools: {
          ...validCapabilities().tools,
          codex: {
            available: false,
          },
        },
      }),
    ],
    [
      "gh",
      validCapabilities({
        tools: {
          ...validCapabilities().tools,
          gh: {
            available: false,
          },
        },
      }),
    ],
  ])(
    "filters execute jobs when required capability is missing: %s",
    async (_name, capabilities) => {
      const store = createStore({ runs: [runRow()] });
      const service = createService(store);

      const response = await service.pollJobs({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({ capabilities }),
      });

      expect(response.jobs).toEqual([]);
    },
  );

  test("filters jobs when a required validation command uses an unavailable reported tool", async () => {
    const service = createService(createStore({ runs: [runRow()] }));

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        capabilities: validCapabilities({
          tools: {
            ...validCapabilities().tools,
            pnpm: {
              available: false,
            },
          },
        }),
      }),
    });

    expect(response.jobs).toEqual([]);
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("does not require cancellation support for polling eligibility", async () => {
    const store = createStore({ runs: [runRow()] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        capabilities: validCapabilities({ supportsCancellation: false }),
      }),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_1"]);
  });

  test("allows dry-run jobs without codex or gh but filters repair jobs without them", async () => {
    const noExecutionTools = validCapabilities({
      tools: {
        ...validCapabilities().tools,
        codex: {
          available: false,
        },
        gh: {
          available: false,
        },
      },
    });
    const dryRun = runRow({
      id: "run_dry",
      jobId: "job_dry",
      mode: "dryRun",
      taskPacket: validTaskPacket({ mode: "dryRun", runId: "run_dry" }),
    });
    const repair = runRow({
      id: "run_repair",
      jobId: "job_repair",
      jobType: "repair",
      mode: "repair",
      taskPacket: validRepairPacket(),
    });
    const store = createStore({ runs: [repair, dryRun] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({ capabilities: noExecutionTools }),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_dry"]);
  });

  test("rejects top-level runnerId mismatch and capabilities runnerId mismatch", async () => {
    const service = createService(createStore({ runs: [] }));

    await expectInvalidRequest(
      service.pollJobs({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({ runnerId: "runner_2" }),
      }),
    );
    await expectInvalidRequest(
      service.pollJobs({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          capabilities: validCapabilities({ runnerId: "runner_2" }),
        }),
      }),
    );
  });

  test("rejects unsafe capability values before store lookups", async () => {
    const store = createStore({ runs: [runRow()] });
    const service = createService(store);
    const unsafeValue = "diff --git a/src/private.ts b/src/private.ts";

    await expectInvalidRequest(
      service.pollJobs({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          capabilities: {
            ...validCapabilities(),
            shell: unsafeValue,
          } as RunnerCapabilities,
        }),
      }),
    );
    expect(store.listRepoMappingsCalls).toEqual([]);
    expect(store.listQueuedRunsCalls).toEqual([]);
  });

  test("returns no jobs when a stored candidate cannot be converted to a safe runner job", async () => {
    const unsafePacketRow = runRow({
      id: "run_unsafe_packet",
      jobId: "job_unsafe_packet",
      queuedAt: new Date("2026-05-22T12:58:00.000Z"),
      taskPacket: {
        ...validTaskPacket({ runId: "run_unsafe_packet" }),
        rawStdout: "unsafe unredacted command output",
      } as unknown as TaskPacket,
    });
    const schemaInvalidRow = runRow({
      id: "run_schema_invalid",
      jobId: "job_schema_invalid",
      queuedAt: new Date("2026-05-22T12:58:30.000Z"),
      taskPacket: validTaskPacket({ runId: "run_other" }),
    });
    const eligibleRow = runRow({
      id: "run_eligible",
      jobId: "job_eligible",
      queuedAt: new Date("2026-05-22T12:59:00.000Z"),
      taskPacket: validTaskPacket({ runId: "run_eligible" }),
    });
    const service = createService(
      createStore({ runs: [unsafePacketRow, schemaInvalidRow, eligibleRow] }),
    );

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });
    const responseText = JSON.stringify(response);

    expect(response.jobs).toEqual([]);
    expect(responseText).not.toContain("unsafe unredacted command output");
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("skips packetless repair runs while leaving later packet-backed jobs eligible", async () => {
    const packetlessRepair = runRow({
      id: "run_packetless_repair",
      jobId: "job_packetless_repair",
      jobType: "repair",
      mode: "repair",
      queuedAt: new Date("2026-05-22T12:58:00.000Z"),
      taskPacket: null,
    });
    const eligibleTask = runRow({
      id: "run_eligible",
      jobId: "job_eligible",
      queuedAt: new Date("2026-05-22T12:59:00.000Z"),
      taskPacket: validTaskPacket({ runId: "run_eligible" }),
    });
    const service = createService(createStore({ runs: [packetlessRepair, eligibleTask] }));

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual(["run_eligible"]);
    expect(JSON.stringify(response)).not.toContain("run_packetless_repair");
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("continues polling past a full page of packetless repair runs", async () => {
    const packetlessRepairs = Array.from({ length: 25 }, (_, index) =>
      runRow({
        id: `run_packetless_repair_${index + 1}`,
        jobId: `job_packetless_repair_${index + 1}`,
        jobType: "repair",
        mode: "repair",
        queuedAt: new Date(`2026-05-22T12:58:${String(index).padStart(2, "0")}.000Z`),
        taskPacket: null,
      }),
    );
    const eligibleTask = runRow({
      id: "run_eligible_after_packetless_repairs",
      jobId: "job_eligible_after_packetless_repairs",
      queuedAt: new Date("2026-05-22T12:59:30.000Z"),
      taskPacket: validTaskPacket({ runId: "run_eligible_after_packetless_repairs" }),
    });
    const store = createStore({ runs: [...packetlessRepairs, eligibleTask] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.jobs.map((job) => job.runId)).toEqual([
      "run_eligible_after_packetless_repairs",
    ]);
    const repoMappedPollCalls = store.listQueuedRunsCalls.filter(
      (call) => call.repoMappingIds !== undefined,
    );
    expect(repoMappedPollCalls).toHaveLength(2);
    expect(repoMappedPollCalls[1]?.excludedRunIds).toEqual(packetlessRepairs.map((row) => row.id));
    expect(JSON.stringify(response)).not.toContain("run_packetless_repair_");
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("omits unsafe keys, credential material, raw output, diffs, patches, snippets, and secret-like values", async () => {
    const rowWithUnsafeStoreOnlyFields = {
      ...runRow(),
      credentialHash: "credential_hash_value",
      rawOutput: "do not serialize logs",
      rawStderr: "do not serialize stderr",
      rawStdout: "do not serialize stdout",
      sourceCode: "do not serialize source",
      token: "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      privateKey: "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
    } as PollRunRow;
    const store = createStore({ runs: [rowWithUnsafeStoreOnlyFields] });
    const service = createService(store);

    const response = await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });
    const responseText = JSON.stringify(response);

    expect(collectUnsafeKeys(response)).toEqual([]);
    expect(responseText).not.toMatch(
      /credential_hash_value|rawOutput|rawStdout|rawStderr|sourceCode|do not serialize|ghp_[A-Za-z0-9_]+|BEGIN PRIVATE KEY|diff --git|rawSource|snippet|patch/i,
    );
    expect(PollJobsResponseSchema.safeParse(response).success).toBe(true);
  });

  test("polling does not update run state, runner id, claim fields, or claim idempotency fields", async () => {
    const row = runRow({
      claimExpiresAt: null,
      claimIdempotencyKey: null,
      claimedAt: null,
      runnerId: null,
      state: "queued",
    });
    const before = JSON.stringify(row);
    const service = createService(createStore({ runs: [row] }));

    await service.pollJobs({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(JSON.stringify(row)).toBe(before);
    expect(row).toMatchObject({
      claimExpiresAt: null,
      claimIdempotencyKey: null,
      claimedAt: null,
      runnerId: null,
      state: "queued",
    });
  });
});
