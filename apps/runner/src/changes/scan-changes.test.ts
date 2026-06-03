import {
  CONTRACT_VERSION,
  RepoPolicySchema,
  RiskFindingSchema,
  RunEventMetadataSchema,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import type { ChangeSizeGateResult } from "./change-size.js";
import type { ChangedFilesResult } from "./changed-files.js";
import {
  scanChanges,
  type ChangeScanResult,
  type ScanChangesDependencies,
} from "./scan-changes.js";
import {
  scanChanges as scanChangesFromEntrypoint,
  type ChangeScanResult as ChangeScanResultFromEntrypoint,
} from "../index.js";

const WORKTREE_PATH = "/repos/control-plane/.worktrees/task-067";

const UNSAFE_TEXT = [
  "diff --git a/private.ts b/private.ts",
  "@@ -1,1 +1,1 @@",
  "patch contains private implementation",
  "SECRET_TOKEN=do-not-print",
  "ghp_scanchangessecret123",
  "sk-scanchangessecret123",
  "command output line",
] as const;

const UNSAFE_EXACT_JSON_KEYS = [
  "diff",
  "patch",
  "source",
  "code",
  "content",
  "stdoutSummary",
  "stderrSummary",
] as const;

describe("scanChanges", () => {
  it("composes the post-Codex scanners and returns aggregate safe metadata", async () => {
    const changedFiles = changedFilesResult({
      paths: ["src/app.ts", "src/auth/login.ts", "pnpm-lock.yaml"],
      modifiedPaths: ["src/app.ts", "src/auth/login.ts"],
      untrackedPaths: ["pnpm-lock.yaml"],
      omittedPathCount: 1,
    });
    const envBlock = finding({
      id: "risk:sensitive_path:env_files",
      severity: "blocked",
      category: "sensitive_path",
      message: "Changed environment files are blocked.",
      paths: [".env.local"],
    });
    const secretBlock = finding({
      id: "risk:secret:provider_token",
      severity: "blocked",
      category: "secret",
      message: "Suspected secret detected: provider_token.",
      paths: ["src/app.ts"],
    });
    const protectedBlock = finding({
      id: "risk:protected_path",
      severity: "blocked",
      category: "protected_path",
      message: "Protected path changes are blocked by repository policy.",
      paths: ["SECURITY_MODEL.md"],
    });
    const warning = finding({
      id: "risk:package_lock",
      severity: "warning",
      category: "package_lock",
      message: "Package lock changes require review.",
      paths: ["pnpm-lock.yaml"],
    });
    const sizeWarning = finding({
      id: "risk:large_diff:diff_lines",
      severity: "warning",
      category: "large_diff",
      message: "Changed diff line count exceeds repository policy threshold.",
      paths: [],
    });
    const changeSize = changeSizeGateResult({
      counts: {
        changedFileCount: 3,
        omittedPathCount: 1,
        evaluatedFileCount: 4,
        trackedDiffLineCount: 20,
        untrackedDiffLineCount: 4,
        diffLineCount: 24,
      },
      warnings: [sizeWarning],
    });
    const { dependencies, calls } = dependencySet({
      changedFiles,
      envBlocks: [envBlock],
      secretBlocks: [secretBlock],
      protectedBlocks: [protectedBlock],
      warningFindings: [warning],
      changeSize,
    });

    const result = await scanChanges({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy(),
      dependencies,
    });

    expect(calls).toEqual([
      { name: "scanChangedFiles", worktreePath: WORKTREE_PATH },
      {
        name: "detectEnvFileBlocks",
        changedPaths: ["src/app.ts", "src/auth/login.ts", "pnpm-lock.yaml"],
      },
      {
        name: "scanChangedFilesForSecrets",
        worktreePath: WORKTREE_PATH,
        changedPaths: ["src/app.ts", "src/auth/login.ts", "pnpm-lock.yaml"],
      },
      {
        name: "detectProtectedPathBlocks",
        changedPaths: ["src/app.ts", "src/auth/login.ts", "pnpm-lock.yaml"],
      },
      {
        name: "detectWarningPathFindings",
        changedPaths: ["src/app.ts", "src/auth/login.ts", "pnpm-lock.yaml"],
      },
      {
        name: "evaluateChangeSizeGate",
        worktreePath: WORKTREE_PATH,
        changedFiles,
      },
    ]);
    expect(result.changedFiles).toEqual(changedFiles);
    expect(result.counts).toEqual({
      changedFileCount: 3,
      addedCount: 0,
      modifiedCount: 2,
      deletedCount: 0,
      untrackedCount: 1,
      omittedPathCount: 1,
      evaluatedFileCount: 4,
      trackedDiffLineCount: 20,
      untrackedDiffLineCount: 4,
      diffLineCount: 24,
    });
    expect(result.blockers).toEqual([envBlock, secretBlock, protectedBlock]);
    expect(result.warnings).toEqual([warning, sizeWarning]);
    expect(result.shouldBlock).toBe(true);
    expect(result.eventMetadata).toEqual({
      changedFilePaths: ["src/app.ts", "src/auth/login.ts", "pnpm-lock.yaml"],
      counts: result.counts,
      blockerCount: 3,
      warningCount: 2,
      shouldBlock: true,
      blockers: result.blockers.map(riskFindingSummary),
      warnings: result.warnings.map(riskFindingSummary),
    });
    expect(RunEventMetadataSchema.safeParse(result.eventMetadata).success).toBe(true);
  });

  it("orders blockers and warnings by detector precedence", async () => {
    const changedFiles = changedFilesResult({
      paths: [
        "src/app.ts",
        ".env.local",
        "SECURITY_MODEL.md",
        "pnpm-lock.yaml",
        "src/secrets/runtime.ts",
      ],
    });
    const envBlock = finding({
      id: "risk:sensitive_path:env_files",
      severity: "blocked",
      category: "sensitive_path",
      message: "Changed environment files are blocked.",
      paths: [".env.local"],
    });
    const secretBlock = finding({
      id: "risk:secret:secret_assignment",
      severity: "blocked",
      category: "secret",
      message: "Suspected secret detected: secret_assignment.",
      paths: ["src/secrets/runtime.ts"],
    });
    const protectedBlock = finding({
      id: "risk:protected_path",
      severity: "blocked",
      category: "protected_path",
      message: "Protected path changes are blocked by repository policy.",
      paths: ["SECURITY_MODEL.md"],
    });
    const sizeBlock = finding({
      id: "risk:large_diff:evaluation_failed",
      severity: "blocked",
      category: "large_diff",
      message: "Change size could not be evaluated.",
      paths: [],
    });
    const pathWarning = finding({
      id: "risk:package_lock",
      severity: "warning",
      category: "package_lock",
      message: "Package lock changes require review.",
      paths: ["pnpm-lock.yaml"],
    });
    const sizeWarning = finding({
      id: "risk:large_diff:file_count",
      severity: "warning",
      category: "large_diff",
      message: "Changed file count exceeds repository policy threshold.",
      paths: [],
    });
    const { dependencies } = dependencySet({
      changedFiles,
      envBlocks: [envBlock],
      secretBlocks: [secretBlock],
      protectedBlocks: [protectedBlock],
      warningFindings: [pathWarning],
      changeSize: changeSizeGateResult({
        counts: {
          changedFileCount: 5,
          omittedPathCount: 0,
          evaluatedFileCount: 5,
          trackedDiffLineCount: 0,
          untrackedDiffLineCount: 0,
          diffLineCount: 0,
        },
        blockers: [sizeBlock],
        warnings: [sizeWarning],
      }),
    });

    const result = await scanChanges({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy(),
      dependencies,
    });

    expect(result.blockers).toEqual([envBlock, secretBlock, protectedBlock, sizeBlock]);
    expect(result.warnings).toEqual([pathWarning, sizeWarning]);
    expect(result.shouldBlock).toBe(true);
  });

  it("returns a passing result for safe changed paths", async () => {
    const changedFiles = changedFilesResult({
      paths: ["src/app.ts", "docs/readme.md"],
      addedPaths: ["docs/readme.md"],
      modifiedPaths: ["src/app.ts"],
    });
    const { dependencies } = dependencySet({
      changedFiles,
      changeSize: changeSizeGateResult({
        counts: {
          changedFileCount: 2,
          omittedPathCount: 0,
          evaluatedFileCount: 2,
          trackedDiffLineCount: 6,
          untrackedDiffLineCount: 0,
          diffLineCount: 6,
        },
      }),
    });

    const result = await scanChanges({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy(),
      dependencies,
    });

    expect(result.changedFiles.counts).toEqual(changedFiles.counts);
    expect(result.counts).toEqual({
      ...changedFiles.counts,
      evaluatedFileCount: 2,
      trackedDiffLineCount: 6,
      untrackedDiffLineCount: 0,
      diffLineCount: 6,
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.shouldBlock).toBe(false);
    expect(RunEventMetadataSchema.safeParse(result.eventMetadata).success).toBe(true);
  });

  it("keeps findings and event metadata schema-valid without raw local artifacts", async () => {
    const changedFilesWithUnsafeExtras = {
      ...changedFilesResult({ paths: ["src/app.ts"] }),
      content: UNSAFE_TEXT.join("\n"),
      stdoutSummary: UNSAFE_TEXT.join("\n"),
      stderrSummary: UNSAFE_TEXT.join("\n"),
    } as unknown as ChangedFilesResult;
    const secretBlock = finding({
      id: "risk:secret:provider_token",
      severity: "blocked",
      category: "secret",
      message: "Suspected secret detected: provider_token.",
      paths: ["src/app.ts"],
    });
    const { dependencies } = dependencySet({
      changedFiles: changedFilesWithUnsafeExtras,
      secretBlocks: [secretBlock],
      changeSize: {
        ...changeSizeGateResult({
          counts: {
            changedFileCount: 1,
            omittedPathCount: 0,
            evaluatedFileCount: 1,
            trackedDiffLineCount: 2,
            untrackedDiffLineCount: 0,
            diffLineCount: 2,
          },
        }),
        content: UNSAFE_TEXT.join("\n"),
        stdoutSummary: UNSAFE_TEXT.join("\n"),
        stderrSummary: UNSAFE_TEXT.join("\n"),
      } as unknown as ChangeSizeGateResult,
    });

    const result = await scanChanges({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy(),
      dependencies,
    });

    expect(RunEventMetadataSchema.safeParse(result.eventMetadata).success).toBe(true);
    for (const finding of [...result.blockers, ...result.warnings]) {
      expect(RiskFindingSchema.parse(finding)).toEqual(finding);
    }
    expectSafeSerializedValue(result);
  });

  it("fails closed when the change-size gate reports evaluation failure", async () => {
    const sizeBlock = finding({
      id: "risk:large_diff:evaluation_failed",
      severity: "blocked",
      category: "large_diff",
      message: "Change size could not be evaluated.",
      paths: [],
    });
    const { dependencies } = dependencySet({
      changedFiles: changedFilesResult({ paths: ["src/app.ts"] }),
      changeSize: changeSizeGateResult({
        counts: {
          changedFileCount: 1,
          omittedPathCount: 0,
          evaluatedFileCount: 1,
          trackedDiffLineCount: 0,
          untrackedDiffLineCount: 0,
          diffLineCount: 0,
        },
        blockers: [sizeBlock],
      }),
    });

    const result = await scanChanges({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy(),
      dependencies,
    });

    expect(result.blockers).toEqual([sizeBlock]);
    expect(result.shouldBlock).toBe(true);
  });

  it("exports the composer from the runner entrypoint", () => {
    const result: ChangeScanResultFromEntrypoint = {
      changedFiles: changedFilesResult({ paths: [] }),
      counts: {
        changedFileCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        omittedPathCount: 0,
        evaluatedFileCount: 0,
        trackedDiffLineCount: 0,
        untrackedDiffLineCount: 0,
        diffLineCount: 0,
      },
      blockers: [],
      warnings: [],
      shouldBlock: false,
      eventMetadata: {
        changedFilePaths: [],
        counts: {
          changedFileCount: 0,
          addedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          untrackedCount: 0,
          omittedPathCount: 0,
          evaluatedFileCount: 0,
          trackedDiffLineCount: 0,
          untrackedDiffLineCount: 0,
          diffLineCount: 0,
        },
        blockerCount: 0,
        warningCount: 0,
        shouldBlock: false,
        blockers: [],
        warnings: [],
      },
    } satisfies ChangeScanResult;

    expect(result.shouldBlock).toBe(false);
    expect(scanChangesFromEntrypoint).toBe(scanChanges);
  });
});

type DependencyCall =
  | { name: "scanChangedFiles"; worktreePath: string }
  | { name: "detectEnvFileBlocks"; changedPaths: string[] }
  | { name: "scanChangedFilesForSecrets"; worktreePath: string; changedPaths: string[] }
  | { name: "detectProtectedPathBlocks"; changedPaths: string[] }
  | { name: "detectWarningPathFindings"; changedPaths: string[] }
  | { name: "evaluateChangeSizeGate"; worktreePath: string; changedFiles: ChangedFilesResult };

const dependencySet = ({
  changedFiles = changedFilesResult({ paths: [] }),
  envBlocks = [],
  secretBlocks = [],
  protectedBlocks = [],
  warningFindings = [],
  changeSize = changeSizeGateResult(),
}: {
  changedFiles?: ChangedFilesResult;
  envBlocks?: RiskFinding[];
  secretBlocks?: RiskFinding[];
  protectedBlocks?: RiskFinding[];
  warningFindings?: RiskFinding[];
  changeSize?: ChangeSizeGateResult;
} = {}): { dependencies: ScanChangesDependencies; calls: DependencyCall[] } => {
  const calls: DependencyCall[] = [];

  return {
    calls,
    dependencies: {
      scanChangedFiles: async (worktreePath) => {
        calls.push({ name: "scanChangedFiles", worktreePath });

        return changedFiles;
      },
      detectEnvFileBlocks: (changedPaths) => {
        calls.push({ name: "detectEnvFileBlocks", changedPaths: [...changedPaths] });

        return envBlocks;
      },
      scanChangedFilesForSecrets: async (worktreePath, changedPaths) => {
        calls.push({
          name: "scanChangedFilesForSecrets",
          worktreePath,
          changedPaths: [...changedPaths],
        });

        return secretBlocks;
      },
      detectProtectedPathBlocks: (_policy, changedPaths) => {
        calls.push({ name: "detectProtectedPathBlocks", changedPaths: [...changedPaths] });

        return protectedBlocks;
      },
      detectWarningPathFindings: (_policy, changedPaths) => {
        calls.push({ name: "detectWarningPathFindings", changedPaths: [...changedPaths] });

        return warningFindings;
      },
      evaluateChangeSizeGate: async (options) => {
        calls.push({
          name: "evaluateChangeSizeGate",
          worktreePath: options.worktreePath,
          changedFiles: options.changedFiles,
        });

        return changeSize;
      },
    },
  };
};

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
    maxDiffLines: 100,
    allowUntrackedFiles: false,
    dryRunChecks: ["protected_and_sensitive_paths_configured"],
    ...overrides,
  });

const changedFilesResult = ({
  paths,
  addedPaths = [],
  modifiedPaths = [],
  deletedPaths = [],
  untrackedPaths = [],
  omittedPathCount = 0,
}: {
  paths: string[];
  addedPaths?: string[];
  modifiedPaths?: string[];
  deletedPaths?: string[];
  untrackedPaths?: string[];
  omittedPathCount?: number;
}): ChangedFilesResult => ({
  paths,
  addedPaths,
  modifiedPaths,
  deletedPaths,
  untrackedPaths,
  counts: {
    changedFileCount: paths.length,
    addedCount: addedPaths.length,
    modifiedCount: modifiedPaths.length,
    deletedCount: deletedPaths.length,
    untrackedCount: untrackedPaths.length,
    omittedPathCount,
  },
});

const changeSizeGateResult = ({
  counts = {
    changedFileCount: 0,
    omittedPathCount: 0,
    evaluatedFileCount: 0,
    trackedDiffLineCount: 0,
    untrackedDiffLineCount: 0,
    diffLineCount: 0,
  },
  blockers = [],
  warnings = [],
}: Partial<ChangeSizeGateResult> = {}): ChangeSizeGateResult => ({
  counts,
  blockers,
  warnings,
});

const finding = (value: RiskFinding): RiskFinding => RiskFindingSchema.parse(value);

const riskFindingSummary = (
  finding: RiskFinding,
): Pick<RiskFinding, "id" | "severity" | "category" | "paths"> => ({
  id: finding.id,
  severity: finding.severity,
  category: finding.category,
  paths: finding.paths,
});

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeKey of UNSAFE_EXACT_JSON_KEYS) {
    expect(serialized).not.toContain(`"${unsafeKey}"`);
  }

  for (const unsafeText of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};
