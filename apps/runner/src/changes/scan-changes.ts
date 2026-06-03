import {
  RiskFindingSchema,
  RunEventMetadataSchema,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";

import {
  evaluateChangeSizeGate,
  type ChangeSizeGateCounts,
  type ChangeSizeGateOptions,
  type ChangeSizeGateResult,
} from "./change-size.js";
import { scanChangedFiles, type ChangedFilesResult } from "./changed-files.js";
import { detectEnvFileBlocks } from "./env-block.js";
import { detectProtectedPathBlocks } from "./protected-paths.js";
import { scanChangedFilesForSecrets } from "./secret-scan.js";
import { detectWarningPathFindings } from "./warning-paths.js";

export type ScanChangesDependencies = {
  scanChangedFiles: (worktreePath: string) => Promise<ChangedFilesResult>;
  detectEnvFileBlocks: (changedPaths: readonly string[]) => RiskFinding[];
  scanChangedFilesForSecrets: (
    worktreePath: string,
    changedPaths: readonly string[],
  ) => Promise<RiskFinding[]>;
  detectProtectedPathBlocks: (policy: RepoPolicy, changedPaths: readonly string[]) => RiskFinding[];
  detectWarningPathFindings: (policy: RepoPolicy, changedPaths: readonly string[]) => RiskFinding[];
  evaluateChangeSizeGate: (options: ChangeSizeGateOptions) => Promise<ChangeSizeGateResult>;
};

export type ScanChangesOptions = {
  worktreePath: string;
  policy: RepoPolicy;
  dependencies?: Partial<ScanChangesDependencies>;
};

export type ChangeScanCounts = ChangedFilesResult["counts"] & ChangeSizeGateCounts;

export type ChangeScanRiskFindingSummary = Pick<
  RiskFinding,
  "id" | "severity" | "category" | "paths"
>;

export type ChangeScanEventMetadata = {
  changedFilePaths: string[];
  counts: ChangeScanCounts;
  blockerCount: number;
  warningCount: number;
  shouldBlock: boolean;
  blockers: ChangeScanRiskFindingSummary[];
  warnings: ChangeScanRiskFindingSummary[];
};

export type ChangeScanResult = {
  changedFiles: ChangedFilesResult;
  counts: ChangeScanCounts;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
  shouldBlock: boolean;
  eventMetadata: ChangeScanEventMetadata;
};

export const scanChanges = async ({
  worktreePath,
  policy,
  dependencies: dependencyOverrides = {},
}: ScanChangesOptions): Promise<ChangeScanResult> => {
  const dependencies = scanChangesDependencies(dependencyOverrides);
  const changedFiles = safeChangedFilesResult(await dependencies.scanChangedFiles(worktreePath));
  const changedPaths = changedFiles.paths;

  const envBlocks = validateRiskFindings(dependencies.detectEnvFileBlocks(changedPaths));
  const secretBlocks = validateRiskFindings(
    await dependencies.scanChangedFilesForSecrets(worktreePath, changedPaths),
  );
  const protectedPathBlocks = validateRiskFindings(
    dependencies.detectProtectedPathBlocks(policy, changedPaths),
  );
  const warningPathFindings = validateRiskFindings(
    dependencies.detectWarningPathFindings(policy, changedPaths),
  );
  const changeSize = safeChangeSizeGateResult(
    await dependencies.evaluateChangeSizeGate({
      worktreePath,
      policy,
      changedFiles,
    }),
  );

  const blockers = [...envBlocks, ...secretBlocks, ...protectedPathBlocks, ...changeSize.blockers];
  const warnings = [...warningPathFindings, ...changeSize.warnings];
  const shouldBlock = blockers.length > 0;
  const counts = combinedCounts(changedFiles, changeSize.counts);
  const eventMetadata = safeEventMetadata({
    changedFilePaths: [...changedPaths],
    counts,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    shouldBlock,
    blockers: blockers.map(riskFindingSummary),
    warnings: warnings.map(riskFindingSummary),
  });

  return {
    changedFiles,
    counts,
    blockers,
    warnings,
    shouldBlock,
    eventMetadata,
  };
};

const scanChangesDependencies = (
  overrides: Partial<ScanChangesDependencies>,
): ScanChangesDependencies => ({
  scanChangedFiles,
  detectEnvFileBlocks,
  scanChangedFilesForSecrets,
  detectProtectedPathBlocks,
  detectWarningPathFindings,
  evaluateChangeSizeGate,
  ...overrides,
});

const validateRiskFindings = (findings: readonly RiskFinding[]): RiskFinding[] =>
  findings.map((finding) => RiskFindingSchema.parse(finding));

const safeChangedFilesResult = (changedFiles: ChangedFilesResult): ChangedFilesResult => ({
  paths: safePathList(changedFiles.paths),
  addedPaths: safePathList(changedFiles.addedPaths),
  modifiedPaths: safePathList(changedFiles.modifiedPaths),
  deletedPaths: safePathList(changedFiles.deletedPaths),
  untrackedPaths: safePathList(changedFiles.untrackedPaths),
  counts: {
    changedFileCount: changedFiles.counts.changedFileCount,
    addedCount: changedFiles.counts.addedCount,
    modifiedCount: changedFiles.counts.modifiedCount,
    deletedCount: changedFiles.counts.deletedCount,
    untrackedCount: changedFiles.counts.untrackedCount,
    omittedPathCount: changedFiles.counts.omittedPathCount,
  },
});

const safeChangeSizeGateResult = (changeSize: ChangeSizeGateResult): ChangeSizeGateResult => ({
  counts: {
    changedFileCount: changeSize.counts.changedFileCount,
    omittedPathCount: changeSize.counts.omittedPathCount,
    evaluatedFileCount: changeSize.counts.evaluatedFileCount,
    trackedDiffLineCount: changeSize.counts.trackedDiffLineCount,
    untrackedDiffLineCount: changeSize.counts.untrackedDiffLineCount,
    diffLineCount: changeSize.counts.diffLineCount,
  },
  blockers: validateRiskFindings(changeSize.blockers),
  warnings: validateRiskFindings(changeSize.warnings),
});

const safePathList = (paths: readonly string[]): string[] => [...paths];

const combinedCounts = (
  changedFiles: ChangedFilesResult,
  sizeCounts: ChangeSizeGateCounts,
): ChangeScanCounts => ({
  changedFileCount: changedFiles.counts.changedFileCount,
  addedCount: changedFiles.counts.addedCount,
  modifiedCount: changedFiles.counts.modifiedCount,
  deletedCount: changedFiles.counts.deletedCount,
  untrackedCount: changedFiles.counts.untrackedCount,
  omittedPathCount: changedFiles.counts.omittedPathCount,
  evaluatedFileCount: sizeCounts.evaluatedFileCount,
  trackedDiffLineCount: sizeCounts.trackedDiffLineCount,
  untrackedDiffLineCount: sizeCounts.untrackedDiffLineCount,
  diffLineCount: sizeCounts.diffLineCount,
});

const riskFindingSummary = (finding: RiskFinding): ChangeScanRiskFindingSummary => ({
  id: finding.id,
  severity: finding.severity,
  category: finding.category,
  paths: [...finding.paths],
});

const safeEventMetadata = (metadata: ChangeScanEventMetadata): ChangeScanEventMetadata =>
  RunEventMetadataSchema.parse(metadata) as ChangeScanEventMetadata;
