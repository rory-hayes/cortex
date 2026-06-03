import { describe, expect, it, vi } from "vitest";

import * as linear from "@control-plane/linear";
import type {
  LinearClientConfig,
  LinearFetch,
  LinearGraphQLClient,
  LinearIssueCreateInput,
  LinearIssueMetadata,
  LinearIssueSyncMetadata,
  LinearOAuthAuthorizeInput,
  LinearOAuthTokenExchangeInput,
  LinearOAuthTokenMetadata,
  LinearProjectOption,
  LinearTeamOption,
  LinearWorkflowStateOption,
} from "@control-plane/linear";

const expectedRuntimeExportKeys = [
  "LINEAR_GRAPHQL_ENDPOINT",
  "LINEAR_TASK_SOURCE_TYPE",
  "LinearGraphQLClientError",
  "createLinearGraphQLClient",
] as const;

type PublicLinearTypeImports = readonly [
  LinearClientConfig,
  LinearOAuthAuthorizeInput,
  LinearOAuthTokenExchangeInput,
  LinearOAuthTokenMetadata,
  LinearIssueMetadata,
  LinearFetch,
  LinearGraphQLClient,
  LinearIssueCreateInput,
  LinearProjectOption,
  LinearTeamOption,
  LinearWorkflowStateOption,
  LinearIssueSyncMetadata,
];

const publicLinearTypeImports: PublicLinearTypeImports | null = null;

describe("@control-plane/linear entrypoint", () => {
  it("exports only safe runtime constants", () => {
    expect(Object.keys(linear).sort()).toEqual([...expectedRuntimeExportKeys].sort());
    expect(linear.LINEAR_GRAPHQL_ENDPOINT).toBe("https://api.linear.app/graphql");
    expect(linear.LINEAR_TASK_SOURCE_TYPE).toBe("linear");
  });

  it("exposes public Linear integration types without runtime behavior", () => {
    const clientConfig = {
      clientId: "linear-client-id",
      redirectUri: "https://control-plane.example/linear/callback",
      scopes: ["read", "write"],
    } satisfies LinearClientConfig;

    const authorizeInput = {
      clientId: clientConfig.clientId,
      redirectUri: clientConfig.redirectUri,
      state: "opaque-state-id",
      scopes: clientConfig.scopes,
    } satisfies LinearOAuthAuthorizeInput;

    const tokenExchangeInput = {
      code: "oauth-code",
      redirectUri: clientConfig.redirectUri,
      codeVerifier: "pkce-verifier",
    } satisfies LinearOAuthTokenExchangeInput;

    const tokenMetadata = {
      tokenType: "bearer",
      scope: "read,write",
      expiresAt: "2026-05-24T14:00:00.000Z",
    } satisfies LinearOAuthTokenMetadata;

    const issueMetadata = {
      issueId: "lin-issue-id",
      identifier: "ENG-123",
      title: "Prepare metadata-only task packet",
      url: "https://linear.app/example/issue/ENG-123",
      teamId: "team-id",
      projectId: "project-id",
      stateId: "state-id",
      stateName: "Todo",
      assigneeId: "user-id",
      labels: ["Ready for AI"],
      updatedAt: "2026-05-24T14:00:00.000Z",
    } satisfies LinearIssueMetadata;
    const createInput = {
      description: "Metadata-only Cortex Task summary.",
      projectId: "project-id",
      stateId: "state-id",
      teamId: "team-id",
      title: "Prepare metadata-only task packet",
    } satisfies LinearIssueCreateInput;
    const teamOption = {
      id: "team-id",
      key: "ENG",
      name: "Engineering",
    } satisfies LinearTeamOption;
    const projectOption = {
      id: "project-id",
      name: "Control Plane",
    } satisfies LinearProjectOption;
    const workflowStateOption = {
      id: "state-id",
      name: "Todo",
      teamId: "team-id",
      type: "unstarted",
    } satisfies LinearWorkflowStateOption;
    const syncMetadata = {
      identifier: "ENG-123",
      issueId: "lin-issue-id",
      status: "Todo",
      title: "Prepare metadata-only task packet",
      url: "https://linear.app/example/issue/ENG-123",
    } satisfies LinearIssueSyncMetadata;

    expect(authorizeInput.state).toBe("opaque-state-id");
    expect(tokenExchangeInput.codeVerifier).toBe("pkce-verifier");
    expect(createInput.description).not.toContain("diff --git");
    expect(teamOption.key).toBe("ENG");
    expect(projectOption.name).toBe("Control Plane");
    expect(workflowStateOption.teamId).toBe("team-id");
    expect(syncMetadata.status).toBe("Todo");
    expect(tokenMetadata).not.toHaveProperty("accessToken");
    expect(issueMetadata).not.toHaveProperty("body");
    expect(issueMetadata).not.toHaveProperty("description");
    expect(issueMetadata).not.toHaveProperty("comments");
    expect(syncMetadata).not.toHaveProperty("body");
    expect(syncMetadata).not.toHaveProperty("description");
    expect(syncMetadata).not.toHaveProperty("comments");
    expect(syncMetadata).not.toHaveProperty("accessToken");
    expect(syncMetadata).not.toHaveProperty("ciphertext");
    expect(syncMetadata).not.toHaveProperty("rawOutput");
    expect(syncMetadata).not.toHaveProperty("source");
    expect(syncMetadata).not.toHaveProperty("diff");
    expect(syncMetadata).not.toHaveProperty("patch");
    expect(publicLinearTypeImports).toBeNull();
  });
});

const linearAccessToken = "lin_api_safe_test_token_123456789";

const createJsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  ({
    json: async () => body,
    ok: init.ok ?? true,
    status: init.status ?? 200,
  }) satisfies Awaited<ReturnType<LinearFetch>>;

const getFetchJsonBody = (fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) => {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { body?: string } | undefined;

  if (init === undefined || typeof init.body !== "string") {
    throw new Error("Expected fetch body.");
  }

  return JSON.parse(init.body) as {
    operationName?: string;
    query?: string;
    variables?: Record<string, unknown>;
  };
};

const createClient = (fetchMock: LinearFetch): LinearGraphQLClient =>
  linear.createLinearGraphQLClient({
    accessToken: linearAccessToken,
    fetch: fetchMock,
  });

const expectNoTokenMaterial = (value: unknown) => {
  expect(JSON.stringify(value)).not.toContain(linearAccessToken);
};

describe("Linear GraphQL client", () => {
  it("sends bearer auth for GraphQL requests without returning token text", async () => {
    const fetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        data: {
          teams: {
            nodes: [{ id: " team-id ", key: " ENG ", name: " Engineering " }],
          },
        },
      }),
    );
    const client = createClient(fetchMock);

    const teams = await client.listTeams();

    expect(fetchMock).toHaveBeenCalledWith(linear.LINEAR_GRAPHQL_ENDPOINT, {
      body: expect.any(String),
      headers: {
        Authorization: `Bearer ${linearAccessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    expect(getFetchJsonBody(fetchMock).operationName).toBe("LinearTeams");
    expect(teams).toEqual([{ id: "team-id", key: "ENG", name: "Engineering" }]);
    expectNoTokenMaterial(teams);
  });

  it("lists teams, projects, and workflow states as bounded safe options", async () => {
    const fetchMock = vi
      .fn<LinearFetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            teams: {
              nodes: [
                { id: "team-1", key: "ENG", name: "Engineering" },
                { id: "team-1", key: "ENG", name: "Engineering duplicate" },
                { id: "team-2", key: null, name: "Product" },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            projects: {
              nodes: [
                { id: "project-1", name: "Control Plane" },
                { id: "project-1", name: "Duplicate project" },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            workflowStates: {
              nodes: [
                {
                  id: "state-1",
                  name: "Todo",
                  team: { id: "team-1" },
                  type: "unstarted",
                },
                {
                  id: "state-2",
                  name: "Done",
                  team: { id: "team-2" },
                  type: "completed",
                },
              ],
            },
          },
        }),
      );
    const client = createClient(fetchMock);

    await expect(client.listTeams()).resolves.toEqual([
      { id: "team-1", key: "ENG", name: "Engineering" },
      { id: "team-2", name: "Product" },
    ]);
    await expect(client.listProjects()).resolves.toEqual([
      { id: "project-1", name: "Control Plane" },
    ]);
    await expect(client.listWorkflowStates({ teamId: "team-1" })).resolves.toEqual([
      { id: "state-1", name: "Todo", teamId: "team-1", type: "unstarted" },
    ]);
    expect(getFetchJsonBody(fetchMock, 2).operationName).toBe("LinearWorkflowStates");
  });

  it("creates issues with title, description, team, optional project, and optional state", async () => {
    const fetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        data: {
          issueCreate: {
            issue: {
              id: "issue-id",
              identifier: "ENG-123",
              project: { id: "project-id" },
              state: { id: "state-id", name: "Todo" },
              team: { id: "team-id" },
              title: "Sync Cortex Task",
              updatedAt: "2026-05-26T14:00:00.000Z",
              url: "https://linear.app/example/issue/ENG-123/sync-cortex-task",
            },
            success: true,
          },
        },
      }),
    );
    const client = createClient(fetchMock);

    const issue = await client.createIssue({
      description: "Cortex Task metadata only.",
      projectId: "project-id",
      stateId: "state-id",
      teamId: "team-id",
      title: "Sync Cortex Task",
    });

    expect(getFetchJsonBody(fetchMock)).toMatchObject({
      operationName: "LinearIssueCreate",
      variables: {
        input: {
          description: "Cortex Task metadata only.",
          projectId: "project-id",
          stateId: "state-id",
          teamId: "team-id",
          title: "Sync Cortex Task",
        },
      },
    });
    expect(issue).toEqual({
      issueId: "issue-id",
      identifier: "ENG-123",
      status: "Todo",
      title: "Sync Cortex Task",
      url: "https://linear.app/example/issue/ENG-123/sync-cortex-task",
    });
    expect(Object.keys(issue).sort()).toEqual(["identifier", "issueId", "status", "title", "url"]);
    expectNoTokenMaterial(issue);
  });

  it("allows safe multiline issue descriptions larger than the default text limit", async () => {
    const fetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        data: {
          issueCreate: {
            issue: {
              id: "issue-id",
              identifier: "ENG-123",
              project: null,
              state: { id: "state-id", name: "Todo" },
              team: { id: "team-id" },
              title: "Sync Cortex Task",
              updatedAt: "2026-05-26T14:00:00.000Z",
              url: "https://linear.app/example/issue/ENG-123/sync-cortex-task",
            },
            success: true,
          },
        },
      }),
    );
    const client = createClient(fetchMock);
    const safeDescription = [
      "Cortex Task metadata only.",
      "Objective: " + "safe metadata ".repeat(95),
      "Acceptance criteria:",
      "- Keep hosted sync metadata-only.",
    ].join("\n");

    expect(safeDescription.length).toBeGreaterThan(1_000);

    await expect(
      client.createIssue({
        description: safeDescription,
        teamId: "team-id",
        title: "Sync Cortex Task",
      }),
    ).resolves.toMatchObject({
      issueId: "issue-id",
    });
    expect(getFetchJsonBody(fetchMock)).toMatchObject({
      operationName: "LinearIssueCreate",
      variables: {
        input: {
          description: safeDescription,
          teamId: "team-id",
          title: "Sync Cortex Task",
        },
      },
    });
  });

  it("updates an existing issue state with issueUpdate", async () => {
    const fetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        data: {
          issueUpdate: {
            issue: {
              id: "issue-id",
              identifier: "ENG-123",
              project: null,
              state: { id: "state-done", name: "Done" },
              team: { id: "team-id" },
              title: "Sync Cortex Task",
              updatedAt: "2026-05-26T15:00:00.000Z",
              url: "https://linear.app/example/issue/ENG-123/sync-cortex-task",
            },
            success: true,
          },
        },
      }),
    );
    const client = createClient(fetchMock);

    const issue = await client.updateIssueState({
      issueId: "issue-id",
      stateId: "state-done",
    });

    expect(getFetchJsonBody(fetchMock)).toMatchObject({
      operationName: "LinearIssueUpdateState",
      variables: {
        id: "issue-id",
        input: {
          stateId: "state-done",
        },
      },
    });
    expect(issue).toEqual({
      issueId: "issue-id",
      identifier: "ENG-123",
      status: "Done",
      title: "Sync Cortex Task",
      url: "https://linear.app/example/issue/ENG-123/sync-cortex-task",
    });
    expect(Object.keys(issue).sort()).toEqual(["identifier", "issueId", "status", "title", "url"]);
  });

  it("requires create and update responses to include a canonical issue URL", async () => {
    const fetchMock = vi
      .fn<LinearFetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            issueCreate: {
              issue: {
                id: "issue-id",
                identifier: "ENG-123",
                state: { id: "state-id", name: "Todo" },
                title: "Sync Cortex Task",
                updatedAt: "2026-05-26T14:00:00.000Z",
              },
              success: true,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            issueUpdate: {
              issue: {
                id: "issue-id",
                identifier: "ENG-123",
                state: { id: "state-done", name: "Done" },
                title: "Sync Cortex Task",
                updatedAt: "2026-05-26T15:00:00.000Z",
              },
              success: true,
            },
          },
        }),
      );
    const client = createClient(fetchMock);

    await expect(
      client.createIssue({
        description: "Cortex Task metadata only.",
        teamId: "team-id",
        title: "Sync Cortex Task",
      }),
    ).rejects.toBeInstanceOf(linear.LinearGraphQLClientError);
    await expect(
      client.updateIssueState({
        issueId: "issue-id",
        stateId: "state-done",
      }),
    ).rejects.toBeInstanceOf(linear.LinearGraphQLClientError);
  });

  it("converts HTTP and GraphQL failures to generic safe errors", async () => {
    const httpFetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse(
        {
          errors: [{ message: `HTTP failure includes ${linearAccessToken}` }],
        },
        { ok: false, status: 401 },
      ),
    );
    const graphqlFetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        errors: [{ message: `GraphQL failure includes ${linearAccessToken}` }],
      }),
    );

    await expect(createClient(httpFetchMock).listTeams()).rejects.toBeInstanceOf(
      linear.LinearGraphQLClientError,
    );
    await expect(createClient(graphqlFetchMock).listTeams()).rejects.toMatchObject({
      code: "linear_graphql_request_failed",
      message: "Linear GraphQL request failed.",
    });

    const [httpResult, graphqlResult] = await Promise.allSettled([
      createClient(httpFetchMock).listTeams(),
      createClient(graphqlFetchMock).listTeams(),
    ]);

    expectNoTokenMaterial(httpResult);
    expectNoTokenMaterial(graphqlResult);
  });
});
