import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const readRepoFile = (path: string): Promise<string> => readFile(join(repoRoot, path), "utf8");

const readRepoFileOrNull = async (path: string): Promise<string | null> => {
  try {
    return await readRepoFile(path);
  } catch {
    return null;
  }
};

const toRepoRelativePath = (path: string): string => relative(repoRoot, path).split(sep).join("/");

const collectSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !/\.test\.[tj]sx?$/u.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};

const parseEnvExample = (source: string): Array<{ key: string; value: string }> =>
  source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const equalsIndex = line.indexOf("=");

      return {
        key: equalsIndex === -1 ? line : line.slice(0, equalsIndex),
        value: equalsIndex === -1 ? "" : line.slice(equalsIndex + 1),
      };
    });

const isUseClientFile = (source: string): boolean =>
  /^(?:"use client"|'use client');?/u.test(source.trimStart());

const githubFineGrainedPrefix = ["github", "pat", ""].join("_");

const realCredentialPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}/u,
  new RegExp(String.raw`\b${githubFineGrainedPrefix}[A-Za-z0-9_]{20,}`, "u"),
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{20,}/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/u,
  /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/u,
  /postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@/iu,
] as const;

const serverSecretEnvNames = [
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "DATABASE_URL",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_TOKEN",
  "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY",
  "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_ID",
  "RUNNER_CREDENTIAL",
] as const;

const forbiddenClientImports = [
  /from\s+["'][^"']*(?:src\/(?:db|runner-auth)|src\/linear\/oauth|src\/github\/app-request)["']/u,
  /import\(\s*["'][^"']*(?:src\/(?:db|runner-auth)|src\/linear\/oauth|src\/github\/app-request)["']\s*\)/u,
  /from\s+["']@\/src\/(?:db|runner-auth|linear\/oauth|github\/app-request)["']/u,
  /import\(\s*["']@\/src\/(?:db|runner-auth|linear\/oauth|github\/app-request)["']\s*\)/u,
  /from\s+["']@control-plane\/db["']/u,
  /import\(\s*["']@control-plane\/db["']\s*\)/u,
] as const;

describe("token storage and environment exposure", () => {
  test("anchors token storage guidance from the canonical security model", async () => {
    const securityModel = await readRepoFile("SECURITY_MODEL.md");

    expect(securityModel).toContain("## Token And Secret Storage");
    expect(securityModel).toContain("docs/TOKEN_STORAGE_SECURITY.md");
  });

  test("documents server/local-only storage rules for runner, GitHub, Linear, Auth0, and database credentials", async () => {
    const tokenStorageDoc = await readRepoFileOrNull("docs/TOKEN_STORAGE_SECURITY.md");

    expect(tokenStorageDoc).not.toBeNull();

    const rules = tokenStorageDoc ?? "";

    expect(rules).toMatch(/runner pairing code/i);
    expect(rules).toMatch(/short-lived/i);
    expect(rules).toMatch(/one-time/i);
    expect(rules).toMatch(/runner credential/i);
    expect(rules).toMatch(/returned once/i);
    expect(rules).toMatch(/local runner/i);
    expect(rules).toMatch(/hash/i);
    expect(rules).toMatch(/ignored local runner config/i);
    expect(rules).toMatch(/GitHub/i);
    expect(rules).toMatch(/local\s+`?git`?\s*\/\s*`?gh`?/i);
    expect(rules).toMatch(/webhook secret/i);
    expect(rules).toMatch(/server-side environment/i);
    expect(rules).toMatch(/installation access token/i);
    expect(rules).toMatch(/transient/i);
    expect(rules).toMatch(/metadata-only/i);
    expect(rules).toMatch(/Linear/i);
    expect(rules).toMatch(/access token/i);
    expect(rules).toMatch(/refresh token/i);
    expect(rules).toMatch(/sealed|encrypted/i);
    expect(rules).toMatch(/ciphertext/i);
    expect(rules).toMatch(/key id/i);
    expect(rules).toMatch(/revoked/i);
    expect(rules).toMatch(/clear/i);
    expect(rules).toMatch(/Auth0/i);
    expect(rules).toMatch(/AUTH0_CLIENT_SECRET/);
    expect(rules).toMatch(/AUTH0_SECRET/);
    expect(rules).toMatch(/DATABASE_URL/);
    expect(rules).toMatch(/NEXT_PUBLIC_DATABASE_URL/);
    expect(rules).toMatch(/server-only/i);
    expect(rules).toMatch(/client bundle/i);
    expect(rules).toMatch(/\.env\.example/);
    expect(rules).toMatch(/placeholder/i);
    expect(rules).toMatch(/enterprise secret manager/i);
    expect(rules).toMatch(/out of scope/i);
  });

  test("keeps web environment examples placeholder-only and server scoped", async () => {
    const envExample = await readRepoFile("apps/web/.env.example");
    const entries = parseEnvExample(envExample);
    const keys = entries.map((entry) => entry.key);

    expect(keys).toEqual(
      expect.arrayContaining([
        "APP_BASE_URL",
        "AUTH0_CLIENT_ID",
        "AUTH0_DOMAIN",
        "DATABASE_URL",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_WEBHOOK_SECRET",
        "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY",
        "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_ID",
        "AUTH0_CLIENT_SECRET",
        "AUTH0_SECRET",
      ]),
    );
    expect(keys).not.toContain("NEXT_PUBLIC_DATABASE_URL");
    expect(keys).not.toContain("NEXT_PUBLIC_GITHUB_TOKEN");
    expect(keys).not.toContain("NEXT_PUBLIC_LINEAR_ACCESS_TOKEN");
    expect(envExample).not.toMatch(/^NEXT_PUBLIC_.*(?:DATABASE_URL|SECRET|TOKEN|PRIVATE_KEY)=/mu);

    const publicEnvKeys = keys.filter((key) => key.startsWith("NEXT_PUBLIC_"));

    expect(publicEnvKeys.sort()).toEqual([]);

    for (const pattern of realCredentialPatterns) {
      expect(envExample).not.toMatch(pattern);
    }

    const sensitiveEntries = entries.filter(({ key }) =>
      /(?:DATABASE_URL|SECRET|SECRET_KEY|TOKEN|PRIVATE_KEY|ENCRYPTION_KEY|CLIENT_SECRET|CREDENTIAL)$/iu.test(
        key,
      ),
    );

    expect(sensitiveEntries).not.toHaveLength(0);

    for (const entry of sensitiveEntries) {
      expect(entry.value).toMatch(/^<[^>\s]+>$/u);
    }
  });

  test("keeps client bundle candidates away from server credential env names and token modules", async () => {
    const sourceFiles = [
      ...(await collectSourceFiles(join(repoRoot, "apps/web/app"))),
      ...(await collectSourceFiles(join(repoRoot, "apps/web/components"))),
      ...(await collectSourceFiles(join(repoRoot, "apps/web/lib"))),
    ];
    const candidates: Array<{ path: string; source: string }> = [];

    for (const file of sourceFiles) {
      const source = await readFile(file, "utf8");

      if (isUseClientFile(source) || toRepoRelativePath(file).startsWith("apps/web/lib/")) {
        candidates.push({ path: toRepoRelativePath(file), source });
      }
    }

    expect(candidates.map((candidate) => candidate.path)).toEqual(
      expect.arrayContaining([
        "apps/web/components/approval-actions.tsx",
        "apps/web/components/request-repair-dialog.tsx",
        "apps/web/lib/utils.ts",
      ]),
    );

    for (const candidate of candidates) {
      expect(candidate.source, `${candidate.path} references process.env`).not.toContain(
        "process.env",
      );

      for (const envName of serverSecretEnvNames) {
        expect(candidate.source, `${candidate.path} references ${envName}`).not.toContain(envName);
      }

      for (const importPattern of forbiddenClientImports) {
        expect(
          candidate.source,
          `${candidate.path} imports a server credential module`,
        ).not.toMatch(importPattern);
      }
    }
  });

  test("keeps credential modules explicitly server-only", async () => {
    const serverOnlyModules = [
      "apps/web/src/db.ts",
      "apps/web/src/github/app-request.ts",
      "apps/web/src/linear/oauth.ts",
      "apps/web/src/runner-auth.ts",
      "apps/web/src/runner-pairing/pairing-codes.ts",
    ];

    for (const modulePath of serverOnlyModules) {
      const source = await readRepoFile(modulePath);

      expect(source.trimStart(), modulePath).toMatch(/^import "server-only";/u);
    }
  });

  test("stores runner and Linear credentials as hashes or sealed token material in the schema", async () => {
    const schemaSource = await readRepoFile("packages/db/src/schema.ts");
    const columnNames = [
      ...schemaSource.matchAll(/\b(?:boolean|integer|jsonb|text|timestamp)\("([^"]+)"/gu),
    ]
      .map((match) => match[1])
      .filter((columnName): columnName is string => columnName !== undefined);

    expect(columnNames).toEqual(expect.arrayContaining(["credential_hash"]));
    expect(columnNames).toEqual(
      expect.arrayContaining([
        "access_token_ciphertext",
        "access_token_key_id",
        "refresh_token_ciphertext",
        "refresh_token_key_id",
      ]),
    );

    const unsafeCredentialColumns = columnNames.filter((columnName) => {
      if (
        /^(?:credential_hash|access_token_ciphertext|access_token_key_id|refresh_token_ciphertext|refresh_token_key_id)$/u.test(
          columnName,
        )
      ) {
        return false;
      }

      return /(?:^|_)(?:access_token|refresh_token|token|secret|private_key|credential)(?:$|_)/iu.test(
        columnName,
      );
    });

    expect(unsafeCredentialColumns).toEqual([]);
    expect(columnNames).not.toEqual(
      expect.arrayContaining([
        "access_token",
        "refresh_token",
        "runner_credential",
        "github_installation_token",
        "github_private_key",
        "github_app_private_key",
        "github_webhook_secret",
      ]),
    );
    expect(schemaSource).toContain("linear_oauth_connections_revoked_credentials_cleared");
  });
});
