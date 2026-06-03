import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  GitHubAccountMetadata,
  GitHubPullRequestMetadata,
  GitHubRepositoryMetadata,
} from "./app-client.js";

const MAX_METADATA_TEXT_LENGTH = 256;
const MAX_URL_LENGTH = 512;
const MAX_REPOSITORY_PART_LENGTH = 100;
const MAX_BRANCH_REF_LENGTH = 256;

export const GITHUB_WEBHOOK_EVENT_NAMES = [
  "installation",
  "installation_repositories",
  "pull_request",
  "push",
] as const;

export type GitHubWebhookEventName = (typeof GITHUB_WEBHOOK_EVENT_NAMES)[number];

export type GitHubWebhookHeaders = Record<string, string | string[] | undefined>;

export type GitHubWebhookHeaderMetadata = {
  deliveryId: string;
  eventName: GitHubWebhookEventName;
};

export type GitHubWebhookPullRequestMetadata = Omit<GitHubPullRequestMetadata, "repository">;

export type GitHubWebhookPushMetadata = {
  defaultBranchPush: boolean;
  ref: string;
};

export type GitHubWebhookRepositoryMetadata = Pick<
  GitHubRepositoryMetadata,
  "id" | "owner" | "name" | "fullName" | "private"
> &
  Partial<
    Pick<
      GitHubRepositoryMetadata,
      "htmlUrl" | "defaultBranch" | "archived" | "disabled" | "visibility"
    >
  >;

export type GitHubWebhookEnvelope = {
  deliveryId: string;
  eventName: GitHubWebhookEventName;
  action: string;
  installationId: number;
  repository?: GitHubRepositoryMetadata;
  repositories: GitHubWebhookRepositoryMetadata[];
  pullRequest?: GitHubWebhookPullRequestMetadata;
  push?: GitHubWebhookPushMetadata;
};

export type ParseGitHubWebhookEnvelopeInput = {
  headers: GitHubWebhookHeaders;
  payload: unknown;
};

export type VerifyGitHubWebhookSignatureInput = {
  headers: GitHubWebhookHeaders;
  payload: string | Uint8Array;
  secret: string | undefined;
};

export type GitHubWebhookErrorCode =
  | "invalid_headers"
  | "invalid_delivery_id"
  | "invalid_secret"
  | "invalid_signature"
  | "missing_signature"
  | "unsupported_event"
  | "invalid_payload";

export type GitHubWebhookErrorMetadata = {
  eventName?: GitHubWebhookEventName;
};

export class GitHubWebhookError extends Error {
  readonly code: GitHubWebhookErrorCode;
  readonly metadata: GitHubWebhookErrorMetadata;

  constructor(
    code: GitHubWebhookErrorCode,
    message: string,
    metadata: GitHubWebhookErrorMetadata = {},
  ) {
    super(message);
    this.name = "GitHubWebhookError";
    this.code = code;
    this.metadata = metadata;
  }
}

type RawRecord = Record<string, unknown>;

export const parseGitHubWebhookHeaders = (
  headers: GitHubWebhookHeaders,
): GitHubWebhookHeaderMetadata => {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new GitHubWebhookError("invalid_headers", "GitHub webhook headers are invalid.");
  }

  const deliveryId = parseDeliveryId(readHeader(headers, "x-github-delivery"));
  const eventName = parseEventName(readHeader(headers, "x-github-event"));

  return {
    deliveryId,
    eventName,
  };
};

export const parseGitHubWebhookEnvelope = (
  input: ParseGitHubWebhookEnvelopeInput,
): GitHubWebhookEnvelope => {
  const { deliveryId, eventName } = parseGitHubWebhookHeaders(input.headers);
  const payload = parseRecord(input.payload);
  const action = eventName === "push" ? "pushed" : parseAction(payload.action);
  const installationId = parseInstallationId(payload.installation);
  const baseEnvelope = {
    deliveryId,
    eventName,
    action,
    installationId,
  };

  if (eventName === "installation" || eventName === "installation_repositories") {
    return {
      ...baseEnvelope,
      repositories: parseRepositoryArrays(payload),
    };
  }

  const repository = parseRepositoryMetadata(payload.repository);

  if (eventName === "push") {
    return {
      ...baseEnvelope,
      repository,
      repositories: [],
      push: parsePushMetadata(payload, repository),
    };
  }

  return {
    ...baseEnvelope,
    repository,
    repositories: [],
    pullRequest: parsePullRequestMetadata(payload.pull_request),
  };
};

const parsePushMetadata = (
  payload: RawRecord,
  repository: GitHubRepositoryMetadata,
): GitHubWebhookPushMetadata => {
  const ref = parseRefName(payload.ref);

  return {
    defaultBranchPush: ref === `refs/heads/${repository.defaultBranch}`,
    ref,
  };
};

export const verifyGitHubWebhookSignature = (input: VerifyGitHubWebhookSignatureInput): void => {
  const secret = parseWebhookSecret(input.secret);
  const signature = parseSignatureDigest(readSignatureHeader(input.headers));
  const expectedSignature = createHmac("sha256", secret).update(input.payload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new GitHubWebhookError("invalid_signature", "GitHub webhook signature is invalid.");
  }
};

const parseWebhookSecret = (secret: string | undefined): string => {
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    secret.trim() !== secret ||
    hasControlCharacter(secret) ||
    secret.toLowerCase().includes("placeholder")
  ) {
    throw new GitHubWebhookError("invalid_secret", "GitHub webhook secret is invalid.");
  }

  return secret;
};

const readSignatureHeader = (headers: GitHubWebhookHeaders): string => {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new GitHubWebhookError("missing_signature", "GitHub webhook signature is missing.");
  }

  const matchingEntries = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === "x-hub-signature-256",
  );

  if (matchingEntries.length === 0) {
    throw new GitHubWebhookError("missing_signature", "GitHub webhook signature is missing.");
  }

  if (matchingEntries.length !== 1) {
    throw new GitHubWebhookError("invalid_signature", "GitHub webhook signature is invalid.");
  }

  const value = matchingEntries[0]?.[1];
  const normalizedValue = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : undefined
    : value;

  if (typeof normalizedValue !== "string") {
    throw new GitHubWebhookError("invalid_signature", "GitHub webhook signature is invalid.");
  }

  return normalizedValue;
};

const parseSignatureDigest = (signature: string): string => {
  if (!/^sha256=[0-9a-f]{64}$/u.test(signature)) {
    throw new GitHubWebhookError("invalid_signature", "GitHub webhook signature is invalid.");
  }

  return signature.slice("sha256=".length);
};

const readHeader = (headers: GitHubWebhookHeaders, wantedName: string): string => {
  const matchingEntries = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === wantedName,
  );

  if (matchingEntries.length !== 1) {
    throw new GitHubWebhookError("invalid_headers", "GitHub webhook headers are invalid.");
  }

  const value = matchingEntries[0]?.[1];
  const normalizedValue = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : undefined
    : value;

  if (
    typeof normalizedValue !== "string" ||
    normalizedValue.length === 0 ||
    normalizedValue.trim() !== normalizedValue ||
    hasControlCharacter(normalizedValue) ||
    looksUnsafeText(normalizedValue)
  ) {
    throw new GitHubWebhookError("invalid_headers", "GitHub webhook headers are invalid.");
  }

  return normalizedValue;
};

const parseDeliveryId = (value: string): string => {
  const normalized = value.toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)
  ) {
    throw new GitHubWebhookError("invalid_delivery_id", "GitHub webhook delivery id is invalid.");
  }

  return normalized;
};

const parseEventName = (value: string): GitHubWebhookEventName => {
  if (GITHUB_WEBHOOK_EVENT_NAMES.includes(value as GitHubWebhookEventName)) {
    return value as GitHubWebhookEventName;
  }

  throw new GitHubWebhookError("unsupported_event", "GitHub webhook event is unsupported.");
};

const parseAction = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 80 ||
    value.trim() !== value ||
    !/^[a-z_]+$/u.test(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidPayload();
  }

  return value;
};

const parseInstallationId = (value: unknown): number => {
  const record = parseRecord(value);

  return parsePositiveInteger(record.id);
};

const parseRepositoryArrays = (payload: RawRecord): GitHubWebhookRepositoryMetadata[] => [
  ...parseOptionalRepositoryArray(payload.repositories),
  ...parseOptionalRepositoryArray(payload.repositories_added),
  ...parseOptionalRepositoryArray(payload.repositories_removed),
];

const parseOptionalRepositoryArray = (value: unknown): GitHubWebhookRepositoryMetadata[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throwInvalidPayload();
  }

  return value.map(parseWebhookRepositoryMetadata);
};

const parsePullRequestMetadata = (value: unknown): GitHubWebhookPullRequestMetadata => {
  const record = parseRecord(value);
  const head = isRecord(record.head) ? record.head : {};
  const base = isRecord(record.base) ? record.base : {};
  const author = parseOptionalAccount(record.user);
  const headRefName = parseOptionalRefName(head.ref);
  const baseRefName = parseOptionalRefName(base.ref);
  const updatedAt = parseOptionalTimestamp(record.updated_at);

  return {
    id: parsePositiveInteger(record.id),
    number: parsePositiveInteger(record.number),
    title: parseMetadataText(record.title),
    state: parsePullRequestState(record.state),
    draft: parseBoolean(record.draft),
    merged: parsePullRequestMerged(record),
    htmlUrl: parseRequiredUrl(record.html_url),
    ...(author === undefined ? {} : { author }),
    ...(headRefName === undefined ? {} : { headRefName }),
    ...(baseRefName === undefined ? {} : { baseRefName }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
};

const parseRepositoryMetadata = (value: unknown): GitHubRepositoryMetadata => {
  const record = parseRecord(value);
  const fullName = parseFullName(record.full_name);
  const [owner, nameFromFullName] = fullName.split("/");
  const name = parseRepositoryPart(record.name);
  const visibility = parseOptionalVisibility(record.visibility);

  if (name !== nameFromFullName) {
    throwInvalidPayload();
  }

  return {
    id: parsePositiveInteger(record.id),
    owner: parseRepositoryPart(owner ?? ""),
    name,
    fullName,
    private: parseBoolean(record.private),
    htmlUrl: parseRequiredUrl(record.html_url),
    defaultBranch: parseRefName(record.default_branch),
    archived: parseBoolean(record.archived),
    disabled: parseBoolean(record.disabled),
    ...(visibility === undefined ? {} : { visibility }),
  };
};

const parseWebhookRepositoryMetadata = (value: unknown): GitHubWebhookRepositoryMetadata => {
  const record = parseRecord(value);
  const fullName = parseFullName(record.full_name);
  const [owner, nameFromFullName] = fullName.split("/");
  const name = parseRepositoryPart(record.name);
  const htmlUrl = parseOptionalUrl(record.html_url);
  const defaultBranch = parseOptionalRefName(record.default_branch);
  const archived = parseOptionalBoolean(record.archived);
  const disabled = parseOptionalBoolean(record.disabled);
  const visibility = parseOptionalVisibility(record.visibility);

  if (name !== nameFromFullName) {
    throwInvalidPayload();
  }

  return {
    id: parsePositiveInteger(record.id),
    owner: parseRepositoryPart(owner ?? ""),
    name,
    fullName,
    private: parseBoolean(record.private),
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    ...(archived === undefined ? {} : { archived }),
    ...(disabled === undefined ? {} : { disabled }),
    ...(visibility === undefined ? {} : { visibility }),
  };
};

const parseAccountMetadata = (value: unknown): GitHubAccountMetadata => {
  const record = parseRecord(value);
  const htmlUrl = parseOptionalUrl(record.html_url);

  return {
    id: parsePositiveInteger(record.id),
    login: parseRepositoryPart(record.login),
    type: parseAccountType(record.type),
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
  };
};

const parseOptionalAccount = (value: unknown): GitHubAccountMetadata | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseAccountMetadata(value);
};

const parseRecord = (value: unknown): RawRecord => {
  if (!isRecord(value)) {
    throwInvalidPayload();
  }

  return value;
};

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePositiveInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throwInvalidPayload();
  }

  return value;
};

const parseRepositoryPart = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REPOSITORY_PART_LENGTH ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    value.startsWith("-") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("@") ||
    value.endsWith(".lock") ||
    hasControlCharacter(value) ||
    /\s/u.test(value) ||
    !/^[A-Za-z0-9._-]+$/u.test(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidPayload();
  }

  return value;
};

const parseFullName = (value: unknown): string => {
  if (typeof value !== "string") {
    throwInvalidPayload();
  }

  const parts = value.split("/");

  if (parts.length !== 2) {
    throwInvalidPayload();
  }

  const owner = parseRepositoryPart(parts[0]);
  const name = parseRepositoryPart(parts[1]);

  return `${owner}/${name}`;
};

const parseMetadataText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_TEXT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidPayload();
  }

  return value;
};

const parseAccountType = (value: unknown): string => {
  const accountType = parseMetadataText(value);

  if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(accountType)) {
    throwInvalidPayload();
  }

  return accountType;
};

const parsePullRequestState = (value: unknown): GitHubWebhookPullRequestMetadata["state"] => {
  if (value === "open" || value === "closed") {
    return value;
  }

  throwInvalidPayload();
};

const parsePullRequestMerged = (record: RawRecord): boolean => {
  if (typeof record.merged === "boolean") {
    return record.merged;
  }

  if (typeof record.merged_at === "string") {
    parseTimestamp(record.merged_at);
    return true;
  }

  if (record.merged_at === null || record.merged_at === undefined) {
    return false;
  }

  throwInvalidPayload();
};

const parseOptionalVisibility = (value: unknown): GitHubRepositoryMetadata["visibility"] => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === "public" || value === "private" || value === "internal") {
    return value;
  }

  throwInvalidPayload();
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throwInvalidPayload();
  }

  return value;
};

const parseOptionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseBoolean(value);
};

const parseRequiredUrl = (value: unknown): string => {
  const url = parseOptionalUrl(value);

  if (url === undefined) {
    throwInvalidPayload();
  }

  return url;
};

const parseOptionalUrl = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidPayload();
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throwInvalidPayload();
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throwInvalidPayload();
  }

  return value;
};

const parseOptionalTimestamp = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseTimestamp(value);
};

const parseTimestamp = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_TEXT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksUnsafeText(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throwInvalidPayload();
  }

  return value;
};

const parseRefName = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BRANCH_REF_LENGTH ||
    value.trim() !== value ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes(":") ||
    value.includes("~") ||
    value.includes("^") ||
    value.includes("?") ||
    value.includes("*") ||
    value.includes("[") ||
    hasControlCharacter(value) ||
    /\s/u.test(value) ||
    looksUnsafeText(value)
  ) {
    throwInvalidPayload();
  }

  const segments = value.split("/");

  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.endsWith(".lock"),
    )
  ) {
    throwInvalidPayload();
  }

  return value;
};

const parseOptionalRefName = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseRefName(value);
};

function throwInvalidPayload(): never {
  throw new GitHubWebhookError("invalid_payload", "GitHub webhook payload is invalid.");
}

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const looksUnsafeText = (value: string): boolean =>
  looksSecretLike(value) || SOURCE_LIKE_TEXT_PATTERNS.some((pattern) => pattern.test(value));

const looksSecretLike = (value: string): boolean =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/iu.test(value) ||
  /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]/iu.test(
    value,
  ) ||
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(value) ||
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\blin_api_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value) ||
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u.test(value) ||
  /\bya29\.[A-Za-z0-9_-]{20,}\b/u.test(value) ||
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/u.test(value) ||
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu.test(value);

const SOURCE_LIKE_TEXT_PATTERNS = [
  /\bdiff --git\b/u,
  /^@@\s/mu,
  /^---\s+a\//mu,
  /^\+\+\+\s+b\//mu,
  /^\*\*\* Begin Patch\b/mu,
  /^```/mu,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,160}[;{}=()]/u,
  /\b(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,120}[;{}=()]/u,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/u,
];
