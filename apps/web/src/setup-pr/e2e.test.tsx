import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  FindingSchema,
  type CortexTask,
  type Finding,
  type SetupPrPreview,
} from "@control-plane/shared";
import {
  createGitHubAppClient,
  type GitHubAppRequest,
  type GitHubAppRequestFunction,
} from "@control-plane/github";

import { SetupPrFlow } from "../../components/setup-pr-flow";
import type { SetupPrCreationRepositoryRow, SetupPrCreationStore } from "./creation";
import type { SetupPrPreviewRow, SetupPrPreviewStore } from "./previews";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));
vi.mock("@/src/server/actions", () => ({
  createSetupPrFromPreviewAction: vi.fn(),
  createSetupPrPreviewAction: vi.fn(),
}));

type SetupPrTaskRow = Awaited<ReturnType<SetupPrPreviewStore["listCortexTasksByIds"]>>[number];
type SetupPrFindingRow = Awaited<ReturnType<SetupPrCreationStore["listFindingsByIds"]>>[number];
type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

const now = new Date("2026-06-02T13:00:00.000Z");
const later = new Date("2026-06-02T13:05:00.000Z");

const createTask = (overrides: Partial<CortexTask> = {}): CortexTask =>
  CortexTaskSchema.parse({
    acceptanceCriteria: ["Review generated setup files before merging the setup PR."],
    approvalStatus: "approved",
    contractVersion: CONTRACT_VERSION,
    createdAt: now.toISOString(),
    executionMode: "setup_pr",
    externalLinks: [],
    findingIds: ["finding_policy"],
    metadata: {
      sourceLabel: "setup_pr_e2e",
    },
    objective: "Prepare reviewer-owned repository setup artifacts.",
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
    taskId: "cortex_task_policy",
    taskRecommendationId: "task_recommendation_policy",
    title: "Add repository policy setup",
    updatedAt: now.toISOString(),
    workspaceId: "workspace_1",
    ...overrides,
  });

const createTaskRow = (task: CortexTask): SetupPrTaskRow => ({
  acceptanceCriteria: task.acceptanceCriteria,
  approvalStatus: task.approvalStatus,
  contractVersion: task.contractVersion,
  createdAt: new Date(task.createdAt),
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
  updatedAt: new Date(task.updatedAt),
  workspaceId: task.workspaceId,
});

const createFinding = (overrides: Partial<Finding> = {}): Finding =>
  FindingSchema.parse({
    category: "validation",
    confidence: 0.95,
    contractVersion: CONTRACT_VERSION,
    createdAt: now.toISOString(),
    deterministicRuleId: "setup-pr-e2e:validation",
    evidence: [
      {
        metadata: {
          commandLabelCount: 0,
        },
        paths: [".aicp/policy.json"],
        summary: "Repository policy metadata is missing.",
      },
    ],
    findingId: "finding_policy",
    recommendation: "Create a setup PR with policy and validation metadata.",
    repoId: "github_repository_1",
    scanId: "repo_scan_1",
    severity: "medium",
    source: "deterministic_rule",
    status: "open",
    summary: "Validation policy should be made explicit before local execution.",
    title: "Missing repository policy",
    updatedAt: now.toISOString(),
    workspaceId: "workspace_1",
    ...overrides,
  });

const createFindingRow = (finding: Finding): SetupPrFindingRow => ({
  category: finding.category,
  confidence: finding.confidence,
  contractVersion: finding.contractVersion,
  createdAt: new Date(finding.createdAt),
  deterministicRuleId: finding.deterministicRuleId,
  evidence: finding.evidence,
  id: finding.findingId,
  recommendation: finding.recommendation,
  repoId: finding.repoId,
  scanId: finding.scanId,
  severity: finding.severity,
  source: finding.source,
  status: finding.status,
  summary: finding.summary,
  taskIds: ["cortex_task_policy"],
  title: finding.title,
  updatedAt: new Date(finding.updatedAt),
  workspaceId: finding.workspaceId,
});

const toSetupPrPreview = (row: SetupPrPreviewRow): SetupPrPreview => ({
  contractVersion: row.contractVersion,
  createdAt: row.createdAt.toISOString(),
  excludedTaskIds: row.excludedTaskIds,
  excludedTemplateIds: row.excludedTemplateIds,
  files: row.files,
  metadata: row.metadata,
  previewId: row.id,
  repoId: row.repoId,
  status: row.status,
  taskIds: row.taskIds,
  updatedAt: row.updatedAt.toISOString(),
  workspaceId: row.workspaceId,
});

const createSetupPrE2EStore = () => {
  const repositories: SetupPrCreationRepositoryRow[] = [
    {
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
    },
  ];
  const tasks: SetupPrTaskRow[] = [
    createTaskRow(createTask()),
    createTaskRow(
      createTask({
        findingIds: ["finding_ci"],
        suggestedValidation: [
          {
            label: "Review CI workflow",
            required: true,
            validationId: "ci-cd:review",
          },
        ],
        taskId: "cortex_task_ci",
        taskRecommendationId: "task_recommendation_ci",
        title: "Add CI validation workflow",
      }),
    ),
  ];
  const findings: SetupPrFindingRow[] = [
    createFindingRow(createFinding()),
    createFindingRow(
      createFinding({
        category: "ci_cd",
        deterministicRuleId: "setup-pr-e2e:ci",
        findingId: "finding_ci",
        recommendation: "Create a setup PR with CI validation metadata.",
        summary: "CI validation should be visible before local execution.",
        title: "Missing CI validation",
      }),
    ),
  ];
  const previews: SetupPrPreviewRow[] = [];
  const auditEvents: StoredAuditEvent[] = [];

  const store = {
    auditEvents,
    findGithubRepository: vi.fn<SetupPrPreviewStore["findGithubRepository"]>(async (input) => {
      const repository = repositories.find(
        (candidate) => candidate.id === input.repoId && candidate.workspaceId === input.workspaceId,
      );

      return repository === undefined
        ? null
        : { id: repository.id, workspaceId: repository.workspaceId };
    }),
    findGithubRepositoryForSetupPr: vi.fn<SetupPrCreationStore["findGithubRepositoryForSetupPr"]>(
      async (input) =>
        repositories.find(
          (repository) =>
            repository.id === input.repoId && repository.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    findWorkspaceMembership: vi.fn<SetupPrPreviewStore["findWorkspaceMembership"]>(async (input) =>
      input.userId === "user_1" && input.workspaceId === "workspace_1"
        ? { id: "membership_1", role: "admin" }
        : null,
    ),
    getSetupPrPreview: vi.fn<(SetupPrPreviewStore & SetupPrCreationStore)["getSetupPrPreview"]>(
      async (input) =>
        previews.find(
          (preview) => preview.id === input.previewId && preview.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    listCortexTasksByIds: vi.fn<
      (SetupPrPreviewStore & SetupPrCreationStore)["listCortexTasksByIds"]
    >(async (input) =>
      tasks.filter(
        (task) =>
          task.repoId === input.repoId &&
          input.taskIds.includes(task.id) &&
          task.workspaceId === input.workspaceId,
      ),
    ),
    listFindingsByIds: vi.fn<SetupPrCreationStore["listFindingsByIds"]>(async (input) =>
      findings.filter(
        (finding) =>
          input.findingIds.includes(finding.id) &&
          finding.repoId === input.repoId &&
          finding.workspaceId === input.workspaceId,
      ),
    ),
    listSetupPrPreviews: vi.fn<SetupPrPreviewStore["listSetupPrPreviews"]>(async (input) =>
      previews.filter(
        (preview) =>
          preview.workspaceId === input.workspaceId &&
          (input.repoId === undefined || preview.repoId === input.repoId),
      ),
    ),
    markSetupPrPreviewPrCreatedWithAudit: vi.fn<
      SetupPrCreationStore["markSetupPrPreviewPrCreatedWithAudit"]
    >(async (input) => {
      const preview = previews.find(
        (candidate) =>
          candidate.id === input.previewId && candidate.workspaceId === input.workspaceId,
      );

      if (preview === undefined) {
        throw new Error("Preview missing in setup PR E2E store.");
      }

      preview.metadata = input.metadata;
      preview.status = "pr_created";
      preview.updatedAt = input.updatedAt;

      const linkInput = input as typeof input & {
        taskPrLinkUpdates?: Array<{
          externalLinks: CortexTask["externalLinks"];
          status: CortexTask["status"];
          taskId: string;
        }>;
      };

      for (const update of linkInput.taskPrLinkUpdates ?? []) {
        const task = tasks.find(
          (candidate) =>
            candidate.id === update.taskId && candidate.workspaceId === input.workspaceId,
        );

        if (task !== undefined) {
          task.externalLinks = update.externalLinks;
          task.status = update.status;
          task.updatedAt = input.updatedAt;
        }
      }

      auditEvents.push(input.auditEvent as StoredAuditEvent);

      return preview;
    }),
    persistSetupPrPreviewWithAudit: vi.fn<SetupPrPreviewStore["persistSetupPrPreviewWithAudit"]>(
      async (input) => {
        const row: SetupPrPreviewRow = {
          contractVersion: input.preview.contractVersion,
          createdAt: input.preview.createdAt ?? now,
          excludedTaskIds: input.preview.excludedTaskIds,
          excludedTemplateIds: input.preview.excludedTemplateIds,
          files: input.preview.files,
          id: input.preview.id,
          metadata: input.preview.metadata,
          repoId: input.preview.repoId,
          status: input.preview.status,
          taskIds: input.preview.taskIds,
          updatedAt: input.preview.updatedAt ?? now,
          workspaceId: input.preview.workspaceId,
        };

        previews.push(row);
        auditEvents.push(input.auditEvent as StoredAuditEvent);

        return row;
      },
    ),
    repositories,
    tasks,
    findings,
    previews,
  } satisfies SetupPrPreviewStore &
    SetupPrCreationStore & {
      auditEvents: StoredAuditEvent[];
      findings: SetupPrFindingRow[];
      previews: SetupPrPreviewRow[];
      repositories: SetupPrCreationRepositoryRow[];
      tasks: SetupPrTaskRow[];
    };

  return store;
};

const repositoryPayload = () => ({
  archived: false,
  default_branch: "main",
  disabled: false,
  full_name: "acme/control-plane",
  html_url: "https://github.com/acme/control-plane",
  id: 9001,
  name: "control-plane",
  owner: {
    html_url: "https://github.com/acme",
    id: 42,
    login: "acme",
    type: "Organization",
  },
  private: true,
  visibility: "private",
});

const createMockGitHubRequest = () => {
  const baseCommitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const baseTreeSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const setupTreeSha = "cccccccccccccccccccccccccccccccccccccccc";
  const setupCommitSha = "dddddddddddddddddddddddddddddddddddddddd";
  const requests: GitHubAppRequest[] = [];
  const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
    requests.push(transportRequest);

    switch (transportRequest.operation) {
      case "getBranchReference":
        return { object: { sha: baseCommitSha }, ref: "refs/heads/main" };
      case "getGitCommit":
        return { sha: baseCommitSha, tree: { sha: baseTreeSha } };
      case "createGitBlob":
        return { sha: String(requests.length).padStart(40, "0") };
      case "createGitTree":
        return { sha: setupTreeSha };
      case "createGitCommit":
        return { sha: setupCommitSha };
      case "createBranchReference":
        return {
          object: { sha: setupCommitSha },
          ref: "refs/heads/cortex/setup-pr/setup-pr-preview-1",
        };
      case "createPullRequest":
        return {
          base: {
            ref: "main",
            repo: repositoryPayload(),
          },
          draft: true,
          head: {
            ref: "cortex/setup-pr/setup-pr-preview-1",
          },
          html_url: "https://github.com/acme/control-plane/pull/77",
          id: 77_000,
          merged: false,
          number: 77,
          repository: repositoryPayload(),
          state: "open",
          title: "Cortex setup PR: setup_pr_preview_1",
          updated_at: later.toISOString(),
        };
      default:
        throw new Error(`Unexpected GitHub operation: ${transportRequest.operation}`);
    }
  });

  return { request, requests };
};

const expectNoUnsafeSetupPrMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toMatch(
    /diff --git|@@ -|```|rawOutput|sourceCode|patchText|process\.env|PRIVATE KEY|\/Users\/rory|\.env(?:\.|$)|runnerId|taskPacketId|run_e2e/iu,
  );
};

describe("setup PR E2E", () => {
  test("creates a preview, opens a mocked GitHub setup PR, stores PR metadata, and links tasks/findings", async () => {
    const [{ createSetupPrCreationService }, { createSetupPrPreviewService }] = await Promise.all([
      import("./creation"),
      import("./previews"),
    ]);
    const store = createSetupPrE2EStore();
    const gitHubHarness = createMockGitHubRequest();
    const githubClient = createGitHubAppClient({ request: gitHubHarness.request });
    const getAuthContext = async () => ({ userId: "user_1" });
    const previewService = createSetupPrPreviewService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      createPreviewId: () => "setup_pr_preview_1",
      getAuthContext,
      now: () => now,
      store,
    });
    const creationService = createSetupPrCreationService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      getAuthContext,
      githubClient,
      now: () => later,
      store,
    });

    const preview = await previewService.createSetupPrPreview({
      repoId: "github_repository_1",
      taskIds: ["cortex_task_policy", "cortex_task_ci"],
      workspaceId: "workspace_1",
    });

    expect(preview.status).toBe("draft");
    expect(preview.files.map((file) => file.path)).toEqual([
      ".aicp/policy.json",
      ".github/workflows/cortex-validation.yml",
    ]);
    expect(preview.files.every((file) => file.omittedContent)).toBe(true);

    const result = await creationService.createSetupPrFromPreview({
      previewId: preview.previewId,
      workspaceId: "workspace_1",
    });

    expect(result).toMatchObject({
      baseBranch: "main",
      branchName: "cortex/setup-pr/setup-pr-preview-1",
      pullRequestNumber: 77,
      pullRequestUrl: "https://github.com/acme/control-plane/pull/77",
    });
    expect(result.preview.status).toBe("pr_created");
    expect(result.preview.metadata).toMatchObject({
      baseBranch: "main",
      headBranch: "cortex/setup-pr/setup-pr-preview-1",
      pullRequestDraft: true,
      pullRequestNumber: 77,
      pullRequestUrl: "https://github.com/acme/control-plane/pull/77",
      repositoryFullName: "acme/control-plane",
      sourceLabel: "setup_pr_creation_service",
    });
    expect(result.evidenceSummary.findingIds).toEqual(["finding_policy", "finding_ci"]);
    expect(result.evidenceSummary.taskIds).toEqual(["cortex_task_policy", "cortex_task_ci"]);
    expect(result.evidenceSummary.files.map((file) => file.path)).toEqual([
      ".aicp/policy.json",
      ".github/workflows/cortex-validation.yml",
    ]);

    expect(gitHubHarness.requests.map((request) => request.operation)).toEqual([
      "getBranchReference",
      "getGitCommit",
      "createGitBlob",
      "createGitBlob",
      "createGitTree",
      "createGitCommit",
      "createBranchReference",
      "createPullRequest",
    ]);
    expect(
      gitHubHarness.requests.find((request) => request.operation === "createGitTree")?.body,
    ).toEqual({
      base_tree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      tree: [
        {
          mode: "100644",
          path: ".aicp/policy.json",
          sha: "0000000000000000000000000000000000000003",
          type: "blob",
        },
        {
          mode: "100644",
          path: ".github/workflows/cortex-validation.yml",
          sha: "0000000000000000000000000000000000000004",
          type: "blob",
        },
      ],
    });
    expect(
      gitHubHarness.requests.find((request) => request.operation === "createBranchReference")?.body,
    ).toEqual({
      ref: "refs/heads/cortex/setup-pr/setup-pr-preview-1",
      sha: "dddddddddddddddddddddddddddddddddddddddd",
    });

    for (const task of store.tasks) {
      expect(task.status).toBe("pr_opened");
      expect(task.externalLinks).toContainEqual({
        externalId: "77",
        provider: "github",
        resourceType: "pull_request",
        status: "draft",
        syncedAt: later.toISOString(),
        title: "Cortex setup PR: setup_pr_preview_1",
        url: "https://github.com/acme/control-plane/pull/77",
      });
    }
    expect(store.findings.map((finding) => finding.id).toSorted()).toEqual([
      "finding_ci",
      "finding_policy",
    ]);

    const html = renderToStaticMarkup(
      createElement(SetupPrFlow, {
        previews: store.previews.map(toSetupPrPreview),
        repositories: [
          {
            id: "github_repository_1",
            repositoryFullName: "acme/control-plane",
            repositoryName: "control-plane",
            repositoryOwner: "acme",
          },
        ],
        tasks: store.tasks.map((task) =>
          CortexTaskSchema.parse({
            acceptanceCriteria: task.acceptanceCriteria,
            approvalStatus: task.approvalStatus,
            contractVersion: task.contractVersion,
            createdAt: task.createdAt.toISOString(),
            executionMode: task.executionMode,
            externalLinks: task.externalLinks,
            findingIds: task.findingIds,
            metadata: task.metadata,
            objective: task.objective,
            origin: {
              type: task.originType,
            },
            prArtifactIds: task.prArtifactIds,
            repoId: task.repoId,
            riskLevel: task.riskLevel,
            runIds: task.runIds,
            status: task.status,
            suggestedValidation: task.suggestedValidation,
            taskId: task.id,
            taskRecommendationId: task.taskRecommendationId ?? undefined,
            title: task.title,
            updatedAt: task.updatedAt.toISOString(),
            workspaceId: task.workspaceId,
          }),
        ),
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("PR created");
    expect(html).toContain('href="https://github.com/acme/control-plane/pull/77"');
    expect(html).toContain("#77");
    expect(html).toContain("cortex/setup-pr/setup-pr-preview-1");
    expect(html).toContain("finding_ci");
    expect(html).toContain("finding_policy");
    expectNoUnsafeSetupPrMaterial({
      auditEvents: store.auditEvents,
      evidenceSummary: result.evidenceSummary,
      html,
      preview: result.preview,
      taskLinks: store.tasks.map((task) => task.externalLinks),
    });
  });
});
