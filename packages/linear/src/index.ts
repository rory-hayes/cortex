export const LINEAR_TASK_SOURCE_TYPE = "linear" as const;
export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql" as const;

export interface LinearClientConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly apiBaseUrl?: string;
  readonly oauthBaseUrl?: string;
}

export interface LinearOAuthAuthorizeInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scopes: readonly string[];
}

export interface LinearOAuthTokenExchangeInput {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier?: string;
}

export interface LinearOAuthTokenMetadata {
  readonly tokenType: "bearer";
  readonly scope?: string;
  readonly expiresAt?: string;
}

export interface LinearIssueMetadata {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly url?: string;
  readonly teamId?: string;
  readonly projectId?: string;
  readonly stateId?: string;
  readonly stateName?: string;
  readonly assigneeId?: string;
  readonly labels?: readonly string[];
  readonly updatedAt: string;
}

export interface LinearIssueSyncMetadata {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly status: string;
}

export interface LinearTeamOption {
  readonly id: string;
  readonly key?: string;
  readonly name: string;
}

export interface LinearProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface LinearWorkflowStateOption {
  readonly id: string;
  readonly name: string;
  readonly teamId?: string;
  readonly type?: string;
}

export interface LinearIssueCreateInput {
  readonly description: string;
  readonly projectId?: string;
  readonly stateId?: string;
  readonly teamId: string;
  readonly title: string;
}

export interface LinearIssueStateUpdateInput {
  readonly issueId: string;
  readonly stateId: string;
}

export interface LinearFetchInit {
  readonly body: string;
  readonly headers: {
    readonly Authorization: string;
    readonly "Content-Type": "application/json";
  };
  readonly method: "POST";
}

export interface LinearFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}

export type LinearFetch = (url: string, init: LinearFetchInit) => Promise<LinearFetchResponse>;

export interface LinearGraphQLClient {
  readonly createIssue: (input: LinearIssueCreateInput) => Promise<LinearIssueSyncMetadata>;
  readonly listProjects: () => Promise<LinearProjectOption[]>;
  readonly listTeams: () => Promise<LinearTeamOption[]>;
  readonly listWorkflowStates: (input?: {
    readonly teamId?: string;
  }) => Promise<LinearWorkflowStateOption[]>;
  readonly updateIssueState: (
    input: LinearIssueStateUpdateInput,
  ) => Promise<LinearIssueSyncMetadata>;
}

export class LinearGraphQLClientError extends Error {
  readonly code = "linear_graphql_request_failed" as const;

  constructor() {
    super("Linear GraphQL request failed.");
    this.name = "LinearGraphQLClientError";
  }
}

const textMaxLength = 1_000;
const issueDescriptionMaxLength = 5_000;
const credentialMaxLength = 2_000;
const idMaxLength = 240;
const nameMaxLength = 240;
const urlMaxLength = 2_048;
const optionLimit = 100;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const unsafeTextPattern =
  /(?:diff --git|@@|-----BEGIN|(?:api[_-]?key|apikey|access[_-]?token|accessToken|auth[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|lin_api_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/iu;
const unsafeUrlQueryKeyPattern =
  /^(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)$/iu;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const hasIssueDescriptionControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode === 10) {
      continue;
    }

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const normalizeText = (value: string, maxLength = textMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    unsafeTextPattern.test(normalizedValue)
  ) {
    throw new LinearGraphQLClientError();
  }

  return normalizedValue;
};

const normalizeIssueDescription = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > issueDescriptionMaxLength ||
    hasIssueDescriptionControlCharacter(normalizedValue) ||
    unsafeTextPattern.test(normalizedValue)
  ) {
    throw new LinearGraphQLClientError();
  }

  return normalizedValue;
};

const normalizeCredentialText = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > credentialMaxLength ||
    hasControlCharacter(normalizedValue) ||
    /\s/u.test(normalizedValue)
  ) {
    throw new LinearGraphQLClientError();
  }

  return normalizedValue;
};

const normalizeId = (value: string): string => {
  const normalizedValue = normalizeText(value, idMaxLength);

  if (!idPattern.test(normalizedValue)) {
    throw new LinearGraphQLClientError();
  }

  return normalizedValue;
};

const normalizeOptionalId = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? normalizeId(value) : undefined;

const normalizeOptionalText = (value: unknown, maxLength = nameMaxLength): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? normalizeText(value, maxLength)
    : undefined;

const normalizeOptionalUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const normalizedValue = normalizeText(value, urlMaxLength);
  let url: URL;

  try {
    url = new URL(normalizedValue);
  } catch {
    throw new LinearGraphQLClientError();
  }

  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw new LinearGraphQLClientError();
  }

  for (const key of url.searchParams.keys()) {
    if (unsafeUrlQueryKeyPattern.test(key)) {
      throw new LinearGraphQLClientError();
    }
  }

  return url.toString();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }

  const child = value[key];

  return isRecord(child) ? child : null;
};

const getNodes = (data: unknown, key: string): unknown[] => {
  const connection = getRecord(data, key);
  const nodes = connection?.nodes;

  if (!Array.isArray(nodes)) {
    throw new LinearGraphQLClientError();
  }

  return nodes.slice(0, optionLimit);
};

const uniqueById = <T extends { readonly id: string }>(items: readonly T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
};

const toTeamOption = (value: unknown): LinearTeamOption => {
  if (!isRecord(value)) {
    throw new LinearGraphQLClientError();
  }

  const id = typeof value.id === "string" ? normalizeId(value.id) : null;
  const name = typeof value.name === "string" ? normalizeText(value.name, nameMaxLength) : null;
  const key = normalizeOptionalText(value.key, 24);

  if (id === null || name === null) {
    throw new LinearGraphQLClientError();
  }

  return {
    id,
    ...(key === undefined ? {} : { key }),
    name,
  };
};

const toProjectOption = (value: unknown): LinearProjectOption => {
  if (!isRecord(value)) {
    throw new LinearGraphQLClientError();
  }

  const id = typeof value.id === "string" ? normalizeId(value.id) : null;
  const name = typeof value.name === "string" ? normalizeText(value.name, nameMaxLength) : null;

  if (id === null || name === null) {
    throw new LinearGraphQLClientError();
  }

  return { id, name };
};

const toWorkflowStateOption = (value: unknown): LinearWorkflowStateOption => {
  if (!isRecord(value)) {
    throw new LinearGraphQLClientError();
  }

  const id = typeof value.id === "string" ? normalizeId(value.id) : null;
  const name = typeof value.name === "string" ? normalizeText(value.name, nameMaxLength) : null;
  const teamId = normalizeOptionalId(getRecord(value, "team")?.id);
  const type = normalizeOptionalText(value.type, 80);

  if (id === null || name === null) {
    throw new LinearGraphQLClientError();
  }

  return {
    id,
    name,
    ...(teamId === undefined ? {} : { teamId }),
    ...(type === undefined ? {} : { type }),
  };
};

const toIssueSyncMetadata = (value: unknown): LinearIssueSyncMetadata => {
  if (!isRecord(value)) {
    throw new LinearGraphQLClientError();
  }

  const issueId = typeof value.id === "string" ? normalizeId(value.id) : null;
  const identifier =
    typeof value.identifier === "string" ? normalizeText(value.identifier, nameMaxLength) : null;
  const title = typeof value.title === "string" ? normalizeText(value.title, nameMaxLength) : null;
  const url = normalizeOptionalUrl(value.url);
  const state = getRecord(value, "state");
  const status = normalizeOptionalText(state?.name, nameMaxLength);

  if (
    issueId === null ||
    identifier === null ||
    title === null ||
    url === undefined ||
    status === undefined
  ) {
    throw new LinearGraphQLClientError();
  }

  return {
    issueId,
    identifier,
    title,
    url,
    status,
  };
};

const defaultFetch = async (url: string, init: LinearFetchInit): Promise<LinearFetchResponse> => {
  const fetchImplementation = (globalThis as { fetch?: LinearFetch }).fetch;

  if (fetchImplementation === undefined) {
    throw new LinearGraphQLClientError();
  }

  return fetchImplementation(url, init);
};

const assertSuccessfulMutation = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value) || value.success !== true || !isRecord(value.issue)) {
    throw new LinearGraphQLClientError();
  }

  return value.issue;
};

const parseGraphQLResponse = async <T>(
  response: LinearFetchResponse,
  selectData: (data: unknown) => T,
): Promise<T> => {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new LinearGraphQLClientError();
  }

  if (!response.ok || !isRecord(payload) || Array.isArray(payload.errors)) {
    throw new LinearGraphQLClientError();
  }

  return selectData(payload.data);
};

const runGraphQLRequest = async <T>(input: {
  accessToken: string;
  endpoint: string;
  fetch: LinearFetch;
  operationName: string;
  query: string;
  selectData: (data: unknown) => T;
  variables?: Record<string, unknown>;
}): Promise<T> => {
  let response: LinearFetchResponse;

  try {
    response = await input.fetch(input.endpoint, {
      body: JSON.stringify({
        operationName: input.operationName,
        query: input.query,
        variables: input.variables ?? {},
      }),
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new LinearGraphQLClientError();
  }

  return parseGraphQLResponse(response, input.selectData);
};

const issueSyncMetadataSelection = `
  id
  identifier
  title
  url
  state {
    name
  }
`;

export const createLinearGraphQLClient = (input: {
  readonly accessToken: string;
  readonly endpoint?: string;
  readonly fetch?: LinearFetch;
}): LinearGraphQLClient => {
  const accessToken = normalizeCredentialText(input.accessToken);
  const endpoint = input.endpoint ?? LINEAR_GRAPHQL_ENDPOINT;
  const fetchImplementation = input.fetch ?? defaultFetch;
  const request = <T>(requestInput: {
    operationName: string;
    query: string;
    selectData: (data: unknown) => T;
    variables?: Record<string, unknown>;
  }) =>
    runGraphQLRequest({
      accessToken,
      endpoint,
      fetch: fetchImplementation,
      ...requestInput,
    });

  return {
    createIssue: async (createInput) => {
      const variablesInput: Record<string, string> = {
        description: normalizeIssueDescription(createInput.description),
        teamId: normalizeId(createInput.teamId),
        title: normalizeText(createInput.title, nameMaxLength),
      };
      const projectId = normalizeOptionalId(createInput.projectId);
      const stateId = normalizeOptionalId(createInput.stateId);

      if (projectId !== undefined) {
        variablesInput.projectId = projectId;
      }

      if (stateId !== undefined) {
        variablesInput.stateId = stateId;
      }

      return request({
        operationName: "LinearIssueCreate",
        query: `
          mutation LinearIssueCreate($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                ${issueSyncMetadataSelection}
              }
            }
          }
        `,
        selectData: (data) =>
          toIssueSyncMetadata(assertSuccessfulMutation(getRecord(data, "issueCreate"))),
        variables: {
          input: variablesInput,
        },
      });
    },
    listProjects: async () =>
      request({
        operationName: "LinearProjects",
        query: `
          query LinearProjects {
            projects(first: 100) {
              nodes {
                id
                name
              }
            }
          }
        `,
        selectData: (data) => uniqueById(getNodes(data, "projects").map(toProjectOption)),
      }),
    listTeams: async () =>
      request({
        operationName: "LinearTeams",
        query: `
          query LinearTeams {
            teams(first: 100) {
              nodes {
                id
                key
                name
              }
            }
          }
        `,
        selectData: (data) => uniqueById(getNodes(data, "teams").map(toTeamOption)),
      }),
    listWorkflowStates: async (listInput = {}) => {
      const teamId = normalizeOptionalId(listInput.teamId);

      return request({
        operationName: "LinearWorkflowStates",
        query: `
          query LinearWorkflowStates {
            workflowStates(first: 100) {
              nodes {
                id
                name
                type
                team {
                  id
                }
              }
            }
          }
        `,
        selectData: (data) => {
          const states = uniqueById(getNodes(data, "workflowStates").map(toWorkflowStateOption));

          return teamId === undefined ? states : states.filter((state) => state.teamId === teamId);
        },
      });
    },
    updateIssueState: async (updateInput) => {
      const issueId = normalizeId(updateInput.issueId);
      const stateId = normalizeId(updateInput.stateId);

      return request({
        operationName: "LinearIssueUpdateState",
        query: `
          mutation LinearIssueUpdateState($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                ${issueSyncMetadataSelection}
              }
            }
          }
        `,
        selectData: (data) =>
          toIssueSyncMetadata(assertSuccessfulMutation(getRecord(data, "issueUpdate"))),
        variables: {
          id: issueId,
          input: {
            stateId,
          },
        },
      });
    },
  };
};
