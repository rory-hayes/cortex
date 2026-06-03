import type { RepoPolicyWarningPathCategory, RiskFinding } from "@control-plane/shared";

import type { PathPolicyEvaluation } from "./path-policy.js";

export type PathPolicyRiskFindingCategory = Extract<
  RiskFinding["category"],
  | "protected_path"
  | "sensitive_path"
  | "package_lock"
  | "migration"
  | "infrastructure"
  | "auth"
  | "billing"
>;

type RiskFindingDefinition = {
  severity: RiskFinding["severity"];
  message: string;
};

const WARNING_CATEGORY_TO_RISK_CATEGORY = {
  packageLocks: "package_lock",
  migrations: "migration",
  infrastructure: "infrastructure",
  auth: "auth",
  billing: "billing",
} as const satisfies Record<RepoPolicyWarningPathCategory, PathPolicyRiskFindingCategory>;

const RISK_FINDING_ORDER = [
  "protected_path",
  "sensitive_path",
  "package_lock",
  "migration",
  "infrastructure",
  "auth",
  "billing",
] as const satisfies readonly PathPolicyRiskFindingCategory[];

const RISK_FINDING_DEFINITIONS = {
  protected_path: {
    severity: "blocked",
    message: "Protected path changes are blocked by repository policy.",
  },
  sensitive_path: {
    severity: "blocked",
    message: "Sensitive path changes are blocked by repository policy.",
  },
  package_lock: {
    severity: "warning",
    message: "Package lock changes require reviewer attention.",
  },
  migration: {
    severity: "warning",
    message: "Migration changes require reviewer attention.",
  },
  infrastructure: {
    severity: "warning",
    message: "Infrastructure changes require reviewer attention.",
  },
  auth: {
    severity: "warning",
    message: "Auth changes require reviewer attention.",
  },
  billing: {
    severity: "warning",
    message: "Billing changes require reviewer attention.",
  },
} as const satisfies Record<PathPolicyRiskFindingCategory, RiskFindingDefinition>;

export const buildRiskFindingsFromPathPolicyEvaluations = (
  evaluations: readonly PathPolicyEvaluation[],
): RiskFinding[] => {
  const pathsByCategory = new Map<PathPolicyRiskFindingCategory, Set<string>>();

  for (const evaluation of evaluations) {
    if (evaluation.protectedPatterns.length > 0) {
      addPath(pathsByCategory, "protected_path", evaluation.normalizedPath);
    }

    if (evaluation.sensitivePatterns.length > 0) {
      addPath(pathsByCategory, "sensitive_path", evaluation.normalizedPath);
    }

    for (const warningMatch of evaluation.warningMatches) {
      addPath(
        pathsByCategory,
        WARNING_CATEGORY_TO_RISK_CATEGORY[warningMatch.category],
        evaluation.normalizedPath,
      );
    }
  }

  return RISK_FINDING_ORDER.flatMap((category) => {
    const paths = [...(pathsByCategory.get(category) ?? [])].sort();

    if (paths.length === 0) {
      return [];
    }

    const definition = RISK_FINDING_DEFINITIONS[category];

    return [
      {
        id: `risk:${category}`,
        severity: definition.severity,
        category,
        message: definition.message,
        paths,
      },
    ];
  });
};

const addPath = (
  pathsByCategory: Map<PathPolicyRiskFindingCategory, Set<string>>,
  category: PathPolicyRiskFindingCategory,
  normalizedPath: string,
): void => {
  const paths = pathsByCategory.get(category) ?? new Set<string>();
  paths.add(normalizedPath);
  pathsByCategory.set(category, paths);
};
