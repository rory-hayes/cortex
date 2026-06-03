import { describe, expect, test } from "vitest";

import { CONTRACT_VERSION, SetupPrEvidenceSummarySchema } from "@control-plane/shared";

const validSummary = () => ({
  contractVersion: CONTRACT_VERSION,
  files: [
    {
      findingIds: ["finding_1"],
      findings: [
        {
          category: "validation",
          findingId: "finding_1",
          severity: "medium",
          status: "open",
          title: "Validation policy is missing",
        },
      ],
      omittedContent: true,
      path: ".aicp/policy.json",
      reviewChecklist: [
        "Confirm validation commands match this repository before creating the setup PR.",
      ],
      sourceTaskIds: ["cortex_task_1"],
      summary: "Create or update the repository policy used by runner dry-run and safety gates.",
      tasks: [
        {
          riskLevel: "medium",
          taskId: "cortex_task_1",
          title: "Add validation setup",
          validationLabels: ["Review validation command map"],
        },
      ],
      templateId: "repo_policy",
      whyGenerated:
        "Generated from 1 approved setup task linked to 1 readiness finding for repo_policy.",
    },
  ],
  findingIds: ["finding_1"],
  generatedAt: "2026-06-02T09:00:00.000Z",
  previewId: "setup_pr_preview_1",
  repoId: "github_repository_1",
  taskIds: ["cortex_task_1"],
  workspaceId: "workspace_1",
});

describe("SetupPrEvidenceSummarySchema", () => {
  test("accepts metadata-only evidence that maps setup files to tasks and findings", () => {
    const result = SetupPrEvidenceSummarySchema.safeParse(validSummary());

    expect(result.success).toBe(true);
    expect(result.data?.files[0]).toMatchObject({
      findingIds: ["finding_1"],
      omittedContent: true,
      path: ".aicp/policy.json",
      sourceTaskIds: ["cortex_task_1"],
      templateId: "repo_policy",
    });
  });

  test("rejects unsafe setup PR evidence payloads", () => {
    expect(
      SetupPrEvidenceSummarySchema.safeParse({
        ...validSummary(),
        files: [
          {
            ...validSummary().files[0],
            content: "Generated setup file content must not appear in evidence metadata.",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      SetupPrEvidenceSummarySchema.safeParse({
        ...validSummary(),
        files: [
          {
            ...validSummary().files[0],
            path: "apps/web/src/page.tsx",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      SetupPrEvidenceSummarySchema.safeParse({
        ...validSummary(),
        files: [
          {
            ...validSummary().files[0],
            reviewChecklist: ["diff --git a/src/app.ts b/src/app.ts"],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
