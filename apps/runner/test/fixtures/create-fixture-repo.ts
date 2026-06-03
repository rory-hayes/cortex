import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { CONTRACT_VERSION, DRY_RUN_CHECKS, type RepoPolicy } from "@control-plane/shared";

import { runCommand } from "../../src/index.js";

export type FixtureRepo = {
  rootPath: string;
  repoPath: string;
  defaultBranch: string;
  policyPath: string;
  validationScriptPath: string;
  baseCommit: string;
  cleanup: () => Promise<void>;
};

export type CreateFixtureRepoOptions = {
  rootPath?: string;
  defaultBranch?: string;
  repoName?: string;
  files?: Record<string, string>;
};

const DEFAULT_REPO_NAME = "repo";
const DEFAULT_BRANCH = "main";

export const createFixtureRepo = async (
  options: CreateFixtureRepoOptions = {},
): Promise<FixtureRepo> => {
  const rootWasCreated = options.rootPath === undefined;
  const rootPath = rootWasCreated
    ? await mkdirTemporaryFixtureRoot()
    : resolve(options.rootPath ?? "");
  const defaultBranch = normalizeBranchName(options.defaultBranch ?? DEFAULT_BRANCH);
  const repoName = normalizeRepoName(options.repoName ?? DEFAULT_REPO_NAME);
  const repoPath = resolve(rootPath, repoName);

  assertInsideRoot(rootPath, repoPath);

  await mkdir(repoPath, { recursive: true });
  await writeFixtureFiles(repoPath, options.files ?? {});

  await runGit(repoPath, ["init"]);
  await runGit(repoPath, ["symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`]);
  await runGit(repoPath, ["config", "user.email", "fixture@example.invalid"]);
  await runGit(repoPath, ["config", "user.name", "Control Plane Fixture"]);
  await runGit(repoPath, ["config", "commit.gpgsign", "false"]);
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-m", "Initial fixture commit"]);

  const baseCommit = (await runGit(repoPath, ["rev-parse", "HEAD"])).stdoutSummary.trim();

  return {
    rootPath,
    repoPath,
    defaultBranch,
    policyPath: join(repoPath, ".aicp", "policy.json"),
    validationScriptPath: join(repoPath, "scripts", "validate.mjs"),
    baseCommit,
    cleanup: async () => {
      await rm(rootWasCreated ? rootPath : repoPath, { force: true, recursive: true });
    },
  };
};

const mkdirTemporaryFixtureRoot = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "control-plane-fixture-repo-"));

const writeFixtureFiles = async (
  repoPath: string,
  customFiles: Record<string, string>,
): Promise<void> => {
  const files = {
    "README.md": "# Fixture Repo\n\nSynthetic repository for runner integration tests.\n",
    "src/app.txt": "fixture application\n",
    ...customFiles,
    ".aicp/policy.json": `${JSON.stringify(createFixturePolicy(), null, 2)}\n`,
    "scripts/validate.mjs": createValidationScript(),
  };

  for (const [repoRelativePath, contents] of Object.entries(files)) {
    const normalizedPath = normalizeFixtureFilePath(repoRelativePath);
    const absolutePath = join(repoPath, normalizedPath);

    assertInsideRoot(repoPath, absolutePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }
};

const createFixturePolicy = (): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: [".aicp/**", ".github/**"],
  sensitivePaths: [".env", ".env.*", "local.env", "*.local.env"],
  warningPaths: {
    packageLocks: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    migrations: ["migrations/**", "db/migrations/**"],
    infrastructure: [".github/**", "infra/**"],
    auth: ["auth/**", "src/auth/**"],
    billing: ["billing/**", "src/billing/**"],
  },
  validationCommands: [
    {
      id: "fixture-validate",
      label: "Fixture validation",
      command: "node scripts/validate.mjs",
      timeoutSeconds: 30,
      required: true,
    },
  ],
  maxChangedFiles: 20,
  maxDiffLines: 200,
  allowUntrackedFiles: true,
  dryRunChecks: [...DRY_RUN_CHECKS],
});

const createValidationScript = (): string => `import { existsSync, readFileSync } from "node:fs";

const requiredFiles = ["README.md", "src/app.txt", ".aicp/policy.json"];

for (const filePath of requiredFiles) {
  if (!existsSync(filePath)) {
    console.error(\`fixture invalid: missing \${filePath}\`);
    process.exit(1);
  }
}

const appText = readFileSync("src/app.txt", "utf8");
if (!appText.includes("fixture application")) {
  console.error("fixture invalid: app marker missing");
  process.exit(1);
}

const policy = JSON.parse(readFileSync(".aicp/policy.json", "utf8"));
if (policy.contractVersion !== ${JSON.stringify(CONTRACT_VERSION)}) {
  console.error("fixture invalid: policy version mismatch");
  process.exit(1);
}

console.log("fixture valid");
`;

const runGit = async (repoPath: string, args: readonly string[]) =>
  runCommand({
    command: "git",
    args,
    cwd: repoPath,
    throwOnNonZero: true,
  });

const normalizeRepoName = (repoName: string): string => {
  if (
    repoName.length === 0 ||
    repoName === "." ||
    repoName === ".." ||
    repoName.includes("/") ||
    repoName.includes("\\")
  ) {
    throw new Error("Invalid fixture repo name.");
  }

  return repoName;
};

const normalizeBranchName = (branchName: string): string => {
  if (
    branchName.length === 0 ||
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    branchName.includes("..") ||
    branchName.includes("\\") ||
    branchName.includes(" ") ||
    branchName.includes("~") ||
    branchName.includes("^") ||
    branchName.includes(":") ||
    branchName.includes("?") ||
    branchName.includes("*") ||
    branchName.includes("[")
  ) {
    throw new Error("Invalid fixture default branch.");
  }

  return branchName;
};

const normalizeFixtureFilePath = (filePath: string): string => {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? "";

  if (
    normalizedPath.length === 0 ||
    normalizedPath.startsWith("/") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid fixture file path.");
  }

  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName === "local.env" ||
    fileName.endsWith(".local.env")
  ) {
    throw new Error("Fixture repos must not include env files.");
  }

  return normalizedPath;
};

const assertInsideRoot = (rootPath: string, targetPath: string): void => {
  const relativePath = relative(rootPath, targetPath);

  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Fixture path must stay inside its root.");
  }
};
