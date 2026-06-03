import { RiskFindingSchema, type RiskFinding } from "@control-plane/shared";

export type EnvFileBlockFinding = RiskFinding;

const ENV_FILE_RISK_ID = "risk:sensitive_path:env_files";
const ENV_FILE_RISK_MESSAGE = "Changed environment files are blocked.";

export const detectEnvFileBlocks = (changedPaths: readonly string[]): EnvFileBlockFinding[] => {
  const blockedPaths = [...new Set(changedPaths.map(normalizePath).filter(isEnvFilePath))].sort(
    comparePaths,
  );

  if (blockedPaths.length === 0) {
    return [];
  }

  return [
    RiskFindingSchema.parse({
      id: ENV_FILE_RISK_ID,
      severity: "blocked",
      category: "sensitive_path",
      message: ENV_FILE_RISK_MESSAGE,
      paths: blockedPaths,
    }),
  ];
};

const normalizePath = (path: string): string => path.replace(/\\/g, "/");

const isEnvFilePath = (path: string): boolean => {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";

  return (
    basename === ".env" ||
    (basename.startsWith(".env.") && basename !== ".env.example") ||
    basename === "local.env" ||
    basename.endsWith(".local.env")
  );
};

const comparePaths = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};
