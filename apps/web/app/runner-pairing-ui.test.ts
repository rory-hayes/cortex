import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

describe("runner pairing UI source conventions", () => {
  test("loads the selected workspace cookie and verifies membership before rendering pairing controls", async () => {
    const source = await readAppFile("./(app)/dashboard/runners/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain('from "next/headers"');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const requestHeaders = await headers()");
    expect(source).toContain("const runnerApiBaseUrl");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toMatch(
      /<RunnerPairing[\s\S]*apiBaseUrl={runnerApiBaseUrl}[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}[\s\S]*workspaceName={verifiedWorkspace\.name}/,
    );
    expect(source).not.toContain("workspaceId={cookieWorkspaceId}");
  });

  test("keeps raw pairing-code generation in the server action response only", async () => {
    await expectFile("../components/runner-pairing.tsx");

    const componentSource = await readAppFile("../components/runner-pairing.tsx");
    const actionSource = await readAppFile("../src/server/actions.ts");
    const combinedSource = `${componentSource}\n${actionSource}`;

    expect(componentSource.trimStart()).toMatch(/^"use client";/);
    expect(componentSource).toContain("useActionState");
    expect(componentSource).toContain("createRunnerPairingCodeAction");
    expect(componentSource).toContain('name="workspaceId"');
    expect(componentSource).toContain('type="hidden"');
    expect(componentSource).toContain("value={workspaceId}");
    expect(componentSource).toContain("Generate pairing code");
    expect(componentSource).toContain("control-plane-runner link --code");
    expect(componentSource).toContain("--base-url");
    expect(componentSource).toContain("break-all");
    expect(componentSource).toMatch(/expires|Expires/);
    expect(actionSource).toMatch(/^export async function createRunnerPairingCodeAction\(/m);
    expect(combinedSource).not.toMatch(
      /generateRunnerPairingCode|randomBytes|node:crypto|console\.|localStorage|sessionStorage|URLSearchParams|window\.location|history\.pushState|router\.push/i,
    );
  });
});
