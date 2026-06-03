import { CONTRACT_VERSION, type RepoPolicy } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import {
  PathPolicyError,
  PathPolicyPatternError,
  evaluatePathAgainstPolicy,
  evaluatePathsAgainstPolicy,
  normalizeRepoRelativePath,
} from "./index.js";

const basePolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["SECURITY_MODEL.md", ".github/workflows/**"],
  sensitivePaths: ["secrets/**", "config/*.local"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml", "**/package-lock.json"],
    migrations: ["db/migrations/**"],
    infrastructure: ["infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [
    {
      id: "policy-test",
      label: "Policy tests",
      command: "pnpm --filter @control-plane/policies test",
      timeoutSeconds: 120,
      required: true,
    },
  ],
  maxChangedFiles: 25,
  maxDiffLines: 500,
  allowUntrackedFiles: false,
  dryRunChecks: ["protected_and_sensitive_paths_configured"],
  ...overrides,
});

describe("path policy evaluator", () => {
  it("blocks exact protected path matches", () => {
    expect(evaluatePathAgainstPolicy(basePolicy(), "SECURITY_MODEL.md")).toMatchObject({
      inputPath: "SECURITY_MODEL.md",
      normalizedPath: "SECURITY_MODEL.md",
      status: "blocked",
      protectedPatterns: ["SECURITY_MODEL.md"],
      sensitivePatterns: [],
      warningMatches: [],
    });
  });

  it("blocks protected ** glob matches across path segments", () => {
    expect(
      evaluatePathAgainstPolicy(basePolicy(), ".github/workflows/release/ci.yml"),
    ).toMatchObject({
      normalizedPath: ".github/workflows/release/ci.yml",
      status: "blocked",
      protectedPatterns: [".github/workflows/**"],
    });
  });

  it("blocks sensitive policy glob matches", () => {
    expect(evaluatePathAgainstPolicy(basePolicy(), "config/app.local")).toMatchObject({
      normalizedPath: "config/app.local",
      status: "blocked",
      protectedPatterns: [],
      sensitivePatterns: ["config/*.local"],
      warningMatches: [],
    });
  });

  it("treats real env files as implicitly sensitive without blocking env examples", () => {
    const policy = basePolicy({ sensitivePaths: ["secrets/**"] });

    expect(evaluatePathAgainstPolicy(policy, ".env")).toMatchObject({
      normalizedPath: ".env",
      status: "blocked",
      sensitivePatterns: [".env"],
    });
    expect(evaluatePathAgainstPolicy(policy, "apps/web/.env.local")).toMatchObject({
      normalizedPath: "apps/web/.env.local",
      status: "blocked",
      sensitivePatterns: [".env.*"],
    });
    expect(evaluatePathAgainstPolicy(policy, ".env.example")).toMatchObject({
      normalizedPath: ".env.example",
      status: "safe",
      sensitivePatterns: [],
    });
    expect(
      evaluatePathAgainstPolicy(basePolicy({ sensitivePaths: [".env.*"] }), ".env.example"),
    ).toMatchObject({
      status: "blocked",
      sensitivePatterns: [".env.*"],
    });
  });

  it("returns warning matches for every warning path category", () => {
    const evaluations = evaluatePathsAgainstPolicy(basePolicy(), [
      "pnpm-lock.yaml",
      "db/migrations/001_add_users.sql",
      "infra/prod/main.tf",
      "apps/web/src/auth/session.ts",
      "apps/web/src/billing/checkout.ts",
    ]);

    expect(evaluations.map((evaluation) => evaluation.status)).toEqual([
      "warning",
      "warning",
      "warning",
      "warning",
      "warning",
    ]);
    expect(evaluations.map((evaluation) => evaluation.warningMatches)).toEqual([
      [{ category: "packageLocks", patterns: ["pnpm-lock.yaml"] }],
      [{ category: "migrations", patterns: ["db/migrations/**"] }],
      [{ category: "infrastructure", patterns: ["infra/**"] }],
      [{ category: "auth", patterns: ["apps/web/src/auth/**"] }],
      [{ category: "billing", patterns: ["apps/web/src/billing/**"] }],
    ]);
  });

  it("keeps warning metadata when a higher-precedence block also applies", () => {
    const policy = basePolicy({
      protectedPaths: ["infra/prod/**"],
    });

    expect(evaluatePathAgainstPolicy(policy, "infra/prod/main.tf")).toMatchObject({
      status: "blocked",
      protectedPatterns: ["infra/prod/**"],
      warningMatches: [{ category: "infrastructure", patterns: ["infra/**"] }],
    });
  });

  it("classifies paths with no policy matches as safe", () => {
    expect(evaluatePathAgainstPolicy(basePolicy(), "src/app.ts")).toEqual({
      inputPath: "src/app.ts",
      normalizedPath: "src/app.ts",
      status: "safe",
      protectedPatterns: [],
      sensitivePatterns: [],
      warningMatches: [],
    });
  });

  it("normalizes Windows separators and leading current-directory segments", () => {
    expect(normalizeRepoRelativePath(".\\src\\\\app.ts")).toBe("src/app.ts");
    expect(evaluatePathAgainstPolicy(basePolicy(), ".\\infra\\main.tf")).toMatchObject({
      normalizedPath: "infra/main.tf",
      status: "warning",
      warningMatches: [{ category: "infrastructure", patterns: ["infra/**"] }],
    });
    expect(evaluatePathAgainstPolicy(basePolicy(), "./SECURITY_MODEL.md")).toMatchObject({
      normalizedPath: "SECURITY_MODEL.md",
      status: "blocked",
      protectedPatterns: ["SECURITY_MODEL.md"],
    });
  });

  it("rejects absolute, empty, and repo-escaping paths", () => {
    expectPathPolicyError("", "empty_path");
    expectPathPolicyError("/", "absolute_path");
    expectPathPolicyError("/tmp/file.ts", "absolute_path");
    expectPathPolicyError("C:\\repo\\file.ts", "absolute_path");
    expectPathPolicyError("../outside.ts", "path_escapes_repo_root");
    expectPathPolicyError("src/../../outside.ts", "path_escapes_repo_root");
  });

  it("rejects unsupported advanced glob syntax instead of treating it literally", () => {
    expectPathPolicyPatternError("{src,lib}/**");
    expectPathPolicyPatternError("!src/**");
    expectPathPolicyPatternError("apps/@(web|runner)/**");
    expectPathPolicyPatternError("src/file?.ts");
    expectPathPolicyPatternError("src/**.ts");
  });
});

const expectPathPolicyError = (inputPath: string, code: PathPolicyError["code"]): void => {
  try {
    normalizeRepoRelativePath(inputPath);
  } catch (error) {
    expect(error).toBeInstanceOf(PathPolicyError);
    expect((error as PathPolicyError).code).toBe(code);
    expect((error as PathPolicyError).inputPath).toBe(inputPath);
    return;
  }

  throw new Error(`Expected ${inputPath} to fail with ${code}.`);
};

const expectPathPolicyPatternError = (pattern: string): void => {
  try {
    evaluatePathAgainstPolicy(basePolicy({ protectedPaths: [pattern] }), "src/app.ts");
  } catch (error) {
    expect(error).toBeInstanceOf(PathPolicyPatternError);
    expect((error as PathPolicyPatternError).code).toBe("unsupported_glob_pattern");
    expect((error as PathPolicyPatternError).pattern).toBe(pattern);
    return;
  }

  throw new Error(`Expected ${pattern} to fail as unsupported glob syntax.`);
};
