import { describe, expect, it } from "vitest";

import {
  RUNNER_ERROR_CATEGORIES,
  RUNNER_ERROR_DEFINITIONS,
  RunnerError,
  getRunnerErrorDefaultMessage,
  getRunnerErrorExitCode,
  isRunnerError,
  toRunnerErrorSummary,
  type RunnerErrorCategory,
} from "./index.js";

const EXPECTED_ERROR_DEFINITIONS: Record<
  RunnerErrorCategory,
  {
    defaultMessage: string;
    exitCode: number;
  }
> = {
  usage: {
    defaultMessage: "Runner command usage is invalid.",
    exitCode: 2,
  },
  task_packet: {
    defaultMessage: "Task packet could not be loaded or validated.",
    exitCode: 3,
  },
  config: {
    defaultMessage: "Runner configuration could not be loaded or validated.",
    exitCode: 4,
  },
  repo_path: {
    defaultMessage: "Repository path could not be validated.",
    exitCode: 5,
  },
  command_execution: {
    defaultMessage: "A runner command failed.",
    exitCode: 6,
  },
  cancelled: {
    defaultMessage: "Runner execution was cancelled.",
    exitCode: 130,
  },
  internal: {
    defaultMessage: "An internal runner error occurred.",
    exitCode: 1,
  },
};

const UNSAFE_METADATA_KEYS = [
  "diff",
  "patch",
  "sourceCode",
  "rawStdout",
  "rawStderr",
  "rawLog",
  "snippet",
  "content",
];

const UNSAFE_METADATA_VALUES = [
  "diff --git a/private.ts b/private.ts",
  "@@ -1 +1 @@",
  "function leakedSource() { return 'private'; }",
  "raw stdout with private implementation details",
  "raw stderr with private implementation details",
  "raw log with private implementation details",
  "const snippet = 'private';",
  "private file content",
];

const SECRET_METADATA_VALUES = [
  "GITHUB_TOKEN=ghp_runnersecret1234567890",
  "OPENAI_API_KEY=sk-runner-secret-value-1234567890",
  "password=correct-horse-battery-staple",
  "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
  "https://runner:credential@example.com/private.git",
];

describe("runner errors", () => {
  it("defines stable categories, default messages, and exit codes", () => {
    expect(RUNNER_ERROR_CATEGORIES).toEqual(Object.keys(EXPECTED_ERROR_DEFINITIONS));

    for (const category of RUNNER_ERROR_CATEGORIES) {
      const expectedDefinition = EXPECTED_ERROR_DEFINITIONS[category];

      expect(RUNNER_ERROR_DEFINITIONS[category]).toEqual(expectedDefinition);
      expect(getRunnerErrorExitCode(category)).toBe(expectedDefinition.exitCode);
      expect(getRunnerErrorDefaultMessage(category)).toBe(expectedDefinition.defaultMessage);
    }
  });

  it("constructs default RunnerError instances from a category", () => {
    for (const category of RUNNER_ERROR_CATEGORIES) {
      const error = new RunnerError({ category });
      const expectedDefinition = EXPECTED_ERROR_DEFINITIONS[category];

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("RunnerError");
      expect(error.category).toBe(category);
      expect(error.exitCode).toBe(expectedDefinition.exitCode);
      expect(error.userSafeMessage).toBe(expectedDefinition.defaultMessage);
      expect(error.message).toBe(expectedDefinition.defaultMessage);
      expect(error.metadata).toEqual({});
      expect(isRunnerError(error)).toBe(true);
    }

    expect(isRunnerError(new Error("plain error"))).toBe(false);
  });

  it("keeps an optional local cause out of summaries", () => {
    const cause = new Error("local-only cause with GITHUB_TOKEN=ghp_causesecret1234567890");
    const error = new RunnerError({
      category: "config",
      cause,
    });

    expect(error.cause).toBe(cause);
    expectSafeSummaryText(toRunnerErrorSummary(error), [cause.message]);
  });

  it("supports custom user-safe messages and safe metadata", () => {
    const error = new RunnerError({
      category: "command_execution",
      userSafeMessage: "Validation command failed.",
      metadata: {
        repoPath: "/tmp/control-plane-fixture",
        code: "validation_failed",
        commandExitCode: 7,
        redactionApplied: true,
        nested: {
          attempt: 1,
          labels: ["typecheck", "runner"],
        },
      },
    });

    expect(error.userSafeMessage).toBe("Validation command failed.");
    expect(error.message).toBe("Validation command failed.");
    expect(error.metadata).toEqual({
      repoPath: "/tmp/control-plane-fixture",
      code: "validation_failed",
      commandExitCode: 7,
      redactionApplied: true,
      nested: {
        attempt: 1,
        labels: ["typecheck", "runner"],
      },
    });
    expect(toRunnerErrorSummary(error)).toEqual({
      category: "command_execution",
      exitCode: 6,
      message: "Validation command failed.",
      metadata: error.metadata,
    });
  });

  it("falls back to default messages when custom messages contain unsafe text", () => {
    const unsafeMessages: Array<{
      category: RunnerErrorCategory;
      message: string;
      leakedText: readonly string[];
    }> = [
      {
        category: "command_execution",
        message: "Command failed with diff --git a/private.ts b/private.ts",
        leakedText: ["diff --git", "private.ts"],
      },
      {
        category: "command_execution",
        message: "Command failed\n@@ -1 +1 @@\n-private\n+secret",
        leakedText: ["@@ -1 +1 @@", "-private", "+secret"],
      },
      {
        category: "internal",
        message: "Error: local failure\n    at runLocal (/private/repo/src/runner.ts:12:34)",
        leakedText: ["runLocal", "/private/repo/src/runner.ts"],
      },
      {
        category: "task_packet",
        message: "const leakedSource = 'private implementation detail';",
        leakedText: ["const leakedSource", "private implementation detail"],
      },
    ];

    for (const { category, message, leakedText } of unsafeMessages) {
      const error = new RunnerError({
        category,
        userSafeMessage: message,
      });
      const defaultMessage = EXPECTED_ERROR_DEFINITIONS[category].defaultMessage;
      const summary = toRunnerErrorSummary(error);

      expect(error.userSafeMessage).toBe(defaultMessage);
      expect(error.message).toBe(defaultMessage);
      expect(summary.message).toBe(defaultMessage);
      expectSafeSummaryText(summary, [message, ...leakedText]);
    }
  });

  it("strips unsafe metadata keys recursively", () => {
    const error = new RunnerError({
      category: "internal",
      metadata: {
        diff: UNSAFE_METADATA_VALUES[0],
        safe: "kept",
        nested: {
          patch: UNSAFE_METADATA_VALUES[1],
          sourceCode: UNSAFE_METADATA_VALUES[2],
          safeNested: "kept nested",
        },
        list: [
          {
            rawStdout: UNSAFE_METADATA_VALUES[3],
            rawStderr: UNSAFE_METADATA_VALUES[4],
            safeListValue: "kept list",
          },
          {
            rawLog: UNSAFE_METADATA_VALUES[5],
            snippet: UNSAFE_METADATA_VALUES[6],
            content: UNSAFE_METADATA_VALUES[7],
          },
        ],
      },
    });

    const summary = toRunnerErrorSummary(error);

    expect(summary.metadata).toEqual({
      safe: "kept",
      nested: {
        safeNested: "kept nested",
      },
      list: [
        {
          safeListValue: "kept list",
        },
        {},
      ],
    });
    expectSafeSummaryText(summary, [...UNSAFE_METADATA_KEYS, ...UNSAFE_METADATA_VALUES]);
  });

  it("drops source-like metadata string values even when keys look safe", () => {
    const error = new RunnerError({
      category: "internal",
      metadata: {
        details: "diff --git a/private.ts b/private.ts\n@@ -1 +1 @@\n-private",
        note: "function leakedSource() { return 'private'; }",
        safe: "kept",
      },
    });

    const summary = toRunnerErrorSummary(error);

    expect(summary.metadata).toEqual({
      safe: "kept",
    });
    expectSafeSummaryText(summary, [
      "diff --git",
      "@@ -1 +1 @@",
      "function leakedSource()",
      "private.ts",
    ]);
  });

  it("redacts secret-looking metadata string values from summaries", () => {
    const error = new RunnerError({
      category: "config",
      metadata: {
        token: SECRET_METADATA_VALUES[0],
        openAiKey: SECRET_METADATA_VALUES[1],
        passwordLine: SECRET_METADATA_VALUES[2],
        privateKey: SECRET_METADATA_VALUES[3],
        credentialUrl: SECRET_METADATA_VALUES[4],
      },
    });

    const summary = toRunnerErrorSummary(error);
    const summaryText = JSON.stringify(summary);

    expect(summaryText).toContain("[REDACTED_SECRET]");
    expect(summaryText).toContain("[REDACTED_PRIVATE_KEY]");
    expect(summaryText).toContain("[REDACTED_CREDENTIAL_URL]");
    expectSafeSummaryText(summary, SECRET_METADATA_VALUES);
  });

  it("summarizes unknown errors as internal errors without leaking raw messages or stacks", () => {
    const unknownError = new Error("GITHUB_TOKEN=ghp_unknownsecret1234567890 leaked raw message");
    unknownError.stack = [
      "Error: raw stack should not cross the runner boundary",
      "    at leakedSource (/private/repo/src/private.ts:1:1)",
      "OPENAI_API_KEY=sk-unknown-secret-value-1234567890",
    ].join("\n");

    const summary = toRunnerErrorSummary(unknownError);

    expect(summary).toEqual({
      category: "internal",
      exitCode: 1,
      message: EXPECTED_ERROR_DEFINITIONS.internal.defaultMessage,
      metadata: {},
    });
    expectSafeSummaryText(summary, [
      unknownError.message,
      unknownError.stack,
      "raw stack",
      "leakedSource",
      "sk-unknown-secret-value-1234567890",
    ]);
  });
});

const expectSafeSummaryText = (summary: unknown, unsafeTexts: readonly string[]): void => {
  const summaryText = JSON.stringify(summary);

  for (const unsafeText of unsafeTexts) {
    expect(summaryText).not.toContain(unsafeText);
  }
};
