import { z } from "zod";

export type UnsafePayloadValueOptions = {
  rejectControlCharacters?: boolean;
};

const secretishNameSegment = String.raw`(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password|passwd|database[_-]?url)`;
const secretishEnvName = String.raw`(?:[A-Z_][A-Z0-9_-]*)?${secretishNameSegment}[A-Z0-9_-]*`;
const secretishProcessEnvName = String.raw`(?:[A-Z_][A-Z0-9_]*)?${secretishNameSegment}[A-Z0-9_]*`;

const unsafePayloadValuePatterns = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /```[^\n]*\n/i,
  /(^|\n)\s*import\s+(?:(?:type\s+)?[$\w*{}\s,]+\s+from\s+)?["'][^"'\n]+["'];?/i,
  /(^|\n)\s*export\s+(?:default\s+)?(?:const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*type\s+[$A-Z_][\w$]*(?:<[^>\n]+>)?\s*=/i,
  /(^|\n)\s*interface\s+[$A-Z_][\w$]*(?:<[^>\n]+>)?(?:\s+extends\s+[$A-Z_][\w$]*(?:\s*,\s*[$A-Z_][\w$]*)*)?\s*\{/i,
  /(^|\n)\s*enum\s+[$A-Z_][\w$]*\s*\{/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\s+extends\s+[$A-Z_][\w$.[\]]*)?\s*\{/i,
  /(^|\n)\s*(?:async\s+)?function\s+[$A-Z_][\w$]*\s*\(/i,
  /(^|\n)\s*(?:const|let|var)\s+[$A-Z_][\w$]*\s*(?::[^=\n]+)?=/i,
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\([^)]*\))?\s*:/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/i,
  /[?&](?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret)=([^&#\s]+)/i,
  new RegExp(
    String.raw`(?:^|[\s;"',])(?:export\s+)?${secretishEnvName}\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s'";,)]+`,
    "iu",
  ),
  new RegExp(String.raw`\bprocess\.env\.${secretishProcessEnvName}\b`, "iu"),
  new RegExp(String.raw`\$\{${secretishProcessEnvName}\}`, "iu"),
  new RegExp(String.raw`\$${secretishProcessEnvName}\b`, "iu"),
  new RegExp(String.raw`\$env:${secretishProcessEnvName}\b`, "iu"),
  new RegExp(String.raw`%${secretishProcessEnvName}%`, "iu"),
  /\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
  /\blin_api_[A-Za-z0-9_]{12,}\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
] as const;

const hasUnsafeControlCharacter = (value: string, options: UnsafePayloadValueOptions): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    if (codePoint === 127) {
      return true;
    }

    if (codePoint < 32) {
      if (options.rejectControlCharacters === true || ![9, 10, 13].includes(codePoint)) {
        return true;
      }
    }
  }

  return false;
};

export const hasUnsafePayloadValueText = (
  value: string,
  options: UnsafePayloadValueOptions = {},
): boolean =>
  hasUnsafeControlCharacter(value, options) ||
  unsafePayloadValuePatterns.some((pattern) => pattern.test(value));

export const addUnsafePayloadValueIssues = (
  value: unknown,
  context: z.RefinementCtx,
  message: string,
  options: UnsafePayloadValueOptions = {},
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
): void => {
  if (typeof value === "string") {
    if (hasUnsafePayloadValueText(value, options)) {
      context.addIssue({
        code: "custom",
        message,
        path,
      });
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addUnsafePayloadValueIssues(item, context, message, options, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    addUnsafePayloadValueIssues(childValue, context, message, options, [...path, key], seen);
  }
};
