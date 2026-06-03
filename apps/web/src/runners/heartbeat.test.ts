import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  HeartbeatResponseSchema,
  RunnerCapabilitiesSchema,
  type HeartbeatRequest,
  type RunnerCapabilities,
} from "@control-plane/shared";

import type { RunnerHeartbeatStore, RunnerHeartbeatUpdate } from "./heartbeat";

vi.mock("server-only", () => ({}));

const dbMocks = vi.hoisted(() => {
  const schema = {
    runs: {
      cancellationReason: "runs.cancellationReason",
      cancellationRequestedAt: "runs.cancellationRequestedAt",
      cancellationRequestedByActorId: "runs.cancellationRequestedByActorId",
      id: "runs.id",
      runnerId: "runs.runnerId",
      state: "runs.state",
      workspaceId: "runs.workspaceId",
    },
    runners: {
      capabilities: "runners.capabilities",
      id: "runners.id",
      lastHeartbeatAt: "runners.lastHeartbeatAt",
      revokedAt: "runners.revokedAt",
      status: "runners.status",
      updatedAt: "runners.updatedAt",
      workspaceId: "runners.workspaceId",
    },
  };

  return {
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
    eq: vi.fn((column: unknown, value: unknown) => ({ column, type: "eq", value })),
    isNull: vi.fn((column: unknown) => ({ column, type: "isNull" })),
    schema,
  };
});

vi.mock("../db", () => ({
  and: dbMocks.and,
  eq: dbMocks.eq,
  isNull: dbMocks.isNull,
  schema: dbMocks.schema,
}));

const importHeartbeat = async () => import("./heartbeat");

const now = new Date("2026-05-22T16:00:00.000Z");
const reportedAt = "2026-05-22T15:59:30.000Z";

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    os: {
      arch: "arm64",
      platform: "darwin",
      release: "25.5.0",
    },
    shell: "/bin/zsh",
    tools: {
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
    },
    maxConcurrentJobs: 1,
    reportedAt,
    runnerId: "runner_1",
    supportsCancellation: true,
    supportsDryRun: true,
    ...overrides,
  });

const validHeartbeat = (overrides: Partial<HeartbeatRequest> = {}): HeartbeatRequest => ({
  capabilities: validCapabilities(),
  contractVersion: CONTRACT_VERSION,
  currentRunId: null,
  runnerId: "runner_1",
  status: "idle",
  timestamp: "2026-05-22T15:59:59.000Z",
  ...overrides,
});

type CancellationLookupInput = {
  runnerId: string;
  runId: string;
  workspaceId: string;
};

type CancellationRow = {
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  cancellationRequestedByActorId: string | null;
  runId: string;
};

const createStore = (
  input: { cancellation?: CancellationRow | null } = {},
): RunnerHeartbeatStore & {
  cancellationLookups: CancellationLookupInput[];
  updates: RunnerHeartbeatUpdate[];
} => {
  const cancellation = input.cancellation ?? null;
  const cancellationLookups: CancellationLookupInput[] = [];
  const updates: RunnerHeartbeatUpdate[] = [];

  return {
    findCancellationForCurrentRun: vi.fn(async (lookup: CancellationLookupInput) => {
      cancellationLookups.push(lookup);

      if (
        cancellation === null ||
        cancellation.runId !== lookup.runId ||
        lookup.runnerId !== "runner_1" ||
        lookup.workspaceId !== "workspace_1"
      ) {
        return null;
      }

      return cancellation;
    }),
    cancellationLookups,
    updateRunnerHeartbeat: vi.fn(async (update) => {
      updates.push(update);

      return {
        runnerId: update.runnerId,
        workspaceId: update.workspaceId,
      };
    }),
    updates,
  };
};

const createUpdateDb = (
  rows: Array<{ runnerId: string; workspaceId: string }> = [
    { runnerId: "runner_1", workspaceId: "workspace_1" },
  ],
) => {
  const returning = vi.fn(async () => rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { update },
    returning,
    set,
    update,
    where,
  };
};

const createQueryDb = (
  row: CancellationRow | null = {
    cancellationReason: "Stop before validation.",
    cancellationRequestedAt: new Date("2026-05-22T16:01:00.000Z"),
    cancellationRequestedByActorId: "user_1",
    runId: "run_1",
  },
) => {
  const findFirst = vi.fn(async (query: unknown) => {
    void query;

    return row === null
      ? undefined
      : {
          cancellationReason: row.cancellationReason,
          cancellationRequestedAt: row.cancellationRequestedAt,
          cancellationRequestedByActorId: row.cancellationRequestedByActorId,
          id: row.runId,
        };
  });

  return {
    db: {
      query: {
        runs: {
          findFirst,
        },
      },
    },
    findFirst,
  };
};

const createService = async (store: RunnerHeartbeatStore) => {
  const { createRunnerHeartbeatService } = await importHeartbeat();

  return createRunnerHeartbeatService({
    now: () => now,
    store,
  });
};

const expectSafeError = async (promise: Promise<unknown>, unsafeText: string) => {
  try {
    await promise;
    throw new Error("Expected heartbeat to reject unsafe input.");
  } catch (error) {
    const serialized = JSON.stringify(error);

    expect(error).toMatchObject({ code: "invalid_request" });
    expect(serialized).not.toContain(unsafeText);
  }
};

const collectObjectKeys = (value: unknown, keys = new Set<string>()): Set<string> => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectKeys(item, keys));

    return keys;
  }

  Object.entries(value).forEach(([key, childValue]) => {
    keys.add(key.toLowerCase());
    collectObjectKeys(childValue, keys);
  });

  return keys;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runner heartbeat service", () => {
  test("updates runner status, last heartbeat, and normalized capabilities", async () => {
    const store = createStore();
    const service = await createService(store);

    const response = await service.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat({
        capabilities: validCapabilities({ runnerId: undefined }),
        status: "busy",
      }),
      workspaceId: "workspace_1",
    });

    expect(store.updateRunnerHeartbeat).toHaveBeenCalledWith({
      capabilities: RunnerCapabilitiesSchema.parse({
        ...validCapabilities({ runnerId: undefined }),
        runnerId: "runner_1",
      }),
      lastHeartbeatAt: now,
      runnerId: "runner_1",
      status: "busy",
      updatedAt: now,
      workspaceId: "workspace_1",
    });
    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      pollIntervalSeconds: 15,
      serverTime: "2026-05-22T16:00:00.000Z",
    });
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
  });

  test("rejects nested runner id mismatches before updating the runner", async () => {
    const store = createStore();
    const service = await createService(store);

    await expect(
      service.recordHeartbeat({
        authenticatedRunnerId: "runner_1",
        payload: validHeartbeat({
          capabilities: validCapabilities({ runnerId: "runner_2" }),
        }),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(store.updateRunnerHeartbeat).not.toHaveBeenCalled();
  });

  test("rejects unsafe capability values before updating the runner", async () => {
    const store = createStore();
    const service = await createService(store);
    const unsafeValue = "diff --git a/src/private.ts b/src/private.ts";

    await expect(
      service.recordHeartbeat({
        authenticatedRunnerId: "runner_1",
        payload: validHeartbeat({
          capabilities: {
            ...validCapabilities(),
            shell: unsafeValue,
          } as RunnerCapabilities,
        }),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(store.updateRunnerHeartbeat).not.toHaveBeenCalled();
    expect(JSON.stringify(store.updates)).not.toContain(unsafeValue);
  });

  test("returns cancellation instruction when current run has cancellation requested", async () => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: new Date("2026-05-22T16:01:00.000Z"),
        cancellationRequestedByActorId: "user_1",
        runId: "run_1",
      },
    });
    const service = await createService(store);

    const response = await service.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat({ currentRunId: "run_1", status: "busy" }),
      workspaceId: "workspace_1",
    });

    expect(response).toEqual({
      cancellation: {
        contractVersion: CONTRACT_VERSION,
        reason: "Stop before validation.",
        requestedAt: "2026-05-22T16:01:00.000Z",
        requestedByActorId: "user_1",
        runId: "run_1",
      },
      contractVersion: CONTRACT_VERSION,
      pollIntervalSeconds: 15,
      serverTime: "2026-05-22T16:00:00.000Z",
    });
    expect(store.cancellationLookups).toEqual([
      {
        runnerId: "runner_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      },
    ]);
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
  });

  test("does not deliver source-like cancellation reason text", async () => {
    const unsafeReason = "function leakSource() { return privateImplementation; }";
    const store = createStore({
      cancellation: {
        cancellationReason: unsafeReason,
        cancellationRequestedAt: new Date("2026-05-22T16:01:00.000Z"),
        cancellationRequestedByActorId: "user_1",
        runId: "run_1",
      },
    });
    const service = await createService(store);

    const response = await service.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat({ currentRunId: "run_1", status: "busy" }),
      workspaceId: "workspace_1",
    });

    expect(response.cancellation).toEqual({
      contractVersion: CONTRACT_VERSION,
      reason: "Cancellation requested.",
      requestedAt: "2026-05-22T16:01:00.000Z",
      requestedByActorId: "user_1",
      runId: "run_1",
    });
    expect(JSON.stringify(response)).not.toContain(unsafeReason);
    expect([...collectObjectKeys(response)]).not.toEqual(
      expect.arrayContaining(["code", "content", "diff", "patch", "source", "snippet"]),
    );
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
  });

  test.each([
    {
      currentRunId: null,
      expectedLookup: false,
      name: "null current run",
    },
    {
      currentRunId: "run_other",
      expectedLookup: true,
      name: "mismatched current run",
    },
    {
      currentRunId: "run_1",
      expectedLookup: true,
      name: "non-cancel-requested run",
      noCancellationRow: true,
    },
  ])("omits cancellation instruction for $name", async (scenario) => {
    const store = createStore({
      cancellation: scenario.noCancellationRow
        ? null
        : {
            cancellationReason: "Stop before validation.",
            cancellationRequestedAt: new Date("2026-05-22T16:01:00.000Z"),
            cancellationRequestedByActorId: "user_1",
            runId: "run_1",
          },
    });
    const service = await createService(store);

    const response = await service.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat({
        currentRunId: scenario.currentRunId,
        status: scenario.currentRunId === null ? "idle" : "busy",
      }),
      workspaceId: "workspace_1",
    });

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      pollIntervalSeconds: 15,
      serverTime: "2026-05-22T16:00:00.000Z",
    });
    expect(store.cancellationLookups).toEqual(
      scenario.expectedLookup && scenario.currentRunId !== null
        ? [
            {
              runnerId: "runner_1",
              runId: scenario.currentRunId,
              workspaceId: "workspace_1",
            },
          ]
        : [],
    );
    expect(response).not.toHaveProperty("cancellation");
    expect(response).not.toHaveProperty("repair");
    expect(response).not.toHaveProperty("close");
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
  });

  test.each([
    {
      cancellationRequestedAt: null,
      cancellationRequestedByActorId: "user_1",
      name: "missing requested timestamp",
    },
    {
      cancellationRequestedAt: new Date("2026-05-22T16:01:00.000Z"),
      cancellationRequestedByActorId: null,
      name: "missing requesting actor",
    },
  ])("omits cancellation instruction for incomplete metadata: $name", async (metadata) => {
    const store = createStore({
      cancellation: {
        cancellationReason: "Stop before validation.",
        cancellationRequestedAt: metadata.cancellationRequestedAt,
        cancellationRequestedByActorId: metadata.cancellationRequestedByActorId,
        runId: "run_1",
      },
    });
    const service = await createService(store);

    const response = await service.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat({ currentRunId: "run_1", status: "busy" }),
      workspaceId: "workspace_1",
    });

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      pollIntervalSeconds: 15,
      serverTime: "2026-05-22T16:00:00.000Z",
    });
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
  });

  test("uses a configurable poll interval in the schema-valid response", async () => {
    const store = createStore();
    const { createRunnerHeartbeatService } = await importHeartbeat();
    const serviceWithCustomInterval = createRunnerHeartbeatService({
      now: () => now,
      pollIntervalSeconds: 30,
      store,
    });

    const response = await serviceWithCustomInterval.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat(),
      workspaceId: "workspace_1",
    });

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      pollIntervalSeconds: 30,
      serverTime: "2026-05-22T16:00:00.000Z",
    });
    expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
  });

  test("rejects runner id mismatches before updating the runner", async () => {
    const store = createStore();
    const service = await createService(store);

    await expect(
      service.recordHeartbeat({
        authenticatedRunnerId: "runner_1",
        payload: validHeartbeat({ runnerId: "runner_2" }),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(store.updateRunnerHeartbeat).not.toHaveBeenCalled();
  });

  test.each([
    ["env assignment", "DATABASE_URL=postgres://user:pass@example.test/control"],
    ["provider token", `ghp_${"a".repeat(32)}`],
    ["credential URL", "https://runner:secret@example.test/repo.git"],
    [
      "private key",
      "-----BEGIN PRIVATE KEY-----\nabc123abc123abc123abc123abc123\n-----END PRIVATE KEY-----",
    ],
    ["bearer value", "Bearer abcdefgh1234567890"],
    ["high entropy secret", "N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1"],
    ["process env reference", "process.env.RUNNER_SECRET"],
    ["shell env reference", "$RUNNER_SECRET"],
    ["braced shell env reference", "${OPENAI_API_KEY}"],
    ["Windows env reference", "%OPENAI_API_KEY%"],
    ["PowerShell env reference", "$env:OPENAI_API_KEY"],
  ])("rejects unsafe capability snapshot text: %s", async (_label, unsafeText) => {
    const store = createStore();
    const service = await createService(store);
    const payload = validHeartbeat({
      capabilities: {
        ...validCapabilities(),
        shell: unsafeText,
      } as RunnerCapabilities,
    });

    await expectSafeError(
      service.recordHeartbeat({
        authenticatedRunnerId: "runner_1",
        payload,
        workspaceId: "workspace_1",
      }),
      unsafeText,
    );
    expect(store.updateRunnerHeartbeat).not.toHaveBeenCalled();
  });

  test("keeps unsafe protocol keys out of returned data and store inputs", async () => {
    const store = createStore();
    const service = await createService(store);

    const response = await service.recordHeartbeat({
      authenticatedRunnerId: "runner_1",
      payload: validHeartbeat(),
      workspaceId: "workspace_1",
    });
    const keys = collectObjectKeys({
      response,
      storeInputs: store.updates,
    });

    for (const unsafeKey of [
      "credential",
      "credentialhash",
      "credentials",
      "diff",
      "env",
      "environment",
      "log",
      "logs",
      "patch",
      "rawoutput",
      "raw_output",
      "snippet",
      "source",
      "sourcecode",
      "stderr",
      "stdout",
      "token",
      "tokens",
    ]) {
      expect(keys).not.toContain(unsafeKey);
    }
  });

  test("drizzle store updates only active runner rows scoped to runner id and workspace id", async () => {
    const { createDrizzleRunnerHeartbeatStore } = await importHeartbeat();
    const capabilities = validCapabilities();
    const db = createUpdateDb();
    const store = createDrizzleRunnerHeartbeatStore(db.db as never);

    await expect(
      store.updateRunnerHeartbeat({
        capabilities,
        lastHeartbeatAt: now,
        runnerId: "runner_1",
        status: "busy",
        updatedAt: now,
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({ runnerId: "runner_1", workspaceId: "workspace_1" });

    expect(db.update).toHaveBeenCalledWith(dbMocks.schema.runners);
    expect(db.set).toHaveBeenCalledWith({
      capabilities,
      lastHeartbeatAt: now,
      status: "busy",
      updatedAt: now,
    });
    expect(dbMocks.eq).toHaveBeenCalledWith(dbMocks.schema.runners.id, "runner_1");
    expect(dbMocks.eq).toHaveBeenCalledWith(dbMocks.schema.runners.workspaceId, "workspace_1");
    expect(dbMocks.isNull).toHaveBeenCalledWith(dbMocks.schema.runners.revokedAt);
    expect(dbMocks.and.mock.calls[0]).toEqual([
      { column: dbMocks.schema.runners.id, type: "eq", value: "runner_1" },
      { column: dbMocks.schema.runners.workspaceId, type: "eq", value: "workspace_1" },
      { column: dbMocks.schema.runners.revokedAt, type: "isNull" },
    ]);
  });

  test("drizzle store selects cancellation metadata scoped to workspace runner run and cancel_requested state", async () => {
    const { createDrizzleRunnerHeartbeatStore } = await importHeartbeat();
    const db = createQueryDb();
    const store = createDrizzleRunnerHeartbeatStore(db.db as never);

    await expect(
      store.findCancellationForCurrentRun({
        runnerId: "runner_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      cancellationReason: "Stop before validation.",
      cancellationRequestedAt: new Date("2026-05-22T16:01:00.000Z"),
      cancellationRequestedByActorId: "user_1",
      runId: "run_1",
    });

    expect(db.findFirst).toHaveBeenCalledWith({
      columns: {
        cancellationReason: true,
        cancellationRequestedAt: true,
        cancellationRequestedByActorId: true,
        id: true,
      },
      where: expect.any(Function),
    });

    const findFirstOptions = db.findFirst.mock.calls[0]?.[0] as
      | {
          where: (
            fields: unknown,
            operators: {
              and: typeof dbMocks.and;
              eq: typeof dbMocks.eq;
            },
          ) => unknown;
        }
      | undefined;

    if (findFirstOptions === undefined) {
      throw new Error("Expected cancellation lookup query options.");
    }

    const where = findFirstOptions.where(dbMocks.schema.runs, {
      and: dbMocks.and,
      eq: dbMocks.eq,
    });

    expect(dbMocks.eq).toHaveBeenCalledWith(dbMocks.schema.runs.workspaceId, "workspace_1");
    expect(dbMocks.eq).toHaveBeenCalledWith(dbMocks.schema.runs.runnerId, "runner_1");
    expect(dbMocks.eq).toHaveBeenCalledWith(dbMocks.schema.runs.id, "run_1");
    expect(dbMocks.eq).toHaveBeenCalledWith(dbMocks.schema.runs.state, "cancel_requested");
    expect(where).toEqual({
      conditions: [
        { column: dbMocks.schema.runs.workspaceId, type: "eq", value: "workspace_1" },
        { column: dbMocks.schema.runs.runnerId, type: "eq", value: "runner_1" },
        { column: dbMocks.schema.runs.id, type: "eq", value: "run_1" },
        { column: dbMocks.schema.runs.state, type: "eq", value: "cancel_requested" },
      ],
      type: "and",
    });
  });
});
