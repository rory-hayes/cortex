import {
  CONTRACT_VERSION,
  RunEventSchema,
  type RunEventSeverity,
  type RunState,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { buildRunEvent } from "./build-event.js";
import type { BuildRunEventInput } from "./build-event.js";

const BASE_INPUT = {
  runId: "run-event-builder",
  state: "worktree_created" satisfies RunState,
  stableStepName: "worktree_created",
  severity: "info" satisfies RunEventSeverity,
  message: "Runner worktree created.",
  now: () => "2026-05-21T20:45:00.000Z",
} satisfies BuildRunEventInput;

describe("buildRunEvent", () => {
  it("builds a schema-valid run event with the current contract version", () => {
    const event = buildRunEvent(BASE_INPUT);

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.contractVersion).toBe(CONTRACT_VERSION);
    expect(event.state).toBe("worktree_created");
    expect(event.severity).toBe("info");
    expect(event.message).toBe("Runner worktree created.");
    expect(event.createdAt).toBe("2026-05-21T20:45:00.000Z");
  });

  it("defaults metadata to an empty object", () => {
    const event = buildRunEvent(BASE_INPUT);

    expect(event.metadata).toEqual({});
  });

  it("defaults attempt to 1 when creating the deterministic idempotency key", () => {
    const event = buildRunEvent(BASE_INPUT);

    expect(event.idempotencyKey).toBe("run:run-event-builder:event:worktree_created:1");
  });

  it("changes the deterministic idempotency key when attempt changes", () => {
    const event = buildRunEvent({
      ...BASE_INPUT,
      attempt: 2,
    });

    expect(event.idempotencyKey).toBe("run:run-event-builder:event:worktree_created:2");
  });

  it("preserves the optional runner id", () => {
    const event = buildRunEvent({
      ...BASE_INPUT,
      runnerId: "runner-local-1",
    });

    expect(event.runnerId).toBe("runner-local-1");
  });

  it("redacts secret-bearing messages and metadata before returning the event", () => {
    const event = buildRunEvent({
      ...BASE_INPUT,
      message: [
        "DATABASE_PASSWORD=EVENT_BUILDER_DOTENV_SECRET_12345",
        "github token ghp_builderredactionabcdefghijklmnopqrstuvwxyz123456",
      ].join("\n"),
      metadata: {
        password: "low",
        nested: {
          accessToken: "tiny-token",
          remote: "https://builder-user:builder-password@example.test/repo.git",
        },
      },
    });

    const serialized = JSON.stringify(event);

    expect(event.message).toContain("[REDACTED_SECRET]");
    expect(event.metadata).toMatchObject({
      password: "[REDACTED_SECRET]",
      nested: {
        accessToken: "[REDACTED_SECRET]",
        remote: "https://[REDACTED_CREDENTIALS]@example.test/repo.git",
      },
    });
    for (const unsafeText of [
      "EVENT_BUILDER_DOTENV_SECRET_12345",
      "ghp_builderredactionabcdefghijklmnopqrstuvwxyz123456",
      "tiny-token",
      "builder-user",
      "builder-password",
    ]) {
      expect(serialized).not.toContain(unsafeText);
    }
  });

  it("omits the optional runner id when it is not provided", () => {
    const event = buildRunEvent(BASE_INPUT);

    expect(event).not.toHaveProperty("runnerId");
  });

  it("rejects invalid states through the shared run event schema", () => {
    expect(() =>
      buildRunEvent({
        ...BASE_INPUT,
        state: "running" as RunState,
      }),
    ).toThrow();
  });

  it("rejects invalid severities through the shared run event schema", () => {
    expect(() =>
      buildRunEvent({
        ...BASE_INPUT,
        severity: "fatal" as RunEventSeverity,
      }),
    ).toThrow();
  });

  it("rejects unsafe metadata keys recursively", () => {
    for (const unsafeKey of ["diff", "patch", "source", "code"]) {
      expect(() =>
        buildRunEvent({
          ...BASE_INPUT,
          metadata: {
            safeWrapper: [
              {
                nested: {
                  [unsafeKey]: "unsafe payload",
                },
              },
            ],
          },
        }),
      ).toThrow();
    }
  });

  it("rejects unsafe metadata keys after redacting secret-bearing values", () => {
    const secret = "EVENT_BUILDER_PATCH_SECRET_12345";

    expect(() =>
      buildRunEvent({
        ...BASE_INPUT,
        metadata: {
          payload: {
            patch: `DATABASE_PASSWORD=${secret}`,
          },
        },
      }),
    ).toThrow(/Run event metadata cannot include unsafe key .*patch/);
  });
});
