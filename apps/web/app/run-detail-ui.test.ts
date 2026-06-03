import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DryRunResultSchema,
  type DryRunResult,
  type RiskFinding,
} from "@control-plane/shared";
import type {
  RunDetail,
  RunDetailPr,
  RunDetailValidationResult,
  RunTimelineEvent,
} from "../src/runs/detail";

vi.mock("server-only", () => ({}));
vi.mock("@/src/server/actions", () => ({
  approveRunAction: vi.fn(),
  rejectRunAction: vi.fn(),
  requestRepairAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const expectNoLiveTimelineBehavior = (source: string) => {
  expect(source).not.toMatch(
    /dangerouslySetInnerHTML|EventSource|WebSocket|setInterval|setTimeout|polling|while\s*\(|for\s*\(\s*;\s*;/,
  );
};

const expectNoUnsafeRunUiSource = (
  source: string,
  options: { allowCortexTaskContext?: boolean; allowPrArtifactMetadata?: boolean } = {},
) => {
  const unsafeTerms = [
    "taskPacket",
    "objective",
    ...(options.allowCortexTaskContext === true ? [] : ["acceptanceCriteria"]),
    "contextFilePaths",
    "policySnapshot",
    "validationCommands",
    "changedPaths",
    ...(options.allowPrArtifactMetadata === true ? [] : ["changedFilePaths", "riskFindings"]),
    "codeSnippet",
    "patchText",
    "rawDiff",
    "rawLogs",
    "rawOutput",
    "rawSource",
    "diff",
    "patch",
    "snippet",
    "sourceCode",
    "sourceContent",
    "localPath",
    "credential",
  ];

  const unsafeSourcePattern = new RegExp(
    unsafeTerms.map((term) => `(?:^|[^A-Za-z0-9_])${term}(?:$|[^A-Za-z0-9_])`).join("|"),
    "i",
  );

  expect(source).not.toMatch(unsafeSourcePattern);
};

const packageLockRisk = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
  ...overrides,
});

const createPrArtifact = (overrides: Partial<RunDetailPr> = {}): RunDetailPr => ({
  branchName: "aicp/task-136-add-pr-artifact-display",
  changedFilePaths: ["apps/web/components/pr-artifact.tsx", "apps/web/src/runs/detail.ts"],
  checks: {
    conclusion: "passing",
    failedCount: 0,
    passedCount: 2,
    pendingCount: 0,
    skippedCount: 1,
    totalCount: 3,
  },
  createdAt: new Date("2026-05-23T10:25:00.000Z"),
  githubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
  number: 42,
  repository: {
    name: "control-plane",
    owner: "rory",
  },
  reviewState: "approved",
  riskFlags: [packageLockRisk()],
  status: "open",
  title: "TASK-136: Add PR artifact display",
  url: "https://github.com/rory/control-plane/pull/42",
  ...overrides,
});

const createTimelineEvent = (overrides: Partial<RunTimelineEvent> = {}): RunTimelineEvent => ({
  createdAt: new Date("2026-05-23T10:05:00.000Z"),
  id: "event_1",
  idempotencyKey: "run:run_1:event:worktree_created:1",
  message: "Worktree created.",
  metadata: {
    attempt: 1,
    runnerMode: "local",
  },
  receivedAt: new Date("2026-05-23T10:05:03.000Z"),
  severity: "info",
  state: "worktree_created",
  ...overrides,
});

const createValidationResult = (
  overrides: Partial<RunDetailValidationResult & { command: string }> = {},
): RunDetailValidationResult & { command: string } => ({
  command: "pnpm --filter @control-plane/web test -- --reporter=verbose",
  commandId: "web-tests",
  commandLabel: "Web tests",
  durationMs: 1500,
  exitCode: 0,
  finishedAt: new Date("2026-05-23T10:12:01.500Z"),
  id: "validation_result_1",
  redactionApplied: true,
  startedAt: new Date("2026-05-23T10:12:00.000Z"),
  status: "passed",
  stderrSummary: "No standard error summary.",
  stdoutSummary: "Passed & sanitized <script>alert(1)</script>.",
  ...overrides,
});

const createCapabilities = (runnerId = "runner_1"): DryRunResult["capabilities"] => ({
  contractVersion: CONTRACT_VERSION,
  runnerId,
  os: {
    arch: "arm64",
    platform: "darwin",
    release: "25.0.0",
  },
  shell: "/bin/zsh",
  tools: {
    codex: { available: true, path: "/Users/rory/.local/bin/codex", version: "1.0.0" },
    gh: { available: false },
    git: { available: true, path: "/usr/bin/git", version: "2.50.0" },
    node: { available: true, version: "24.0.0" },
    npm: { available: true, version: "11.0.0" },
    pnpm: { available: true, version: "10.0.0" },
    python: { available: false },
    yarn: { available: false },
  },
  maxConcurrentJobs: 2,
  supportsCancellation: true,
  supportsDryRun: true,
  reportedAt: "2026-05-23T09:59:00.000Z",
});

const createDryRunResult = (overrides: Partial<DryRunResult> = {}): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "dry_run_result_1",
    runId: "run_1",
    status: "warning",
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
    capabilities: createCapabilities(),
    blockers: [],
    warnings: [],
    createdAt: "2026-05-23T09:59:30.000Z",
    ...overrides,
  });

const createRunDetailFixture = (
  overrides: Partial<Omit<RunDetail, "repair">> & { repair?: RunDetail["repair"] } = {},
): RunDetail => {
  const repair = overrides.repair ?? {
    attemptCount: 0,
    canRequestRepair: true,
    disabledReason: null,
    maxAttempts: 3,
    nextAttempt: 1,
    remainingAttempts: 3,
  };

  return {
    cortexTask: null,
    createdAt: new Date("2026-05-23T10:00:00.000Z"),
    dryRunResult: createDryRunResult({
      checks: [
        {
          id: "repo_clean",
          label: "Repo clean",
          status: "passed",
          message: "Repository was clean.",
          metadata: {
            changedFileCount: 0,
            safeCheckCount: 1,
          },
        },
      ],
      warnings: [
        {
          id: "risk:package_lock",
          severity: "warning",
          category: "package_lock",
          message: "Package lock changed.",
          paths: ["pnpm-lock.yaml"],
        },
      ],
    }),
    id: "run_approval_fixture",
    mode: "execute",
    pr: createPrArtifact({
      changedFilePaths: [
        "apps/web/components/pr-artifact.tsx",
        ".env.local",
        "/Users/rory/repos/control-plane/apps/web/secret.ts",
      ],
      riskFlags: [
        packageLockRisk(),
        packageLockRisk({
          id: "risk:raw_diff",
          message: "diff --git a/app.ts b/app.ts",
          paths: ["apps/web/components/pr-artifact.tsx"],
        }),
      ],
    }),
    repoMapping: {
      id: "repo_mapping_1",
      repositoryName: "control-plane",
      repositoryOwner: "rory",
    },
    runner: {
      displayName: "Mac Studio",
      id: "runner_1",
    },
    state: "awaiting_approval",
    task: {
      id: "task_137",
      title: "Verify timeline/artifacts milestone",
    },
    timeline: [
      createTimelineEvent({
        id: "event_approval_fixture",
        idempotencyKey: "run:run_approval_fixture:event:worktree_created:1",
        message: "Worktree created.",
        metadata: {
          attempt: 1,
          apiKey: "OPENAI_API_KEY=sk-proj-unsafe-fixture-value",
          patchText: "@@ -1 +1 @@",
          rawLogs: "raw runner log line",
          sourceCode: "const leaked = process.env.SECRET",
          taskPacket: {
            objective: "Read private source files.",
          },
        },
        state: "worktree_created",
      }),
    ],
    updatedAt: new Date("2026-05-23T10:25:00.000Z"),
    validationResults: [
      createValidationResult({
        command:
          "pnpm --filter @control-plane/web test -- --reporter=verbose /Users/rory/repos/control-plane",
        commandLabel: "Web tests",
        id: "validation_safe_summary",
        stdoutSummary: "Passed 42 tests after redaction.",
      }),
      createValidationResult({
        command: "pnpm run lint -- --debug",
        commandLabel: "Web lint",
        id: "validation_unsafe_summary",
        stdoutSummary: "raw stdout: diff --git a/app.ts b/app.ts",
        stderrSummary: "const leaked = process.env.SECRET",
      }),
    ],
    workspaceId: "workspace_1",
    ...overrides,
    repair,
  };
};

const createCortexTaskContextFixture = (): NonNullable<RunDetail["cortexTask"]> => ({
  acceptanceCriteria: [
    "Run detail shows the originating Cortex Task before technical event details.",
    "Task findings and validation evidence remain metadata-only.",
  ],
  approvalStatus: "approved",
  executionMode: "local_runner",
  findings: [
    {
      category: "validation",
      findingId: "finding_1",
      severity: "medium",
      status: "open",
      summary: "Run detail does not show the originating Cortex Task context.",
      title: "Missing run task context",
    },
    {
      category: "security",
      findingId: "finding_unsafe_hidden",
      severity: "high",
      status: "open",
      summary: "diff --git a/app.ts b/app.ts",
      title: "created at /Users/rory/repos/control-plane",
    },
  ],
  latestRunId: "run_approval_fixture",
  origin: {
    type: "finding",
  },
  prArtifactIds: ["pr_artifact_1"],
  riskLevel: "medium",
  runIds: ["run_approval_fixture", "run_repair_1"],
  status: "pr_opened",
  suggestedValidation: [
    {
      label: "Web typecheck",
      required: true,
      validationId: "web-typecheck",
    },
    {
      label: "Web visual smoke",
      required: false,
      validationId: "web-visual-smoke",
    },
  ],
  taskId: "cortex_task_1",
  title: "Show Cortex Task context on run detail",
});

describe("run detail UI", () => {
  test("ApprovalReviewPanel renders decision controls only when review evidence is complete", async () => {
    const { ApprovalReviewPanel } = await import("../components/approval-review-panel");
    const html = renderToStaticMarkup(
      createElement(ApprovalReviewPanel, {
        runDetail: createRunDetailFixture(),
      }),
    );

    expect(html).toContain("Approval decision");
    expect(html).toContain("Evidence complete");
    expect(html).toContain("Validation evidence");
    expect(html).toContain("PR metadata");
    expect(html).toContain("Changed path metadata");
    expect(html).toContain("Policy and risk evidence");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Request repair");
    expect(html).toContain("Package lock");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="runId"');
    expect(html).toContain('value="run_approval_fixture"');
    expect(html).toContain('name="previousRunId"');
    expect(html).toContain('name="feedback"');
    expect(html).not.toMatch(
      /name="(?:taskPacket|objective|acceptanceCriteria|validationCommands|diff|patch|sourceCode|rawOutput|changedFilePaths|riskFindings|localPath|decision)"/i,
    );
  });

  test("ApprovalReviewPanel accepts repaired run evidence from PR risk metadata without dry-run results", async () => {
    const { ApprovalReviewPanel } = await import("../components/approval-review-panel");
    const html = renderToStaticMarkup(
      createElement(ApprovalReviewPanel, {
        runDetail: createRunDetailFixture({
          dryRunResult: null,
          mode: "repair",
          pr: createPrArtifact({
            changedFilePaths: ["apps/web/components/approval-review-panel.tsx"],
            riskFlags: [packageLockRisk()],
          }),
        }),
      }),
    );

    expect(html).toContain("Evidence complete");
    expect(html).toContain("Policy and risk evidence");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Request repair");
    expect(html).toContain('name="runId"');
    expect(html).not.toContain("Review evidence incomplete");
    expect(html).not.toContain("Missing policy and risk evidence");
  });

  test("ApprovalReviewPanel blocks decision controls when validation, PR, paths, or risk evidence is missing", async () => {
    const { ApprovalReviewPanel } = await import("../components/approval-review-panel");
    const html = renderToStaticMarkup(
      createElement(ApprovalReviewPanel, {
        runDetail: createRunDetailFixture({
          dryRunResult: null,
          pr: createPrArtifact({ changedFilePaths: [] }),
          validationResults: [],
        }),
      }),
    );

    expect(html).toContain("Review evidence incomplete");
    expect(html).toContain("Decision controls stay unavailable until the runner has submitted");
    expect(html).toContain("Missing validation evidence");
    expect(html).toContain("Missing changed path metadata");
    expect(html).toContain("Missing policy and risk evidence");
    expect(html).not.toContain("Evidence complete");
    expect(html).not.toContain('name="runId"');
    expect(html).not.toContain('name="feedback"');
  });

  test("ApprovalReviewPanel keeps controls unavailable for non-reviewable run states", async () => {
    const { ApprovalReviewPanel } = await import("../components/approval-review-panel");
    const html = renderToStaticMarkup(
      createElement(ApprovalReviewPanel, {
        runDetail: createRunDetailFixture({
          state: "completed",
        }),
      }),
    );

    expect(html).toContain("Run is not awaiting approval");
    expect(html).toContain("Decision controls stay unavailable");
    expect(html).not.toContain("Evidence complete");
    expect(html).not.toContain('name="runId"');
    expect(html).not.toContain('name="feedback"');
  });

  test("run detail approval fixture renders summary, timeline, dry-run, validation, and PR artifact without unsafe material", async () => {
    const { DryRunResultDisplay } = await import("../components/dry-run-result");
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const { RunTimeline } = await import("../components/run-timeline");
    const { ValidationResultDisplay } = await import("../components/validation-result");
    const runDetail = createRunDetailFixture();
    const html = renderToStaticMarkup(
      createElement(
        "main",
        null,
        createElement(
          "section",
          { "aria-labelledby": "run-summary" },
          createElement("p", null, "Summary"),
          createElement("h2", { id: "run-summary" }, "Run metadata"),
          createElement("dl", null, [
            createElement("dt", { key: "task-label" }, "Task"),
            createElement("dd", { key: "task-title" }, runDetail.task.title),
            createElement("dd", { key: "task-id" }, runDetail.task.id),
          ]),
        ),
        createElement(DryRunResultDisplay, { result: runDetail.dryRunResult }),
        createElement(ValidationResultDisplay, { results: runDetail.validationResults }),
        createElement(PrArtifactDisplay, { artifact: runDetail.pr }),
        createElement(RunTimeline, { events: runDetail.timeline }),
      ),
    );

    expect(html).toContain("Run metadata");
    expect(html).toContain("Verify timeline/artifacts milestone");
    expect(html).toContain("task_137");
    expect(html).toContain("Append-only run events");
    expect(html).toContain("Worktree created.");
    expect(html).toContain("Dry run result");
    expect(html).toContain("Readiness checks");
    expect(html).toContain("Repo clean");
    expect(html).toContain("Validation results");
    expect(html).toContain("Web tests");
    expect(html).toContain("Passed 42 tests after redaction.");
    expect(html).toContain("Pull request");
    expect(html).toContain("TASK-136: Add PR artifact display");
    expect(html).toContain("Review");
    expect(html).toContain("Approved");
    expect(html).toContain("Checks");
    expect(html).toContain("Checks passing");
    expect(html).toContain("2 passed");
    expect(html).toContain("1 skipped");
    expect(html).toContain("Last GitHub sync");
    expect(html).toContain("May 24, 2026");
    expect(html).toContain("Changed files");
    expect(html).toContain("apps/web/components/pr-artifact.tsx");
    expect(html).toContain("Risk flags");
    expect(html).toContain("Package lock changed.");

    for (const unsafeText of [
      "pnpm --filter @control-plane/web test -- --reporter=verbose",
      "pnpm run lint -- --debug",
      "raw runner log line",
      "raw stdout",
      "diff --git a/app.ts b/app.ts",
      "@@ -1 +1 @@",
      "const leaked = process.env.SECRET",
      "OPENAI_API_KEY=sk-proj-unsafe-fixture-value",
      ".env.local",
      "/Users/rory/repos/control-plane",
      "taskPacket",
      "sourceCode",
      "patchText",
      "rawLogs",
      "apiKey",
      "repoPath",
      "command",
    ]) {
      expect(html).not.toContain(unsafeText);
    }
  });

  test("RunCortexTaskContextPanel renders task context, findings, validation, and PR evidence without unsafe material", async () => {
    const { RunCortexTaskContextPanel } = await import("../components/run-cortex-task-context");
    const runDetail = createRunDetailFixture({
      cortexTask: createCortexTaskContextFixture(),
    });
    const html = renderToStaticMarkup(
      createElement(RunCortexTaskContextPanel, {
        context: runDetail.cortexTask,
        pr: runDetail.pr,
        validationResults: runDetail.validationResults,
      }),
    );

    expect(html).toContain("Cortex Task context");
    expect(html).toContain("Show Cortex Task context on run detail");
    expect(html).toContain("cortex_task_1");
    expect(html).toContain("Medium risk");
    expect(html).toContain("Local runner");
    expect(html).toContain("PR opened");
    expect(html).toContain("Approval approved");
    expect(html).toContain(
      "Run detail shows the originating Cortex Task before technical event details.",
    );
    expect(html).toContain("Missing run task context");
    expect(html).toContain("Validation");
    expect(html).toContain("Medium");
    expect(html).toContain("Open");
    expect(html).toContain("Web typecheck");
    expect(html).toContain("Required");
    expect(html).toContain("Web visual smoke");
    expect(html).toContain("Optional");
    expect(html).toContain("Pull request #42");
    expect(html).toContain("Checks passing");
    expect(html).toContain("Validation evidence");
    expect(html).toContain("Web tests");
    expect(html).toContain("Passed");

    for (const unsafeText of [
      "diff --git a/app.ts b/app.ts",
      "/Users/rory/repos/control-plane",
      "pnpm --filter @control-plane/web test -- --reporter=verbose",
      "raw runner log line",
      "const leaked = process.env.SECRET",
      "objective",
      "taskPacket",
      "sourceCode",
      "patchText",
      "rawLogs",
    ]) {
      expect(html).not.toContain(unsafeText);
    }
  });

  test("RunCortexTaskContextPanel renders no markup when the run has no Cortex Task context", async () => {
    const { RunCortexTaskContextPanel } = await import("../components/run-cortex-task-context");
    const html = renderToStaticMarkup(
      createElement(RunCortexTaskContextPanel, {
        context: null,
        pr: null,
        validationResults: [],
      }),
    );

    expect(html).toBe("");
  });

  test("PrArtifactDisplay renders PR title, number, status, branch, and safe external link", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, { artifact: createPrArtifact() }),
    );

    expect(html).toContain("Pull request");
    expect(html).toContain("TASK-136: Add PR artifact display");
    expect(html).toContain("#42");
    expect(html).toContain("Open");
    expect(html).toContain("May 23, 2026");
    expect(html).toContain("Last GitHub sync");
    expect(html).toContain("Checks passing");
    expect(html).toContain("aicp/task-136-add-pr-artifact-display");
    expect(html).toContain('href="https://github.com/rory/control-plane/pull/42"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  test("PrArtifactDisplay renders changed file paths and risk flags", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, { artifact: createPrArtifact() }),
    );

    expect(html).toContain("Changed files");
    expect(html).toContain("apps/web/components/pr-artifact.tsx");
    expect(html).toContain("apps/web/src/runs/detail.ts");
    expect(html).toContain("Risk flags");
    expect(html).toContain("Package lock");
    expect(html).toContain("Warning");
    expect(html).toContain("Package lock changed.");
    expect(html).toContain("pnpm-lock.yaml");
  });

  test("PrArtifactDisplay renders unknown GitHub tracking states when not synced", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, {
        artifact: createPrArtifact({
          checks: {
            conclusion: "unknown",
            failedCount: 0,
            passedCount: 0,
            pendingCount: 0,
            skippedCount: 0,
            totalCount: 0,
          },
          githubSyncedAt: null,
          reviewState: "unknown",
        }),
      }),
    );

    expect(html).toContain("Review unknown");
    expect(html).toContain("Checks unknown");
    expect(html).toContain("Not synced from GitHub yet.");
  });

  test("PrArtifactDisplay handles missing and unsafe links without rendering an outbound anchor", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const missingLinkHtml = renderToStaticMarkup(
      createElement(PrArtifactDisplay, { artifact: createPrArtifact({ url: null }) }),
    );

    expect(missingLinkHtml).toContain("Link unavailable");
    expect(missingLinkHtml).not.toContain('target="_blank"');
    expect(missingLinkHtml).not.toContain('rel="noreferrer"');
  });

  test.each([
    {
      leakedText: "token@example.com",
      url: "https://token@example.com/rory/control-plane/pull/42",
    },
    {
      leakedText: "token=hunter2",
      url: "https://github.com/rory/control-plane/pull/42?token=hunter2",
    },
    {
      leakedText: "access_token=hunter2",
      url: "https://github.com/rory/control-plane/pull/42?access_token=hunter2",
    },
  ])("PrArtifactDisplay hides unsafe PR URL: $url", async ({ leakedText, url }) => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, {
        artifact: createPrArtifact({ url }),
      }),
    );

    expect(html).toContain("Link unavailable");
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('rel="noreferrer"');
    expect(html).not.toContain(leakedText);
  });

  test("PrArtifactDisplay renders a calm empty state when no PR artifact exists", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(createElement(PrArtifactDisplay, { artifact: null }));

    expect(html).toContain("No PR artifact yet.");
    expect(html).toContain("The PR link and metadata will appear after the runner opens a PR.");
  });

  test("PrArtifactDisplay escapes HTML-like artifact strings and avoids raw HTML rendering", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, {
        artifact: createPrArtifact({
          branchName: "aicp/<script>alert(1)</script>",
          changedFilePaths: ['apps/web/<img src=x onerror="alert(1)">.tsx'],
          riskFlags: [
            packageLockRisk({
              message: "<script>alert(1)</script>",
              paths: ['apps/web/<img src=x onerror="alert(1)">.tsx'],
            }),
          ],
          title: "<script>alert(1)</script>",
        }),
      }),
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });

  test("PrArtifactDisplay filters unsafe artifact text before rendering", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, {
        artifact: createPrArtifact({
          branchName: "src/index.ts\nexport const leakedValue = true;",
          changedFilePaths: [
            "apps/web/components/pr-artifact.tsx",
            ".env.local",
            "/Users/rory/repos/control-plane/apps/web/secret.ts",
            "src/index.ts\nexport const leakedValue = true;",
          ],
          riskFlags: [
            packageLockRisk({
              id: "risk:unsafe_message",
              message: "diff --git a/app.ts b/app.ts",
              paths: ["apps/web/components/pr-artifact.tsx"],
            }),
            packageLockRisk({
              id: "risk:unsafe_path",
              message: "Package lock changed.",
              paths: ["/Users/rory/repos/control-plane/apps/web/secret.ts"],
            }),
            packageLockRisk(),
          ],
          title: "const leaked = process.env.SECRET;",
          url: "javascript:alert(1)",
        }),
      }),
    );

    expect(html).toContain("Pull request #42");
    expect(html).toContain("Branch unavailable");
    expect(html).toContain("apps/web/components/pr-artifact.tsx");
    expect(html).toContain("Package lock changed.");
    expect(html).toContain("pnpm-lock.yaml");
    expect(html).toContain("Link unavailable");
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("diff --git a/app.ts b/app.ts");
    expect(html).not.toContain("export const leakedValue = true");
    expect(html).not.toContain("const leaked = process.env.SECRET");
    expect(html).not.toContain(".env.local");
    expect(html).not.toContain("/Users/rory/repos/control-plane");
  });

  test("PrArtifactDisplay filters local paths embedded in artifact text fields", async () => {
    const { PrArtifactDisplay } = await import("../components/pr-artifact");
    const html = renderToStaticMarkup(
      createElement(PrArtifactDisplay, {
        artifact: createPrArtifact({
          branchName: "created at C:\\Users\\rory\\repos\\control-plane",
          riskFlags: [
            packageLockRisk(),
            packageLockRisk({
              id: "risk:unsafe_local_path_message",
              message: "created at \\\\build-server\\checkout\\control-plane",
            }),
          ],
          title: "created at /Users/rory/repos/control-plane",
        }),
      }),
    );

    expect(html).toContain("Pull request #42");
    expect(html).toContain("Branch unavailable");
    expect(html).toContain("Package lock changed.");
    expect(html).not.toContain("/Users/rory/repos/control-plane");
    expect(html).not.toContain("C:\\Users\\rory\\repos\\control-plane");
    expect(html).not.toContain("\\\\build-server\\checkout\\control-plane");
  });

  test("DryRunResultDisplay renders an empty state when no result exists", async () => {
    const { DryRunResultDisplay } = await import("../components/dry-run-result");
    const html = renderToStaticMarkup(createElement(DryRunResultDisplay, { result: null }));

    expect(html).toContain("Dry run result");
    expect(html).toContain("No dry-run result has been submitted.");
    expect(html).toContain("Readiness checks will appear here after the runner reports them.");
  });

  test.each([
    ["passed", "Passed"],
    ["warning", "Warning"],
    ["failed", "Failed"],
  ] satisfies Array<[DryRunResult["status"], string]>)(
    "DryRunResultDisplay renders the overall %s state",
    async (status, label) => {
      const { DryRunResultDisplay } = await import("../components/dry-run-result");
      const html = renderToStaticMarkup(
        createElement(DryRunResultDisplay, {
          result: createDryRunResult({ status }),
        }),
      );

      expect(html).toContain("Overall status");
      expect(html).toContain(label);
      expect(html).toContain("May 23, 2026");
    },
  );

  test("DryRunResultDisplay renders all readiness check row statuses with safe metadata", async () => {
    const { DryRunResultDisplay } = await import("../components/dry-run-result");
    const html = renderToStaticMarkup(
      createElement(DryRunResultDisplay, {
        result: createDryRunResult({
          checks: [
            {
              id: "repo_clean",
              label: "Repo clean",
              status: "passed",
              message: "Repository was clean.",
              metadata: { changedFileCount: 0 },
            },
            {
              id: "required_tools_available",
              label: "Required tools available",
              status: "warning",
              message: "Optional tool is not available.",
              metadata: { optionalToolCount: 1 },
            },
            {
              id: "repo_policy_exists_and_parses",
              label: "Repo policy parses",
              status: "failed",
              message: "Policy could not be parsed.",
              metadata: { reason: "schema_error" },
            },
            {
              id: "worktree_path_available",
              label: "Worktree path available",
              status: "skipped",
              message: "Skipped after policy failure.",
              metadata: { skippedAfter: "repo_policy_exists_and_parses" },
            },
          ],
        }),
      }),
    );

    expect(html).toContain("Readiness checks");
    expect(html).toContain("Repo clean");
    expect(html).toContain("Passed");
    expect(html).toContain("Required tools available");
    expect(html).toContain("Warning");
    expect(html).toContain("Repo policy parses");
    expect(html).toContain("Failed");
    expect(html).toContain("Worktree path available");
    expect(html).toContain("Skipped");
    expect(html).toContain("changedFileCount");
    expect(html).toContain("0");
    expect(html).toContain("schema_error");
  });

  test("DryRunResultDisplay distinguishes blockers from warnings", async () => {
    const { DryRunResultDisplay } = await import("../components/dry-run-result");
    const html = renderToStaticMarkup(
      createElement(DryRunResultDisplay, {
        result: createDryRunResult({
          blockers: [
            {
              id: "risk:dirty_repo",
              severity: "blocked",
              category: "dirty_repo",
              message: "Repository has uncommitted changes.",
              paths: ["apps/web/package.json"],
            },
          ],
          warnings: [
            {
              id: "risk:package_lock",
              severity: "warning",
              category: "package_lock",
              message: "Package lock changed.",
              paths: ["pnpm-lock.yaml"],
            },
          ],
        }),
      }),
    );

    expect(html).toContain("Blockers");
    expect(html).toContain("Repository has uncommitted changes.");
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain("Warnings");
    expect(html).toContain("Package lock changed.");
    expect(html).toContain('data-variant="outline"');
  });

  test("DryRunResultDisplay renders capability metadata without tool paths or controls", async () => {
    const { DryRunResultDisplay } = await import("../components/dry-run-result");
    const html = renderToStaticMarkup(
      createElement(DryRunResultDisplay, {
        result: createDryRunResult(),
      }),
    );

    expect(html).toContain("Runner capabilities");
    expect(html).toContain("darwin");
    expect(html).toContain("arm64");
    expect(html).toContain("Max concurrent jobs");
    expect(html).toContain("Dry-run support");
    expect(html).toContain("Cancellation support");
    expect(html).toContain("zsh");
    expect(html).toContain("codex");
    expect(html).toContain("git");
    expect(html).toContain("Available");
    expect(html).toContain("Unavailable");
    expect(html).toContain("1.0.0");
    expect(html).not.toContain("/bin/zsh");
    expect(html).not.toContain("/Users/rory/.local/bin/codex");
    expect(html).not.toContain("/usr/bin/git");
    expect(html).not.toMatch(/configure|settings|enable|disable|install|path/i);
  });

  test("DryRunResultDisplay escapes messages and omits unsafe metadata", async () => {
    const { DryRunResultDisplay } = await import("../components/dry-run-result");
    const html = renderToStaticMarkup(
      createElement(DryRunResultDisplay, {
        result: createDryRunResult({
          checks: [
            {
              id: "repo_clean",
              label: "Repo clean",
              status: "warning",
              message: "<script>alert(1)</script>",
              metadata: {
                safeNote: '<img src=x onerror="alert(1)">',
                repoPath: "/Users/rory/repos/control-plane",
                nested: {
                  checkoutRoot: "/Users/rory/repos/control-plane/apps/web",
                  command: "pnpm test -- --reporter=verbose",
                  rawLog: "raw runner log line",
                  summary: "metadata kept",
                },
              },
            },
          ],
        }),
      }),
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("metadata kept");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(
      /repoPath|checkoutRoot|command|rawLog|raw runner log line|pnpm test -- --reporter=verbose|\/Users\/rory\/repos\/control-plane/i,
    );
  });

  test("RunTimeline renders state, severity, message, timestamp, and metadata", async () => {
    const { RunTimeline } = await import("../components/run-timeline");
    const html = renderToStaticMarkup(
      createElement(RunTimeline, {
        events: [
          createTimelineEvent({
            message: "Validation warning recorded.",
            metadata: {
              attempt: 2,
              commandId: "unit-tests",
            },
            severity: "warning",
            state: "validation_running",
          }),
        ],
      }),
    );

    expect(html).toContain("Timeline");
    expect(html).toContain("Validation running");
    expect(html).toContain("Warning");
    expect(html).toContain("Validation warning recorded.");
    expect(html).toContain("May 23, 2026");
    expect(html).toContain("Event time");
    expect(html).toContain("Received");
    expect(html).toContain("attempt");
    expect(html).toContain("2");
    expect(html).toContain("commandId");
    expect(html).toContain("unit-tests");
  });

  test("RunTimeline renders a calm empty state", async () => {
    const { RunTimeline } = await import("../components/run-timeline");
    const html = renderToStaticMarkup(createElement(RunTimeline, { events: [] }));

    expect(html).toContain("No timeline events yet.");
    expect(html).toContain("Runner events will appear here after they are received.");
  });

  test("RunTimeline orders events and collapses duplicate idempotency keys", async () => {
    const { RunTimeline } = await import("../components/run-timeline");
    const html = renderToStaticMarkup(
      createElement(RunTimeline, {
        events: [
          createTimelineEvent({
            createdAt: new Date("2026-05-23T10:06:00.000Z"),
            id: "event_later",
            idempotencyKey: "run:run_1:event:validation:1",
            message: "Validation started after claim.",
            receivedAt: new Date("2026-05-23T10:06:01.000Z"),
            state: "validation_running",
          }),
          createTimelineEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_claim_retry",
            idempotencyKey: "run:run_1:event:claimed:1",
            message: "Duplicate retry should be hidden.",
            receivedAt: new Date("2026-05-23T10:05:03.000Z"),
            state: "claimed",
          }),
          createTimelineEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_claim_original",
            idempotencyKey: "run:run_1:event:claimed:1",
            message: "Original claim is visible.",
            receivedAt: new Date("2026-05-23T10:05:01.000Z"),
            state: "claimed",
          }),
        ],
      }),
    );

    expect(html.indexOf("Original claim is visible.")).toBeLessThan(
      html.indexOf("Validation started after claim."),
    );
    expect(html).not.toContain("Duplicate retry should be hidden.");
  });

  test("RunTimeline labels cancellation states", async () => {
    const { RunTimeline } = await import("../components/run-timeline");
    const html = renderToStaticMarkup(
      createElement(RunTimeline, {
        events: [
          createTimelineEvent({
            id: "event_cancel_requested",
            idempotencyKey: "run:run_1:event:cancel_requested:1",
            message: "Cancellation has been requested.",
            state: "cancel_requested",
          }),
          createTimelineEvent({
            id: "event_cancelling",
            idempotencyKey: "run:run_1:event:cancelling:1",
            message: "Runner is stopping at the next boundary.",
            state: "cancelling",
          }),
          createTimelineEvent({
            id: "event_cancelled",
            idempotencyKey: "run:run_1:event:cancelled:1",
            message: "Run cancellation is complete.",
            state: "cancelled",
          }),
        ],
      }),
    );

    expect(html).toContain("Cancel requested");
    expect(html).toContain("Cancelling");
    expect(html).toContain("Cancelled");
  });

  test("RunTimeline escapes runner messages and metadata instead of rendering HTML", async () => {
    const { RunTimeline } = await import("../components/run-timeline");
    const html = renderToStaticMarkup(
      createElement(RunTimeline, {
        events: [
          createTimelineEvent({
            message: "<script>alert(1)</script>",
            metadata: {
              imageProbe: '<img src=x onerror="alert(1)">',
              runnerMessage: "<script>alert(1)</script>",
            },
          }),
        ],
      }),
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });

  test("RunTimeline omits unsafe metadata fields", async () => {
    const { RunTimeline } = await import("../components/run-timeline");
    const html = renderToStaticMarkup(
      createElement(RunTimeline, {
        events: [
          createTimelineEvent({
            metadata: {
              attempt: 1,
              apiKey: "api key variant",
              command: "pnpm test -- --reporter=verbose",
              commandText: "pnpm test -- --reporter=verbose",
              codeSnippet: "code snippet variant",
              diff: "diff --git a/app.ts b/app.ts",
              fileContent: "file content variant",
              repoPath: "/Users/rory/repos/control-plane",
              worktreePath: "/Users/rory/.codex-runner-worktrees/run_1",
              checkoutRoot: "/Users/rory/repos/control-plane/apps/web",
              statusNote: "created at /Users/rory/repos/control-plane/apps/web",
              nested: {
                patch: "@@ -1 +1 @@",
                patchText: "patch text variant",
                private_key: "private key variant",
                rawDiff: "raw diff variant",
                rawLog: "raw log variant",
                rawLogs: "raw runner log line",
                rawSource: "raw source variant",
                sourceCode: "const leaked = process.env.SECRET",
                sourceContent: "source content variant",
              },
              rawOutput: "raw runner log line",
              taskPacket: { objective: "Read private source files" },
            },
          }),
        ],
      }),
    );

    expect(html).toContain("attempt");
    expect(html).toContain("1");
    expect(html).not.toMatch(
      /diff|patch|sourceCode|sourceContent|rawOutput|rawLogs|rawLog|rawSource|taskPacket|objective|codeSnippet|fileContent|repoPath|worktreePath|checkoutRoot|private_key|apiKey|diff --git|@@ -1 \+1 @@|raw runner log line|raw diff variant|raw log variant|patch text variant|raw source variant|source content variant|code snippet variant|file content variant|private key variant|api key variant|const leaked = process\.env\.SECRET|\/Users\/rory\/repos\/control-plane|\/Users\/rory\/\.codex-runner-worktrees\/run_1/i,
    );
    expect(html).not.toContain("pnpm test -- --reporter=verbose");
  });

  test("ValidationResultDisplay renders validation statuses and redacted summaries", async () => {
    const { ValidationResultDisplay } = await import("../components/validation-result");
    const html = renderToStaticMarkup(
      createElement(ValidationResultDisplay, {
        results: [
          createValidationResult({
            commandLabel: "Web tests",
            durationMs: 950,
            exitCode: 0,
            id: "validation_passed",
            status: "passed",
            stdoutSummary: "Passed & sanitized <script>alert(1)</script>.",
          }),
          createValidationResult({
            command: "pnpm --filter @control-plane/web typecheck --pretty false",
            commandLabel: "Web typecheck",
            durationMs: 1510,
            exitCode: 1,
            id: "validation_failed",
            status: "failed",
            stderrSummary: "Type check failed after redaction.",
            stdoutSummary: "Checked project references.",
          }),
          createValidationResult({
            command: "pnpm run lint -- --debug",
            commandLabel: "Web lint",
            durationMs: 0,
            exitCode: null,
            id: "validation_skipped",
            status: "skipped",
            stdoutSummary: "Skipped after prior blocker.",
          }),
          createValidationResult({
            command: "pnpm exec vitest --run",
            commandLabel: "Web vitest",
            durationMs: 2250,
            exitCode: null,
            id: "validation_cancelled",
            status: "cancelled",
            stderrSummary: "Cancelled before standard error output.",
            stdoutSummary: "Cancelled at validation boundary.",
          }),
        ],
      }),
    );

    expect(html).toContain("Validation results");
    expect(html).toContain("Web tests");
    expect(html).toContain("Web typecheck");
    expect(html).toContain("Web lint");
    expect(html).toContain("Web vitest");
    expect(html).toContain("Passed");
    expect(html).toContain("Failed");
    expect(html).toContain("Skipped");
    expect(html).toContain("Cancelled");
    expect(html).toContain("Exit code: 0");
    expect(html).toContain("Exit code: 1");
    expect(html).toContain("Exit code: none");
    expect(html).toContain("Duration: 950 ms");
    expect(html).toContain("Duration: 1.5 s");
    expect(html).toContain("Duration: 2.3 s");
    expect(html).toContain("Redaction confirmed");
    expect(html).toContain("Output summary");
    expect(html).toContain("Error summary");
    expect(html).toContain("Passed &amp; sanitized &lt;script&gt;alert(1)&lt;/script&gt;.");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("ValidationResultDisplay hides summaries when redaction is not confirmed", async () => {
    const { ValidationResultDisplay } = await import("../components/validation-result");
    const html = renderToStaticMarkup(
      createElement(ValidationResultDisplay, {
        results: [
          createValidationResult({
            command:
              "pnpm --filter @control-plane/web test -- --reporter=verbose /Users/rory/repos/control-plane",
            redactionApplied: false,
            stderrSummary: "raw stderr: diff --git a/app.ts b/app.ts",
            stdoutSummary:
              "raw stdout: @@ -1 +1 @@ const leaked = process.env.SECRET from /Users/rory/repos/control-plane/src/private.ts",
          }),
        ],
      }),
    );

    expect(html).toContain("Summaries hidden; redaction not confirmed.");
    expect(html).not.toContain("raw stdout");
    expect(html).not.toContain("raw stderr");
    expect(html).not.toContain("diff --git a/app.ts b/app.ts");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("const leaked = process.env.SECRET");
    expect(html).not.toContain("/Users/rory/repos/control-plane");
    expect(html).not.toContain("pnpm --filter @control-plane/web test");
  });

  test("ValidationResultDisplay renders an empty state", async () => {
    const { ValidationResultDisplay } = await import("../components/validation-result");
    const html = renderToStaticMarkup(createElement(ValidationResultDisplay, { results: [] }));

    expect(html).toContain("No validation results submitted yet.");
  });

  test("component and detail page sources stay server-rendered with no live streaming or polling", async () => {
    await expectFile("../components/run-timeline.tsx");
    await expectFile("../components/validation-result.tsx");
    await expectFile("../components/dry-run-result.tsx");
    await expectFile("../components/pr-artifact.tsx");
    await expectFile("../components/run-cortex-task-context.tsx");
    await expectFile("./(app)/dashboard/runs/[runId]/page.tsx");

    const componentSource = await readAppFile("../components/run-timeline.tsx");
    const validationResultSource = await readAppFile("../components/validation-result.tsx");
    const dryRunSource = await readAppFile("../components/dry-run-result.tsx");
    const prArtifactSource = await readAppFile("../components/pr-artifact.tsx");
    const taskContextSource = await readAppFile("../components/run-cortex-task-context.tsx");
    const pageSource = await readAppFile("./(app)/dashboard/runs/[runId]/page.tsx");

    expect(componentSource.trimStart()).not.toMatch(/^"use client";/);
    expect(dryRunSource.trimStart()).not.toMatch(/^"use client";/);
    expect(componentSource).toContain("RunTimelineEvent");
    expect(componentSource).toContain('from "@/src/runs/detail";');
    expect(componentSource).toContain('import { Badge } from "@/components/ui/badge";');
    expect(componentSource).toContain("metadataEntries");
    expect(componentSource).toContain("event.createdAt");
    expect(componentSource).toContain("event.receivedAt");
    expect(componentSource).toContain("key={event.idempotencyKey}");
    expect(validationResultSource.trimStart()).not.toMatch(/^"use client";/);
    expect(validationResultSource).toContain("RunDetailValidationResult");
    expect(validationResultSource).toContain('from "@/src/runs/detail";');
    expect(validationResultSource).toContain('import { Badge } from "@/components/ui/badge";');
    expect(validationResultSource).toContain("result.commandLabel");
    expect(validationResultSource).not.toMatch(/result\.command(?!Label|Id)/);
    expectNoLiveTimelineBehavior(componentSource);
    expectNoLiveTimelineBehavior(validationResultSource);
    expect(dryRunSource).toContain("DryRunResultDisplay");
    expect(dryRunSource).toContain("DryRunResult");
    expect(dryRunSource).toContain('import { Badge } from "@/components/ui/badge";');
    expect(dryRunSource).toContain('from "@/components/ui/table";');
    expect(dryRunSource).not.toContain("JSON.stringify");
    expectNoLiveTimelineBehavior(dryRunSource);
    expect(prArtifactSource.trimStart()).not.toMatch(/^"use client";/);
    expect(prArtifactSource).toContain("RunDetailPr");
    expect(prArtifactSource).toContain('import { Badge } from "@/components/ui/badge";');
    expect(prArtifactSource).toContain('import { Button } from "@/components/ui/button";');
    expect(prArtifactSource).toContain("GitPullRequest");
    expect(prArtifactSource).toContain("GitBranch");
    expect(prArtifactSource).toContain("ExternalLink");
    expect(prArtifactSource).toContain("FileText");
    expect(prArtifactSource).toContain("ShieldAlert");
    expect(prArtifactSource).not.toContain("dangerouslySetInnerHTML");
    expectNoLiveTimelineBehavior(prArtifactSource);
    expect(taskContextSource.trimStart()).not.toMatch(/^"use client";/);
    expect(taskContextSource).toContain("RunCortexTaskContextPanel");
    expect(taskContextSource).toContain("RunDetail");
    expect(taskContextSource).toContain('import { Badge } from "@/components/ui/badge";');
    expect(taskContextSource).toContain("context.acceptanceCriteria");
    expect(taskContextSource).toContain("validationResults");
    expect(taskContextSource).toContain("pr");
    expect(taskContextSource).not.toContain("objective");
    expect(taskContextSource).not.toMatch(/command(?!Label|Id)/);
    expectNoLiveTimelineBehavior(taskContextSource);
    expectNoUnsafeRunUiSource(taskContextSource, { allowCortexTaskContext: true });
    expectNoLiveTimelineBehavior(pageSource);
    expectNoUnsafeRunUiSource(prArtifactSource, { allowPrArtifactMetadata: true });
    expectNoUnsafeRunUiSource(pageSource, {
      allowCortexTaskContext: true,
      allowPrArtifactMetadata: true,
    });
  });

  test("CancelRunButton source submits a required bounded reason to the server action", async () => {
    await expectFile("../components/cancel-run-button.tsx");

    const source = await readAppFile("../components/cancel-run-button.tsx");

    expect(source.trimStart()).toMatch(/^"use client";/);
    expect(source).toContain('import { useRouter } from "next/navigation";');
    expect(source).toContain("cancelRunAction");
    expect(source).toContain('from "@/src/server/actions";');
    expect(source).toContain("Dialog");
    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogTrigger");
    expect(source).toContain("Button");
    expect(source).toContain("Textarea");
    expect(source).toContain("Field");
    expect(source).toContain("FieldError");
    expect(source).toMatch(/new FormData\(event\.currentTarget\)/);
    expect(source).toMatch(/await cancelRunAction\(formData\)/);
    expect(source).toContain("router.refresh()");
    expect(source).toContain("setOpen(false)");
    expect(source).toMatch(/name="workspaceId"[\s\S]*type="hidden"[\s\S]*value={workspaceId}/);
    expect(source).toMatch(/name="runId"[\s\S]*type="hidden"[\s\S]*value={runId}/);
    expect(source).toMatch(/<Textarea[\s\S]*id="reason"[\s\S]*maxLength=\{500\}/);
    expect(source).toMatch(/<Textarea[\s\S]*name="reason"[\s\S]*required/);
    expect(source).not.toMatch(/state\.data|cancellationRequestedAt|cancellationRequestedBy/i);
    expectNoLiveTimelineBehavior(source);
    expectNoUnsafeRunUiSource(source);
  });

  test("RequestRepairDialog source submits bounded metadata-only repair feedback", async () => {
    await expectFile("../components/request-repair-dialog.tsx");

    const source = await readAppFile("../components/request-repair-dialog.tsx");

    expect(source.trimStart()).toMatch(/^"use client";/);
    expect(source).toContain('import { useRouter } from "next/navigation";');
    expect(source).toContain("requestRepairAction");
    expect(source).toContain('from "@/src/server/actions";');
    expect(source).toContain("Dialog");
    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogTrigger");
    expect(source).toContain("Button");
    expect(source).toContain("Textarea");
    expect(source).toContain("Field");
    expect(source).toContain("FieldDescription");
    expect(source).toContain("FieldError");
    expect(source).toMatch(/new FormData\(event\.currentTarget\)/);
    expect(source).toMatch(/await requestRepairAction\(formData\)/);
    expect(source).toContain("router.refresh()");
    expect(source).toContain("setOpen(false)");
    expect(source).toMatch(/name="workspaceId"[\s\S]*type="hidden"[\s\S]*value={workspaceId}/);
    expect(source).toMatch(/name="previousRunId"[\s\S]*type="hidden"[\s\S]*value={previousRunId}/);
    expect(source).toMatch(/<Textarea[\s\S]*id="feedback"[\s\S]*name="feedback"/);
    expect(source).toMatch(/<Textarea[\s\S]*maxLength={REQUEST_REPAIR_FEEDBACK_MAX_LENGTH}/);
    expect(source).toMatch(/<Textarea[\s\S]*required/);
    expect(source).toContain("Repair attempts: {attemptCount} / {maxAttempts}");
    expect(source).toContain("Queue repair attempt {nextAttempt} of {maxAttempts}.");
    expect(source).toContain(
      "Do not paste secrets, source code, diffs, patches, or command output.",
    );
    expect(source).toMatch(/disabled={isPending \|\| disabled}/);
    expect(source).not.toMatch(/chat|conversation|thread|messageHistory|setInterval/i);
    expect(source).not.toMatch(/actorId|requestedBy|rawOutput|rawLog|taskPacket/i);
    expectNoLiveTimelineBehavior(source);
    expectNoUnsafeRunUiSource(source);
  });

  test("ApprovalActions source submits only scoped ids and a required bounded reason", async () => {
    await expectFile("../components/approval-actions.tsx");

    const source = await readAppFile("../components/approval-actions.tsx");

    expect(source.trimStart()).toMatch(/^"use client";/);
    expect(source).toContain('import { useRouter } from "next/navigation";');
    expect(source).toContain("approveRunAction");
    expect(source).toContain("rejectRunAction");
    expect(source).toContain('from "@/src/server/actions";');
    expect(source).toContain("Dialog");
    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogTrigger");
    expect(source).toContain("Button");
    expect(source).toContain("Textarea");
    expect(source).toContain("Field");
    expect(source).toContain("FieldError");
    expect(source).toMatch(/new FormData\(event\.currentTarget\)/);
    expect(source).toMatch(/await approveRunAction\(formData\)/);
    expect(source).toMatch(/await rejectRunAction\(formData\)/);
    expect(source).toContain("router.refresh()");
    expect(source).toContain("setOpenAction(null)");
    expect(source).toMatch(/name="workspaceId"[\s\S]*type="hidden"[\s\S]*value={workspaceId}/);
    expect(source).toMatch(/name="runId"[\s\S]*type="hidden"[\s\S]*value={runId}/);
    expect(source).toMatch(
      /<Textarea[\s\S]*id="approval-reason"[\s\S]*maxLength=\{APPROVAL_REASON_MAX_LENGTH\}/,
    );
    expect(source).toMatch(/<Textarea[\s\S]*name="reason"[\s\S]*required/);
    expect(source).not.toMatch(/name="decision"|formData\.set\("decision"|state\.data/i);
    expect(source).not.toMatch(/merge|push|github|pull request|runner execution/i);
    expectNoLiveTimelineBehavior(source);
    expectNoUnsafeRunUiSource(source);
  });

  test("detail page verifies the selected workspace before loading run events", async () => {
    const source = await readAppFile("./(app)/dashboard/runs/[runId]/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createWorkspaceMutationService");
    expect(source).toContain("createRunDetailService");
    expect(source).toContain("createDrizzleRunDetailStore");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toContain("Select workspace");
    expect(source).toMatch(
      /getRunDetail\(\{\s*runId,\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /runDetailService\s*\.\s*getRunDetail\(\{\s*runId,\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).toMatch(/runDetail === null[\s\S]*notFound\(\)/);
    expect(source).toContain(
      'import { ValidationResultDisplay } from "@/components/validation-result";',
    );
    expect(source).toMatch(/<ValidationResultDisplay[\s\S]*results={runDetail\.validationResults}/);
    expect(source).toContain('import { DryRunResultDisplay } from "@/components/dry-run-result";');
    expect(source).toMatch(/<DryRunResultDisplay[\s\S]*result={runDetail\.dryRunResult}/);
    expect(source).toContain('import { PrArtifactDisplay } from "@/components/pr-artifact";');
    expect(source).toMatch(/<PrArtifactDisplay[\s\S]*artifact={runDetail\.pr}/);
    expect(source).toContain(
      'import { RunCortexTaskContextPanel } from "@/components/run-cortex-task-context";',
    );
    expect(source).toMatch(
      /<RunCortexTaskContextPanel[\s\S]*context={runDetail\.cortexTask}[\s\S]*pr={runDetail\.pr}[\s\S]*validationResults={runDetail\.validationResults}/,
    );
    expect(source.indexOf("<RunCortexTaskContextPanel")).toBeLessThan(
      source.indexOf('aria-labelledby="run-summary"'),
    );
    expect(source).toMatch(/<RunTimeline[\s\S]*events={runDetail\.timeline}/);
    expect(source).toContain(
      'import { RequestRepairDialog } from "@/components/request-repair-dialog";',
    );
    expect(source).toMatch(/<RequestRepairDialog[\s\S]*previousRunId={runDetail\.id}/);
    expect(source).toMatch(/<RequestRepairDialog[\s\S]*workspaceId={runDetail\.workspaceId}/);
    expect(source).toMatch(
      /<RequestRepairDialog[\s\S]*attemptCount={runDetail\.repair\.attemptCount}/,
    );
    expect(source).toMatch(
      /<RequestRepairDialog[\s\S]*maxAttempts={runDetail\.repair\.maxAttempts}/,
    );
    expect(source).toMatch(
      /<RequestRepairDialog[\s\S]*remainingAttempts={runDetail\.repair\.remainingAttempts}/,
    );
    expect(source).toMatch(
      /<RequestRepairDialog[\s\S]*nextAttempt={runDetail\.repair\.nextAttempt}/,
    );
    expect(source).toMatch(
      /<RequestRepairDialog[\s\S]*disabled={!\s*runDetail\.repair\.canRequestRepair}/,
    );
    expect(source).toMatch(
      /<RequestRepairDialog[\s\S]*disabledReason={runDetail\.repair\.disabledReason \?\? ""}/,
    );
    expect(source).toContain('href="/dashboard/runs"');
    expect(source).toContain("coordination metadata only");
    expect(source).toContain("PR metadata");
    expect(source).toContain("changed file paths");
    expect(source).toContain("risk flags");
    expect(source).toContain("diffs");
    expect(source).toContain("patches");
    expect(source).toContain("source");
    expect(source).toContain("raw runner output");
    expect(source).toContain("secrets");
    expect(source).toContain("machine-local filesystem paths");
    expect(source).not.toMatch(/prArtifacts|prUrl|prNumber|prStatus/i);
    expectNoUnsafeRunUiSource(source, {
      allowCortexTaskContext: true,
      allowPrArtifactMetadata: true,
    });
  });

  test("detail page renders the cancel action only for non-terminal runs", async () => {
    const source = await readAppFile("./(app)/dashboard/runs/[runId]/page.tsx");

    expect(source).toContain('import { isTerminalRunState } from "@control-plane/shared";');
    expect(source).toContain('import { CancelRunButton } from "@/components/cancel-run-button";');
    expect(source).toMatch(
      /!isTerminalRunState\(runDetail\.state\)[\s\S]*<CancelRunButton[\s\S]*runId={runDetail\.id}[\s\S]*workspaceId={runDetail\.workspaceId}/,
    );
    expect(source).not.toContain("workspaceId={cookieWorkspaceId}");
  });

  test("detail page renders repair metadata and disables repair outside allowed state or at limit", async () => {
    const source = await readAppFile("./(app)/dashboard/runs/[runId]/page.tsx");

    expect(source).toContain("Repair attempts");
    expect(source).toContain("runDetail.repair.attemptCount");
    expect(source).toContain("runDetail.repair.maxAttempts");
    expect(source).toContain("runDetail.repair.nextAttempt");
    expect(source).toContain("runDetail.repair.canRequestRepair");
    expect(source).toContain("runDetail.repair.disabledReason");
    expect(source).not.toContain("workspaceId={cookieWorkspaceId}");
    expectNoUnsafeRunUiSource(source);
  });

  test("detail page delegates approval decisions to the evidence-gated review panel", async () => {
    const source = await readAppFile("./(app)/dashboard/runs/[runId]/page.tsx");

    expect(source).toContain(
      'import { ApprovalReviewPanel } from "@/components/approval-review-panel";',
    );
    expect(source).toContain("<ApprovalReviewPanel runDetail={runDetail} />");
    expect(source).not.toContain(
      'import { ApprovalActions } from "@/components/approval-actions";',
    );
    expect(source).not.toContain("<ApprovalActions");
    expect(source).not.toContain("workspaceId={cookieWorkspaceId}");
  });
});
