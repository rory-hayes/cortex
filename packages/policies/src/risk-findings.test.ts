import { CONTRACT_VERSION, RiskFindingSchema, type RepoPolicy } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { buildRiskFindingsFromPathPolicyEvaluations, evaluatePathsAgainstPolicy } from "./index.js";

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

const buildFindings = (policy: RepoPolicy, paths: readonly string[]) =>
  buildRiskFindingsFromPathPolicyEvaluations(evaluatePathsAgainstPolicy(policy, paths));

describe("risk finding builder", () => {
  it("builds blocked protected path findings with normalized path-only metadata", () => {
    expect(
      buildFindings(basePolicy(), [
        "./SECURITY_MODEL.md",
        ".github\\workflows\\ci.yml",
        ".github/workflows/ci.yml",
      ]),
    ).toEqual([
      {
        id: "risk:protected_path",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path changes are blocked by repository policy.",
        paths: [".github/workflows/ci.yml", "SECURITY_MODEL.md"],
      },
    ]);
  });

  it("builds blocked sensitive path findings including implicit real env files", () => {
    expect(
      buildFindings(basePolicy({ sensitivePaths: ["secrets/**"] }), [
        ".env",
        "apps/web/.env.local",
        ".env.example",
        "secrets/token.txt",
      ]),
    ).toEqual([
      {
        id: "risk:sensitive_path",
        severity: "blocked",
        category: "sensitive_path",
        message: "Sensitive path changes are blocked by repository policy.",
        paths: [".env", "apps/web/.env.local", "secrets/token.txt"],
      },
    ]);
  });

  it("treats env examples as sensitive when explicitly matched by policy", () => {
    expect(buildFindings(basePolicy({ sensitivePaths: [".env.*"] }), [".env.example"])).toEqual([
      {
        id: "risk:sensitive_path",
        severity: "blocked",
        category: "sensitive_path",
        message: "Sensitive path changes are blocked by repository policy.",
        paths: [".env.example"],
      },
    ]);
  });

  it("maps warning path categories to warning risk findings", () => {
    expect(
      buildFindings(basePolicy(), [
        "pnpm-lock.yaml",
        "db/migrations/001_add_users.sql",
        "infra/prod/main.tf",
        "apps/web/src/auth/session.ts",
        "apps/web/src/billing/checkout.ts",
      ]),
    ).toEqual([
      {
        id: "risk:package_lock",
        severity: "warning",
        category: "package_lock",
        message: "Package lock changes require reviewer attention.",
        paths: ["pnpm-lock.yaml"],
      },
      {
        id: "risk:migration",
        severity: "warning",
        category: "migration",
        message: "Migration changes require reviewer attention.",
        paths: ["db/migrations/001_add_users.sql"],
      },
      {
        id: "risk:infrastructure",
        severity: "warning",
        category: "infrastructure",
        message: "Infrastructure changes require reviewer attention.",
        paths: ["infra/prod/main.tf"],
      },
      {
        id: "risk:auth",
        severity: "warning",
        category: "auth",
        message: "Auth changes require reviewer attention.",
        paths: ["apps/web/src/auth/session.ts"],
      },
      {
        id: "risk:billing",
        severity: "warning",
        category: "billing",
        message: "Billing changes require reviewer attention.",
        paths: ["apps/web/src/billing/checkout.ts"],
      },
    ]);
  });

  it("deduplicates paths and returns findings in deterministic category order", () => {
    const policy = basePolicy({
      protectedPaths: ["infra/**", "SECURITY_MODEL.md"],
      sensitivePaths: ["secrets/**", "config/*.local"],
    });

    expect(
      buildFindings(policy, [
        "infra/prod/main.tf",
        "secrets/token.txt",
        "pnpm-lock.yaml",
        "./SECURITY_MODEL.md",
        "config/app.local",
        "apps/web/src/auth/session.ts",
        "infra\\prod\\main.tf",
      ]),
    ).toEqual([
      {
        id: "risk:protected_path",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path changes are blocked by repository policy.",
        paths: ["SECURITY_MODEL.md", "infra/prod/main.tf"],
      },
      {
        id: "risk:sensitive_path",
        severity: "blocked",
        category: "sensitive_path",
        message: "Sensitive path changes are blocked by repository policy.",
        paths: ["config/app.local", "secrets/token.txt"],
      },
      {
        id: "risk:package_lock",
        severity: "warning",
        category: "package_lock",
        message: "Package lock changes require reviewer attention.",
        paths: ["pnpm-lock.yaml"],
      },
      {
        id: "risk:infrastructure",
        severity: "warning",
        category: "infrastructure",
        message: "Infrastructure changes require reviewer attention.",
        paths: ["infra/prod/main.tf"],
      },
      {
        id: "risk:auth",
        severity: "warning",
        category: "auth",
        message: "Auth changes require reviewer attention.",
        paths: ["apps/web/src/auth/session.ts"],
      },
    ]);
  });

  it("emits only the shared safe risk finding fields", () => {
    const findings = buildFindings(basePolicy(), [
      "SECURITY_MODEL.md",
      "apps/web/src/auth/session.ts",
    ]);

    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        "category",
        "id",
        "message",
        "paths",
        "severity",
      ]);
      expect(RiskFindingSchema.safeParse(finding).success).toBe(true);
      expect(JSON.stringify(finding)).not.toMatch(
        /protectedPatterns|sensitivePatterns|warningMatches|patterns|inputPath|diff|patch|snippet|content|stdout|stderr/u,
      );
    }
  });
});
