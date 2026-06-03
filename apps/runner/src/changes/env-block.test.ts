import { RiskFindingSchema, type RiskFinding } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { detectEnvFileBlocks } from "./env-block.js";
import {
  detectEnvFileBlocks as detectEnvFileBlocksFromEntrypoint,
  type EnvFileBlockFinding as EnvFileBlockFindingFromEntrypoint,
} from "../index.js";

const UNSAFE_TEXT = [
  "diff --git a/private.ts b/private.ts",
  "@@ -1,1 +1,1 @@",
  "patch contains private implementation",
  "source",
  "code",
  "content",
  "stdoutSummary",
  "stderrSummary",
  "command output line",
  "SECRET_TOKEN=do-not-print",
  "ghp_envblocksecret123",
  "sk-envblocksecret123",
] as const;

describe("env file hard-block detector", () => {
  it("blocks root and nested env files with a schema-valid RiskFinding", () => {
    const findings = detectEnvFileBlocks([
      ".env",
      "apps/web/.env.local",
      "apps/runner/.env.production.local",
      "src/app.ts",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:sensitive_path:env_files",
        severity: "blocked",
        category: "sensitive_path",
        message: "Changed environment files are blocked.",
        paths: [".env", "apps/runner/.env.production.local", "apps/web/.env.local"],
      },
    ]);
    expect(RiskFindingSchema.parse(findings[0])).toEqual(findings[0]);
  });

  it("blocks local env variants by basename case-insensitively", () => {
    const findings = detectEnvFileBlocks([
      "local.env",
      "config/settings.local.env",
      "apps/web/LOCAL.ENV",
      "apps/runner/SETTINGS.LOCAL.ENV",
      "settings.env",
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.paths).toEqual([
      "apps/runner/SETTINGS.LOCAL.ENV",
      "apps/web/LOCAL.ENV",
      "config/settings.local.env",
      "local.env",
    ]);
  });

  it("allows env example templates", () => {
    expect(detectEnvFileBlocks([".env.example", "apps/web/.env.example"])).toEqual([]);
  });

  it("normalizes separators, deduplicates, and sorts blocked paths", () => {
    const findings = detectEnvFileBlocks([
      "zeta/.env",
      "apps\\web\\.env.local",
      "zeta/.env",
      ".env",
      "apps/web/.env.local",
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.paths).toEqual([".env", "apps/web/.env.local", "zeta/.env"]);
  });

  it("returns an empty array when no env-like paths changed", () => {
    expect(detectEnvFileBlocks(["src/app.ts", "docs/.env.example", "settings.env"])).toEqual([]);
  });

  it("does not serialize diffs, patches, source, command output, or secret values", () => {
    const findings = detectEnvFileBlocks([".env.local", ...UNSAFE_TEXT]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.paths).toEqual([".env.local"]);
    expectSafeSerializedValue(findings);
  });

  it("exports the detector from the runner entrypoint", () => {
    const finding: EnvFileBlockFindingFromEntrypoint = {
      id: "risk:sensitive_path:env_files",
      severity: "blocked",
      category: "sensitive_path",
      message: "Changed environment files are blocked.",
      paths: [".env"],
    } satisfies RiskFinding;

    expect(finding.paths).toEqual([".env"]);
    expect(detectEnvFileBlocksFromEntrypoint).toBe(detectEnvFileBlocks);
  });
});

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeText of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};
