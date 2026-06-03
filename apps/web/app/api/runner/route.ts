import {
  createAuthenticatedRunnerRouteHandler,
  createRouteError,
} from "../../../src/server/route-handlers";

export const POST = createAuthenticatedRunnerRouteHandler(async () => {
  throw createRouteError(
    "not_implemented",
    "Runner API placeholder is intentionally limited to shared route conventions.",
  );
});
