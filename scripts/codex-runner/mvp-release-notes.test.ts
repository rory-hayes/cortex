import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const requiredSections = [
  "## Release Candidate Status",
  "## Repo Readiness Onboarding",
  "## Cortex Tasks",
  "## Setup PRs",
  "## Optional Runner Execution",
  "## Deferred Work",
  "## Runtime Setup Status",
  "## Known Risks And Limitations",
  "## Release Review Checklist",
] as const;

describe("MVP release notes", () => {
  test("cover the required release-readiness lanes", () => {
    const notes = readRepoFile("docs/MVP_RELEASE_NOTES.md");

    expect(notes).toContain("# Cortex MVP Release Notes");
    expect(notes).toContain("Last updated: June 4, 2026");

    for (const section of requiredSections) {
      expect(notes).toContain(section);
    }

    expect(notes).toContain("Connect GitHub");
    expect(notes).toContain("Cortex Tasks are the MVP's internal AI execution queue");
    expect(notes).toContain("Setup PRs use an elevated GitHub App permission mode");
    expect(notes).toContain("The local runner remains optional");
    expect(notes).toContain("Hosted source-code execution");
    expect(notes).toContain("docs/PRODUCTION_RUNTIME_SETUP.md");
    expect(notes).toContain("pnpm release-readiness:check");
    expect(notes).toContain("pnpm vercel-production-env:check");
    expect(notes).toContain("pnpm production-runtime:check");
    expect(notes).toContain("pnpm production-smoke:check");
    expect(notes).toContain("pnpm supabase-link:check");
    expect(notes).toContain("pnpm supabase-migrations:check");
    expect(notes).toContain("pnpm supabase-db:check");
    expect(notes).toContain("pnpm supabase-smoke:check");
    expect(notes).toContain("apps/web/src/runtime/env.ts");
    expect(notes).toContain("Canonical SQL migrations remain owned by `packages/db/migrations`");
    expect(notes).toContain("Local Supabase link is complete");
    expect(notes).toContain("linked remote migration history is readable");
    expect(notes).toContain("rory-hayes/payslip-peeks-and-probes.git");
  });

  test("keeps the release notes aligned with the trust boundary", () => {
    const notes = readRepoFile("docs/MVP_RELEASE_NOTES.md");

    expect(notes).toContain("The runner is the executor; the web app is the coordinator.");
    expect(notes).toContain("The hosted app stores metadata and audit evidence only.");
    expect(notes).toContain(
      "Raw source code, diffs, patches, code snippets, `.env` contents, secrets, private keys, and unredacted command output must not cross into hosted payloads.",
    );
    expect(notes).toContain("Approval into a task does not automatically queue a runner job");
    expect(notes).toContain("Hosted setup PR previews store filenames");
    expect(notes).toContain("Sends only safe run metadata");
  });
});
