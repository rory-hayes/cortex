import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  CodexAdapter,
  CodexExecutionRequest,
  MockCodexAdapterOptions,
  MockCodexFileChange,
} from "@control-plane/codex";

type MockCodexAdapterFactory = (options?: MockCodexAdapterOptions) => CodexAdapter;

const REQUEST_PROMPT = "PROMPT_SENTINEL implement approved fixture change locally";
const EXPLICIT_FILE_CHANGE = {
  relativePath: "docs/mock-codex-result.txt",
  contents: "Mock Codex fixture change.\n",
} satisfies MockCodexFileChange;

const DEFAULT_FILE_CHANGE = {
  relativePath: "docs/mock-codex-result.txt",
  contents: "Mock Codex fixture change.\n",
} satisfies MockCodexFileChange;

const UNSAFE_CONTENTS = [
  "OPENAI_API_KEY=sk-test-secret-value",
  "diff --git a/secret.txt b/secret.txt",
  "*** Begin Patch",
  "function leakSecret() { return 'SOURCE_SNIPPET_SENTINEL'; }",
].join("\n");

describe("createMockCodexAdapter", () => {
  it("writes explicit fixture changes and returns only a synthesized safe summary", async () => {
    const createMockCodexAdapter = await getMockFactory();
    const worktreePath = await createTempWorktree();

    try {
      const adapter = createMockCodexAdapter({
        fileChanges: [EXPLICIT_FILE_CHANGE],
      });

      const request = createRequest(worktreePath);
      const result = await adapter.execute(request);

      await expect(
        readFile(join(worktreePath, "docs", "mock-codex-result.txt"), "utf8"),
      ).resolves.toBe(EXPLICIT_FILE_CHANGE.contents);

      expect(Object.keys(result).sort()).toEqual(
        [
          "durationMs",
          "exitCode",
          "redactionApplied",
          "status",
          "stderrSummary",
          "stdoutSummary",
        ].sort(),
      );
      expect(result.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(30_000);
      expect(result.stdoutSummary).toBe("Mock Codex applied 1 file change.");
      expect(result.stderrSummary).toBe("");
      expect(result.redactionApplied).toBe(true);

      const serializedResult = JSON.stringify(result);
      expect(serializedResult).not.toContain(worktreePath);
      expect(serializedResult).not.toContain(EXPLICIT_FILE_CHANGE.relativePath);
      expect(serializedResult).not.toContain(EXPLICIT_FILE_CHANGE.contents);
      expect(serializedResult).not.toContain(request.prompt);
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("creates a deterministic safe file by default", async () => {
    const createMockCodexAdapter = await getMockFactory();
    const worktreePath = await createTempWorktree();

    try {
      const result = await createMockCodexAdapter().execute(createRequest(worktreePath));

      await expect(
        readFile(join(worktreePath, "docs", "mock-codex-result.txt"), "utf8"),
      ).resolves.toBe(DEFAULT_FILE_CHANGE.contents);
      expect(result).toMatchObject({
        status: "succeeded",
        exitCode: 0,
        stdoutSummary: "Mock Codex applied 1 file change.",
        stderrSummary: "",
        redactionApplied: true,
      });
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("allows .env.example fixture templates", async () => {
    const createMockCodexAdapter = await getMockFactory();
    const worktreePath = await createTempWorktree();
    const envExampleChange = {
      relativePath: ".env.example",
      contents: "MOCK_PLACEHOLDER=value\n",
    } satisfies MockCodexFileChange;

    try {
      const result = await createMockCodexAdapter({
        fileChanges: [envExampleChange],
      }).execute(createRequest(worktreePath));

      await expect(readFile(join(worktreePath, ".env.example"), "utf8")).resolves.toBe(
        envExampleChange.contents,
      );
      expect(result.status).toBe("succeeded");
      expect(result.stdoutSummary).toBe("Mock Codex applied 1 file change.");
      expect(JSON.stringify(result)).not.toContain(envExampleChange.contents);
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("rejects fixture changes through symlinked parent directories", async () => {
    const createMockCodexAdapter = await getMockFactory();
    const rootPath = await mkdtemp(join(tmpdir(), "aicp-mock-codex-root-"));
    const worktreePath = join(rootPath, "worktree");
    const outsidePath = join(rootPath, "outside");
    const symlinkedParent = join(worktreePath, "docs");
    const escapedFile = join(outsidePath, "mock-codex-result.txt");
    await mkdir(worktreePath);
    await mkdir(outsidePath);
    await symlink(outsidePath, symlinkedParent, "dir");

    try {
      const request = createRequest(worktreePath);
      const result = await createMockCodexAdapter({
        fileChanges: [EXPLICIT_FILE_CHANGE],
      }).execute(request);

      expect(result).toMatchObject({
        status: "failed",
        exitCode: 1,
        stdoutSummary: "",
        stderrSummary: "Mock Codex rejected unsafe file change.",
        redactionApplied: true,
      });
      await expect(pathExists(escapedFile)).resolves.toBe(false);

      const serializedResult = JSON.stringify(result);
      expect(serializedResult).not.toContain(worktreePath);
      expect(serializedResult).not.toContain(outsidePath);
      expect(serializedResult).not.toContain(EXPLICIT_FILE_CHANGE.relativePath);
      expect(serializedResult).not.toContain(EXPLICIT_FILE_CHANGE.contents);
      expect(serializedResult).not.toContain(request.prompt);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects fixture changes that would overwrite symlink targets", async () => {
    const createMockCodexAdapter = await getMockFactory();
    const rootPath = await mkdtemp(join(tmpdir(), "aicp-mock-codex-root-"));
    const worktreePath = join(rootPath, "worktree");
    const outsidePath = join(rootPath, "outside");
    const outsideFile = join(outsidePath, "mock-codex-result.txt");
    const docsPath = join(worktreePath, "docs");
    await mkdir(docsPath, { recursive: true });
    await mkdir(outsidePath);
    await writeFile(outsideFile, "outside original\n", "utf8");
    await symlink(outsideFile, join(docsPath, "mock-codex-result.txt"));

    try {
      const request = createRequest(worktreePath);
      const result = await createMockCodexAdapter({
        fileChanges: [EXPLICIT_FILE_CHANGE],
      }).execute(request);

      expect(result).toMatchObject({
        status: "failed",
        exitCode: 1,
        stdoutSummary: "",
        stderrSummary: "Mock Codex rejected unsafe file change.",
        redactionApplied: true,
      });
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside original\n");

      const serializedResult = JSON.stringify(result);
      expect(serializedResult).not.toContain(worktreePath);
      expect(serializedResult).not.toContain(outsidePath);
      expect(serializedResult).not.toContain(EXPLICIT_FILE_CHANGE.relativePath);
      expect(serializedResult).not.toContain(EXPLICIT_FILE_CHANGE.contents);
      expect(serializedResult).not.toContain(request.prompt);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects .env.example fixture templates with secret-looking contents", async () => {
    const createMockCodexAdapter = await getMockFactory();
    const worktreePath = await createTempWorktree();
    const envExampleChange = {
      relativePath: ".env.example",
      contents: "OPENAI_API_KEY=sk-test-secret-value\n",
    } satisfies MockCodexFileChange;

    try {
      const result = await createMockCodexAdapter({
        fileChanges: [envExampleChange],
      }).execute(createRequest(worktreePath));

      expect(result).toMatchObject({
        status: "failed",
        exitCode: 1,
        stdoutSummary: "",
        stderrSummary: "Mock Codex rejected unsafe file change.",
        redactionApplied: true,
      });
      await expect(pathExists(join(worktreePath, ".env.example"))).resolves.toBe(false);

      const serializedResult = JSON.stringify(result);
      expect(serializedResult).not.toContain(envExampleChange.contents);
      expect(serializedResult).not.toContain("OPENAI_API_KEY");
      expect(serializedResult).not.toContain("sk-test-secret-value");
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "absolute paths",
      relativePath: "__ABSOLUTE_PATH__",
      expectedUnwrittenFile: "absolute-target.txt",
    },
    {
      label: "parent traversal",
      relativePath: "../escape.txt",
      expectedUnwrittenFile: "escape.txt",
    },
    {
      label: "nested parent traversal",
      relativePath: "docs/../../escape.txt",
      expectedUnwrittenFile: "escape.txt",
    },
    {
      label: "real env files",
      relativePath: ".env",
      expectedUnwrittenFile: "worktree/.env",
    },
    {
      label: "nested real env files",
      relativePath: "config/.env.production",
      expectedUnwrittenFile: "worktree/config/.env.production",
    },
  ])(
    "rejects unsafe mock file changes for $label without leaking request details",
    async ({ relativePath, expectedUnwrittenFile }) => {
      const createMockCodexAdapter = await getMockFactory();
      const rootPath = await mkdtemp(join(tmpdir(), "aicp-mock-codex-root-"));
      const worktreePath = join(rootPath, "worktree");
      await mkdir(worktreePath);
      const unsafePath =
        relativePath === "__ABSOLUTE_PATH__" ? join(rootPath, "absolute-target.txt") : relativePath;

      try {
        const request = createRequest(worktreePath, {
          prompt: `${REQUEST_PROMPT}\nSECRET_PROMPT_SENTINEL`,
        });
        const result = await createMockCodexAdapter({
          fileChanges: [
            {
              relativePath: unsafePath,
              contents: UNSAFE_CONTENTS,
            },
          ],
        }).execute(request);

        expect(result).toMatchObject({
          status: "failed",
          exitCode: 1,
          stdoutSummary: "",
          stderrSummary: "Mock Codex rejected unsafe file change.",
          redactionApplied: true,
        });
        await expect(pathExists(join(rootPath, expectedUnwrittenFile))).resolves.toBe(false);

        const serializedResult = JSON.stringify(result);
        for (const unsafeFragment of [
          worktreePath,
          unsafePath,
          request.prompt,
          "SECRET_PROMPT_SENTINEL",
          "OPENAI_API_KEY",
          "sk-test-secret-value",
          "diff --git",
          "*** Begin Patch",
          "SOURCE_SNIPPET_SENTINEL",
          "function leakSecret",
          "Error:",
        ]) {
          expect(serializedResult).not.toContain(unsafeFragment);
        }
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    },
  );
});

const getMockFactory = async (): Promise<MockCodexAdapterFactory> => {
  const codexModule: Record<string, unknown> = await import("@control-plane/codex");

  expect(typeof codexModule.createMockCodexAdapter).toBe("function");

  return codexModule.createMockCodexAdapter as MockCodexAdapterFactory;
};

const createTempWorktree = (): Promise<string> => mkdtemp(join(tmpdir(), "aicp-mock-codex-"));

const createRequest = (
  worktreePath: string,
  overrides: Partial<CodexExecutionRequest> = {},
): CodexExecutionRequest => ({
  runId: "run_059",
  worktreePath,
  prompt: REQUEST_PROMPT,
  timeoutMs: 5_000,
  ...overrides,
});

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
