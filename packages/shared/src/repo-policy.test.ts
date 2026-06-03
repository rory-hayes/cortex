import { describe, expect, it } from "vitest";
import type {
  DryRunCheck as SharedDryRunCheck,
  RepoPolicy as SharedRepoPolicy,
  RepoPolicyWarningPaths as SharedRepoPolicyWarningPaths,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const DOCUMENTED_DRY_RUN_CHECKS = [
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

const WARNING_PATH_CATEGORIES = [
  "packageLocks",
  "migrations",
  "infrastructure",
  "auth",
  "billing",
] as const;

type DryRunCheck = (typeof DOCUMENTED_DRY_RUN_CHECKS)[number];
type WarningPathCategory = (typeof WARNING_PATH_CATEGORIES)[number];

type ValidationCommand = {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  required: boolean;
};

type RepoPolicyWarningPaths = Record<WarningPathCategory, string[]>;

type RepoPolicy = {
  contractVersion: typeof CONTRACT_VERSION;
  protectedBranches: string[];
  protectedPaths: string[];
  sensitivePaths: string[];
  warningPaths: RepoPolicyWarningPaths;
  validationCommands: ValidationCommand[];
  maxChangedFiles: number;
  maxDiffLines?: number;
  allowUntrackedFiles: boolean;
  dryRunChecks: DryRunCheck[];
};

type RepoPolicyModule = {
  DRY_RUN_CHECKS: readonly DryRunCheck[];
  DryRunCheckSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  REPO_POLICY_WARNING_PATH_CATEGORIES: readonly WarningPathCategory[];
  RepoPolicyWarningPathsSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RepoPolicySchema: {
    parse: (value: unknown) => RepoPolicy;
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadRepoPolicyModule = async () => (await import("./repo-policy.js")) as RepoPolicyModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RepoPolicyModule>;

const validCommand = (overrides: Partial<ValidationCommand> = {}): ValidationCommand => ({
  id: "test",
  label: "Run tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
  ...overrides,
});

const validWarningPaths = (
  overrides: Partial<RepoPolicyWarningPaths> = {},
): RepoPolicyWarningPaths => ({
  packageLocks: ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"],
  migrations: ["db/migrations/**"],
  infrastructure: [".github/**", "infra/**"],
  auth: ["apps/web/src/auth/**"],
  billing: ["apps/web/src/billing/**"],
  ...overrides,
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["SECURITY_MODEL.md", ".github/workflows/**"],
  sensitivePaths: [".env", ".env.*", "secrets/**"],
  warningPaths: validWarningPaths(),
  validationCommands: [validCommand()],
  maxChangedFiles: 25,
  maxDiffLines: 1_000,
  allowUntrackedFiles: false,
  dryRunChecks: [...DOCUMENTED_DRY_RUN_CHECKS],
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  check: SharedDryRunCheck;
  policy: SharedRepoPolicy;
  warningPaths: SharedRepoPolicyWarningPaths;
}) => value;

describe("RepoPolicy", () => {
  it("exports the documented dry-run checks in canonical order", async () => {
    const { DRY_RUN_CHECKS, DryRunCheckSchema } = await loadRepoPolicyModule();

    expect(DRY_RUN_CHECKS).toEqual(DOCUMENTED_DRY_RUN_CHECKS);
    for (const check of DOCUMENTED_DRY_RUN_CHECKS) {
      expect(DryRunCheckSchema.safeParse(check).success).toBe(true);
    }
    expect(DryRunCheckSchema.safeParse("repo_policy_optional").success).toBe(false);
  });

  it("validates a complete policy matching the documented data model", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(RepoPolicySchema.safeParse(validPolicy()).success).toBe(true);
  });

  it("validates a policy without the optional maxDiffLines limit", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();
    const policyWithoutDiffLimit = validPolicy();
    delete policyWithoutDiffLimit.maxDiffLines;

    expect(RepoPolicySchema.safeParse(policyWithoutDiffLimit).success).toBe(true);
  });

  it("rejects missing and empty validation commands", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(
      RepoPolicySchema.safeParse({ ...validPolicy(), validationCommands: undefined }).success,
    ).toBe(false);
    expect(RepoPolicySchema.safeParse(validPolicy({ validationCommands: [] })).success).toBe(false);
  });

  it("rejects missing or wrong contract versions", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(
      RepoPolicySchema.safeParse({ ...validPolicy(), contractVersion: undefined }).success,
    ).toBe(false);
    expect(
      RepoPolicySchema.safeParse({
        ...validPolicy(),
        contractVersion: "2026-05-10.v2",
      }).success,
    ).toBe(false);
  });

  it("rejects missing protected branch fields", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(
      RepoPolicySchema.safeParse({ ...validPolicy(), protectedBranches: undefined }).success,
    ).toBe(false);
  });

  it("defaults missing protected and sensitive path arrays for dry-run readiness checks", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();
    const policyInput: Partial<RepoPolicy> = validPolicy();
    delete policyInput.protectedPaths;
    delete policyInput.sensitivePaths;

    const parsedPolicy = RepoPolicySchema.parse(policyInput);

    expect(parsedPolicy.protectedPaths).toEqual([]);
    expect(parsedPolicy.sensitivePaths).toEqual([]);
  });

  it("allows empty protected and sensitive path arrays for dry-run readiness checks", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();
    const parsedPolicy = RepoPolicySchema.parse(
      validPolicy({
        protectedPaths: [],
        sensitivePaths: [],
      }),
    );

    expect(parsedPolicy.protectedPaths).toEqual([]);
    expect(parsedPolicy.sensitivePaths).toEqual([]);
  });

  it("rejects empty protected, sensitive, and warning path strings", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(RepoPolicySchema.safeParse(validPolicy({ protectedBranches: [""] })).success).toBe(
      false,
    );
    expect(RepoPolicySchema.safeParse(validPolicy({ protectedPaths: [""] })).success).toBe(false);
    expect(RepoPolicySchema.safeParse(validPolicy({ sensitivePaths: [""] })).success).toBe(false);
    expect(
      RepoPolicySchema.safeParse(
        validPolicy({
          warningPaths: validWarningPaths({
            packageLocks: [""],
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(
      RepoPolicySchema.safeParse({
        ...validPolicy(),
        readsPolicyFiles: true,
      }).success,
    ).toBe(false);
  });

  it("requires a complete strict warning path object", async () => {
    const { RepoPolicyWarningPathsSchema } = await loadRepoPolicyModule();
    const missingBilling: Partial<RepoPolicyWarningPaths> = validWarningPaths();
    delete missingBilling.billing;

    expect(RepoPolicyWarningPathsSchema.safeParse(validWarningPaths()).success).toBe(true);
    expect(RepoPolicyWarningPathsSchema.safeParse(missingBilling).success).toBe(false);
    expect(
      RepoPolicyWarningPathsSchema.safeParse({
        ...validWarningPaths(),
        docs: ["docs/**"],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid numeric limits", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    for (const maxChangedFiles of [0, -1, 1.5]) {
      expect(RepoPolicySchema.safeParse(validPolicy({ maxChangedFiles })).success).toBe(false);
    }
    for (const maxDiffLines of [0, -1, 1.5]) {
      expect(RepoPolicySchema.safeParse(validPolicy({ maxDiffLines })).success).toBe(false);
    }
  });

  it("rejects missing, empty, and unknown dry-run checks", async () => {
    const { RepoPolicySchema } = await loadRepoPolicyModule();

    expect(RepoPolicySchema.safeParse({ ...validPolicy(), dryRunChecks: undefined }).success).toBe(
      false,
    );
    expect(RepoPolicySchema.safeParse(validPolicy({ dryRunChecks: [] })).success).toBe(false);
    expect(
      RepoPolicySchema.safeParse(
        validPolicy({
          dryRunChecks: ["repo_path_exists", "hosted_execution_available" as DryRunCheck],
        }),
      ).success,
    ).toBe(false);
  });

  it("exports repo policy schemas, constants, and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();
    const policy: SharedRepoPolicy = validPolicy();
    const warningPaths: SharedRepoPolicyWarningPaths = policy.warningPaths;
    const check: SharedDryRunCheck = "repo_path_exists";

    expect(shared.DRY_RUN_CHECKS).toEqual(DOCUMENTED_DRY_RUN_CHECKS);
    expect(shared.DryRunCheckSchema?.safeParse(check).success).toBe(true);
    expect(shared.REPO_POLICY_WARNING_PATH_CATEGORIES).toEqual(WARNING_PATH_CATEGORIES);
    expect(shared.RepoPolicyWarningPathsSchema?.safeParse(warningPaths).success).toBe(true);
    expect(shared.RepoPolicySchema?.safeParse(policy).success).toBe(true);
    expect(assertEntrypointTypeExports({ check, policy, warningPaths }).check).toBe(
      "repo_path_exists",
    );
  });
});
