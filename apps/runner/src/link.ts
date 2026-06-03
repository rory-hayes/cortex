import {
  CONTRACT_VERSION,
  LinkRunnerRequestSchema,
  LinkRunnerResponseSchema,
  RUNNER_PROTOCOL_ENDPOINTS,
  type LinkRunnerResponse,
  type RunnerCapabilities,
} from "@control-plane/shared";

import { detectRunnerCapabilities, type DetectRunnerCapabilitiesOptions } from "./capabilities.js";
import {
  storeRunnerCredential,
  type RunnerCredentialStoreSummary,
  type StoreRunnerCredentialOptions,
} from "./credential-store.js";
import { RunnerError } from "./errors.js";

export type RunnerLinkOptions = {
  baseUrl: string;
  code: string;
  credentialPath?: string;
};

export type RunnerLinkSafeSummary = RunnerCredentialStoreSummary;

type RunnerLinkFetchResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

type RunnerLinkFetch = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
    redirect: "manual";
  },
) => Promise<RunnerLinkFetchResponse>;

export type RunnerLinkDependencies = {
  detectCapabilities?: (options?: DetectRunnerCapabilitiesOptions) => Promise<RunnerCapabilities>;
  fetch?: RunnerLinkFetch;
  now?: () => Date;
  storeCredential?: (
    options: StoreRunnerCredentialOptions,
  ) => Promise<RunnerCredentialStoreSummary>;
};

type RunnerLinkEnvelope =
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

export const runRunnerLink = async (
  options: RunnerLinkOptions,
  dependencies: RunnerLinkDependencies = {},
): Promise<RunnerLinkSafeSummary> => {
  const pairingCode = options.code.trim();

  if (pairingCode.length === 0) {
    throw new RunnerError({
      category: "usage",
      userSafeMessage: "Pairing code is required.",
    });
  }

  const linkUrl = buildRunnerLinkUrl(options.baseUrl);
  const now = dependencies.now ?? (() => new Date());
  const capabilities = await (dependencies.detectCapabilities ?? detectRunnerCapabilities)({ now });
  const request = LinkRunnerRequestSchema.parse({
    capabilities,
    contractVersion: CONTRACT_VERSION,
    pairingCode,
    requestedAt: now().toISOString(),
  });
  const responseBody = await postLinkRequest({
    body: JSON.stringify(request),
    fetch: dependencies.fetch ?? fetch,
    url: linkUrl,
  });
  const credential = parseLinkResponseEnvelope(responseBody);
  const storeCredential = dependencies.storeCredential ?? storeRunnerCredential;

  try {
    return await storeCredential({
      credential,
      ...(options.credentialPath === undefined ? {} : { credentialPath: options.credentialPath }),
      now,
    });
  } catch {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner credential could not be stored.",
    });
  }
};

const buildRunnerLinkUrl = (baseUrl: string): string => {
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

  parsedUrl.pathname = `/api${RUNNER_PROTOCOL_ENDPOINTS.linkRunner}`;

  return parsedUrl.toString();
};

const invalidBaseUrlError = () =>
  new RunnerError({
    category: "usage",
    userSafeMessage:
      "Runner API base URL must be an http localhost URL or https URL without embedded credentials.",
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

const postLinkRequest = async (input: {
  body: string;
  fetch: RunnerLinkFetch;
  url: string;
}): Promise<unknown> => {
  let response: RunnerLinkFetchResponse;

  try {
    response = await input.fetch(input.url, {
      body: input.body,
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "manual",
    });
  } catch {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner link request failed.",
    });
  }

  try {
    return await response.json();
  } catch {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner link response was invalid.",
    });
  }
};

const parseLinkResponseEnvelope = (body: unknown): LinkRunnerResponse => {
  if (!isRunnerLinkEnvelope(body)) {
    throw invalidResponseError();
  }

  if (!body.ok) {
    if (body.error?.code === "invalid_pairing_code") {
      throw new RunnerError({
        category: "usage",
        userSafeMessage: "The pairing code is invalid or expired.",
      });
    }

    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner link request failed.",
    });
  }

  const parsedResponse = LinkRunnerResponseSchema.safeParse(body.data);

  if (!parsedResponse.success) {
    throw invalidResponseError();
  }

  return parsedResponse.data;
};

const invalidResponseError = () =>
  new RunnerError({
    category: "command_execution",
    userSafeMessage: "Runner link response was invalid.",
  });

const isRunnerLinkEnvelope = (value: unknown): value is RunnerLinkEnvelope => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { ok?: unknown };

  return typeof candidate.ok === "boolean";
};
