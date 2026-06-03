import { getDatabase } from "../../../../../src/db";
import {
  createDrizzleLinearIssueCandidateImportStore,
  createLinearIssueCandidateImportService,
  type ImportLinearIssueCandidateInput,
} from "../../../../../src/linear/import-candidates";
import { createActionError, toActionErrorEnvelope } from "../../../../../src/server/errors";

const statusByActionErrorCode = {
  forbidden: 403,
  internal_error: 500,
  plan_limit_exceeded: 402,
  unauthenticated: 401,
  validation_error: 400,
} as const;

const allowedFields = new Set(["workspaceid", "linearissuecandidateid", "repoid"]);

const normalizeFieldName = (field: string): string => field.toLowerCase().replace(/[^a-z0-9]/g, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertOnlyAllowedFields = (value: Record<string, unknown>): void => {
  if (Object.keys(value).some((field) => !allowedFields.has(normalizeFieldName(field)))) {
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

const parsePostBody = (body: unknown): ImportLinearIssueCandidateInput => {
  if (!isRecord(body)) {
    throw createActionError("validation_error");
  }

  assertOnlyAllowedFields(body);

  return {
    linearIssueCandidateId: parseBoundedStringField(body, "linearIssueCandidateId", 240),
    repoId: parseBoundedStringField(body, "repoId", 240),
    workspaceId: parseBoundedStringField(body, "workspaceId", 240),
  };
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

  return createLinearIssueCandidateImportService({
    store: createDrizzleLinearIssueCandidateImportStore(db),
  });
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await parseJsonBody(request);
    const input = parsePostBody(body);
    const data = await createService().importLinearIssueCandidate(input);

    return jsonResponse(
      {
        data,
        ok: true,
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
};
