import { describe, expect, test } from "vitest";

import {
  classifyRepoScanFileRead,
  type RepoScanFileReadDecision,
} from "./repo-scan-file-allowlist.js";

const maxFileReadBytes = 1024;

const classify = (path: string, size: number | null = 100): RepoScanFileReadDecision =>
  classifyRepoScanFileRead({
    maxFileReadBytes,
    path,
    size,
  });

describe("repo scan file read allowlist", () => {
  test.each([
    ".aicp/policy.json",
    "AGENTS.md",
    "agents.md",
    "BACKLOG.md",
    "backlog.md",
    "PRODUCT.md",
    "PRODUCT_SPEC.md",
    "MVP_PLAN.md",
    "README.md",
    "docs/PRODUCT.md",
    "docs/PRODUCT_SPEC.md",
    "docs/SECURITY.md",
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "turbo.json",
    "pnpm-workspace.yml",
    "pnpm-workspace.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yaml",
  ])("allows bounded safe scan input %s", (path) => {
    expect(classify(path)).toMatchObject({ action: "read" });
  });

  test.each([
    ".env",
    ".env.local",
    ".env.production",
    ".env.example",
    "local.env",
    "api.local.env",
    "secrets/config.json",
    ".ssh/config",
    "id_rsa",
    "id_ed25519",
    "deploy.pem",
    "certificates/root.key",
    "identity.p12",
    "identity.pfx",
    "docs/token.md",
    "docs/passwords.md",
    "docs/service-credentials.md",
    "docs/client-secret.md",
    "ARCHITECTURE.md",
    "docs/ARCHITECTURE.md",
    "docs/AGENTS.md",
    "docs/BACKLOG.md",
    "src/AGENTS.md",
    "src/BACKLOG.md",
    "src/README.ts",
    "README.png",
  ])("skips unsafe or non-allowlisted scan input %s", (path) => {
    expect(classify(path)).toMatchObject({ action: "skip" });
  });

  test.each([
    [".env", "sensitive_path"],
    [".env.local", "sensitive_path"],
    [".env.example", "sensitive_path"],
    ["local.env", "sensitive_path"],
    ["api.local.env", "sensitive_path"],
    ["secrets/config.json", "secret_path"],
    [".ssh/config", "sensitive_path"],
    ["id_rsa", "private_key"],
    ["id_ed25519", "private_key"],
    ["deploy.pem", "private_key"],
    ["certificates/root.key", "private_key"],
    ["identity.p12", "private_key"],
    ["identity.pfx", "private_key"],
    ["README.png", "binary"],
    ["docs/SECURITY.pdf", "binary"],
    ["ARCHITECTURE.md", "not_allowlisted"],
    ["docs/ARCHITECTURE.md", "not_allowlisted"],
    ["docs/AGENTS.md", "not_allowlisted"],
    ["docs/BACKLOG.md", "not_allowlisted"],
    ["src/index.ts", "source_path"],
    ["src/AGENTS.md", "source_path"],
    ["src/BACKLOG.md", "source_path"],
    ["apps/web/page.tsx", "source_path"],
    ["packages/shared/src/index.ts", "source_path"],
    ["tests/app.test.ts", "source_path"],
  ] as const)("reports exact skip reason for %s", (path, reason) => {
    expect(classify(path)).toEqual({ action: "skip", reason });
  });

  test.each([
    ".aicp/policy.json",
    "AGENTS.md",
    "agents.md",
    "BACKLOG.md",
    "backlog.md",
    "PRODUCT.md",
    "PRODUCT_SPEC.md",
    "MVP_PLAN.md",
    "README.md",
    "docs/PRODUCT.md",
    "docs/PRODUCT_SPEC.md",
    "docs/SECURITY.md",
    "package.json",
    ".github/workflows/ci.yml",
  ])("reports unknown-size allowlisted file before reading %s", (path) => {
    expect(classify(path, null)).toEqual({
      action: "skip",
      reason: "unknown_size",
    });
  });

  test.each([
    ".aicp/policy.json",
    "AGENTS.md",
    "agents.md",
    "BACKLOG.md",
    "backlog.md",
    "PRODUCT.md",
    "PRODUCT_SPEC.md",
    "MVP_PLAN.md",
    "README.md",
    "docs/PRODUCT.md",
    "docs/PRODUCT_SPEC.md",
    "docs/SECURITY.md",
    "package.json",
    ".github/workflows/ci.yml",
  ])("reports oversized allowlisted file before reading %s", (path) => {
    expect(classify(path, maxFileReadBytes + 1)).toEqual({
      action: "skip",
      reason: "oversized",
    });
  });

  test("skips files with unknown or oversized tree metadata before content requests", () => {
    expect(classify("README.md", null)).toEqual({
      action: "skip",
      reason: "unknown_size",
    });
    expect(classify("README.md", maxFileReadBytes + 1)).toEqual({
      action: "skip",
      reason: "oversized",
    });
  });

  test("classifies unsafe path types before size labels", () => {
    expect(classify(".env", maxFileReadBytes + 1)).toEqual({
      action: "skip",
      reason: "sensitive_path",
    });
    expect(classify("src/README.ts", maxFileReadBytes + 1)).toEqual({
      action: "skip",
      reason: "source_path",
    });
    expect(classify("README.png", maxFileReadBytes + 1)).toEqual({
      action: "skip",
      reason: "binary",
    });
  });
});
