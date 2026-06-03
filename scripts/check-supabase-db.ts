import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

type SupabaseDatabaseStatus = "blocked" | "passed";

type SupabaseDatabaseCheck = {
  readonly message: string;
  readonly name: "database_url" | "psql_connectivity";
  readonly status: SupabaseDatabaseStatus;
};

type SupabaseDatabaseReadiness = {
  readonly checks: SupabaseDatabaseCheck[];
  readonly databaseUrl: "configured" | "missing";
  readonly ready: boolean;
};

type PsqlEnv = Readonly<Record<string, string>>;

type ExecPsql = (
  args: readonly string[],
  env: PsqlEnv,
) => Promise<{
  readonly stderr: string;
  readonly stdout: string;
}>;

type SupabaseDatabaseOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly execPsql?: ExecPsql;
};

type SupabaseDatabaseCheckOptions = SupabaseDatabaseOptions & {
  readonly stderr?: (message: string) => void;
  readonly stdout?: (message: string) => void;
};

type ParsedArgs =
  | {
      readonly help: true;
      readonly json: false;
    }
  | {
      readonly help: false;
      readonly json: boolean;
    };

const execFileAsync = promisify(execFile);

const usage = `Usage: pnpm supabase-db:check [--json]

Checks direct Supabase Postgres connectivity using DATABASE_URL from the environment.
Output contains only statuses and safe messages; it never prints database URLs, passwords, hosts, query output, or raw psql errors.`;

const psqlArgs = [
  "--no-psqlrc",
  "--set",
  "ON_ERROR_STOP=1",
  "--tuples-only",
  "--no-align",
  "--quiet",
  "--command",
  "select 1 as cortex_readiness_check;",
] as const;

const defaultExecPsql: ExecPsql = async (args, env) => {
  const { stderr, stdout } = await execFileAsync("psql", [...args], {
    env: {
      ...process.env,
      ...env,
    },
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });

  return {
    stderr: String(stderr),
    stdout: String(stdout),
  };
};

const isPlaceholderPassword = (password: string): boolean => {
  const normalized = password.trim().toLowerCase();

  return (
    normalized === "" ||
    normalized.includes("your-password") ||
    normalized.includes("[your_password]") ||
    normalized.includes("[your-password]") ||
    normalized.includes("<remote-db-password>")
  );
};

const makeBlockedResult = (
  databaseUrl: SupabaseDatabaseReadiness["databaseUrl"],
  message: string,
): SupabaseDatabaseReadiness => ({
  checks: [
    {
      message,
      name: "database_url",
      status: "blocked",
    },
  ],
  databaseUrl,
  ready: false,
});

const buildPsqlEnv = (
  databaseUrl: string | undefined,
):
  | { databaseUrl: "configured"; env: PsqlEnv }
  | { databaseUrl: "configured" | "missing"; message: string } => {
  const rawValue = databaseUrl?.trim() ?? "";

  if (!rawValue) {
    return {
      databaseUrl: "missing",
      message: "DATABASE_URL is required before direct database verification can run.",
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(rawValue);
  } catch {
    return {
      databaseUrl: "configured",
      message: "DATABASE_URL must be a valid Postgres connection string.",
    };
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return {
      databaseUrl: "configured",
      message: "DATABASE_URL must use the postgres or postgresql protocol.",
    };
  }

  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

  if (!parsed.hostname || !user || !database) {
    return {
      databaseUrl: "configured",
      message: "DATABASE_URL must include a host, user, and database name.",
    };
  }

  if (isPlaceholderPassword(password)) {
    return {
      databaseUrl: "configured",
      message: "DATABASE_URL must contain the real database password.",
    };
  }

  return {
    databaseUrl: "configured",
    env: {
      PGCONNECT_TIMEOUT: "10",
      PGDATABASE: database,
      PGHOST: parsed.hostname,
      PGPASSWORD: password,
      PGPORT: parsed.port || "5432",
      PGSSLMODE: "require",
      PGUSER: user,
    },
  };
};

export const runSupabaseDatabaseReadiness = async (
  options: SupabaseDatabaseOptions = {},
): Promise<SupabaseDatabaseReadiness> => {
  const env = options.env ?? process.env;
  const parsed = buildPsqlEnv(env.DATABASE_URL);

  if (!("env" in parsed)) {
    return makeBlockedResult(parsed.databaseUrl, parsed.message);
  }

  const checks: SupabaseDatabaseCheck[] = [
    {
      message: "DATABASE_URL is present and uses a Postgres connection string.",
      name: "database_url",
      status: "passed",
    },
  ];

  try {
    const result = await (options.execPsql ?? defaultExecPsql)(psqlArgs, parsed.env);

    if (result.stdout.trim() !== "1") {
      checks.push({
        message: "Direct database query returned an unexpected result.",
        name: "psql_connectivity",
        status: "blocked",
      });
    } else {
      checks.push({
        message: "Direct database query completed successfully.",
        name: "psql_connectivity",
        status: "passed",
      });
    }
  } catch {
    checks.push({
      message: "Direct database query could not be completed.",
      name: "psql_connectivity",
      status: "blocked",
    });
  }

  return {
    checks,
    databaseUrl: parsed.databaseUrl,
    ready: checks.every((check) => check.status === "passed"),
  };
};

export const formatSupabaseDatabaseReadiness = (readiness: SupabaseDatabaseReadiness): string => {
  const lines = [
    `Supabase database readiness: ${readiness.ready ? "ready" : "blocked"}`,
    `Database URL: ${readiness.databaseUrl}`,
    "",
    ...readiness.checks.map((check) => `[${check.status}] ${check.name} - ${check.message}`),
  ];

  return lines.join("\n");
};

const toPublicReadiness = (readiness: SupabaseDatabaseReadiness): SupabaseDatabaseReadiness =>
  readiness;

export const parseSupabaseDatabaseCheckArgs = (argv: readonly string[]): ParsedArgs => {
  let json = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      return { help: true, json: false };
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, json };
};

export const runSupabaseDatabaseCheck = async (
  argv: readonly string[],
  options: SupabaseDatabaseCheckOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseSupabaseDatabaseCheckArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const readiness = await runSupabaseDatabaseReadiness({
    env: options.env ?? process.env,
    ...(options.execPsql === undefined ? {} : { execPsql: options.execPsql }),
  });

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicReadiness(readiness), null, 2)}\n`);
  } else {
    stdout(`${formatSupabaseDatabaseReadiness(readiness)}\n`);
  }

  return readiness.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runSupabaseDatabaseCheck(process.argv.slice(2));
}
