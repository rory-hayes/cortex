import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const repositorySyncMocks = vi.hoisted(() => ({
  createDrizzleGitHubRepositoryStore: vi.fn(),
  createDrizzleRepoScanStore: vi.fn(),
  createDrizzleSetupPrMergeResolutionStore: vi.fn(),
  createGitHubRepositoryService: vi.fn(),
  createRepoScanService: vi.fn(),
  createSetupPrMergeResolutionService: vi.fn(),
  getDatabase: vi.fn(),
  resolveMergedSetupPrForWebhook: vi.fn(),
  syncGitHubRepositoriesForWebhook: vi.fn(),
  triggerRepoScanForWebhook: vi.fn(),
}));

vi.mock("@/src/db", () => ({
  getDatabase: repositorySyncMocks.getDatabase,
}));

vi.mock("@/src/github/repositories", () => ({
  createDrizzleGitHubRepositoryStore: repositorySyncMocks.createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService: repositorySyncMocks.createGitHubRepositoryService,
}));

vi.mock("@/src/repo-readiness/repo-scans", () => ({
  createDrizzleRepoScanStore: repositorySyncMocks.createDrizzleRepoScanStore,
  createRepoScanService: repositorySyncMocks.createRepoScanService,
}));

vi.mock("@/src/setup-pr/resolution", () => ({
  createDrizzleSetupPrMergeResolutionStore:
    repositorySyncMocks.createDrizzleSetupPrMergeResolutionStore,
  createSetupPrMergeResolutionService: repositorySyncMocks.createSetupPrMergeResolutionService,
}));

const deliveryId = "123e4567-e89b-42d3-a456-426614174000";
const webhookSecret = "github-webhook-secret-value";
const fakePayloadToken = `${"ghp_"}payloadTokenMustNotLeaveRoute`;

const importRoute = async () => import("./route");

const repositoryPayload = () => ({
  id: 9001,
  name: "control-plane",
  full_name: "acme/control-plane",
  private: true,
  html_url: "https://github.example.test/acme/control-plane",
  default_branch: "main",
  archived: false,
  disabled: false,
  visibility: "private",
  contents_url: "https://api.github.example.test/repos/acme/control-plane/contents/{+path}",
});

const installationPayload = () => ({
  action: "created",
  installation: {
    id: 42,
    access_tokens_url: "https://api.github.example.test/app/installations/42/access_tokens",
  },
  repositories: [repositoryPayload()],
});

const installationRepositoriesPayload = () => ({
  action: "added",
  installation: {
    id: 42,
    token: fakePayloadToken,
  },
  repositories_added: [repositoryPayload()],
  repositories_removed: [],
});

const installationRepositoriesRemovedPayload = () => ({
  action: "removed",
  installation: {
    id: 42,
    token: fakePayloadToken,
  },
  repositories_added: [],
  repositories_removed: [repositoryPayload()],
});

const pullRequestPayload = () => ({
  action: "opened",
  installation: {
    id: 42,
  },
  repository: repositoryPayload(),
  pull_request: {
    id: 701,
    number: 17,
    title: "TASK-152: Add webhook verification",
    state: "open",
    draft: false,
    merged: false,
    html_url: "https://github.example.test/acme/control-plane/pull/17",
    user: {
      id: 501,
      login: "rory",
      type: "User",
      html_url: "https://github.example.test/rory",
    },
    head: {
      ref: "aicp/task-152",
    },
    base: {
      ref: "main",
    },
    updated_at: "2026-05-24T12:00:00.000Z",
    body: "Do not expose this PR body text.",
    comments: 4,
    review_comments: 2,
    diff_url: "https://github.example.test/acme/control-plane/pull/17.diff",
    patch_url: "https://github.example.test/acme/control-plane/pull/17.patch",
    source: "const shouldNotLeaveRoute = true;",
  },
  comment: {
    body: "Do not expose this comment.",
  },
  secret: fakePayloadToken,
});

const mergedPullRequestPayload = () => ({
  ...pullRequestPayload(),
  action: "closed",
  pull_request: {
    ...pullRequestPayload().pull_request,
    merged: true,
    merged_at: "2026-05-24T12:15:00.000Z",
    state: "closed",
  },
});

const pushPayload = (overrides: Record<string, unknown> = {}) => ({
  after: "1".repeat(40),
  before: "0".repeat(40),
  commits: [
    {
      added: ["apps/web/source-should-not-leave.ts"],
      message: "Do not expose commit messages.",
      modified: ["packages/github/source-should-not-leave.ts"],
      removed: [],
    },
  ],
  head_commit: {
    message: "Do not expose head commit.",
  },
  installation: {
    id: 42,
    token: fakePayloadToken,
  },
  pusher: {
    email: "do-not-expose@example.test",
    name: "octocat",
  },
  ref: "refs/heads/main",
  repository: repositoryPayload(),
  ...overrides,
});

const signPayload = (payload: string, secret = webhookSecret): string =>
  `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

const createRequest = ({
  eventName,
  payload,
  rawBody = JSON.stringify(payload),
  signature = signPayload(rawBody),
}: {
  eventName: string;
  payload?: unknown;
  rawBody?: string;
  signature?: string;
}): Request =>
  new Request("https://control-plane.test/api/github/webhook", {
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": eventName,
      "x-hub-signature-256": signature,
    },
    method: "POST",
  });

const post = async (request: Request): Promise<Response> => {
  const { POST } = await importRoute();

  return POST(request);
};

const expectSafeResponseText = (responseText: string, rawPayload?: string): void => {
  expect(responseText).not.toContain(webhookSecret);
  expect(responseText).not.toContain(fakePayloadToken);
  expect(responseText).not.toContain("Do not expose this PR body text");
  expect(responseText).not.toContain("Do not expose this comment");
  expect(responseText).not.toContain("Do not expose commit messages.");
  expect(responseText).not.toContain("source-should-not-leave");
  expect(responseText).not.toContain("do-not-expose@example.test");
  expect(responseText).not.toContain("diff_url");
  expect(responseText).not.toContain("patch_url");
  expect(responseText).not.toContain("shouldNotLeaveRoute");
  expect(responseText).not.toMatch(/\b(?:raw_payload|diff|patch|source|snippet|content)\b/iu);

  if (rawPayload !== undefined) {
    expect(responseText).not.toContain(rawPayload);
  }
};

beforeEach(() => {
  vi.resetModules();
  repositorySyncMocks.createDrizzleGitHubRepositoryStore.mockReset();
  repositorySyncMocks.createDrizzleRepoScanStore.mockReset();
  repositorySyncMocks.createGitHubRepositoryService.mockReset();
  repositorySyncMocks.createRepoScanService.mockReset();
  repositorySyncMocks.createDrizzleSetupPrMergeResolutionStore.mockReset();
  repositorySyncMocks.createSetupPrMergeResolutionService.mockReset();
  repositorySyncMocks.getDatabase.mockReset();
  repositorySyncMocks.resolveMergedSetupPrForWebhook.mockReset();
  repositorySyncMocks.syncGitHubRepositoriesForWebhook.mockReset();
  repositorySyncMocks.triggerRepoScanForWebhook.mockReset();
  repositorySyncMocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  repositorySyncMocks.createDrizzleGitHubRepositoryStore.mockReturnValue({
    kind: "github-repository-store",
  });
  repositorySyncMocks.createDrizzleRepoScanStore.mockReturnValue({
    kind: "repo-scan-store",
  });
  repositorySyncMocks.createDrizzleSetupPrMergeResolutionStore.mockReturnValue({
    kind: "setup-pr-merge-resolution-store",
  });
  repositorySyncMocks.createGitHubRepositoryService.mockReturnValue({
    syncGitHubRepositoriesForWebhook: repositorySyncMocks.syncGitHubRepositoriesForWebhook,
  });
  repositorySyncMocks.createRepoScanService.mockReturnValue({
    triggerRepoScanForWebhook: repositorySyncMocks.triggerRepoScanForWebhook,
  });
  repositorySyncMocks.createSetupPrMergeResolutionService.mockReturnValue({
    resolveMergedSetupPrForWebhook: repositorySyncMocks.resolveMergedSetupPrForWebhook,
  });
  repositorySyncMocks.syncGitHubRepositoriesForWebhook.mockResolvedValue({
    matchedRepoMappingCount: 0,
    skipped: false,
    syncedRepositoryCount: 1,
  });
  repositorySyncMocks.resolveMergedSetupPrForWebhook.mockResolvedValue({
    findingIds: ["finding_agent_readiness"],
    previewId: "setup_preview_1",
    repoId: "repo_1",
    resolvedFindingCount: 1,
    resolvedTaskCount: 1,
    status: "resolved",
    taskIds: ["task_setup_agents"],
    workspaceId: "workspace_1",
  });
  repositorySyncMocks.triggerRepoScanForWebhook.mockResolvedValue({
    created: true,
    repoId: "github_repository_1",
    scanId: "repo_scan_1",
    status: "queued",
    workspaceId: "workspace_1",
  });
  process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;
});

afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

describe("POST /api/github/webhook", () => {
  test("accepts valid signed installation webhooks with a minimal safe envelope", async () => {
    const response = await post(
      createRequest({
        eventName: "installation",
        payload: installationPayload(),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        action: "created",
        deliveryId,
        eventName: "installation",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.createDrizzleGitHubRepositoryStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(repositorySyncMocks.syncGitHubRepositoriesForWebhook).toHaveBeenCalledWith({
      githubInstallationId: 42,
      repositories: [
        {
          archived: false,
          defaultBranch: "main",
          disabled: false,
          fullName: "acme/control-plane",
          htmlUrl: "https://github.example.test/acme/control-plane",
          id: 9001,
          name: "control-plane",
          owner: "acme",
          private: true,
          visibility: "private",
        },
      ],
    });
  });

  test("accepts valid signed installation_repositories webhooks with a minimal safe envelope", async () => {
    const rawBody = JSON.stringify(installationRepositoriesPayload());
    const response = await post(
      createRequest({
        eventName: "installation_repositories",
        payload: installationRepositoriesPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "added",
        deliveryId,
        eventName: "installation_repositories",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.syncGitHubRepositoriesForWebhook).toHaveBeenCalledWith({
      githubInstallationId: 42,
      repositories: [
        {
          archived: false,
          defaultBranch: "main",
          disabled: false,
          fullName: "acme/control-plane",
          htmlUrl: "https://github.example.test/acme/control-plane",
          id: 9001,
          name: "control-plane",
          owner: "acme",
          private: true,
          visibility: "private",
        },
      ],
    });
    expectSafeResponseText(responseText, rawBody);
  });

  test("accepts repository removal webhooks without syncing removed repositories", async () => {
    const rawBody = JSON.stringify(installationRepositoriesRemovedPayload());
    const response = await post(
      createRequest({
        eventName: "installation_repositories",
        payload: installationRepositoriesRemovedPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "removed",
        deliveryId,
        eventName: "installation_repositories",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.syncGitHubRepositoriesForWebhook).not.toHaveBeenCalled();
    expect(repositorySyncMocks.resolveMergedSetupPrForWebhook).not.toHaveBeenCalled();
    expectSafeResponseText(responseText, rawBody);
  });

  test("resolves matching setup PR previews from merged pull_request webhooks", async () => {
    const rawBody = JSON.stringify(mergedPullRequestPayload());
    const response = await post(
      createRequest({
        eventName: "pull_request",
        payload: mergedPullRequestPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "closed",
        deliveryId,
        eventName: "pull_request",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.createDrizzleSetupPrMergeResolutionStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(repositorySyncMocks.resolveMergedSetupPrForWebhook).toHaveBeenCalledWith({
      deliveryId,
      installationId: 42,
      pullRequest: expect.objectContaining({
        merged: true,
        number: 17,
        state: "closed",
      }),
      repository: expect.objectContaining({
        fullName: "acme/control-plane",
        name: "control-plane",
        owner: "acme",
      }),
    });
    expect(repositorySyncMocks.createDrizzleRepoScanStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(repositorySyncMocks.triggerRepoScanForWebhook).toHaveBeenCalledWith({
      deliveryId,
      githubInstallationId: 42,
      reason: "pull_request_merged",
      repository: expect.objectContaining({
        fullName: "acme/control-plane",
        name: "control-plane",
        owner: "acme",
      }),
    });
    expectSafeResponseText(responseText, rawBody);
  });

  test("accepts repository installation webhooks without creating orphan repository rows", async () => {
    repositorySyncMocks.syncGitHubRepositoriesForWebhook.mockResolvedValue({
      matchedRepoMappingCount: 0,
      skipped: true,
      syncedRepositoryCount: 0,
    });

    const rawBody = JSON.stringify(installationRepositoriesPayload());
    const response = await post(
      createRequest({
        eventName: "installation_repositories",
        payload: installationRepositoriesPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "added",
        deliveryId,
        eventName: "installation_repositories",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.syncGitHubRepositoriesForWebhook).toHaveBeenCalledTimes(1);
    expectSafeResponseText(responseText, rawBody);
  });

  test("accepts valid signed pull_request webhooks without returning body, comments, diffs, or patches", async () => {
    const rawBody = JSON.stringify(pullRequestPayload());
    const response = await post(
      createRequest({
        eventName: "pull_request",
        payload: pullRequestPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "opened",
        deliveryId,
        eventName: "pull_request",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.syncGitHubRepositoriesForWebhook).not.toHaveBeenCalled();
    expect(repositorySyncMocks.triggerRepoScanForWebhook).not.toHaveBeenCalled();
    expectSafeResponseText(responseText, rawBody);
  });

  test("rejects unsigned requests with a generic safe 400", async () => {
    const rawBody = JSON.stringify(pullRequestPayload());
    const request = createRequest({
      eventName: "pull_request",
      payload: pullRequestPayload(),
      rawBody,
    });
    request.headers.delete("x-hub-signature-256");
    const response = await post(request);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expectSafeResponseText(responseText, rawBody);
  });

  test("rejects invalid signatures with a generic safe 400", async () => {
    const rawBody = JSON.stringify(pullRequestPayload());
    const response = await post(
      createRequest({
        eventName: "pull_request",
        payload: pullRequestPayload(),
        rawBody,
        signature: `sha256=${"0".repeat(64)}`,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expectSafeResponseText(responseText, rawBody);
  });

  test("accepts default branch push webhooks and debounces through the repo scan service", async () => {
    const rawBody = JSON.stringify(pushPayload());
    const response = await post(
      createRequest({
        eventName: "push",
        payload: pushPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "pushed",
        deliveryId,
        eventName: "push",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.createDrizzleRepoScanStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(repositorySyncMocks.triggerRepoScanForWebhook).toHaveBeenCalledWith({
      deliveryId,
      githubInstallationId: 42,
      reason: "default_branch_push",
      repository: expect.objectContaining({
        defaultBranch: "main",
        fullName: "acme/control-plane",
        name: "control-plane",
        owner: "acme",
      }),
    });
    expectSafeResponseText(responseText, rawBody);
  });

  test("accepts non-default branch push webhooks without triggering a rescan", async () => {
    const payload = pushPayload({ ref: "refs/heads/feature/webhook-noise" });
    const rawBody = JSON.stringify(payload);
    const response = await post(
      createRequest({
        eventName: "push",
        payload,
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        action: "pushed",
        deliveryId,
        eventName: "push",
        installationId: 42,
        status: "accepted",
      },
      ok: true,
    });
    expect(repositorySyncMocks.triggerRepoScanForWebhook).not.toHaveBeenCalled();
    expectSafeResponseText(responseText, rawBody);
  });

  test("rejects signed malformed JSON with a generic safe 400", async () => {
    const rawBody = `{"secret":"${fakePayloadToken}","body":"Do not expose this PR body text"`;
    const response = await post(
      createRequest({
        eventName: "installation",
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expectSafeResponseText(responseText, rawBody);
  });

  test("rejects placeholder webhook secrets with a generic safe 400", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "<github-webhook-secret-placeholder>";
    const rawBody = JSON.stringify(pullRequestPayload());
    const response = await post(
      createRequest({
        eventName: "pull_request",
        payload: pullRequestPayload(),
        rawBody,
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expectSafeResponseText(responseText, rawBody);
  });
});
