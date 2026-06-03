import { ClaimJobRequestSchema } from "@control-plane/shared";

import { getDatabase } from "../../../../../src/db";
import {
  createClaimJobService,
  createDrizzleClaimJobStore,
  isClaimJobRequestError,
} from "../../../../../src/jobs/claim";
import {
  createAuthenticatedRunnerRouteHandler,
  createRouteError,
} from "../../../../../src/server/route-handlers";

const readJsonPayload = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw createRouteError("invalid_request");
  }
};

const parseClaimJobRequest = async (request: Request) => {
  const payload = await readJsonPayload(request);
  const parsedRequest = ClaimJobRequestSchema.safeParse(payload);

  if (!parsedRequest.success) {
    throw createRouteError("invalid_request");
  }

  return parsedRequest.data;
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const claimRequest = await parseClaimJobRequest(request);

  if (claimRequest.runnerId !== context.runnerId) {
    throw createRouteError("invalid_request");
  }

  const database = getDatabase();
  const service = createClaimJobService({
    store: createDrizzleClaimJobStore(database.db),
  });

  try {
    return await service.claimJob({
      context,
      request: claimRequest,
    });
  } catch (error) {
    if (isClaimJobRequestError(error)) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
