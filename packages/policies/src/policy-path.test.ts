import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPO_POLICY_DIRECTORY,
  REPO_POLICY_FILE_NAME,
  REPO_POLICY_RELATIVE_PATH,
  RepoPolicyPathLookupError,
  getRepoPolicyFilePath,
  resolveRepoPolicyPath,
} from "./index.js";

describe("repo policy path convention", () => {
  it("exports the repo-local policy path constants", () => {
    expect(REPO_POLICY_DIRECTORY).toBe(".aicp");
    expect(REPO_POLICY_FILE_NAME).toBe("policy.json");
    expect(REPO_POLICY_RELATIVE_PATH).toBe(".aicp/policy.json");
  });

  it("resolves the policy file path under a supplied repo root", async () => {
    const repoRoot = await createTempRepoRoot("policy-path-present-");
    const policyPath = getRepoPolicyFilePath(repoRoot);

    await mkdir(join(repoRoot, REPO_POLICY_DIRECTORY), { recursive: true });
    await writeFile(policyPath, "{}", "utf8");

    await expect(resolveRepoPolicyPath(repoRoot)).resolves.toBe(policyPath);
  });

  it("rejects a missing policy file with a structured policy_file_missing error", async () => {
    const repoRoot = await createTempRepoRoot("policy-path-missing-");
    const expectedPolicyPath = getRepoPolicyFilePath(repoRoot);

    const error = await expectPolicyPathLookupError(resolveRepoPolicyPath(repoRoot));

    expect(error.code).toBe("policy_file_missing");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(expectedPolicyPath);
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain("policy_file_missing");
  });

  it("rejects a directory at the policy path with policy_path_not_file", async () => {
    const repoRoot = await createTempRepoRoot("policy-path-directory-");
    const policyPath = getRepoPolicyFilePath(repoRoot);

    await mkdir(policyPath, { recursive: true });

    const error = await expectPolicyPathLookupError(resolveRepoPolicyPath(repoRoot));

    expect(error.code).toBe("policy_path_not_file");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(policyPath);
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain("policy_path_not_file");
  });

  it("does not use fallback policy files near the repo root", async () => {
    const repoRoot = await createTempRepoRoot("policy-path-no-fallback-");

    await writeFile(join(repoRoot, "policy.json"), "{}", "utf8");
    await mkdir(join(repoRoot, REPO_POLICY_DIRECTORY), { recursive: true });
    await writeFile(join(repoRoot, REPO_POLICY_DIRECTORY, "policy.yaml"), "{}", "utf8");
    await writeFile(join(repoRoot, REPO_POLICY_DIRECTORY, "policy.json.bak"), "{}", "utf8");

    const error = await expectPolicyPathLookupError(resolveRepoPolicyPath(repoRoot));

    expect(error.code).toBe("policy_file_missing");
    expect(error.policyPath).toBe(getRepoPolicyFilePath(repoRoot));
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
  });
});

const createTempRepoRoot = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix));

const expectPolicyPathLookupError = async (
  promise: Promise<unknown>,
): Promise<RepoPolicyPathLookupError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RepoPolicyPathLookupError);
    return error as RepoPolicyPathLookupError;
  }

  throw new Error("Expected repo policy path lookup to reject.");
};
