import { HeartbeatRequestSchema, type HeartbeatRequest } from "@control-plane/shared";

import { getDatabase } from "../../../../src/db";
import {
  RunnerHeartbeatRequestError,
  createDrizzleRunnerHeartbeatStore,
  createRunnerHeartbeatService,
} from "../../../../src/runners/heartbeat";
import {
  createAuthenticatedRunnerRouteHandler,
  createRouteError,
} from "../../../../src/server/route-handlers";

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw createRouteError("invalid_request");
  }
};

const parseHeartbeatBody = async (
  request: Request,
  authenticatedRunnerId: string,
): Promise<HeartbeatRequest> => {
  const parsedBody = HeartbeatRequestSchema.safeParse(await parseJsonBody(request));

  if (!parsedBody.success) {
    throw createRouteError("invalid_request");
  }

  if (
    parsedBody.data.runnerId !== authenticatedRunnerId ||
    (parsedBody.data.capabilities.runnerId !== undefined &&
      parsedBody.data.capabilities.runnerId !== authenticatedRunnerId)
  ) {
    throw createRouteError("invalid_request");
  }

  return parsedBody.data;
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const payload = await parseHeartbeatBody(request, context.runnerId);
  const database = getDatabase();
  const service = createRunnerHeartbeatService({
    store: createDrizzleRunnerHeartbeatStore(database.db),
  });

  try {
    return await service.recordHeartbeat({
      authenticatedRunnerId: context.runnerId,
      payload,
      workspaceId: context.workspaceId,
    });
  } catch (error) {
    if (error instanceof RunnerHeartbeatRequestError) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
