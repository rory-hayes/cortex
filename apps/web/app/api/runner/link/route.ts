import { LinkRunnerRequestSchema } from "@control-plane/shared";

import { getDatabase } from "../../../../src/db";
import { createDrizzleRunnerLinkStore, createRunnerLinkService } from "../../../../src/runner-auth";
import { createRouteError, createRunnerRouteHandler } from "../../../../src/server/route-handlers";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw createRouteError("invalid_request");
  }
};

const hasOnlyBlankPairingCodeIssue = (body: unknown): boolean => {
  if (!isRecord(body) || typeof body.pairingCode !== "string") {
    return false;
  }

  if (body.pairingCode.trim().length > 0) {
    return false;
  }

  return LinkRunnerRequestSchema.safeParse({
    ...body,
    pairingCode: "placeholder",
  }).success;
};

const parseLinkRunnerRequest = async (request: Request) => {
  const body = await parseJsonBody(request);
  const parsedRequest = LinkRunnerRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    if (hasOnlyBlankPairingCodeIssue(body)) {
      throw createRouteError("invalid_pairing_code");
    }

    throw createRouteError("invalid_request");
  }

  if (parsedRequest.data.pairingCode.trim().length === 0) {
    throw createRouteError("invalid_pairing_code");
  }

  return parsedRequest.data;
};

const getPollingBaseUrl = (request: Request): string => {
  const url = new URL(request.url);

  return `${url.origin}/api`;
};

export const POST = createRunnerRouteHandler(async (request) => {
  const linkRequest = await parseLinkRunnerRequest(request);
  const database = getDatabase();
  const service = createRunnerLinkService({
    store: createDrizzleRunnerLinkStore(database.db),
  });
  const result = await service.linkRunner({
    capabilities: linkRequest.capabilities,
    pairingCode: linkRequest.pairingCode,
    pollingBaseUrl: getPollingBaseUrl(request),
  });

  if (result.status === "invalid_pairing_code") {
    throw createRouteError("invalid_pairing_code");
  }

  return result.response;
});
