import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTRACT_VERSION, type RunEvent } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { appendRunEvent, EventWriterError } from "./event-writer.js";

const EVENT_PAYLOAD_TEXT = [
  "event-message-that-must-not-leak",
  "metadata-value-that-must-not-leak",
  '"idempotencyKey"',
  '"metadata"',
] as const;

const validRunEvent = (overrides: Partial<RunEvent> = {}): RunEvent => ({
  contractVersion: CONTRACT_VERSION,
  id: "event-1",
  idempotencyKey: "run:run-1:event:claimed:1",
  runId: "run-1",
  runnerId: "runner-1",
  state: "claimed",
  severity: "info",
  message: "Runner claimed the job.",
  metadata: {
    exitCode: 0,
    changedFilePaths: ["apps/runner/src/event-writer.ts"],
  },
  createdAt: "2026-05-20T07:30:00.000Z",
  ...overrides,
});

describe("event writer", () => {
  it("appends one valid RunEvent as exactly one JSONL line", async () => {
    const eventsOutPath = await createTempEventsPath();
    const event = validRunEvent();

    await expect(appendRunEvent(eventsOutPath, event)).resolves.toEqual(event);

    const lines = await readJsonLines(eventsOutPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(event);
  });

  it("appends multiple events without overwriting previous lines", async () => {
    const eventsOutPath = await createTempEventsPath();
    const firstEvent = validRunEvent({
      id: "event-1",
      idempotencyKey: "run:run-1:event:claimed:1",
      state: "claimed",
      createdAt: "2026-05-20T07:30:00.000Z",
    });
    const secondEvent = validRunEvent({
      id: "event-2",
      idempotencyKey: "run:run-1:event:dry_run_running:1",
      state: "dry_run_running",
      severity: "debug",
      createdAt: "2026-05-20T07:31:00.000Z",
    });

    await appendRunEvent(eventsOutPath, firstEvent);
    await appendRunEvent(eventsOutPath, secondEvent);

    await expect(readJsonLines(eventsOutPath)).resolves.toEqual([firstEvent, secondEvent]);
  });

  it("preserves the event identity, state, severity, metadata, and timestamp fields", async () => {
    const eventsOutPath = await createTempEventsPath();
    const event = validRunEvent({
      id: "event-preserved",
      runId: "run-preserved",
      idempotencyKey: "run:run-preserved:event:validation_running:2",
      state: "validation_running",
      severity: "warning",
      metadata: {
        validationStatus: "running",
        commandIds: ["typecheck", "test"],
      },
      createdAt: "2026-05-20T08:00:00.000Z",
    });

    const returnedEvent = await appendRunEvent(eventsOutPath, event);
    const [writtenEvent] = await readJsonLines(eventsOutPath);

    for (const persistedEvent of [returnedEvent, writtenEvent]) {
      expect(persistedEvent).toMatchObject({
        id: event.id,
        runId: event.runId,
        idempotencyKey: event.idempotencyKey,
        state: event.state,
        severity: event.severity,
        metadata: event.metadata,
        createdAt: event.createdAt,
      });
    }
  });

  it("redacts event messages and nested metadata before returning and writing JSONL", async () => {
    const eventsOutPath = await createTempEventsPath();
    const event = validRunEvent({
      message: [
        "DATABASE_PASSWORD=EVENT_WRITER_DOTENV_SECRET_12345",
        "github token ghp_writerredactionabcdefghijklmnopqrstuvwxyz123456",
      ].join("\n"),
      metadata: {
        safeStatus: "running",
        nested: {
          password: "low",
          values: [
            "https://writer-user:writer-password@example.test/repo.git",
            {
              accessToken: "tiny-token",
            },
          ],
        },
      },
    });

    const returnedEvent = await appendRunEvent(eventsOutPath, event);
    const [writtenEvent] = await readJsonLines(eventsOutPath);

    expect(writtenEvent).toBeDefined();
    if (writtenEvent === undefined) {
      throw new Error("Expected appended event to be persisted.");
    }

    for (const persistedEvent of [returnedEvent, writtenEvent]) {
      const serialized = JSON.stringify(persistedEvent);

      expect(persistedEvent.message).toContain("[REDACTED_SECRET]");
      expect(persistedEvent.metadata).toMatchObject({
        safeStatus: "running",
        nested: {
          password: "[REDACTED_SECRET]",
          values: [
            "https://[REDACTED_CREDENTIALS]@example.test/repo.git",
            {
              accessToken: "[REDACTED_SECRET]",
            },
          ],
        },
      });
      for (const unsafeText of [
        "EVENT_WRITER_DOTENV_SECRET_12345",
        "ghp_writerredactionabcdefghijklmnopqrstuvwxyz123456",
        "writer-user",
        "writer-password",
        "tiny-token",
      ]) {
        expect(serialized).not.toContain(unsafeText);
      }
    }
  });

  it("rejects an event missing an idempotency key before creating the output file", async () => {
    const eventsOutPath = await createTempEventsPath();
    const eventWithoutIdempotencyKey: Record<string, unknown> = { ...validRunEvent() };
    delete eventWithoutIdempotencyKey.idempotencyKey;

    const error = await expectEventWriterError(
      appendRunEvent(eventsOutPath, eventWithoutIdempotencyKey),
    );

    expect(error.code).toBe("invalid_event");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "idempotencyKey",
          message: expect.any(String),
        }),
      ]),
    );
    await expect(access(eventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects nested unsafe metadata without modifying an existing output file", async () => {
    const eventsOutPath = await createTempEventsPath();
    const originalContents = `${JSON.stringify(validRunEvent({ id: "existing-event" }))}\n`;
    await writeFile(eventsOutPath, originalContents, "utf8");

    const error = await expectEventWriterError(
      appendRunEvent(
        eventsOutPath,
        validRunEvent({
          metadata: {
            payload: {
              patch: "unsafe payload",
            },
          },
        }),
      ),
    );

    expect(error.code).toBe("invalid_event");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "metadata.payload.patch",
          message: expect.any(String),
        }),
      ]),
    );
    await expect(readFile(eventsOutPath, "utf8")).resolves.toBe(originalContents);
  });

  it("rejects unsafe metadata keys containing secrets without creating the output file or leaking the value", async () => {
    const eventsOutPath = await createTempEventsPath();
    const secret = "EVENT_WRITER_PATCH_SECRET_12345";

    const error = await expectEventWriterError(
      appendRunEvent(
        eventsOutPath,
        validRunEvent({
          metadata: {
            payload: {
              patch: `DATABASE_PASSWORD=${secret}`,
            },
          },
        }),
      ),
    );

    const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

    expect(error.code).toBe("invalid_event");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "metadata.payload.patch",
          message: expect.any(String),
        }),
      ]),
    );
    expect(safeErrorText).not.toContain(secret);
    await expect(access(eventsOutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("wraps filesystem failures without event payload text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-event-writer-directory-"));
    const event = validRunEvent({
      message: EVENT_PAYLOAD_TEXT[0],
      metadata: {
        note: EVENT_PAYLOAD_TEXT[1],
      },
    });

    const error = await expectEventWriterError(appendRunEvent(directory, event));

    expect(error.code).toBe("write_failed");
    expect(error.issues).toEqual([]);
    expect(error.eventsOutPath).toBe(directory);
    expect(error.cause).toBeUndefined();
    expectSafeEventWriterErrorText(error);
  });

  it("exports the writer API from the runner package entrypoint", async () => {
    const runner = await import("./index.js");

    expect(runner.appendRunEvent).toBe(appendRunEvent);
    expect(runner.EventWriterError).toBe(EventWriterError);
  });
});

const createTempEventsPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "runner-event-writer-"));
  return join(directory, "events.jsonl");
};

const readJsonLines = async (eventsOutPath: string): Promise<RunEvent[]> => {
  const contents = await readFile(eventsOutPath, "utf8");

  return contents
    .trimEnd()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEvent);
};

const expectEventWriterError = async (promise: Promise<unknown>): Promise<EventWriterError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EventWriterError);
    return error as EventWriterError;
  }

  throw new Error("Expected event writer to reject.");
};

const expectSafeEventWriterErrorText = (error: EventWriterError): void => {
  const safeText = `${error.message}\n${JSON.stringify({
    code: error.code,
    issues: error.issues,
  })}`;

  for (const unsafeText of EVENT_PAYLOAD_TEXT) {
    expect(safeText).not.toContain(unsafeText);
  }
};
