import { lstat as fsLstat, realpath as fsRealpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type DryRunCheckResult,
  type RiskFinding,
  type TaskPacket,
} from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";
import { isSafeBranchName } from "../git/branch-name.js";

const GIT_OUTPUT_SUMMARY_LIMIT = 1;

type BranchVerificationStatus = "passed" | "invalid" | "exists" | "unverified" | "mapping_mismatch";

type WorktreeInspectionStatus =
  | "available"
  | "invalid"
  | "missing"
  | "occupied"
  | "uninspectable"
  | "mapping_mismatch";

type BranchReadinessMetadata = {
  repoMappingMatches: boolean;
  branchNameConfigured: boolean;
  branchNameSafe: boolean;
  branchFormatVerified: boolean;
  branchNameAvailable: boolean;
  localBranchExists: boolean;
  verificationStatus: BranchVerificationStatus;
  gitCheckRefExitCode?: number;
  gitShowRefExitCode?: number;
};

type WorktreeReadinessMetadata = {
  repoMappingMatches: boolean;
  worktreePathConfigured: boolean;
  worktreePathAvailable: boolean;
  inspectionStatus: WorktreeInspectionStatus;
};

type BranchCheckResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
};

type WorktreeCheckResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
};

export type CheckWorktreeReadinessTaskRepo = Pick<
  TaskPacket["repo"],
  "localPath" | "defaultBranch" | "targetBranch" | "worktreePath"
>;

export type CheckWorktreeReadinessCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type CheckWorktreeReadinessOptions = {
  commandRunner?: CheckWorktreeReadinessCommandRunner;
  lstat?: (path: string) => Promise<unknown>;
  realpath?: (path: string) => Promise<string>;
};

export type CheckWorktreeReadinessResult = {
  checks: DryRunCheckResult[];
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export const checkWorktreeReadiness = async (
  repoPath: string,
  taskRepo: CheckWorktreeReadinessTaskRepo,
  options: CheckWorktreeReadinessOptions = {},
): Promise<CheckWorktreeReadinessResult> => {
  const realpath = options.realpath ?? fsRealpath;
  const repoMappingMatches = await evaluateRepoMapping(repoPath, taskRepo.localPath, realpath);

  if (!repoMappingMatches) {
    const message = "Task packet repo mapping does not match the validated repository.";

    return {
      checks: [
        buildBranchMappingMismatchCheck(taskRepo),
        buildWorktreeMappingMismatchCheck(taskRepo),
      ],
      blockers: [buildMissingMappingFinding("repo_local_path", message)],
      warnings: [],
    };
  }

  const branchResult = await checkTargetBranch(repoPath, taskRepo.targetBranch, {
    commandRunner: options.commandRunner ?? runCommand,
  });
  const worktreeResult = await checkWorktreePath(taskRepo.worktreePath, {
    lstat: options.lstat ?? fsLstat,
  });

  return {
    checks: [branchResult.check, worktreeResult.check],
    blockers: [...branchResult.blockers, ...worktreeResult.blockers],
    warnings: [],
  };
};

const evaluateRepoMapping = async (
  repoPath: string,
  taskRepoPath: string,
  realpath: (path: string) => Promise<string>,
): Promise<boolean> => {
  try {
    const [resolvedRepoPath, resolvedTaskRepoPath] = await Promise.all([
      realpath(repoPath),
      realpath(taskRepoPath),
    ]);

    return resolvedRepoPath === resolvedTaskRepoPath;
  } catch {
    return false;
  }
};

const checkTargetBranch = async (
  repoPath: string,
  targetBranch: string,
  options: {
    commandRunner: CheckWorktreeReadinessCommandRunner;
  },
): Promise<BranchCheckResult> => {
  const branchNameConfigured = typeof targetBranch === "string" && targetBranch.trim().length > 0;

  if (!branchNameConfigured || !isSafeBranchName(targetBranch)) {
    const message = "Target branch name is invalid or unsafe.";

    return {
      check: buildBranchCheck({
        status: "failed",
        message,
        metadata: {
          repoMappingMatches: true,
          branchNameConfigured,
          branchNameSafe: false,
          branchFormatVerified: false,
          branchNameAvailable: false,
          localBranchExists: false,
          verificationStatus: "invalid",
        },
      }),
      blockers: [buildMissingMappingFinding("target_branch", message)],
    };
  }

  let formatResult: CommandExecutionResult;

  try {
    formatResult = await options.commandRunner({
      command: "git",
      args: ["check-ref-format", "--branch", targetBranch],
      cwd: repoPath,
      summaryLimit: GIT_OUTPUT_SUMMARY_LIMIT,
    });
  } catch {
    return failedUnableToVerifyBranch();
  }

  if (formatResult.redactionApplied) {
    return failedUnableToVerifyBranch(formatResult.exitCode);
  }

  if (formatResult.exitCode !== 0) {
    const message = "Target branch name is invalid or unsafe.";

    return {
      check: buildBranchCheck({
        status: "failed",
        message,
        metadata: {
          repoMappingMatches: true,
          branchNameConfigured: true,
          branchNameSafe: true,
          branchFormatVerified: false,
          branchNameAvailable: false,
          localBranchExists: false,
          verificationStatus: "invalid",
          gitCheckRefExitCode: formatResult.exitCode,
        },
      }),
      blockers: [buildMissingMappingFinding("target_branch", message)],
    };
  }

  let showRefResult: CommandExecutionResult;

  try {
    showRefResult = await options.commandRunner({
      command: "git",
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${targetBranch}`],
      cwd: repoPath,
      summaryLimit: GIT_OUTPUT_SUMMARY_LIMIT,
    });
  } catch {
    return failedUnableToVerifyBranch(formatResult.exitCode);
  }

  if (showRefResult.redactionApplied) {
    return failedUnableToVerifyBranch(formatResult.exitCode, showRefResult.exitCode);
  }

  if (showRefResult.exitCode === 0) {
    const message = "Target branch already exists locally.";

    return {
      check: buildBranchCheck({
        status: "failed",
        message,
        metadata: {
          repoMappingMatches: true,
          branchNameConfigured: true,
          branchNameSafe: true,
          branchFormatVerified: true,
          branchNameAvailable: false,
          localBranchExists: true,
          verificationStatus: "exists",
          gitCheckRefExitCode: formatResult.exitCode,
          gitShowRefExitCode: showRefResult.exitCode,
        },
      }),
      blockers: [buildDuplicateAssignmentFinding(message)],
    };
  }

  if (showRefResult.exitCode !== 1) {
    return failedUnableToVerifyBranch(formatResult.exitCode, showRefResult.exitCode);
  }

  return {
    check: buildBranchCheck({
      status: "passed",
      message: "Target branch name is valid and not already present locally.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: true,
        branchFormatVerified: true,
        branchNameAvailable: true,
        localBranchExists: false,
        verificationStatus: "passed",
        gitCheckRefExitCode: formatResult.exitCode,
        gitShowRefExitCode: showRefResult.exitCode,
      },
    }),
    blockers: [],
  };
};

const failedUnableToVerifyBranch = (
  gitCheckRefExitCode?: number,
  gitShowRefExitCode?: number,
): BranchCheckResult => {
  const message = "Unable to verify target branch readiness.";
  const metadata: BranchReadinessMetadata = {
    repoMappingMatches: true,
    branchNameConfigured: true,
    branchNameSafe: true,
    branchFormatVerified: false,
    branchNameAvailable: false,
    localBranchExists: false,
    verificationStatus: "unverified",
  };

  if (gitCheckRefExitCode !== undefined) {
    metadata.gitCheckRefExitCode = gitCheckRefExitCode;
  }

  if (gitShowRefExitCode !== undefined) {
    metadata.gitShowRefExitCode = gitShowRefExitCode;
  }

  return {
    check: buildBranchCheck({
      status: "failed",
      message,
      metadata,
    }),
    blockers: [buildMissingMappingFinding("target_branch_verification", message)],
  };
};

const checkWorktreePath = async (
  worktreePath: string | undefined,
  options: {
    lstat: (path: string) => Promise<unknown>;
  },
): Promise<WorktreeCheckResult> => {
  if (typeof worktreePath !== "string" || worktreePath.trim().length === 0) {
    const message = "Task packet is missing a worktree target path.";

    return {
      check: buildWorktreeCheck({
        status: "failed",
        message,
        metadata: {
          repoMappingMatches: true,
          worktreePathConfigured: false,
          worktreePathAvailable: false,
          inspectionStatus: "missing",
        },
      }),
      blockers: [buildMissingMappingFinding("worktree_path", message)],
    };
  }

  if (!isAbsolute(worktreePath)) {
    const message = "Task packet worktree path must be absolute.";

    return {
      check: buildWorktreeCheck({
        status: "failed",
        message,
        metadata: {
          repoMappingMatches: true,
          worktreePathConfigured: true,
          worktreePathAvailable: false,
          inspectionStatus: "invalid",
        },
      }),
      blockers: [buildMissingMappingFinding("worktree_path", message)],
    };
  }

  try {
    await options.lstat(worktreePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        check: buildWorktreeCheck({
          status: "passed",
          message: "Worktree target path is available.",
          metadata: {
            repoMappingMatches: true,
            worktreePathConfigured: true,
            worktreePathAvailable: true,
            inspectionStatus: "available",
          },
        }),
        blockers: [],
      };
    }

    const message = "Unable to inspect worktree target path.";

    return {
      check: buildWorktreeCheck({
        status: "failed",
        message,
        metadata: {
          repoMappingMatches: true,
          worktreePathConfigured: true,
          worktreePathAvailable: false,
          inspectionStatus: "uninspectable",
        },
      }),
      blockers: [buildStaleLockFinding("worktree_path_inspection", message)],
    };
  }

  const message = "Worktree target path is already occupied.";

  return {
    check: buildWorktreeCheck({
      status: "failed",
      message,
      metadata: {
        repoMappingMatches: true,
        worktreePathConfigured: true,
        worktreePathAvailable: false,
        inspectionStatus: "occupied",
      },
    }),
    blockers: [buildStaleLockFinding("worktree_path", message)],
  };
};

const buildBranchMappingMismatchCheck = (
  taskRepo: CheckWorktreeReadinessTaskRepo,
): DryRunCheckResult =>
  buildBranchCheck({
    status: "failed",
    message: "Task packet repo mapping does not match the validated repository.",
    metadata: {
      repoMappingMatches: false,
      branchNameConfigured:
        typeof taskRepo.targetBranch === "string" && taskRepo.targetBranch.trim().length > 0,
      branchNameSafe: false,
      branchFormatVerified: false,
      branchNameAvailable: false,
      localBranchExists: false,
      verificationStatus: "mapping_mismatch",
    },
  });

const buildWorktreeMappingMismatchCheck = (
  taskRepo: CheckWorktreeReadinessTaskRepo,
): DryRunCheckResult =>
  buildWorktreeCheck({
    status: "failed",
    message: "Task packet repo mapping does not match the validated repository.",
    metadata: {
      repoMappingMatches: false,
      worktreePathConfigured:
        typeof taskRepo.worktreePath === "string" && taskRepo.worktreePath.trim().length > 0,
      worktreePathAvailable: false,
      inspectionStatus: "mapping_mismatch",
    },
  });

const buildBranchCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: BranchReadinessMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "branch_name_available",
    label: "Branch name available",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildWorktreeCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: WorktreeReadinessMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "worktree_path_available",
    label: "Worktree path available",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildMissingMappingFinding = (suffix: string, message: string): RiskFinding =>
  RiskFindingSchema.parse({
    id: `risk:missing_mapping:${suffix}`,
    severity: "blocked",
    category: "missing_mapping",
    message,
    paths: [],
  });

const buildDuplicateAssignmentFinding = (message: string): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:duplicate_assignment:target_branch",
    severity: "blocked",
    category: "duplicate_assignment",
    message,
    paths: [],
  });

const buildStaleLockFinding = (suffix: string, message: string): RiskFinding =>
  RiskFindingSchema.parse({
    id: `risk:stale_lock:${suffix}`,
    severity: "blocked",
    category: "stale_lock",
    message,
    paths: [],
  });

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";
