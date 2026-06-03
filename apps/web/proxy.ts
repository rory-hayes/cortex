import { NextResponse, type NextRequest } from "next/server";

import { auth0 } from "./lib/auth0";

const protectedPathPrefixes = ["/dashboard", "/workspaces"] as const;

export const hasAuth0RuntimeConfig = (): boolean =>
  Boolean(process.env.APP_BASE_URL?.trim()) &&
  Boolean(process.env.AUTH0_DOMAIN?.trim()) &&
  Boolean(process.env.AUTH0_CLIENT_ID?.trim()) &&
  Boolean(process.env.AUTH0_CLIENT_SECRET?.trim()) &&
  Boolean(process.env.AUTH0_SECRET?.trim());

const isProtectedRoute = (request: NextRequest): boolean =>
  protectedPathPrefixes.some(
    (prefix) =>
      request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`),
  );

const copyAuthHeaders = (from: NextResponse, to: NextResponse): NextResponse => {
  from.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "x-middleware-next") {
      to.headers.set(key, value);
    }
  });

  return to;
};

export async function proxy(request: NextRequest) {
  if (!hasAuth0RuntimeConfig()) {
    if (isProtectedRoute(request)) {
      return new Response("Authentication is not configured for this deployment.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
        status: 503,
      });
    }

    return NextResponse.next();
  }

  const authResponse = await auth0.middleware(request);

  if (isProtectedRoute(request) && (await auth0.getSession(request)) === null) {
    const loginUrl = new URL("/auth/login", request.url);
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    loginUrl.searchParams.set("returnTo", returnTo);

    return copyAuthHeaders(authResponse, NextResponse.redirect(loginUrl));
  }

  return authResponse;
}

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
