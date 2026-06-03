import { pathToFileURL } from "node:url";

type FetchFunction = typeof fetch;

type SupabaseSmokeStatus = "blocked" | "passed" | "warning";

type SupabaseSmokeCheck = {
  readonly message: string;
  readonly name: "auth_health_endpoint" | "rest_endpoint";
  readonly status: SupabaseSmokeStatus;
  readonly statusCode: number | null;
};

type SupabaseSmokeResult = {
  readonly checks: SupabaseSmokeCheck[];
  readonly projectUrl: "configured";
  readonly ready: boolean;
};

type SupabaseSmokeOptions = {
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

type EndpointDefinition = {
  readonly label: string;
  readonly name: SupabaseSmokeCheck["name"];
  readonly pathname: string;
};

const usage = `Usage: pnpm supabase-smoke:check [--url <https-url>] [--json]

Checks Supabase REST/Auth endpoint reachability without printing response bodies, project refs, or secrets.
Defaults to SUPABASE_URL when --url is omitted.`;

const endpointDefinitions = [
  {
    label: "REST endpoint",
    name: "rest_endpoint",
    pathname: "/rest/v1/",
  },
  {
    label: "Auth health endpoint",
    name: "auth_health_endpoint",
    pathname: "/auth/v1/health",
  },
] as const satisfies readonly EndpointDefinition[];

const isLocalHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]" ||
  hostname.endsWith(".localhost");

const normalizeSupabaseUrl = (value: string | undefined): URL => {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new Error("SUPABASE_URL or --url is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Supabase smoke URL must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && !isLocalHostname(parsed.hostname)) {
    throw new Error("Supabase smoke URL must use HTTPS unless targeting localhost.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Supabase smoke URL must not include credentials, query strings, or hashes.");
  }

  const baseUrl = new URL(parsed.toString());
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  return baseUrl;
};

const joinEndpoint = (baseUrl: URL, pathname: string): URL => {
  const url = new URL(baseUrl.toString());

  url.pathname = pathname;
  url.search = "";
  url.hash = "";

  return url;
};

export const parseSupabaseSmokeArgs = (argv: readonly string[]): ParsedArgs => {
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

const classifyEndpointResponse = (
  definition: EndpointDefinition,
  statusCode: number,
): SupabaseSmokeCheck => {
  if (statusCode >= 200 && statusCode < 400) {
    return {
      message: `${definition.label} is reachable.`,
      name: definition.name,
      status: "passed",
      statusCode,
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      message: `${definition.label} is reachable and requires API authentication.`,
      name: definition.name,
      status: "passed",
      statusCode,
    };
  }

  if (statusCode === 429) {
    return {
      message: `${definition.label} is reachable but rate-limited.`,
      name: definition.name,
      status: "warning",
      statusCode,
    };
  }

  if (statusCode === 404) {
    return {
      message: `${definition.label} was not found.`,
      name: definition.name,
      status: "blocked",
      statusCode,
    };
  }

  if (statusCode >= 500) {
    return {
      message: `${definition.label} returned a server error.`,
      name: definition.name,
      status: "blocked",
      statusCode,
    };
  }

  return {
    message: `${definition.label} returned an unexpected status.`,
    name: definition.name,
    status: "blocked",
    statusCode,
  };
};

const buildEndpointCheck = async (
  fetchFn: FetchFunction,
  baseUrl: URL,
  definition: EndpointDefinition,
): Promise<SupabaseSmokeCheck> => {
  try {
    const response = await fetchFn(joinEndpoint(baseUrl, definition.pathname), {
      redirect: "manual",
    });

    return classifyEndpointResponse(definition, response.status);
  } catch {
    return {
      message: `${definition.label} could not be reached.`,
      name: definition.name,
      status: "blocked",
      statusCode: null,
    };
  }
};

export const runSupabaseSmoke = async (input: {
  readonly fetch?: FetchFunction | undefined;
  readonly url: string | undefined;
}): Promise<SupabaseSmokeResult> => {
  const fetchFn = input.fetch ?? fetch;
  const baseUrl = normalizeSupabaseUrl(input.url);
  const checks: SupabaseSmokeCheck[] = [];

  for (const definition of endpointDefinitions) {
    checks.push(await buildEndpointCheck(fetchFn, baseUrl, definition));
  }

  return {
    checks,
    projectUrl: "configured",
    ready: checks.every((check) => check.status === "passed"),
  };
};

export const formatSupabaseSmokeResult = (result: SupabaseSmokeResult): string => {
  const lines = [
    `Supabase endpoint smoke readiness: ${result.ready ? "ready" : "blocked"}`,
    `Project URL: ${result.projectUrl}`,
    "",
    ...result.checks.map((check) => {
      const statusCode = check.statusCode === null ? "n/a" : String(check.statusCode);

      return `[${check.status}] ${check.name} (${statusCode}) - ${check.message}`;
    }),
  ];

  return lines.join("\n");
};

const toPublicResult = (result: SupabaseSmokeResult) => ({
  checks: result.checks,
  projectUrl: result.projectUrl,
  ready: result.ready,
});

export const runSupabaseSmokeCheck = async (
  argv: readonly string[],
  options: SupabaseSmokeOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseSupabaseSmokeArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  try {
    const url = parsedArgs.url ?? options.env?.SUPABASE_URL ?? process.env.SUPABASE_URL;
    const result = await runSupabaseSmoke({
      fetch: options.fetch,
      url,
    });

    if (parsedArgs.json) {
      stdout(`${JSON.stringify(toPublicResult(result), null, 2)}\n`);
    } else {
      stdout(`${formatSupabaseSmokeResult(result)}\n`);
    }

    return result.ready ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supabase smoke check failed.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runSupabaseSmokeCheck(process.argv.slice(2));
}
