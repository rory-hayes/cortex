import { createPrivateKey, sign } from "node:crypto";
import { pathToFileURL } from "node:url";

import { assessProductionRuntimeEnv } from "../apps/web/src/runtime/env.js";

type FetchFunction = typeof fetch;

type GitHubAppCheckStatus = "blocked" | "passed" | "warning";

type GitHubAppRuntimeCheck = {
  readonly message: string;
  readonly name:
    | "GITHUB_APP_ID"
    | "GITHUB_APP_PRIVATE_KEY"
    | "GITHUB_WEBHOOK_SECRET"
    | "app_identity"
    | "app_jwt";
  readonly status: GitHubAppCheckStatus;
  readonly statusCode?: number | null;
};

type GitHubAppRuntimeReadiness = {
  readonly checks: GitHubAppRuntimeCheck[];
  readonly live: boolean;
  readonly ready: boolean;
};

type GitHubAppRuntimeOptions = {
  readonly apiBaseUrl?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchFunction;
  readonly live?: boolean;
  readonly now?: () => Date;
};

type GitHubAppRuntimeCheckOptions = GitHubAppRuntimeOptions & {
  readonly stderr?: (message: string) => void;
  readonly stdout?: (message: string) => void;
};

type ParsedArgs =
  | {
      readonly help: true;
      readonly json: false;
      readonly live: true;
    }
  | {
      readonly help: false;
      readonly json: boolean;
      readonly live: boolean;
    };

const defaultApiBaseUrl = "https://api.github.com";

const usage = `Usage: pnpm github-app:check [--json] [--offline]

Validates GitHub App runtime credentials from the current shell.
Default mode signs a GitHub App JWT and verifies it against the GitHub /app endpoint.
Offline mode validates required values and local JWT signing only.
Output contains only key names, statuses, and HTTP status codes; it never prints private keys, JWTs, webhook secrets, response bodies, or raw GitHub errors.`;

const normalizePrivateKey = (value: string): string => value.replace(/\\n/gu, "\n");

const toBase64UrlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const createGitHubAppJwt = (input: { appId: string; now: Date; privateKey: string }): string => {
  const issuedAt = Math.floor(input.now.getTime() / 1_000) - 60;
  const expiresAt = issuedAt + 9 * 60;
  const header = toBase64UrlJson({
    alg: "RS256",
    typ: "JWT",
  });
  const payload = toBase64UrlJson({
    exp: expiresAt,
    iat: issuedAt,
    iss: input.appId,
  });
  const signingInput = `${header}.${payload}`;
  const privateKey = createPrivateKey(normalizePrivateKey(input.privateKey));
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");

  return `${signingInput}.${signature}`;
};

const buildGitHubAppUrl = (apiBaseUrl: string): string => {
  const url = new URL("/app", apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`);

  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("GitHub API base URL must be HTTPS.");
  }

  return url.toString();
};

const githubRuntimeKeys = new Set([
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
]);

const getGithubRuntimeChecks = (
  env: Readonly<Record<string, string | undefined>>,
): GitHubAppRuntimeCheck[] =>
  assessProductionRuntimeEnv(env)
    .checks.filter((check) => githubRuntimeKeys.has(check.key))
    .map((check) => ({
      message: check.message,
      name: check.key as GitHubAppRuntimeCheck["name"],
      status: check.status === "configured" ? "passed" : "blocked",
    }));

const hasBlockedChecks = (checks: readonly GitHubAppRuntimeCheck[]): boolean =>
  checks.some((check) => check.status === "blocked");

const makeBlockedResult = (
  checks: readonly GitHubAppRuntimeCheck[],
  live: boolean,
): GitHubAppRuntimeReadiness => ({
  checks: [...checks],
  live,
  ready: false,
});

export const runGitHubAppRuntimeReadiness = async (
  options: GitHubAppRuntimeOptions = {},
): Promise<GitHubAppRuntimeReadiness> => {
  const env = options.env ?? process.env;
  const live = options.live ?? true;
  const checks = getGithubRuntimeChecks(env);

  if (hasBlockedChecks(checks)) {
    return makeBlockedResult(checks, live);
  }

  let jwt: string;

  try {
    jwt = createGitHubAppJwt({
      appId: env.GITHUB_APP_ID ?? "",
      now: options.now?.() ?? new Date(),
      privateKey: env.GITHUB_APP_PRIVATE_KEY ?? "",
    });
    checks.push({
      message: "GitHub App private key can sign an app JWT.",
      name: "app_jwt",
      status: "passed",
    });
  } catch {
    checks.push({
      message: "GitHub App private key could not sign an app JWT.",
      name: "app_jwt",
      status: "blocked",
    });

    return makeBlockedResult(checks, live);
  }

  if (!live) {
    checks.push({
      message: "Live GitHub App API identity verification was skipped.",
      name: "app_identity",
      status: "warning",
    });

    return {
      checks,
      live,
      ready: true,
    };
  }

  try {
    const response = await (options.fetch ?? fetch)(
      buildGitHubAppUrl(options.apiBaseUrl ?? defaultApiBaseUrl),
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method: "GET",
      },
    );

    if (!response.ok) {
      checks.push({
        message: "GitHub App API identity verification failed.",
        name: "app_identity",
        status: "blocked",
        statusCode: response.status,
      });

      return makeBlockedResult(checks, live);
    }

    const payload: unknown = await response.json();
    const appId =
      typeof payload === "object" && payload !== null
        ? (payload as { id?: unknown }).id
        : undefined;

    if (typeof appId !== "number" || String(appId) !== env.GITHUB_APP_ID) {
      checks.push({
        message: "GitHub App API identity response did not match the configured app id.",
        name: "app_identity",
        status: "blocked",
        statusCode: response.status,
      });

      return makeBlockedResult(checks, live);
    }

    checks.push({
      message: "GitHub App API identity verification completed successfully.",
      name: "app_identity",
      status: "passed",
      statusCode: response.status,
    });
  } catch {
    checks.push({
      message: "GitHub App API identity verification could not be completed.",
      name: "app_identity",
      status: "blocked",
      statusCode: null,
    });

    return makeBlockedResult(checks, live);
  }

  return {
    checks,
    live,
    ready: true,
  };
};

export const formatGitHubAppRuntimeReadiness = (readiness: GitHubAppRuntimeReadiness): string => {
  const lines = [
    `GitHub App runtime readiness: ${readiness.ready ? "ready" : "blocked"}`,
    `Mode: ${readiness.live ? "live" : "offline"}`,
    "",
    ...readiness.checks.map((check) => {
      const statusSuffix = check.statusCode === undefined ? "" : ` (HTTP ${check.statusCode})`;

      return `[${check.status}] ${check.name} - ${check.message}${statusSuffix}`;
    }),
  ];

  return lines.join("\n");
};

export const parseGitHubAppRuntimeCheckArgs = (argv: readonly string[]): ParsedArgs => {
  let json = false;
  let live = true;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      return { help: true, json: false, live: true };
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--offline") {
      live = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, json, live };
};

export const runGitHubAppRuntimeCheck = async (
  argv: readonly string[],
  options: GitHubAppRuntimeCheckOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseGitHubAppRuntimeCheckArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const readiness = await runGitHubAppRuntimeReadiness({
    ...(options.apiBaseUrl === undefined ? {} : { apiBaseUrl: options.apiBaseUrl }),
    env: options.env ?? process.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    live: parsedArgs.live,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(readiness, null, 2)}\n`);
  } else {
    stdout(`${formatGitHubAppRuntimeReadiness(readiness)}\n`);
  }

  return readiness.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runGitHubAppRuntimeCheck(process.argv.slice(2));
}
