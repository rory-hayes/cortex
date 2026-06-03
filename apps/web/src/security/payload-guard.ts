import "server-only";

import { redactLogText } from "@control-plane/logging";

const unsafePayloadKeyNames = new Set([
  "code",
  "codesnippet",
  "content",
  "contents",
  "diff",
  "filecontent",
  "filecontents",
  "patch",
  "patchtext",
  "rawdiff",
  "rawcommandoutput",
  "rawlog",
  "rawlogs",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "password",
  "snippet",
  "snippets",
  "source",
  "sourcecode",
  "sourcecontent",
  "secret",
  "stderr",
  "stderrsummary",
  "stdout",
  "stdoutsummary",
  "token",
  "privatekey",
]);

const rawPayloadKeyPattern =
  /^(?:raw|full|unified|git)?(?:diff|patch|source|code)(?:text|content|contents|snippet|snippets|filecontent|filecontents|body|data|blob|value|code|line|lines)?$/;

const rawLogKeyPattern =
  /^(?:raw|full)?(?:stdout|stderr|output|log|logs)(?:text|content|contents|body|data|blob|value|line|lines)?$/;

const unsafePayloadTextPatterns = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:async\s+)?function\s+[$A-Z_][\w$]*\s*\(/i,
  /(^|\n)\s*(?:const|let|var)\s+[$A-Z_][\w$]*\s*(?::[^=\n]+)?=/i,
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\([^)]*\))?\s*:/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /(^|\n)\s*[A-Z0-9_-]+:\s*\n\s{2,}[A-Z0-9_-]+:/i,
  /(^|\n)\s*<\/?[A-Z][\w:-]*(?:\s+[^>\n]*)?>/i,
  /```[^\n]*\n/i,
  /\b(?:sourceCode|rawSource|rawDiff|patchText|codeSnippet|rawOutput|rawLog)\b/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i,
  /[?&](?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret)=([^&#\s]+)/i,
  /(?:^|\s)--(?:password|passwd|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|token|secret)(?:=|\s+)(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s]+/i,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z_][A-Za-z0-9_-]*(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)[A-Za-z0-9_-]*\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/i,
  /\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-][A-Za-z0-9._~+/=-]{7,}\b/i,
] as const;

const unsafePathTextPatterns = [
  /^\/|^[A-Za-z]:[\\/]/,
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\))/iu,
  /(?:^|[/\\])\.\.(?:[/\\]|$)/,
  ...unsafePayloadTextPatterns,
] as const;

export class UnsafeWebBoundPayloadError extends Error {
  readonly code = "unsafe_web_bound_payload" as const;

  constructor() {
    super("Unsafe web-bound payload.");
    this.name = "UnsafeWebBoundPayloadError";
  }
}

const normalizePayloadKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export const hasUnsafePayloadKey = (key: string): boolean => {
  const normalizedKey = normalizePayloadKey(key);

  return (
    unsafePayloadKeyNames.has(normalizedKey) ||
    rawPayloadKeyPattern.test(normalizedKey) ||
    rawLogKeyPattern.test(normalizedKey)
  );
};

const isAllowedValidationResultSummaryKey = (
  container: Record<string, unknown>,
  normalizedKey: string,
): boolean =>
  (normalizedKey === "stdoutsummary" || normalizedKey === "stderrsummary") &&
  container.redactionApplied === true &&
  typeof container.commandId === "string" &&
  typeof container.commandLabel === "string" &&
  typeof container.status === "string" &&
  typeof container.stdoutSummary === "string" &&
  typeof container.stderrSummary === "string";

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const isRealEnvPath = (value: string): boolean => {
  const segments = value
    .replace(/\\/g, "/")
    .split(/[/\s"'([{:=,]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/[).;\]}]+$/gu, "").toLowerCase());

  return segments.some((segment) => {
    if (segment === ".env.example") {
      return false;
    }

    return (
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment === "local.env" ||
      segment.endsWith(".local.env")
    );
  });
};

export const hasUnsafePayloadText = (value: string): boolean =>
  redactLogText(value).redactionApplied ||
  unsafePayloadTextPatterns.some((pattern) => pattern.test(value));

export const hasUnsafePayloadPathText = (value: string): boolean =>
  redactLogText(value).redactionApplied ||
  hasControlCharacter(value) ||
  isRealEnvPath(value) ||
  unsafePathTextPatterns.some((pattern) => pattern.test(value));

export type PayloadGuardOptions = {
  inspectKeys?: boolean;
};

export const hasUnsafeWebBoundPayload = (
  value: unknown,
  options: PayloadGuardOptions = {},
  seen: WeakSet<object> = new WeakSet(),
): boolean => {
  if (typeof value === "string") {
    return hasUnsafePayloadText(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((childValue) => hasUnsafeWebBoundPayload(childValue, options, seen));
  }

  const inspectKeys = options.inspectKeys !== false;

  return Object.entries(value).some(([key, childValue]) => {
    const normalizedKey = normalizePayloadKey(key);
    const hasUnsafeKey =
      inspectKeys &&
      (hasUnsafePayloadKey(key) || hasUnsafePayloadText(key)) &&
      !isAllowedValidationResultSummaryKey(value as Record<string, unknown>, normalizedKey);

    return hasUnsafeKey || hasUnsafeWebBoundPayload(childValue, options, seen);
  });
};

export const assertSafeWebBoundPayload = (value: unknown): void => {
  if (hasUnsafeWebBoundPayload(value)) {
    throw new UnsafeWebBoundPayloadError();
  }
};
