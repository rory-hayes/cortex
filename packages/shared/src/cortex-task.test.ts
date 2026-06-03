import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "./version.js";

const DOCUMENTED_CORTEX_TASK_ORIGIN_TYPES = [
  "finding",
  "task_recommendation",
  "manual",
  "external_import",
] as const;

const DOCUMENTED_CORTEX_TASK_RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;

const DOCUMENTED_CORTEX_TASK_EXECUTION_MODES = [
  "planning_only",
  "setup_pr",
  "local_runner",
] as const;

const DOCUMENTED_CORTEX_TASK_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "queued",
  "running",
  "blocked",
  "pr_opened",
  "completed",
  "rejected",
  "deferred",
] as const;

const DOCUMENTED_CORTEX_TASK_APPROVAL_STATUSES = [
  "not_requested",
  "pending",
  "approved",
  "rejected",
  "deferred",
] as const;

const DOCUMENTED_CORTEX_TASK_TRANSITION_ACTORS = ["user", "runner", "external_sync"] as const;

const DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_PROVIDERS = [
  "github",
  "linear",
  "jira",
  "docs",
] as const;

const DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES = [
  "github_issue",
  "linear_issue",
  "jira_issue",
  "pull_request",
  "documentation",
] as const;

const UNSAFE_CORTEX_TASK_KEYS = [
  "sourceCode",
  "rawSource",
  "diff",
  "rawDiff",
  "patch",
  "patchText",
  "snippet",
  "codeSnippet",
  "fileContents",
  "rawLog",
  "rawLogs",
  "rawCommandOutput",
  "stdout",
  "stdoutSummary",
  "stderr",
  "stderrSummary",
  "secret",
  "token",
  "password",
  "privateKey",
] as const;

const UNSAFE_CORTEX_TASK_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw logs: private runner output",
  "https://runner:secret@example.test/repo.git",
  "LINEAR_TOKEN=lin_api_tasksecret1234567890",
  "%LINEAR_TOKEN%",
] as const;

type CortexTaskOriginType = (typeof DOCUMENTED_CORTEX_TASK_ORIGIN_TYPES)[number];
type CortexTaskRiskLevel = (typeof DOCUMENTED_CORTEX_TASK_RISK_LEVELS)[number];
type CortexTaskExecutionMode = (typeof DOCUMENTED_CORTEX_TASK_EXECUTION_MODES)[number];
type CortexTaskStatus = (typeof DOCUMENTED_CORTEX_TASK_STATUSES)[number];
type CortexTaskApprovalStatus = (typeof DOCUMENTED_CORTEX_TASK_APPROVAL_STATUSES)[number];
type CortexTaskTransitionActor = (typeof DOCUMENTED_CORTEX_TASK_TRANSITION_ACTORS)[number];
type CortexTaskExternalLinkProvider =
  (typeof DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_PROVIDERS)[number];
type CortexTaskExternalLinkResourceType =
  (typeof DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES)[number];

type CortexTaskOrigin = {
  type: CortexTaskOriginType;
  externalId?: string;
  externalSystem?: string;
};

type CortexTaskSuggestedValidation = {
  validationId: string;
  label: string;
  required: boolean;
};

type CortexTaskExternalLink = {
  externalId?: string;
  provider: CortexTaskExternalLinkProvider;
  resourceType: CortexTaskExternalLinkResourceType;
  status: string;
  syncedAt?: string;
  title: string;
  url: string;
};

type CortexTask = {
  contractVersion: typeof CONTRACT_VERSION;
  taskId: string;
  workspaceId: string;
  repoId: string;
  origin: CortexTaskOrigin;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  riskLevel: CortexTaskRiskLevel;
  executionMode: CortexTaskExecutionMode;
  status: CortexTaskStatus;
  approvalStatus: CortexTaskApprovalStatus;
  suggestedValidation: CortexTaskSuggestedValidation[];
  findingIds: string[];
  taskRecommendationId?: string;
  taskPacketId?: string;
  runIds: string[];
  latestRunId?: string;
  prArtifactIds: string[];
  externalLinks: CortexTaskExternalLink[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type ZodIssueSummary = {
  path: PropertyKey[];
  message: string;
};

type SchemaLike = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: ZodIssueSummary[];
        };
      };
};

type CortexTaskModule = {
  CORTEX_TASK_ORIGIN_TYPES: readonly CortexTaskOriginType[];
  CORTEX_TASK_RISK_LEVELS: readonly CortexTaskRiskLevel[];
  CORTEX_TASK_EXECUTION_MODES: readonly CortexTaskExecutionMode[];
  CORTEX_TASK_STATUSES: readonly CortexTaskStatus[];
  CORTEX_TASK_APPROVAL_STATUSES: readonly CortexTaskApprovalStatus[];
  CORTEX_TASK_STATUS_TRANSITION_TABLE: Record<
    CortexTaskTransitionActor,
    Partial<Record<CortexTaskStatus, readonly CortexTaskStatus[]>>
  >;
  CORTEX_TASK_TRANSITION_ACTORS: readonly CortexTaskTransitionActor[];
  CORTEX_TASK_EXTERNAL_LINK_PROVIDERS: readonly CortexTaskExternalLinkProvider[];
  CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES: readonly CortexTaskExternalLinkResourceType[];
  CortexTaskOriginTypeSchema: SchemaLike;
  CortexTaskRiskLevelSchema: SchemaLike;
  CortexTaskExecutionModeSchema: SchemaLike;
  CortexTaskStatusSchema: SchemaLike;
  CortexTaskApprovalStatusSchema: SchemaLike;
  CortexTaskTransitionActorSchema: SchemaLike;
  CortexTaskExternalLinkProviderSchema: SchemaLike;
  CortexTaskExternalLinkResourceTypeSchema: SchemaLike;
  CortexTaskOriginSchema: SchemaLike;
  CortexTaskSuggestedValidationSchema: SchemaLike;
  CortexTaskExternalLinkSchema: SchemaLike;
  CortexTaskMetadataSchema: SchemaLike;
  CortexTaskSchema: SchemaLike;
  evaluateCortexTaskStatusTransition: (input: {
    actor: CortexTaskTransitionActor;
    currentApprovalStatus: CortexTaskApprovalStatus;
    currentStatus: CortexTaskStatus;
    nextStatus: CortexTaskStatus;
  }) =>
    | {
        actor: CortexTaskTransitionActor;
        allowed: true;
        currentApprovalStatus: CortexTaskApprovalStatus;
        currentStatus: CortexTaskStatus;
        nextApprovalStatus: CortexTaskApprovalStatus;
        nextStatus: CortexTaskStatus;
      }
    | {
        actor: CortexTaskTransitionActor;
        allowed: false;
        currentApprovalStatus: CortexTaskApprovalStatus;
        currentStatus: CortexTaskStatus;
        nextStatus: CortexTaskStatus;
        reason: string;
      };
};

const loadCortexTaskModule = async () => (await import("./cortex-task.js")) as CortexTaskModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<CortexTaskModule>;

const validTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  contractVersion: CONTRACT_VERSION,
  taskId: "cortex-task-001",
  workspaceId: "workspace-001",
  repoId: "repo-001",
  origin: {
    type: "finding",
  },
  title: "Add validation command metadata",
  objective: "Add metadata-only validation command configuration before local runner execution.",
  acceptanceCriteria: [
    "Validation command metadata is represented without shell command text.",
    "Repo readiness can link the task to the originating finding.",
  ],
  riskLevel: "medium",
  executionMode: "setup_pr",
  status: "approved",
  approvalStatus: "approved",
  suggestedValidation: [
    {
      validationId: "validation:typecheck",
      label: "TypeScript typecheck",
      required: true,
    },
  ],
  findingIds: ["finding-validation-001"],
  taskRecommendationId: "task-recommendation-validation-001",
  taskPacketId: "task-packet-001",
  runIds: ["run-001", "run-002"],
  latestRunId: "run-002",
  prArtifactIds: ["pr-artifact-001"],
  externalLinks: [
    {
      externalId: "42",
      provider: "github",
      resourceType: "github_issue",
      status: "open",
      syncedAt: "2026-05-25T11:01:00.000Z",
      title: "GitHub issue 42",
      url: "https://github.com/example/repo/issues/42",
    },
  ],
  metadata: {
    readinessScoreAtCreation: 70,
    category: "validation",
    labels: ["repo-readiness", "setup"],
  },
  createdAt: "2026-05-25T11:00:00.000Z",
  updatedAt: "2026-05-25T11:05:00.000Z",
  ...overrides,
});

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

describe("CortexTask", () => {
  it("exports documented enum values in canonical order", async () => {
    const {
      CORTEX_TASK_APPROVAL_STATUSES,
      CORTEX_TASK_EXECUTION_MODES,
      CORTEX_TASK_ORIGIN_TYPES,
      CORTEX_TASK_RISK_LEVELS,
      CORTEX_TASK_STATUSES,
      CORTEX_TASK_TRANSITION_ACTORS,
      CORTEX_TASK_EXTERNAL_LINK_PROVIDERS,
      CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES,
      CortexTaskApprovalStatusSchema,
      CortexTaskExecutionModeSchema,
      CortexTaskExternalLinkProviderSchema,
      CortexTaskExternalLinkResourceTypeSchema,
      CortexTaskOriginTypeSchema,
      CortexTaskRiskLevelSchema,
      CortexTaskStatusSchema,
      CortexTaskTransitionActorSchema,
    } = await loadCortexTaskModule();

    expect(CORTEX_TASK_ORIGIN_TYPES).toEqual(DOCUMENTED_CORTEX_TASK_ORIGIN_TYPES);
    expect(CORTEX_TASK_RISK_LEVELS).toEqual(DOCUMENTED_CORTEX_TASK_RISK_LEVELS);
    expect(CORTEX_TASK_EXECUTION_MODES).toEqual(DOCUMENTED_CORTEX_TASK_EXECUTION_MODES);
    expect(CORTEX_TASK_STATUSES).toEqual(DOCUMENTED_CORTEX_TASK_STATUSES);
    expect(CORTEX_TASK_APPROVAL_STATUSES).toEqual(DOCUMENTED_CORTEX_TASK_APPROVAL_STATUSES);
    expect(CORTEX_TASK_TRANSITION_ACTORS).toEqual(DOCUMENTED_CORTEX_TASK_TRANSITION_ACTORS);
    expect(CORTEX_TASK_EXTERNAL_LINK_PROVIDERS).toEqual(
      DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_PROVIDERS,
    );
    expect(CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES).toEqual(
      DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES,
    );

    for (const value of DOCUMENTED_CORTEX_TASK_ORIGIN_TYPES) {
      expect(CortexTaskOriginTypeSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_RISK_LEVELS) {
      expect(CortexTaskRiskLevelSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_EXECUTION_MODES) {
      expect(CortexTaskExecutionModeSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_STATUSES) {
      expect(CortexTaskStatusSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_APPROVAL_STATUSES) {
      expect(CortexTaskApprovalStatusSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_TRANSITION_ACTORS) {
      expect(CortexTaskTransitionActorSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_PROVIDERS) {
      expect(CortexTaskExternalLinkProviderSchema.safeParse(value).success).toBe(true);
    }

    for (const value of DOCUMENTED_CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES) {
      expect(CortexTaskExternalLinkResourceTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("evaluates user review and queue transitions with derived approval statuses", async () => {
    const { evaluateCortexTaskStatusTransition } = await loadCortexTaskModule();

    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "not_requested",
        currentStatus: "draft",
        nextStatus: "needs_review",
      }),
    ).toMatchObject({
      allowed: true,
      nextApprovalStatus: "pending",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "pending",
        currentStatus: "needs_review",
        nextStatus: "approved",
      }),
    ).toMatchObject({
      allowed: true,
      nextApprovalStatus: "approved",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "approved",
        currentStatus: "approved",
        nextStatus: "queued",
      }),
    ).toMatchObject({
      allowed: true,
      nextApprovalStatus: "approved",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "pending",
        currentStatus: "needs_review",
        nextStatus: "rejected",
      }),
    ).toMatchObject({
      allowed: true,
      nextApprovalStatus: "rejected",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "approved",
        currentStatus: "approved",
        nextStatus: "deferred",
      }),
    ).toMatchObject({
      allowed: true,
      nextApprovalStatus: "deferred",
    });
  });

  it("rejects invalid user jumps across approval and execution states", async () => {
    const { evaluateCortexTaskStatusTransition } = await loadCortexTaskModule();

    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "not_requested",
        currentStatus: "draft",
        nextStatus: "queued",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "transition_not_allowed",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "pending",
        currentStatus: "needs_review",
        nextStatus: "running",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "transition_not_allowed",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "user",
        currentApprovalStatus: "approved",
        currentStatus: "completed",
        nextStatus: "running",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "transition_not_allowed",
    });
  });

  it("limits runner actors to approved execution transitions", async () => {
    const { evaluateCortexTaskStatusTransition } = await loadCortexTaskModule();

    for (const transition of [
      ["queued", "running"],
      ["queued", "blocked"],
      ["running", "blocked"],
      ["running", "pr_opened"],
    ] as const) {
      expect(
        evaluateCortexTaskStatusTransition({
          actor: "runner",
          currentApprovalStatus: "approved",
          currentStatus: transition[0],
          nextStatus: transition[1],
        }),
      ).toMatchObject({
        allowed: true,
        nextApprovalStatus: "approved",
      });
    }

    expect(
      evaluateCortexTaskStatusTransition({
        actor: "runner",
        currentApprovalStatus: "pending",
        currentStatus: "needs_review",
        nextStatus: "approved",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "transition_not_allowed",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "runner",
        currentApprovalStatus: "pending",
        currentStatus: "queued",
        nextStatus: "running",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "approval_required",
    });
    expect(
      evaluateCortexTaskStatusTransition({
        actor: "runner",
        currentApprovalStatus: "approved",
        currentStatus: "pr_opened",
        nextStatus: "completed",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "transition_not_allowed",
    });
  });

  it("prevents external sync from bypassing approval or entering execution states", async () => {
    const { evaluateCortexTaskStatusTransition } = await loadCortexTaskModule();

    for (const nextStatus of ["approved", "queued", "running", "pr_opened"] as const) {
      expect(
        evaluateCortexTaskStatusTransition({
          actor: "external_sync",
          currentApprovalStatus: "pending",
          currentStatus: "needs_review",
          nextStatus,
        }),
      ).toMatchObject({
        allowed: false,
        reason: "transition_not_allowed",
      });
    }

    expect(
      evaluateCortexTaskStatusTransition({
        actor: "external_sync",
        currentApprovalStatus: "approved",
        currentStatus: "pr_opened",
        nextStatus: "completed",
      }),
    ).toMatchObject({
      allowed: true,
      nextApprovalStatus: "approved",
    });
  });

  it("validates a metadata-only Cortex task with every required field", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();

    expect(CortexTaskSchema.safeParse(validTask()).success).toBe(true);
  });

  it("supports canonical safe external links for issues, pull requests, and documentation", async () => {
    const { CortexTaskExternalLinkSchema, CortexTaskSchema } = await loadCortexTaskModule();
    const externalLinks = [
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        syncedAt: "2026-05-25T11:01:00.000Z",
        title: "GitHub issue 42",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        externalId: "LIN-42",
        provider: "linear",
        resourceType: "linear_issue",
        status: "triaged",
        title: "Linear issue LIN-42",
        url: "https://linear.app/example/issue/LIN-42/add-validation-metadata",
      },
      {
        externalId: "OPS-42",
        provider: "jira",
        resourceType: "jira_issue",
        status: "In Progress",
        title: "Jira issue OPS-42",
        url: "https://example.atlassian.net/browse/OPS-42",
      },
      {
        externalId: "43",
        provider: "github",
        resourceType: "pull_request",
        status: "merged",
        title: "Pull request 43",
        url: "https://github.com/example/repo/pull/43",
      },
      {
        provider: "docs",
        resourceType: "documentation",
        title: "Validation runbook",
        url: "https://docs.example.test/runbooks/validation",
      },
    ] satisfies Array<Partial<CortexTaskExternalLink> & Record<string, unknown>>;

    for (const link of externalLinks) {
      const result = CortexTaskExternalLinkSchema.safeParse(link);

      expect(result.success, `Expected ${link.resourceType} link to parse.`).toBe(true);
      if (result.success) {
        expect(result.data as CortexTaskExternalLink).toMatchObject({
          provider: link.provider,
          resourceType: link.resourceType,
          status: link.status ?? "unknown",
          title: link.title,
        });
      }
    }

    const taskResult = CortexTaskSchema.safeParse(
      validTask({
        externalLinks: externalLinks as CortexTaskExternalLink[],
      }),
    );

    expect(taskResult.success).toBe(true);
    if (taskResult.success) {
      expect((taskResult.data as CortexTask).externalLinks.at(-1)).toMatchObject({
        provider: "docs",
        resourceType: "documentation",
        status: "unknown",
      });
    }
  });

  it("keeps tasks with zero external links valid", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();

    expect(CortexTaskSchema.safeParse(validTask({ externalLinks: [] })).success).toBe(true);
  });

  it("normalizes legacy label/url/externalId links for v1 compatibility", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();
    const legacyTask = {
      ...validTask(),
      externalLinks: [
        {
          externalId: "42",
          label: "GitHub issue",
          url: "https://github.com/example/repo/issues/42",
        },
      ],
    };

    const result = CortexTaskSchema.safeParse(legacyTask);

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as CortexTask).externalLinks).toEqual([
        {
          externalId: "42",
          provider: "github",
          resourceType: "github_issue",
          status: "unknown",
          title: "GitHub issue",
          url: "https://github.com/example/repo/issues/42",
        },
      ]);
    }
  });

  it("rejects malformed, unsafe, or underspecified external links", async () => {
    const { CortexTaskExternalLinkSchema, CortexTaskSchema } = await loadCortexTaskModule();
    const invalidLinks = [
      {
        externalId: "42",
        provider: "unknown",
        resourceType: "github_issue",
        status: "open",
        title: "GitHub issue 42",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "jira_issue",
        status: "open",
        title: "GitHub issue 42",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        title: "GitHub issue without id",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        title: "Insecure GitHub issue",
        url: "http://github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        title: "Credentialed GitHub issue",
        url: "https://user:password@github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        title: "GitHub issue with secret query",
        url: "https://github.com/example/repo/issues/42?token=secret",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        sourceCode: "placeholder",
        title: "GitHub issue with unsafe key",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        title: "```ts\nconst leaked = true;\n```",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "raw logs: pnpm test output",
        title: "GitHub issue 42",
        url: "https://github.com/example/repo/issues/42",
      },
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        syncedAt: "not-a-date",
        title: "GitHub issue 42",
        url: "https://github.com/example/repo/issues/42",
      },
    ];

    for (const link of invalidLinks) {
      expect(
        CortexTaskExternalLinkSchema.safeParse(link).success,
        `Expected external link to reject: ${JSON.stringify(link)}`,
      ).toBe(false);
      expect(
        CortexTaskSchema.safeParse(validTask({ externalLinks: [link as CortexTaskExternalLink] }))
          .success,
        `Expected task to reject external link: ${JSON.stringify(link)}`,
      ).toBe(false);
    }
  });

  it("rejects missing required top-level fields", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();
    const requiredFields = [
      "contractVersion",
      "taskId",
      "workspaceId",
      "repoId",
      "origin",
      "title",
      "objective",
      "acceptanceCriteria",
      "riskLevel",
      "executionMode",
      "status",
      "approvalStatus",
      "suggestedValidation",
      "findingIds",
      "runIds",
      "prArtifactIds",
      "externalLinks",
      "metadata",
      "createdAt",
      "updatedAt",
    ] as const;

    for (const field of requiredFields) {
      const candidate: Partial<CortexTask> = { ...validTask() };
      delete candidate[field];

      const result = CortexTaskSchema.safeParse(candidate);

      expect(result.success, `Expected missing ${field} to be rejected.`).toBe(false);
    }
  });

  it("rejects invalid status, risk, execution, and approval values", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();

    expect(
      CortexTaskSchema.safeParse(validTask({ status: "ready" as CortexTaskStatus })).success,
    ).toBe(false);
    expect(
      CortexTaskSchema.safeParse(validTask({ riskLevel: "critical" as CortexTaskRiskLevel }))
        .success,
    ).toBe(false);
    expect(
      CortexTaskSchema.safeParse(
        validTask({ executionMode: "hosted_execution" as CortexTaskExecutionMode }),
      ).success,
    ).toBe(false);
    expect(
      CortexTaskSchema.safeParse(
        validTask({ approvalStatus: "auto_approved" as CortexTaskApprovalStatus }),
      ).success,
    ).toBe(false);
  });

  it("rejects unsafe payload keys recursively across the whole task", async () => {
    const { CortexTaskSchema, CortexTaskMetadataSchema } = await loadCortexTaskModule();

    for (const key of UNSAFE_CORTEX_TASK_KEYS) {
      const metadata = {
        safeSummary: "Only metadata identifiers and labels are allowed.",
        nested: [{ [key]: "placeholder value" }],
      };
      const taskResult = CortexTaskSchema.safeParse(
        validTask({
          metadata,
        }),
      );
      const metadataResult = CortexTaskMetadataSchema.safeParse(metadata);

      expect(taskResult.success, `Expected task payload key ${key} to be rejected.`).toBe(false);
      expect(metadataResult.success, `Expected metadata key ${key} to be rejected.`).toBe(false);

      if (!taskResult.success) {
        expect(taskResult.error.issues.map((issue) => issuePath(issue.path))).toContain(
          `metadata.nested.0.${key}`,
        );
      }
    }
  });

  it("rejects source-like, raw-log, and secret-like text values across tasks", async () => {
    const { CortexTaskSchema, CortexTaskMetadataSchema } = await loadCortexTaskModule();

    for (const unsafeValue of UNSAFE_CORTEX_TASK_VALUES) {
      const metadata = {
        safeKey: unsafeValue,
      };

      expect(
        CortexTaskSchema.safeParse(
          validTask({
            objective: unsafeValue,
          }),
        ).success,
        `Expected task objective value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        CortexTaskSchema.safeParse(
          validTask({
            metadata,
          }),
        ).success,
        `Expected task metadata value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        CortexTaskMetadataSchema.safeParse(metadata).success,
        `Expected task metadata schema to reject ${unsafeValue}`,
      ).toBe(false);
    }
  });

  it("rejects source payload keys so task provenance must use origin", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();
    const result = CortexTaskSchema.safeParse({
      ...validTask(),
      source: {
        type: "finding",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issuePath(issue.path))).toContain("source");
    }
  });

  it("keeps suggested validation metadata-only by rejecting command fields", async () => {
    const { CortexTaskSchema, CortexTaskSuggestedValidationSchema } = await loadCortexTaskModule();
    const suggestedValidation = {
      validationId: "validation:typecheck",
      label: "TypeScript typecheck",
      required: true,
      command: "pnpm run typecheck",
    };

    expect(CortexTaskSuggestedValidationSchema.safeParse(suggestedValidation).success).toBe(false);
    expect(
      CortexTaskSchema.safeParse(
        validTask({
          suggestedValidation: [suggestedValidation as CortexTaskSuggestedValidation],
        }),
      ).success,
    ).toBe(false);
  });

  it("enforces origin cross-field requirements", async () => {
    const { CortexTaskSchema } = await loadCortexTaskModule();
    const taskRecommendationTask: Partial<CortexTask> = validTask({
      origin: { type: "task_recommendation" },
    });
    delete taskRecommendationTask.taskRecommendationId;

    expect(
      CortexTaskSchema.safeParse(
        validTask({
          origin: { type: "finding" },
          findingIds: [],
        }),
      ).success,
    ).toBe(false);
    expect(CortexTaskSchema.safeParse(taskRecommendationTask).success).toBe(false);
    expect(
      CortexTaskSchema.safeParse(
        validTask({
          origin: { type: "external_import" },
          externalLinks: [],
        }),
      ).success,
    ).toBe(false);
    expect(
      CortexTaskSchema.safeParse(
        validTask({
          origin: { type: "external_import", externalId: "EXT-42" },
          externalLinks: [],
          findingIds: [],
        }),
      ).success,
    ).toBe(true);
    expect(
      CortexTaskSchema.safeParse(
        validTask({
          latestRunId: "run-missing",
        }),
      ).success,
    ).toBe(false);
  });

  it("exports the Cortex task contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.CORTEX_TASK_ORIGIN_TYPES).toEqual(DOCUMENTED_CORTEX_TASK_ORIGIN_TYPES);
    expect(shared.CORTEX_TASK_RISK_LEVELS).toEqual(DOCUMENTED_CORTEX_TASK_RISK_LEVELS);
    expect(shared.CORTEX_TASK_EXECUTION_MODES).toEqual(DOCUMENTED_CORTEX_TASK_EXECUTION_MODES);
    expect(shared.CORTEX_TASK_STATUSES).toEqual(DOCUMENTED_CORTEX_TASK_STATUSES);
    expect(shared.CORTEX_TASK_APPROVAL_STATUSES).toEqual(DOCUMENTED_CORTEX_TASK_APPROVAL_STATUSES);
    expect(shared.CortexTaskOriginTypeSchema?.safeParse("manual").success).toBe(true);
    expect(shared.CortexTaskRiskLevelSchema?.safeParse("blocked").success).toBe(true);
    expect(shared.CortexTaskExecutionModeSchema?.safeParse("local_runner").success).toBe(true);
    expect(shared.CortexTaskStatusSchema?.safeParse("queued").success).toBe(true);
    expect(shared.CortexTaskApprovalStatusSchema?.safeParse("approved").success).toBe(true);
    expect(shared.CortexTaskSchema?.safeParse(validTask()).success).toBe(true);
  });
});
