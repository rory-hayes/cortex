import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  RunEventSchema,
  type RunEvent,
  type SubmitRunEventRequest,
} from "@control-plane/shared";

import {
  RunEventSubmissionError,
  SubmitRunEventRequestError,
  createDrizzleRunEventSubmissionStore,
  createDrizzleSubmitRunEventStore,
  createRunEventSubmissionService,
  createSubmitRunEventService,
  getConservativeRunEventRunState,
  shouldUpdateRunAggregateForEvent,
  type PersistRunEventInput,
  type PersistRunEventResult,
  type SubmitRunEventStore,
} from "./events.js";
import { schema } from "../db";

vi.mock("server-only", () => ({}));

type TestRun = {
  id: string;
  lastEventAt: Date | null;
  runnerId: string | null;
  state: RunEvent["state"];
  updateCount: number;
  updatedAt: Date;
  workspaceId: string;
};

type StoredEvent = {
  event: RunEvent;
  receivedAt: Date;
  workspaceId: string;
};

const receivedAt = new Date("2026-05-22T14:00:00.000Z");

const createRequest = (
  overrides: Partial<SubmitRunEventRequest> = {},
): SubmitRunEventRequest => ({
  contractVersion: CONTRACT_VERSION,
  runId: "run_1",
  runnerId: "runner_1",
  eventId: "event_1",
  idempotencyKey: "run:run_1:event:worktree_created:1",
  state: "worktree_created",
  severity: "info",
  message: "Worktree created.",
  metadata: {
    branchName: "aicp/task-118",
    changedFilePaths: ["apps/web/src/runs/events.ts"],
  },
  createdAt: "2026-05-22T13:59:00.000Z",
  ...overrides,
});

const createRun = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "run_1",
  lastEventAt: null,
  runnerId: "runner_1",
  state: "claimed",
  updateCount: 0,
  updatedAt: new Date("2026-05-22T13:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (runs: TestRun[]): SubmitRunEventStore & { events: StoredEvent[] } => {
  const events: StoredEvent[] = [];

  return {
    events,
    persistRunEvent: async ({
      event,
      eventCreatedAt,
      receivedAt: serverReceivedAt,
      runnerId,
      workspaceId,
    }: PersistRunEventInput): Promise<PersistRunEventResult> => {
      const run = runs.find(
        (candidate) => candidate.id === event.runId && candidate.workspaceId === workspaceId,
      );

      if (run === undefined) {
        return { status: "run_not_found" };
      }

      if (run.runnerId !== null && run.runnerId !== runnerId) {
        return { status: "runner_conflict" };
      }

      const existing = events.find(
        (candidate) =>
          candidate.event.runId === event.runId &&
          candidate.event.idempotencyKey === event.idempotencyKey,
      );

      if (existing !== undefined) {
        return {
          event: existing.event,
          inserted: false,
          status: "stored",
        };
      }

      if (events.some((candidate) => candidate.event.id === event.id)) {
        return { status: "event_id_conflict" };
      }

      events.push({
        event,
        receivedAt: serverReceivedAt,
        workspaceId,
      });

      if (
        shouldUpdateRunAggregateForEvent({
          currentLastEventAt: run.lastEventAt,
          eventCreatedAt,
        })
      ) {
        run.state = getConservativeRunEventRunState({
          currentState: run.state,
          eventState: event.state,
        });
        run.lastEventAt = eventCreatedAt;
        run.updatedAt = serverReceivedAt;
        run.updateCount += 1;
      }

      return {
        event,
        inserted: true,
        status: "stored",
      };
    },
  };
};

describe("run event submission service", () => {
  test("exposes approved submit-run-event service and store names", () => {
    const store = createStore([createRun()]);
    const service = createSubmitRunEventService({
      now: () => receivedAt,
      store,
    });

    expect(typeof service.submitRunEvent).toBe("function");
    expect(createDrizzleSubmitRunEventStore).toBe(createDrizzleRunEventSubmissionStore);
    expect(new RunEventSubmissionError()).toBeInstanceOf(SubmitRunEventRequestError);
  });

  test("stores a valid event and returns a RunEvent-schema-valid response", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    const event = await service.submitRunEvent({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event).toEqual({
      contractVersion: CONTRACT_VERSION,
      id: "event_1",
      idempotencyKey: "run:run_1:event:worktree_created:1",
      runId: "run_1",
      runnerId: "runner_1",
      state: "worktree_created",
      severity: "info",
      message: "Worktree created.",
      metadata: {
        branchName: "aicp/task-118",
        changedFilePaths: ["apps/web/src/runs/events.ts"],
      },
      createdAt: "2026-05-22T13:59:00.000Z",
    });
    expect(store.events).toHaveLength(1);
  });

  test("serializes event responses without task packet bodies or unsafe raw payload terms", async () => {
    const store = createStore([createRun()]);
    const service = createSubmitRunEventService({
      now: () => receivedAt,
      store,
    });

    const event = await service.submitRunEvent({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });
    const serializedEvent = JSON.stringify(event);

    expect(serializedEvent).not.toMatch(
      /taskPacket|task packet body|sourceCode|rawSource|diff|patch|snippet|rawOutput|rawLog|logs|credential|token|stdout|stderr/i,
    );
  });

  test("accepts canonical event idempotency keys with colon-containing stable steps", async () => {
    const store = createStore([createRun({ id: "run-canonical-format" })]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    const event = await service.submitRunEvent({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        eventId: "event_validation_format_check",
        idempotencyKey: "run:run-canonical-format:event:validation:format-check:3",
        runId: "run-canonical-format",
        state: "validation_running",
      }),
    });

    expect(event.idempotencyKey).toBe(
      "run:run-canonical-format:event:validation:format-check:3",
    );
    expect(store.events).toHaveLength(1);
  });

  test("retries the same run id and idempotency key without inserting a duplicate", async () => {
    const run = createRun();
    const store = createStore([run]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    const firstEvent = await service.submitRunEvent({
      context,
      request: createRequest(),
    });
    const retriedEvent = await service.submitRunEvent({
      context,
      request: createRequest(),
    });

    expect(retriedEvent).toEqual(firstEvent);
    expect(store.events).toHaveLength(1);
    expect(run.updateCount).toBe(1);
  });

  test("stores equivalent event steps on different runs independently", async () => {
    const store = createStore([
      createRun({ id: "run_1" }),
      createRun({ id: "run_2" }),
    ]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    const firstEvent = await service.submitRunEvent({
      context,
      request: createRequest({
        eventId: "event_run_1",
        idempotencyKey: "run:run_1:event:worktree_created:1",
        runId: "run_1",
      }),
    });
    const secondEvent = await service.submitRunEvent({
      context,
      request: createRequest({
        eventId: "event_run_2",
        idempotencyKey: "run:run_2:event:worktree_created:1",
        runId: "run_2",
      }),
    });

    expect(firstEvent.runId).toBe("run_1");
    expect(secondEvent.runId).toBe("run_2");
    expect(store.events).toHaveLength(2);
  });

  test("rejects non-canonical event idempotency keys before persistence", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          idempotencyKey: "run:run_1:event:worktree_created",
        }),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test.each([
    [
      "raw diff stable step",
      {
        idempotencyKey: "run:run_1:event:diff --git a/app.ts b/app.ts:1",
      },
    ],
    [
      "source-like stable step",
      {
        idempotencyKey: "run:run_1:event:export const leakedValue = true;:1",
      },
    ],
    [
      "private key stable step",
      {
        idempotencyKey:
          "run:run_1:event:-----BEGIN PRIVATE KEY-----unsafe-----END PRIVATE KEY-----:1",
      },
    ],
    [
      "token-like stable step",
      {
        idempotencyKey:
          "run:run_1:event:ghp_eventguardabcdefghijklmnopqrstuvwxyz123456:1",
      },
    ],
  ])("rejects unsafe idempotency key %s before persistence", async (_label, overrides) => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest(overrides),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test.each([
    [
      "raw diff event id",
      {
        eventId: "diff --git a/app.ts b/app.ts",
      },
    ],
    [
      "source-like event id",
      {
        eventId: "export const leakedValue = true;",
      },
    ],
    [
      "private key event id",
      {
        eventId: "-----BEGIN PRIVATE KEY-----unsafe-----END PRIVATE KEY-----",
      },
    ],
    [
      "token-like event id",
      {
        eventId: "ghp_eventguardabcdefghijklmnopqrstuvwxyz123456",
      },
    ],
  ])("rejects unsafe %s before persistence", async (_label, overrides) => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest(overrides),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("rejects reusing the same event id with a different idempotency key", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    await service.submitRunEvent({
      context,
      request: createRequest(),
    });

    await expect(
      service.submitRunEvent({
        context,
        request: createRequest({
          idempotencyKey: "run:run_1:event:codex_running:1",
        }),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(1);
  });

  test("returns the original event when a retry body changes event id message or metadata", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    const firstEvent = await service.submitRunEvent({
      context,
      request: createRequest(),
    });
    const retriedEvent = await service.submitRunEvent({
      context,
      request: createRequest({
        eventId: "event_changed",
        message: "Changed message should be ignored.",
        metadata: {
          branchName: "changed",
          safeSummary: "Retry payload changed after the first insert.",
        },
      }),
    });

    expect(retriedEvent).toEqual(firstEvent);
    expect(retriedEvent).toMatchObject({
      id: "event_1",
      message: "Worktree created.",
      metadata: {
        branchName: "aicp/task-118",
      },
    });
    expect(store.events).toHaveLength(1);
  });

  test.each([
    [
      "raw diff text in message",
      {
        message: "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts",
      },
    ],
    [
      "patch text in safe metadata value",
      {
        metadata: {
          safeSummary: "*** Begin Patch\n*** Update File: app.ts\n@@",
        },
      },
    ],
    [
      "code snippet text in message",
      {
        message: "export const leakedValue = true;",
      },
    ],
    [
      "raw output text in safe metadata value",
      {
        metadata: {
          safeSummary: "raw output: unsafe command result\nstdout: full command log",
        },
      },
    ],
    [
      "secret-like text in message",
      {
        message: "runner token ghp_eventguardabcdefghijklmnopqrstuvwxyz123456",
      },
    ],
    [
      "bearer token-like text in message",
      {
        message: "Runner returned Bearer unsafe-runner-token-1234567890 in a summary.",
      },
    ],
    [
      "secret-like text in safe metadata value",
      {
        metadata: {
          safeSummary: "DATABASE_PASSWORD=unsafe-fixture-value-1234567890",
        },
      },
    ],
    [
      "raw diff text in metadata key",
      {
        metadata: {
          nested: {
            "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts": "Redacted summary.",
          },
        },
      },
    ],
    [
      "source-like text in metadata key",
      {
        metadata: {
          nested: {
            "export const leakedValue = true;": "Redacted summary.",
          },
        },
      },
    ],
    [
      "secret-like text in metadata key",
      {
        metadata: {
          nested: {
            "DATABASE_PASSWORD=unsafe-fixture-value-1234567890": "Redacted summary.",
          },
        },
      },
    ],
    [
      "raw log text in metadata key",
      {
        metadata: {
          nested: {
            "raw output: unsafe command result": "Redacted summary.",
          },
        },
      },
    ],
  ])("rejects %s before persistence", async (_label, overrides) => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest(overrides),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("rejects body runner id mismatch before persistence", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({ runnerId: "runner_2" }),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("rejects unsafe protocol metadata keys before persistence", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          metadata: {
            nested: {
              sourceCode: "Redacted summary should not use source-like fields.",
            },
          },
        }),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("rejects calendar-invalid timestamps before persistence", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({ createdAt: "2026-02-31T00:00:00.000Z" }),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("keeps unsafe request material out of service errors", async () => {
    const store = createStore([createRun()]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    let thrownError: unknown;

    try {
      await service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          message:
            "diff --git a/app.ts b/app.ts\nhttps://deploy-user:deploy-pass@example.test/repo.git",
          runnerId: "runner-secret-credential",
        }),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(RunEventSubmissionError);
    const serializedError = JSON.stringify(thrownError);
    const errorText = `${String(thrownError)} ${serializedError}`;

    expect(errorText).not.toMatch(
      /diff --git|deploy-user|deploy-pass|runner-secret-credential|sourceCode|rawOutput/i,
    );
    expect(store.events).toHaveLength(0);
  });

  test("rejects runs outside the authenticated runner workspace", async () => {
    const store = createStore([createRun({ workspaceId: "workspace_2" })]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest(),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("rejects runs already assigned to a different runner", async () => {
    const store = createStore([createRun({ runnerId: "runner_2" })]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest(),
      }),
    ).rejects.toBeInstanceOf(RunEventSubmissionError);
    expect(store.events).toHaveLength(0);
  });

  test("accepts runs that are not yet assigned to a runner", async () => {
    const store = createStore([createRun({ runnerId: null })]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await expect(
      service.submitRunEvent({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest(),
      }),
    ).resolves.toMatchObject({
      id: "event_1",
      runnerId: "runner_1",
      runId: "run_1",
    });
    expect(store.events).toHaveLength(1);
  });

  test("updates run state and timestamps only on first insert", async () => {
    const run = createRun({
      state: "claimed",
      updatedAt: new Date("2026-05-22T13:00:00.000Z"),
    });
    const store = createStore([run]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    await service.submitRunEvent({
      context,
      request: createRequest({
        createdAt: "2026-05-22T13:59:00.000Z",
        state: "worktree_created",
      }),
    });
    await service.submitRunEvent({
      context,
      request: createRequest({
        createdAt: "2026-05-22T14:30:00.000Z",
        eventId: "event_changed",
        message: "A later retry must not move timestamps.",
        state: "failed",
      }),
    });

    expect(run).toMatchObject({
      lastEventAt: new Date("2026-05-22T13:59:00.000Z"),
      state: "worktree_created",
      updateCount: 1,
      updatedAt: receivedAt,
    });
  });

  test("stores an older new event without moving the run aggregate backwards", async () => {
    const existingLastEventAt = new Date("2026-05-22T14:30:00.000Z");
    const existingUpdatedAt = new Date("2026-05-22T14:31:00.000Z");
    const run = createRun({
      lastEventAt: existingLastEventAt,
      state: "validation_running",
      updatedAt: existingUpdatedAt,
    });
    const store = createStore([run]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    const event = await service.submitRunEvent({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        createdAt: "2026-05-22T13:59:00.000Z",
        eventId: "event_late_worktree_created",
        idempotencyKey: "run:run_1:event:worktree_created:2",
        state: "worktree_created",
      }),
    });

    expect(event.state).toBe("worktree_created");
    expect(store.events).toHaveLength(1);
    expect(run).toMatchObject({
      lastEventAt: existingLastEventAt,
      state: "validation_running",
      updateCount: 0,
      updatedAt: existingUpdatedAt,
    });
  });

  test("does not regress terminal run state for a late non-terminal event", async () => {
    const run = createRun({
      state: "completed",
      updatedAt: new Date("2026-05-22T13:00:00.000Z"),
    });
    const store = createStore([run]);
    const service = createRunEventSubmissionService({
      now: () => receivedAt,
      store,
    });

    await service.submitRunEvent({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        eventId: "event_late_validation",
        idempotencyKey: "run:run_1:event:validation_running:2",
        state: "validation_running",
      }),
    });

    expect(run).toMatchObject({
      lastEventAt: new Date("2026-05-22T13:59:00.000Z"),
      state: "completed",
      updateCount: 1,
      updatedAt: receivedAt,
    });
  });

  test("allows terminal events to move non-terminal runs into terminal states", () => {
    expect(
      getConservativeRunEventRunState({
        currentState: "validation_running",
        eventState: "failed",
      }),
    ).toBe("failed");
    expect(
      getConservativeRunEventRunState({
        currentState: "completed",
        eventState: "codex_running",
      }),
    ).toBe("completed");
  });
});

type DrizzleEventRow = {
  contractVersion: string;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  message: string;
  metadata: RunEvent["metadata"];
  receivedAt: Date;
  runId: string;
  runnerId: string | null;
  severity: RunEvent["severity"];
  state: RunEvent["state"];
  workspaceId: string;
};

type DrizzleHarnessInput = PersistRunEventInput;

const toDrizzleEventRow = (
  event: RunEvent,
  options: {
    receivedAt?: Date;
    workspaceId?: string;
  } = {},
): DrizzleEventRow => ({
  contractVersion: event.contractVersion,
  createdAt: new Date(event.createdAt),
  id: event.id,
  idempotencyKey: event.idempotencyKey,
  message: event.message,
  metadata: event.metadata,
  receivedAt: options.receivedAt ?? receivedAt,
  runId: event.runId,
  runnerId: event.runnerId ?? null,
  severity: event.severity,
  state: event.state,
  workspaceId: options.workspaceId ?? "workspace_1",
});

const createRunEvent = (overrides: Partial<RunEvent> = {}): RunEvent =>
  RunEventSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "event_1",
    idempotencyKey: "run:run_1:event:worktree_created:1",
    runId: "run_1",
    runnerId: "runner_1",
    state: "worktree_created",
    severity: "info",
    message: "Worktree created.",
    metadata: {
      branchName: "aicp/task-118",
    },
    createdAt: "2026-05-22T13:59:00.000Z",
    ...overrides,
  });

const createPersistInput = (
  overrides: {
    event?: Partial<RunEvent>;
    eventCreatedAt?: Date;
    receivedAt?: Date;
    runnerId?: string;
    workspaceId?: string;
  } = {},
): PersistRunEventInput => {
  const event = createRunEvent(overrides.event);

  return {
    event,
    eventCreatedAt: overrides.eventCreatedAt ?? new Date(event.createdAt),
    receivedAt: overrides.receivedAt ?? receivedAt,
    runnerId: overrides.runnerId ?? "runner_1",
    workspaceId: overrides.workspaceId ?? "workspace_1",
  };
};

const createDrizzleStoreHarness = (input: {
  events?: DrizzleEventRow[];
  runs?: TestRun[];
}) => {
  const events = [...(input.events ?? [])];
  const runs = [...(input.runs ?? [])];
  let activeInput: DrizzleHarnessInput | null = null;
  let insertCount = 0;
  let updateCount = 0;

  const requireActiveInput = (): DrizzleHarnessInput => {
    if (activeInput === null) {
      throw new Error("Drizzle harness used outside a persist call.");
    }

    return activeInput;
  };

  const selectRows = (table: unknown, selection: Record<string, unknown>): unknown[] => {
    const currentInput = requireActiveInput();

    if (table === schema.runs) {
      const run = runs.find(
        (candidate) =>
          candidate.id === currentInput.event.runId &&
          candidate.workspaceId === currentInput.workspaceId,
      );

      return run === undefined
        ? []
        : [
            {
              id: run.id,
              lastEventAt: run.lastEventAt,
              runnerId: run.runnerId,
              state: run.state,
              workspaceId: run.workspaceId,
            },
          ];
    }

    if (table !== schema.runEvents) {
      return [];
    }

    const selectionKeys = Object.keys(selection);

    if (selectionKeys.length === 1 && selectionKeys[0] === "id") {
      const event = events.find((candidate) => candidate.id === currentInput.event.id);

      return event === undefined ? [] : [{ id: event.id }];
    }

    const event = events.find(
      (candidate) =>
        candidate.runId === currentInput.event.runId &&
        candidate.workspaceId === currentInput.workspaceId &&
        candidate.idempotencyKey === currentInput.event.idempotencyKey,
    );

    return event === undefined ? [] : [event];
  };

  const select = vi.fn((selection: Record<string, unknown>) => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectRows(table, selection)),
      })),
    })),
  }));

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((row: DrizzleEventRow) => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => {
          if (table !== schema.runEvents) {
            return [];
          }

          const hasConflict = events.some(
            (candidate) =>
              candidate.id === row.id ||
              (candidate.runId === row.runId &&
                candidate.idempotencyKey === row.idempotencyKey),
          );

          if (hasConflict) {
            return [];
          }

          insertCount += 1;
          events.push(row);

          return [row];
        }),
      })),
    })),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Partial<TestRun>) => ({
      where: vi.fn(async () => {
        if (table !== schema.runs) {
          return;
        }

        const currentInput = requireActiveInput();
        const run = runs.find(
          (candidate) =>
            candidate.id === currentInput.event.runId &&
            candidate.workspaceId === currentInput.workspaceId,
        );

        if (run === undefined) {
          return;
        }

        Object.assign(run, values);
        run.updateCount += 1;
        updateCount += 1;
      }),
    })),
  }));

  const transaction = vi.fn(
    async (callback: (tx: { insert: typeof insert; select: typeof select; update: typeof update }) => unknown) =>
      callback({ insert, select, update }),
  );
  const store = createDrizzleSubmitRunEventStore({ transaction } as never);

  const persistRunEvent = async (persistInput: PersistRunEventInput) => {
    activeInput = persistInput;

    try {
      return await store.persistRunEvent(persistInput);
    } finally {
      activeInput = null;
    }
  };

  return {
    events,
    get insertCount() {
      return insertCount;
    },
    persistRunEvent,
    runs,
    transaction,
    get updateCount() {
      return updateCount;
    },
  };
};

describe("Drizzle run event submission store", () => {
  test("inserts the first event, updates the run aggregate, and allows unassigned runs", async () => {
    const run = createRun({ runnerId: null });
    const harness = createDrizzleStoreHarness({ runs: [run] });
    const input = createPersistInput();

    await expect(harness.persistRunEvent(input)).resolves.toEqual({
      event: input.event,
      inserted: true,
      status: "stored",
    });

    expect(harness.events).toEqual([
      expect.objectContaining({
        id: "event_1",
        idempotencyKey: "run:run_1:event:worktree_created:1",
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(run).toMatchObject({
      lastEventAt: new Date("2026-05-22T13:59:00.000Z"),
      state: "worktree_created",
      updateCount: 1,
      updatedAt: receivedAt,
    });
    expect(harness.insertCount).toBe(1);
    expect(harness.updateCount).toBe(1);
    expect(harness.transaction).toHaveBeenCalledTimes(1);
  });

  test("returns an existing idempotent event without another insert or run update", async () => {
    const run = createRun();
    const harness = createDrizzleStoreHarness({ runs: [run] });
    const firstInput = createPersistInput();
    const retryInput = createPersistInput({
      event: {
        id: "event_changed",
        message: "Retry payload changed.",
        metadata: {
          branchName: "changed",
        },
        state: "failed",
      },
    });

    const firstResult = await harness.persistRunEvent(firstInput);
    const retryResult = await harness.persistRunEvent(retryInput);

    expect(firstResult).toEqual({
      event: firstInput.event,
      inserted: true,
      status: "stored",
    });
    expect(retryResult).toEqual({
      event: firstInput.event,
      inserted: false,
      status: "stored",
    });
    expect(harness.events).toHaveLength(1);
    expect(run.updateCount).toBe(1);
    expect(harness.insertCount).toBe(1);
    expect(harness.updateCount).toBe(1);
  });

  test("rejects duplicate event ids with a different idempotency key", async () => {
    const existingEvent = createRunEvent({
      idempotencyKey: "run:run_1:event:codex_running:1",
      state: "codex_running",
    });
    const harness = createDrizzleStoreHarness({
      events: [toDrizzleEventRow(existingEvent)],
      runs: [createRun()],
    });

    await expect(harness.persistRunEvent(createPersistInput())).resolves.toEqual({
      status: "event_id_conflict",
    });
    expect(harness.events).toHaveLength(1);
    expect(harness.insertCount).toBe(0);
    expect(harness.updateCount).toBe(0);
  });

  test("rejects events for runs outside the authenticated workspace", async () => {
    const harness = createDrizzleStoreHarness({
      runs: [createRun({ workspaceId: "workspace_2" })],
    });

    await expect(harness.persistRunEvent(createPersistInput())).resolves.toEqual({
      status: "run_not_found",
    });
    expect(harness.events).toHaveLength(0);
    expect(harness.insertCount).toBe(0);
    expect(harness.updateCount).toBe(0);
  });

  test("rejects events for runs assigned to a different runner", async () => {
    const harness = createDrizzleStoreHarness({
      runs: [createRun({ runnerId: "runner_2" })],
    });

    await expect(harness.persistRunEvent(createPersistInput())).resolves.toEqual({
      status: "runner_conflict",
    });
    expect(harness.events).toHaveLength(0);
    expect(harness.insertCount).toBe(0);
    expect(harness.updateCount).toBe(0);
  });
});
