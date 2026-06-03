import { realpath as defaultRealpath } from "node:fs/promises";
import { basename } from "node:path";

import {
  loadRunnerCredential,
  type LoadRunnerCredentialOptions,
  type RunnerCredentialRecord,
} from "./credential-store.js";
import { RunnerError } from "./errors.js";
import { isSafeBranchName } from "./git/branch-name.js";
import {
  assertSafeRunnerRepoMappingMetadata,
  postRunnerRepoMapping,
  type PostRunnerRepoMappingOptions,
  type RunnerRepoMappingMetadata,
  type RunnerRepoMappingResult,
} from "./protocol/repo-mappings.js";
import {
  RepoPathValidationError,
  runGitForRepoPathValidation,
  validateRepoPath,
  type RepoPathGitResult,
  type RunGitForRepoPathValidation,
} from "./repo-path.js";

export type RunnerRepoMappingGitRunner = RunGitForRepoPathValidation;

export type RunnerReposAddOptions = {
  credentialPath?: string;
  path: string;
};

export type RunnerReposAddDependencies = {
  loadCredential?: (options?: LoadRunnerCredentialOptions) => Promise<RunnerCredentialRecord>;
  postRepoMapping?: (options: PostRunnerRepoMappingOptions) => Promise<RunnerRepoMappingResult>;
  realpath?: (path: string) => Promise<string>;
  runGit?: RunnerRepoMappingGitRunner;
};

export type RunnerRepoProvider = "bitbucket" | "github" | "gitlab" | "local" | "unknown";

export type RunnerRepoMetadata = RunnerRepoMappingMetadata & {
  provider: RunnerRepoProvider;
  remoteUrl: string | null;
};

type RemoteIdentity = {
  name: string;
  owner: string;
  provider: RunnerRepoProvider;
};

type ParsedRemoteIdentity = {
  host: string;
  name: string;
  owner: string;
  provider?: RunnerRepoProvider;
};

const unsafeRemotePatterns = [
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
];

const safeMetadataPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;

export const runRunnerReposAdd = async (
  options: RunnerReposAddOptions,
  dependencies: RunnerReposAddDependencies = {},
): Promise<RunnerRepoMappingResult> => {
  const repoPath = options.path.trim();

  if (repoPath.length === 0) {
    throw new RunnerError({
      category: "usage",
      userSafeMessage: "Repository path is required.",
    });
  }

  const runGit = dependencies.runGit ?? runGitForRepoPathValidation;

  try {
    await validateRepoPath(repoPath, { runGit });
  } catch (error) {
    if (error instanceof RepoPathValidationError) {
      throw new RunnerError({
        category: "repo_path",
        userSafeMessage: "Repository path could not be validated.",
      });
    }

    throw error;
  }

  const localPath = await canonicalizeLocalPath(repoPath, dependencies.realpath ?? defaultRealpath);
  const remoteUrl = await detectOriginRemoteUrl(localPath, runGit);

  if (remoteUrl !== null && isUnsafeRemoteUrl(remoteUrl)) {
    throw new RunnerError({
      category: "usage",
      userSafeMessage: "Repository remote URL is not safe to register.",
    });
  }

  if (remoteUrl !== null) {
    assertSafeRemoteUrlMetadata(remoteUrl);
  }

  const defaultBranch = await detectDefaultBranch(localPath, runGit);
  const identity =
    remoteUrl === null ? fallbackLocalIdentity(localPath) : deriveRemoteIdentity(remoteUrl);
  const mapping = assertSafeRunnerRepoMappingMetadata(
    assertSafeRepoMetadata({
      defaultBranch,
      localPath,
      provider: identity.provider,
      remoteUrl,
      repositoryName: identity.name,
      repositoryOwner: identity.owner,
    }),
  );
  const loadCredential = dependencies.loadCredential ?? loadRunnerCredential;
  const credential = await loadCredential(
    options.credentialPath === undefined ? {} : { credentialPath: options.credentialPath },
  );
  const postRepoMapping = dependencies.postRepoMapping ?? postRunnerRepoMapping;

  return postRepoMapping({
    credential,
    mapping,
  });
};

const canonicalizeLocalPath = async (
  repoPath: string,
  realpath: (path: string) => Promise<string>,
): Promise<string> => {
  try {
    return await realpath(repoPath);
  } catch {
    throw new RunnerError({
      category: "repo_path",
      userSafeMessage: "Repository path could not be canonicalized.",
    });
  }
};

const detectOriginRemoteUrl = async (
  repoPath: string,
  runGit: RunnerRepoMappingGitRunner,
): Promise<string | null> => {
  const result = await runSafeGit(runGit, ["remote", "get-url", "origin"], repoPath);

  if (result.exitCode !== 0) {
    return null;
  }

  const remoteUrl = result.stdout.trim();

  return remoteUrl.length === 0 ? null : remoteUrl;
};

const detectDefaultBranch = async (
  repoPath: string,
  runGit: RunnerRepoMappingGitRunner,
): Promise<string> => {
  const originHead = await runSafeGit(
    runGit,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repoPath,
  );

  if (originHead.exitCode === 0) {
    const branch = normalizeOriginHead(originHead.stdout.trim());

    if (branch !== null) {
      return branch;
    }

    throw unsafeMetadataError();
  }

  const currentBranch = await runSafeGit(runGit, ["rev-parse", "--abbrev-ref", "HEAD"], repoPath);

  if (currentBranch.exitCode === 0) {
    const branch = currentBranch.stdout.trim();

    if (branch !== "HEAD" && isSafeDefaultBranchName(branch)) {
      return branch;
    }

    if (branch.length > 0 && branch !== "HEAD") {
      throw unsafeMetadataError();
    }
  }

  throw new RunnerError({
    category: "command_execution",
    userSafeMessage: "Repository default branch could not be detected.",
  });
};

const runSafeGit = async (
  runGit: RunnerRepoMappingGitRunner,
  args: readonly string[],
  cwd: string,
): Promise<RepoPathGitResult> => {
  try {
    return await runGit(args, { cwd });
  } catch {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Repository metadata could not be detected.",
    });
  }
};

const normalizeOriginHead = (value: string): string | null => {
  const normalized = value.startsWith("origin/") ? value.slice("origin/".length) : value;

  return isSafeDefaultBranchName(normalized) ? normalized : null;
};

const isUnsafeRemoteUrl = (remoteUrl: string): boolean => {
  if (unsafeRemotePatterns.some((pattern) => pattern.test(remoteUrl))) {
    return true;
  }

  if (hasCredentialedScpStyleRemote(remoteUrl)) {
    return true;
  }

  try {
    const parsedUrl = new URL(remoteUrl);

    if (
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      (parsedUrl.username.length > 0 || parsedUrl.password.length > 0)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
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

const assertSafeRemoteUrlMetadata = (remoteUrl: string): void => {
  assertSafeRunnerRepoMappingMetadata({
    defaultBranch: "main",
    localPath: "/repository",
    provider: "github",
    remoteUrl,
    repositoryName: "repository",
    repositoryOwner: "owner",
  });
};

const deriveRemoteIdentity = (remoteUrl: string): RemoteIdentity => {
  const parsed = parseRemoteOwnerName(remoteUrl);

  if (parsed === null) {
    throw new RunnerError({
      category: "usage",
      userSafeMessage: "Repository remote metadata could not be parsed.",
    });
  }

  return {
    name: parsed.name,
    owner: parsed.owner,
    provider: parsed.provider ?? providerForHost(parsed.host),
  };
};

const parseRemoteOwnerName = (remoteUrl: string): ParsedRemoteIdentity | null => {
  const localPathStyle = parseLocalPathStyleRemote(remoteUrl);

  if (localPathStyle !== null) {
    return localPathStyle;
  }

  const urlStyle = parseUrlStyleRemote(remoteUrl);

  if (urlStyle !== null) {
    return urlStyle;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(remoteUrl)) {
    return null;
  }

  const scpStyleMatch = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(remoteUrl);

  if (scpStyleMatch === null) {
    return null;
  }

  return parseOwnerNameFromPath(scpStyleMatch[1] ?? "", scpStyleMatch[2] ?? "");
};

const parseLocalPathStyleRemote = (remoteUrl: string): ParsedRemoteIdentity | null => {
  let localRemotePath: string;

  try {
    const parsedUrl = new URL(remoteUrl);

    if (parsedUrl.protocol !== "file:") {
      return null;
    }

    localRemotePath = parsedUrl.pathname;
  } catch {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(remoteUrl)) {
      return null;
    }

    if (/^(?:[^@]+@)?[^:]+:.+$/u.test(remoteUrl)) {
      return null;
    }

    localRemotePath = remoteUrl;
  }

  const name = stripGitSuffix(basename(localRemotePath));

  if (!isSafeMetadataText(name)) {
    return null;
  }

  return {
    host: "local",
    name,
    owner: "local",
    provider: "local",
  };
};

const parseUrlStyleRemote = (remoteUrl: string): ParsedRemoteIdentity | null => {
  try {
    const parsedUrl = new URL(remoteUrl);

    return parseOwnerNameFromPath(parsedUrl.hostname, parsedUrl.pathname);
  } catch {
    return null;
  }
};

const parseOwnerNameFromPath = (
  host: string,
  remotePath: string,
): { host: string; name: string; owner: string } | null => {
  const segments = remotePath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length < 2) {
    return null;
  }

  const owner = segments.at(-2);
  const rawName = segments.at(-1);

  if (owner === undefined || rawName === undefined) {
    return null;
  }

  const name = stripGitSuffix(rawName);

  if (!isSafeMetadataText(host) || !isSafeMetadataText(owner) || !isSafeMetadataText(name)) {
    return null;
  }

  return {
    host,
    name,
    owner,
  };
};

const providerForHost = (host: string): RunnerRepoProvider => {
  const normalizedHost = host.toLowerCase();

  if (normalizedHost === "github.com" || normalizedHost.endsWith(".github.com")) {
    return "github";
  }

  if (normalizedHost === "gitlab.com" || normalizedHost.endsWith(".gitlab.com")) {
    return "gitlab";
  }

  if (normalizedHost === "bitbucket.org" || normalizedHost.endsWith(".bitbucket.org")) {
    return "bitbucket";
  }

  return "unknown";
};

const fallbackLocalIdentity = (localPath: string): RemoteIdentity => {
  const localName = stripGitSuffix(basename(localPath));

  return {
    name: isSafeMetadataText(localName) ? localName : "repository",
    owner: "local",
    provider: "local",
  };
};

const stripGitSuffix = (value: string): string =>
  value.toLowerCase().endsWith(".git") ? value.slice(0, -4) : value;

const assertSafeRepoMetadata = (metadata: RunnerRepoMetadata): RunnerRepoMetadata => {
  const values = [
    metadata.defaultBranch,
    metadata.provider,
    metadata.repositoryName,
    metadata.repositoryOwner,
  ];

  if (values.some((value) => !isSafeMetadataText(value))) {
    throw unsafeMetadataError();
  }

  if (!isSafeLocalPathMetadataText(metadata.localPath)) {
    throw unsafeMetadataError();
  }

  if (metadata.remoteUrl !== null && !isSafeRemoteMetadataText(metadata.remoteUrl)) {
    throw unsafeMetadataError();
  }

  return metadata;
};

const unsafeMetadataError = () =>
  new RunnerError({
    category: "usage",
    userSafeMessage: "Repository metadata is not safe to register.",
  });

const isSafeMetadataText = (value: string): boolean =>
  safeMetadataPattern.test(value) && !unsafeRemotePatterns.some((pattern) => pattern.test(value));

const isSafeDefaultBranchName = (value: string): boolean =>
  isSafeMetadataText(value) && isSafeBranchName(value);

const isSafeLocalPathMetadataText = (value: string): boolean => {
  if (value.length === 0 || value.length > 1_024) {
    return false;
  }

  if (hasControlCharacter(value)) {
    return false;
  }

  return !unsafeRemotePatterns.some((pattern) => pattern.test(value));
};

const isSafeRemoteMetadataText = (value: string): boolean => {
  if (value.length === 0 || value.length > 2_048) {
    return false;
  }

  if (hasControlCharacter(value)) {
    return false;
  }

  return (
    !unsafeRemotePatterns.some((pattern) => pattern.test(value)) &&
    !hasCredentialedScpStyleRemote(value)
  );
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });
