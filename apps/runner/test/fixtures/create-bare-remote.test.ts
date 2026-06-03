import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../../src/index.js";
import { createBareRemote, type BareRemoteFixture } from "./create-bare-remote.js";
import { createFixtureRepo, type FixtureRepo } from "./create-fixture-repo.js";

const fixtures: FixtureRepo[] = [];
const remotes: BareRemoteFixture[] = [];

describe("createBareRemote", () => {
  afterEach(async () => {
    await Promise.all(remotes.splice(0).map((remote) => remote.cleanup()));
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  });

  it("creates a local bare remote and configures fixture repo origin", async () => {
    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    const remote = await createBareRemote({ fixture });
    remotes.push(remote);

    expect(remote.rootPath).toBe(fixture.rootPath);
    expect(relative(fixture.rootPath, remote.remotePath)).toBe("remote.git");
    expect(remote.remoteName).toBe("origin");

    await expectCommand(["git", "rev-parse", "--is-bare-repository"], remote.remotePath, "true\n");
    await expectCommand(
      ["git", "remote", "get-url", "origin"],
      fixture.repoPath,
      `${remote.remotePath}\n`,
    );
    await expectCleanStatus(fixture.repoPath);
  });

  it("allows a fixture branch to push to the local bare remote", async () => {
    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    const remote = await createBareRemote({ fixture });
    remotes.push(remote);

    const branchName = "fixture/test-push";
    await runGit(fixture.repoPath, ["checkout", "-b", branchName]);
    await writeSyntheticFile(fixture.repoPath, "src/pushed.txt", "synthetic push proof\n");
    await runGit(fixture.repoPath, ["add", "src/pushed.txt"]);
    await runGit(fixture.repoPath, ["commit", "-m", "Add push proof"]);
    await runGit(fixture.repoPath, ["push", "-u", "origin", branchName]);

    const localHead = await runGit(fixture.repoPath, ["rev-parse", "HEAD"]);
    const remoteHead = await runGit(fixture.rootPath, [
      "--git-dir",
      remote.remotePath,
      "rev-parse",
      `refs/heads/${branchName}`,
    ]);

    expect(remoteHead.stdoutSummary).toBe(localHead.stdoutSummary);
  });

  it.each([
    "",
    "..",
    "../remote.git",
    "nested/remote.git",
    "nested\\remote.git",
    "ssh://remote.git",
    "https:remote.git",
  ])("rejects unsafe remote directory name %j", async (remoteDirectoryName) => {
    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    await expect(createBareRemote({ fixture, remoteDirectoryName })).rejects.toThrow(
      "Invalid fixture bare remote directory name.",
    );

    await expectCleanStatus(fixture.repoPath);
  });

  it("rejects a bare remote path that resolves to the fixture repo", async () => {
    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    await expect(createBareRemote({ fixture, remoteDirectoryName: "repo" })).rejects.toThrow(
      "Fixture bare remote path must not be the fixture repo path.",
    );

    await expectPathExists(fixture.repoPath);
    await expectCleanStatus(fixture.repoPath);
    await expect(readFile(join(fixture.repoPath, "README.md"), "utf8")).resolves.toContain(
      "Fixture Repo",
    );
  });

  it("cleans up only the bare remote path and keeps the fixture repo", async () => {
    const fixture = await createFixtureRepo();
    fixtures.push(fixture);

    const remote = await createBareRemote({ fixture });

    await expectPathExists(remote.remotePath);
    await expectPathExists(fixture.repoPath);

    await remote.cleanup();

    await expect(stat(remote.remotePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expectPathExists(fixture.repoPath);
    await expect(readFile(join(fixture.repoPath, "README.md"), "utf8")).resolves.toContain(
      "Fixture Repo",
    );
  });
});

const runGit = async (cwd: string, args: readonly string[]) =>
  runCommand({
    command: "git",
    args,
    cwd,
    throwOnNonZero: true,
  });

const expectCommand = async (
  command: readonly [string, ...string[]],
  cwd: string,
  expectedStdout: string,
): Promise<void> => {
  const [executable, ...args] = command;
  const result = await runCommand({
    command: executable,
    args,
    cwd,
    throwOnNonZero: true,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdoutSummary).toBe(expectedStdout);
  expect(result.stderrSummary).toBe("");
};

const expectCleanStatus = async (repoPath: string): Promise<void> => {
  await expectCommand(["git", "status", "--porcelain=v1"], repoPath, "");
};

const writeSyntheticFile = async (
  repoPath: string,
  repoRelativePath: string,
  contents: string,
): Promise<void> => {
  const absolutePath = join(repoPath, repoRelativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
};

const expectPathExists = async (path: string): Promise<void> => {
  await expect(stat(path)).resolves.toBeDefined();
};
