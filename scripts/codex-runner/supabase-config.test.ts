import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const secretKeyPrefix = ["sb", "secret"].join("_");
const publishableKeyPrefix = ["sb", "publishable"].join("_");
const postgresScheme = ["postgres", "ql"].join("");
const legacyPostgresConnection = ["postgres", "://", "postgres", ":"].join("");
const placeholderPassword = ["YOUR", "PASSWORD"].join("-");
const remoteProjectRef = ["kpcsxytx", "fxvndy", "yurfgh"].join("");

const unsafeCredentialPatterns = [
  new RegExp(`${secretKeyPrefix}_[A-Za-z0-9_-]+`, "u"),
  new RegExp(`${publishableKeyPrefix}_[A-Za-z0-9_-]+`, "u"),
  new RegExp(`${postgresScheme}://postgres:`, "iu"),
  new RegExp(legacyPostgresConnection, "iu"),
  new RegExp(placeholderPassword, "u"),
  new RegExp(remoteProjectRef, "u"),
] as const;

describe("Supabase local project config", () => {
  test("keeps local setup initialized without binding remote credentials", () => {
    const config = readRepoFile("supabase/config.toml");

    expect(config).toContain('project_id = "cortex"');
    expect(config).toContain("major_version = 17");
    expect(config).toContain('openai_api_key = "env(OPENAI_API_KEY)"');
    expect(config).toContain('auth_token = "env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)"');
    expect(config).toContain('secret = "env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)"');

    for (const pattern of unsafeCredentialPatterns) {
      expect(config).not.toMatch(pattern);
    }
  });

  test("ignores generated Supabase temp state and local env files", () => {
    const gitignore = readRepoFile("supabase/.gitignore");

    expect(gitignore).toContain(".temp");
    expect(gitignore).toContain(".env.local");
    expect(gitignore).toContain(".env.*.local");
  });

  test("keeps canonical database migrations in the db package", () => {
    const migration = readRepoFile("packages/db/migrations/0022_finding_task_links.sql");

    expect(migration).toContain("CREATE TABLE");
    expect(migration).toContain("finding_task_links");
    expect(migration).toMatch(/ALTER TABLE "finding_task_links" ENABLE ROW LEVEL SECURITY/iu);
  });

  test("documents local setup without transferring migration ownership", () => {
    const readme = readRepoFile("supabase/README.md");

    expect(readme).toContain("Supabase Local Setup");
    expect(readme).toContain("Canonical SQL migrations live in `packages/db/migrations`.");
    expect(readme).toContain("Do not copy migrations into `supabase/migrations`");
    expect(readme).toContain("The local link marker is present");
    expect(readme).toContain("remote migration history as safe version ids");
    expect(readme).toContain("Direct database checks and applying canonical package migrations");
    expect(readme).toContain("pnpm supabase-migrations:check");
    expect(readme).toContain("Do not commit Supabase API keys");

    for (const pattern of unsafeCredentialPatterns) {
      expect(readme).not.toMatch(pattern);
    }
  });
});
