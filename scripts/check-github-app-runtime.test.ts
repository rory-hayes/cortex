import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  formatGitHubAppRuntimeReadiness,
  parseGitHubAppRuntimeCheckArgs,
  runGitHubAppRuntimeCheck,
  runGitHubAppRuntimeReadiness,
} from "./check-github-app-runtime.js";

const createPrivateKeyPem = (): string => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return privateKey
    .export({
      format: "pem",
      type: "pkcs8",
    })
    .toString();
};

const realishPrivateKey = createPrivateKeyPem();

const validEnv = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: realishPrivateKey,
  GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
} as const;

describe("GitHub App runtime readiness check", () => {
  test("parses supported arguments", () => {
    expect(parseGitHubAppRuntimeCheckArgs([])).toEqual({
      help: false,
      json: false,
      live: true,
    });
    expect(parseGitHubAppRuntimeCheckArgs(["--json", "--offline"])).toEqual({
      help: false,
      json: true,
      live: false,
    });
    expect(parseGitHubAppRuntimeCheckArgs(["--help"])).toEqual({
      help: true,
      json: false,
      live: true,
    });
    expect(() => parseGitHubAppRuntimeCheckArgs(["--verbose"])).toThrow(/Unknown argument/);
  });

  test("blocks missing GitHub App values without making live requests", async () => {
    const result = await runGitHubAppRuntimeReadiness({
      env: {
        GITHUB_APP_ID: "",
        GITHUB_APP_PRIVATE_KEY: "",
        GITHUB_WEBHOOK_SECRET: "",
      },
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const output = formatGitHubAppRuntimeReadiness(result);

    expect(result.ready).toBe(false);
    expect(output).toContain("GitHub App runtime readiness: blocked");
    expect(output).toContain("GITHUB_APP_ID");
    expect(output).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(output).toContain("GITHUB_WEBHOOK_SECRET");
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain("github-webhook-secret");
  });

  test("verifies offline JWT signing without printing the private key or JWT", async () => {
    const result = await runGitHubAppRuntimeReadiness({
      env: validEnv,
      live: false,
      now: () => new Date("2026-06-04T10:00:00.000Z"),
    });
    const output = formatGitHubAppRuntimeReadiness(result);

    expect(result.ready).toBe(true);
    expect(result.live).toBe(false);
    expect(output).toContain("[passed] app_jwt");
    expect(output).toContain("[warning] app_identity");
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain("github-webhook-secret");
    expect(output).not.toMatch(/Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
  });

  test("verifies the live GitHub App identity endpoint without printing credentials", async () => {
    const calls: Array<{ headers: Record<string, string>; url: string }> = [];
    const result = await runGitHubAppRuntimeReadiness({
      apiBaseUrl: "https://api.github.test",
      env: validEnv,
      fetch: (async (input, init) => {
        calls.push({
          headers: init?.headers as Record<string, string>,
          url: String(input),
        });

        return new Response(
          JSON.stringify({
            id: 123456,
            name: "Cortex",
          }),
          { status: 200 },
        );
      }) satisfies typeof fetch,
      now: () => new Date("2026-06-04T10:00:00.000Z"),
    });
    const output = formatGitHubAppRuntimeReadiness(result);

    expect(result.ready).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.test/app");
    expect(calls[0]?.headers.Authorization).toMatch(
      /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(output).toContain("[passed] app_identity");
    expect(output).toContain("HTTP 200");
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain(calls[0]?.headers.Authorization ?? "");
  });

  test("fails closed on live GitHub API errors without printing response bodies", async () => {
    const result = await runGitHubAppRuntimeReadiness({
      apiBaseUrl: "https://api.github.test",
      env: validEnv,
      fetch: async () => new Response("private key is invalid", { status: 401 }),
    });
    const output = formatGitHubAppRuntimeReadiness(result);

    expect(result.ready).toBe(false);
    expect(output).toContain("[blocked] app_identity");
    expect(output).toContain("HTTP 401");
    expect(output).not.toContain("private key is invalid");
    expect(output).not.toContain(realishPrivateKey);
  });

  test("prints JSON readiness without raw GitHub credentials", async () => {
    let output = "";
    const exitCode = await runGitHubAppRuntimeCheck(["--json", "--offline"], {
      env: validEnv,
      now: () => new Date("2026-06-04T10:00:00.000Z"),
      stdout: (message) => {
        output += message;
      },
    });
    const payload = JSON.parse(output) as {
      ready: boolean;
    };

    expect(exitCode).toBe(0);
    expect(payload.ready).toBe(true);
    expect(output).not.toContain(realishPrivateKey);
    expect(output).not.toContain("github-webhook-secret");
    expect(output).not.toMatch(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
  });
});
