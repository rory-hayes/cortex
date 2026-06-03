import {
  CONTRACT_VERSION,
  RepoPolicySchema,
  RiskFindingSchema,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { detectWarningPathFindings } from "./warning-paths.js";
import {
  detectWarningPathFindings as detectWarningPathFindingsFromEntrypoint,
  type WarningPathFinding as WarningPathFindingFromEntrypoint,
} from "../index.js";

const UNSAFE_TEXT = [
  "custom-package-locks/**",
  "custom-migrations/**",
  "custom-infra/**",
  "custom-auth/**",
  "custom-billing/**",
  "protected/private/**",
  "secrets/**",
  "diff --git a/private.ts b/private.ts",
  "@@ -1,1 +1,1 @@",
  "patch contains private implementation",
  "source",
  "code",
  "content",
  "stdoutSummary",
  "stderrSummary",
  "command output line",
  "SECRET_TOKEN=do-not-print",
  "ghp_warningpathsecret123",
  "sk-warningpathsecret123",
] as const;

describe("warning path classifier", () => {
  it("returns ordered schema-valid warnings for policy warning paths", () => {
    const findings = detectWarningPathFindings(
      validPolicy({
        warningPaths: {
          packageLocks: ["custom-package-locks/**"],
          migrations: ["custom-migrations/**"],
          infrastructure: ["custom-infra/**"],
          auth: ["custom-auth/**"],
          billing: ["custom-billing/**"],
        },
      }),
      [
        "custom-billing/checkout.ts",
        "custom-auth/session.ts",
        "custom-infra/main.tf",
        "custom-migrations/001-init.sql",
        "custom-package-locks/pnpm-lock.yaml",
      ],
    );

    expect(findings).toEqual([
      {
        id: "risk:package_lock",
        severity: "warning",
        category: "package_lock",
        message: "Package lock changes require reviewer attention.",
        paths: ["custom-package-locks/pnpm-lock.yaml"],
      },
      {
        id: "risk:migration",
        severity: "warning",
        category: "migration",
        message: "Migration changes require reviewer attention.",
        paths: ["custom-migrations/001-init.sql"],
      },
      {
        id: "risk:infrastructure",
        severity: "warning",
        category: "infrastructure",
        message: "Infrastructure changes require reviewer attention.",
        paths: ["custom-infra/main.tf"],
      },
      {
        id: "risk:auth",
        severity: "warning",
        category: "auth",
        message: "Auth changes require reviewer attention.",
        paths: ["custom-auth/session.ts"],
      },
      {
        id: "risk:billing",
        severity: "warning",
        category: "billing",
        message: "Billing changes require reviewer attention.",
        paths: ["custom-billing/checkout.ts"],
      },
    ]);

    for (const finding of findings) {
      expect(RiskFindingSchema.parse(finding)).toEqual(finding);
    }
  });

  it("uses conservative built-in warning patterns when policy warning arrays are empty", () => {
    const findings = detectWarningPathFindings(validPolicy({ warningPaths: emptyWarningPaths() }), [
      "packages/api/package-lock.json",
      "prisma/migrations/20260521000000_init/migration.sql",
      "terraform/prod/main.tf",
      "apps/web/src/auth/session.ts",
      "apps/web/src/billing/checkout.ts",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:package_lock",
        severity: "warning",
        category: "package_lock",
        message: "Package lock changes require reviewer attention.",
        paths: ["packages/api/package-lock.json"],
      },
      {
        id: "risk:migration",
        severity: "warning",
        category: "migration",
        message: "Migration changes require reviewer attention.",
        paths: ["prisma/migrations/20260521000000_init/migration.sql"],
      },
      {
        id: "risk:infrastructure",
        severity: "warning",
        category: "infrastructure",
        message: "Infrastructure changes require reviewer attention.",
        paths: ["terraform/prod/main.tf"],
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

  it("normalizes Windows separators, deduplicates paths, and sorts deterministically", () => {
    const findings = detectWarningPathFindings(validPolicy({ warningPaths: emptyWarningPaths() }), [
      "apps\\web\\src\\auth\\z-session.ts",
      "apps/web/src/auth/a-session.ts",
      "apps/web/src/auth/z-session.ts",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:auth",
        severity: "warning",
        category: "auth",
        message: "Auth changes require reviewer attention.",
        paths: ["apps/web/src/auth/a-session.ts", "apps/web/src/auth/z-session.ts"],
      },
    ]);
  });

  it("does not emit blocked findings for protected or sensitive path overlaps", () => {
    const findings = detectWarningPathFindings(
      validPolicy({
        protectedPaths: ["terraform/**"],
        sensitivePaths: ["apps/web/src/auth/**", ".env"],
        warningPaths: emptyWarningPaths(),
      }),
      ["terraform/prod/main.tf", "apps/web/src/auth/session.ts", ".env", "pnpm-lock.yaml"],
    );

    expect(findings).toEqual([
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
        paths: ["terraform/prod/main.tf"],
      },
      {
        id: "risk:auth",
        severity: "warning",
        category: "auth",
        message: "Auth changes require reviewer attention.",
        paths: ["apps/web/src/auth/session.ts"],
      },
    ]);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(findings.map((finding) => finding.category)).not.toContain("protected_path");
    expect(findings.map((finding) => finding.category)).not.toContain("sensitive_path");
  });

  it("serializes only safe RiskFinding fields without policy patterns or raw artifacts", () => {
    const findings = detectWarningPathFindings(
      validPolicy({
        protectedPaths: ["protected/private/**"],
        sensitivePaths: ["secrets/**", "SECRET_TOKEN=do-not-print"],
        warningPaths: {
          packageLocks: ["custom-package-locks/**"],
          migrations: ["custom-migrations/**"],
          infrastructure: ["custom-infra/**", "diff --git a/private.ts b/private.ts"],
          auth: ["custom-auth/**", "source"],
          billing: ["custom-billing/**", "command output line"],
        },
      }),
      [
        "custom-package-locks/pnpm-lock.yaml",
        "custom-migrations/001-init.sql",
        "custom-infra/main.tf",
        "custom-auth/session.ts",
        "custom-billing/checkout.ts",
      ],
    );

    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        "category",
        "id",
        "message",
        "paths",
        "severity",
      ]);
      expect(RiskFindingSchema.parse(finding)).toEqual(finding);
    }
    expectSafeSerializedValue(findings);
  });

  it("exports the detector and finding type from the runner entrypoint", () => {
    const finding: WarningPathFindingFromEntrypoint = {
      id: "risk:billing",
      severity: "warning",
      category: "billing",
      message: "Billing changes require reviewer attention.",
      paths: ["apps/web/src/billing/checkout.ts"],
    } satisfies RiskFinding;

    expect(finding.paths).toEqual(["apps/web/src/billing/checkout.ts"]);
    expect(detectWarningPathFindingsFromEntrypoint).toBe(detectWarningPathFindings);
  });
});

const emptyWarningPaths = (): RepoPolicy["warningPaths"] => ({
  packageLocks: [],
  migrations: [],
  infrastructure: [],
  auth: [],
  billing: [],
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy =>
  RepoPolicySchema.parse({
    contractVersion: CONTRACT_VERSION,
    protectedBranches: ["main"],
    protectedPaths: ["SECURITY_MODEL.md"],
    sensitivePaths: ["secrets/**"],
    warningPaths: {
      packageLocks: ["pnpm-lock.yaml"],
      migrations: ["migrations/**"],
      infrastructure: [".github/**"],
      auth: ["src/auth/**"],
      billing: ["src/billing/**"],
    },
    validationCommands: [
      {
        id: "test",
        label: "Tests",
        command: "pnpm test",
        timeoutSeconds: 60,
        required: true,
      },
    ],
    maxChangedFiles: 50,
    allowUntrackedFiles: false,
    dryRunChecks: ["protected_and_sensitive_paths_configured"],
    ...overrides,
  });

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeText of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};
