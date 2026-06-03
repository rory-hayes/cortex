import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createDrizzleLinearIssueCandidateImportStore: vi.fn(),
  createLinearIssueCandidateImportService: vi.fn(),
  getDatabase: vi.fn(),
  importLinearIssueCandidate: vi.fn(),
}));

vi.mock("../../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../../src/linear/import-candidates", () => ({
  createDrizzleLinearIssueCandidateImportStore: mocks.createDrizzleLinearIssueCandidateImportStore,
  createLinearIssueCandidateImportService: mocks.createLinearIssueCandidateImportService,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validPostBody = {
  linearIssueCandidateId: "linear_issue_candidate_1",
  repoId: "github_repository_1",
  workspaceId: "workspace_1",
};

const post = async (body: unknown) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/linear/issue-candidates/import", {
      body: JSON.stringify(body),
      method: "POST",
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzleLinearIssueCandidateImportStore.mockReturnValue({ kind: "test-store" });
  mocks.createLinearIssueCandidateImportService.mockReturnValue({
    importLinearIssueCandidate: mocks.importLinearIssueCandidate,
  });
  mocks.importLinearIssueCandidate.mockResolvedValue({
    approvalStatus: "not_requested",
    externalLinkCount: 1,
    repoId: "github_repository_1",
    status: "draft",
    taskId: "cortex_task_1",
    workspaceId: "workspace_1",
  });
});

describe("POST /api/linear/issue-candidates/import", () => {
  test("returns generic 400 for invalid JSON", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("https://control-plane.test/api/linear/issue-candidates/import", {
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
    expect(mocks.importLinearIssueCandidate).not.toHaveBeenCalled();
  });

  test("imports a Linear issue candidate and returns a no-store safe envelope", async () => {
    const response = await post({
      linearIssueCandidateId: " linear_issue_candidate_1 ",
      repoId: " github_repository_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        approvalStatus: "not_requested",
        externalLinkCount: 1,
        repoId: "github_repository_1",
        status: "draft",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(mocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDrizzleLinearIssueCandidateImportStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(mocks.importLinearIssueCandidate).toHaveBeenCalledWith(validPostBody);
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
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
      expect(mocks.importLinearIssueCandidate).not.toHaveBeenCalled();
    },
  );

  test("maps service auth and validation errors to safe envelopes", async () => {
    const { createActionError } = await import("../../../../../src/server/errors");

    mocks.importLinearIssueCandidate.mockRejectedValueOnce(createActionError("unauthenticated"));
    const unauthenticated = await post(validPostBody);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
      },
      ok: false,
    });

    mocks.importLinearIssueCandidate.mockRejectedValueOnce(createActionError("validation_error"));
    const validationError = await post({
      ...validPostBody,
      repoId: "missing_repo",
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
    expect(source).not.toMatch(/body.*console|linearIssueCandidateId.*console|repoId.*console/i);
    expect(source).not.toMatch(/JSON\.stringify\(body\)/);
  });
});
