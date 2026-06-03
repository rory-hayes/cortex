import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  ClaimJobResponseSchema,
  RunEventSchema,
  RunnerCapabilitiesSchema,
  createClaimJobIdempotencyKey,
  createRunEventIdempotencyKey,
  type ClaimJobRequest,
  type RunEvent,
  type RunnerCapabilities,
} from "@control-plane/shared";

import {
  RUNNER_JOB_CLAIM_TTL_MS,
  createClaimJobService,
  type DuplicateAssignmentBlockInput,
  type ClaimJobStore,
  type ClaimRunRow,
} from "../../src/jobs/claim.js";
import { incrementWorkspaceUsageForClaim } from "../../src/billing/usage.js";

const now = new Date("2026-05-23T09:00:00.000Z");
const claimExpiresAt = new Date(now.getTime() + RUNNER_JOB_CLAIM_TTL_MS);

const validCapabilities = (runnerId: string): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    runnerId,
    os: {
      arch: "arm64",
      platform: "darwin",
      release: "25.5.0",
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
    },
    maxConcurrentJobs: 1,
    reportedAt: "2026-05-23T08:59:30.000Z",
    supportsCancellation: true,
    supportsDryRun: true,
  });

const claimRequest = (runnerId: string): ClaimJobRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId,
  jobId: "job_1",
  runId: "run_1",
  idempotencyKey: createClaimJobIdempotencyKey({
    jobId: "job_1",
    runId: "run_1",
    runnerId,
  }),
  capabilitiesSnapshot: validCapabilities(runnerId),
});

const duplicateAssignmentEventKey = (runnerId: string): string =>
  createRunEventIdempotencyKey({
    attempt: 1,
    runId: "run_1",
    stableStepName: `duplicate_assignment:${runnerId}`,
  });

const queuedRun = (overrides: Partial<ClaimRunRow> = {}): ClaimRunRow =>
  ({
    capabilitiesSnapshot: null,
    claimExpiresAt: null,
    claimIdempotencyKey: null,
    claimedAt: null,
    id: "run_1",
    jobId: "job_1",
    runnerId: null,
    state: "queued",
    taskPacket: {
      objective: "diff --git a/private.ts b/private.ts",
      rawLogs: "Bearer runner-secret-credential",
      source: "do not serialize",
    },
    updatedAt: new Date("2026-05-23T08:55:00.000Z"),
    workspaceId: "workspace_1",
    ...overrides,
  }) as ClaimRunRow;

type InMemoryClaimStore = ClaimJobStore & {
  claimMutations: number;
  recordDuplicateAssignmentBlock: ReturnType<
    typeof vi.fn<(input: DuplicateAssignmentBlockInput) => Promise<void>>
  >;
  runEvents: RunEvent[];
  runs: ClaimRunRow[];
  usageCount: number;
  usageUpdates: number;
};

const createInMemoryClaimStore = (runs: ClaimRunRow[] = [queuedRun()]): InMemoryClaimStore => {
  const store = {
    claimMutations: 0,
    runEvents: [] as RunEvent[],
    runs,
    usageCount: 0,
    usageUpdates: 0,
    claimRun: vi.fn(async (input) => {
      const run = runs.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.id === input.runId &&
          candidate.jobId === input.jobId,
      );

      if (run === undefined || run.state !== "queued" || run.claimIdempotencyKey !== null) {
        return {
          run: run ?? null,
          status: "miss" as const,
        };
      }

      run.capabilitiesSnapshot = input.capabilitiesSnapshot;
      run.claimExpiresAt = input.claimExpiresAt;
      run.claimIdempotencyKey = input.idempotencyKey;
      run.claimedAt = input.claimedAt;
      run.runnerId = input.runnerId;
      run.state = "claimed";
      run.updatedAt = input.updatedAt;
      store.claimMutations += 1;
      await incrementWorkspaceUsageForClaim(
        {
          update: vi.fn(() => ({
            set: vi.fn((values: { updatedAt: Date }) => ({
              where: vi.fn(() => ({
                returning: vi.fn(async () => {
                  store.usageCount += 1;
                  store.usageUpdates += 1;

                  return [
                    {
                      id: input.workspaceId,
                      monthlyRunLimit: 10_000,
                      plan: "mvp",
                      repoLimit: 25,
                      runnerLimit: 10,
                      stripeCustomerId: null,
                      stripeSubscriptionId: null,
                      updatedAt: values.updatedAt,
                      usageCount: store.usageCount,
                    },
                  ];
                }),
              })),
            })),
          })),
        } as never,
        {
          updatedAt: input.claimedAt,
          workspaceId: input.workspaceId,
        },
      );

      return {
        run,
        status: "claimed" as const,
      };
    }),
    recordDuplicateAssignmentBlock: vi.fn(async ({ event }) => {
      const parsedEvent = RunEventSchema.parse(event);
      const existingEvent = store.runEvents.find(
        (candidate) =>
          candidate.runId === parsedEvent.runId &&
          candidate.idempotencyKey === parsedEvent.idempotencyKey,
      );

      if (existingEvent === undefined) {
        store.runEvents.push(parsedEvent);
      }
    }),
  } satisfies InMemoryClaimStore;

  return store;
};

const createService = (store: ClaimJobStore) =>
  createClaimJobService({
    now: () => now,
    store,
  });

const claimAsRunner = async (runnerId: string, store: ClaimJobStore) =>
  createService(store).claimJob({
    context: {
      runnerId,
      workspaceId: "workspace_1",
    },
    request: claimRequest(runnerId),
  });

const unsafeMetadataKeys: ReadonlySet<string> = new Set([
  "authorization",
  "bearer",
  "capabilitiessnapshot",
  "credential",
  "diff",
  "filecontent",
  "filecontents",
  "logs",
  "output",
  "patch",
  "privatekey",
  "rawdiff",
  "rawlog",
  "rawlogs",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "requestbody",
  "secret",
  "snippet",
  "snippets",
  "source",
  "sourcecode",
  "taskpacket",
  "token",
]);

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

    if (unsafeMetadataKeys.has(normalizedKey)) {
      keys.push(key);
    }

    collectUnsafeKeys(childValue, keys);
  }

  return keys;
};

const expectMetadataOnlyTrace = (event: RunEvent) => {
  expect(RunEventSchema.safeParse(event).success).toBe(true);
  expect(collectUnsafeKeys(event)).toEqual([]);
  expect(JSON.stringify(event)).not.toMatch(
    /taskPacket|diff --git|Bearer|credential|capabilitiesSnapshot|source|patch|rawLogs|logs?|token=|ghp_|-----BEGIN/i,
  );
};

const expectMetadataOnlyClaimResponse = (response: unknown) => {
  expect(ClaimJobResponseSchema.safeParse(response).success).toBe(true);
  expect(collectUnsafeKeys(response)).toEqual([]);
  expect(JSON.stringify(response)).not.toMatch(
    /taskPacket|diff --git|Bearer|credential|capabilitiesSnapshot|source|patch|rawLogs|logs?|token=|ghp_|-----BEGIN/i,
  );
};

describe("claim idempotency security hardening", () => {
  test("same runner retry with the same canonical idempotency key produces one claim and no duplicate trace records", async () => {
    const store = createInMemoryClaimStore();
    const service = createService(store);
    const request = claimRequest("runner_1");

    const [firstResponse, retryResponse] = await Promise.all([
      service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request,
      }),
      service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request,
      }),
    ]);

    expect(firstResponse.status).toBe("claimed");
    expect(retryResponse.status).toBe("already_claimed");
    expectMetadataOnlyClaimResponse(firstResponse);
    expectMetadataOnlyClaimResponse(retryResponse);
    expect(store.runs).toHaveLength(1);
    expect(store.claimMutations).toBe(1);
    expect(store.usageCount).toBe(1);
    expect(store.usageUpdates).toBe(1);
    expect(store.runEvents).toEqual([]);
    expect(store.recordDuplicateAssignmentBlock).not.toHaveBeenCalled();
  });

  test("competing runner receives a stable conflict while the winning claim is preserved and traced as duplicate assignment", async () => {
    const store = createInMemoryClaimStore();

    await claimAsRunner("runner_1", store);
    const conflictResponse = await claimAsRunner("runner_2", store);

    expect(conflictResponse).toEqual({
      contractVersion: CONTRACT_VERSION,
      conflictReason: "already_claimed",
      jobId: "job_1",
      runId: "run_1",
      status: "conflict",
    });
    expectMetadataOnlyClaimResponse(conflictResponse);
    expect(store.claimMutations).toBe(1);
    expect(store.runs[0]).toMatchObject({
      claimExpiresAt,
      claimIdempotencyKey: claimRequest("runner_1").idempotencyKey,
      claimedAt: now,
      runnerId: "runner_1",
      state: "claimed",
    });
    expect(store.runEvents).toHaveLength(1);
    const conflictEvent = store.runEvents[0];
    if (conflictEvent === undefined) {
      throw new Error("Expected duplicate assignment trace event.");
    }
    expect(conflictEvent).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      idempotencyKey: duplicateAssignmentEventKey("runner_2"),
      runId: "run_1",
      runnerId: "runner_2",
      severity: "blocked",
      state: "blocked",
      metadata: {
        claimedByRunnerId: "runner_1",
        claimingRunnerId: "runner_2",
        conflictReason: "already_claimed",
        jobId: "job_1",
        riskCategory: "duplicate_assignment",
      },
    });
    expectMetadataOnlyTrace(conflictEvent);
  });

  test("losing runner retry after conflict returns the same conflict with one metadata-only trace record", async () => {
    const store = createInMemoryClaimStore();

    await claimAsRunner("runner_1", store);
    const firstConflict = await claimAsRunner("runner_2", store);
    const retryConflict = await claimAsRunner("runner_2", store);

    expect(retryConflict).toEqual(firstConflict);
    expect(retryConflict).toMatchObject({
      conflictReason: "already_claimed",
      status: "conflict",
    });
    expectMetadataOnlyClaimResponse(firstConflict);
    expectMetadataOnlyClaimResponse(retryConflict);
    expect(store.claimMutations).toBe(1);
    expect(store.runEvents).toHaveLength(1);
    expect(store.runEvents[0]?.idempotencyKey).toBe(duplicateAssignmentEventKey("runner_2"));
    const conflictEvent = store.runEvents[0];
    if (conflictEvent === undefined) {
      throw new Error("Expected duplicate assignment trace event.");
    }
    expectMetadataOnlyTrace(conflictEvent);
  });

  test("distinct losing runners each produce one metadata-only duplicate-assignment trace while retries remain idempotent", async () => {
    const store = createInMemoryClaimStore();

    await claimAsRunner("runner_1", store);
    const runner2Conflict = await claimAsRunner("runner_2", store);
    const runner2Retry = await claimAsRunner("runner_2", store);
    const runner3Conflict = await claimAsRunner("runner_3", store);

    expectMetadataOnlyClaimResponse(runner2Conflict);
    expectMetadataOnlyClaimResponse(runner2Retry);
    expectMetadataOnlyClaimResponse(runner3Conflict);
    expect(store.claimMutations).toBe(1);
    expect(store.runEvents).toHaveLength(2);
    expect(new Set(store.runEvents.map((event) => event.idempotencyKey)).size).toBe(2);
    expect(store.runEvents.map((event) => event.metadata.claimingRunnerId).sort()).toEqual([
      "runner_2",
      "runner_3",
    ]);

    for (const event of store.runEvents) {
      expect(event).toMatchObject({
        contractVersion: CONTRACT_VERSION,
        runId: "run_1",
        severity: "blocked",
        state: "blocked",
        metadata: {
          claimedByRunnerId: "runner_1",
          conflictReason: "already_claimed",
          jobId: "job_1",
          riskCategory: "duplicate_assignment",
        },
      });
      expectMetadataOnlyTrace(event);
    }
  });
});
