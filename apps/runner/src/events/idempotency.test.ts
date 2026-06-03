import { describe, expect, it } from "vitest";

import { buildRunEvent } from "./build-event.js";

describe("run event idempotency", () => {
  it("keeps idempotency key and event id stable for the same run, step, and attempt", () => {
    const firstEvent = buildRunEvent({
      runId: "run-local-idempotency",
      state: "validation_running",
      stableStepName: "validation:unit-tests",
      severity: "info",
      message: "Validation command started.",
      now: () => "2026-05-21T20:50:00.000Z",
      attempt: 2,
    });
    const retriedEvent = buildRunEvent({
      runId: "run-local-idempotency",
      state: "validation_running",
      stableStepName: "validation:unit-tests",
      severity: "info",
      message: "Validation command started.",
      now: () => "2026-05-21T20:51:00.000Z",
      attempt: 2,
    });

    expect(retriedEvent.createdAt).not.toBe(firstEvent.createdAt);
    expect(retriedEvent.idempotencyKey).toBe(firstEvent.idempotencyKey);
    expect(retriedEvent.id).toBe(firstEvent.id);
  });

  it("uses different keys for different validation attempts", () => {
    const firstAttempt = buildRunEvent({
      runId: "run-validation-attempts",
      state: "validation_running",
      stableStepName: "validation:unit-tests",
      severity: "info",
      message: "Validation command started.",
      now: () => "2026-05-21T20:52:00.000Z",
      attempt: 1,
    });
    const secondAttempt = buildRunEvent({
      runId: "run-validation-attempts",
      state: "validation_running",
      stableStepName: "validation:unit-tests",
      severity: "info",
      message: "Validation command started.",
      now: () => "2026-05-21T20:53:00.000Z",
      attempt: 2,
    });

    expect(secondAttempt.idempotencyKey).not.toBe(firstAttempt.idempotencyKey);
    expect(secondAttempt.id).not.toBe(firstAttempt.id);
  });

  it("uses different keys for different repair attempts", () => {
    const firstRepairAttempt = buildRunEvent({
      runId: "run-repair-attempts",
      state: "repair_requested",
      stableStepName: "repair:request",
      severity: "info",
      message: "Repair requested.",
      now: () => "2026-05-21T20:54:00.000Z",
      attempt: 1,
    });
    const secondRepairAttempt = buildRunEvent({
      runId: "run-repair-attempts",
      state: "repair_requested",
      stableStepName: "repair:request",
      severity: "info",
      message: "Repair requested.",
      now: () => "2026-05-21T20:55:00.000Z",
      attempt: 2,
    });

    expect(secondRepairAttempt.idempotencyKey).not.toBe(firstRepairAttempt.idempotencyKey);
    expect(secondRepairAttempt.id).not.toBe(firstRepairAttempt.id);
  });

  it("uses the canonical run event idempotency key format", () => {
    const event = buildRunEvent({
      runId: "run-canonical-format",
      state: "validation_running",
      stableStepName: "validation:format-check",
      severity: "info",
      message: "Validation command started.",
      now: () => "2026-05-21T20:56:00.000Z",
      attempt: 3,
    });

    expect(event.idempotencyKey).toBe("run:run-canonical-format:event:validation:format-check:3");
  });
});
