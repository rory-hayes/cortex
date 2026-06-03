import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importWorkspaceMutations = async () => import("./workspace-mutations");

const createStore = (
  memberships: Array<{
    name?: string;
    role?: string;
    workspaceId: string;
    userId: string;
  }> = [],
) => ({
  createWorkspaceWithOwnerAndAudit: vi.fn(
    async (input: {
      workspace: { id: string; name: string };
    }): Promise<{ id: string; name: string }> => ({
      id: input.workspace.id,
      name: input.workspace.name,
    }),
  ),
  findWorkspaceForUser: vi.fn(async (input: { workspaceId: string; userId: string }) => {
    const membership = memberships.find(
      (candidate) =>
        candidate.workspaceId === input.workspaceId && candidate.userId === input.userId,
    );

    return membership === undefined
      ? null
      : {
          name: membership.name ?? "Platform Ops",
          role: membership.role ?? "member",
          workspaceId: membership.workspaceId,
        };
  }),
  findWorkspaceMembership: vi.fn(async (input: { workspaceId: string; userId: string }) =>
    memberships.some(
      (membership) =>
        membership.workspaceId === input.workspaceId && membership.userId === input.userId,
    )
      ? { id: "membership_1", role: "member" }
      : null,
  ),
  insertAuditEvent: vi.fn(async () => undefined),
  listWorkspacesForUser: vi.fn(async (input: { userId: string }) =>
    memberships
      .filter((membership) => membership.userId === input.userId)
      .map((membership) => ({
        createdAt: new Date("2026-05-22T12:00:00.000Z"),
        name: membership.name ?? "Platform Ops",
        role: membership.role ?? "member",
        updatedAt: new Date("2026-05-22T12:00:00.000Z"),
        workspaceId: membership.workspaceId,
      })),
  ),
  updateWorkspaceName: vi.fn(async (input: { name: string; workspaceId: string }) => ({
    id: input.workspaceId,
    name: input.name,
  })),
  updateWorkspaceNameWithAudit: vi.fn(
    async (input: {
      auditEvent: unknown;
      name: string;
      workspaceId: string;
    }): Promise<{ id: string; name: string } | null> => ({
      id: input.workspaceId,
      name: input.name,
    }),
  ),
});

describe("workspace mutation service", () => {
  test("blocks unauthenticated users before workspace creation", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore();
    const service = createWorkspaceMutationService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(service.createWorkspace({ name: "Platform Ops" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.createWorkspaceWithOwnerAndAudit).not.toHaveBeenCalled();
  });

  test("creates a trimmed workspace, owner membership, and pathless audit event for the current Clerk user", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const now = new Date("2026-05-22T12:00:00.000Z");
    const store = createStore();
    const service = createWorkspaceMutationService({
      createAuditEventId: () => "audit_1",
      createMembershipId: () => "membership_1",
      createWorkspaceId: () => "workspace_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store,
    });

    await expect(service.createWorkspace({ name: "  Platform Ops  " })).resolves.toEqual({
      name: "Platform Ops",
      workspaceId: "workspace_1",
    });

    expect(store.createWorkspaceWithOwnerAndAudit).toHaveBeenCalledWith({
      auditEvent: expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "workspace.created",
        id: "audit_1",
        message: "Workspace created.",
        metadata: {
          nameLength: 12,
        },
        workspaceId: "workspace_1",
      }),
      membership: {
        createdAt: now,
        id: "membership_1",
        role: "owner",
        userId: "user_1",
        workspaceId: "workspace_1",
      },
      workspace: {
        createdAt: now,
        id: "workspace_1",
        name: "Platform Ops",
        updatedAt: now,
      },
    });
  });

  test("wraps workspace, owner membership, and audit creation in one transaction", async () => {
    const { createDrizzleWorkspaceMutationStore } = await importWorkspaceMutations();
    const returning = vi.fn(async () => [{ id: "workspace_1", name: "Platform Ops" }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (callback: (tx: { insert: typeof insert }) => unknown) =>
      callback({ insert }),
    );
    const store = createDrizzleWorkspaceMutationStore({ transaction } as never);
    const now = new Date("2026-05-22T12:00:00.000Z");

    await expect(
      store.createWorkspaceWithOwnerAndAudit({
        auditEvent: {
          actorId: "user_1",
          createdAt: now,
          eventType: "workspace.created",
          id: "audit_1",
          message: "Workspace created.",
          metadata: { nameLength: 12 },
          workspaceId: "workspace_1",
        },
        membership: {
          createdAt: now,
          id: "membership_1",
          role: "owner",
          userId: "user_1",
          workspaceId: "workspace_1",
        },
        workspace: {
          createdAt: now,
          id: "workspace_1",
          name: "Platform Ops",
          updatedAt: now,
        },
      }),
    ).resolves.toEqual({ id: "workspace_1", name: "Platform Ops" });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(3);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace_1", name: "Platform Ops" }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "membership_1",
        role: "owner",
        userId: "user_1",
        workspaceId: "workspace_1",
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "workspace.created",
        metadata: { nameLength: 12 },
        workspaceId: "workspace_1",
      }),
    );
  });

  test("blocks non-members from selecting a workspace", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore([{ userId: "user_2", workspaceId: "workspace_1" }]);
    const service = createWorkspaceMutationService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.selectWorkspace({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.findWorkspaceForUser).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
  });

  test("lists only workspaces with memberships for the current user", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore([
      { name: "Platform Ops", role: "owner", userId: "user_1", workspaceId: "workspace_1" },
      { name: "Hidden Ops", role: "owner", userId: "user_2", workspaceId: "workspace_2" },
    ]);
    const service = createWorkspaceMutationService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listCurrentUserWorkspaces()).resolves.toEqual([
      {
        createdAt: new Date("2026-05-22T12:00:00.000Z"),
        name: "Platform Ops",
        role: "owner",
        updatedAt: new Date("2026-05-22T12:00:00.000Z"),
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.listWorkspacesForUser).toHaveBeenCalledWith({ userId: "user_1" });
  });

  test("blocks unauthenticated users before update or audit insert", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore([{ userId: "user_1", workspaceId: "workspace_1" }]);
    const service = createWorkspaceMutationService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.updateWorkspaceName({ name: "Renamed workspace", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.updateWorkspaceName).not.toHaveBeenCalled();
    expect(store.updateWorkspaceNameWithAudit).not.toHaveBeenCalled();
    expect(store.insertAuditEvent).not.toHaveBeenCalled();
  });

  test("blocks authenticated non-members before update or audit insert", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore([{ userId: "user_2", workspaceId: "workspace_1" }]);
    const service = createWorkspaceMutationService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.updateWorkspaceName({ name: "Renamed workspace", workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.updateWorkspaceName).not.toHaveBeenCalled();
    expect(store.updateWorkspaceNameWithAudit).not.toHaveBeenCalled();
    expect(store.insertAuditEvent).not.toHaveBeenCalled();
  });

  test("allows members to mutate only the requested workspace scope", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore([{ userId: "user_1", workspaceId: "workspace_1" }]);
    const service = createWorkspaceMutationService({
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => new Date("2026-05-22T12:00:00.000Z"),
      store,
    });

    await expect(
      service.updateWorkspaceName({ name: "Renamed workspace", workspaceId: "workspace_2" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      service.updateWorkspaceName({ name: "Renamed workspace", workspaceId: "workspace_1" }),
    ).resolves.toEqual({
      name: "Renamed workspace",
      workspaceId: "workspace_1",
    });

    expect(store.updateWorkspaceNameWithAudit).toHaveBeenCalledTimes(1);
    expect(store.updateWorkspaceNameWithAudit).toHaveBeenCalledWith({
      auditEvent: expect.objectContaining({
        actorId: "user_1",
        eventType: "workspace.updated",
        message: "Workspace name updated.",
        metadata: {
          nameLength: 17,
        },
        workspaceId: "workspace_1",
      }),
      name: "Renamed workspace",
      workspaceId: "workspace_1",
    });
    expect(store.updateWorkspaceName).not.toHaveBeenCalled();
    expect(store.insertAuditEvent).not.toHaveBeenCalled();
  });

  test("uses the atomic update-with-audit store contract so audit failures cannot follow a persisted update", async () => {
    const { createWorkspaceMutationService } = await importWorkspaceMutations();
    const store = createStore([{ userId: "user_1", workspaceId: "workspace_1" }]);
    store.updateWorkspaceNameWithAudit.mockRejectedValueOnce(new Error("audit insert failed"));
    const service = createWorkspaceMutationService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.updateWorkspaceName({ name: "Renamed workspace", workspaceId: "workspace_1" }),
    ).rejects.toThrow("audit insert failed");

    expect(store.updateWorkspaceNameWithAudit).toHaveBeenCalledTimes(1);
    expect(store.updateWorkspaceName).not.toHaveBeenCalled();
    expect(store.insertAuditEvent).not.toHaveBeenCalled();
  });

  test("wraps the Drizzle workspace update and audit insert in one transaction", async () => {
    const { createDrizzleWorkspaceMutationStore } = await importWorkspaceMutations();
    const returning = vi.fn(async () => [{ id: "workspace_1", name: "Renamed workspace" }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const values = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; update: typeof update }) => unknown) =>
        callback({ insert, update }),
    );
    const store = createDrizzleWorkspaceMutationStore({ transaction } as never);
    const auditEvent = {
      createdAt: new Date("2026-05-22T12:00:00.000Z"),
      eventType: "workspace.updated",
      id: "audit_1",
      message: "Workspace name updated.",
      metadata: {},
      workspaceId: "workspace_1",
    };

    await expect(
      store.updateWorkspaceNameWithAudit({
        auditEvent,
        name: "Renamed workspace",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({ id: "workspace_1", name: "Renamed workspace" });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalled();
    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(auditEvent);
  });
});
