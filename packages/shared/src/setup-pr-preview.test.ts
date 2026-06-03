import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "./version.js";

const loadSetupPrPreviewModule = async () => await import("./setup-pr-preview.js");

const validPreview = () => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-06-02T08:00:00.000Z",
  excludedTaskIds: ["cortex_task_excluded"],
  excludedTemplateIds: ["ci_workflow"],
  files: [
    {
      omittedContent: true,
      operation: "create_or_update",
      path: ".aicp/policy.json",
      reviewInstructions: ["Confirm generated policy before PR creation."],
      reviewRequired: true,
      sourceTaskIds: ["cortex_task_1"],
      summary: "Create or update repository policy metadata for runner safety checks.",
      templateId: "repo_policy",
    },
    {
      omittedContent: true,
      operation: "create_or_update",
      path: "AGENTS.md",
      reviewInstructions: ["Replace placeholders before merge."],
      reviewRequired: true,
      sourceTaskIds: ["cortex_task_2"],
      summary: "Create review-required agent instructions.",
      templateId: "agent_instructions",
    },
  ],
  metadata: {
    sourceLabel: "setup_pr_preview_service",
  },
  previewId: "setup_pr_preview_1",
  repoId: "github_repository_1",
  status: "draft",
  taskIds: ["cortex_task_1", "cortex_task_2"],
  updatedAt: "2026-06-02T08:00:00.000Z",
  workspaceId: "workspace_1",
});

describe("SetupPrPreview contract", () => {
  it("parses metadata-only setup PR previews", async () => {
    const { SetupPrPreviewSchema } = await loadSetupPrPreviewModule();

    const result = SetupPrPreviewSchema.safeParse(validPreview());

    expect(result.success).toBe(true);
    expect(result.success ? result.data.files.map((file) => file.path) : []).toEqual([
      ".aicp/policy.json",
      "AGENTS.md",
    ]);
  });

  it("requires generated content to be omitted from persisted preview metadata", async () => {
    const { SetupPrPreviewSchema } = await loadSetupPrPreviewModule();

    const result = SetupPrPreviewSchema.safeParse({
      ...validPreview(),
      files: [
        {
          ...validPreview().files[0],
          content: "Generated setup file body must stay out of preview persistence.",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ".env",
    ".env.local",
    "apps/web/src/page.tsx",
    "packages/shared/src/index.ts",
    "/Users/rory/private/repo/AGENTS.md",
    "../AGENTS.md",
  ])("rejects unsafe preview file path %s", async (path) => {
    const { SetupPrPreviewSchema } = await loadSetupPrPreviewModule();

    const result = SetupPrPreviewSchema.safeParse({
      ...validPreview(),
      files: [
        {
          ...validPreview().files[0],
          path,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsafe payload keys and values recursively", async () => {
    const { SetupPrPreviewSchema } = await loadSetupPrPreviewModule();

    const unsafeKeyResult = SetupPrPreviewSchema.safeParse({
      ...validPreview(),
      metadata: {
        rawSource: "not allowed",
      },
    });
    const unsafeValueResult = SetupPrPreviewSchema.safeParse({
      ...validPreview(),
      files: [
        {
          ...validPreview().files[0],
          summary: "diff --git a/app.ts b/app.ts",
        },
      ],
    });

    expect(unsafeKeyResult.success).toBe(false);
    expect(unsafeValueResult.success).toBe(false);
  });

  it("exports the setup PR preview contract from the public entrypoint", async () => {
    const shared = await import("./index.js");

    expect(shared.SetupPrPreviewSchema.safeParse(validPreview()).success).toBe(true);
  });
});
