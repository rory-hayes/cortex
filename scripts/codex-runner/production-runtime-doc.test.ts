import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const readRepoFile = (path: string): string => readFileSync(path, "utf8");

const prohibitedCredentialMarkers = [
  ["sb", "_secret_"].join(""),
  ["sb", "_publishable_"].join(""),
  ["postgresql://", "postgres", ":"].join(""),
  ["postgres://", "postgres", ":"].join(""),
  ["YOUR", "-PASSWORD"].join(""),
  ["AUTH0_CLIENT_SECRET", "="].join(""),
  ["AUTH0_SECRET", "="].join(""),
  ["GITHUB_APP_PRIVATE_KEY", "="].join(""),
] as const;

describe("production runtime setup documentation", () => {
  test("documents required production runtime variables without secret values", () => {
    const docs = readRepoFile("docs/PRODUCTION_RUNTIME_SETUP.md");
    const normalizedDocs = docs.replace(/\s+/g, " ");

    for (const key of [
      "WEB_BASE_URL",
      "APP_BASE_URL",
      "AUTH0_DOMAIN",
      "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET",
      "AUTH0_SECRET",
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]) {
      expect(docs).toContain(key);
    }

    expect(docs).toContain("Supabase as Postgres through server-side `DATABASE_URL`");
    expect(docs).toContain("The Supabase REST URL and API keys cannot be used");
    expect(docs).toContain("Dashboard Connect panel");
    expect(docs).toContain("Database Settings");
    expect(docs).toContain("anon or publishable keys are browser-visible API keys");
    expect(docs).toContain("service-role keys are privileged server-only REST keys");
    expect(normalizedDocs).toContain("does not require a service-role key");
    expect(docs).toContain("Local Supabase link can be created");
    expect(docs).toContain("Linked migration history can be checked as safe version ids");
    expect(docs).toContain("database verification and applying canonical package migrations");
    expect(docs).toContain("Canonical SQL migrations remain in `packages/db/migrations`");
    expect(docs).toContain("pnpm release-readiness:check");
    expect(docs).toContain("pnpm vercel-production-env:check");
    expect(docs).toContain("pnpm production-runtime:check");
    expect(docs).toContain("pnpm production-smoke:check");
    expect(docs).toContain("pnpm supabase-link:check");
    expect(docs).toContain("pnpm supabase-migrations:check");
    expect(docs).toContain("pnpm supabase-db:check");
    expect(docs).toContain("pnpm supabase-smoke:check");
    expect(docs).toContain("does not verify table grants, migrations, or direct Postgres access");
    expect(docs).toContain("apps/web/src/runtime/env.test.ts");

    for (const marker of prohibitedCredentialMarkers) {
      expect(docs).not.toContain(marker);
    }
  });
});
