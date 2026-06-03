import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type SupabaseLinkStatus = "blocked" | "passed";

type SupabaseLinkCheck = {
  readonly message: string;
  readonly name: "local_config" | "project_link";
  readonly status: SupabaseLinkStatus;
};

type SupabaseLinkReadiness = {
  readonly checks: SupabaseLinkCheck[];
  readonly config: "configured" | "missing";
  readonly projectRef: "configured" | "missing";
  readonly ready: boolean;
};

type SupabaseLinkOptions = {
  readonly root?: string;
};

type SupabaseLinkCheckOptions = SupabaseLinkOptions & {
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

const usage = `Usage: pnpm supabase-link:check [--json]

Checks whether local Supabase config exists and whether the project is linked.
Output contains only status labels; it never prints project refs, passwords, API keys, or paths.`;

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const hasNonEmptyProjectRef = async (path: string): Promise<boolean> => {
  try {
    const value = await readFile(path, "utf8");
    return value.trim().length > 0;
  } catch {
    return false;
  }
};

export const parseSupabaseLinkCheckArgs = (argv: readonly string[]): ParsedArgs => {
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

export const runSupabaseLinkReadiness = async (
  options: SupabaseLinkOptions = {},
): Promise<SupabaseLinkReadiness> => {
  const root = options.root ?? process.cwd();
  const configPath = join(root, "supabase", "config.toml");
  const projectRefPath = join(root, "supabase", ".temp", "project-ref");
  const hasConfig = await fileExists(configPath);

  if (!hasConfig) {
    return {
      checks: [
        {
          message: "supabase/config.toml is missing. Run supabase init first.",
          name: "local_config",
          status: "blocked",
        },
      ],
      config: "missing",
      projectRef: "missing",
      ready: false,
    };
  }

  const hasProjectRef = await hasNonEmptyProjectRef(projectRefPath);
  const checks: SupabaseLinkCheck[] = [
    {
      message: "supabase/config.toml is present.",
      name: "local_config",
      status: "passed",
    },
  ];

  if (hasProjectRef) {
    checks.push({
      message: "Local Supabase project link marker is present.",
      name: "project_link",
      status: "passed",
    });
  } else {
    checks.push({
      message:
        "Local Supabase project link marker is missing. Run supabase link --project-ref <project-ref>; database checks need the remote DB password.",
      name: "project_link",
      status: "blocked",
    });
  }

  return {
    checks,
    config: "configured",
    projectRef: hasProjectRef ? "configured" : "missing",
    ready: hasProjectRef,
  };
};

export const formatSupabaseLinkReadiness = (readiness: SupabaseLinkReadiness): string => {
  const lines = [
    `Supabase link readiness: ${readiness.ready ? "ready" : "blocked"}`,
    `Local config: ${readiness.config}`,
    `Project ref: ${readiness.projectRef}`,
    "",
    ...readiness.checks.map((check) => `[${check.status}] ${check.name} - ${check.message}`),
  ];

  return lines.join("\n");
};

const toPublicReadiness = (readiness: SupabaseLinkReadiness) => ({
  config: readiness.config,
  projectRef: readiness.projectRef,
  ready: readiness.ready,
});

export const runSupabaseLinkCheck = async (
  argv: readonly string[],
  options: SupabaseLinkCheckOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseSupabaseLinkCheckArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const readiness = await runSupabaseLinkReadiness(
    options.root === undefined ? {} : { root: options.root },
  );

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicReadiness(readiness), null, 2)}\n`);
  } else {
    stdout(`${formatSupabaseLinkReadiness(readiness)}\n`);
  }

  return readiness.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runSupabaseLinkCheck(process.argv.slice(2));
}
