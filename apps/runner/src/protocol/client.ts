import type { RunnerProtocolEndpoint } from "@control-plane/shared";

import { RunnerError } from "../errors.js";

export type RunnerProtocolResponseParser<TResponse> = {
  safeParse: (value: unknown) =>
    | {
        data: TResponse;
        success: true;
      }
    | {
        success: false;
      };
};

export type RunnerProtocolFetchResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

export type RunnerProtocolFetchInit = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  redirect: "manual";
};

export type RunnerProtocolFetch = (
  url: string,
  init: RunnerProtocolFetchInit,
) => Promise<RunnerProtocolFetchResponse>;

export type PostRunnerProtocolRequestOptions<TResponse> = {
  baseUrl: string;
  endpoint: RunnerProtocolEndpoint;
  request: unknown;
  responseSchema: RunnerProtocolResponseParser<TResponse>;
  runnerCredential: string;
  runnerId: string;
  fetch?: RunnerProtocolFetch;
  maxAttempts?: number;
};

type RunnerProtocolEnvelope =
  | {
      data: unknown;
      ok: true;
    }
  | {
      error?: {
        code?: unknown;
        message?: unknown;
      };
      ok: false;
    };

const DEFAULT_MAX_ATTEMPTS = 3;

export const postRunnerProtocolRequest = async <TResponse>(
  options: PostRunnerProtocolRequestOptions<TResponse>,
): Promise<TResponse> => {
  const url = buildRunnerProtocolUrl(options.baseUrl, options.endpoint);
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const fetchRequest = options.fetch ?? defaultFetch;
  const body = JSON.stringify(options.request);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: RunnerProtocolFetchResponse;

    try {
      response = await fetchRequest(url, {
        body,
        headers: {
          authorization: `Bearer ${options.runnerCredential}`,
          "content-type": "application/json",
          "x-control-plane-runner-id": options.runnerId,
        },
        method: "POST",
        redirect: "manual",
      });
    } catch {
      if (attempt < maxAttempts) {
        continue;
      }

      throw requestFailedError();
    }

    if (isTransientStatus(response.status)) {
      if (attempt < maxAttempts) {
        continue;
      }

      throw requestFailedError();
    }

    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      throw invalidResponseError();
    }

    if (!isRunnerProtocolEnvelope(responseBody)) {
      throw invalidResponseError();
    }

    if (!responseBody.ok) {
      throw requestRejectedError();
    }

    const parsedResponse = options.responseSchema.safeParse(responseBody.data);

    if (!parsedResponse.success) {
      throw invalidResponseError();
    }

    return parsedResponse.data;
  }

  throw requestFailedError();
};

export const buildRunnerProtocolUrl = (
  baseUrl: string,
  endpoint: RunnerProtocolEndpoint,
): string => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw invalidBaseUrlError();
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw invalidBaseUrlError();
  }

  if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
    throw invalidBaseUrlError();
  }

  if (parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
    throw invalidBaseUrlError();
  }

  if (parsedUrl.protocol === "http:" && !isLocalHttpHostname(parsedUrl.hostname)) {
    throw invalidBaseUrlError();
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");

  if (normalizedPath !== "" && normalizedPath !== "/api") {
    throw invalidBaseUrlError();
  }

  parsedUrl.pathname = `/api${endpoint}`;

  return parsedUrl.toString();
};

const defaultFetch: RunnerProtocolFetch = async (url, init) => fetch(url, init);

const normalizeMaxAttempts = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_ATTEMPTS;
  }

  return Math.floor(value);
};

const isTransientStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

const invalidBaseUrlError = () =>
  new RunnerError({
    category: "usage",
    userSafeMessage:
      "Runner API base URL must be an http localhost URL or https URL without embedded credentials.",
  });

const requestFailedError = () =>
  new RunnerError({
    category: "command_execution",
    userSafeMessage: "Runner protocol request failed.",
  });

const requestRejectedError = () =>
  new RunnerError({
    category: "command_execution",
    userSafeMessage: "Runner protocol request was rejected.",
  });

const invalidResponseError = () =>
  new RunnerError({
    category: "command_execution",
    userSafeMessage: "Runner protocol response was invalid.",
  });

const isLocalHttpHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname.toLowerCase();

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]"
  ) {
    return true;
  }

  const octets = normalizedHostname.split(".");

  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) {
        return false;
      }

      const value = Number(octet);

      return value >= 0 && value <= 255;
    })
  );
};

const isRunnerProtocolEnvelope = (value: unknown): value is RunnerProtocolEnvelope => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { ok?: unknown };

  return typeof candidate.ok === "boolean";
};
