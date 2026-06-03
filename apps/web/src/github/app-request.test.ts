import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importAppRequest = async () => import("./app-request");

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

describe("GitHub App request transport", () => {
  test("exchanges an app JWT for an installation token and performs metadata requests", async () => {
    const { createGitHubAppRequestFunction } = await importAppRequest();
    const calls: Array<{ init: RequestInit | undefined; url: string }> = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);

      calls.push({ init, url });

      if (url.endsWith("/app/installations/123/access_tokens")) {
        return new Response(
          JSON.stringify({
            expires_at: "2026-06-02T10:30:00.000Z",
            token: "installation_access_value",
          }),
          { status: 201 },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
        }),
        { status: 200 },
      );
    });
    const request = createGitHubAppRequestFunction({
      apiBaseUrl: "https://api.github.test",
      appId: "12345",
      fetch: fetchFn,
      now: () => new Date("2026-06-02T10:00:00.000Z"),
      privateKey: createPrivateKeyPem(),
    });

    await expect(
      request({
        installationId: 123,
        method: "GET",
        operation: "getPullRequest",
        path: "/repos/rory/control-plane/pulls/22",
        query: { per_page: 100 },
      }),
    ).resolves.toEqual({ ok: true });
    await request({
      installationId: 123,
      method: "POST",
      operation: "createPullRequest",
      path: "/repos/rory/control-plane/pulls",
      body: {
        base: "main",
        draft: true,
        head: "cortex/setup-pr/setup-pr-preview-1",
        title: "Cortex setup PR",
      },
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(calls[0]?.url).toBe("https://api.github.test/app/installations/123/access_tokens");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(String((calls[0]?.init?.headers as Record<string, string>).Authorization)).toMatch(
      /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(calls[1]?.url).toBe(
      "https://api.github.test/repos/rory/control-plane/pulls/22?per_page=100",
    );
    expect(calls[1]?.init?.headers).toMatchObject({
      Authorization: "Bearer installation_access_value",
    });
    expect(calls[2]?.url).toBe("https://api.github.test/repos/rory/control-plane/pulls");
    expect(calls[2]?.init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(String(calls[2]?.init?.body)).toContain("cortex/setup-pr/setup-pr-preview-1");
  });

  test("rejects missing app configuration before making a request", async () => {
    const { createGitHubAppRequestFunction } = await importAppRequest();
    const fetchFn = vi.fn<typeof fetch>();

    expect(() =>
      createGitHubAppRequestFunction({
        appId: "",
        fetch: fetchFn,
        privateKey: createPrivateKeyPem(),
      }),
    ).toThrow(expect.objectContaining({ code: "validation_error" }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("rejects failed GitHub responses without exposing response bodies", async () => {
    const { createGitHubAppRequestFunction } = await importAppRequest();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("nope", { status: 403 }));
    const request = createGitHubAppRequestFunction({
      apiBaseUrl: "https://api.github.test",
      appId: "12345",
      fetch: fetchFn,
      now: () => new Date("2026-06-02T10:00:00.000Z"),
      privateKey: createPrivateKeyPem(),
    });

    await expect(
      request({
        installationId: 123,
        method: "GET",
        operation: "getPullRequest",
        path: "/repos/rory/control-plane/pulls/22",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});
