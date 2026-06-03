import {
  buildRiskFindingsFromPathPolicyEvaluations,
  evaluatePathsAgainstPolicy,
} from "@control-plane/policies";
import { RiskFindingSchema, type RepoPolicy, type RiskFinding } from "@control-plane/shared";

type WarningPathRiskCategory = Extract<
  RiskFinding["category"],
  "package_lock" | "migration" | "infrastructure" | "auth" | "billing"
>;

export type WarningPathFinding = RiskFinding & {
  severity: "warning";
  category: WarningPathRiskCategory;
};

const BUILT_IN_WARNING_PATHS = {
  packageLocks: [
    "**/package-lock.json",
    "**/npm-shrinkwrap.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
    "**/bun.lock",
    "**/bun.lockb",
  ],
  migrations: [
    "**/migrations/**",
    "**/migration/**",
    "prisma/migrations/**",
    "supabase/migrations/**",
    "db/migrations/**",
    "database/migrations/**",
  ],
  infrastructure: [
    ".github/workflows/**",
    ".github/actions/**",
    "infra/**",
    "infrastructure/**",
    "terraform/**",
    "pulumi/**",
    "k8s/**",
    "kubernetes/**",
    "helm/**",
    "charts/**",
    "deploy/**",
    "deployments/**",
    "cloudformation/**",
    "cdk/**",
    "**/Dockerfile",
    "**/docker-compose.yml",
    "**/docker-compose.yaml",
    "**/serverless.yml",
    "**/serverless.yaml",
    "**/*.tf",
    "netlify.toml",
    "vercel.json",
    "render.yaml",
    "fly.toml",
    "wrangler.toml",
  ],
  auth: ["**/auth/**", "**/authentication/**", "**/oauth/**"],
  billing: [
    "**/billing/**",
    "**/payments/**",
    "**/payment/**",
    "**/stripe/**",
    "**/checkout/**",
    "**/subscription/**",
    "**/subscriptions/**",
  ],
} satisfies RepoPolicy["warningPaths"];

const WARNING_RISK_CATEGORIES = new Set<RiskFinding["category"]>([
  "package_lock",
  "migration",
  "infrastructure",
  "auth",
  "billing",
]);

export const detectWarningPathFindings = (
  policy: RepoPolicy,
  changedPaths: readonly string[],
): WarningPathFinding[] => {
  const findings = buildWarningFindings(buildWarningOnlyPolicy(policy), changedPaths);

  return findings.map((finding) => {
    const parsed = RiskFindingSchema.parse(finding);

    if (!isWarningPathFinding(parsed)) {
      throw new Error("Warning path classifier produced a non-warning finding.");
    }

    return parsed;
  });
};

const buildWarningFindings = (
  policy: RepoPolicy,
  changedPaths: readonly string[],
): WarningPathFinding[] => {
  try {
    const evaluations = evaluatePathsAgainstPolicy(policy, changedPaths);
    const findings = buildRiskFindingsFromPathPolicyEvaluations(evaluations);

    return findings.filter(isWarningPathFinding);
  } catch {
    return [];
  }
};

const buildWarningOnlyPolicy = (policy: RepoPolicy): RepoPolicy => ({
  ...policy,
  protectedPaths: [],
  sensitivePaths: [],
  warningPaths: mergeWarningPaths(policy.warningPaths),
});

const mergeWarningPaths = (
  warningPaths: RepoPolicy["warningPaths"],
): RepoPolicy["warningPaths"] => ({
  packageLocks: mergePathPatterns(warningPaths.packageLocks, BUILT_IN_WARNING_PATHS.packageLocks),
  migrations: mergePathPatterns(warningPaths.migrations, BUILT_IN_WARNING_PATHS.migrations),
  infrastructure: mergePathPatterns(
    warningPaths.infrastructure,
    BUILT_IN_WARNING_PATHS.infrastructure,
  ),
  auth: mergePathPatterns(warningPaths.auth, BUILT_IN_WARNING_PATHS.auth),
  billing: mergePathPatterns(warningPaths.billing, BUILT_IN_WARNING_PATHS.billing),
});

const mergePathPatterns = (
  policyPatterns: readonly string[],
  builtInPatterns: readonly string[],
): string[] => [...new Set([...policyPatterns, ...builtInPatterns])];

const isWarningPathFinding = (finding: RiskFinding): finding is WarningPathFinding =>
  finding.severity === "warning" && WARNING_RISK_CATEGORIES.has(finding.category);
