import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importPublicRequest = async () => import("./public-request");

describe("public GitHub request adapter", () => {
  test("performs metadata-only public GET requests with safe GitHub headers", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        truncated: false,
        tree: [],
      }),
    );
    const { createPublicGitHubRequestFunction } = await importPublicRequest();
    const request = createPublicGitHubRequestFunction({
      apiBaseUrl: "https://api.github.test",
      fetch,
    });

    const result = await request({
      installationId: 1,
      method: "GET",
      operation: "getRepositoryTree",
      path: "/repos/rory-hayes/payslip-peeks-and-probes/git/trees/main",
      query: { recursive: "1" },
    });

    expect(result).toEqual({
      truncated: false,
      tree: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.test/repos/rory-hayes/payslip-peeks-and-probes/git/trees/main?recursive=1",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "cortex-public-repo-readiness",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method: "GET",
      },
    );
  });

  test("rejects write operations, bodies, and provider failures without leaking payloads", async () => {
    const fetch = vi.fn(
      async () => new Response("raw GitHub token ghp_providerPayload", { status: 404 }),
    );
    const { createPublicGitHubRequestFunction } = await importPublicRequest();
    const request = createPublicGitHubRequestFunction({
      apiBaseUrl: "https://api.github.test",
      fetch,
    });

    await expect(
      request({
        installationId: 1,
        method: "POST",
        operation: "createIssue",
        path: "/repos/rory-hayes/payslip-peeks-and-probes/issues",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      request({
        body: { title: "Do not create" },
        installationId: 1,
        method: "GET",
        operation: "getRepositoryTree",
        path: "/repos/rory-hayes/payslip-peeks-and-probes/git/trees/main",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      request({
        installationId: 1,
        method: "GET",
        operation: "getRepositoryFile",
        path: "/repos/rory-hayes/payslip-peeks-and-probes/contents/package.json",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    try {
      await request({
        installationId: 1,
        method: "GET",
        operation: "getRepositoryFile",
        path: "/repos/rory-hayes/payslip-peeks-and-probes/contents/package.json",
      });
    } catch (error) {
      expect(String(error)).not.toContain("ghp_providerPayload");
      expect(String(error)).not.toContain("raw GitHub");
    }
  });
});
