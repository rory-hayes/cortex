import { spawn, type ChildProcessByStdio } from "node:child_process";
import { isAbsolute, parse } from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  CONTRACT_VERSION,
  PrArtifactSchema,
  RiskFindingSchema,
  type PrArtifact,
  type RiskFinding,
} from "@control-plane/shared";

const MAX_METADATA_LENGTH = 128;
const MAX_REPOSITORY_PART_LENGTH = 100;
const MAX_BRANCH_NAME_LENGTH = 200;
const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 20_000;
const MAX_CHANGED_PATH_LENGTH = 512;
const MAX_RISK_FINDING_ID_LENGTH = 128;
const MAX_RISK_FINDING_MESSAGE_LENGTH = 512;
const DEFAULT_CAPTURE_LIMIT = 4_096;
const OUTPUT_TRUNCATED_MARKER = "[truncated]";
const MOCK_PR_HOST = "github.example.test";
const MOCK_CREATED_AT = "2026-05-10T00:00:00.000Z";

export type GhPrErrorCode =
  | "invalid_worktree_path"
  | "invalid_metadata"
  | "invalid_repository"
  | "invalid_branch_name"
  | "invalid_base_branch"
  | "invalid_title"
  | "invalid_body"
  | "missing_changed_files"
  | "invalid_changed_file_path"
  | "invalid_risk_finding"
  | "gh_create_failed"
  | "gh_view_failed"
  | "invalid_pr_output";

export type GhPrErrorMetadata = {
  ghExitCode?: number;
};

export class GhPrError extends Error {
  readonly code: GhPrErrorCode;
  readonly metadata: GhPrErrorMetadata;

  constructor(code: GhPrErrorCode, message: string, metadata: GhPrErrorMetadata = {}) {
    super(message);
    this.name = "GhPrError";
    this.code = code;
    this.metadata = metadata;
  }
}

export type GhPrCommand = {
  command: "gh";
  args: string[];
  cwd: string;
  stdin: string;
};

export type GhPrCommandResult = {
  exitCode: number;
  stdoutSummary: string;
  stderrSummary: string;
};

export type GhPrCommandRunner = (command: GhPrCommand) => Promise<GhPrCommandResult>;

export type CreatePullRequestWithGhOptions = {
  worktreePath: string;
  runId: string;
  repository: {
    owner: string;
    name: string;
  };
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  changedFilePaths: string[];
  riskFindings: RiskFinding[];
  createdAt?: string;
  commandRunner?: GhPrCommandRunner;
};

export type GetPullRequestWithGhOptions = {
  worktreePath: string;
  runId: string;
  repository: {
    owner: string;
    name: string;
  };
  branchName: string;
  changedFilePaths: string[];
  riskFindings: RiskFinding[];
  createdAt?: string;
  commandRunner?: GhPrCommandRunner;
};

export type GhPrAdapter = {
  createPullRequest(options: CreatePullRequestWithGhOptions): Promise<PrArtifact>;
  getPullRequest?(options: GetPullRequestWithGhOptions): Promise<PrArtifact>;
};

export type MockGhPrAdapter = GhPrAdapter & {
  readonly calls: readonly PrArtifact[];
};

type ParsedGhPrOptions = {
  worktreePath: string;
  runId: string;
  repository: {
    owner: string;
    name: string;
  };
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  changedFilePaths: string[];
  riskFindings: RiskFinding[];
  createdAt: string;
};

type ParsedPrOutput = {
  prNumber: number;
  prUrl: string;
  prTitle?: string;
  prStatus?: PrArtifact["prStatus"];
};

export const createPullRequestWithGh = async (
  options: CreatePullRequestWithGhOptions,
): Promise<PrArtifact> => {
  const parsedOptions = parseGhPrOptions(options);
  const commandRunner = options.commandRunner ?? defaultGhPrCommandRunner;

  const result = await runGhCommand(commandRunner, {
    command: "gh",
    args: [
      "pr",
      "create",
      "--draft",
      "--base",
      parsedOptions.baseBranch,
      "--head",
      parsedOptions.branchName,
      "--title",
      parsedOptions.title,
      "--body-file",
      "-",
    ],
    cwd: parsedOptions.worktreePath,
    stdin: parsedOptions.body,
  });

  if (result.exitCode !== 0) {
    throw new GhPrError("gh_create_failed", "GitHub CLI failed to create a pull request.", {
      ghExitCode: result.exitCode,
    });
  }

  const prOutput = parsePrOutput(result.stdoutSummary, parsedOptions.repository);

  return toPrArtifact(parsedOptions, prOutput);
};

export const getPullRequestWithGh = async (
  options: GetPullRequestWithGhOptions,
): Promise<PrArtifact> => {
  const parsedOptions = parseGhPrOptions({
    ...options,
    baseBranch: options.branchName,
    body: "Existing pull request metadata lookup.",
    title: "Existing pull request",
  });
  const commandRunner = options.commandRunner ?? defaultGhPrCommandRunner;

  const result = await runGhCommand(commandRunner, {
    command: "gh",
    args: ["pr", "view", parsedOptions.branchName, "--json", "number,url,title,state,isDraft"],
    cwd: parsedOptions.worktreePath,
    stdin: "",
  });

  if (result.exitCode !== 0) {
    throw new GhPrError("gh_view_failed", "GitHub CLI failed to load pull request metadata.", {
      ghExitCode: result.exitCode,
    });
  }

  const prOutput = parsePrViewOutput(result.stdoutSummary, parsedOptions.repository);

  return toPrArtifact(parsedOptions, prOutput);
};

export const createMockGhPrAdapter = (): MockGhPrAdapter => {
  const calls: PrArtifact[] = [];

  return {
    get calls(): readonly PrArtifact[] {
      return [...calls];
    },
    async createPullRequest(options: CreatePullRequestWithGhOptions): Promise<PrArtifact> {
      const parsedOptions = parseGhPrOptions({
        ...options,
        createdAt: options.createdAt ?? MOCK_CREATED_AT,
      });
      const artifact = toPrArtifact(parsedOptions, {
        prNumber: 1,
        prUrl: `https://${MOCK_PR_HOST}/${parsedOptions.repository.owner}/${parsedOptions.repository.name}/pull/1`,
      });

      calls.push(artifact);

      return artifact;
    },
    async getPullRequest(options: GetPullRequestWithGhOptions): Promise<PrArtifact> {
      const parsedOptions = parseGhPrOptions({
        ...options,
        baseBranch: options.branchName,
        body: "Existing pull request metadata lookup.",
        createdAt: options.createdAt ?? MOCK_CREATED_AT,
        title: "Existing pull request",
      });
      const artifact = toPrArtifact(parsedOptions, {
        prNumber: 1,
        prStatus: "draft",
        prTitle: "Existing pull request",
        prUrl: `https://${MOCK_PR_HOST}/${parsedOptions.repository.owner}/${parsedOptions.repository.name}/pull/1`,
      });

      calls.push(artifact);

      return artifact;
    },
  };
};

const parseGhPrOptions = (options: CreatePullRequestWithGhOptions): ParsedGhPrOptions => {
  const worktreePath = parseWorktreePath(options.worktreePath);
  const runId = parseMetadataValue(options.runId);
  const repository = parseRepository(options.repository);
  const branchName = parseBranchName(options.branchName, "invalid_branch_name");
  const baseBranch = parseBranchName(options.baseBranch, "invalid_base_branch");
  const title = parseTitle(options.title);
  const body = parseBody(options.body);
  const changedFilePaths = parseChangedFilePaths(options.changedFilePaths);
  const riskFindings = parseRiskFindings(options.riskFindings);
  const createdAt = parseCreatedAt(options.createdAt);

  return {
    worktreePath,
    runId,
    repository,
    branchName,
    baseBranch,
    title,
    body,
    changedFilePaths,
    riskFindings,
    createdAt,
  };
};

const parseWorktreePath = (worktreePath: string): string => {
  if (
    typeof worktreePath !== "string" ||
    worktreePath.trim().length === 0 ||
    worktreePath.trim() !== worktreePath ||
    !isAbsolute(worktreePath) ||
    worktreePath === parse(worktreePath).root ||
    hasControlCharacter(worktreePath)
  ) {
    throw new GhPrError("invalid_worktree_path", "Worktree path must be a safe absolute path.");
  }

  return worktreePath;
};

const parseMetadataValue = (value: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksSecretLike(value)
  ) {
    throw new GhPrError(
      "invalid_metadata",
      "PR metadata values must be short, single-line, and non-secret.",
    );
  }

  return value;
};

const parseRepository = (repository: CreatePullRequestWithGhOptions["repository"]) => {
  if (typeof repository !== "object" || repository === null) {
    throw new GhPrError("invalid_repository", "Repository metadata must be safe.");
  }

  return {
    owner: parseRepositoryPart(repository.owner),
    name: parseRepositoryPart(repository.name),
  };
};

const parseRepositoryPart = (value: string): string => {
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
    looksSecretLike(value)
  ) {
    throw new GhPrError("invalid_repository", "Repository metadata must be safe.");
  }

  return value;
};

const parseBranchName = (branchName: string, code: GhPrErrorCode): string => {
  if (!isSafeBranchName(branchName) || looksSecretLike(branchName)) {
    throw new GhPrError(code, "Branch names must be safe git branch refs.");
  }

  return branchName;
};

const parseTitle = (title: string): string => {
  if (
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > MAX_TITLE_LENGTH ||
    title.trim() !== title ||
    hasControlCharacter(title) ||
    looksUnsafeForPrText(title)
  ) {
    throw new GhPrError("invalid_title", "Pull request title must be safe metadata.");
  }

  return title;
};

const parseBody = (body: string): string => {
  if (
    typeof body !== "string" ||
    body.trim().length === 0 ||
    body.length > MAX_BODY_LENGTH ||
    hasDisallowedBodyControlCharacter(body) ||
    looksUnsafeForPrText(body)
  ) {
    throw new GhPrError("invalid_body", "Pull request body must be safe metadata.");
  }

  return body;
};

const parseChangedFilePaths = (changedFilePaths: string[]): string[] => {
  if (!Array.isArray(changedFilePaths)) {
    throw new GhPrError("missing_changed_files", "Changed file paths are required.");
  }

  const uniquePaths = [...new Set(changedFilePaths)];

  if (uniquePaths.length === 0) {
    throw new GhPrError("missing_changed_files", "Changed file paths are required.");
  }

  for (const changedFilePath of uniquePaths) {
    if (!isSafeChangedFilePath(changedFilePath) || isRealEnvPath(changedFilePath)) {
      throw new GhPrError(
        "invalid_changed_file_path",
        "Changed file paths must be safe repo-relative paths.",
      );
    }
  }

  return uniquePaths.toSorted((left, right) => left.localeCompare(right));
};

const parseRiskFindings = (riskFindings: RiskFinding[]): RiskFinding[] => {
  if (!Array.isArray(riskFindings)) {
    throw new GhPrError("invalid_risk_finding", "Risk findings must be schema-valid.");
  }

  const canonicalFindings: RiskFinding[] = [];
  const seenFindings = new Set<string>();

  for (const finding of riskFindings) {
    const result = RiskFindingSchema.safeParse(finding);

    if (!result.success) {
      throw new GhPrError("invalid_risk_finding", "Risk findings must be schema-valid.");
    }

    const canonicalFinding = {
      id: parseRiskFindingText(result.data.id, MAX_RISK_FINDING_ID_LENGTH),
      severity: result.data.severity,
      category: result.data.category,
      message: parseRiskFindingText(result.data.message, MAX_RISK_FINDING_MESSAGE_LENGTH),
      paths: parseRiskFindingPaths(result.data.paths),
    };
    const key = JSON.stringify(canonicalFinding);

    if (!seenFindings.has(key)) {
      seenFindings.add(key);
      canonicalFindings.push(canonicalFinding);
    }
  }

  return canonicalFindings.toSorted((left, right) => {
    const severityOrder = riskSeverityOrder(left.severity) - riskSeverityOrder(right.severity);

    if (severityOrder !== 0) {
      return severityOrder;
    }

    const categoryOrder = left.category.localeCompare(right.category);

    if (categoryOrder !== 0) {
      return categoryOrder;
    }

    return left.id.localeCompare(right.id);
  });
};

const parseRiskFindingText = (value: string, maxLength: number): string => {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeForRiskFindingText(value)
  ) {
    throw new GhPrError("invalid_risk_finding", "Risk findings must be safe metadata.");
  }

  return value;
};

const parseRiskFindingPaths = (paths: string[]): string[] => {
  const uniquePaths = [...new Set(paths)];

  for (const path of uniquePaths) {
    if (!isSafeChangedFilePath(path) || isRealEnvPath(path)) {
      throw new GhPrError("invalid_risk_finding", "Risk findings must be schema-valid.");
    }
  }

  return uniquePaths.toSorted((left, right) => left.localeCompare(right));
};

const parseCreatedAt = (createdAt: string | undefined): string => {
  if (createdAt === undefined) {
    return new Date().toISOString();
  }

  if (
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    createdAt.trim() !== createdAt ||
    hasControlCharacter(createdAt) ||
    looksSecretLike(createdAt) ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    throw new GhPrError("invalid_metadata", "PR metadata values must be safe.");
  }

  return createdAt;
};

const toPrArtifact = (parsedOptions: ParsedGhPrOptions, prOutput: ParsedPrOutput): PrArtifact => {
  const artifact = {
    contractVersion: CONTRACT_VERSION,
    id: `pr:${parsedOptions.runId}:${prOutput.prNumber}`,
    runId: parsedOptions.runId,
    repository: parsedOptions.repository,
    branchName: parsedOptions.branchName,
    prNumber: prOutput.prNumber,
    prUrl: prOutput.prUrl,
    prTitle: prOutput.prTitle ?? parsedOptions.title,
    prStatus: prOutput.prStatus ?? "draft",
    changedFilePaths: parsedOptions.changedFilePaths,
    riskFindings: parsedOptions.riskFindings,
    createdAt: parsedOptions.createdAt,
  };
  const result = PrArtifactSchema.safeParse(artifact);

  if (!result.success) {
    throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
  }

  return result.data;
};

const parsePrOutput = (
  stdoutSummary: string,
  repository: ParsedGhPrOptions["repository"],
): ParsedPrOutput => {
  if (typeof stdoutSummary !== "string" || stdoutSummary.length === 0) {
    throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
  }

  const urlMatches = stdoutSummary.match(
    /\bhttps:\/\/[^\s<>"']+\/pull\/[1-9][0-9]*\/?(?=$|[\s<>"'])/gu,
  );

  if (urlMatches === null || urlMatches.length === 0) {
    throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
  }

  for (const candidate of urlMatches) {
    const parsedUrl = parsePullRequestUrl(candidate, repository);

    if (parsedUrl !== null) {
      return parsedUrl;
    }
  }

  throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
};

const parsePrViewOutput = (
  stdoutSummary: string,
  repository: ParsedGhPrOptions["repository"],
): ParsedPrOutput => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdoutSummary);
  } catch {
    throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
  }

  const record = parsed as {
    isDraft?: unknown;
    number?: unknown;
    state?: unknown;
    title?: unknown;
    url?: unknown;
  };
  const prUrl = typeof record.url === "string" ? record.url : "";
  const parsedUrl = parsePullRequestUrl(prUrl, repository);
  const prTitle = typeof record.title === "string" ? parseTitle(record.title) : "";
  const prStatus = parsePrViewStatus(record.state, record.isDraft);

  if (
    parsedUrl === null ||
    typeof record.number !== "number" ||
    !Number.isSafeInteger(record.number) ||
    record.number !== parsedUrl.prNumber ||
    prTitle.length === 0
  ) {
    throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
  }

  return {
    prNumber: parsedUrl.prNumber,
    prUrl: parsedUrl.prUrl,
    prTitle,
    prStatus,
  };
};

const parsePrViewStatus = (state: unknown, isDraft: unknown): PrArtifact["prStatus"] => {
  if (isDraft === true) {
    return "draft";
  }

  if (state === "OPEN") {
    return "open";
  }

  if (state === "CLOSED") {
    return "closed";
  }

  if (state === "MERGED") {
    return "merged";
  }

  throw new GhPrError("invalid_pr_output", "GitHub CLI returned invalid pull request data.");
};

const parsePullRequestUrl = (
  candidate: string,
  repository: ParsedGhPrOptions["repository"],
): ParsedPrOutput | null => {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    hasControlCharacter(candidate) ||
    looksSecretLike(candidate) ||
    pathParts.length !== 4 ||
    pathParts[0] !== repository.owner ||
    pathParts[1] !== repository.name ||
    pathParts[2] !== "pull" ||
    !/^[1-9][0-9]*$/u.test(pathParts[3] ?? "")
  ) {
    return null;
  }

  const prNumber = Number.parseInt(pathParts[3] ?? "", 10);

  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  return {
    prNumber,
    prUrl: `${url.origin}/${repository.owner}/${repository.name}/pull/${prNumber}`,
  };
};

const runGhCommand = async (
  commandRunner: GhPrCommandRunner,
  command: GhPrCommand,
): Promise<GhPrCommandResult> => {
  try {
    const result = await commandRunner(command);

    if (!Number.isInteger(result.exitCode)) {
      return {
        exitCode: 1,
        stdoutSummary: "",
        stderrSummary: "",
      };
    }

    return {
      exitCode: result.exitCode,
      stdoutSummary: typeof result.stdoutSummary === "string" ? result.stdoutSummary : "",
      stderrSummary: typeof result.stderrSummary === "string" ? result.stderrSummary : "",
    };
  } catch {
    return {
      exitCode: 1,
      stdoutSummary: "",
      stderrSummary: "",
    };
  }
};

const defaultGhPrCommandRunner: GhPrCommandRunner = async (
  command: GhPrCommand,
): Promise<GhPrCommandResult> =>
  new Promise((resolve) => {
    let settled = false;
    let child: ChildProcessByStdio<Writable, Readable, Readable>;

    const settle = (result: GhPrCommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    try {
      child = spawn(command.command, command.args, {
        cwd: command.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      settle(formatSpawnFailure(error));
      return;
    }

    let stdoutSummary = "";
    let stderrSummary = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutSummary = appendBounded(stdoutSummary, String(chunk), DEFAULT_CAPTURE_LIMIT);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrSummary = appendBounded(stderrSummary, String(chunk), DEFAULT_CAPTURE_LIMIT);
    });

    const settleStdinFailure = (): void => {
      child.kill("SIGTERM");
      settle({
        exitCode: 1,
        stdoutSummary: "",
        stderrSummary: "",
      });
    };

    child.stdin?.on("error", settleStdinFailure);

    child.on("error", (error) => {
      settle(formatSpawnFailure(error));
    });

    child.on("close", (exitCode) => {
      settle({
        exitCode: exitCode ?? 1,
        stdoutSummary,
        stderrSummary,
      });
    });

    try {
      child.stdin?.write(command.stdin);
      child.stdin?.end();
    } catch {
      settleStdinFailure();
    }
  });

const formatSpawnFailure = (error: unknown): GhPrCommandResult => ({
  exitCode: getErrorCode(error) === "ENOENT" ? 127 : 1,
  stdoutSummary: "",
  stderrSummary: "",
});

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;

  return typeof code === "string" ? code : undefined;
};

const appendBounded = (current: string, addition: string, limit: number): string => {
  if (current.includes(OUTPUT_TRUNCATED_MARKER)) {
    return current;
  }

  if (current.length >= limit) {
    return `${current}${OUTPUT_TRUNCATED_MARKER}`;
  }

  const next = `${current}${addition}`;

  if (next.length <= limit) {
    return next;
  }

  return `${next.slice(0, limit)}${OUTPUT_TRUNCATED_MARKER}`;
};

const isSafeBranchName = (branchName: string): boolean => {
  if (
    typeof branchName !== "string" ||
    branchName.length === 0 ||
    branchName.length > MAX_BRANCH_NAME_LENGTH ||
    branchName.trim() !== branchName ||
    branchName.startsWith("-") ||
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    branchName.endsWith(".") ||
    branchName.endsWith(".lock") ||
    branchName.includes("\\") ||
    branchName.includes("..") ||
    branchName.includes("@{") ||
    branchName.includes(":") ||
    branchName.includes("~") ||
    branchName.includes("^") ||
    branchName.includes("?") ||
    branchName.includes("*") ||
    branchName.includes("[") ||
    hasControlCharacter(branchName) ||
    /\s/u.test(branchName)
  ) {
    return false;
  }

  const segments = branchName.split("/");

  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith(".") &&
      !segment.endsWith(".lock"),
  );
};

const isSafeChangedFilePath = (changedFilePath: string): boolean => {
  if (
    typeof changedFilePath !== "string" ||
    changedFilePath.length === 0 ||
    changedFilePath.length > MAX_CHANGED_PATH_LENGTH ||
    changedFilePath.trim() !== changedFilePath ||
    hasControlCharacter(changedFilePath) ||
    hasUnsafeChangedPathText(changedFilePath) ||
    changedFilePath.startsWith("/") ||
    changedFilePath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(changedFilePath) ||
    changedFilePath.includes("\\")
  ) {
    return false;
  }

  const segments = changedFilePath.split("/");

  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const isRealEnvPath = (changedFilePath: string): boolean => {
  const basename = changedFilePath.split("/").at(-1);

  if (basename === undefined || basename === ".env.example") {
    return false;
  }

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "local.env" ||
    basename.endsWith(".local.env")
  );
};

const riskSeverityOrder = (severity: RiskFinding["severity"]): number =>
  severity === "blocked" ? 0 : 1;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const hasDisallowedBodyControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint !== undefined &&
      (codePoint === 0 || (codePoint < 32 && ![9, 10, 13].includes(codePoint)) || codePoint === 127)
    ) {
      return true;
    }
  }

  return false;
};

const looksUnsafeForPrText = (value: string): boolean =>
  looksSecretLike(value) || SOURCE_LIKE_PR_TEXT_PATTERNS.some((pattern) => pattern.test(value));

const looksUnsafeForRiskFindingText = (value: string): boolean =>
  looksUnsafeForPrText(value) ||
  /\b(?:const|let|var|function|class|import|export)\b[\s\S]{0,120}[;{}=()]/u.test(value);

const hasUnsafeChangedPathText = (value: string): boolean =>
  looksSecretLike(value) ||
  /\[REDACTED_(?:SECRET|PRIVATE_KEY|CREDENTIAL_URL)\]/iu.test(value) ||
  /(?:^|[/_. -])(?:api[-_]?key|token|secret|secrets|password|passwd|private[-_]?key)(?:$|[/_. -])/iu.test(
    value,
  ) ||
  /(?:^|[/_. -])(?:diff|patch|stdoutSummary|stderrSummary)(?:$|[/_. -])/iu.test(value) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/u.test(value) ||
  /(?:=>|[{};])/u.test(value);

const looksSecretLike = (value: string): boolean =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/iu.test(value) ||
  /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]/iu.test(
    value,
  ) ||
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(value) ||
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\blin_api_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value) ||
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u.test(value) ||
  /\bya29\.[A-Za-z0-9_-]{20,}\b/u.test(value) ||
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/u.test(value) ||
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu.test(value);

const SOURCE_LIKE_PR_TEXT_PATTERNS = [
  /\bdiff --git\b/u,
  /^@@\s/mu,
  /^---\s+a\//mu,
  /^\+\+\+\s+b\//mu,
  /^\*\*\* Begin Patch\b/mu,
  /^```/mu,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,160}[;{}=()]/u,
  /\b(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,120}[;{}=()]/u,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/u,
  /(^|\n)\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)\n]*\)\s*;?\s*(?=\n|$)/u,
  /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)\n]*\)/u,
];
