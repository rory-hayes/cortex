import { getDatabase } from "../../../../src/db";
import {
  createDrizzleRepoScanStore,
  createRepoScanService,
  type GetRepoScanStatusInput,
  type RepoScanStatusSummary,
  type TriggerRepoScanInput,
  type TriggeredRepoScan,
} from "../../../../src/repo-readiness/repo-scans";
import { createActionError, toActionErrorEnvelope } from "../../../../src/server/errors";
import {
  assertSafeWebBoundPayload,
  hasUnsafePayloadPathText,
} from "../../../../src/security/payload-guard";

const statusByActionErrorCode = {
  forbidden: 403,
  internal_error: 500,
  plan_limit_exceeded: 402,
  unauthenticated: 401,
  validation_error: 400,
} as const;

const allowedFields = new Set(["productGoal", "repoId", "workspaceId"]);
const allowedGetFields = new Set(["repoId", "scanId", "workspaceId"]);
const productGoalMaxLength = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertOnlyAllowedFields = (value: Record<string, unknown>): void => {
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw createActionError("validation_error");
  }
};

const getStringField = (input: Record<string, unknown>, field: string): string => {
  const value = input[field];

  return typeof value === "string" ? value.trim() : "";
};

const parseBoundedStringField = (
  input: Record<string, unknown>,
  field: string,
  maxLength: number,
): string => {
  const value = getStringField(input, field);

  if (value.length === 0 || value.length > maxLength) {
    throw createActionError("validation_error");
  }

  return value;
};

const parseOptionalProductGoal = (input: Record<string, unknown>): string | undefined => {
  if (!("productGoal" in input)) {
    return undefined;
  }

  const productGoal = getStringField(input, "productGoal");

  if (productGoal.length === 0) {
    return undefined;
  }

  if (productGoal.length > productGoalMaxLength || hasUnsafePayloadPathText(productGoal)) {
    throw createActionError("validation_error");
  }

  try {
    assertSafeWebBoundPayload(productGoal);
  } catch {
    throw createActionError("validation_error");
  }

  return productGoal;
};

const parsePostBody = (body: unknown): TriggerRepoScanInput => {
  if (!isRecord(body)) {
    throw createActionError("validation_error");
  }

  assertOnlyAllowedFields(body);
  const productGoal = parseOptionalProductGoal(body);

  return {
    ...(productGoal === undefined ? {} : { productGoal }),
    repoId: parseBoundedStringField(body, "repoId", 240),
    workspaceId: parseBoundedStringField(body, "workspaceId", 240),
  };
};

const parseGetQuery = (request: Request): GetRepoScanStatusInput => {
  const searchParams = new URL(request.url).searchParams;
  const fields = [...searchParams.keys()];

  if (fields.some((field) => !allowedGetFields.has(field))) {
    throw createActionError("validation_error");
  }

  const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";
  const repoId = searchParams.get("repoId")?.trim() ?? "";
  const scanId = searchParams.get("scanId")?.trim() ?? "";

  if (
    workspaceId.length === 0 ||
    workspaceId.length > 240 ||
    (repoId.length === 0 && scanId.length === 0) ||
    (repoId.length > 0 && scanId.length > 0) ||
    repoId.length > 240 ||
    scanId.length > 240
  ) {
    throw createActionError("validation_error");
  }

  return scanId.length > 0 ? { scanId, workspaceId } : { repoId, workspaceId };
};

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw createActionError("validation_error");
  }
};

const jsonResponse = (body: unknown, status: number): Response =>
  Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
    status,
  });

const handleRouteError = (error: unknown): Response => {
  const envelope = toActionErrorEnvelope(error);

  return jsonResponse(
    {
      error: envelope,
      ok: false,
    },
    statusByActionErrorCode[envelope.code],
  );
};

const createService = () => {
  const { db } = getDatabase();

  return createRepoScanService({
    store: createDrizzleRepoScanStore(db),
  });
};

const toResponseData = (scan: TriggeredRepoScan) => ({
  repoId: scan.repoId,
  scanId: scan.scanId,
  status: scan.status,
  workspaceId: scan.workspaceId,
});

const toStatusResponseData = (status: RepoScanStatusSummary) => ({
  blockedFindingCount: status.blockedFindingCount,
  createdAt: status.createdAt,
  failureSummary: status.failureSummary,
  findingCount: status.findingCount,
  finishedAt: status.finishedAt,
  inventoryCounts: status.inventoryCounts,
  moduleStatuses: status.moduleStatuses,
  openFindingCount: status.openFindingCount,
  readinessReportId: status.readinessReportId,
  readinessReportStatus: status.readinessReportStatus,
  repoId: status.repoId,
  scanId: status.scanId,
  startedAt: status.startedAt,
  status: status.status,
  statusSummary: status.statusSummary,
  taskRecommendationCount: status.taskRecommendationCount,
  updatedAt: status.updatedAt,
  workspaceId: status.workspaceId,
});

export const GET = async (request: Request): Promise<Response> => {
  try {
    const input = parseGetQuery(request);
    const status = await createService().getRepoScanStatus(input);

    if (status === null) {
      throw createActionError("validation_error");
    }

    return jsonResponse(
      {
        data: toStatusResponseData(status),
        ok: true,
      },
      200,
    );
  } catch (error) {
    return handleRouteError(error);
  }
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await parseJsonBody(request);
    const input = parsePostBody(body);
    const scan = await createService().triggerRepoScan(input);

    return jsonResponse(
      {
        data: toResponseData(scan),
        ok: true,
      },
      scan.created ? 201 : 200,
    );
  } catch (error) {
    return handleRouteError(error);
  }
};
