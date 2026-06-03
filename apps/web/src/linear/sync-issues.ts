import "server-only";

import { randomUUID } from "node:crypto";

import { redactLogText } from "@control-plane/logging";

import {
  and,
  desc,
  eq,
  isNull,
  schema,
  sql,
  type Database,
  type LinearIssueCandidate,
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
  DEFAULT_LINEAR_ISSUE_ELIGIBILITY,
  filterReadyLinearIssueCandidates,
  isLinearIssueReadyForAi,
  type LinearIssueEligibilityConfig,
} from "./eligibility";

export const LINEAR_ISSUE_SYNC_DEFAULT_LIMIT = 50;
export const LINEAR_ISSUE_SYNC_MAX_LIMIT = 100;
export const LINEAR_ISSUE_BODY_SUMMARY_MAX_LENGTH = 500;
export const LINEAR_ISSUE_COMMENTS_SUMMARY_MAX_LENGTH = 500;

const requiredTextMaxLength = 240;
const titleMaxLength = 240;
const statusMaxLength = 120;
const labelMaxLength = 80;
const maxLabelCount = 50;
const projectNameMaxLength = 160;
const urlMaxLength = 512;

const unsafeMetadataTextPattern =
  /(?:diff --git|@@|-----BEGIN|(?:api[_-]?key|apikey|access[_-]?token|accessToken|auth[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|private[_-]?key|token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|lin_api_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/iu;
const unsafeUrlQueryKeyPattern =
  /(?:access[_-]?token|api[_-]?key|client[_-]?secret|password|secret|token)/iu;
const unsafeSourceLikeTextPatterns = [
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /```/i,
  /\bprocess\.env\.[A-Z0-9_]+\b/i,
] as const;
const unsafeMetadataSourceLikeTextPatterns = [
  /(^|\n)\s*import\s+(?:[\s\S]+?\s+from\s+)?["'][^"']+["']\s*;?\s*(?=\n|$)/i,
  /(^|\n)\s*export\s+(?:default\s+)?(?:const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/i,
  /(^|\n)\s*function\s+[A-Za-z_$][\w$]*\s*\(/i,
  /(^|\n)\s*class\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/i,
  /(^|\n)\s*(?:type|interface|enum)\s+[A-Za-z_$][\w$]*\s*(?:=|\{|extends\b)/i,
  /```/i,
  /\bprocess\.env\.[A-Z0-9_]+\b/i,
] as const;
const unsafeSummaryTextPatterns = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)\s*(?:std(?:out|err)|raw output|command output|test logs?)\s*:/i,
  /(^|\n)\s*(?:npm|pnpm|yarn)\s+(?:ERR!|error\b)/i,
  /(^|\n)\s*(?:FAIL|PASS)\s+(?:\S*[\\/])?\S+\.(?:test|spec)\.[cm]?[jt]sx?\b/i,
  /(^|\n)\s*(?:\d+\s+(?:passing|failing|failed)|\d+\s+tests?\s+failed)\b/i,
  /(^|\n)\s*Test Files\s+\d+/i,
  /(^|\n)\s*at\s+(?:[A-Za-z_$][\w$<>.]*)?\s*\(?[^)\n]+:\d+:\d+\)?/i,
  /(^|\n)\s*Traceback \(most recent call last\):/i,
  ...unsafeSourceLikeTextPatterns,
] as const;

type LinearOAuthConnectionRow = typeof schema.linearOAuthConnections.$inferSelect;
type LinearIssueCandidateInsert = typeof schema.linearIssueCandidates.$inferInsert;

export type LinearIssueSyncConnection = Pick<
  LinearOAuthConnectionRow,
  "expiresAt" | "id" | "linearWorkspaceId" | "workspaceId"
>;

export type LinearIssueSyncComment = {
  readonly body?: string | null;
  readonly summary?: string | null;
  readonly text?: string | null;
};

export type LinearIssueSyncIssue = {
  readonly body?: string | null;
  readonly bodySummary?: string | null;
  readonly comments?: readonly LinearIssueSyncComment[];
  readonly commentsSummary?: string | null;
  readonly description?: string | null;
  readonly identifier: string;
  readonly issueId: string;
  readonly labels?: readonly string[];
  readonly project?: {
    readonly id?: string | null;
    readonly name?: string | null;
  } | null;
  readonly projectId?: string | null;
  readonly projectName?: string | null;
  readonly state?: {
    readonly name?: string | null;
  } | null;
  readonly stateName?: string | null;
  readonly status?: string | null;
  readonly title: string;
  readonly updatedAt: Date | string;
  readonly url?: string | null;
};

export type LinearIssueSyncClient = {
  listIssues: (input: {
    connection: Pick<LinearIssueSyncConnection, "id" | "linearWorkspaceId" | "workspaceId">;
    limit: number;
  }) => Promise<readonly LinearIssueSyncIssue[]>;
};

export type LinearIssueCandidateData = Pick<
  LinearIssueCandidate,
  | "bodySummary"
  | "commentsSummary"
  | "createdAt"
  | "id"
  | "identifier"
  | "labels"
  | "lastSyncedAt"
  | "linearConnectionId"
  | "linearIssueId"
  | "linearUpdatedAt"
  | "linearWorkspaceId"
  | "projectId"
  | "projectName"
  | "redactionApplied"
  | "status"
  | "title"
  | "updatedAt"
  | "url"
  | "workspaceId"
>;

export type SyncLinearIssuesInput = {
  linearConnectionId: string;
  limit?: number;
  workspaceId: string;
};

export type SyncLinearIssuesResult = {
  candidateCount: number;
  candidates: LinearIssueCandidateData[];
  connectionId: string;
  linearWorkspaceId: string;
  redactedCount: number;
  skippedIssueCount: number;
  syncedAt: Date;
  syncedIssueCount: number;
  workspaceId: string;
};

export type ListLinearIssueCandidatesInput = {
  workspaceId: string;
};

export type UpsertLinearIssueCandidatesWithAuditInput = {
  auditEvent: AuditEventInsert;
  candidates: LinearIssueCandidateInsert[];
};

export type LinearIssueSyncStore = WorkspaceMembershipStore & {
  findActiveLinearOAuthConnection: (input: {
    linearConnectionId: string;
    now: Date;
    workspaceId: string;
  }) => Promise<LinearIssueSyncConnection | null>;
  upsertLinearIssueCandidatesWithAudit: (
    input: UpsertLinearIssueCandidatesWithAuditInput,
  ) => Promise<LinearIssueCandidate[]>;
  listLinearIssueCandidates: (input: { workspaceId: string }) => Promise<LinearIssueCandidate[]>;
};

export type LinearIssueSyncService = {
  listLinearIssueCandidates: (
    input: ListLinearIssueCandidatesInput,
  ) => Promise<LinearIssueCandidateData[]>;
  syncLinearIssues: (input: SyncLinearIssuesInput) => Promise<SyncLinearIssuesResult>;
};

type SummaryResult = {
  redactionApplied: boolean;
  text: string;
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

const hasUnsafeMetadataSourceLikeText = (value: string): boolean =>
  unsafeMetadataSourceLikeTextPatterns.some((pattern) => pattern.test(value));

const assertSafeBoundedText = (value: string, maxLength = requiredTextMaxLength): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    unsafeMetadataTextPattern.test(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const assertSafeMetadataText = (value: string, maxLength = requiredTextMaxLength): string => {
  const normalizedValue = assertSafeBoundedText(value, maxLength);

  if (
    redactLogText(normalizedValue).redactionApplied ||
    hasUnsafeMetadataSourceLikeText(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeWorkspaceId = (value: string): string => assertSafeBoundedText(value);

const normalizeLinearId = (value: string): string => {
  const normalizedValue = assertSafeBoundedText(value);

  if (!/^[A-Za-z0-9._:-]+$/u.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalSafeText = (
  value: string | null | undefined,
  maxLength = requiredTextMaxLength,
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return assertSafeMetadataText(value, maxLength);
};

const normalizeStatus = (issue: LinearIssueSyncIssue): string => {
  const status = issue.status ?? issue.stateName ?? issue.state?.name;

  if (status === undefined || status === null) {
    throw createActionError("validation_error");
  }

  return assertSafeMetadataText(status, statusMaxLength);
};

const normalizeOptionalUrl = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = assertSafeBoundedText(value, urlMaxLength);

  try {
    const url = new URL(normalizedValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      Boolean(url.username || url.password)
    ) {
      throw createActionError("validation_error");
    }

    for (const key of url.searchParams.keys()) {
      if (unsafeUrlQueryKeyPattern.test(key)) {
        throw createActionError("validation_error");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ServerActionError") {
      throw error;
    }

    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeLabels = (labels: readonly string[] | undefined): string[] => {
  const normalizedLabels: string[] = [];
  const seenLabels = new Set<string>();

  for (const label of labels ?? []) {
    const normalizedLabel = assertSafeMetadataText(label, labelMaxLength);

    if (seenLabels.has(normalizedLabel)) {
      continue;
    }

    seenLabels.add(normalizedLabel);
    normalizedLabels.push(normalizedLabel);

    if (normalizedLabels.length > maxLabelCount) {
      throw createActionError("validation_error");
    }
  }

  return normalizedLabels;
};

const normalizeTimestamp = (value: Date | string): Date => {
  const date = value instanceof Date ? value : new Date(assertSafeBoundedText(value, 80));

  if (!Number.isFinite(date.getTime())) {
    throw createActionError("validation_error");
  }

  return date;
};

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/\n{2,}/gu, "\n")
    .trim();

const hasUnsafeSummaryText = (value: string): boolean =>
  unsafeSummaryTextPatterns.some((pattern) => pattern.test(value));

const truncateSummary = (value: string, maxLength: number): SummaryResult => {
  if (value.length <= maxLength) {
    return {
      redactionApplied: false,
      text: value,
    };
  }

  return {
    redactionApplied: true,
    text: `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`,
  };
};

const summarizeText = (value: string | null | undefined, maxLength: number): SummaryResult => {
  if (value === undefined || value === null || value.trim().length === 0) {
    return {
      redactionApplied: false,
      text: "",
    };
  }

  const redacted = redactLogText(value);
  const normalizedText = normalizeWhitespace(redacted.text);

  if (hasUnsafeSummaryText(normalizedText)) {
    return {
      redactionApplied: true,
      text: "[redacted]",
    };
  }

  const truncated = truncateSummary(normalizedText, maxLength);

  return {
    redactionApplied: redacted.redactionApplied || truncated.redactionApplied,
    text: truncated.text,
  };
};

const getIssueBodyText = (issue: LinearIssueSyncIssue): string | null =>
  issue.bodySummary ?? issue.body ?? issue.description ?? null;

const getCommentText = (comment: LinearIssueSyncComment): string | null =>
  comment.summary ?? comment.body ?? comment.text ?? null;

const getIssueCommentsText = (issue: LinearIssueSyncIssue): string | null => {
  if (issue.commentsSummary !== undefined && issue.commentsSummary !== null) {
    return issue.commentsSummary;
  }

  const commentTexts = (issue.comments ?? [])
    .map(getCommentText)
    .filter((commentText): commentText is string => commentText !== null);

  return commentTexts.length === 0 ? null : commentTexts.join("\n");
};

const normalizeSyncLimit = (value: number | undefined): number => {
  const limit = value ?? LINEAR_ISSUE_SYNC_DEFAULT_LIMIT;

  if (!Number.isInteger(limit) || limit < 1 || limit > LINEAR_ISSUE_SYNC_MAX_LIMIT) {
    throw createActionError("validation_error");
  }

  return limit;
};

const toIssueEligibilityCandidate = (
  issue: LinearIssueSyncIssue,
): { labels: readonly string[]; status: string | null } => ({
  labels: issue.labels ?? [],
  status: issue.status ?? issue.stateName ?? issue.state?.name ?? null,
});

const toStoredLinearIssueKey = (
  candidate: Pick<LinearIssueCandidate, "linearIssueId" | "linearWorkspaceId">,
): string => `${candidate.linearWorkspaceId}\u0000${candidate.linearIssueId}`;

const toSyncedLinearIssueKey = (
  connection: Pick<LinearIssueSyncConnection, "linearWorkspaceId">,
  issue: Pick<LinearIssueSyncIssue, "issueId">,
): string => `${connection.linearWorkspaceId}\u0000${issue.issueId.trim()}`;

const toCandidateData = (row: LinearIssueCandidate): LinearIssueCandidateData => {
  const bodySummary = summarizeText(row.bodySummary, LINEAR_ISSUE_BODY_SUMMARY_MAX_LENGTH);
  const commentsSummary = summarizeText(
    row.commentsSummary,
    LINEAR_ISSUE_COMMENTS_SUMMARY_MAX_LENGTH,
  );

  return {
    bodySummary: bodySummary.text,
    commentsSummary: commentsSummary.text,
    createdAt: row.createdAt,
    id: normalizeLinearId(row.id),
    identifier: assertSafeMetadataText(row.identifier, requiredTextMaxLength),
    labels: normalizeLabels(row.labels),
    lastSyncedAt: row.lastSyncedAt,
    linearConnectionId: normalizeLinearId(row.linearConnectionId),
    linearIssueId: normalizeLinearId(row.linearIssueId),
    linearUpdatedAt: row.linearUpdatedAt,
    linearWorkspaceId: normalizeLinearId(row.linearWorkspaceId),
    projectId: normalizeOptionalSafeText(row.projectId, requiredTextMaxLength),
    projectName: normalizeOptionalSafeText(row.projectName, projectNameMaxLength),
    redactionApplied:
      row.redactionApplied || bodySummary.redactionApplied || commentsSummary.redactionApplied,
    status: assertSafeMetadataText(row.status, statusMaxLength),
    title: assertSafeMetadataText(row.title, titleMaxLength),
    updatedAt: row.updatedAt,
    url: normalizeOptionalUrl(row.url),
    workspaceId: normalizeWorkspaceId(row.workspaceId),
  };
};

const normalizeIssueCandidate = (input: {
  connection: LinearIssueSyncConnection;
  createCandidateId: () => string;
  issue: LinearIssueSyncIssue;
  syncedAt: Date;
}): LinearIssueCandidateInsert => {
  const bodySummary = summarizeText(
    getIssueBodyText(input.issue),
    LINEAR_ISSUE_BODY_SUMMARY_MAX_LENGTH,
  );
  const commentsSummary = summarizeText(
    getIssueCommentsText(input.issue),
    LINEAR_ISSUE_COMMENTS_SUMMARY_MAX_LENGTH,
  );
  const redactionApplied = bodySummary.redactionApplied || commentsSummary.redactionApplied;

  return {
    bodySummary: bodySummary.text,
    commentsSummary: commentsSummary.text,
    createdAt: input.syncedAt,
    id: normalizeLinearId(input.createCandidateId()),
    identifier: assertSafeMetadataText(input.issue.identifier, requiredTextMaxLength),
    labels: normalizeLabels(input.issue.labels),
    lastSyncedAt: input.syncedAt,
    linearConnectionId: input.connection.id,
    linearIssueId: normalizeLinearId(input.issue.issueId),
    linearUpdatedAt: normalizeTimestamp(input.issue.updatedAt),
    linearWorkspaceId: input.connection.linearWorkspaceId,
    projectId: normalizeOptionalSafeText(
      input.issue.projectId ?? input.issue.project?.id,
      requiredTextMaxLength,
    ),
    projectName: normalizeOptionalSafeText(
      input.issue.projectName ?? input.issue.project?.name,
      projectNameMaxLength,
    ),
    redactionApplied,
    status: normalizeStatus(input.issue),
    title: assertSafeMetadataText(input.issue.title, titleMaxLength),
    updatedAt: input.syncedAt,
    url: normalizeOptionalUrl(input.issue.url),
    workspaceId: input.connection.workspaceId,
  };
};

const assertConnectionCanSync = (
  connection: LinearIssueSyncConnection | null,
  syncedAt: Date,
): LinearIssueSyncConnection => {
  if (connection === null || (connection.expiresAt !== null && connection.expiresAt <= syncedAt)) {
    throw createActionError("validation_error");
  }

  return connection;
};

export const createDrizzleLinearIssueSyncStore = (db: Database): LinearIssueSyncStore => ({
  findActiveLinearOAuthConnection: async ({ linearConnectionId, workspaceId }) => {
    const [connection] = await db
      .select({
        expiresAt: schema.linearOAuthConnections.expiresAt,
        id: schema.linearOAuthConnections.id,
        linearWorkspaceId: schema.linearOAuthConnections.linearWorkspaceId,
        workspaceId: schema.linearOAuthConnections.workspaceId,
      })
      .from(schema.linearOAuthConnections)
      .where(
        and(
          eq(schema.linearOAuthConnections.id, linearConnectionId),
          eq(schema.linearOAuthConnections.workspaceId, workspaceId),
          isNull(schema.linearOAuthConnections.revokedAt),
        ),
      )
      .limit(1);

    return connection ?? null;
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
  listLinearIssueCandidates: async ({ workspaceId }) =>
    db
      .select()
      .from(schema.linearIssueCandidates)
      .where(eq(schema.linearIssueCandidates.workspaceId, workspaceId))
      .orderBy(desc(schema.linearIssueCandidates.lastSyncedAt)),
  upsertLinearIssueCandidatesWithAudit: async ({ auditEvent, candidates }) =>
    db.transaction(async (tx) => {
      const upsertedCandidates =
        candidates.length === 0
          ? []
          : await tx
              .insert(schema.linearIssueCandidates)
              .values(candidates)
              .onConflictDoUpdate({
                set: {
                  bodySummary: sql`excluded.body_summary`,
                  commentsSummary: sql`excluded.comments_summary`,
                  identifier: sql`excluded.identifier`,
                  labels: sql`excluded.labels`,
                  lastSyncedAt: sql`excluded.last_synced_at`,
                  linearConnectionId: sql`excluded.linear_oauth_connection_id`,
                  linearUpdatedAt: sql`excluded.linear_updated_at`,
                  linearWorkspaceId: sql`excluded.linear_workspace_id`,
                  projectId: sql`excluded.project_id`,
                  projectName: sql`excluded.project_name`,
                  redactionApplied: sql`excluded.redaction_applied`,
                  status: sql`excluded.status`,
                  title: sql`excluded.title`,
                  updatedAt: sql`excluded.updated_at`,
                  url: sql`excluded.url`,
                },
                target: [
                  schema.linearIssueCandidates.workspaceId,
                  schema.linearIssueCandidates.linearWorkspaceId,
                  schema.linearIssueCandidates.linearIssueId,
                ],
              })
              .returning();

      await tx.insert(schema.auditEvents).values(auditEvent);

      return upsertedCandidates;
    }),
});

export const createLinearIssueSyncService = (input: {
  client: LinearIssueSyncClient;
  createAuditEventId?: () => string;
  createCandidateId?: () => string;
  eligibility?: LinearIssueEligibilityConfig;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: LinearIssueSyncStore;
}): LinearIssueSyncService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());
  const createCandidateId = input.createCandidateId ?? randomUUID;
  const eligibility = input.eligibility ?? DEFAULT_LINEAR_ISSUE_ELIGIBILITY;

  return {
    listLinearIssueCandidates: async (listInput) => {
      const workspaceId = normalizeWorkspaceId(listInput.workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const candidates = await input.store.listLinearIssueCandidates({
        workspaceId: scope.workspaceId,
      });

      return filterReadyLinearIssueCandidates(candidates, eligibility).map(toCandidateData);
    },
    syncLinearIssues: async (syncInput) => {
      const workspaceId = normalizeWorkspaceId(syncInput.workspaceId);
      const linearConnectionId = normalizeLinearId(syncInput.linearConnectionId);
      const limit = normalizeSyncLimit(syncInput.limit);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId,
      });
      const syncedAt = now();
      const connection = assertConnectionCanSync(
        await input.store.findActiveLinearOAuthConnection({
          linearConnectionId,
          now: syncedAt,
          workspaceId: scope.workspaceId,
        }),
        syncedAt,
      );
      const rawIssues = await input.client.listIssues({
        connection: {
          id: connection.id,
          linearWorkspaceId: connection.linearWorkspaceId,
          workspaceId: connection.workspaceId,
        },
        limit,
      });
      const issues = rawIssues.slice(0, limit);
      const issuesWithEligibility = issues.map((issue) => ({
        isReady: isLinearIssueReadyForAi(toIssueEligibilityCandidate(issue), eligibility),
        issue,
      }));
      const readyIssueCount = issuesWithEligibility.filter(({ isReady }) => isReady).length;
      const existingCandidates = await input.store.listLinearIssueCandidates({
        workspaceId: scope.workspaceId,
      });
      const existingIssueKeys = new Set(existingCandidates.map(toStoredLinearIssueKey));
      const issuesToPersist = issuesWithEligibility
        .filter(
          ({ isReady, issue }) =>
            isReady || existingIssueKeys.has(toSyncedLinearIssueKey(connection, issue)),
        )
        .map(({ issue }) => issue);
      const skippedIssueCount = rawIssues.length - readyIssueCount;
      const candidates = issuesToPersist.map((issue) =>
        normalizeIssueCandidate({
          connection,
          createCandidateId,
          issue,
          syncedAt,
        }),
      );
      const readyCandidates = candidates.filter((candidate) =>
        isLinearIssueReadyForAi(
          {
            labels: candidate.labels ?? [],
            status: candidate.status,
          },
          eligibility,
        ),
      );
      const redactedCount = readyCandidates.filter(
        (candidate) => candidate.redactionApplied,
      ).length;
      const candidateCount = readyCandidates.length;
      const syncedIssueCount = readyCandidates.length;
      const auditEvent = createAuditEventInsert({
        actorId: scope.actorId,
        createId: input.createAuditEventId ?? randomUUID,
        eventType: "linear_issue_candidates.synced",
        message: "Linear issues synced.",
        metadata: {
          candidateCount,
          redactedCount,
          skippedIssueCount,
          syncedIssueCount,
        },
        now: () => syncedAt,
        workspaceId: scope.workspaceId,
      });
      const storedCandidates = await input.store.upsertLinearIssueCandidatesWithAudit({
        auditEvent,
        candidates,
      });
      const candidateData = filterReadyLinearIssueCandidates(storedCandidates, eligibility).map(
        toCandidateData,
      );

      return {
        candidateCount: candidateData.length,
        candidates: candidateData,
        connectionId: connection.id,
        linearWorkspaceId: connection.linearWorkspaceId,
        redactedCount: candidateData.filter((candidate) => candidate.redactionApplied).length,
        skippedIssueCount,
        syncedAt,
        syncedIssueCount,
        workspaceId: scope.workspaceId,
      };
    },
  };
};
