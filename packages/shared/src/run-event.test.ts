import { describe, expect, it } from "vitest";
import type {
  RunEvent as SharedRunEvent,
  RunEventSeverity as SharedRunEventSeverity,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const RUN_EVENT_SEVERITIES = ["debug", "info", "warning", "error", "blocked"] as const;

type RunState = SharedRunEvent["state"];
type RunEventSeverity = (typeof RUN_EVENT_SEVERITIES)[number];

type RunEvent = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  idempotencyKey: string;
  runId: string;
  runnerId?: string;
  state: RunState;
  severity: RunEventSeverity;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type RunEventModule = {
  RUN_EVENT_SEVERITIES: readonly RunEventSeverity[];
  RunEventSeveritySchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunEventMetadataSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunEventSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  createRunEventIdempotencyKey: (input: {
    runId: string;
    stableStepName: string;
    attempt: number;
  }) => string;
};

const loadRunEventModule = async () => (await import("./run-event.js")) as RunEventModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RunEventModule>;

const validRunEvent = (overrides: Partial<RunEvent> = {}): RunEvent => ({
  contractVersion: CONTRACT_VERSION,
  id: "event-1",
  idempotencyKey: "run:run-1:event:worktree_created:1",
  runId: "run-1",
  runnerId: "runner-1",
  state: "worktree_created",
  severity: "info",
  message: "Worktree created.",
  metadata: {
    exitCode: 0,
    changedFilePaths: ["packages/shared/src/run-event.ts"],
    riskFlags: ["validation_skipped"],
    validationStatus: "passed",
  },
  createdAt: "2026-05-14T20:05:30.494Z",
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  event: SharedRunEvent;
  severity: SharedRunEventSeverity;
}) => value;

describe("RunEvent", () => {
  it("exports the documented severities in canonical order", async () => {
    const { RUN_EVENT_SEVERITIES: exportedSeverities, RunEventSeveritySchema } =
      await loadRunEventModule();

    expect(exportedSeverities).toEqual(RUN_EVENT_SEVERITIES);
    for (const severity of RUN_EVENT_SEVERITIES) {
      expect(RunEventSeveritySchema.safeParse(severity).success).toBe(true);
    }
    expect(RunEventSeveritySchema.safeParse("fatal").success).toBe(false);
  });

  it("validates a run event matching the documented data model", async () => {
    const { RunEventSchema } = await loadRunEventModule();

    expect(RunEventSchema.safeParse(validRunEvent()).success).toBe(true);
  });

  it("requires an idempotency key", async () => {
    const { RunEventSchema } = await loadRunEventModule();
    const eventWithoutIdempotencyKey: Record<string, unknown> = { ...validRunEvent() };
    delete eventWithoutIdempotencyKey.idempotencyKey;

    expect(RunEventSchema.safeParse(eventWithoutIdempotencyKey).success).toBe(false);
  });

  it("rejects missing or wrong contract versions", async () => {
    const { RunEventSchema } = await loadRunEventModule();
    const eventWithoutContractVersion: Record<string, unknown> = { ...validRunEvent() };
    delete eventWithoutContractVersion.contractVersion;

    expect(RunEventSchema.safeParse(eventWithoutContractVersion).success).toBe(false);
    expect(
      RunEventSchema.safeParse(
        validRunEvent({ contractVersion: "2026-05-10.v0" as typeof CONTRACT_VERSION }),
      ).success,
    ).toBe(false);
  });

  it("rejects invalid states and severities", async () => {
    const { RunEventSchema } = await loadRunEventModule();

    expect(RunEventSchema.safeParse(validRunEvent({ state: "running" as RunState })).success).toBe(
      false,
    );
    expect(
      RunEventSchema.safeParse(validRunEvent({ severity: "fatal" as RunEventSeverity })).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields", async () => {
    const { RunEventSchema } = await loadRunEventModule();

    expect(
      RunEventSchema.safeParse({
        ...validRunEvent(),
        unexpectedField: "not allowed",
      }).success,
    ).toBe(false);
  });

  it("creates deterministic idempotency keys", async () => {
    const { createRunEventIdempotencyKey } = await loadRunEventModule();
    const input = {
      runId: "run-1",
      stableStepName: "worktree_created",
      attempt: 1,
    };

    expect(createRunEventIdempotencyKey(input)).toBe(createRunEventIdempotencyKey(input));
    expect(createRunEventIdempotencyKey(input)).toBe("run:run-1:event:worktree_created:1");
  });

  it("rejects disallowed metadata keys that could carry raw code payloads", async () => {
    const { RunEventSchema } = await loadRunEventModule();

    for (const unsafeKey of ["diff", "patch", "source", "code"]) {
      expect(
        RunEventSchema.safeParse(
          validRunEvent({
            metadata: {
              [unsafeKey]: "unsafe payload",
            },
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("rejects nested disallowed metadata keys", async () => {
    const { RunEventSchema } = await loadRunEventModule();

    expect(
      RunEventSchema.safeParse(
        validRunEvent({
          metadata: {
            payload: {
              patch: "unsafe payload",
            },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("allows safe metadata keys used for web-bound run summaries", async () => {
    const { RunEventMetadataSchema, RunEventSchema } = await loadRunEventModule();
    const metadata = {
      exitCode: 0,
      changedFilePaths: ["packages/shared/src/run-event.ts"],
      riskFlags: ["package_lock"],
      validationStatus: "passed",
    };

    expect(RunEventMetadataSchema.safeParse(metadata).success).toBe(true);
    expect(RunEventSchema.safeParse(validRunEvent({ metadata })).success).toBe(true);
  });

  it("exports the run event contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.RUN_EVENT_SEVERITIES).toEqual(RUN_EVENT_SEVERITIES);
    expect(shared.RunEventSeveritySchema?.safeParse("warning").success).toBe(true);
    expect(shared.RunEventSchema?.safeParse(validRunEvent()).success).toBe(true);
    expect(
      shared.createRunEventIdempotencyKey?.({
        runId: "run-1",
        stableStepName: "worktree_created",
        attempt: 1,
      }),
    ).toBe("run:run-1:event:worktree_created:1");

    assertEntrypointTypeExports({
      event: validRunEvent(),
      severity: "blocked",
    });
  });
});
