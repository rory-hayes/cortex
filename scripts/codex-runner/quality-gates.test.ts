import { describe, expect, test } from "vitest";
import { redactSensitiveOutput, scanQualityGates } from "./quality-gates.js";

describe("quality gates", () => {
  test("hard-blocks env files, secrets, protected paths, and raw patch artifacts", () => {
    const result = scanQualityGates({
      changedFiles: ["src/app.ts", ".env.local", "SECURITY_MODEL.md"],
      artifactText: "diff --git a/src/app.ts b/src/app.ts\nOPENAI_API_KEY=sk-test-secret-value",
      validationResults: [],
      protectedPaths: ["SECURITY_MODEL.md"],
      requiresTests: true,
    });

    expect(result.hardBlocks.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "ENV_FILE_CHANGED",
        "SUSPECTED_SECRET",
        "PROTECTED_PATH_CHANGED",
        "RAW_DIFF_OR_PATCH_DETECTED",
        "MISSING_TEST_CHANGE",
      ]),
    );
    expect(result.canProceed).toBe(false);
  });

  test("allows env example templates while still blocking real env files", () => {
    const allowed = scanQualityGates({
      changedFiles: ["apps/web/.env.example", "apps/runner/.env.example"],
      artifactText: "safe summary",
      validationResults: [],
      protectedPaths: [],
      requiresTests: false,
    });

    expect(allowed.hardBlocks.map((finding) => finding.code)).not.toContain("ENV_FILE_CHANGED");
    expect(allowed.canProceed).toBe(true);

    const blocked = scanQualityGates({
      changedFiles: [".env", "apps/web/.env.local"],
      artifactText: "safe summary",
      validationResults: [],
      protectedPaths: [],
      requiresTests: false,
    });

    expect(blocked.hardBlocks.map((finding) => finding.code)).toContain("ENV_FILE_CHANGED");
    expect(blocked.canProceed).toBe(false);
  });

  test("warns on lockfiles, migrations, infrastructure, auth, billing, and large changes", () => {
    const result = scanQualityGates({
      changedFiles: [
        "pnpm-lock.yaml",
        "db/migrations/001.sql",
        ".github/workflows/ci.yml",
        "src/auth/session.ts",
        "src/billing/checkout.ts",
        ...Array.from({ length: 26 }, (_, index) => `src/file-${index}.ts`),
      ],
      artifactText: "safe summary",
      validationResults: [
        {
          id: "test",
          label: "Optional test",
          command: "node",
          args: ["--version"],
          timeoutMs: 1_000,
          required: false,
          status: "skipped",
          exitCode: null,
          durationMs: 0,
          stdoutSummary: "",
          stderrSummary: "",
          timedOut: false,
        },
      ],
      protectedPaths: [],
      requiresTests: false,
      maxChangedFiles: 25,
    });

    expect(result.warnings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "LOCKFILE_CHANGED",
        "MIGRATION_CHANGED",
        "INFRASTRUCTURE_CHANGED",
        "AUTH_CHANGED",
        "BILLING_CHANGED",
        "LARGE_CHANGESET",
        "OPTIONAL_VALIDATION_SKIPPED",
      ]),
    );
    expect(result.canProceed).toBe(true);
  });

  test("hard-blocks backlog updates unless README status is updated too", () => {
    const result = scanQualityGates({
      changedFiles: ["BACKLOG.md", "src/task.ts", "src/task.test.ts"],
      artifactText: "safe summary",
      validationResults: [],
      protectedPaths: [],
      requiresTests: true,
    });

    expect(result.hardBlocks.map((finding) => finding.code)).toContain("README_STATUS_NOT_UPDATED");
    expect(result.canProceed).toBe(false);
  });

  test("allows backlog updates when README status is updated", () => {
    const result = scanQualityGates({
      changedFiles: ["BACKLOG.md", "README.md", "src/task.ts", "src/task.test.ts"],
      artifactText: "safe summary",
      validationResults: [],
      protectedPaths: [],
      requiresTests: true,
    });

    expect(result.hardBlocks.map((finding) => finding.code)).not.toContain(
      "README_STATUS_NOT_UPDATED",
    );
    expect(result.canProceed).toBe(true);
  });

  test("redacts common secret patterns before logs are persisted", () => {
    const redacted = redactSensitiveOutput(
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\npassword: super-secret\nhttps://user:pass@example.com/path",
    );

    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("user:pass");
    expect(redacted).toContain("[REDACTED]");
  });
});
