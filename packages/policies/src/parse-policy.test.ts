import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTRACT_VERSION, type RepoPolicy } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import {
  REPO_POLICY_DIRECTORY,
  REPO_POLICY_RELATIVE_PATH,
  RepoPolicyParseError,
  getRepoPolicyFilePath,
  parseRepoPolicy,
} from "./index.js";

const SECRET_LIKE_KEYS = [
  "githubToken",
  "privateKeyMaterial",
  "sk_policy_key_name_must_not_leak",
] as const;

const SECRET_LIKE_VALUES = [
  "ghp_policy_secret_1234567890",
  "sk-control-plane-policy-secret",
  "-----BEGIN PRIVATE KEY-----",
] as const;

const RAW_POLICY_SNIPPETS = [
  '{"githubToken"',
  '"privateKeyMaterial"',
  '"command":"pnpm test"',
] as const;

const POLICY_FIXTURE_NAMES = [
  "valid-policy.json",
  "missing-validation-policy.json",
  "invalid-json-policy.json",
  "sensitive-path-policy.json",
] as const;

describe("repo policy parser", () => {
  it("parses the valid policy fixture and returns typed policy fields", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-valid-");
    await writeRawPolicy(repoRoot, await readPolicyFixture("valid-policy.json"));

    const policy = await parseRepoPolicy(repoRoot);

    expect(policy.contractVersion).toBe(CONTRACT_VERSION);
    expect(policy.protectedBranches).toEqual(["main"]);
    expect(policy.protectedPaths).toEqual([".github/**"]);
    expect(policy.sensitivePaths).toEqual([".env", ".env.*"]);
    expect(policy.validationCommands[0]?.id).toBe("test");
    expect(policy.validationCommands[0]?.required).toBe(true);
    expect(policy.maxChangedFiles).toBe(25);
    expect(policy.allowUntrackedFiles).toBe(false);
    expect(policy.dryRunChecks).toContain("repo_policy_exists_and_parses");
  });

  it("rejects the missing-validation policy fixture with validation command issue paths", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-missing-validation-");
    await writeRawPolicy(repoRoot, await readPolicyFixture("missing-validation-policy.json"));

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("invalid_policy");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "validationCommands", message: expect.any(String) }),
      ]),
    );
    expectSafePolicyErrorText(error);
  });

  it("rejects the invalid JSON policy fixture without echoing fixture contents", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-invalid-json-fixture-");
    const fixtureText = await readPolicyFixture("invalid-json-policy.json");
    await writeRawPolicy(repoRoot, fixtureText);

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("invalid_json");
    expect(error.issues).toEqual([]);
    expect(error.message).not.toContain("policy-invalid-json-fixture");
    expect(`${error.message}\n${JSON.stringify(error.issues)}`).not.toContain(fixtureText);
    expectSafePolicyErrorText(error);
  });

  it("parses the sensitive path fixture with env and protected path examples", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-sensitive-path-");
    await writeRawPolicy(repoRoot, await readPolicyFixture("sensitive-path-policy.json"));

    const policy = await parseRepoPolicy(repoRoot);

    expect(policy.sensitivePaths).toEqual(expect.arrayContaining([".env", ".env.*"]));
    expect(policy.protectedPaths).toEqual(expect.arrayContaining([".github/**", "infra/prod/**"]));
    expect(policy.validationCommands.map((command) => command.id)).toContain(
      "policy-sensitive-path-test",
    );
  });

  it("parses missing path arrays as empty arrays for dry-run readiness checks", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-missing-path-arrays-");
    const policyInput: Record<string, unknown> = validPolicy();
    delete policyInput.protectedPaths;
    delete policyInput.sensitivePaths;
    await writePolicy(repoRoot, policyInput);

    const policy = await parseRepoPolicy(repoRoot);

    expect(policy.protectedPaths).toEqual([]);
    expect(policy.sensitivePaths).toEqual([]);
  });

  it("parses empty path arrays for dry-run readiness checks", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-empty-path-arrays-");
    await writePolicy(repoRoot, {
      ...validPolicy(),
      protectedPaths: [],
      sensitivePaths: [],
    });

    const policy = await parseRepoPolicy(repoRoot);

    expect(policy.protectedPaths).toEqual([]);
    expect(policy.sensitivePaths).toEqual([]);
  });

  it("keeps policy fixtures free of secrets, diffs, patches, and source-like payloads", async () => {
    for (const fixtureName of POLICY_FIXTURE_NAMES) {
      const fixtureText = await readPolicyFixture(fixtureName);

      expect(fixtureText).not.toMatch(/(?:api[_-]?key|access[_-]?token|password|secret)/iu);
      expect(fixtureText).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
      expect(fixtureText).not.toMatch(/(?:^diff --git|^\+\+\+ |^--- |^@@ )/mu);
      expect(fixtureText).not.toMatch(/"(?:source|code|diff|patch|content|snippet)"\s*:/u);
    }
  });

  it("rejects a missing policy with a structured policy_file_missing error", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-missing-");
    const expectedPolicyPath = getRepoPolicyFilePath(repoRoot);

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("policy_file_missing");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(expectedPolicyPath);
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain("policy_file_missing");
    expectSafePolicyErrorText(error);
  });

  it("rejects a directory at the policy path with policy_path_not_file", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-directory-");
    const policyPath = getRepoPolicyFilePath(repoRoot);

    await mkdir(policyPath, { recursive: true });

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("policy_path_not_file");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(policyPath);
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain("policy_path_not_file");
    expectSafePolicyErrorText(error);
  });

  it("rejects unreadable policy content with policy_read_failed", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-read-failed-");
    await writePolicy(repoRoot, validPolicy());

    const error = await expectRepoPolicyParseError(
      parseRepoPolicy(repoRoot, {
        readFile: async () => {
          throw new Error("ghp_policy_secret_1234567890");
        },
      }),
    );

    expect(error.code).toBe("policy_read_failed");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(getRepoPolicyFilePath(repoRoot));
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(REPO_POLICY_RELATIVE_PATH);
    expect(error.message).toContain("policy_read_failed");
    expectSafePolicyErrorText(error);
  });

  it("rejects invalid JSON without echoing file contents", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-invalid-json-");
    await writeRawPolicy(
      repoRoot,
      '{"githubToken":"ghp_policy_secret_1234567890","validationCommands":[{"command":"pnpm test"}]',
    );

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("invalid_json");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(getRepoPolicyFilePath(repoRoot));
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(REPO_POLICY_RELATIVE_PATH);
    expectSafePolicyErrorText(error);
  });

  it("rejects schema-invalid policies with safe issue paths", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-invalid-policy-");
    await writePolicy(repoRoot, {
      ...validPolicy(),
      validationCommands: [],
      maxChangedFiles: 0,
    });

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("invalid_policy");
    expect(error.repoRoot).toBe(repoRoot);
    expect(error.policyPath).toBe(getRepoPolicyFilePath(repoRoot));
    expect(error.relativePath).toBe(REPO_POLICY_RELATIVE_PATH);
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "validationCommands", message: expect.any(String) }),
        expect.objectContaining({ path: "maxChangedFiles", message: expect.any(String) }),
      ]),
    );
    expect(error.message).toContain("validationCommands");
    expect(error.message).toContain("maxChangedFiles");
    expectSafePolicyErrorText(error);
  });

  it("does not leak secret-looking unknown keys or values in invalid policy errors", async () => {
    const repoRoot = await createTempRepoRoot("policy-parser-secret-regression-");
    await writePolicy(repoRoot, {
      ...validPolicy(),
      [SECRET_LIKE_KEYS[0]]: SECRET_LIKE_VALUES[0],
      [SECRET_LIKE_KEYS[1]]: SECRET_LIKE_VALUES[2],
      warningPaths: {
        ...validPolicy().warningPaths,
        [SECRET_LIKE_KEYS[2]]: SECRET_LIKE_VALUES[1],
      },
    });

    const error = await expectRepoPolicyParseError(parseRepoPolicy(repoRoot));

    expect(error.code).toBe("invalid_policy");
    expect(error.issues.length).toBeGreaterThan(0);
    expectSafePolicyErrorText(error);
  });
});

const createTempRepoRoot = async (prefix: string): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(repoRoot, REPO_POLICY_DIRECTORY), { recursive: true });
  return repoRoot;
};

const writePolicy = (repoRoot: string, policy: Record<string, unknown>): Promise<void> =>
  writeRawPolicy(repoRoot, JSON.stringify(policy));

const writeRawPolicy = async (repoRoot: string, contents: string): Promise<void> => {
  await mkdir(join(repoRoot, REPO_POLICY_DIRECTORY), { recursive: true });
  await writeFile(getRepoPolicyFilePath(repoRoot), contents, "utf8");
};

const readPolicyFixture = (name: (typeof POLICY_FIXTURE_NAMES)[number]): Promise<string> =>
  readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

const expectRepoPolicyParseError = async (
  promise: Promise<unknown>,
): Promise<RepoPolicyParseError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RepoPolicyParseError);
    return error as RepoPolicyParseError;
  }

  throw new Error("Expected repo policy parser to reject.");
};

const expectSafePolicyErrorText = (error: RepoPolicyParseError): void => {
  const safeText = `${error.message}\n${JSON.stringify({
    code: error.code,
    issues: error.issues,
  })}`;

  for (const unsafeText of [...SECRET_LIKE_KEYS, ...SECRET_LIKE_VALUES, ...RAW_POLICY_SNIPPETS]) {
    expect(safeText).not.toContain(unsafeText);
  }
};

const validPolicy = (): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: [".github/**"],
  sensitivePaths: [".env", ".env.*"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["migrations/**"],
    infrastructure: ["infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [
    {
      id: "test",
      label: "Policies tests",
      command: "pnpm test",
      timeoutSeconds: 120,
      required: true,
    },
  ],
  maxChangedFiles: 25,
  maxDiffLines: 500,
  allowUntrackedFiles: false,
  dryRunChecks: [
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
    "protected_and_sensitive_paths_configured",
  ],
});
