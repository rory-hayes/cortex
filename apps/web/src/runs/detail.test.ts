import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, DryRunResultSchema } from "@control-plane/shared";
import type {
  DryRunResult,
  PrArtifactStatus,
  RiskFinding,
  RunEventSeverity,
  RunState,
  TaskPacketMode,
  ValidationResultStatus,
} from "@control-plane/shared";

import type {
  RunDetailCortexTaskContextStoreRow,
  RunDetailStore,
  RunDetailStoreRunRow,
  RunTimelineEventStoreRow,
} from "./detail";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRunDetail = async () => import("./detail");

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
    gh: { available: true, version: "2.0.0" },
    git: { available: true, path: "/usr/bin/git", version: "2.50.0" },
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
    warnings: [
      {
        id: "risk:missing_capability",
        severity: "warning",
        category: "missing_capability",
        message: "Optional GitHub CLI is unavailable.",
        paths: [],
      },
    ],
    createdAt: "2026-05-23T09:59:30.000Z",
    ...overrides,
  });

const createRun = (
  overrides: Partial<RunDetailStoreRunRow> & Record<string, unknown> = {},
): RunDetailStoreRunRow =>
  ({
    createdAt: new Date("2026-05-23T10:00:00.000Z"),
    dryRunResult: null,
    id: "run_1",
    attemptCount: 0,
    lastEventAt: new Date("2026-05-23T10:30:00.000Z"),
    maxAttempts: 1,
    mode: "execute" satisfies TaskPacketMode,
    prArtifactContractVersion: CONTRACT_VERSION,
    prArtifactCreatedAt: new Date("2026-05-23T10:25:00.000Z"),
    prGithubChecksSummary: {
      conclusion: "passing",
      failedCount: 0,
      passedCount: 2,
      pendingCount: 0,
      skippedCount: 1,
      totalCount: 3,
    },
    prGithubReviewState: "approved",
    prGithubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
    prArtifactId: "pr_artifact_1",
    prArtifactRunId: "run_1",
    prBranchName: "aicp/task-136-add-pr-artifact-display",
    prChangedFilePaths: ["apps/web/components/pr-artifact.tsx"],
    prNumber: 42,
    prRepositoryName: "control-plane",
    prRepositoryOwner: "rory",
    prRiskFindings: [],
    prStatus: "open" satisfies PrArtifactStatus,
    prTitle: "TASK-136: Add PR artifact display",
    prUrl: "https://github.com/rory/control-plane/pull/42",
    repoMappingId: "repo_mapping_1",
    repositoryName: "control-plane",
    repositoryOwner: "rory",
    runnerDisplayName: "Mac Studio",
    runnerId: "runner_1",
    state: "pr_opened" satisfies RunState,
    taskId: "task_1",
    taskTitle: "Add run detail timeline",
    updatedAt: new Date("2026-05-23T10:15:00.000Z"),
    workspaceId: "workspace_1",
    ...overrides,
  }) as RunDetailStoreRunRow;

const createEvent = (
  overrides: Partial<RunTimelineEventStoreRow> & Record<string, unknown> = {},
): RunTimelineEventStoreRow =>
  ({
    contractVersion: CONTRACT_VERSION,
    createdAt: new Date("2026-05-23T10:05:00.000Z"),
    id: "event_1",
    idempotencyKey: "run:run_1:event:claimed:1",
    message: "Runner claimed the job.",
    metadata: {
      attempt: 1,
      runnerMode: "local",
    },
    receivedAt: new Date("2026-05-23T10:05:01.000Z"),
    runId: "run_1",
    runnerId: "runner_1",
    severity: "info" satisfies RunEventSeverity,
    state: "claimed" satisfies RunState,
    workspaceId: "workspace_1",
    ...overrides,
  }) as RunTimelineEventStoreRow;

type ValidationResultStoreRow = {
  command: string;
  commandId: string;
  commandLabel: string;
  contractVersion: string;
  durationMs: number;
  exitCode: number | null;
  finishedAt: Date;
  id: string;
  redactionApplied: boolean;
  runId: string;
  startedAt: Date;
  status: ValidationResultStatus;
  stderrSummary: string;
  stdoutSummary: string;
  workspaceId: string;
};

const createCortexTaskContext = (
  overrides: Partial<RunDetailCortexTaskContextStoreRow> = {},
): RunDetailCortexTaskContextStoreRow => ({
  findings: [
    {
      category: "validation",
      confidence: 0.9,
      contractVersion: CONTRACT_VERSION,
      createdAt: new Date("2026-05-23T09:30:00.000Z"),
      deterministicRuleId: "validation:missing-contract-test",
      evidence: [
        {
          metadata: {
            commandCount: 1,
          },
          paths: ["apps/web/src/runs/detail.ts"],
          summary: "Run context needs metadata-only test coverage.",
        },
      ],
      id: "finding_1",
      recommendation: "Add run detail task context evidence without raw execution payloads.",
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      severity: "medium",
      source: "deterministic_rule",
      status: "open",
      summary: "Run detail does not show the originating Cortex Task context.",
      title: "Missing run task context",
      updatedAt: new Date("2026-05-23T09:30:00.000Z"),
      workspaceId: "workspace_1",
    },
  ],
  task: {
    acceptanceCriteria: [
      "Run detail shows the originating Cortex Task before technical event details.",
      "Task findings and validation evidence remain metadata-only.",
    ],
    approvalStatus: "approved",
    contractVersion: CONTRACT_VERSION,
    createdAt: new Date("2026-05-23T09:40:00.000Z"),
    executionMode: "local_runner",
    externalLinks: [],
    findingIds: ["finding_1"],
    id: "cortex_task_1",
    latestRunId: "run_1",
    metadata: {
      recommendationCount: 1,
    },
    objective: "Add the Cortex Task context panel without exposing source.",
    originExternalId: null,
    originExternalSystem: null,
    originType: "finding",
    prArtifactIds: ["pr_artifact_1"],
    repoId: "github_repository_1",
    riskLevel: "medium",
    runIds: ["run_1", "run_repair_1"],
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
    taskPacketId: "task_packet_1",
    taskRecommendationId: null,
    title: "Show Cortex Task context on run detail",
    updatedAt: new Date("2026-05-23T10:20:00.000Z"),
    workspaceId: "workspace_1",
  },
  ...overrides,
});

const createValidationResult = (
  overrides: Partial<ValidationResultStoreRow> & Record<string, unknown> = {},
): ValidationResultStoreRow =>
  ({
    command: "pnpm --filter @control-plane/web test",
    commandId: "web-tests",
    commandLabel: "Web tests",
    contractVersion: CONTRACT_VERSION,
    durationMs: 1250,
    exitCode: 0,
    finishedAt: new Date("2026-05-23T10:12:01.250Z"),
    id: "validation_result_1",
    redactionApplied: true,
    runId: "run_1",
    startedAt: new Date("2026-05-23T10:12:00.000Z"),
    status: "passed" satisfies ValidationResultStatus,
    stderrSummary: "No standard error summary.",
    stdoutSummary: "Passed 12 tests.",
    workspaceId: "workspace_1",
    ...overrides,
  }) as ValidationResultStoreRow;

const createStore = (
  input: {
    detail?: {
      cortexTaskContext?: RunDetailCortexTaskContextStoreRow | null;
      events: RunTimelineEventStoreRow[];
      run: RunDetailStoreRunRow;
      validationResults?: ValidationResultStoreRow[];
    } | null;
    memberships?: Array<{ userId: string; workspaceId: string }>;
  } = {},
) => {
  const store = {
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }: { userId: string; workspaceId: string }) =>
      input.memberships?.some(
        (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    getWorkspaceRunDetail: vi.fn(async () => input.detail?.run ?? null),
    getRunCortexTaskContext: vi.fn(async () => input.detail?.cortexTaskContext ?? null),
    listRunEvents: vi.fn(async () => input.detail?.events ?? []),
    listValidationResults: vi.fn(async () => input.detail?.validationResults ?? []),
  };

  return store as unknown as RunDetailStore & {
    getRunCortexTaskContext: typeof store.getRunCortexTaskContext;
    listValidationResults: typeof store.listValidationResults;
  };
};

const collectObjectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectKeys(item, keys));

    return keys;
  }

  Object.entries(value).forEach(([key, childValue]) => {
    keys.push(key);
    collectObjectKeys(childValue, keys);
  });

  return keys;
};

const expectNoUnsafeRunDetailMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const keys = collectObjectKeys(value).map((key) => key.toLowerCase());

  expect(keys).not.toEqual(
    expect.arrayContaining([
      "capabilitiessnapshot",
      "changedpaths",
      "contextfilepaths",
      "credentials",
      "diff",
      "localpath",
      "repopath",
      "logs",
      "objective",
      "patch",
      "policysnapshot",
      "rawlogs",
      "rawoutput",
      "rawdiff",
      "rawlog",
      "rawsource",
      "riskfindings",
      "snippet",
      "source",
      "sourcecode",
      "sourcecontent",
      "taskpacket",
      "validationcommands",
      "worktreepath",
      "patchtext",
      "codesnippet",
      "filecontent",
      "private_key",
      "apikey",
    ]),
  );
  expect(serialized).not.toContain("Implement by reading src/private.ts");
  expect(serialized).not.toContain("apps/web/src/private.ts");
  expect(serialized).not.toContain("pnpm test -- --reporter=verbose");
  expect(serialized).not.toContain("src/changed-file.ts");
  expect(serialized).not.toContain("/Users/rory/repos/control-plane");
  expect(serialized).not.toContain("/Users/rory/.codex-runner-worktrees/run_1");
  expect(serialized).not.toContain("/Users/rory/repos/control-plane/apps/web");
  expect(serialized).not.toContain("credential_hash_value");
  expect(serialized).not.toContain("/bin/zsh");
  expect(serialized).not.toContain("/Users/rory/.local/bin/codex");
  expect(serialized).not.toContain("/usr/bin/git");
  expect(serialized).not.toContain("diff --git a/app.ts b/app.ts");
  expect(serialized).not.toContain("@@ -1 +1 @@");
  expect(serialized).not.toContain("const leaked = process.env.SECRET");
  expect(serialized).not.toContain("raw runner log line");
  expect(serialized).not.toContain("raw diff variant");
  expect(serialized).not.toContain("raw log variant");
  expect(serialized).not.toContain("patch text variant");
  expect(serialized).not.toContain("raw source variant");
  expect(serialized).not.toContain("source content variant");
  expect(serialized).not.toContain("code snippet variant");
  expect(serialized).not.toContain("file content variant");
  expect(serialized).not.toContain("private key variant");
  expect(serialized).not.toContain("api key variant");
};

const packageLockRisk = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
  ...overrides,
});

const expectPrArtifactContractShape = (artifact: unknown) => {
  expect(artifact).toEqual({
    branchName: "aicp/task-136-add-pr-artifact-display",
    changedFilePaths: [
      "apps/web/components/pr-artifact.tsx",
      "apps/web/src/runs/detail.ts",
    ],
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
    number: 77,
    repository: {
      name: "control-plane",
      owner: "rory",
    },
    reviewState: "approved",
    riskFlags: [packageLockRisk()],
    status: "draft",
    title: "TASK-136: Add PR artifact display",
    url: "https://github.com/rory/control-plane/pull/77",
  });
};

describe("run detail service", () => {
  test("rejects unauthenticated users before row access", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun(),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.getWorkspaceRunDetail).not.toHaveBeenCalled();
    expect(store.listRunEvents).not.toHaveBeenCalled();
    expect(store.listValidationResults).not.toHaveBeenCalled();
  });

  test("returns safe Cortex Task context, linked findings, and task evidence for the selected run", async () => {
    const { createRunDetailService } = await importRunDetail();
    const cortexTaskContext = createCortexTaskContext();
    const store = createStore({
      detail: {
        cortexTaskContext,
        events: [createEvent()],
        run: createRun(),
        validationResults: [createValidationResult()],
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail).toMatchObject({
      cortexTask: {
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
        ],
        latestRunId: "run_1",
        origin: {
          type: "finding",
        },
        prArtifactIds: ["pr_artifact_1"],
        riskLevel: "medium",
        runIds: ["run_1", "run_repair_1"],
        status: "pr_opened",
        suggestedValidation: cortexTaskContext.task.suggestedValidation,
        taskId: "cortex_task_1",
        title: "Show Cortex Task context on run detail",
      },
    });
    expect(store.getRunCortexTaskContext).toHaveBeenCalledWith({
      runId: "run_1",
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(detail)).not.toContain("Add the Cortex Task context panel");
    expect(JSON.stringify(detail)).not.toContain("task_packet_1");
    expectNoUnsafeRunDetailMaterial(detail);
  });

  test("omits unsafe Cortex Task context without leaking objective, logs, diffs, source, or local paths", async () => {
    const { createRunDetailService } = await importRunDetail();
    const unsafeContext = createCortexTaskContext({
      findings: [
        {
          ...createCortexTaskContext().findings[0],
          evidence: [
            {
              metadata: {
                rawLogs: "raw runner log line",
              },
              paths: ["/Users/rory/repos/control-plane/apps/web/secret.ts"],
              summary: "diff --git a/app.ts b/app.ts",
            },
          ],
          summary: "raw stdout: diff --git a/app.ts b/app.ts",
        } as unknown as RunDetailCortexTaskContextStoreRow["findings"][number],
      ],
      task: {
        ...createCortexTaskContext().task,
        acceptanceCriteria: ["Acceptance criteria raw text", "diff --git a/app.ts b/app.ts"],
        metadata: {
          rawOutput: "raw runner log line",
        },
        objective: "Implement by reading /Users/rory/repos/control-plane/apps/web/private.ts",
        title: "created at /Users/rory/repos/control-plane",
      } as unknown as RunDetailCortexTaskContextStoreRow["task"],
    });
    const store = createStore({
      detail: {
        cortexTaskContext: unsafeContext,
        events: [createEvent()],
        run: createRun(),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail).toMatchObject({
      cortexTask: null,
      id: "run_1",
    });
    expectNoUnsafeRunDetailMaterial(detail);
  });

  test("rejects authenticated non-members before row access", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun(),
      },
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.getWorkspaceRunDetail).not.toHaveBeenCalled();
    expect(store.listRunEvents).not.toHaveBeenCalled();
    expect(store.listValidationResults).not.toHaveBeenCalled();
  });

  test.each([
    { runId: "run_1", workspaceId: "  " },
    { runId: "run_1", workspaceId: "workspace_\n1" },
    { runId: "", workspaceId: "workspace_1" },
    { runId: "run_\u00001", workspaceId: "workspace_1" },
  ])("rejects blank or control-character ids before row access", async (input) => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun(),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.getRunDetail(input)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.getWorkspaceRunDetail).not.toHaveBeenCalled();
    expect(store.listRunEvents).not.toHaveBeenCalled();
    expect(store.listValidationResults).not.toHaveBeenCalled();
  });

  test("returns only the requested run and events in the verified workspace", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [
          createEvent({ id: "event_visible", runId: "run_visible" }),
          createEvent({
            id: "event_other_workspace",
            workspaceId: "workspace_2",
          }),
          createEvent({
            id: "event_other_run",
            runId: "run_2",
          }),
        ],
        run: createRun({ id: "run_visible", prArtifactRunId: "run_visible" }),
        validationResults: [
          createValidationResult({ id: "validation_visible", runId: "run_visible" }),
          createValidationResult({
            id: "validation_other_workspace",
            workspaceId: "workspace_2",
          }),
          createValidationResult({
            id: "validation_other_run",
            runId: "run_2",
          }),
        ],
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: " run_visible ", workspaceId: " workspace_1 " }),
    ).resolves.toMatchObject({
      id: "run_visible",
      pr: {
        number: 42,
        status: "open",
        url: "https://github.com/rory/control-plane/pull/42",
      },
      repoMapping: {
        id: "repo_mapping_1",
        repositoryName: "control-plane",
        repositoryOwner: "rory",
      },
      runner: {
        displayName: "Mac Studio",
        id: "runner_1",
      },
      task: {
        id: "task_1",
        title: "Add run detail timeline",
      },
      timeline: [
        expect.objectContaining({
          id: "event_visible",
        }),
      ],
      validationResults: [
        expect.objectContaining({
          id: "validation_visible",
        }),
      ],
      workspaceId: "workspace_1",
    });
    expect(store.getWorkspaceRunDetail).toHaveBeenCalledWith({
      runId: "run_visible",
      workspaceId: "workspace_1",
    });
    expect(store.listRunEvents).toHaveBeenCalledWith({
      runId: "run_visible",
      workspaceId: "workspace_1",
    });
    expect(store.listValidationResults).toHaveBeenCalledWith({
      runId: "run_visible",
      workspaceId: "workspace_1",
    });
  });

  test("returns safe repair attempt metadata with default max attempts and remaining attempts", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          attemptCount: 1,
          maxAttempts: 1,
          state: "awaiting_approval",
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail).toMatchObject({
      repair: {
        attemptCount: 1,
        canRequestRepair: true,
        disabledReason: null,
        maxAttempts: 2,
        nextAttempt: 2,
        remainingAttempts: 1,
      },
    });
    expectNoUnsafeRunDetailMaterial(detail);
  });

  test("returns repair disabled reason when the run is not awaiting approval", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          attemptCount: 0,
          maxAttempts: 2,
          state: "pr_opened",
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      repair: {
        attemptCount: 0,
        canRequestRepair: false,
        disabledReason: "Repairs are available only while the run is awaiting approval.",
        maxAttempts: 2,
        nextAttempt: 1,
        remainingAttempts: 2,
      },
    });
  });

  test("clamps repair remaining attempts at zero when the run is already at the limit", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          attemptCount: 3,
          maxAttempts: 2,
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      repair: {
        attemptCount: 3,
        canRequestRepair: false,
        disabledReason: "Repair attempt limit reached.",
        maxAttempts: 2,
        nextAttempt: 4,
        remainingAttempts: 0,
      },
    });
  });

  test("returns null when the store returns a run from another workspace", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent({ workspaceId: "workspace_2" })],
        run: createRun({ workspaceId: "workspace_2" }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toBeNull();
  });

  test("returns null when the store does not find a run", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: null,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_missing", workspaceId: "workspace_1" }),
    ).resolves.toBeNull();
    expect(store.getWorkspaceRunDetail).toHaveBeenCalledWith({
      runId: "run_missing",
      workspaceId: "workspace_1",
    });
    expect(store.listRunEvents).not.toHaveBeenCalled();
    expect(store.listValidationResults).not.toHaveBeenCalled();
  });

  test("returns ordered validation result display metadata without raw command text", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun(),
        validationResults: [
          createValidationResult({
            command: "pnpm --filter @control-plane/web typecheck --verbose",
            commandId: "web-typecheck",
            commandLabel: "Web typecheck",
            durationMs: 2400,
            exitCode: null,
            finishedAt: new Date("2026-05-23T10:12:02.400Z"),
            id: "validation_c_later_started",
            startedAt: new Date("2026-05-23T10:12:00.000Z"),
            status: "skipped",
            stderrSummary: "",
            stdoutSummary: "Skipped after required failure.",
          }),
          createValidationResult({
            command: "pnpm --filter @control-plane/web test -- --reporter=verbose",
            commandId: "web-tests",
            commandLabel: "Web tests",
            durationMs: 1500,
            exitCode: 1,
            finishedAt: new Date("2026-05-23T10:11:01.500Z"),
            id: "validation_a_earliest_started",
            startedAt: new Date("2026-05-23T10:11:00.000Z"),
            status: "failed",
            stderrSummary: "Assertion failed after redaction.",
            stdoutSummary: "Ran 16 tests with one failure.",
          }),
          createValidationResult({
            command: "pnpm run lint -- --debug",
            commandId: "web-lint",
            commandLabel: "Web lint",
            durationMs: 2000,
            exitCode: 0,
            finishedAt: new Date("2026-05-23T10:12:02.000Z"),
            id: "validation_b_same_started_earlier_finished",
            startedAt: new Date("2026-05-23T10:12:00.000Z"),
            status: "passed",
            stderrSummary: "No standard error summary.",
            stdoutSummary: "Lint passed.",
          }),
          createValidationResult({
            command: "pnpm exec vitest --run",
            commandId: "web-vitest",
            commandLabel: "Web vitest",
            durationMs: 2000,
            exitCode: null,
            finishedAt: new Date("2026-05-23T10:12:02.000Z"),
            id: "validation_a_same_started_same_finished",
            startedAt: new Date("2026-05-23T10:12:00.000Z"),
            status: "cancelled",
            stderrSummary: "Cancelled before stderr output.",
            stdoutSummary: "Cancelled at validation boundary.",
          }),
          createValidationResult({
            id: "validation_other_workspace",
            workspaceId: "workspace_2",
          }),
          createValidationResult({
            id: "validation_other_run",
            runId: "run_2",
          }),
        ],
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail).toMatchObject({
      validationResults: [
        {
          commandId: "web-tests",
          commandLabel: "Web tests",
          durationMs: 1500,
          exitCode: 1,
          id: "validation_a_earliest_started",
          redactionApplied: true,
          status: "failed",
          stderrSummary: "Assertion failed after redaction.",
          stdoutSummary: "Ran 16 tests with one failure.",
        },
        {
          id: "validation_a_same_started_same_finished",
        },
        {
          id: "validation_b_same_started_earlier_finished",
        },
        {
          id: "validation_c_later_started",
        },
      ],
    });
    expect(
      (
        detail as {
          validationResults: Array<Record<string, unknown>>;
        }
      ).validationResults.map((result) => result.id),
    ).toEqual([
      "validation_a_earliest_started",
      "validation_a_same_started_same_finished",
      "validation_b_same_started_earlier_finished",
      "validation_c_later_started",
    ]);
    for (const result of (
      detail as {
        validationResults: Array<Record<string, unknown>>;
      }
    ).validationResults) {
      expect(result).not.toHaveProperty("command");
    }
    expect(JSON.stringify(detail)).not.toContain("pnpm --filter @control-plane/web test");
    expect(JSON.stringify(detail)).not.toContain("pnpm run lint -- --debug");
    expect(JSON.stringify(detail)).not.toContain("pnpm exec vitest --run");
    expect(store.listValidationResults).toHaveBeenCalledWith({
      runId: "run_1",
      workspaceId: "workspace_1",
    });
  });

  test("returns full safe PR artifact metadata when present", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          prBranchName: "aicp/task-136-add-pr-artifact-display",
          prChangedFilePaths: [
            "apps/web/components/pr-artifact.tsx",
            "apps/web/src/runs/detail.ts",
          ],
          prNumber: 77,
          prGithubChecksSummary: {
            conclusion: "passing",
            failedCount: 0,
            passedCount: 2,
            pendingCount: 0,
            skippedCount: 1,
            totalCount: 3,
          },
          prGithubReviewState: "approved",
          prGithubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
          prRiskFindings: [packageLockRisk()],
          prStatus: "draft",
          prTitle: "TASK-136: Add PR artifact display",
          prUrl: "https://github.com/rory/control-plane/pull/77",
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expectPrArtifactContractShape(result?.pr);
    expectNoUnsafeRunDetailMaterial(result);
  });

  test("defaults malformed GitHub PR tracking metadata to unknown values", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          prGithubChecksSummary: {
            conclusion: "passing",
            failedCount: -1,
            passedCount: Number.NaN,
            pendingCount: 0,
            skippedCount: 0,
            totalCount: -2,
          },
          prGithubReviewState: "raw" as unknown as RunDetailStoreRunRow["prGithubReviewState"],
          prGithubSyncedAt: new Date("invalid"),
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      pr: {
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
      },
    });
  });

  test("drops unsafe PR URLs from run detail metadata", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          prNumber: 77,
          prStatus: "draft",
          prUrl: "https://token@example.com/rory/control-plane/pull/77",
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      pr: {
        number: 77,
        status: "draft",
        url: null,
      },
    });
  });

  test("omits unsafe changed file paths and risk findings from PR artifact metadata", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          prBranchName: "aicp/task-136-add-pr-artifact-display",
          prChangedFilePaths: [
            "apps/web/components/pr-artifact.tsx",
            ".env.local",
            "/Users/rory/repos/control-plane/apps/web/secret.ts",
            "src/index.ts\nexport const leakedValue = true;",
          ],
          prRiskFindings: [
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
          prTitle: "TASK-136: Add PR artifact display",
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(result?.pr).toMatchObject({
      changedFilePaths: ["apps/web/components/pr-artifact.tsx"],
      riskFlags: [packageLockRisk()],
    });
    expectNoUnsafeRunDetailMaterial(result);
  });

  test("returns null PR metadata when the PR artifact row is absent, malformed, or mismatched", async () => {
    const { createRunDetailService } = await importRunDetail();
    const makeService = (run: RunDetailStoreRunRow) =>
      createRunDetailService({
        getAuthContext: async () => ({ userId: "user_1" }),
        store: createStore({
          detail: {
            events: [createEvent()],
            run,
          },
          memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        }),
      });

    await expect(
      makeService(createRun({ prArtifactId: null })).getRunDetail({
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({ pr: null });
    await expect(
      makeService(
        createRun({
          prArtifactContractVersion: "2020-01-01.invalid",
        }),
      ).getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({ pr: null });
    await expect(
      makeService(createRun({ prArtifactRunId: "run_2" })).getRunDetail({
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({ pr: null });
  });

  test("omits unsafe PR artifact rows without leaking source-like artifact text", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          prArtifactContractVersion: "2020-01-01.invalid",
          prArtifactId: "pr_artifact_1",
          prBranchName: "src/index.ts\nexport const leakedValue = true;",
          prTitle: "diff --git a/app.ts b/app.ts",
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(result?.pr).toBeNull();
    expectNoUnsafeRunDetailMaterial(result);
  });

  test("returns the stored dry-run result for the verified workspace and run", async () => {
    const { createRunDetailService } = await importRunDetail();
    const dryRunResult = createDryRunResult({
      runId: "run_1",
      status: "warning",
    });
    const expectedDryRunResult = DryRunResultSchema.parse({
      ...dryRunResult,
      capabilities: {
        ...dryRunResult.capabilities,
        shell: "zsh",
        tools: {
          ...dryRunResult.capabilities.tools,
          codex: { available: true, version: "1.0.0" },
          git: { available: true, version: "2.50.0" },
        },
      },
    });
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          dryRunResult: {
            ...dryRunResult,
            resultCreatedAt: new Date(dryRunResult.createdAt),
          },
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail).toMatchObject({
      dryRunResult: expectedDryRunResult,
      id: "run_1",
      workspaceId: "workspace_1",
    });
    expectNoUnsafeRunDetailMaterial(detail);
  });

  test("returns null dry-run result when no stored result exists", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({ dryRunResult: null }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      dryRunResult: null,
    });
  });

  test("returns null dry-run result when the stored row is malformed", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [createEvent()],
        run: createRun({
          dryRunResult: {
            ...createDryRunResult(),
            checks: [
              {
                id: "repo_clean",
                label: "Repo clean",
                message: "Missing status should make this row invalid.",
                metadata: {},
              },
            ],
            resultCreatedAt: new Date("2026-05-23T09:59:30.000Z"),
          },
        }),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      dryRunResult: null,
    });
  });

  test("orders events by createdAt, then receivedAt, then stable id", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [
          createEvent({
            createdAt: new Date("2026-05-23T10:06:00.000Z"),
            id: "event_c_later_created",
            idempotencyKey: "run:run_1:event:later:1",
            receivedAt: new Date("2026-05-23T10:06:01.000Z"),
          }),
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_c_same_created_later_received",
            idempotencyKey: "run:run_1:event:same_created_late_received:1",
            receivedAt: new Date("2026-05-23T10:05:03.000Z"),
          }),
          createEvent({
            createdAt: new Date("2026-05-23T10:04:00.000Z"),
            id: "event_a_earliest_created",
            idempotencyKey: "run:run_1:event:earliest:1",
            receivedAt: new Date("2026-05-23T10:04:05.000Z"),
          }),
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_z_same_created_same_received",
            idempotencyKey: "run:run_1:event:same_created_same_received_z:1",
            receivedAt: new Date("2026-05-23T10:05:02.000Z"),
          }),
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_b_same_created_earlier_received",
            idempotencyKey: "run:run_1:event:same_created_early_received:1",
            receivedAt: new Date("2026-05-23T10:05:02.000Z"),
          }),
        ],
        run: createRun(),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail?.timeline.map((event) => event.id)).toEqual([
      "event_a_earliest_created",
      "event_b_same_created_earlier_received",
      "event_z_same_created_same_received",
      "event_c_same_created_later_received",
      "event_c_later_created",
    ]);
  });

  test("de-duplicates repeated idempotency keys after ordering", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_duplicate_late",
            idempotencyKey: "run:run_1:event:claimed:1",
            message: "Retry should be suppressed.",
            receivedAt: new Date("2026-05-23T10:05:03.000Z"),
          }),
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_duplicate_early",
            idempotencyKey: "run:run_1:event:claimed:1",
            message: "Original event kept.",
            receivedAt: new Date("2026-05-23T10:05:01.000Z"),
          }),
          createEvent({
            id: "event_unique",
            idempotencyKey: "run:run_1:event:worktree_created:1",
          }),
        ],
        run: createRun(),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail?.timeline.map((event) => event.id)).toEqual([
      "event_duplicate_early",
      "event_unique",
    ]);
    expect(detail?.timeline[0]?.message).toBe("Original event kept.");
  });

  test("does not let invalid event rows suppress later valid retries", async () => {
    const { createRunDetailService } = await importRunDetail();
    const store = createStore({
      detail: {
        events: [
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_invalid_first",
            idempotencyKey: "run:run_1:event:claimed:1",
            message: "",
            receivedAt: new Date("2026-05-23T10:05:01.000Z"),
          }),
          createEvent({
            createdAt: new Date("2026-05-23T10:05:00.000Z"),
            id: "event_valid_retry",
            idempotencyKey: "run:run_1:event:claimed:1",
            message: "Valid retry retained.",
            receivedAt: new Date("2026-05-23T10:05:02.000Z"),
          }),
        ],
        run: createRun(),
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const detail = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(detail?.timeline).toEqual([
      expect.objectContaining({
        id: "event_valid_retry",
        message: "Valid retry retained.",
      }),
    ]);
  });

  test("omits unsafe row fields such as packets, local paths, logs, diffs, patches, snippets, and source-like fields", async () => {
    const { createRunDetailService } = await importRunDetail();
    const unsafeRun = {
      ...createRun({
        prArtifactId: null,
        runnerDisplayName: null,
        runnerId: null,
        state: "queued",
      }),
      acceptanceCriteria: ["Acceptance criteria raw text"],
      capabilitiesSnapshot: { tools: {} },
      changedPaths: ["src/changed-file.ts"],
      contextFilePaths: ["apps/web/src/private.ts"],
      credentials: "credential_hash_value",
      diff: "diff --git a/app.ts b/app.ts",
      localPath: "/Users/rory/repos/control-plane",
      objective: "Implement by reading src/private.ts",
      patch: "@@ -1 +1 @@",
      policySnapshot: { protectedPaths: ["src/private.ts"] },
      rawLogs: "raw runner log line",
      rawOutput: "raw runner log line",
      riskFindings: [{ category: "secret" }],
      snippet: "const leaked = process.env.SECRET",
      sourceCode: "const leaked = process.env.SECRET",
      taskPacket: { objective: "Implement by reading src/private.ts" },
      validationCommands: [{ command: "pnpm test -- --reporter=verbose" }],
    } as unknown as RunDetailStoreRunRow;
    const unsafeEvent = {
      ...createEvent({
        metadata: {
          attempt: 1,
          changedFileCount: 2,
          command: "pnpm test -- --reporter=verbose",
          commandText: "pnpm test -- --reporter=verbose",
          credentials: "credential_hash_value",
          diff: "diff --git a/app.ts b/app.ts",
          apiKey: "api key variant",
          codeSnippet: "code snippet variant",
          fileContent: "file content variant",
          repoPath: "/Users/rory/repos/control-plane",
          worktreePath: "/Users/rory/.codex-runner-worktrees/run_1",
          statusNote: "created at /Users/rory/repos/control-plane/apps/web",
          nested: {
            checkoutRoot: "/Users/rory/repos/control-plane/apps/web",
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
          taskPacket: { objective: "Implement by reading src/private.ts" },
        },
      }),
      diff: "diff --git a/app.ts b/app.ts",
      patch: "@@ -1 +1 @@",
      rawLogs: "raw runner log line",
      rawOutput: "raw runner log line",
      receivedAt: new Date("2026-05-23T10:05:01.000Z"),
      snippet: "const leaked = process.env.SECRET",
      sourceCode: "const leaked = process.env.SECRET",
    } as unknown as RunTimelineEventStoreRow;
    const store = createStore({
      detail: {
        events: [unsafeEvent],
        run: unsafeRun,
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createRunDetailService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getRunDetail({ runId: "run_1", workspaceId: "workspace_1" });

    expect(result).toEqual({
      createdAt: new Date("2026-05-23T10:00:00.000Z"),
      cortexTask: null,
      id: "run_1",
      dryRunResult: null,
      mode: "execute",
      pr: null,
      repoMapping: {
        id: "repo_mapping_1",
        repositoryName: "control-plane",
        repositoryOwner: "rory",
      },
      repair: {
        attemptCount: 0,
        canRequestRepair: false,
        disabledReason: "Repairs are available only while the run is awaiting approval.",
        maxAttempts: 2,
        nextAttempt: 1,
        remainingAttempts: 2,
      },
      runner: null,
      state: "queued",
      task: {
        id: "task_1",
        title: "Add run detail timeline",
      },
      timeline: [
        {
          createdAt: new Date("2026-05-23T10:05:00.000Z"),
          id: "event_1",
          idempotencyKey: "run:run_1:event:claimed:1",
          message: "Runner claimed the job.",
          metadata: {
            attempt: 1,
            changedFileCount: 2,
          },
          receivedAt: new Date("2026-05-23T10:05:01.000Z"),
          severity: "info",
          state: "claimed",
        },
      ],
      updatedAt: new Date("2026-05-23T10:30:00.000Z"),
      validationResults: [],
      workspaceId: "workspace_1",
    });
    expectNoUnsafeRunDetailMaterial(result);
  });
});
