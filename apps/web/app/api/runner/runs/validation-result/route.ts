import { SubmitValidationResultRequestSchema } from "@control-plane/shared";

import { getDatabase } from "../../../../../src/db";
import { hasUnsafeValidationResultSubmissionRequest } from "../../../../../src/runs/artifact-safety";
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

const parseSubmitValidationResultRequest = async (request: Request, runnerId: string) => {
  const parsedRequest = SubmitValidationResultRequestSchema.safeParse(await parseJsonBody(request));

  if (!parsedRequest.success || parsedRequest.data.runnerId !== runnerId) {
    throw createRouteError("invalid_request");
  }

  if (hasUnsafeValidationResultSubmissionRequest(parsedRequest.data)) {
    throw createRouteError("invalid_request");
  }

  return parsedRequest.data;
};

export const POST = createAuthenticatedRunnerRouteHandler(async (request, context) => {
  const validationRequest = await parseSubmitValidationResultRequest(request, context.runnerId);
  const database = getDatabase();
  const service = createRunArtifactSubmissionService({
    store: createDrizzleRunArtifactSubmissionStore(database.db),
  });

  try {
    return await service.submitValidationResult({
      context,
      request: validationRequest,
    });
  } catch (error) {
    if (isRunArtifactSubmissionRequestError(error)) {
      throw createRouteError("invalid_request");
    }

    throw error;
  }
});
