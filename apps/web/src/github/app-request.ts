import "server-only";

import { createPrivateKey, sign } from "node:crypto";

import type { GitHubAppRequest, GitHubAppRequestFunction } from "@control-plane/github";

import { createActionError } from "../server/errors";

type FetchFunction = typeof fetch;

type InstallationToken = {
  expiresAtMs: number;
  token: string;
};

type CreateGitHubAppRequestFunctionOptions = {
  apiBaseUrl?: string;
  appId?: string;
  fetch?: FetchFunction;
  now?: () => Date;
  privateKey?: string;
};

const defaultApiBaseUrl = "https://api.github.com";
const tokenRefreshSkewMs = 60_000;

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

const normalizePrivateKey = (value: string): string => value.replace(/\\n/gu, "\n");

const toBase64UrlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const createGitHubAppJwt = (input: { appId: string; now: Date; privateKey: string }): string => {
  const issuedAt = Math.floor(input.now.getTime() / 1_000) - 60;
  const expiresAt = issuedAt + 9 * 60;
  const header = toBase64UrlJson({
    alg: "RS256",
    typ: "JWT",
  });
  const payload = toBase64UrlJson({
    exp: expiresAt,
    iat: issuedAt,
    iss: input.appId,
  });
  const signingInput = `${header}.${payload}`;

  try {
    const privateKey = createPrivateKey(normalizePrivateKey(input.privateKey));
    const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString(
      "base64url",
    );

    return `${signingInput}.${signature}`;
  } catch {
    throw createActionError("validation_error");
  }
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

  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const parseInstallationToken = async (response: Response): Promise<InstallationToken> => {
  if (!response.ok) {
    throw createActionError("validation_error");
  }

  const payload: unknown = await response.json();

  if (typeof payload !== "object" || payload === null) {
    throw createActionError("validation_error");
  }

  const token = (payload as Record<string, unknown>).token;
  const expiresAt = (payload as Record<string, unknown>).expires_at;

  if (typeof token !== "string" || token.trim().length === 0 || typeof expiresAt !== "string") {
    throw createActionError("validation_error");
  }

  const expiresAtMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresAtMs)) {
    throw createActionError("validation_error");
  }

  return {
    expiresAtMs,
    token,
  };
};

const parseGitHubResponse = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw createActionError("validation_error");
  }

  return response.json();
};

export const createGitHubAppRequestFunction = (
  options: CreateGitHubAppRequestFunctionOptions = {},
): GitHubAppRequestFunction => {
  const appId = assertConfiguredText(options.appId ?? process.env.GITHUB_APP_ID);
  const privateKey = assertConfiguredText(options.privateKey ?? process.env.GITHUB_APP_PRIVATE_KEY);
  const apiBaseUrl = assertConfiguredText(options.apiBaseUrl ?? defaultApiBaseUrl);
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const tokenCache = new Map<number, InstallationToken>();

  const getInstallationToken = async (installationId: number): Promise<string> => {
    const currentTime = now();
    const cachedToken = tokenCache.get(installationId);

    if (
      cachedToken !== undefined &&
      cachedToken.expiresAtMs - tokenRefreshSkewMs > currentTime.getTime()
    ) {
      return cachedToken.token;
    }

    const jwt = createGitHubAppJwt({
      appId,
      now: currentTime,
      privateKey,
    });
    const response = await fetchFn(
      buildGitHubUrl(apiBaseUrl, `/app/installations/${installationId}/access_tokens`, undefined),
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method: "POST",
      },
    );
    const installationToken = await parseInstallationToken(response);

    tokenCache.set(installationId, installationToken);

    return installationToken.token;
  };

  return async (request) => {
    const installationId = request.installationId;

    if (
      installationId === undefined ||
      !Number.isSafeInteger(installationId) ||
      installationId <= 0
    ) {
      throw createActionError("validation_error");
    }

    const token = await getInstallationToken(installationId);
    const requestInit: RequestInit = {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method: request.method,
    };

    if (request.body !== undefined) {
      requestInit.body = JSON.stringify(request.body);
    }

    const response = await fetchFn(
      buildGitHubUrl(apiBaseUrl, request.path, request.query),
      requestInit,
    );

    return parseGitHubResponse(response);
  };
};
