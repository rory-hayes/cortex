import { describe, expect, test, vi } from "vitest";

import type { AuditEventInsert } from "../server/audit";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRunnerRevoke = async () => import("./revoke");

type StoredRunner = {
  id: string;
  revokedAt: Date | null;
  status: "busy" | "idle" | "offline";
  updatedAt: Date;
  workspaceId: string;
};

const now = new Date("2026-05-22T13:30:00.000Z");
const previouslyRevokedAt = new Date("2026-05-22T13:05:00.000Z");

const createRunner = (overrides: Partial<StoredRunner> = {}): StoredRunner => ({
  id: "runner_1",
  revokedAt: null,
  status: "idle",
  updatedAt: new Date("2026-05-22T13:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (input: {
  memberships?: Array<{ role: string; userId: string; workspaceId: string }>;
  runners?: StoredRunner[];
}) => {
  const runners = input.runners ?? [];
  const auditEvents: AuditEventInsert[] = [];

  return {
    auditEvents,
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) => {
      const membership = input.memberships?.find(
        (candidate) => candidate.userId === userId && candidate.workspaceId === workspaceId,
      );

      return membership === undefined
        ? null
        : {
            id: "membership_1",
            role: membership.role,
          };
    }),
    revokeRunnerWithAudit: vi.fn(
      async ({
        auditEventFor,
        revokedAt,
        runnerId,
        workspaceId,
      }: {
        auditEventFor: (row: {
          id: string;
          revokedAt: Date;
          workspaceId: string;
        }) => AuditEventInsert;
        revokedAt: Date;
        runnerId: string;
        workspaceId: string;
      }) => {
        const runner = runners.find(
          (candidate) => candidate.id === runnerId && candidate.workspaceId === workspaceId,
        );

        if (runner === undefined) {
          return { status: "not_found" as const };
        }

        if (runner.revokedAt !== null) {
          return {
            runner: {
              id: runner.id,
              revokedAt: runner.revokedAt,
              workspaceId: runner.workspaceId,
            },
            status: "already_revoked" as const,
          };
        }

        runner.revokedAt = revokedAt;
        runner.status = "offline";
        runner.updatedAt = revokedAt;
        auditEvents.push(
          auditEventFor({
            id: runner.id,
            revokedAt,
            workspaceId: runner.workspaceId,
          }),
        );

        return {
          runner: {
            id: runner.id,
            revokedAt,
            workspaceId: runner.workspaceId,
          },
          status: "revoked" as const,
        };
      },
    ),
    runners,
  };
};

const expectNoUnsafeAuditMaterial = (value: unknown) => {
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
        /^(body|capabilities|code|credential|credentialHash|credential_hash|diff|hash|logs?|pairing|patch|raw|request|secret|source|token)$/i.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("runner-secret-credential");
  expect(serialized).not.toContain("credential_hash_value");
  expect(serialized).not.toContain("RUNNER-LINK-CODE");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@");
  expect(serialized).not.toContain("const leaked");
  expect(unsafeKeys).toEqual([]);
};

describe("runner revoke service", () => {
  test("rejects unauthenticated users before membership lookup or mutation", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const store = createStore({
      memberships: [{ role: "owner", userId: "user_1", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });
    const service = createRunnerRevokeService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.revokeRunner({ runnerId: "runner_1", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.revokeRunnerWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects authenticated non-members before mutation", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const store = createStore({
      memberships: [{ role: "owner", userId: "user_2", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });
    const service = createRunnerRevokeService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.revokeRunner({ runnerId: "runner_1", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.revokeRunnerWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects workspace members that are not owners before mutation", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const store = createStore({
      memberships: [{ role: "member", userId: "user_1", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });
    const service = createRunnerRevokeService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.revokeRunner({ runnerId: "runner_1", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.revokeRunnerWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("lets workspace owners revoke an active runner and writes a safe audit event", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const runner = createRunner();
    const store = createStore({
      memberships: [{ role: "owner", userId: "user_1", workspaceId: "workspace_1" }],
      runners: [runner],
    });
    const service = createRunnerRevokeService({
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store,
    });

    await expect(
      service.revokeRunner({ runnerId: " runner_1 ", workspaceId: " workspace_1 " }),
    ).resolves.toEqual({
      revokedAt: now,
      runnerId: "runner_1",
      status: "revoked",
      workspaceId: "workspace_1",
    });

    expect(runner.revokedAt).toBe(now);
    expect(runner.status).toBe("offline");
    expect(runner.updatedAt).toBe(now);
    expect(store.revokeRunnerWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: now,
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "runner.revoked",
        id: "audit_1",
        message: "Runner revoked.",
        metadata: {
          revokedAt: now.toISOString(),
          runnerId: "runner_1",
        },
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeAuditMaterial(store.auditEvents);
  });

  test("returns forbidden for missing and out-of-workspace runners without leaking existence", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const store = createStore({
      memberships: [{ role: "owner", userId: "user_1", workspaceId: "workspace_1" }],
      runners: [createRunner({ id: "runner_hidden", workspaceId: "workspace_2" })],
    });
    const service = createRunnerRevokeService({
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store,
    });

    await expect(
      service.revokeRunner({ runnerId: "runner_missing", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.revokeRunner({ runnerId: "runner_hidden", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.auditEvents).toEqual([]);
  });

  test("is idempotent for already-revoked runners without duplicate audit events", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const runner = createRunner({ revokedAt: previouslyRevokedAt, updatedAt: previouslyRevokedAt });
    const store = createStore({
      memberships: [{ role: "owner", userId: "user_1", workspaceId: "workspace_1" }],
      runners: [runner],
    });
    const service = createRunnerRevokeService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store,
    });

    await expect(
      service.revokeRunner({ runnerId: "runner_1", workspaceId: "workspace_1" }),
    ).resolves.toEqual({
      revokedAt: previouslyRevokedAt,
      runnerId: "runner_1",
      status: "revoked",
      workspaceId: "workspace_1",
    });

    expect(runner.revokedAt).toBe(previouslyRevokedAt);
    expect(store.auditEvents).toEqual([]);
    expectNoUnsafeAuditMaterial(store.auditEvents);
  });

  test("does not create duplicate audit events when an owner repeats revocation", async () => {
    const { createRunnerRevokeService } = await importRunnerRevoke();
    const runner = createRunner();
    const store = createStore({
      memberships: [{ role: "owner", userId: "user_1", workspaceId: "workspace_1" }],
      runners: [runner],
    });
    const service = createRunnerRevokeService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store,
    });

    await service.revokeRunner({ runnerId: "runner_1", workspaceId: "workspace_1" });
    await expect(
      service.revokeRunner({ runnerId: "runner_1", workspaceId: "workspace_1" }),
    ).resolves.toEqual({
      revokedAt: now,
      runnerId: "runner_1",
      status: "revoked",
      workspaceId: "workspace_1",
    });

    expect(store.auditEvents).toHaveLength(1);
    expectNoUnsafeAuditMaterial(store.auditEvents);
  });

  test("sets heartbeat status offline in the Drizzle revoke transaction", async () => {
    const { createDrizzleRunnerRevokeStore } = await importRunnerRevoke();
    const selectLimit = vi.fn(async () => [
      {
        id: "runner_1",
        revokedAt: null,
        workspaceId: "workspace_1",
      },
    ]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimit })),
      })),
    }));
    const updateReturning = vi.fn(async () => [
      {
        id: "runner_1",
        revokedAt: now,
        workspaceId: "workspace_1",
      },
    ]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const insertValues = vi.fn();
    const insert = vi.fn(() => ({ values: insertValues }));
    const transaction = vi.fn(
      async (
        callback: (tx: {
          insert: typeof insert;
          select: typeof select;
          update: typeof update;
        }) => unknown,
      ) => callback({ insert, select, update }),
    );
    const store = createDrizzleRunnerRevokeStore({ transaction } as never);

    await expect(
      store.revokeRunnerWithAudit({
        auditEventFor: (runner) => ({
          actorId: "user_1",
          createdAt: now,
          eventType: "runner.revoked",
          id: "audit_1",
          message: "Runner revoked.",
          metadata: { runnerId: runner.id },
          runnerId: runner.id,
          workspaceId: runner.workspaceId,
        }),
        revokedAt: now,
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      runner: {
        id: "runner_1",
        revokedAt: now,
        workspaceId: "workspace_1",
      },
      status: "revoked",
    });

    expect(updateSet).toHaveBeenCalledWith({
      revokedAt: now,
      status: "offline",
      updatedAt: now,
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "runner.revoked",
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    );
  });
});
