import "server-only";

import { redactLogText } from "@control-plane/logging";
import type { RunEventSeverity, RunState } from "@control-plane/shared";

import { and, eq, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";

export const AUDIT_LOG_CATEGORIES = [
  "runner",
  "job",
  "cancellation",
  "approval",
  "repair",
  "integration",
  "policy",
  "repository",
  "task",
  "workspace",
] as const;

export const AUDIT_LOG_SOURCES = ["audit_event", "run_event"] as const;

export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORIES)[number];
export type AuditLogCategoryFilter = AuditLogCategory | "all";
export type AuditLogSource = (typeof AUDIT_LOG_SOURCES)[number];
export type AuditLogSourceFilter = AuditLogSource | "all";

export type AuditLogDetail = {
  label: string;
  value: string;
};

export type AuditLogRow = {
  actorId: string | null;
  category: AuditLogCategory;
  details: AuditLogDetail[];
  eventType: string;
  id: string;
  message: string;
  occurredAt: Date;
  runId: string | null;
  runnerId: string | null;
  severity: RunEventSeverity;
  source: AuditLogSource;
  sourceLabel: string;
  taskId: string | null;
  workspaceId: string;
};

export type AuditLogSourceRows = {
  auditEvents: Array<{
    actorId: string | null;
    createdAt: Date;
    eventType: string;
    id: string;
    message: string;
    metadata: Record<string, unknown>;
    runId: string | null;
    runnerId: string | null;
    taskId: string | null;
    workspaceId: string;
  }>;
  claimedRuns: Array<{
    claimedAt: Date;
    claimExpiresAt: Date | null;
    id: string;
    jobId: string;
    jobType: string;
    mode: string;
    runnerId: string | null;
    taskId: string;
    workspaceId: string;
  }>;
  runEvents: Array<{
    createdAt: Date;
    id: string;
    message: string;
    metadata: Record<string, unknown>;
    runId: string;
    runnerId: string | null;
    severity: RunEventSeverity;
    state: RunState;
    workspaceId: string;
  }>;
};

export type AuditLogStore = WorkspaceMembershipStore & {
  listAuditLogSources: (input: {
    limit: number;
    workspaceId: string;
  }) => Promise<AuditLogSourceRows>;
};

export type AuditLogService = {
  listAuditLog: (input: {
    category?: AuditLogCategoryFilter;
    limit?: number;
    source?: AuditLogSourceFilter;
    workspaceId: string;
  }) => Promise<AuditLogRow[]>;
};

const DEFAULT_AUDIT_LOG_LIMIT = 50;
const MAX_AUDIT_LOG_LIMIT = 100;
const SOURCE_LIMIT_MULTIPLIER = 3;

const categorySet = new Set<AuditLogCategory>(AUDIT_LOG_CATEGORIES);
const sourceSet = new Set<AuditLogSource>(AUDIT_LOG_SOURCES);

const policyRiskCategories = new Set([
  "auth",
  "billing",
  "dirty_repo",
  "generated_files",
  "infrastructure",
  "large_diff",
  "missing_capability",
  "missing_mapping",
  "missing_validation",
  "migration",
  "package_lock",
  "protected_branch",
  "protected_path",
  "secret",
  "sensitive_path",
  "stale_lock",
  "validation_failed",
  "validation_skipped",
]);

const duplicateAssignmentRiskCategory = "duplicate_assignment";

const consequentialRunStates = new Set<RunState>([
  "awaiting_approval",
  "blocked",
  "cancel_requested",
  "cancelling",
  "cancelled",
  "claimed",
  "failed",
  "pr_opened",
  "repair_requested",
]);
const consequentialRunStatesForQuery = [...consequentialRunStates];

const normalizeWorkspaceId = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();

  if (normalizedWorkspaceId.length === 0) {
    throw createActionError("validation_error");
  }

  return normalizedWorkspaceId;
};

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_AUDIT_LOG_LIMIT;
  }

  if (!Number.isFinite(limit)) {
    throw createActionError("validation_error");
  }

  const normalizedLimit = Math.floor(limit);

  if (normalizedLimit <= 0) {
    throw createActionError("validation_error");
  }

  return Math.min(normalizedLimit, MAX_AUDIT_LOG_LIMIT);
};

const normalizeCategoryFilter = (
  category: AuditLogCategoryFilter | undefined,
): AuditLogCategoryFilter => {
  if (category === undefined || category === "all") {
    return "all";
  }

  if (!categorySet.has(category)) {
    throw createActionError("validation_error");
  }

  return category;
};

const normalizeSourceFilter = (source: AuditLogSourceFilter | undefined): AuditLogSourceFilter => {
  if (source === undefined || source === "all") {
    return "all";
  }

  if (!sourceSet.has(source)) {
    throw createActionError("validation_error");
  }

  return source;
};

const unsafeDisplayTextPattern =
  /(?:diff --git|@@|-----BEGIN|raw\s*(?:source|patch|log|output)|source\s*code|sourceCode|\b(?:command\s*output|credential|patch|rawLog|rawOutput|snippet|stdout|stderr)\b|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:\/Users\/|\/private\/|\/var\/folders\/|\/tmp\/)|[A-Za-z]:\\|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)/i;

const safeText = (value: string, fallback: string): string => {
  const redacted = redactLogText(value).text.trim();

  if (redacted.length === 0 || unsafeDisplayTextPattern.test(redacted)) {
    return fallback;
  }

  return redacted;
};

const eventTypeToMessage = (eventType: string): string =>
  `${eventType
    .replace(/[_:.]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")}.`;

const detailFields = [
  ["approvalDecisionId", "Approval", "id"],
  ["decision", "Decision", "enum"],
  ["reasonLength", "Reason length", "number"],
  ["reasonRedactionApplied", "Reason redacted", "boolean"],
  ["runStateAtDecision", "Run state", "enum"],
  ["targetState", "Target state", "enum"],
  ["runnerId", "Runner", "id"],
  ["pairingId", "Pairing", "id"],
  ["ttlSeconds", "TTL seconds", "number"],
  ["expiresAt", "Expires", "date"],
  ["revokedAt", "Revoked", "date"],
  ["claimingRunnerId", "Claiming runner", "id"],
  ["claimedByRunnerId", "Claimed by", "id"],
  ["claimExpiresAt", "Claim expires", "date"],
  ["conflictReason", "Conflict", "enum"],
  ["jobId", "Job", "id"],
  ["jobType", "Job type", "enum"],
  ["riskCategory", "Risk", "enum"],
  ["mode", "Mode", "enum"],
  ["originType", "Origin", "enum"],
  ["status", "Status", "enum"],
  ["repoMappingId", "Repository mapping", "id"],
  ["repositoryId", "Repository", "id"],
  ["taskId", "Task", "id"],
  ["acceptanceCriteriaCount", "Acceptance criteria", "number"],
  ["acceptanceCriteriaTotalLength", "Acceptance criteria length", "number"],
  ["contextFilePathCount", "Context file paths", "number"],
  ["externalIdLength", "External id length", "number"],
  ["externalUrlLength", "External URL length", "number"],
  ["objectiveLength", "Objective length", "number"],
  ["titleLength", "Title length", "number"],
  ["defaultBranchLength", "Default branch length", "number"],
  ["localPathLength", "Local path length", "number"],
  ["remoteUrlLength", "Remote URL length", "number"],
  ["repositoryNameLength", "Repository name length", "number"],
  ["repositoryOwnerLength", "Repository owner length", "number"],
] as const;

const toDisplayEnum = (value: string): string => value.replace(/[_-]+/g, " ");

const formatDetailValue = (
  key: string,
  value: unknown,
  kind: (typeof detailFields)[number][2],
): string | null => {
  if (typeof value === "string") {
    const formattedValue = kind === "enum" ? toDisplayEnum(value) : value;
    const safeValue = safeText(formattedValue, "");

    return safeValue.length === 0 ? null : safeValue;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (key.endsWith("At") && typeof value === "object" && value !== null) {
    return null;
  }

  return null;
};

const summarizeMetadata = (metadata: Record<string, unknown>): AuditLogDetail[] =>
  detailFields.flatMap(([key, label, kind]) => {
    if (!(key in metadata)) {
      return [];
    }

    const value = formatDetailValue(key, metadata[key], kind);

    return value === null ? [] : [{ label, value }];
  });

const getRiskCategory = (metadata: Record<string, unknown>): string | null =>
  typeof metadata.riskCategory === "string" ? metadata.riskCategory : null;

const getMetadataId = (metadata: Record<string, unknown>, key: string): string | null => {
  const value = metadata[key];

  if (typeof value !== "string") {
    return null;
  }

  const safeValue = safeText(value, "");

  return safeValue.length === 0 ? null : safeValue;
};

const isSecurityRisk = (metadata: Record<string, unknown>): boolean => {
  const riskCategory = getRiskCategory(metadata);

  return riskCategory !== null && policyRiskCategories.has(riskCategory);
};

const categoryForAuditEvent = (
  eventType: string,
  metadata: Record<string, unknown>,
): AuditLogCategory => {
  if (eventType.startsWith("runner.") || eventType.startsWith("runner_pairing.")) {
    return "runner";
  }

  if (eventType.includes("cancel")) {
    return "cancellation";
  }

  if (eventType.includes("approval")) {
    return "approval";
  }

  if (eventType.includes("repair")) {
    return "repair";
  }

  if (eventType.startsWith("integration.")) {
    return "integration";
  }

  if (eventType.startsWith("repo_mapping.") || eventType.startsWith("repository.")) {
    return "repository";
  }

  if (eventType.startsWith("task.")) {
    return "task";
  }

  if (eventType.includes("policy") || eventType.includes("security") || isSecurityRisk(metadata)) {
    return "policy";
  }

  if (eventType.startsWith("run.") || eventType.includes("job") || eventType.includes("cancel")) {
    return "job";
  }

  return "workspace";
};

const categoryForRunEvent = (
  state: RunState,
  severity: RunEventSeverity,
  metadata: Record<string, unknown>,
): AuditLogCategory => {
  const riskCategory = getRiskCategory(metadata);

  if (riskCategory === duplicateAssignmentRiskCategory || state === "claimed") {
    return "job";
  }

  if (state === "cancel_requested" || state === "cancelling" || state === "cancelled") {
    return "cancellation";
  }

  if (state === "repair_requested") {
    return "repair";
  }

  if (state === "awaiting_approval") {
    return "approval";
  }

  if (severity === "blocked" || state === "blocked" || isSecurityRisk(metadata)) {
    return "policy";
  }

  return "job";
};

const shouldIncludeRunEvent = (row: AuditLogSourceRows["runEvents"][number]): boolean =>
  consequentialRunStates.has(row.state) || row.severity === "blocked";

const toAuditEventRow = (row: AuditLogSourceRows["auditEvents"][number]): AuditLogRow | null => {
  const category = categoryForAuditEvent(row.eventType, row.metadata);

  return {
    actorId: row.actorId,
    category,
    details: summarizeMetadata(row.metadata),
    eventType: row.eventType,
    id: `audit:${row.id}`,
    message: safeText(row.message, eventTypeToMessage(row.eventType)),
    occurredAt: row.createdAt,
    runId: row.runId,
    runnerId: row.runnerId,
    severity: category === "policy" ? "blocked" : "info",
    source: "audit_event",
    sourceLabel: "Audit event",
    taskId: row.taskId,
    workspaceId: row.workspaceId,
  };
};

const toRunEventRow = (row: AuditLogSourceRows["runEvents"][number]): AuditLogRow => {
  const eventType =
    getRiskCategory(row.metadata) === duplicateAssignmentRiskCategory
      ? "run.duplicate_assignment_blocked"
      : `run.${row.state}`;

  return {
    actorId: null,
    category: categoryForRunEvent(row.state, row.severity, row.metadata),
    details: summarizeMetadata(row.metadata),
    eventType,
    id: `run-event:${row.id}`,
    message: safeText(row.message, eventTypeToMessage(eventType)),
    occurredAt: row.createdAt,
    runId: row.runId,
    runnerId: row.runnerId,
    severity: row.severity,
    source: "run_event",
    sourceLabel: "Run event",
    taskId: getMetadataId(row.metadata, "taskId"),
    workspaceId: row.workspaceId,
  };
};

const toClaimedRunRow = (row: AuditLogSourceRows["claimedRuns"][number]): AuditLogRow => {
  const metadata = {
    ...(row.claimExpiresAt === null ? {} : { claimExpiresAt: row.claimExpiresAt }),
    ...(row.runnerId === null ? {} : { runnerId: row.runnerId }),
    jobId: row.jobId,
    jobType: row.jobType,
    mode: row.mode,
    status: "claimed",
    taskId: row.taskId,
  };

  return {
    actorId: null,
    category: "job",
    details: summarizeMetadata(metadata),
    eventType: "run.claimed",
    id: `run-claim:${row.id}`,
    message: "Job claimed.",
    occurredAt: row.claimedAt,
    runId: row.id,
    runnerId: row.runnerId,
    severity: "info",
    source: "run_event",
    sourceLabel: "Run record",
    taskId: getMetadataId(metadata, "taskId"),
    workspaceId: row.workspaceId,
  };
};

const compareRows = (left: AuditLogRow, right: AuditLogRow): number => {
  const timeDifference = right.occurredAt.getTime() - left.occurredAt.getTime();

  return timeDifference === 0 ? left.id.localeCompare(right.id) : timeDifference;
};

export const createDrizzleAuditLogStore = (db: Database): AuditLogStore => ({
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
  listAuditLogSources: async ({ limit, workspaceId }) => {
    const [auditEvents, runEvents, claimedRuns] = await Promise.all([
      db.query.auditEvents.findMany({
        columns: {
          actorId: true,
          createdAt: true,
          eventType: true,
          id: true,
          message: true,
          metadata: true,
          runId: true,
          runnerId: true,
          taskId: true,
          workspaceId: true,
        },
        limit,
        orderBy: (fields, { desc }) => [desc(fields.createdAt)],
        where: (fields, { eq }) => eq(fields.workspaceId, workspaceId),
      }),
      db.query.runEvents.findMany({
        columns: {
          createdAt: true,
          id: true,
          message: true,
          metadata: true,
          runId: true,
          runnerId: true,
          severity: true,
          state: true,
          workspaceId: true,
        },
        limit,
        orderBy: (fields, { desc }) => [desc(fields.createdAt)],
        where: (fields, { and, eq, inArray, or }) =>
          and(
            eq(fields.workspaceId, workspaceId),
            or(
              inArray(fields.state, consequentialRunStatesForQuery),
              eq(fields.severity, "blocked"),
            ),
          ),
      }),
      db.query.runs.findMany({
        columns: {
          claimedAt: true,
          claimExpiresAt: true,
          id: true,
          jobId: true,
          jobType: true,
          mode: true,
          runnerId: true,
          taskId: true,
          workspaceId: true,
        },
        limit,
        orderBy: (fields, { desc }) => [desc(fields.claimedAt)],
        where: (fields, { and, eq, isNotNull }) =>
          and(eq(fields.workspaceId, workspaceId), isNotNull(fields.claimedAt)),
      }),
    ]);

    return {
      auditEvents: auditEvents.map((row) => ({
        ...row,
        metadata: row.metadata as Record<string, unknown>,
      })),
      claimedRuns: claimedRuns.flatMap((row) =>
        row.claimedAt === null
          ? []
          : [
              {
                ...row,
                claimedAt: row.claimedAt,
              },
            ],
      ),
      runEvents: runEvents.map((row) => ({
        ...row,
        metadata: row.metadata as Record<string, unknown>,
      })),
    };
  },
});

export const createAuditLogService = (input: {
  getAuthContext?: GetAuthContext;
  store: AuditLogStore;
}): AuditLogService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listAuditLog: async ({ category, limit, source, workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const normalizedLimit = normalizeLimit(limit);
      const categoryFilter = normalizeCategoryFilter(category);
      const sourceFilter = normalizeSourceFilter(source);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const sourceRows = await input.store.listAuditLogSources({
        limit: normalizedLimit * SOURCE_LIMIT_MULTIPLIER,
        workspaceId: scope.workspaceId,
      });
      const claimedRunIdsWithEvents = new Set(
        sourceRows.runEvents.filter((row) => row.state === "claimed").map((row) => row.runId),
      );
      const rows = [
        ...sourceRows.auditEvents.map(toAuditEventRow),
        ...sourceRows.runEvents.filter(shouldIncludeRunEvent).map(toRunEventRow),
        ...sourceRows.claimedRuns
          .filter((row) => !claimedRunIdsWithEvents.has(row.id))
          .map(toClaimedRunRow),
      ].filter((row): row is AuditLogRow => row !== null && row.workspaceId === scope.workspaceId);

      return rows
        .filter((row) => categoryFilter === "all" || row.category === categoryFilter)
        .filter((row) => sourceFilter === "all" || row.source === sourceFilter)
        .sort(compareRows)
        .slice(0, normalizedLimit);
    },
  };
};
