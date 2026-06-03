import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RiskFindingSchema, type RiskFinding } from "@control-plane/shared";
import { afterEach, describe, expect, it } from "vitest";

import { scanChangedFilesForSecrets } from "./secret-scan.js";
import {
  scanChangedFilesForSecrets as scanChangedFilesForSecretsFromEntrypoint,
  type SecretPatternCategory as SecretPatternCategoryFromEntrypoint,
  type SecretScanFinding as SecretScanFindingFromEntrypoint,
} from "../index.js";

const SLACK_BOT_TOKEN = ["xoxb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join(
  "-",
);

const SECRET_VALUES = [
  "ghp_abcdefghijklmnopqrstuvwxyz123456",
  "github_pat_11AAABBBB0abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz",
  "sk-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
  "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
  "AKIAIOSFODNN7EXAMPLE",
  "ASIAIOSFODNN7EXAMPLE",
  SLACK_BOT_TOKEN,
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  "https://deploy-user:deploy-password@example.com/repo.git",
  "secret-assignment-value-1234567890",
  "N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1",
  "-----BEGIN PRIVATE KEY-----",
] as const;

const UNSAFE_TEXT = [
  ...SECRET_VALUES,
  "diff",
  "patch",
  "source",
  "code",
  "content",
  "stdoutSummary",
  "stderrSummary",
] as const;

const temporaryRoots: string[] = [];

describe("suspected secret scanner", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("blocks common secret patterns with schema-valid category findings", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "config/private-key.pem",
      ["-----BEGIN PRIVATE KEY-----", "not-a-real-key-body", "-----END PRIVATE KEY-----"].join(
        "\n",
      ),
    );
    await writeWorktreeFile(
      worktreePath,
      "src/provider-tokens.txt",
      [
        "githubToken=ghp_abcdefghijklmnopqrstuvwxyz123456",
        "fineGrained=github_pat_11AAABBBB0abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz",
        "openaiKey=sk-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
        "projectKey=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
        "awsAccessKey=AKIAIOSFODNN7EXAMPLE",
        "awsSessionKey=ASIAIOSFODNN7EXAMPLE",
        `slackBotToken=${SLACK_BOT_TOKEN}`,
      ].join("\n"),
    );
    await writeWorktreeFile(
      worktreePath,
      "src/jwt.txt",
      "jwtToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\n",
    );
    await writeWorktreeFile(
      worktreePath,
      "src/credential-url.txt",
      "remote=https://deploy-user:deploy-password@example.com/repo.git\n",
    );
    await writeWorktreeFile(
      worktreePath,
      "src/assignment.txt",
      "API_TOKEN=secret-assignment-value-1234567890\n",
    );
    await writeWorktreeFile(
      worktreePath,
      "src/high-entropy.txt",
      "bearer token N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1\n",
    );

    const findings = await scanChangedFilesForSecrets(worktreePath, [
      "src/high-entropy.txt",
      "src/provider-tokens.txt",
      "src/jwt.txt",
      "config/private-key.pem",
      "src/credential-url.txt",
      "src/assignment.txt",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:secret:private_key",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: private_key.",
        paths: ["config/private-key.pem"],
      },
      {
        id: "risk:secret:credential_url",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: credential_url.",
        paths: ["src/credential-url.txt"],
      },
      {
        id: "risk:secret:provider_token",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: provider_token.",
        paths: ["src/provider-tokens.txt"],
      },
      {
        id: "risk:secret:jwt",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: jwt.",
        paths: ["src/jwt.txt"],
      },
      {
        id: "risk:secret:secret_assignment",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: secret_assignment.",
        paths: ["src/assignment.txt"],
      },
      {
        id: "risk:secret:high_entropy",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: high_entropy.",
        paths: ["src/high-entropy.txt"],
      },
    ]);
    for (const finding of findings) {
      expect(RiskFindingSchema.parse(finding)).toEqual(finding);
    }
  });

  it("deduplicates paths and sorts paths within stable category findings", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "zeta/provider.txt",
      "token=ghp_abcdefghijklmnopqrstuvwxyz123456\n",
    );
    await writeWorktreeFile(
      worktreePath,
      "alpha/provider.txt",
      "token=sk-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH\n",
    );

    const findings = await scanChangedFilesForSecrets(worktreePath, [
      "zeta/provider.txt",
      "alpha/provider.txt",
      "zeta/provider.txt",
      "missing/provider.txt",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:secret:provider_token",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: provider_token.",
        paths: ["alpha/provider.txt", "zeta/provider.txt"],
      },
    ]);
  });

  it.each([
    ["github classic", "ghp_abcdefghijklmnopqrstuvwxyz123456"],
    [
      "github fine-grained",
      "github_pat_11AAABBBB0abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz",
    ],
    ["openai standard", "sk-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH"],
    ["openai project", "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH"],
    ["aws access key", "AKIAIOSFODNN7EXAMPLE"],
    ["aws session key", "ASIAIOSFODNN7EXAMPLE"],
    ["slack bot", SLACK_BOT_TOKEN],
  ])("blocks %s provider tokens independently", async (label, token) => {
    const worktreePath = await createWorktree();
    const changedPath = `src/${label.replace(/[^a-z]/g, "-")}.txt`;
    await writeWorktreeFile(worktreePath, changedPath, `value ${token}\n`);

    await expect(scanChangedFilesForSecrets(worktreePath, [changedPath])).resolves.toEqual([
      {
        id: "risk:secret:provider_token",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: provider_token.",
        paths: [changedPath],
      },
    ]);
  });

  it("uses redacted category IDs and messages without serializing secret values or source-like fields", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "src/secrets.ts",
      [
        "export const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';",
        "const source = 'implementation text that must stay local';",
      ].join("\n"),
    );

    const findings = await scanChangedFilesForSecrets(worktreePath, ["src/secrets.ts"]);

    expect(findings).toEqual([
      {
        id: "risk:secret:provider_token",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: provider_token.",
        paths: ["src/secrets.ts"],
      },
    ]);
    expectSafeSerializedValue(findings);
  });

  it("requires secret-like context for high-entropy candidates", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "src/hashes.txt",
      "checksum=N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1\n",
    );
    await writeWorktreeFile(
      worktreePath,
      "src/session.txt",
      "bearer token N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1\n",
    );

    const findings = await scanChangedFilesForSecrets(worktreePath, [
      "src/hashes.txt",
      "src/session.txt",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:secret:high_entropy",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: high_entropy.",
        paths: ["src/session.txt"],
      },
    ]);
  });

  it("blocks lower and mixed-case secret-looking assignments", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "src/lowercase.env",
      "api_token=lowercase-secret-value\n",
    );
    await writeWorktreeFile(
      worktreePath,
      "src/mixedcase.env",
      'OpenAiSecret: "mixedcase-secret-value"\n',
    );

    const findings = await scanChangedFilesForSecrets(worktreePath, [
      "src/mixedcase.env",
      "src/lowercase.env",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:secret:secret_assignment",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: secret_assignment.",
        paths: ["src/lowercase.env", "src/mixedcase.env"],
      },
    ]);
  });

  it("ignores obvious placeholders and examples", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "docs/example.env",
      [
        "API_TOKEN=<token>",
        "OPENAI_API_KEY=your_api_key",
        "GITHUB_TOKEN=placeholder",
        "SLACK_TOKEN=mock",
        "PASSWORD=changeme",
        "private_key=example",
      ].join("\n"),
    );

    await expect(scanChangedFilesForSecrets(worktreePath, ["docs/example.env"])).resolves.toEqual(
      [],
    );
  });

  it("skips missing and deleted files without leaking local filesystem errors", async () => {
    const worktreePath = await createWorktree();

    const findings = await scanChangedFilesForSecrets(worktreePath, [
      "src/missing.ts",
      "nested/deleted.txt",
    ]);

    expect(findings).toEqual([]);
    expectSafeSerializedValue(findings);
  });

  it("does not read unsafe absolute, traversal, empty, control-character, or NUL paths", async () => {
    const worktreePath = await createWorktree();
    await writeWorktreeFile(
      worktreePath,
      "safe/provider.txt",
      "token=ghp_abcdefghijklmnopqrstuvwxyz123456\n",
    );
    const outsideRoot = await createWorktree("runner-secret-scan-outside-");
    await writeWorktreeFile(outsideRoot, "outside.txt", "token=ghp_shouldnotberead1234567890\n");

    const findings = await scanChangedFilesForSecrets(worktreePath, [
      "",
      "/absolute/provider.txt",
      "C:/absolute/provider.txt",
      "../outside.txt",
      "nested/../../outside.txt",
      "has\u0007bell.txt",
      "has\u0000nul.txt",
      "safe/provider.txt",
    ]);

    expect(findings).toEqual([
      {
        id: "risk:secret:provider_token",
        severity: "blocked",
        category: "secret",
        message: "Suspected secret detected: provider_token.",
        paths: ["safe/provider.txt"],
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain("outside");
    expectSafeSerializedValue(findings);
  });

  it("does not follow symlink targets", async () => {
    const worktreePath = await createWorktree();
    const outsideRoot = await createWorktree("runner-secret-scan-symlink-target-");
    await writeWorktreeFile(outsideRoot, "target.txt", "token=ghp_shouldnotberead1234567890\n");
    await symlink(join(outsideRoot, "target.txt"), join(worktreePath, "linked-secret.txt"));

    const findings = await scanChangedFilesForSecrets(worktreePath, ["linked-secret.txt"]);

    expect(findings).toEqual([]);
    expectSafeSerializedValue(findings);
  });

  it("does not follow symlinked directories inside changed paths", async () => {
    const worktreePath = await createWorktree();
    const outsideRoot = await createWorktree("runner-secret-scan-symlink-dir-target-");
    await writeWorktreeFile(outsideRoot, "target.txt", "token=ghp_shouldnotberead1234567890\n");
    await symlink(outsideRoot, join(worktreePath, "linked-dir"));

    const findings = await scanChangedFilesForSecrets(worktreePath, ["linked-dir/target.txt"]);

    expect(findings).toEqual([]);
    expectSafeSerializedValue(findings);
  });

  it("exports the scanner from the runner entrypoint", () => {
    const category: SecretPatternCategoryFromEntrypoint = "provider_token";
    const finding: SecretScanFindingFromEntrypoint = {
      id: "risk:secret:provider_token",
      severity: "blocked",
      category: "secret",
      message: "Suspected secret detected: provider_token.",
      paths: ["src/provider.ts"],
    } satisfies RiskFinding;

    expect(category).toBe("provider_token");
    expect(finding.paths).toEqual(["src/provider.ts"]);
    expect(scanChangedFilesForSecretsFromEntrypoint).toBe(scanChangedFilesForSecrets);
  });
});

const createWorktree = async (prefix = "runner-secret-scan-"): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const writeWorktreeFile = async (
  worktreePath: string,
  relativePath: string,
  contents: string,
): Promise<void> => {
  const filePath = join(worktreePath, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, contents, "utf8");
};

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeText of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};
