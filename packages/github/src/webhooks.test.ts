import { createHmac } from "node:crypto";

import * as github from "@control-plane/github";
import { describe, expect, it } from "vitest";

import {
  GITHUB_WEBHOOK_EVENT_NAMES,
  GitHubWebhookError,
  parseGitHubWebhookEnvelope,
  parseGitHubWebhookHeaders,
  verifyGitHubWebhookSignature,
  type GitHubWebhookEnvelope,
  type GitHubWebhookErrorCode,
  type GitHubWebhookEventName,
  type GitHubWebhookHeaders,
  type VerifyGitHubWebhookSignatureInput,
} from "./webhooks.js";

const deliveryId = "123e4567-e89b-42d3-a456-426614174000";
const fakeBoundaryToken = `${"ghp_"}should_not_leave_the_boundary`;
const fakeErrorToken = `${"ghp_"}thisTokenMustNotAppearInErrors`;
const webhookSecret = "github-webhook-secret-value";

const headers = (overrides: GitHubWebhookHeaders = {}): GitHubWebhookHeaders => ({
  "x-github-delivery": deliveryId,
  "x-github-event": "pull_request",
  ...overrides,
});

const signWebhookPayload = (payload: string, secret = webhookSecret): string =>
  `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

const signatureInput = (
  overrides: Partial<VerifyGitHubWebhookSignatureInput> = {},
): VerifyGitHubWebhookSignatureInput => {
  const payload = JSON.stringify(pullRequestPayload());

  return {
    headers: headers({
      "x-hub-signature-256": signWebhookPayload(payload),
    }),
    payload,
    secret: webhookSecret,
    ...overrides,
  };
};

const repositoryPayload = () => ({
  id: 9001,
  name: "control-plane",
  full_name: "acme/control-plane",
  private: true,
  html_url: "https://github.example.test/acme/control-plane",
  default_branch: "main",
  archived: false,
  disabled: false,
  visibility: "private",
  contents_url: "https://api.github.example.test/repos/acme/control-plane/contents/{+path}",
});

const pullRequestPayload = () => ({
  action: "opened",
  installation: {
    id: 42,
    access_tokens_url: "https://api.github.example.test/app/installations/42/access_tokens",
  },
  repository: repositoryPayload(),
  pull_request: {
    id: 701,
    number: 17,
    title: "TASK-150: Add metadata visibility helpers",
    state: "open",
    draft: false,
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
    },
    base: {
      ref: "main",
    },
    updated_at: "2026-05-24T12:00:00.000Z",
    body: "Do not expose PR body text.",
    comments: 4,
    review_comments: 2,
    diff_url: "https://github.example.test/acme/control-plane/pull/17.diff",
    patch_url: "https://github.example.test/acme/control-plane/pull/17.patch",
    raw_payload: "unredacted command output",
  },
  comment: {
    body: "Do not expose comments.",
  },
});

const pushPayload = () => ({
  after: "1".repeat(40),
  before: "0".repeat(40),
  commits: [
    {
      added: ["apps/web/source-should-not-leave.ts"],
      message: "Do not expose commit messages.",
      modified: ["packages/github/source-should-not-leave.ts"],
      removed: [],
    },
  ],
  head_commit: {
    message: "Do not expose head commit.",
  },
  installation: {
    id: 42,
    token: fakeBoundaryToken,
  },
  pusher: {
    email: "do-not-expose@example.test",
    name: "octocat",
  },
  ref: "refs/heads/main",
  repository: repositoryPayload(),
});

describe("@control-plane/github webhook helpers", () => {
  it("exports webhook helpers, event names, errors, and public types through the package entrypoint", () => {
    const headerInput: GitHubWebhookHeaders = headers();
    const eventName: GitHubWebhookEventName = "pull_request";
    const envelope: GitHubWebhookEnvelope = {
      deliveryId,
      eventName,
      action: "opened",
      installationId: 42,
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
      repositories: [],
      pullRequest: {
        id: 701,
        number: 17,
        title: "TASK-150: Add metadata visibility helpers",
        state: "open",
        draft: false,
        merged: false,
        htmlUrl: "https://github.example.test/acme/control-plane/pull/17",
        author: {
          id: 501,
          login: "rory",
          type: "User",
          htmlUrl: "https://github.example.test/rory",
        },
        headRefName: "aicp/task-150",
        baseRefName: "main",
        updatedAt: "2026-05-24T12:00:00.000Z",
      },
    };
    const code: GitHubWebhookErrorCode = "unsupported_event";

    expect(typeof github.parseGitHubWebhookHeaders).toBe("function");
    expect(typeof github.parseGitHubWebhookEnvelope).toBe("function");
    expect(typeof github.verifyGitHubWebhookSignature).toBe("function");
    expect(github.GITHUB_WEBHOOK_EVENT_NAMES).toEqual(GITHUB_WEBHOOK_EVENT_NAMES);
    expect(github.GitHubWebhookError).toBe(GitHubWebhookError);
    expect(headerInput["x-github-event"]).toBe(eventName);
    expect(envelope.deliveryId).toBe(deliveryId);
    expect(code).toBe("unsupported_event");
  });

  it("supports only the visibility metadata events needed for the next milestone", () => {
    expect(GITHUB_WEBHOOK_EVENT_NAMES).toEqual([
      "installation",
      "installation_repositories",
      "pull_request",
      "push",
    ]);
  });

  it("normalizes webhook headers and installation repository envelopes into metadata-only structures", () => {
    const parsedHeaders = parseGitHubWebhookHeaders({
      "X-GitHub-Delivery": deliveryId,
      "X-GitHub-Event": "installation_repositories",
    });
    const envelope = parseGitHubWebhookEnvelope({
      headers: {
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "installation_repositories",
      },
      payload: {
        action: "added",
        installation: {
          id: 42,
          token: fakeBoundaryToken,
        },
        repositories_added: [
          repositoryPayload(),
          {
            ...repositoryPayload(),
            name: "z-api",
            full_name: "acme/z-api",
          },
        ],
        repositories_removed: [],
      },
    });

    expect(parsedHeaders).toEqual({
      deliveryId,
      eventName: "installation_repositories",
    });
    expect(envelope).toEqual({
      deliveryId,
      eventName: "installation_repositories",
      action: "added",
      installationId: 42,
      repositories: [
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
      ],
    });
  });

  it("accepts compact installation repository entries from GitHub webhook payloads", () => {
    const envelope = parseGitHubWebhookEnvelope({
      headers: {
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "installation_repositories",
      },
      payload: {
        action: "added",
        installation: {
          id: 42,
        },
        repositories_added: [
          {
            id: 186853007,
            node_id: "MDEwOlJlcG9zaXRvcnkxODY4NTMwMDc=",
            name: "Space",
            full_name: "Codertocat/Space",
            private: false,
          },
        ],
        repositories_removed: [],
      },
    });

    expect(envelope).toEqual({
      deliveryId,
      eventName: "installation_repositories",
      action: "added",
      installationId: 42,
      repositories: [
        {
          id: 186853007,
          owner: "Codertocat",
          name: "Space",
          fullName: "Codertocat/Space",
          private: false,
        },
      ],
    });
  });

  it("parses pull request webhooks without body text, comments, diffs, patches, or raw payload content", () => {
    const envelope = parseGitHubWebhookEnvelope({
      headers: headers(),
      payload: pullRequestPayload(),
    });
    const serialized = JSON.stringify(envelope);

    expect(envelope).toEqual({
      deliveryId,
      eventName: "pull_request",
      action: "opened",
      installationId: 42,
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
      repositories: [],
      pullRequest: {
        id: 701,
        number: 17,
        title: "TASK-150: Add metadata visibility helpers",
        state: "open",
        draft: false,
        merged: false,
        htmlUrl: "https://github.example.test/acme/control-plane/pull/17",
        author: {
          id: 501,
          login: "rory",
          type: "User",
          htmlUrl: "https://github.example.test/rory",
        },
        headRefName: "aicp/task-150",
        baseRefName: "main",
        updatedAt: "2026-05-24T12:00:00.000Z",
      },
    });
    expect(serialized).not.toMatch(/body text|comments|review_comments|diff_url|patch_url/iu);
    expect(serialized).not.toMatch(/\b(?:raw_payload|diff|patch|snippet|source|content)\b/iu);
  });

  it("parses default branch push webhooks without commit messages, changed paths, or pusher data", () => {
    const envelope = parseGitHubWebhookEnvelope({
      headers: headers({ "x-github-event": "push" }),
      payload: pushPayload(),
    });
    const serialized = JSON.stringify(envelope);

    expect(envelope).toEqual({
      deliveryId,
      eventName: "push",
      action: "pushed",
      installationId: 42,
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
      repositories: [],
      push: {
        defaultBranchPush: true,
        ref: "refs/heads/main",
      },
    });
    expect(serialized).not.toContain("Do not expose commit messages.");
    expect(serialized).not.toContain("source-should-not-leave");
    expect(serialized).not.toContain("do-not-expose@example.test");
    expect(serialized).not.toMatch(/\b(?:commits|head_commit|added|modified|removed|pusher)\b/iu);
  });

  it("fails safely for unsupported events, malformed delivery ids, and invalid payloads", () => {
    const unsafePayload = {
      action: "opened",
      installation: {
        id: 42,
      },
      token: fakeErrorToken,
      body: "Do not echo this body.",
    };
    const invalidCases = [
      () => parseGitHubWebhookHeaders(headers({ "x-github-event": "issues" })),
      () => parseGitHubWebhookHeaders(headers({ "x-github-delivery": "../bad" })),
      () =>
        parseGitHubWebhookEnvelope({
          headers: headers(),
          payload: unsafePayload,
        }),
    ];

    for (const execute of invalidCases) {
      expect(execute).toThrow(GitHubWebhookError);

      try {
        execute();
      } catch (error) {
        expect(String(error)).not.toContain(fakeErrorToken);
        expect(String(error)).not.toContain("Do not echo");
        expect(JSON.stringify((error as GitHubWebhookError).metadata)).not.toContain(
          fakeErrorToken,
        );
        expect(JSON.stringify((error as GitHubWebhookError).metadata)).not.toContain("Do not echo");
      }
    }
  });

  it("verifies valid sha256 webhook signatures over the raw payload", () => {
    expect(() => verifyGitHubWebhookSignature(signatureInput())).not.toThrow();
  });

  it("fails closed when the sha256 signature header is missing", () => {
    expect(() =>
      verifyGitHubWebhookSignature(
        signatureInput({
          headers: headers(),
        }),
      ),
    ).toThrowError(GitHubWebhookError);

    try {
      verifyGitHubWebhookSignature(
        signatureInput({
          headers: headers(),
        }),
      );
    } catch (error) {
      expect((error as GitHubWebhookError).code).toBe("missing_signature");
    }
  });

  it("fails closed when the sha256 signature header is malformed", () => {
    for (const signature of [
      "sha1=0123456789abcdef",
      "sha256=not-hex",
      `sha256=${"a".repeat(63)}`,
      ` sha256=${"a".repeat(64)}`,
    ]) {
      expect(() =>
        verifyGitHubWebhookSignature(
          signatureInput({
            headers: headers({
              "x-hub-signature-256": signature,
            }),
          }),
        ),
      ).toThrowError(GitHubWebhookError);

      try {
        verifyGitHubWebhookSignature(
          signatureInput({
            headers: headers({
              "x-hub-signature-256": signature,
            }),
          }),
        );
      } catch (error) {
        expect((error as GitHubWebhookError).code).toBe("invalid_signature");
      }
    }
  });

  it("fails closed when the sha256 signature digest does not match", () => {
    expect(() =>
      verifyGitHubWebhookSignature(
        signatureInput({
          headers: headers({
            "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
          }),
        }),
      ),
    ).toThrowError(GitHubWebhookError);

    try {
      verifyGitHubWebhookSignature(
        signatureInput({
          headers: headers({
            "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
          }),
        }),
      );
    } catch (error) {
      expect((error as GitHubWebhookError).code).toBe("invalid_signature");
    }
  });

  it("fails closed when the webhook secret is absent, blank, or still a placeholder", () => {
    for (const secret of [undefined, "", "   ", "<github-webhook-secret-placeholder>"]) {
      expect(() =>
        verifyGitHubWebhookSignature(
          signatureInput({
            secret,
          }),
        ),
      ).toThrowError(GitHubWebhookError);

      try {
        verifyGitHubWebhookSignature(
          signatureInput({
            secret,
          }),
        );
      } catch (error) {
        expect((error as GitHubWebhookError).code).toBe("invalid_secret");
      }
    }
  });

  it("does not echo secrets, raw bodies, URLs, PR body text, or source-like payload values in signature errors", () => {
    const payload = JSON.stringify({
      ...pullRequestPayload(),
      secret: fakeErrorToken,
      source: "const shouldNotLeak = true;",
      pull_request: {
        ...pullRequestPayload().pull_request,
        body: "Do not echo this PR body.",
        diff_url: "https://github.example.test/acme/control-plane/pull/17.diff",
        patch_url: "https://github.example.test/acme/control-plane/pull/17.patch",
      },
    });

    try {
      verifyGitHubWebhookSignature(
        signatureInput({
          headers: headers({
            "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
          }),
          payload,
        }),
      );
    } catch (error) {
      const serializedError = JSON.stringify({
        message: String(error),
        metadata: (error as GitHubWebhookError).metadata,
      });

      expect(serializedError).not.toContain(webhookSecret);
      expect(serializedError).not.toContain(fakeErrorToken);
      expect(serializedError).not.toContain(payload);
      expect(serializedError).not.toContain("Do not echo this PR body");
      expect(serializedError).not.toContain("diff_url");
      expect(serializedError).not.toContain("patch_url");
      expect(serializedError).not.toContain("const shouldNotLeak");
      return;
    }

    throw new Error("Expected invalid signature to fail.");
  });
});
