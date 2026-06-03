import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "./version.js";

const DOCUMENTED_TASK_RECOMMENDATION_STATUSES = [
  "open",
  "approved",
  "ignored",
  "deferred",
  "converted",
] as const;

const DOCUMENTED_TASK_RECOMMENDATION_EFFORTS = ["small", "medium", "large"] as const;

const UNSAFE_TASK_RECOMMENDATION_KEYS = [
  "sourceCode",
  "diff",
  "patch",
  "snippet",
  "command",
  "fileContents",
  "localPath",
  "paths",
  "rawOutput",
  "stdoutSummary",
  "stderrSummary",
  "secret",
  "token",
  "password",
  "privateKey",
] as const;

const UNSAFE_TASK_RECOMMENDATION_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw output: private recommendation output",
  "https://runner:secret@example.test/repo.git",
  "OPENAI_API_KEY=sk-recommendation-secret-value",
  "$env:OPENAI_API_KEY",
] as const;

type TaskRecommendationStatus = (typeof DOCUMENTED_TASK_RECOMMENDATION_STATUSES)[number];
type TaskRecommendationEffort = (typeof DOCUMENTED_TASK_RECOMMENDATION_EFFORTS)[number];
type CortexTaskRiskLevel = "low" | "medium" | "high" | "blocked";
type CortexTaskExecutionMode = "planning_only" | "setup_pr" | "local_runner";

type TaskRecommendationSuggestedValidation = {
  validationId: string;
  label: string;
  required: boolean;
};

type TaskRecommendation = {
  contractVersion: typeof CONTRACT_VERSION;
  taskRecommendationId: string;
  workspaceId: string;
  repoId: string;
  scanId: string;
  title: string;
  objective: string;
  findingIds: string[];
  acceptanceCriteria: string[];
  riskLevel: CortexTaskRiskLevel;
  effort: TaskRecommendationEffort;
  executionMode: CortexTaskExecutionMode;
  suggestedValidation: TaskRecommendationSuggestedValidation[];
  status: TaskRecommendationStatus;
  cortexTaskId?: string;
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

type TaskRecommendationModule = {
  TASK_RECOMMENDATION_STATUSES: readonly TaskRecommendationStatus[];
  TASK_RECOMMENDATION_EFFORTS: readonly TaskRecommendationEffort[];
  TaskRecommendationStatusSchema: SchemaLike;
  TaskRecommendationEffortSchema: SchemaLike;
  TaskRecommendationMetadataSchema: SchemaLike;
  TaskRecommendationSchema: SchemaLike;
};

const loadTaskRecommendationModule = async () =>
  (await import("./task-recommendation.js")) as TaskRecommendationModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<TaskRecommendationModule>;

const validRecommendation = (overrides: Partial<TaskRecommendation> = {}): TaskRecommendation => ({
  contractVersion: CONTRACT_VERSION,
  taskRecommendationId: "task-recommendation-validation-001",
  workspaceId: "workspace-001",
  repoId: "repo-001",
  scanId: "repo-scan-001",
  title: "Add validation command metadata",
  objective: "Represent validation setup work as a safe metadata-only recommendation.",
  findingIds: ["finding-validation-001"],
  acceptanceCriteria: [
    "Recommendation links to the validation readiness finding.",
    "Suggested validation is represented without shell command text.",
  ],
  riskLevel: "medium",
  effort: "small",
  executionMode: "setup_pr",
  suggestedValidation: [
    {
      validationId: "validation:typecheck",
      label: "TypeScript typecheck",
      required: true,
    },
  ],
  status: "open",
  metadata: {
    readinessCategory: "validation",
    confidence: 0.82,
    labels: ["repo-readiness", "setup"],
  },
  createdAt: "2026-05-25T12:10:00.000Z",
  updatedAt: "2026-05-25T12:10:00.000Z",
  ...overrides,
});

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

describe("TaskRecommendation", () => {
  it("exports documented statuses and effort values in canonical order", async () => {
    const {
      TASK_RECOMMENDATION_EFFORTS,
      TASK_RECOMMENDATION_STATUSES,
      TaskRecommendationEffortSchema,
      TaskRecommendationStatusSchema,
    } = await loadTaskRecommendationModule();

    expect(TASK_RECOMMENDATION_STATUSES).toEqual(DOCUMENTED_TASK_RECOMMENDATION_STATUSES);
    expect(TASK_RECOMMENDATION_EFFORTS).toEqual(DOCUMENTED_TASK_RECOMMENDATION_EFFORTS);

    for (const status of DOCUMENTED_TASK_RECOMMENDATION_STATUSES) {
      expect(TaskRecommendationStatusSchema.safeParse(status).success).toBe(true);
    }

    for (const effort of DOCUMENTED_TASK_RECOMMENDATION_EFFORTS) {
      expect(TaskRecommendationEffortSchema.safeParse(effort).success).toBe(true);
    }
  });

  it("validates a metadata-only task recommendation", async () => {
    const { TaskRecommendationSchema } = await loadTaskRecommendationModule();

    expect(TaskRecommendationSchema.safeParse(validRecommendation()).success).toBe(true);
  });

  it("rejects missing required top-level fields and unknown fields", async () => {
    const { TaskRecommendationSchema } = await loadTaskRecommendationModule();
    const requiredFields = [
      "contractVersion",
      "taskRecommendationId",
      "workspaceId",
      "repoId",
      "scanId",
      "title",
      "objective",
      "findingIds",
      "acceptanceCriteria",
      "riskLevel",
      "effort",
      "executionMode",
      "suggestedValidation",
      "status",
      "metadata",
      "createdAt",
      "updatedAt",
    ] as const;

    for (const field of requiredFields) {
      const candidate: Partial<TaskRecommendation> = { ...validRecommendation() };
      delete candidate[field];

      expect(
        TaskRecommendationSchema.safeParse(candidate).success,
        `Expected missing ${field} to be rejected.`,
      ).toBe(false);
    }

    const unknownFieldResult = TaskRecommendationSchema.safeParse({
      ...validRecommendation(),
      reviewerNotes: "Use metadata for safe labels and counts only.",
    });

    expect(unknownFieldResult.success).toBe(false);
  });

  it("requires at least one finding link and one acceptance criterion", async () => {
    const { TaskRecommendationSchema } = await loadTaskRecommendationModule();

    expect(
      TaskRecommendationSchema.safeParse(validRecommendation({ findingIds: [] })).success,
    ).toBe(false);
    expect(
      TaskRecommendationSchema.safeParse(validRecommendation({ acceptanceCriteria: [] })).success,
    ).toBe(false);
  });

  it("rejects invalid risk, effort, execution mode, and status values", async () => {
    const { TaskRecommendationSchema } = await loadTaskRecommendationModule();

    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({ riskLevel: "critical" as CortexTaskRiskLevel }),
      ).success,
    ).toBe(false);
    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({ effort: "tiny" as TaskRecommendationEffort }),
      ).success,
    ).toBe(false);
    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({ executionMode: "hosted_execution" as CortexTaskExecutionMode }),
      ).success,
    ).toBe(false);
    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({ status: "dismissed" as TaskRecommendationStatus }),
      ).success,
    ).toBe(false);
  });

  it("rejects unsafe payload keys recursively across the whole recommendation", async () => {
    const { TaskRecommendationMetadataSchema, TaskRecommendationSchema } =
      await loadTaskRecommendationModule();

    for (const key of UNSAFE_TASK_RECOMMENDATION_KEYS) {
      const metadata = {
        safeSummary: "Only metadata identifiers, labels, and counts are allowed.",
        nested: [{ [key]: "placeholder value" }],
      };
      const recommendationResult = TaskRecommendationSchema.safeParse(
        validRecommendation({
          metadata,
        }),
      );
      const metadataResult = TaskRecommendationMetadataSchema.safeParse(metadata);

      expect(
        recommendationResult.success,
        `Expected recommendation payload key ${key} to be rejected.`,
      ).toBe(false);
      expect(metadataResult.success, `Expected metadata key ${key} to be rejected.`).toBe(false);

      if (!recommendationResult.success) {
        expect(recommendationResult.error.issues.map((issue) => issuePath(issue.path))).toContain(
          `metadata.nested.0.${key}`,
        );
      }
    }
  });

  it("rejects source-like, raw-log, and secret-like text values across recommendations", async () => {
    const { TaskRecommendationMetadataSchema, TaskRecommendationSchema } =
      await loadTaskRecommendationModule();

    for (const unsafeValue of UNSAFE_TASK_RECOMMENDATION_VALUES) {
      const metadata = {
        safeKey: unsafeValue,
      };

      expect(
        TaskRecommendationSchema.safeParse(
          validRecommendation({
            objective: unsafeValue,
          }),
        ).success,
        `Expected recommendation objective value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        TaskRecommendationSchema.safeParse(
          validRecommendation({
            metadata,
          }),
        ).success,
        `Expected recommendation metadata value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        TaskRecommendationMetadataSchema.safeParse(metadata).success,
        `Expected recommendation metadata schema to reject ${unsafeValue}`,
      ).toBe(false);
    }
  });

  it("keeps suggested validation metadata-only by rejecting command text", async () => {
    const { TaskRecommendationSchema } = await loadTaskRecommendationModule();
    const suggestedValidation = {
      validationId: "validation:typecheck",
      label: "TypeScript typecheck",
      required: true,
      command: "pnpm run typecheck",
    };

    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({
          suggestedValidation: [
            suggestedValidation as unknown as TaskRecommendationSuggestedValidation,
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("requires converted recommendations to link a Cortex task and rejects premature links", async () => {
    const { TaskRecommendationSchema } = await loadTaskRecommendationModule();

    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({
          status: "converted",
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskRecommendationSchema.safeParse(
        validRecommendation({
          status: "converted",
          cortexTaskId: "cortex-task-001",
        }),
      ).success,
    ).toBe(true);

    for (const status of ["open", "approved", "ignored", "deferred"] as const) {
      expect(
        TaskRecommendationSchema.safeParse(
          validRecommendation({
            status,
            cortexTaskId: "cortex-task-001",
          }),
        ).success,
        `Expected ${status} recommendation to reject cortexTaskId.`,
      ).toBe(false);
    }
  });

  it("exports the TaskRecommendation contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.TASK_RECOMMENDATION_STATUSES).toEqual(DOCUMENTED_TASK_RECOMMENDATION_STATUSES);
    expect(shared.TASK_RECOMMENDATION_EFFORTS).toEqual(DOCUMENTED_TASK_RECOMMENDATION_EFFORTS);
    expect(shared.TaskRecommendationStatusSchema?.safeParse("approved").success).toBe(true);
    expect(shared.TaskRecommendationEffortSchema?.safeParse("medium").success).toBe(true);
    expect(shared.TaskRecommendationSchema?.safeParse(validRecommendation()).success).toBe(true);
  });
});
