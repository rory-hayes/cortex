import { evaluatePathAgainstPolicy } from "@control-plane/policies";
import {
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type DryRunCheckResult,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";

const READINESS_PATTERN_PROBE_PATH = "src/path-policy-readiness-probe.ts";
const ENV_FILE_PROBE_PATH = ".env";
const ENV_LOCAL_FILE_PROBE_PATH = "apps/web/.env.local";
const ENV_EXAMPLE_PROBE_PATH = ".env.example";

type ExplicitPatternVerification =
  | {
      ok: true;
    }
  | {
      ok: false;
      category: "protected_path" | "sensitive_path";
    };

type ImplicitEnvProtectionEvaluation = {
  implicitEnvProtectionActive: boolean;
  envFileBlocked: boolean;
  envLocalFileBlocked: boolean;
  envExampleAllowed: boolean;
};

export type PathPolicyReadinessMetadata = {
  protectedPathPatternCount: number;
  sensitivePathPatternCount: number;
  protectedPathsConfigured: boolean;
  sensitivePathsConfigured: boolean;
  implicitEnvProtectionActive: boolean;
  envFileBlocked: boolean;
  envLocalFileBlocked: boolean;
  envExampleAllowed: boolean;
  policyPatternEvaluationVerified: boolean;
};

export type CheckPathPolicyReadinessResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export const checkPathPolicyReadiness = (policy: RepoPolicy): CheckPathPolicyReadinessResult => {
  const protectedPaths = getPathPatterns(policy.protectedPaths);
  const sensitivePaths = getPathPatterns(policy.sensitivePaths);
  const implicitEnvProtection = evaluateImplicitEnvProtection(policy);
  const patternVerification = verifyExplicitPathPatterns(policy, protectedPaths, sensitivePaths);
  const metadata = buildMetadata({
    protectedPaths,
    sensitivePaths,
    implicitEnvProtection,
    policyPatternEvaluationVerified: patternVerification.ok,
  });

  if (!patternVerification.ok) {
    const category = patternVerification.category;
    const message = "Path policy patterns could not be verified.";

    return {
      check: buildCheck({
        status: "failed",
        message,
        metadata,
      }),
      blockers: [buildPathPolicyBlocker(category, message)],
      warnings: [],
    };
  }

  if (!metadata.implicitEnvProtectionActive) {
    const message = "Implicit env path protection is not active.";

    return {
      check: buildCheck({
        status: "failed",
        message,
        metadata,
      }),
      blockers: [buildPathPolicyBlocker("sensitive_path", message)],
      warnings: [],
    };
  }

  if (!metadata.protectedPathsConfigured) {
    const warnings = metadata.sensitivePathsConfigured ? [] : [buildSensitivePathWarning()];

    return {
      check: buildCheck({
        status: "failed",
        message: "Protected path patterns are not configured.",
        metadata,
      }),
      blockers: [buildProtectedPathBlocker()],
      warnings,
    };
  }

  if (!metadata.sensitivePathsConfigured) {
    return {
      check: buildCheck({
        status: "warning",
        message: "Explicit sensitive path patterns are not configured.",
        metadata,
      }),
      blockers: [],
      warnings: [buildSensitivePathWarning()],
    };
  }

  return {
    check: buildCheck({
      status: "passed",
      message: "Protected and sensitive path policy is configured.",
      metadata,
    }),
    blockers: [],
    warnings: [],
  };
};

const buildMetadata = (input: {
  protectedPaths: readonly string[];
  sensitivePaths: readonly string[];
  implicitEnvProtection: ImplicitEnvProtectionEvaluation;
  policyPatternEvaluationVerified: boolean;
}): PathPolicyReadinessMetadata => ({
  protectedPathPatternCount: input.protectedPaths.length,
  sensitivePathPatternCount: input.sensitivePaths.length,
  protectedPathsConfigured: input.protectedPaths.length > 0,
  sensitivePathsConfigured: input.sensitivePaths.length > 0,
  implicitEnvProtectionActive: input.implicitEnvProtection.implicitEnvProtectionActive,
  envFileBlocked: input.implicitEnvProtection.envFileBlocked,
  envLocalFileBlocked: input.implicitEnvProtection.envLocalFileBlocked,
  envExampleAllowed: input.implicitEnvProtection.envExampleAllowed,
  policyPatternEvaluationVerified: input.policyPatternEvaluationVerified,
});

const verifyExplicitPathPatterns = (
  policy: RepoPolicy,
  protectedPaths: readonly string[],
  sensitivePaths: readonly string[],
): ExplicitPatternVerification => {
  try {
    evaluatePathAgainstPolicy(
      buildPolicyForPathEvaluation(policy, {
        protectedPaths,
        sensitivePaths: [],
      }),
      READINESS_PATTERN_PROBE_PATH,
    );
  } catch {
    return {
      ok: false,
      category: "protected_path",
    };
  }

  try {
    evaluatePathAgainstPolicy(
      buildPolicyForPathEvaluation(policy, {
        protectedPaths: [],
        sensitivePaths,
      }),
      READINESS_PATTERN_PROBE_PATH,
    );
  } catch {
    return {
      ok: false,
      category: "sensitive_path",
    };
  }

  return {
    ok: true,
  };
};

const evaluateImplicitEnvProtection = (policy: RepoPolicy): ImplicitEnvProtectionEvaluation => {
  const implicitPolicy = buildPolicyForPathEvaluation(policy, {
    protectedPaths: [],
    sensitivePaths: [],
  });

  try {
    const envFile = evaluatePathAgainstPolicy(implicitPolicy, ENV_FILE_PROBE_PATH);
    const envLocalFile = evaluatePathAgainstPolicy(implicitPolicy, ENV_LOCAL_FILE_PROBE_PATH);
    const envExample = evaluatePathAgainstPolicy(implicitPolicy, ENV_EXAMPLE_PROBE_PATH);
    const envFileBlocked = envFile.status === "blocked" && envFile.sensitivePatterns.length > 0;
    const envLocalFileBlocked =
      envLocalFile.status === "blocked" && envLocalFile.sensitivePatterns.length > 0;
    const envExampleAllowed = envExample.status === "safe";

    return {
      implicitEnvProtectionActive: envFileBlocked && envLocalFileBlocked && envExampleAllowed,
      envFileBlocked,
      envLocalFileBlocked,
      envExampleAllowed,
    };
  } catch {
    return {
      implicitEnvProtectionActive: false,
      envFileBlocked: false,
      envLocalFileBlocked: false,
      envExampleAllowed: false,
    };
  }
};

const buildPolicyForPathEvaluation = (
  policy: RepoPolicy,
  input: {
    protectedPaths: readonly string[];
    sensitivePaths: readonly string[];
  },
): RepoPolicy => ({
  ...policy,
  protectedPaths: [...input.protectedPaths],
  sensitivePaths: [...input.sensitivePaths],
  warningPaths: {
    packageLocks: [],
    migrations: [],
    infrastructure: [],
    auth: [],
    billing: [],
  },
});

const getPathPatterns = (patterns: unknown): readonly string[] =>
  Array.isArray(patterns) ? (patterns as string[]) : [];

const buildCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: PathPolicyReadinessMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "protected_and_sensitive_paths_configured",
    label: "Protected and sensitive paths configured",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildPathPolicyBlocker = (
  category: "protected_path" | "sensitive_path",
  message: string,
): RiskFinding =>
  RiskFindingSchema.parse({
    id:
      category === "protected_path"
        ? "risk:protected_path:readiness"
        : "risk:sensitive_path:readiness",
    severity: "blocked",
    category,
    message,
    paths: [],
  });

const buildProtectedPathBlocker = (): RiskFinding =>
  buildPathPolicyBlocker("protected_path", "Protected path patterns are not configured.");

const buildSensitivePathWarning = (): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:sensitive_path:explicit_patterns",
    severity: "warning",
    category: "sensitive_path",
    message: "Explicit sensitive path patterns are not configured.",
    paths: [],
  });
