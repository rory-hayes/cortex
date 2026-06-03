export const RUNNER_ERROR_CATEGORIES = [
  "usage",
  "task_packet",
  "config",
  "repo_path",
  "command_execution",
  "cancelled",
  "internal",
] as const;

export type RunnerErrorCategory = (typeof RUNNER_ERROR_CATEGORIES)[number];

export type RunnerErrorDefinition = {
  defaultMessage: string;
  exitCode: number;
};

export const RUNNER_ERROR_DEFINITIONS = {
  usage: {
    defaultMessage: "Runner command usage is invalid.",
    exitCode: 2,
  },
  task_packet: {
    defaultMessage: "Task packet could not be loaded or validated.",
    exitCode: 3,
  },
  config: {
    defaultMessage: "Runner configuration could not be loaded or validated.",
    exitCode: 4,
  },
  repo_path: {
    defaultMessage: "Repository path could not be validated.",
    exitCode: 5,
  },
  command_execution: {
    defaultMessage: "A runner command failed.",
    exitCode: 6,
  },
  cancelled: {
    defaultMessage: "Runner execution was cancelled.",
    exitCode: 130,
  },
  internal: {
    defaultMessage: "An internal runner error occurred.",
    exitCode: 1,
  },
} as const satisfies Record<RunnerErrorCategory, RunnerErrorDefinition>;

export type RunnerErrorMetadataValue =
  | string
  | number
  | boolean
  | null
  | RunnerErrorMetadataValue[]
  | {
      [key: string]: RunnerErrorMetadataValue;
    };

export type RunnerErrorMetadata = Record<string, RunnerErrorMetadataValue>;

export type RunnerErrorSummary = {
  category: RunnerErrorCategory;
  exitCode: number;
  message: string;
  metadata: RunnerErrorMetadata;
};

export type RunnerErrorOptions = {
  category: RunnerErrorCategory;
  userSafeMessage?: string;
  metadata?: Record<string, unknown>;
  cause?: unknown;
};

const UNSAFE_METADATA_KEYS = new Set([
  "diff",
  "patch",
  "source",
  "sourcecode",
  "stdout",
  "stderr",
  "rawstdout",
  "rawstderr",
  "rawlog",
  "rawoutput",
  "rawcommandoutput",
  "snippet",
  "content",
  "stack",
]);

const SOURCE_LIKE_METADATA_PATTERNS = [
  /diff --git\s+/i,
  /^@@\s+[-+0-9, ]+@@/m,
  /(?:^|\n)\s*at\s+(?:[A-Za-z_$][\w$.[\]<>]*\s+\()?[^)\n]+:\d+:\d+\)?/,
  /(?:^|\n)\s*(?:function|class)\s+[A-Za-z_$][\w$]*\s*[({]/,
  /(?:^|\n)\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
  /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\w*{])/,
  /(?:^|\n)\s*export\s+(?:type\s+)?(?:const|let|var|class|function|\{|\*)/,
];

export class RunnerError extends Error {
  readonly category: RunnerErrorCategory;
  readonly exitCode: number;
  readonly userSafeMessage: string;
  readonly metadata: RunnerErrorMetadata;

  constructor(options: RunnerErrorOptions) {
    const userSafeMessage = sanitizeRunnerErrorMessage(options.category, options.userSafeMessage);

    if ("cause" in options) {
      super(userSafeMessage, { cause: options.cause });
    } else {
      super(userSafeMessage);
    }

    this.name = "RunnerError";
    this.category = options.category;
    this.exitCode = getRunnerErrorExitCode(options.category);
    this.userSafeMessage = userSafeMessage;
    this.metadata = sanitizeRunnerErrorMetadata(options.metadata);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const isRunnerError = (error: unknown): error is RunnerError => error instanceof RunnerError;

export const getRunnerErrorExitCode = (category: RunnerErrorCategory): number =>
  RUNNER_ERROR_DEFINITIONS[category].exitCode;

export const getRunnerErrorDefaultMessage = (category: RunnerErrorCategory): string =>
  RUNNER_ERROR_DEFINITIONS[category].defaultMessage;

export const toRunnerErrorSummary = (error: unknown): RunnerErrorSummary => {
  if (!isRunnerError(error)) {
    return {
      category: "internal",
      exitCode: getRunnerErrorExitCode("internal"),
      message: getRunnerErrorDefaultMessage("internal"),
      metadata: {},
    };
  }

  return {
    category: error.category,
    exitCode: error.exitCode,
    message: sanitizeRunnerErrorMessage(error.category, error.userSafeMessage),
    metadata: sanitizeRunnerErrorMetadata(error.metadata),
  };
};

const sanitizeRunnerErrorMessage = (
  category: RunnerErrorCategory,
  userSafeMessage: string | undefined,
): string => {
  const defaultMessage = getRunnerErrorDefaultMessage(category);

  if (userSafeMessage === undefined) {
    return defaultMessage;
  }

  const redacted = redactText(userSafeMessage);

  return hasSourceLikeText(redacted) ? defaultMessage : redacted;
};

const sanitizeRunnerErrorMetadata = (
  metadata: Record<string, unknown> | undefined,
): RunnerErrorMetadata => {
  if (metadata === undefined) {
    return {};
  }

  return sanitizeRecord(metadata, new WeakSet());
};

const sanitizeRecord = (
  record: Record<string, unknown>,
  seen: WeakSet<object>,
): RunnerErrorMetadata => {
  if (seen.has(record)) {
    return {};
  }

  seen.add(record);

  const sanitized: RunnerErrorMetadata = {};

  for (const [key, value] of Object.entries(record)) {
    if (isUnsafeMetadataKey(key)) {
      continue;
    }

    const sanitizedValue = sanitizeMetadataValue(value, seen);

    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
};

const sanitizeMetadataValue = (
  value: unknown,
  seen: WeakSet<object>,
): RunnerErrorMetadataValue | undefined => {
  if (typeof value === "string") {
    return sanitizeMetadataString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    return value
      .map((item) => sanitizeMetadataValue(item, seen))
      .filter((item): item is RunnerErrorMetadataValue => item !== undefined);
  }

  if (isPlainRecord(value)) {
    return sanitizeRecord(value, seen);
  }

  return undefined;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isUnsafeMetadataKey = (key: string): boolean =>
  UNSAFE_METADATA_KEYS.has(normalizeMetadataKey(key));

const normalizeMetadataKey = (key: string): string =>
  key
    .trim()
    .replace(/[\s_-]/g, "")
    .toLowerCase();

const sanitizeMetadataString = (value: string): string | undefined => {
  const redacted = redactText(value);

  if (hasSourceLikeText(redacted)) {
    return undefined;
  }

  return redacted;
};

const hasSourceLikeText = (value: string): boolean =>
  SOURCE_LIKE_METADATA_PATTERNS.some((pattern) => pattern.test(value));

const redactText = (value: string): string => {
  let redacted = value;

  redacted = redacted.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  );
  redacted = redacted.replace(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/gi,
    "[REDACTED_CREDENTIAL_URL]",
  );
  redacted = redacted.replace(
    /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]\s*['"]?[^\s'";,)]+['"]?/gi,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]");

  return redacted;
};
