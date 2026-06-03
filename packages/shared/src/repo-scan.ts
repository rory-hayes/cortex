import { z } from "zod";

import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const NonNegativeIntegerSchema = z.number().int().min(0);
const DocumentSummaryLabelSchema = z.string().min(1).max(80);
const DocumentSummaryTextSchema = z.string().min(1).max(480);
const GoalContextSummaryTextSchema = z.string().min(1).max(500);

const UNSAFE_REPO_SCAN_PAYLOAD_KEYS = new Set([
  "command",
  "diff",
  "patch",
  "source",
  "sourcecode",
  "snippet",
  "code",
  "content",
  "filecontent",
  "secret",
  "token",
  "password",
  "privatekey",
  "rawlog",
  "stdout",
  "stderr",
  "rawoutput",
  "paths",
  "filepaths",
  "localpath",
]);

const UNSAFE_REPO_SCAN_TEXT_PATTERNS = [
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\))/iu,
  /(?:^|[/\\])\.\.(?:[/\\]|$)/u,
] as const;

const normalizePayloadKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const addUnsafePayloadKeyIssues = (
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
) => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addUnsafePayloadKeyIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];

    if (UNSAFE_REPO_SCAN_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Repo scan cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

const addUnsafeRepoScanTextIssues = (
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
): void => {
  if (typeof value === "string") {
    if (UNSAFE_REPO_SCAN_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
      context.addIssue({
        code: "custom",
        message: "Repo scan cannot include unsafe text values.",
        path,
      });
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addUnsafeRepoScanTextIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    addUnsafeRepoScanTextIssues(childValue, context, [...path, key], seen);
  }
};

export const REPO_SCAN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const RepoScanStatusSchema = z.enum(REPO_SCAN_STATUSES);
export type RepoScanStatus = z.infer<typeof RepoScanStatusSchema>;

export const REPO_SCAN_MODULE_STATUSES = [
  "queued",
  "running",
  "passed",
  "warning",
  "blocked",
  "failed",
  "skipped",
] as const;

export const RepoScanModuleStatusValueSchema = z.enum(REPO_SCAN_MODULE_STATUSES);
export type RepoScanModuleStatusValue = z.infer<typeof RepoScanModuleStatusValueSchema>;

export const RepoScanLanguageSummarySchema = z
  .object({
    name: NonEmptyStringSchema,
    fileCount: NonNegativeIntegerSchema,
  })
  .strict();

export type RepoScanLanguageSummary = z.infer<typeof RepoScanLanguageSummarySchema>;

export const RepoScanDocumentationSummarySchema = z
  .object({
    kind: NonEmptyStringSchema,
    present: z.boolean(),
    pathCount: NonNegativeIntegerSchema,
  })
  .strict();

export type RepoScanDocumentationSummary = z.infer<typeof RepoScanDocumentationSummarySchema>;

export const RepoScanPolicySummarySchema = z
  .object({
    hasPolicyFile: z.boolean(),
    protectedPathCount: NonNegativeIntegerSchema,
    sensitivePathCount: NonNegativeIntegerSchema,
    validationCommandCount: NonNegativeIntegerSchema,
    dryRunCheckCount: NonNegativeIntegerSchema,
  })
  .strict();

export type RepoScanPolicySummary = z.infer<typeof RepoScanPolicySummarySchema>;

export const REPO_SCAN_AGENT_INSTRUCTION_READ_STATUSES = [
  "missing",
  "read",
  "unreadable",
  "oversized",
  "unknown_size",
] as const;

export const RepoScanAgentInstructionReadStatusSchema = z.enum(
  REPO_SCAN_AGENT_INSTRUCTION_READ_STATUSES,
);
export type RepoScanAgentInstructionReadStatus = z.infer<
  typeof RepoScanAgentInstructionReadStatusSchema
>;

export const REPO_SCAN_AGENT_INSTRUCTION_COMPLETENESS_STATUSES = [
  "missing",
  "complete",
  "incomplete",
  "conflicting",
  "unknown",
] as const;

export const RepoScanAgentInstructionCompletenessStatusSchema = z.enum(
  REPO_SCAN_AGENT_INSTRUCTION_COMPLETENESS_STATUSES,
);
export type RepoScanAgentInstructionCompletenessStatus = z.infer<
  typeof RepoScanAgentInstructionCompletenessStatusSchema
>;

export const RepoScanAgentInstructionSummarySchema = z
  .object({
    hasAgentInstructions: z.boolean(),
    instructionFileCount: NonNegativeIntegerSchema,
    readStatus: RepoScanAgentInstructionReadStatusSchema,
    completenessStatus: RepoScanAgentInstructionCompletenessStatusSchema,
    missingSectionLabels: z.array(NonEmptyStringSchema),
  })
  .strict();

export type RepoScanAgentInstructionSummary = z.infer<typeof RepoScanAgentInstructionSummarySchema>;

const DEFAULT_REPO_SCAN_AGENT_INSTRUCTION_SUMMARY: RepoScanAgentInstructionSummary = {
  completenessStatus: "missing",
  hasAgentInstructions: false,
  instructionFileCount: 0,
  missingSectionLabels: ["agent instructions"],
  readStatus: "missing",
};

export const REPO_SCAN_BACKLOG_READ_STATUSES = [
  "missing",
  "read",
  "unreadable",
  "oversized",
  "unknown_size",
] as const;

export const RepoScanBacklogReadStatusSchema = z.enum(REPO_SCAN_BACKLOG_READ_STATUSES);
export type RepoScanBacklogReadStatus = z.infer<typeof RepoScanBacklogReadStatusSchema>;

export const REPO_SCAN_BACKLOG_STRUCTURE_STATUSES = [
  "missing",
  "complete",
  "weak",
  "unknown",
] as const;

export const RepoScanBacklogStructureStatusSchema = z.enum(REPO_SCAN_BACKLOG_STRUCTURE_STATUSES);
export type RepoScanBacklogStructureStatus = z.infer<typeof RepoScanBacklogStructureStatusSchema>;

export const RepoScanBacklogSummarySchema = z
  .object({
    hasBacklog: z.boolean(),
    backlogFileCount: NonNegativeIntegerSchema,
    readStatus: RepoScanBacklogReadStatusSchema,
    structureStatus: RepoScanBacklogStructureStatusSchema,
    missingStructureLabels: z.array(NonEmptyStringSchema),
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);
  });

export type RepoScanBacklogSummary = z.infer<typeof RepoScanBacklogSummarySchema>;

export const DEFAULT_REPO_SCAN_BACKLOG_SUMMARY: RepoScanBacklogSummary = {
  backlogFileCount: 0,
  hasBacklog: false,
  missingStructureLabels: ["backlog"],
  readStatus: "missing",
  structureStatus: "missing",
};

export const REPO_SCAN_BACKLOG_QUALITY_STRUCTURE_STATUSES = [
  "missing",
  "weak",
  "ai_executable",
  "unknown",
] as const;

export const RepoScanBacklogQualityStructureStatusSchema = z.enum(
  REPO_SCAN_BACKLOG_QUALITY_STRUCTURE_STATUSES,
);
export type RepoScanBacklogQualityStructureStatus = z.infer<
  typeof RepoScanBacklogQualityStructureStatusSchema
>;

export const REPO_SCAN_BACKLOG_QUALITY_SIGNAL_LABELS = [
  "acceptance criteria",
  "backlog",
  "backlog content unreadable",
  "dependencies",
  "file-touch hints",
  "priority or milestone",
  "security notes",
  "status markers",
  "task ids",
  "validation",
] as const;

export const RepoScanBacklogQualitySignalLabelSchema = z.enum(
  REPO_SCAN_BACKLOG_QUALITY_SIGNAL_LABELS,
);
export type RepoScanBacklogQualitySignalLabel = z.infer<
  typeof RepoScanBacklogQualitySignalLabelSchema
>;

export const RepoScanBacklogQualitySummarySchema = z
  .object({
    hasBacklog: z.boolean(),
    backlogFileCount: NonNegativeIntegerSchema,
    readStatus: RepoScanBacklogReadStatusSchema,
    structureStatus: RepoScanBacklogQualityStructureStatusSchema,
    signalLabels: z.array(RepoScanBacklogQualitySignalLabelSchema),
    missingSignalLabels: z.array(RepoScanBacklogQualitySignalLabelSchema),
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);
  });

export type RepoScanBacklogQualitySummary = z.infer<typeof RepoScanBacklogQualitySummarySchema>;

export const DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY: RepoScanBacklogQualitySummary = {
  backlogFileCount: 0,
  hasBacklog: false,
  missingSignalLabels: ["backlog"],
  readStatus: "missing",
  signalLabels: [],
  structureStatus: "missing",
};

export const REPO_SCAN_VALIDATION_POSTURE_STATUSES = [
  "missing",
  "partial",
  "ready",
  "unknown",
] as const;

export const RepoScanValidationPostureStatusSchema = z.enum(REPO_SCAN_VALIDATION_POSTURE_STATUSES);
export type RepoScanValidationPostureStatus = z.infer<typeof RepoScanValidationPostureStatusSchema>;

export const REPO_SCAN_VALIDATION_COMMAND_LABELS = [
  "build",
  "format",
  "lint",
  "test",
  "typecheck",
] as const;

export const RepoScanValidationCommandLabelSchema = z.enum(REPO_SCAN_VALIDATION_COMMAND_LABELS);
export type RepoScanValidationCommandLabel = z.infer<typeof RepoScanValidationCommandLabelSchema>;

export const RepoScanValidationPostureSummarySchema = z
  .object({
    postureStatus: RepoScanValidationPostureStatusSchema,
    hasPolicyFile: z.boolean(),
    validationCommandCount: NonNegativeIntegerSchema,
    dryRunCheckCount: NonNegativeIntegerSchema,
    detectedCommandLabels: z.array(RepoScanValidationCommandLabelSchema),
    missingCommandLabels: z.array(RepoScanValidationCommandLabelSchema),
    suggestedCommandLabels: z.array(RepoScanValidationCommandLabelSchema),
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);
  });

export type RepoScanValidationPostureSummary = z.infer<
  typeof RepoScanValidationPostureSummarySchema
>;

export const DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY: RepoScanValidationPostureSummary = {
  detectedCommandLabels: [],
  dryRunCheckCount: 0,
  hasPolicyFile: false,
  missingCommandLabels: ["format", "lint", "test", "typecheck"],
  postureStatus: "missing",
  suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
  validationCommandCount: 0,
};

export const REPO_SCAN_CI_POSTURE_STATUSES = ["missing", "partial", "aligned", "unknown"] as const;

export const RepoScanCiPostureStatusSchema = z.enum(REPO_SCAN_CI_POSTURE_STATUSES);
export type RepoScanCiPostureStatus = z.infer<typeof RepoScanCiPostureStatusSchema>;

export const RepoScanCiPostureSummarySchema = z
  .object({
    postureStatus: RepoScanCiPostureStatusSchema,
    hasCi: z.boolean(),
    providerLabels: z.array(NonEmptyStringSchema),
    workflowFileCount: NonNegativeIntegerSchema,
    detectedCommandLabels: z.array(RepoScanValidationCommandLabelSchema),
    missingCommandLabels: z.array(RepoScanValidationCommandLabelSchema),
    requiredCommandLabels: z.array(RepoScanValidationCommandLabelSchema),
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);
  });

export type RepoScanCiPostureSummary = z.infer<typeof RepoScanCiPostureSummarySchema>;

export const DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY: RepoScanCiPostureSummary = {
  detectedCommandLabels: [],
  hasCi: false,
  missingCommandLabels: [],
  postureStatus: "missing",
  providerLabels: [],
  requiredCommandLabels: [],
  workflowFileCount: 0,
};

export const REPO_SCAN_PRODUCT_CLARITY_READ_STATUSES = [
  "missing",
  "read",
  "unreadable",
  "oversized",
  "unknown_size",
] as const;

export const RepoScanProductClarityReadStatusSchema = z.enum(
  REPO_SCAN_PRODUCT_CLARITY_READ_STATUSES,
);
export type RepoScanProductClarityReadStatus = z.infer<
  typeof RepoScanProductClarityReadStatusSchema
>;

export const REPO_SCAN_PRODUCT_CLARITY_STATUSES = [
  "missing",
  "weak",
  "sufficient",
  "unknown",
] as const;

export const RepoScanProductClarityStatusSchema = z.enum(REPO_SCAN_PRODUCT_CLARITY_STATUSES);
export type RepoScanProductClarityStatus = z.infer<typeof RepoScanProductClarityStatusSchema>;
const RepoScanProductClaritySummaryStatusSchema = z.preprocess(
  (value) => (value === "clear" ? "sufficient" : value),
  RepoScanProductClarityStatusSchema,
);

export const REPO_SCAN_GOAL_CONTEXT_STATUSES = ["not_provided", "provided"] as const;

export const RepoScanGoalContextStatusSchema = z.enum(REPO_SCAN_GOAL_CONTEXT_STATUSES);
export type RepoScanGoalContextStatus = z.infer<typeof RepoScanGoalContextStatusSchema>;

export const REPO_SCAN_PRODUCT_CLARITY_SIGNAL_LABELS = [
  "non_goals",
  "problem",
  "purpose",
  "scope",
  "success_criteria",
  "target_user",
  "workflow",
] as const;

export const RepoScanProductClaritySignalLabelSchema = z.enum(
  REPO_SCAN_PRODUCT_CLARITY_SIGNAL_LABELS,
);
export type RepoScanProductClaritySignalLabel = z.infer<
  typeof RepoScanProductClaritySignalLabelSchema
>;

const DefaultProductClaritySummary: {
  hasProductDocs: boolean;
  productDocCount: number;
  readStatus: RepoScanProductClarityReadStatus;
  clarityStatus: RepoScanProductClarityStatus;
  signalLabels: RepoScanProductClaritySignalLabel[];
  missingSignalLabels: RepoScanProductClaritySignalLabel[];
  goalContextStatus: RepoScanGoalContextStatus;
  goalContextSummary?: string;
} = {
  clarityStatus: "missing",
  goalContextStatus: "not_provided",
  hasProductDocs: false,
  missingSignalLabels: [],
  productDocCount: 0,
  readStatus: "missing",
  signalLabels: [],
};

export const RepoScanProductClaritySummarySchema = z
  .object({
    hasProductDocs: z.boolean(),
    productDocCount: NonNegativeIntegerSchema,
    readStatus: RepoScanProductClarityReadStatusSchema,
    clarityStatus: RepoScanProductClaritySummaryStatusSchema,
    signalLabels: z.array(RepoScanProductClaritySignalLabelSchema),
    missingSignalLabels: z.array(RepoScanProductClaritySignalLabelSchema),
    goalContextStatus: RepoScanGoalContextStatusSchema,
    goalContextSummary: GoalContextSummaryTextSchema.optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);
  });

export type RepoScanProductClaritySummary = z.infer<typeof RepoScanProductClaritySummarySchema>;

export const REPO_SCAN_REPO_HYGIENE_STATUSES = [
  "unknown",
  "healthy",
  "minor_gaps",
  "needs_attention",
] as const;

export const RepoScanRepoHygieneStatusSchema = z.enum(REPO_SCAN_REPO_HYGIENE_STATUSES);
export type RepoScanRepoHygieneStatus = z.infer<typeof RepoScanRepoHygieneStatusSchema>;

export const REPO_SCAN_REPO_HYGIENE_PACKAGE_MANAGER_STATUSES = [
  "unknown",
  "none",
  "single",
  "manifest_without_lockfile",
  "mixed",
] as const;

export const RepoScanRepoHygienePackageManagerStatusSchema = z.enum(
  REPO_SCAN_REPO_HYGIENE_PACKAGE_MANAGER_STATUSES,
);
export type RepoScanRepoHygienePackageManagerStatus = z.infer<
  typeof RepoScanRepoHygienePackageManagerStatusSchema
>;

export const REPO_SCAN_REPO_HYGIENE_MONOREPO_STRUCTURE_STATUSES = [
  "unknown",
  "single_project",
  "configured",
  "unclear",
] as const;

export const RepoScanRepoHygieneMonorepoStructureStatusSchema = z.enum(
  REPO_SCAN_REPO_HYGIENE_MONOREPO_STRUCTURE_STATUSES,
);
export type RepoScanRepoHygieneMonorepoStructureStatus = z.infer<
  typeof RepoScanRepoHygieneMonorepoStructureStatusSchema
>;

export const REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS = [
  "mixed_lockfiles",
  "unclear_monorepo_structure",
  "missing_js_lockfile",
  "missing_gitignore",
  "missing_contribution_docs",
  "missing_issue_templates",
] as const;

export const RepoScanRepoHygieneIssueLabelSchema = z.enum(REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS);
export type RepoScanRepoHygieneIssueLabel = z.infer<typeof RepoScanRepoHygieneIssueLabelSchema>;

export const RepoScanRepoHygieneSummarySchema = z
  .object({
    hygieneStatus: RepoScanRepoHygieneStatusSchema,
    issueLabels: z.array(RepoScanRepoHygieneIssueLabelSchema),
    packageManagerStatus: RepoScanRepoHygienePackageManagerStatusSchema,
    packageManagerCount: NonNegativeIntegerSchema,
    jsLockfileCount: NonNegativeIntegerSchema,
    hasRootGitignore: z.boolean(),
    hasContributionDocs: z.boolean(),
    contributionDocCount: NonNegativeIntegerSchema,
    issueTemplateCount: NonNegativeIntegerSchema,
    monorepoStructureStatus: RepoScanRepoHygieneMonorepoStructureStatusSchema,
    monorepoSignalCount: NonNegativeIntegerSchema,
    workspaceConfigCount: NonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);

    if (summary.hygieneStatus === "healthy" && summary.issueLabels.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Healthy repo hygiene summaries cannot include issue labels.",
        path: ["issueLabels"],
      });
    }
  });

export type RepoScanRepoHygieneSummary = z.infer<typeof RepoScanRepoHygieneSummarySchema>;

const DEFAULT_REPO_SCAN_REPO_HYGIENE_SUMMARY: RepoScanRepoHygieneSummary = {
  contributionDocCount: 0,
  hasContributionDocs: false,
  hasRootGitignore: false,
  hygieneStatus: "unknown",
  issueLabels: [],
  issueTemplateCount: 0,
  jsLockfileCount: 0,
  monorepoSignalCount: 0,
  monorepoStructureStatus: "unknown",
  packageManagerCount: 0,
  packageManagerStatus: "unknown",
  workspaceConfigCount: 0,
};

export const REPO_SCAN_DOCUMENT_SUMMARY_KINDS = [
  "agent_instructions",
  "code_of_conduct",
  "contributing",
  "mvp_plan",
  "product",
  "product_spec",
  "readme",
  "security",
] as const;

export const RepoScanDocumentSummaryKindSchema = z.enum(REPO_SCAN_DOCUMENT_SUMMARY_KINDS);
export type RepoScanDocumentSummaryKind = z.infer<typeof RepoScanDocumentSummaryKindSchema>;

export const REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS = [
  "agent_rules",
  "architecture",
  "backlog",
  "execution_flow",
  "product_scope",
  "security",
  "setup",
  "validation",
  "workflow",
] as const;

export const RepoScanDocumentSummaryTopicLabelSchema = z.enum(
  REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS,
);
export type RepoScanDocumentSummaryTopicLabel = z.infer<
  typeof RepoScanDocumentSummaryTopicLabelSchema
>;

export const RepoScanDocumentSummarySchema = z
  .object({
    kind: RepoScanDocumentSummaryKindSchema,
    label: DocumentSummaryLabelSchema,
    topicLabels: z
      .array(RepoScanDocumentSummaryTopicLabelSchema)
      .max(REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS.length),
    summary: DocumentSummaryTextSchema,
    redactionApplied: z.boolean(),
    documentByteCount: NonNegativeIntegerSchema,
    inputCharacterCount: NonNegativeIntegerSchema,
    redactedCharacterCount: NonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((summary, context) => {
    addUnsafePayloadKeyIssues(summary, context);
    addUnsafePayloadValueIssues(summary, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(summary, context);
  });

export type RepoScanDocumentSummary = z.infer<typeof RepoScanDocumentSummarySchema>;

export const RepoScanInventorySchema = z
  .object({
    agentInstructionSummary: RepoScanAgentInstructionSummarySchema.default(
      DEFAULT_REPO_SCAN_AGENT_INSTRUCTION_SUMMARY,
    ),
    backlogSummary: RepoScanBacklogSummarySchema.default(DEFAULT_REPO_SCAN_BACKLOG_SUMMARY),
    backlogQualitySummary: RepoScanBacklogQualitySummarySchema.default(
      DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
    ),
    validationPostureSummary: RepoScanValidationPostureSummarySchema.default(
      DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
    ),
    ciPostureSummary: RepoScanCiPostureSummarySchema.default(DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY),
    totalFileCount: NonNegativeIntegerSchema,
    scannedFileCount: NonNegativeIntegerSchema,
    omittedFileCount: NonNegativeIntegerSchema,
    totalDirectoryCount: NonNegativeIntegerSchema,
    languageSummaries: z.array(RepoScanLanguageSummarySchema),
    packageManagerLabels: z.array(NonEmptyStringSchema),
    ciProviderLabels: z.array(NonEmptyStringSchema),
    documentationSummaries: z.array(RepoScanDocumentationSummarySchema),
    policySummary: RepoScanPolicySummarySchema,
    productClaritySummary: RepoScanProductClaritySummarySchema.default(
      DefaultProductClaritySummary,
    ),
    repoHygieneSummary: RepoScanRepoHygieneSummarySchema.default(
      DEFAULT_REPO_SCAN_REPO_HYGIENE_SUMMARY,
    ),
    documentSummaries: z.array(RepoScanDocumentSummarySchema).default([]),
  })
  .strict()
  .superRefine((inventory, context) => {
    addUnsafePayloadKeyIssues(inventory, context);
    addUnsafePayloadValueIssues(inventory, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(inventory, context);

    if (inventory.scannedFileCount + inventory.omittedFileCount > inventory.totalFileCount) {
      context.addIssue({
        code: "custom",
        message: "scannedFileCount plus omittedFileCount cannot exceed totalFileCount.",
        path: ["scannedFileCount"],
      });
    }

    const summarizedLanguageFileCount = inventory.languageSummaries.reduce(
      (total, summary) => total + summary.fileCount,
      0,
    );

    if (summarizedLanguageFileCount > inventory.scannedFileCount) {
      context.addIssue({
        code: "custom",
        message: "Language summary file counts cannot exceed scannedFileCount.",
        path: ["languageSummaries"],
      });
    }
  });

export type RepoScanInventory = z.infer<typeof RepoScanInventorySchema>;

const TERMINAL_REPO_SCAN_MODULE_STATUSES = new Set<RepoScanModuleStatusValue>([
  "passed",
  "warning",
  "blocked",
  "failed",
  "skipped",
]);

export const RepoScanModuleStatusSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
    order: NonNegativeIntegerSchema,
    required: z.boolean(),
    status: RepoScanModuleStatusValueSchema,
    summary: NonEmptyStringSchema,
    startedAt: NonEmptyStringSchema.optional(),
    finishedAt: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((moduleStatus, context) => {
    addUnsafePayloadKeyIssues(moduleStatus, context);
    addUnsafePayloadValueIssues(
      moduleStatus,
      context,
      "Repo scan cannot include unsafe text values.",
    );
    addUnsafeRepoScanTextIssues(moduleStatus, context);

    if (moduleStatus.status === "running" && !moduleStatus.startedAt) {
      context.addIssue({
        code: "custom",
        message: "Running repo scan modules require startedAt.",
        path: ["startedAt"],
      });
    }

    if (TERMINAL_REPO_SCAN_MODULE_STATUSES.has(moduleStatus.status) && !moduleStatus.finishedAt) {
      context.addIssue({
        code: "custom",
        message: "Terminal repo scan modules require finishedAt.",
        path: ["finishedAt"],
      });
    }
  });

export type RepoScanModuleStatus = z.infer<typeof RepoScanModuleStatusSchema>;

const TERMINAL_REPO_SCAN_STATUSES = new Set<RepoScanStatus>(["completed", "failed", "cancelled"]);

const RepoScanShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    scanId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    status: RepoScanStatusSchema,
    statusSummary: NonEmptyStringSchema,
    moduleStatuses: z.array(RepoScanModuleStatusSchema).default([]),
    inventory: RepoScanInventorySchema,
    findingIds: z.array(NonEmptyStringSchema),
    taskRecommendationIds: z.array(NonEmptyStringSchema),
    readinessReportId: NonEmptyStringSchema.optional(),
    failureSummary: NonEmptyStringSchema.optional(),
    createdAt: NonEmptyStringSchema,
    startedAt: NonEmptyStringSchema.optional(),
    finishedAt: NonEmptyStringSchema.optional(),
    updatedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((scan, context) => {
    if (scan.status === "running" && !scan.startedAt) {
      context.addIssue({
        code: "custom",
        message: "Running repo scans require startedAt.",
        path: ["startedAt"],
      });
    }

    if (TERMINAL_REPO_SCAN_STATUSES.has(scan.status) && !scan.finishedAt) {
      context.addIssue({
        code: "custom",
        message: "Terminal repo scans require finishedAt.",
        path: ["finishedAt"],
      });
    }

    if (scan.status === "completed" && !scan.readinessReportId) {
      context.addIssue({
        code: "custom",
        message: "Completed repo scans require readinessReportId.",
        path: ["readinessReportId"],
      });
    }

    if (scan.status === "failed" && !scan.failureSummary) {
      context.addIssue({
        code: "custom",
        message: "Failed repo scans require failureSummary.",
        path: ["failureSummary"],
      });
    }
  });

export const RepoScanSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(payload, context, "Repo scan cannot include unsafe text values.");
    addUnsafeRepoScanTextIssues(payload, context);
  })
  .pipe(RepoScanShapeSchema);

export type RepoScan = z.infer<typeof RepoScanSchema>;
