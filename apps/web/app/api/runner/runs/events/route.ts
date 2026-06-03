import { SubmitRunEventRequestSchema } from "@control-plane/shared";

import { getDatabase } from "../../../../../src/db";
import {
  createDrizzleSubmitRunEventStore,
  createSubmitRunEventService,
  isSubmitRunEventRequestError,
} from "../../../../../src/runs/events";
import {
  createAuthenticatedRunnerRouteHandler,
  createRouteError,
} from "../../../../../src/server/route-handlers";
import { hasUnsafeWebBoundPayload } from "../../../../../src/security/payload-guard";

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    const body = await request.json();

    if (hasUnsafeWebBoundPayload(body)) {
      throw createRouteError("invalid_request");
    }

    return body;
  } catch {
    throw createRouteError("invalid_request");
  }
};

const parseSubmitRunEventRequest = async (request: Request) => {
  const body = await parseJsonBody(request);
  const parsedRequest = SubmitRunEventRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    throw createRouteError("invalid_request");
  }

  return parsedRequest.data;
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const eventRequest = await parseSubmitRunEventRequest(request);

  if (eventRequest.runnerId !== undefined && eventRequest.runnerId !== context.runnerId) {
    throw createRouteError("invalid_request");
  }

  const database = getDatabase();
  const service = createSubmitRunEventService({
    store: createDrizzleSubmitRunEventStore(database.db),
  });

  try {
    return await service.submitRunEvent({
      context,
      request: eventRequest,
    });
  } catch (error) {
    if (isSubmitRunEventRequestError(error)) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
