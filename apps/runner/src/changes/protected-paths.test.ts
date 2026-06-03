import {
  CONTRACT_VERSION,
  RepoPolicySchema,
  RiskFindingSchema,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { detectProtectedPathBlocks } from "./protected-paths.js";
import {
  detectProtectedPathBlocks as detectProtectedPathBlocksFromEntrypoint,
  type ProtectedPathBlockFinding as ProtectedPathBlockFindingFromEntrypoint,
} from "../index.js";

const UNSAFE_TEXT = [
  "src/private/**",
  "apps/{web,runner}/**",
  "secrets/**",
  "pnpm-lock.yaml",
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
  "ghp_protectedpathsecret123",
  "sk-protectedpathsecret123",
] as const;

describe("protected path safety gate", () => {
  it("blocks exact and glob protected path matches with a schema-valid RiskFinding", () => {
    const findings = detectProtectedPathBlocks(
      validPolicy({
        protectedPaths: ["SECURITY_MODEL.md", ".github/workflows/**"],
      }),
      ["src/app.ts", ".github/workflows/ci.yml", "SECURITY_MODEL.md"],
    );

    expect(findings).toEqual([
      {
        id: "risk:protected_path",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path changes are blocked by repository policy.",
        paths: [".github/workflows/ci.yml", "SECURITY_MODEL.md"],
      },
    ]);
    expect(RiskFindingSchema.parse(findings[0])).toEqual(findings[0]);
  });

  it("normalizes Windows separators and deduplicates blocked paths", () => {
    const findings = detectProtectedPathBlocks(
      validPolicy({
        protectedPaths: [".github/workflows/**"],
      }),
      [".github\\workflows\\ci.yml", ".github/workflows/ci.yml", ".github\\workflows\\release.yml"],
    );

    expect(findings).toEqual([
      {
        id: "risk:protected_path",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path changes are blocked by repository policy.",
        paths: [".github/workflows/ci.yml", ".github/workflows/release.yml"],
      },
    ]);
  });

  it("returns an empty array when no protected paths changed", () => {
    expect(
      detectProtectedPathBlocks(validPolicy({ protectedPaths: ["SECURITY_MODEL.md"] }), [
        "src/app.ts",
        "docs/notes.md",
      ]),
    ).toEqual([]);
  });

  it("ignores sensitive and warning paths for this focused detector", () => {
    const findings = detectProtectedPathBlocks(validPolicy({ protectedPaths: ["SECURITY.md"] }), [
      "secrets/runtime.json",
      "pnpm-lock.yaml",
      "migrations/001-init.sql",
      "src/auth/login.ts",
      "src/billing/checkout.ts",
    ]);

    expect(findings).toEqual([]);
  });

  it("parses every returned finding through the shared RiskFinding schema", () => {
    const findings = detectProtectedPathBlocks(
      validPolicy({
        protectedPaths: ["SECURITY_MODEL.md", ".github/workflows/**"],
      }),
      ["SECURITY_MODEL.md", ".github/workflows/ci.yml"],
    );

    expect(findings).toHaveLength(1);
    for (const finding of findings) {
      expect(RiskFindingSchema.parse(finding)).toEqual(finding);
    }
  });

  it("does not serialize policy patterns, diffs, patches, source keys, command output, or secret values", () => {
    const findings = detectProtectedPathBlocks(
      validPolicy({
        protectedPaths: ["src/private/**"],
        sensitivePaths: ["secrets/**", "SECRET_TOKEN=do-not-print"],
        warningPaths: {
          packageLocks: ["pnpm-lock.yaml"],
          migrations: ["patch contains private implementation"],
          infrastructure: ["diff --git a/private.ts b/private.ts"],
          auth: ["source"],
          billing: ["command output line"],
        },
      }),
      [
        "src/private/settings.ts",
        "secrets/runtime.json",
        "pnpm-lock.yaml",
        "migrations/001-init.sql",
        "src/auth/source.ts",
      ],
    );

    expect(findings).toEqual([
      {
        id: "risk:protected_path",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path changes are blocked by repository policy.",
        paths: ["src/private/settings.ts"],
      },
    ]);
    expectSafeSerializedValue(findings);
  });

  it("fails closed with a generic protected-path block when protected glob syntax is unsupported", () => {
    const unsupportedPattern = "apps/{web,runner}/**";
    const findings = detectProtectedPathBlocks(
      validPolicy({
        protectedPaths: [unsupportedPattern],
      }),
      ["apps/web/src/app.ts"],
    );

    expect(findings).toEqual([
      {
        id: "risk:protected_path:evaluation_failed",
        severity: "blocked",
        category: "protected_path",
        message: "Protected path policy could not be evaluated.",
        paths: [],
      },
    ]);
    expect(RiskFindingSchema.parse(findings[0])).toEqual(findings[0]);
    expect(JSON.stringify(findings)).not.toContain(unsupportedPattern);
    expectSafeSerializedValue(findings);
  });

  it("exports the detector from the runner entrypoint", () => {
    const finding: ProtectedPathBlockFindingFromEntrypoint = {
      id: "risk:protected_path",
      severity: "blocked",
      category: "protected_path",
      message: "Protected path changes are blocked by repository policy.",
      paths: ["SECURITY_MODEL.md"],
    } satisfies RiskFinding;

    expect(finding.paths).toEqual(["SECURITY_MODEL.md"]);
    expect(detectProtectedPathBlocksFromEntrypoint).toBe(detectProtectedPathBlocks);
  });
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
