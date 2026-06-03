import {
  CONTRACT_VERSION,
  DryRunCheckResultSchema,
  RepoPolicySchema,
  RiskFindingSchema,
  TaskPacketSchema,
  type RepoPolicy,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import {
  checkPathPolicyReadiness,
  type CheckPathPolicyReadinessResult,
  type PathPolicyReadinessMetadata,
} from "./check-path-policy.js";
import {
  checkPathPolicyReadiness as checkPathPolicyReadinessFromEntrypoint,
  type CheckPathPolicyReadinessResult as CheckPathPolicyReadinessResultFromEntrypoint,
  type PathPolicyReadinessMetadata as PathPolicyReadinessMetadataFromEntrypoint,
} from "../index.js";

const UNSAFE_POLICY_TEXT = [
  "src/private/**",
  "secrets/**",
  "apps/{web,runner}/**",
  "diff --git a/private.ts b/private.ts",
  "patch contains private source",
  "function leakedSource() { return token; }",
  "OPENAI_API_KEY=sk-policy-secret",
  "pnpm test -- --reporter=verbose",
] as const;

describe("path policy readiness dry-run check", () => {
  it("passes when protected and sensitive path patterns are configured", () => {
    const result = checkPathPolicyReadiness(validPolicy());

    expect(result).toEqual({
      check: {
        id: "protected_and_sensitive_paths_configured",
        label: "Protected and sensitive paths configured",
        status: "passed",
        message: "Protected and sensitive path policy is configured.",
        metadata: {
          protectedPathPatternCount: 1,
          sensitivePathPatternCount: 2,
          protectedPathsConfigured: true,
          sensitivePathsConfigured: true,
          implicitEnvProtectionActive: true,
          envFileBlocked: true,
          envLocalFileBlocked: true,
          envExampleAllowed: true,
          policyPatternEvaluationVerified: true,
        },
      },
      blockers: [],
      warnings: [],
    });
    expect(DryRunCheckResultSchema.safeParse(result.check).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it("warns instead of blocking when sensitive path patterns are empty", () => {
    const result = checkPathPolicyReadiness(validPolicy({ sensitivePaths: [] }));

    expect(result.check).toEqual({
      id: "protected_and_sensitive_paths_configured",
      label: "Protected and sensitive paths configured",
      status: "warning",
      message: "Explicit sensitive path patterns are not configured.",
      metadata: {
        protectedPathPatternCount: 1,
        sensitivePathPatternCount: 0,
        protectedPathsConfigured: true,
        sensitivePathsConfigured: false,
        implicitEnvProtectionActive: true,
        envFileBlocked: true,
        envLocalFileBlocked: true,
        envExampleAllowed: true,
        policyPatternEvaluationVerified: true,
      },
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([sensitivePathWarning()]);
    expect(RiskFindingSchema.safeParse(result.warnings[0]).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it("warns for policies parsed without a sensitive path field", () => {
    const policyInput = validPolicyInput();
    delete policyInput.sensitivePaths;

    const parsedPolicy = RepoPolicySchema.parse(policyInput);
    const result = checkPathPolicyReadiness(parsedPolicy);

    expect(parsedPolicy.sensitivePaths).toEqual([]);
    expect(result.check.status).toBe("warning");
    expect(result.check.metadata).toMatchObject({
      protectedPathsConfigured: true,
      sensitivePathPatternCount: 0,
      sensitivePathsConfigured: false,
      implicitEnvProtectionActive: true,
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([sensitivePathWarning()]);
    expectSafeSerializedResult(result);
  });

  it("blocks when protected path patterns are empty", () => {
    const result = checkPathPolicyReadiness(validPolicy({ protectedPaths: [] }));

    expect(result.check).toEqual({
      id: "protected_and_sensitive_paths_configured",
      label: "Protected and sensitive paths configured",
      status: "failed",
      message: "Protected path patterns are not configured.",
      metadata: {
        protectedPathPatternCount: 0,
        sensitivePathPatternCount: 2,
        protectedPathsConfigured: false,
        sensitivePathsConfigured: true,
        implicitEnvProtectionActive: true,
        envFileBlocked: true,
        envLocalFileBlocked: true,
        envExampleAllowed: true,
        policyPatternEvaluationVerified: true,
      },
    });
    expect(result.blockers).toEqual([protectedPathBlocker()]);
    expect(result.warnings).toEqual([]);
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it("blocks for task packets parsed without a protected path field", () => {
    const packetInput = validTaskPacketInput();
    delete packetInput.policy.protectedPaths;

    const parsedPacket = TaskPacketSchema.parse(packetInput);
    const result = checkPathPolicyReadiness(parsedPacket.policy);

    expect(parsedPacket.policy.protectedPaths).toEqual([]);
    expect(result.check.status).toBe("failed");
    expect(result.check.metadata).toMatchObject({
      protectedPathPatternCount: 0,
      protectedPathsConfigured: false,
      sensitivePathsConfigured: true,
      implicitEnvProtectionActive: true,
    });
    expect(result.blockers).toEqual([protectedPathBlocker()]);
    expect(result.warnings).toEqual([]);
    expectSafeSerializedResult(result);
  });

  it("verifies implicit env protection without relying on explicit sensitive paths", () => {
    const result = checkPathPolicyReadiness(validPolicy({ sensitivePaths: [] }));

    expect(result.check.metadata).toMatchObject({
      sensitivePathPatternCount: 0,
      implicitEnvProtectionActive: true,
      envFileBlocked: true,
      envLocalFileBlocked: true,
      envExampleAllowed: true,
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([sensitivePathWarning()]);
    expectSafeSerializedResult(result);
  });

  it("fails closed when path policy glob syntax cannot be evaluated", () => {
    const unsupportedPattern = "apps/{web,runner}/**";
    const result = checkPathPolicyReadiness(
      validPolicy({
        protectedPaths: [unsupportedPattern],
      }),
    );

    expect(result.check).toEqual({
      id: "protected_and_sensitive_paths_configured",
      label: "Protected and sensitive paths configured",
      status: "failed",
      message: "Path policy patterns could not be verified.",
      metadata: {
        protectedPathPatternCount: 1,
        sensitivePathPatternCount: 2,
        protectedPathsConfigured: true,
        sensitivePathsConfigured: true,
        implicitEnvProtectionActive: true,
        envFileBlocked: true,
        envLocalFileBlocked: true,
        envExampleAllowed: true,
        policyPatternEvaluationVerified: false,
      },
    });
    expect(result.blockers).toEqual([
      protectedPathBlocker("Path policy patterns could not be verified."),
    ]);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(unsupportedPattern);
    expectSafeSerializedResult(result);
  });

  it("keeps serialized readiness output free of raw payloads and policy pattern values", () => {
    const result = checkPathPolicyReadiness(
      validPolicy({
        protectedPaths: [
          "src/private/**",
          "apps/{web,runner}/**",
          "diff --git a/private.ts b/private.ts",
        ],
        sensitivePaths: [
          "secrets/**",
          "OPENAI_API_KEY=sk-policy-secret",
          "function leakedSource() { return token; }",
        ],
        warningPaths: {
          packageLocks: ["pnpm-lock.yaml"],
          migrations: ["patch contains private source"],
          infrastructure: [],
          auth: [],
          billing: [],
        },
      }),
    );

    expect(result.check.status).toBe("failed");
    expectSafeSerializedResult(result);
  });

  it("exports the path policy readiness check and types from the runner entrypoint", () => {
    const result: CheckPathPolicyReadinessResultFromEntrypoint =
      checkPathPolicyReadinessFromEntrypoint(validPolicy());
    const localResult: CheckPathPolicyReadinessResult = result;
    const metadata: PathPolicyReadinessMetadataFromEntrypoint = result.check
      .metadata as PathPolicyReadinessMetadata;

    expect(localResult.check.id).toBe("protected_and_sensitive_paths_configured");
    expect(metadata.implicitEnvProtectionActive).toBe(true);
    expect(checkPathPolicyReadinessFromEntrypoint).toBe(checkPathPolicyReadiness);
  });
});

const protectedPathBlocker = (message = "Protected path patterns are not configured.") => ({
  id: "risk:protected_path:readiness",
  severity: "blocked",
  category: "protected_path",
  message,
  paths: [],
});

const sensitivePathWarning = () => ({
  id: "risk:sensitive_path:explicit_patterns",
  severity: "warning",
  category: "sensitive_path",
  message: "Explicit sensitive path patterns are not configured.",
  paths: [],
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy =>
  RepoPolicySchema.parse({
    ...validPolicyInput(),
    ...overrides,
  });

const validPolicyInput = (): Record<string, unknown> => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["src/security/**"],
  sensitivePaths: [".env", ".env.*"],
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
      command: "pnpm test -- --reporter=verbose",
      timeoutSeconds: 60,
      required: true,
    },
  ],
  maxChangedFiles: 50,
  allowUntrackedFiles: false,
  dryRunChecks: ["protected_and_sensitive_paths_configured"],
});

const validTaskPacketInput = () => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-path-policy-readiness",
  repositoryId: "repo-path-policy-readiness",
  runId: "run-path-policy-readiness",
  mode: "dryRun",
  objective: "Verify path policy readiness.",
  acceptanceCriteria: ["Dry-run path policy readiness produces safe metadata."],
  source: {
    type: "manual",
    title: "Path policy readiness",
  },
  repo: {
    localPath: "/repos/control-plane",
    defaultBranch: "main",
    targetBranch: "codex/TASK-046-path-policy-readiness",
  },
  context: {
    files: ["BACKLOG.md"],
    notes: ["Use metadata only."],
  },
  policy: validPolicyInput(),
  validation: {
    commands: [
      {
        id: "test",
        label: "Tests",
        command: "pnpm test -- --reporter=verbose",
        timeoutSeconds: 60,
        required: true,
      },
    ],
  },
  createdAt: "2026-05-20T15:43:00.000Z",
});

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);

  for (const unsafeText of UNSAFE_POLICY_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};
