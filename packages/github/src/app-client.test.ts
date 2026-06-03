import * as github from "@control-plane/github";
import { describe, expect, it, vi } from "vitest";

import {
  GitHubAppClientError,
  createGitHubAppClient,
  type CreateGitHubAppClientOptions,
  type GitHubAppClient,
  type GitHubAppClientErrorCode,
  type GitHubAppRequest,
  type GitHubAppRequestFunction,
  type GitHubInstallationMetadata,
  type GitHubIssueMetadata,
  type GitHubPullRequestCheckSummary,
  type GitHubPullRequestMetadata,
  type GitHubPullRequestReviewSummary,
  type GitHubRepositoryMetadata,
  type GitHubSetupPullRequestFile,
} from "./app-client.js";

const fakeTransportToken = `${"ghp_"}should_not_leave_the_transport_boundary`;
const fakeErrorToken = `${"ghp_"}thisTokenMustNotAppearInErrors`;
const fakeRepositoryToken = `${"ghp_"}thisShouldNotEcho`;

const installationPayload = () => ({
  id: 42,
  access_tokens_url: "https://api.github.example.test/app/installations/42/access_tokens",
  account: {
    id: 1001,
    login: "acme",
    type: "Organization",
    html_url: "https://github.example.test/acme",
    email: "security@example.test",
  },
  app_id: 12,
  repository_selection: "selected",
  permissions: {
    contents: "read",
    pull_requests: "read",
    metadata: "read",
  },
  suspended_at: null,
  html_url: "https://github.example.test/settings/installations/42",
  token: fakeTransportToken,
});

const repositoryPayload = (overrides: Record<string, unknown> = {}) => ({
  id: 9001,
  name: "control-plane",
  full_name: "acme/control-plane",
  private: true,
  html_url: "https://github.example.test/acme/control-plane",
  default_branch: "main",
  archived: false,
  disabled: false,
  visibility: "private",
  description: "Repository description is not required for visibility sync.",
  contents_url: "https://api.github.example.test/repos/acme/control-plane/contents/{+path}",
  ssh_url: "git@github.example.test:acme/control-plane.git",
  ...overrides,
});

const pullRequestPayload = () => ({
  id: 701,
  number: 17,
  title: "TASK-150: Add metadata visibility helpers",
  state: "open",
  draft: true,
  merged: false,
  html_url: "https://github.example.test/acme/control-plane/pull/17",
  user: {
    id: 501,
    login: "rory",
    type: "User",
    html_url: "https://github.example.test/rory",
  },
  head: {
    ref: "aicp/task-150",
    sha: "abc123",
    repo: repositoryPayload({ name: "fork", full_name: "rory/fork" }),
  },
  base: {
    ref: "main",
    sha: "def456",
    repo: repositoryPayload(),
  },
  updated_at: "2026-05-24T12:00:00.000Z",
  body: "Do not expose PR body text.",
  comments: 4,
  diff_url: "https://github.example.test/acme/control-plane/pull/17.diff",
  patch_url: "https://github.example.test/acme/control-plane/pull/17.patch",
  raw_output: "unredacted command output",
  token: fakeTransportToken,
});

const issuePayload = () => ({
  id: 601,
  number: 31,
  title: "Sync approved task to GitHub Issues",
  state: "open",
  html_url: "https://github.example.test/acme/control-plane/issues/31",
  repository_url: "https://api.github.example.test/repos/acme/control-plane",
  user: {
    id: 501,
    login: "rory",
    type: "User",
    html_url: "https://github.example.test/rory",
  },
  created_at: "2026-05-27T12:00:00.000Z",
  updated_at: "2026-05-27T12:01:00.000Z",
  body: "Do not expose issue body text.",
  comments: 0,
  comments_url: "https://api.github.example.test/repos/acme/control-plane/issues/31/comments",
  diff_url: "https://github.example.test/acme/control-plane/issues/31.diff",
  patch_url: "https://github.example.test/acme/control-plane/issues/31.patch",
  raw_output: "unredacted command output",
  token: fakeTransportToken,
});

const gitReferencePayload = (sha = "1111111111111111111111111111111111111111") => ({
  ref: "refs/heads/main",
  object: {
    sha,
    type: "commit",
    url: `https://api.github.example.test/repos/acme/control-plane/git/commits/${sha}`,
  },
  url: "https://api.github.example.test/repos/acme/control-plane/git/refs/heads/main",
});

const gitCommitPayload = () => ({
  sha: "1111111111111111111111111111111111111111",
  tree: {
    sha: "2222222222222222222222222222222222222222",
    url: "https://api.github.example.test/repos/acme/control-plane/git/trees/2222222222222222222222222222222222222222",
  },
  parents: [],
  message: "Do not expose commit response body.",
});

const gitBlobPayload = (sha: string) => ({
  sha,
  url: `https://api.github.example.test/repos/acme/control-plane/git/blobs/${sha}`,
});

const gitTreePayload = () => ({
  sha: "5555555555555555555555555555555555555555",
  tree: [],
  truncated: false,
});

const createdGitCommitPayload = () => ({
  sha: "6666666666666666666666666666666666666666",
  tree: {
    sha: "5555555555555555555555555555555555555555",
  },
  message: "Cortex setup PR",
});

const pullRequestReviewsPayload = () => [
  {
    id: 801,
    state: "APPROVED",
    html_url: "https://github.example.test/acme/control-plane/pull/17#pullrequestreview-801",
    submitted_at: "2026-05-24T12:05:00.000Z",
    body: "Do not expose review body text.",
    comments_url: "https://api.github.example.test/repos/acme/control-plane/pulls/comments/1",
    token: fakeTransportToken,
    user: {
      id: 501,
      login: "reviewer",
      type: "User",
    },
  },
  {
    id: 802,
    state: "COMMENTED",
    html_url: "https://github.example.test/acme/control-plane/pull/17#pullrequestreview-802",
    body: "Do not expose a review comment.",
  },
];

const pullRequestCheckRunsPayload = () => ({
  total_count: 3,
  check_runs: [
    {
      id: 901,
      status: "completed",
      conclusion: "success",
      html_url: "https://github.example.test/acme/control-plane/runs/901",
      details_url: "https://github.example.test/acme/control-plane/runs/901/details",
      name: "Unit tests",
      output: {
        title: "Do not expose check output title.",
        summary: "Do not expose check output summary.",
        text: "Do not expose check logs.",
      },
      token: fakeTransportToken,
    },
    {
      id: 902,
      status: "completed",
      conclusion: "skipped",
      html_url: "https://github.example.test/acme/control-plane/runs/902",
    },
    {
      id: 903,
      status: "queued",
      conclusion: null,
      html_url: "https://github.example.test/acme/control-plane/runs/903",
      logs_url: "https://api.github.example.test/repos/acme/control-plane/check-runs/903/logs",
    },
  ],
});

describe("@control-plane/github app client shell", () => {
  it("exports the app client helper, error, and public metadata types through the package entrypoint", () => {
    const request: GitHubAppRequest = {
      method: "GET",
      path: "/app/installations/42",
      operation: "getInstallation",
    };
    const requestFn: GitHubAppRequestFunction = async () => installationPayload();
    const options: CreateGitHubAppClientOptions = { request: requestFn };
    const client: GitHubAppClient = createGitHubAppClient(options);
    const installation: GitHubInstallationMetadata = {
      id: 42,
      account: {
        id: 1001,
        login: "acme",
        type: "Organization",
        htmlUrl: "https://github.example.test/acme",
      },
      repositorySelection: "selected",
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
      },
      suspendedAt: null,
      htmlUrl: "https://github.example.test/settings/installations/42",
    };
    const repository: GitHubRepositoryMetadata = {
      id: 9001,
      owner: "acme",
      name: "control-plane",
      fullName: "acme/control-plane",
      private: true,
      htmlUrl: "https://github.example.test/acme/control-plane",
      defaultBranch: "main",
      archived: false,
      disabled: false,
      visibility: "private",
    };
    const pullRequest: GitHubPullRequestMetadata = {
      id: 701,
      number: 17,
      title: "TASK-150: Add metadata visibility helpers",
      state: "open",
      draft: true,
      merged: false,
      htmlUrl: "https://github.example.test/acme/control-plane/pull/17",
      author: {
        id: 501,
        login: "rory",
        type: "User",
        htmlUrl: "https://github.example.test/rory",
      },
      repository,
      headRefName: "aicp/task-150",
      baseRefName: "main",
      updatedAt: "2026-05-24T12:00:00.000Z",
    };
    const issue: GitHubIssueMetadata = {
      createdAt: "2026-05-27T12:00:00.000Z",
      htmlUrl: "https://github.example.test/acme/control-plane/issues/31",
      id: 601,
      number: 31,
      state: "open",
      title: "Sync approved task to GitHub Issues",
      updatedAt: "2026-05-27T12:01:00.000Z",
    };
    const reviewSummary: GitHubPullRequestReviewSummary = {
      states: {
        approved: 1,
        changes_requested: 0,
        commented: 1,
        dismissed: 0,
        pending: 0,
        unknown: 0,
      },
      totalCount: 2,
      urls: [
        "https://github.example.test/acme/control-plane/pull/17#pullrequestreview-801",
        "https://github.example.test/acme/control-plane/pull/17#pullrequestreview-802",
      ],
    };
    const checksSummary: GitHubPullRequestCheckSummary = {
      conclusionCounts: {
        action_required: 0,
        cancelled: 0,
        failure: 0,
        neutral: 0,
        skipped: 1,
        stale: 0,
        startup_failure: 0,
        success: 1,
        timed_out: 0,
        unknown: 1,
      },
      ref: "aicp/task-150",
      statusCounts: {
        completed: 2,
        in_progress: 0,
        pending: 0,
        queued: 1,
        requested: 0,
        unknown: 0,
        waiting: 0,
      },
      totalCount: 3,
      urls: [
        "https://github.example.test/acme/control-plane/runs/901",
        "https://github.example.test/acme/control-plane/runs/902",
        "https://github.example.test/acme/control-plane/runs/903",
      ],
    };
    const setupPrFile: GitHubSetupPullRequestFile = {
      content: "Generated setup artifact for reviewer-owned setup.",
      path: ".aicp/policy.json",
    };
    const code: GitHubAppClientErrorCode = "invalid_repository";

    expect(typeof github.createGitHubAppClient).toBe("function");
    expect(github.GitHubAppClientError).toBe(GitHubAppClientError);
    expect(request.operation).toBe("getInstallation");
    expect(typeof client.getInstallation).toBe("function");
    expect(typeof client.createIssue).toBe("function");
    expect(installation.repositorySelection).toBe("selected");
    expect(repository.fullName).toBe("acme/control-plane");
    expect(issue.number).toBe(31);
    expect(pullRequest.repository.name).toBe("control-plane");
    expect(reviewSummary.states.approved).toBe(1);
    expect(checksSummary.conclusionCounts.success).toBe(1);
    expect(setupPrFile.path).toBe(".aicp/policy.json");
    expect(typeof client.createSetupPullRequest).toBe("function");
    expect(code).toBe("invalid_repository");
  });

  it("uses the injected request function for fixed metadata-only operations", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      if (transportRequest.operation === "getInstallation") {
        return installationPayload();
      }

      if (transportRequest.operation === "listInstallationRepositories") {
        return { repositories: [repositoryPayload()] };
      }

      if (transportRequest.operation === "getPullRequest") {
        return pullRequestPayload();
      }

      if (transportRequest.operation === "getPullRequestReviewSummary") {
        return pullRequestReviewsPayload();
      }

      return pullRequestCheckRunsPayload();
    });
    const client = createGitHubAppClient({ request });

    await client.getInstallation({ installationId: 42 });
    await client.listInstallationRepositories({ installationId: 42, page: 2, perPage: 25 });
    await client.getPullRequest({
      installationId: 42,
      owner: "acme",
      repo: "control-plane",
      pullNumber: 17,
    });
    await client.getPullRequestReviewSummary({
      installationId: 42,
      owner: "acme",
      repo: "control-plane",
      pullNumber: 17,
    });
    await client.getPullRequestCheckSummary({
      installationId: 42,
      owner: "acme",
      ref: "aicp/task-150",
      repo: "control-plane",
    });

    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls.map(([call]) => call)).toEqual([
      {
        method: "GET",
        operation: "getInstallation",
        path: "/app/installations/42",
        installationId: 42,
      },
      {
        method: "GET",
        operation: "listInstallationRepositories",
        path: "/installation/repositories",
        installationId: 42,
        query: {
          page: 2,
          per_page: 25,
        },
      },
      {
        method: "GET",
        operation: "getPullRequest",
        path: "/repos/acme/control-plane/pulls/17",
        installationId: 42,
      },
      {
        method: "GET",
        operation: "getPullRequestReviewSummary",
        path: "/repos/acme/control-plane/pulls/17/reviews",
        installationId: 42,
        query: {
          per_page: 100,
        },
      },
      {
        method: "GET",
        operation: "getPullRequestCheckSummary",
        path: "/repos/acme/control-plane/commits/aicp%2Ftask-150/check-runs",
        installationId: 42,
        query: {
          per_page: 100,
        },
      },
    ]);
  });

  it("returns sanitized installation, repository, and pull request metadata", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      if (transportRequest.operation === "getInstallation") {
        return installationPayload();
      }

      if (transportRequest.operation === "listInstallationRepositories") {
        return {
          repositories: [
            repositoryPayload({ name: "z-api", full_name: "acme/z-api" }),
            repositoryPayload(),
          ],
          total_count: 2,
        };
      }

      if (transportRequest.operation === "getPullRequest") {
        return pullRequestPayload();
      }

      if (transportRequest.operation === "getPullRequestReviewSummary") {
        return pullRequestReviewsPayload();
      }

      return pullRequestCheckRunsPayload();
    });
    const client = createGitHubAppClient({ request });

    await expect(client.getInstallation({ installationId: 42 })).resolves.toEqual({
      id: 42,
      account: {
        id: 1001,
        login: "acme",
        type: "Organization",
        htmlUrl: "https://github.example.test/acme",
      },
      repositorySelection: "selected",
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
      },
      suspendedAt: null,
      htmlUrl: "https://github.example.test/settings/installations/42",
    });
    await expect(client.listInstallationRepositories({ installationId: 42 })).resolves.toEqual([
      {
        id: 9001,
        owner: "acme",
        name: "control-plane",
        fullName: "acme/control-plane",
        private: true,
        htmlUrl: "https://github.example.test/acme/control-plane",
        defaultBranch: "main",
        archived: false,
        disabled: false,
        visibility: "private",
      },
      {
        id: 9001,
        owner: "acme",
        name: "z-api",
        fullName: "acme/z-api",
        private: true,
        htmlUrl: "https://github.example.test/acme/control-plane",
        defaultBranch: "main",
        archived: false,
        disabled: false,
        visibility: "private",
      },
    ]);
    await expect(
      client.getPullRequest({
        installationId: 42,
        owner: "acme",
        repo: "control-plane",
        pullNumber: 17,
      }),
    ).resolves.toEqual({
      id: 701,
      number: 17,
      title: "TASK-150: Add metadata visibility helpers",
      state: "open",
      draft: true,
      merged: false,
      htmlUrl: "https://github.example.test/acme/control-plane/pull/17",
      author: {
        id: 501,
        login: "rory",
        type: "User",
        htmlUrl: "https://github.example.test/rory",
      },
      repository: {
        id: 9001,
        owner: "acme",
        name: "control-plane",
        fullName: "acme/control-plane",
        private: true,
        htmlUrl: "https://github.example.test/acme/control-plane",
        defaultBranch: "main",
        archived: false,
        disabled: false,
        visibility: "private",
      },
      headRefName: "aicp/task-150",
      baseRefName: "main",
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
    await expect(
      client.getPullRequestReviewSummary({
        installationId: 42,
        owner: "acme",
        repo: "control-plane",
        pullNumber: 17,
      }),
    ).resolves.toEqual({
      states: {
        approved: 1,
        changes_requested: 0,
        commented: 1,
        dismissed: 0,
        pending: 0,
        unknown: 0,
      },
      totalCount: 2,
      urls: [
        "https://github.example.test/acme/control-plane/pull/17#pullrequestreview-801",
        "https://github.example.test/acme/control-plane/pull/17#pullrequestreview-802",
      ],
    });
    await expect(
      client.getPullRequestCheckSummary({
        installationId: 42,
        owner: "acme",
        ref: "aicp/task-150",
        repo: "control-plane",
      }),
    ).resolves.toEqual({
      conclusionCounts: {
        action_required: 0,
        cancelled: 0,
        failure: 0,
        neutral: 0,
        skipped: 1,
        stale: 0,
        startup_failure: 0,
        success: 1,
        timed_out: 0,
        unknown: 1,
      },
      ref: "aicp/task-150",
      statusCounts: {
        completed: 2,
        in_progress: 0,
        pending: 0,
        queued: 1,
        requested: 0,
        unknown: 0,
        waiting: 0,
      },
      totalCount: 3,
      urls: [
        "https://github.example.test/acme/control-plane/runs/901",
        "https://github.example.test/acme/control-plane/runs/902",
        "https://github.example.test/acme/control-plane/runs/903",
      ],
    });
  });

  it("omits raw content, diffs, patches, snippets, command output, tokens, and credentials", async () => {
    const client = createGitHubAppClient({
      request: async (transportRequest) => {
        if (transportRequest.operation === "getInstallation") {
          return installationPayload();
        }

        if (transportRequest.operation === "listInstallationRepositories") {
          return { repositories: [repositoryPayload()] };
        }

        if (transportRequest.operation === "getPullRequest") {
          return pullRequestPayload();
        }

        if (transportRequest.operation === "getPullRequestReviewSummary") {
          return pullRequestReviewsPayload();
        }

        return pullRequestCheckRunsPayload();
      },
    });

    const visibleResults = [
      await client.getInstallation({ installationId: 42 }),
      await client.listInstallationRepositories({ installationId: 42 }),
      await client.getPullRequest({
        installationId: 42,
        owner: "acme",
        repo: "control-plane",
        pullNumber: 17,
      }),
      await client.getPullRequestReviewSummary({
        installationId: 42,
        owner: "acme",
        repo: "control-plane",
        pullNumber: 17,
      }),
      await client.getPullRequestCheckSummary({
        installationId: 42,
        owner: "acme",
        ref: "aicp/task-150",
        repo: "control-plane",
      }),
    ];
    const serialized = JSON.stringify(visibleResults);

    expect(serialized).not.toMatch(
      /body text|review body|review comment|comments|comments_url|check output|check logs|logs_url|diff_url|patch_url|raw_output|contents_url|ssh_url|token|credential|ghp_/iu,
    );
    expect(serialized).not.toMatch(/\b(?:diff|patch|snippet|source|content|stdout|stderr)\b/iu);
  });

  it("creates a draft setup pull request from generated setup files through Git data operations", async () => {
    const requests: GitHubAppRequest[] = [];
    const client = createGitHubAppClient({
      request: async (transportRequest) => {
        requests.push(transportRequest);

        if (transportRequest.operation === "getBranchReference") {
          return gitReferencePayload();
        }

        if (transportRequest.operation === "getGitCommit") {
          return gitCommitPayload();
        }

        if (transportRequest.operation === "createGitBlob") {
          return gitBlobPayload(
            requests.filter((request) => request.operation === "createGitBlob").length === 1
              ? "3333333333333333333333333333333333333333"
              : "4444444444444444444444444444444444444444",
          );
        }

        if (transportRequest.operation === "createGitTree") {
          return gitTreePayload();
        }

        if (transportRequest.operation === "createGitCommit") {
          return createdGitCommitPayload();
        }

        if (transportRequest.operation === "createBranchReference") {
          return {
            ...gitReferencePayload("6666666666666666666666666666666666666666"),
            ref: "refs/heads/cortex/setup-pr/setup-pr-preview-1",
          };
        }

        return pullRequestPayload();
      },
    });

    const pullRequest = await client.createSetupPullRequest({
      baseBranch: "main",
      branchName: "cortex/setup-pr/setup-pr-preview-1",
      commitMessage: "Cortex setup PR for setup_pr_preview_1",
      files: [
        {
          content: "Generated policy placeholder.\n",
          path: ".aicp/policy.json",
        },
        {
          content: "Generated workflow placeholder.\n",
          path: ".github/workflows/cortex-validation.yml",
        },
      ],
      installationId: 42,
      owner: "acme",
      prBody:
        "## Findings addressed\n- finding_1\n\n## Review checklist\n- Review generated setup files.",
      prTitle: "Cortex setup PR: setup_pr_preview_1",
      repo: "control-plane",
    });

    expect(pullRequest.number).toBe(17);
    expect(JSON.stringify(pullRequest)).not.toMatch(
      /Generated policy placeholder|Generated workflow placeholder|Findings addressed|Review checklist|diff_url|patch_url|token|ghp_/iu,
    );
    expect(requests.map((request) => [request.method, request.operation, request.path])).toEqual([
      ["GET", "getBranchReference", "/repos/acme/control-plane/git/ref/heads/main"],
      [
        "GET",
        "getGitCommit",
        "/repos/acme/control-plane/git/commits/1111111111111111111111111111111111111111",
      ],
      ["POST", "createGitBlob", "/repos/acme/control-plane/git/blobs"],
      ["POST", "createGitBlob", "/repos/acme/control-plane/git/blobs"],
      ["POST", "createGitTree", "/repos/acme/control-plane/git/trees"],
      ["POST", "createGitCommit", "/repos/acme/control-plane/git/commits"],
      ["POST", "createBranchReference", "/repos/acme/control-plane/git/refs"],
      ["POST", "createPullRequest", "/repos/acme/control-plane/pulls"],
    ]);
    expect(requests[2]?.body).toEqual({
      content: "Generated policy placeholder.\n",
      encoding: "utf-8",
    });
    expect(requests[4]?.body).toEqual({
      base_tree: "2222222222222222222222222222222222222222",
      tree: [
        {
          mode: "100644",
          path: ".aicp/policy.json",
          sha: "3333333333333333333333333333333333333333",
          type: "blob",
        },
        {
          mode: "100644",
          path: ".github/workflows/cortex-validation.yml",
          sha: "4444444444444444444444444444444444444444",
          type: "blob",
        },
      ],
    });
    expect(requests[7]?.body).toEqual({
      base: "main",
      body: "## Findings addressed\n- finding_1\n\n## Review checklist\n- Review generated setup files.",
      draft: true,
      head: "cortex/setup-pr/setup-pr-preview-1",
      title: "Cortex setup PR: setup_pr_preview_1",
    });
  });

  it("creates a GitHub issue through the installation request transport", async () => {
    const requests: GitHubAppRequest[] = [];
    const client = createGitHubAppClient({
      request: async (transportRequest) => {
        requests.push(transportRequest);

        return issuePayload();
      },
    });

    const issue = await client.createIssue({
      body: [
        "Cortex Task: Sync approved task to GitHub Issues",
        "",
        "Objective: Mirror approved metadata-only tasks into GitHub Issues.",
        "",
        "Acceptance criteria:",
        "- Created issue links back to Cortex.",
        "",
        "Risk: medium",
        "Suggested validation: Typecheck",
        "Cortex URL: https://cortex.example/dashboard/tasks/sync-github-issues?taskId=cortex_task_1",
      ].join("\n"),
      installationId: 42,
      owner: "acme",
      repo: "control-plane",
      title: "Sync approved task to GitHub Issues",
    });

    expect(issue).toEqual({
      createdAt: "2026-05-27T12:00:00.000Z",
      htmlUrl: "https://github.example.test/acme/control-plane/issues/31",
      id: 601,
      number: 31,
      state: "open",
      title: "Sync approved task to GitHub Issues",
      updatedAt: "2026-05-27T12:01:00.000Z",
    });
    expect(JSON.stringify(issue)).not.toMatch(
      /issue body|comments_url|diff_url|patch_url|raw_output|token|ghp_/iu,
    );
    expect(requests).toEqual([
      {
        body: {
          body: [
            "Cortex Task: Sync approved task to GitHub Issues",
            "",
            "Objective: Mirror approved metadata-only tasks into GitHub Issues.",
            "",
            "Acceptance criteria:",
            "- Created issue links back to Cortex.",
            "",
            "Risk: medium",
            "Suggested validation: Typecheck",
            "Cortex URL: https://cortex.example/dashboard/tasks/sync-github-issues?taskId=cortex_task_1",
          ].join("\n"),
          title: "Sync approved task to GitHub Issues",
        },
        installationId: 42,
        method: "POST",
        operation: "createIssue",
        path: "/repos/acme/control-plane/issues",
      },
    ]);
  });

  it("rejects setup pull request writes outside the approved setup file boundary", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async () => {
      throw new Error("setup PR input validation should run before GitHub transport");
    });
    const client = createGitHubAppClient({ request });
    const disallowedFiles = [
      { path: "apps/web/src/app.ts", reason: "source application file" },
      { path: "packages/shared/src/contracts.ts", reason: "package source file" },
      { path: "src/index.ts", reason: "root source file" },
      { path: ".github/workflows/deploy.yml", reason: "unapproved workflow file" },
      { path: ".env", reason: "environment file" },
      { path: ".env.local", reason: "environment override file" },
      { path: "README.md", reason: "unapproved root file" },
    ];

    for (const file of disallowedFiles) {
      await expect(
        client.createSetupPullRequest({
          baseBranch: "main",
          branchName: "cortex/setup-pr/setup-pr-preview-1",
          commitMessage: "Cortex setup PR for setup_pr_preview_1",
          files: [
            {
              content: `Generated setup artifact for ${file.reason}.\n`,
              path: file.path,
            },
          ],
          installationId: 42,
          owner: "acme",
          prBody:
            "## Findings addressed\n- finding_1\n\n## Review checklist\n- Review generated setup files.",
          prTitle: "Cortex setup PR: setup_pr_preview_1",
          repo: "control-plane",
        }),
      ).rejects.toMatchObject({
        code: "invalid_setup_file",
      });
    }

    expect(request).not.toHaveBeenCalled();
  });

  it("rejects setup pull request bodies that look like raw source, diffs, patches, or secrets", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async () => {
      throw new Error("setup PR input validation should run before GitHub transport");
    });
    const client = createGitHubAppClient({ request });
    const unsafeBodies = [
      "## Findings addressed\n```ts\nconst token = process.env.SECRET;\n```",
      "## Findings addressed\ndiff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@",
      "## Findings addressed\n*** Begin Patch\n*** Update File: src/index.ts",
      "## Findings addressed\n-----BEGIN PRIVATE KEY-----",
    ];

    for (const prBody of unsafeBodies) {
      await expect(
        client.createSetupPullRequest({
          baseBranch: "main",
          branchName: "cortex/setup-pr/setup-pr-preview-1",
          commitMessage: "Cortex setup PR for setup_pr_preview_1",
          files: [
            {
              content: "Generated policy placeholder.\n",
              path: ".aicp/policy.json",
            },
          ],
          installationId: 42,
          owner: "acme",
          prBody,
          prTitle: "Cortex setup PR: setup_pr_preview_1",
          repo: "control-plane",
        }),
      ).rejects.toMatchObject({
        code: "invalid_pull_request",
      });
    }

    expect(request).not.toHaveBeenCalled();
  });

  it("rejects GitHub issue titles and bodies that look like raw source, diffs, patches, or secrets", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async () => {
      throw new Error("issue input validation should run before GitHub transport");
    });
    const client = createGitHubAppClient({ request });
    const safeIssueInput = {
      body: "Cortex Task: Sync metadata\n\nObjective: Keep issue sync metadata-only.",
      installationId: 42,
      owner: "acme",
      repo: "control-plane",
      title: "Sync metadata to GitHub Issues",
    };
    const unsafeInputs = [
      {
        ...safeIssueInput,
        title: "const leaked = process.env.SECRET;",
      },
      {
        ...safeIssueInput,
        body: "Cortex Task\n```ts\nconst leaked = true;\n```",
      },
      {
        ...safeIssueInput,
        body: "Cortex Task\ndiff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@",
      },
      {
        ...safeIssueInput,
        body: "Cortex Task\n*** Begin Patch\n*** Update File: src/index.ts",
      },
      {
        ...safeIssueInput,
        body: "Cortex Task\n-----BEGIN PRIVATE KEY-----",
      },
    ];

    for (const issueInput of unsafeInputs) {
      await expect(client.createIssue(issueInput)).rejects.toMatchObject({
        code: "invalid_issue",
      });
    }

    expect(request).not.toHaveBeenCalled();
  });

  it("throws safe errors for invalid inputs and unsafe responses without echoing raw payloads", async () => {
    const unsafePayload = {
      id: 17,
      body: "Do not echo this body.",
      token: fakeErrorToken,
    };
    const client = createGitHubAppClient({
      request: async () => unsafePayload,
    });
    const invalidCases = [
      () => client.getInstallation({ installationId: 0 }),
      () => client.listInstallationRepositories({ installationId: Number.NaN }),
      () =>
        client.getPullRequest({
          installationId: 42,
          owner: "bad\nowner",
          repo: "control-plane",
          pullNumber: 17,
        }),
      () =>
        client.getPullRequest({
          installationId: 42,
          owner: "acme",
          repo: `token=${fakeRepositoryToken}`,
          pullNumber: 17,
        }),
      () =>
        client.getPullRequest({
          installationId: 42,
          owner: "acme",
          repo: "control-plane",
          pullNumber: -1,
        }),
      () =>
        client.getPullRequest({
          installationId: 42,
          owner: "acme",
          repo: "control-plane",
          pullNumber: 17,
        }),
      () =>
        client.getPullRequestReviewSummary({
          installationId: 0,
          owner: "acme",
          repo: "control-plane",
          pullNumber: 17,
        }),
      () =>
        client.getPullRequestCheckSummary({
          installationId: 42,
          owner: "acme",
          ref: "bad ref",
          repo: "control-plane",
        }),
    ];

    for (const execute of invalidCases) {
      await expect(execute()).rejects.toBeInstanceOf(GitHubAppClientError);

      try {
        await execute();
      } catch (error) {
        expect(String(error)).not.toContain(fakeErrorToken);
        expect(String(error)).not.toContain(fakeRepositoryToken);
        expect(String(error)).not.toContain("Do not echo");
        const serializedMetadata = JSON.stringify((error as GitHubAppClientError).metadata);

        expect(serializedMetadata).not.toContain(fakeErrorToken);
        expect(serializedMetadata).not.toContain(fakeRepositoryToken);
        expect(serializedMetadata).not.toContain("Do not echo");
      }
    }
  });
});
