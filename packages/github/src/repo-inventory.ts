import { Buffer } from "node:buffer";

import {
  REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS,
  RepoPolicySchema,
  RepoScanInventorySchema,
  type RepoPolicy,
  type RepoScanAgentInstructionSummary,
  type RepoScanBacklogQualitySignalLabel,
  type RepoScanBacklogQualitySummary,
  type RepoScanBacklogSummary,
  type RepoScanCiPostureSummary,
  type RepoScanDocumentationSummary,
  type RepoScanInventory,
  type RepoScanLanguageSummary,
  type RepoScanPolicySummary,
  type RepoScanProductClarityReadStatus,
  type RepoScanProductClarityStatus,
  type RepoScanProductClaritySummary,
  type RepoScanRepoHygieneIssueLabel,
  type RepoScanRepoHygieneMonorepoStructureStatus,
  type RepoScanRepoHygienePackageManagerStatus,
  type RepoScanRepoHygieneStatus,
  type RepoScanRepoHygieneSummary,
  type RepoScanValidationCommandLabel,
  type RepoScanValidationPostureSummary,
} from "@control-plane/shared";

import type { GitHubAppRequest, GitHubAppRequestFunction } from "./app-client.js";
import { summarizeAllowlistedDocument } from "./repo-document-summarizer.js";
import {
  classifyRepoScanFileRead,
  type RepoScanFileReadAllowReason,
} from "./repo-scan-file-allowlist.js";

export const DEFAULT_MAX_TREE_ENTRIES = 20_000;
export const DEFAULT_MAX_FILE_READ_BYTES = 64 * 1024;

const MAX_REPOSITORY_PART_LENGTH = 100;
const MAX_BRANCH_REF_LENGTH = 256;
const MAX_TREE_PATH_LENGTH = 512;

export type GitHubRepositoryInventoryRequest = {
  defaultBranch: string;
  installationId: number;
  maxFileReadBytes?: number;
  maxTreeEntries?: number;
  owner: string;
  repo: string;
  request: GitHubAppRequestFunction;
};

export type GitHubRepositoryInventoryRepository = {
  defaultBranch: string;
  name: string;
  owner: string;
};

export type GitHubRepositoryInventoryTreeSummary = {
  hasTestDirectories: boolean;
  processedEntryCount: number;
  skippedEntryCount: number;
  truncated: boolean;
};

export type GitHubRepositoryInventoryFileReadSummary = {
  attemptedFileCount: number;
  readFileCount: number;
  skippedOversizedFileCount: number;
  unreadableFileCount: number;
};

export type GitHubRepositoryInventoryPolicyReadStatus =
  | "invalid"
  | "missing"
  | "oversized"
  | "parsed"
  | "unreadable";

export type GitHubRepositoryInventory = {
  allowlistedFileReadSummary: GitHubRepositoryInventoryFileReadSummary;
  policyReadStatus: GitHubRepositoryInventoryPolicyReadStatus;
  repository: GitHubRepositoryInventoryRepository;
  repoScanInventory: RepoScanInventory;
  treeSummary: GitHubRepositoryInventoryTreeSummary;
};

export type GitHubRepositoryInventoryErrorCode =
  | "invalid_file_limit"
  | "invalid_installation_id"
  | "invalid_ref"
  | "invalid_repository"
  | "invalid_request_function"
  | "invalid_response"
  | "invalid_tree_limit"
  | "request_failed";

export class GitHubRepositoryInventoryError extends Error {
  readonly code: GitHubRepositoryInventoryErrorCode;

  constructor(code: GitHubRepositoryInventoryErrorCode, message: string) {
    super(message);
    this.name = "GitHubRepositoryInventoryError";
    this.code = code;
  }
}

type GitHubTreeEntryType = "blob" | "tree";

type GitHubTreeEntry = {
  path: string;
  size: number | null;
  type: GitHubTreeEntryType;
};

type PolicyReadResult = {
  policy?: RepoPolicy;
  status: GitHubRepositoryInventoryPolicyReadStatus;
};

type AgentInstructionReadStatus = RepoScanAgentInstructionSummary["readStatus"];
type BacklogReadStatus = RepoScanBacklogSummary["readStatus"];

type AgentInstructionTracking = {
  fileCount: number;
  readStatus: AgentInstructionReadStatus;
  texts: string[];
};

type BacklogTracking = {
  fileCount: number;
  readStatus: BacklogReadStatus;
  texts: string[];
};

type CiWorkflowTracking = {
  fileCount: number;
  texts: string[];
};

type ReadableFileEntry = {
  path: string;
  reason: RepoScanFileReadAllowReason;
  size: number;
};

const EMPTY_POLICY_SUMMARY: RepoScanPolicySummary = {
  dryRunCheckCount: 0,
  hasPolicyFile: false,
  protectedPathCount: 0,
  sensitivePathCount: 0,
  validationCommandCount: 0,
};

const ROOT_AGENT_INSTRUCTION_FILENAMES = new Set(["AGENTS.md", "agents.md"]);
const ROOT_BACKLOG_FILENAMES = new Set(["BACKLOG.md", "backlog.md"]);
const AGENT_INSTRUCTION_REQUIRED_SECTIONS = [
  { label: "architecture", pattern: /\b(?:architecture|boundary|web app|runner)\b/iu },
  { label: "security", pattern: /\b(?:security|trust|secret|source|diff|patch)\b/iu },
  { label: "testing", pattern: /\b(?:test|testing|validation|verify|verification)\b/iu },
] as const;
const BACKLOG_REQUIRED_STRUCTURE = [
  { label: "task headings", pattern: /^(?:#{2,4}\s+)?(?:TASK|RFB)-\d+\b/imu },
  { label: "status markers", pattern: /\bStatus:\s*\[[ xX~!]\]/iu },
  { label: "acceptance criteria", pattern: /\bAcceptance Criteria:\s*\S/iu },
  { label: "validation guidance", pattern: /\bValidation:\s*\S/iu },
] as const;
const BACKLOG_EXECUTION_METADATA_PATTERNS = [
  /\b(?:Files Likely Touched|Files Likely To Change):\s*\S/iu,
  /\bPriority:\s*\S/iu,
  /\bMilestone:\s*\S/iu,
  /\bArea:\s*\S/iu,
  /\bDepends on:\s*\S/iu,
  /\bGoal:\s*\S/iu,
] as const;
const BACKLOG_QUALITY_SIGNALS = [
  { label: "acceptance criteria", pattern: /\bAcceptance Criteria:\s*\S/iu },
  { label: "dependencies", pattern: /\b(?:Depends on|Dependencies):\s*\S/iu },
  {
    label: "file-touch hints",
    pattern: /\b(?:Files Likely Touched|Files Likely To Change):\s*\S/iu,
  },
  { label: "priority or milestone", pattern: /\b(?:Priority|Milestone):\s*\S/iu },
  { label: "security notes", pattern: /\b(?:Security\/Trust Notes|Security Notes):\s*\S/iu },
  { label: "status markers", pattern: /\bStatus:\s*\[[ xX~!]\]/iu },
  { label: "task ids", pattern: /^(?:#{2,4}\s+)?(?:TASK|RFB)-\d+\b/imu },
  { label: "validation", pattern: /\bValidation:\s*\S/iu },
] as const satisfies readonly {
  label: RepoScanBacklogQualitySignalLabel;
  pattern: RegExp;
}[];

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".c", "C"],
  [".cc", "C++"],
  [".cpp", "C++"],
  [".cs", "C#"],
  [".css", "CSS"],
  [".go", "Go"],
  [".html", "HTML"],
  [".java", "Java"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".json", "JSON"],
  [".kt", "Kotlin"],
  [".md", "Markdown"],
  [".php", "PHP"],
  [".py", "Python"],
  [".rb", "Ruby"],
  [".rs", "Rust"],
  [".swift", "Swift"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".yaml", "YAML"],
  [".yml", "YAML"],
]);

const PACKAGE_MANAGER_PATTERNS = [
  { label: "pnpm", pattern: /^pnpm-lock\.yaml$/u },
  { label: "yarn", pattern: /^yarn\.lock$/u },
  { label: "npm", pattern: /^package-lock\.json$/u },
  { label: "bun", pattern: /^bun\.lockb?$/u },
  { label: "cargo", pattern: /^Cargo\.lock$/u },
  { label: "go modules", pattern: /^go\.sum$/u },
  { label: "poetry", pattern: /^poetry\.lock$/u },
  { label: "pip", pattern: /^requirements(?:-[A-Za-z0-9._-]+)?\.txt$/u },
] as const;

const CI_PATTERNS = [
  { label: "GitHub Actions", pattern: /^\.github\/workflows\/[^/]+\.ya?ml$/u },
  { label: "GitLab CI", pattern: /^\.gitlab-ci\.ya?ml$/u },
  { label: "CircleCI", pattern: /^\.circleci\/config\.ya?ml$/u },
  { label: "Azure Pipelines", pattern: /^azure-pipelines\.ya?ml$/u },
  { label: "Travis CI", pattern: /^\.travis\.ya?ml$/u },
] as const;

const DOCUMENTATION_PATTERNS = [
  { kind: "architecture", pattern: /^(?:docs\/)?ARCHITECTURE\.[A-Za-z0-9]+$/iu },
  { kind: "product", pattern: /(?:^|\/)PRODUCT(?:\.[A-Za-z0-9]+)?$/iu },
  { kind: "product_spec", pattern: /(?:^|\/)PRODUCT_SPEC(?:\.[A-Za-z0-9]+)?$/iu },
  { kind: "readme", pattern: /(?:^|\/)README(?:\.[A-Za-z0-9]+)?$/iu },
  { kind: "contributing", pattern: /(?:^|\/)CONTRIBUTING(?:\.[A-Za-z0-9]+)?$/iu },
  { kind: "security", pattern: /(?:^|\/)SECURITY(?:\.[A-Za-z0-9]+)?$/iu },
  { kind: "code_of_conduct", pattern: /(?:^|\/)CODE_OF_CONDUCT(?:\.[A-Za-z0-9]+)?$/iu },
] as const;

const POLICY_PATH = ".aicp/policy.json";
const PRODUCT_SIGNAL_LABELS = [
  "non_goals",
  "problem",
  "purpose",
  "scope",
  "success_criteria",
  "target_user",
  "workflow",
] as const;

type ProductSignalLabel = (typeof PRODUCT_SIGNAL_LABELS)[number];

const PRODUCT_DOCUMENTATION_PATTERNS = [
  /^MVP_PLAN\.(?:md|markdown|txt)$/iu,
  /(?:^|\/)PRODUCT(?:\.(?:md|markdown|txt))?$/iu,
  /(?:^|\/)PRODUCT_SPEC(?:\.(?:md|markdown|txt))?$/iu,
] as const;

const PRODUCT_SIGNAL_PATTERNS: Record<ProductSignalLabel, RegExp> = {
  non_goals: /\b(?:non[-\s]?goals?|out of scope|not in scope)\b/iu,
  problem: /\b(?:problem|pain point|user need|customer need)\b/iu,
  purpose: /\b(?:purpose|mission|goal|why)\b/iu,
  scope: /\b(?:scope|in scope|boundary|boundaries)\b/iu,
  success_criteria: /\b(?:success criteria|acceptance criteria|metric|measure)\b/iu,
  target_user: /\b(?:target users?|users?|audience|customers?)\b/iu,
  workflow: /\b(?:workflow|user journey|flow|process)\b/iu,
};

const VALIDATION_COMMAND_LABELS = [
  "build",
  "format",
  "lint",
  "test",
  "typecheck",
] as const satisfies readonly RepoScanValidationCommandLabel[];
const REQUIRED_VALIDATION_COMMAND_LABELS = [
  "format",
  "lint",
  "test",
  "typecheck",
] as const satisfies readonly RepoScanValidationCommandLabel[];
const REQUIRED_CI_COMMAND_LABELS = [
  "build",
  "test",
  "typecheck",
] as const satisfies readonly RepoScanValidationCommandLabel[];
const VALIDATION_COMMAND_PATTERNS: Record<RepoScanValidationCommandLabel, RegExp> = {
  build: /\b(?:build|next\s+build|vite\s+build|tsup|rollup)\b/iu,
  format: /\b(?:format|format:check|prettier)\b/iu,
  lint: /\b(?:lint|eslint)\b/iu,
  test: /\b(?:test|vitest|jest|playwright|cypress)\b/iu,
  typecheck: /\b(?:typecheck|type-check|tsc(?:\s|$|:)|vue-tsc)\b/iu,
};

const JS_LOCKFILE_LABELS: ReadonlyMap<string, string> = new Map([
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
] as const);

const CONTRIBUTION_DOCUMENTATION_PATTERNS = [
  /^(?:docs\/)?CONTRIBUTING\.(?:md|markdown|txt)$/iu,
  /^(?:docs\/)?DEVELOPMENT\.(?:md|markdown|txt)$/iu,
] as const;

const ISSUE_TEMPLATE_PATTERNS = [
  /^\.github\/ISSUE_TEMPLATE\.(?:md|markdown|txt|ya?ml)$/iu,
  /^\.github\/issue_template\.(?:md|markdown|txt|ya?ml)$/iu,
  /^\.github\/ISSUE_TEMPLATE\/[^/]+\.(?:md|markdown|txt|ya?ml)$/iu,
] as const;

const MONOREPO_ROOT_DIRECTORY_NAMES = new Set(["apps", "libs", "packages", "services"]);

const WORKSPACE_CONFIG_PATTERNS = [
  /^lerna\.json$/iu,
  /^nx\.json$/iu,
  /^pnpm-workspace\.ya?ml$/iu,
  /^rush\.json$/iu,
  /^turbo\.json$/iu,
] as const;

const looksUnsafeText = (value: string): boolean =>
  /(?:diff\s+--git|@@|-----BEGIN|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,})/iu.test(
    value,
  );

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const parsePositiveInteger = (
  value: unknown,
  code: Extract<
    GitHubRepositoryInventoryErrorCode,
    "invalid_file_limit" | "invalid_installation_id" | "invalid_tree_limit"
  >,
): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubRepositoryInventoryError(
      code,
      "GitHub repository inventory input was invalid.",
    );
  }

  return value;
};

const parseRepositoryPart = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REPOSITORY_PART_LENGTH ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    value.startsWith("-") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("@") ||
    value.endsWith(".lock") ||
    hasControlCharacter(value) ||
    /\s/u.test(value) ||
    !/^[A-Za-z0-9._-]+$/u.test(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubRepositoryInventoryError(
      "invalid_repository",
      "Repository metadata must be safe.",
    );
  }

  return value;
};

const parseRefName = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BRANCH_REF_LENGTH ||
    value.trim() !== value ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes(":") ||
    value.includes("~") ||
    value.includes("^") ||
    value.includes("?") ||
    value.includes("*") ||
    value.includes("[") ||
    hasControlCharacter(value) ||
    /\s/u.test(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubRepositoryInventoryError("invalid_ref", "Repository ref must be safe.");
  }

  const segments = value.split("/");

  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.endsWith(".lock"),
    )
  ) {
    throw new GitHubRepositoryInventoryError("invalid_ref", "Repository ref must be safe.");
  }

  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseTreePath = (value: unknown): string | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TREE_PATH_LENGTH ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    return null;
  }

  const segments = value.split("/");

  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || segment.endsWith(".lock/"),
    )
  ) {
    return null;
  }

  return value;
};

const parseTreeEntryType = (value: unknown): GitHubTreeEntryType | null => {
  if (value === "blob" || value === "tree") {
    return value;
  }

  return null;
};

const parseOptionalSize = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

const parseTreeResponse = (value: unknown): { entries: GitHubTreeEntry[]; truncated: boolean } => {
  if (!isRecord(value) || !Array.isArray(value.tree)) {
    throw new GitHubRepositoryInventoryError(
      "invalid_response",
      "GitHub repository inventory response was invalid.",
    );
  }

  const entries: GitHubTreeEntry[] = [];

  for (const rawEntry of value.tree) {
    if (!isRecord(rawEntry)) {
      continue;
    }

    const path = parseTreePath(rawEntry.path);
    const type = parseTreeEntryType(rawEntry.type);

    if (path === null || type === null) {
      continue;
    }

    entries.push({
      path,
      size: parseOptionalSize(rawEntry.size),
      type,
    });
  }

  return {
    entries,
    truncated: value.truncated === true,
  };
};

const runRequest = async (
  request: GitHubAppRequestFunction,
  transportRequest: GitHubAppRequest,
): Promise<unknown> => {
  try {
    return await request(transportRequest);
  } catch {
    throw new GitHubRepositoryInventoryError(
      "request_failed",
      "GitHub repository inventory request failed.",
    );
  }
};

const addLabelForPatterns = (
  labels: Set<string>,
  path: string,
  patterns: readonly { label: string; pattern: RegExp }[],
): void => {
  for (const { label, pattern } of patterns) {
    if (pattern.test(path)) {
      labels.add(label);
    }
  }
};

const matchesPattern = (path: string, patterns: readonly { pattern: RegExp }[]): boolean =>
  patterns.some(({ pattern }) => pattern.test(path));

const getLanguageName = (path: string): string | null => {
  if (path === POLICY_PATH) {
    return null;
  }

  const basename = path.split("/").at(-1) ?? "";
  const extensionMatch = basename.match(/(\.[A-Za-z0-9]+)$/u);

  if (extensionMatch === null) {
    return null;
  }

  return LANGUAGE_BY_EXTENSION.get(extensionMatch[1]?.toLowerCase() ?? "") ?? null;
};

const addDocumentationSummary = (documentationCounts: Map<string, number>, path: string): void => {
  for (const { kind, pattern } of DOCUMENTATION_PATTERNS) {
    if (pattern.test(path)) {
      documentationCounts.set(kind, (documentationCounts.get(kind) ?? 0) + 1);
    }
  }
};

const isProductDocumentationPath = (path: string): boolean =>
  PRODUCT_DOCUMENTATION_PATTERNS.some((pattern) => pattern.test(path));

const isContributionDocumentationPath = (path: string): boolean =>
  CONTRIBUTION_DOCUMENTATION_PATTERNS.some((pattern) => pattern.test(path));

const isIssueTemplatePath = (path: string): boolean =>
  ISSUE_TEMPLATE_PATTERNS.some((pattern) => pattern.test(path));

const jsLockfileLabelForPath = (path: string): string | undefined => JS_LOCKFILE_LABELS.get(path);

const isWorkspaceConfigPath = (path: string): boolean =>
  WORKSPACE_CONFIG_PATTERNS.some((pattern) => pattern.test(path));

const isTopLevelMonorepoDirectory = (path: string): boolean =>
  !path.includes("/") && MONOREPO_ROOT_DIRECTORY_NAMES.has(path.toLowerCase());

const isNestedWorkspacePackageManifest = (path: string): boolean => {
  const segments = path.split("/");

  return (
    segments.length === 3 &&
    MONOREPO_ROOT_DIRECTORY_NAMES.has(segments[0]?.toLowerCase() ?? "") &&
    segments[2] === "package.json"
  );
};

const isBoundedProductDocumentationDecision = (
  decision: ReturnType<typeof classifyRepoScanFileRead>,
): boolean =>
  decision.action === "read" ||
  decision.reason === "oversized" ||
  decision.reason === "unknown_size";

const detectProductSignalLabels = (text: string): ProductSignalLabel[] =>
  PRODUCT_SIGNAL_LABELS.filter((label) => PRODUCT_SIGNAL_PATTERNS[label].test(text));

const hasTestDirectory = (path: string): boolean =>
  path.split("/").some((segment) => /^(?:__tests__|e2e|spec|test|tests)$/iu.test(segment));

const toSortedLabels = (labels: Set<string>): string[] =>
  [...labels].toSorted((left, right) => left.localeCompare(right));

const toLanguageSummaries = (languageCounts: Map<string, number>): RepoScanLanguageSummary[] =>
  [...languageCounts.entries()]
    .map(([name, fileCount]) => ({ fileCount, name }))
    .toSorted((left, right) => left.name.localeCompare(right.name));

const toDocumentationSummaries = (
  documentationCounts: Map<string, number>,
): RepoScanDocumentationSummary[] =>
  [...documentationCounts.entries()]
    .map(([kind, pathCount]) => ({
      kind,
      pathCount,
      present: pathCount > 0,
    }))
    .filter((summary) => summary.present)
    .toSorted((left, right) => left.kind.localeCompare(right.kind));

const summarizePolicy = (
  policy: RepoPolicy | undefined,
  hasPolicyFile: boolean,
): RepoScanPolicySummary => {
  if (policy === undefined) {
    return {
      ...EMPTY_POLICY_SUMMARY,
      hasPolicyFile,
    };
  }

  return {
    dryRunCheckCount: policy.dryRunChecks.length,
    hasPolicyFile: true,
    protectedPathCount: policy.protectedPaths.length,
    sensitivePathCount: policy.sensitivePaths.length,
    validationCommandCount: policy.validationCommands.length,
  };
};

const detectValidationCommandLabels = (policy: RepoPolicy): RepoScanValidationCommandLabel[] => {
  const labels = new Set<RepoScanValidationCommandLabel>();

  for (const command of policy.validationCommands) {
    const searchableText = [command.id, command.label, command.command].join(" ");

    for (const label of VALIDATION_COMMAND_LABELS) {
      if (VALIDATION_COMMAND_PATTERNS[label].test(searchableText)) {
        labels.add(label);
      }
    }
  }

  return VALIDATION_COMMAND_LABELS.filter((label) => labels.has(label));
};

const summarizeValidationPosture = (
  policy: RepoPolicy | undefined,
  hasPolicyFile: boolean,
): RepoScanValidationPostureSummary => {
  if (policy === undefined || policy.validationCommands.length === 0) {
    return {
      detectedCommandLabels: [],
      dryRunCheckCount: 0,
      hasPolicyFile,
      missingCommandLabels: [...REQUIRED_VALIDATION_COMMAND_LABELS],
      postureStatus: "missing",
      suggestedCommandLabels: [...REQUIRED_VALIDATION_COMMAND_LABELS],
      validationCommandCount: 0,
    };
  }

  const detectedCommandLabels = detectValidationCommandLabels(policy);
  const missingCommandLabels = REQUIRED_VALIDATION_COMMAND_LABELS.filter(
    (label) => !detectedCommandLabels.includes(label),
  );
  const postureStatus =
    missingCommandLabels.length === 0
      ? "ready"
      : detectedCommandLabels.length === 0
        ? "unknown"
        : "partial";

  return {
    detectedCommandLabels,
    dryRunCheckCount: policy.dryRunChecks.length,
    hasPolicyFile: true,
    missingCommandLabels,
    postureStatus,
    suggestedCommandLabels: [...REQUIRED_VALIDATION_COMMAND_LABELS],
    validationCommandCount: policy.validationCommands.length,
  };
};

const detectCiCommandLabels = (texts: readonly string[]): RepoScanValidationCommandLabel[] => {
  const searchableText = texts.join("\n");

  return VALIDATION_COMMAND_LABELS.filter((label) =>
    VALIDATION_COMMAND_PATTERNS[label].test(searchableText),
  );
};

const summarizeCiPosture = (input: {
  providerLabels: string[];
  tracking: CiWorkflowTracking;
  validationPostureSummary: RepoScanValidationPostureSummary;
}): RepoScanCiPostureSummary => {
  const requiredCommandLabels = REQUIRED_CI_COMMAND_LABELS.filter((label) =>
    input.validationPostureSummary.detectedCommandLabels.includes(label),
  );
  const hasCi = input.providerLabels.length > 0 || input.tracking.fileCount > 0;

  if (!hasCi) {
    return {
      detectedCommandLabels: [],
      hasCi: false,
      missingCommandLabels: requiredCommandLabels,
      postureStatus: "missing",
      providerLabels: input.providerLabels,
      requiredCommandLabels,
      workflowFileCount: input.tracking.fileCount,
    };
  }

  if (requiredCommandLabels.length === 0 || input.tracking.texts.length === 0) {
    return {
      detectedCommandLabels: [],
      hasCi: true,
      missingCommandLabels: requiredCommandLabels,
      postureStatus: "unknown",
      providerLabels: input.providerLabels,
      requiredCommandLabels,
      workflowFileCount: input.tracking.fileCount,
    };
  }

  const detectedCommandLabels = detectCiCommandLabels(input.tracking.texts);
  const missingCommandLabels = requiredCommandLabels.filter(
    (label) => !detectedCommandLabels.includes(label),
  );

  return {
    detectedCommandLabels,
    hasCi: true,
    missingCommandLabels,
    postureStatus: missingCommandLabels.length === 0 ? "aligned" : "partial",
    providerLabels: input.providerLabels,
    requiredCommandLabels,
    workflowFileCount: input.tracking.fileCount,
  };
};

const isRootAgentInstructionPath = (path: string): boolean =>
  ROOT_AGENT_INSTRUCTION_FILENAMES.has(path);

const isRootBacklogPath = (path: string): boolean => ROOT_BACKLOG_FILENAMES.has(path);

const nextAgentReadStatus = (
  currentStatus: AgentInstructionReadStatus,
  nextStatus: AgentInstructionReadStatus,
): AgentInstructionReadStatus => {
  if (currentStatus === "read" || nextStatus === "read") {
    return "read";
  }

  if (currentStatus === "missing") {
    return nextStatus;
  }

  if (currentStatus === "oversized" || nextStatus === "oversized") {
    return "oversized";
  }

  if (currentStatus === "unknown_size" || nextStatus === "unknown_size") {
    return "unknown_size";
  }

  return "unreadable";
};

const nextBacklogReadStatus = (
  currentStatus: BacklogReadStatus,
  nextStatus: BacklogReadStatus,
): BacklogReadStatus => {
  if (currentStatus === "read" || nextStatus === "read") {
    return "read";
  }

  if (currentStatus === "missing") {
    return nextStatus;
  }

  if (currentStatus === "oversized" || nextStatus === "oversized") {
    return "oversized";
  }

  if (currentStatus === "unknown_size" || nextStatus === "unknown_size") {
    return "unknown_size";
  }

  return "unreadable";
};

const missingAgentInstructionSections = (text: string): string[] =>
  AGENT_INSTRUCTION_REQUIRED_SECTIONS.filter(({ pattern }) => !pattern.test(text)).map(
    ({ label }) => label,
  );

const missingBacklogStructureLabels = (text: string): string[] => {
  const missingLabels: RepoScanBacklogSummary["missingStructureLabels"] =
    BACKLOG_REQUIRED_STRUCTURE.filter(({ pattern }) => !pattern.test(text)).map(
      ({ label }) => label,
    );
  const executionMetadataCount = BACKLOG_EXECUTION_METADATA_PATTERNS.filter((pattern) =>
    pattern.test(text),
  ).length;

  if (executionMetadataCount < 2) {
    missingLabels.push("execution metadata");
  }

  return missingLabels;
};

const detectBacklogQualitySignals = (text: string): RepoScanBacklogQualitySignalLabel[] =>
  BACKLOG_QUALITY_SIGNALS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);

const summarizeAgentInstructions = (
  tracking: AgentInstructionTracking,
): RepoScanAgentInstructionSummary => {
  if (tracking.fileCount === 0) {
    return {
      completenessStatus: "missing",
      hasAgentInstructions: false,
      instructionFileCount: 0,
      missingSectionLabels: ["agent instructions"],
      readStatus: "missing",
    };
  }

  if (tracking.fileCount > 1) {
    return {
      completenessStatus: "conflicting",
      hasAgentInstructions: true,
      instructionFileCount: tracking.fileCount,
      missingSectionLabels: ["duplicate root instruction files"],
      readStatus: tracking.readStatus,
    };
  }

  if (tracking.texts.length === 0) {
    return {
      completenessStatus: "unknown",
      hasAgentInstructions: true,
      instructionFileCount: tracking.fileCount,
      missingSectionLabels: ["instruction content unreadable"],
      readStatus: tracking.readStatus,
    };
  }

  const missingSectionLabels = missingAgentInstructionSections(tracking.texts.join("\n"));

  return {
    completenessStatus: missingSectionLabels.length === 0 ? "complete" : "incomplete",
    hasAgentInstructions: true,
    instructionFileCount: tracking.fileCount,
    missingSectionLabels,
    readStatus: tracking.readStatus,
  };
};

const summarizeBacklog = (tracking: BacklogTracking): RepoScanBacklogSummary => {
  if (tracking.fileCount === 0) {
    return {
      backlogFileCount: 0,
      hasBacklog: false,
      missingStructureLabels: ["backlog"],
      readStatus: "missing",
      structureStatus: "missing",
    };
  }

  if (tracking.texts.length === 0) {
    return {
      backlogFileCount: tracking.fileCount,
      hasBacklog: true,
      missingStructureLabels: ["backlog content unreadable"],
      readStatus: tracking.readStatus,
      structureStatus: "unknown",
    };
  }

  const missingStructureLabels = missingBacklogStructureLabels(tracking.texts.join("\n"));

  return {
    backlogFileCount: tracking.fileCount,
    hasBacklog: true,
    missingStructureLabels,
    readStatus: tracking.readStatus,
    structureStatus: missingStructureLabels.length === 0 ? "complete" : "weak",
  };
};

const summarizeBacklogQuality = (tracking: BacklogTracking): RepoScanBacklogQualitySummary => {
  if (tracking.fileCount === 0) {
    return {
      backlogFileCount: 0,
      hasBacklog: false,
      missingSignalLabels: ["backlog"],
      readStatus: "missing",
      signalLabels: [],
      structureStatus: "missing",
    };
  }

  if (tracking.texts.length === 0) {
    return {
      backlogFileCount: tracking.fileCount,
      hasBacklog: true,
      missingSignalLabels: ["backlog content unreadable"],
      readStatus: tracking.readStatus,
      signalLabels: [],
      structureStatus: "unknown",
    };
  }

  const signalLabels = detectBacklogQualitySignals(tracking.texts.join("\n"));
  const signalLabelSet = new Set(signalLabels);
  const missingSignalLabels = BACKLOG_QUALITY_SIGNALS.filter(
    ({ label }) => !signalLabelSet.has(label),
  ).map(({ label }) => label);

  return {
    backlogFileCount: tracking.fileCount,
    hasBacklog: true,
    missingSignalLabels,
    readStatus: tracking.readStatus,
    signalLabels,
    structureStatus: missingSignalLabels.length === 0 ? "ai_executable" : "weak",
  };
};

const productClarityStatusFor = (input: {
  productDocCount: number;
  readStatus: RepoScanProductClarityReadStatus;
  signalLabels: readonly ProductSignalLabel[];
}): RepoScanProductClarityStatus => {
  if (input.productDocCount === 0) {
    return "missing";
  }

  if (input.readStatus !== "read") {
    return "unknown";
  }

  return input.signalLabels.length >= 5 ? "sufficient" : "weak";
};

const summarizeProductClarity = (input: {
  productDocCount: number;
  readStatus: RepoScanProductClarityReadStatus;
  signalLabels: Set<ProductSignalLabel>;
}): RepoScanProductClaritySummary => {
  const signalLabels = [...input.signalLabels].toSorted((left, right) => left.localeCompare(right));
  const missingSignalLabels =
    input.readStatus === "read"
      ? PRODUCT_SIGNAL_LABELS.filter((label) => !input.signalLabels.has(label))
      : [];

  return {
    clarityStatus: productClarityStatusFor({
      productDocCount: input.productDocCount,
      readStatus: input.readStatus,
      signalLabels,
    }),
    goalContextStatus: "not_provided",
    hasProductDocs: input.productDocCount > 0,
    missingSignalLabels,
    productDocCount: input.productDocCount,
    readStatus: input.readStatus,
    signalLabels,
  };
};

const packageManagerStatusFor = (input: {
  hasRootPackageManifest: boolean;
  jsLockfileCount: number;
}): RepoScanRepoHygienePackageManagerStatus => {
  if (input.jsLockfileCount > 1) {
    return "mixed";
  }

  if (input.jsLockfileCount === 1) {
    return "single";
  }

  return input.hasRootPackageManifest ? "manifest_without_lockfile" : "none";
};

const monorepoStructureStatusFor = (input: {
  monorepoSignalCount: number;
  workspaceConfigCount: number;
}): RepoScanRepoHygieneMonorepoStructureStatus => {
  if (input.monorepoSignalCount === 0) {
    return "single_project";
  }

  return input.workspaceConfigCount > 0 ? "configured" : "unclear";
};

const hygieneStatusFor = (
  issueLabels: readonly RepoScanRepoHygieneIssueLabel[],
): RepoScanRepoHygieneStatus => {
  if (issueLabels.length === 0) {
    return "healthy";
  }

  return issueLabels.includes("mixed_lockfiles") ||
    issueLabels.includes("unclear_monorepo_structure")
    ? "needs_attention"
    : "minor_gaps";
};

const summarizeRepoHygiene = (input: {
  contributionDocCount: number;
  hasRootGitignore: boolean;
  hasRootPackageManifest: boolean;
  issueTemplateCount: number;
  jsLockfileLabels: Set<string>;
  monorepoSignalCount: number;
  packageManagerLabels: Set<string>;
  workspaceConfigCount: number;
}): RepoScanRepoHygieneSummary => {
  const jsLockfileCount = input.jsLockfileLabels.size;
  const packageManagerStatus = packageManagerStatusFor({
    hasRootPackageManifest: input.hasRootPackageManifest,
    jsLockfileCount,
  });
  const monorepoStructureStatus = monorepoStructureStatusFor({
    monorepoSignalCount: input.monorepoSignalCount,
    workspaceConfigCount: input.workspaceConfigCount,
  });
  const issueLabelCandidates = new Set<RepoScanRepoHygieneIssueLabel>();

  if (packageManagerStatus === "mixed") {
    issueLabelCandidates.add("mixed_lockfiles");
  }
  if (monorepoStructureStatus === "unclear") {
    issueLabelCandidates.add("unclear_monorepo_structure");
  }
  if (packageManagerStatus === "manifest_without_lockfile") {
    issueLabelCandidates.add("missing_js_lockfile");
  }
  if (!input.hasRootGitignore) {
    issueLabelCandidates.add("missing_gitignore");
  }
  if (input.contributionDocCount === 0) {
    issueLabelCandidates.add("missing_contribution_docs");
  }
  if (input.issueTemplateCount === 0) {
    issueLabelCandidates.add("missing_issue_templates");
  }

  const issueLabels = REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS.filter((label) =>
    issueLabelCandidates.has(label),
  );

  return {
    contributionDocCount: input.contributionDocCount,
    hasContributionDocs: input.contributionDocCount > 0,
    hasRootGitignore: input.hasRootGitignore,
    hygieneStatus: hygieneStatusFor(issueLabels),
    issueLabels,
    issueTemplateCount: input.issueTemplateCount,
    jsLockfileCount,
    monorepoSignalCount: input.monorepoSignalCount,
    monorepoStructureStatus,
    packageManagerCount: input.packageManagerLabels.size,
    packageManagerStatus,
    workspaceConfigCount: input.workspaceConfigCount,
  };
};

const parseFileText = (value: unknown, maxFileReadBytes: number): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const size = parseOptionalSize(value.size);

  if (size === null || size > maxFileReadBytes) {
    return null;
  }

  if (value.encoding !== "base64" || typeof value.content !== "string") {
    return null;
  }

  const normalizedContent = value.content.replace(/\s+/gu, "");

  try {
    const buffer = Buffer.from(normalizedContent, "base64");

    if (buffer.byteLength > maxFileReadBytes) {
      return null;
    }

    return buffer.toString("utf8");
  } catch {
    return null;
  }
};

const readAllowlistedFile = async (input: {
  defaultBranch: string;
  installationId: number;
  maxFileReadBytes: number;
  owner: string;
  path: string;
  repo: string;
  request: GitHubAppRequestFunction;
}): Promise<string | null> => {
  const response = await runRequest(input.request, {
    installationId: input.installationId,
    method: "GET",
    operation: "getRepositoryFile",
    path: `/repos/${input.owner}/${input.repo}/contents/${encodeURIComponent(input.path)}`,
    query: { ref: input.defaultBranch },
  });

  return parseFileText(response, input.maxFileReadBytes);
};

const readPolicy = async (input: {
  defaultBranch: string;
  installationId: number;
  maxFileReadBytes: number;
  owner: string;
  repo: string;
  request: GitHubAppRequestFunction;
}): Promise<PolicyReadResult> => {
  const text = await readAllowlistedFile({
    ...input,
    path: POLICY_PATH,
  });

  if (text === null) {
    return { status: "unreadable" };
  }

  try {
    return {
      policy: RepoPolicySchema.parse(JSON.parse(text)),
      status: "parsed",
    };
  } catch {
    return { status: "invalid" };
  }
};

const treePathFor = (owner: string, repo: string, defaultBranch: string): string =>
  `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}`;

export const buildGitHubRepositoryInventory = async (
  input: GitHubRepositoryInventoryRequest,
): Promise<GitHubRepositoryInventory> => {
  if (typeof input.request !== "function") {
    throw new GitHubRepositoryInventoryError(
      "invalid_request_function",
      "GitHub repository inventory requires an injected request function.",
    );
  }

  const installationId = parsePositiveInteger(input.installationId, "invalid_installation_id");
  const maxTreeEntries =
    input.maxTreeEntries === undefined
      ? DEFAULT_MAX_TREE_ENTRIES
      : parsePositiveInteger(input.maxTreeEntries, "invalid_tree_limit");
  const maxFileReadBytes =
    input.maxFileReadBytes === undefined
      ? DEFAULT_MAX_FILE_READ_BYTES
      : parsePositiveInteger(input.maxFileReadBytes, "invalid_file_limit");
  const owner = parseRepositoryPart(input.owner);
  const repo = parseRepositoryPart(input.repo);
  const defaultBranch = parseRefName(input.defaultBranch);
  const treeResponse = await runRequest(input.request, {
    installationId,
    method: "GET",
    operation: "getRepositoryTree",
    path: treePathFor(owner, repo, defaultBranch),
    query: { recursive: "1" },
  });
  const tree = parseTreeResponse(treeResponse);
  const processedEntries = tree.entries.slice(0, maxTreeEntries);
  const skippedEntries = Math.max(0, tree.entries.length - processedEntries.length);
  const languageCounts = new Map<string, number>();
  const packageManagerLabels = new Set<string>();
  const jsLockfileLabels = new Set<string>();
  const ciProviderLabels = new Set<string>();
  const documentationCounts = new Map<string, number>();
  const readableEntries: ReadableFileEntry[] = [];
  const documentSummaries: RepoScanInventory["documentSummaries"] = [];
  const agentInstructionTracking: AgentInstructionTracking = {
    fileCount: 0,
    readStatus: "missing",
    texts: [],
  };
  const backlogTracking: BacklogTracking = {
    fileCount: 0,
    readStatus: "missing",
    texts: [],
  };
  const ciWorkflowTracking: CiWorkflowTracking = {
    fileCount: 0,
    texts: [],
  };
  const productDocPaths = new Set<string>();
  const productSignalLabels = new Set<ProductSignalLabel>();
  let totalFileCount = 0;
  let totalDirectoryCount = 0;
  let scannedFileCount = 0;
  let skippedBlobCount = 0;
  let skippedUnknownSizeProductDocCount = 0;
  let skippedOversizedProductDocCount = 0;
  let unreadableProductDocCount = 0;
  let readProductDocCount = 0;
  let contributionDocCount = 0;
  let hasPolicyFile = false;
  let hasRootGitignore = false;
  let hasRootPackageManifest = false;
  let hasTestDirectories = false;
  let issueTemplateCount = 0;
  let monorepoSignalCount = 0;
  let workspaceConfigCount = 0;

  for (const entry of tree.entries) {
    if (entry.type === "blob") {
      totalFileCount += 1;
    } else {
      totalDirectoryCount += 1;
    }
  }

  for (const entry of processedEntries) {
    hasTestDirectories = hasTestDirectories || hasTestDirectory(entry.path);

    if (entry.type !== "blob") {
      if (isTopLevelMonorepoDirectory(entry.path)) {
        monorepoSignalCount += 1;
      }

      continue;
    }

    scannedFileCount += 1;
    contributionDocCount += isContributionDocumentationPath(entry.path) ? 1 : 0;
    hasPolicyFile = hasPolicyFile || entry.path === POLICY_PATH;
    hasRootGitignore = hasRootGitignore || entry.path === ".gitignore";
    hasRootPackageManifest = hasRootPackageManifest || entry.path === "package.json";
    issueTemplateCount += isIssueTemplatePath(entry.path) ? 1 : 0;
    monorepoSignalCount += isNestedWorkspacePackageManifest(entry.path) ? 1 : 0;
    workspaceConfigCount += isWorkspaceConfigPath(entry.path) ? 1 : 0;

    if (isRootAgentInstructionPath(entry.path)) {
      agentInstructionTracking.fileCount += 1;
    }

    if (isRootBacklogPath(entry.path)) {
      backlogTracking.fileCount += 1;
    }

    const languageName = getLanguageName(entry.path);

    if (languageName !== null) {
      languageCounts.set(languageName, (languageCounts.get(languageName) ?? 0) + 1);
    }

    addLabelForPatterns(packageManagerLabels, entry.path, PACKAGE_MANAGER_PATTERNS);
    const jsLockfileLabel = jsLockfileLabelForPath(entry.path);
    if (jsLockfileLabel !== undefined) {
      jsLockfileLabels.add(jsLockfileLabel);
    }
    addLabelForPatterns(ciProviderLabels, entry.path, CI_PATTERNS);
    if (matchesPattern(entry.path, CI_PATTERNS)) {
      ciWorkflowTracking.fileCount += 1;
    }
    addDocumentationSummary(documentationCounts, entry.path);

    const fileReadDecision = classifyRepoScanFileRead({
      maxFileReadBytes,
      path: entry.path,
      size: entry.size,
    });
    const isProductDoc =
      isProductDocumentationPath(entry.path) &&
      isBoundedProductDocumentationDecision(fileReadDecision);

    if (isProductDoc) {
      productDocPaths.add(entry.path);
    }

    if (fileReadDecision.action === "read") {
      readableEntries.push({
        path: entry.path,
        reason: fileReadDecision.reason,
        size: entry.size ?? 0,
      });
    } else if (fileReadDecision.reason === "oversized") {
      skippedBlobCount += 1;

      if (isRootAgentInstructionPath(entry.path)) {
        agentInstructionTracking.readStatus = nextAgentReadStatus(
          agentInstructionTracking.readStatus,
          "oversized",
        );
      }
      if (isRootBacklogPath(entry.path)) {
        backlogTracking.readStatus = nextBacklogReadStatus(backlogTracking.readStatus, "oversized");
      }
      if (isProductDoc) {
        skippedOversizedProductDocCount += 1;
      }
    } else if (fileReadDecision.reason === "unknown_size") {
      if (isRootAgentInstructionPath(entry.path)) {
        agentInstructionTracking.readStatus = nextAgentReadStatus(
          agentInstructionTracking.readStatus,
          "unknown_size",
        );
      }
      if (isRootBacklogPath(entry.path)) {
        backlogTracking.readStatus = nextBacklogReadStatus(
          backlogTracking.readStatus,
          "unknown_size",
        );
      }
      if (isProductDoc) {
        skippedUnknownSizeProductDocCount += 1;
      }
    }
  }

  const skippedProcessedBlobCount =
    skippedEntries > 0
      ? tree.entries.slice(maxTreeEntries).filter((entry) => entry.type === "blob").length
      : 0;
  const fileReadSummary: GitHubRepositoryInventoryFileReadSummary = {
    attemptedFileCount: 0,
    readFileCount: 0,
    skippedOversizedFileCount: skippedBlobCount,
    unreadableFileCount: 0,
  };
  let policyReadStatus: GitHubRepositoryInventoryPolicyReadStatus = hasPolicyFile
    ? "unreadable"
    : "missing";
  let policy: RepoPolicy | undefined;

  for (const readableEntry of readableEntries.toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const { path } = readableEntry;

    fileReadSummary.attemptedFileCount += 1;

    if (path === POLICY_PATH) {
      const policyRead = await readPolicy({
        defaultBranch,
        installationId,
        maxFileReadBytes,
        owner,
        repo,
        request: input.request,
      });

      policyReadStatus = policyRead.status;
      policy = policyRead.policy;

      if (policyRead.status === "parsed") {
        fileReadSummary.readFileCount += 1;
      } else {
        fileReadSummary.unreadableFileCount += 1;
      }

      continue;
    }

    try {
      const fileText = await readAllowlistedFile({
        defaultBranch,
        installationId,
        maxFileReadBytes,
        owner,
        path,
        repo,
        request: input.request,
      });

      if (fileText === null) {
        fileReadSummary.unreadableFileCount += 1;

        if (isRootAgentInstructionPath(path)) {
          agentInstructionTracking.readStatus = nextAgentReadStatus(
            agentInstructionTracking.readStatus,
            "unreadable",
          );
        }
        if (isRootBacklogPath(path)) {
          backlogTracking.readStatus = nextBacklogReadStatus(
            backlogTracking.readStatus,
            "unreadable",
          );
        }
        if (productDocPaths.has(path)) {
          unreadableProductDocCount += 1;
        }
      } else {
        fileReadSummary.readFileCount += 1;
        try {
          const documentSummary = summarizeAllowlistedDocument({
            allowReason: readableEntry.reason,
            maxFileReadBytes,
            path,
            size: readableEntry.size,
            text: fileText,
          });

          if (documentSummary !== null) {
            documentSummaries.push(documentSummary);
          }
        } catch {
          // Summary failures stay local; inventory still returns metadata-only scan results.
        }

        if (isRootAgentInstructionPath(path)) {
          agentInstructionTracking.readStatus = nextAgentReadStatus(
            agentInstructionTracking.readStatus,
            "read",
          );
          agentInstructionTracking.texts.push(fileText);
        }
        if (isRootBacklogPath(path)) {
          backlogTracking.readStatus = nextBacklogReadStatus(backlogTracking.readStatus, "read");
          backlogTracking.texts.push(fileText);
        }
        if (matchesPattern(path, CI_PATTERNS)) {
          ciWorkflowTracking.texts.push(fileText);
        }
        if (productDocPaths.has(path)) {
          readProductDocCount += 1;
          for (const signalLabel of detectProductSignalLabels(fileText)) {
            productSignalLabels.add(signalLabel);
          }
        }
      }
    } catch {
      fileReadSummary.unreadableFileCount += 1;

      if (isRootAgentInstructionPath(path)) {
        agentInstructionTracking.readStatus = nextAgentReadStatus(
          agentInstructionTracking.readStatus,
          "unreadable",
        );
      }
      if (isRootBacklogPath(path)) {
        backlogTracking.readStatus = nextBacklogReadStatus(
          backlogTracking.readStatus,
          "unreadable",
        );
      }
      if (productDocPaths.has(path)) {
        unreadableProductDocCount += 1;
      }
    }
  }

  const productReadStatus: RepoScanProductClarityReadStatus =
    productDocPaths.size === 0
      ? "missing"
      : readProductDocCount > 0
        ? "read"
        : unreadableProductDocCount > 0
          ? "unreadable"
          : skippedOversizedProductDocCount > 0
            ? "oversized"
            : skippedUnknownSizeProductDocCount > 0
              ? "unknown_size"
              : "unreadable";

  if (
    hasPolicyFile &&
    skippedBlobCount > 0 &&
    !readableEntries.some((entry) => entry.path === POLICY_PATH)
  ) {
    const policyEntry = processedEntries.find((entry) => entry.path === POLICY_PATH);

    if (
      policyEntry?.type === "blob" &&
      policyEntry.size !== null &&
      policyEntry.size > maxFileReadBytes
    ) {
      policyReadStatus = "oversized";
    }
  }

  const validationPostureSummary = summarizeValidationPosture(policy, hasPolicyFile);
  const ciProviderLabelList = toSortedLabels(ciProviderLabels);
  const repoScanInventory = RepoScanInventorySchema.parse({
    agentInstructionSummary: summarizeAgentInstructions(agentInstructionTracking),
    backlogQualitySummary: summarizeBacklogQuality(backlogTracking),
    backlogSummary: summarizeBacklog(backlogTracking),
    ciPostureSummary: summarizeCiPosture({
      providerLabels: ciProviderLabelList,
      tracking: ciWorkflowTracking,
      validationPostureSummary,
    }),
    ciProviderLabels: ciProviderLabelList,
    documentationSummaries: toDocumentationSummaries(documentationCounts),
    documentSummaries,
    languageSummaries: toLanguageSummaries(languageCounts),
    omittedFileCount: skippedProcessedBlobCount,
    packageManagerLabels: toSortedLabels(packageManagerLabels),
    policySummary: summarizePolicy(policy, hasPolicyFile),
    validationPostureSummary,
    productClaritySummary: summarizeProductClarity({
      productDocCount: productDocPaths.size,
      readStatus: productReadStatus,
      signalLabels: productSignalLabels,
    }),
    repoHygieneSummary: summarizeRepoHygiene({
      contributionDocCount,
      hasRootGitignore,
      hasRootPackageManifest,
      issueTemplateCount,
      jsLockfileLabels,
      monorepoSignalCount,
      packageManagerLabels,
      workspaceConfigCount,
    }),
    scannedFileCount,
    totalDirectoryCount,
    totalFileCount,
  });

  return {
    allowlistedFileReadSummary: fileReadSummary,
    policyReadStatus,
    repository: {
      defaultBranch,
      name: repo,
      owner,
    },
    repoScanInventory,
    treeSummary: {
      hasTestDirectories,
      processedEntryCount: processedEntries.length,
      skippedEntryCount: skippedEntries,
      truncated: tree.truncated,
    },
  };
};
