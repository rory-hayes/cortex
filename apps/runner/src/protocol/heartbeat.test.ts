import {
  CONTRACT_VERSION,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type LinkRunnerResponse,
  type CancellationRequest,
  type CloseRunRequest,
  type RepairRequest,
  type RunnerCapabilities,
} from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import { sendRunnerHeartbeat, type RunnerHeartbeatInstruction } from "./heartbeat.js";

const runnerCredential = "runner-credential-secret";

describe("runner heartbeat client", () => {
  test("loads the stored credential, reports capabilities, sends authenticated heartbeat, and returns safe metadata", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true, data: heartbeatResponse() }));
    const detectCapabilities = vi.fn(async () => runnerCapabilities());
    const loadCredential = vi.fn(async () => storedCredential());

    const result = await sendRunnerHeartbeat(
      {
        currentRunId: "run_1",
      },
      {
        detectCapabilities,
        fetch,
        loadCredential,
        now: () => new Date("2026-05-22T16:00:00.000Z"),
      },
    );

    expect(loadCredential).toHaveBeenCalledWith({});
    expect(detectCapabilities).toHaveBeenCalledWith({
      now: expect.any(Function),
      runnerId: "runner_1",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://control-plane.test/api/runner/heartbeat",
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${runnerCredential}`,
          "content-type": "application/json",
          "x-control-plane-runner-id": "runner_1",
        },
        method: "POST",
        redirect: "manual",
      }),
    );

    const requestInit = (
      fetch.mock.calls[0] as
        | [string, { body: string; headers: Record<string, string>; method: string }]
        | undefined
    )?.[1];
    expect(requestInit).toBeDefined();
    const body = JSON.parse(requestInit?.body ?? "{}") as HeartbeatRequest;

    expect(HeartbeatRequestSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      capabilities: runnerCapabilities(),
      contractVersion: CONTRACT_VERSION,
      currentRunId: "run_1",
      runnerId: "runner_1",
      status: "busy",
      timestamp: "2026-05-22T16:00:00.000Z",
    });
    expect(result).toEqual({
      currentRunId: "run_1",
      instruction: { type: "none" },
      pollIntervalSeconds: 15,
      runnerId: "runner_1",
      serverTime: "2026-05-22T16:00:01.000Z",
      status: "busy",
    });
    expect(JSON.stringify(result)).not.toContain(runnerCredential);
  });

  test("defaults heartbeat status to idle without a run and allows explicit status override", async () => {
    const idleFetch = vi.fn(async () => jsonResponse({ ok: true, data: heartbeatResponse() }));
    const offlineFetch = vi.fn(async () => jsonResponse({ ok: true, data: heartbeatResponse() }));

    await sendRunnerHeartbeat(
      {},
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch: idleFetch,
        loadCredential: async () => storedCredential(),
        now: () => new Date("2026-05-22T16:00:00.000Z"),
      },
    );
    await sendRunnerHeartbeat(
      {
        status: "offline",
      },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch: offlineFetch,
        loadCredential: async () => storedCredential(),
        now: () => new Date("2026-05-22T16:00:00.000Z"),
      },
    );

    expect(JSON.parse(getFetchBody(idleFetch))).toMatchObject({
      currentRunId: null,
      status: "idle",
    });
    expect(JSON.parse(getFetchBody(offlineFetch))).toMatchObject({
      currentRunId: null,
      status: "offline",
    });
  });

  test.each([
    ["none", heartbeatResponse(), { type: "none" }],
    [
      "cancellation",
      heartbeatResponse({ cancellation: cancellationRequest() }),
      { cancellation: cancellationRequest(), type: "cancellation" },
    ],
    [
      "repair",
      heartbeatResponse({ repair: repairRequest() }),
      { repair: repairRequest(), type: "repair" },
    ],
    [
      "close",
      heartbeatResponse({ close: closeRequest() }),
      { close: closeRequest(), type: "close" },
    ],
  ] satisfies [string, HeartbeatResponse, RunnerHeartbeatInstruction][])(
    "returns a normalized %s heartbeat instruction and response metadata",
    async (_name, response, expectedInstruction) => {
      const fetch = vi.fn(async () => jsonResponse({ ok: true, data: response }));

      const result = await sendRunnerHeartbeat(
        {
          currentRunId: "run_1",
        },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
          loadCredential: async () => storedCredential(),
          now: () => new Date("2026-05-22T16:00:00.000Z"),
        },
      );

      expect(HeartbeatResponseSchema.safeParse(response).success).toBe(true);
      expect(result).toMatchObject({
        instruction: expectedInstruction,
        pollIntervalSeconds: response.pollIntervalSeconds,
        serverTime: response.serverTime,
      });
    },
  );
});

const jsonResponse = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
});

const getFetchBody = (fetch: ReturnType<typeof vi.fn>): string => {
  const requestInit = fetch.mock.calls[0]?.[1] as { body?: unknown } | undefined;

  if (typeof requestInit?.body !== "string") {
    throw new Error("Expected fetch body.");
  }

  return requestInit.body;
};

const storedCredential = (): LinkRunnerResponse & { storedAt: string } => ({
  contractVersion: CONTRACT_VERSION,
  linkedAt: "2026-05-22T15:00:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "https://control-plane.test/api",
  runnerCredential,
  runnerId: "runner_1",
  storedAt: "2026-05-22T15:00:01.000Z",
  workspaceId: "workspace_1",
});

const runnerCapabilities = (): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  maxConcurrentJobs: 1,
  os: {
    arch: "arm64",
    platform: "darwin",
    release: "25.0.0",
  },
  reportedAt: "2026-05-22T16:00:00.000Z",
  runnerId: "runner_1",
  shell: "/bin/zsh",
  supportsCancellation: true,
  supportsDryRun: true,
  tools: {
    codex: { available: true, version: "1.2.3" },
    gh: { available: true, version: "2.72.0" },
    git: { available: true, version: "2.49.0" },
    node: { available: true, version: "24.0.0" },
    npm: { available: false },
    pnpm: { available: true, version: "9.15.9" },
    python: { available: false },
    yarn: { available: false },
  },
});

const heartbeatResponse = (overrides: Partial<HeartbeatResponse> = {}): HeartbeatResponse =>
  HeartbeatResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    pollIntervalSeconds: 15,
    serverTime: "2026-05-22T16:00:01.000Z",
    ...overrides,
  });

const cancellationRequest = (): CancellationRequest => ({
  contractVersion: CONTRACT_VERSION,
  reason: "Cancel requested by reviewer.",
  requestedAt: "2026-05-22T16:00:02.000Z",
  requestedByActorId: "user_1",
  runId: "run_1",
});

const closeRequest = (): CloseRunRequest => ({
  closedAt: "2026-05-22T16:00:03.000Z",
  closedByActorId: "user_1",
  contractVersion: CONTRACT_VERSION,
  reason: "Run reviewed and closed.",
  runId: "run_1",
});

const repairRequest = (): RepairRequest => ({
  contractVersion: CONTRACT_VERSION,
  reason: "Validation failed and needs repair.",
  requestedAt: "2026-05-22T16:00:04.000Z",
  requestedByActorId: "user_1",
  runId: "run_1",
  taskPacket: {
    acceptanceCriteria: ["Keep the runner protocol boundary safe."],
    context: {
      files: [],
      notes: ["Repair validation failure."],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: "2026-05-22T16:00:04.000Z",
    id: "task_1",
    mode: "repair",
    objective: "Repair the failed validation.",
    policy: {
      allowUntrackedFiles: true,
      contractVersion: CONTRACT_VERSION,
      dryRunChecks: [
        "repo_path_exists",
        "git_repository",
        "repo_clean",
        "current_branch_not_protected",
        "repo_policy_exists_and_parses",
        "validation_commands_configured",
        "required_tools_available",
        "branch_name_available",
        "worktree_path_available",
        "protected_and_sensitive_paths_configured",
        "runner_capabilities_satisfied",
      ],
      maxChangedFiles: 10,
      protectedBranches: ["main"],
      protectedPaths: ["infra/**"],
      sensitivePaths: [".env"],
      validationCommands: [
        {
          command: "pnpm test",
          id: "test",
          label: "Tests",
          required: true,
          timeoutSeconds: 120,
        },
      ],
      warningPaths: {
        auth: [],
        billing: [],
        infrastructure: [],
        migrations: [],
        packageLocks: [],
      },
    },
    repair: {
      attempt: 1,
      feedback: "Fix the failing validation.",
      maxAttempts: 2,
      previousRunId: "run_previous",
    },
    repo: {
      defaultBranch: "main",
      localPath: "/repo",
      targetBranch: "aicp/task",
    },
    repositoryId: "repo_1",
    runId: "run_1",
    source: {
      title: "Repair validation",
      type: "repair",
    },
    validation: {
      commands: [
        {
          command: "pnpm test",
          id: "test",
          label: "Tests",
          required: true,
          timeoutSeconds: 120,
        },
      ],
    },
    workspaceId: "workspace_1",
  },
});
