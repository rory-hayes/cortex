import "server-only";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  RepoPolicySchema,
  TaskPacketSchema,
  ValidationCommandSchema,
  type CortexTask,
  type CortexTaskExternalLink,
  type RepoPolicy,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";
import { hasUnsafePayloadPathText, hasUnsafePayloadText } from "../security/payload-guard";

export type CortexTaskPacketRepoMapping = {
  archivedAt: Date | null;
  defaultBranch: string | null;
  id: string;
  localPath: string | null;
  policySnapshot: unknown | null;
  repositoryName: string;
  repositoryOwner: string;
  validationCommands: unknown;
  workspaceId: string;
};

export type CortexTaskPacketGitHubRepository = {
  archived: boolean;
  disabled: boolean;
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

export type BuildCortexTaskPacketInput = {
  githubRepository: CortexTaskPacketGitHubRepository;
  now: Date;
  packetId: string;
  repoMapping: CortexTaskPacketRepoMapping;
  requiredApprovalExists?: boolean;
  runId: string;
  task: CortexTask;
};

const requiredTextMaxLength = 240;
const objectiveMaxLength = 4_000;
const acceptanceCriterionMaxLength = 1_000;
const contextNoteMaxLength = 1_000;
const localPathMaxLength = 1_024;
const urlMaxLength = 2_048;
const repositoryPartMaxLength = 100;
const repositoryFullNameMaxLength = 220;
const validationCwdMaxLength = 512;
const policyPatternMaxLength = 512;
const maxSuggestedValidationNotes = 10;
const secretUrlParameterPattern =
  /^(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)$/iu;

const unsafeCopiedTextPatterns = [
  /```[\s\S]*?```/,
  /\bdiff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:async\s+)?def\s+[A-Za-z_][\w]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[A-Za-z_][\w]*(?:\([^)]*\))?\s*:/i,
  /(^|\n)\s*<\/?[A-Z][\w:-]*(?:\s+[^>\n]*)?\/?>/i,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:sourceCode|rawSource|rawDiff|patchText|codeSnippet|rawOutput|rawLog)\b/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i,
  /(?:^|[\s"'([{:=,])(?:\.env(?:\.[A-Za-z0-9_.-]+)?|local\.env|[A-Za-z0-9_.-]+\.local\.env)(?:$|[\s"'),.;\]}])/i,
] as const;

const failValidation = (): never => {
  throw createActionError("validation_error");
};

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const isSafeHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
      return false;
    }

    for (const key of url.searchParams.keys()) {
      if (secretUrlParameterPattern.test(key)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

const tryDecodeUrlComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const hasUnsafeSafeHttpsUrlText = (value: string): boolean => {
  const url = new URL(value);
  const urlParts = [
    url.hostname,
    ...url.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(tryDecodeUrlComponent),
    ...[...url.searchParams.keys()].map(tryDecodeUrlComponent),
    ...[...url.searchParams.values()].map(tryDecodeUrlComponent),
    ...(url.hash.length === 0 ? [] : [tryDecodeUrlComponent(url.hash.slice(1))]),
  ];

  return urlParts.some(
    (part) =>
      hasUnsafePayloadText(part) || unsafeCopiedTextPatterns.some((pattern) => pattern.test(part)),
  );
};

const hasUnsafeCopiedText = (value: string): boolean => {
  if (isSafeHttpsUrl(value)) {
    return hasUnsafeSafeHttpsUrlText(value);
  }

  return (
    hasUnsafePayloadText(value) ||
    hasUnsafePayloadPathText(value) ||
    unsafeCopiedTextPatterns.some((pattern) => pattern.test(value))
  );
};

const assertRequiredText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return failValidation();
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafeCopiedText(normalizedValue)
  ) {
    return failValidation();
  }

  return normalizedValue;
};

const assertSafeLocalPath = (value: unknown): string => {
  if (typeof value !== "string") {
    return failValidation();
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > localPathMaxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafePayloadText(normalizedValue)
  ) {
    return failValidation();
  }

  return normalizedValue;
};

const assertOptionalText = (value: unknown, maxLength: number): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return failValidation();
  }

  if (value.trim().length === 0) {
    return undefined;
  }

  return assertRequiredText(value, maxLength);
};

const assertRequiredTextList = (value: unknown, maxItemLength: number): string[] => {
  if (!Array.isArray(value)) {
    return failValidation();
  }

  return value.map((item) => assertRequiredText(item, maxItemLength));
};

const assertRepositoryPart = (value: unknown): string => {
  const normalizedValue = assertRequiredText(value, repositoryPartMaxLength);

  if (
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.startsWith("-") ||
    normalizedValue.includes("/") ||
    normalizedValue.includes("\\") ||
    normalizedValue.includes(":") ||
    normalizedValue.includes("@") ||
    /\s/u.test(normalizedValue) ||
    !/^[A-Za-z0-9._-]+$/u.test(normalizedValue)
  ) {
    return failValidation();
  }

  return normalizedValue;
};

const assertRepositoryFullName = (input: {
  name: string;
  owner: string;
  value: unknown;
}): string => {
  const fullName = assertRequiredText(input.value, repositoryFullNameMaxLength);
  const expectedFullName = `${input.owner}/${input.name}`;

  if (fullName !== expectedFullName) {
    return failValidation();
  }

  return fullName;
};

const assertBranchName = (value: unknown): string => {
  const branch = assertRequiredText(value, requiredTextMaxLength);

  if (
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.includes("\\") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes(":") ||
    branch.includes("~") ||
    branch.includes("^") ||
    branch.includes("?") ||
    branch.includes("*") ||
    branch.includes("[") ||
    /\s/u.test(branch)
  ) {
    return failValidation();
  }

  return branch;
};

const normalizeSafeBranchSegment = (value: string): string => {
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
  assertBranchName(
    `aicp/cortex-task-${normalizeSafeBranchSegment(taskId)}-${normalizeSafeBranchSegment(runId)}`,
  );

const toIsoTimestamp = (value: Date): string => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return failValidation();
  }

  return value.toISOString();
};

const hasUnsafeCopiedValue = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (typeof value === "string") {
    return hasUnsafeCopiedText(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeCopiedValue(item, seen));
  }

  return Object.values(value).some((childValue) => hasUnsafeCopiedValue(childValue, seen));
};

const assertSafeCortexTask = (value: CortexTask): CortexTask => {
  const parsedTask = CortexTaskSchema.safeParse(value);

  if (parsedTask.success !== true) {
    return failValidation();
  }

  if (hasUnsafeCopiedValue(parsedTask.data)) {
    return failValidation();
  }

  return parsedTask.data;
};

const assertApprovedLocalRunnerTask = (input: {
  requiredApprovalExists?: boolean;
  task: CortexTask;
}): CortexTask => {
  const task = assertSafeCortexTask(input.task);

  if (
    task.status !== "approved" ||
    task.approvalStatus !== "approved" ||
    task.executionMode !== "local_runner" ||
    task.riskLevel === "blocked" ||
    (task.riskLevel === "high" && input.requiredApprovalExists !== true)
  ) {
    return failValidation();
  }

  return task;
};

const assertActiveRepoMapping = (mapping: CortexTaskPacketRepoMapping): void => {
  if (
    mapping.archivedAt !== null ||
    typeof mapping.localPath !== "string" ||
    mapping.localPath.trim().length === 0 ||
    typeof mapping.defaultBranch !== "string" ||
    mapping.defaultBranch.trim().length === 0 ||
    mapping.policySnapshot === null
  ) {
    return failValidation();
  }
};

const assertGitHubRepository = (
  repository: CortexTaskPacketGitHubRepository,
): {
  fullName: string;
  id: string;
  name: string;
  owner: string;
  workspaceId: string;
} => {
  if (repository.archived || repository.disabled) {
    return failValidation();
  }

  const owner = assertRepositoryPart(repository.repositoryOwner);
  const name = assertRepositoryPart(repository.repositoryName);

  return {
    fullName: assertRepositoryFullName({
      name,
      owner,
      value: repository.repositoryFullName,
    }),
    id: assertRequiredText(repository.id, requiredTextMaxLength),
    name,
    owner,
    workspaceId: assertRequiredText(repository.workspaceId, requiredTextMaxLength),
  };
};

const assertValidationCwd = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const cwd = assertRequiredText(value, validationCwdMaxLength);

  if (
    cwd.startsWith("/") ||
    cwd === "~" ||
    cwd.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/u.test(cwd) ||
    cwd.includes("\\") ||
    cwd.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return failValidation();
  }

  return cwd;
};

const assertSafeValidationCommand = (command: ValidationCommand): ValidationCommand => {
  const cwd = assertValidationCwd(command.cwd);

  return {
    command: assertRequiredText(command.command, 1_000),
    ...(cwd === undefined ? {} : { cwd }),
    id: assertRequiredText(command.id, requiredTextMaxLength),
    label: assertRequiredText(command.label, requiredTextMaxLength),
    required: command.required,
    timeoutSeconds: command.timeoutSeconds,
  };
};

const parseValidationCommands = (commands: unknown): ValidationCommand[] => {
  if (!Array.isArray(commands) || commands.length === 0) {
    return failValidation();
  }

  const parsedCommands = commands.map((command) => {
    const parsedCommand = ValidationCommandSchema.safeParse(command);

    if (parsedCommand.success !== true) {
      return failValidation();
    }

    return assertSafeValidationCommand(parsedCommand.data);
  });

  if (!parsedCommands.some((command) => command.required)) {
    return failValidation();
  }

  return parsedCommands;
};

const hasAbsoluteOrEscapingPolicyPattern = (value: string): boolean => {
  const normalizedPath = value.replace(/\\/g, "/");

  return (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ||
    normalizedPath.split("/").some((segment) => segment === "..")
  );
};

const assertSafePolicyPattern = (value: string): string => {
  if (typeof value !== "string") {
    return failValidation();
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > policyPatternMaxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafePayloadText(normalizedValue) ||
    hasAbsoluteOrEscapingPolicyPattern(normalizedValue)
  ) {
    return failValidation();
  }

  return normalizedValue;
};

const assertSafePolicyPatterns = (patterns: string[]): string[] =>
  patterns.map((pattern) => assertSafePolicyPattern(pattern));

const assertSafeRepoPolicy = (policy: RepoPolicy): RepoPolicy => ({
  ...policy,
  protectedBranches: assertSafePolicyPatterns(policy.protectedBranches),
  protectedPaths: assertSafePolicyPatterns(policy.protectedPaths),
  sensitivePaths: assertSafePolicyPatterns(policy.sensitivePaths),
  warningPaths: {
    auth: assertSafePolicyPatterns(policy.warningPaths.auth),
    billing: assertSafePolicyPatterns(policy.warningPaths.billing),
    infrastructure: assertSafePolicyPatterns(policy.warningPaths.infrastructure),
    migrations: assertSafePolicyPatterns(policy.warningPaths.migrations),
    packageLocks: assertSafePolicyPatterns(policy.warningPaths.packageLocks),
  },
});

const parseRepoPolicy = (input: {
  policySnapshot: unknown;
  validationCommands: ValidationCommand[];
}): RepoPolicy => {
  const parsedPolicy = RepoPolicySchema.safeParse(input.policySnapshot);

  if (parsedPolicy.success !== true) {
    return failValidation();
  }

  const composedPolicy = RepoPolicySchema.safeParse({
    ...parsedPolicy.data,
    validationCommands: input.validationCommands,
  });

  if (composedPolicy.success !== true) {
    return failValidation();
  }

  return assertSafeRepoPolicy(composedPolicy.data);
};

const selectLinearExternalLink = (task: CortexTask): CortexTaskExternalLink | undefined =>
  task.externalLinks.find(
    (link) => link.provider === "linear" || link.resourceType === "linear_issue",
  );

const isLinearExternalImport = (task: CortexTask): boolean =>
  task.origin.type === "external_import" &&
  (task.origin.externalSystem?.toLowerCase() === "linear" ||
    selectLinearExternalLink(task) !== undefined);

const createTaskPacketSource = (task: CortexTask): TaskPacket["source"] => {
  const linearExternalLink = selectLinearExternalLink(task);
  const source: TaskPacket["source"] = {
    title: assertRequiredText(task.title, requiredTextMaxLength),
    type: isLinearExternalImport(task) ? "linear" : "manual",
  };
  const externalId = assertOptionalText(
    linearExternalLink?.externalId ??
      (source.type === "linear" ? task.origin.externalId : undefined),
    requiredTextMaxLength,
  );
  const url = assertOptionalText(linearExternalLink?.url, urlMaxLength);

  if (externalId !== undefined) {
    source.externalId = externalId;
  }

  if (url !== undefined) {
    source.url = url;
  }

  return source;
};

const createContextNotes = (task: CortexTask): string[] => {
  const notes = [
    `Cortex task id: ${assertRequiredText(task.taskId, requiredTextMaxLength)}.`,
    `Risk level: ${assertRequiredText(task.riskLevel, requiredTextMaxLength)}.`,
    `Origin type: ${assertRequiredText(task.origin.type, requiredTextMaxLength)}.`,
    `Finding count: ${task.findingIds.length}.`,
  ];

  if (task.origin.externalSystem !== undefined) {
    notes.push(
      `Origin external system: ${assertRequiredText(
        task.origin.externalSystem,
        requiredTextMaxLength,
      )}.`,
    );
  }

  if (task.origin.externalId !== undefined) {
    notes.push(
      `Origin external id: ${assertRequiredText(task.origin.externalId, requiredTextMaxLength)}.`,
    );
  }

  if (task.taskRecommendationId !== undefined) {
    notes.push(
      `Task recommendation id: ${assertRequiredText(
        task.taskRecommendationId,
        requiredTextMaxLength,
      )}.`,
    );
  }

  const suggestedValidationLabels = task.suggestedValidation
    .slice(0, maxSuggestedValidationNotes)
    .map((validation) => {
      const label = assertRequiredText(validation.label, requiredTextMaxLength);

      return `${label} (${validation.required ? "required" : "optional"})`;
    });

  if (suggestedValidationLabels.length > 0) {
    const overflow =
      task.suggestedValidation.length > maxSuggestedValidationNotes
        ? `, plus ${task.suggestedValidation.length - maxSuggestedValidationNotes} more`
        : "";
    notes.push(`Suggested validation labels: ${suggestedValidationLabels.join(", ")}${overflow}.`);
  } else {
    notes.push("Suggested validation labels: none.");
  }

  return notes.map((note) => assertRequiredText(note, contextNoteMaxLength));
};

export const buildCortexTaskPacket = (input: BuildCortexTaskPacketInput): TaskPacket => {
  const task = assertApprovedLocalRunnerTask({
    ...(input.requiredApprovalExists === undefined
      ? {}
      : { requiredApprovalExists: input.requiredApprovalExists }),
    task: input.task,
  });
  const repository = assertGitHubRepository(input.githubRepository);

  assertActiveRepoMapping(input.repoMapping);

  const workspaceId = assertRequiredText(task.workspaceId, requiredTextMaxLength);
  const mappingWorkspaceId = assertRequiredText(
    input.repoMapping.workspaceId,
    requiredTextMaxLength,
  );
  const taskRepositoryId = assertRequiredText(task.repoId, requiredTextMaxLength);

  if (
    workspaceId !== mappingWorkspaceId ||
    workspaceId !== repository.workspaceId ||
    taskRepositoryId !== repository.id
  ) {
    return failValidation();
  }

  const mappingOwner = assertRepositoryPart(input.repoMapping.repositoryOwner);
  const mappingName = assertRepositoryPart(input.repoMapping.repositoryName);

  if (mappingOwner !== repository.owner || mappingName !== repository.name) {
    return failValidation();
  }

  const validationCommands = parseValidationCommands(input.repoMapping.validationCommands);
  const defaultBranch = assertBranchName(input.repoMapping.defaultBranch);
  const policy = parseRepoPolicy({
    policySnapshot: input.repoMapping.policySnapshot,
    validationCommands,
  });
  const packetId = assertRequiredText(input.packetId, requiredTextMaxLength);
  const runId = assertRequiredText(input.runId, requiredTextMaxLength);
  const taskId = assertRequiredText(task.taskId, requiredTextMaxLength);

  const packet = {
    acceptanceCriteria: assertRequiredTextList(
      task.acceptanceCriteria,
      acceptanceCriterionMaxLength,
    ),
    context: {
      files: [],
      notes: createContextNotes(task),
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: toIsoTimestamp(input.now),
    id: packetId,
    mode: "execute",
    objective: assertRequiredText(task.objective, objectiveMaxLength),
    policy,
    repo: {
      defaultBranch,
      localPath: assertSafeLocalPath(input.repoMapping.localPath),
      targetBranch: createTargetBranch(taskId, runId),
    },
    repositoryId: repository.fullName,
    runId,
    source: createTaskPacketSource(task),
    validation: {
      commands: validationCommands,
    },
    workspaceId,
  };

  const parsedPacket = TaskPacketSchema.safeParse(packet);

  if (parsedPacket.success !== true) {
    return failValidation();
  }

  return parsedPacket.data;
};
