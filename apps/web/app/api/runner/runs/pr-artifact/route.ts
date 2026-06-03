import { SubmitPrArtifactRequestSchema } from "@control-plane/shared";

import { getDatabase } from "../../../../../src/db";
import { hasUnsafePrArtifactSubmissionRequest } from "../../../../../src/runs/artifact-safety";
import {
  createDrizzleRunArtifactSubmissionStore,
  createRunArtifactSubmissionService,
  isRunArtifactSubmissionRequestError,
} from "../../../../../src/runs/artifacts";
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

const parseSubmitPrArtifactRequest = async (request: Request, runnerId: string) => {
  const parsedRequest = SubmitPrArtifactRequestSchema.safeParse(await parseJsonBody(request));

  if (!parsedRequest.success || parsedRequest.data.runnerId !== runnerId) {
    throw createRouteError("invalid_request");
  }

  if (hasUnsafePrArtifactSubmissionRequest(parsedRequest.data)) {
    throw createRouteError("invalid_request");
  }

  return parsedRequest.data;
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const prArtifactRequest = await parseSubmitPrArtifactRequest(request, context.runnerId);
  const database = getDatabase();
  const service = createRunArtifactSubmissionService({
    store: createDrizzleRunArtifactSubmissionStore(database.db),
  });

  try {
    return await service.submitPrArtifact({
      context,
      request: prArtifactRequest,
    });
  } catch (error) {
    if (isRunArtifactSubmissionRequestError(error)) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
