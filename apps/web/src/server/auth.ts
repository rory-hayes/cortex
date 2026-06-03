import "server-only";

import { auth0 } from "../../lib/auth0";

import { createActionError } from "./errors";

export type AuthContext = {
  userId: string | null;
};

export type GetAuthContext = () => Promise<AuthContext>;

export type WorkspaceMembership = {
  id: string;
  role: string;
};

export type WorkspaceMembershipStore = {
  findWorkspaceMembership: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<WorkspaceMembership | null>;
};

export type WorkspaceScope = {
  actorId: string;
  membership: WorkspaceMembership;
  workspaceId: string;
};

export const getCurrentAuthContext: GetAuthContext = async () => {
  const session = await auth0.getSession();

  return {
    userId: session?.user.sub ?? null,
  };
};

export const requireAuthenticatedUser = async (
  getAuthContext: GetAuthContext = getCurrentAuthContext,
): Promise<string> => {
  const authContext = await getAuthContext();

  if (!authContext.userId) {
    throw createActionError("unauthenticated");
  }

  return authContext.userId;
};

export const requireWorkspaceMembership = async (input: {
  getAuthContext?: GetAuthContext;
  store: WorkspaceMembershipStore;
  workspaceId: string;
}): Promise<WorkspaceScope> => {
  const actorId = await requireAuthenticatedUser(input.getAuthContext);
  const membership = await input.store.findWorkspaceMembership({
    userId: actorId,
    workspaceId: input.workspaceId,
  });

  if (membership === null) {
    throw createActionError("forbidden");
  }

  return {
    actorId,
    membership,
    workspaceId: input.workspaceId,
  };
};
