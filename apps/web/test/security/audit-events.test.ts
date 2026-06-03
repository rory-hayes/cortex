import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

import {
  createAuditLogService,
  type AuditLogRow,
  type AuditLogSourceRows,
  type AuditLogStore,
} from "../../src/audit-log/list.js";

const workspaceId = "workspace_1";
const actorId = "user_1";

const at = (value: string): Date => new Date(value);

type AuditEventSourceRow = AuditLogSourceRows["auditEvents"][number];
type RunEventSourceRow = AuditLogSourceRows["runEvents"][number];
type ClaimedRunSourceRow = AuditLogSourceRows["claimedRuns"][number];

const auditEvent = (overrides: Partial<AuditEventSourceRow> = {}): AuditEventSourceRow => ({
  actorId,
  createdAt: at("2026-05-23T10:00:00.000Z"),
  eventType: "runner_pairing.created",
  id: "audit_1",
  message: "Runner pairing code created.",
  metadata: {},
  runId: null,
  runnerId: null,
  taskId: null,
  workspaceId,
  ...overrides,
});

const runEvent = (overrides: Partial<RunEventSourceRow> = {}): RunEventSourceRow => ({
  createdAt: at("2026-05-23T10:00:00.000Z"),
  id: "event_1",
  message: "Run event recorded.",
  metadata: {},
  runId: "run_1",
  runnerId: "runner_1",
  severity: "info",
  state: "claimed",
  workspaceId,
  ...overrides,
});

const claimedRun = (overrides: Partial<ClaimedRunSourceRow> = {}): ClaimedRunSourceRow => ({
  claimedAt: at("2026-05-23T10:03:00.000Z"),
  claimExpiresAt: at("2026-05-23T10:18:00.000Z"),
  id: "run_claimed",
  jobId: "job_1",
  jobType: "manual_task",
  mode: "execute",
  runnerId: "runner_1",
  taskId: "task_1",
  workspaceId,
  ...overrides,
});

const createAuditLogTestStore = (
  rows: Partial<AuditLogSourceRows>,
): AuditLogStore & {
  sourceCalls: Array<{ limit: number; workspaceId: string }>;
} => {
  const sourceCalls: Array<{ limit: number; workspaceId: string }> = [];

  return {
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId: requestedWorkspaceId }) =>
      userId === actorId && requestedWorkspaceId === workspaceId
        ? { id: "membership_1", role: "owner" }
        : null,
    ),
    listAuditLogSources: vi.fn(async (input) => {
      sourceCalls.push(input);

      return {
        auditEvents: rows.auditEvents ?? [],
        claimedRuns: rows.claimedRuns ?? [],
        runEvents: rows.runEvents ?? [],
      };
    }),
    sourceCalls,
  };
};

const listAuditRows = async (rows: Partial<AuditLogSourceRows>): Promise<AuditLogRow[]> => {
  const store = createAuditLogTestStore(rows);
  const service = createAuditLogService({
    getAuthContext: async () => ({ userId: actorId }),
    store,
  });

  return service.listAuditLog({ limit: 50, workspaceId });
};

const unsafeMetadataKeys = new Set([
  "authorization",
  "code",
  "content",
  "credential",
  "diff",
  "filecontent",
  "filecontents",
  "log",
  "logs",
  "output",
  "patch",
  "privatekey",
  "raw",
  "rawdiff",
  "rawlog",
  "rawlogs",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "secret",
  "snippet",
  "snippets",
  "source",
  "sourcecode",
  "stderr",
  "stdout",
  "token",
]);

const unsafeTextPattern =
  /(?:diff --git|@@|-----BEGIN|-----END|raw\s*(?:source|patch|log|output)|source\s*code|sourceCode|\b(?:credential|patch|rawLog|rawOutput|snippet|stdout|stderr)\b|(?:token|secret|password)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:\/Users\/|\/private\/|\/var\/folders\/|\/tmp\/)|[A-Za-z]:\\|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)/i;

const collectUnsafeKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUnsafeKeys(item, keys));

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const isSafeAuditRowSource =
      normalizedKey === "source" && (childValue === "audit_event" || childValue === "run_event");

    if (!isSafeAuditRowSource && unsafeMetadataKeys.has(normalizedKey)) {
      keys.push(key);
    }

    collectUnsafeKeys(childValue, keys);
  }

  return keys;
};

const expectMetadataOnlyAudit = (value: unknown) => {
  expect(collectUnsafeKeys(value)).toEqual([]);
  expect(JSON.stringify(value)).not.toMatch(unsafeTextPattern);
};

const rowById = (rows: AuditLogRow[], id: string): AuditLogRow => {
  const row = rows.find((candidate) => candidate.id === id);

  expect(row).toBeDefined();

  return row as AuditLogRow;
};

const detailValue = (row: AuditLogRow, label: string): string | undefined =>
  row.details.find((detail) => detail.label === label)?.value;

describe("audit event completeness security boundary", () => {
  test("projects all consequential audit surfaces as metadata-only audit rows", async () => {
    const rows = await listAuditRows({
      auditEvents: [
        auditEvent({
          createdAt: at("2026-05-23T10:01:00.000Z"),
          eventType: "runner_pairing.created",
          id: "pairing_created",
          message: "Runner pairing code created.",
          metadata: {
            expiresAt: "2026-05-23T10:06:00.000Z",
            pairingId: "pairing_1",
            ttlSeconds: 300,
          },
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:02:00.000Z"),
          eventType: "runner_pairing.redeemed",
          id: "pairing_redeemed",
          message: "Runner pairing code redeemed.",
          metadata: {
            pairingId: "pairing_1",
          },
          runnerId: "runner_1",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:03:00.000Z"),
          eventType: "runner.linked",
          id: "runner_linked",
          message: "Runner linked.",
          metadata: {
            pairingId: "pairing_1",
            runnerId: "runner_1",
          },
          runnerId: "runner_1",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:04:00.000Z"),
          eventType: "run.cancel_requested",
          id: "cancel_requested",
          message: "Run cancellation requested.",
          metadata: {
            reasonLength: 24,
            reasonRedactionApplied: false,
            targetState: "cancel_requested",
          },
          runId: "run_cancelled",
          taskId: "task_cancelled",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:05:00.000Z"),
          eventType: "run.approval_decision_recorded",
          id: "approval_approve",
          message: "Approval decision recorded.",
          metadata: {
            approvalDecisionId: "approval_approve",
            decision: "approve",
            reasonLength: 18,
            reasonRedactionApplied: false,
            runStateAtDecision: "awaiting_approval",
          },
          runId: "run_approved",
          taskId: "task_approved",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:06:00.000Z"),
          eventType: "run.approval_decision_recorded",
          id: "approval_reject",
          message: "Approval decision recorded.",
          metadata: {
            approvalDecisionId: "approval_reject",
            decision: "reject",
            reasonLength: 21,
            reasonRedactionApplied: false,
            runStateAtDecision: "awaiting_approval",
          },
          runId: "run_rejected",
          taskId: "task_rejected",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:07:00.000Z"),
          eventType: "run.repair_requested",
          id: "repair_requested",
          message: "Repair requested.",
          metadata: {
            reasonLength: 32,
            reasonRedactionApplied: false,
            targetState: "repair_requested",
          },
          runId: "run_repair",
          taskId: "task_repair",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:08:00.000Z"),
          eventType: "runner.revoked",
          id: "runner_revoked",
          message: "Runner revoked.",
          metadata: {
            revokedAt: "2026-05-23T10:08:00.000Z",
            runnerId: "runner_1",
          },
          runnerId: "runner_1",
        }),
        auditEvent({
          createdAt: at("2026-05-23T10:09:00.000Z"),
          eventType: "integration.linear.synced",
          id: "linear_synced",
          message: "Linear issue metadata synced.",
          metadata: {
            externalIdLength: 12,
            externalUrlLength: 44,
            originType: "linear",
            status: "synced",
          },
        }),
      ],
      claimedRuns: [claimedRun()],
      runEvents: [
        runEvent({
          createdAt: at("2026-05-23T10:10:00.000Z"),
          id: "policy_block",
          message: "Policy block recorded.",
          metadata: {
            jobId: "job_blocked",
            riskCategory: "protected_path",
            taskId: "task_blocked",
          },
          runId: "run_blocked",
          runnerId: "runner_1",
          severity: "blocked",
          state: "blocked",
        }),
      ],
    });

    expect(rows).toHaveLength(11);
    expect(rows.map((row) => row.id)).toEqual([
      "run-event:policy_block",
      "audit:linear_synced",
      "audit:runner_revoked",
      "audit:repair_requested",
      "audit:approval_reject",
      "audit:approval_approve",
      "audit:cancel_requested",
      "audit:runner_linked",
      "run-claim:run_claimed",
      "audit:pairing_redeemed",
      "audit:pairing_created",
    ]);

    expect(rowById(rows, "audit:pairing_created")).toMatchObject({
      category: "runner",
      eventType: "runner_pairing.created",
      source: "audit_event",
    });
    expect(rowById(rows, "audit:pairing_redeemed")).toMatchObject({
      category: "runner",
      eventType: "runner_pairing.redeemed",
      runnerId: "runner_1",
    });
    expect(rowById(rows, "audit:runner_linked")).toMatchObject({
      category: "runner",
      eventType: "runner.linked",
      runnerId: "runner_1",
    });
    expect(rowById(rows, "run-claim:run_claimed")).toMatchObject({
      category: "job",
      eventType: "run.claimed",
      runId: "run_claimed",
      runnerId: "runner_1",
      source: "run_event",
      sourceLabel: "Run record",
    });
    expect(rowById(rows, "audit:cancel_requested")).toMatchObject({
      category: "cancellation",
      eventType: "run.cancel_requested",
      runId: "run_cancelled",
    });
    expect(rowById(rows, "audit:approval_approve")).toMatchObject({
      category: "approval",
      eventType: "run.approval_decision_recorded",
      runId: "run_approved",
    });
    expect(detailValue(rowById(rows, "audit:approval_approve"), "Decision")).toBe("approve");
    expect(rowById(rows, "audit:approval_reject")).toMatchObject({
      category: "approval",
      eventType: "run.approval_decision_recorded",
      runId: "run_rejected",
    });
    expect(detailValue(rowById(rows, "audit:approval_reject"), "Decision")).toBe("reject");
    expect(rowById(rows, "audit:repair_requested")).toMatchObject({
      category: "repair",
      eventType: "run.repair_requested",
      runId: "run_repair",
    });
    expect(rowById(rows, "audit:runner_revoked")).toMatchObject({
      category: "runner",
      eventType: "runner.revoked",
      runnerId: "runner_1",
    });
    expect(rowById(rows, "run-event:policy_block")).toMatchObject({
      category: "policy",
      eventType: "run.blocked",
      runId: "run_blocked",
      severity: "blocked",
    });
    expect(detailValue(rowById(rows, "run-event:policy_block"), "Risk")).toBe("protected path");
    expect(rowById(rows, "audit:linear_synced")).toMatchObject({
      category: "integration",
      eventType: "integration.linear.synced",
      source: "audit_event",
    });

    for (const row of rows) {
      expect(row).not.toHaveProperty("metadata");
    }
    expectMetadataOnlyAudit(rows);
  });

  test("sanitizes unsafe audit and run-event messages while omitting unsafe metadata", async () => {
    const rows = await listAuditRows({
      auditEvents: [
        auditEvent({
          eventType: "run.approval_decision_recorded",
          id: "unsafe_audit",
          message: "diff --git a/src/app.ts b/src/app.ts with token=ghp_12345678901234567890",
          metadata: {
            credentialText: "credential token=ghp_12345678901234567890",
            decision: "request_repair",
            diff: "diff --git a/src/app.ts b/src/app.ts",
            localPath: "/Users/rory/Documents/private/repo",
            patch: "@@ -1 +1 @@",
            raw: "raw source code",
            rawLog: "stderr token=ghp_12345678901234567890",
            reasonLength: 41,
            reasonRedactionApplied: true,
            secret: "secret=ghp_12345678901234567890",
            source: "source code",
            sourceCode: "const token = 'sk-test-1234567890';",
            snippet: "const password = 'secret';",
            stderr: "stderr token=abc12345",
            stdout: "stdout with raw output",
            token: "token=ghp_12345678901234567890",
          },
          runId: "run_unsafe",
          runnerId: "runner_1",
          taskId: "task_unsafe",
        }),
      ],
      runEvents: [
        runEvent({
          id: "unsafe_run_event",
          message: "Raw command output from /private/tmp/repo included token=abc12345",
          metadata: {
            jobId: "job_unsafe",
            rawOutput: "stdout diff --git a/file b/file",
            riskCategory: "secret",
            source: "source code",
            taskId: "task_unsafe",
          },
          runId: "run_unsafe",
          severity: "blocked",
          state: "blocked",
        }),
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        details: [
          { label: "Decision", value: "request repair" },
          { label: "Reason length", value: "41" },
          { label: "Reason redacted", value: "yes" },
        ],
        eventType: "run.approval_decision_recorded",
        id: "audit:unsafe_audit",
        message: "Run Approval Decision Recorded.",
      }),
      expect.objectContaining({
        details: [
          { label: "Job", value: "job_unsafe" },
          { label: "Risk", value: "secret" },
          { label: "Task", value: "task_unsafe" },
        ],
        eventType: "run.blocked",
        id: "run-event:unsafe_run_event",
        message: "Run Blocked.",
      }),
    ]);

    for (const row of rows) {
      expect(row).not.toHaveProperty("metadata");
    }
    expectMetadataOnlyAudit(rows);
  });
});
