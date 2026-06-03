import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { RepoMappingData } from "../src/repo-mappings/repo-mappings";
import type { GitHubRepositoryData } from "../src/github/repositories";

vi.mock("@/src/server/actions", () => ({
  deleteRepoMappingAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const expectNoUnsafeRepoMappingDisplayMaterial = (source: string) => {
  expect(source).not.toMatch(
    /policySnapshot|validationCommands|JSON\.stringify|\bdiff\b|\bpatch\b|\bsnippet\b|secret|token/i,
  );
};

const createMapping = (overrides: Partial<RepoMappingData> = {}) =>
  ({
    archivedAt: null,
    createdAt: new Date("2026-05-22T10:00:00.000Z"),
    defaultBranch: "main",
    githubInstallationId: null,
    id: "repo_mapping_1",
    localPath: "/Users/rory/repos/control-plane",
    policyStatus: "ready",
    policySummary: {
      maxChangedFiles: 20,
      protectedPathCount: 2,
      sensitivePathCount: 3,
      untrackedFiles: "blocked",
      warningPathCount: 6,
    },
    provider: "github",
    remoteUrl: "https://git.example.com/mirror.git",
    repositoryExternalId: null,
    repositoryName: "control-plane",
    repositoryOwner: "rory",
    runnerId: "runner_local_1",
    updatedAt: new Date("2026-05-22T12:00:00.000Z"),
    validationCommandCount: 2,
    validationSummary: {
      labels: ["Typecheck", "Unit tests"],
      optionalCount: 0,
      requiredCount: 2,
    },
    workspaceId: "workspace_1",
    ...overrides,
  }) satisfies RepoMappingData;

const createGitHubRepository = (
  overrides: Partial<GitHubRepositoryData> = {},
): GitHubRepositoryData =>
  ({
    archived: false,
    createdAt: new Date("2026-05-24T15:00:00.000Z"),
    defaultBranch: "main",
    disabled: false,
    githubAppInstallationId: "github_app_installation_1",
    githubInstallationId: "42",
    htmlUrl: "https://github.example.test/rory/control-plane",
    id: "github_repository_1",
    isPrivate: true,
    lastSyncedAt: new Date("2026-05-24T16:00:00.000Z"),
    matchedRepoMappingId: "repo_mapping_1",
    repositoryExternalId: "9001",
    repositoryFullName: "rory/control-plane",
    repositoryName: "control-plane",
    repositoryOwner: "rory",
    updatedAt: new Date("2026-05-24T16:00:00.000Z"),
    visibility: "private",
    workspaceId: "workspace_1",
    ...overrides,
  }) satisfies GitHubRepositoryData;

describe("repo mapping UI source conventions", () => {
  test("renders repository rows with owner/name and runner-scoped mapping metadata", async () => {
    const { RepoMappingTable } = await import("../components/repo-mapping-table");
    const mapping = createMapping();
    const githubRepository = createGitHubRepository();

    const html = renderToStaticMarkup(
      createElement(RepoMappingTable, {
        githubRepositories: [githubRepository],
        repoMappings: [mapping],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("rory/control-plane");
    expect(html).toContain("runner_local_1");
    expect(html).toContain("/Users/rory/repos/control-plane");
    expect(html).toContain("https://git.example.com/mirror.git");
    expect(html).toContain("main");
    expect(html).toContain("Ready");
    expect(html).toContain("2 validation commands");
    expect(html).toContain("2 protected paths");
    expect(html).toContain("3 sensitive paths");
    expect(html).toContain("6 warning paths");
    expect(html).toContain("Max 20 files");
    expect(html).toContain("Untracked blocked");
    expect(html).toContain("2 required");
    expect(html).toContain("Typecheck");
    expect(html).toContain("Unit tests");
    expect(html).toContain("GitHub visibility");
    expect(html).toContain("Private");
    expect(html).toContain("Matched");
    expect(html).toContain("Synced May");
    expect(html).toContain("Archive");
  });

  test("renders unmatched synced GitHub repositories without requiring local mappings", async () => {
    const { RepoMappingTable } = await import("../components/repo-mapping-table");

    const html = renderToStaticMarkup(
      createElement(RepoMappingTable, {
        githubRepositories: [
          createGitHubRepository({
            id: "github_repository_unmatched",
            isPrivate: false,
            matchedRepoMappingId: null,
            repositoryFullName: "rory/unmapped",
            repositoryName: "unmapped",
            visibility: "public",
          }),
        ],
        repoMappings: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("1 synced GitHub repository");
    expect(html).toContain("0 matched to local mappings");
    expect(html).toContain("rory/unmapped");
    expect(html).toContain("Public");
    expect(html).toContain("Unmatched");
  });

  test("renders summary counts, status filters, and filtered empty state", async () => {
    const { RepoMappingTable } = await import("../components/repo-mapping-table");
    const readyMapping = createMapping({
      id: "repo_mapping_ready",
      policyStatus: "ready",
      repositoryName: "ready-service",
    });
    const missingValidationMapping = createMapping({
      id: "repo_mapping_missing_validation",
      policyStatus: "missing_validation",
      repositoryName: "needs-validation",
      validationCommandCount: 0,
      validationSummary: {
        labels: [],
        optionalCount: 0,
        requiredCount: 0,
      },
    });
    const notReportedMapping = createMapping({
      id: "repo_mapping_not_reported",
      policyStatus: "not_reported",
      policySummary: {
        maxChangedFiles: null,
        protectedPathCount: 0,
        sensitivePathCount: 0,
        untrackedFiles: "not_reported",
        warningPathCount: 0,
      },
      repositoryName: "policy-pending",
      validationCommandCount: 0,
      validationSummary: {
        labels: [],
        optionalCount: 0,
        requiredCount: 0,
      },
    });

    const html = renderToStaticMarkup(
      createElement(RepoMappingTable, {
        policyStatusFilter: "ready",
        repoMappings: [readyMapping, missingValidationMapping, notReportedMapping],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("3 mapped repositories");
    expect(html).toContain("Ready 1");
    expect(html).toContain("Missing validation 1");
    expect(html).toContain("Not reported 1");
    expect(html).toContain("status=ready");
    expect(html).toContain("status=missing_validation");
    expect(html).toContain("status=not_reported");
    expect(html).toContain("Showing 1 of 3 mappings");
    expect(html).toContain("ready-service");
    expect(html).not.toContain("needs-validation");
    expect(html).not.toContain("policy-pending");

    const emptyHtml = renderToStaticMarkup(
      createElement(RepoMappingTable, {
        policyStatusFilter: "missing_validation",
        repoMappings: [readyMapping],
        workspaceId: "workspace_1",
      }),
    );

    expect(emptyHtml).toContain("No repositories match this filter.");
    expect(emptyHtml).toContain("Clear filters");
  });

  test("renders empty state with local runner setup guidance", async () => {
    const { RepoMappingTable } = await import("../components/repo-mapping-table");

    const html = renderToStaticMarkup(
      createElement(RepoMappingTable, {
        repoMappings: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("No repositories mapped.");
    expect(html).toContain("control-plane-runner repos add --path /absolute/path/to/repo");
  });

  test("loads mappings only after selected workspace membership is verified", async () => {
    const source = await readAppFile("./(app)/dashboard/repositories/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createRepoMappingService");
    expect(source).toContain("createDrizzleRepoMappingStore");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toContain("createDrizzleGitHubRepositoryStore");
    expect(source).toContain("createRepoScanService");
    expect(source).toContain("createDrizzleRepoScanStore");
    expect(source).toContain("RepoScanProgress");
    expect(source).toMatch(
      /listRepoMappings\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).toMatch(
      /listGitHubRepositories\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).toMatch(/listRepoScans\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/);
    expect(source).not.toMatch(
      /repoMappingService\s*\.\s*listRepoMappings\(\{\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).not.toMatch(
      /githubRepositoryService\s*\.\s*listGitHubRepositories\(\{\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toContain("Source code stays local");
    expect(source).toContain("Runner executes locally");
    expect(source).toContain("searchParams");
    expect(source).toContain("policyStatusFilter");
    expect(source).toMatch(
      /<RepoMappingTable[\s\S]*githubRepositories={githubRepositories}[\s\S]*repoMappings={repoMappings}[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}/,
    );
    expect(source).toMatch(/<RepoScanProgress[\s\S]*scans={repoScans}/);
    expectNoUnsafeRepoMappingDisplayMaterial(source);
  });

  test("renders safe repo mapping table columns, empty state, and archive form", async () => {
    await expectFile("../components/repo-mapping-table.tsx");

    const source = await readAppFile("../components/repo-mapping-table.tsx");

    expect(source.trimStart()).not.toMatch(/^"use client";/);
    expect(source).toContain("RepoMappingData");
    expect(source).toContain('from "@/src/repo-mappings/repo-mappings";');
    expect(source).toContain('import { Badge } from "@/components/ui/badge";');
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain('from "@/components/ui/table"');
    expect(source).toContain("Runner");
    expect(source).toContain("Local path");
    expect(source).toContain("Remote");
    expect(source).toContain("GitHub visibility");
    expect(source).toContain("Branch");
    expect(source).toContain("Policy");
    expect(source).toContain("Actions");
    expect(source).toContain("mapping.runnerId");
    expect(source).toContain("mapping.repositoryOwner");
    expect(source).toContain("mapping.repositoryName");
    expect(source).toContain("mapping.localPath");
    expect(source).toContain("mapping.remoteUrl");
    expect(source).toContain("githubRepositories");
    expect(source).toContain("matchedRepoMappingId");
    expect(source).toContain("No remote reported");
    expect(source).toContain("mapping.defaultBranch");
    expect(source).toContain("mapping.policyStatus");
    expect(source).toContain("mapping.validationCommandCount");
    expect(source).toContain("control-plane-runner repos add --path /absolute/path/to/repo");
    expect(source).toContain("deleteRepoMappingAction");
    expect(source).toContain('name="workspaceId"');
    expect(source).toContain("value={workspaceId}");
    expect(source).toContain('name="repoMappingId"');
    expect(source).toContain("value={mapping.id}");
    expect(source).toMatch(/<Button[\s\S]*Archive/);
    expect(source).toMatch(/font-mono[\s\S]*break-all/);
    expectNoUnsafeRepoMappingDisplayMaterial(source);
  });
});
