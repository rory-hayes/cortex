import { getDatabase } from "../../../src/db";
import { createActionError, toActionErrorEnvelope } from "../../../src/server/errors";
import {
  createDrizzleManualTaskStore,
  createManualTaskService,
  type CreateManualTaskInput,
  type ListManualTasksInput,
  toManualTaskData,
} from "../../../src/tasks/manual-tasks";

const unsafePayloadKeys = new Set([
  "content",
  "contents",
  "dependencygraph",
  "dependencygraphs",
  "diff",
  "filecontent",
  "filecontents",
  "filetree",
  "filetrees",
  "log",
  "logs",
  "output",
  "patch",
  "rawdiff",
  "rawlog",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "rawstderr",
  "rawstdout",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stdout",
  "snippet",
  "snippets",
]);

const unsafeTextPatterns = [
  /\bdiff --git\b/i,
  /@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bxox[a-z]-[A-Za-z0-9-]{20,}\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Za-z0-9._%+-]+:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+|;)/m,
  /^\s*(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/m,
  /^\s*(?:try|else)\s*\{/m,
  /^\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)]*\)\s*;?\s*$/m,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
] as const;

const statusByActionErrorCode = {
  forbidden: 403,
  internal_error: 500,
  plan_limit_exceeded: 402,
  unauthenticated: 401,
  validation_error: 400,
} as const;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const findUnsafePayloadKey = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const unsafeKey = findUnsafePayloadKey(item, seen);
      if (unsafeKey !== undefined) {
        return unsafeKey;
      }
    }

    return undefined;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (unsafePayloadKeys.has(normalizeKey(key))) {
      return key;
    }

    const unsafeKey = findUnsafePayloadKey(childValue, seen);
    if (unsafeKey !== undefined) {
      return unsafeKey;
    }
  }

  return undefined;
};

const assertNoUnsafePayloadKeys = (value: unknown): void => {
  if (findUnsafePayloadKey(value) !== undefined) {
    throw createActionError("validation_error");
  }
};

const hasUnsafeText = (value: string): boolean =>
  hasControlCharacter(value) || unsafeTextPatterns.some((pattern) => pattern.test(value));

const findUnsafeTextValue = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (typeof value === "string") {
    return hasUnsafeText(value.trim());
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => findUnsafeTextValue(item, seen));
  }

  return Object.values(value).some((childValue) => findUnsafeTextValue(childValue, seen));
};

const assertNoUnsafeTextValues = (value: unknown): void => {
  if (findUnsafeTextValue(value)) {
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

const parseStringArrayField = (input: Record<string, unknown>, field: string): string[] => {
  const value = input[field];

  if (!Array.isArray(value)) {
    throw createActionError("validation_error");
  }

  if (!value.every((item) => typeof item === "string")) {
    throw createActionError("validation_error");
  }

  return value.map((item) => item.trim());
};

const parseOptionalStringArrayField = (
  input: Record<string, unknown>,
  field: string,
): string[] | undefined => {
  if (input[field] === undefined || input[field] === null) {
    return undefined;
  }

  return parseStringArrayField(input, field);
};

const parseSourceField = (input: Record<string, unknown>): CreateManualTaskInput["source"] => {
  const value = input.source;

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw createActionError("validation_error");
  }

  const source: NonNullable<CreateManualTaskInput["source"]> = {};
  const externalId = getOptionalStringField(value, "externalId");
  const url = getOptionalStringField(value, "url");

  if (externalId !== undefined) {
    source.externalId = externalId;
  }

  if (url !== undefined) {
    source.url = url;
  }

  return source;
};

const parsePostBody = (body: unknown): CreateManualTaskInput => {
  assertNoUnsafePayloadKeys(body);
  assertNoUnsafeTextValues(body);

  if (!isRecord(body)) {
    throw createActionError("validation_error");
  }

  const mode = body.mode;
  if (mode !== undefined && mode !== "execute" && mode !== "dryRun") {
    throw createActionError("validation_error");
  }

  const input: CreateManualTaskInput = {
    acceptanceCriteria: parseStringArrayField(body, "acceptanceCriteria"),
    objective: getStringField(body, "objective"),
    repoMappingId: getStringField(body, "repoMappingId"),
    title: getStringField(body, "title"),
    workspaceId: getStringField(body, "workspaceId"),
  };
  const contextFilePaths = parseOptionalStringArrayField(body, "contextFilePaths");
  const source = parseSourceField(body);

  if (contextFilePaths !== undefined) {
    input.contextFilePaths = contextFilePaths;
  }

  if (mode !== undefined) {
    input.mode = mode;
  }

  if (source !== undefined) {
    input.source = source;
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

const parseLimit = (value: string | null): number | undefined => {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue)) {
    throw createActionError("validation_error");
  }

  return parsedValue;
};

const parseGetRequest = (request: Request): ListManualTasksInput => {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const repoMappingId = url.searchParams.get("repoMappingId")?.trim() || undefined;
  const limit = parseLimit(url.searchParams.get("limit"));

  if (workspaceId.length === 0) {
    throw createActionError("validation_error");
  }

  const input: ListManualTasksInput = {
    workspaceId,
  };

  if (repoMappingId !== undefined) {
    input.repoMappingId = repoMappingId;
  }

  if (limit !== undefined) {
    input.limit = limit;
  }

  return input;
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

  return createManualTaskService({
    store: createDrizzleManualTaskStore(db),
  });
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await parseJsonBody(request);
    const input = parsePostBody(body);
    const service = createService();
    const task = await service.createManualTask(input);

    return jsonResponse(
      {
        data: {
          task: toManualTaskData(task),
        },
        ok: true,
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
};

export const GET = async (request: Request): Promise<Response> => {
  try {
    const input = parseGetRequest(request);
    const service = createService();
    const tasks = await service.listManualTasks(input);

    return jsonResponse(
      {
        data: {
          tasks: tasks.map(toManualTaskData),
        },
        ok: true,
      },
      200,
    );
  } catch (error) {
    return handleRouteError(error);
  }
};
