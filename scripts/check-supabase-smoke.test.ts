import { describe, expect, test } from "vitest";

import {
  formatSupabaseSmokeResult,
  parseSupabaseSmokeArgs,
  runSupabaseSmoke,
  runSupabaseSmokeCheck,
} from "./check-supabase-smoke.js";

const createResponse = (status: number, body = ""): Response => new Response(body, { status });

describe("Supabase smoke check command", () => {
  test("parses supported arguments", () => {
    expect(parseSupabaseSmokeArgs([])).toEqual({ help: false, json: false, url: undefined });
    expect(parseSupabaseSmokeArgs(["--json"])).toEqual({
      help: false,
      json: true,
      url: undefined,
    });
    expect(parseSupabaseSmokeArgs(["--url", "https://project-ref.supabase.co"])).toEqual({
      help: false,
      json: false,
      url: "https://project-ref.supabase.co",
    });
    expect(parseSupabaseSmokeArgs(["--help"])).toEqual({
      help: true,
      json: false,
      url: undefined,
    });
    expect(() => parseSupabaseSmokeArgs(["--url"])).toThrow(/requires a value/);
    expect(() => parseSupabaseSmokeArgs(["--verbose"])).toThrow(/Unknown argument/);
  });

  test("passes when REST is key-gated and Auth health is reachable", async () => {
    const requestedUrls: string[] = [];
    const result = await runSupabaseSmoke({
      fetch: (async (url) => {
        requestedUrls.push(String(url));

        if (String(url).endsWith("/auth/v1/health")) {
          return createResponse(200, "auth body");
        }

        return createResponse(401, "rest body");
      }) satisfies typeof fetch,
      url: "https://project-ref.supabase.co/rest/v1/",
    });

    expect(result.ready).toBe(true);
    expect(result.projectUrl).toBe("configured");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "REST endpoint is reachable and requires API authentication.",
          name: "rest_endpoint",
          status: "passed",
          statusCode: 401,
        }),
        expect.objectContaining({
          message: "Auth health endpoint is reachable.",
          name: "auth_health_endpoint",
          status: "passed",
          statusCode: 200,
        }),
      ]),
    );
    expect(requestedUrls).toEqual([
      "https://project-ref.supabase.co/rest/v1/",
      "https://project-ref.supabase.co/auth/v1/health",
    ]);
  });

  test("blocks when an endpoint is not found", async () => {
    const result = await runSupabaseSmoke({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/v1/health")) {
          return createResponse(200);
        }

        return createResponse(404, "not found body");
      }) satisfies typeof fetch,
      url: "https://project-ref.supabase.co",
    });

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "REST endpoint was not found.",
          name: "rest_endpoint",
          status: "blocked",
          statusCode: 404,
        }),
      ]),
    );
  });

  test("rejects credentialed or query-bearing Supabase URLs without echoing them", async () => {
    let stderr = "";
    const credentialedUrl = ["https://", "user", ":", "secret", "@project-ref.supabase.co"].join(
      "",
    );
    const credentialMarker = ["user", ":", "secret"].join("");
    const exitCode = await runSupabaseSmokeCheck(["--url", credentialedUrl], {
      stderr: (message: string) => {
        stderr += message;
      },
    });

    expect(exitCode).toBe(2);
    expect(stderr).toContain("must not include credentials");
    expect(stderr).not.toContain(credentialMarker);
    expect(stderr).not.toContain("project-ref.supabase.co");
  });

  test("prints safe text and JSON output without bodies, keys, or project refs", async () => {
    let textOutput = "";
    const projectRef = "project-ref";
    const secretMarker = ["sb", "_secret_", "hidden"].join("");
    const fetchFn = (async (url) => {
      if (String(url).endsWith("/auth/v1/health")) {
        return createResponse(403, `auth ${secretMarker} body`);
      }

      return createResponse(401, `rest ${secretMarker} body`);
    }) satisfies typeof fetch;
    const textExitCode = await runSupabaseSmokeCheck(
      ["--url", `https://${projectRef}.supabase.co`],
      {
        fetch: fetchFn,
        stdout: (message: string) => {
          textOutput += message;
        },
      },
    );
    let jsonOutput = "";
    const jsonExitCode = await runSupabaseSmokeCheck(
      ["--url", `https://${projectRef}.supabase.co/rest/v1/`, "--json"],
      {
        fetch: fetchFn,
        stdout: (message: string) => {
          jsonOutput += message;
        },
      },
    );

    expect(textExitCode).toBe(0);
    expect(jsonExitCode).toBe(0);
    expect(textOutput).toContain("Supabase endpoint smoke readiness: ready");
    expect(textOutput).toContain("Project URL: configured");
    expect(jsonOutput).toContain('"ready": true');
    expect(`${textOutput}\n${jsonOutput}`).not.toContain(secretMarker);
    expect(`${textOutput}\n${jsonOutput}`).not.toContain(projectRef);
    expect(`${textOutput}\n${jsonOutput}`).not.toContain("supabase.co");
  });

  test("uses SUPABASE_URL from the provided environment without printing it", async () => {
    let output = "";
    const exitCode = await runSupabaseSmokeCheck([], {
      env: {
        SUPABASE_URL: "https://project-ref.supabase.co",
      },
      fetch: (async () => createResponse(401)) satisfies typeof fetch,
      stdout: (message: string) => {
        output += message;
      },
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("Project URL: configured");
    expect(output).not.toContain("project-ref");
  });

  test("formats smoke results without leaking URLs or route bodies", () => {
    const output = formatSupabaseSmokeResult({
      checks: [
        {
          message: "REST endpoint is reachable and requires API authentication.",
          name: "rest_endpoint",
          status: "passed",
          statusCode: 401,
        },
      ],
      projectUrl: "configured",
      ready: true,
    });

    expect(output).toContain("Supabase endpoint smoke readiness: ready");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("<html>");
  });
});
