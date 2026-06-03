import "server-only";

import { randomUUID } from "node:crypto";

import { RepoReadinessReportSchema, type RepoReadinessReport } from "@control-plane/shared";

import {
  and,
  desc,
  eq,
  inArray,
  schema,
  type Database,
  type FindingRecord,
  type RepoReadinessReportRecord,
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
import {
  assertSafeWebBoundPayload,
  hasUnsafePayloadPathText,
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";
import { createUsageEventInsert } from "../billing/usage-events";
import { classifyExecutionReadiness } from "./execution-readiness";
import { calculateReadinessScores } from "./readiness-scores";

type RepoScanReportRow = Pick<RepoScanRecord, "id" | "inventory" | "repoId" | "workspaceId">;
type FindingReportRow = Pick<
  FindingRecord,
  | "category"
  | "deterministicRuleId"
  | "id"
  | "repoId"
  | "scanId"
  | "severity"
  | "status"
  | "workspaceId"
>;
type RepoReadinessReportInsert = typeof schema.repoReadinessReports.$inferInsert;

export type PersistReadinessReportInput = {
  repoId: string;
  report: RepoReadinessReport;
  scanId: string;
  workspaceId: string;
};

export type GetLatestReadinessReportInput = {
  repoId: string;
  workspaceId: string;
};

export type GetReadinessReportInput = {
  reportId: string;
  workspaceId: string;
};

export type ListReadinessReportsInput = {
  repoId: string;
  workspaceId: string;
};

export type RepoReadinessReportStore = WorkspaceMembershipStore & {
  findFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    scanId: string;
    workspaceId: string;
  }) => Promise<FindingReportRow[]>;
  findRepoScan: (input: {
    scanId: string;
    workspaceId: string;
  }) => Promise<RepoScanReportRow | null>;
  getLatestReadinessReport: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<RepoReadinessReportRecord | null>;
  getReadinessReport: (input: {
    reportId: string;
    workspaceId: string;
  }) => Promise<RepoReadinessReportRecord | null>;
  listReadinessReports: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<RepoReadinessReportRecord[]>;
  upsertReportWithAuditAndScanUpdate: (input: {
    createAuditEvent: (report: RepoReadinessReportRecord) => AuditEventInsert;
    report: RepoReadinessReportInsert;
  }) => Promise<RepoReadinessReportRecord>;
};

export type RepoReadinessReportService = {
  getLatestReadinessReport: (
    input: GetLatestReadinessReportInput,
  ) => Promise<RepoReadinessReport | null>;
  getReadinessReport: (input: GetReadinessReportInput) => Promise<RepoReadinessReport | null>;
  listReadinessReports: (input: ListReadinessReportsInput) => Promise<RepoReadinessReport[]>;
  persistReadinessReport: (input: PersistReadinessReportInput) => Promise<RepoReadinessReport>;
};

const textMaxLength = 1_000;
const idPattern = /^[A-Za-z0-9._:-]+$/u;
const unsafeReportPathTextPatterns = [/(?:^|[\s"'([{:=,])\.\.(?:[/\\]|$)/u] as const;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const assertValidationSafe = (value: unknown): void => {
  if (hasUnsafeWebBoundPayload(value, { inspectKeys: false })) {
    throw createActionError("validation_error");
  }
};

const assertSafePayload = (value: unknown): void => {
  try {
    assertSafeWebBoundPayload(value);
  } catch {
    throw createActionError("validation_error");
  }
};

const hasUnsafeReportPathText = (value: string): boolean =>
  hasUnsafePayloadPathText(value) ||
  unsafeReportPathTextPatterns.some((pattern) => pattern.test(value));

const assertNoUnsafePathText = (value: unknown, seen: WeakSet<object> = new WeakSet()): void => {
  if (typeof value === "string") {
    if (hasUnsafeReportPathText(value)) {
      throw createActionError("validation_error");
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
    value.forEach((item) => assertNoUnsafePathText(item, seen));

    return;
  }

  Object.values(value).forEach((item) => assertNoUnsafePathText(item, seen));
};

const assertSafeText = (value: string, maxLength = textMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    hasUnsafeReportPathText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeId = (value: string): string => {
  const normalizedValue = assertSafeText(value, 240);

  if (!idPattern.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const uniquePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

const normalizeIdArray = (values: readonly string[]): string[] =>
  uniquePreservingOrder(values.map(normalizeId));

const normalizeTextArray = (values: readonly string[]): string[] =>
  values.map((value) => assertSafeText(value));

const normalizeGeneratedAt = (value: string): string => {
  const normalizedValue = assertSafeText(value, 80);
  const generatedAt = new Date(normalizedValue);

  if (Number.isNaN(generatedAt.getTime())) {
    throw createActionError("validation_error");
  }

  return generatedAt.toISOString();
};

const validateReportInput = (value: unknown): RepoReadinessReport => {
  assertValidationSafe(value);

  try {
    const report = RepoReadinessReportSchema.parse(value);
    assertSafePayload(report);
    assertNoUnsafePathText(report);

    return {
      ...report,
      blockedReasons: normalizeTextArray(report.blockedReasons),
      findingIds: normalizeIdArray(report.findingIds),
      generatedAt: normalizeGeneratedAt(report.generatedAt),
      recommendedNextActions: normalizeTextArray(report.recommendedNextActions),
      repoId: normalizeId(report.repoId),
      reportId: normalizeId(report.reportId),
      scanId: normalizeId(report.scanId),
      strengths: normalizeTextArray(report.strengths),
      summary: assertSafeText(report.summary),
      taskRecommendationIds: normalizeIdArray(report.taskRecommendationIds),
      weaknesses: normalizeTextArray(report.weaknesses),
      workspaceId: normalizeId(report.workspaceId),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createActionError("validation_error");
  }
};

const toIsoString = (value: Date): string => value.toISOString();

const toReport = (row: RepoReadinessReportRecord): RepoReadinessReport =>
  validateReportInput({
    blockedReasons: row.blockedReasons,
    categoryScores: row.categoryScores,
    contractVersion: row.contractVersion,
    executionReadiness: row.executionReadiness,
    findingIds: row.findingIds,
    generatedAt: toIsoString(row.generatedAt),
    overallScore: row.overallScore,
    recommendedNextActions: row.recommendedNextActions,
    repoId: row.repoId,
    reportId: row.id,
    scanId: row.scanId,
    strengths: row.strengths,
    summary: row.summary,
    taskRecommendationIds: row.taskRecommendationIds,
    weaknesses: row.weaknesses,
    workspaceId: row.workspaceId,
  });

const assertMatchingReportScope = (input: {
  repoId: string;
  report: RepoReadinessReport;
  scanId: string;
  workspaceId: string;
}): void => {
  if (
    input.report.workspaceId !== input.workspaceId ||
    input.report.repoId !== input.repoId ||
    input.report.scanId !== input.scanId
  ) {
    throw createActionError("validation_error");
  }
};

const assertFindingScope = async (input: {
  report: RepoReadinessReport;
  store: RepoReadinessReportStore;
}): Promise<FindingReportRow[]> => {
  if (input.report.findingIds.length === 0) {
    return [];
  }

  const findings = await input.store.findFindingsByIds({
    findingIds: input.report.findingIds,
    repoId: input.report.repoId,
    scanId: input.report.scanId,
    workspaceId: input.report.workspaceId,
  });
  const scopedFindingIds = new Set(findings.map((finding) => finding.id));

  if (
    findings.length !== input.report.findingIds.length ||
    input.report.findingIds.some((findingId) => !scopedFindingIds.has(findingId))
  ) {
    throw createActionError("validation_error");
  }

  return findings;
};

const auditMetadataForReport = (report: RepoReadinessReport): Record<string, unknown> => {
  const metadata = {
    blockedReasonCount: report.blockedReasons.length,
    categoryCount: Object.keys(report.categoryScores).length,
    executionReadiness: report.executionReadiness,
    findingCount: report.findingIds.length,
    generatedAt: report.generatedAt,
    overallScore: report.overallScore,
    recommendedNextActionCount: report.recommendedNextActions.length,
    repoId: report.repoId,
    reportId: report.reportId,
    scanId: report.scanId,
    strengthCount: report.strengths.length,
    summaryLength: report.summary.length,
    taskRecommendationCount: report.taskRecommendationIds.length,
    weaknessCount: report.weaknesses.length,
  };

  assertSafePayload(metadata);

  return metadata;
};

const buildAuditEvent = (input: {
  actorId: string;
  createAuditEventId: () => string;
  eventType: string;
  message: string;
  now: Date;
  report: RepoReadinessReport;
}): AuditEventInsert =>
  createAuditEventInsert({
    actorId: input.actorId,
    createId: input.createAuditEventId,
    eventType: input.eventType,
    message: input.message,
    metadata: auditMetadataForReport(input.report),
    now: () => input.now,
    workspaceId: input.report.workspaceId,
  });

export const createDrizzleRepoReadinessReportStore = (db: Database): RepoReadinessReportStore => ({
  findFindingsByIds: async ({ findingIds, repoId, scanId, workspaceId }) => {
    if (findingIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: schema.findings.id,
        category: schema.findings.category,
        deterministicRuleId: schema.findings.deterministicRuleId,
        repoId: schema.findings.repoId,
        scanId: schema.findings.scanId,
        severity: schema.findings.severity,
        status: schema.findings.status,
        workspaceId: schema.findings.workspaceId,
      })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.workspaceId, workspaceId),
          eq(schema.findings.repoId, repoId),
          eq(schema.findings.scanId, scanId),
          inArray(schema.findings.id, findingIds),
        ),
      );
  },
  findRepoScan: async ({ scanId, workspaceId }) => {
    const [scan] = await db
      .select({
        id: schema.repoScans.id,
        inventory: schema.repoScans.inventory,
        repoId: schema.repoScans.repoId,
        workspaceId: schema.repoScans.workspaceId,
      })
      .from(schema.repoScans)
      .where(and(eq(schema.repoScans.id, scanId), eq(schema.repoScans.workspaceId, workspaceId)))
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
  getLatestReadinessReport: async ({ repoId, workspaceId }) => {
    const [report] = await db
      .select()
      .from(schema.repoReadinessReports)
      .where(
        and(
          eq(schema.repoReadinessReports.workspaceId, workspaceId),
          eq(schema.repoReadinessReports.repoId, repoId),
        ),
      )
      .orderBy(
        desc(schema.repoReadinessReports.generatedAt),
        desc(schema.repoReadinessReports.createdAt),
      )
      .limit(1);

    return report ?? null;
  },
  getReadinessReport: async ({ reportId, workspaceId }) => {
    const [report] = await db
      .select()
      .from(schema.repoReadinessReports)
      .where(
        and(
          eq(schema.repoReadinessReports.workspaceId, workspaceId),
          eq(schema.repoReadinessReports.id, reportId),
        ),
      )
      .limit(1);

    return report ?? null;
  },
  listReadinessReports: async ({ repoId, workspaceId }) =>
    db
      .select()
      .from(schema.repoReadinessReports)
      .where(
        and(
          eq(schema.repoReadinessReports.workspaceId, workspaceId),
          eq(schema.repoReadinessReports.repoId, repoId),
        ),
      )
      .orderBy(
        desc(schema.repoReadinessReports.generatedAt),
        desc(schema.repoReadinessReports.createdAt),
      ),
  upsertReportWithAuditAndScanUpdate: async ({ createAuditEvent, report }) =>
    db.transaction(async (tx) => {
      const [upsertedReport] = await tx
        .insert(schema.repoReadinessReports)
        .values(report)
        .onConflictDoUpdate({
          set: {
            blockedReasons: report.blockedReasons,
            categoryScores: report.categoryScores,
            contractVersion: report.contractVersion,
            executionReadiness: report.executionReadiness,
            findingIds: report.findingIds,
            generatedAt: report.generatedAt,
            overallScore: report.overallScore,
            recommendedNextActions: report.recommendedNextActions,
            repoId: report.repoId,
            strengths: report.strengths,
            summary: report.summary,
            taskRecommendationIds: report.taskRecommendationIds,
            updatedAt: report.updatedAt,
            weaknesses: report.weaknesses,
          },
          target: [schema.repoReadinessReports.workspaceId, schema.repoReadinessReports.scanId],
        })
        .returning();

      if (upsertedReport === undefined) {
        throw new Error("Repo readiness report upsert did not return a row.");
      }

      await tx
        .update(schema.repoScans)
        .set({
          findingIds: upsertedReport.findingIds,
          readinessReportId: upsertedReport.id,
          taskRecommendationIds: upsertedReport.taskRecommendationIds,
          updatedAt: report.updatedAt,
        })
        .where(
          and(
            eq(schema.repoScans.id, upsertedReport.scanId),
            eq(schema.repoScans.workspaceId, upsertedReport.workspaceId),
          ),
        );

      await tx.insert(schema.auditEvents).values(createAuditEvent(upsertedReport));
      await tx
        .insert(schema.usageEvents)
        .values(
          createUsageEventInsert({
            createdAt: upsertedReport.generatedAt,
            idempotencyKey: `usage:${upsertedReport.workspaceId}:readiness_report_generation:${upsertedReport.id}`,
            metadata: {
              executionReadiness: upsertedReport.executionReadiness,
            },
            occurredAt: upsertedReport.generatedAt,
            source: {
              id: upsertedReport.id,
              table: "repo_readiness_reports",
            },
            usageEventType: "readiness_report_generation",
            workspaceId: upsertedReport.workspaceId,
          }),
        )
        .onConflictDoNothing({
          target: [schema.usageEvents.workspaceId, schema.usageEvents.idempotencyKey],
        });

      return upsertedReport;
    }),
});

export const createRepoReadinessReportService = (input: {
  createAuditEventId?: () => string;
  createReportId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RepoReadinessReportStore;
}): RepoReadinessReportService => {
  const createAuditEventId = input.createAuditEventId ?? randomUUID;
  const createReportId = input.createReportId ?? randomUUID;
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    getLatestReadinessReport: async (getInput) => {
      const workspaceId = normalizeId(getInput.workspaceId);
      const repoId = normalizeId(getInput.repoId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const report = await input.store.getLatestReadinessReport({
        repoId,
        workspaceId: scope.workspaceId,
      });

      return report === null ? null : toReport(report);
    },
    getReadinessReport: async (getInput) => {
      const workspaceId = normalizeId(getInput.workspaceId);
      const reportId = normalizeId(getInput.reportId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const report = await input.store.getReadinessReport({
        reportId,
        workspaceId: scope.workspaceId,
      });

      return report === null ? null : toReport(report);
    },
    listReadinessReports: async (listInput) => {
      const workspaceId = normalizeId(listInput.workspaceId);
      const repoId = normalizeId(listInput.repoId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const reports = await input.store.listReadinessReports({
        repoId,
        workspaceId: scope.workspaceId,
      });

      return reports.map(toReport);
    },
    persistReadinessReport: async (persistInput) => {
      const workspaceId = normalizeId(persistInput.workspaceId);
      const repoId = normalizeId(persistInput.repoId);
      const scanId = normalizeId(persistInput.scanId);
      const report = validateReportInput(persistInput.report);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });

      assertMatchingReportScope({
        repoId,
        report,
        scanId,
        workspaceId: scope.workspaceId,
      });

      const scan = await input.store.findRepoScan({
        scanId,
        workspaceId: scope.workspaceId,
      });

      if (scan === null || scan.repoId !== repoId) {
        throw createActionError("validation_error");
      }

      const scopedFindings = await assertFindingScope({
        report,
        store: input.store,
      });
      const executionReadiness = classifyExecutionReadiness({
        findings: scopedFindings,
        inventory: scan.inventory,
        taskRecommendationIds: report.taskRecommendationIds,
      });
      const readinessScores = calculateReadinessScores({
        findings: scopedFindings,
        inventory: scan.inventory,
      });

      const currentTime = now();
      const rowReport = validateReportInput({
        ...report,
        blockedReasons: executionReadiness.blockedReasons,
        categoryScores: readinessScores.categoryScores,
        executionReadiness: executionReadiness.executionReadiness,
        overallScore: readinessScores.overallScore,
        recommendedNextActions: executionReadiness.recommendedNextActions,
        weaknesses: uniquePreservingOrder([...report.weaknesses, ...readinessScores.weaknesses]),
        reportId: normalizeId(createReportId()),
      });
      const row: RepoReadinessReportInsert = {
        blockedReasons: rowReport.blockedReasons,
        categoryScores: rowReport.categoryScores,
        contractVersion: rowReport.contractVersion,
        createdAt: currentTime,
        executionReadiness: rowReport.executionReadiness,
        findingIds: rowReport.findingIds,
        generatedAt: new Date(rowReport.generatedAt),
        id: rowReport.reportId,
        overallScore: rowReport.overallScore,
        recommendedNextActions: rowReport.recommendedNextActions,
        repoId: rowReport.repoId,
        scanId: rowReport.scanId,
        strengths: rowReport.strengths,
        summary: rowReport.summary,
        taskRecommendationIds: rowReport.taskRecommendationIds,
        updatedAt: currentTime,
        weaknesses: rowReport.weaknesses,
        workspaceId: rowReport.workspaceId,
      };
      const upsertedReport = await input.store.upsertReportWithAuditAndScanUpdate({
        createAuditEvent: (persistedReport) =>
          buildAuditEvent({
            actorId: scope.actorId,
            createAuditEventId,
            eventType: "repo_readiness_reports.upserted",
            message: "Repo readiness report persisted.",
            now: currentTime,
            report: toReport(persistedReport),
          }),
        report: row,
      });

      return toReport(upsertedReport);
    },
  };
};
