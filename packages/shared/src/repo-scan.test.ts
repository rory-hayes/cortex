import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "./version.js";

const DOCUMENTED_REPO_SCAN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

const DOCUMENTED_REPO_SCAN_MODULE_STATUSES = [
  "queued",
  "running",
  "passed",
  "warning",
  "blocked",
  "failed",
  "skipped",
] as const;

const UNSAFE_REPO_SCAN_KEYS = [
  "sourceCode",
  "fileContent",
  "rawOutput",
  "diff",
  "patch",
  "snippet",
  "secret",
  "command",
  "paths",
  "filePaths",
  "localPath",
] as const;

const UNSAFE_REPO_SCAN_DOCUMENT_SUMMARY_KEYS = [
  "content",
  "source",
  "rawOutput",
  "diff",
  "patch",
  "snippet",
  "secret",
  "token",
] as const;

const UNSAFE_REPO_SCAN_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw output: private scan output",
  "https://runner:secret@example.test/repo.git",
  "DATABASE_PASSWORD=unsafe-scan-password",
  "$DATABASE_PASSWORD",
] as const;

const UNSAFE_REPO_SCAN_MODULE_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw output: private scan output",
  "https://runner:secret@example.test/repo.git",
  "DATABASE_PASSWORD=unsafe-scan-password",
  "/Users/rory/private/repo/src/app.ts",
] as const;

const UNSAFE_REPO_SCAN_DOCUMENT_SUMMARY_VALUES = [
  "```ts\nconst leakedSource = true;\n```",
  "diff --git a/src/private.ts b/src/private.ts",
  "@@ -1,2 +1,2 @@",
  "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
  "DATABASE_PASSWORD=unsafe-scan-password",
  "fetch https://deploy-user:deploy-pass@example.test/repo.git",
  "raw output: private provider response",
] as const;

type RepoScanStatus = (typeof DOCUMENTED_REPO_SCAN_STATUSES)[number];
type RepoScanModuleStatusValue = (typeof DOCUMENTED_REPO_SCAN_MODULE_STATUSES)[number];

type RepoScanLanguageSummary = {
  name: string;
  fileCount: number;
};

type RepoScanDocumentationSummary = {
  kind: string;
  present: boolean;
  pathCount: number;
};

type RepoScanPolicySummary = {
  hasPolicyFile: boolean;
  protectedPathCount: number;
  sensitivePathCount: number;
  validationCommandCount: number;
  dryRunCheckCount: number;
};

type RepoScanAgentInstructionSummary = {
  hasAgentInstructions: boolean;
  instructionFileCount: number;
  readStatus: "missing" | "read" | "unreadable" | "oversized" | "unknown_size";
  completenessStatus: "missing" | "complete" | "incomplete" | "conflicting" | "unknown";
  missingSectionLabels: string[];
};

type RepoScanBacklogSummary = {
  hasBacklog: boolean;
  backlogFileCount: number;
  readStatus: "missing" | "read" | "unreadable" | "oversized" | "unknown_size";
  structureStatus: "missing" | "complete" | "weak" | "unknown";
  missingStructureLabels: string[];
};

type RepoScanBacklogQualitySummary = {
  hasBacklog: boolean;
  backlogFileCount: number;
  readStatus: "missing" | "read" | "unreadable" | "oversized" | "unknown_size";
  structureStatus: "missing" | "weak" | "ai_executable" | "unknown";
  signalLabels: string[];
  missingSignalLabels: string[];
};

type RepoScanValidationPostureSummary = {
  postureStatus: "missing" | "partial" | "ready" | "unknown";
  hasPolicyFile: boolean;
  validationCommandCount: number;
  dryRunCheckCount: number;
  detectedCommandLabels: string[];
  missingCommandLabels: string[];
  suggestedCommandLabels: string[];
};

type RepoScanCiPostureSummary = {
  postureStatus: "missing" | "partial" | "aligned" | "unknown";
  hasCi: boolean;
  providerLabels: string[];
  workflowFileCount: number;
  detectedCommandLabels: string[];
  missingCommandLabels: string[];
  requiredCommandLabels: string[];
};

type RepoScanProductClaritySummary = {
  hasProductDocs: boolean;
  productDocCount: number;
  readStatus: "missing" | "read" | "unreadable" | "oversized" | "unknown_size";
  clarityStatus: "missing" | "weak" | "sufficient" | "unknown";
  signalLabels: string[];
  missingSignalLabels: string[];
  goalContextStatus: "not_provided" | "provided";
  goalContextSummary?: string;
};

type RepoScanRepoHygieneSummary = {
  hygieneStatus: "unknown" | "healthy" | "minor_gaps" | "needs_attention";
  issueLabels: (
    | "missing_contribution_docs"
    | "missing_gitignore"
    | "missing_issue_templates"
    | "missing_js_lockfile"
    | "mixed_lockfiles"
    | "unclear_monorepo_structure"
  )[];
  packageManagerStatus: "unknown" | "none" | "single" | "manifest_without_lockfile" | "mixed";
  packageManagerCount: number;
  jsLockfileCount: number;
  hasRootGitignore: boolean;
  hasContributionDocs: boolean;
  contributionDocCount: number;
  issueTemplateCount: number;
  monorepoStructureStatus: "unknown" | "single_project" | "configured" | "unclear";
  monorepoSignalCount: number;
  workspaceConfigCount: number;
};

type RepoScanDocumentSummary = {
  kind:
    | "agent_instructions"
    | "code_of_conduct"
    | "contributing"
    | "mvp_plan"
    | "product"
    | "product_spec"
    | "readme"
    | "security";
  label: string;
  topicLabels: (
    | "agent_rules"
    | "architecture"
    | "backlog"
    | "execution_flow"
    | "product_scope"
    | "security"
    | "setup"
    | "validation"
    | "workflow"
  )[];
  summary: string;
  redactionApplied: boolean;
  documentByteCount: number;
  inputCharacterCount: number;
  redactedCharacterCount: number;
};

type RepoScanInventory = {
  totalFileCount: number;
  scannedFileCount: number;
  omittedFileCount: number;
  totalDirectoryCount: number;
  languageSummaries: RepoScanLanguageSummary[];
  packageManagerLabels: string[];
  ciProviderLabels: string[];
  documentationSummaries: RepoScanDocumentationSummary[];
  policySummary: RepoScanPolicySummary;
  agentInstructionSummary: RepoScanAgentInstructionSummary;
  backlogSummary: RepoScanBacklogSummary;
  backlogQualitySummary: RepoScanBacklogQualitySummary;
  validationPostureSummary: RepoScanValidationPostureSummary;
  ciPostureSummary: RepoScanCiPostureSummary;
  productClaritySummary: RepoScanProductClaritySummary;
  repoHygieneSummary: RepoScanRepoHygieneSummary;
  documentSummaries: RepoScanDocumentSummary[];
};

type RepoScanModuleStatus = {
  id: string;
  label: string;
  metadata: Record<string, unknown>;
  order: number;
  required: boolean;
  status: RepoScanModuleStatusValue;
  summary: string;
  startedAt?: string;
  finishedAt?: string;
};

type RepoScan = {
  contractVersion: typeof CONTRACT_VERSION;
  scanId: string;
  workspaceId: string;
  repoId: string;
  status: RepoScanStatus;
  statusSummary: string;
  moduleStatuses?: RepoScanModuleStatus[];
  inventory: RepoScanInventory;
  findingIds: string[];
  taskRecommendationIds: string[];
  readinessReportId?: string;
  failureSummary?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
};

type ZodIssueSummary = {
  path: PropertyKey[];
  message: string;
};

type SchemaLike = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: ZodIssueSummary[];
        };
      };
};

type RepoScanModule = {
  REPO_SCAN_STATUSES: readonly RepoScanStatus[];
  RepoScanStatusSchema: SchemaLike;
  RepoScanLanguageSummarySchema: SchemaLike;
  RepoScanDocumentationSummarySchema: SchemaLike;
  RepoScanAgentInstructionSummarySchema: SchemaLike;
  RepoScanBacklogQualitySignalLabelSchema: SchemaLike;
  RepoScanBacklogQualityStructureStatusSchema: SchemaLike;
  RepoScanBacklogQualitySummarySchema: SchemaLike;
  RepoScanBacklogReadStatusSchema: SchemaLike;
  RepoScanBacklogStructureStatusSchema: SchemaLike;
  RepoScanBacklogSummarySchema: SchemaLike;
  REPO_SCAN_BACKLOG_QUALITY_SIGNAL_LABELS: readonly string[];
  REPO_SCAN_VALIDATION_COMMAND_LABELS: readonly string[];
  REPO_SCAN_VALIDATION_POSTURE_STATUSES: readonly string[];
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY: RepoScanCiPostureSummary;
  REPO_SCAN_CI_POSTURE_STATUSES: readonly RepoScanCiPostureSummary["postureStatus"][];
  RepoScanCiPostureStatusSchema: SchemaLike;
  RepoScanCiPostureSummarySchema: SchemaLike;
  RepoScanValidationCommandLabelSchema: SchemaLike;
  RepoScanValidationPostureStatusSchema: SchemaLike;
  RepoScanValidationPostureSummarySchema: SchemaLike;
  RepoScanPolicySummarySchema: SchemaLike;
  RepoScanProductClaritySummarySchema: SchemaLike;
  REPO_SCAN_DOCUMENT_SUMMARY_KINDS: readonly RepoScanDocumentSummary["kind"][];
  REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS: readonly RepoScanDocumentSummary["topicLabels"][number][];
  RepoScanDocumentSummaryKindSchema: SchemaLike;
  RepoScanDocumentSummaryTopicLabelSchema: SchemaLike;
  RepoScanDocumentSummarySchema: SchemaLike;
  REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS: readonly RepoScanRepoHygieneSummary["issueLabels"][number][];
  REPO_SCAN_REPO_HYGIENE_STATUSES: readonly RepoScanRepoHygieneSummary["hygieneStatus"][];
  REPO_SCAN_REPO_HYGIENE_PACKAGE_MANAGER_STATUSES: readonly RepoScanRepoHygieneSummary["packageManagerStatus"][];
  REPO_SCAN_REPO_HYGIENE_MONOREPO_STRUCTURE_STATUSES: readonly RepoScanRepoHygieneSummary["monorepoStructureStatus"][];
  RepoScanRepoHygieneIssueLabelSchema: SchemaLike;
  RepoScanRepoHygieneStatusSchema: SchemaLike;
  RepoScanRepoHygienePackageManagerStatusSchema: SchemaLike;
  RepoScanRepoHygieneMonorepoStructureStatusSchema: SchemaLike;
  RepoScanRepoHygieneSummarySchema: SchemaLike;
  RepoScanInventorySchema: SchemaLike;
  REPO_SCAN_MODULE_STATUSES: readonly RepoScanModuleStatusValue[];
  RepoScanModuleStatusSchema: SchemaLike;
  RepoScanSchema: SchemaLike;
};

const loadRepoScanModule = async () => (await import("./repo-scan.js")) as RepoScanModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RepoScanModule>;

const validInventory = (overrides: Partial<RepoScanInventory> = {}): RepoScanInventory => ({
  totalFileCount: 48,
  scannedFileCount: 44,
  omittedFileCount: 4,
  totalDirectoryCount: 12,
  languageSummaries: [
    {
      name: "TypeScript",
      fileCount: 36,
    },
    {
      name: "Markdown",
      fileCount: 8,
    },
  ],
  packageManagerLabels: ["pnpm"],
  ciProviderLabels: ["GitHub Actions"],
  documentationSummaries: [
    {
      kind: "readme",
      present: true,
      pathCount: 1,
    },
    {
      kind: "architecture",
      present: true,
      pathCount: 2,
    },
    {
      kind: "contributing",
      present: false,
      pathCount: 0,
    },
  ],
  documentSummaries: [
    {
      documentByteCount: 512,
      inputCharacterCount: 420,
      kind: "readme",
      label: "README",
      redactedCharacterCount: 420,
      redactionApplied: false,
      summary: "README indicates product scope, setup, validation, and workflow context.",
      topicLabels: ["product_scope", "setup", "validation", "workflow"],
    },
  ],
  policySummary: {
    hasPolicyFile: true,
    protectedPathCount: 3,
    sensitivePathCount: 2,
    validationCommandCount: 4,
    dryRunCheckCount: 11,
  },
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogSummary: {
    backlogFileCount: 1,
    hasBacklog: true,
    missingStructureLabels: [],
    readStatus: "read",
    structureStatus: "complete",
  },
  backlogQualitySummary: {
    backlogFileCount: 1,
    hasBacklog: true,
    missingSignalLabels: [],
    readStatus: "read",
    signalLabels: [
      "acceptance criteria",
      "dependencies",
      "file-touch hints",
      "priority or milestone",
      "security notes",
      "status markers",
      "task ids",
      "validation",
    ],
    structureStatus: "ai_executable",
  },
  validationPostureSummary: {
    detectedCommandLabels: ["format", "lint", "test", "typecheck"],
    dryRunCheckCount: 11,
    hasPolicyFile: true,
    missingCommandLabels: [],
    postureStatus: "ready",
    suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
    validationCommandCount: 4,
  },
  ciPostureSummary: {
    detectedCommandLabels: ["test", "typecheck"],
    hasCi: true,
    missingCommandLabels: [],
    postureStatus: "aligned",
    providerLabels: ["GitHub Actions"],
    requiredCommandLabels: ["test", "typecheck"],
    workflowFileCount: 1,
  },
  productClaritySummary: {
    clarityStatus: "sufficient",
    goalContextStatus: "not_provided",
    hasProductDocs: true,
    missingSignalLabels: [],
    productDocCount: 1,
    readStatus: "read",
    signalLabels: ["purpose", "target_user", "problem", "scope", "success_criteria"],
  },
  repoHygieneSummary: {
    contributionDocCount: 1,
    hasContributionDocs: true,
    hasRootGitignore: true,
    hygieneStatus: "healthy",
    issueLabels: [],
    issueTemplateCount: 1,
    jsLockfileCount: 1,
    monorepoSignalCount: 0,
    monorepoStructureStatus: "single_project",
    packageManagerCount: 1,
    packageManagerStatus: "single",
    workspaceConfigCount: 0,
  },
  ...overrides,
});

const validScan = (overrides: Partial<RepoScan> = {}): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  scanId: "repo-scan-001",
  workspaceId: "workspace-001",
  repoId: "repo-001",
  status: "completed",
  statusSummary: "Repository scan completed with metadata-only inventory summaries.",
  moduleStatuses: [
    {
      id: "github_inventory",
      label: "GitHub inventory",
      metadata: {
        ciProviderCount: 1,
        packageManagerCount: 1,
      },
      order: 0,
      required: true,
      status: "passed",
      summary: "Metadata-only GitHub inventory completed.",
      startedAt: "2026-05-25T12:01:00.000Z",
      finishedAt: "2026-05-25T12:01:30.000Z",
    },
  ],
  inventory: validInventory(),
  findingIds: ["finding-validation-001", "finding-security-001"],
  taskRecommendationIds: ["task-recommendation-validation-001"],
  readinessReportId: "readiness-report-001",
  createdAt: "2026-05-25T12:00:00.000Z",
  startedAt: "2026-05-25T12:01:00.000Z",
  finishedAt: "2026-05-25T12:02:00.000Z",
  updatedAt: "2026-05-25T12:02:00.000Z",
  ...overrides,
});

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

describe("RepoScan", () => {
  it("exports documented scan statuses in canonical order", async () => {
    const { REPO_SCAN_STATUSES, RepoScanStatusSchema } = await loadRepoScanModule();

    expect(REPO_SCAN_STATUSES).toEqual(DOCUMENTED_REPO_SCAN_STATUSES);
    for (const status of DOCUMENTED_REPO_SCAN_STATUSES) {
      expect(RepoScanStatusSchema.safeParse(status).success).toBe(true);
    }

    expect(RepoScanStatusSchema.safeParse("dry_run_running").success).toBe(false);
    expect(RepoScanStatusSchema.safeParse("blocked").success).toBe(false);
  });

  it("validates a completed metadata-only repo scan", async () => {
    const { RepoScanSchema } = await loadRepoScanModule();

    expect(RepoScanSchema.safeParse(validScan()).success).toBe(true);
  });

  it("defaults old repo scan payloads to an empty module status list", async () => {
    const { RepoScanSchema } = await loadRepoScanModule();
    const legacyScan: Record<string, unknown> = validScan();
    delete legacyScan.moduleStatuses;
    delete (legacyScan.inventory as Partial<RepoScanInventory>).agentInstructionSummary;

    const result = RepoScanSchema.safeParse(legacyScan);

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as RepoScan).moduleStatuses).toEqual([]);
      expect((result.data as RepoScan).inventory.agentInstructionSummary).toEqual({
        completenessStatus: "missing",
        hasAgentInstructions: false,
        instructionFileCount: 0,
        missingSectionLabels: ["agent instructions"],
        readStatus: "missing",
      });
    }
  });

  it("defaults old repo scan inventory payloads to missing product clarity metadata", async () => {
    const { RepoScanInventorySchema, RepoScanSchema } = await loadRepoScanModule();
    const legacyInventory: Record<string, unknown> = validInventory();
    delete legacyInventory.productClaritySummary;

    const inventoryResult = RepoScanInventorySchema.safeParse(legacyInventory);
    expect(inventoryResult.success).toBe(true);
    if (inventoryResult.success) {
      expect((inventoryResult.data as RepoScanInventory).productClaritySummary).toEqual({
        clarityStatus: "missing",
        goalContextStatus: "not_provided",
        hasProductDocs: false,
        missingSignalLabels: [],
        productDocCount: 0,
        readStatus: "missing",
        signalLabels: [],
      });
    }

    const scanResult = RepoScanSchema.safeParse(
      validScan({ inventory: legacyInventory as RepoScanInventory }),
    );
    expect(scanResult.success).toBe(true);
    if (scanResult.success) {
      expect((scanResult.data as RepoScan).inventory.productClaritySummary).toEqual({
        clarityStatus: "missing",
        goalContextStatus: "not_provided",
        hasProductDocs: false,
        missingSignalLabels: [],
        productDocCount: 0,
        readStatus: "missing",
        signalLabels: [],
      });
    }
  });

  it("defaults old repo scan inventory payloads to missing backlog metadata", async () => {
    const { RepoScanInventorySchema, RepoScanSchema } = await loadRepoScanModule();
    const legacyInventory: Record<string, unknown> = validInventory();
    delete legacyInventory.backlogSummary;
    delete legacyInventory.backlogQualitySummary;

    const inventoryResult = RepoScanInventorySchema.safeParse(legacyInventory);
    expect(inventoryResult.success).toBe(true);
    if (inventoryResult.success) {
      expect((inventoryResult.data as RepoScanInventory).backlogSummary).toEqual({
        backlogFileCount: 0,
        hasBacklog: false,
        missingStructureLabels: ["backlog"],
        readStatus: "missing",
        structureStatus: "missing",
      });
      expect((inventoryResult.data as RepoScanInventory).backlogQualitySummary).toEqual({
        backlogFileCount: 0,
        hasBacklog: false,
        missingSignalLabels: ["backlog"],
        readStatus: "missing",
        signalLabels: [],
        structureStatus: "missing",
      });
    }

    const scanResult = RepoScanSchema.safeParse(
      validScan({ inventory: legacyInventory as RepoScanInventory }),
    );
    expect(scanResult.success).toBe(true);
    if (scanResult.success) {
      expect((scanResult.data as RepoScan).inventory.backlogQualitySummary.structureStatus).toBe(
        "missing",
      );
    }
  });

  it("defaults old repo scan inventory payloads to unknown repo hygiene metadata", async () => {
    const { RepoScanInventorySchema, RepoScanSchema } = await loadRepoScanModule();
    const legacyInventory: Record<string, unknown> = validInventory();
    delete legacyInventory.repoHygieneSummary;

    const expectedDefault: RepoScanRepoHygieneSummary = {
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

    const inventoryResult = RepoScanInventorySchema.safeParse(legacyInventory);
    expect(inventoryResult.success).toBe(true);
    if (inventoryResult.success) {
      expect((inventoryResult.data as RepoScanInventory).repoHygieneSummary).toEqual(
        expectedDefault,
      );
    }

    const scanResult = RepoScanSchema.safeParse(
      validScan({ inventory: legacyInventory as RepoScanInventory }),
    );
    expect(scanResult.success).toBe(true);
    if (scanResult.success) {
      expect((scanResult.data as RepoScan).inventory.repoHygieneSummary).toEqual(expectedDefault);
    }
  });

  it("defaults old repo scan inventory payloads to an empty document summary list", async () => {
    const { RepoScanInventorySchema, RepoScanSchema } = await loadRepoScanModule();
    const legacyInventory: Record<string, unknown> = validInventory();
    delete legacyInventory.documentSummaries;

    const inventoryResult = RepoScanInventorySchema.safeParse(legacyInventory);
    expect(inventoryResult.success).toBe(true);
    if (inventoryResult.success) {
      expect((inventoryResult.data as RepoScanInventory).documentSummaries).toEqual([]);
    }

    const scanResult = RepoScanSchema.safeParse(
      validScan({ inventory: legacyInventory as RepoScanInventory }),
    );
    expect(scanResult.success).toBe(true);
    if (scanResult.success) {
      expect((scanResult.data as RepoScan).inventory.documentSummaries).toEqual([]);
    }
  });

  it("defaults old repo scan inventory payloads to missing CI/CD posture metadata", async () => {
    const { RepoScanInventorySchema, RepoScanSchema } = await loadRepoScanModule();
    const legacyInventory: Record<string, unknown> = validInventory();
    delete legacyInventory.ciPostureSummary;

    const expectedDefault: RepoScanCiPostureSummary = {
      detectedCommandLabels: [],
      hasCi: false,
      missingCommandLabels: [],
      postureStatus: "missing",
      providerLabels: [],
      requiredCommandLabels: [],
      workflowFileCount: 0,
    };

    const inventoryResult = RepoScanInventorySchema.safeParse(legacyInventory);
    expect(inventoryResult.success).toBe(true);
    if (inventoryResult.success) {
      expect((inventoryResult.data as RepoScanInventory).ciPostureSummary).toEqual(expectedDefault);
    }

    const scanResult = RepoScanSchema.safeParse(
      validScan({ inventory: legacyInventory as RepoScanInventory }),
    );
    expect(scanResult.success).toBe(true);
    if (scanResult.success) {
      expect((scanResult.data as RepoScan).inventory.ciPostureSummary).toEqual(expectedDefault);
    }
  });

  it("exports documented module statuses in canonical order", async () => {
    const { REPO_SCAN_MODULE_STATUSES, RepoScanModuleStatusSchema } = await loadRepoScanModule();

    expect(REPO_SCAN_MODULE_STATUSES).toEqual(DOCUMENTED_REPO_SCAN_MODULE_STATUSES);
    for (const status of DOCUMENTED_REPO_SCAN_MODULE_STATUSES) {
      expect(
        RepoScanModuleStatusSchema.safeParse({
          id: `module_${status}`,
          label: `Module ${status}`,
          metadata: {},
          order: 0,
          required: true,
          status,
          summary: `Module ${status} status.`,
          ...(status === "running" ? { startedAt: "2026-05-25T12:01:00.000Z" } : {}),
          ...(["passed", "warning", "blocked", "failed", "skipped"].includes(status)
            ? { finishedAt: "2026-05-25T12:02:00.000Z" }
            : {}),
        }).success,
      ).toBe(true);
    }

    expect(RepoScanModuleStatusSchema.safeParse({ status: "completed" }).success).toBe(false);
  });

  it("enforces module timestamp rules", async () => {
    const { RepoScanModuleStatusSchema } = await loadRepoScanModule();
    const baseStatus: Omit<RepoScanModuleStatus, "status"> = {
      id: "github_inventory",
      label: "GitHub inventory",
      metadata: {},
      order: 0,
      required: true,
      summary: "Metadata-only inventory module status.",
    };

    expect(
      RepoScanModuleStatusSchema.safeParse({
        ...baseStatus,
        status: "running",
      }).success,
    ).toBe(false);
    expect(
      RepoScanModuleStatusSchema.safeParse({
        ...baseStatus,
        startedAt: "2026-05-25T12:01:00.000Z",
        status: "running",
      }).success,
    ).toBe(true);

    for (const status of ["passed", "warning", "blocked", "failed", "skipped"] as const) {
      expect(
        RepoScanModuleStatusSchema.safeParse({
          ...baseStatus,
          status,
        }).success,
        `Expected ${status} to require finishedAt.`,
      ).toBe(false);
      expect(
        RepoScanModuleStatusSchema.safeParse({
          ...baseStatus,
          finishedAt: "2026-05-25T12:02:00.000Z",
          status,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects unsafe module payload keys and text values", async () => {
    const { RepoScanModuleStatusSchema, RepoScanSchema } = await loadRepoScanModule();
    const safeModuleStatus: RepoScanModuleStatus = {
      id: "github_inventory",
      label: "GitHub inventory",
      metadata: {},
      order: 0,
      required: true,
      status: "passed",
      summary: "Metadata-only inventory completed.",
      finishedAt: "2026-05-25T12:02:00.000Z",
    };

    for (const key of UNSAFE_REPO_SCAN_KEYS) {
      const result = RepoScanModuleStatusSchema.safeParse({
        ...safeModuleStatus,
        metadata: {
          nested: {
            [key]: "placeholder value",
          },
        },
      });

      expect(result.success, `Expected unsafe module key ${key} to be rejected.`).toBe(false);
    }

    for (const unsafeValue of UNSAFE_REPO_SCAN_MODULE_VALUES) {
      expect(
        RepoScanModuleStatusSchema.safeParse({
          ...safeModuleStatus,
          summary: unsafeValue,
        }).success,
        `Expected unsafe module summary value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        RepoScanSchema.safeParse(
          validScan({
            moduleStatuses: [
              {
                ...safeModuleStatus,
                metadata: {
                  note: unsafeValue,
                },
              },
            ],
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("keeps inventory summaries count and label based", async () => {
    const {
      RepoScanDocumentationSummarySchema,
      RepoScanDocumentSummarySchema,
      RepoScanInventorySchema,
      RepoScanLanguageSummarySchema,
      RepoScanPolicySummarySchema,
      RepoScanAgentInstructionSummarySchema,
      RepoScanBacklogQualitySummarySchema,
      RepoScanBacklogSummarySchema,
      RepoScanProductClaritySummarySchema,
      RepoScanRepoHygieneSummarySchema,
    } = await loadRepoScanModule();
    const inventory = validInventory();

    expect(RepoScanInventorySchema.safeParse(inventory).success).toBe(true);
    expect(RepoScanLanguageSummarySchema.safeParse(inventory.languageSummaries[0]).success).toBe(
      true,
    );
    expect(
      RepoScanDocumentationSummarySchema.safeParse(inventory.documentationSummaries[0]).success,
    ).toBe(true);
    expect(RepoScanPolicySummarySchema.safeParse(inventory.policySummary).success).toBe(true);
    expect(
      RepoScanAgentInstructionSummarySchema.safeParse(inventory.agentInstructionSummary).success,
    ).toBe(true);
    expect(RepoScanBacklogSummarySchema.safeParse(inventory.backlogSummary).success).toBe(true);
    expect(
      RepoScanBacklogQualitySummarySchema.safeParse(inventory.backlogQualitySummary).success,
    ).toBe(true);
    expect(
      RepoScanProductClaritySummarySchema.safeParse(inventory.productClaritySummary).success,
    ).toBe(true);
    expect(RepoScanRepoHygieneSummarySchema.safeParse(inventory.repoHygieneSummary).success).toBe(
      true,
    );
    expect(RepoScanDocumentSummarySchema.safeParse(inventory.documentSummaries[0]).success).toBe(
      true,
    );

    expect(
      RepoScanInventorySchema.safeParse({
        ...inventory,
        paths: ["src/index.ts"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanLanguageSummarySchema.safeParse({
        name: "TypeScript",
        fileCount: 12,
        filePaths: ["src/index.ts"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanAgentInstructionSummarySchema.safeParse({
        ...inventory.agentInstructionSummary,
        content: "Do not return raw instruction content.",
      }).success,
    ).toBe(false);
    expect(
      RepoScanBacklogQualitySummarySchema.safeParse({
        ...inventory.backlogQualitySummary,
        content: "Do not return raw backlog content.",
      }).success,
    ).toBe(false);
    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        ...inventory.productClaritySummary,
        rawProductText: "This should never be serialized.",
      }).success,
    ).toBe(false);
    expect(
      RepoScanRepoHygieneSummarySchema.safeParse({
        ...inventory.repoHygieneSummary,
        filePaths: [".gitignore", ".github/ISSUE_TEMPLATE/bug.yml"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanRepoHygieneSummarySchema.safeParse({
        ...inventory.repoHygieneSummary,
        issueLabels: ["missing_gitignore", "src/index.ts"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanDocumentSummarySchema.safeParse({
        ...inventory.documentSummaries[0],
        sourcePath: "README.md",
      }).success,
    ).toBe(false);
  });

  it("keeps document summaries to fixed kinds, labels, safe summaries, and count metadata", async () => {
    const {
      REPO_SCAN_DOCUMENT_SUMMARY_KINDS,
      REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS,
      RepoScanDocumentSummaryKindSchema,
      RepoScanDocumentSummarySchema,
      RepoScanDocumentSummaryTopicLabelSchema,
      RepoScanInventorySchema,
    } = await loadRepoScanModule();

    expect(REPO_SCAN_DOCUMENT_SUMMARY_KINDS).toEqual([
      "agent_instructions",
      "code_of_conduct",
      "contributing",
      "mvp_plan",
      "product",
      "product_spec",
      "readme",
      "security",
    ]);
    expect(REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS).toEqual([
      "agent_rules",
      "architecture",
      "backlog",
      "execution_flow",
      "product_scope",
      "security",
      "setup",
      "validation",
      "workflow",
    ]);

    for (const kind of REPO_SCAN_DOCUMENT_SUMMARY_KINDS) {
      expect(RepoScanDocumentSummaryKindSchema.safeParse(kind).success).toBe(true);
    }
    for (const topicLabel of REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS) {
      expect(RepoScanDocumentSummaryTopicLabelSchema.safeParse(topicLabel).success).toBe(true);
    }

    const summary: RepoScanDocumentSummary = {
      documentByteCount: 1_280,
      inputCharacterCount: 1_200,
      kind: "product_spec",
      label: "Product spec",
      redactedCharacterCount: 1_160,
      redactionApplied: true,
      summary:
        "Product spec indicates product scope, workflow, validation, security, and execution flow context.",
      topicLabels: ["product_scope", "workflow", "validation", "security", "execution_flow"],
    };

    expect(RepoScanDocumentSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      RepoScanInventorySchema.safeParse({
        ...validInventory(),
        documentSummaries: [summary],
      }).success,
    ).toBe(true);

    expect(
      RepoScanDocumentSummarySchema.safeParse({
        ...summary,
        kind: "architecture",
      }).success,
    ).toBe(false);
    expect(
      RepoScanDocumentSummarySchema.safeParse({
        ...summary,
        topicLabels: ["product_scope", "raw output"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanDocumentSummarySchema.safeParse({
        ...summary,
        summary: "A".repeat(481),
      }).success,
    ).toBe(false);
    expect(
      RepoScanDocumentSummarySchema.safeParse({
        ...summary,
        inputCharacterCount: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe document summary keys and text values", async () => {
    const { RepoScanDocumentSummarySchema, RepoScanInventorySchema } = await loadRepoScanModule();
    const safeSummary: RepoScanDocumentSummary = {
      documentByteCount: 512,
      inputCharacterCount: 420,
      kind: "security",
      label: "Security",
      redactedCharacterCount: 400,
      redactionApplied: true,
      summary: "Security document indicates security, validation, and workflow context.",
      topicLabels: ["security", "validation", "workflow"],
    };

    for (const key of UNSAFE_REPO_SCAN_DOCUMENT_SUMMARY_KEYS) {
      expect(
        RepoScanDocumentSummarySchema.safeParse({
          ...safeSummary,
          [key]: "placeholder value",
        }).success,
        `Expected unsafe document summary key ${key} to be rejected.`,
      ).toBe(false);
      expect(
        RepoScanInventorySchema.safeParse({
          ...validInventory(),
          documentSummaries: [
            {
              ...safeSummary,
              [key]: "placeholder value",
            },
          ],
        }).success,
      ).toBe(false);
    }

    for (const unsafeValue of UNSAFE_REPO_SCAN_DOCUMENT_SUMMARY_VALUES) {
      expect(
        RepoScanDocumentSummarySchema.safeParse({
          ...safeSummary,
          summary: unsafeValue,
        }).success,
        `Expected unsafe document summary text to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        RepoScanInventorySchema.safeParse({
          ...validInventory(),
          documentSummaries: [
            {
              ...safeSummary,
              label: unsafeValue,
            },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it("keeps repo hygiene summaries to fixed statuses, counts, and issue labels", async () => {
    const {
      REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS,
      REPO_SCAN_REPO_HYGIENE_MONOREPO_STRUCTURE_STATUSES,
      REPO_SCAN_REPO_HYGIENE_PACKAGE_MANAGER_STATUSES,
      REPO_SCAN_REPO_HYGIENE_STATUSES,
      RepoScanRepoHygieneIssueLabelSchema,
      RepoScanRepoHygieneMonorepoStructureStatusSchema,
      RepoScanRepoHygienePackageManagerStatusSchema,
      RepoScanRepoHygieneStatusSchema,
      RepoScanRepoHygieneSummarySchema,
    } = await loadRepoScanModule();

    expect(REPO_SCAN_REPO_HYGIENE_STATUSES).toEqual([
      "unknown",
      "healthy",
      "minor_gaps",
      "needs_attention",
    ]);
    expect(REPO_SCAN_REPO_HYGIENE_PACKAGE_MANAGER_STATUSES).toEqual([
      "unknown",
      "none",
      "single",
      "manifest_without_lockfile",
      "mixed",
    ]);
    expect(REPO_SCAN_REPO_HYGIENE_MONOREPO_STRUCTURE_STATUSES).toEqual([
      "unknown",
      "single_project",
      "configured",
      "unclear",
    ]);
    expect(REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS).toEqual([
      "mixed_lockfiles",
      "unclear_monorepo_structure",
      "missing_js_lockfile",
      "missing_gitignore",
      "missing_contribution_docs",
      "missing_issue_templates",
    ]);

    for (const status of REPO_SCAN_REPO_HYGIENE_STATUSES) {
      expect(RepoScanRepoHygieneStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of REPO_SCAN_REPO_HYGIENE_PACKAGE_MANAGER_STATUSES) {
      expect(RepoScanRepoHygienePackageManagerStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of REPO_SCAN_REPO_HYGIENE_MONOREPO_STRUCTURE_STATUSES) {
      expect(RepoScanRepoHygieneMonorepoStructureStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const label of REPO_SCAN_REPO_HYGIENE_ISSUE_LABELS) {
      expect(RepoScanRepoHygieneIssueLabelSchema.safeParse(label).success).toBe(true);
    }

    expect(
      RepoScanRepoHygieneSummarySchema.safeParse({
        contributionDocCount: 0,
        hasContributionDocs: false,
        hasRootGitignore: false,
        hygieneStatus: "needs_attention",
        issueLabels: ["mixed_lockfiles", "missing_gitignore"],
        issueTemplateCount: 0,
        jsLockfileCount: 2,
        monorepoSignalCount: 2,
        monorepoStructureStatus: "unclear",
        packageManagerCount: 2,
        packageManagerStatus: "mixed",
        workspaceConfigCount: 0,
      }).success,
    ).toBe(true);
    expect(
      RepoScanRepoHygieneSummarySchema.safeParse({
        ...validInventory().repoHygieneSummary,
        hygieneStatus: "critical",
      }).success,
    ).toBe(false);
    expect(
      RepoScanRepoHygieneSummarySchema.safeParse({
        ...validInventory().repoHygieneSummary,
        issueLabels: ["missing_gitignore", "raw output: not allowed"],
      }).success,
    ).toBe(false);
  });

  it("keeps backlog quality summaries to fixed statuses, counts, and labels", async () => {
    const {
      REPO_SCAN_BACKLOG_QUALITY_SIGNAL_LABELS,
      RepoScanBacklogQualitySignalLabelSchema,
      RepoScanBacklogQualityStructureStatusSchema,
      RepoScanBacklogQualitySummarySchema,
      RepoScanBacklogReadStatusSchema,
      RepoScanBacklogStructureStatusSchema,
      RepoScanBacklogSummarySchema,
    } = await loadRepoScanModule();

    expect(REPO_SCAN_BACKLOG_QUALITY_SIGNAL_LABELS).toEqual([
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
    ]);
    for (const status of ["missing", "read", "unreadable", "oversized", "unknown_size"]) {
      expect(RepoScanBacklogReadStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of ["missing", "complete", "weak", "unknown"]) {
      expect(RepoScanBacklogStructureStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of ["missing", "weak", "ai_executable", "unknown"]) {
      expect(RepoScanBacklogQualityStructureStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const label of REPO_SCAN_BACKLOG_QUALITY_SIGNAL_LABELS) {
      expect(RepoScanBacklogQualitySignalLabelSchema.safeParse(label).success).toBe(true);
    }

    expect(
      RepoScanBacklogSummarySchema.safeParse({
        backlogFileCount: 1,
        hasBacklog: true,
        missingStructureLabels: ["execution metadata"],
        readStatus: "read",
        structureStatus: "weak",
      }).success,
    ).toBe(true);
    expect(
      RepoScanBacklogQualitySummarySchema.safeParse({
        backlogFileCount: 1,
        hasBacklog: true,
        missingSignalLabels: ["validation"],
        readStatus: "read",
        signalLabels: ["task ids", "status markers"],
        structureStatus: "weak",
      }).success,
    ).toBe(true);
    expect(
      RepoScanBacklogQualitySummarySchema.safeParse({
        ...validInventory().backlogQualitySummary,
        signalLabels: ["task ids", "diff --git a/src/app.ts b/src/app.ts"],
      }).success,
    ).toBe(false);
  });

  it("keeps validation posture summaries to fixed statuses, counts, and labels", async () => {
    const {
      REPO_SCAN_VALIDATION_COMMAND_LABELS,
      REPO_SCAN_VALIDATION_POSTURE_STATUSES,
      RepoScanValidationCommandLabelSchema,
      RepoScanValidationPostureStatusSchema,
      RepoScanValidationPostureSummarySchema,
    } = await loadRepoScanModule();

    expect(REPO_SCAN_VALIDATION_POSTURE_STATUSES).toEqual([
      "missing",
      "partial",
      "ready",
      "unknown",
    ]);
    expect(REPO_SCAN_VALIDATION_COMMAND_LABELS).toEqual([
      "build",
      "format",
      "lint",
      "test",
      "typecheck",
    ]);
    for (const status of REPO_SCAN_VALIDATION_POSTURE_STATUSES) {
      expect(RepoScanValidationPostureStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const label of REPO_SCAN_VALIDATION_COMMAND_LABELS) {
      expect(RepoScanValidationCommandLabelSchema.safeParse(label).success).toBe(true);
    }

    expect(
      RepoScanValidationPostureSummarySchema.safeParse({
        detectedCommandLabels: ["test", "typecheck"],
        dryRunCheckCount: 2,
        hasPolicyFile: true,
        missingCommandLabels: ["format", "lint"],
        postureStatus: "partial",
        suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
        validationCommandCount: 2,
      }).success,
    ).toBe(true);
    expect(
      RepoScanValidationPostureSummarySchema.safeParse({
        ...validInventory().validationPostureSummary,
        detectedCommandLabels: ["test", "pnpm test && cat src/index.ts"],
      }).success,
    ).toBe(false);
  });

  it("keeps CI/CD posture summaries to fixed statuses, counts, and labels", async () => {
    const {
      DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
      REPO_SCAN_CI_POSTURE_STATUSES,
      RepoScanCiPostureStatusSchema,
      RepoScanCiPostureSummarySchema,
    } = await loadRepoScanModule();

    expect(REPO_SCAN_CI_POSTURE_STATUSES).toEqual(["missing", "partial", "aligned", "unknown"]);
    for (const status of REPO_SCAN_CI_POSTURE_STATUSES) {
      expect(RepoScanCiPostureStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY).toEqual({
      detectedCommandLabels: [],
      hasCi: false,
      missingCommandLabels: [],
      postureStatus: "missing",
      providerLabels: [],
      requiredCommandLabels: [],
      workflowFileCount: 0,
    });

    expect(
      RepoScanCiPostureSummarySchema.safeParse({
        detectedCommandLabels: ["test"],
        hasCi: true,
        missingCommandLabels: ["typecheck"],
        postureStatus: "partial",
        providerLabels: ["GitHub Actions"],
        requiredCommandLabels: ["test", "typecheck"],
        workflowFileCount: 1,
      }).success,
    ).toBe(true);
    expect(
      RepoScanCiPostureSummarySchema.safeParse({
        ...validInventory().ciPostureSummary,
        detectedCommandLabels: ["test", "pnpm test && cat src/index.ts"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanCiPostureSummarySchema.safeParse({
        ...validInventory().ciPostureSummary,
        providerLabels: ["GitHub Actions", "diff --git a/.github/workflows/ci.yml b/ci.yml"],
      }).success,
    ).toBe(false);
  });

  it("keeps product clarity summaries to fixed statuses, counts, and labels", async () => {
    const { RepoScanProductClaritySummarySchema } = await loadRepoScanModule();

    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        clarityStatus: "sufficient",
        goalContextStatus: "not_provided",
        hasProductDocs: true,
        missingSignalLabels: ["non_goals"],
        productDocCount: 2,
        readStatus: "read",
        signalLabels: ["purpose", "target_user", "problem", "scope"],
      }).success,
    ).toBe(true);
    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        clarityStatus: "sufficient",
        goalContextStatus: "provided",
        goalContextSummary: "The repo coordinates safe AI-assisted engineering work.",
        hasProductDocs: true,
        missingSignalLabels: [],
        productDocCount: 2,
        readStatus: "read",
        signalLabels: ["purpose", "target_user", "problem", "scope"],
      }).success,
    ).toBe(true);
    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        clarityStatus: "sufficient",
        goalContextStatus: "provided",
        goalContextSummary: "const leaked = process.env.SECRET;",
        hasProductDocs: true,
        missingSignalLabels: [],
        productDocCount: 2,
        readStatus: "read",
        signalLabels: ["purpose", "target_user", "problem", "scope"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        clarityStatus: "invented",
        goalContextStatus: "not_provided",
        hasProductDocs: true,
        missingSignalLabels: [],
        productDocCount: 1,
        readStatus: "read",
        signalLabels: ["purpose"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        clarityStatus: "sufficient",
        goalContextStatus: "not_provided",
        hasProductDocs: true,
        missingSignalLabels: [],
        productDocCount: 1,
        readStatus: "read",
        signalLabels: ["purpose", "diff --git a/src/app.ts b/src/app.ts"],
      }).success,
    ).toBe(false);
    expect(
      RepoScanProductClaritySummarySchema.safeParse({
        clarityStatus: "sufficient",
        goalContextStatus: "not_provided",
        hasProductDocs: true,
        missingSignalLabels: [],
        productDocCount: 1,
        readStatus: "read",
        signalLabels: ["purpose", "brand_positioning"],
      }).success,
    ).toBe(false);
  });

  it("rejects negative or inconsistent inventory counts", async () => {
    const { RepoScanInventorySchema, RepoScanSchema } = await loadRepoScanModule();

    expect(RepoScanInventorySchema.safeParse(validInventory({ totalFileCount: -1 })).success).toBe(
      false,
    );
    expect(
      RepoScanInventorySchema.safeParse(
        validInventory({
          totalFileCount: 4,
          scannedFileCount: 4,
          omittedFileCount: 1,
        }),
      ).success,
    ).toBe(false);
    expect(
      RepoScanInventorySchema.safeParse(
        validInventory({
          scannedFileCount: 10,
          omittedFileCount: 0,
          languageSummaries: [
            {
              name: "TypeScript",
              fileCount: 11,
            },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      RepoScanInventorySchema.safeParse(
        validInventory({
          documentationSummaries: [
            {
              kind: "readme",
              present: true,
              pathCount: -1,
            },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      RepoScanSchema.safeParse(
        validScan({
          inventory: validInventory({
            policySummary: {
              ...validInventory().policySummary,
              validationCommandCount: -1,
            },
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unsafe payload keys recursively", async () => {
    const { RepoScanSchema } = await loadRepoScanModule();

    for (const key of UNSAFE_REPO_SCAN_KEYS) {
      const result = RepoScanSchema.safeParse({
        ...validScan(),
        inventory: {
          ...validInventory(),
          nested: {
            [key]: "placeholder value",
          },
        },
      });

      expect(result.success, `Expected unsafe scan key ${key} to be rejected.`).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issuePath(issue.path))).toContain(
          `inventory.nested.${key}`,
        );
      }
    }
  });

  it("rejects source-like, raw-log, and secret-like text values across scans", async () => {
    const { RepoScanSchema } = await loadRepoScanModule();

    for (const unsafeValue of UNSAFE_REPO_SCAN_VALUES) {
      expect(
        RepoScanSchema.safeParse(
          validScan({
            statusSummary: unsafeValue,
          }),
        ).success,
        `Expected scan statusSummary value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        RepoScanSchema.safeParse(
          validScan({
            failureSummary: unsafeValue,
            status: "failed",
          }),
        ).success,
        `Expected scan failureSummary value to reject ${unsafeValue}`,
      ).toBe(false);
    }
  });

  it("enforces status timestamp and terminal field rules", async () => {
    const { RepoScanSchema } = await loadRepoScanModule();
    const runningScan: Partial<RepoScan> = {
      ...validScan(),
      status: "running",
      statusSummary: "Repository scan is currently running.",
    };
    delete runningScan.readinessReportId;
    delete runningScan.finishedAt;
    delete runningScan.startedAt;

    const completedScan: Partial<RepoScan> = validScan();
    delete completedScan.readinessReportId;

    const failedScan: Partial<RepoScan> = {
      ...validScan(),
      status: "failed",
      finishedAt: "2026-05-25T12:02:00.000Z",
      statusSummary: "Repository scan failed before report generation.",
    };
    delete failedScan.readinessReportId;
    delete failedScan.failureSummary;

    const failedWithoutFinishedAt: Partial<RepoScan> = {
      ...validScan(),
      status: "failed",
      failureSummary: "Repo metadata provider returned an unavailable status.",
    };
    delete failedWithoutFinishedAt.readinessReportId;
    delete failedWithoutFinishedAt.finishedAt;

    const cancelledScan: Partial<RepoScan> = {
      ...validScan(),
      status: "cancelled",
      finishedAt: "2026-05-25T12:02:00.000Z",
      statusSummary: "Repository scan was cancelled before report generation.",
    };
    delete cancelledScan.readinessReportId;

    expect(RepoScanSchema.safeParse(runningScan).success).toBe(false);
    expect(RepoScanSchema.safeParse(failedWithoutFinishedAt).success).toBe(false);
    expect(RepoScanSchema.safeParse(completedScan).success).toBe(false);
    expect(RepoScanSchema.safeParse(failedScan).success).toBe(false);
    expect(RepoScanSchema.safeParse(cancelledScan).success).toBe(true);
  });

  it("exports the RepoScan contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.REPO_SCAN_STATUSES).toEqual(DOCUMENTED_REPO_SCAN_STATUSES);
    expect(shared.REPO_SCAN_MODULE_STATUSES).toEqual(DOCUMENTED_REPO_SCAN_MODULE_STATUSES);
    expect(shared.RepoScanStatusSchema?.safeParse("completed").success).toBe(true);
    expect(
      shared.RepoScanModuleStatusSchema?.safeParse({
        id: "github_inventory",
        label: "GitHub inventory",
        metadata: {},
        order: 0,
        required: true,
        status: "passed",
        summary: "Metadata-only inventory completed.",
        finishedAt: "2026-05-25T12:02:00.000Z",
      }).success,
    ).toBe(true);
    expect(shared.RepoScanInventorySchema?.safeParse(validInventory()).success).toBe(true);
    expect(shared.RepoScanSchema?.safeParse(validScan()).success).toBe(true);
  });
});
