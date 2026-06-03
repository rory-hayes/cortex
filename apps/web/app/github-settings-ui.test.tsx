import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { GitHubAppInstallationData } from "../src/github/installations";
import type { GitHubRepositoryData } from "../src/github/repositories";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const unsafeBoundaryPattern =
  /diff --git|raw source|source code|patch text|code snippet|raw log|raw output|stdout|stderr|private key|access token|client secret|api key|password/i;

const mutationActionPattern =
  /<form|connect github|disconnect|install github app|create installation|delete installation|sync now|refresh repositories/i;

const createInstallation = (
  overrides: Partial<GitHubAppInstallationData> = {},
): GitHubAppInstallationData =>
  ({
    accountHtmlUrl: "https://github.example.test/control-plane",
    accountId: "9001",
    accountLogin: "control-plane",
    accountType: "Organization",
    createdAt: new Date("2026-05-24T14:00:00.000Z"),
    githubInstallationId: "123456",
    id: "github_app_installation_1",
    installationHtmlUrl: "https://github.example.test/apps/aicp/installations/123456",
    lastSyncedAt: new Date("2026-05-24T16:15:00.000Z"),
    permissions: {
      contents: "read",
      metadata: "read",
    },
    repositorySelection: "selected",
    suspendedAt: null,
    updatedAt: new Date("2026-05-24T16:15:00.000Z"),
    workspaceId: "workspace_1",
    ...overrides,
  }) satisfies GitHubAppInstallationData;

const createRepository = (overrides: Partial<GitHubRepositoryData> = {}): GitHubRepositoryData =>
  ({
    archived: false,
    createdAt: new Date("2026-05-24T15:00:00.000Z"),
    defaultBranch: "main",
    disabled: false,
    githubAppInstallationId: "github_app_installation_1",
    githubInstallationId: "123456",
    htmlUrl: "https://github.example.test/control-plane/app",
    id: "github_repository_1",
    isPrivate: true,
    lastSyncedAt: new Date("2026-05-24T16:20:00.000Z"),
    matchedRepoMappingId: "repo_mapping_1",
    repositoryExternalId: "8001",
    repositoryFullName: "control-plane/app",
    repositoryName: "app",
    repositoryOwner: "control-plane",
    updatedAt: new Date("2026-05-24T16:20:00.000Z"),
    visibility: "private",
    workspaceId: "workspace_1",
    ...overrides,
  }) satisfies GitHubRepositoryData;

const expectNoUnsafeOrMutationMaterial = (htmlOrSource: string) => {
  expect(htmlOrSource).not.toMatch(unsafeBoundaryPattern);
  expect(htmlOrSource).not.toMatch(mutationActionPattern);
};

describe("GitHub settings UI", () => {
  test("renders empty GitHub visibility state without mutation controls", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [],
        repositories: [],
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("GitHub visibility");
    expect(html).toContain("Control Plane");
    expect(html).toContain("metadata-only");
    expect(html).toContain("does not execute code in v1");
    expect(html).toContain("0 installations");
    expect(html).toContain("0 active");
    expect(html).toContain("0 suspended");
    expect(html).toContain("0 synced repositories");
    expect(html).toContain("0 matched to local mappings");
    expect(html).toContain("No GitHub App installations synced");
    expect(html).toContain("No synced GitHub repositories");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("renders active and suspended installation status with safe permission summaries", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [
          createInstallation(),
          createInstallation({
            accountLogin: "legacy-team",
            accountType: "User",
            githubInstallationId: "123457",
            id: "github_app_installation_2",
            installationHtmlUrl: null,
            lastSyncedAt: new Date("2026-05-24T15:30:00.000Z"),
            permissions: {
              checks: "read",
            },
            repositorySelection: "all",
            suspendedAt: new Date("2026-05-24T15:45:00.000Z"),
          }),
        ],
        repositories: [],
      }),
    );

    expect(html).toContain("2 installations");
    expect(html).toContain("1 active");
    expect(html).toContain("1 suspended");
    expect(html).toContain("control-plane");
    expect(html).toContain("Organization");
    expect(html).toContain("Active");
    expect(html).toContain("Selected repositories");
    expect(html).toContain("2 permissions");
    expect(html).toContain("contents read");
    expect(html).toContain("metadata read");
    expect(html).toContain("Open installation");
    expect(html).toContain("legacy-team");
    expect(html).toContain("User");
    expect(html).toContain("Suspended");
    expect(html).toContain("All repositories");
    expect(html).toContain("1 permission");
    expect(html).toContain("checks read");
    expect(html).toContain("Synced May");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("renders GitHub App scan-only and setup PR permission review", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [createInstallation()],
        repositories: [],
      }),
    );

    expect(html).toContain("Repository scan permissions");
    expect(html).toContain("Scan-only ready");
    expect(html).toContain("Scan-only does not require a runner");
    expect(html).toContain("Setup PR needs permission upgrade");
    expect(html).toContain("Missing contents write");
    expect(html).toContain("Missing pull requests write");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("does not mark scan-only ready when a write grant only exceeds the read requirement", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [
          createInstallation({
            permissions: {
              contents: "write",
              metadata: "read",
            },
          }),
        ],
        repositories: [],
      }),
    );

    expect(html).toContain("Scan-only needs permission upgrade");
    expect(html).not.toContain("Scan-only ready");
    expect(html).toContain("contents write exceeds scan-only read access");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("blocks scan-only readiness when rejected MVP permissions are granted at read level", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [
          createInstallation({
            permissions: {
              administration: "read",
              contents: "read",
              metadata: "read",
              secrets: "read",
            },
          }),
        ],
        repositories: [],
      }),
    );

    expect(html).toContain("Scan-only blocked by rejected permissions");
    expect(html).not.toContain("Scan-only ready");
    expect(html).toContain("Rejected MVP permissions");
    expect(html).toContain("Repository administration read");
    expect(html).toContain("Repository secrets read");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("omits hostile stored permission fields from rendered settings", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [
          createInstallation({
            permissions: {
              command: "write",
              contents: "read",
              metadata: "read",
              patch: "write",
              password: "write",
              passwd: "write",
              raw_output: "write",
              token: "ghp_should_not_render",
            },
          }),
        ],
        repositories: [],
      }),
    );

    expect(html).toContain("2 permissions");
    expect(html).toContain("contents read");
    expect(html).toContain("metadata read");
    expect(html).not.toContain("patch write");
    expect(html).not.toContain("password write");
    expect(html).not.toContain("passwd write");
    expect(html).not.toContain("raw output write");
    expect(html).not.toContain("ghp_should_not_render");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("renders least-privilege warnings for extra write and admin installation grants", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [
          createInstallation({
            permissions: {
              administration: "admin",
              checks: "write",
              contents: "write",
              metadata: "read",
              pull_requests: "write",
            },
          }),
        ],
        repositories: [],
      }),
    );

    expect(html).toContain("Scan-only needs permission upgrade");
    expect(html).toContain("Setup PR ready");
    expect(html).toContain("Least-privilege warnings");
    expect(html).toContain("administration admin is not required for scan-only");
    expect(html).toContain("checks write is not required for scan-only");
    expect(html).toContain("contents write exceeds scan-only read access");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("renders synced repository metadata, visibility, mapping status, and last sync time", async () => {
    const { GitHubSettings } = await import("../components/github-settings");

    const html = renderToStaticMarkup(
      createElement(GitHubSettings, {
        installations: [createInstallation()],
        repositories: [
          createRepository(),
          createRepository({
            archived: true,
            defaultBranch: "trunk",
            htmlUrl: "https://github.example.test/control-plane/docs",
            id: "github_repository_2",
            isPrivate: false,
            matchedRepoMappingId: null,
            repositoryExternalId: "8002",
            repositoryFullName: "control-plane/docs",
            repositoryName: "docs",
            visibility: "public",
          }),
          createRepository({
            defaultBranch: "stable",
            disabled: true,
            htmlUrl: "https://github.example.test/control-plane/internal-tool",
            id: "github_repository_3",
            isPrivate: false,
            matchedRepoMappingId: "repo_mapping_3",
            repositoryExternalId: "8003",
            repositoryFullName: "control-plane/internal-tool",
            repositoryName: "internal-tool",
            visibility: "internal",
          }),
        ],
      }),
    );

    expect(html).toContain("3 synced repositories");
    expect(html).toContain("2 matched to local mappings");
    expect(html).toContain("Repository");
    expect(html).toContain("Visibility");
    expect(html).toContain("Default branch");
    expect(html).toContain("Repository state");
    expect(html).toContain("Local mapping");
    expect(html).toContain("Last sync");
    expect(html).toContain("control-plane/app");
    expect(html).toContain("Private");
    expect(html).toContain("main");
    expect(html).toContain("Active");
    expect(html).toContain("Matched");
    expect(html).toContain("control-plane/docs");
    expect(html).toContain("Public");
    expect(html).toContain("trunk");
    expect(html).toContain("Archived");
    expect(html).toContain("Unmatched");
    expect(html).toContain("control-plane/internal-tool");
    expect(html).toContain("Internal");
    expect(html).toContain("stable");
    expect(html).toContain("Disabled");
    expect(html).toContain("Synced May");
    expectNoUnsafeOrMutationMaterial(html);
  });

  test("defines a server GitHub settings component using existing UI primitives", async () => {
    await expectFile("../components/github-settings.tsx");

    const source = await readAppFile("../components/github-settings.tsx");

    expect(source.trimStart()).not.toMatch(/^"use client";/);
    expect(source).toContain("GitHubAppInstallationData");
    expect(source).toContain("GitHubRepositoryData");
    expect(source).toContain("reviewGitHubAppPermissions");
    expect(source).not.toContain("reviewGitHubAppRepositoryScanPermissions");
    expect(source).toMatch(/installations:\s*GitHubAppInstallationData\[\];/);
    expect(source).toMatch(/repositories:\s*GitHubRepositoryData\[\];/);
    expect(source).toMatch(/workspaceName\?:\s*string;/);
    expect(source).toContain('import { Badge } from "@/components/ui/badge";');
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain('from "@/components/ui/table"');
    expect(source).toContain("metadata-only");
    expect(source).toContain("does not execute code in v1");
    expect(source).toContain("Scan-only does not require a runner");
    expect(source).toContain("installation.suspendedAt");
    expect(source).toContain("installation.permissions");
    expect(source).toContain("repository.repositoryFullName");
    expect(source).toContain("repository.defaultBranch");
    expect(source).toContain("repository.archived");
    expect(source).toContain("repository.disabled");
    expect(source).toContain("repository.matchedRepoMappingId");
    expectNoUnsafeOrMutationMaterial(source);
  });

  test("loads GitHub metadata only after selected workspace membership is verified", async () => {
    await expectFile("./(app)/dashboard/settings/github/page.tsx");

    const source = await readAppFile("./(app)/dashboard/settings/github/page.tsx");
    const selectWorkspaceIndex = source.indexOf(
      "selectWorkspace({ workspaceId: cookieWorkspaceId })",
    );
    const installationsIndex = source.indexOf("listGitHubInstallations({");
    const repositoriesIndex = source.indexOf("listGitHubRepositories({");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createDrizzleWorkspaceMutationStore");
    expect(source).toContain("createWorkspaceMutationService");
    expect(source).toContain("createDrizzleGitHubInstallationStore");
    expect(source).toContain("createGitHubInstallationService");
    expect(source).toContain("createDrizzleGitHubRepositoryStore");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toContain("const verifiedWorkspace");
    expect(selectWorkspaceIndex).toBeGreaterThanOrEqual(0);
    expect(installationsIndex).toBeGreaterThan(selectWorkspaceIndex);
    expect(repositoriesIndex).toBeGreaterThan(selectWorkspaceIndex);
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(
      /listGitHubInstallations\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).toMatch(
      /listGitHubRepositories\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /listGitHubInstallations\(\{\s*workspaceId: cookieWorkspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /listGitHubRepositories\(\{\s*workspaceId: cookieWorkspaceId,?\s*\}\)/,
    );
    expect(source).toMatch(
      /Promise\.all\(\[[\s\S]*listGitHubInstallations[\s\S]*listGitHubRepositories/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toContain('href="/workspaces"');
    expect(source).toMatch(
      /<GitHubSettings[\s\S]*installations={installations}[\s\S]*repositories={repositories}[\s\S]*workspaceName={verifiedWorkspace\.name}/,
    );
    expectNoUnsafeOrMutationMaterial(source);
  });

  test("links settings landing users to metadata-only GitHub visibility", async () => {
    const source = await readAppFile("./(app)/dashboard/settings/page.tsx");

    expect(source).toContain('href="/dashboard/settings/github"');
    expect(source).toContain("GitHub connection");
    expect(source).toContain("metadata-only visibility");
    expect(source).toContain("local runners still execute code");
    expect(source).not.toMatch(/GitHub execution|execute through GitHub|merge through GitHub/i);
    expectNoUnsafeOrMutationMaterial(source);
  });
});
