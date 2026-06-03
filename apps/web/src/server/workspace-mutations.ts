import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, schema, type Database } from "../db";

import {
  getCurrentAuthContext,
  requireAuthenticatedUser,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "./auth";
import { createAuditEventInsert, type AuditEventInsert } from "./audit";
import { createActionError } from "./errors";

const WORKSPACE_NAME_MAX_LENGTH = 120;

export type CreateWorkspaceInput = {
  name: string;
};

export type CreateWorkspaceData = {
  name: string;
  workspaceId: string;
};

export type SelectWorkspaceInput = {
  workspaceId: string;
};

export type SelectedWorkspaceData = {
  name: string;
  role: string;
  workspaceId: string;
};

export type CurrentUserWorkspaceData = SelectedWorkspaceData & {
  createdAt: Date;
  updatedAt: Date;
};

export type UpdateWorkspaceNameInput = {
  name: string;
  workspaceId: string;
};

export type UpdateWorkspaceNameData = {
  name: string;
  workspaceId: string;
};

export type UpdateWorkspaceNameWithAuditInput = UpdateWorkspaceNameInput & {
  auditEvent: AuditEventInsert;
};

export type CreateWorkspaceWithOwnerAndAuditInput = {
  auditEvent: AuditEventInsert;
  membership: {
    createdAt: Date;
    id: string;
    role: "owner";
    userId: string;
    workspaceId: string;
  };
  workspace: {
    createdAt: Date;
    id: string;
    name: string;
    updatedAt: Date;
  };
};

export type WorkspaceMutationStore = WorkspaceMembershipStore & {
  createWorkspaceWithOwnerAndAudit: (input: CreateWorkspaceWithOwnerAndAuditInput) => Promise<{
    id: string;
    name: string;
  }>;
  findWorkspaceForUser: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<SelectedWorkspaceData | null>;
  listWorkspacesForUser: (input: { userId: string }) => Promise<CurrentUserWorkspaceData[]>;
  updateWorkspaceNameWithAudit: (input: UpdateWorkspaceNameWithAuditInput) => Promise<{
    id: string;
    name: string;
  } | null>;
};

export type WorkspaceMutationService = {
  createWorkspace: (input: CreateWorkspaceInput) => Promise<CreateWorkspaceData>;
  listCurrentUserWorkspaces: () => Promise<CurrentUserWorkspaceData[]>;
  selectWorkspace: (input: SelectWorkspaceInput) => Promise<SelectedWorkspaceData>;
  updateWorkspaceName: (input: UpdateWorkspaceNameInput) => Promise<UpdateWorkspaceNameData>;
};

export const createDrizzleWorkspaceMutationStore = (db: Database): WorkspaceMutationStore => ({
  createWorkspaceWithOwnerAndAudit: async ({ auditEvent, membership, workspace }) =>
    db.transaction(async (tx) => {
      const [createdWorkspace] = await tx.insert(schema.workspaces).values(workspace).returning({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
      });

      if (createdWorkspace === undefined) {
        throw new Error("Workspace creation did not return a row.");
      }

      await tx.insert(schema.memberships).values(membership);
      await tx.insert(schema.auditEvents).values(auditEvent);

      return createdWorkspace;
    }),
  findWorkspaceForUser: async ({ userId, workspaceId }) => {
    const [workspace] = await db
      .select({
        name: schema.workspaces.name,
        role: schema.memberships.role,
        workspaceId: schema.workspaces.id,
      })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.memberships.workspaceId, schema.workspaces.id))
      .where(
        and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);

    return workspace ?? null;
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
  listWorkspacesForUser: async ({ userId }) =>
    db
      .select({
        createdAt: schema.workspaces.createdAt,
        name: schema.workspaces.name,
        role: schema.memberships.role,
        updatedAt: schema.workspaces.updatedAt,
        workspaceId: schema.workspaces.id,
      })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.memberships.workspaceId, schema.workspaces.id))
      .where(eq(schema.memberships.userId, userId)),
  updateWorkspaceNameWithAudit: async ({ auditEvent, name, workspaceId }) =>
    db.transaction(async (tx) => {
      const [workspace] = await tx
        .update(schema.workspaces)
        .set({
          name,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaces.id, workspaceId))
        .returning({
          id: schema.workspaces.id,
          name: schema.workspaces.name,
        });

      if (workspace === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return workspace;
    }),
});

export const createWorkspaceMutationService = (input: {
  createAuditEventId?: () => string;
  createMembershipId?: () => string;
  createWorkspaceId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: WorkspaceMutationStore;
}): WorkspaceMutationService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const normalizeWorkspaceName = (name: string) => {
    const normalizedName = name.trim();

    if (normalizedName.length === 0 || normalizedName.length > WORKSPACE_NAME_MAX_LENGTH) {
      throw createActionError("validation_error");
    }

    return normalizedName;
  };
  const normalizeWorkspaceId = (workspaceId: string) => {
    const normalizedWorkspaceId = workspaceId.trim();

    if (normalizedWorkspaceId.length === 0) {
      throw createActionError("validation_error");
    }

    return normalizedWorkspaceId;
  };

  return {
    createWorkspace: async ({ name }) => {
      const normalizedName = normalizeWorkspaceName(name);
      const actorId = await requireAuthenticatedUser(getAuthContext);
      const createdAt = input.now?.() ?? new Date();
      const workspaceId = input.createWorkspaceId?.() ?? randomUUID();
      const membershipId = input.createMembershipId?.() ?? randomUUID();
      const workspace = await input.store.createWorkspaceWithOwnerAndAudit({
        auditEvent: createAuditEventInsert({
          actorId,
          createId: input.createAuditEventId ?? randomUUID,
          eventType: "workspace.created",
          message: "Workspace created.",
          metadata: {
            nameLength: normalizedName.length,
          },
          now: () => createdAt,
          workspaceId,
        }),
        membership: {
          createdAt,
          id: membershipId,
          role: "owner",
          userId: actorId,
          workspaceId,
        },
        workspace: {
          createdAt,
          id: workspaceId,
          name: normalizedName,
          updatedAt: createdAt,
        },
      });

      return {
        name: workspace.name,
        workspaceId: workspace.id,
      };
    },
    listCurrentUserWorkspaces: async () => {
      const actorId = await requireAuthenticatedUser(getAuthContext);

      return input.store.listWorkspacesForUser({ userId: actorId });
    },
    selectWorkspace: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const actorId = await requireAuthenticatedUser(getAuthContext);
      const workspace = await input.store.findWorkspaceForUser({
        userId: actorId,
        workspaceId: normalizedWorkspaceId,
      });

      if (workspace === null) {
        throw createActionError("forbidden");
      }

      return workspace;
    },
    updateWorkspaceName: async ({ name, workspaceId }) => {
      const normalizedName = normalizeWorkspaceName(name);
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const auditInput: Parameters<typeof createAuditEventInsert>[0] = {
        actorId: scope.actorId,
        createId: input.createAuditEventId ?? randomUUID,
        eventType: "workspace.updated",
        message: "Workspace name updated.",
        metadata: {
          nameLength: normalizedName.length,
        },
        workspaceId: scope.workspaceId,
      };

      if (input.now !== undefined) {
        auditInput.now = input.now;
      }

      const workspace = await input.store.updateWorkspaceNameWithAudit({
        auditEvent: createAuditEventInsert(auditInput),
        name: normalizedName,
        workspaceId: scope.workspaceId,
      });

      if (workspace === null) {
        throw createActionError("forbidden");
      }

      return {
        name: workspace.name,
        workspaceId: workspace.id,
      };
    },
  };
};
