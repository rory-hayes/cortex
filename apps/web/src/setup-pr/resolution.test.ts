import { beforeEach, describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION } from "@control-plane/shared";

import {
  createSetupPrMergeResolutionService,
  type SetupPrMergeResolutionStore,
} from "./resolution";

vi.mock("server-only", () => ({}));

type TaskRow = Parameters<
  SetupPrMergeResolutionStore["resolveSetupPrMergeWithAudit"]
>[0]["tasks"][number];
type FindingRow = Parameters<
  SetupPrMergeResolutionStore["resolveSetupPrMergeWithAudit"]
>[0]["findings"][number];
type PreviewRow = NonNullable<
  Awaited<ReturnType<SetupPrMergeResolutionStore["findSetupPrPreviewForPullRequest"]>>
>;

const now = new Date("2026-06-02T12:00:00.000Z");

const previewRow = (overrides: Partial<PreviewRow> = {}): PreviewRow => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-06-02T10:00:00.000Z"),
  excludedTaskIds: [],
  excludedTemplateIds: [],
  files: [
    {
      omittedContent: true,
      operation: "create_or_update",
      path: "AGENTS.md",
      reviewInstructions: ["Confirm the instructions match the repository workflow."],
      reviewRequired: true,
      sourceTaskIds: ["task_setup_agents"],
      summary: "Adds repository agent instructions.",
      templateId: "agent-instructions",
    },
  ],
  id: "setup_preview_1",
  metadata: {
    baseBranch: "main",
    headBranch: "cortex/setup-pr/setup-preview-1",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.example.test/acme/control-plane/pull/42",
    repositoryFullName: "acme/control-plane",
    sourceLabel: "setup_pr_creation_service",
  },
  repoId: "repo_1",
  status: "pr_created",
  taskIds: ["task_setup_agents"],
  updatedAt: new Date("2026-06-02T10:05:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const cortexTaskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  acceptanceCriteria: ["Agent instructions exist."],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-06-02T09:00:00.000Z"),
  executionMode: "setup_pr",
  externalLinks: [],
  findingIds: ["finding_agent_readiness"],
  id: "task_setup_agents",
  latestRunId: null,
  metadata: {},
  objective: "Add repository agent instructions.",
  originExternalId: null,
  originExternalSystem: null,
  originType: "finding",
  prArtifactIds: [],
  repoId: "repo_1",
  riskLevel: "low",
  runIds: [],
  status: "approved",
  suggestedValidation: [
    {
      label: "Review AGENTS.md",
      required: true,
      validationId: "review_agents",
    },
  ],
  taskPacketId: null,
  taskRecommendationId: "recommendation_1",
  title: "Add AGENTS.md",
  updatedAt: new Date("2026-06-02T09:10:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const findingRow = (overrides: Partial<FindingRow> = {}): FindingRow => ({
  category: "agent_readiness",
  confidence: 0.9,
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-06-02T08:00:00.000Z"),
  deterministicRuleId: "agent_readiness.missing",
  evidence: [
    {
      metadata: { statusLabel: "missing" },
      paths: ["AGENTS.md"],
      summary: "No agent instructions were detected.",
    },
  ],
  id: "finding_agent_readiness",
  recommendation: "Add repository agent instructions.",
  repoId: "repo_1",
  scanId: "scan_1",
  severity: "medium",
  source: "deterministic_rule",
  status: "open",
  summary: "The repository is missing agent instructions.",
  taskIds: ["task_setup_agents"],
  title: "Missing agent instructions",
  updatedAt: new Date("2026-06-02T08:10:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = () => {
  const state = {
    findings: [findingRow()],
    previews: [previewRow()],
    tasks: [cortexTaskRow()],
  };
  const store: SetupPrMergeResolutionStore = {
    findSetupPrPreviewForPullRequest: vi.fn(async () => state.previews[0] ?? null),
    listCortexTasksByIds: vi.fn(async () => state.tasks),
    listFindingsByIds: vi.fn(async () => state.findings),
    resolveSetupPrMergeWithAudit: vi.fn<
      SetupPrMergeResolutionStore["resolveSetupPrMergeWithAudit"]
    >(async ({ findings, metadata, tasks, updatedAt }) => {
      state.previews[0] = {
        ...(state.previews[0] as PreviewRow),
        metadata,
        updatedAt,
      };
      state.tasks = tasks.map((task) => ({
        ...task,
        approvalStatus: "approved",
        status: "completed",
        updatedAt,
      }));
      state.findings = findings.map((finding) => ({
        ...finding,
        status: "resolved",
        updatedAt,
      }));

      return {
        resolvedFindingCount: findings.length,
        resolvedTaskCount: tasks.length,
      };
    }),
  };

  return { state, store };
};

const mergedPullRequest = {
  draft: false,
  headRefName: "cortex/setup-pr/setup-preview-1",
  htmlUrl: "https://github.example.test/acme/control-plane/pull/42",
  id: 7001,
  merged: true,
  number: 42,
  state: "closed",
  title: "Cortex setup PR: setup_preview_1",
  updatedAt: "2026-06-02T11:45:00.000Z",
} as const;

const repository = {
  fullName: "acme/control-plane",
  id: 9001,
  name: "control-plane",
  owner: "acme",
  private: true,
} as const;

describe("createSetupPrMergeResolutionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("resolves setup PR tasks and findings when a matching PR is merged", async () => {
    const { store } = createStore();
    const service = createSetupPrMergeResolutionService({
      createAuditEventId: () => "audit_setup_pr_merged",
      now: () => now,
      store,
    });

    const result = await service.resolveMergedSetupPrForWebhook({
      deliveryId: "123e4567-e89b-42d3-a456-426614174000",
      installationId: 42,
      pullRequest: mergedPullRequest,
      repository,
    });

    expect(result).toEqual({
      findingIds: ["finding_agent_readiness"],
      previewId: "setup_preview_1",
      repoId: "repo_1",
      resolvedFindingCount: 1,
      resolvedTaskCount: 1,
      status: "resolved",
      taskIds: ["task_setup_agents"],
      workspaceId: "workspace_1",
    });
    expect(store.findSetupPrPreviewForPullRequest).toHaveBeenCalledWith({
      githubInstallationId: 42,
      pullRequestNumber: 42,
      repositoryName: "control-plane",
      repositoryOwner: "acme",
    });
    expect(store.resolveSetupPrMergeWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        findingIds: ["finding_agent_readiness"],
        previewId: "setup_preview_1",
        taskIds: ["task_setup_agents"],
        updatedAt: now,
        workspaceId: "workspace_1",
      }),
    );
    const mutationInput = vi.mocked(store.resolveSetupPrMergeWithAudit).mock.calls[0]?.[0];
    expect(mutationInput?.metadata).toMatchObject({
      pullRequestMerged: true,
      pullRequestMergedAt: "2026-06-02T11:45:00.000Z",
      pullRequestNumber: 42,
      sourceLabel: "setup_pr_merge_resolution_service",
    });
    expect(JSON.stringify(mutationInput?.auditEvents)).not.toMatch(
      /\b(?:diff|patch|source|snippet|content|rawOutput|token|secret)\b/iu,
    );
  });

  test("ignores non-merged pull request events before reading setup PR rows", async () => {
    const { store } = createStore();
    const service = createSetupPrMergeResolutionService({
      now: () => now,
      store,
    });

    await expect(
      service.resolveMergedSetupPrForWebhook({
        deliveryId: "123e4567-e89b-42d3-a456-426614174000",
        installationId: 42,
        pullRequest: {
          ...mergedPullRequest,
          merged: false,
          state: "open",
        },
        repository,
      }),
    ).resolves.toEqual({
      pullRequestNumber: 42,
      reason: "not_merged",
      status: "ignored",
    });
    expect(store.findSetupPrPreviewForPullRequest).not.toHaveBeenCalled();
    expect(store.resolveSetupPrMergeWithAudit).not.toHaveBeenCalled();
  });

  test("treats repeated merged PR deliveries as already resolved", async () => {
    const { store } = createStore();
    vi.mocked(store.findSetupPrPreviewForPullRequest).mockResolvedValue(
      previewRow({
        metadata: {
          pullRequestMerged: true,
          pullRequestMergedAt: "2026-06-02T11:45:00.000Z",
          pullRequestNumber: 42,
          sourceLabel: "setup_pr_merge_resolution_service",
        },
      }),
    );
    const service = createSetupPrMergeResolutionService({
      now: () => now,
      store,
    });

    await expect(
      service.resolveMergedSetupPrForWebhook({
        deliveryId: "123e4567-e89b-42d3-a456-426614174000",
        installationId: 42,
        pullRequest: mergedPullRequest,
        repository,
      }),
    ).resolves.toEqual({
      previewId: "setup_preview_1",
      reason: "already_resolved",
      status: "ignored",
    });
    expect(store.resolveSetupPrMergeWithAudit).not.toHaveBeenCalled();
  });
});
