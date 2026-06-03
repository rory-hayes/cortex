import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { RunnerListItem } from "../src/runners/list";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const expectNoUnsafeRunnerDisplayMaterial = (source: string) => {
  expect(source).not.toMatch(
    /credentialHash|credential_hash|runnerCredential|pairingCodeHash|secret|token/i,
  );
};

const createRunner = (overrides: Partial<RunnerListItem> = {}) =>
  ({
    capabilitiesSummary: {
      availableTools: ["git", "node", "pnpm"],
      maxConcurrentJobs: 2,
      supportsCancellation: true,
      supportsDryRun: true,
      toolAvailability: [
        { available: true, name: "git" },
        { available: false, name: "gh" },
        { available: false, name: "codex" },
        { available: true, name: "node" },
        { available: false, name: "npm" },
        { available: true, name: "pnpm" },
        { available: false, name: "yarn" },
        { available: false, name: "python" },
      ],
    },
    displayName: "Mac Studio",
    id: "runner_1",
    isRevoked: false,
    lastHeartbeatAt: new Date("2026-05-22T13:00:00.000Z"),
    linkedAt: new Date("2026-05-22T12:58:00.000Z"),
    revokedAt: null,
    status: "idle",
    ...overrides,
  }) satisfies RunnerListItem;

describe("runner list UI source conventions", () => {
  test("renders health summary, filters, heartbeat labels, capability badges, and revoke states", async () => {
    const { RunnerList } = await import("../components/runner-list");
    const idleRunner = createRunner({
      displayName: "Idle runner",
      id: "runner_idle",
      status: "idle",
    });
    const busyRunner = createRunner({
      displayName: "Busy runner",
      id: "runner_busy",
      status: "busy",
    });
    const offlineRunner = createRunner({
      displayName: "Offline runner",
      id: "runner_offline",
      status: "offline",
    });
    const revokedRunner = createRunner({
      displayName: "Revoked runner",
      id: "runner_revoked",
      isRevoked: true,
      revokedAt: new Date("2026-05-22T14:00:00.000Z"),
      status: "revoked",
    });
    const noHeartbeatRunner = createRunner({
      displayName: "No heartbeat runner",
      id: "runner_no_heartbeat",
      lastHeartbeatAt: null,
      status: "offline",
    });

    const html = renderToStaticMarkup(
      createElement(RunnerList, {
        revokeRunner: () => undefined,
        runners: [idleRunner, busyRunner, offlineRunner, revokedRunner, noHeartbeatRunner],
        statusFilter: "all",
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("5 paired runners");
    expect(html).toContain("Idle 1");
    expect(html).toContain("Busy 1");
    expect(html).toContain("Offline 2");
    expect(html).toContain("Revoked 1");
    expect(html).toContain("No heartbeat 1");
    expect(html).toContain("status=idle");
    expect(html).toContain("status=busy");
    expect(html).toContain("status=offline");
    expect(html).toContain("status=revoked");
    expect(html).toContain("status=no_heartbeat");
    expect(html).toContain("Last heartbeat");
    expect(html).toContain("No heartbeat yet");
    expect(html).toContain("git");
    expect(html).toContain("codex missing");
    expect(html).toContain("Dry run");
    expect(html).toContain("Cancellation");
    expect(html).toContain("Max concurrency 2");
    expect(html).toContain("Revoked");
    expect(html).toContain("disabled");
    expect(html).toContain("Revoke");

    const emptyFilterHtml = renderToStaticMarkup(
      createElement(RunnerList, {
        revokeRunner: () => undefined,
        runners: [idleRunner],
        statusFilter: "busy",
        workspaceId: "workspace_1",
      }),
    );

    expect(emptyFilterHtml).toContain("No runners match this filter.");
    expect(emptyFilterHtml).toContain("Clear filters");
  });

  test("renders pairing guidance when no runners are paired", async () => {
    const { RunnerList } = await import("../components/runner-list");

    const html = renderToStaticMarkup(
      createElement(RunnerList, {
        revokeRunner: () => undefined,
        runners: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("No runners paired.");
    expect(html).toContain("Pair a local runner");
    expect(html).toContain("The web app coordinates metadata; execution stays on the runner.");
  });

  test("loads runners only after selected workspace membership is verified", async () => {
    const source = await readAppFile("./(app)/dashboard/runners/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain('from "@/src/runners/list"');
    expect(source).toContain("createRunnerListService");
    expect(source).toContain("createDrizzleRunnerListStore");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(
      /listWorkspaceRunners\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /runnerListService\s*\.\s*listWorkspaceRunners\(\{\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).toMatch(
      /<RunnerPairing[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}[\s\S]*workspaceName={verifiedWorkspace\.name}/,
    );
    expect(source).toContain('from "@/src/server/actions"');
    expect(source).toContain("revokeRunnerAction");
    expect(source).toMatch(/await revokeRunnerAction\(formData\)/);
    expect(source).toContain("searchParams");
    expect(source).toContain("statusFilter");
    expect(source).toContain("Connection status");
    expect(source).toContain("Stored heartbeat metadata");
    expect(source).toMatch(
      /<RunnerList[\s\S]*revokeRunner={revokeRunner}[\s\S]*runners={runners}[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}/,
    );
    expectNoUnsafeRunnerDisplayMaterial(source);
  });

  test("renders runner rows with safe status, heartbeat, capability, and revoke forms", async () => {
    await expectFile("../components/runner-list.tsx");

    const source = await readAppFile("../components/runner-list.tsx");

    expect(source.trimStart()).not.toMatch(/^"use client";/);
    expect(source).toContain("RunnerListItem");
    expect(source).toContain('from "@/src/runners/list";');
    expect(source).toContain('import { Badge } from "@/components/ui/badge";');
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain('from "@/components/ui/table"');
    expect(source).toContain("runner.displayName");
    expect(source).toContain("runner.status");
    expect(source).toContain("runner.isRevoked");
    expect(source).toContain("runner.revokedAt");
    expect(source).toContain("revoked");
    expect(source).toContain("runner.lastHeartbeatAt");
    expect(source).toContain("formatDate");
    expect(source).toContain("No heartbeat yet");
    expect(source).toContain("runner.id");
    expect(source).toContain("runner.capabilitiesSummary.availableTools");
    expect(source).toContain("runner.capabilitiesSummary.toolAvailability");
    expect(source).toContain("runner.capabilitiesSummary.maxConcurrentJobs");
    expect(source).toContain("statusFilter");
    expect(source).toContain("No runners match this filter.");
    expect(source).toMatch(/<form[\s\S]*action={revokeRunner}/);
    expect(source).toMatch(/<input[\s\S]*name="workspaceId"[\s\S]*value={workspaceId}/);
    expect(source).toMatch(/<input[\s\S]*name="runnerId"[\s\S]*value={runner\.id}/);
    expect(source).toMatch(/<Button[\s\S]*disabled={runner\.isRevoked}/);
    expect(source).toContain('runner.isRevoked ? "Revoked" : "Revoke"');
    expectNoUnsafeRunnerDisplayMaterial(source);
    expect(source).not.toMatch(/JSON\.stringify|capabilities\.tools|\.path/);
  });
});
