import "server-only";

import {
  FindingSchema,
  type CortexTaskSuggestedValidation,
  type Finding,
  type FindingCategory,
  type FindingSeverity,
  type TaskRecommendation,
} from "@control-plane/shared";

export type TaskRecommendationTemplateCandidate = Pick<
  TaskRecommendation,
  | "acceptanceCriteria"
  | "effort"
  | "executionMode"
  | "findingIds"
  | "objective"
  | "riskLevel"
  | "suggestedValidation"
  | "title"
>;

const severityToRisk = (severity: FindingSeverity): TaskRecommendation["riskLevel"] => {
  switch (severity) {
    case "blocked":
      return "blocked";
    case "high":
      return "medium";
    case "medium":
      return "medium";
    case "info":
    case "low":
      return "low";
  }
};

const categoryValidation = (category: FindingCategory): CortexTaskSuggestedValidation => {
  switch (category) {
    case "agent_readiness":
      return {
        label: "Review agent instruction coverage",
        required: true,
        validationId: "agent-readiness:review",
      };
    case "architecture":
      return {
        label: "Review architecture documentation coverage",
        required: true,
        validationId: "architecture-docs:review",
      };
    case "backlog_quality":
      return {
        label: "Review backlog task structure",
        required: true,
        validationId: "backlog-quality:review",
      };
    case "ci_cd":
      return {
        label: "Review CI validation coverage",
        required: true,
        validationId: "ci-cd:review",
      };
    case "execution_risk":
      return {
        label: "Review execution risk controls",
        required: true,
        validationId: "execution-risk:review",
      };
    case "integration":
      return {
        label: "Review integration setup",
        required: true,
        validationId: "integration:review",
      };
    case "product_clarity":
      return {
        label: "Review product clarity coverage",
        required: true,
        validationId: "product-clarity:review",
      };
    case "repo_hygiene":
      return {
        label: "Review repository hygiene setup",
        required: true,
        validationId: "repo-hygiene:review",
      };
    case "security":
      return {
        label: "Review repository policy coverage",
        required: true,
        validationId: "security-policy-coverage:review",
      };
    case "validation":
      return {
        label: "Review validation command map",
        required: true,
        validationId: "validation-posture:review",
      };
  }
};

const lowerFirst = (value: string): string =>
  value.length === 0 ? value : `${value.charAt(0).toLowerCase()}${value.slice(1)}`;

const baseTemplate = (
  finding: Finding,
  template: Omit<TaskRecommendationTemplateCandidate, "findingIds">,
): TaskRecommendationTemplateCandidate => ({
  ...template,
  findingIds: [finding.findingId],
});

const productClarityTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "A bounded product document describes the product purpose and target users.",
      "The document identifies the problem, scope, and success criteria.",
      "The update avoids raw source excerpts, secrets, local paths, diffs, and change hunks.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective:
      "Add or improve product documentation with purpose, users, problem, scope, and success criteria.",
    riskLevel: severityToRisk(finding.severity),
    suggestedValidation: [categoryValidation("product_clarity")],
    title: "Add or improve product clarity documentation",
  });

const agentReadinessTemplate = (finding: Finding): TaskRecommendationTemplateCandidate => {
  const missingAgentInstructions =
    finding.deterministicRuleId === "agent_readiness.missing_agents_md";

  return baseTemplate(finding, {
    acceptanceCriteria: [
      "Root AGENTS.md exists as the canonical coding-agent instruction file.",
      "Instructions cover project purpose, architecture boundaries, security rules, and validation expectations.",
      "Instruction updates do not include secrets, raw source snippets, or local environment details.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective: missingAgentInstructions
      ? "Generate a root AGENTS.md with project purpose, architecture boundaries, security rules, and validation expectations."
      : "Improve root AGENTS.md so coding agents receive clear project purpose, architecture boundaries, security rules, and validation expectations.",
    riskLevel: severityToRisk(finding.severity),
    suggestedValidation: [
      {
        label: "Review agent instruction coverage",
        required: true,
        validationId: "agent-instructions:review",
      },
    ],
    title: missingAgentInstructions ? "Generate root AGENTS.md" : "Improve root AGENTS.md",
  });
};

const architectureTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "Architecture documentation describes the system shape and major runtime boundaries.",
      "The document identifies package or app responsibilities without copying implementation excerpts.",
      "The document records validation and security expectations for safe AI-assisted changes.",
      "The update avoids credentials, environment-specific machine details, and change hunks.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective:
      "Add architecture documentation covering system shape, boundaries, package responsibilities, validation expectations, and security expectations.",
    riskLevel: "medium",
    suggestedValidation: [categoryValidation("architecture")],
    title: "Add architecture documentation",
  });

const backlogQualityTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "Root BACKLOG.md exists as the canonical backlog file.",
      "Backlog tasks include task identifiers, status markers, dependencies, acceptance criteria, validation guidance, and file-touch hints.",
      "Backlog metadata avoids secrets, raw private issue text, source excerpts, local machine paths, diffs, and change hunks.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective:
      "Create or improve a root backlog with AI-executable task structure, validation guidance, and execution metadata.",
    riskLevel: severityToRisk(finding.severity),
    suggestedValidation: [categoryValidation("backlog_quality")],
    title: "Improve AI-ready backlog structure",
  });

const validationTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "Repository policy includes required validation entries for typecheck, lint, format, and test gates.",
      "Each validation entry has a stable identifier, human-readable label, timeout, and required flag.",
      "Hosted repo-readiness scanning records only fixed validation labels and counts, not command text or output.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective: "Add a clear validation command map before approving AI-assisted execution.",
    riskLevel: severityToRisk(finding.severity),
    suggestedValidation: [categoryValidation("validation")],
    title: "Add validation command map",
  });

const ciCdTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "CI workflow coverage exists for detected test, typecheck, and build validation labels where applicable.",
      "Hosted repo-readiness scanning records only fixed CI/CD labels and counts, not workflow file contents or command output.",
      "The CI/CD readiness finding resolves after the metadata-only scan reports aligned coverage.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective: "Add or update CI workflow coverage for detected validation labels.",
    riskLevel: "low",
    suggestedValidation: [categoryValidation("ci_cd")],
    title: "Add CI validation workflow",
  });

const securityTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "Repository policy exists and is visible to repo-readiness inventory.",
      "Protected area rules cover high-risk directories such as CI, infrastructure, auth, billing, and policy configuration.",
      "Sensitive area rules cover credential-bearing or environment-like files using placeholders only.",
      "The setup update avoids credentials, implementation excerpts, and local machine details.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective:
      "Add repository policy coverage for protected and sensitive areas before AI execution.",
    riskLevel: "medium",
    suggestedValidation: [categoryValidation("security")],
    title: "Add repository policy coverage",
  });

const repoHygieneTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "Repository setup uses one package manager lockfile convention.",
      "Root ignore rules, contribution notes, and issue templates are present where appropriate.",
      "Monorepo structure has explicit workspace configuration when multi-package signals are present.",
      "The setup update avoids credentials, implementation excerpts, and local machine details.",
    ],
    effort: "small",
    executionMode: "setup_pr",
    objective: "Improve repository setup hygiene for safer AI-assisted execution.",
    riskLevel: finding.severity === "medium" ? "medium" : "low",
    suggestedValidation: [categoryValidation("repo_hygiene")],
    title: "Improve repository hygiene setup",
  });

const genericTemplate = (finding: Finding): TaskRecommendationTemplateCandidate =>
  baseTemplate(finding, {
    acceptanceCriteria: [
      "The recommendation remains linked to the readiness finding.",
      "The setup plan addresses the safe finding summary and recommendation.",
      "Hosted metadata excludes secrets, implementation excerpts, diffs, change hunks, local paths, and command output.",
    ],
    effort: finding.severity === "blocked" ? "medium" : "small",
    executionMode: finding.severity === "blocked" ? "planning_only" : "setup_pr",
    objective: "Resolve the readiness finding using its safe summary and recommendation.",
    riskLevel: severityToRisk(finding.severity),
    suggestedValidation: [categoryValidation(finding.category)],
    title: `Address ${lowerFirst(finding.title)}`,
  });

export const buildTaskRecommendationTemplateCandidate = (
  input: Finding,
): TaskRecommendationTemplateCandidate => {
  const finding = FindingSchema.parse(input);

  switch (finding.category) {
    case "agent_readiness":
      return agentReadinessTemplate(finding);
    case "architecture":
      return architectureTemplate(finding);
    case "backlog_quality":
      return backlogQualityTemplate(finding);
    case "ci_cd":
      return ciCdTemplate(finding);
    case "product_clarity":
      return productClarityTemplate(finding);
    case "repo_hygiene":
      return repoHygieneTemplate(finding);
    case "security":
      return securityTemplate(finding);
    case "validation":
      return validationTemplate(finding);
    case "execution_risk":
    case "integration":
      return genericTemplate(finding);
  }
};
