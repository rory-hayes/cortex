import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createDrizzleRepoScanStore: vi.fn(),
  createRepoScanService: vi.fn(),
  getRepoScanStatus: vi.fn(),
  getDatabase: vi.fn(),
  triggerRepoScan: vi.fn(),
}));

vi.mock("../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../src/repo-readiness/repo-scans", () => ({
  createDrizzleRepoScanStore: mocks.createDrizzleRepoScanStore,
  createRepoScanService: mocks.createRepoScanService,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validPostBody = {
  repoId: "github_repository_1",
  workspaceId: "workspace_1",
};
const validPostBodyWithGoal = {
  productGoal: "Build a hosted control room for safe AI-assisted engineering readiness.",
  repoId: "github_repository_1",
  workspaceId: "workspace_1",
};

const post = async (body: unknown) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/repo-readiness/scans", {
      body: JSON.stringify(body),
      method: "POST",
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzleRepoScanStore.mockReturnValue({ kind: "test-store" });
  mocks.createRepoScanService.mockReturnValue({
    getRepoScanStatus: mocks.getRepoScanStatus,
    triggerRepoScan: mocks.triggerRepoScan,
  });
  mocks.getRepoScanStatus.mockResolvedValue({
    blockedFindingCount: 1,
    createdAt: "2026-05-25T10:00:00.000Z",
    findingCount: 2,
    inventoryCounts: {
      ciProviderCount: 1,
      documentationCount: 1,
      dryRunCheckCount: 11,
      hasPolicyFile: true,
      languageCount: 1,
      omittedFileCount: 0,
      packageManagerCount: 1,
      presentDocumentationCount: 1,
      protectedPathCount: 2,
      scannedFileCount: 12,
      sensitivePathCount: 3,
      totalDirectoryCount: 4,
      totalFileCount: 12,
      validationCommandCount: 4,
    },
    moduleStatuses: [
      {
        finishedAt: "2026-05-25T10:01:00.000Z",
        id: "github_inventory",
        label: "GitHub inventory",
        metadata: { languageCount: 1 },
        order: 0,
        required: true,
        startedAt: "2026-05-25T10:00:00.000Z",
        status: "passed",
        summary: "Metadata-only GitHub inventory completed.",
      },
    ],
    openFindingCount: 1,
    readinessReportId: "readiness_report_1",
    readinessReportStatus: "available",
    repoId: "github_repository_1",
    scanId: "repo_scan_1",
    status: "running",
    statusSummary: "Repo readiness scan is running.",
    taskRecommendationCount: 3,
    updatedAt: "2026-05-25T10:01:00.000Z",
    workspaceId: "workspace_1",
  });
  mocks.triggerRepoScan.mockResolvedValue({
    created: true,
    repoId: "github_repository_1",
    scanId: "repo_scan_1",
    status: "queued",
    workspaceId: "workspace_1",
  });
});

describe("GET /api/repo-readiness/scans", () => {
  test("returns latest scan status by repo id with a no-store safe envelope", async () => {
    const { GET } = await importRoute();
    const response = await GET(
      new Request(
        "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&repoId=github_repository_1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({
        blockedFindingCount: 1,
        findingCount: 2,
        inventoryCounts: expect.objectContaining({
          languageCount: 1,
          totalFileCount: 12,
        }),
        moduleStatuses: [
          expect.objectContaining({
            id: "github_inventory",
            status: "passed",
          }),
        ],
        openFindingCount: 1,
        readinessReportId: "readiness_report_1",
        readinessReportStatus: "available",
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "running",
        statusSummary: "Repo readiness scan is running.",
        taskRecommendationCount: 3,
        workspaceId: "workspace_1",
      }),
      ok: true,
    });
    expect(mocks.getRepoScanStatus).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
  });

  test("returns scan status by scan id", async () => {
    const { GET } = await importRoute();
    const response = await GET(
      new Request(
        "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&scanId=repo_scan_1",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getRepoScanStatus).toHaveBeenCalledWith({
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
  });

  test("returns generic validation error when scan status is not found", async () => {
    const { GET } = await importRoute();
    mocks.getRepoScanStatus.mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&scanId=repo_scan_missing",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
  });

  test.each([
    "https://control-plane.test/api/repo-readiness/scans?repoId=github_repository_1",
    "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1",
    "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&repoId=github_repository_1&scanId=repo_scan_1",
    "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&repoId=github_repository_1&rawOutput=diff%20--git",
    "https://control-plane.test/api/repo-readiness/scans?workspace_id=workspace_1&repoId=github_repository_1",
  ])("rejects invalid query %s without calling the service", async (url) => {
    const { GET } = await importRoute();
    const response = await GET(new Request(url));
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("diff --git");
    expect(responseText).not.toContain("rawOutput");
    expect(mocks.getRepoScanStatus).not.toHaveBeenCalled();
  });

  test("maps service errors to safe status envelopes without echoing query values", async () => {
    const { GET } = await importRoute();
    const { createActionError } = await import("../../../../src/server/errors");

    mocks.getRepoScanStatus.mockRejectedValueOnce(createActionError("forbidden"));
    const forbidden = await GET(
      new Request(
        "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&repoId=github_repository_1",
      ),
    );
    expect(forbidden.status).toBe(403);

    mocks.getRepoScanStatus.mockRejectedValueOnce(createActionError("validation_error"));
    const validationError = await GET(
      new Request(
        "https://control-plane.test/api/repo-readiness/scans?workspaceId=workspace_1&scanId=repo_scan_unsafe",
      ),
    );
    const responseText = await validationError.text();
    expect(validationError.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("repo_scan_unsafe");
  });
});

describe("POST /api/repo-readiness/scans", () => {
  test("returns generic 400 for invalid JSON", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("https://control-plane.test/api/repo-readiness/scans", {
        body: "{",
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(mocks.triggerRepoScan).not.toHaveBeenCalled();
  });

  test("queues a scan and returns a no-store safe envelope", async () => {
    const response = await post({
      productGoal: " Build a hosted control room for safe AI-assisted engineering readiness. ",
      repoId: " github_repository_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "queued",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(mocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDrizzleRepoScanStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.triggerRepoScan).toHaveBeenCalledWith(validPostBodyWithGoal);
  });

  test("returns 200 when an active scan is debounced", async () => {
    mocks.triggerRepoScan.mockResolvedValueOnce({
      created: false,
      repoId: "github_repository_1",
      scanId: "repo_scan_existing",
      status: "running",
      workspaceId: "workspace_1",
    });

    const response = await post(validPostBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        repoId: "github_repository_1",
        scanId: "repo_scan_existing",
        status: "running",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
    { field: "secret", value: "ghp_scantriggersecret1234567890" },
  ])(
    "rejects unsafe payload field $field without echoing the request body",
    async ({ field, value }) => {
      const response = await post({
        ...validPostBody,
        [field]: value,
      });
      const responseText = await response.text();

      expect(response.status).toBe(400);
      expect(JSON.parse(responseText)).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(responseText).not.toContain(value);
      expect(responseText).not.toMatch(new RegExp(field, "i"));
      expect(mocks.triggerRepoScan).not.toHaveBeenCalled();
    },
  );

  test.each([
    { field: "repo-id", value: "diff --git a/app.ts b/app.ts" },
    { field: "workspace_id", value: "ghp_scantriggersecret1234567890" },
  ])("rejects normalized alias field $field instead of ignoring it", async ({ field, value }) => {
    const response = await post({
      ...validPostBody,
      [field]: value,
    });
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain(value);
    expect(mocks.triggerRepoScan).not.toHaveBeenCalled();
  });

  test("maps service errors to safe envelopes without echoing request values", async () => {
    const { createActionError } = await import("../../../../src/server/errors");

    mocks.triggerRepoScan.mockRejectedValueOnce(createActionError("forbidden"));
    const forbidden = await post(validPostBody);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
      ok: false,
    });

    mocks.triggerRepoScan.mockRejectedValueOnce(createActionError("validation_error"));
    const validationError = await post({
      repoId: "missing_repo",
      workspaceId: "workspace_1",
    });
    const responseText = await validationError.text();
    expect(validationError.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("missing_repo");
  });

  test("does not log request bodies or unsafe values in route source", async () => {
    const source = await readRouteSource();

    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(/body.*console|repoId.*console|workspaceId.*console/i);
    expect(source).not.toMatch(/JSON\.stringify\(body\)/);
  });
});
