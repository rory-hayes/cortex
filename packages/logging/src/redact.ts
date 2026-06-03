export type RedactedLogText = {
  text: string;
  redactionApplied: boolean;
};

const SECRET_REDACTION = "[REDACTED_SECRET]";
const PRIVATE_KEY_REDACTION = "[REDACTED_PRIVATE_KEY]";
const CREDENTIAL_URL_REDACTION = "[REDACTED_CREDENTIALS]";

const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const CREDENTIAL_URL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^@\s/?#]+)@([^\s<>"'`]+)/gi;
const DOTENV_ASSIGNMENT_PATTERN =
  /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\n]*)$/gm;
const SECRET_ASSIGNMENT_PATTERN =
  /((?:^|[{\s,])(?:"(?:password|passwd|api[_-]?key|apikey|access[_-]?token|accessToken|auth[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret)"|'(?:password|passwd|api[_-]?key|apikey|access[_-]?token|accessToken|auth[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret)'|(?:password|passwd|api[_-]?key|apikey|access[_-]?token|accessToken|auth[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret))\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,\n}]+)/gi;
const BEARER_TOKEN_PATTERN = /(\bAuthorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const PROVIDER_TOKEN_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g,
  /\blin_api_[A-Za-z0-9_]{12,}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
] as const;
const HIGH_ENTROPY_CANDIDATE_PATTERN =
  /(^|[^A-Za-z0-9+/_=-])([A-Za-z0-9][A-Za-z0-9+/_=-]{31,})(?=$|[^A-Za-z0-9+/_=-])/g;

export const redactLogText = (text: string): RedactedLogText => {
  let redacted = text;

  redacted = redacted.replace(PRIVATE_KEY_BLOCK_PATTERN, PRIVATE_KEY_REDACTION);
  redacted = redacted.replace(
    CREDENTIAL_URL_PATTERN,
    (_match, scheme: string, _userinfo: string, rest: string) =>
      `${scheme}${CREDENTIAL_URL_REDACTION}@${rest}`,
  );
  redacted = redacted.replace(
    DOTENV_ASSIGNMENT_PATTERN,
    (_match, prefix: string) => `${prefix}${SECRET_REDACTION}`,
  );
  redacted = redacted.replace(
    SECRET_ASSIGNMENT_PATTERN,
    (_match, prefix: string, value: string) => `${prefix}${redactAssignmentValue(value)}`,
  );
  redacted = redacted.replace(JWT_PATTERN, SECRET_REDACTION);
  redacted = redacted.replace(
    BEARER_TOKEN_PATTERN,
    (_match, prefix: string) => `${prefix}${SECRET_REDACTION}`,
  );

  for (const pattern of PROVIDER_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, SECRET_REDACTION);
  }

  redacted = redacted.replace(
    HIGH_ENTROPY_CANDIDATE_PATTERN,
    (_match, prefix: string, candidate: string) =>
      `${prefix}${isHighEntropySecretCandidate(candidate) ? SECRET_REDACTION : candidate}`,
  );

  return {
    text: redacted,
    redactionApplied: redacted !== text,
  };
};

const redactAssignmentValue = (value: string): string => {
  if (value.startsWith('"') && value.endsWith('"')) {
    return `"${SECRET_REDACTION}"`;
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return `'${SECRET_REDACTION}'`;
  }

  return SECRET_REDACTION;
};

const isHighEntropySecretCandidate = (candidate: string): boolean => {
  if (
    candidate.length < 32 ||
    !/[A-Z]/.test(candidate) ||
    !/[a-z]/.test(candidate) ||
    !/\d/.test(candidate)
  ) {
    return false;
  }

  return calculateShannonEntropy(candidate) >= 4;
};

const calculateShannonEntropy = (value: string): number => {
  const counts = new Map<string, number>();

  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;

    return entropy - probability * Math.log2(probability);
  }, 0);
};
