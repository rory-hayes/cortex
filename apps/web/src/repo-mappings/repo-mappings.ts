import "server-only";

import { randomUUID } from "node:crypto";

import { CONTRACT_VERSION } from "@control-plane/shared";

import { and, eq, isNull, schema, type Database, type RepoMapping } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export type RepoMappingRow = RepoMapping;
export type RepoMappingPolicyStatus = "ready" | "missing_validation" | "not_reported";
export type RepoMappingUntrackedPosture = "allowed" | "blocked" | "not_reported";
export type RepoMappingPolicySummary = {
  maxChangedFiles: number | null;
  protectedPathCount: number;
  sensitivePathCount: number;
  untrackedFiles: RepoMappingUntrackedPosture;
  warningPathCount: number;
};
export type RepoMappingValidationSummary = {
  labels: string[];
  optionalCount: number;
  requiredCount: number;
};

export type RepoMappingData = Omit<
  RepoMappingRow,
  "localPath" | "policySnapshot" | "runnerId" | "validationCommands"
> & {
  localPath: string;
  policySummary: RepoMappingPolicySummary;
  policyStatus: RepoMappingPolicyStatus;
  runnerId: string;
  validationCommandCount: number;
  validationSummary: RepoMappingValidationSummary;
};

export type CreateRepoMappingInput = {
  defaultBranch: string;
  githubInstallationId?: string | null;
  localPath: string;
  provider?: string;
  remoteUrl?: string | null;
  repositoryExternalId?: string | null;
  repositoryName: string;
  repositoryOwner: string;
  runnerId: string;
  workspaceId: string;
};

export type RunnerRepoMappingRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  defaultBranch: string;
  localPath: string;
  provider: string;
  remoteUrl: string | null;
  repositoryName: string;
  repositoryOwner: string;
  runnerId: string;
  timestamp: string;
  workspaceId: string;
};

export type RunnerRepoMappingData = Pick<
  RepoMappingData,
  | "defaultBranch"
  | "id"
  | "localPath"
  | "provider"
  | "remoteUrl"
  | "repositoryName"
  | "repositoryOwner"
  | "runnerId"
  | "workspaceId"
>;

export type ListRepoMappingsInput = {
  workspaceId: string;
};

export type DeleteRepoMappingInput = {
  repoMappingId: string;
  workspaceId: string;
};

export type DeletedRepoMappingData = {
  archivedAt: Date;
  id: string;
  workspaceId: string;
};

export type RepoMappingCreateInsert = {
  auditEvent: AuditEventInsert;
  defaultBranch: string;
  githubInstallationId: string | null;
  id: string;
  localPath: string;
  provider: string;
  remoteUrl: string | null;
  repositoryExternalId: string | null;
  repositoryName: string;
  repositoryOwner: string;
  runnerId: string;
  workspaceId: string;
};

export type RepoMappingArchiveUpdate = {
  archivedAt: Date;
  auditEvent: AuditEventInsert;
  repoMappingId: string;
  workspaceId: string;
};

type NormalizedCreateRepoMappingInput = Omit<RepoMappingCreateInsert, "auditEvent" | "id">;

export type RepoMappingStore = WorkspaceMembershipStore & {
  archiveRepoMappingWithAudit: (update: RepoMappingArchiveUpdate) => Promise<RepoMappingRow | null>;
  createRepoMappingWithAudit: (insert: RepoMappingCreateInsert) => Promise<RepoMappingRow>;
  findRunnerInWorkspace: (input: {
    runnerId: string;
    workspaceId: string;
  }) => Promise<{ id: string; workspaceId: string } | null>;
  listActiveRepoMappings: (input: { workspaceId: string }) => Promise<RepoMappingRow[]>;
};

export type RepoMappingService = {
  createRepoMapping: (input: CreateRepoMappingInput) => Promise<RepoMappingData>;
  deleteRepoMapping: (input: DeleteRepoMappingInput) => Promise<DeletedRepoMappingData>;
  listRepoMappings: (input: ListRepoMappingsInput) => Promise<RepoMappingData[]>;
};

export type RunnerRepoMappingService = {
  registerRepoMapping: (input: {
    context: {
      runnerId: string;
      workspaceId: string;
    };
    request: RunnerRepoMappingRequest;
  }) => Promise<RunnerRepoMappingData>;
};

const requiredTextMaxLength = 240;
const localPathMaxLength = 1_024;
const remoteUrlMaxLength = 2_048;
const unsafeTextPatterns = [
  /\bdiff --git\b/i,
  /@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Za-z0-9._%+-]+:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;/m,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
];

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const assertSafeBoundedText = (value: string, maxLength: number): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue) ||
    unsafeTextPatterns.some((pattern) => pattern.test(normalizedValue))
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalText = (
  value: string | null | undefined,
  maxLength: number,
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return null;
  }

  return assertSafeBoundedText(normalizedValue, maxLength);
};

const hasHttpUrlCredentials = (value: string): boolean => {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.username || url.password)
    );
  } catch {
    return false;
  }
};

const parseCreateRepoMappingInput = (
  input: CreateRepoMappingInput,
): NormalizedCreateRepoMappingInput => {
  const remoteUrl = normalizeOptionalText(input.remoteUrl, remoteUrlMaxLength);

  if (remoteUrl !== null && hasHttpUrlCredentials(remoteUrl)) {
    throw createActionError("validation_error");
  }

  return {
    defaultBranch: assertSafeBoundedText(input.defaultBranch, requiredTextMaxLength),
    githubInstallationId: normalizeOptionalText(input.githubInstallationId, requiredTextMaxLength),
    localPath: assertSafeBoundedText(input.localPath, localPathMaxLength),
    provider: assertSafeBoundedText(input.provider ?? "github", requiredTextMaxLength),
    remoteUrl,
    repositoryExternalId: normalizeOptionalText(input.repositoryExternalId, requiredTextMaxLength),
    repositoryName: assertSafeBoundedText(input.repositoryName, requiredTextMaxLength),
    repositoryOwner: assertSafeBoundedText(input.repositoryOwner, requiredTextMaxLength),
    runnerId: assertSafeBoundedText(input.runnerId, requiredTextMaxLength),
    workspaceId: assertSafeBoundedText(input.workspaceId, requiredTextMaxLength),
  };
};

export class RunnerRepoMappingRequestError extends Error {
  readonly code = "invalid_request" as const;

  constructor() {
    super("Invalid runner repo mapping request.");
    this.name = "RunnerRepoMappingRequestError";
  }
}

export const isRunnerRepoMappingRequestError = (
  error: unknown,
): error is RunnerRepoMappingRequestError => error instanceof RunnerRepoMappingRequestError;

const createRunnerRepoMappingRequestError = () => new RunnerRepoMappingRequestError();

const parseRunnerRepoMappingRequest = (
  request: RunnerRepoMappingRequest,
): NormalizedCreateRepoMappingInput => {
  try {
    if (request.contractVersion !== CONTRACT_VERSION) {
      throw createRunnerRepoMappingRequestError();
    }

    const normalizedTimestamp = assertSafeBoundedText(request.timestamp, requiredTextMaxLength);
    const timestampMs = Date.parse(normalizedTimestamp);

    if (!Number.isFinite(timestampMs)) {
      throw createRunnerRepoMappingRequestError();
    }

    return parseCreateRepoMappingInput({
      defaultBranch: request.defaultBranch,
      localPath: request.localPath,
      provider: request.provider,
      remoteUrl: request.remoteUrl,
      repositoryName: request.repositoryName,
      repositoryOwner: request.repositoryOwner,
      runnerId: request.runnerId,
      workspaceId: request.workspaceId,
    });
  } catch {
    throw createRunnerRepoMappingRequestError();
  }
};

const parseRequiredIdInput = (value: string): string =>
  assertSafeBoundedText(value, requiredTextMaxLength);

const getPolicyStatus = (row: RepoMappingRow): RepoMappingPolicyStatus => {
  if (row.policySnapshot === null) {
    return "not_reported";
  }

  return Array.isArray(row.validationCommands) &&
    row.validationCommands.some((command) => command.required)
    ? "ready"
    : "missing_validation";
};

const getWarningPathCount = (
  warningPaths: NonNullable<RepoMappingRow["policySnapshot"]>["warningPaths"],
): number =>
  Object.values(warningPaths).reduce((total, warningPathList) => total + warningPathList.length, 0);

const toPolicySummary = (row: RepoMappingRow): RepoMappingPolicySummary => {
  const policy = row.policySnapshot;

  if (policy === null) {
    return {
      maxChangedFiles: null,
      protectedPathCount: 0,
      sensitivePathCount: 0,
      untrackedFiles: "not_reported",
      warningPathCount: 0,
    };
  }

  return {
    maxChangedFiles: policy.maxChangedFiles,
    protectedPathCount: policy.protectedPaths.length,
    sensitivePathCount: policy.sensitivePaths.length,
    untrackedFiles: policy.allowUntrackedFiles ? "allowed" : "blocked",
    warningPathCount: getWarningPathCount(policy.warningPaths),
  };
};

const normalizeSafeValidationLabel = (
  command: NonNullable<RepoMappingRow["validationCommands"]>[number],
  index: number,
): string => {
  const normalizedLabel = command.label.trim();
  const normalizedCommand = command.command.trim();

  if (
    normalizedLabel.length === 0 ||
    normalizedLabel.length > 80 ||
    normalizedLabel === normalizedCommand ||
    hasControlCharacter(normalizedLabel) ||
    unsafeTextPatterns.some((pattern) => pattern.test(normalizedLabel))
  ) {
    return `Validation check ${index + 1}`;
  }

  return normalizedLabel;
};

const toValidationSummary = (row: RepoMappingRow): RepoMappingValidationSummary => {
  const commands = Array.isArray(row.validationCommands) ? row.validationCommands : [];

  return {
    labels: commands.map(normalizeSafeValidationLabel),
    optionalCount: commands.filter((command) => !command.required).length,
    requiredCount: commands.filter((command) => command.required).length,
  };
};

const toRepoMappingData = (row: RepoMappingRow): RepoMappingData => {
  if (row.runnerId === null || row.localPath === null) {
    throw new Error("Active repo mapping is missing runner-scoped path metadata.");
  }

  const validationCommandCount = Array.isArray(row.validationCommands)
    ? row.validationCommands.length
    : 0;

  return {
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    defaultBranch: row.defaultBranch,
    githubInstallationId: row.githubInstallationId,
    id: row.id,
    localPath: row.localPath,
    policySummary: toPolicySummary(row),
    policyStatus: getPolicyStatus(row),
    provider: row.provider,
    remoteUrl: row.remoteUrl,
    repositoryExternalId: row.repositoryExternalId,
    repositoryName: row.repositoryName,
    repositoryOwner: row.repositoryOwner,
    runnerId: row.runnerId,
    updatedAt: row.updatedAt,
    validationCommandCount,
    validationSummary: toValidationSummary(row),
    workspaceId: row.workspaceId,
  };
};

const toRunnerRepoMappingData = (row: RepoMappingRow): RunnerRepoMappingData => {
  if (row.runnerId === null || row.localPath === null) {
    throw new Error("Active repo mapping is missing runner-scoped path metadata.");
  }

  return {
    defaultBranch: row.defaultBranch,
    id: row.id,
    localPath: row.localPath,
    provider: row.provider,
    remoteUrl: row.remoteUrl,
    repositoryName: row.repositoryName,
    repositoryOwner: row.repositoryOwner,
    runnerId: row.runnerId,
    workspaceId: row.workspaceId,
  };
};

export const createDrizzleRepoMappingStore = (db: Database): RepoMappingStore => ({
  archiveRepoMappingWithAudit: async ({ archivedAt, auditEvent, repoMappingId, workspaceId }) =>
    db.transaction(async (tx) => {
      const [mapping] = await tx
        .update(schema.repoMappings)
        .set({
          archivedAt,
          updatedAt: archivedAt,
        })
        .where(
          and(
            eq(schema.repoMappings.id, repoMappingId),
            eq(schema.repoMappings.workspaceId, workspaceId),
            isNull(schema.repoMappings.archivedAt),
          ),
        )
        .returning();

      if (mapping === undefined) {
        return null;
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return mapping;
    }),
  createRepoMappingWithAudit: async ({ auditEvent, ...mappingInsert }) =>
    db.transaction(async (tx) => {
      const [mapping] = await tx.insert(schema.repoMappings).values(mappingInsert).returning();

      if (mapping === undefined) {
        throw new Error("Repo mapping insert did not return a row.");
      }

      await tx.insert(schema.auditEvents).values(auditEvent);

      return mapping;
    }),
  findRunnerInWorkspace: async ({ runnerId, workspaceId }) => {
    const [runner] = await db
      .select({
        id: schema.runners.id,
        workspaceId: schema.runners.workspaceId,
      })
      .from(schema.runners)
      .where(and(eq(schema.runners.id, runnerId), eq(schema.runners.workspaceId, workspaceId)))
      .limit(1);

    return runner ?? null;
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
  listActiveRepoMappings: async ({ workspaceId }) =>
    db
      .select()
      .from(schema.repoMappings)
      .where(
        and(
          eq(schema.repoMappings.workspaceId, workspaceId),
          isNull(schema.repoMappings.archivedAt),
        ),
      ),
});

export const createRunnerRepoMappingService = (input: {
  createAuditEventId?: () => string;
  createRepoMappingId?: () => string;
  now?: () => Date;
  store: RepoMappingStore;
}): RunnerRepoMappingService => ({
  registerRepoMapping: async ({ context, request }) => {
    const parsedInput = parseRunnerRepoMappingRequest(request);

    if (
      parsedInput.runnerId !== context.runnerId ||
      parsedInput.workspaceId !== context.workspaceId
    ) {
      throw createRunnerRepoMappingRequestError();
    }

    const runner = await input.store.findRunnerInWorkspace({
      runnerId: context.runnerId,
      workspaceId: context.workspaceId,
    });

    if (runner === null) {
      throw createRunnerRepoMappingRequestError();
    }

    const repoMappingId = input.createRepoMappingId?.() ?? randomUUID();
    const registeredAt = input.now?.() ?? new Date();
    const auditEvent = createAuditEventInsert({
      createId: input.createAuditEventId ?? randomUUID,
      eventType: "repo_mapping.created_by_runner",
      message: "Repository mapping created by runner.",
      metadata: {
        defaultBranchLength: parsedInput.defaultBranch.length,
        localPathLength: parsedInput.localPath.length,
        repoMappingId,
        remoteUrlLength: parsedInput.remoteUrl?.length ?? 0,
        repositoryNameLength: parsedInput.repositoryName.length,
        repositoryOwnerLength: parsedInput.repositoryOwner.length,
      },
      now: () => registeredAt,
      runnerId: context.runnerId,
      workspaceId: context.workspaceId,
    });
    const mapping = await input.store.createRepoMappingWithAudit({
      ...parsedInput,
      auditEvent,
      id: repoMappingId,
      workspaceId: context.workspaceId,
    });

    return toRunnerRepoMappingData(mapping);
  },
});

export const createRepoMappingService = (input: {
  createAuditEventId?: () => string;
  createRepoMappingId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RepoMappingStore;
}): RepoMappingService => ({
  createRepoMapping: async (createInput) => {
    const parsedInput = parseCreateRepoMappingInput(createInput);
    const scope = await requireWorkspaceMembership({
      getAuthContext: input.getAuthContext ?? getCurrentAuthContext,
      store: input.store,
      workspaceId: parsedInput.workspaceId,
    });
    const runner = await input.store.findRunnerInWorkspace({
      runnerId: parsedInput.runnerId,
      workspaceId: scope.workspaceId,
    });

    if (runner === null) {
      throw createActionError("validation_error");
    }

    const repoMappingId = input.createRepoMappingId?.() ?? randomUUID();
    const auditInput: Parameters<typeof createAuditEventInsert>[0] = {
      actorId: scope.actorId,
      createId: input.createAuditEventId ?? randomUUID,
      eventType: "repo_mapping.created",
      message: "Repository mapping created.",
      metadata: {
        defaultBranchLength: parsedInput.defaultBranch.length,
        localPathLength: parsedInput.localPath.length,
        repoMappingId,
        remoteUrlLength: parsedInput.remoteUrl?.length ?? 0,
        repositoryNameLength: parsedInput.repositoryName.length,
        repositoryOwnerLength: parsedInput.repositoryOwner.length,
        runnerId: parsedInput.runnerId,
      },
      runnerId: parsedInput.runnerId,
      workspaceId: scope.workspaceId,
    };

    if (input.now !== undefined) {
      auditInput.now = input.now;
    }

    const auditEvent = createAuditEventInsert(auditInput);
    const mapping = await input.store.createRepoMappingWithAudit({
      ...parsedInput,
      auditEvent,
      id: repoMappingId,
      workspaceId: scope.workspaceId,
    });

    return toRepoMappingData(mapping);
  },
  deleteRepoMapping: async ({ repoMappingId, workspaceId }) => {
    const parsedInput = {
      repoMappingId: parseRequiredIdInput(repoMappingId),
      workspaceId: parseRequiredIdInput(workspaceId),
    };
    const scope = await requireWorkspaceMembership({
      getAuthContext: input.getAuthContext ?? getCurrentAuthContext,
      store: input.store,
      workspaceId: parsedInput.workspaceId,
    });
    const archivedAt = input.now?.() ?? new Date();
    const auditInput: Parameters<typeof createAuditEventInsert>[0] = {
      actorId: scope.actorId,
      createId: input.createAuditEventId ?? randomUUID,
      eventType: "repo_mapping.archived",
      message: "Repository mapping archived.",
      metadata: {
        repoMappingId: parsedInput.repoMappingId,
      },
      workspaceId: scope.workspaceId,
    };

    if (input.now !== undefined) {
      auditInput.now = input.now;
    }

    const auditEvent = createAuditEventInsert(auditInput);
    const mapping = await input.store.archiveRepoMappingWithAudit({
      archivedAt,
      auditEvent,
      repoMappingId: parsedInput.repoMappingId,
      workspaceId: scope.workspaceId,
    });

    if (mapping === null) {
      throw createActionError("forbidden");
    }

    return {
      archivedAt: mapping.archivedAt ?? archivedAt,
      id: mapping.id,
      workspaceId: mapping.workspaceId,
    };
  },
  listRepoMappings: async ({ workspaceId }) => {
    const parsedWorkspaceId = parseRequiredIdInput(workspaceId);
    const scope = await requireWorkspaceMembership({
      getAuthContext: input.getAuthContext ?? getCurrentAuthContext,
      store: input.store,
      workspaceId: parsedWorkspaceId,
    });
    const mappings = await input.store.listActiveRepoMappings({
      workspaceId: scope.workspaceId,
    });

    return mappings.map(toRepoMappingData);
  },
});
