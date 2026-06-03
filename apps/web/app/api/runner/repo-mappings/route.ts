import { CONTRACT_VERSION } from "@control-plane/shared";

import { getDatabase } from "../../../../src/db";
import {
  createDrizzleRepoMappingStore,
  createRunnerRepoMappingService,
  isRunnerRepoMappingRequestError,
  type RunnerRepoMappingRequest,
} from "../../../../src/repo-mappings/repo-mappings";
import {
  createAuthenticatedRunnerRouteHandler,
  createRouteError,
} from "../../../../src/server/route-handlers";

const allowedKeys = new Set([
  "contractVersion",
  "defaultBranch",
  "localPath",
  "provider",
  "remoteUrl",
  "repositoryName",
  "repositoryOwner",
  "runnerId",
  "timestamp",
  "workspaceId",
]);

const requiredStringKeys = [
  "contractVersion",
  "defaultBranch",
  "localPath",
  "provider",
  "repositoryName",
  "repositoryOwner",
  "runnerId",
  "timestamp",
  "workspaceId",
] as const;

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw createRouteError("invalid_request");
  }
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const readRequiredString = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw createRouteError("invalid_request");
  }

  return value;
};

const parseRunnerRepoMappingRequest = async (
  request: Request,
): Promise<RunnerRepoMappingRequest> => {
  const payload = await parseJsonBody(request);

  if (!isPlainRecord(payload)) {
    throw createRouteError("invalid_request");
  }

  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw createRouteError("invalid_request");
  }

  if (
    requiredStringKeys.some(
      (key) => typeof payload[key] !== "string" || payload[key].trim().length === 0,
    )
  ) {
    throw createRouteError("invalid_request");
  }

  if (payload.contractVersion !== CONTRACT_VERSION) {
    throw createRouteError("invalid_request");
  }

  if (payload.remoteUrl !== null && typeof payload.remoteUrl !== "string") {
    throw createRouteError("invalid_request");
  }

  return {
    contractVersion: CONTRACT_VERSION,
    defaultBranch: readRequiredString(payload, "defaultBranch"),
    localPath: readRequiredString(payload, "localPath"),
    provider: readRequiredString(payload, "provider"),
    remoteUrl: payload.remoteUrl,
    repositoryName: readRequiredString(payload, "repositoryName"),
    repositoryOwner: readRequiredString(payload, "repositoryOwner"),
    runnerId: readRequiredString(payload, "runnerId"),
    timestamp: readRequiredString(payload, "timestamp"),
    workspaceId: readRequiredString(payload, "workspaceId"),
  };
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const repoMappingRequest = await parseRunnerRepoMappingRequest(request);

  if (
    repoMappingRequest.runnerId !== context.runnerId ||
    repoMappingRequest.workspaceId !== context.workspaceId
  ) {
    throw createRouteError("invalid_request");
  }

  const database = getDatabase();
  const service = createRunnerRepoMappingService({
    store: createDrizzleRepoMappingStore(database.db),
  });

  try {
    return await service.registerRepoMapping({
      context,
      request: repoMappingRequest,
    });
  } catch (error) {
    if (isRunnerRepoMappingRequestError(error)) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
