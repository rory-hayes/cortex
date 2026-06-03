import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  CONTRACT_VERSION,
  PrArtifactSchema,
  SubmitPrArtifactRequestSchema,
  type PrArtifact,
  type RiskFinding,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import { PrArtifactWriterError, writePrArtifact } from "./pr-artifact.js";

const UNSAFE_UNKNOWN_FIELD_NAMES = [
  "diff",
  "patch",
  "source",
  "code",
  "content",
  "stdout",
  "stderr",
] as const;

describe("PR artifact writer", () => {
  it("writes one schema-valid PR JSON artifact and returns the artifact", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({
      runId: "run-pr-artifact-basic",
      prNumber: 82,
    });

    const written = await writePrArtifact({ artifactRoot, artifact });

    expect(written.artifactPath).toBe(join(artifactRoot, "pr", "run-pr-artifact-basic-82.json"));
    expect(written.artifact).toEqual(artifact);

    const parsed = PrArtifactSchema.parse(JSON.parse(await readFile(written.artifactPath, "utf8")));
    expect(parsed).toEqual(artifact);
  });

  it("writes an artifact that can be embedded in a submit PR artifact request", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({ runId: "run-pr-submit-request", prNumber: 17 });

    const written = await writePrArtifact({ artifactRoot, artifact });

    expect(
      SubmitPrArtifactRequestSchema.safeParse({
        contractVersion: CONTRACT_VERSION,
        runnerId: "runner-local-1",
        runId: artifact.runId,
        artifact: written.artifact,
        submittedAt: "2026-05-22T01:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("creates the parent PR artifact directory", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({ runId: "run-pr-directory", prNumber: 3 });

    const written = await writePrArtifact({ artifactRoot, artifact });

    await expect(access(join(artifactRoot, "pr"))).resolves.toBeUndefined();
    await expect(readFile(written.artifactPath, "utf8")).resolves.toContain('"prNumber": 3');
  });

  it("rejects a pre-existing PR artifact directory symlink before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const outsideRoot = await mkdtemp(join(tmpdir(), "runner-pr-artifact-outside-dir-"));
    await symlink(outsideRoot, join(artifactRoot, "pr"), "dir");
    const artifact = validPrArtifact({ runId: "run-pr-directory-symlink", prNumber: 97 });

    const error = await expectPrArtifactWriterError(writePrArtifact({ artifactRoot, artifact }));

    expect(error.code).toBe("unsafe_artifact_path");
    await expect(
      access(join(outsideRoot, "run-pr-directory-symlink-97.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a deterministic PR artifact file symlink before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const outsideRoot = await mkdtemp(join(tmpdir(), "runner-pr-artifact-outside-file-"));
    const outsideTarget = join(outsideRoot, "outside-target.json");
    await mkdir(join(artifactRoot, "pr"));
    await writeFile(outsideTarget, "outside file must stay unchanged", "utf8");
    await symlink(outsideTarget, join(artifactRoot, "pr", "run-pr-file-symlink-98.json"));
    const artifact = validPrArtifact({ runId: "run-pr-file-symlink", prNumber: 98 });

    const error = await expectPrArtifactWriterError(writePrArtifact({ artifactRoot, artifact }));

    expect(error.code).toBe("unsafe_artifact_path");
    await expect(readFile(outsideTarget, "utf8")).resolves.toBe("outside file must stay unchanged");
  });

  it("uses run id and PR number for the filename, not PR title or branch prose", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({
      runId: "Run/With Spaces",
      branchName: "aicp/task-082-branch-prose-must-not-name-file",
      prNumber: 456,
      prTitle: "TASK-082 title prose must not name file",
    });

    const written = await writePrArtifact({ artifactRoot, artifact });
    const relativeArtifactPath = relative(artifactRoot, written.artifactPath);

    expect(relativeArtifactPath).toBe(join("pr", "run-with-spaces-456.json"));
    expect(written.artifactPath).not.toContain("branch-prose-must-not-name-file");
    expect(written.artifactPath).not.toContain("title-prose-must-not-name-file");
  });

  it("rejects raw payload and command-output fields before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifactWithUnsafeFields = {
      ...validPrArtifact({ runId: "run-pr-unsafe-fields", prNumber: 91 }),
      diff: "diff --git a/src/private.ts b/src/private.ts",
      patch: "*** Begin Patch\n*** Update File: src/private.ts",
      source: "source text must stay local",
      code: "const leaked = true;",
      content: "file content must stay local",
      stdout: "raw stdout must stay local",
      stderr: "raw stderr must stay local",
    };

    const error = await expectPrArtifactWriterError(
      writePrArtifact({ artifactRoot, artifact: artifactWithUnsafeFields }),
    );
    const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

    expect(error.code).toBe("invalid_artifact");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "<root>.<unknown>",
          message: "Unrecognized PR artifact field.",
        }),
      ]),
    );
    for (const unsafeText of [
      ...UNSAFE_UNKNOWN_FIELD_NAMES,
      "diff --git",
      "Begin Patch",
      "source text must stay local",
      "const leaked",
      "file content must stay local",
      "raw stdout must stay local",
      "raw stderr must stay local",
    ]) {
      expect(safeErrorText).not.toContain(unsafeText);
    }
    await expect(access(join(artifactRoot, "pr"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects source-like text values before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({
      runId: "run-pr-source-like-text",
      prNumber: 92,
      prTitle: ["```ts", "export const leaked = true;", "```"].join("\n"),
    });

    const error = await expectPrArtifactWriterError(writePrArtifact({ artifactRoot, artifact }));
    const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

    expect(error.code).toBe("invalid_artifact");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "prTitle",
          message: "Unsafe PR artifact text.",
        }),
      ]),
    );
    expect(safeErrorText).not.toContain("export const leaked");
    expect(safeErrorText).not.toContain("```");
    await expect(access(join(artifactRoot, "pr"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["console.log(user.email);", 'router.get("/admin", handler);'])(
    "rejects source-like text snippet %s before writing",
    async (prTitle) => {
      const artifactRoot = await createArtifactRoot();
      const artifact = validPrArtifact({
        runId: "run-pr-source-snippet-text",
        prNumber: 99,
        prTitle,
      });

      const error = await expectPrArtifactWriterError(writePrArtifact({ artifactRoot, artifact }));
      const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

      expect(error.code).toBe("invalid_artifact");
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "prTitle",
            message: "Unsafe PR artifact text.",
          }),
        ]),
      );
      expect(safeErrorText).not.toContain(prTitle);
      await expect(access(join(artifactRoot, "pr"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each([
    "/absolute/path.ts",
    "../outside.ts",
    "src\\private.ts",
    ".env",
    "config/.env.local",
    "@@ -1,2 +1,2 @@",
    "src/const leaked = true;.ts",
  ])("rejects unsafe changed file path %s before writing", async (changedFilePath) => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({
      runId: "run-pr-unsafe-path",
      prNumber: 93,
      changedFilePaths: ["src/safe.ts", changedFilePath],
    });

    const error = await expectPrArtifactWriterError(writePrArtifact({ artifactRoot, artifact }));
    const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

    expect(error.code).toBe("invalid_artifact");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "changedFilePaths.<item>",
          message: "Unsafe changed file path.",
        }),
      ]),
    );
    expect(safeErrorText).not.toContain(changedFilePath);
    await expect(access(join(artifactRoot, "pr"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows .env.example changed paths because templates are metadata-safe", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({
      runId: "run-pr-env-example",
      prNumber: 94,
      changedFilePaths: [".env.example"],
    });

    const written = await writePrArtifact({ artifactRoot, artifact });

    expect(written.artifact.changedFilePaths).toEqual([".env.example"]);
  });

  it("rejects unsafe risk finding paths and messages before writing", async () => {
    const artifactRoot = await createArtifactRoot();
    const artifact = validPrArtifact({
      runId: "run-pr-unsafe-risk",
      prNumber: 95,
      riskFindings: [
        warningFinding({
          message: "Risk message must not include const leaked = true;",
          paths: ["../secret.ts"],
        }),
      ],
    });

    const error = await expectPrArtifactWriterError(writePrArtifact({ artifactRoot, artifact }));
    const safeErrorText = `${error.message}\n${JSON.stringify(error.issues)}`;

    expect(error.code).toBe("invalid_artifact");
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "riskFindings.0.message",
          message: "Unsafe risk finding text.",
        }),
        expect.objectContaining({
          path: "riskFindings.0.paths.<item>",
          message: "Unsafe risk finding path.",
        }),
      ]),
    );
    expect(safeErrorText).not.toContain("const leaked");
    expect(safeErrorText).not.toContain("../secret.ts");
    await expect(access(join(artifactRoot, "pr"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("wraps filesystem write errors without echoing artifact payload text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-pr-artifact-file-root-"));
    const artifactRoot = join(directory, "artifact-root-file");
    await writeFile(artifactRoot, "not a directory", "utf8");
    const artifact = validPrArtifact({
      runId: "run-pr-write-failure",
      prNumber: 96,
      prTitle: "Payload title text must not appear in writer errors",
    });

    const error = await expectPrArtifactWriterError(
      writePrArtifact({ artifactRoot: join(artifactRoot, "missing-parent"), artifact }),
    );

    expect(error.code).toBe("write_failed");
    expect(error.issues).toEqual([]);
    expect(error.message).not.toContain("Payload title text must not appear");
  });

  it("exports the writer API from the runner package entrypoint", async () => {
    const runner = await import("../index.js");

    expect(runner.writePrArtifact).toBe(writePrArtifact);
    expect(runner.PrArtifactWriterError).toBe(PrArtifactWriterError);
  });
});

const createArtifactRoot = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "runner-pr-artifact-"));

const warningFinding = (overrides: Partial<RiskFinding> = {}): RiskFinding => ({
  id: "risk:package_lock",
  severity: "warning",
  category: "package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  ...overrides,
});

const validPrArtifact = (overrides: Partial<PrArtifact> = {}): PrArtifact => ({
  contractVersion: CONTRACT_VERSION,
  id: "pr:run-pr-artifact-basic:82",
  runId: "run-pr-artifact-basic",
  repository: {
    owner: "acme",
    name: "control-plane",
  },
  branchName: "aicp/task-082-add-local-pr-artifact-writer",
  prNumber: 82,
  prUrl: "https://github.example.test/acme/control-plane/pull/82",
  prTitle: "TASK-082: Add local PR artifact writer",
  prStatus: "draft",
  changedFilePaths: [
    "apps/runner/src/artifacts/pr-artifact.ts",
    "apps/runner/src/artifacts/pr-artifact.test.ts",
  ],
  riskFindings: [warningFinding()],
  createdAt: "2026-05-22T01:00:00.000Z",
  ...overrides,
});

const expectPrArtifactWriterError = async (
  promise: Promise<unknown>,
): Promise<PrArtifactWriterError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PrArtifactWriterError);
    return error as PrArtifactWriterError;
  }

  throw new Error("Expected PR artifact writer to reject.");
};
