import { describe, expect, it } from "vitest";
import type {
  DryRunCheck as SharedDryRunCheck,
  DryRunCheckResult as SharedDryRunCheckResult,
  DryRunCheckResultStatus as SharedDryRunCheckResultStatus,
  DryRunResult as SharedDryRunResult,
  DryRunResultStatus as SharedDryRunResultStatus,
  RiskFinding as SharedRiskFinding,
  RunnerCapabilities as SharedRunnerCapabilities,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const DOCUMENTED_DRY_RUN_RESULT_STATUSES = ["passed", "failed", "warning"] as const;

const DOCUMENTED_DRY_RUN_CHECK_RESULT_STATUSES = [
  "passed",
  "failed",
  "warning",
  "skipped",
] as const;

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

type DryRunResultStatus = (typeof DOCUMENTED_DRY_RUN_RESULT_STATUSES)[number];
type DryRunCheckResultStatus = (typeof DOCUMENTED_DRY_RUN_CHECK_RESULT_STATUSES)[number];
type DryRunCheck = (typeof DOCUMENTED_DRY_RUN_CHECKS)[number];

type RiskFinding = {
  id: string;
  severity: "warning" | "blocked";
  category: SharedRiskFinding["category"];
  message: string;
  paths: string[];
};

type RunnerCapabilities = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId?: string;
  os: {
    platform: string;
    release: string;
    arch: string;
  };
  shell: string;
  tools: {
    git?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    gh?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    codex?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    node?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    npm?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    pnpm?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    yarn?: {
      available: boolean;
      version?: string;
      path?: string;
    };
    python?: {
      available: boolean;
      version?: string;
      path?: string;
    };
  };
  maxConcurrentJobs: number;
  supportsDryRun: boolean;
  supportsCancellation: boolean;
  reportedAt: string;
};

type DryRunCheckResult = {
  id: DryRunCheck;
  label: string;
  status: DryRunCheckResultStatus;
  message: string;
  metadata: Record<string, unknown>;
};

type DryRunResult = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  runId: string;
  status: DryRunResultStatus;
  checks: DryRunCheckResult[];
  capabilities: RunnerCapabilities;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
  createdAt: string;
};

type DryRunResultModule = {
  DRY_RUN_RESULT_STATUSES: readonly DryRunResultStatus[];
  DryRunResultStatusSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  DRY_RUN_CHECK_RESULT_STATUSES: readonly DryRunCheckResultStatus[];
  DryRunCheckResultStatusSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  DryRunCheckResultMetadataSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  DryRunCheckResultSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  DryRunResultSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadDryRunResultModule = async () =>
  (await import("./dry-run-result.js")) as DryRunResultModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<DryRunResultModule>;

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  os: {
    platform: "darwin",
    release: "25.5.0",
    arch: "arm64",
  },
  shell: "/bin/zsh",
  tools: {
    git: {
      available: true,
      version: "2.49.0",
      path: "/usr/bin/git",
    },
    gh: {
      available: true,
      version: "2.72.0",
      path: "/opt/homebrew/bin/gh",
    },
    codex: {
      available: false,
    },
    node: {
      available: true,
      version: "24.0.0",
      path: "/opt/homebrew/bin/node",
    },
    pnpm: {
      available: true,
      version: "10.11.0",
      path: "/opt/homebrew/bin/pnpm",
    },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: true,
  reportedAt: "2026-05-14T20:45:02.239Z",
  ...overrides,
});

const validRiskFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk-1",
  severity: "warning",
  category: "package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  ...overrides,
});

const validCheckResult = (overrides: Partial<DryRunCheckResult> = {}): DryRunCheckResult => ({
  id: "repo_clean",
  label: "Repo clean",
  status: "passed",
  message: "Repository has no uncommitted changes.",
  metadata: {
    checkedAt: "2026-05-14T20:46:00.000Z",
    commandIds: ["test"],
    pathCount: 0,
    optional: false,
    summaries: {
      repo: "Clean working tree.",
    },
  },
  ...overrides,
});

const validDryRunResult = (overrides: Partial<DryRunResult> = {}): DryRunResult => ({
  contractVersion: CONTRACT_VERSION,
  id: "dry-run-result-1",
  runId: "run-1",
  status: "passed",
  checks: [validCheckResult()],
  capabilities: validCapabilities(),
  blockers: [],
  warnings: [],
  createdAt: "2026-05-14T20:47:00.000Z",
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  check: SharedDryRunCheck;
  checkResult: SharedDryRunCheckResult;
  checkStatus: SharedDryRunCheckResultStatus;
  result: SharedDryRunResult;
  resultStatus: SharedDryRunResultStatus;
  capabilities: SharedRunnerCapabilities;
}) => value;

describe("DryRunResult", () => {
  it("exports the documented result and check statuses in canonical order", async () => {
    const {
      DRY_RUN_RESULT_STATUSES,
      DRY_RUN_CHECK_RESULT_STATUSES,
      DryRunResultStatusSchema,
      DryRunCheckResultStatusSchema,
    } = await loadDryRunResultModule();

    expect(DRY_RUN_RESULT_STATUSES).toEqual(DOCUMENTED_DRY_RUN_RESULT_STATUSES);
    expect(DRY_RUN_CHECK_RESULT_STATUSES).toEqual(DOCUMENTED_DRY_RUN_CHECK_RESULT_STATUSES);

    for (const status of DOCUMENTED_DRY_RUN_RESULT_STATUSES) {
      expect(DryRunResultStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of DOCUMENTED_DRY_RUN_CHECK_RESULT_STATUSES) {
      expect(DryRunCheckResultStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("validates a passed dry-run result with successful checks and no findings", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    expect(DryRunResultSchema.safeParse(validDryRunResult()).success).toBe(true);
  });

  it("validates a warning dry-run result with warning checks and findings", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          status: "warning",
          checks: [
            validCheckResult(),
            validCheckResult({
              id: "validation_commands_configured",
              label: "Optional validation skipped",
              status: "warning",
              message: "An optional validation command is not configured.",
            }),
          ],
          warnings: [
            validRiskFinding({
              id: "warning-1",
              severity: "warning",
              category: "validation_skipped",
              message: "Optional validation was skipped.",
              paths: [],
            }),
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("validates a failed dry-run result with failed checks and blockers", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          status: "failed",
          checks: [
            validCheckResult({
              id: "required_tools_available",
              label: "Required tools available",
              status: "failed",
              message: "The GitHub CLI is unavailable.",
              metadata: {
                missingTools: ["gh"],
              },
            }),
          ],
          blockers: [
            validRiskFinding({
              id: "blocker-1",
              severity: "blocked",
              category: "missing_capability",
              message: "The runner is missing a required tool.",
              paths: [],
            }),
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("validates nested capabilities through the runner capability contract", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          capabilities: validCapabilities({
            maxConcurrentJobs: 0,
          }),
        }),
      ).success,
    ).toBe(false);
    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          capabilities: validCapabilities({
            tools: {
              docker: {
                available: true,
              },
            } as RunnerCapabilities["tools"],
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("validates blockers and warnings through the risk finding contract", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          blockers: [
            validRiskFinding({
              severity: "error" as RiskFinding["severity"],
            }),
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      DryRunResultSchema.safeParse({
        ...validDryRunResult(),
        warnings: [
          {
            ...validRiskFinding(),
            rawMessage: "not allowed",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects missing or wrong contract versions", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();
    const resultWithoutContractVersion: Record<string, unknown> = validDryRunResult();
    delete resultWithoutContractVersion.contractVersion;

    expect(DryRunResultSchema.safeParse(resultWithoutContractVersion).success).toBe(false);
    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          contractVersion: "2026-05-10.v0" as typeof CONTRACT_VERSION,
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown result and check statuses", async () => {
    const { DryRunResultSchema, DryRunResultStatusSchema, DryRunCheckResultStatusSchema } =
      await loadDryRunResultModule();
    const unknownResultStatus = "blocked" as DryRunResultStatus;
    const unknownCheckStatus = "cancelled" as DryRunCheckResultStatus;

    expect(DryRunResultStatusSchema.safeParse(unknownResultStatus).success).toBe(false);
    expect(DryRunCheckResultStatusSchema.safeParse(unknownCheckStatus).success).toBe(false);
    expect(
      DryRunResultSchema.safeParse(validDryRunResult({ status: unknownResultStatus })).success,
    ).toBe(false);
    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          checks: [validCheckResult({ status: unknownCheckStatus })],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects empty required result strings and check strings", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    for (const key of ["id", "runId", "createdAt"] satisfies (keyof DryRunResult)[]) {
      expect(DryRunResultSchema.safeParse(validDryRunResult({ [key]: "" })).success).toBe(false);
    }

    for (const key of ["id", "label", "message"] satisfies (keyof DryRunCheckResult)[]) {
      expect(
        DryRunResultSchema.safeParse(
          validDryRunResult({
            checks: [validCheckResult({ [key]: "" })],
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("uses the documented dry-run check identifiers for check result ids", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    for (const check of DOCUMENTED_DRY_RUN_CHECKS) {
      expect(
        DryRunResultSchema.safeParse(
          validDryRunResult({
            checks: [validCheckResult({ id: check })],
          }),
        ).success,
      ).toBe(true);
    }
    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          checks: [validCheckResult({ id: "hosted_execution_available" as DryRunCheck })],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields that could carry raw source payloads", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    for (const unsafeField of ["diff", "patch", "sourceCode", "metadata"]) {
      expect(
        DryRunResultSchema.safeParse({
          ...validDryRunResult(),
          [unsafeField]: "not allowed",
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown check result fields", async () => {
    const { DryRunResultSchema } = await loadDryRunResultModule();

    expect(
      DryRunResultSchema.safeParse({
        ...validDryRunResult(),
        checks: [
          {
            ...validCheckResult(),
            rawOutput: "not allowed",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe check metadata keys recursively", async () => {
    const { DryRunCheckResultMetadataSchema, DryRunResultSchema } = await loadDryRunResultModule();
    const unsafeKeys = [
      "diff",
      "patch",
      "source",
      "code",
      "sourceCode",
      "content",
      "contents",
      "snippet",
      "snippets",
      "fileContent",
      "fileContents",
    ];

    for (const unsafeKey of unsafeKeys) {
      const metadata = {
        safeSummary: "Dry-run metadata.",
        nested: [
          {
            [unsafeKey]: "unsafe payload",
          },
        ],
      };

      expect(DryRunCheckResultMetadataSchema.safeParse(metadata).success).toBe(false);
      expect(
        DryRunResultSchema.safeParse(
          validDryRunResult({
            checks: [validCheckResult({ metadata })],
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("rejects prefixed and suffixed raw payload metadata keys recursively", async () => {
    const { DryRunCheckResultMetadataSchema, DryRunResultSchema } = await loadDryRunResultModule();
    const unsafeKeys = [
      "rawDiff",
      "diffText",
      "unifiedDiff",
      "rawPatch",
      "patchText",
      "fullPatch",
      "rawSource",
      "sourceText",
      "sourceContent",
      "sourceFileContents",
      "rawCode",
      "codeSnippet",
      "codeText",
    ];

    for (const unsafeKey of unsafeKeys) {
      const metadata = {
        safeSummary: "Dry-run metadata.",
        nested: {
          safeList: [
            {
              [unsafeKey]: "unsafe payload",
            },
          ],
        },
      };

      expect(DryRunCheckResultMetadataSchema.safeParse(metadata).success).toBe(false);
      expect(
        DryRunResultSchema.safeParse(
          validDryRunResult({
            checks: [validCheckResult({ metadata })],
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("allows safe check metadata for paths, command ids, statuses, versions, timestamps, and summaries", async () => {
    const { DryRunCheckResultMetadataSchema, DryRunResultSchema } = await loadDryRunResultModule();
    const metadata = {
      path: "packages/shared/src/dry-run-result.ts",
      paths: ["packages/shared/src/dry-run-result.ts"],
      commandIds: ["test"],
      optional: false,
      status: "passed",
      gitVersion: "2.49.0",
      checkedAt: "2026-05-14T20:48:00.000Z",
      summary: "Repository readiness checks passed.",
      counts: {
        blockers: 0,
        warnings: 0,
      },
    };

    expect(DryRunCheckResultMetadataSchema.safeParse(metadata).success).toBe(true);
    expect(
      DryRunResultSchema.safeParse(
        validDryRunResult({
          checks: [validCheckResult({ metadata })],
        }),
      ).success,
    ).toBe(true);
  });

  it("exports dry-run result schemas, constants, and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();
    const result: SharedDryRunResult = validDryRunResult();
    const checkResult: SharedDryRunCheckResult = validCheckResult();
    const resultStatus: SharedDryRunResultStatus = "warning";
    const checkStatus: SharedDryRunCheckResultStatus = "skipped";
    const check: SharedDryRunCheck = "repo_path_exists";
    const capabilities: SharedRunnerCapabilities = validCapabilities();

    expect(shared.DRY_RUN_RESULT_STATUSES).toEqual(DOCUMENTED_DRY_RUN_RESULT_STATUSES);
    expect(shared.DRY_RUN_CHECK_RESULT_STATUSES).toEqual(DOCUMENTED_DRY_RUN_CHECK_RESULT_STATUSES);
    expect(shared.DryRunResultStatusSchema?.safeParse(resultStatus).success).toBe(true);
    expect(shared.DryRunCheckResultStatusSchema?.safeParse(checkStatus).success).toBe(true);
    expect(shared.DryRunCheckResultMetadataSchema?.safeParse(checkResult.metadata).success).toBe(
      true,
    );
    expect(shared.DryRunCheckResultSchema?.safeParse(checkResult).success).toBe(true);
    expect(shared.DryRunResultSchema?.safeParse(result).success).toBe(true);

    assertEntrypointTypeExports({
      check,
      checkResult,
      checkStatus,
      result,
      resultStatus,
      capabilities,
    });
  });
});
