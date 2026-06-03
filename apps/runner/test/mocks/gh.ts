import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export type MockGhHarnessOptions = {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle?: string;
};

export type MockGhInvocation = {
  command: "gh";
  args: string[];
  stdinLength: number;
  stdinSha256: string;
};

export type MockGhHarness = {
  rootPath: string;
  binDir: string;
  invocationsPath: string;
  prUrl: string;
  prTitle: string;
  readInvocations: () => Promise<MockGhInvocation[]>;
  cleanup: () => Promise<void>;
};

const MOCK_GH_PR_URL_ENV = "CONTROL_PLANE_MOCK_GH_PR_URL";
const MOCK_GH_PR_TITLE_ENV = "CONTROL_PLANE_MOCK_GH_PR_TITLE";
const MOCK_GH_INVOCATIONS_PATH_ENV = "CONTROL_PLANE_MOCK_GH_INVOCATIONS_PATH";

export const createMockGhHarness = async (
  options: MockGhHarnessOptions,
): Promise<MockGhHarness> => {
  const owner = normalizeRepositoryPart(options.owner);
  const repo = normalizeRepositoryPart(options.repo);
  const prNumber = normalizePrNumber(options.prNumber);
  const prTitle = normalizePrTitle(options.prTitle ?? "Mock pull request");
  const rootPath = await mkdtemp(join(tmpdir(), "aicp-mock-gh-"));
  const binDir = join(rootPath, "bin");
  const invocationsPath = join(rootPath, "invocations.jsonl");
  const ghPath = join(binDir, "gh");
  const prUrl = `https://github.example.test/${owner}/${repo}/pull/${prNumber}`;
  let cleaned = false;

  await mkdir(binDir, { recursive: true });
  await writeFile(ghPath, renderMockGhExecutable(), { encoding: "utf8", mode: 0o700 });
  await chmod(ghPath, 0o700);

  return {
    rootPath,
    binDir,
    invocationsPath,
    prUrl,
    prTitle,
    readInvocations: async () => readInvocations(invocationsPath),
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      await rm(rootPath, { force: true, recursive: true });
    },
  };
};

export const withMockGhOnPath = async <Result>(
  options: MockGhHarnessOptions,
  callback: (harness: MockGhHarness) => Result | Promise<Result>,
): Promise<Result> => {
  const harness = await createMockGhHarness(options);
  const originalPath = process.env.PATH;
  const originalPrUrl = process.env[MOCK_GH_PR_URL_ENV];
  const originalPrTitle = process.env[MOCK_GH_PR_TITLE_ENV];
  const originalInvocationsPath = process.env[MOCK_GH_INVOCATIONS_PATH_ENV];

  process.env.PATH =
    typeof originalPath === "string" && originalPath.length > 0
      ? `${harness.binDir}${delimiter}${originalPath}`
      : harness.binDir;
  process.env[MOCK_GH_PR_URL_ENV] = harness.prUrl;
  process.env[MOCK_GH_PR_TITLE_ENV] = harness.prTitle;
  process.env[MOCK_GH_INVOCATIONS_PATH_ENV] = harness.invocationsPath;

  try {
    return await callback(harness);
  } finally {
    restoreEnv("PATH", originalPath);
    restoreEnv(MOCK_GH_PR_URL_ENV, originalPrUrl);
    restoreEnv(MOCK_GH_PR_TITLE_ENV, originalPrTitle);
    restoreEnv(MOCK_GH_INVOCATIONS_PATH_ENV, originalInvocationsPath);
    await harness.cleanup();
  }
};

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

const readInvocations = async (invocationsPath: string): Promise<MockGhInvocation[]> => {
  let contents = "";

  try {
    contents = await readFile(invocationsPath, "utf8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return [];
    }

    throw new Error("Mock gh invocations could not be read.");
  }

  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => parseInvocation(line));
};

const parseInvocation = (line: string): MockGhInvocation => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Mock gh invocation record is invalid.");
  }

  if (!isMockGhInvocation(parsed)) {
    throw new Error("Mock gh invocation record is invalid.");
  }

  return {
    command: parsed.command,
    args: [...parsed.args],
    stdinLength: parsed.stdinLength,
    stdinSha256: parsed.stdinSha256,
  };
};

const isMockGhInvocation = (value: unknown): value is MockGhInvocation => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<MockGhInvocation>;

  return (
    record.command === "gh" &&
    Array.isArray(record.args) &&
    record.args.every((arg) => typeof arg === "string") &&
    Number.isSafeInteger(record.stdinLength) &&
    record.stdinLength !== undefined &&
    record.stdinLength >= 0 &&
    typeof record.stdinSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(record.stdinSha256)
  );
};

const normalizeRepositoryPart = (value: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    value.startsWith("-") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new Error("Invalid mock gh repository metadata.");
  }

  return value;
};

const normalizePrNumber = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Invalid mock gh pull request number.");
  }

  return value;
};

const normalizePrTitle = (value: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    throw new Error("Invalid mock gh pull request title.");
  }

  return value;
};

const renderMockGhExecutable = (): string => `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { createHash } = require("node:crypto");

const prUrl = process.env.${MOCK_GH_PR_URL_ENV};
const prTitle = process.env.${MOCK_GH_PR_TITLE_ENV};
const invocationsPath = process.env.${MOCK_GH_INVOCATIONS_PATH_ENV};

if (!prUrl || !prTitle || !invocationsPath) {
  process.stderr.write("mock gh: missing configuration\\n");
  process.exit(2);
}

let stdin = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const invocation = {
    command: "gh",
    args,
    stdinLength: Buffer.byteLength(stdin, "utf8"),
    stdinSha256: createHash("sha256").update(stdin).digest("hex"),
  };

  try {
    appendFileSync(invocationsPath, JSON.stringify(invocation) + "\\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    process.stderr.write("mock gh: invocation record failed\\n");
    process.exit(2);
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write("gh version 2.0.0 (mock)\\n");
    process.exit(0);
  }

  if (args[0] === "pr" && args[1] === "create") {
    process.stdout.write(prUrl + "\\n");
    process.exit(0);
  }

  if (args[0] === "pr" && args[1] === "view") {
    process.stdout.write(JSON.stringify({
      isDraft: true,
      number: Number(prUrl.split("/").at(-1)),
      state: "OPEN",
      title: prTitle,
      url: prUrl,
    }) + "\\n");
    process.exit(0);
  }

  process.stderr.write("mock gh: unsupported command\\n");
  process.exit(2);
});
process.stdin.resume();
`;

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;

  return typeof code === "string" ? code : undefined;
};
