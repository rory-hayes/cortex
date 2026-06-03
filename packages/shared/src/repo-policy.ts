import { z } from "zod";

import { ValidationCommandSchema } from "./validation-command.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const PathPatternListSchema = z.array(NonEmptyStringSchema);
const RequiredPathPatternListSchema = PathPatternListSchema.min(1);
const OptionalPathPatternListSchema = PathPatternListSchema.default([]);

export const REPO_POLICY_WARNING_PATH_CATEGORIES = [
  "packageLocks",
  "migrations",
  "infrastructure",
  "auth",
  "billing",
] as const;

export const RepoPolicyWarningPathCategorySchema = z.enum(REPO_POLICY_WARNING_PATH_CATEGORIES);
export type RepoPolicyWarningPathCategory = z.infer<typeof RepoPolicyWarningPathCategorySchema>;

export const RepoPolicyWarningPathsSchema = z
  .object({
    packageLocks: PathPatternListSchema,
    migrations: PathPatternListSchema,
    infrastructure: PathPatternListSchema,
    auth: PathPatternListSchema,
    billing: PathPatternListSchema,
  })
  .strict();

export type RepoPolicyWarningPaths = z.infer<typeof RepoPolicyWarningPathsSchema>;

export const DRY_RUN_CHECKS = [
  "repo_path_exists",
  "git_repository",
  "repo_clean",
  "current_branch_not_protected",
  "repo_policy_exists_and_parses",
  "validation_commands_configured",
  "required_tools_available",
  "branch_name_available",
  "worktree_path_available",
  "protected_and_sensitive_paths_configured",
  "runner_capabilities_satisfied",
] as const;

export const DryRunCheckSchema = z.enum(DRY_RUN_CHECKS);
export type DryRunCheck = z.infer<typeof DryRunCheckSchema>;

export const RepoPolicySchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    protectedBranches: RequiredPathPatternListSchema,
    protectedPaths: OptionalPathPatternListSchema,
    sensitivePaths: OptionalPathPatternListSchema,
    warningPaths: RepoPolicyWarningPathsSchema,
    validationCommands: z.array(ValidationCommandSchema).min(1),
    maxChangedFiles: z.number().int().positive(),
    maxDiffLines: z.number().int().positive().optional(),
    allowUntrackedFiles: z.boolean(),
    dryRunChecks: z.array(DryRunCheckSchema).min(1),
  })
  .strict();

export type RepoPolicy = z.infer<typeof RepoPolicySchema>;
