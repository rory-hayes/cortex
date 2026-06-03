const MAX_REPOSITORY_PART_LENGTH = 100;
const MAX_METADATA_TEXT_LENGTH = 256;
const MAX_URL_LENGTH = 512;
const MAX_PERMISSION_KEY_LENGTH = 80;
const MAX_PERMISSION_VALUE_LENGTH = 40;
const MAX_BRANCH_REF_LENGTH = 256;
const MAX_SETUP_FILE_PATH_LENGTH = 240;
const MAX_SETUP_FILE_CONTENT_LENGTH = 64_000;
const MAX_PULL_REQUEST_BODY_LENGTH = 8_000;
const MAX_ISSUE_BODY_LENGTH = 8_000;
const APPROVED_SETUP_PR_FILE_PATHS = new Set([
  ".aicp/policy.json",
  ".github/workflows/cortex-validation.yml",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "BACKLOG.md",
  "CONTRIBUTING.md",
  "PRODUCT_SPEC.md",
  "docs/CORTEX_INTEGRATIONS.md",
]);

export type GitHubAppOperation =
  | "createBranchReference"
  | "createGitBlob"
  | "createGitCommit"
  | "createGitTree"
  | "createIssue"
  | "createPullRequest"
  | "getBranchReference"
  | "getGitCommit"
  | "getInstallation"
  | "listInstallationRepositories"
  | "getRepositoryFile"
  | "getRepositoryTree"
  | "getPullRequest"
  | "getPullRequestCheckSummary"
  | "getPullRequestReviewSummary";

export type GitHubAppRequest = {
  body?: Record<string, unknown>;
  method: "GET" | "POST";
  operation: GitHubAppOperation;
  path: string;
  installationId?: number;
  query?: Record<string, number | string | boolean>;
};

export type GitHubAppRequestFunction = (request: GitHubAppRequest) => Promise<unknown>;

export type CreateGitHubAppClientOptions = {
  request: GitHubAppRequestFunction;
};

export type GitHubInstallationMetadata = {
  id: number;
  account: GitHubAccountMetadata;
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
  suspendedAt: string | null;
  htmlUrl?: string;
};

export type GitHubAccountMetadata = {
  id: number;
  login: string;
  type: string;
  htmlUrl?: string;
};

export type GitHubRepositoryMetadata = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
  visibility?: "public" | "private" | "internal";
};

export type GitHubPullRequestMetadata = {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  htmlUrl: string;
  author?: GitHubAccountMetadata;
  repository: GitHubRepositoryMetadata;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
};

export type GitHubIssueMetadata = {
  createdAt?: string;
  htmlUrl: string;
  id: number;
  number: number;
  state: "open" | "closed";
  title: string;
  updatedAt?: string;
};

export type GitHubPullRequestReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending"
  | "unknown";

export type GitHubPullRequestReviewSummary = {
  states: Record<GitHubPullRequestReviewState, number>;
  totalCount: number;
  urls: string[];
};

export type GitHubCheckRunStatus =
  | "completed"
  | "in_progress"
  | "pending"
  | "queued"
  | "requested"
  | "unknown"
  | "waiting";

export type GitHubCheckRunConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "startup_failure"
  | "success"
  | "timed_out"
  | "unknown";

export type GitHubPullRequestCheckSummary = {
  conclusionCounts: Record<GitHubCheckRunConclusion, number>;
  ref: string;
  statusCounts: Record<GitHubCheckRunStatus, number>;
  totalCount: number;
  urls: string[];
};

export type GetGitHubInstallationOptions = {
  installationId: number;
};

export type ListGitHubInstallationRepositoriesOptions = {
  installationId: number;
  page?: number;
  perPage?: number;
};

export type GetGitHubPullRequestOptions = {
  installationId: number;
  owner: string;
  pullNumber: number;
  repo: string;
};

export type GetGitHubPullRequestReviewSummaryOptions = GetGitHubPullRequestOptions;

export type GetGitHubPullRequestCheckSummaryOptions = {
  installationId: number;
  owner: string;
  ref: string;
  repo: string;
};

export type CreateGitHubIssueOptions = {
  body: string;
  installationId: number;
  owner: string;
  repo: string;
  title: string;
};

export type GitHubSetupPullRequestFile = {
  content: string;
  path: string;
};

export type CreateGitHubSetupPullRequestOptions = {
  baseBranch: string;
  branchName: string;
  commitMessage: string;
  files: GitHubSetupPullRequestFile[];
  installationId: number;
  owner: string;
  prBody: string;
  prTitle: string;
  repo: string;
};

export type GitHubAppClient = {
  createIssue(options: CreateGitHubIssueOptions): Promise<GitHubIssueMetadata>;
  createSetupPullRequest(
    options: CreateGitHubSetupPullRequestOptions,
  ): Promise<GitHubPullRequestMetadata>;
  getInstallation(options: GetGitHubInstallationOptions): Promise<GitHubInstallationMetadata>;
  listInstallationRepositories(
    options: ListGitHubInstallationRepositoriesOptions,
  ): Promise<GitHubRepositoryMetadata[]>;
  getPullRequestCheckSummary(
    options: GetGitHubPullRequestCheckSummaryOptions,
  ): Promise<GitHubPullRequestCheckSummary>;
  getPullRequest(options: GetGitHubPullRequestOptions): Promise<GitHubPullRequestMetadata>;
  getPullRequestReviewSummary(
    options: GetGitHubPullRequestReviewSummaryOptions,
  ): Promise<GitHubPullRequestReviewSummary>;
};

export type GitHubAppClientErrorCode =
  | "invalid_request_function"
  | "invalid_installation_id"
  | "invalid_repository"
  | "invalid_branch_ref"
  | "invalid_git_sha"
  | "invalid_issue"
  | "invalid_setup_file"
  | "invalid_pull_request"
  | "invalid_pull_number"
  | "request_failed"
  | "invalid_response";

export type GitHubAppClientErrorMetadata = {
  operation?: GitHubAppOperation;
};

export class GitHubAppClientError extends Error {
  readonly code: GitHubAppClientErrorCode;
  readonly metadata: GitHubAppClientErrorMetadata;

  constructor(
    code: GitHubAppClientErrorCode,
    message: string,
    metadata: GitHubAppClientErrorMetadata = {},
  ) {
    super(message);
    this.name = "GitHubAppClientError";
    this.code = code;
    this.metadata = metadata;
  }
}

type RawRecord = Record<string, unknown>;

type GitObjectMetadata = {
  sha: string;
};

type GitCommitMetadata = GitObjectMetadata & {
  treeSha: string;
};

type GitReferenceMetadata = GitObjectMetadata & {
  ref: string;
};

type GitTreeEntry = {
  mode: "100644";
  path: string;
  sha: string;
  type: "blob";
};

export const createGitHubAppClient = (options: CreateGitHubAppClientOptions): GitHubAppClient => {
  if (typeof options !== "object" || options === null || typeof options.request !== "function") {
    throw new GitHubAppClientError(
      "invalid_request_function",
      "GitHub App client requires an injected request function.",
    );
  }

  return {
    async createIssue(issueOptions: CreateGitHubIssueOptions): Promise<GitHubIssueMetadata> {
      const installationId = parsePositiveInteger(
        issueOptions.installationId,
        "invalid_installation_id",
      );
      const owner = parseRepositoryPart(issueOptions.owner);
      const repo = parseRepositoryPart(issueOptions.repo);
      const title = parseIssueTitleText(issueOptions.title);
      const body = parseIssueBodyText(issueOptions.body);
      const issue = await runRequest(options.request, {
        method: "POST",
        operation: "createIssue",
        path: `/repos/${owner}/${repo}/issues`,
        installationId,
        body: {
          body,
          title,
        },
      });

      return parseIssueMetadata(issue);
    },

    async createSetupPullRequest(
      setupOptions: CreateGitHubSetupPullRequestOptions,
    ): Promise<GitHubPullRequestMetadata> {
      const installationId = parsePositiveInteger(
        setupOptions.installationId,
        "invalid_installation_id",
      );
      const owner = parseRepositoryPart(setupOptions.owner);
      const repo = parseRepositoryPart(setupOptions.repo);
      const baseBranch = parseInputRefName(setupOptions.baseBranch);
      const branchName = parseInputRefName(setupOptions.branchName);
      const commitMessage = parseSetupMetadataText(setupOptions.commitMessage);
      const prTitle = parseSetupMetadataText(setupOptions.prTitle);
      const prBody = parsePullRequestBodyText(setupOptions.prBody);
      const files = parseSetupPullRequestFiles(setupOptions.files);
      const baseRef = await runRequest(options.request, {
        method: "GET",
        operation: "getBranchReference",
        path: `/repos/${owner}/${repo}/git/ref/heads/${encodeRefPath(baseBranch)}`,
        installationId,
      });
      const baseRefMetadata = parseGitReference(baseRef);
      const baseCommit = await runRequest(options.request, {
        method: "GET",
        operation: "getGitCommit",
        path: `/repos/${owner}/${repo}/git/commits/${baseRefMetadata.sha}`,
        installationId,
      });
      const baseCommitMetadata = parseGitCommit(baseCommit);
      const treeEntries: GitTreeEntry[] = [];

      for (const file of files) {
        const blob = await runRequest(options.request, {
          method: "POST",
          operation: "createGitBlob",
          path: `/repos/${owner}/${repo}/git/blobs`,
          installationId,
          body: {
            content: file.content,
            encoding: "utf-8",
          },
        });
        const blobMetadata = parseGitObject(blob);

        treeEntries.push({
          mode: "100644",
          path: file.path,
          sha: blobMetadata.sha,
          type: "blob",
        });
      }

      const tree = await runRequest(options.request, {
        method: "POST",
        operation: "createGitTree",
        path: `/repos/${owner}/${repo}/git/trees`,
        installationId,
        body: {
          base_tree: baseCommitMetadata.treeSha,
          tree: treeEntries,
        },
      });
      const treeMetadata = parseGitObject(tree);
      const commit = await runRequest(options.request, {
        method: "POST",
        operation: "createGitCommit",
        path: `/repos/${owner}/${repo}/git/commits`,
        installationId,
        body: {
          message: commitMessage,
          parents: [baseRefMetadata.sha],
          tree: treeMetadata.sha,
        },
      });
      const commitMetadata = parseGitObject(commit);

      await runRequest(options.request, {
        method: "POST",
        operation: "createBranchReference",
        path: `/repos/${owner}/${repo}/git/refs`,
        installationId,
        body: {
          ref: `refs/heads/${branchName}`,
          sha: commitMetadata.sha,
        },
      });

      const pullRequest = await runRequest(options.request, {
        method: "POST",
        operation: "createPullRequest",
        path: `/repos/${owner}/${repo}/pulls`,
        installationId,
        body: {
          base: baseBranch,
          body: prBody,
          draft: true,
          head: branchName,
          title: prTitle,
        },
      });

      return parsePullRequestMetadata(pullRequest);
    },

    async getInstallation(
      installationOptions: GetGitHubInstallationOptions,
    ): Promise<GitHubInstallationMetadata> {
      const installationId = parsePositiveInteger(
        installationOptions.installationId,
        "invalid_installation_id",
      );
      const response = await runRequest(options.request, {
        method: "GET",
        operation: "getInstallation",
        path: `/app/installations/${installationId}`,
        installationId,
      });

      return parseInstallationMetadata(response);
    },

    async listInstallationRepositories(
      listOptions: ListGitHubInstallationRepositoriesOptions,
    ): Promise<GitHubRepositoryMetadata[]> {
      const installationId = parsePositiveInteger(
        listOptions.installationId,
        "invalid_installation_id",
      );
      const query = parsePaginationQuery(listOptions);
      const response = await runRequest(options.request, {
        method: "GET",
        operation: "listInstallationRepositories",
        path: "/installation/repositories",
        installationId,
        ...(query === undefined ? {} : { query }),
      });

      return parseRepositoryList(response);
    },

    async getPullRequest(
      pullRequestOptions: GetGitHubPullRequestOptions,
    ): Promise<GitHubPullRequestMetadata> {
      const installationId = parsePositiveInteger(
        pullRequestOptions.installationId,
        "invalid_installation_id",
      );
      const owner = parseRepositoryPart(pullRequestOptions.owner);
      const repo = parseRepositoryPart(pullRequestOptions.repo);
      const pullNumber = parsePositiveInteger(pullRequestOptions.pullNumber, "invalid_pull_number");
      const response = await runRequest(options.request, {
        method: "GET",
        operation: "getPullRequest",
        path: `/repos/${owner}/${repo}/pulls/${pullNumber}`,
        installationId,
      });

      return parsePullRequestMetadata(response);
    },

    async getPullRequestReviewSummary(
      pullRequestOptions: GetGitHubPullRequestReviewSummaryOptions,
    ): Promise<GitHubPullRequestReviewSummary> {
      const installationId = parsePositiveInteger(
        pullRequestOptions.installationId,
        "invalid_installation_id",
      );
      const owner = parseRepositoryPart(pullRequestOptions.owner);
      const repo = parseRepositoryPart(pullRequestOptions.repo);
      const pullNumber = parsePositiveInteger(pullRequestOptions.pullNumber, "invalid_pull_number");
      const response = await runRequest(options.request, {
        method: "GET",
        operation: "getPullRequestReviewSummary",
        path: `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
        installationId,
        query: { per_page: 100 },
      });

      return parsePullRequestReviewSummary(response);
    },

    async getPullRequestCheckSummary(
      checkOptions: GetGitHubPullRequestCheckSummaryOptions,
    ): Promise<GitHubPullRequestCheckSummary> {
      const installationId = parsePositiveInteger(
        checkOptions.installationId,
        "invalid_installation_id",
      );
      const owner = parseRepositoryPart(checkOptions.owner);
      const repo = parseRepositoryPart(checkOptions.repo);
      const ref = parseRefName(checkOptions.ref);
      const response = await runRequest(options.request, {
        method: "GET",
        operation: "getPullRequestCheckSummary",
        path: `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs`,
        installationId,
        query: { per_page: 100 },
      });

      return parsePullRequestCheckSummary(response, ref);
    },
  };
};

const runRequest = async (
  request: GitHubAppRequestFunction,
  transportRequest: GitHubAppRequest,
): Promise<unknown> => {
  try {
    return await request(transportRequest);
  } catch {
    throw new GitHubAppClientError("request_failed", "GitHub App metadata request failed.", {
      operation: transportRequest.operation,
    });
  }
};

const parsePaginationQuery = (
  options: ListGitHubInstallationRepositoriesOptions,
): GitHubAppRequest["query"] | undefined => {
  const query: Record<string, number> = {};

  if (options.page !== undefined) {
    query.page = parsePositiveInteger(options.page, "invalid_response");
  }

  if (options.perPage !== undefined) {
    query.per_page = parsePositiveInteger(options.perPage, "invalid_response");
  }

  return Object.keys(query).length === 0 ? undefined : query;
};

const parseInstallationMetadata = (value: unknown): GitHubInstallationMetadata => {
  const record = parseRecord(value);
  const account = parseAccountMetadata(record.account);
  const repositorySelection = parseRepositorySelection(record.repository_selection);
  const permissions = parsePermissions(record.permissions);
  const suspendedAt = parseNullableTimestamp(record.suspended_at);
  const htmlUrl = parseOptionalUrl(record.html_url);

  return {
    id: parsePositiveInteger(record.id, "invalid_response"),
    account,
    repositorySelection,
    permissions,
    suspendedAt,
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
  };
};

const parseRepositoryList = (value: unknown): GitHubRepositoryMetadata[] => {
  const repositories = Array.isArray(value) ? value : parseRecord(value).repositories;

  if (!Array.isArray(repositories)) {
    throwInvalidResponse();
  }

  return repositories
    .map(parseRepositoryMetadata)
    .toSorted((left, right) => left.fullName.localeCompare(right.fullName));
};

const parsePullRequestMetadata = (value: unknown): GitHubPullRequestMetadata => {
  const record = parseRecord(value);
  const base = isRecord(record.base) ? record.base : {};
  const head = isRecord(record.head) ? record.head : {};
  const repository = parseRepositoryMetadata(isRecord(base.repo) ? base.repo : record.repository);
  const author = parseOptionalAccount(record.user);
  const headRefName = parseOptionalRefName(head.ref);
  const baseRefName = parseOptionalRefName(base.ref);
  const updatedAt = parseOptionalTimestamp(record.updated_at);

  return {
    id: parsePositiveInteger(record.id, "invalid_response"),
    number: parsePositiveInteger(record.number, "invalid_response"),
    title: parseMetadataText(record.title),
    state: parsePullRequestState(record.state),
    draft: parseBoolean(record.draft),
    merged: parsePullRequestMerged(record),
    htmlUrl: parseRequiredUrl(record.html_url),
    ...(author === undefined ? {} : { author }),
    repository,
    ...(headRefName === undefined ? {} : { headRefName }),
    ...(baseRefName === undefined ? {} : { baseRefName }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
};

const parseIssueMetadata = (value: unknown): GitHubIssueMetadata => {
  const record = parseRecord(value);
  const createdAt = parseOptionalTimestamp(record.created_at);
  const updatedAt = parseOptionalTimestamp(record.updated_at);

  return {
    id: parsePositiveInteger(record.id, "invalid_response"),
    number: parsePositiveInteger(record.number, "invalid_response"),
    title: parseMetadataText(record.title),
    state: parseIssueState(record.state),
    htmlUrl: parseRequiredUrl(record.html_url),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
};

const createReviewStateCounts = (): Record<GitHubPullRequestReviewState, number> => ({
  approved: 0,
  changes_requested: 0,
  commented: 0,
  dismissed: 0,
  pending: 0,
  unknown: 0,
});

const parsePullRequestReviewSummary = (value: unknown): GitHubPullRequestReviewSummary => {
  if (!Array.isArray(value)) {
    throwInvalidResponse();
  }

  const states = createReviewStateCounts();
  const urls = new Set<string>();

  for (const item of value) {
    const record = parseRecord(item);
    const state = parseReviewState(record.state);
    const htmlUrl = parseOptionalUrl(record.html_url);

    states[state] += 1;

    if (htmlUrl !== undefined) {
      urls.add(htmlUrl);
    }
  }

  return {
    states,
    totalCount: value.length,
    urls: [...urls].toSorted((left, right) => left.localeCompare(right)),
  };
};

const createCheckStatusCounts = (): Record<GitHubCheckRunStatus, number> => ({
  completed: 0,
  in_progress: 0,
  pending: 0,
  queued: 0,
  requested: 0,
  unknown: 0,
  waiting: 0,
});

const createCheckConclusionCounts = (): Record<GitHubCheckRunConclusion, number> => ({
  action_required: 0,
  cancelled: 0,
  failure: 0,
  neutral: 0,
  skipped: 0,
  stale: 0,
  startup_failure: 0,
  success: 0,
  timed_out: 0,
  unknown: 0,
});

const parsePullRequestCheckSummary = (
  value: unknown,
  ref: string,
): GitHubPullRequestCheckSummary => {
  const record = parseRecord(value);
  const checkRuns = record.check_runs;

  if (!Array.isArray(checkRuns)) {
    throwInvalidResponse();
  }

  const statusCounts = createCheckStatusCounts();
  const conclusionCounts = createCheckConclusionCounts();
  const urls = new Set<string>();

  for (const item of checkRuns) {
    const checkRun = parseRecord(item);
    const status = parseCheckRunStatus(checkRun.status);
    const conclusion = parseCheckRunConclusion(checkRun.conclusion);
    const htmlUrl = parseOptionalUrl(checkRun.html_url);

    statusCounts[status] += 1;
    conclusionCounts[conclusion] += 1;

    if (htmlUrl !== undefined) {
      urls.add(htmlUrl);
    }
  }

  return {
    conclusionCounts,
    ref,
    statusCounts,
    totalCount: checkRuns.length,
    urls: [...urls].toSorted((left, right) => left.localeCompare(right)),
  };
};

const parseGitReference = (value: unknown): GitReferenceMetadata => {
  const record = parseRecord(value);
  const object = parseRecord(record.object);

  return {
    ref: parseGitReferenceName(record.ref),
    sha: parseGitSha(object.sha),
  };
};

const parseGitCommit = (value: unknown): GitCommitMetadata => {
  const record = parseRecord(value);
  const tree = parseRecord(record.tree);

  return {
    sha: parseGitSha(record.sha),
    treeSha: parseGitSha(tree.sha),
  };
};

const parseGitObject = (value: unknown): GitObjectMetadata => {
  const record = parseRecord(value);

  return {
    sha: parseGitSha(record.sha),
  };
};

const parseRepositoryMetadata = (value: unknown): GitHubRepositoryMetadata => {
  const record = parseRecord(value);
  const fullName = parseFullName(record.full_name);
  const [owner, nameFromFullName] = fullName.split("/");
  const name = parseRepositoryPart(record.name);
  const visibility = parseOptionalVisibility(record.visibility);

  if (name !== nameFromFullName) {
    throwInvalidResponse();
  }

  return {
    id: parsePositiveInteger(record.id, "invalid_response"),
    owner: parseRepositoryPart(owner ?? ""),
    name,
    fullName,
    private: parseBoolean(record.private),
    htmlUrl: parseRequiredUrl(record.html_url),
    defaultBranch: parseRefName(record.default_branch),
    archived: parseBoolean(record.archived),
    disabled: parseBoolean(record.disabled),
    ...(visibility === undefined ? {} : { visibility }),
  };
};

const parseAccountMetadata = (value: unknown): GitHubAccountMetadata => {
  const record = parseRecord(value);
  const htmlUrl = parseOptionalUrl(record.html_url);

  return {
    id: parsePositiveInteger(record.id, "invalid_response"),
    login: parseRepositoryPart(record.login),
    type: parseAccountType(record.type),
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
  };
};

const parseOptionalAccount = (value: unknown): GitHubAccountMetadata | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseAccountMetadata(value);
};

const parseRecord = (value: unknown): RawRecord => {
  if (!isRecord(value)) {
    throwInvalidResponse();
  }

  return value;
};

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePositiveInteger = (value: unknown, code: GitHubAppClientErrorCode): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubAppClientError(
      code,
      code === "invalid_response"
        ? "GitHub App metadata response was invalid."
        : "GitHub App client input was invalid.",
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
    throw new GitHubAppClientError("invalid_repository", "Repository metadata must be safe.");
  }

  return value;
};

const parseFullName = (value: unknown): string => {
  if (typeof value !== "string") {
    throwInvalidResponse();
  }

  const parts = value.split("/");

  if (parts.length !== 2) {
    throwInvalidResponse();
  }

  const owner = parseRepositoryPart(parts[0]);
  const name = parseRepositoryPart(parts[1]);

  return `${owner}/${name}`;
};

const parseMetadataText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_TEXT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidResponse();
  }

  return value;
};

const parseAccountType = (value: unknown): string => {
  const accountType = parseMetadataText(value);

  if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(accountType)) {
    throwInvalidResponse();
  }

  return accountType;
};

const parseRepositorySelection = (
  value: unknown,
): GitHubInstallationMetadata["repositorySelection"] => {
  if (value === "all" || value === "selected") {
    return value;
  }

  throwInvalidResponse();
};

const parsePermissions = (value: unknown): Record<string, string> => {
  const record = parseRecord(value);
  const permissions: Record<string, string> = {};

  for (const [key, permissionValue] of Object.entries(record).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      key.length === 0 ||
      key.length > MAX_PERMISSION_KEY_LENGTH ||
      !/^[a-z_]+$/u.test(key) ||
      looksUnsafeText(key) ||
      typeof permissionValue !== "string" ||
      permissionValue.length === 0 ||
      permissionValue.length > MAX_PERMISSION_VALUE_LENGTH ||
      !/^[a-z_]+$/u.test(permissionValue) ||
      looksUnsafeText(permissionValue)
    ) {
      throwInvalidResponse();
    }

    permissions[key] = permissionValue;
  }

  return permissions;
};

const parsePullRequestState = (value: unknown): GitHubPullRequestMetadata["state"] => {
  if (value === "open" || value === "closed") {
    return value;
  }

  throwInvalidResponse();
};

const parseIssueState = (value: unknown): GitHubIssueMetadata["state"] => {
  if (value === "open" || value === "closed") {
    return value;
  }

  throwInvalidResponse();
};

const parseReviewState = (value: unknown): GitHubPullRequestReviewState => {
  if (typeof value !== "string" || hasControlCharacter(value) || looksUnsafeText(value)) {
    throwInvalidResponse();
  }

  const normalizedValue = value.toLowerCase();

  if (
    normalizedValue === "approved" ||
    normalizedValue === "changes_requested" ||
    normalizedValue === "commented" ||
    normalizedValue === "dismissed" ||
    normalizedValue === "pending"
  ) {
    return normalizedValue;
  }

  return "unknown";
};

const parseCheckRunStatus = (value: unknown): GitHubCheckRunStatus => {
  if (typeof value !== "string" || hasControlCharacter(value) || looksUnsafeText(value)) {
    throwInvalidResponse();
  }

  if (
    value === "completed" ||
    value === "in_progress" ||
    value === "pending" ||
    value === "queued" ||
    value === "requested" ||
    value === "waiting"
  ) {
    return value;
  }

  return "unknown";
};

const parseCheckRunConclusion = (value: unknown): GitHubCheckRunConclusion => {
  if (value === null || value === undefined) {
    return "unknown";
  }

  if (typeof value !== "string" || hasControlCharacter(value) || looksUnsafeText(value)) {
    throwInvalidResponse();
  }

  if (
    value === "action_required" ||
    value === "cancelled" ||
    value === "failure" ||
    value === "neutral" ||
    value === "skipped" ||
    value === "stale" ||
    value === "startup_failure" ||
    value === "success" ||
    value === "timed_out"
  ) {
    return value;
  }

  return "unknown";
};

const parsePullRequestMerged = (record: RawRecord): boolean => {
  if (typeof record.merged === "boolean") {
    return record.merged;
  }

  if (typeof record.merged_at === "string") {
    parseTimestamp(record.merged_at);
    return true;
  }

  if (record.merged_at === null || record.merged_at === undefined) {
    return false;
  }

  throwInvalidResponse();
};

const parseOptionalVisibility = (value: unknown): GitHubRepositoryMetadata["visibility"] => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === "public" || value === "private" || value === "internal") {
    return value;
  }

  throwInvalidResponse();
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throwInvalidResponse();
  }

  return value;
};

const parseRequiredUrl = (value: unknown): string => {
  const url = parseOptionalUrl(value);

  if (url === undefined) {
    throwInvalidResponse();
  }

  return url;
};

const parseOptionalUrl = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidResponse();
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throwInvalidResponse();
  }

  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throwInvalidResponse();
  }

  return value;
};

const parseNullableTimestamp = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }

  return parseTimestamp(value);
};

const parseOptionalTimestamp = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseTimestamp(value);
};

const parseTimestamp = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_TEXT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throwInvalidResponse();
  }

  return value;
};

const parseSetupMetadataText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_TEXT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubAppClientError(
      "invalid_pull_request",
      "GitHub App pull request input was invalid.",
    );
  }

  return value;
};

const parsePullRequestBodyText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PULL_REQUEST_BODY_LENGTH ||
    value.trim() !== value ||
    hasMultilineUnsafeControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubAppClientError(
      "invalid_pull_request",
      "GitHub App pull request input was invalid.",
    );
  }

  return value;
};

const parseIssueTitleText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_TEXT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubAppClientError("invalid_issue", "GitHub App issue input was invalid.");
  }

  return value;
};

const parseIssueBodyText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ISSUE_BODY_LENGTH ||
    value.trim() !== value ||
    hasMultilineUnsafeControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubAppClientError("invalid_issue", "GitHub App issue input was invalid.");
  }

  return value;
};

const parseInputRefName = (value: unknown): string => {
  try {
    return parseRefName(value);
  } catch (error) {
    if (error instanceof GitHubAppClientError) {
      throw new GitHubAppClientError(
        "invalid_branch_ref",
        "GitHub App branch reference input was invalid.",
      );
    }

    throw error;
  }
};

const parseGitSha = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 6 ||
    value.length > 128 ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    !/^[a-f0-9]+$/iu.test(value) ||
    looksUnsafeText(value)
  ) {
    throw new GitHubAppClientError(
      "invalid_git_sha",
      "GitHub App Git object response was invalid.",
    );
  }

  return value;
};

const parseGitReferenceName = (value: unknown): string => {
  if (typeof value !== "string" || !value.startsWith("refs/heads/")) {
    throwInvalidResponse();
  }

  const branch = value.slice("refs/heads/".length);

  parseRefName(branch);

  return value;
};

const parseSetupPullRequestFilePath = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SETUP_FILE_PATH_LENGTH ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    hasControlCharacter(value) ||
    looksUnsafeText(value) ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new GitHubAppClientError("invalid_setup_file", "Setup PR file input was invalid.");
  }

  const normalized = value.toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;

  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key")
  ) {
    throw new GitHubAppClientError("invalid_setup_file", "Setup PR file input was invalid.");
  }

  if (!APPROVED_SETUP_PR_FILE_PATHS.has(value)) {
    throw new GitHubAppClientError("invalid_setup_file", "Setup PR file input was invalid.");
  }

  return value;
};

const parseSetupPullRequestFileContent = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SETUP_FILE_CONTENT_LENGTH ||
    hasMultilineUnsafeControlCharacter(value) ||
    looksSecretLike(value)
  ) {
    throw new GitHubAppClientError("invalid_setup_file", "Setup PR file input was invalid.");
  }

  return value;
};

const parseSetupPullRequestFiles = (value: unknown): GitHubSetupPullRequestFile[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new GitHubAppClientError("invalid_setup_file", "Setup PR file input was invalid.");
  }

  const seenPaths = new Set<string>();

  return value.map((item) => {
    const record = parseRecord(item);
    const path = parseSetupPullRequestFilePath(record.path);
    const normalizedPath = path.toLowerCase();

    if (seenPaths.has(normalizedPath)) {
      throw new GitHubAppClientError("invalid_setup_file", "Setup PR file input was invalid.");
    }

    seenPaths.add(normalizedPath);

    return {
      content: parseSetupPullRequestFileContent(record.content),
      path,
    };
  });
};

const encodeRefPath = (value: string): string =>
  value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

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
    throwInvalidResponse();
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
    throwInvalidResponse();
  }

  return value;
};

const parseOptionalRefName = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseRefName(value);
};

function throwInvalidResponse(): never {
  throw new GitHubAppClientError("invalid_response", "GitHub App metadata response was invalid.");
}

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const hasMultilineUnsafeControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint !== undefined &&
      codePoint < 32 &&
      codePoint !== 9 &&
      codePoint !== 10 &&
      codePoint !== 13
    ) {
      return true;
    }

    if (codePoint === 127) {
      return true;
    }
  }

  return false;
};

const looksUnsafeText = (value: string): boolean =>
  looksSecretLike(value) || SOURCE_LIKE_TEXT_PATTERNS.some((pattern) => pattern.test(value));

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

const SOURCE_LIKE_TEXT_PATTERNS = [
  /\bdiff --git\b/u,
  /^@@\s/mu,
  /^---\s+a\//mu,
  /^\+\+\+\s+b\//mu,
  /^\*\*\* Begin Patch\b/mu,
  /^```/mu,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,160}[;{}=()]/u,
  /\b(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,120}[;{}=()]/u,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/u,
];
