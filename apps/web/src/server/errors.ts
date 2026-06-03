import "server-only";

export const ACTION_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "plan_limit_exceeded",
  "validation_error",
  "internal_error",
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export type ActionErrorEnvelope = {
  code: ActionErrorCode;
  message: string;
};

export type ActionResult<TData> =
  | {
      ok: true;
      data: TData;
    }
  | {
      ok: false;
      error: ActionErrorEnvelope;
    };

const publicActionErrors = {
  forbidden: "You do not have access to this workspace.",
  internal_error: "Something went wrong.",
  plan_limit_exceeded: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
  unauthenticated: "Sign in to continue.",
  validation_error: "Check the submitted fields and try again.",
} satisfies Record<ActionErrorCode, string>;

const unsafePublicMessagePattern =
  /diff --git|patch|source|snippet|secret|token|stdout|stderr|raw output|\.env|\/Users\//iu;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const publicMessageFor = (code: ActionErrorCode, message: string | undefined): string => {
  const trimmedMessage = message?.trim();

  if (
    trimmedMessage === undefined ||
    trimmedMessage.length === 0 ||
    trimmedMessage.length > 240 ||
    hasControlCharacter(trimmedMessage) ||
    unsafePublicMessagePattern.test(trimmedMessage)
  ) {
    return publicActionErrors[code];
  }

  return trimmedMessage;
};

export class ServerActionError extends Error {
  readonly code: ActionErrorCode;

  constructor(code: ActionErrorCode, message?: string) {
    super(publicMessageFor(code, message));
    this.name = "ServerActionError";
    this.code = code;
  }
}

export const createActionError = (
  code: Exclude<ActionErrorCode, "internal_error">,
  message?: string,
) => new ServerActionError(code, message);

export const isServerActionError = (error: unknown): error is ServerActionError =>
  error instanceof ServerActionError;

export const toActionErrorEnvelope = (error: unknown): ActionErrorEnvelope => {
  if (isServerActionError(error)) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: "internal_error",
    message: publicActionErrors.internal_error,
  };
};

export const runServerAction = async <TData>(
  operation: () => Promise<TData> | TData,
): Promise<ActionResult<TData>> => {
  try {
    return {
      data: await operation(),
      ok: true,
    };
  } catch (error) {
    return {
      error: toActionErrorEnvelope(error),
      ok: false,
    };
  }
};
