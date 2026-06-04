import "server-only";

import type { GitHubAppRequest, GitHubAppRequestFunction } from "@control-plane/github";

import { createActionError } from "../server/errors";

type FetchFunction = typeof fetch;

type CreatePublicGitHubRequestFunctionOptions = {
  apiBaseUrl?: string;
  fetch?: FetchFunction;
};

const defaultApiBaseUrl = "https://api.github.com";
const allowedOperations = new Set(["getRepositoryFile", "getRepositoryTree"]);

const assertConfiguredText = (value: string | undefined): string => {
  const normalizedValue = value?.trim() ?? "";

  if (
    normalizedValue.length === 0 ||
    normalizedValue.startsWith("<") ||
    normalizedValue.endsWith(">")
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const buildGitHubUrl = (
  apiBaseUrl: string,
  path: string,
  query: GitHubAppRequest["query"],
): string => {
  let url: URL;

  try {
    url = new URL(path, apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`);
  } catch {
    throw createActionError("validation_error");
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw createActionError("validation_error");
  }

  if (!url.pathname.startsWith("/repos/")) {
    throw createActionError("validation_error");
  }

  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const assertPublicMetadataRequest = (request: GitHubAppRequest): void => {
  if (
    request.method !== "GET" ||
    request.body !== undefined ||
    !allowedOperations.has(request.operation)
  ) {
    throw createActionError("validation_error");
  }

  if (
    request.operation === "getRepositoryTree" &&
    !/^\/repos\/[^/]+\/[^/]+\/git\/trees\/[^/]+$/u.test(request.path)
  ) {
    throw createActionError("validation_error");
  }

  if (
    request.operation === "getRepositoryFile" &&
    !/^\/repos\/[^/]+\/[^/]+\/contents\/.+$/u.test(request.path)
  ) {
    throw createActionError("validation_error");
  }
};

const parseGitHubResponse = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw createActionError("validation_error");
  }

  try {
    return await response.json();
  } catch {
    throw createActionError("validation_error");
  }
};

export const createPublicGitHubRequestFunction = (
  options: CreatePublicGitHubRequestFunctionOptions = {},
): GitHubAppRequestFunction => {
  const apiBaseUrl = assertConfiguredText(options.apiBaseUrl ?? defaultApiBaseUrl);
  const fetchFn = options.fetch ?? fetch;

  return async (request) => {
    assertPublicMetadataRequest(request);

    const response = await fetchFn(buildGitHubUrl(apiBaseUrl, request.path, request.query), {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "cortex-public-repo-readiness",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method: "GET",
    });

    return parseGitHubResponse(response);
  };
};
