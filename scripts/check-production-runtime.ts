import { pathToFileURL } from "node:url";

import {
  assessProductionRuntimeEnv,
  type ProductionRuntimeEnvInput,
  type ProductionRuntimeReadiness,
} from "../apps/web/src/runtime/env.js";

type RuntimeCheckOptions = {
  readonly env?: ProductionRuntimeEnvInput;
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

const usage = `Usage: pnpm production-runtime:check [--json]

Checks whether required production runtime environment variables are configured.
Output contains only variable names, statuses, and safe messages; it never prints values.`;

export const parseProductionRuntimeCheckArgs = (argv: readonly string[]): ParsedArgs => {
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

const toPublicReadiness = (readiness: ProductionRuntimeReadiness) => ({
  blockedKeys: readiness.blockedKeys,
  checks: readiness.checks.map((check) => ({
    group: check.group,
    key: check.key,
    message: check.message,
    required: check.required,
    status: check.status,
  })),
  ready: readiness.ready,
});

export const formatProductionRuntimeReadiness = (readiness: ProductionRuntimeReadiness): string => {
  const lines = [
    `Production runtime readiness: ${readiness.ready ? "ready" : "blocked"}`,
    "",
    ...readiness.checks.map((check) => {
      const requiredLabel = check.required ? "required" : "optional";

      return `[${check.status}] ${check.group}/${check.key} (${requiredLabel}) - ${check.message}`;
    }),
  ];

  if (!readiness.ready) {
    lines.push("", `Blocked keys: ${readiness.blockedKeys.join(", ")}`);
  }

  return lines.join("\n");
};

export const runProductionRuntimeCheck = (
  argv: readonly string[],
  options: RuntimeCheckOptions = {},
): number => {
  const stdout = options.stdout ?? ((message) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message) => process.stderr.write(message));

  let parsedArgs: ParsedArgs;

  try {
    parsedArgs = parseProductionRuntimeCheckArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";

    stderr(`${message}\n${usage}\n`);
    return 2;
  }

  if (parsedArgs.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  const readiness = assessProductionRuntimeEnv(options.env ?? process.env);

  if (parsedArgs.json) {
    stdout(`${JSON.stringify(toPublicReadiness(readiness), null, 2)}\n`);
  } else {
    stdout(`${formatProductionRuntimeReadiness(readiness)}\n`);
  }

  return readiness.ready ? 0 : 1;
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = runProductionRuntimeCheck(process.argv.slice(2));
}
