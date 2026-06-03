import { CONTRACT_VERSION } from "@control-plane/shared";
import { describe, expect, test } from "vitest";

import { RunnerError } from "../errors.js";

import {
  postRunnerRepoMapping,
  type RunnerRepoMappingMetadata,
  type RunnerRepoMappingProtocolDependencies,
} from "./repo-mappings.js";

const runnerCredential = "runner-credential-must-stay-local";
type TestFetch = NonNullable<RunnerRepoMappingProtocolDependencies["fetch"]>;

describe("runner repo mapping protocol client", () => {
  test("posts only mapping metadata to the authenticated repo-mappings endpoint", async () => {
    const { calls, fetch } = createFetch({ ok: true, data: responseData() });

    const result = await postRunnerRepoMapping(
      {
        credential: credentialRecord(),
        mapping: mappingMetadata(),
      },
      {
        fetch,
        now: () => new Date("2026-05-23T08:00:00.000Z"),
      },
    );

    expect(result).toEqual(responseData());
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? unreachableCall();

    expect(url).toBe("https://control-plane.test/api/runner/repo-mappings");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${runnerCredential}`,
          "content-type": "application/json",
          "x-control-plane-runner-id": "runner_1",
        },
      }),
    );

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(body).toEqual({
      contractVersion: CONTRACT_VERSION,
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      provider: "github",
      remoteUrl: "https://github.com/rory/control-plane.git",
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      timestamp: "2026-05-23T08:00:00.000Z",
      workspaceId: "workspace_1",
    });
    expect(Object.keys(body).sort()).toEqual([
      "contractVersion",
      "defaultBranch",
      "localPath",
      "provider",
      "remoteUrl",
      "repositoryName",
      "repositoryOwner",
      "runnerId",
      "timestamp",
      "workspaceId",
    ]);
    expect(JSON.stringify(body)).not.toContain(runnerCredential);
    expect(JSON.stringify(body)).not.toMatch(
      /source|fileTree|tree|diff|patch|snippet|dependencyGraph|credential/i,
    );
  });

  test("derives the repo-mappings endpoint from pollingBaseUrl without duplicating api", async () => {
    const { calls, fetch } = createFetch({ ok: true, data: responseData() });

    await postRunnerRepoMapping(
      {
        credential: {
          ...credentialRecord(),
          pollingBaseUrl: "https://control-plane.test/api/",
        },
        mapping: mappingMetadata(),
      },
      { fetch },
    );

    expect(calls[0]?.[0]).toBe("https://control-plane.test/api/runner/repo-mappings");
  });

  test.each([
    ["diff text in local path", { localPath: "/repos/diff --git a/app.ts b/app.ts" }],
    ["patch hunk in remote URL", { remoteUrl: "https://github.com/rory/@@ -1,2 +1,2 @@.git" }],
    [
      "source snippet in remote URL",
      { remoteUrl: "https://github.com/rory/function leak() {}.git" },
    ],
    [
      "credential-like SCP-style remote URL",
      { remoteUrl: "user:pass@github.com:rory/control-plane.git" },
    ],
  ])("rejects source-like mapping metadata before posting: %s", async (_caseName, overrides) => {
    const { calls, fetch } = createFetch({ ok: true, data: responseData() });

    await expect(
      postRunnerRepoMapping(
        {
          credential: credentialRecord(),
          mapping: {
            ...mappingMetadata(),
            ...overrides,
          },
        },
        { fetch },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Repository metadata is not safe to register.",
    });
    expect(calls).toHaveLength(0);
  });

  test("rejects unsafe stored API base URLs before posting", async () => {
    const { calls, fetch } = createFetch({ ok: true, data: responseData() });

    await expect(
      postRunnerRepoMapping(
        {
          credential: {
            ...credentialRecord(),
            pollingBaseUrl: ["https://", "runner", ":", "redacted", "@control-plane.test/api"].join(
              "",
            ),
          },
          mapping: mappingMetadata(),
        },
        { fetch },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message:
        "Runner API base URL must be an http localhost URL or https URL without embedded credentials.",
    });
    expect(calls).toHaveLength(0);
  });

  test.each([
    [
      "credentialed remote URL",
      {
        remoteUrl: ["https://", "user", ":", "pass", "@github.com/rory/control-plane.git"].join(""),
      },
      "pass",
    ],
    ["source-like local path", { localPath: "/repos/diff --git a/app.ts b/app.ts" }, "diff --git"],
    [
      "token-like repository name",
      { repositoryName: `${"github_pat_"}${"a".repeat(24)}` },
      "github_pat_",
    ],
  ])(
    "rejects unsafe response metadata before returning CLI-printable data: %s",
    async (_caseName, overrides, unsafeText) => {
      const { fetch } = createFetch({
        ok: true,
        data: {
          ...responseData(),
          ...overrides,
        },
      });

      const promise = postRunnerRepoMapping(
        {
          credential: credentialRecord(),
          mapping: mappingMetadata(),
        },
        { fetch },
      );

      await expect(promise).rejects.toMatchObject({
        category: "command_execution",
        message: "Runner repo mapping response was invalid.",
      });
      await promise.catch((error: unknown) => {
        expect(error).toBeInstanceOf(RunnerError);
        expect(JSON.stringify(error)).not.toContain(unsafeText);
        expect(JSON.stringify(error)).not.toContain(runnerCredential);
      });
    },
  );

  test("maps network, API, HTTP, and response schema failures to generic safe RunnerErrors", async () => {
    const cases = [
      {
        name: "network failure",
        fetch: (async () => {
          throw new Error(`network ${runnerCredential}`);
        }) satisfies TestFetch,
        message: "Runner repo mapping request failed.",
      },
      {
        name: "API error",
        fetch: (async () =>
          jsonResponse({
            ok: false,
            error: {
              code: "invalid_runner_credential",
              message: `bad ${runnerCredential}`,
            },
          })) satisfies TestFetch,
        message: "Runner repo mapping request failed.",
      },
      {
        name: "400 response",
        fetch: (async () =>
          jsonResponse({ ok: true, data: responseData() }, 400)) satisfies TestFetch,
        message: "Runner repo mapping request failed.",
      },
      {
        name: "401 response",
        fetch: (async () =>
          jsonResponse(
            {
              error: {
                code: "invalid_runner_credential",
                message: `bad ${runnerCredential}`,
              },
              ok: false,
            },
            401,
          )) satisfies TestFetch,
        message: "Runner repo mapping request failed.",
      },
      {
        name: "invalid JSON",
        fetch: (async () => ({
          json: async () => {
            throw new Error(`invalid json ${runnerCredential}`);
          },
          ok: true,
          status: 200,
        })) satisfies TestFetch,
        message: "Runner repo mapping response was invalid.",
      },
      {
        name: "invalid envelope",
        fetch: (async () =>
          jsonResponse({ ok: true, data: { runnerCredential } })) satisfies TestFetch,
        message: "Runner repo mapping response was invalid.",
      },
    ];

    for (const testCase of cases) {
      await postRunnerRepoMapping(
        {
          credential: credentialRecord(),
          mapping: mappingMetadata(),
        },
        { fetch: testCase.fetch },
      ).catch((error: unknown) => {
        expect(error, testCase.name).toBeInstanceOf(RunnerError);
        expect(error, testCase.name).toMatchObject({
          category: "command_execution",
          message: testCase.message,
        });
        expect(JSON.stringify(error), testCase.name).not.toContain(runnerCredential);
      });
    }
  });
});

const credentialRecord = () => ({
  contractVersion: CONTRACT_VERSION,
  linkedAt: "2026-05-22T14:00:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "https://control-plane.test/api",
  runnerCredential,
  runnerId: "runner_1",
  storedAt: "2026-05-22T14:30:00.000Z",
  workspaceId: "workspace_1",
});

const mappingMetadata = (): RunnerRepoMappingMetadata => ({
  defaultBranch: "main",
  localPath: "/repos/control-plane",
  provider: "github",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
});

const responseData = () => ({
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/repos/control-plane",
  provider: "github",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
});

const jsonResponse = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
});

const createFetch = (body: unknown): { calls: Array<Parameters<TestFetch>>; fetch: TestFetch } => {
  const calls: Array<Parameters<TestFetch>> = [];
  const fetch: TestFetch = async (url, init) => {
    calls.push([url, init]);

    return jsonResponse(body);
  };

  return { calls, fetch };
};

const unreachableCall = (): Parameters<TestFetch> => {
  throw new Error("Expected fetch to be called.");
};
