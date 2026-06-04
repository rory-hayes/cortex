import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("Auth0 auth shell", () => {
  test("keeps the root layout free of provider-side source access", async () => {
    const source = await readAppFile("./layout.tsx");

    expect(source).not.toContain("@clerk/nextjs");
    expect(source).not.toContain("ClerkProvider");
    expect(source).toMatch(/<body>\s*{children}\s*<\/body>/s);
  });

  test("defines Auth0 sign-in and sign-up bridge routes", async () => {
    const signInSource = await readAppFile("./sign-in/[[...sign-in]]/page.tsx");
    const signUpSource = await readAppFile("./sign-up/[[...sign-up]]/page.tsx");

    expect(signInSource).toContain('import { redirect } from "next/navigation";');
    expect(signInSource).toContain('redirect("/auth/login?returnTo=%2Fdashboard")');
    expect(signInSource).toContain("AuthPageFallback");
    expect(signInSource).toContain('mode="sign-in"');
    expect(signUpSource).toContain('import { redirect } from "next/navigation";');
    expect(signUpSource).toContain(
      'redirect("/auth/login?screen_hint=signup&returnTo=%2Fdashboard")',
    );
    expect(signUpSource).toContain("AuthPageFallback");
    expect(signUpSource).toContain('mode="sign-up"');
  });

  test("renders a visible auth setup fallback when Auth0 runtime config is missing", async () => {
    const source = await readAppFile("./auth-runtime.tsx");

    expect(source).toContain("hasAuth0RuntimeConfig");
    expect(source).toContain("data-auth-page={mode}");
    expect(source).toContain("Authentication setup required");
    expect(source).toContain("Configure Auth0 runtime keys");
  });

  test("keeps the Auth0 dependency represented in the workspace lockfile", async () => {
    const packageJson = JSON.parse(await readAppFile("../package.json")) as {
      dependencies?: Record<string, string>;
    };
    const lockfile = await readAppFile("../../../pnpm-lock.yaml");

    expect(packageJson.dependencies?.["@auth0/nextjs-auth0"]).toBe("4.x");
    expect(lockfile).toMatch(
      /apps\/web:\n(?:.*\n)*?\s{4}dependencies:\n(?:.*\n)*?\s{6}'@auth0\/nextjs-auth0':\n\s{8}specifier: 4\.x\n\s{8}version: /,
    );
    expect(lockfile).toContain("'@auth0/nextjs-auth0@");
  });

  test("creates the server Auth0 client", async () => {
    const source = await readAppFile("../lib/auth0.ts");

    expect(source).toContain('import { Auth0Client } from "@auth0/nextjs-auth0/server";');
    expect(source).toContain("export const auth0 = new Auth0Client({");
    expect(source).toContain('signInReturnToPath: "/dashboard"');
  });

  test("runs Auth0 middleware through the Next proxy", async () => {
    const source = await readAppFile("../proxy.ts");

    expect(source).toContain('import { auth0 } from "./lib/auth0";');
    expect(source).toContain("auth0.middleware(request)");
    expect(source).toContain("hasAuth0RuntimeConfig");
    expect(source).toContain("Authentication is not configured for this deployment.");
    expect(source).toContain("NextResponse.next()");
    expect(source).not.toContain("@clerk/nextjs");
    expect(source).toContain(
      '"/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"',
    );
  });

  test("defines a protected dashboard shell", async () => {
    const source = await readAppFile("./(app)/dashboard/page.tsx");

    expect(source).toContain("Operational overview");
    expect(source).toContain("OverviewDashboard");
  });

  test("documents only safe Auth0 environment placeholders", async () => {
    const source = await readAppFile("../.env.example");

    expect(source).toContain("APP_BASE_URL=<auth0-app-base-url-placeholder>");
    expect(source).toContain("AUTH0_DOMAIN=<auth0-domain-placeholder>");
    expect(source).toContain("AUTH0_CLIENT_ID=<auth0-client-id-placeholder>");
    expect(source).toContain("AUTH0_CLIENT_SECRET=<auth0-client-secret-placeholder>");
    expect(source).toContain("AUTH0_SECRET=<auth0-session-secret-placeholder>");
    expect(source).not.toContain("NEXT_PUBLIC_CLERK");
    expect(source).not.toContain("CLERK_SECRET_KEY");
    expect(source).not.toMatch(/\b(?:pk|sk)_(?:live|test)_[A-Za-z0-9_-]+/);
  });
});
