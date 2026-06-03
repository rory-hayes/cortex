import { getDatabase } from "../../../../../src/db";
import {
  createDrizzleLinearTaskSyncStore,
  createLinearTaskSyncService,
  type SyncCortexTaskToLinearInput,
} from "../../../../../src/linear/task-sync";
import { createActionError, toActionErrorEnvelope } from "../../../../../src/server/errors";

const statusByActionErrorCode = {
  forbidden: 403,
  internal_error: 500,
  plan_limit_exceeded: 402,
  unauthenticated: 401,
  validation_error: 400,
} as const;

const allowedFields = new Set([
  "workspaceId",
  "taskId",
  "linearConnectionId",
  "teamId",
  "projectId",
  "statusId",
]);

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

const getOptionalStringField = (
  input: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = getStringField(input, field);

  return value.length > 0 ? value : undefined;
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

const parsePostBody = (body: unknown): SyncCortexTaskToLinearInput => {
  if (!isRecord(body)) {
    throw createActionError("validation_error");
  }

  assertOnlyAllowedFields(body);

  const input: SyncCortexTaskToLinearInput = {
    linearConnectionId: parseBoundedStringField(body, "linearConnectionId", 240),
    taskId: parseBoundedStringField(body, "taskId", 240),
    teamId: parseBoundedStringField(body, "teamId", 240),
    workspaceId: parseBoundedStringField(body, "workspaceId", 240),
  };
  const projectId = getOptionalStringField(body, "projectId");
  const statusId = getOptionalStringField(body, "statusId");

  if (projectId !== undefined) {
    input.projectId = projectId;
  }

  if (statusId !== undefined) {
    input.statusId = statusId;
  }

  return input;
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

  return createLinearTaskSyncService({
    store: createDrizzleLinearTaskSyncStore(db),
  });
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const parsedInput = parsePostBody(await parseJsonBody(request));
    const data = await createService().syncCortexTaskToLinear(parsedInput);

    return jsonResponse(
      {
        data,
        ok: true,
      },
      200,
    );
  } catch (error) {
    return handleRouteError(error);
  }
};
