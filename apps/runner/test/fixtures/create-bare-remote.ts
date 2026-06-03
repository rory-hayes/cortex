import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { runCommand } from "../../src/index.js";
import type { FixtureRepo } from "./create-fixture-repo.js";

export type BareRemoteFixture = {
  rootPath: string;
  remotePath: string;
  remoteName: string;
  cleanup: () => Promise<void>;
};

export type CreateBareRemoteOptions = {
  fixture: Pick<FixtureRepo, "rootPath" | "repoPath" | "defaultBranch">;
  remoteDirectoryName?: string;
  remoteName?: string;
};

const DEFAULT_REMOTE_DIRECTORY_NAME = "remote.git";
const DEFAULT_REMOTE_NAME = "origin";

export const createBareRemote = async (
  options: CreateBareRemoteOptions,
): Promise<BareRemoteFixture> => {
  const rootPath = resolve(options.fixture.rootPath);
  const repoPath = resolve(options.fixture.repoPath);
  const remoteDirectoryName = normalizeRemoteDirectoryName(
    options.remoteDirectoryName ?? DEFAULT_REMOTE_DIRECTORY_NAME,
  );
  const remoteName = normalizeRemoteName(options.remoteName ?? DEFAULT_REMOTE_NAME);
  const remotePath = resolve(rootPath, remoteDirectoryName);

  assertInsideRoot(rootPath, repoPath, "Fixture repo path must stay inside its root.");
  assertInsideRoot(rootPath, remotePath, "Fixture bare remote path must stay inside its root.");
  assertNotFixtureRepoPath(repoPath, remotePath);

  await runGit(repoPath, ["init", "--bare", remotePath]);
  await runGit(repoPath, ["remote", "add", remoteName, remotePath]);
  await runGit(repoPath, ["push", "-u", remoteName, options.fixture.defaultBranch]);

  return {
    rootPath,
    remotePath,
    remoteName,
    cleanup: async () => {
      assertInsideRoot(rootPath, remotePath, "Fixture bare remote path must stay inside its root.");
      assertNotFixtureRepoPath(repoPath, remotePath);
      await rm(remotePath, { force: true, recursive: true });
    },
  };
};

const runGit = async (cwd: string, args: readonly string[]) =>
  runCommand({
    command: "git",
    args,
    cwd,
    throwOnNonZero: true,
  });

const normalizeRemoteDirectoryName = (remoteDirectoryName: string): string => {
  if (
    remoteDirectoryName.length === 0 ||
    remoteDirectoryName === "." ||
    remoteDirectoryName === ".." ||
    remoteDirectoryName.includes("/") ||
    remoteDirectoryName.includes("\\") ||
    remoteDirectoryName.includes(":")
  ) {
    throw new Error("Invalid fixture bare remote directory name.");
  }

  return remoteDirectoryName;
};

const normalizeRemoteName = (remoteName: string): string => {
  if (
    remoteName.length === 0 ||
    remoteName === "." ||
    remoteName === ".." ||
    remoteName.includes("/") ||
    remoteName.includes("\\") ||
    remoteName.includes(":")
  ) {
    throw new Error("Invalid fixture bare remote name.");
  }

  return remoteName;
};

const assertInsideRoot = (rootPath: string, targetPath: string, message: string): void => {
  const relativePath = relative(rootPath, targetPath);

  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(message);
  }
};

const assertNotFixtureRepoPath = (repoPath: string, remotePath: string): void => {
  if (remotePath === repoPath) {
    throw new Error("Fixture bare remote path must not be the fixture repo path.");
  }
};
