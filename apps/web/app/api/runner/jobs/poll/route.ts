import { PollJobsRequestSchema } from "@control-plane/shared";

import { getDatabase } from "../../../../../src/db";
import {
  createDrizzlePollJobsStore,
  createPollJobsService,
  isPollJobsRequestError,
} from "../../../../../src/jobs/poll";
import {
  createAuthenticatedRunnerRouteHandler,
  createRouteError,
} from "../../../../../src/server/route-handlers";

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw createRouteError("invalid_request");
  }
};

const parsePollJobsRequest = async (request: Request) => {
  const body = await parseJsonBody(request);
  const parsedRequest = PollJobsRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    throw createRouteError("invalid_request");
  }

  return parsedRequest.data;
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const pollRequest = await parsePollJobsRequest(request);

  if (pollRequest.runnerId !== context.runnerId) {
    throw createRouteError("invalid_request");
  }

  const database = getDatabase();
  const service = createPollJobsService({
    store: createDrizzlePollJobsStore(database.db),
  });

  try {
    return await service.pollJobs({
      context,
      request: pollRequest,
    });
  } catch (error) {
    if (isPollJobsRequestError(error)) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
