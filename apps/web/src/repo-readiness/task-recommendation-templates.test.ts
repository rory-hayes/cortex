import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  TaskRecommendationSchema,
  type Finding,
  type TaskRecommendation,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const importTemplates = async () => import("./task-recommendation-templates");

const now = "2026-05-29T09:00:00.000Z";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  confidence: 1,
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  deterministicRuleId: "validation_posture.partial",
  evidence: [
    {
      metadata: {},
      paths: [],
      summary: "Finding was evaluated from metadata-only scan summaries.",
    },
  ],
  findingId: "finding_1",
  category: "validation",
  recommendation: "Add a clear validation command map before approving AI-assisted execution.",
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  severity: "medium",
  source: "deterministic_rule",
  status: "open",
  summary: "The repository inventory shows partial validation metadata.",
  title: "Validation command map is incomplete",
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const recommendationFromTemplate = (
  template: Pick<
    TaskRecommendation,
    | "acceptanceCriteria"
    | "effort"
    | "executionMode"
    | "findingIds"
    | "objective"
    | "riskLevel"
    | "suggestedValidation"
    | "title"
  >,
): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    ...template,
    contractVersion: CONTRACT_VERSION,
    createdAt: now,
    metadata: {
      sourceLabel: "template_test",
    },
    repoId: "github_repository_1",
    scanId: "repo_scan_1",
    status: "open",
    taskRecommendationId: "task_recommendation_1",
    updatedAt: now,
    workspaceId: "workspace_1",
  });

describe("task recommendation templates", () => {
  test.each([
    {
      category: "product_clarity",
      deterministicRuleId: "product_clarity.missing",
      expectedTitle: "Add or improve product clarity documentation",
      severity: "high",
    },
    {
      category: "agent_readiness",
      deterministicRuleId: "agent_readiness.missing_agents_md",
      expectedTitle: "Generate root AGENTS.md",
      severity: "high",
    },
    {
      category: "architecture",
      deterministicRuleId: "architecture.missing",
      expectedTitle: "Add architecture documentation",
      severity: "high",
    },
    {
      category: "backlog_quality",
      deterministicRuleId: "backlog_quality.weak",
      expectedTitle: "Improve AI-ready backlog structure",
      severity: "medium",
    },
    {
      category: "validation",
      deterministicRuleId: "validation_posture.partial",
      expectedTitle: "Add validation command map",
      severity: "medium",
    },
    {
      category: "ci_cd",
      deterministicRuleId: "ci_cd.partial",
      expectedTitle: "Add CI validation workflow",
      severity: "medium",
    },
    {
      category: "security",
      deterministicRuleId: "security.policy_coverage_incomplete",
      expectedTitle: "Add repository policy coverage",
      severity: "medium",
    },
    {
      category: "repo_hygiene",
      deterministicRuleId: "repo_hygiene.structural_setup_risk",
      expectedTitle: "Improve repository hygiene setup",
      severity: "medium",
    },
  ] as const)(
    "builds a schema-valid setup recommendation template for $category findings",
    async ({ category, deterministicRuleId, expectedTitle, severity }) => {
      const { buildTaskRecommendationTemplateCandidate } = await importTemplates();

      const template = buildTaskRecommendationTemplateCandidate(
        finding({
          category,
          deterministicRuleId,
          severity,
        }),
      );

      expect(template).toMatchObject({
        effort: "small",
        executionMode: "setup_pr",
        findingIds: ["finding_1"],
        title: expectedTitle,
      });
      expect(template.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      expect(template.suggestedValidation.length).toBeGreaterThanOrEqual(1);
      expect(() => recommendationFromTemplate(template)).not.toThrow();
      expect(JSON.stringify(template)).not.toMatch(/rawSource|patch|diff --git|stdout|stderr/u);
    },
  );

  test("falls back to a conservative generic template for uncommon finding categories", async () => {
    const { buildTaskRecommendationTemplateCandidate } = await importTemplates();

    const template = buildTaskRecommendationTemplateCandidate(
      finding({
        category: "integration",
        deterministicRuleId: "integration.custom",
        severity: "blocked",
        title: "External integration setup is ambiguous",
      }),
    );

    expect(template).toMatchObject({
      executionMode: "planning_only",
      findingIds: ["finding_1"],
      riskLevel: "blocked",
      title: "Address external integration setup is ambiguous",
    });
    expect(template.suggestedValidation).toEqual([
      {
        label: "Review integration setup",
        required: true,
        validationId: "integration:review",
      },
    ]);
    expect(() => recommendationFromTemplate(template)).not.toThrow();
  });
});
