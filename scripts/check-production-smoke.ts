import { pathToFileURL } from "node:url";

type FetchFunction = typeof fetch;

type SmokeStatus = "blocked" | "passed" | "warning";

type SmokeCheck = {
  readonly message: string;
  readonly name: "protected_route" | "public_route" | "sign_up_route";
  readonly status: SmokeStatus;
  readonly statusCode: number | null;
};

type SmokeResult = {
  readonly baseOrigin: string;
  readonly checks: SmokeCheck[];
  readonly ready: boolean;
};

type SmokeOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchFunction;
  readonly stderr?: (message: string) => void;
  readonly stdout?: (message: string) => void;
};

type ParsedArgs =
  | {
      readonly help: true;
      readonly json: false;
      readonly url: undefined;
    }
  | {
      readonly help: false;
      readonly json: boolean;
      readonly url: string | undefined;
    };

const usage = `Usage: pnpm production-smoke:check [--url <https-url>] [--json]

Checks production public/protected route reachability without printing response bodies or secrets.
Defaults to WEB_BASE_URL when --url is omitted.`;

const normalizeBaseUrl = (value: string | undefined): URL => {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new Error("WEB_BASE_URL or --url is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Production smoke URL must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Production smoke URL must use HTTPS unless targeting localhost.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Production smoke URL must not include credentials, query strings, or hashes.");
  }

  return parsed;
};

const joinRoute = (baseUrl: URL, pathname: string): URL => {
  const url = new URL(baseUrl.toString());

  url.pathname = pathname;
  url.search = "";
  url.hash = "";

  return url;
};

const publicBaseOrigin = (url: URL): string => `${url.protocol}//${url.host}`;

export const parseProductionSmokeArgs = (argv: readonly string[]): ParsedArgs => {
  let json = false;
  let url: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true, json: false, url: undefined };
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--url") {
      const nextValue = argv[index + 1];

      if (nextValue === undefined || nextValue.startsWith("--")) {
        throw new Error("--url requires a value.");
      }

      url = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, json, url };
};

const buildPublicRouteCheck = async (fetchFn: FetchFunction, baseUrl: URL): Promise<SmokeCheck> => {
  const response = await fetchFn(joinRoute(baseUrl, "/"), {
    redirect: "follow",
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    return {
      message: "Public route did not return a successful status.",
      name: "public_route",
      status: "blocked",
      statusCode: response.status,
    };
  }

  if (!contentType.toLowerCase().includes("text/html")) {
    return {
      message: "Public route is reachable but did not return HTML.",
      name: "public_route",
      status: "warning",
      statusCode: response.status,
    };
  }

  const body = await response.text();

  if (!body.includes("Cortex")) {
    return {
      message: "Public route is reachable but the Cortex landing marker was not found.",
      name: "public_route",
      status: "warning",
      statusCode: response.status,
    };
  }

  return {
    message: "Public route is reachable.",
    name: "public_route",
    status: "passed",
    statusCode: response.status,
  };
};

const buildProtectedRouteCheck = async (
  fetchFn: FetchFunction,
  baseUrl: URL,
): Promise<SmokeCheck> => {
  const response = await fetchFn(joinRoute(baseUrl, "/dashboard"), {
    redirect: "manual",
  });

  if (response.status === 503) {
    return {
      message: "Protected route reports authentication is not configured.",
      name: "protected_route",
      status: "blocked",
      statusCode: response.status,
    };
  }

  if (response.status >= 200 && response.status < 400) {
    return {
      message: "Protected route no longer returns the missing-auth configuration response.",
      name: "protected_route",
      status: "passed",
      statusCode: response.status,
    };
  }

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return {
      message: "Protected route is reachable and guarded, but needs authenticated manual review.",
      name: "protected_route",
      status: "warning",
      statusCode: response.status,
    };
  }

  return {
    message: "Protected route returned an unexpected status.",
    name: "protected_route",
    status: "blocked",
    statusCode: response.status,
  };
};

const buildSignUpRouteCheck = async (fetchFn: FetchFunction, baseUrl: URL): Promise<SmokeCheck> => {
  const response = await fetchFn(joinRoute(baseUrl, "/sign-up"), {
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";

    if (
      location.includes("/auth/login") &&
      location.includes("screen_hint=signup") &&
      location.includes("returnTo=%2Fdashboard")
    ) {
      return {
        message: "Sign-up route redirects to Auth0 signup with dashboard return.",
        name: "sign_up_route",
        status: "passed",
        statusCode: response.status,
      };
    }

    return {
      message: "Sign-up route redirects, but not to the Auth0 signup flow with dashboard return.",
      name: "sign_up_route",
      status: "blocked",
      statusCode: response.status,
    };
  }

  if (!response.ok) {
    return {
      message: "Sign-up route did not return a successful status.",
      name: "sign_up_route",
      status: "blocked",
      statusCode: response.status,
    };
  }

  if (!contentType.toLowerCase().includes("text/html")) {
    return {
      message: "Sign-up route is reachable but did not return HTML.",
      name: "sign_up_route",
      status: "warning",
      statusCode: response.status,
    };
  }

  const body = await response.text();

  if (!body.includes('data-auth-page="sign-up"')) {
    return {
      message: "Sign-up route is reachable but did not render an auth page marker.",
      name: "sign_up_route",
      status: "blocked",
      statusCode: response.status,
    };
  }

  if (body.includes("Authentication setup required")) {
    return {
      message: "Sign-up route renders the missing-auth configuration notice.",
      name: "sign_up_route",
      status: "warning",
      statusCode: response.status,
    };
  }

  return {
    message: "Sign-up route is reachable.",
    name: "sign_up_route",
    status: "passed",
    statusCode: response.status,
  };
};

export const runProductionSmoke = async (input: {
  readonly fetch?: FetchFunction | undefined;
  readonly url: string | undefined;
}): Promise<SmokeResult> => {
  const fetchFn = input.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(input.url);
  const checks = [
    await buildPublicRouteCheck(fetchFn, baseUrl),
    await buildSignUpRouteCheck(fetchFn, baseUrl),
    await buildProtectedRouteCheck(fetchFn, baseUrl),
  ];

  return {
    baseOrigin: publicBaseOrigin(baseUrl),
    checks,
    ready: checks.every((check) => check.status === "passed"),
  };
};

export const formatProductionSmokeResult = (result: SmokeResult): string => {
  const lines = [
    `Production smoke readiness: ${result.ready ? "ready" : "blocked"}`,
    `Base origin: ${result.baseOrigin}`,
    "",
    ...result.checks.map((check) => {
      const statusCode = check.statusCode === null ? "n/a" : String(check.statusCode);

      return `[${check.status}] ${check.name} (${statusCode}) - ${check.message}`;
    }),
  ];

  return lines.join("\n");
};

const toPublicResult = (result: SmokeResult) => ({
  baseOrigin: result.baseOrigin,
  checks: result.checks,
  ready: result.ready,
});

export const runProductionSmokeCheck = async (
  argv: readonly string[],
  options: SmokeOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseProductionSmokeArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  let result: SmokeResult;

  try {
    result = await runProductionSmoke({
      fetch: options.fetch,
      url: parsedArgs.url ?? options.env?.WEB_BASE_URL,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production smoke check failed.";

    stderr(`${message}\n`);
    return 2;
  }

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicResult(result), null, 2)}\n`);
  } else {
    stdout(`${formatProductionSmokeResult(result)}\n`);
  }

  return result.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runProductionSmokeCheck(process.argv.slice(2), {
    env: process.env,
  });
}
