import { describe, expect, test } from "vitest";

import {
  formatProductionSmokeResult,
  parseProductionSmokeArgs,
  runProductionSmoke,
  runProductionSmokeCheck,
} from "./check-production-smoke.js";

const createResponse = (
  status: number,
  body = "",
  headers: Record<string, string> = {},
): Response => new Response(body, { headers, status });

describe("production smoke check command", () => {
  test("parses supported arguments", () => {
    expect(parseProductionSmokeArgs([])).toEqual({ help: false, json: false, url: undefined });
    expect(parseProductionSmokeArgs(["--json"])).toEqual({
      help: false,
      json: true,
      url: undefined,
    });
    expect(parseProductionSmokeArgs(["--url", "https://cortex.internal"])).toEqual({
      help: false,
      json: false,
      url: "https://cortex.internal",
    });
    expect(parseProductionSmokeArgs(["--help"])).toEqual({
      help: true,
      json: false,
      url: undefined,
    });
    expect(() => parseProductionSmokeArgs(["--url"])).toThrow(/requires a value/);
    expect(() => parseProductionSmokeArgs(["--verbose"])).toThrow(/Unknown argument/);
  });

  test("passes when public route is HTML and protected route no longer returns missing auth", async () => {
    const requestedUrls: string[] = [];
    const result = await runProductionSmoke({
      fetch: (async (url) => {
        requestedUrls.push(String(url));

        if (String(url).endsWith("/dashboard")) {
          return createResponse(302);
        }

        if (String(url).endsWith("/sign-up")) {
          return createResponse(307, "", {
            location: "/auth/login?screen_hint=signup&returnTo=%2Fdashboard",
          });
        }

        return createResponse(200, "<html><title>Cortex</title></html>", {
          "content-type": "text/html; charset=utf-8",
        });
      }) satisfies typeof fetch,
      url: "https://cortex.internal/app",
    });

    expect(result.ready).toBe(true);
    expect(result.baseOrigin).toBe("https://cortex.internal");
    expect(requestedUrls).toEqual([
      "https://cortex.internal/",
      "https://cortex.internal/sign-up",
      "https://cortex.internal/dashboard",
    ]);
  });

  test("passes when the sign-up route redirects to Auth0 signup", async () => {
    const result = await runProductionSmoke({
      fetch: (async (url) => {
        if (String(url).endsWith("/dashboard")) {
          return createResponse(302);
        }

        if (String(url).endsWith("/sign-up")) {
          return createResponse(302, "", {
            location: "/auth/login?screen_hint=signup&returnTo=%2Fdashboard",
          });
        }

        return createResponse(200, "<html>Cortex</html>", {
          "content-type": "text/html",
        });
      }) satisfies typeof fetch,
      url: "https://cortex.internal",
    });

    expect(result.ready).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Sign-up route redirects to Auth0 signup with dashboard return.",
          name: "sign_up_route",
          status: "passed",
          statusCode: 302,
        }),
      ]),
    );
  });

  test("blocks when the sign-up route renders a blank auth shell", async () => {
    const result = await runProductionSmoke({
      fetch: (async (url) => {
        if (String(url).endsWith("/dashboard")) {
          return createResponse(302);
        }

        if (String(url).endsWith("/sign-up")) {
          return createResponse(200, "<html><main></main></html>", {
            "content-type": "text/html",
          });
        }

        return createResponse(200, "<html>Cortex</html>", {
          "content-type": "text/html",
        });
      }) satisfies typeof fetch,
      url: "https://cortex.internal",
    });

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Sign-up route is reachable but did not render an auth page marker.",
          name: "sign_up_route",
          status: "blocked",
          statusCode: 200,
        }),
      ]),
    );
  });

  test("blocks when the protected route reports missing auth configuration", async () => {
    const result = await runProductionSmoke({
      fetch: (async (url) => {
        if (String(url).endsWith("/dashboard")) {
          return createResponse(503, "Authentication is not configured for this deployment.");
        }

        if (String(url).endsWith("/sign-up")) {
          return createResponse(
            200,
            '<html><main data-auth-page="sign-up">Setup required</main></html>',
            {
              "content-type": "text/html",
            },
          );
        }

        return createResponse(200, "<html>Cortex</html>", {
          "content-type": "text/html",
        });
      }) satisfies typeof fetch,
      url: "https://cortex.internal",
    });

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Protected route reports authentication is not configured.",
          name: "protected_route",
          status: "blocked",
          statusCode: 503,
        }),
      ]),
    );
  });

  test("rejects credentialed or query-bearing smoke URLs without echoing them", async () => {
    let stderr = "";
    const credentialedUrl = ["https://", "user", ":", "secret", "@cortex.internal"].join("");
    const credentialMarker = ["user", ":", "secret"].join("");
    const exitCode = await runProductionSmokeCheck(["--url", credentialedUrl], {
      stderr: (message: string) => {
        stderr += message;
      },
    });

    expect(exitCode).toBe(2);
    expect(stderr).toContain("must not include credentials");
    expect(stderr).not.toContain(credentialMarker);
  });

  test("prints safe text and JSON output without response bodies", async () => {
    let textOutput = "";
    const fetchFn = (async (url) => {
      if (String(url).endsWith("/dashboard")) {
        return createResponse(503, "secret response body");
      }

      if (String(url).endsWith("/sign-up")) {
        return createResponse(
          200,
          '<html><main data-auth-page="sign-up">secret signup body</main></html>',
          {
            "content-type": "text/html",
          },
        );
      }

      return createResponse(200, "<html>Cortex secret body</html>", {
        "content-type": "text/html",
      });
    }) satisfies typeof fetch;
    const textExitCode = await runProductionSmokeCheck(["--url", "https://cortex.internal"], {
      fetch: fetchFn,
      stdout: (message: string) => {
        textOutput += message;
      },
    });
    let jsonOutput = "";
    const jsonExitCode = await runProductionSmokeCheck(
      ["--url", "https://cortex.internal", "--json"],
      {
        fetch: fetchFn,
        stdout: (message: string) => {
          jsonOutput += message;
        },
      },
    );

    expect(textExitCode).toBe(1);
    expect(jsonExitCode).toBe(1);
    expect(textOutput).toContain("Production smoke readiness: blocked");
    expect(jsonOutput).toContain('"ready": false');
    expect(`${textOutput}\n${jsonOutput}`).not.toContain("secret response body");
    expect(`${textOutput}\n${jsonOutput}`).not.toContain("secret signup body");
    expect(`${textOutput}\n${jsonOutput}`).not.toContain("Cortex secret body");
  });

  test("formats smoke results without leaking route bodies", () => {
    const output = formatProductionSmokeResult({
      baseOrigin: "https://cortex.internal",
      checks: [
        {
          message: "Public route is reachable.",
          name: "public_route",
          status: "passed",
          statusCode: 200,
        },
      ],
      ready: true,
    });

    expect(output).toContain("Production smoke readiness: ready");
    expect(output).not.toContain("<html>");
  });
});
