import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  CONTRACT_VERSION,
  ValidationResultSchema,
  type ValidationResult,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import {
  ValidationArtifactWriterError,
  writeValidationResultArtifact,
} from "./validation-artifact.js";

const SECRET_FRAGMENTS = [
  "VALIDATION_ARTIFACT_DOTENV_SECRET_12345",
  "ghp_validationartifactabcdefghijklmnopqrstuvwxyz123456",
  "validation-artifact-password-12345",
  "artifact-user",
  "artifact-password",
] as const;

const UNSAFE_FIELD_NAMES = ["stdout", "stderr", "rawOutput", "code", "content"] as const;

describe("validation result artifact writer", () => {
  it("writes one schema-valid validation JSON artifact and returns the sanitized result", async () => {
    const artifactRoot = await createArtifactRoot();
    const result = validValidationResult({
      runId: "run-artifact-basic",
      commandId: "unit",
      commandLabel: "Unit validation",
      command: "pnpm test",
      stdoutSummary: "unit validation passed",
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });

    expect(written.artifactPath).toBe(
      join(artifactRoot, "validation", "run-artifact-basic-unit.json"),
    );
    expect(written.result).toEqual(result);

    const parsed = ValidationResultSchema.parse(
      JSON.parse(await readFile(written.artifactPath, "utf8")),
    );
    expect(parsed).toEqual(result);
  });

  it("creates the parent validation artifact directory", async () => {
    const artifactRoot = await createArtifactRoot();
    const result = validValidationResult({
      runId: "run-artifact-directory",
      commandId: "typecheck",
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });

    await expect(access(join(artifactRoot, "validation"))).resolves.toBeUndefined();
    await expect(readFile(written.artifactPath, "utf8")).resolves.toContain(
      '"commandId": "typecheck"',
    );
  });

  it("uses a deterministic safe filename from run id and command id, not command text", async () => {
    const artifactRoot = await createArtifactRoot();
    const commandText = "pnpm test && echo command-text-must-not-name-file";
    const result = validValidationResult({
      runId: "run/artifact path",
      commandId: "../lint command",
      command: commandText,
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });

    expect(written.artifactPath).toBe(
      join(artifactRoot, "validation", "run-artifact-path-lint-command.json"),
    );
    expect(written.artifactPath).not.toContain("command-text-must-not-name-file");
    expect(relative(artifactRoot, written.artifactPath)).toBe(
      join("validation", "run-artifact-path-lint-command.json"),
    );
  });

  it("redacts secrets in command metadata and summaries before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const result = validValidationResult({
      runId: "run-artifact-redaction",
      commandId: "secret-check",
      commandLabel: "GITHUB_TOKEN=VALIDATION_ARTIFACT_DOTENV_SECRET_12345",
      command: [
        "git clone https://artifact-user:artifact-password@example.test/repo.git",
        "echo ghp_validationartifactabcdefghijklmnopqrstuvwxyz123456",
      ].join(" && "),
      stdoutSummary: "DATABASE_PASSWORD=validation-artifact-password-12345",
      stderrSummary: "Authorization: Bearer validationArtifactBearerToken1234567890",
      redactionApplied: false,
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });
    const serialized = await readFile(written.artifactPath, "utf8");

    expect(written.result.redactionApplied).toBe(true);
    expect(serialized).toContain("[REDACTED_SECRET]");
    expect(serialized).toContain("https://[REDACTED_CREDENTIALS]@example.test/repo.git");
    for (const secretFragment of SECRET_FRAGMENTS) {
      expect(serialized).not.toContain(secretFragment);
    }
  });

  it("redacts unsafe validation identity fields before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const providerToken = "ghp_validationartifactidentityabcdefghijklmnop";
    const result = validValidationResult({
      id: `validation:${providerToken}:unit`,
      runId: ["diff --git a/src/private.ts b/src/private.ts", "+const leakedIdentity = true;"].join(
        "\n",
      ),
      commandId: `credential-${providerToken}`,
      redactionApplied: false,
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });
    const serialized = await readFile(written.artifactPath, "utf8");

    expect(written.result.id).toContain("[REDACTED_SECRET]");
    expect(written.result.runId).toBe("[REDACTED_SOURCE_LIKE_OUTPUT]");
    expect(written.result.commandId).toContain("[REDACTED_SECRET]");
    expect(written.result.redactionApplied).toBe(true);
    for (const unsafeText of [providerToken, "diff --git", "leakedIdentity", "src/private.ts"]) {
      expect(serialized).not.toContain(unsafeText);
    }
  });

  it("suppresses diff, patch, fenced code, and source-like validation summaries", async () => {
    const artifactRoot = await createArtifactRoot();
    const result = validValidationResult({
      runId: "run-artifact-source-like",
      commandId: "source-summary",
      stdoutSummary: [
        "diff --git a/src/private.ts b/src/private.ts",
        "@@ -1,2 +1,2 @@",
        "+const leakedValue = 'must-not-leak';",
      ].join("\n"),
      stderrSummary: ["```ts", "export const leaked = true;", "```"].join("\n"),
      redactionApplied: false,
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });
    const serialized = await readFile(written.artifactPath, "utf8");

    expect(written.result.stdoutSummary).toBe("[REDACTED_SOURCE_LIKE_OUTPUT]");
    expect(written.result.stderrSummary).toBe("[REDACTED_SOURCE_LIKE_OUTPUT]");
    expect(written.result.redactionApplied).toBe(true);
    for (const unsafeText of [
      "diff --git",
      "@@ -1,2 +1,2 @@",
      "leakedValue",
      "export const leaked",
      "```",
    ]) {
      expect(serialized).not.toContain(unsafeText);
    }
  });

  it("does not write raw stream, output, code, or content fields", async () => {
    const artifactRoot = await createArtifactRoot();
    const resultWithExtraFields = {
      ...validValidationResult({ runId: "run-artifact-extra-fields", commandId: "unit" }),
      stdout: "raw stdout must stay local",
      stderr: "raw stderr must stay local",
      rawOutput: "raw output must stay local",
      code: "const leaked = true;",
      content: "source content must stay local",
    };

    const error = await expectValidationArtifactWriterError(
      writeValidationResultArtifact({ artifactRoot, result: resultWithExtraFields }),
    );

    expect(error.code).toBe("invalid_result");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "<root>.<unknown>",
          message: "Unrecognized validation result field.",
        }),
      ]),
    );
    for (const unsafeText of [
      ...UNSAFE_FIELD_NAMES,
      "raw stdout must stay local",
      "raw stderr must stay local",
      "raw output must stay local",
      "const leaked = true",
      "source content must stay local",
    ]) {
      expect(`${error.message}\n${JSON.stringify(error.issues)}`).not.toContain(unsafeText);
    }
    await expect(access(join(artifactRoot, "validation"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not echo unsafe unknown validation fields in invalid-result errors", async () => {
    const artifactRoot = await createArtifactRoot();
    const unsafeUnknownKey = "ghp_validationartifactunknownabcdefghijklmnop";
    const unsafeDiffKey = "diff --git a/src/private.ts b/src/private.ts";
    const resultWithUnsafeUnknownKeys = {
      ...validValidationResult({
        runId: "run-artifact-invalid-unknown-key",
        commandId: "unit",
      }),
      [unsafeUnknownKey]: "unknown field value must stay local",
      [unsafeDiffKey]: "diff key must stay local",
    };

    const error = await expectValidationArtifactWriterError(
      writeValidationResultArtifact({ artifactRoot, result: resultWithUnsafeUnknownKeys }),
    );
    const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

    expect(error.code).toBe("invalid_result");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "<root>.<unknown>",
          message: "Unrecognized validation result field.",
        }),
      ]),
    );
    for (const unsafeText of [
      unsafeUnknownKey,
      unsafeDiffKey,
      "unknown field value must stay local",
      "diff key must stay local",
      "src/private.ts",
    ]) {
      expect(safeErrorText).not.toContain(unsafeText);
    }
    await expect(access(join(artifactRoot, "validation"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects schema-invalid validation results before creating a file", async () => {
    const artifactRoot = await createArtifactRoot();
    const invalidResult = {
      ...validValidationResult({ runId: "run-artifact-invalid-schema", commandId: "unit" }),
      exitCode: -1,
    };

    const error = await expectValidationArtifactWriterError(
      writeValidationResultArtifact({ artifactRoot, result: invalidResult }),
    );

    expect(error.code).toBe("invalid_result");
    expect(error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "exitCode" })]),
    );
    await expect(access(join(artifactRoot, "validation"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps traversal-shaped run and command ids inside the artifact root", async () => {
    const artifactRoot = await createArtifactRoot();
    const result = validValidationResult({
      runId: "../../outside/.env",
      commandId: "../../secret",
    });

    const written = await writeValidationResultArtifact({ artifactRoot, result });
    const relativeArtifactPath = relative(artifactRoot, written.artifactPath);

    expect(relativeArtifactPath).toBe(join("validation", "outside-env-secret.json"));
    expect(relativeArtifactPath.startsWith("..")).toBe(false);
    await expect(readFile(written.artifactPath, "utf8")).resolves.toContain(
      '"runId": "outside-env"',
    );
  });

  it("wraps filesystem write errors without echoing validation payload text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-validation-artifact-file-root-"));
    const artifactRoot = join(directory, "artifact-root-file");
    await writeFile(artifactRoot, "not a directory", "utf8");
    const result = validValidationResult({
      runId: "run-artifact-write-failure",
      commandId: "unit",
      stdoutSummary: "payload text must not appear in writer errors",
    });

    const error = await expectValidationArtifactWriterError(
      writeValidationResultArtifact({ artifactRoot: join(artifactRoot, "missing-parent"), result }),
    );

    expect(error.code).toBe("write_failed");
    expect(error.issues).toEqual([]);
    expect(error.message).not.toContain("payload text must not appear in writer errors");
  });

  it("exports the writer API from the runner package entrypoint", async () => {
    const runner = await import("../index.js");

    expect(runner.writeValidationResultArtifact).toBe(writeValidationResultArtifact);
    expect(runner.ValidationArtifactWriterError).toBe(ValidationArtifactWriterError);
  });
});

const createArtifactRoot = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "runner-validation-artifact-"));

const validValidationResult = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
  contractVersion: CONTRACT_VERSION,
  id: "validation:run-artifact-basic:unit",
  runId: "run-artifact-basic",
  commandId: "unit",
  commandLabel: "Unit validation",
  command: "pnpm test",
  status: "passed",
  exitCode: 0,
  durationMs: 24,
  stdoutSummary: "",
  stderrSummary: "",
  redactionApplied: false,
  startedAt: "2026-05-21T22:00:00.000Z",
  finishedAt: "2026-05-21T22:00:01.000Z",
  ...overrides,
});

const expectValidationArtifactWriterError = async (
  promise: Promise<unknown>,
): Promise<ValidationArtifactWriterError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationArtifactWriterError);
    return error as ValidationArtifactWriterError;
  }

  throw new Error("Expected validation artifact writer to reject.");
};
