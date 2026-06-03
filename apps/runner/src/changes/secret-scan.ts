import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { RiskFindingSchema, type RiskFinding } from "@control-plane/shared";

export type SecretPatternCategory =
  | "private_key"
  | "credential_url"
  | "provider_token"
  | "jwt"
  | "secret_assignment"
  | "high_entropy";

export type SecretScanFinding = RiskFinding;

export type SecretScanOptions = Record<string, never>;

const SECRET_PATTERN_CATEGORIES = [
  "private_key",
  "credential_url",
  "provider_token",
  "jwt",
  "secret_assignment",
  "high_entropy",
] as const satisfies readonly SecretPatternCategory[];

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;
const CREDENTIAL_URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s)'"<>]+/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const SECRET_ASSIGNMENT_PATTERN =
  /^\s*(?:export\s+)?(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#;,)]+))/i;
const HIGH_ENTROPY_CONTEXT_PATTERN =
  /(?:api[_-]?key|token|secret|password|passwd|private[_-]?key|credential|auth|bearer)/i;
const HIGH_ENTROPY_CANDIDATE_PATTERN = /\b[A-Za-z0-9/+_-]{32,}={0,2}\b/g;
const MIN_HIGH_ENTROPY_SCORE = 4.2;

const PROVIDER_TOKEN_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
] as const;

type PathFindingSets = Record<SecretPatternCategory, Set<string>>;

export const scanChangedFilesForSecrets = async (
  worktreePath: string,
  changedPaths: readonly string[],
  options: SecretScanOptions = {},
): Promise<SecretScanFinding[]> => {
  void options;

  const rootPath = resolve(worktreePath);
  const pathSets = createPathFindingSets();
  const normalizedPaths = sortedPaths(
    new Set(changedPaths.map(normalizeChangedPath).filter(isDefined)),
  );

  for (const normalizedPath of normalizedPaths) {
    const localPath = resolveLocalPath(rootPath, normalizedPath);

    if (localPath === undefined) {
      continue;
    }

    const contents = await readLocalRegularFile(rootPath, normalizedPath, localPath);

    if (contents === undefined) {
      continue;
    }

    for (const category of detectSecretCategories(contents)) {
      pathSets[category].add(normalizedPath);
    }
  }

  return buildFindings(pathSets);
};

const createPathFindingSets = (): PathFindingSets => ({
  private_key: new Set<string>(),
  credential_url: new Set<string>(),
  provider_token: new Set<string>(),
  jwt: new Set<string>(),
  secret_assignment: new Set<string>(),
  high_entropy: new Set<string>(),
});

const detectSecretCategories = (contents: string): SecretPatternCategory[] => {
  const categories = new Set<SecretPatternCategory>();

  if (PRIVATE_KEY_PATTERN.test(contents)) {
    categories.add("private_key");
  }

  if (CREDENTIAL_URL_PATTERN.test(contents)) {
    categories.add("credential_url");
  }

  if (containsProviderToken(contents)) {
    categories.add("provider_token");
  }

  if (JWT_PATTERN.test(contents)) {
    categories.add("jwt");
  }

  if (containsSecretAssignment(contents)) {
    categories.add("secret_assignment");
  }

  if (containsContextualHighEntropyToken(contents)) {
    categories.add("high_entropy");
  }

  return SECRET_PATTERN_CATEGORIES.filter((category) => categories.has(category));
};

const containsProviderToken = (value: string): boolean =>
  PROVIDER_TOKEN_PATTERNS.some((pattern) => pattern.test(value));

const containsSecretAssignment = (contents: string): boolean => {
  for (const line of splitLines(contents)) {
    const match = SECRET_ASSIGNMENT_PATTERN.exec(line);

    if (match === null) {
      continue;
    }

    const value = match[1] ?? match[2] ?? match[3] ?? "";

    if (isLikelySecretAssignmentValue(value) && !containsSpecificSecretPattern(value)) {
      return true;
    }
  }

  return false;
};

const containsContextualHighEntropyToken = (contents: string): boolean => {
  for (const line of splitLines(contents)) {
    if (!HIGH_ENTROPY_CONTEXT_PATTERN.test(line) || lineContainsSpecificSecretPattern(line)) {
      continue;
    }

    for (const candidate of line.matchAll(HIGH_ENTROPY_CANDIDATE_PATTERN)) {
      const token = candidate[0];

      if (isHighEntropySecretCandidate(token)) {
        return true;
      }
    }
  }

  return false;
};

const lineContainsSpecificSecretPattern = (line: string): boolean =>
  PRIVATE_KEY_PATTERN.test(line) ||
  CREDENTIAL_URL_PATTERN.test(line) ||
  containsProviderToken(line) ||
  JWT_PATTERN.test(line) ||
  containsSecretAssignment(line);

const containsSpecificSecretPattern = (value: string): boolean =>
  PRIVATE_KEY_PATTERN.test(value) ||
  CREDENTIAL_URL_PATTERN.test(value) ||
  containsProviderToken(value) ||
  JWT_PATTERN.test(value);

const isLikelySecretAssignmentValue = (value: string): boolean => {
  const normalized = normalizeSecretValue(value);

  return (
    normalized.length >= 8 &&
    !isObviousPlaceholder(normalized) &&
    !/^(?:true|false|null|undefined|none|0|1)$/i.test(normalized)
  );
};

const isHighEntropySecretCandidate = (value: string): boolean => {
  const normalized = normalizeSecretValue(value);

  return (
    normalized.length >= 32 &&
    !isObviousPlaceholder(normalized) &&
    hasMixedTokenClasses(normalized) &&
    shannonEntropy(normalized) >= MIN_HIGH_ENTROPY_SCORE
  );
};

const normalizeSecretValue = (value: string): string => value.trim().replace(/^['"]|['"]$/g, "");

const isObviousPlaceholder = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();

  return (
    /^<[^<>]+>$/.test(normalized) ||
    new Set(["placeholder", "example", "mock", "changeme", "your_api_key"]).has(normalized)
  );
};

const hasMixedTokenClasses = (value: string): boolean => {
  const classCount = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[+/_-]/.test(value),
  ].filter(Boolean).length;

  return classCount >= 3;
};

const shannonEntropy = (value: string): number => {
  const counts = new Map<string, number>();

  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
};

const splitLines = (value: string): string[] => value.split(/\r?\n/);

const normalizeChangedPath = (value: string): string | undefined => {
  if (value.length === 0 || value.trim() !== value || hasControlCharacters(value)) {
    return undefined;
  }

  const path = value.replace(/\\/g, "/");

  if (
    path.startsWith("/") ||
    path.includes("://") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  const normalized = path
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized;
};

const resolveLocalPath = (rootPath: string, normalizedPath: string): string | undefined => {
  const localPath = resolve(rootPath, normalizedPath);

  if (!isPathInsideRoot(rootPath, localPath)) {
    return undefined;
  }

  return localPath;
};

const isPathInsideRoot = (rootPath: string, localPath: string): boolean =>
  localPath === rootPath || localPath.startsWith(`${rootPath}${sep}`);

const readLocalRegularFile = async (
  rootPath: string,
  normalizedPath: string,
  localPath: string,
): Promise<string | undefined> => {
  try {
    const stats = await lstatSafePath(rootPath, normalizedPath);

    if (stats === undefined || !stats.isFile()) {
      return undefined;
    }

    return await readFile(localPath, "utf8");
  } catch {
    return undefined;
  }
};

const lstatSafePath = async (
  rootPath: string,
  normalizedPath: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> => {
  const segments = normalizedPath.split("/");
  let currentPath = rootPath;
  let stats: Awaited<ReturnType<typeof lstat>> | undefined;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment === undefined) {
      return undefined;
    }

    currentPath = resolve(currentPath, segment);
    stats = await lstat(currentPath);

    if (stats.isSymbolicLink()) {
      return undefined;
    }

    if (index < segments.length - 1 && !stats.isDirectory()) {
      return undefined;
    }
  }

  return stats;
};

const buildFindings = (pathSets: PathFindingSets): SecretScanFinding[] =>
  SECRET_PATTERN_CATEGORIES.flatMap((category) => {
    const paths = sortedPaths(pathSets[category]);

    if (paths.length === 0) {
      return [];
    }

    return [
      RiskFindingSchema.parse({
        id: `risk:secret:${category}`,
        severity: "blocked",
        category: "secret",
        message: `Suspected secret detected: ${category}.`,
        paths,
      }),
    ];
  });

const sortedPaths = (paths: Iterable<string>): string[] => [...paths].sort(comparePaths);

const comparePaths = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
