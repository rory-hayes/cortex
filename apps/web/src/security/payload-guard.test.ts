import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DryRunResultSchema,
  PrArtifactSchema,
  RunEventSchema,
  ValidationResultSchema,
  type DryRunResult,
  type PrArtifact,
  type RunEvent,
  type ValidationResult,
} from "@control-plane/shared";

import {
  UnsafeWebBoundPayloadError,
  assertSafeWebBoundPayload,
  hasUnsafePayloadPathText,
  hasUnsafePayloadText,
  hasUnsafeWebBoundPayload,
} from "./payload-guard.js";

vi.mock("server-only", () => ({}));

const unsafePayloadKeys = [
  "diff",
  "patch",
  "source",
  "sourceCode",
  "rawDiff",
  "patchText",
  "codeSnippet",
  "fileContents",
  "rawOutput",
  "rawCommandOutput",
  "rawLog",
  "rawLogs",
  "stdout",
  "stdoutSummary",
  "stderr",
  "stderrSummary",
  "secret",
  "token",
  "password",
  "privateKey",
] as const;

const validRunEvent = (): RunEvent =>
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
      branchName: "aicp/task-176",
      changedFilePaths: ["apps/web/src/security/payload-guard.ts"],
    },
    createdAt: "2026-05-23T10:00:00.000Z",
  });

const validDryRunResult = (): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "dry_run_result_1",
    runId: "run_1",
    status: "passed",
    checks: [
      {
        id: "repo_clean",
        label: "Repo clean",
        status: "passed",
        message: "Repository was clean.",
        metadata: {
          changedFileCount: 0,
        },
      },
    ],
    capabilities: {
      contractVersion: CONTRACT_VERSION,
      runnerId: "runner_1",
      os: {
        arch: "arm64",
        platform: "darwin",
        release: "25.0.0",
      },
      shell: "zsh",
      tools: {
        codex: { available: true, version: "1.0.0" },
        gh: { available: true, version: "2.0.0" },
        git: { available: true, version: "2.50.0" },
        node: { available: true, version: "24.0.0" },
        npm: { available: true, version: "11.0.0" },
        pnpm: { available: true, version: "10.0.0" },
        python: { available: false },
        yarn: { available: false },
      },
      maxConcurrentJobs: 1,
      supportsCancellation: true,
      supportsDryRun: true,
      reportedAt: "2026-05-23T09:59:00.000Z",
    },
    blockers: [],
    warnings: [],
    createdAt: "2026-05-23T09:59:30.000Z",
  });

const validValidationResult = (): ValidationResult =>
  ValidationResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "validation_result_1",
    runId: "run_1",
    commandId: "web-tests",
    commandLabel: "Web tests",
    command: "pnpm --filter @control-plane/web test",
    status: "passed",
    exitCode: 0,
    durationMs: 1234,
    stdoutSummary: "Validation command passed.",
    stderrSummary: "",
    redactionApplied: true,
    startedAt: "2026-05-23T09:58:00.000Z",
    finishedAt: "2026-05-23T09:58:02.000Z",
  });

const validPrArtifact = (): PrArtifact =>
  PrArtifactSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "pr_artifact_1",
    runId: "run_1",
    repository: {
      owner: "control-plane",
      name: "app",
    },
    branchName: "aicp/task-176",
    prNumber: 42,
    prUrl: "https://github.com/control-plane/app/pull/42",
    prTitle: "TASK-176 payload guard",
    prStatus: "draft",
    changedFilePaths: ["apps/web/src/security/payload-guard.ts"],
    riskFindings: [
      {
        id: "risk:package_lock",
        severity: "warning",
        category: "package_lock",
        message: "Package lock changed.",
        paths: ["pnpm-lock.yaml"],
      },
    ],
    createdAt: "2026-05-23T09:59:45.000Z",
  });

describe("web-bound payload guard", () => {
  test.each(unsafePayloadKeys)("rejects recursive unsafe raw-payload key %s", (unsafeKey) => {
    expect(
      hasUnsafeWebBoundPayload({
        safe: [
          {
            nested: {
              [unsafeKey]: "redacted summary",
            },
          },
        ],
      }),
    ).toBe(true);
  });

  test.each([
    ["raw diff marker", "diff --git a/app.ts b/app.ts"],
    ["patch hunk", "@@ -1,2 +1,2 @@\n-old\n+new"],
    ["code fence", "```ts\nconst leakedValue = true;\n```"],
    ["TypeScript snippet", "export const leakedValue = true;"],
    ["Python snippet", "def leaked_value():\n    return True"],
    ["raw output label", "raw output: unsafe command result"],
    ["credential URL", "https://deploy-user:deploy-pass@example.test/repo.git"],
    ["secret query parameter", "https://example.test/callback?token=hunter2"],
    ["CLI secret flag", "pnpm test --token=hunter2"],
    [
      "private key block",
      "-----BEGIN PRIVATE KEY-----\nunsafe-fixture-value\n-----END PRIVATE KEY-----",
    ],
    ["bearer token", "Bearer unsafeFixtureToken12345"],
    ["provider token", "ghp_payloadguardabcdefghijklmnopqrstuvwxyz123456"],
    ["dotenv assignment", "DATABASE_URL=postgres://user:password@example.test/app"],
  ] as const)("rejects high-risk string marker: %s", (_label, value) => {
    expect(hasUnsafePayloadText(value)).toBe(true);
    expect(hasUnsafeWebBoundPayload({ safeSummary: value })).toBe(true);
  });

  test("handles cyclic objects without treating the cycle itself as unsafe", () => {
    const payload: Record<string, unknown> = {
      message: "Worktree created.",
      metadata: {
        branchName: "aicp/task-176",
      },
    };
    payload.self = payload;

    expect(hasUnsafeWebBoundPayload(payload)).toBe(false);
  });

  test("throws only a generic error for unsafe payloads", () => {
    expect(() =>
      assertSafeWebBoundPayload({
        sourceCode: "diff --git a/app.ts b/app.ts",
      }),
    ).toThrow(UnsafeWebBoundPayloadError);

    try {
      assertSafeWebBoundPayload({
        sourceCode: "diff --git a/app.ts b/app.ts",
      });
    } catch (error) {
      expect(String(error)).not.toMatch(/sourceCode|diff --git|app\.ts|Zod|request body/i);
    }
  });

  test("allows current safe runner event and artifact payload shapes", () => {
    const safePayloads = [
      {
        contractVersion: CONTRACT_VERSION,
        runId: "run_1",
        runnerId: "runner_1",
        eventId: "event_1",
        idempotencyKey: "run:run_1:event:worktree_created:1",
        state: "worktree_created",
        severity: "info",
        message: "Worktree created.",
        metadata: {
          branchName: "aicp/task-176",
        },
        createdAt: "2026-05-23T10:00:00.000Z",
      },
      {
        contractVersion: CONTRACT_VERSION,
        runnerId: "runner_1",
        runId: "run_1",
        result: validDryRunResult(),
        submittedAt: "2026-05-23T10:00:00.000Z",
      },
      {
        contractVersion: CONTRACT_VERSION,
        runnerId: "runner_1",
        runId: "run_1",
        result: validValidationResult(),
        submittedAt: "2026-05-23T10:00:00.000Z",
      },
      {
        contractVersion: CONTRACT_VERSION,
        runnerId: "runner_1",
        runId: "run_1",
        artifact: validPrArtifact(),
        submittedAt: "2026-05-23T10:00:00.000Z",
      },
      {
        documentSummaries: [
          {
            documentByteCount: 512,
            inputCharacterCount: 420,
            kind: "readme",
            label: "README",
            redactedCharacterCount: 400,
            redactionApplied: true,
            summary: "README indicates product scope, security, validation, and workflow context.",
            topicLabels: ["product_scope", "security", "validation", "workflow"],
          },
        ],
      },
      validRunEvent(),
    ];

    for (const payload of safePayloads) {
      expect(hasUnsafeWebBoundPayload(payload)).toBe(false);
      expect(() => assertSafeWebBoundPayload(payload)).not.toThrow();
    }
  });

  test("keeps path-specific safety available without blocking env examples", () => {
    expect(hasUnsafePayloadPathText(".env")).toBe(true);
    expect(hasUnsafePayloadPathText("config/.env.production")).toBe(true);
    expect(hasUnsafePayloadPathText("../src/app.ts")).toBe(true);
    expect(hasUnsafePayloadPathText("See /Users/rory/private/repo/src/app.ts")).toBe(true);
    expect(hasUnsafePayloadPathText("See C:\\Users\\rory\\repo\\src\\app.ts")).toBe(true);
    expect(hasUnsafePayloadPathText("See file:///Users/rory/private/repo/src/app.ts")).toBe(true);
    expect(hasUnsafePayloadPathText(".env.example")).toBe(false);
    expect(hasUnsafePayloadPathText("apps/web/.env.example")).toBe(false);
  });
});
