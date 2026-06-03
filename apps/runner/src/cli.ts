#!/usr/bin/env -S node --import tsx

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { toRunnerErrorSummary } from "./errors.js";
import {
  runRunnerLink as defaultRunRunnerLink,
  type RunnerLinkOptions,
  type RunnerLinkSafeSummary,
} from "./link.js";
import {
  runRunnerReposAdd as defaultRunRunnerReposAdd,
  type RunnerReposAddOptions,
} from "./repos.js";
import type { RunnerRepoMappingResult } from "./protocol/repo-mappings.js";
import {
  runRunner as defaultRunRunner,
  type RunRunnerOptions,
  type RunRunnerResult,
} from "./run.js";

export type RunnerRunOptions = RunRunnerOptions;
export type RunnerLinkCliOptions = RunnerLinkOptions;
export type RunnerReposAddCliOptions = RunnerReposAddOptions;

export type RunnerCliParseResult =
  | {
      type: "help";
      help: string;
    }
  | {
      type: "run";
      options: RunnerRunOptions;
    }
  | {
      type: "link";
      options: RunnerLinkCliOptions;
    }
  | {
      type: "reposAdd";
      options: RunnerReposAddCliOptions;
    }
  | {
      type: "error";
      exitCode: 2;
      message: string;
      help?: string;
    };

export type RunnerCliStreams = {
  stdout: {
    write: (chunk: string) => void;
  };
  stderr: {
    write: (chunk: string) => void;
  };
};

export type RunnerCliDependencies = {
  linkRunner?: (options: RunnerLinkCliOptions) => Promise<RunnerLinkSafeSummary>;
  reposAdd?: (options: RunnerReposAddCliOptions) => Promise<RunnerRepoMappingResult>;
  runRunner?: (options: RunnerRunOptions) => Promise<RunRunnerResult>;
};

const GLOBAL_HELP = `Usage: control-plane-runner <command> [options]

Commands:
  run    Run a local runner task skeleton flow.
  link   Link this local runner to a web workspace.
  repos  Manage runner-scoped repository mappings.

Global options:
  -h, --help    Show this help.

Run command:
  control-plane-runner run --repo <path> --task <path> --dry-run [--events-out <path>] [--config <path>]

Link command:
  control-plane-runner link --code <pairing-code> --base-url <api-base-url>

Repos command:
  control-plane-runner repos add --path <repo>
`;

const RUN_HELP = `Usage: control-plane-runner run --repo <path> --task <path> --dry-run [--events-out <path>] [--config <path>]

Options:
  --repo <path>          Local repository path.
  --task <path>          Local task packet path.
  --dry-run              Required for this initial CLI surface.
  --events-out <path>    Optional structured event output path.
  --config <path>        Optional local runner config path.
  -h, --help             Show this help.
`;

const LINK_HELP = `Usage: control-plane-runner link --code <pairing-code> --base-url <api-base-url>

Options:
  --code <pairing-code>      Short-lived web pairing code.
  --base-url <api-base-url>  Runner API base URL, for example http://localhost:3000/api.
  -h, --help                 Show this help.
`;

const REPOS_HELP = `Usage: control-plane-runner repos <command> [options]

Commands:
  add    Register a local repository mapping with the control plane.

Repos add command:
  control-plane-runner repos add --path <repo>
`;

const REPOS_ADD_HELP = `Usage: control-plane-runner repos add --path <repo>

Options:
  --path <repo>    Local Git repository path to register.
  -h, --help       Show this help.
`;

const STRING_OPTIONS = new Set([
  "--repo",
  "--task",
  "--events-out",
  "--config",
  "--code",
  "--base-url",
  "--path",
]);

export const getRunnerCliHelp = (command?: "run" | "link" | "repos" | "reposAdd"): string => {
  if (command === "run") {
    return RUN_HELP;
  }

  if (command === "link") {
    return LINK_HELP;
  }

  if (command === "repos") {
    return REPOS_HELP;
  }

  if (command === "reposAdd") {
    return REPOS_ADD_HELP;
  }

  return GLOBAL_HELP;
};

export const parseRunnerCliArgs = (args: string[]): RunnerCliParseResult => {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;

  if (normalizedArgs.length === 0) {
    return {
      type: "error",
      exitCode: 2,
      message: "Missing command.",
      help: getRunnerCliHelp(),
    };
  }

  const [command, ...commandArgs] = normalizedArgs;

  if (command === "--help" || command === "-h") {
    return {
      type: "help",
      help: getRunnerCliHelp(),
    };
  }

  if (command === "run") {
    return parseRunCommandArgs(commandArgs);
  }

  if (command === "link") {
    return parseLinkCommandArgs(commandArgs);
  }

  if (command === "repos") {
    return parseReposCommandArgs(commandArgs);
  }

  return {
    type: "error",
    exitCode: 2,
    message: `Unknown command: ${formatCliToken(command)}.`,
    help: getRunnerCliHelp(),
  };
};

export const runCli = async (
  args = process.argv.slice(2),
  streams: RunnerCliStreams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
  dependencies: RunnerCliDependencies = {},
): Promise<number> => {
  const result = parseRunnerCliArgs(args);

  if (result.type === "help") {
    streams.stdout.write(result.help);
    return 0;
  }

  if (result.type === "error") {
    streams.stderr.write(`${result.message}\n\n${result.help ?? getRunnerCliHelp()}`);
    return result.exitCode;
  }

  try {
    if (result.type === "link") {
      const linkResult = await (dependencies.linkRunner ?? defaultRunRunnerLink)(result.options);
      streams.stdout.write(`${JSON.stringify(linkResult)}\n`);
      return 0;
    }

    if (result.type === "reposAdd") {
      const reposAddResult = await (dependencies.reposAdd ?? defaultRunRunnerReposAdd)(
        result.options,
      );
      streams.stdout.write(`${JSON.stringify(reposAddResult)}\n`);
      return 0;
    }

    const runnerResult = await (dependencies.runRunner ?? defaultRunRunner)(result.options);
    if (runnerResult.dryRunResult !== undefined) {
      streams.stdout.write(`${JSON.stringify(runnerResult.dryRunResult)}\n`);
    }
    return runnerResult.exitCode;
  } catch (error) {
    const summary = toRunnerErrorSummary(error);
    streams.stderr.write(`${summary.message}\n`);
    return summary.exitCode;
  }
};

const parseReposCommandArgs = (args: string[]): RunnerCliParseResult => {
  if (args[0] === "--help" || args[0] === "-h") {
    return {
      type: "help",
      help: getRunnerCliHelp("repos"),
    };
  }

  if (args.length === 0) {
    return {
      type: "error",
      exitCode: 2,
      message: "Missing repos command.",
      help: getRunnerCliHelp("repos"),
    };
  }

  const [subcommand, ...subcommandArgs] = args;

  if (subcommand === "add") {
    return parseReposAddCommandArgs(subcommandArgs);
  }

  return {
    type: "error",
    exitCode: 2,
    message: `Unknown repos command: ${formatCliToken(subcommand)}.`,
    help: getRunnerCliHelp("repos"),
  };
};

const parseReposAddCommandArgs = (args: string[]): RunnerCliParseResult => {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      type: "help",
      help: getRunnerCliHelp("reposAdd"),
    };
  }

  const missingValue = findMissingStringOptionValue(args);

  if (missingValue !== undefined) {
    return {
      type: "error",
      exitCode: 2,
      message: `Missing value for ${missingValue}.`,
      help: getRunnerCliHelp("reposAdd"),
    };
  }

  try {
    const { values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        path: {
          type: "string",
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
    });

    if (values.path === undefined) {
      return {
        type: "error",
        exitCode: 2,
        message: "Missing required options: --path.",
        help: getRunnerCliHelp("reposAdd"),
      };
    }

    return {
      type: "reposAdd",
      options: {
        path: values.path,
      },
    };
  } catch (error) {
    return {
      type: "error",
      exitCode: 2,
      message: formatParseError(error),
      help: getRunnerCliHelp("reposAdd"),
    };
  }
};

const parseLinkCommandArgs = (args: string[]): RunnerCliParseResult => {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      type: "help",
      help: getRunnerCliHelp("link"),
    };
  }

  const missingValue = findMissingStringOptionValue(args);

  if (missingValue !== undefined) {
    return {
      type: "error",
      exitCode: 2,
      message: `Missing value for ${missingValue}.`,
      help: getRunnerCliHelp("link"),
    };
  }

  try {
    const { values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        "base-url": {
          type: "string",
        },
        code: {
          type: "string",
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
    });

    const missingOptions = getMissingLinkOptions(values);

    if (missingOptions.length > 0) {
      return {
        type: "error",
        exitCode: 2,
        message: `Missing required options: ${missingOptions.join(", ")}.`,
        help: getRunnerCliHelp("link"),
      };
    }

    const code = values.code;
    const baseUrl = values["base-url"];

    if (code === undefined || baseUrl === undefined) {
      return {
        type: "error",
        exitCode: 2,
        message: "Missing required options: --code, --base-url.",
        help: getRunnerCliHelp("link"),
      };
    }

    return {
      type: "link",
      options: {
        baseUrl,
        code,
      },
    };
  } catch (error) {
    void error;

    return {
      type: "error",
      exitCode: 2,
      message: "Invalid link command options.",
      help: getRunnerCliHelp("link"),
    };
  }
};

const parseRunCommandArgs = (args: string[]): RunnerCliParseResult => {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      type: "help",
      help: getRunnerCliHelp("run"),
    };
  }

  const missingValue = findMissingStringOptionValue(args);

  if (missingValue !== undefined) {
    return {
      type: "error",
      exitCode: 2,
      message: `Missing value for ${missingValue}.`,
      help: getRunnerCliHelp("run"),
    };
  }

  try {
    const { values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        repo: {
          type: "string",
        },
        task: {
          type: "string",
        },
        "dry-run": {
          type: "boolean",
        },
        "events-out": {
          type: "string",
        },
        config: {
          type: "string",
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
    });

    const missingOptions = getMissingRunOptions(values);

    if (missingOptions.length > 0) {
      return {
        type: "error",
        exitCode: 2,
        message: `Missing required options: ${missingOptions.join(", ")}.`,
        help: getRunnerCliHelp("run"),
      };
    }

    const repo = values.repo;
    const task = values.task;

    if (repo === undefined || task === undefined) {
      return {
        type: "error",
        exitCode: 2,
        message: "Missing required options: --repo, --task.",
        help: getRunnerCliHelp("run"),
      };
    }

    const options: RunnerRunOptions = {
      command: "run",
      repo,
      task,
      dryRun: true,
      ...(values["events-out"] === undefined ? {} : { eventsOut: values["events-out"] }),
      ...(values.config === undefined ? {} : { configPath: values.config }),
    };

    return {
      type: "run",
      options,
    };
  } catch (error) {
    return {
      type: "error",
      exitCode: 2,
      message: formatParseError(error),
      help: getRunnerCliHelp("run"),
    };
  }
};

const getMissingRunOptions = (values: {
  repo?: string;
  task?: string;
  "dry-run"?: boolean;
}): string[] => {
  const missingOptions: string[] = [];

  if (values.repo === undefined) {
    missingOptions.push("--repo");
  }

  if (values.task === undefined) {
    missingOptions.push("--task");
  }

  if (values["dry-run"] !== true) {
    missingOptions.push("--dry-run");
  }

  return missingOptions;
};

const getMissingLinkOptions = (values: { code?: string; "base-url"?: string }): string[] => {
  const missingOptions: string[] = [];

  if (values.code === undefined) {
    missingOptions.push("--code");
  }

  if (values["base-url"] === undefined) {
    missingOptions.push("--base-url");
  }

  return missingOptions;
};

const findMissingStringOptionValue = (args: string[]): string | undefined => {
  for (const [index, arg] of args.entries()) {
    const equalsIndex = arg.indexOf("=");

    if (equalsIndex > 0) {
      const optionName = arg.slice(0, equalsIndex);

      if (STRING_OPTIONS.has(optionName) && arg.slice(equalsIndex + 1).length === 0) {
        return optionName;
      }

      continue;
    }

    if (!STRING_OPTIONS.has(arg)) {
      continue;
    }

    const nextArg = args[index + 1];

    if (nextArg === undefined || nextArg.startsWith("-")) {
      return arg;
    }
  }

  return undefined;
};

const formatParseError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "Invalid command options.";
  }

  return `${stripAnsi(error.message)}.`;
};

const formatCliToken = (token: string | undefined): string =>
  stripAnsi(token ?? "")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 80);

const stripAnsi = (value: string): string => {
  const escapeCharacter = String.fromCharCode(27);
  let stripped = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== escapeCharacter) {
      stripped += character;
      continue;
    }

    if (value[index + 1] !== "[") {
      continue;
    }

    index += 2;

    while (index < value.length && !isAsciiLetter(value[index])) {
      index += 1;
    }
  }

  return stripped;
};

const isAsciiLetter = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }

  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};

const isDirectCliExecution = (moduleUrl: string, argvEntry = process.argv[1]): boolean => {
  if (argvEntry === undefined) {
    return false;
  }

  return fileURLToPath(moduleUrl) === resolve(argvEntry);
};

if (isDirectCliExecution(import.meta.url)) {
  process.exitCode = await runCli();
}
