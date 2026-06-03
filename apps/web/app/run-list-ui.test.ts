import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { RunListItem } from "../src/runs/list";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const createRun = (overrides: Partial<RunListItem> & Record<string, unknown> = {}): RunListItem =>
  ({
    id: "run_1",
    mode: "execute",
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
    review: {
      blockerCount: 0,
      changedFileCount: 2,
      prReady: true,
      riskCategoryCounts: [{ category: "package_lock", count: 1 }],
      stateBucket: "pr_ready",
      validationStatusCounts: [{ count: 1, status: "passed" }],
      warningCount: 1,
    },
    runner: {
      displayName: "Mac Studio",
      id: "runner_1",
    },
    state: "pr_opened",
    task: {
      id: "task_1",
      title: "Add run list page",
    },
    updatedAt: new Date("2026-05-23T10:30:00.000Z"),
    ...overrides,
  }) as RunListItem;

const expectNoUnsafeRunDisplayMaterial = (source: string) => {
  expect(source).not.toMatch(
    /taskPacket|objective|acceptanceCriteria|contextFilePaths|policySnapshot|validationCommands|changedPaths|riskFindings|rawLogs|rawOutput|diff|patch|snippet|sourceCode|localPath|credential/i,
  );
};

describe("run list UI", () => {
  test("renders dense run metadata, review evidence counts, queue bucket, and safe PR link", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(createElement(RunTable, { runs: [createRun()] }));

    expect(html).toContain("Run");
    expect(html).toContain("Status");
    expect(html).toContain("Task");
    expect(html).toContain("Runner");
    expect(html).toContain("Repository mapping");
    expect(html).toContain("Updated");
    expect(html).toContain("PR");
    expect(html).toContain("run_1");
    expect(html).toContain("PR opened");
    expect(html).toContain("PR-ready");
    expect(html).toContain("Execute");
    expect(html).toContain("Add run list page");
    expect(html).toContain("task_1");
    expect(html).toContain("Mac Studio");
    expect(html).toContain("runner_1");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("repo_mapping_1");
    expect(html).toContain("May 23, 2026");
    expect(html).toContain("View timeline");
    expect(html).toContain('href="/dashboard/runs/run_1"');
    expect(html).toContain("Open");
    expect(html).toContain("#42");
    expect(html).toContain("2 files");
    expect(html).toContain("1 passed");
    expect(html).toContain("1 warning");
    expect(html).toContain("0 blockers");
    expect(html).toContain("Package lock");
    expect(html).toContain('href="https://github.com/rory/control-plane/pull/42"');
  });

  test("renders unassigned runners and PR artifacts without safe links", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(
      createElement(RunTable, {
        runs: [
          createRun({
            id: "run_2",
            pr: {
              number: 43,
              status: "draft",
              url: null,
            },
            review: {
              blockerCount: 0,
              changedFileCount: 0,
              prReady: false,
              riskCategoryCounts: [],
              stateBucket: "ready",
              validationStatusCounts: [],
              warningCount: 0,
            },
            runner: null,
            state: "queued",
          }),
        ],
      }),
    );

    expect(html).toContain("Queued");
    expect(html).toContain("Ready");
    expect(html).toContain("Unassigned");
    expect(html).toContain("Draft");
    expect(html).toContain("#43");
    expect(html).toContain('href="/dashboard/runs/run_2"');
    expect(html).not.toContain('href="https://');
  });

  test("encodes run ids in detail links", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(
      createElement(RunTable, {
        runs: [
          createRun({
            id: "run/with space",
          }),
        ],
      }),
    );

    expect(html).toContain('href="/dashboard/runs/run%2Fwith%20space"');
    expect(html).not.toContain('href="/dashboard/runs/run/with space"');
  });

  test("renders empty state when no runs exist", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(createElement(RunTable, { runs: [] }));

    expect(html).toContain("No runs yet.");
    expect(html).toContain("Approved task runs will appear after a runner claims a job.");
  });

  test("renders Cortex-style state filters from derived review buckets", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(
      createElement(RunTable, {
        runs: [
          createRun({ id: "run_ready", review: { ...createRun().review, stateBucket: "ready" } }),
          createRun({
            id: "run_running",
            review: { ...createRun().review, stateBucket: "running" },
            state: "codex_running",
          }),
          createRun({
            id: "run_blocked",
            review: { ...createRun().review, blockerCount: 1, stateBucket: "blocked" },
            state: "blocked",
          }),
          createRun({
            id: "run_failed",
            review: { ...createRun().review, stateBucket: "failed" },
            state: "failed",
          }),
          createRun({
            id: "run_approval",
            review: { ...createRun().review, prReady: false, stateBucket: "awaiting_approval" },
            state: "awaiting_approval",
          }),
          createRun({
            id: "run_pr_ready",
            review: { ...createRun().review, prReady: true, stateBucket: "pr_ready" },
            state: "awaiting_approval",
          }),
        ],
      }),
    );

    expect(html).toContain("All work");
    expect(html).toContain("Ready");
    expect(html).toContain("Running");
    expect(html).toContain("Blocked");
    expect(html).toContain("Failed");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("PR-ready");
    expect(html).toContain('href="/dashboard/runs?state=ready"');
    expect(html).toContain('href="/dashboard/runs?state=pr_ready"');
  });

  test("filters run rows to the selected review state bucket", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(
      createElement(RunTable, {
        runs: [
          createRun({
            id: "run_ready",
            review: { ...createRun().review, stateBucket: "ready" },
            state: "queued",
          }),
          createRun({
            id: "run_blocked",
            review: { ...createRun().review, blockerCount: 1, stateBucket: "blocked" },
            state: "blocked",
          }),
        ],
        stateFilter: "blocked",
      }),
    );

    expect(html).toContain("Showing 1 of 2 runs.");
    expect(html).toContain("run_blocked");
    expect(html).not.toContain("run_ready");
  });

  test("renders a clear empty state when no runs match the selected filter", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(
      createElement(RunTable, {
        runs: [
          createRun({
            id: "run_ready",
            review: { ...createRun().review, stateBucket: "ready" },
            state: "queued",
          }),
        ],
        stateFilter: "failed",
      }),
    );

    expect(html).toContain("No runs match this filter.");
    expect(html).toContain('href="/dashboard/runs"');
    expect(html).not.toContain("run_ready");
  });

  test("does not render timeline details, changed paths, validation commands, packets, diffs, patches, snippets, or source-like text", async () => {
    const { RunTable } = await import("../components/run-table");
    const html = renderToStaticMarkup(
      createElement(RunTable, {
        runs: [
          createRun({
            changedPaths: ["src/changed-file.ts"],
            contextFilePaths: ["apps/web/src/private.ts"],
            diff: "diff --git a/app.ts b/app.ts",
            eventMetadata: { rawLog: "raw runner log line" },
            objective: "Read private source files",
            patch: "@@ -1 +1 @@",
            riskFindings: [{ category: "secret" }],
            snippet: "const leaked = process.env.SECRET",
            sourceCode: "const leaked = process.env.SECRET",
            taskPacket: { objective: "Read private source files" },
            timeline: [{ message: "Detailed timeline event" }],
            validationCommands: [{ command: "pnpm test -- --reporter=verbose" }],
          }),
        ],
      }),
    );

    expect(html).not.toContain("Detailed timeline event");
    expect(html).not.toContain("src/changed-file.ts");
    expect(html).not.toContain("apps/web/src/private.ts");
    expect(html).not.toContain("Read private source files");
    expect(html).not.toContain("pnpm test -- --reporter=verbose");
    expect(html).not.toContain("raw runner log line");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("const leaked = process.env.SECRET");
  });

  test("loads runs only after selected workspace membership is verified", async () => {
    const source = await readAppFile("./(app)/dashboard/runs/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("searchParams?: Promise");
    expect(source).toContain("getRunStateFilter");
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createWorkspaceMutationService");
    expect(source).toContain("createRunListService");
    expect(source).toContain("createDrizzleRunListStore");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(
      /listWorkspaceRuns\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /runListService\s*\.\s*listWorkspaceRuns\(\{\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toContain("coordination metadata only");
    expect(source).toMatch(/<RunTable[\s\S]*runs={runs}[\s\S]*stateFilter={runStateFilter}/);
    expectNoUnsafeRunDisplayMaterial(source);
  });

  test("defines the server-rendered metadata-only run table", async () => {
    await expectFile("../components/run-table.tsx");

    const source = await readAppFile("../components/run-table.tsx");

    expect(source.trimStart()).not.toMatch(/^"use client";/);
    expect(source).toContain('import Link from "next/link";');
    expect(source).toContain("RunListItem");
    expect(source).toContain('from "@/src/runs/list";');
    expect(source).toContain('import { Badge } from "@/components/ui/badge";');
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain('from "@/components/ui/table"');
    expect(source).toContain("Run");
    expect(source).toContain("Status");
    expect(source).toContain("Task");
    expect(source).toContain("Runner");
    expect(source).toContain("Repository mapping");
    expect(source).toContain("Review evidence");
    expect(source).toContain("Updated");
    expect(source).toContain("PR");
    expect(source).toContain("No PR yet");
    expect(source).toContain("Unassigned");
    expect(source).toContain("run.state");
    expect(source).toContain("run.task.title");
    expect(source).toContain("run.task.id");
    expect(source).toContain("run.runner");
    expect(source).toContain("run.repoMapping.repositoryOwner");
    expect(source).toContain("run.repoMapping.repositoryName");
    expect(source).toContain("run.updatedAt");
    expect(source).toContain("run.review.changedFileCount");
    expect(source).toContain("run.review.warningCount");
    expect(source).toContain("run.review.blockerCount");
    expect(source).toContain("run.review.prReady");
    expect(source).toContain("filteredRuns");
    expect(source).toContain("encodeURIComponent(run.id)");
    expect(source).toContain("href={`/dashboard/runs/${encodeURIComponent(run.id)}`}");
    expect(source).toContain("View timeline");
    expectNoUnsafeRunDisplayMaterial(source);
  });
});
