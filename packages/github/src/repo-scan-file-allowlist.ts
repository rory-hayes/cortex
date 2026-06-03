export type RepoScanFileReadAllowReason =
  | "agent_instructions"
  | "backlog"
  | "config"
  | "documentation"
  | "github_workflow"
  | "repo_policy";

export type RepoScanFileReadSkipReason =
  | "binary"
  | "invalid_path"
  | "not_allowlisted"
  | "oversized"
  | "private_key"
  | "secret_path"
  | "sensitive_path"
  | "source_path"
  | "unknown_size";

export type RepoScanFileReadDecision =
  | {
      action: "read";
      reason: RepoScanFileReadAllowReason;
    }
  | {
      action: "skip";
      reason: RepoScanFileReadSkipReason;
    };

export type ClassifyRepoScanFileReadInput = {
  maxFileReadBytes: number;
  path: string;
  size: number | null;
};

const POLICY_PATH = ".aicp/policy.json";
const ROOT_AGENT_INSTRUCTION_FILENAMES = new Set(["AGENTS.md", "agents.md"]);
const ROOT_BACKLOG_FILENAMES = new Set(["BACKLOG.md", "backlog.md"]);

const ROOT_CONFIG_PATTERNS = [
  /^package\.json$/u,
  /^tsconfig(?:\.[A-Za-z0-9._-]+)?\.json$/u,
  /^turbo\.json$/u,
  /^pnpm-workspace\.ya?ml$/u,
] as const;

const DOCUMENTATION_BASENAMES = new Set([
  "code_of_conduct",
  "contributing",
  "mvp_plan",
  "product",
  "product_spec",
  "readme",
  "security",
]);

const SAFE_DOCUMENTATION_EXTENSIONS = new Set([".markdown", ".md", ".txt"]);
const SAFE_WORKFLOW_EXTENSIONS = new Set([".yaml", ".yml"]);
const PRIVATE_KEY_EXTENSIONS = new Set([".key", ".p12", ".pfx", ".pem"]);
const PRIVATE_KEY_BASENAMES = new Set(["id_dsa", "id_ecdsa", "id_ed25519", "id_rsa"]);
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".webp",
  ".zip",
]);
const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);
const SOURCE_DIRECTORY_NAMES = new Set([
  "__tests__",
  "app",
  "apps",
  "lib",
  "packages",
  "spec",
  "src",
  "test",
  "tests",
]);

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const getExtension = (basename: string): string => {
  const extensionMatch = basename.match(/(\.[A-Za-z0-9]+)$/u);

  return extensionMatch?.[1]?.toLowerCase() ?? "";
};

const stripExtension = (basename: string): string => {
  const extension = getExtension(basename);

  return extension.length === 0 ? basename : basename.slice(0, -extension.length);
};

const hasValidPathShape = (path: string): boolean => {
  if (
    path.length === 0 ||
    path.trim() !== path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    hasControlCharacter(path)
  ) {
    return false;
  }

  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const isSensitivePath = (segments: string[], basename: string): boolean => {
  const lowerBasename = basename.toLowerCase();

  return (
    lowerBasename === ".env" ||
    lowerBasename.startsWith(".env.") ||
    lowerBasename === "local.env" ||
    lowerBasename.endsWith(".local.env") ||
    segments.some((segment) => segment.toLowerCase() === ".ssh")
  );
};

const isSecretPath = (segments: string[], basename: string): boolean => {
  const lowerBasename = basename.toLowerCase();

  return (
    segments.some((segment) => segment.toLowerCase() === "secrets") ||
    /(?:^|[-_.])(?:secret|secrets|token|tokens|password|passwords|credential|credentials)(?:[-_.]|$)/iu.test(
      lowerBasename,
    )
  );
};

const isPrivateKeyPath = (basename: string): boolean => {
  const lowerBasename = basename.toLowerCase();

  return (
    PRIVATE_KEY_BASENAMES.has(lowerBasename) || PRIVATE_KEY_EXTENSIONS.has(getExtension(basename))
  );
};

const isSourcePath = (segments: string[], basename: string): boolean =>
  SOURCE_EXTENSIONS.has(getExtension(basename)) ||
  segments.slice(0, -1).some((segment) => SOURCE_DIRECTORY_NAMES.has(segment.toLowerCase()));

const isRootDocumentationFile = (segments: string[], basename: string): boolean => {
  if (segments.length !== 1) {
    return false;
  }

  const extension = getExtension(basename);
  const documentationName = stripExtension(basename).toLowerCase();

  return (
    SAFE_DOCUMENTATION_EXTENSIONS.has(extension) && DOCUMENTATION_BASENAMES.has(documentationName)
  );
};

const isDocsDocumentationFile = (segments: string[], basename: string): boolean => {
  if (segments[0]?.toLowerCase() !== "docs") {
    return false;
  }

  const extension = getExtension(basename);
  const documentationName = stripExtension(basename).toLowerCase();

  return (
    SAFE_DOCUMENTATION_EXTENSIONS.has(extension) && DOCUMENTATION_BASENAMES.has(documentationName)
  );
};

const isRootConfigFile = (path: string, segments: string[]): boolean =>
  segments.length === 1 && ROOT_CONFIG_PATTERNS.some((pattern) => pattern.test(path));

const isRootAgentInstructionFile = (path: string, segments: string[]): boolean =>
  segments.length === 1 && ROOT_AGENT_INSTRUCTION_FILENAMES.has(path);

const isRootBacklogFile = (path: string, segments: string[]): boolean =>
  segments.length === 1 && ROOT_BACKLOG_FILENAMES.has(path);

const isGitHubWorkflowFile = (segments: string[], basename: string): boolean =>
  segments.length === 3 &&
  segments[0] === ".github" &&
  segments[1] === "workflows" &&
  SAFE_WORKFLOW_EXTENSIONS.has(getExtension(basename));

const getAllowReason = (
  path: string,
  segments: string[],
  basename: string,
): RepoScanFileReadAllowReason | null => {
  if (path === POLICY_PATH) {
    return "repo_policy";
  }

  if (isRootAgentInstructionFile(path, segments)) {
    return "agent_instructions";
  }

  if (isRootBacklogFile(path, segments)) {
    return "backlog";
  }

  if (isGitHubWorkflowFile(segments, basename)) {
    return "github_workflow";
  }

  if (isRootConfigFile(path, segments)) {
    return "config";
  }

  if (isRootDocumentationFile(segments, basename) || isDocsDocumentationFile(segments, basename)) {
    return "documentation";
  }

  return null;
};

export const classifyRepoScanFileRead = (
  input: ClassifyRepoScanFileReadInput,
): RepoScanFileReadDecision => {
  if (!hasValidPathShape(input.path)) {
    return { action: "skip", reason: "invalid_path" };
  }

  const segments = input.path.split("/");
  const basename = segments.at(-1) ?? "";

  if (isSensitivePath(segments, basename)) {
    return { action: "skip", reason: "sensitive_path" };
  }

  if (isSecretPath(segments, basename)) {
    return { action: "skip", reason: "secret_path" };
  }

  if (isPrivateKeyPath(basename)) {
    return { action: "skip", reason: "private_key" };
  }

  if (BINARY_EXTENSIONS.has(getExtension(basename))) {
    return { action: "skip", reason: "binary" };
  }

  if (isSourcePath(segments, basename)) {
    return { action: "skip", reason: "source_path" };
  }

  const allowReason = getAllowReason(input.path, segments, basename);

  if (allowReason === null) {
    return { action: "skip", reason: "not_allowlisted" };
  }

  if (input.size === null) {
    return { action: "skip", reason: "unknown_size" };
  }

  if (input.size > input.maxFileReadBytes) {
    return { action: "skip", reason: "oversized" };
  }

  return { action: "read", reason: allowReason };
};
