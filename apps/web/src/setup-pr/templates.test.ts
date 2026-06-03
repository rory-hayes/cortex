import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  RepoPolicySchema,
  type CortexTask,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const importTemplates = async () => import("./templates");

const now = "2026-06-02T08:00:00.000Z";

const cortexTask = (overrides: Partial<CortexTask> = {}): CortexTask =>
  CortexTaskSchema.parse({
    acceptanceCriteria: [
      "The generated setup artifact is reviewable before PR creation.",
      "The generated setup artifact is marked as requiring human review.",
    ],
    approvalStatus: "approved",
    contractVersion: CONTRACT_VERSION,
    createdAt: now,
    executionMode: "setup_pr",
    externalLinks: [],
    findingIds: ["finding_1"],
    metadata: {
      sourceLabel: "setup_pr_template_test",
    },
    objective: "Generate bounded setup files from approved metadata-only recommendations.",
    origin: {
      type: "task_recommendation",
    },
    prArtifactIds: [],
    repoId: "github_repo_1",
    riskLevel: "medium",
    runIds: [],
    status: "approved",
    suggestedValidation: [
      {
        label: "Review validation command map",
        required: true,
        validationId: "validation-posture:review",
      },
    ],
    taskId: "cortex_task_1",
    taskRecommendationId: "task_recommendation_1",
    title: "Add validation command map",
    updatedAt: now,
    workspaceId: "workspace_1",
    ...overrides,
  });

const unsafeGeneratedContentPattern =
  /diff --git|@@ -|process\.env|PRIVATE KEY|sb_secret|token=|rawSource|sourceCode|patchText|\/Users\/rory/u;

describe("setup PR file templates", () => {
  test("defines deterministic allowlisted setup file templates", async () => {
    const { listSetupPrFileTemplates } = await importTemplates();

    const templates = listSetupPrFileTemplates();

    expect(templates.map((template) => template.templateId)).toEqual([
      "repo_policy",
      "ci_workflow",
      "agent_instructions",
      "architecture_doc",
      "backlog",
      "contributing",
      "product_spec",
      "integration_notes",
    ]);
    expect(templates.map((template) => template.path)).toEqual([
      ".aicp/policy.json",
      ".github/workflows/cortex-validation.yml",
      "AGENTS.md",
      "ARCHITECTURE.md",
      "BACKLOG.md",
      "CONTRIBUTING.md",
      "PRODUCT_SPEC.md",
      "docs/CORTEX_INTEGRATIONS.md",
    ]);
    expect(new Set(templates.map((template) => template.path)).size).toBe(templates.length);
    expect(
      templates.every(
        (template) => template.operation === "create_or_update" && template.reviewRequired,
      ),
    ).toBe(true);
    templates.forEach((template) => {
      expect(template.path).not.toMatch(/(^|\/)\.env(?:\.|$)|(^|\/)(?:src|apps|packages)\//u);
      expect(template.matchingValidationIds.length).toBeGreaterThan(0);
      expect(template.reviewInstructions.length).toBeGreaterThan(0);
      expect(template.summary).not.toMatch(unsafeGeneratedContentPattern);
    });
  });

  test("selects setup templates from task suggested validation and dedupes shared policy output", async () => {
    const { buildSetupPrTemplateFilesForTask } = await importTemplates();

    const files = buildSetupPrTemplateFilesForTask(
      cortexTask({
        suggestedValidation: [
          {
            label: "Review validation command map",
            required: true,
            validationId: "validation-posture:review",
          },
          {
            label: "Review repository policy coverage",
            required: true,
            validationId: "security-policy-coverage:review",
          },
          {
            label: "Review CI validation coverage",
            required: true,
            validationId: "ci-cd:review",
          },
        ],
      }),
    );

    expect(files.map((file) => file.path)).toEqual([
      ".aicp/policy.json",
      ".github/workflows/cortex-validation.yml",
    ]);
    expect(files.map((file) => file.templateId)).toEqual(["repo_policy", "ci_workflow"]);
    expect(files.every((file) => file.reviewRequired)).toBe(true);
    expect(files.every((file) => file.content.length > 0)).toBe(true);
    expect(files.every((file) => file.summary.length > 0)).toBe(true);
  });

  test("does not generate setup PR files for non-setup or blocked tasks", async () => {
    const { buildSetupPrTemplateFilesForTask } = await importTemplates();

    expect(buildSetupPrTemplateFilesForTask(cortexTask({ executionMode: "local_runner" }))).toEqual(
      [],
    );
    expect(
      buildSetupPrTemplateFilesForTask(cortexTask({ executionMode: "planning_only" })),
    ).toEqual([]);
    expect(buildSetupPrTemplateFilesForTask(cortexTask({ riskLevel: "blocked" }))).toEqual([]);
  });

  test("renders generated review markers and safe deterministic content", async () => {
    const { renderSetupPrFileTemplate, listSetupPrFileTemplates } = await importTemplates();

    const renderedFiles = listSetupPrFileTemplates().map((template) =>
      renderSetupPrFileTemplate(template.templateId),
    );

    renderedFiles.forEach((file) => {
      expect(file.generatedBy).toBe("cortex_setup_pr_template");
      expect(file.reviewRequired).toBe(true);
      expect(file.reviewInstructions.length).toBeGreaterThan(0);
      expect(file.content).not.toMatch(unsafeGeneratedContentPattern);
      if (file.reviewMarkerPlacement === "file_content") {
        expect(file.content).toContain("Generated by Cortex setup PR template");
        expect(file.content).toContain("Review required before merge");
      } else {
        expect(file.reviewMarkerPlacement).toBe("preview_metadata");
      }
    });
  });

  test("renders the repository policy template as shared-schema-valid JSON", async () => {
    const { renderSetupPrFileTemplate } = await importTemplates();

    const policyFile = renderSetupPrFileTemplate("repo_policy");
    const parsedPolicy = JSON.parse(policyFile.content);

    expect(() => RepoPolicySchema.parse(parsedPolicy)).not.toThrow();
    expect(parsedPolicy).toMatchObject({
      allowUntrackedFiles: false,
      contractVersion: CONTRACT_VERSION,
      protectedBranches: ["main"],
    });
    expect(parsedPolicy.validationCommands.map((command: { id: string }) => command.id)).toEqual([
      "typecheck",
      "lint",
      "format",
      "test",
    ]);
  });
});
