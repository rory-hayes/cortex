import { describe, expect, it } from "vitest";

import { hasUnsafePayloadValueText } from "./payload-safety.js";

describe("payload safety value detection", () => {
  it("allows ordinary repo-readiness prose that starts with declaration-like words", () => {
    const safeProseValues = [
      "Type check coverage is missing.",
      "Class cleanup is needed before the runner status page ships.",
      "Function naming should be clarified in the implementation plan.",
      "Import metadata from Linear only after manual approval.",
      "Interface documentation is incomplete.",
    ] as const;

    for (const value of safeProseValues) {
      expect(hasUnsafePayloadValueText(value), `Expected safe prose to be allowed: ${value}`).toBe(
        false,
      );
    }
  });

  it("continues rejecting declaration-like code snippets", () => {
    const unsafeSnippetValues = [
      "type TaskPayload = { rawSource: string }",
      "interface RunnerPayload { token: string }",
      "class RunnerSecret {}",
      "function leakSecret() { return process.env.SECRET; }",
      "import { secret } from './private';",
    ] as const;

    for (const value of unsafeSnippetValues) {
      expect(
        hasUnsafePayloadValueText(value),
        `Expected declaration-like snippet to be rejected: ${value}`,
      ).toBe(true);
    }
  });

  it("rejects exact secret-like environment names and references", () => {
    const unsafeEnvValues = [
      "API_KEY=plain-secret",
      "TOKEN=plain-secret",
      "process.env.API_KEY",
      "process.env.TOKEN",
      "${API_KEY}",
      "$TOKEN",
      "$env:API_KEY",
      "%TOKEN%",
    ] as const;

    for (const value of unsafeEnvValues) {
      expect(hasUnsafePayloadValueText(value), `Expected env value to be rejected: ${value}`).toBe(
        true,
      );
    }
  });
});
