import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  RepoScanInventorySchema,
  RepoScanSchema,
  type RepoScan,
  type RepoScanInventory,
  type RepoScanModuleStatus,
  type RepoScanStatus,
} from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  inArray,
  schema,
  sql,
  type Database,
  type GitHubRepository,
  type RepoScanRecord,
} from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import { assertSafeWebBoundPayload, hasUnsafePayloadPathText } from "../security/payload-guard";
import { createUsageEventInsert } from "../billing/usage-events";
import type {
  BillingPlanLimitAdminOverride,
  BillingPlanLimitService,
} from "../billing/plan-limits";

type GitHubRepositoryScanRow = Pick<GitHubRepository, "id" | "workspaceId">;
type RepoScanInsert = typeof schema.repoScans.$inferInsert;
type RepoScanUpdate = Partial<
  Pick<
    RepoScanRecord,
    | "failureSummary"
    | "findingIds"
    | "finishedAt"
    | "inventory"
    | "moduleStatuses"
    | "readinessReportId"
    | "startedAt"
    | "status"
    | "statusSummary"
    | "taskRecommendationIds"
    | "updatedAt"
  >
>;

export type CreateRepoScanInput = {
  productGoal?: string;
  repoId: string;
  workspaceId: string;
};

export type TriggerRepoScanInput = {
  productGoal?: string;
  repoId: string;
  workspaceId: string;
};

export type TriggerRepoScanForWebhookReason = "default_branch_push" | "pull_request_merged";

export type TriggerRepoScanForWebhookInput = {
  deliveryId: string;
  githubInstallationId: number | string;
  reason: TriggerRepoScanForWebhookReason;
  repository: {
    id: number | string;
    name: string;
    owner: string;
  };
};

export type TriggeredRepoScan = {
  created: boolean;
  repoId: string;
  scanId: string;
  status: Extract<RepoScanStatus, "queued" | "running">;
  workspaceId: string;
};

export type GetRepoScanInput = {
  scanId: string;
  workspaceId: string;
};

export type ListRepoScansInput = {
  repoId?: string;
  workspaceId: string;
};

export type GetRepoScanStatusInput = {
  repoId?: string;
  scanId?: string;
  workspaceId: string;
};

export type RepoScanInventoryCounts = {
  ciProviderCount: number;
  documentationCount: number;
  dryRunCheckCount: number;
  hasPolicyFile: boolean;
  languageCount: number;
  omittedFileCount: number;
  packageManagerCount: number;
  presentDocumentationCount: number;
  protectedPathCount: number;
  scannedFileCount: number;
  sensitivePathCount: number;
  totalDirectoryCount: number;
  totalFileCount: number;
  validationCommandCount: number;
};

export type RepoScanStatusSummary = {
  blockedFindingCount: number;
  createdAt: string;
  failureSummary?: string;
  findingCount: number;
  finishedAt?: string;
  inventoryCounts: RepoScanInventoryCounts;
  moduleStatuses: RepoScanModuleStatus[];
  openFindingCount: number;
  readinessReportId?: string;
  readinessReportStatus: "available" | "pending";
  repoId: string;
  scanId: string;
  startedAt?: string;
  status: RepoScanStatus;
  statusSummary: string;
  taskRecommendationCount: number;
  updatedAt: string;
  workspaceId: string;
};

export type UpdateRepoScanStatusInput = {
  failureSummary?: string;
  findingIds?: string[];
  inventory?: RepoScanInventory;
  moduleStatuses?: RepoScanModuleStatus[];
  readinessReportId?: string;
  scanId: string;
  status: RepoScanStatus;
  statusSummary?: string;
  taskRecommendationIds?: string[];
  workspaceId: string;
};

export type RepoScanStore = WorkspaceMembershipStore & {
  createRepoScanWithAudit: (input: {
    auditEvent: AuditEventInsert;
    scan: RepoScanInsert;
  }) => Promise<RepoScanRecord>;
  findGitHubRepositoryForWebhook: (input: {
    githubInstallationId: string;
    repositoryExternalId: string;
    repositoryName: string;
    repositoryOwner: string;
  }) => Promise<GitHubRepositoryScanRow | null>;
  findGitHubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<GitHubRepositoryScanRow | null>;
  findActiveRepoScanForRepo: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<RepoScanRecord | null>;
  getRepoScanFindingStatusCounts: (input: {
    repoId: string;
    scanId: string;
    workspaceId: string;
  }) => Promise<{
    blockedFindingCount: number;
    openFindingCount: number;
  }>;
  getRepoScan: (input: { scanId: string; workspaceId: string }) => Promise<RepoScanRecord | null>;
  listRepoScans: (input: { repoId?: string; workspaceId: string }) => Promise<RepoScanRecord[]>;
  updateRepoScanWithAudit: (input: {
    auditEvent: AuditEventInsert;
    scanId: string;
    updates: RepoScanUpdate;
    workspaceId: string;
  }) => Promise<RepoScanRecord | null>;
};

export type RepoScanService = {
  createRepoScan: (input: CreateRepoScanInput) => Promise<RepoScan>;
  getRepoScan: (input: GetRepoScanInput) => Promise<RepoScan | null>;
  getRepoScanStatus: (input: GetRepoScanStatusInput) => Promise<RepoScanStatusSummary | null>;
  listRepoScans: (input: ListRepoScansInput) => Promise<RepoScan[]>;
  triggerRepoScanForWebhook: (
    input: TriggerRepoScanForWebhookInput,
  ) => Promise<TriggeredRepoScan | null>;
  triggerRepoScan: (input: TriggerRepoScanInput) => Promise<TriggeredRepoScan>;
  updateRepoScanStatus: (input: UpdateRepoScanStatusInput) => Promise<RepoScan>;
};

const textMaxLength = 240;
const summaryMaxLength = 500;
const productGoalMaxLength = 500;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const terminalStatuses = new Set<RepoScanStatus>(["completed", "failed", "cancelled"]);
const activeStatuses = ["queued", "running"] as const;
const unsafeLocalPathTextPatterns = [
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\))/iu,
] as const;

const emptyInventory = (): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "missing",
    hasAgentInstructions: false,
    instructionFileCount: 0,
    missingSectionLabels: ["agent instructions"],
    readStatus: "missing",
  },
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: [],
  documentationSummaries: [],
  documentSummaries: [],
  languageSummaries: [],
  omittedFileCount: 0,
  packageManagerLabels: [],
  policySummary: {
    dryRunCheckCount: 0,
    hasPolicyFile: false,
    protectedPathCount: 0,
    sensitivePathCount: 0,
    validationCommandCount: 0,
  },
  productClaritySummary: {
    clarityStatus: "missing",
    goalContextStatus: "not_provided",
    hasProductDocs: false,
    missingSignalLabels: [],
    productDocCount: 0,
    readStatus: "missing",
    signalLabels: [],
  },
  repoHygieneSummary: {
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
  },
  scannedFileCount: 0,
  totalDirectoryCount: 0,
  totalFileCount: 0,
});

const inventoryForProductGoal = (productGoal: string | undefined): RepoScanInventory => {
  const inventory = emptyInventory();

  if (productGoal === undefined) {
    return inventory;
  }

  return {
    ...inventory,
    productClaritySummary: {
      ...inventory.productClaritySummary,
      goalContextStatus: "provided",
      goalContextSummary: productGoal,
    },
  };
};

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const assertSafePayload = (value: unknown): void => {
  try {
    assertSafeWebBoundPayload(value);
  } catch {
    throw createActionError("validation_error");
  }
};

const assertSafeText = (value: string, maxLength = textMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  assertSafePayload(normalizedValue);

  return normalizedValue;
};

const hasUnsafeSummaryPathText = (value: string): boolean =>
  hasUnsafePayloadPathText(value) ||
  unsafeLocalPathTextPatterns.some((pattern) => pattern.test(value));

const assertSafeSummaryText = (value: string, maxLength = summaryMaxLength): string => {
  const normalizedValue = assertSafeText(value, maxLength);

  if (hasUnsafeSummaryPathText(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalProductGoal = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  return assertSafeSummaryText(normalizedValue, productGoalMaxLength);
};

const normalizeGitHubNumericId = (value: number | string): string => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw createActionError("validation_error");
    }

    return String(value);
  }

  const normalizedValue = value.trim();

  if (!/^\d{1,32}$/u.test(normalizedValue) || BigInt(normalizedValue) <= 0n) {
    throw createActionError("validation_error");
  }

  return BigInt(normalizedValue).toString();
};

const normalizeId = (value: string): string => {
  const normalizedValue = assertSafeText(value);

  if (!idPattern.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeRepositoryPart = (value: string): string => {
  const normalizedValue = assertSafeText(value, 100);

  if (
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.startsWith("-") ||
    normalizedValue.includes("/") ||
    normalizedValue.includes("\\") ||
    normalizedValue.includes(":") ||
    normalizedValue.includes("@") ||
    /\s/u.test(normalizedValue) ||
    !/^[A-Za-z0-9._-]+$/u.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeWebhookReason = (
  value: TriggerRepoScanForWebhookReason,
): TriggerRepoScanForWebhookReason => {
  if (value === "default_branch_push" || value === "pull_request_merged") {
    return value;
  }

  throw createActionError("validation_error");
};

const normalizeOptionalId = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeId(value);
};

const normalizeIdArray = (values: readonly string[] | undefined, fallback: string[]): string[] =>
  values === undefined ? [...fallback] : values.map(normalizeId);

const normalizeInventory = (
  value: RepoScanInventory | undefined,
  fallback: RepoScanInventory,
): RepoScanInventory => {
  const inventory = value ?? fallback;

  assertSafePayload(inventory);

  try {
    return RepoScanInventorySchema.parse(inventory);
  } catch {
    throw createActionError("validation_error");
  }
};

const normalizeModuleStatuses = (
  value: RepoScanModuleStatus[] | undefined,
  fallback: RepoScanModuleStatus[],
): RepoScanModuleStatus[] => {
  const moduleStatuses = value ?? fallback;

  assertSafePayload(moduleStatuses);

  return [...moduleStatuses];
};

const defaultStatusSummary = (status: RepoScanStatus): string => {
  switch (status) {
    case "queued":
      return "Queued for repo readiness scanning.";
    case "running":
      return "Repo readiness scan is running.";
    case "completed":
      return "Repo readiness scan completed.";
    case "failed":
      return "Repo readiness scan failed.";
    case "cancelled":
      return "Repo readiness scan was cancelled.";
  }
};

const toIsoString = (value: Date): string => value.toISOString();

const validateRepoScan = (value: unknown): RepoScan => {
  assertSafePayload(value);

  try {
    const scan = RepoScanSchema.parse(value);
    assertSafePayload(scan);

    return scan;
  } catch {
    throw createActionError("validation_error");
  }
};

const toRepoScan = (row: RepoScanRecord): RepoScan => {
  const scan: Record<string, unknown> = {
    contractVersion: row.contractVersion,
    createdAt: toIsoString(row.createdAt),
    findingIds: row.findingIds,
    inventory: row.inventory,
    moduleStatuses: row.moduleStatuses,
    repoId: row.repoId,
    scanId: row.id,
    status: row.status,
    statusSummary: row.statusSummary,
    taskRecommendationIds: row.taskRecommendationIds,
    updatedAt: toIsoString(row.updatedAt),
    workspaceId: row.workspaceId,
  };

  if (row.readinessReportId !== null) {
    scan.readinessReportId = row.readinessReportId;
  }

  if (row.failureSummary !== null) {
    scan.failureSummary = row.failureSummary;
  }

  if (row.startedAt !== null) {
    scan.startedAt = toIsoString(row.startedAt);
  }

  if (row.finishedAt !== null) {
    scan.finishedAt = toIsoString(row.finishedAt);
  }

  return validateRepoScan(scan);
};

const auditMetadataForScan = (scan: RepoScan): Record<string, unknown> => {
  const moduleStatusCounts: Record<string, number> = {};

  for (const moduleStatus of scan.moduleStatuses) {
    moduleStatusCounts[moduleStatus.status] = (moduleStatusCounts[moduleStatus.status] ?? 0) + 1;
  }

  const metadata: Record<string, unknown> = {
    findingCount: scan.findingIds.length,
    moduleCount: scan.moduleStatuses.length,
    moduleStatusCounts,
    repoId: scan.repoId,
    scanId: scan.scanId,
    status: scan.status,
    statusSummaryLength: scan.statusSummary.length,
    taskRecommendationCount: scan.taskRecommendationIds.length,
    productGoalContextStatus: scan.inventory.productClaritySummary.goalContextStatus,
  };

  if (scan.readinessReportId !== undefined) {
    metadata.readinessReportId = scan.readinessReportId;
  }

  if (scan.failureSummary !== undefined) {
    metadata.failureSummaryLength = scan.failureSummary.length;
  }

  assertSafePayload(metadata);

  return metadata;
};

const buildCreatedAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  now: Date;
  scan: RepoScan;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: "repo_scans.created",
    message: "Repo scan created.",
    metadata: auditMetadataForScan(input.scan),
    now: () => input.now,
    workspaceId: input.scan.workspaceId,
  });

const buildStatusAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  now: Date;
  scan: RepoScan;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: "repo_scans.status_updated",
    message: "Repo scan status updated.",
    metadata: auditMetadataForScan(input.scan),
    now: () => input.now,
    workspaceId: input.scan.workspaceId,
  });

const buildWebhookTriggeredAuditEvent = (input: {
  createAuditEventId: () => string;
  deliveryId: string;
  githubInstallationId: string;
  now: Date;
  reason: TriggerRepoScanForWebhookReason;
  scan: RepoScan;
}): AuditEventInsert =>
  createAuditEventInsert({
    createId: input.createAuditEventId,
    eventType: "repo_scans.webhook_triggered",
    message: "Repo scan queued from GitHub webhook.",
    metadata: {
      deliveryId: input.deliveryId,
      githubInstallationId: input.githubInstallationId,
      repoId: input.scan.repoId,
      scanId: input.scan.scanId,
      status: input.scan.status,
      triggerReason: input.reason,
    },
    now: () => input.now,
    workspaceId: input.scan.workspaceId,
  });

const toTriggeredRepoScan = (input: {
  created: boolean;
  scan: Pick<RepoScan, "repoId" | "scanId" | "status" | "workspaceId">;
}): TriggeredRepoScan => {
  if (input.scan.status !== "queued" && input.scan.status !== "running") {
    throw createActionError("validation_error");
  }

  return {
    created: input.created,
    repoId: input.scan.repoId,
    scanId: input.scan.scanId,
    status: input.scan.status,
    workspaceId: input.scan.workspaceId,
  };
};

const toInventoryCounts = (inventory: RepoScanInventory): RepoScanInventoryCounts => ({
  ciProviderCount: inventory.ciProviderLabels.length,
  documentationCount: inventory.documentationSummaries.length,
  dryRunCheckCount: inventory.policySummary.dryRunCheckCount,
  hasPolicyFile: inventory.policySummary.hasPolicyFile,
  languageCount: inventory.languageSummaries.length,
  omittedFileCount: inventory.omittedFileCount,
  packageManagerCount: inventory.packageManagerLabels.length,
  presentDocumentationCount: inventory.documentationSummaries.filter((summary) => summary.present)
    .length,
  protectedPathCount: inventory.policySummary.protectedPathCount,
  scannedFileCount: inventory.scannedFileCount,
  sensitivePathCount: inventory.policySummary.sensitivePathCount,
  totalDirectoryCount: inventory.totalDirectoryCount,
  totalFileCount: inventory.totalFileCount,
  validationCommandCount: inventory.policySummary.validationCommandCount,
});

const toRepoScanStatusSummary = (input: {
  blockedFindingCount: number;
  openFindingCount: number;
  scan: RepoScan;
}): RepoScanStatusSummary => {
  const status: RepoScanStatusSummary = {
    blockedFindingCount: input.blockedFindingCount,
    createdAt: input.scan.createdAt,
    findingCount: input.scan.findingIds.length,
    inventoryCounts: toInventoryCounts(input.scan.inventory),
    moduleStatuses: input.scan.moduleStatuses,
    openFindingCount: input.openFindingCount,
    readinessReportStatus:
      input.scan.readinessReportId === undefined ? ("pending" as const) : ("available" as const),
    repoId: input.scan.repoId,
    scanId: input.scan.scanId,
    status: input.scan.status,
    statusSummary: input.scan.statusSummary,
    taskRecommendationCount: input.scan.taskRecommendationIds.length,
    updatedAt: input.scan.updatedAt,
    workspaceId: input.scan.workspaceId,
  };

  if (input.scan.failureSummary !== undefined) {
    status.failureSummary = input.scan.failureSummary;
  }

  if (input.scan.finishedAt !== undefined) {
    status.finishedAt = input.scan.finishedAt;
  }

  if (input.scan.readinessReportId !== undefined) {
    status.readinessReportId = input.scan.readinessReportId;
  }

  if (input.scan.startedAt !== undefined) {
    status.startedAt = input.scan.startedAt;
  }

  assertSafePayload(status);

  return status;
};

export const createDrizzleRepoScanStore = (db: Database): RepoScanStore => ({
  createRepoScanWithAudit: async ({ auditEvent, scan }) =>
    db.transaction(async (tx) => {
      const [createdScan] = await tx.insert(schema.repoScans).values(scan).returning();

      if (createdScan === undefined) {
        throw new Error("Repo scan insert did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);
      await tx
        .insert(schema.usageEvents)
        .values(
          createUsageEventInsert({
            createdAt: scan.createdAt ?? new Date(),
            idempotencyKey: `usage:${scan.workspaceId}:repo_scan:${scan.id}`,
            metadata: {
              eventType: auditEvent.eventType,
            },
            occurredAt: scan.createdAt ?? new Date(),
            source: {
              id: scan.id,
              table: "repo_scans",
            },
            usageEventType: "repo_scan",
            workspaceId: scan.workspaceId,
          }),
        )
        .onConflictDoNothing({
          target: [schema.usageEvents.workspaceId, schema.usageEvents.idempotencyKey],
        });

      return createdScan;
    }),
  findGitHubRepositoryForWebhook: async ({
    githubInstallationId,
    repositoryExternalId,
    repositoryName,
    repositoryOwner,
  }) => {
    const [repository] = await db
      .select({
        id: schema.githubRepositories.id,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .where(
        and(
          eq(schema.githubRepositories.githubInstallationId, githubInstallationId),
          eq(schema.githubRepositories.repositoryExternalId, repositoryExternalId),
          eq(schema.githubRepositories.repositoryName, repositoryName),
          eq(schema.githubRepositories.repositoryOwner, repositoryOwner),
        ),
      )
      .limit(1);

    return repository ?? null;
  },
  findGitHubRepository: async ({ repoId, workspaceId }) => {
    const [repository] = await db
      .select({
        id: schema.githubRepositories.id,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .where(
        and(
          eq(schema.githubRepositories.id, repoId),
          eq(schema.githubRepositories.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return repository ?? null;
  },
  findActiveRepoScanForRepo: async ({ repoId, workspaceId }) => {
    const [scan] = await db
      .select()
      .from(schema.repoScans)
      .where(
        and(
          eq(schema.repoScans.repoId, repoId),
          eq(schema.repoScans.workspaceId, workspaceId),
          inArray(schema.repoScans.status, activeStatuses),
        ),
      )
      .orderBy(desc(schema.repoScans.createdAt))
      .limit(1);

    return scan ?? null;
  },
  findWorkspaceMembership: async ({ userId, workspaceId }) => {
    const [membership] = await db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);

    return membership ?? null;
  },
  getRepoScanFindingStatusCounts: async ({ repoId, scanId, workspaceId }) => {
    const [counts] = await db
      .select({
        blockedFindingCount: sql<number>`count(*) filter (where ${schema.findings.severity} = 'blocked')`,
        openFindingCount: sql<number>`count(*) filter (where ${schema.findings.status} = 'open')`,
      })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.repoId, repoId),
          eq(schema.findings.scanId, scanId),
          eq(schema.findings.workspaceId, workspaceId),
        ),
      );

    return {
      blockedFindingCount: Number(counts?.blockedFindingCount ?? 0),
      openFindingCount: Number(counts?.openFindingCount ?? 0),
    };
  },
  getRepoScan: async ({ scanId, workspaceId }) => {
    const [scan] = await db
      .select()
      .from(schema.repoScans)
      .where(and(eq(schema.repoScans.id, scanId), eq(schema.repoScans.workspaceId, workspaceId)))
      .limit(1);

    return scan ?? null;
  },
  listRepoScans: async ({ repoId, workspaceId }) => {
    const conditions = [eq(schema.repoScans.workspaceId, workspaceId)];

    if (repoId !== undefined) {
      conditions.push(eq(schema.repoScans.repoId, repoId));
    }

    return db
      .select()
      .from(schema.repoScans)
      .where(and(...conditions))
      .orderBy(desc(schema.repoScans.createdAt));
  },
  updateRepoScanWithAudit: async ({ auditEvent, scanId, updates, workspaceId }) =>
    db.transaction(async (tx) => {
      const [updatedScan] = await tx
        .update(schema.repoScans)
        .set(updates)
        .where(and(eq(schema.repoScans.id, scanId), eq(schema.repoScans.workspaceId, workspaceId)))
        .returning();

      if (updatedScan === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return updatedScan;
    }),
});

export const createRepoScanService = (input: {
  createAuditEventId?: () => string;
  createScanId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RepoScanStore;
  usageLimitAdminOverride?: BillingPlanLimitAdminOverride;
  usageLimitService?: Pick<BillingPlanLimitService, "assertUsageAllowed">;
}): RepoScanService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createScanId = input.createScanId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  const assertRepoScanUsageAllowed = async (workspaceId: string): Promise<void> => {
    await input.usageLimitService?.assertUsageAllowed({
      ...(input.usageLimitAdminOverride === undefined
        ? {}
        : { adminOverride: input.usageLimitAdminOverride }),
      usageEventType: "repo_scan",
      workspaceId,
    });
  };

  const createQueuedRepoScan = async (createInput: CreateRepoScanInput): Promise<RepoScan> => {
    const workspaceId = normalizeId(createInput.workspaceId);
    const repoId = normalizeId(createInput.repoId);
    const productGoal = normalizeOptionalProductGoal(createInput.productGoal);
    const scope = await requireWorkspaceMembership({
      getAuthContext,
      store: input.store,
      workspaceId,
    });
    const repository = await input.store.findGitHubRepository({
      repoId,
      workspaceId: scope.workspaceId,
    });

    if (repository === null) {
      throw createActionError("validation_error");
    }

    await assertRepoScanUsageAllowed(scope.workspaceId);

    const createdAt = now();
    const inventory = inventoryForProductGoal(productGoal);
    const scan = validateRepoScan({
      contractVersion: CONTRACT_VERSION,
      createdAt: toIsoString(createdAt),
      findingIds: [],
      inventory,
      moduleStatuses: [],
      repoId: repository.id,
      scanId: normalizeId(createScanId()),
      status: "queued",
      statusSummary: defaultStatusSummary("queued"),
      taskRecommendationIds: [],
      updatedAt: toIsoString(createdAt),
      workspaceId: scope.workspaceId,
    });
    const row: RepoScanInsert = {
      contractVersion: scan.contractVersion,
      createdAt,
      failureSummary: null,
      findingIds: scan.findingIds,
      finishedAt: null,
      id: scan.scanId,
      inventory: scan.inventory,
      moduleStatuses: scan.moduleStatuses,
      readinessReportId: null,
      repoId: scan.repoId,
      startedAt: null,
      status: scan.status,
      statusSummary: scan.statusSummary,
      taskRecommendationIds: scan.taskRecommendationIds,
      updatedAt: createdAt,
      workspaceId: scan.workspaceId,
    };
    const auditEvent = buildCreatedAuditEvent({
      actorId: scope.actorId,
      createAuditEventId,
      now: createdAt,
      scan,
    });
    const createdScan = await input.store.createRepoScanWithAudit({
      auditEvent,
      scan: row,
    });

    return toRepoScan(createdScan);
  };

  return {
    createRepoScan: createQueuedRepoScan,
    triggerRepoScanForWebhook: async (webhookInput) => {
      const deliveryId = normalizeId(webhookInput.deliveryId);
      const githubInstallationId = normalizeGitHubNumericId(webhookInput.githubInstallationId);
      const repositoryExternalId = normalizeGitHubNumericId(webhookInput.repository.id);
      const repositoryOwner = normalizeRepositoryPart(webhookInput.repository.owner);
      const repositoryName = normalizeRepositoryPart(webhookInput.repository.name);
      const reason = normalizeWebhookReason(webhookInput.reason);
      const repository = await input.store.findGitHubRepositoryForWebhook({
        githubInstallationId,
        repositoryExternalId,
        repositoryName,
        repositoryOwner,
      });

      if (repository === null) {
        return null;
      }

      const activeScan = await input.store.findActiveRepoScanForRepo({
        repoId: repository.id,
        workspaceId: repository.workspaceId,
      });

      if (activeScan !== null) {
        return toTriggeredRepoScan({
          created: false,
          scan: toRepoScan(activeScan),
        });
      }

      await assertRepoScanUsageAllowed(repository.workspaceId);

      const createdAt = now();
      const scan = validateRepoScan({
        contractVersion: CONTRACT_VERSION,
        createdAt: toIsoString(createdAt),
        findingIds: [],
        inventory: emptyInventory(),
        moduleStatuses: [],
        repoId: repository.id,
        scanId: normalizeId(createScanId()),
        status: "queued",
        statusSummary: "Queued after GitHub repository change.",
        taskRecommendationIds: [],
        updatedAt: toIsoString(createdAt),
        workspaceId: repository.workspaceId,
      });
      const createdScan = await input.store.createRepoScanWithAudit({
        auditEvent: buildWebhookTriggeredAuditEvent({
          createAuditEventId,
          deliveryId,
          githubInstallationId,
          now: createdAt,
          reason,
          scan,
        }),
        scan: {
          contractVersion: scan.contractVersion,
          createdAt,
          failureSummary: null,
          findingIds: scan.findingIds,
          finishedAt: null,
          id: scan.scanId,
          inventory: scan.inventory,
          moduleStatuses: scan.moduleStatuses,
          readinessReportId: null,
          repoId: scan.repoId,
          startedAt: null,
          status: scan.status,
          statusSummary: scan.statusSummary,
          taskRecommendationIds: scan.taskRecommendationIds,
          updatedAt: createdAt,
          workspaceId: scan.workspaceId,
        },
      });

      return toTriggeredRepoScan({
        created: true,
        scan: toRepoScan(createdScan),
      });
    },
    triggerRepoScan: async (triggerInput) => {
      const workspaceId = normalizeId(triggerInput.workspaceId);
      const repoId = normalizeId(triggerInput.repoId);
      const productGoal = normalizeOptionalProductGoal(triggerInput.productGoal);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const repository = await input.store.findGitHubRepository({
        repoId,
        workspaceId: scope.workspaceId,
      });

      if (repository === null) {
        throw createActionError("validation_error");
      }

      const activeScan = await input.store.findActiveRepoScanForRepo({
        repoId: repository.id,
        workspaceId: scope.workspaceId,
      });

      if (activeScan !== null) {
        return toTriggeredRepoScan({
          created: false,
          scan: toRepoScan(activeScan),
        });
      }

      const createdScan = await createQueuedRepoScan({
        ...(productGoal === undefined ? {} : { productGoal }),
        repoId: repository.id,
        workspaceId: scope.workspaceId,
      });

      return toTriggeredRepoScan({
        created: true,
        scan: createdScan,
      });
    },
    getRepoScan: async (getInput) => {
      const workspaceId = normalizeId(getInput.workspaceId);
      const scanId = normalizeId(getInput.scanId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const scan = await input.store.getRepoScan({
        scanId,
        workspaceId: scope.workspaceId,
      });

      return scan === null ? null : toRepoScan(scan);
    },
    getRepoScanStatus: async (statusInput) => {
      const workspaceId = normalizeId(statusInput.workspaceId);
      const repoId = statusInput.repoId === undefined ? undefined : normalizeId(statusInput.repoId);
      const scanId = statusInput.scanId === undefined ? undefined : normalizeId(statusInput.scanId);

      if (
        (repoId === undefined && scanId === undefined) ||
        (repoId !== undefined && scanId !== undefined)
      ) {
        throw createActionError("validation_error");
      }

      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const row =
        scanId === undefined
          ? ((
              await input.store.listRepoScans({
                ...(repoId === undefined ? {} : { repoId }),
                workspaceId: scope.workspaceId,
              })
            )[0] ?? null)
          : await input.store.getRepoScan({
              scanId,
              workspaceId: scope.workspaceId,
            });

      if (row === null) {
        return null;
      }

      const scan = toRepoScan(row);
      const counts = await input.store.getRepoScanFindingStatusCounts({
        repoId: scan.repoId,
        scanId: scan.scanId,
        workspaceId: scan.workspaceId,
      });

      return toRepoScanStatusSummary({
        blockedFindingCount: counts.blockedFindingCount,
        openFindingCount: counts.openFindingCount,
        scan,
      });
    },
    listRepoScans: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const repoId = listInput.repoId === undefined ? undefined : normalizeId(listInput.repoId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const scans = await input.store.listRepoScans({
        workspaceId: scope.workspaceId,
        ...(repoId === undefined ? {} : { repoId }),
      });

      return scans.map(toRepoScan);
    },
    updateRepoScanStatus: async (updateInput) => {
      const workspaceId = normalizeId(updateInput.workspaceId);
      const scanId = normalizeId(updateInput.scanId);
      const status = updateInput.status;
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const existingScan = await input.store.getRepoScan({
        scanId,
        workspaceId: scope.workspaceId,
      });

      if (existingScan === null) {
        throw createActionError("validation_error");
      }

      const updatedAt = now();
      const findingIds = normalizeIdArray(updateInput.findingIds, existingScan.findingIds);
      const taskRecommendationIds = normalizeIdArray(
        updateInput.taskRecommendationIds,
        existingScan.taskRecommendationIds,
      );

      if (status === "failed" && updateInput.failureSummary === undefined) {
        throw createActionError("validation_error");
      }

      if (
        status === "completed" &&
        updateInput.readinessReportId === undefined &&
        existingScan.readinessReportId === null
      ) {
        throw createActionError("validation_error");
      }

      const inventory = normalizeInventory(updateInput.inventory, existingScan.inventory);
      const moduleStatuses = normalizeModuleStatuses(
        updateInput.moduleStatuses,
        existingScan.moduleStatuses,
      );
      const readinessReportId =
        updateInput.readinessReportId === undefined
          ? existingScan.readinessReportId
          : normalizeOptionalId(updateInput.readinessReportId);
      const failureSummary =
        updateInput.failureSummary === undefined
          ? existingScan.failureSummary
          : assertSafeSummaryText(updateInput.failureSummary);
      const statusSummary =
        updateInput.statusSummary === undefined
          ? defaultStatusSummary(status)
          : assertSafeSummaryText(updateInput.statusSummary);
      const startedAt =
        status === "running" ? (existingScan.startedAt ?? updatedAt) : existingScan.startedAt;
      const finishedAt = terminalStatuses.has(status) ? updatedAt : null;
      const nextScan = validateRepoScan({
        contractVersion: existingScan.contractVersion,
        createdAt: toIsoString(existingScan.createdAt),
        failureSummary: failureSummary ?? undefined,
        findingIds,
        finishedAt: finishedAt === null ? undefined : toIsoString(finishedAt),
        inventory,
        moduleStatuses,
        readinessReportId: readinessReportId ?? undefined,
        repoId: existingScan.repoId,
        scanId: existingScan.id,
        startedAt: startedAt === null ? undefined : toIsoString(startedAt),
        status,
        statusSummary,
        taskRecommendationIds,
        updatedAt: toIsoString(updatedAt),
        workspaceId: existingScan.workspaceId,
      });
      const updates: RepoScanUpdate = {
        failureSummary: nextScan.failureSummary ?? null,
        findingIds: nextScan.findingIds,
        finishedAt,
        inventory: nextScan.inventory,
        moduleStatuses: nextScan.moduleStatuses,
        readinessReportId: nextScan.readinessReportId ?? null,
        startedAt,
        status: nextScan.status,
        statusSummary: nextScan.statusSummary,
        taskRecommendationIds: nextScan.taskRecommendationIds,
        updatedAt,
      };
      const auditEvent = buildStatusAuditEvent({
        actorId: scope.actorId,
        createAuditEventId,
        now: updatedAt,
        scan: nextScan,
      });
      const updatedScan = await input.store.updateRepoScanWithAudit({
        auditEvent,
        scanId: nextScan.scanId,
        updates,
        workspaceId: scope.workspaceId,
      });

      if (updatedScan === null) {
        throw createActionError("validation_error");
      }

      return toRepoScan(updatedScan);
    },
  };
};
