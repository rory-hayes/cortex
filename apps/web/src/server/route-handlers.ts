import "server-only";

import {
  authenticateRunnerRequest as defaultAuthenticateRunnerRequest,
  isRunnerAuthenticationError,
  type AuthenticatedRunnerContext,
} from "../runner-auth";

export const ROUTE_ERROR_CODES = [
  "invalid_runner_credential",
  "invalid_pairing_code",
  "invalid_request",
  "not_implemented",
  "internal_error",
] as const;

export type RouteErrorCode = (typeof ROUTE_ERROR_CODES)[number];

export type RouteErrorEnvelope = {
  code: RouteErrorCode;
  message: string;
};

type RouteErrorDescriptor = {
  message: string;
  status: number;
};

const publicRouteErrors = {
  invalid_runner_credential: {
    message: "Invalid runner credentials.",
    status: 401,
  },
  invalid_pairing_code: {
    message: "The pairing code is invalid or expired.",
    status: 401,
  },
  invalid_request: {
    message: "The request is invalid.",
    status: 400,
  },
  internal_error: {
    message: "Something went wrong.",
    status: 500,
  },
  not_implemented: {
    message: "Runner API conventions are present, but this endpoint is not implemented yet.",
    status: 501,
  },
} satisfies Record<RouteErrorCode, RouteErrorDescriptor>;

export class RunnerRouteError extends Error {
  readonly code: RouteErrorCode;

  constructor(code: RouteErrorCode, message?: string) {
    super(message ?? publicRouteErrors[code].message);
    this.name = "RunnerRouteError";
    this.code = code;
  }
}

export const createRouteError = (
  code: Exclude<RouteErrorCode, "internal_error">,
  message?: string,
) => new RunnerRouteError(code, message);

const isRunnerRouteError = (error: unknown): error is RunnerRouteError =>
  error instanceof RunnerRouteError;

const toRouteErrorResponse = (
  error: unknown,
): {
  envelope: RouteErrorEnvelope;
  status: number;
} => {
  if (isRunnerRouteError(error)) {
    const descriptor = publicRouteErrors[error.code];

    return {
      envelope: {
        code: error.code,
        message: descriptor.message,
      },
      status: descriptor.status,
    };
  }

  if (isRunnerAuthenticationError(error)) {
    const descriptor = publicRouteErrors.invalid_runner_credential;

    return {
      envelope: {
        code: "invalid_runner_credential",
        message: descriptor.message,
      },
      status: descriptor.status,
    };
  }

  return {
    envelope: {
      code: "internal_error",
      message: publicRouteErrors.internal_error.message,
    },
    status: publicRouteErrors.internal_error.status,
  };
};

const jsonResponse = (body: unknown, status: number): Response =>
  Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
    status,
  });

export const createRunnerRouteHandler =
  <TData>(handler: (request: Request) => Promise<TData> | TData) =>
  async (request: Request): Promise<Response> => {
    try {
      return jsonResponse(
        {
          data: await handler(request),
          ok: true,
        },
        200,
      );
    } catch (error) {
      const routeError = toRouteErrorResponse(error);

      return jsonResponse(
        {
          error: routeError.envelope,
          ok: false,
        },
        routeError.status,
      );
    }
  };

export type AuthenticatedRunnerRouteOptions = {
  authenticateRunner?: (
    request: Request,
  ) => AuthenticatedRunnerContext | Promise<AuthenticatedRunnerContext>;
};

export const createAuthenticatedRunnerRouteHandler =
  <TData>(
    handler: (request: Request, context: AuthenticatedRunnerContext) => Promise<TData> | TData,
    options: AuthenticatedRunnerRouteOptions = {},
  ) =>
  async (request: Request): Promise<Response> => {
    try {
      const authenticateRunner = options.authenticateRunner ?? defaultAuthenticateRunnerRequest;
      const context = await authenticateRunner(request);

      return jsonResponse(
        {
          data: await handler(request, context),
          ok: true,
        },
        200,
      );
    } catch (error) {
      const routeError = toRouteErrorResponse(error);

      return jsonResponse(
        {
          error: routeError.envelope,
          ok: false,
        },
        routeError.status,
      );
    }
  };
