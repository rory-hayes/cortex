import { redactLogText } from "@control-plane/logging";

const unsafeDisplayTextPatterns = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /```[^\n]*\n/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i,
  /\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-][A-Za-z0-9._~+/=-]{7,}\b/i,
  /[?&](?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret)=([^&#\s]+)/i,
] as const;

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
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());

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

export const hasUnsafeDisplayText = (value: string): boolean =>
  redactLogText(value).redactionApplied ||
  hasControlCharacter(value) ||
  isRealEnvPath(value) ||
  /^\/|^[A-Za-z]:[\\/]/u.test(value) ||
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\))/iu.test(value) ||
  /(?:^|[/\\])\.\.(?:[/\\]|$)/u.test(value) ||
  unsafeDisplayTextPatterns.some((pattern) => pattern.test(value));

export const safeDisplayText = (value: string, fallback = "Unavailable"): string =>
  hasUnsafeDisplayText(value) ? fallback : value;

export const safeDisplayPath = (value: string): string | null =>
  hasUnsafeDisplayText(value) ? null : value;
