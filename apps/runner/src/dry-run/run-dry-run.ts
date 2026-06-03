import { parseRepoPolicy } from "@control-plane/policies";
import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  DryRunCheckResultSchema,
  DryRunResultSchema,
  RiskFindingSchema,
  RunnerCapabilitiesSchema,
  type DryRunCheck,
  type DryRunCheckResult,
  type DryRunResult,
  type RepoPolicy,
  type RiskFinding,
  type RunnerCapabilities,
  type TaskPacket,
} from "@control-plane/shared";

import { detectRunnerCapabilities } from "../capabilities.js";
import { RepoPathValidationError, validateRepoPath } from "../repo-path.js";
import { checkProtectedBranch } from "./check-branch.js";
import { checkCleanRepo } from "./check-clean-repo.js";
import { checkPathPolicyReadiness } from "./check-path-policy.js";
import { checkRequiredTools } from "./check-tools.js";
import { checkValidationConfig } from "./check-validation-config.js";
import { checkWorktreeReadiness } from "./check-worktree-readiness.js";

type MaybePromise<T> = T | Promise<T>;

export type RunDryRunOptions = {
  repoPath: string;
  taskPacket: TaskPacket;
};

export type RunDryRunCheckResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export type RunDryRunWorktreeCheckResult = {
  checks: DryRunCheckResult[];
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export type RunDryRunDependencies = {
  now?: () => string;
  validateRepoPath?: (repoPath: string) => Promise<{ repoPath: string }>;
  parseRepoPolicy?: (repoPath: string) => Promise<RepoPolicy>;
  detectRunnerCapabilities?: (options: { cwd: string }) => Promise<RunnerCapabilities>;
  checkCleanRepo?: (repoPath: string) => Promise<RunDryRunCheckResult>;
  checkProtectedBranch?: (repoPath: string, policy: RepoPolicy) => Promise<RunDryRunCheckResult>;
  checkValidationConfig?: (policy: RepoPolicy) => MaybePromise<RunDryRunCheckResult>;
  checkRequiredTools?: (
    capabilities: RunnerCapabilities,
    task: Pick<TaskPacket, "mode" | "validation">,
  ) => MaybePromise<RunDryRunCheckResult>;
  checkWorktreeReadiness?: (
    repoPath: string,
    taskRepo: TaskPacket["repo"],
  ) => Promise<RunDryRunWorktreeCheckResult>;
  checkPathPolicyReadiness?: (policy: RepoPolicy) => MaybePromise<RunDryRunCheckResult>;
};

type RepoValidationState =
  | {
      ok: true;
      repoPath: string;
      checks: DryRunCheckResult[];
      blockers: RiskFinding[];
    }
  | {
      ok: false;
      repoPathExists: boolean;
      checks: DryRunCheckResult[];
      blockers: RiskFinding[];
      skipReason: string;
    };

type PolicyState =
  | {
      ok: true;
      policy: RepoPolicy;
      check: DryRunCheckResult;
      blockers: RiskFinding[];
    }
  | {
      ok: false;
      check: DryRunCheckResult;
      blockers: RiskFinding[];
      skipReason: string;
    };

type CapabilityState = {
  capabilities: RunnerCapabilities;
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
  cwd: string;
};

export const runDryRun = async (
  options: RunDryRunOptions,
  dependencies: RunDryRunDependencies = {},
): Promise<DryRunResult> => {
  const now = dependencies.now ?? currentIsoTimestamp;
  const createdAt = now();
  const checks = new Map<DryRunCheck, DryRunCheckResult>();
  const blockers: RiskFinding[] = [];
  const warnings: RiskFinding[] = [];

  const repoState = await validateRepository(options.repoPath, dependencies);
  addChecks(checks, repoState.checks);
  blockers.push(...repoState.blockers);

  const capabilityState = await detectCapabilities({
    cwd: repoState.ok || repoState.repoPathExists ? options.repoPath : process.cwd(),
    now,
    detectRunnerCapabilities: dependencies.detectRunnerCapabilities ?? detectRunnerCapabilities,
  });
  checks.set("runner_capabilities_satisfied", capabilityState.check);
  blockers.push(...capabilityState.blockers);
  warnings.push(...capabilityState.warnings);

  const toolsResult = await (dependencies.checkRequiredTools ?? checkRequiredTools)(
    capabilityState.capabilities,
    {
      mode: options.taskPacket.mode,
      validation: options.taskPacket.validation,
    },
  );
  checks.set("required_tools_available", toolsResult.check);
  blockers.push(...toolsResult.blockers);
  warnings.push(...toolsResult.warnings);

  if (!repoState.ok) {
    addSkippedRepoChecks(checks, repoState.skipReason);
    return parseDryRunResult({
      options,
      checks,
      capabilities: capabilityState.capabilities,
      blockers,
      warnings,
      createdAt,
    });
  }

  const cleanRepoResult = await (dependencies.checkCleanRepo ?? checkCleanRepo)(repoState.repoPath);
  checks.set("repo_clean", cleanRepoResult.check);
  blockers.push(...cleanRepoResult.blockers);
  warnings.push(...cleanRepoResult.warnings);

  const policyState = await parsePolicy(repoState.repoPath, dependencies);
  checks.set("repo_policy_exists_and_parses", policyState.check);
  blockers.push(...policyState.blockers);

  const worktreeResult = await (dependencies.checkWorktreeReadiness ?? checkWorktreeReadiness)(
    repoState.repoPath,
    options.taskPacket.repo,
  );
  addChecks(checks, worktreeResult.checks);
  blockers.push(...worktreeResult.blockers);
  warnings.push(...worktreeResult.warnings);

  if (!policyState.ok) {
    addSkippedPolicyChecks(checks, policyState.skipReason);
    return parseDryRunResult({
      options,
      checks,
      capabilities: capabilityState.capabilities,
      blockers,
      warnings,
      createdAt,
    });
  }

  const protectedBranchResult = await (dependencies.checkProtectedBranch ?? checkProtectedBranch)(
    repoState.repoPath,
    policyState.policy,
  );
  checks.set("current_branch_not_protected", protectedBranchResult.check);
  blockers.push(...protectedBranchResult.blockers);
  warnings.push(...protectedBranchResult.warnings);

  const validationConfigResult = await (
    dependencies.checkValidationConfig ?? checkValidationConfig
  )(policyState.policy);
  checks.set("validation_commands_configured", validationConfigResult.check);
  blockers.push(...validationConfigResult.blockers);
  warnings.push(...validationConfigResult.warnings);

  const pathPolicyResult = await (
    dependencies.checkPathPolicyReadiness ?? checkPathPolicyReadiness
  )(policyState.policy);
  checks.set("protected_and_sensitive_paths_configured", pathPolicyResult.check);
  blockers.push(...pathPolicyResult.blockers);
  warnings.push(...pathPolicyResult.warnings);

  return parseDryRunResult({
    options,
    checks,
    capabilities: capabilityState.capabilities,
    blockers,
    warnings,
    createdAt,
  });
};

const validateRepository = async (
  repoPath: string,
  dependencies: RunDryRunDependencies,
): Promise<RepoValidationState> => {
  try {
    const validated = await (dependencies.validateRepoPath ?? validateRepoPath)(repoPath);

    return {
      ok: true,
      repoPath: validated.repoPath,
      checks: [
        buildCheck({
          id: "repo_path_exists",
          label: "Repo path exists",
          status: "passed",
          message: "Repository path exists and is a readable directory.",
          metadata: {
            repoPathValidationCode: "passed",
          },
        }),
        buildCheck({
          id: "git_repository",
          label: "Git repository",
          status: "passed",
          message: "Repository path is a Git working tree.",
          metadata: {
            gitRepositoryVerified: true,
          },
        }),
      ],
      blockers: [],
    };
  } catch (error) {
    if (error instanceof RepoPathValidationError && error.code === "not_git_repository") {
      return {
        ok: false,
        repoPathExists: true,
        skipReason: "git_repository_failed",
        checks: [
          buildCheck({
            id: "repo_path_exists",
            label: "Repo path exists",
            status: "passed",
            message: "Repository path exists and is a readable directory.",
            metadata: {
              repoPathValidationCode: error.code,
            },
          }),
          buildCheck({
            id: "git_repository",
            label: "Git repository",
            status: "failed",
            message: "Repository path is not a Git working tree.",
            metadata: {
              repoPathValidationCode: error.code,
              gitRepositoryVerified: false,
            },
          }),
        ],
        blockers: [
          buildRiskFinding({
            id: "risk:missing_mapping:git_repository",
            severity: "blocked",
            category: "missing_mapping",
            message: "Repository path is not a Git working tree.",
          }),
        ],
      };
    }

    const validationCode =
      error instanceof RepoPathValidationError ? error.code : "repo_path_unverified";

    return {
      ok: false,
      repoPathExists: false,
      skipReason: "repo_path_failed",
      checks: [
        buildCheck({
          id: "repo_path_exists",
          label: "Repo path exists",
          status: "failed",
          message: "Repository path does not exist or is not a readable directory.",
          metadata: {
            repoPathValidationCode: validationCode,
          },
        }),
      ],
      blockers: [
        buildRiskFinding({
          id: "risk:missing_mapping:repo_path",
          severity: "blocked",
          category: "missing_mapping",
          message: "Repository path does not exist or is not a readable directory.",
        }),
      ],
    };
  }
};

const parsePolicy = async (
  repoPath: string,
  dependencies: RunDryRunDependencies,
): Promise<PolicyState> => {
  try {
    const policy = await (dependencies.parseRepoPolicy ?? parseRepoPolicy)(repoPath);

    return {
      ok: true,
      policy,
      check: buildCheck({
        id: "repo_policy_exists_and_parses",
        label: "Repo policy exists and parses",
        status: "passed",
        message: "Repo policy file exists and parses.",
        metadata: {
          policyParsed: true,
          validationCommandCount: policy.validationCommands.length,
          configuredDryRunCheckCount: policy.dryRunChecks.length,
        },
      }),
      blockers: [],
    };
  } catch {
    return {
      ok: false,
      skipReason: "repo_policy_failed",
      check: buildCheck({
        id: "repo_policy_exists_and_parses",
        label: "Repo policy exists and parses",
        status: "failed",
        message: "Repo policy file is missing or invalid.",
        metadata: {
          policyParsed: false,
        },
      }),
      blockers: [
        buildRiskFinding({
          id: "risk:missing_validation:repo_policy",
          severity: "blocked",
          category: "missing_validation",
          message: "Repo policy file is missing or invalid.",
        }),
      ],
    };
  }
};

const detectCapabilities = async (input: {
  cwd: string;
  now: () => string;
  detectRunnerCapabilities: (options: { cwd: string }) => Promise<RunnerCapabilities>;
}): Promise<CapabilityState> => {
  try {
    const capabilities = await input.detectRunnerCapabilities({ cwd: input.cwd });

    if (!capabilities.supportsDryRun) {
      const message = "Runner does not report dry-run support.";

      return {
        capabilities,
        cwd: input.cwd,
        check: buildRunnerCapabilitiesCheck({
          status: "failed",
          message,
          capabilities,
        }),
        blockers: [buildMissingCapabilityFinding("dry_run_support", "blocked", message)],
        warnings: [],
      };
    }

    return {
      capabilities,
      cwd: input.cwd,
      check: buildRunnerCapabilitiesCheck({
        status: "passed",
        message: "Runner capabilities satisfy dry-run requirements.",
        capabilities,
      }),
      blockers: [],
      warnings: [],
    };
  } catch {
    const capabilities = fallbackCapabilities(input.now());
    const message = "Runner capabilities could not be detected.";

    return {
      capabilities,
      cwd: input.cwd,
      check: buildRunnerCapabilitiesCheck({
        status: "failed",
        message,
        capabilities,
      }),
      blockers: [buildMissingCapabilityFinding("detection_failed", "blocked", message)],
      warnings: [],
    };
  }
};

const buildRunnerCapabilitiesCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  capabilities: RunnerCapabilities;
}): DryRunCheckResult =>
  buildCheck({
    id: "runner_capabilities_satisfied",
    label: "Runner capabilities satisfied",
    status: input.status,
    message: input.message,
    metadata: {
      supportsDryRun: input.capabilities.supportsDryRun,
      supportsCancellation: input.capabilities.supportsCancellation,
      maxConcurrentJobs: input.capabilities.maxConcurrentJobs,
      availableTools: Object.entries(input.capabilities.tools)
        .filter(([, capability]) => capability?.available === true)
        .map(([tool]) => tool)
        .sort(),
      unavailableTools: Object.entries(input.capabilities.tools)
        .filter(([, capability]) => capability?.available !== true)
        .map(([tool]) => tool)
        .sort(),
    },
  });

const addSkippedRepoChecks = (checks: Map<DryRunCheck, DryRunCheckResult>, reason: string) => {
  for (const checkId of [
    "git_repository",
    "repo_clean",
    "current_branch_not_protected",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
    "branch_name_available",
    "worktree_path_available",
    "protected_and_sensitive_paths_configured",
  ] satisfies DryRunCheck[]) {
    if (!checks.has(checkId)) {
      checks.set(checkId, skippedCheck(checkId, reason));
    }
  }
};

const addSkippedPolicyChecks = (checks: Map<DryRunCheck, DryRunCheckResult>, reason: string) => {
  for (const checkId of [
    "current_branch_not_protected",
    "validation_commands_configured",
    "protected_and_sensitive_paths_configured",
  ] satisfies DryRunCheck[]) {
    if (!checks.has(checkId)) {
      checks.set(checkId, skippedCheck(checkId, reason));
    }
  }
};

const parseDryRunResult = (input: {
  options: RunDryRunOptions;
  checks: Map<DryRunCheck, DryRunCheckResult>;
  capabilities: RunnerCapabilities;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
  createdAt: string;
}): DryRunResult => {
  const orderedChecks = DRY_RUN_CHECKS.map((checkId) => {
    const check = input.checks.get(checkId) ?? skippedCheck(checkId, "not_run");

    return DryRunCheckResultSchema.parse(check);
  });

  return DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `dry-run:${input.options.taskPacket.runId}`,
    runId: input.options.taskPacket.runId,
    status: deriveStatus(input.blockers, input.warnings),
    checks: orderedChecks,
    capabilities: input.capabilities,
    blockers: input.blockers,
    warnings: input.warnings,
    createdAt: input.createdAt,
  });
};

const addChecks = (
  checks: Map<DryRunCheck, DryRunCheckResult>,
  checkResults: readonly DryRunCheckResult[],
) => {
  for (const check of checkResults) {
    checks.set(check.id, check);
  }
};

const deriveStatus = (
  blockers: readonly RiskFinding[],
  warnings: readonly RiskFinding[],
): DryRunResult["status"] => {
  if (blockers.length > 0) {
    return "failed";
  }

  if (warnings.length > 0) {
    return "warning";
  }

  return "passed";
};

const skippedCheck = (id: DryRunCheck, reason: string): DryRunCheckResult =>
  buildCheck({
    id,
    label: labelForCheck(id),
    status: "skipped",
    message: `${labelForCheck(id)} skipped because a prerequisite failed.`,
    metadata: {
      skipped: true,
      prerequisite: reason,
    },
  });

const buildCheck = (input: {
  id: DryRunCheck;
  label: string;
  status: DryRunCheckResult["status"];
  message: string;
  metadata: Record<string, unknown>;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: input.id,
    label: input.label,
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildRiskFinding = (input: {
  id: string;
  severity: RiskFinding["severity"];
  category: RiskFinding["category"];
  message: string;
}): RiskFinding =>
  RiskFindingSchema.parse({
    id: input.id,
    severity: input.severity,
    category: input.category,
    message: input.message,
    paths: [],
  });

const buildMissingCapabilityFinding = (
  suffix: string,
  severity: RiskFinding["severity"],
  message: string,
): RiskFinding =>
  buildRiskFinding({
    id: `risk:missing_capability:${suffix}`,
    severity,
    category: "missing_capability",
    message,
  });

const fallbackCapabilities = (reportedAt: string): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    os: {
      platform: "unknown",
      release: "unknown",
      arch: "unknown",
    },
    shell: "unknown",
    tools: {
      git: { available: false },
      gh: { available: false },
      codex: { available: false },
      node: { available: false },
      npm: { available: false },
      pnpm: { available: false },
      yarn: { available: false },
      python: { available: false },
    },
    maxConcurrentJobs: 1,
    supportsDryRun: false,
    supportsCancellation: false,
    reportedAt,
  });

const labelForCheck = (id: DryRunCheck): string =>
  id
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const currentIsoTimestamp = (): string => new Date().toISOString();
