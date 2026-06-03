import "server-only";

import type { RunnerCapabilities } from "@control-plane/shared";

import { and, eq, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";

const SAFE_TOOL_NAMES = ["git", "gh", "codex", "node", "npm", "pnpm", "yarn", "python"] as const;

type SafeToolName = (typeof SAFE_TOOL_NAMES)[number];
export type RunnerHeartbeatStatus = "busy" | "idle" | "offline";
export type RunnerStatus = RunnerHeartbeatStatus | "revoked";

export type RunnerToolAvailability = {
  available: boolean;
  name: SafeToolName;
};

export type RunnerCapabilitiesSummary = {
  availableTools: SafeToolName[];
  maxConcurrentJobs: number;
  supportsCancellation: boolean;
  supportsDryRun: boolean;
  toolAvailability: RunnerToolAvailability[];
};

export type RunnerListItem = {
  capabilitiesSummary: RunnerCapabilitiesSummary;
  displayName: string;
  id: string;
  isRevoked: boolean;
  lastHeartbeatAt: Date | null;
  linkedAt: Date;
  revokedAt: Date | null;
  status: RunnerStatus;
};

type RunnerListStoreRow = {
  capabilities: RunnerCapabilities;
  displayName: string;
  id: string;
  lastHeartbeatAt: Date | null;
  linkedAt: Date;
  revokedAt: Date | null;
  status: RunnerHeartbeatStatus;
  workspaceId: string;
};

export type RunnerListStore = WorkspaceMembershipStore & {
  listWorkspaceRunners: (input: { workspaceId: string }) => Promise<RunnerListStoreRow[]>;
};

export type RunnerListService = {
  listWorkspaceRunners: (input: { workspaceId: string }) => Promise<RunnerListItem[]>;
};

const normalizeWorkspaceId = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();

  if (normalizedWorkspaceId.length === 0) {
    throw createActionError("validation_error");
  }

  return normalizedWorkspaceId;
};

const summarizeCapabilities = (capabilities: RunnerCapabilities): RunnerCapabilitiesSummary => {
  const toolAvailability = SAFE_TOOL_NAMES.map((toolName) => ({
    available: capabilities.tools[toolName]?.available === true,
    name: toolName,
  }));

  return {
    availableTools: toolAvailability
      .filter((toolSummary) => toolSummary.available)
      .map((toolSummary) => toolSummary.name),
    maxConcurrentJobs: capabilities.maxConcurrentJobs,
    supportsCancellation: capabilities.supportsCancellation,
    supportsDryRun: capabilities.supportsDryRun,
    toolAvailability,
  };
};

const toRunnerListItem = (runner: RunnerListStoreRow): RunnerListItem => ({
  capabilitiesSummary: summarizeCapabilities(runner.capabilities),
  displayName: runner.displayName,
  id: runner.id,
  isRevoked: runner.revokedAt != null,
  lastHeartbeatAt: runner.lastHeartbeatAt,
  linkedAt: runner.linkedAt,
  revokedAt: runner.revokedAt ?? null,
  status: runner.revokedAt === null ? runner.status : "revoked",
});

export const createDrizzleRunnerListStore = (db: Database): RunnerListStore => ({
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
  listWorkspaceRunners: async ({ workspaceId }) =>
    db
      .select({
        capabilities: schema.runners.capabilities,
        displayName: schema.runners.displayName,
        id: schema.runners.id,
        lastHeartbeatAt: schema.runners.lastHeartbeatAt,
        linkedAt: schema.runners.linkedAt,
        revokedAt: schema.runners.revokedAt,
        status: schema.runners.status,
        workspaceId: schema.runners.workspaceId,
      })
      .from(schema.runners)
      .where(eq(schema.runners.workspaceId, workspaceId)),
});

export const createRunnerListService = (input: {
  getAuthContext?: GetAuthContext;
  store: RunnerListStore;
}): RunnerListService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listWorkspaceRunners: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const runners = await input.store.listWorkspaceRunners({
        workspaceId: scope.workspaceId,
      });

      return runners
        .filter((runner) => runner.workspaceId === scope.workspaceId)
        .map(toRunnerListItem);
    },
  };
};
