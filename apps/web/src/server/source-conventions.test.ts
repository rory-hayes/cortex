import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readServerFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("server module source conventions", () => {
  test("keeps app UI mutations in a server action module", async () => {
    const source = await readServerFile("./actions.ts");

    expect(source.trimStart()).toMatch(/^"use server";/);
    expect(source).toContain('import "server-only";');
    expect(source).toMatch(/^export async function createWorkspaceAction\(/m);
    expect(source).toMatch(/^export async function selectWorkspaceAction\(/m);
    expect(source).toMatch(/^export async function updateWorkspaceNameAction\(/m);
    expect(source).toMatch(/^export async function createManualTaskAction\(/m);
    expect(source).toMatch(/^export async function createRepoMappingAction\(/m);
    expect(source).toMatch(/^export async function deleteRepoMappingAction\(/m);
    expect(source).not.toMatch(/^export\s+const\s+createCreateWorkspaceAction\s*=/m);
    expect(source).not.toMatch(/^export\s+const\s+createSelectWorkspaceAction\s*=/m);
    expect(source).not.toMatch(/^export\s+const\s+createUpdateWorkspaceNameAction\s*=/m);
    expect(source).not.toMatch(/^export\s+const\s+createCreateManualTaskAction\s*=/m);
    expect(source).not.toMatch(/^export\s+const\s+createCreateRepoMappingAction\s*=/m);
  });

  test("marks server-only convention modules explicitly", async () => {
    const serverOnlyFiles = [
      "../task-packets/build-cortex-task-packet.ts",
      "../task-packets/build-task-packet.ts",
      "../tasks/manual-tasks.ts",
      "../tasks/tasks.ts",
      "../repo-mappings/repo-mappings.ts",
      "../repairs/build-repair-packet.ts",
      "../repairs/repair-requests.ts",
      "../runners/heartbeat.ts",
      "./action-factories.ts",
      "./audit.ts",
      "./auth.ts",
      "./errors.ts",
      "../runners/revoke.ts",
      "./route-handlers.ts",
      "../runs/artifacts.ts",
      "../runs/events.ts",
      "../security/payload-guard.ts",
      "../runs/detail.ts",
      "../runs/list.ts",
      "./workspace-mutations.ts",
    ];

    for (const file of serverOnlyFiles) {
      await expect(readServerFile(file)).resolves.toContain('import "server-only";');
    }
  });

  test("keeps manual task modules free of raw source upload fields and request logging", async () => {
    const taskSources = [
      await readServerFile("../tasks/manual-tasks.ts"),
      await readFile(new URL("../../app/api/tasks/route.ts", import.meta.url), "utf8"),
    ].join("\n");

    expect(taskSources).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(taskSources).not.toMatch(
      /\b(?:content|diff|patch|rawOutput|snippet|sourceCode|stderr|stdout)\s*:/,
    );
  });

  test("keeps the task packet builder server-only and file-content blind", async () => {
    const source = await readServerFile("../task-packets/build-task-packet.ts");

    expect(source).toContain('import "server-only";');
    expect(source).not.toMatch(/from\s+["']node:fs(?:\/promises)?["']/);
    expect(source).not.toMatch(/\breadFile\b/);
    expect(source).not.toMatch(/\brequest\b|\bbody\b|console\.(?:log|info|warn|error|debug)/);
  });

  test("keeps the Cortex task packet builder server-only and file-content blind", async () => {
    const source = await readServerFile("../task-packets/build-cortex-task-packet.ts");

    expect(source).toContain('import "server-only";');
    expect(source).not.toMatch(/from\s+["']node:fs(?:\/promises)?["']/);
    expect(source).not.toMatch(/\breadFile\b/);
    expect(source).not.toMatch(/\b(?:requestBody|bodyText|rawBody)\b/);
    expect(source).not.toMatch(/\brequest\b|\bbody\b|console\.(?:log|info|warn|error|debug)/);
  });

  test("keeps repair request creation server-only and file-content blind", async () => {
    const source = await readServerFile("../repairs/repair-requests.ts");

    expect(source).toContain('import "server-only";');
    expect(source).not.toMatch(/from\s+["']node:fs(?:\/promises)?["']/);
    expect(source).not.toMatch(/\breadFile\b/);
    expect(source).not.toMatch(
      /\b(?:content|diff|patch|rawOutput|snippet|sourceCode|stderr|stdout)\s*:/,
    );
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
  });

  test("keeps runner artifact modules free of raw request logging", async () => {
    const artifactSources = [
      await readServerFile("../runs/artifacts.ts"),
      await readServerFile("../security/payload-guard.ts"),
      await readFile(new URL("../../app/api/runner/runs/events/route.ts", import.meta.url), "utf8"),
      await readFile(
        new URL("../../app/api/runner/runs/dry-run-result/route.ts", import.meta.url),
        "utf8",
      ),
      await readFile(
        new URL("../../app/api/runner/runs/validation-result/route.ts", import.meta.url),
        "utf8",
      ),
      await readFile(
        new URL("../../app/api/runner/runs/pr-artifact/route.ts", import.meta.url),
        "utf8",
      ),
    ].join("\n");

    expect(artifactSources).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(artifactSources).not.toMatch(/authorization|request body|runnerCredential/i);
  });

  test("keeps repair packet builder server-only and file-content blind", async () => {
    const source = await readServerFile("../repairs/build-repair-packet.ts");

    expect(source).toContain('import "server-only";');
    expect(source).not.toMatch(/from\s+["']node:fs(?:\/promises)?["']/);
    expect(source).not.toMatch(/\breadFile\b/);
    expect(source).not.toMatch(
      /\b(?:content|diff|patch|rawOutput|snippet|sourceCode|stderr|stdout)\s*:/,
    );
    expect(source).not.toMatch(/\b(?:requestBody|bodyText|rawBody)\b/);
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
  });
});
