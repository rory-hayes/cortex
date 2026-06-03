import { CONTRACT_VERSION } from "@control-plane/shared";

import { RunnerError } from "../errors.js";
import type { RunnerCredentialRecord } from "../credential-store.js";

export type RunnerRepoMappingMetadata = {
  defaultBranch: string;
  localPath: string;
  provider: string;
  remoteUrl?: string | null;
  repositoryName: string;
  repositoryOwner: string;
};

export type RunnerRepoMappingRequestBody = RunnerRepoMappingMetadata & {
  contractVersion: typeof CONTRACT_VERSION;
  remoteUrl: string | null;
  runnerId: string;
  timestamp: string;
  workspaceId: string;
};

export type RunnerRepoMappingResult = {
  defaultBranch: string;
  id: string;
  localPath: string;
  provider: string;
  remoteUrl: string | null;
  repositoryName: string;
  repositoryOwner: string;
  runnerId: string;
  workspaceId: string;
};

export type PostRunnerRepoMappingOptions = {
  credential: RunnerCredentialRecord;
  mapping: RunnerRepoMappingMetadata;
};

type RunnerRepoMappingFetchResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

type RunnerRepoMappingFetch = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
    redirect: "manual";
  },
) => Promise<RunnerRepoMappingFetchResponse>;

export type RunnerRepoMappingProtocolDependencies = {
  fetch?: RunnerRepoMappingFetch;
  now?: () => Date;
};

type RunnerRepoMappingEnvelope =
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

const requiredMetadataMaxLength = 240;
const localPathMaxLength = 1_024;
const remoteUrlMaxLength = 2_048;
const unsafeMetadataTextPatterns = [
  /\bdiff --git\b/i,
  /@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;/m,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
];

export const postRunnerRepoMapping = async (
  options: PostRunnerRepoMappingOptions,
  dependencies: RunnerRepoMappingProtocolDependencies = {},
): Promise<RunnerRepoMappingResult> => {
  const body = createRepoMappingRequestBody({
    ...options,
    now: dependencies.now ?? (() => new Date()),
  });
  const responseBody = await postRepoMappingRequest({
    body: JSON.stringify(body),
    fetch: dependencies.fetch ?? fetch,
    runnerCredential: options.credential.runnerCredential,
    runnerId: options.credential.runnerId,
    url: buildRepoMappingsUrl(options.credential.pollingBaseUrl),
  });

  return parseRepoMappingResponseEnvelope(responseBody);
};

const createRepoMappingRequestBody = ({
  credential,
  mapping,
  now,
}: PostRunnerRepoMappingOptions & { now: () => Date }): RunnerRepoMappingRequestBody => {
  const safeMapping = assertSafeRunnerRepoMappingMetadata(mapping);
  const timestamp = now().toISOString();

  assertSafeRepoMappingText(timestamp, requiredMetadataMaxLength);

  return {
    contractVersion: CONTRACT_VERSION,
    defaultBranch: safeMapping.defaultBranch,
    localPath: safeMapping.localPath,
    provider: safeMapping.provider,
    remoteUrl: safeMapping.remoteUrl ?? null,
    repositoryName: safeMapping.repositoryName,
    repositoryOwner: safeMapping.repositoryOwner,
    runnerId: credential.runnerId,
    timestamp,
    workspaceId: credential.workspaceId,
  };
};

export const assertSafeRunnerRepoMappingMetadata = (
  mapping: RunnerRepoMappingMetadata,
): RunnerRepoMappingMetadata => {
  assertSafeRepoMappingText(mapping.defaultBranch, requiredMetadataMaxLength);
  assertSafeRepoMappingText(mapping.localPath, localPathMaxLength);
  assertSafeRepoMappingText(mapping.provider, requiredMetadataMaxLength);
  assertSafeRepoMappingText(mapping.repositoryName, requiredMetadataMaxLength);
  assertSafeRepoMappingText(mapping.repositoryOwner, requiredMetadataMaxLength);

  if (mapping.remoteUrl !== undefined && mapping.remoteUrl !== null) {
    assertSafeRepoMappingText(mapping.remoteUrl, remoteUrlMaxLength);

    if (
      hasHttpUrlCredentials(mapping.remoteUrl) ||
      hasCredentialedScpStyleRemote(mapping.remoteUrl)
    ) {
      throw unsafeMetadataError();
    }
  }

  return mapping;
};

const assertSafeRepoMappingText = (value: string, maxLength: number): void => {
  const trimmedValue = value.trim();

  if (
    trimmedValue.length === 0 ||
    trimmedValue.length > maxLength ||
    hasControlCharacter(trimmedValue) ||
    unsafeMetadataTextPatterns.some((pattern) => pattern.test(trimmedValue))
  ) {
    throw unsafeMetadataError();
  }
};

const hasHttpUrlCredentials = (value: string): boolean => {
  try {
    const parsedUrl = new URL(value);

    return (
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      (parsedUrl.username.length > 0 || parsedUrl.password.length > 0)
    );
  } catch {
    return false;
  }
};

const hasCredentialedScpStyleRemote = (value: string): boolean => {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) {
    return false;
  }

  const atIndex = value.indexOf("@");

  if (atIndex <= 0) {
    return false;
  }

  const userInfo = value.slice(0, atIndex);
  const remoteTarget = value.slice(atIndex + 1);

  return userInfo.includes(":") && /^[^:\s]+:.+$/u.test(remoteTarget);
};

const unsafeMetadataError = () =>
  new RunnerError({
    category: "usage",
    userSafeMessage: "Repository metadata is not safe to register.",
  });

const buildRepoMappingsUrl = (pollingBaseUrl: string): string => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(pollingBaseUrl);
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

  parsedUrl.pathname = "/api/runner/repo-mappings";

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

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const postRepoMappingRequest = async (input: {
  body: string;
  fetch: RunnerRepoMappingFetch;
  runnerCredential: string;
  runnerId: string;
  url: string;
}): Promise<unknown> => {
  let response: RunnerRepoMappingFetchResponse;

  try {
    response = await input.fetch(input.url, {
      body: input.body,
      headers: {
        Authorization: `Bearer ${input.runnerCredential}`,
        "content-type": "application/json",
        "x-control-plane-runner-id": input.runnerId,
      },
      method: "POST",
      redirect: "manual",
    });
  } catch {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner repo mapping request failed.",
    });
  }

  if (!response.ok || response.status === 400 || response.status === 401) {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner repo mapping request failed.",
    });
  }

  try {
    return await response.json();
  } catch {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner repo mapping response was invalid.",
    });
  }
};

const parseRepoMappingResponseEnvelope = (body: unknown): RunnerRepoMappingResult => {
  if (!isRepoMappingEnvelope(body)) {
    throw invalidResponseError();
  }

  if (!body.ok) {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner repo mapping request failed.",
    });
  }

  return parseRepoMappingResult(body.data);
};

const parseRepoMappingResult = (data: unknown): RunnerRepoMappingResult => {
  if (!isPlainRecord(data)) {
    throw invalidResponseError();
  }

  const requiredStrings = [
    "defaultBranch",
    "id",
    "localPath",
    "provider",
    "repositoryName",
    "repositoryOwner",
    "runnerId",
    "workspaceId",
  ] as const;

  if (
    requiredStrings.some((key) => typeof data[key] !== "string" || data[key].trim().length === 0)
  ) {
    throw invalidResponseError();
  }

  const remoteUrl = data.remoteUrl;

  if (remoteUrl !== null && typeof remoteUrl !== "string") {
    throw invalidResponseError();
  }

  const result = {
    defaultBranch: readRequiredResultString(data, "defaultBranch"),
    id: readRequiredResultString(data, "id"),
    localPath: readRequiredResultString(data, "localPath"),
    provider: readRequiredResultString(data, "provider"),
    remoteUrl,
    repositoryName: readRequiredResultString(data, "repositoryName"),
    repositoryOwner: readRequiredResultString(data, "repositoryOwner"),
    runnerId: readRequiredResultString(data, "runnerId"),
    workspaceId: readRequiredResultString(data, "workspaceId"),
  };

  assertSafeRepoMappingResponseResult(result);

  return result;
};

const assertSafeRepoMappingResponseResult = (result: RunnerRepoMappingResult): void => {
  try {
    assertSafeRunnerRepoMappingMetadata(result);
    assertSafeRepoMappingText(result.id, requiredMetadataMaxLength);
    assertSafeRepoMappingText(result.runnerId, requiredMetadataMaxLength);
    assertSafeRepoMappingText(result.workspaceId, requiredMetadataMaxLength);
  } catch {
    throw invalidResponseError();
  }
};

const readRequiredResultString = (data: Record<string, unknown>, key: string): string => {
  const value = data[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidResponseError();
  }

  return value;
};

const invalidResponseError = () =>
  new RunnerError({
    category: "command_execution",
    userSafeMessage: "Runner repo mapping response was invalid.",
  });

const isRepoMappingEnvelope = (value: unknown): value is RunnerRepoMappingEnvelope => {
  if (!isPlainRecord(value)) {
    return false;
  }

  return typeof value.ok === "boolean";
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};
