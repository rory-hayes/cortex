import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type Finding } from "@control-plane/shared";

import type { PersistedFinding } from "../src/repo-readiness/findings";

vi.mock("@/src/server/actions", () => ({
  convertFindingToTaskAction: vi.fn(),
  updateFindingStatusAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const now = "2026-05-26T09:00:00.000Z";

const createFinding = (
  overrides: Partial<Finding> & Record<string, unknown> = {},
): PersistedFinding =>
  ({
    dedupeKey: "fd_0".padEnd(67, "0"),
    finding: {
      category: "validation",
      confidence: 0.94,
      contractVersion: CONTRACT_VERSION,
      createdAt: now,
      deterministicRuleId: "validation.commands.missing",
      evidence: [
        {
          metadata: {
            pathCount: 2,
            ruleKind: "validation-metadata",
          },
          paths: [".aicp/policy.json", ".github/workflows/ci.yml"],
          summary: "Validation command metadata is not configured.",
        },
      ],
      findingId: "finding_1",
      recommendation: "Add explicit validation metadata before enabling local execution.",
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      severity: "high",
      source: "deterministic_rule",
      status: "open",
      summary: "The repository does not declare validation commands for Cortex.",
      title: "Validation commands are missing",
      updatedAt: now,
      workspaceId: "workspace_1",
      ...overrides,
    },
    taskIds: ["cortex_task_1"],
  }) as PersistedFinding;

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

const expectNoUnsafeFindingDisplayMaterial = (source: string) => {
  expect(source).not.toMatch(
    /JSON\.stringify|rawOutput|validationCommands|localPath|sourceCode|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
};

describe("findings list UI", () => {
  test("renders filters, counts, badges, evidence summaries, safe paths, recommendations, task links, and actions", async () => {
    const { FindingList } = await import("../components/finding-list");
    const html = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [
          createFinding(),
          createFinding({
            category: "security",
            findingId: "finding_2",
            repoId: "github_repository_2",
            severity: "blocked",
            status: "deferred",
            title: "Security setup is incomplete",
          }),
        ],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Readiness findings");
    expect(html).toContain("2 findings");
    expect(html).toContain("1 open");
    expect(html).toContain("1 deferred");
    expect(html).toContain("All findings");
    expect(html).toContain("Open");
    expect(html).toContain("Dismissed");
    expect(html).toContain("Deferred");
    expect(html).toContain("Resolved");
    expect(html).toContain("High");
    expect(html).toContain("Blocked");
    expect(html).toContain("Validation");
    expect(html).toContain("Security");
    expect(html).toContain('href="/dashboard/findings?status=open"');
    expect(html).toContain('href="/dashboard/findings?severity=blocked"');
    expect(html).toContain('href="/dashboard/findings?category=validation"');
    expect(html).toContain('href="/dashboard/findings?repo=github_repository_1"');
    expect(html).toContain('href="/dashboard/findings?scan=repo_scan_1"');
    expect(html).toContain("Validation commands are missing");
    expect(html).toContain("The repository does not declare validation commands for Cortex.");
    expect(html).toContain("Validation command metadata is not configured.");
    expect(html).toContain(".aicp/policy.json");
    expect(html).toContain(".github/workflows/ci.yml");
    expect(html).toContain("Add explicit validation metadata before enabling local execution.");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("repo_scan_1");
    expect(html).toContain("1 linked task");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="findingId"');
    expect(html).toContain('value="finding_1"');
    expect(html).toContain('name="status"');
    expect(html).toContain('value="dismissed"');
    expect(html).toContain('value="deferred"');
    expect(html).toContain("Convert to task");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Defer");
    expectNoUnsafeFindingDisplayMaterial(html);
  });

  test("filters rendered rows by selected severity, category, status, repo, and scan", async () => {
    const { FindingList } = await import("../components/finding-list");
    const html = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [
          createFinding({ findingId: "finding_high_validation" }),
          createFinding({
            category: "security",
            findingId: "finding_blocked_security",
            repoId: "github_repository_2",
            scanId: "repo_scan_2",
            severity: "blocked",
            status: "deferred",
            title: "Security setup is incomplete",
          }),
        ],
        repositories,
        selectedFilters: {
          category: "security",
          repoId: "github_repository_2",
          scanId: "repo_scan_2",
          severity: "blocked",
          status: "deferred",
        },
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Showing 1 of 2 findings.");
    expect(html).toContain("Security setup is incomplete");
    expect(html).toContain("rory/worker");
    expect(html).not.toContain("Validation commands are missing");
  });

  test("does not render unsafe extra fields from finding objects", async () => {
    const { FindingList } = await import("../components/finding-list");
    const html = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [
          createFinding({
            diff: "diff --git a/app.ts b/app.ts",
            localPath: "/Users/rory/private/repo",
            patch: "@@ -1 +1 @@",
            rawOutput: "stderr: failed command output",
            sourceCode: "const leaked = process.env.SECRET",
            validationCommands: ["pnpm test -- --verbose"],
          }),
        ],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Validation commands are missing");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("failed command output");
    expect(html).not.toContain("const leaked");
    expect(html).not.toContain("pnpm test -- --verbose");
    expectNoUnsafeFindingDisplayMaterial(html);
  });

  test("does not render unsafe known-field text or paths from hostile finding props", async () => {
    const { FindingList } = await import("../components/finding-list");
    const html = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [
          createFinding({
            evidence: [
              {
                metadata: {},
                paths: ["/Users/rory/private/repo/src/app.ts", "apps/web/.env.local"],
                summary: "```ts\nconst leakedEvidence = true;\n```",
              },
            ],
            recommendation: "Review https://user:repo-secret-token@example.test/private.git",
            summary: "stdout: raw validation output must not render",
            title: "diff --git a/app.ts b/app.ts",
          }),
        ],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("finding_1");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("raw validation output");
    expect(html).not.toContain("leakedEvidence");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain(".env.local");
    expect(html).not.toContain("repo-secret-token");
    expectNoUnsafeFindingDisplayMaterial(html);
  });

  test("renders a clear empty state when there are no findings or filters match nothing", async () => {
    const { FindingList } = await import("../components/finding-list");
    const emptyHtml = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(emptyHtml).toContain("No findings yet.");
    expect(emptyHtml).toContain("Run a repo readiness scan");
    expect(emptyHtml).toContain('href="/dashboard/repositories"');

    const filteredHtml = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [createFinding()],
        repositories,
        selectedFilters: {
          severity: "blocked",
        },
        workspaceId: "workspace_1",
      }),
    );

    expect(filteredHtml).toContain("No findings match this filter.");
    expect(filteredHtml).toContain('href="/dashboard/findings"');
  });

  test("loads findings only after selected workspace membership is verified", async () => {
    await expectFile("./(app)/dashboard/findings/page.tsx");

    const source = await readAppFile("./(app)/dashboard/findings/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createRepoFindingService");
    expect(source).toContain("createDrizzleRepoFindingStore");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toContain("createDrizzleGitHubRepositoryStore");
    expect(source).toMatch(/listFindings\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/);
    expect(source).toMatch(
      /listGitHubRepositories\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/,
    );
    expect(source).not.toMatch(/listFindings\(\{\s*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toMatch(
      /<FindingList[\s\S]*findings={findings}[\s\S]*repositories={githubRepositories}[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}/,
    );
    expectNoUnsafeFindingDisplayMaterial(source);
  });

  test("adds Findings to the authenticated dashboard navigation", async () => {
    const navSource = await readAppFile("../components/nav.tsx");
    const shellTestSource = await readAppFile("./navigation-shell.test.ts");

    expect(navSource).toContain('label: "Findings"');
    expect(navSource).toContain('href: "/dashboard/findings"');
    expect(shellTestSource).toContain('label: "Findings"');
    expect(shellTestSource).toContain('route: "./(app)/dashboard/findings/page.tsx"');
  });
});
