import { readFile } from "node:fs/promises";

export type RunnerMockModes = {
  codex: boolean;
  gh: boolean;
};

export type RunnerConfig = {
  worktreeRoot: string;
  eventsOut?: string;
  mockModes: RunnerMockModes;
};

export type LoadRunnerConfigOptions = {
  configPath?: string;
};

export type RunnerConfigLoaderErrorCode = "read_failed" | "invalid_json" | "invalid_config";

export type RunnerConfigLoaderIssue = {
  path: string;
  message: string;
};

type RunnerConfigLoaderErrorOptions = {
  code: RunnerConfigLoaderErrorCode;
  configPath?: string;
  message: string;
  issues?: RunnerConfigLoaderIssue[];
  cause?: unknown;
};

export class RunnerConfigLoaderError extends Error {
  readonly code: RunnerConfigLoaderErrorCode;
  readonly configPath: string | undefined;
  readonly issues: RunnerConfigLoaderIssue[];

  constructor({ code, configPath, message, issues = [], cause }: RunnerConfigLoaderErrorOptions) {
    super(message, { cause });
    this.name = "RunnerConfigLoaderError";
    this.code = code;
    this.configPath = configPath;
    this.issues = issues;
  }
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  worktreeRoot: ".codex-runner-worktrees",
  mockModes: {
    codex: false,
    gh: false,
  },
};

const TOP_LEVEL_KEYS = new Set(["worktreeRoot", "eventsOut", "mockModes"]);
const MOCK_MODE_KEYS = new Set(["codex", "gh"]);
const UNKNOWN_TOP_LEVEL_KEY_PATH = "<unknown>";
const UNKNOWN_MOCK_MODE_KEY_PATH = "mockModes.<unknown>";

type RunnerConfigInput = {
  worktreeRoot?: string;
  eventsOut?: string;
  mockModes?: Partial<RunnerMockModes>;
};

export const loadRunnerConfig = async (
  options: LoadRunnerConfigOptions = {},
): Promise<RunnerConfig> => {
  const defaults = createDefaultRunnerConfig();

  if (options.configPath === undefined) {
    return defaults;
  }

  let contents: string;

  try {
    contents = await readFile(options.configPath, "utf8");
  } catch (error) {
    throw new RunnerConfigLoaderError({
      code: "read_failed",
      configPath: options.configPath,
      message: `Unable to read runner config file at ${options.configPath}: read_failed.`,
      cause: error,
    });
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(contents);
  } catch {
    throw new RunnerConfigLoaderError({
      code: "invalid_json",
      configPath: options.configPath,
      message: `Invalid JSON in runner config file at ${options.configPath}.`,
    });
  }

  const validation = validateConfigShape(parsedJson);

  if (validation.issues.length > 0) {
    throw new RunnerConfigLoaderError({
      code: "invalid_config",
      configPath: options.configPath,
      message: formatInvalidConfigMessage(options.configPath, validation.issues),
      issues: validation.issues,
    });
  }

  return mergeConfig(defaults, validation.config);
};

const validateConfigShape = (
  value: unknown,
): {
  config: RunnerConfigInput;
  issues: RunnerConfigLoaderIssue[];
} => {
  const issues: RunnerConfigLoaderIssue[] = [];

  if (!isRecord(value)) {
    return {
      config: {},
      issues: [
        {
          path: "<root>",
          message: "Expected object.",
        },
      ],
    };
  }

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        path: UNKNOWN_TOP_LEVEL_KEY_PATH,
        message: "Unknown config field.",
      });
    }
  }

  const config: RunnerConfigInput = {};

  if ("worktreeRoot" in value) {
    if (isNonEmptyString(value.worktreeRoot)) {
      config.worktreeRoot = value.worktreeRoot;
    } else {
      issues.push({
        path: "worktreeRoot",
        message: "Expected non-empty string.",
      });
    }
  }

  if ("eventsOut" in value) {
    if (isNonEmptyString(value.eventsOut)) {
      config.eventsOut = value.eventsOut;
    } else {
      issues.push({
        path: "eventsOut",
        message: "Expected non-empty string.",
      });
    }
  }

  if ("mockModes" in value) {
    if (isRecord(value.mockModes)) {
      config.mockModes = validateMockModes(value.mockModes, issues);
    } else {
      issues.push({
        path: "mockModes",
        message: "Expected object.",
      });
    }
  }

  return {
    config,
    issues,
  };
};

const validateMockModes = (
  value: Record<string, unknown>,
  issues: RunnerConfigLoaderIssue[],
): Partial<RunnerMockModes> => {
  const mockModes: Partial<RunnerMockModes> = {};

  for (const key of Object.keys(value)) {
    if (!MOCK_MODE_KEYS.has(key)) {
      issues.push({
        path: UNKNOWN_MOCK_MODE_KEY_PATH,
        message: "Unknown mock mode field.",
      });
    }
  }

  if ("codex" in value) {
    if (typeof value.codex === "boolean") {
      mockModes.codex = value.codex;
    } else {
      issues.push({
        path: "mockModes.codex",
        message: "Expected boolean.",
      });
    }
  }

  if ("gh" in value) {
    if (typeof value.gh === "boolean") {
      mockModes.gh = value.gh;
    } else {
      issues.push({
        path: "mockModes.gh",
        message: "Expected boolean.",
      });
    }
  }

  return mockModes;
};

const mergeConfig = (defaults: RunnerConfig, config: RunnerConfigInput): RunnerConfig => ({
  worktreeRoot: config.worktreeRoot ?? defaults.worktreeRoot,
  ...(config.eventsOut === undefined ? {} : { eventsOut: config.eventsOut }),
  mockModes: {
    codex: config.mockModes?.codex ?? defaults.mockModes.codex,
    gh: config.mockModes?.gh ?? defaults.mockModes.gh,
  },
});

const createDefaultRunnerConfig = (): RunnerConfig => ({
  worktreeRoot: DEFAULT_RUNNER_CONFIG.worktreeRoot,
  mockModes: {
    codex: DEFAULT_RUNNER_CONFIG.mockModes.codex,
    gh: DEFAULT_RUNNER_CONFIG.mockModes.gh,
  },
});

const formatInvalidConfigMessage = (
  configPath: string,
  issues: RunnerConfigLoaderIssue[],
): string => {
  if (issues.length === 0) {
    return `Invalid runner config file at ${configPath}: invalid_config.`;
  }

  const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

  return `Invalid runner config file at ${configPath}: ${issueSummary}.`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
