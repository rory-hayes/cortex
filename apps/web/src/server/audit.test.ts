import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importAudit = async () => import("./audit");

describe("audit event helper", () => {
  test("creates safe audit rows with workspace, actor, type, message, and metadata", async () => {
    const { insertAuditEvent } = await importAudit();
    const store = {
      insertAuditEvent: vi.fn(async () => undefined),
    };

    await insertAuditEvent({
      actorId: "user_123",
      createId: () => "audit_1",
      eventType: "workspace.updated",
      message: "Workspace name updated.",
      metadata: {
        diff: "diff --git a/file b/file",
        nested: {
          kept: "visible metadata",
          patch: "@@ -1 +1 @@",
          token: "ghp_example",
        },
        safeCount: 1,
        secret: "sk_live_example",
        source: "const value = true;",
      },
      now: () => new Date("2026-05-22T12:00:00.000Z"),
      store,
      workspaceId: "workspace_1",
    });

    expect(store.insertAuditEvent).toHaveBeenCalledWith({
      actorId: "user_123",
      createdAt: new Date("2026-05-22T12:00:00.000Z"),
      eventType: "workspace.updated",
      id: "audit_1",
      message: "Workspace name updated.",
      metadata: {
        nested: {
          kept: "visible metadata",
        },
        safeCount: 1,
      },
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(store.insertAuditEvent.mock.calls)).not.toMatch(
      /diff|patch|source|code|secret|token|rawOutput|stdout|stderr|ghp_|sk_live/i,
    );
  });

  test("strips secret-like metadata keys and redacts secret-looking values under safe keys", async () => {
    const { insertAuditEvent } = await importAudit();
    const store = {
      insertAuditEvent: vi.fn(async () => undefined),
    };

    await insertAuditEvent({
      createId: () => "audit_2",
      eventType: "workspace.updated",
      message: "Workspace name updated.",
      metadata: {
        apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        nested: {
          password: "correct horse battery staple",
          safeCredentialUrl: "https://deploy-user:deploy-pass@example.test/repo.git",
          safeEnvLine: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        },
        passwd: "plain text password",
        privateKey: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        safeAuthorization: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890",
        safeProviderValue: "github_pat_abcdefghijklmnopqrstuvwxyz123456",
      },
      now: () => new Date("2026-05-22T12:00:00.000Z"),
      store,
      workspaceId: "workspace_1",
    });

    expect(store.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          nested: {
            safeCredentialUrl: "https://[REDACTED_CREDENTIALS]@example.test/repo.git",
            safeEnvLine: "OPENAI_API_KEY=[REDACTED_SECRET]",
          },
          safeAuthorization: "Authorization: Bearer [REDACTED_SECRET]",
          safeProviderValue: "[REDACTED_SECRET]",
        },
      }),
    );
    expect(JSON.stringify(store.insertAuditEvent.mock.calls)).not.toMatch(
      /apiKey|passwd|privateKey|password|sk-proj-|deploy-user|deploy-pass|github_pat_|Bearer abcdef|PRIVATE KEY/i,
    );
  });

  test("strips unsafe metadata key variants before audit insert", async () => {
    const { insertAuditEvent } = await importAudit();
    const store = {
      insertAuditEvent: vi.fn(async () => undefined),
    };

    await insertAuditEvent({
      createId: () => "audit_3",
      eventType: "workspace.updated",
      message: "Workspace name updated.",
      metadata: {
        "api-key": "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        nested: {
          raw_output: "diff --git a/file b/file",
          "std-err": "token=github_pat_abcdefghijklmnopqrstuvwxyz123456",
          visible: "safe metadata",
        },
        PASSWORD: "plain text password",
        private_key: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
      },
      now: () => new Date("2026-05-22T12:00:00.000Z"),
      store,
      workspaceId: "workspace_1",
    });

    expect(store.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          nested: {
            visible: "safe metadata",
          },
        },
      }),
    );
    expect(JSON.stringify(store.insertAuditEvent.mock.calls)).not.toMatch(
      /api-key|raw_output|std-err|PASSWORD|private_key|diff --git|github_pat_|plain text password|PRIVATE KEY/i,
    );
  });

  test("redacts generic bearer credentials under safe-looking metadata keys", async () => {
    const { insertAuditEvent } = await importAudit();
    const store = {
      insertAuditEvent: vi.fn(async () => undefined),
    };

    await insertAuditEvent({
      createId: () => "audit_4",
      eventType: "workspace.updated",
      message: "Workspace name updated.",
      metadata: {
        authorizationHeader: "Bearer opaque-session-token-fixture-12345",
        visible: "safe metadata",
      },
      now: () => new Date("2026-05-22T12:00:00.000Z"),
      store,
      workspaceId: "workspace_1",
    });

    expect(store.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          authorizationHeader: "[redacted]",
          visible: "safe metadata",
        },
      }),
    );
    expect(JSON.stringify(store.insertAuditEvent.mock.calls)).not.toContain(
      "opaque-session-token-fixture-12345",
    );
  });
});
