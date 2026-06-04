import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  assessProductionRuntimeEnv,
  productionRuntimeRequirements,
  type ProductionRuntimeEnvInput,
  type RuntimeEnvCheck,
} from "../apps/web/src/runtime/env.js";
import { runVercelProductionEnvReadiness } from "./check-vercel-production-env.js";

type ApplyStatus = "applied" | "blocked" | "would_apply";

type ApplyCheck = {
  readonly key: string;
  readonly message: string;
  readonly status: ApplyStatus;
};

type ApplyResult = {
  readonly checks: ApplyCheck[];
  readonly dryRun: boolean;
  readonly ready: boolean;
  readonly targetKeys: string[];
};

type ExecVercelEnvAdd = (input: {
  readonly key: string;
  readonly sensitive: boolean;
  readonly value: string;
}) => Promise<void>;

type ExecVercelEnvList = () => Promise<string>;

type ApplyOptions = {
  readonly env?: ProductionRuntimeEnvInput;
  readonly execVercelEnvAdd?: ExecVercelEnvAdd;
  readonly execVercelEnvList?: ExecVercelEnvList;
};

type ApplyCommandOptions = ApplyOptions & {
  readonly stderr?: (message: string) => void;
  readonly stdout?: (message: string) => void;
};

type ParsedArgs =
  | {
      readonly allRequired: false;
      readonly dryRun: false;
      readonly help: true;
      readonly json: false;
      readonly keys: readonly string[];
    }
  | {
      readonly allRequired: boolean;
      readonly dryRun: boolean;
      readonly help: false;
      readonly json: boolean;
      readonly keys: readonly string[];
    };

const usage = `Usage: pnpm vercel-production-env:apply [--dry-run] [--all-required] [--key <required-key>] [--json]

Applies required production runtime variables from the current shell to Vercel production.
Default mode applies only required keys missing from Vercel production; --all-required overwrites every required key.
Use --key to apply a specific required key without requiring other missing keys to be loaded in the shell.
Output contains only variable names and statuses; it never prints values.`;

const secretLikeKeys = new Set([
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "DATABASE_URL",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY",
]);

const requiredKeys = productionRuntimeRequirements
  .filter((requirement) => requirement.required)
  .map((requirement) => requirement.key);
const requiredKeySet = new Set<string>(requiredKeys);

const defaultExecVercelEnvAdd: ExecVercelEnvAdd = ({ key, sensitive, value }) =>
  new Promise((resolve, reject) => {
    const args = ["env", "add", key, "production", "--force", "--yes"];

    if (sensitive) {
      args.push("--sensitive");
    }

    const child = spawn("vercel", args, {
      stdio: ["pipe", "ignore", "ignore"],
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error("Vercel env add failed."));
    });

    child.stdin.end(value);
  });

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const getRuntimeCheckByKey = (env: ProductionRuntimeEnvInput): Map<string, RuntimeEnvCheck> =>
  new Map(assessProductionRuntimeEnv(env).checks.map((check) => [check.key, check]));

const getTargetKeys = async (
  parsedArgs: Extract<ParsedArgs, { help: false }>,
  options: ApplyOptions,
): Promise<string[]> => {
  const keys = parsedArgs.keys ?? [];

  if (keys.length > 0) {
    return [...keys];
  }

  if (parsedArgs.allRequired) {
    return requiredKeys;
  }

  const vercelReadiness = await runVercelProductionEnvReadiness({
    ...(options.execVercelEnvList === undefined
      ? {}
      : { execVercelEnvList: options.execVercelEnvList }),
  });

  return vercelReadiness.missingRequiredKeys;
};

export const parseApplyVercelProductionEnvArgs = (argv: readonly string[]): ParsedArgs => {
  let allRequired = false;
  let dryRun = false;
  let json = false;
  const keys: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { allRequired: false, dryRun: false, help: true, json: false, keys: [] };
    }

    if (arg === "--all-required") {
      allRequired = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--key") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--key requires a required runtime key name.");
      }

      if (!requiredKeySet.has(value)) {
        throw new Error("--key must name a required production runtime key.");
      }

      keys.push(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { allRequired, dryRun, help: false, json, keys: unique(keys) };
};

export const applyVercelProductionEnv = async (
  parsedArgs: Extract<ParsedArgs, { help: false }>,
  options: ApplyOptions = {},
): Promise<ApplyResult> => {
  const env = options.env ?? process.env;
  const targetKeys = unique(await getTargetKeys(parsedArgs, options)).filter((key) =>
    requiredKeySet.has(key),
  );
  const checksByKey = getRuntimeCheckByKey(env);
  const invalidChecks = targetKeys
    .map((key) => checksByKey.get(key))
    .filter(
      (check): check is RuntimeEnvCheck => check !== undefined && check.status !== "configured",
    );

  if (invalidChecks.length > 0) {
    return {
      checks: invalidChecks.map((check) => ({
        key: check.key,
        message: check.message,
        status: "blocked",
      })),
      dryRun: parsedArgs.dryRun,
      ready: false,
      targetKeys,
    };
  }

  if (parsedArgs.dryRun || targetKeys.length === 0) {
    return {
      checks: targetKeys.map((key) => ({
        key,
        message: `${key} is ready to apply from the current shell.`,
        status: "would_apply",
      })),
      dryRun: parsedArgs.dryRun,
      ready: true,
      targetKeys,
    };
  }

  const execVercelEnvAdd = options.execVercelEnvAdd ?? defaultExecVercelEnvAdd;
  const checks: ApplyCheck[] = [];

  for (const key of targetKeys) {
    const value = env[key];

    if (value === undefined) {
      checks.push({
        key,
        message: `${key} is missing from the current shell.`,
        status: "blocked",
      });
      break;
    }

    try {
      await execVercelEnvAdd({
        key,
        sensitive: secretLikeKeys.has(key),
        value,
      });

      checks.push({
        key,
        message: `${key} was applied to Vercel production.`,
        status: "applied",
      });
    } catch {
      checks.push({
        key,
        message: `${key} could not be applied to Vercel production.`,
        status: "blocked",
      });
      break;
    }
  }

  return {
    checks,
    dryRun: false,
    ready:
      checks.length === targetKeys.length && checks.every((check) => check.status === "applied"),
    targetKeys,
  };
};

export const formatApplyVercelProductionEnvResult = (result: ApplyResult): string => {
  const lines = [
    `Vercel production env apply: ${result.ready ? "ready" : "blocked"}`,
    `Mode: ${result.dryRun ? "dry-run" : "apply"}`,
    `Target keys: ${result.targetKeys.length > 0 ? result.targetKeys.join(", ") : "none"}`,
    "",
  ];

  if (result.checks.length === 0) {
    lines.push("No required Vercel production variables need applying.");
  } else {
    lines.push(
      ...result.checks.map((check) => `[${check.status}] ${check.key} - ${check.message}`),
    );
  }

  return lines.join("\n");
};

export const runApplyVercelProductionEnvCommand = async (
  argv: readonly string[],
  options: ApplyCommandOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseApplyVercelProductionEnvArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const result = await applyVercelProductionEnv(parsedArgs, options);

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout(`${formatApplyVercelProductionEnvResult(result)}\n`);
  }

  return result.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = await runApplyVercelProductionEnvCommand(process.argv.slice(2));
}
