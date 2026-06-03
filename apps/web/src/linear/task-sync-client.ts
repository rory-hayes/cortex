import "server-only";

import {
  createLinearGraphQLClient,
  type LinearFetch,
  type LinearGraphQLClient,
  type LinearIssueCreateInput,
  type LinearIssueSyncMetadata,
  type LinearIssueStateUpdateInput,
  type LinearProjectOption,
  type LinearTeamOption,
  type LinearWorkflowStateOption,
} from "@control-plane/linear";

export type LinearTaskSyncClient = {
  readonly createIssue: (input: LinearIssueCreateInput) => Promise<LinearIssueSyncMetadata>;
  readonly listProjects: () => Promise<LinearProjectOption[]>;
  readonly listTeams: () => Promise<LinearTeamOption[]>;
  readonly listWorkflowStates: (input?: {
    readonly teamId?: string;
  }) => Promise<LinearWorkflowStateOption[]>;
  readonly updateIssueState: (
    input: LinearIssueStateUpdateInput,
  ) => Promise<LinearIssueSyncMetadata>;
};

export class LinearTaskSyncClientError extends Error {
  readonly code = "linear_task_sync_client_failed" as const;

  constructor() {
    super("Linear task sync client request failed.");
    this.name = "LinearTaskSyncClientError";
  }
}

const wrapLinearClientCall = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new LinearTaskSyncClientError();
  }
};

const createSafeClient = (input: {
  accessToken: string;
  endpoint?: string;
  fetch?: LinearFetch;
}): LinearGraphQLClient => {
  try {
    return createLinearGraphQLClient(input);
  } catch {
    throw new LinearTaskSyncClientError();
  }
};

export const createLinearTaskSyncClient = (input: {
  accessToken: string;
  endpoint?: string;
  fetch?: LinearFetch;
}): LinearTaskSyncClient => {
  const client = createSafeClient(input);

  return {
    createIssue: (issueInput) => wrapLinearClientCall(() => client.createIssue(issueInput)),
    listProjects: () => wrapLinearClientCall(() => client.listProjects()),
    listTeams: () => wrapLinearClientCall(() => client.listTeams()),
    listWorkflowStates: (listInput) =>
      wrapLinearClientCall(() => client.listWorkflowStates(listInput)),
    updateIssueState: (updateInput) =>
      wrapLinearClientCall(() => client.updateIssueState(updateInput)),
  };
};
