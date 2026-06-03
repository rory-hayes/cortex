import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  FindingSchema,
  SetupPrPreviewSchema,
  type CortexTask,
  type Finding,
  type SetupPrEvidenceSummary,
  type SetupPrPreview,
} from "@control-plane/shared";
import type { GitHubPullRequestMetadata } from "@control-plane/github";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

type StoredRepository = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  githubInstallationId: string;
  id: string;
  installationPermissions: Record<string, string>;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

type StoredCortexTask = {
  acceptanceCriteria: string[];
  approvalStatus: CortexTask["approvalStatus"];
  contractVersion: CortexTask["contractVersion"];
  createdAt: Date;
  executionMode: CortexTask["executionMode"];
  externalLinks: CortexTask["externalLinks"];
  findingIds: string[];
  id: string;
  latestRunId: string | null;
  metadata: CortexTask["metadata"];
  objective: string;
  originExternalId: string | null;
  originExternalSystem: string | null;
  originType: CortexTask["origin"]["type"];
  prArtifactIds: string[];
  repoId: string;
  riskLevel: CortexTask["riskLevel"];
  runIds: string[];
  status: CortexTask["status"];
  suggestedValidation: CortexTask["suggestedValidation"];
  taskPacketId: string | null;
  taskRecommendationId: string | null;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type StoredSetupPrPreview = {
  contractVersion: SetupPrPreview["contractVersion"];
  createdAt: Date;
  excludedTaskIds: string[];
  excludedTemplateIds: string[];
  files: SetupPrPreview["files"];
  id: string;
  metadata: SetupPrPreview["metadata"];
  repoId: string;
  status: SetupPrPreview["status"];
  taskIds: string[];
  updatedAt: Date;
  workspaceId: string;
};

type StoredFinding = {
  category: Finding["category"];
  confidence: number;
  contractVersion: Finding["contractVersion"];
  createdAt: Date;
  deterministicRuleId: string;
  evidence: Finding["evidence"];
  id: string;
  recommendation: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  source: Finding["source"];
  status: Finding["status"];
  summary: string;
  taskIds: string[];
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

type SetupPrCreationStore = {
  findGithubRepositoryForSetupPr: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<StoredRepository | null>;
  findWorkspaceMembership: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<{ id: string; role: string } | null>;
  getSetupPrPreview: (input: {
    previewId: string;
    workspaceId: string;
  }) => Promise<StoredSetupPrPreview | null>;
  listCortexTasksByIds: (input: {
    repoId: string;
    taskIds: string[];
    workspaceId: string;
  }) => Promise<StoredCortexTask[]>;
  listFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    workspaceId: string;
  }) => Promise<StoredFinding[]>;
  markSetupPrPreviewPrCreatedWithAudit: (input: {
    auditEvent: StoredAuditEvent;
    metadata: SetupPrPreview["metadata"];
    previewId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<StoredSetupPrPreview>;
};

type SetupPrCreationService = {
  createSetupPrFromPreview: (input: { previewId: string; workspaceId: string }) => Promise<{
    baseBranch: string;
    branchName: string;
    evidenceSummary: SetupPrEvidenceSummary;
    preview: SetupPrPreview;
    pullRequestNumber: number;
    pullRequestUrl: string;
  }>;
};

type GitHubSetupPrClient = {
  createSetupPullRequest: (input: {
    baseBranch: string;
    branchName: string;
    commitMessage: string;
    files: Array<{ content: string; path: string }>;
    installationId: number;
    owner: string;
    prBody: string;
    prTitle: string;
    repo: string;
  }) => Promise<GitHubPullRequestMetadata>;
};

const importCreation = async () =>
  (await import("./creation")) as {
    createSetupPrCreationService: (input: {
      createAuditEventId?: () => string;
      getAuthContext?: () => Promise<{ userId: string | null }>;
      githubClient: GitHubSetupPrClient;
      now?: () => Date;
      store: SetupPrCreationStore;
    }) => SetupPrCreationService;
  };

const now = new Date("2026-06-02T09:00:00.000Z");

const cortexTask = (overrides: Partial<CortexTask> = {}): CortexTask =>
  CortexTaskSchema.parse({
    acceptanceCriteria: ["Generated setup artifacts are reviewed before merge."],
    approvalStatus: "approved",
    contractVersion: CONTRACT_VERSION,
    createdAt: now.toISOString(),
    executionMode: "setup_pr",
    externalLinks: [],
    findingIds: ["finding_1"],
    metadata: {
      sourceLabel: "setup_pr_creation_test",
    },
    objective: "Prepare reviewer-owned setup artifacts.",
    origin: {
      type: "task_recommendation",
    },
    prArtifactIds: [],
    repoId: "github_repository_1",
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
    title: "Add validation setup",
    updatedAt: now.toISOString(),
    workspaceId: "workspace_1",
    ...overrides,
  });

const taskRow = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => {
  const task = cortexTask({
    ...(overrides.id === undefined ? {} : { taskId: overrides.id }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
    ...(overrides.repoId === undefined ? {} : { repoId: overrides.repoId }),
    ...(overrides.suggestedValidation === undefined
      ? {}
      : { suggestedValidation: overrides.suggestedValidation }),
  });

  return {
    acceptanceCriteria: task.acceptanceCriteria,
    approvalStatus: task.approvalStatus,
    contractVersion: task.contractVersion,
    createdAt: now,
    executionMode: task.executionMode,
    externalLinks: task.externalLinks,
    findingIds: task.findingIds,
    id: task.taskId,
    latestRunId: task.latestRunId ?? null,
    metadata: task.metadata,
    objective: task.objective,
    originExternalId: task.origin.externalId ?? null,
    originExternalSystem: task.origin.externalSystem ?? null,
    originType: task.origin.type,
    prArtifactIds: task.prArtifactIds,
    repoId: task.repoId,
    riskLevel: task.riskLevel,
    runIds: task.runIds,
    status: task.status,
    suggestedValidation: task.suggestedValidation,
    taskPacketId: task.taskPacketId ?? null,
    taskRecommendationId: task.taskRecommendationId ?? null,
    title: task.title,
    updatedAt: now,
    workspaceId: task.workspaceId,
    ...overrides,
  };
};

const findingRow = (overrides: Partial<StoredFinding> = {}): StoredFinding => {
  const parsedFinding = FindingSchema.parse({
    category: overrides.category ?? "validation",
    confidence: overrides.confidence ?? 0.9,
    contractVersion: overrides.contractVersion ?? CONTRACT_VERSION,
    createdAt: (overrides.createdAt ?? now).toISOString(),
    deterministicRuleId: overrides.deterministicRuleId ?? "validation-posture",
    evidence: overrides.evidence ?? [
      {
        metadata: {
          signal: "missing_policy",
        },
        paths: [".aicp/policy.json"],
        summary: "Validation setup metadata is incomplete.",
      },
    ],
    findingId: overrides.id ?? "finding_1",
    recommendation:
      overrides.recommendation ?? "Create repository policy metadata for validation gates.",
    repoId: overrides.repoId ?? "github_repository_1",
    scanId: overrides.scanId ?? "repo_scan_1",
    severity: overrides.severity ?? "medium",
    source: overrides.source ?? "deterministic_rule",
    status: overrides.status ?? "open",
    summary:
      overrides.summary ?? "The repository does not expose enough validation setup metadata.",
    title: overrides.title ?? "Validation policy is missing",
    updatedAt: (overrides.updatedAt ?? now).toISOString(),
    workspaceId: overrides.workspaceId ?? "workspace_1",
  });

  return {
    category: parsedFinding.category,
    confidence: parsedFinding.confidence,
    contractVersion: parsedFinding.contractVersion,
    createdAt: overrides.createdAt ?? now,
    deterministicRuleId: parsedFinding.deterministicRuleId,
    evidence: parsedFinding.evidence,
    id: parsedFinding.findingId,
    recommendation: parsedFinding.recommendation,
    repoId: parsedFinding.repoId,
    scanId: parsedFinding.scanId,
    severity: parsedFinding.severity,
    source: parsedFinding.source,
    status: parsedFinding.status,
    summary: parsedFinding.summary,
    taskIds: overrides.taskIds ?? [],
    title: parsedFinding.title,
    updatedAt: overrides.updatedAt ?? now,
    workspaceId: parsedFinding.workspaceId,
    ...overrides,
  };
};

const basePreviewFiles: SetupPrPreview["files"] = [
  {
    omittedContent: true,
    operation: "create_or_update",
    path: ".aicp/policy.json",
    reviewInstructions: ["Confirm generated policy before PR creation."],
    reviewRequired: true,
    sourceTaskIds: ["cortex_task_1", "cortex_task_2"],
    summary: "Create or update the repository policy used by runner dry-run and safety gates.",
    templateId: "repo_policy",
  },
  {
    omittedContent: true,
    operation: "create_or_update",
    path: ".github/workflows/cortex-validation.yml",
    reviewInstructions: ["Confirm workflow commands before merge."],
    reviewRequired: true,
    sourceTaskIds: ["cortex_task_2"],
    summary: "Create a review-required CI workflow for validation coverage.",
    templateId: "ci_workflow",
  },
];

const previewRow = (overrides: Partial<StoredSetupPrPreview> = {}): StoredSetupPrPreview => {
  const createdAt = overrides.createdAt ?? now;
  const updatedAt = overrides.updatedAt ?? now;
  const preview = SetupPrPreviewSchema.parse({
    contractVersion: CONTRACT_VERSION,
    createdAt: createdAt.toISOString(),
    excludedTaskIds: overrides.excludedTaskIds ?? [],
    excludedTemplateIds: overrides.excludedTemplateIds ?? [],
    files: overrides.files ?? basePreviewFiles,
    metadata: overrides.metadata ?? {
      sourceLabel: "setup_pr_preview_service",
    },
    previewId: overrides.id ?? "setup_pr_preview_1",
    repoId: overrides.repoId ?? "github_repository_1",
    status: overrides.status ?? "draft",
    taskIds: overrides.taskIds ?? ["cortex_task_1", "cortex_task_2"],
    updatedAt: updatedAt.toISOString(),
    workspaceId: overrides.workspaceId ?? "workspace_1",
  });

  return {
    contractVersion: preview.contractVersion,
    createdAt,
    excludedTaskIds: preview.excludedTaskIds,
    excludedTemplateIds: preview.excludedTemplateIds,
    files: preview.files,
    id: preview.previewId,
    metadata: preview.metadata,
    repoId: preview.repoId,
    status: preview.status,
    taskIds: preview.taskIds,
    updatedAt,
    workspaceId: preview.workspaceId,
  };
};

const repositoryRow = (overrides: Partial<StoredRepository> = {}): StoredRepository => ({
  archived: false,
  defaultBranch: "main",
  disabled: false,
  githubInstallationId: "42",
  id: "github_repository_1",
  installationPermissions: {
    contents: "write",
    metadata: "read",
    pull_requests: "write",
  },
  repositoryFullName: "acme/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "acme",
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  options: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    findings?: StoredFinding[];
    previews?: StoredSetupPrPreview[];
    repositories?: StoredRepository[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const previews = [...(options.previews ?? [previewRow()])];
  const repositories = [...(options.repositories ?? [repositoryRow()])];
  const findings = [
    ...(options.findings ?? [
      findingRow(),
      findingRow({
        category: "ci_cd",
        id: "finding_2",
        deterministicRuleId: "ci-cd",
        evidence: [
          {
            metadata: {
              signal: "missing_ci",
            },
            paths: [".github/workflows/cortex-validation.yml"],
            summary: "CI validation metadata is incomplete.",
          },
        ],
        recommendation: "Create a review-required CI workflow for validation coverage.",
        severity: "medium",
        summary: "The repository does not expose enough CI validation metadata.",
        title: "CI validation workflow is missing",
      }),
    ]),
  ];
  const tasks = [
    ...(options.tasks ?? [
      taskRow(),
      taskRow({
        id: "cortex_task_2",
        findingIds: ["finding_2"],
        suggestedValidation: [
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
        title: "Add CI setup",
      }),
    ]),
  ];

  const store: SetupPrCreationStore & {
    auditEvents: StoredAuditEvent[];
    previews: StoredSetupPrPreview[];
  } = {
    auditEvents,
    findGithubRepositoryForSetupPr: vi.fn<SetupPrCreationStore["findGithubRepositoryForSetupPr"]>(
      async ({ repoId, workspaceId }) =>
        repositories.find((repo) => repo.id === repoId && repo.workspaceId === workspaceId) ?? null,
    ),
    findWorkspaceMembership: vi.fn<SetupPrCreationStore["findWorkspaceMembership"]>(
      async ({ userId, workspaceId }) =>
        (options.memberships ?? [{ userId: "user_1", workspaceId: "workspace_1" }]).some(
          (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
        )
          ? { id: "membership_1", role: "admin" }
          : null,
    ),
    getSetupPrPreview: vi.fn<SetupPrCreationStore["getSetupPrPreview"]>(
      async ({ previewId, workspaceId }) =>
        previews.find(
          (preview) => preview.id === previewId && preview.workspaceId === workspaceId,
        ) ?? null,
    ),
    listCortexTasksByIds: vi.fn<SetupPrCreationStore["listCortexTasksByIds"]>(
      async ({ repoId, taskIds, workspaceId }) =>
        tasks.filter(
          (task) =>
            taskIds.includes(task.id) && task.repoId === repoId && task.workspaceId === workspaceId,
        ),
    ),
    listFindingsByIds: vi.fn<SetupPrCreationStore["listFindingsByIds"]>(
      async ({ findingIds, repoId, workspaceId }) =>
        findings.filter(
          (finding) =>
            findingIds.includes(finding.id) &&
            finding.repoId === repoId &&
            finding.workspaceId === workspaceId,
        ),
    ),
    markSetupPrPreviewPrCreatedWithAudit: vi.fn<
      SetupPrCreationStore["markSetupPrPreviewPrCreatedWithAudit"]
    >(async ({ auditEvent, metadata, previewId, updatedAt, workspaceId }) => {
      const preview = previews.find(
        (storedPreview) =>
          storedPreview.id === previewId && storedPreview.workspaceId === workspaceId,
      );

      if (preview === undefined) {
        throw new Error("Preview missing in test store.");
      }

      preview.metadata = metadata;
      preview.status = "pr_created";
      preview.updatedAt = updatedAt;
      auditEvents.push(auditEvent);

      return preview;
    }),
    previews,
  };

  return store;
};

const createGitHubClient = () => ({
  createSetupPullRequest: vi.fn<GitHubSetupPrClient["createSetupPullRequest"]>(async () => ({
    draft: true,
    htmlUrl: "https://github.example.test/acme/control-plane/pull/42",
    id: 4200,
    merged: false,
    number: 42,
    repository: {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      fullName: "acme/control-plane",
      htmlUrl: "https://github.example.test/acme/control-plane",
      id: 9001,
      name: "control-plane",
      owner: "acme",
      private: true,
      visibility: "private",
    },
    state: "open",
    title: "Cortex setup PR: setup_pr_preview_1",
  })),
});

const createService = async (
  store = createStore(),
  githubClient: GitHubSetupPrClient = createGitHubClient(),
) => {
  const { createSetupPrCreationService } = await importCreation();

  return createSetupPrCreationService({
    createAuditEventId: () => "audit_event_1",
    getAuthContext: async () => ({ userId: "user_1" }),
    githubClient,
    now: () => now,
    store,
  });
};

const unsafeSerializedPattern =
  /diff --git|@@ -|```|process\.env|(^|[/\s])\.env(?:\.|$)|PRIVATE KEY|rawSource|sourceCode|patchText|rawOutput|Generated by Cortex setup PR template|\/Users\/rory/u;

describe("setup PR creation service", () => {
  test("creates a branch and draft PR from an approved setup preview", async () => {
    const store = createStore();
    const githubClient = createGitHubClient();
    const service = await createService(store, githubClient);

    const result = await service.createSetupPrFromPreview({
      previewId: "setup_pr_preview_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        baseBranch: "main",
        branchName: "cortex/setup-pr/setup-pr-preview-1",
        pullRequestNumber: 42,
        pullRequestUrl: "https://github.example.test/acme/control-plane/pull/42",
      }),
    );
    expect(result.preview.status).toBe("pr_created");
    expect(JSON.stringify(result)).not.toMatch(unsafeSerializedPattern);
    expect(githubClient.createSetupPullRequest).toHaveBeenCalledTimes(1);
    expect(githubClient.createSetupPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: "main",
        branchName: "cortex/setup-pr/setup-pr-preview-1",
        commitMessage: "Cortex setup PR for setup_pr_preview_1",
        installationId: 42,
        owner: "acme",
        prTitle: "Cortex setup PR: setup_pr_preview_1",
        repo: "control-plane",
      }),
    );
    const call = vi.mocked(githubClient.createSetupPullRequest).mock.calls[0]?.[0];

    expect(call?.files.map((file) => file.path)).toEqual([
      ".aicp/policy.json",
      ".github/workflows/cortex-validation.yml",
    ]);
    expect(call?.files.every((file) => file.content.length > 0)).toBe(true);
    expect(call?.prBody).toContain("## Findings addressed");
    expect(call?.prBody).toContain("## Evidence summary");
    expect(call?.prBody).toContain("finding_1");
    expect(call?.prBody).toContain("finding_2");
    expect(call?.prBody).toContain("Add validation setup");
    expect(call?.prBody).toContain("Validation policy is missing");
    expect(call?.prBody).toContain("CI validation workflow is missing");
    expect(call?.prBody).toContain("## Review checklist");
    expect(call?.prBody).toContain(".aicp/policy.json");
    expect(call?.prBody).toContain(".github/workflows/cortex-validation.yml");
    expect(call?.prBody).not.toMatch(unsafeSerializedPattern);
    expect(store.previews[0]?.metadata).toMatchObject({
      baseBranch: "main",
      headBranch: "cortex/setup-pr/setup-pr-preview-1",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.example.test/acme/control-plane/pull/42",
      repositoryFullName: "acme/control-plane",
      sourceLabel: "setup_pr_creation_service",
    });
    expect(result.evidenceSummary).toMatchObject({
      findingIds: ["finding_1", "finding_2"],
      taskIds: ["cortex_task_1", "cortex_task_2"],
    });
    expect(result.evidenceSummary.files[0]).toMatchObject({
      findingIds: ["finding_1", "finding_2"],
      path: ".aicp/policy.json",
      sourceTaskIds: ["cortex_task_1", "cortex_task_2"],
      templateId: "repo_policy",
    });
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "setup_pr.pr_created",
        metadata: {
          baseBranch: "main",
          fileCount: 2,
          headBranch: "cortex/setup-pr/setup-pr-preview-1",
          previewId: "setup_pr_preview_1",
          pullRequestNumber: 42,
          repoId: "github_repository_1",
          taskCount: 2,
        },
      }),
    ]);
  });

  test("writes only files approved in the preview", async () => {
    const store = createStore({
      previews: [
        previewRow({
          files: [
            {
              omittedContent: true,
              operation: "create_or_update",
              path: ".aicp/policy.json",
              reviewInstructions: ["Confirm generated policy before PR creation."],
              reviewRequired: true,
              sourceTaskIds: ["cortex_task_1", "cortex_task_2"],
              summary:
                "Create or update the repository policy used by runner dry-run and safety gates.",
              templateId: "repo_policy",
            },
          ],
        }),
      ],
    });
    const githubClient = createGitHubClient();
    const service = await createService(store, githubClient);

    await service.createSetupPrFromPreview({
      previewId: "setup_pr_preview_1",
      workspaceId: "workspace_1",
    });

    const call = vi.mocked(githubClient.createSetupPullRequest).mock.calls[0]?.[0];

    expect(call?.files.map((file) => file.path)).toEqual([".aicp/policy.json"]);
  });

  test("rejects non-draft previews and missing setup PR permissions without touching GitHub", async () => {
    const nonDraftGithubClient = createGitHubClient();
    const nonDraftService = await createService(
      createStore({
        previews: [previewRow({ status: "pr_created" })],
      }),
      nonDraftGithubClient,
    );

    await expect(
      nonDraftService.createSetupPrFromPreview({
        previewId: "setup_pr_preview_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(nonDraftGithubClient.createSetupPullRequest).not.toHaveBeenCalled();

    const missingPermissionGithubClient = createGitHubClient();
    const missingPermissionService = await createService(
      createStore({
        repositories: [
          repositoryRow({
            installationPermissions: {
              contents: "read",
              metadata: "read",
              pull_requests: "read",
            },
          }),
        ],
      }),
      missingPermissionGithubClient,
    );

    await expect(
      missingPermissionService.createSetupPrFromPreview({
        previewId: "setup_pr_preview_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(missingPermissionGithubClient.createSetupPullRequest).not.toHaveBeenCalled();
  });

  test("rejects stale preview files that no approved setup task can regenerate", async () => {
    const store = createStore({
      previews: [
        previewRow({
          files: [
            {
              omittedContent: true,
              operation: "create_or_update",
              path: "AGENTS.md",
              reviewInstructions: ["Confirm generated instructions before PR creation."],
              reviewRequired: true,
              sourceTaskIds: ["cortex_task_1"],
              summary: "Create or update agent operating instructions for AI-assisted tasks.",
              templateId: "agent_instructions",
            },
          ],
        }),
      ],
    });
    const githubClient = createGitHubClient();
    const service = await createService(store, githubClient);

    await expect(
      service.createSetupPrFromPreview({
        previewId: "setup_pr_preview_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(githubClient.createSetupPullRequest).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects preview file path tampering for code, env, and unapproved protected paths", async () => {
    const policyPreviewFile = basePreviewFiles[0];
    const workflowPreviewFile = basePreviewFiles[1];

    if (policyPreviewFile === undefined || workflowPreviewFile === undefined) {
      throw new Error("Expected setup PR preview fixture files to be defined.");
    }

    const tamperedFiles = [
      {
        file: {
          ...policyPreviewFile,
          path: "apps/web/src/app.ts",
        },
        label: "source application file",
      },
      {
        file: {
          ...policyPreviewFile,
          path: ".env",
        },
        label: "environment file",
      },
      {
        file: {
          ...workflowPreviewFile,
          path: ".github/workflows/deploy.yml",
        },
        label: "unapproved workflow file",
      },
    ];

    for (const { file, label } of tamperedFiles) {
      const preview = previewRow();

      preview.files = [file];

      const githubClient = createGitHubClient();
      const service = await createService(createStore({ previews: [preview] }), githubClient);

      await expect(
        service.createSetupPrFromPreview({
          previewId: "setup_pr_preview_1",
          workspaceId: "workspace_1",
        }),
        label,
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(githubClient.createSetupPullRequest, label).not.toHaveBeenCalled();
    }
  });

  test("requires workspace membership before creating a setup PR", async () => {
    const githubClient = createGitHubClient();
    const service = await createService(createStore({ memberships: [] }), githubClient);

    await expect(
      service.createSetupPrFromPreview({
        previewId: "setup_pr_preview_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(githubClient.createSetupPullRequest).not.toHaveBeenCalled();
  });
});
