import { CONTRACT_VERSION, RunEventSchema, type RunEvent } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { redactRunEvent } from "./redact-event.js";

const SECRET_FIXTURES = [
  "EVENT_DOTENV_SECRET_12345",
  "ghp_eventredactionabcdefghijklmnopqrstuvwxyz123456",
  "sk-proj-eventredactionabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
  "https://event-user:event-password@example.test/repo.git",
  "EVENT_PRIVATE_KEY_BODY_1234567890",
  "N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1",
  "nested-metadata-token-fixture-12345",
  "low",
  "tiny-api-key",
  "client-secret-low-entropy",
] as const;

const validRunEvent = (overrides: Partial<RunEvent> = {}): RunEvent => ({
  contractVersion: CONTRACT_VERSION,
  id: "event-redaction-1",
  idempotencyKey: "run:run-redaction:event:claimed:1",
  runId: "run-redaction",
  runnerId: "runner-redaction",
  state: "claimed",
  severity: "info",
  message: "Runner claimed the job.",
  metadata: {
    safe: "metadata",
  },
  createdAt: "2026-05-21T21:30:00.000Z",
  ...overrides,
});

describe("redactRunEvent", () => {
  it("redacts secret-bearing event messages", () => {
    const event = redactRunEvent(
      validRunEvent({
        message: [
          "DATABASE_PASSWORD=EVENT_DOTENV_SECRET_12345",
          "github token ghp_eventredactionabcdefghijklmnopqrstuvwxyz123456",
          "openai key sk-proj-eventredactionabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
          "fetching https://event-user:event-password@example.test/repo.git",
          "-----BEGIN PRIVATE KEY-----",
          "EVENT_PRIVATE_KEY_BODY_1234567890",
          "-----END PRIVATE KEY-----",
          "opaque token N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1",
        ].join("\n"),
      }),
    );

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(event.message).toContain("[REDACTED_SECRET]");
    expect(event.message).toContain("[REDACTED_PRIVATE_KEY]");
    expect(event.message).toContain("[REDACTED_CREDENTIALS]");
    expectNoSecretFixtures(event);
  });

  it("redacts nested metadata string values inside objects and arrays", () => {
    const event = redactRunEvent(
      validRunEvent({
        metadata: {
          safeStatus: "passed",
          nested: {
            values: [
              "ACCESS_TOKEN=nested-metadata-token-fixture-12345",
              {
                remote: "https://event-user:event-password@example.test/repo.git",
                token: "N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1",
              },
              ["github token ghp_eventredactionabcdefghijklmnopqrstuvwxyz123456"],
            ],
          },
        },
      }),
    );

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(JSON.stringify(event.metadata)).toContain("[REDACTED_SECRET]");
    expect(JSON.stringify(event.metadata)).toContain("[REDACTED_CREDENTIALS]");
    expectNoSecretFixtures(event);
  });

  it("redacts low-entropy scalar values for secret-like metadata keys", () => {
    const event = redactRunEvent(
      validRunEvent({
        metadata: {
          password: "low",
          apiKey: "tiny-api-key",
          accessToken: 12345,
          clientSecret: "client-secret-low-entropy",
          nested: {
            private_key: false,
          },
        },
      }),
    );

    expect(event.metadata).toMatchObject({
      password: "[REDACTED_SECRET]",
      apiKey: "[REDACTED_SECRET]",
      accessToken: "[REDACTED_SECRET]",
      clientSecret: "[REDACTED_SECRET]",
      nested: {
        private_key: "[REDACTED_SECRET]",
      },
    });
    expectNoSecretFixtures(event);
  });

  it("leaves safe event identity fields unchanged", () => {
    const original = validRunEvent({
      id: "event-identity",
      runId: "run-identity",
      idempotencyKey: "run:run-identity:event:validation_running:2",
      state: "validation_running",
      severity: "warning",
      createdAt: "2026-05-21T21:31:00.000Z",
      message: "TOKEN=EVENT_DOTENV_SECRET_12345",
      metadata: {
        password: "low",
      },
    });

    const event = redactRunEvent(original);

    expect(event).toMatchObject({
      id: original.id,
      runId: original.runId,
      idempotencyKey: original.idempotencyKey,
      state: original.state,
      severity: original.severity,
      createdAt: original.createdAt,
    });
    expect(event.message).not.toContain("EVENT_DOTENV_SECRET_12345");
    expect(event.metadata.password).toBe("[REDACTED_SECRET]");
  });

  it("keeps unsafe metadata keys so schema validation still rejects them after redaction", () => {
    const event = redactRunEvent(
      validRunEvent({
        metadata: {
          payload: {
            source: "DATABASE_PASSWORD=EVENT_DOTENV_SECRET_12345",
          },
        },
      }),
    );

    const parsed = RunEventSchema.safeParse(event);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["metadata", "payload", "source"],
          }),
        ]),
      );
    }
    expect(JSON.stringify(event)).toContain('"source"');
    expectNoSecretFixtures(event);
  });
});

const expectNoSecretFixtures = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const secret of SECRET_FIXTURES) {
    expect(serialized).not.toContain(secret);
  }
};
