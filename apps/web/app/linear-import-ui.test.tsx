import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { LinearIssueCandidateData } from "../src/linear/sync-issues";

vi.mock("@/src/server/actions", () => ({
  approveManualTaskAction: vi.fn(),
  importLinearIssueCandidateAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const syncedAt = new Date("2026-05-26T11:45:00.000Z");

const candidate = (
  overrides: Partial<LinearIssueCandidateData> & Record<string, unknown> = {},
): LinearIssueCandidateData =>
  ({
    bodySummary: "Improve queue retry copy using metadata from Linear.",
    commentsSummary: "Keep local runner approval before execution.",
    createdAt: syncedAt,
    id: "linear_issue_candidate_1",
    identifier: "ENG-159",
    labels: ["Ready for AI", "Bug"],
    lastSyncedAt: syncedAt,
    linearConnectionId: "linear_connection_1",
    linearIssueId: "linear_issue_159",
    linearUpdatedAt: syncedAt,
    linearWorkspaceId: "linear_workspace_1",
    projectId: "linear_project_1",
    projectName: "Control Plane",
    redactionApplied: false,
    status: "Ready for AI",
    title: "Tune retry copy",
    updatedAt: syncedAt,
    url: "https://linear.app/control-plane/issue/ENG-159/tune-retry-copy",
    workspaceId: "workspace_1",
    ...overrides,
  }) as LinearIssueCandidateData;

const repositories = [
  {
    id: "github_repository_1",
    repositoryFullName: "rory/control-plane",
    repositoryName: "control-plane",
    repositoryOwner: "rory",
  },
  {
    id: "github_repository_2",
    repositoryFullName: "rory/worker",
    repositoryName: "worker",
    repositoryOwner: "rory",
  },
];

const expectNoUnsafeImportSurfaceMaterial = (html: string) => {
  expect(html).not.toMatch(
    /type=["']file["']|upload|raw source|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
  expect(html).not.toMatch(
    /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands|localPath|stdout|stderr)["']/i,
  );
  expect(html).not.toMatch(/\b(?:Run|Auto-run|Approve to run|Start here)\b/);
};

describe("Linear import UI", () => {
  test("renders candidate rows with explicit target repo selection and Create draft wording", async () => {
    const { LinearImportList } = await import("../components/linear-import-list");
    const html = renderToStaticMarkup(
      createElement(LinearImportList, {
        candidates: [candidate()],
        repositories,
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Import from Linear");
    expect(html).toContain("Ready Linear issue candidates");
    expect(html).toContain("ENG-159");
    expect(html).toContain("Tune retry copy");
    expect(html).toContain("Ready for AI");
    expect(html).toContain("Ready for AI");
    expect(html).toContain("Bug");
    expect(html).toContain("Control Plane");
    expect(html).toContain("Improve queue retry copy using metadata from Linear.");
    expect(html).toContain("Keep local runner approval before execution.");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("rory/worker");
    expect(html).toContain("Create draft");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="linearIssueCandidateId"');
    expect(html).toContain('value="linear_issue_candidate_1"');
    expect(html).toContain('name="repoId"');
    expect(html).toContain('value="github_repository_1"');
    expect(html).toContain('value="github_repository_2"');
    expectNoUnsafeImportSurfaceMaterial(html);
  });

  test("blocks import when no explicit GitHub repository is available", async () => {
    const { LinearImportList } = await import("../components/linear-import-list");
    const html = renderToStaticMarkup(
      createElement(LinearImportList, {
        candidates: [candidate()],
        repositories: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Repository required");
    expect(html).toContain("Create draft");
    expect(html).toContain("disabled");
    expect(html).not.toContain('name="repoId"');
    expectNoUnsafeImportSurfaceMaterial(html);
  });

  test("does not render unsafe candidate fields or raw issue material", async () => {
    const { LinearImportList } = await import("../components/linear-import-list");
    const html = renderToStaticMarkup(
      createElement(LinearImportList, {
        candidates: [
          candidate({
            bodySummary: "diff --git a/app.ts b/app.ts",
            comments: ["SHOULD_NOT_RENDER_COMMENTS"],
            commentsSummary: "stdout: raw command output",
            localPath: "/Users/rory/private/repo",
            patch: "@@ -1 +1 @@",
            rawOutput: "stderr: failed",
            sourceCode: "const leaked = process.env.SECRET;",
            title: "diff --git a/app.ts b/app.ts",
          }),
        ],
        repositories,
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("linear_issue_candidate_1");
    expect(html).not.toContain("SHOULD_NOT_RENDER_COMMENTS");
    expect(html).not.toContain("const leaked");
    expect(html).not.toContain("failed");
    expectNoUnsafeImportSurfaceMaterial(html);
  });

  test("renders empty state without using Linear as a start-here front door", async () => {
    const { LinearImportList } = await import("../components/linear-import-list");
    const html = renderToStaticMarkup(
      createElement(LinearImportList, {
        candidates: [],
        repositories,
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("No ready Linear candidates.");
    expect(html).toContain("Import from Linear");
    expectNoUnsafeImportSurfaceMaterial(html);
  });

  test("adds Import from Linear CTA to the tasks list without replacing manual task creation", async () => {
    const { TaskList } = await import("../components/task-list");
    const html = renderToStaticMarkup(
      createElement(TaskList, {
        tasks: [],
      }),
    );

    expect(html).toContain("Create manual task");
    expect(html).toContain("Import from Linear");
    expect(html).toContain('href="/dashboard/tasks/import-linear"');
    expect(html).not.toContain("Start here");
  });

  test("defines a protected import page that verifies workspace membership before loading candidates", async () => {
    await expectFile("./(app)/dashboard/tasks/import-linear/page.tsx");

    const source = await readAppFile("./(app)/dashboard/tasks/import-linear/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createLinearIssueSyncService");
    expect(source).toContain("createDrizzleLinearIssueSyncStore");
    expect(source).toContain("filterReadyLinearIssueCandidates");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toContain("createDrizzleGitHubRepositoryStore");
    expect(source).toMatch(
      /listLinearIssueCandidates\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/,
    );
    expect(source).toMatch(
      /listGitHubRepositories\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/,
    );
    expect(source).not.toMatch(/listLinearIssueCandidates\(\{\s*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toMatch(
      /<LinearImportList[\s\S]*candidates={readyCandidates}[\s\S]*repositories={safeRepositories}[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}/,
    );
    expect(source).toContain("Import from Linear");
    expect(source).not.toContain("Start here");
    expectNoUnsafeImportSurfaceMaterial(source);
  });
});
