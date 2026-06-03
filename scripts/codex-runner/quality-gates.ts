import type { QualityFinding, QualityGateInput, QualityGateResult } from "./types.js";

export function scanQualityGates(input: QualityGateInput): QualityGateResult {
  const hardBlocks: QualityFinding[] = [];
  const warnings: QualityFinding[] = [];
  const files = input.changedFiles.map(normalizePath);
  const artifactText = input.artifactText;

  addIf(
    hardBlocks,
    files.some(isEnvFile),
    "ENV_FILE_CHANGED",
    "Environment files may contain secrets and cannot be changed by the runner.",
    files.filter(isEnvFile),
  );
  addIf(
    hardBlocks,
    containsSecret(artifactText),
    "SUSPECTED_SECRET",
    "A suspected secret appeared in runner artifacts or command output.",
    [],
  );
  addIf(
    hardBlocks,
    input.protectedPaths.some((pattern) => files.some((file) => matchesPattern(file, pattern))),
    "PROTECTED_PATH_CHANGED",
    "A protected path changed and requires manual intervention.",
    files.filter((file) => input.protectedPaths.some((pattern) => matchesPattern(file, pattern))),
  );
  addIf(
    hardBlocks,
    containsRawDiffOrPatch(artifactText),
    "RAW_DIFF_OR_PATCH_DETECTED",
    "Runner artifacts must not contain raw diffs or patches.",
    [],
  );
  addIf(
    hardBlocks,
    input.requiresTests && !files.some(isTestFile),
    "MISSING_TEST_CHANGE",
    "Code changes require corresponding test changes unless the task is docs-only.",
    files,
  );
  addIf(
    hardBlocks,
    files.includes("BACKLOG.md") && !files.includes("README.md"),
    "README_STATUS_NOT_UPDATED",
    "Backlog-moving changes must update README.md so GitHub main shows the current repository state after every push.",
    ["BACKLOG.md"],
  );

  for (const result of input.validationResults) {
    if (result.required && result.status !== "passed") {
      hardBlocks.push({
        code: "FAILED_REQUIRED_VALIDATION",
        severity: "blocked",
        message: `Required validation failed: ${result.label}.`,
        paths: [],
      });
    }
  }

  addIf(
    warnings,
    files.some(isLockfile),
    "LOCKFILE_CHANGED",
    "Package lockfile changed.",
    files.filter(isLockfile),
  );
  addIf(
    warnings,
    files.some((file) => /(^|\/)migrations?\//i.test(file)),
    "MIGRATION_CHANGED",
    "Database migration files changed.",
    files.filter((file) => /(^|\/)migrations?\//i.test(file)),
  );
  addIf(
    warnings,
    files.some(isInfrastructureFile),
    "INFRASTRUCTURE_CHANGED",
    "Infrastructure or workflow files changed.",
    files.filter(isInfrastructureFile),
  );
  addIf(
    warnings,
    files.some((file) => /(^|\/)(auth|oauth|session|sessions)(\/|\.|-)/i.test(file)),
    "AUTH_CHANGED",
    "Authentication-related files changed.",
    files.filter((file) => /(^|\/)(auth|oauth|session|sessions)(\/|\.|-)/i.test(file)),
  );
  addIf(
    warnings,
    files.some((file) => /(^|\/)(billing|stripe|payment|subscription)s?(\/|\.|-)/i.test(file)),
    "BILLING_CHANGED",
    "Billing or payment files changed.",
    files.filter((file) => /(^|\/)(billing|stripe|payment|subscription)s?(\/|\.|-)/i.test(file)),
  );
  addIf(
    warnings,
    files.length > (input.maxChangedFiles ?? 50),
    "LARGE_CHANGESET",
    "The task changed more files than the configured review threshold.",
    files,
  );
  for (const result of input.validationResults) {
    if (!result.required && result.status === "skipped") {
      warnings.push({
        code: "OPTIONAL_VALIDATION_SKIPPED",
        severity: "warning",
        message: `Optional validation skipped: ${result.label}.`,
        paths: [],
      });
    }
  }

  return {
    canProceed: hardBlocks.length === 0,
    hardBlocks,
    warnings,
  };
}

export function redactSensitiveOutput(output: string): string {
  return output
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:OPENAI|GITHUB|LINEAR|STRIPE|CLERK|SUPABASE|VERCEL|NETLIFY|AWS)[A-Z0-9_]*\s*[:=]\s*[^\s]+/gi,
      "[REDACTED]",
    )
    .replace(/\b(?:password|passwd|pwd|token|secret)\s*[:=]\s*[^\s]+/gi, "[REDACTED]")
    .replace(/\b(?:ghp|github_pat|sk|rk|xoxb|xoxp)_[A-Za-z0-9_/-]{12,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/https?:\/\/([^/\s:@]+):([^@\s/]+)@/g, "https://[REDACTED]@");
}

export function sanitizeArtifactText(output: string): string {
  return redactSensitiveOutput(output)
    .split("\n")
    .map((line) =>
      /^(diff --git|@@ |--- [ab]\/|\+\+\+ [ab]\/)/.test(line)
        ? "[REDACTED RAW DIFF OR PATCH]"
        : line,
    )
    .join("\n");
}

export function containsSecret(value: string): boolean {
  return redactSensitiveOutput(value) !== value;
}

function addIf(
  findings: QualityFinding[],
  condition: boolean,
  code: string,
  message: string,
  paths: string[],
): void {
  if (condition) {
    findings.push({
      code,
      severity:
        code === "LOCKFILE_CHANGED" ||
        code === "MIGRATION_CHANGED" ||
        code === "INFRASTRUCTURE_CHANGED" ||
        code === "AUTH_CHANGED" ||
        code === "BILLING_CHANGED" ||
        code === "LARGE_CHANGESET" ||
        code === "OPTIONAL_VALIDATION_SKIPPED"
          ? "warning"
          : "blocked",
      message,
      paths,
    });
  }
}

function containsRawDiffOrPatch(value: string): boolean {
  return (
    /(^|\n)diff --git /i.test(value) ||
    /(^|\n)@@ -\d+,\d+ \+\d+,\d+ @@/i.test(value) ||
    /(^|\n)(-{3}|\+{3}) [ab]\//.test(value)
  );
}

function isEnvFile(file: string): boolean {
  if (file === ".env.example" || file.endsWith("/.env.example")) {
    return false;
  }

  return file === ".env" || file.startsWith(".env.") || file.includes("/.env");
}

function isLockfile(file: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(file);
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function isInfrastructureFile(file: string): boolean {
  return (
    file.startsWith(".github/") ||
    file.startsWith("infra/") ||
    file.includes("/terraform/") ||
    /(^|\/)(Dockerfile|docker-compose\.ya?ml|render\.yaml|vercel\.json|netlify\.toml)$/.test(file)
  );
}

function matchesPattern(file: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  if (file === normalizedPattern || file.startsWith(`${normalizedPattern}/`)) {
    return true;
  }

  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(file);
}

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\/+/, "");
}
