import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  RepoScanSchema,
  type RepoScan,
  type RepoScanInventory,
  type RepoScanStatus,
} from "@control-plane/shared";

import { getBillingPlanLimits } from "../billing/plan-limits";
import { BILLING_USAGE_ENFORCEMENT_ENABLED } from "../billing/usage";
import { and, desc, eq, schema, type Database, type RepoScanRecord } from "../db";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import { assertSafeWebBoundPayload } from "../security/payload-guard";

export const WEEKLY_REPO_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type RecurringRepoScanCandidate = {
  latestScanCreatedAt: Date | null;
  latestScanFinishedAt: Date | null;
  latestScanId: string | null;
  latestScanStatus: RepoScanStatus | null;
  monthlyRunLimit: number;
  plan: string;
  repoId: string;
  usageCount: number;
  workspaceId: string;
};

export type RecurringRepoScanReason = "never_scanned" | "weekly_due";

export type QueuedRecurringRepoScan = {
  created: true;
  reason: RecurringRepoScanReason;
  repoId: string;
  scanId: string;
  status: "queued";
  workspaceId: string;
};

export type SkippedRecurringRepoScan = {
  reason: "active_scan" | "plan_limit" | "recent_scan";
  repoId: string;
  scanId?: string;
  workspaceId: string;
};

export type RecurringRepoScanSchedulerResult = {
  dueCount: number;
  planLimitedCount: number;
  queued: QueuedRecurringRepoScan[];
  skipped: SkippedRecurringRepoScan[];
  skippedCount: number;
};

export type RecurringRepoScanInsert = Pick<
  typeof schema.repoScans.$inferInsert,
  | "contractVersion"
  | "createdAt"
  | "failureSummary"
  | "findingIds"
  | "finishedAt"
  | "id"
  | "inventory"
  | "moduleStatuses"
  | "readinessReportId"
  | "repoId"
  | "startedAt"
  | "status"
  | "statusSummary"
  | "taskRecommendationIds"
  | "updatedAt"
  | "workspaceId"
>;

export type RepoScanSchedulerStore = {
  createRecurringRepoScanWithAudit: (input: {
    auditEvent: AuditEventInsert;
    scan: RecurringRepoScanInsert;
  }) => Promise<RepoScanRecord>;
  listRecurringRepoScanCandidates: (input: {
    limit: number;
  }) => Promise<RecurringRepoScanCandidate[]>;
};

export type RepoScanScheduler = {
  runWeeklyRepoScans: (input?: { limit?: number }) => Promise<RecurringRepoScanSchedulerResult>;
};

const defaultLimit = 100;
const textMaxLength = 240;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const activeStatuses = new Set<RepoScanStatus>(["queued", "running"]);

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

const normalizeId = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > textMaxLength ||
    hasControlCharacter(normalizedValue) ||
    !idPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  assertSafePayload(normalizedValue);

  return normalizedValue;
};

const normalizeLimit = (value: number | undefined): number => {
  if (value === undefined) {
    return defaultLimit;
  }

  if (!Number.isSafeInteger(value) || value <= 0 || value > 500) {
    throw createActionError("validation_error");
  }

  return value;
};

const validateScan = (value: unknown): RepoScan => {
  assertSafePayload(value);

  try {
    const scan = RepoScanSchema.parse(value);
    assertSafePayload(scan);

    return scan;
  } catch {
    throw createActionError("validation_error");
  }
};

const toIsoString = (value: Date): string => value.toISOString();

const isPlanLimited = (
  candidate: RecurringRepoScanCandidate,
  enforcementEnabled: boolean,
): boolean =>
  enforcementEnabled && candidate.usageCount >= getBillingPlanLimits(candidate.plan).repo_scan;

const getDueReason = (
  candidate: RecurringRepoScanCandidate,
  now: Date,
): RecurringRepoScanReason | null => {
  if (candidate.latestScanId === null || candidate.latestScanCreatedAt === null) {
    return "never_scanned";
  }

  if (candidate.latestScanStatus !== null && activeStatuses.has(candidate.latestScanStatus)) {
    return null;
  }

  return now.getTime() - candidate.latestScanCreatedAt.getTime() >= WEEKLY_REPO_SCAN_INTERVAL_MS
    ? "weekly_due"
    : null;
};

const toQueuedScan = (input: {
  createScanId: () => string;
  now: Date;
  reason: RecurringRepoScanReason;
  repoId: string;
  workspaceId: string;
}): { insert: RecurringRepoScanInsert; scan: RepoScan } => {
  const scan = validateScan({
    contractVersion: CONTRACT_VERSION,
    createdAt: toIsoString(input.now),
    findingIds: [],
    inventory: emptyInventory(),
    moduleStatuses: [],
    repoId: normalizeId(input.repoId),
    scanId: normalizeId(input.createScanId()),
    status: "queued",
    statusSummary:
      input.reason === "never_scanned"
        ? "Queued for first recurring repo readiness scan."
        : "Queued for weekly repo readiness rescan.",
    taskRecommendationIds: [],
    updatedAt: toIsoString(input.now),
    workspaceId: normalizeId(input.workspaceId),
  });

  return {
    insert: {
      contractVersion: scan.contractVersion,
      createdAt: input.now,
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
      updatedAt: input.now,
      workspaceId: scan.workspaceId,
    },
    scan,
  };
};

const buildRecurringAuditEvent = (input: {
  createAuditEventId: () => string;
  now: Date;
  reason: RecurringRepoScanReason;
  scan: RepoScan;
}): AuditEventInsert =>
  createAuditEventInsert({
    createId: input.createAuditEventId,
    eventType: "repo_scans.recurring_queued",
    message: "Recurring repo readiness scan queued.",
    metadata: {
      repoId: input.scan.repoId,
      scanId: input.scan.scanId,
      status: input.scan.status,
      triggerReason: input.reason,
    },
    now: () => input.now,
    workspaceId: input.scan.workspaceId,
  });

const toScanRecord = (row: RepoScanRecord): RepoScan =>
  validateScan({
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
    ...(row.failureSummary === null ? {} : { failureSummary: row.failureSummary }),
    ...(row.finishedAt === null ? {} : { finishedAt: toIsoString(row.finishedAt) }),
    ...(row.readinessReportId === null ? {} : { readinessReportId: row.readinessReportId }),
    ...(row.startedAt === null ? {} : { startedAt: toIsoString(row.startedAt) }),
  });

export const createDrizzleRepoScanSchedulerStore = (db: Database): RepoScanSchedulerStore => ({
  createRecurringRepoScanWithAudit: async ({ auditEvent, scan }) =>
    db.transaction(async (tx) => {
      const [createdScan] = await tx.insert(schema.repoScans).values(scan).returning();

      if (createdScan === undefined) {
        throw new Error("Recurring repo scan insert did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return createdScan;
    }),
  listRecurringRepoScanCandidates: async ({ limit }) => {
    const repositories = await db
      .select({
        monthlyRunLimit: schema.workspaces.monthlyRunLimit,
        plan: schema.workspaces.plan,
        repoId: schema.githubRepositories.id,
        usageCount: schema.workspaces.usageCount,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .innerJoin(schema.workspaces, eq(schema.githubRepositories.workspaceId, schema.workspaces.id))
      .where(
        and(
          eq(schema.githubRepositories.archived, false),
          eq(schema.githubRepositories.disabled, false),
        ),
      )
      .limit(limit);

    const candidates: RecurringRepoScanCandidate[] = [];

    for (const repository of repositories) {
      const [latestScan] = await db
        .select({
          createdAt: schema.repoScans.createdAt,
          finishedAt: schema.repoScans.finishedAt,
          id: schema.repoScans.id,
          status: schema.repoScans.status,
        })
        .from(schema.repoScans)
        .where(
          and(
            eq(schema.repoScans.repoId, repository.repoId),
            eq(schema.repoScans.workspaceId, repository.workspaceId),
          ),
        )
        .orderBy(desc(schema.repoScans.createdAt))
        .limit(1);

      candidates.push({
        latestScanCreatedAt: latestScan?.createdAt ?? null,
        latestScanFinishedAt: latestScan?.finishedAt ?? null,
        latestScanId: latestScan?.id ?? null,
        latestScanStatus: latestScan?.status ?? null,
        monthlyRunLimit: repository.monthlyRunLimit,
        plan: repository.plan,
        repoId: repository.repoId,
        usageCount: repository.usageCount,
        workspaceId: repository.workspaceId,
      });
    }

    return candidates;
  },
});

export const createRepoScanScheduler = (input: {
  createAuditEventId?: () => string;
  createScanId?: () => string;
  enforcementEnabled?: boolean;
  now?: () => Date;
  store: RepoScanSchedulerStore;
}): RepoScanScheduler => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createScanId = input.createScanId ?? randomUUID;
  const enforcementEnabled = input.enforcementEnabled ?? BILLING_USAGE_ENFORCEMENT_ENABLED;
  const now = input.now ?? (() => new Date());

  return {
    runWeeklyRepoScans: async (runInput = {}) => {
      const limit = normalizeLimit(runInput.limit);
      const currentTime = now();
      const candidates = await input.store.listRecurringRepoScanCandidates({ limit });
      const queued: QueuedRecurringRepoScan[] = [];
      const skipped: SkippedRecurringRepoScan[] = [];

      for (const candidate of candidates) {
        const repoId = normalizeId(candidate.repoId);
        const workspaceId = normalizeId(candidate.workspaceId);

        if (candidate.latestScanStatus !== null && activeStatuses.has(candidate.latestScanStatus)) {
          const activeSkip: SkippedRecurringRepoScan = {
            reason: "active_scan",
            repoId,
            workspaceId,
          };

          if (candidate.latestScanId !== null) {
            activeSkip.scanId = candidate.latestScanId;
          }

          skipped.push(activeSkip);
          continue;
        }

        if (isPlanLimited(candidate, enforcementEnabled)) {
          skipped.push({
            reason: "plan_limit",
            repoId,
            workspaceId,
          });
          continue;
        }

        const reason = getDueReason(candidate, currentTime);

        if (reason === null) {
          skipped.push({
            reason: "recent_scan",
            repoId,
            workspaceId,
          });
          continue;
        }

        const { insert, scan } = toQueuedScan({
          createScanId,
          now: currentTime,
          reason,
          repoId,
          workspaceId,
        });
        const createdScan = toScanRecord(
          await input.store.createRecurringRepoScanWithAudit({
            auditEvent: buildRecurringAuditEvent({
              createAuditEventId,
              now: currentTime,
              reason,
              scan,
            }),
            scan: insert,
          }),
        );

        queued.push({
          created: true,
          reason,
          repoId: createdScan.repoId,
          scanId: createdScan.scanId,
          status: "queued",
          workspaceId: createdScan.workspaceId,
        });
      }

      const result: RecurringRepoScanSchedulerResult = {
        dueCount: queued.length,
        planLimitedCount: skipped.filter((item) => item.reason === "plan_limit").length,
        queued,
        skipped,
        skippedCount: skipped.length,
      };

      assertSafePayload(result);

      return result;
    },
  };
};
