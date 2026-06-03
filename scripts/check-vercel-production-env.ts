import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { productionRuntimeRequirements } from "../apps/web/src/runtime/env.js";

type VercelProductionEnvStatus = "configured" | "missing";

type VercelProductionEnvCheck = {
  readonly key: string;
  readonly message: string;
  readonly required: boolean;
  readonly status: VercelProductionEnvStatus;
};

type VercelProductionEnvReadiness = {
  readonly checks: VercelProductionEnvCheck[];
  readonly configuredRequiredKeys: string[];
  readonly missingRequiredKeys: string[];
  readonly ready: boolean;
};

type ExecVercelEnvList = () => Promise<string>;

type VercelProductionEnvOptions = {
  readonly execVercelEnvList?: ExecVercelEnvList;
};

type VercelProductionEnvCheckOptions = VercelProductionEnvOptions & {
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

const usage = `Usage: pnpm vercel-production-env:check [--json]

Checks whether Vercel production has the required runtime environment variable names configured.
Output contains only variable names and statuses; it never prints environment values.`;

const defaultExecVercelEnvList: ExecVercelEnvList = async () => {
  const { stdout } = await execFileAsync(
    "vercel",
    ["env", "list", "production", "--format=json", "--non-interactive"],
    {
      maxBuffer: 1024 * 1024,
    },
  );

  return String(stdout);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getEnvArray = (parsed: unknown): unknown[] => {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (isRecord(parsed)) {
    for (const key of ["envs", "environmentVariables", "items"]) {
      const value = parsed[key];

      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
};

const hasProductionTarget = (target: unknown): boolean => {
  if (target === undefined) {
    return true;
  }

  if (typeof target === "string") {
    return target === "production";
  }

  if (Array.isArray(target)) {
    return target.includes("production");
  }

  return false;
};

const parseConfiguredProductionKeys = (output: string): Set<string> | null => {
  try {
    const parsed = JSON.parse(output) as unknown;
    const keys = new Set<string>();

    for (const item of getEnvArray(parsed)) {
      if (!isRecord(item)) {
        continue;
      }

      const key = item.key ?? item.name;

      if (typeof key !== "string" || key.trim() === "") {
        continue;
      }

      if (hasProductionTarget(item.target ?? item.environment)) {
        keys.add(key);
      }
    }

    return keys;
  } catch {
    return null;
  }
};

export const runVercelProductionEnvReadiness = async (
  options: VercelProductionEnvOptions = {},
): Promise<VercelProductionEnvReadiness> => {
  let configuredKeys: Set<string> | null;

  try {
    configuredKeys = parseConfiguredProductionKeys(
      await (options.execVercelEnvList ?? defaultExecVercelEnvList)(),
    );
  } catch {
    configuredKeys = null;
  }

  const availableKeys = configuredKeys ?? new Set<string>();
  const checks = productionRuntimeRequirements.map((requirement) => {
    const configured = availableKeys.has(requirement.key);

    return {
      key: requirement.key,
      message:
        configuredKeys === null
          ? "Vercel production environment names could not be read."
          : configured
            ? `${requirement.key} is configured in Vercel production.`
            : `${requirement.key} is missing from Vercel production.`,
      required: requirement.required,
      status: configured ? "configured" : "missing",
    } satisfies VercelProductionEnvCheck;
  });
  const configuredRequiredKeys = checks
    .filter((check) => check.required && check.status === "configured")
    .map((check) => check.key);
  const missingRequiredKeys = checks
    .filter((check) => check.required && check.status !== "configured")
    .map((check) => check.key);

  return {
    checks,
    configuredRequiredKeys,
    missingRequiredKeys,
    ready: missingRequiredKeys.length === 0,
  };
};

export const formatVercelProductionEnvReadiness = (
  readiness: VercelProductionEnvReadiness,
): string => {
  const lines = [
    `Vercel production env readiness: ${readiness.ready ? "ready" : "blocked"}`,
    `Configured required: ${
      readiness.configuredRequiredKeys.length > 0
        ? readiness.configuredRequiredKeys.join(", ")
        : "none"
    }`,
    `Missing required: ${
      readiness.missingRequiredKeys.length > 0 ? readiness.missingRequiredKeys.join(", ") : "none"
    }`,
    "",
    ...readiness.checks.map((check) => `[${check.status}] ${check.key} - ${check.message}`),
  ];

  return lines.join("\n");
};

const toPublicReadiness = (readiness: VercelProductionEnvReadiness) => readiness;

export const parseVercelProductionEnvCheckArgs = (argv: readonly string[]): ParsedArgs => {
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

export const runVercelProductionEnvCheck = async (
  argv: readonly string[],
  options: VercelProductionEnvCheckOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseVercelProductionEnvCheckArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const readiness = await runVercelProductionEnvReadiness({
    ...(options.execVercelEnvList === undefined
      ? {}
      : { execVercelEnvList: options.execVercelEnvList }),
  });

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicReadiness(readiness), null, 2)}\n`);
  } else {
    stdout(`${formatVercelProductionEnvReadiness(readiness)}\n`);
  }

  return readiness.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runVercelProductionEnvCheck(process.argv.slice(2));
}
