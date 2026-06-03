import { describe, expect, test, vi } from "vitest";

import type { LinearFetch } from "@control-plane/linear";

vi.mock("server-only", () => ({}));

const importTaskSyncClient = async () => import("./task-sync-client");

const accessToken = "linear-access-token-plaintext";

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

const expectNoBearerMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain(accessToken);
  expect(serialized).not.toContain(`Bearer ${accessToken}`);
  expect(serialized).not.toContain("Authorization");
};

describe("Linear task sync client", () => {
  test("lists bounded team, project, and status options through mocked fetch", async () => {
    const { createLinearTaskSyncClient } = await importTaskSyncClient();
    const fetchMock = vi
      .fn<LinearFetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            teams: {
              nodes: Array.from({ length: 105 }, (_item, index) => ({
                id: `team-${index}`,
                key: `T${index}`,
                name: `Team ${index}`,
              })),
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
                { id: "project-1", name: "Duplicate Control Plane" },
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
                { id: "state-1", name: "Todo", team: { id: "team-1" }, type: "unstarted" },
                { id: "state-2", name: "Done", team: { id: "team-2" }, type: "completed" },
              ],
            },
          },
        }),
      );
    const client = createLinearTaskSyncClient({ accessToken, fetch: fetchMock });

    await expect(client.listTeams()).resolves.toHaveLength(100);
    await expect(client.listProjects()).resolves.toEqual([
      { id: "project-1", name: "Control Plane" },
    ]);
    await expect(client.listWorkflowStates({ teamId: "team-1" })).resolves.toEqual([
      { id: "state-1", name: "Todo", teamId: "team-1", type: "unstarted" },
    ]);

    expect(getFetchJsonBody(fetchMock, 0).operationName).toBe("LinearTeams");
    expect(getFetchJsonBody(fetchMock, 1).operationName).toBe("LinearProjects");
    expect(getFetchJsonBody(fetchMock, 2).operationName).toBe("LinearWorkflowStates");
  });

  test("creates issues with safe Markdown body and never returns bearer token material", async () => {
    const { createLinearTaskSyncClient } = await importTaskSyncClient();
    const fetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        data: {
          issueCreate: {
            issue: {
              id: "linear_issue_222",
              identifier: "ENG-222",
              project: { id: "linear_project_1" },
              state: { id: "linear_state_todo", name: "Todo" },
              team: { id: "linear_team_1" },
              title: "Sync approved task to Linear",
              updatedAt: "2026-05-26T16:00:00.000Z",
              url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
            },
            success: true,
          },
        },
      }),
    );
    const client = createLinearTaskSyncClient({ accessToken, fetch: fetchMock });
    const description = [
      "Cortex Task: Sync approved task to Linear",
      "",
      "Acceptance criteria:",
      "- Keep hosted sync metadata-only.",
    ].join("\n");

    const issue = await client.createIssue({
      description,
      projectId: "linear_project_1",
      stateId: "linear_state_todo",
      teamId: "linear_team_1",
      title: "Sync approved task to Linear",
    });

    expect(getFetchJsonBody(fetchMock)).toMatchObject({
      operationName: "LinearIssueCreate",
      variables: {
        input: {
          description,
          projectId: "linear_project_1",
          stateId: "linear_state_todo",
          teamId: "linear_team_1",
          title: "Sync approved task to Linear",
        },
      },
    });
    expect(issue).toMatchObject({
      identifier: "ENG-222",
      issueId: "linear_issue_222",
      status: "Todo",
      title: "Sync approved task to Linear",
      url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
    });
    expect(Object.keys(issue).sort()).toEqual(["identifier", "issueId", "status", "title", "url"]);
    expectNoBearerMaterial(issue);
  });

  test("rejects unsafe Linear API responses without exposing bearer token material", async () => {
    const { LinearTaskSyncClientError, createLinearTaskSyncClient } = await importTaskSyncClient();
    const fetchMock = vi.fn<LinearFetch>(async () =>
      createJsonResponse({
        data: {
          issueCreate: {
            issue: {
              id: "linear_issue_222",
              identifier: "ENG-222",
              state: { id: "linear_state_todo", name: "Todo" },
              team: { id: "linear_team_1" },
              title: "diff --git a/app.ts b/app.ts",
              updatedAt: "2026-05-26T16:00:00.000Z",
              url: "https://linear.app/control-plane/issue/ENG-222?token",
            },
            success: true,
          },
        },
      }),
    );
    const client = createLinearTaskSyncClient({ accessToken, fetch: fetchMock });

    const result = await Promise.allSettled([
      client.createIssue({
        description: "Cortex Task metadata only.",
        teamId: "linear_team_1",
        title: "Sync approved task to Linear",
      }),
    ]);

    expect(result[0]).toMatchObject({
      reason: expect.any(LinearTaskSyncClientError),
      status: "rejected",
    });
    expect(JSON.stringify(result)).not.toContain("diff --git");
    expectNoBearerMaterial(result);
  });
});
