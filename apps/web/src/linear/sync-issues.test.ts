import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import type {
  LinearIssueSyncIssue,
  UpsertLinearIssueCandidatesWithAuditInput,
} from "./sync-issues";
import type { LinearIssueEligibilityConfig } from "./eligibility";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));
vi.mock("../jobs/manual-queue", () => ({
  queueManualJob: vi.fn(),
}));

const importSyncIssues = async () => import("./sync-issues");

type StoredLinearOAuthConnection = {
  expiresAt: Date | null;
  id: string;
  linearWorkspaceId: string;
  revokedAt: Date | null;
  workspaceId: string;
};

type StoredLinearIssueCandidate = {
  bodySummary: string;
  commentsSummary: string;
  createdAt: Date;
  id: string;
  identifier: string;
  labels: string[];
  lastSyncedAt: Date;
  linearConnectionId: string;
  linearIssueId: string;
  linearUpdatedAt: Date;
  linearWorkspaceId: string;
  projectId: string | null;
  projectName: string | null;
  redactionApplied: boolean;
  status: string;
  title: string;
  updatedAt: Date;
  url: string | null;
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

type LinearIssueCandidateInsert = UpsertLinearIssueCandidatesWithAuditInput["candidates"][number];

const now = new Date("2026-05-24T16:00:00.000Z");
const later = new Date("2026-05-24T16:05:00.000Z");
const linearUpdatedAt = new Date("2026-05-24T15:45:00.000Z");

const createConnection = (
  overrides: Partial<StoredLinearOAuthConnection> = {},
): StoredLinearOAuthConnection => ({
  expiresAt: new Date("2026-06-24T16:00:00.000Z"),
  id: "linear_connection_1",
  linearWorkspaceId: "linear_workspace_1",
  revokedAt: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const createIssue = (overrides: Partial<LinearIssueSyncIssue> = {}): LinearIssueSyncIssue => ({
  body: "Fix the retry copy on the queue detail page.",
  comments: [{ body: "Please keep the runner approval gate intact." }],
  identifier: " ENG-159 ",
  issueId: " issue_159 ",
  labels: [" Ready for AI ", "bug", "Ready for AI"],
  project: {
    id: " project_1 ",
    name: " Control Plane ",
  },
  status: " Todo ",
  title: " Sync Linear issues ",
  updatedAt: linearUpdatedAt.toISOString(),
  url: " https://linear.app/control-plane/issue/ENG-159/sync-linear-issues ",
  ...overrides,
});

const toStoredCandidate = (candidate: LinearIssueCandidateInsert): StoredLinearIssueCandidate => ({
  bodySummary: candidate.bodySummary ?? "",
  commentsSummary: candidate.commentsSummary ?? "",
  createdAt: candidate.createdAt ?? now,
  id: candidate.id,
  identifier: candidate.identifier,
  labels: candidate.labels ?? [],
  lastSyncedAt: candidate.lastSyncedAt,
  linearConnectionId: candidate.linearConnectionId,
  linearIssueId: candidate.linearIssueId,
  linearUpdatedAt: candidate.linearUpdatedAt,
  linearWorkspaceId: candidate.linearWorkspaceId,
  projectId: candidate.projectId ?? null,
  projectName: candidate.projectName ?? null,
  redactionApplied: candidate.redactionApplied ?? false,
  status: candidate.status,
  title: candidate.title,
  updatedAt: candidate.updatedAt ?? now,
  url: candidate.url ?? null,
  workspaceId: candidate.workspaceId,
});

const createStore = (
  options: {
    candidates?: StoredLinearIssueCandidate[];
    connections?: StoredLinearOAuthConnection[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const approvals: unknown[] = [];
  const candidates = [...(options.candidates ?? [])];
  const connections = [...(options.connections ?? [])];
  const queuedJobs: unknown[] = [];
  const runs: unknown[] = [];
  const taskPackets: unknown[] = [];
  const tasks: unknown[] = [];

  return {
    approvals,
    auditEvents,
    candidates,
    connections,
    findActiveLinearOAuthConnection: vi.fn(
      async (input: {
        linearConnectionId: string;
        now: Date;
        workspaceId: string;
      }): Promise<StoredLinearOAuthConnection | null> =>
        connections.find(
          (connection) =>
            connection.id === input.linearConnectionId &&
            connection.workspaceId === input.workspaceId &&
            connection.revokedAt === null &&
            (connection.expiresAt === null || connection.expiresAt > input.now),
        ) ?? null,
    ),
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    listLinearIssueCandidates: vi.fn(async (input: { workspaceId: string }) =>
      candidates
        .filter((candidate) => candidate.workspaceId === input.workspaceId)
        .sort((left, right) => right.lastSyncedAt.getTime() - left.lastSyncedAt.getTime()),
    ),
    queuedJobs,
    runs,
    taskPackets,
    tasks,
    upsertLinearIssueCandidatesWithAudit: vi.fn(
      async (
        input: UpsertLinearIssueCandidatesWithAuditInput,
      ): Promise<StoredLinearIssueCandidate[]> => {
        const upsertedCandidates: StoredLinearIssueCandidate[] = [];

        for (const candidate of input.candidates) {
          const storedCandidate = toStoredCandidate(candidate);
          const existing = candidates.find(
            (storedCandidate) =>
              storedCandidate.workspaceId === candidate.workspaceId &&
              storedCandidate.linearWorkspaceId === candidate.linearWorkspaceId &&
              storedCandidate.linearIssueId === candidate.linearIssueId,
          );

          if (existing === undefined) {
            candidates.push(storedCandidate);
            upsertedCandidates.push(storedCandidate);
            continue;
          }

          Object.assign(existing, {
            bodySummary: storedCandidate.bodySummary,
            commentsSummary: storedCandidate.commentsSummary,
            identifier: storedCandidate.identifier,
            labels: storedCandidate.labels,
            lastSyncedAt: storedCandidate.lastSyncedAt,
            linearConnectionId: storedCandidate.linearConnectionId,
            linearUpdatedAt: storedCandidate.linearUpdatedAt,
            linearWorkspaceId: storedCandidate.linearWorkspaceId,
            projectId: storedCandidate.projectId,
            projectName: storedCandidate.projectName,
            redactionApplied: storedCandidate.redactionApplied,
            status: storedCandidate.status,
            title: storedCandidate.title,
            updatedAt: storedCandidate.updatedAt,
            url: storedCandidate.url,
            workspaceId: storedCandidate.workspaceId,
          });
          upsertedCandidates.push(existing);
        }

        auditEvents.push(input.auditEvent);

        return upsertedCandidates;
      },
    ),
  };
};

const createService = async (input: {
  clientIssues?: LinearIssueSyncIssue[];
  eligibility?: LinearIssueEligibilityConfig;
  now?: () => Date;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createLinearIssueSyncService } = await importSyncIssues();
  const client = {
    listIssues: vi.fn(
      async (): Promise<readonly LinearIssueSyncIssue[]> => input.clientIssues ?? [createIssue()],
    ),
  };
  const serviceInput: Parameters<typeof createLinearIssueSyncService>[0] = {
    client,
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createCandidateId: () => `linear_issue_candidate_${input.store.candidates.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: input.now ?? (() => now),
    store: input.store,
  };

  if (input.eligibility !== undefined) {
    serviceInput.eligibility = input.eligibility;
  }

  return {
    client,
    service: createLinearIssueSyncService(serviceInput),
  };
};

const expectNoUnsafeIssueMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);

      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      if (
        /^(?:accessToken|approval|code|comments|content|diff|jobId|log|output|patch|privateKey|rawPayload|rawSource|runId|secret|source|stderr|stdout|taskPacket|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("*** Begin Patch");
  expect(serialized).not.toContain("-----BEGIN");
  expect(serialized).not.toContain("const leaked");
  expect(serialized).not.toContain("linear-secret-token");
  expect(serialized).not.toContain("raw_payload");
  expect(unsafeKeys).toEqual([]);
};

describe("Linear issue sync service", () => {
  test("rejects unauthenticated and non-member users before API sync", async () => {
    const unauthenticatedStore = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const unauthenticated = await createService({
      store: unauthenticatedStore,
      userId: null,
    });

    await expect(
      unauthenticated.service.syncLinearIssues({
        linearConnectionId: "linear_connection_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(unauthenticated.client.listIssues).not.toHaveBeenCalled();
    expect(unauthenticatedStore.upsertLinearIssueCandidatesWithAudit).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const nonMember = await createService({ store: nonMemberStore });

    await expect(
      nonMember.service.syncLinearIssues({
        linearConnectionId: "linear_connection_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMember.client.listIssues).not.toHaveBeenCalled();
    expect(nonMemberStore.upsertLinearIssueCandidatesWithAudit).not.toHaveBeenCalled();
  });

  test("blocks sync when the Linear OAuth connection is missing, revoked, or expired", async () => {
    const store = createStore({
      connections: [
        createConnection({ id: "linear_connection_revoked", revokedAt: now }),
        createConnection({
          expiresAt: new Date("2026-05-24T15:59:59.000Z"),
          id: "linear_connection_expired",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { client, service } = await createService({ store });

    await expect(
      service.syncLinearIssues({
        linearConnectionId: "linear_connection_missing",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.syncLinearIssues({
        linearConnectionId: "linear_connection_revoked",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.syncLinearIssues({
        linearConnectionId: "linear_connection_expired",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(client.listIssues).not.toHaveBeenCalled();
    expect(store.upsertLinearIssueCandidatesWithAudit).not.toHaveBeenCalled();
  });

  test("normalizes mocked Linear issues and upserts candidate rows", async () => {
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { client, service } = await createService({ store });

    const result = await service.syncLinearIssues({
      linearConnectionId: " linear_connection_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(client.listIssues).toHaveBeenCalledWith({
      connection: {
        id: "linear_connection_1",
        linearWorkspaceId: "linear_workspace_1",
        workspaceId: "workspace_1",
      },
      limit: 50,
    });
    expect(store.candidates).toEqual([
      expect.objectContaining({
        bodySummary: "Fix the retry copy on the queue detail page.",
        commentsSummary: "Please keep the runner approval gate intact.",
        identifier: "ENG-159",
        labels: ["Ready for AI", "bug"],
        lastSyncedAt: now,
        linearConnectionId: "linear_connection_1",
        linearIssueId: "issue_159",
        linearUpdatedAt,
        linearWorkspaceId: "linear_workspace_1",
        projectId: "project_1",
        projectName: "Control Plane",
        redactionApplied: false,
        status: "Todo",
        title: "Sync Linear issues",
        url: "https://linear.app/control-plane/issue/ENG-159/sync-linear-issues",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(result).toMatchObject({
      candidateCount: 1,
      connectionId: "linear_connection_1",
      redactedCount: 0,
      skippedIssueCount: 0,
      syncedIssueCount: 1,
      workspaceId: "workspace_1",
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        identifier: "ENG-159",
        linearIssueId: "issue_159",
        status: "Todo",
        title: "Sync Linear issues",
      }),
    ]);
    expectNoUnsafeIssueMaterial({ result, stored: store.candidates });
  });

  test("bounds oversized client responses to the requested sync limit before persistence", async () => {
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { client, service } = await createService({
      clientIssues: [
        createIssue({ identifier: "ENG-159", issueId: "issue_159", title: "First issue" }),
        createIssue({ identifier: "ENG-160", issueId: "issue_160", title: "Second issue" }),
        createIssue({ identifier: "ENG-161", issueId: "issue_161", title: "Third issue" }),
      ],
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      limit: 2,
      workspaceId: "workspace_1",
    });

    expect(client.listIssues).toHaveBeenCalledWith({
      connection: {
        id: "linear_connection_1",
        linearWorkspaceId: "linear_workspace_1",
        workspaceId: "workspace_1",
      },
      limit: 2,
    });
    expect(store.candidates).toHaveLength(2);
    expect(result).toMatchObject({
      candidateCount: 2,
      redactedCount: 0,
      skippedIssueCount: 1,
      syncedIssueCount: 2,
    });
    expect(store.candidates.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_159",
      "issue_160",
    ]);
    expect(result.candidates.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_159",
      "issue_160",
    ]);
    expect(
      JSON.stringify({ auditEvents: store.auditEvents, result, stored: store.candidates }),
    ).not.toContain("Third issue");
  });

  test("syncs only Ready-for-AI issues by status or label without queueing runner work", async () => {
    const { queueManualJob } = await import("../jobs/manual-queue");
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [
        createIssue({
          body: "Ready by label body summary",
          comments: [{ body: "Ready by label comment summary" }],
          identifier: "ENG-160",
          issueId: "issue_ready_by_label",
          labels: ["Ready for AI"],
          status: "Todo",
          title: "Ready by label",
          url: "https://linear.app/control-plane/issue/ENG-160/ready-by-label",
        }),
        createIssue({
          body: "Ready by status body summary",
          comments: [{ body: "Ready by status comment summary" }],
          identifier: "ENG-161",
          issueId: "issue_ready_by_status",
          labels: ["bug"],
          status: "Ready for AI",
          title: "Ready by status",
          url: "https://linear.app/control-plane/issue/ENG-161/ready-by-status",
        }),
        createIssue({
          body: "Non-ready body should not appear in audit or candidates.",
          comments: [{ body: "Non-ready comment should not appear in audit or candidates." }],
          identifier: "ENG-162",
          issueId: "issue_not_ready",
          labels: ["bug"],
          status: "Todo",
          title: "Not ready for AI",
          url: "https://linear.app/control-plane/issue/ENG-162/not-ready",
        }),
      ],
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.candidates.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_ready_by_label",
      "issue_ready_by_status",
    ]);
    expect(result.candidates.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_ready_by_label",
      "issue_ready_by_status",
    ]);
    expect(result).toMatchObject({
      candidateCount: 2,
      redactedCount: 0,
      skippedIssueCount: 1,
      syncedIssueCount: 2,
    });
    expect(queueManualJob).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.queuedJobs).toEqual([]);
    expect(store.runs).toEqual([]);
    expect(store.taskPackets).toEqual([]);
    expect(store.tasks).toEqual([]);

    expect(store.auditEvents[0]?.metadata).toEqual({
      candidateCount: 2,
      redactedCount: 0,
      skippedIssueCount: 1,
      syncedIssueCount: 2,
    });
    const serializedAudit = JSON.stringify(store.auditEvents);
    expect(serializedAudit).not.toContain("Ready by label");
    expect(serializedAudit).not.toContain("Ready by status");
    expect(serializedAudit).not.toContain("Not ready for AI");
    expect(serializedAudit).not.toContain("linear.app/control-plane/issue");
    expect(serializedAudit).not.toContain("Ready for AI");
    expect(serializedAudit).not.toContain("Ready by label body summary");
    expect(serializedAudit).not.toContain("Ready by status comment summary");
    expect(serializedAudit).not.toContain("Non-ready body should not appear");
    expect(serializedAudit).not.toContain("Non-ready comment should not appear");
    expect(serializedAudit).not.toContain("linear_connection_1");
    expect(serializedAudit).not.toContain("linear_workspace_1");
    expect(serializedAudit).not.toMatch(/rawPayload|raw Linear|comments|body|labels/u);
    expectNoUnsafeIssueMaterial({
      result,
      stored: store.candidates,
      auditEvents: store.auditEvents,
    });
  });

  test("sync uses service-level custom Ready-for-AI status and label configuration", async () => {
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [
        createIssue({
          identifier: "ENG-163",
          issueId: "issue_custom_status",
          labels: [],
          status: "AI Selected",
          title: "Custom status ready",
        }),
        createIssue({
          identifier: "ENG-164",
          issueId: "issue_custom_label",
          labels: ["Agent Candidate"],
          status: "Todo",
          title: "Custom label ready",
        }),
        createIssue({
          identifier: "ENG-165",
          issueId: "issue_default_ready",
          labels: ["Ready for AI"],
          status: "Todo",
          title: "Default ready should not match custom config",
        }),
      ],
      eligibility: {
        labels: ["Agent Candidate"],
        statuses: ["AI Selected"],
      },
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(result.candidates.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_custom_status",
      "issue_custom_label",
    ]);
    expect(store.candidates.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_custom_status",
      "issue_custom_label",
    ]);
  });

  test("re-sync updates existing candidates instead of duplicating rows", async () => {
    const existingCandidate = {
      bodySummary: "Old summary",
      commentsSummary: "",
      createdAt: new Date("2026-05-23T16:00:00.000Z"),
      id: "linear_issue_candidate_existing",
      identifier: "ENG-159",
      labels: [],
      lastSyncedAt: new Date("2026-05-23T16:00:00.000Z"),
      linearConnectionId: "linear_connection_1",
      linearIssueId: "issue_159",
      linearUpdatedAt: new Date("2026-05-23T15:45:00.000Z"),
      linearWorkspaceId: "linear_workspace_1",
      projectId: null,
      projectName: null,
      redactionApplied: false,
      status: "Todo",
      title: "Old title",
      updatedAt: new Date("2026-05-23T16:00:00.000Z"),
      url: null,
      workspaceId: "workspace_1",
    };
    const store = createStore({
      candidates: [existingCandidate],
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [
        createIssue({
          body: "Updated body summary",
          comments: [],
          labels: ["Ready for AI"],
          status: "In Progress",
          title: "Updated Linear issue title",
        }),
      ],
      now: () => later,
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.candidates).toHaveLength(1);
    expect(store.candidates[0]).toMatchObject({
      bodySummary: "Updated body summary",
      id: "linear_issue_candidate_existing",
      lastSyncedAt: later,
      status: "In Progress",
      title: "Updated Linear issue title",
      updatedAt: later,
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        id: "linear_issue_candidate_existing",
        status: "In Progress",
        title: "Updated Linear issue title",
      }),
    ]);
  });

  test("re-sync hides a stored ready candidate when Linear removes Ready-for-AI status and labels", async () => {
    const existingCandidate = toStoredCandidate({
      bodySummary: "Previously ready summary",
      commentsSummary: "Previously ready comment",
      createdAt: new Date("2026-05-23T16:00:00.000Z"),
      id: "linear_issue_candidate_existing",
      identifier: "ENG-159",
      labels: ["Ready for AI"],
      lastSyncedAt: new Date("2026-05-23T16:00:00.000Z"),
      linearConnectionId: "linear_connection_1",
      linearIssueId: "issue_159",
      linearUpdatedAt: new Date("2026-05-23T15:45:00.000Z"),
      linearWorkspaceId: "linear_workspace_1",
      projectId: null,
      projectName: null,
      redactionApplied: false,
      status: "Todo",
      title: "Previously ready title",
      updatedAt: new Date("2026-05-23T16:00:00.000Z"),
      url: null,
      workspaceId: "workspace_1",
    });
    const store = createStore({
      candidates: [existingCandidate],
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [
        createIssue({
          body: "Updated non-ready summary",
          comments: [],
          labels: ["bug"],
          status: "Todo",
          title: "Updated non-ready Linear issue",
        }),
      ],
      now: () => later,
      store,
    });

    const syncResult = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });
    const listResult = await service.listLinearIssueCandidates({ workspaceId: "workspace_1" });

    expect(syncResult.candidates).toEqual([]);
    expect(listResult).toEqual([]);
    expect(store.candidates).toEqual([
      expect.objectContaining({
        id: "linear_issue_candidate_existing",
        labels: ["bug"],
        lastSyncedAt: later,
        linearIssueId: "issue_159",
        status: "Todo",
        title: "Updated non-ready Linear issue",
        updatedAt: later,
      }),
    ]);
    expectNoUnsafeIssueMaterial({
      auditEvents: store.auditEvents,
      listResult,
      stored: store.candidates,
      syncResult,
    });
  });

  test("keeps duplicate Linear issue ids isolated by Linear workspace", async () => {
    const existingCandidate = {
      bodySummary: "Other Linear workspace issue",
      commentsSummary: "",
      createdAt: new Date("2026-05-23T16:00:00.000Z"),
      id: "linear_issue_candidate_existing",
      identifier: "ENG-159",
      labels: [],
      lastSyncedAt: new Date("2026-05-23T16:00:00.000Z"),
      linearConnectionId: "linear_connection_other",
      linearIssueId: "issue_159",
      linearUpdatedAt: new Date("2026-05-23T15:45:00.000Z"),
      linearWorkspaceId: "linear_workspace_other",
      projectId: null,
      projectName: null,
      redactionApplied: false,
      status: "Todo",
      title: "Issue from another Linear workspace",
      updatedAt: new Date("2026-05-23T16:00:00.000Z"),
      url: null,
      workspaceId: "workspace_1",
    };
    const store = createStore({
      candidates: [existingCandidate],
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({ store });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.candidates).toHaveLength(2);
    expect(store.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "linear_issue_candidate_existing",
          linearIssueId: "issue_159",
          linearWorkspaceId: "linear_workspace_other",
          title: "Issue from another Linear workspace",
        }),
        expect.objectContaining({
          linearIssueId: "issue_159",
          linearWorkspaceId: "linear_workspace_1",
          title: "Sync Linear issues",
        }),
      ]),
    );
    expect(result.candidates).toEqual([
      expect.objectContaining({
        linearIssueId: "issue_159",
        linearWorkspaceId: "linear_workspace_1",
        title: "Sync Linear issues",
      }),
    ]);
  });

  test("stores only bounded issue body and comment summaries", async () => {
    const { LINEAR_ISSUE_BODY_SUMMARY_MAX_LENGTH, LINEAR_ISSUE_COMMENTS_SUMMARY_MAX_LENGTH } =
      await importSyncIssues();
    const longBody = `User visible context ${"body ".repeat(400)}tail`;
    const longComment = `Reviewer note ${"comment ".repeat(400)}tail`;
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [createIssue({ body: longBody, comments: [{ body: longComment }] })],
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    const [storedCandidate] = store.candidates;
    expect(storedCandidate?.bodySummary.length).toBeLessThanOrEqual(
      LINEAR_ISSUE_BODY_SUMMARY_MAX_LENGTH,
    );
    expect(storedCandidate?.commentsSummary.length).toBeLessThanOrEqual(
      LINEAR_ISSUE_COMMENTS_SUMMARY_MAX_LENGTH,
    );
    expect(result.candidates[0]?.bodySummary.length).toBeLessThanOrEqual(
      LINEAR_ISSUE_BODY_SUMMARY_MAX_LENGTH,
    );
    expect(result.candidates[0]?.commentsSummary.length).toBeLessThanOrEqual(
      LINEAR_ISSUE_COMMENTS_SUMMARY_MAX_LENGTH,
    );
    expect(JSON.stringify({ result, storedCandidate })).not.toContain(longBody);
    expect(JSON.stringify({ result, storedCandidate })).not.toContain(longComment);
  });

  test("redacts unsafe issue text before persistence and return", async () => {
    const unsafeBody = [
      "Investigate without leaking this secret=linear-secret-token",
      "diff --git a/app.ts b/app.ts",
      "const leaked = process.env.LINEAR_TOKEN;",
      "-----BEGIN PRIVATE KEY-----",
      "abc123",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const unsafeComment = [
      "*** Begin Patch",
      "@@ -1 +1 @@",
      "```ts",
      "const leaked = true;",
      "```",
    ].join("\n");
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [createIssue({ body: unsafeBody, comments: [{ body: unsafeComment }] })],
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.candidates[0]).toMatchObject({
      bodySummary: "[redacted]",
      commentsSummary: "[redacted]",
      redactionApplied: true,
    });
    expect(result.candidates[0]).toMatchObject({
      bodySummary: "[redacted]",
      commentsSummary: "[redacted]",
      redactionApplied: true,
    });
    expectNoUnsafeIssueMaterial({ result, stored: store.candidates });
  });

  test("redacts raw command output in issue body and comments before persistence and return", async () => {
    const rawOutputBody = [
      "The local validation output was pasted into the issue.",
      "stdout: pnpm test -- --runInBand",
      "FAIL src/linear/sync-issues.test.ts",
      "Error: expected status to be passed",
    ].join("\n");
    const rawOutputComment = [
      "stderr: npm ERR! code ELIFECYCLE",
      "npm ERR! test failed",
      "    at Object.<anonymous> (/workspace/app.test.ts:12:3)",
    ].join("\n");
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [createIssue({ body: rawOutputBody, comments: [{ body: rawOutputComment }] })],
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.candidates[0]).toMatchObject({
      bodySummary: "[redacted]",
      commentsSummary: "[redacted]",
      redactionApplied: true,
    });
    expect(result.candidates[0]).toMatchObject({
      bodySummary: "[redacted]",
      commentsSummary: "[redacted]",
      redactionApplied: true,
    });
    expect(JSON.stringify({ result, stored: store.candidates })).not.toMatch(
      /(?:stdout:|stderr:|npm ERR!|FAIL src\/linear|Object\.<anonymous>)/u,
    );
  });

  test("accepts ordinary prose metadata that starts with source-like words", async () => {
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [
        createIssue({
          project: {
            id: "project_1",
            name: "Class cleanup",
          },
          status: "Return to backlog",
          title: "Import Linear issue metadata",
        }),
      ],
      store,
    });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.candidates).toEqual([
      expect.objectContaining({
        projectName: "Class cleanup",
        status: "Return to backlog",
        title: "Import Linear issue metadata",
      }),
    ]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        projectName: "Class cleanup",
        status: "Return to backlog",
        title: "Import Linear issue metadata",
      }),
    ]);
  });

  test.each([
    [
      "title",
      createIssue({
        title: "const leaked = process.env.LINEAR_TOKEN;",
      }),
    ],
    [
      "identifier",
      createIssue({
        identifier: "function leaked() {}",
      }),
    ],
    [
      "status",
      createIssue({
        status: "function leaked() {}",
      }),
    ],
    [
      "label",
      createIssue({
        labels: ["Ready for AI", "import leaked from './secret';"],
      }),
    ],
    [
      "project id",
      createIssue({
        project: {
          id: "const leaked = process.env.LINEAR_TOKEN;",
          name: "Control Plane",
        },
      }),
    ],
    [
      "project name",
      createIssue({
        project: {
          id: "project_1",
          name: "class LeakedSecret {}",
        },
      }),
    ],
  ])(
    "rejects unsafe source-like issue metadata in %s before persistence",
    async (_field, issue) => {
      const store = createStore({
        connections: [createConnection()],
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      });
      const { service } = await createService({
        clientIssues: [issue],
        store,
      });

      await expect(
        service.syncLinearIssues({
          linearConnectionId: "linear_connection_1",
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });

      expect(store.upsertLinearIssueCandidatesWithAudit).not.toHaveBeenCalled();
      expect(store.candidates).toEqual([]);
      expect(store.auditEvents).toEqual([]);
      expectNoUnsafeIssueMaterial({
        auditEvents: store.auditEvents,
        stored: store.candidates,
      });
    },
  );

  test.each([
    [
      "title",
      createIssue({
        title: "api_key=api-key-from-fixture-12345",
      }),
    ],
    [
      "status",
      createIssue({
        status: "private_key=private-key-from-fixture-12345",
      }),
    ],
    [
      "label",
      createIssue({
        labels: ["Ready for AI", "api_key=label-api-key-from-fixture-12345"],
      }),
    ],
    [
      "project id",
      createIssue({
        project: {
          id: "private_key=project-private-key-from-fixture-12345",
          name: "Control Plane",
        },
      }),
    ],
    [
      "project name",
      createIssue({
        project: {
          id: "project_1",
          name: "api_key=project-name-api-key-from-fixture-12345",
        },
      }),
    ],
  ])("rejects secret-like issue metadata in %s before persistence", async (_field, issue) => {
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [issue],
      store,
    });

    await expect(
      service.syncLinearIssues({
        linearConnectionId: "linear_connection_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.upsertLinearIssueCandidatesWithAudit).not.toHaveBeenCalled();
    expect(store.candidates).toEqual([]);
    expect(store.auditEvents).toEqual([]);
    expectNoUnsafeIssueMaterial({
      auditEvents: store.auditEvents,
      stored: store.candidates,
    });
  });

  test("writes safe audit metadata using linear_issue_candidates.synced", async () => {
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({
      clientIssues: [
        createIssue(),
        createIssue({
          identifier: "ENG-160",
          issueId: "issue_160",
          title: "Second synced issue",
        }),
      ],
      store,
    });

    await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "linear_issue_candidates.synced",
        id: "audit_1",
        message: "Linear issues synced.",
        metadata: {
          candidateCount: 2,
          redactedCount: 0,
          skippedIssueCount: 0,
          syncedIssueCount: 2,
        },
        workspaceId: "workspace_1",
      }),
    ]);

    const serializedAudit = JSON.stringify(store.auditEvents);
    expect(serializedAudit).not.toContain("ENG-159");
    expect(serializedAudit).not.toContain("Sync Linear issues");
    expect(serializedAudit).not.toContain("linear.app");
    expect(serializedAudit).not.toContain("Ready for AI");
    expect(serializedAudit).not.toContain("linear_connection_1");
    expect(serializedAudit).not.toContain("linear_workspace_1");
    expectNoUnsafeIssueMaterial(store.auditEvents);
  });

  test("lists synced Linear issue candidates without touching runner queue state", async () => {
    const storedCandidate = toStoredCandidate({
      bodySummary: "Candidate summary",
      commentsSummary: "Candidate comment",
      createdAt: now,
      id: "linear_issue_candidate_1",
      identifier: "ENG-159",
      labels: ["Ready for AI"],
      lastSyncedAt: now,
      linearConnectionId: "linear_connection_1",
      linearIssueId: "issue_159",
      linearUpdatedAt,
      linearWorkspaceId: "linear_workspace_1",
      projectId: "project_1",
      projectName: "Control Plane",
      redactionApplied: false,
      status: "Todo",
      title: "Sync Linear issues",
      updatedAt: now,
      url: "https://linear.app/control-plane/issue/ENG-159/sync-linear-issues",
      workspaceId: "workspace_1",
    });
    const store = createStore({
      candidates: [storedCandidate],
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({ store });

    const result = await service.listLinearIssueCandidates({ workspaceId: " workspace_1 " });

    expect(store.listLinearIssueCandidates).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(result).toEqual([
      expect.objectContaining({
        bodySummary: "Candidate summary",
        commentsSummary: "Candidate comment",
        identifier: "ENG-159",
        linearIssueId: "issue_159",
        status: "Todo",
        title: "Sync Linear issues",
      }),
    ]);
    expect(store.approvals).toEqual([]);
    expect(store.queuedJobs).toEqual([]);
    expect(store.runs).toEqual([]);
    expect(store.taskPackets).toEqual([]);
    expect(store.tasks).toEqual([]);
    expectNoUnsafeIssueMaterial({ result, store });
  });

  test("listing candidates filters out stored non-ready rows", async () => {
    const readyByLabel = toStoredCandidate({
      bodySummary: "Ready label summary",
      commentsSummary: "Ready label comment",
      createdAt: now,
      id: "linear_issue_candidate_label",
      identifier: "ENG-160",
      labels: ["Ready for AI"],
      lastSyncedAt: later,
      linearConnectionId: "linear_connection_1",
      linearIssueId: "issue_ready_by_label",
      linearUpdatedAt,
      linearWorkspaceId: "linear_workspace_1",
      projectId: null,
      projectName: null,
      redactionApplied: false,
      status: "Todo",
      title: "Ready by label",
      updatedAt: now,
      url: null,
      workspaceId: "workspace_1",
    });
    const readyByStatus = toStoredCandidate({
      bodySummary: "Ready status summary",
      commentsSummary: "Ready status comment",
      createdAt: now,
      id: "linear_issue_candidate_status",
      identifier: "ENG-161",
      labels: ["bug"],
      lastSyncedAt: now,
      linearConnectionId: "linear_connection_1",
      linearIssueId: "issue_ready_by_status",
      linearUpdatedAt,
      linearWorkspaceId: "linear_workspace_1",
      projectId: null,
      projectName: null,
      redactionApplied: false,
      status: "Ready for AI",
      title: "Ready by status",
      updatedAt: now,
      url: null,
      workspaceId: "workspace_1",
    });
    const notReady = toStoredCandidate({
      bodySummary: "Stored non-ready body should stay hidden.",
      commentsSummary: "Stored non-ready comment should stay hidden.",
      createdAt: now,
      id: "linear_issue_candidate_not_ready",
      identifier: "ENG-162",
      labels: ["bug"],
      lastSyncedAt: new Date("2026-05-24T15:00:00.000Z"),
      linearConnectionId: "linear_connection_1",
      linearIssueId: "issue_not_ready",
      linearUpdatedAt,
      linearWorkspaceId: "linear_workspace_1",
      projectId: null,
      projectName: null,
      redactionApplied: false,
      status: "Todo",
      title: "Not ready for AI",
      updatedAt: now,
      url: null,
      workspaceId: "workspace_1",
    });
    const store = createStore({
      candidates: [notReady, readyByLabel, readyByStatus],
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({ store });

    const result = await service.listLinearIssueCandidates({ workspaceId: "workspace_1" });

    expect(result.map((candidate) => candidate.linearIssueId)).toEqual([
      "issue_ready_by_label",
      "issue_ready_by_status",
    ]);
    expect(JSON.stringify(result)).not.toContain("issue_not_ready");
    expect(JSON.stringify(result)).not.toContain("Stored non-ready body should stay hidden.");
    expect(JSON.stringify(result)).not.toContain("Stored non-ready comment should stay hidden.");
    expectNoUnsafeIssueMaterial({ result, store: { ...store, candidates: result } });
  });

  test("does not queue jobs, create runs, create task packets, or approve tasks", async () => {
    const { queueManualJob } = await import("../jobs/manual-queue");
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { service } = await createService({ store });

    const result = await service.syncLinearIssues({
      linearConnectionId: "linear_connection_1",
      workspaceId: "workspace_1",
    });

    expect(queueManualJob).not.toHaveBeenCalled();
    expect(store.approvals).toEqual([]);
    expect(store.queuedJobs).toEqual([]);
    expect(store.runs).toEqual([]);
    expect(store.taskPackets).toEqual([]);
    expect(store.tasks).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/\b(?:taskPacket|runId|jobId|approvedAt)\b/u);
    expect(JSON.stringify(store)).not.toMatch(/\b(?:taskPacket|jobId|approvedAt)\b/u);
  });

  test("keeps the Linear issue sync module server-only and free of client component directives", async () => {
    const source = await readFile(new URL("./sync-issues.ts", import.meta.url), "utf8");

    expect(source.trimStart()).toMatch(/^import "server-only";/u);
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("'use client'");
    expect(source).not.toMatch(/node:(?:child_process|fs|fs\/promises)/u);
    expect(source).not.toMatch(/\b(?:exec|execFile|spawn|fork)\s*\(/u);
    expect(source).not.toMatch(/\b(?:readFile|readdir|stat|lstat)\s*\(/u);
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/u);
  });
});
