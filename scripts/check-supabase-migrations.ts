import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

type MigrationStatus = "blocked" | "passed";

type MigrationCheck = {
  readonly message: string;
  readonly name: "local_migrations" | "remote_history";
  readonly status: MigrationStatus;
};

type MigrationSummary = {
  readonly count: number;
  readonly latest: string | null;
};

type RemoteMigrationSummary = MigrationSummary & {
  readonly available: boolean;
};

type SupabaseMigrationReadiness = {
  readonly checks: MigrationCheck[];
  readonly extraRemoteVersions: string[];
  readonly local: MigrationSummary;
  readonly missingRemoteVersions: string[];
  readonly ready: boolean;
  readonly remote: RemoteMigrationSummary;
};

type ExecSupabase = () => Promise<string>;

type SupabaseMigrationOptions = {
  readonly execSupabase?: ExecSupabase;
  readonly root?: string;
};

type SupabaseMigrationCheckOptions = SupabaseMigrationOptions & {
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

const usage = `Usage: pnpm supabase-migrations:check [--json]

Compares canonical local package migrations with linked Supabase remote migration history.
Output contains only migration counts and version ids; it never prints database URLs, project refs, passwords, API keys, local paths, or raw command output.`;

const migrationVersionPattern = /^(\d{4})_.+\.sql$/u;

const parseMigrationVersionsFromFilenames = (filenames: readonly string[]): string[] =>
  [
    ...new Set(
      filenames
        .map((filename) => migrationVersionPattern.exec(filename)?.[1])
        .filter((version): version is string => version !== undefined),
    ),
  ].sort();

const summarizeVersions = (versions: readonly string[]): MigrationSummary => ({
  count: versions.length,
  latest: versions.at(-1) ?? null,
});

const parseRemoteMigrationVersions = (output: string): string[] => {
  const versions = new Set<string>();

  for (const line of output.split(/\r?\n/u)) {
    const columns = line
      .split("|")
      .map((column) => column.trim())
      .filter(Boolean);

    if (columns.length < 2) {
      continue;
    }

    const remoteVersion = columns.at(1);

    if (remoteVersion !== undefined && /^\d{4}$/u.test(remoteVersion)) {
      versions.add(remoteVersion);
    }
  }

  return [...versions].sort();
};

const readLocalMigrationVersions = async (root: string): Promise<string[]> => {
  try {
    const filenames = await readdir(join(root, "packages", "db", "migrations"));
    return parseMigrationVersionsFromFilenames(filenames);
  } catch {
    return [];
  }
};

const defaultExecSupabase: ExecSupabase = async () => {
  const { stdout } = await execFileAsync(
    "supabase",
    ["migration", "list", "--linked", "--password", ""],
    {
      maxBuffer: 1024 * 1024,
    },
  );

  return stdout;
};

const compareVersions = (left: readonly string[], right: readonly string[]): string[] => {
  const rightSet = new Set(right);
  return left.filter((version) => !rightSet.has(version));
};

export const runSupabaseMigrationReadiness = async (
  options: SupabaseMigrationOptions = {},
): Promise<SupabaseMigrationReadiness> => {
  const root = options.root ?? process.cwd();
  const localVersions = await readLocalMigrationVersions(root);
  const checks: MigrationCheck[] = [];

  checks.push(
    localVersions.length === 0
      ? {
          message: "No canonical local package migrations were found.",
          name: "local_migrations",
          status: "blocked",
        }
      : {
          message: "Canonical local package migrations were found.",
          name: "local_migrations",
          status: "passed",
        },
  );

  let remoteVersions: string[] = [];
  let remoteAvailable = true;

  try {
    remoteVersions = parseRemoteMigrationVersions(
      await (options.execSupabase ?? defaultExecSupabase)(),
    );

    if (remoteVersions.length === 0) {
      remoteAvailable = false;
    }
  } catch {
    remoteAvailable = false;
  }

  const missingRemoteVersions = compareVersions(localVersions, remoteVersions);
  const extraRemoteVersions = compareVersions(remoteVersions, localVersions);

  if (!remoteAvailable) {
    checks.push({
      message: "Linked remote migration history could not be read.",
      name: "remote_history",
      status: "blocked",
    });
  } else if (missingRemoteVersions.length > 0) {
    checks.push({
      message:
        "Linked remote migration history is missing canonical local package migration versions.",
      name: "remote_history",
      status: "blocked",
    });
  } else {
    checks.push({
      message: "Linked remote migration history includes all canonical local migrations.",
      name: "remote_history",
      status: "passed",
    });
  }

  const ready = localVersions.length > 0 && remoteAvailable && missingRemoteVersions.length === 0;

  return {
    checks,
    extraRemoteVersions,
    local: summarizeVersions(localVersions),
    missingRemoteVersions,
    ready,
    remote: {
      ...summarizeVersions(remoteVersions),
      available: remoteAvailable,
    },
  };
};

export const formatSupabaseMigrationReadiness = (readiness: SupabaseMigrationReadiness): string => {
  const lines = [
    `Supabase migration readiness: ${readiness.ready ? "ready" : "blocked"}`,
    `Local migrations: ${readiness.local.count}`,
    `Remote migrations: ${readiness.remote.available ? readiness.remote.count : "unavailable"}`,
    `Latest local: ${readiness.local.latest ?? "none"}`,
    `Latest remote: ${readiness.remote.latest ?? "none"}`,
    "",
    ...readiness.checks.map((check) => `[${check.status}] ${check.name} - ${check.message}`),
  ];

  if (readiness.missingRemoteVersions.length > 0) {
    lines.push(
      "",
      `Missing remote versions: ${readiness.missingRemoteVersions.join(", ")}`,
      "Apply canonical package migrations through the approved database release flow.",
    );
  }

  if (readiness.extraRemoteVersions.length > 0) {
    lines.push("", `Extra remote versions: ${readiness.extraRemoteVersions.join(", ")}`);
  }

  return lines.join("\n");
};

const toPublicReadiness = (readiness: SupabaseMigrationReadiness) => readiness;

export const parseSupabaseMigrationCheckArgs = (argv: readonly string[]): ParsedArgs => {
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

export const runSupabaseMigrationCheck = async (
  argv: readonly string[],
  options: SupabaseMigrationCheckOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseSupabaseMigrationCheckArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const readiness = await runSupabaseMigrationReadiness({
    ...(options.execSupabase === undefined ? {} : { execSupabase: options.execSupabase }),
    ...(options.root === undefined ? {} : { root: options.root }),
  });

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicReadiness(readiness), null, 2)}\n`);
  } else {
    stdout(`${formatSupabaseMigrationReadiness(readiness)}\n`);
  }

  return readiness.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runSupabaseMigrationCheck(process.argv.slice(2));
}
