import { pathToFileURL } from "node:url";

import { assessProductionRuntimeEnv } from "../apps/web/src/runtime/env.js";
import { runGitHubAppRuntimeReadiness } from "./check-github-app-runtime.js";
import { runProductionSmoke } from "./check-production-smoke.js";
import { runSupabaseDatabaseReadiness } from "./check-supabase-db.js";
import { runSupabaseLinkReadiness } from "./check-supabase-link.js";
import { runSupabaseMigrationReadiness } from "./check-supabase-migrations.js";
import { runSupabaseSmoke } from "./check-supabase-smoke.js";
import { runVercelProductionEnvReadiness } from "./check-vercel-production-env.js";

type FetchFunction = typeof fetch;
type ExecPsql = (
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<{
  readonly stderr: string;
  readonly stdout: string;
}>;
type ExecSupabaseMigrations = () => Promise<string>;
type ExecVercelEnvList = () => Promise<string>;
type ExecGitHubAppRuntime = () => ReturnType<typeof runGitHubAppRuntimeReadiness>;

type ReleaseCheckStatus = "blocked" | "passed" | "warning";

type ReleaseCheck = {
  readonly message: string;
  readonly name: string;
  readonly status: ReleaseCheckStatus;
  readonly statusCode?: number | null;
};

type ReleaseSection = {
  readonly checks: ReleaseCheck[];
  readonly name:
    | "github_app_runtime"
    | "production_runtime"
    | "production_smoke"
    | "supabase_database"
    | "supabase_link"
    | "supabase_migrations"
    | "supabase_smoke"
    | "vercel_production_env";
  readonly ready: boolean;
};

type ReleaseReadinessResult = {
  readonly ready: boolean;
  readonly sections: ReleaseSection[];
};

type ReleaseReadinessOptions = {
  readonly appUrl?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly execGitHubAppRuntime?: ExecGitHubAppRuntime | undefined;
  readonly execPsql?: ExecPsql | undefined;
  readonly execSupabaseMigrations?: ExecSupabaseMigrations | undefined;
  readonly execVercelEnvList?: ExecVercelEnvList | undefined;
  readonly fetch?: FetchFunction | undefined;
  readonly root?: string | undefined;
  readonly supabaseUrl?: string | undefined;
};

type ReleaseReadinessCheckOptions = ReleaseReadinessOptions & {
  readonly stderr?: (message: string) => void;
  readonly stdout?: (message: string) => void;
};

type ParsedArgs =
  | {
      readonly appUrl: undefined;
      readonly help: true;
      readonly json: false;
      readonly supabaseUrl: undefined;
    }
  | {
      readonly appUrl: string | undefined;
      readonly help: false;
      readonly json: boolean;
      readonly supabaseUrl: string | undefined;
    };

const usage = `Usage: pnpm release-readiness:check [--app-url <https-url>] [--supabase-url <https-url>] [--json]

Runs the safe production release gate: local runtime env, Vercel production env names, GitHub App runtime identity, deployed route smoke, Supabase link, Supabase migration history, direct Supabase database connectivity, and Supabase endpoint smoke.
Output contains only statuses, variable names, safe labels, and HTTP status codes; it never prints secret values, Supabase refs, database URLs, API keys, private keys, JWTs, webhook secrets, response bodies, or local paths.`;

const toRuntimeReleaseStatus = (input: {
  readonly required: boolean;
  readonly status: string;
}): ReleaseCheckStatus => {
  if (input.status === "configured") {
    return "passed";
  }

  return input.required ? "blocked" : "warning";
};

const makeBlockedSection = (
  name: ReleaseSection["name"],
  checkName: string,
  message: string,
): ReleaseSection => ({
  checks: [
    {
      message,
      name: checkName,
      status: "blocked",
    },
  ],
  name,
  ready: false,
});

const makeRuntimeSection = (env: Readonly<Record<string, string | undefined>>): ReleaseSection => {
  const readiness = assessProductionRuntimeEnv(env);

  return {
    checks: readiness.checks.map((check) => ({
      message: check.message,
      name: check.key,
      status: toRuntimeReleaseStatus(check),
    })),
    name: "production_runtime",
    ready: readiness.ready,
  };
};

const makeVercelProductionEnvSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  const readiness = await runVercelProductionEnvReadiness({
    ...(options.execVercelEnvList === undefined
      ? {}
      : { execVercelEnvList: options.execVercelEnvList }),
  });

  return {
    checks: readiness.checks.map((check) => ({
      message: check.message,
      name: check.key,
      status: toRuntimeReleaseStatus(check),
    })),
    name: "vercel_production_env",
    ready: readiness.ready,
  };
};

const makeGitHubAppRuntimeSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  try {
    const readiness =
      options.execGitHubAppRuntime === undefined
        ? await runGitHubAppRuntimeReadiness({
            env: options.env ?? process.env,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          })
        : await options.execGitHubAppRuntime();

    return {
      checks: readiness.checks.map((check) => ({
        message: check.message,
        name: check.name,
        status: check.status,
        ...(check.statusCode === undefined ? {} : { statusCode: check.statusCode }),
      })),
      name: "github_app_runtime",
      ready: readiness.ready,
    };
  } catch {
    return makeBlockedSection(
      "github_app_runtime",
      "app_identity",
      "GitHub App runtime verification could not run.",
    );
  }
};

const makeProductionSmokeSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  const url = options.appUrl ?? options.env?.WEB_BASE_URL;

  if (url === undefined || url.trim() === "") {
    return makeBlockedSection(
      "production_smoke",
      "app_url",
      "WEB_BASE_URL or --app-url is required before deployed route smoke can run.",
    );
  }

  try {
    const smoke = await runProductionSmoke({
      fetch: options.fetch,
      url,
    });

    return {
      checks: smoke.checks,
      name: "production_smoke",
      ready: smoke.ready,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production smoke check failed.";

    return makeBlockedSection("production_smoke", "production_smoke", message);
  }
};

const makeSupabaseLinkSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  const readiness = await runSupabaseLinkReadiness(
    options.root === undefined ? {} : { root: options.root },
  );

  return {
    checks: readiness.checks,
    name: "supabase_link",
    ready: readiness.ready,
  };
};

const makeSupabaseMigrationSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  const readiness = await runSupabaseMigrationReadiness({
    ...(options.execSupabaseMigrations === undefined
      ? {}
      : { execSupabase: options.execSupabaseMigrations }),
    ...(options.root === undefined ? {} : { root: options.root }),
  });

  return {
    checks: readiness.checks,
    name: "supabase_migrations",
    ready: readiness.ready,
  };
};

const makeSupabaseDatabaseSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  try {
    const readiness = await runSupabaseDatabaseReadiness({
      env: options.env ?? process.env,
      ...(options.execPsql === undefined ? {} : { execPsql: options.execPsql }),
    });

    return {
      checks: readiness.checks,
      name: "supabase_database",
      ready: readiness.ready,
    };
  } catch {
    return makeBlockedSection(
      "supabase_database",
      "database_connectivity",
      "Direct database verification could not run.",
    );
  }
};

const makeSupabaseSmokeSection = async (
  options: ReleaseReadinessOptions,
): Promise<ReleaseSection> => {
  const url = options.supabaseUrl ?? options.env?.SUPABASE_URL;

  if (url === undefined || url.trim() === "") {
    return makeBlockedSection(
      "supabase_smoke",
      "supabase_url",
      "SUPABASE_URL or --supabase-url is required before Supabase endpoint smoke can run.",
    );
  }

  try {
    const smoke = await runSupabaseSmoke({
      fetch: options.fetch,
      url,
    });

    return {
      checks: smoke.checks,
      name: "supabase_smoke",
      ready: smoke.ready,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supabase smoke check failed.";

    return makeBlockedSection("supabase_smoke", "supabase_smoke", message);
  }
};

export const parseReleaseReadinessArgs = (argv: readonly string[]): ParsedArgs => {
  let appUrl: string | undefined;
  let json = false;
  let supabaseUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { appUrl: undefined, help: true, json: false, supabaseUrl: undefined };
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--app-url") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--app-url requires a value.");
      }

      appUrl = value;
      index += 1;
      continue;
    }

    if (arg === "--supabase-url") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--supabase-url requires a value.");
      }

      supabaseUrl = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { appUrl, help: false, json, supabaseUrl };
};

export const runReleaseReadiness = async (
  options: ReleaseReadinessOptions = {},
): Promise<ReleaseReadinessResult> => {
  const env = options.env ?? process.env;
  const sections = [
    makeRuntimeSection(env),
    await makeVercelProductionEnvSection(options),
    await makeGitHubAppRuntimeSection({ ...options, env }),
    await makeProductionSmokeSection({ ...options, env }),
    await makeSupabaseLinkSection(options),
    await makeSupabaseMigrationSection(options),
    await makeSupabaseDatabaseSection({ ...options, env }),
    await makeSupabaseSmokeSection({ ...options, env }),
  ];

  return {
    ready: sections.every((section) => section.ready),
    sections,
  };
};

export const formatReleaseReadinessResult = (result: ReleaseReadinessResult): string => {
  const lines = [`Release readiness: ${result.ready ? "ready" : "blocked"}`, ""];

  for (const section of result.sections) {
    lines.push(`[${section.ready ? "ready" : "blocked"}] ${section.name}`);

    for (const check of section.checks) {
      const statusCode =
        check.statusCode === undefined || check.statusCode === null ? "" : ` (${check.statusCode})`;

      lines.push(`  - [${check.status}] ${check.name}${statusCode} - ${check.message}`);
    }
  }

  return lines.join("\n");
};

const toPublicResult = (result: ReleaseReadinessResult): ReleaseReadinessResult => result;

export const runReleaseReadinessCheck = async (
  argv: readonly string[],
  options: ReleaseReadinessCheckOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseReleaseReadinessArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const result = await runReleaseReadiness({
    appUrl: parsedArgs.appUrl ?? options.appUrl,
    env: options.env ?? process.env,
    ...(options.execPsql === undefined ? {} : { execPsql: options.execPsql }),
    ...(options.execSupabaseMigrations === undefined
      ? {}
      : { execSupabaseMigrations: options.execSupabaseMigrations }),
    ...(options.execVercelEnvList === undefined
      ? {}
      : { execVercelEnvList: options.execVercelEnvList }),
    ...(options.execGitHubAppRuntime === undefined
      ? {}
      : { execGitHubAppRuntime: options.execGitHubAppRuntime }),
    fetch: options.fetch,
    root: options.root,
    supabaseUrl: parsedArgs.supabaseUrl ?? options.supabaseUrl,
  });

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicResult(result), null, 2)}\n`);
  } else {
    stdout(`${formatReleaseReadinessResult(result)}\n`);
  }

  return result.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runReleaseReadinessCheck(process.argv.slice(2));
}
