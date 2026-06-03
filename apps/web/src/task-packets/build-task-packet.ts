import "server-only";

import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  RepoPolicySchema,
  TaskPacketSchema,
  ValidationCommandSchema,
  type RepoPolicy,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";

export type ManualTaskPacketTask = {
  acceptanceCriteria: string[];
  contextFilePaths: string[];
  contractVersion: string;
  externalId?: string | null;
  externalUrl?: string | null;
  id: string;
  mode: string;
  objective: string;
  repoMappingId: string;
  sourceType: string;
  status: string;
  title: string;
  workspaceId: string;
};

export type ManualTaskPacketRepoMapping = {
  archivedAt: Date | null;
  defaultBranch: string | null;
  id: string;
  localPath: string | null;
  policySnapshot: unknown | null;
  validationCommands: unknown;
  workspaceId: string;
};

export type BuildManualTaskPacketInput = {
  now: Date;
  packetId: string;
  repoMapping: ManualTaskPacketRepoMapping;
  runId: string;
  task: ManualTaskPacketTask;
};

const requiredTextMaxLength = 240;
const objectiveMaxLength = 4_000;
const acceptanceCriterionMaxLength = 1_000;
const contextFilePathMaxLength = 512;
const defaultContextNote = "Context files are path references only.";

const defaultSensitivePaths = [".env", ".env.*", "local.env", "*.local.env"] as const;

const defaultWarningPaths = {
  auth: ["**/auth/**", "**/authentication/**", "**/oauth/**"],
  billing: [
    "**/billing/**",
    "**/payments/**",
    "**/payment/**",
    "**/stripe/**",
    "**/checkout/**",
    "**/subscription/**",
    "**/subscriptions/**",
  ],
  infrastructure: [
    ".github/workflows/**",
    ".github/actions/**",
    "infra/**",
    "infrastructure/**",
    "terraform/**",
    "pulumi/**",
    "k8s/**",
    "kubernetes/**",
    "helm/**",
    "charts/**",
    "deploy/**",
    "deployments/**",
    "cloudformation/**",
    "cdk/**",
    "**/Dockerfile",
    "**/docker-compose.yml",
    "**/docker-compose.yaml",
    "**/serverless.yml",
    "**/serverless.yaml",
    "**/*.tf",
    "netlify.toml",
    "vercel.json",
    "render.yaml",
    "fly.toml",
    "wrangler.toml",
  ],
  migrations: [
    "**/migrations/**",
    "**/migration/**",
    "prisma/migrations/**",
    "supabase/migrations/**",
    "db/migrations/**",
    "database/migrations/**",
  ],
  packageLocks: [
    "**/package-lock.json",
    "**/npm-shrinkwrap.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
    "**/bun.lock",
    "**/bun.lockb",
  ],
} satisfies RepoPolicy["warningPaths"];

const unsafePayloadKeys = new Set([
  "content",
  "contents",
  "dependencygraph",
  "dependencygraphs",
  "diff",
  "filecontent",
  "filecontents",
  "filetree",
  "filetrees",
  "log",
  "logs",
  "output",
  "patch",
  "rawdiff",
  "rawlog",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "rawstderr",
  "rawstdout",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stdout",
  "snippet",
  "snippets",
]);

const unsafeTextPatterns = [
  /\bdiff --git\b/i,
  /@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bxox[a-z]-[A-Za-z0-9-]{20,}\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Za-z0-9._%+-]+:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+|;)/m,
  /^\s*(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/m,
  /^\s*(?:try|else)\s*\{/m,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
] as const;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const hasUnsafeText = (value: string): boolean =>
  unsafeTextPatterns.some((pattern) => pattern.test(value));

const assertSafeBoundedText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafeText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalText = (value: unknown, maxLength: number): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  if (value.trim().length === 0) {
    return undefined;
  }

  return assertSafeBoundedText(value, maxLength);
};

const assertStringList = (
  value: unknown,
  maxItemLength: number,
  normalizeItem = (item: unknown) => assertSafeBoundedText(item, maxItemLength),
): string[] => {
  if (!Array.isArray(value)) {
    throw createActionError("validation_error");
  }

  return value.map(normalizeItem);
};

const isEnvLikeContextPath = (path: string): boolean => {
  const basename = path.split("/").at(-1) ?? "";

  if (basename === ".env.example") {
    return false;
  }

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "local.env" ||
    basename.endsWith(".local.env")
  );
};

const normalizeContextFilePath = (value: unknown): string => {
  const path = assertSafeBoundedText(value, contextFilePathMaxLength);

  if (
    path.startsWith("/") ||
    path === "~" ||
    path.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    isEnvLikeContextPath(path)
  ) {
    throw createActionError("validation_error");
  }

  return path;
};

const findUnsafePayloadKey = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const unsafeKey = findUnsafePayloadKey(item, seen);
      if (unsafeKey !== undefined) {
        return unsafeKey;
      }
    }

    return undefined;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (unsafePayloadKeys.has(normalizeKey(key))) {
      return key;
    }

    const unsafeKey = findUnsafePayloadKey(childValue, seen);
    if (unsafeKey !== undefined) {
      return unsafeKey;
    }
  }

  return undefined;
};

const findUnsafeText = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (typeof value === "string") {
    return hasUnsafeText(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => findUnsafeText(item, seen));
  }

  return Object.values(value).some((childValue) => findUnsafeText(childValue, seen));
};

const assertSafePacketPayload = (value: unknown): void => {
  if (findUnsafePayloadKey(value) !== undefined || findUnsafeText(value)) {
    throw createActionError("validation_error");
  }
};

const assertManualTask = (task: ManualTaskPacketTask): ManualTaskPacketTask => {
  if (
    task.contractVersion !== CONTRACT_VERSION ||
    task.sourceType !== "manual" ||
    task.status !== "draft" ||
    (task.mode !== "execute" && task.mode !== "dryRun")
  ) {
    throw createActionError("validation_error");
  }

  return task;
};

const assertActiveRepoMapping = (mapping: ManualTaskPacketRepoMapping): void => {
  if (
    mapping.archivedAt !== null ||
    typeof mapping.localPath !== "string" ||
    mapping.localPath.trim().length === 0 ||
    typeof mapping.defaultBranch !== "string" ||
    mapping.defaultBranch.trim().length === 0
  ) {
    throw createActionError("validation_error");
  }
};

const parseValidationCommands = (commands: unknown): ValidationCommand[] => {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw createActionError("validation_error");
  }

  const parsedCommands = commands.map((command) => {
    const parsedCommand = ValidationCommandSchema.safeParse(command);

    if (!parsedCommand.success) {
      throw createActionError("validation_error");
    }

    return parsedCommand.data;
  });

  if (!parsedCommands.some((command) => command.required)) {
    throw createActionError("validation_error");
  }

  return parsedCommands;
};

const createDefaultPolicy = (input: {
  defaultBranch: string;
  validationCommands: ValidationCommand[];
}): RepoPolicy => {
  const policy = RepoPolicySchema.safeParse({
    allowUntrackedFiles: false,
    contractVersion: CONTRACT_VERSION,
    dryRunChecks: [...DRY_RUN_CHECKS],
    maxChangedFiles: 20,
    protectedBranches: [input.defaultBranch],
    protectedPaths: [],
    sensitivePaths: [...defaultSensitivePaths],
    validationCommands: input.validationCommands,
    warningPaths: defaultWarningPaths,
  });

  if (!policy.success) {
    throw createActionError("validation_error");
  }

  return policy.data;
};

const composePolicy = (input: {
  defaultBranch: string;
  policySnapshot: unknown | null;
  validationCommands: ValidationCommand[];
}): RepoPolicy => {
  if (input.policySnapshot === null) {
    return createDefaultPolicy({
      defaultBranch: input.defaultBranch,
      validationCommands: input.validationCommands,
    });
  }

  const parsedPolicy = RepoPolicySchema.safeParse(input.policySnapshot);
  if (!parsedPolicy.success) {
    throw createActionError("validation_error");
  }

  const composedPolicy = RepoPolicySchema.safeParse({
    ...parsedPolicy.data,
    validationCommands: input.validationCommands,
  });

  if (!composedPolicy.success) {
    throw createActionError("validation_error");
  }

  return composedPolicy.data;
};

const sanitizeBranchSegment = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/\.\.+/g, ".")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/[./]+$/g, "")
    .replace(/\.lock$/g, "")
    .slice(0, 80);

  if (sanitized.length === 0 || sanitized === "." || sanitized.includes("@{")) {
    return "item";
  }

  return sanitized;
};

const createTargetBranch = (taskId: string, runId: string): string =>
  `aicp/manual-task-${sanitizeBranchSegment(taskId)}-${sanitizeBranchSegment(runId)}`;

const toIsoTimestamp = (value: Date): string => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw createActionError("validation_error");
  }

  return value.toISOString();
};

const createTaskPacketSource = (task: ManualTaskPacketTask): TaskPacket["source"] => {
  const source: TaskPacket["source"] = {
    title: assertSafeBoundedText(task.title, requiredTextMaxLength),
    type: "manual",
  };
  const externalId = normalizeOptionalText(task.externalId, requiredTextMaxLength);
  const externalUrl = normalizeOptionalText(task.externalUrl, 2_048);

  if (externalId !== undefined) {
    source.externalId = externalId;
  }

  if (externalUrl !== undefined) {
    source.url = externalUrl;
  }

  return source;
};

export const buildManualTaskPacket = (input: BuildManualTaskPacketInput): TaskPacket => {
  const task = assertManualTask(input.task);
  const mapping = input.repoMapping;

  assertActiveRepoMapping(mapping);

  const workspaceId = assertSafeBoundedText(task.workspaceId, requiredTextMaxLength);
  const mappingWorkspaceId = assertSafeBoundedText(mapping.workspaceId, requiredTextMaxLength);
  const repoMappingId = assertSafeBoundedText(task.repoMappingId, requiredTextMaxLength);
  const mappingId = assertSafeBoundedText(mapping.id, requiredTextMaxLength);

  if (workspaceId !== mappingWorkspaceId || repoMappingId !== mappingId) {
    throw createActionError("validation_error");
  }

  const packetId = assertSafeBoundedText(input.packetId, requiredTextMaxLength);
  const runId = assertSafeBoundedText(input.runId, requiredTextMaxLength);
  const taskId = assertSafeBoundedText(task.id, requiredTextMaxLength);
  const defaultBranch = assertSafeBoundedText(mapping.defaultBranch, requiredTextMaxLength);
  const localPath = assertSafeBoundedText(mapping.localPath, 1_024);
  const validationCommands = parseValidationCommands(mapping.validationCommands);
  const policy = composePolicy({
    defaultBranch,
    policySnapshot: mapping.policySnapshot,
    validationCommands,
  });

  const packet = {
    acceptanceCriteria: assertStringList(task.acceptanceCriteria, acceptanceCriterionMaxLength),
    context: {
      files: assertStringList(
        task.contextFilePaths,
        contextFilePathMaxLength,
        normalizeContextFilePath,
      ),
      notes: [defaultContextNote],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: toIsoTimestamp(input.now),
    id: packetId,
    mode: task.mode,
    objective: assertSafeBoundedText(task.objective, objectiveMaxLength),
    policy,
    repo: {
      defaultBranch,
      localPath,
      targetBranch: createTargetBranch(taskId, runId),
    },
    repositoryId: mappingId,
    runId,
    source: createTaskPacketSource(task),
    validation: {
      commands: validationCommands,
    },
    workspaceId,
  };

  assertSafePacketPayload(packet);

  const parsedPacket = TaskPacketSchema.safeParse(packet);

  if (!parsedPacket.success) {
    throw createActionError("validation_error");
  }

  return parsedPacket.data;
};
