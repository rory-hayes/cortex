import { z } from "zod";

import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const TrimmedNonEmptyStringSchema = z.string().trim().min(1);

const UNSAFE_CORTEX_TASK_PAYLOAD_KEYS = new Set([
  "command",
  "diff",
  "patch",
  "rawdiff",
  "patchtext",
  "source",
  "rawsource",
  "sourcecode",
  "snippet",
  "codesnippet",
  "code",
  "content",
  "filecontent",
  "filecontents",
  "secret",
  "token",
  "password",
  "privatekey",
  "rawlog",
  "rawlogs",
  "stdout",
  "stdoutsummary",
  "stderr",
  "stderrsummary",
  "rawoutput",
  "rawcommandoutput",
]);

const normalizePayloadKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const addUnsafePayloadKeyIssues = (
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
) => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addUnsafePayloadKeyIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];

    if (UNSAFE_CORTEX_TASK_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Cortex task cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

export const CORTEX_TASK_ORIGIN_TYPES = [
  "finding",
  "task_recommendation",
  "manual",
  "external_import",
] as const;

export const CortexTaskOriginTypeSchema = z.enum(CORTEX_TASK_ORIGIN_TYPES);
export type CortexTaskOriginType = z.infer<typeof CortexTaskOriginTypeSchema>;

export const CORTEX_TASK_RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;

export const CortexTaskRiskLevelSchema = z.enum(CORTEX_TASK_RISK_LEVELS);
export type CortexTaskRiskLevel = z.infer<typeof CortexTaskRiskLevelSchema>;

export const CORTEX_TASK_EXECUTION_MODES = ["planning_only", "setup_pr", "local_runner"] as const;

export const CortexTaskExecutionModeSchema = z.enum(CORTEX_TASK_EXECUTION_MODES);
export type CortexTaskExecutionMode = z.infer<typeof CortexTaskExecutionModeSchema>;

export const CORTEX_TASK_STATUSES = [
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

export const CortexTaskStatusSchema = z.enum(CORTEX_TASK_STATUSES);
export type CortexTaskStatus = z.infer<typeof CortexTaskStatusSchema>;

export const CORTEX_TASK_APPROVAL_STATUSES = [
  "not_requested",
  "pending",
  "approved",
  "rejected",
  "deferred",
] as const;

export const CortexTaskApprovalStatusSchema = z.enum(CORTEX_TASK_APPROVAL_STATUSES);
export type CortexTaskApprovalStatus = z.infer<typeof CortexTaskApprovalStatusSchema>;

export const CORTEX_TASK_TRANSITION_ACTORS = ["user", "runner", "external_sync"] as const;

export const CortexTaskTransitionActorSchema = z.enum(CORTEX_TASK_TRANSITION_ACTORS);
export type CortexTaskTransitionActor = z.infer<typeof CortexTaskTransitionActorSchema>;

export const CORTEX_TASK_EXTERNAL_LINK_PROVIDERS = ["github", "linear", "jira", "docs"] as const;

export const CortexTaskExternalLinkProviderSchema = z.enum(CORTEX_TASK_EXTERNAL_LINK_PROVIDERS);
export type CortexTaskExternalLinkProvider = z.infer<typeof CortexTaskExternalLinkProviderSchema>;

export const CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES = [
  "github_issue",
  "linear_issue",
  "jira_issue",
  "pull_request",
  "documentation",
] as const;

export const CortexTaskExternalLinkResourceTypeSchema = z.enum(
  CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES,
);
export type CortexTaskExternalLinkResourceType = z.infer<
  typeof CortexTaskExternalLinkResourceTypeSchema
>;

const EXTERNAL_LINK_RESOURCE_TYPES_BY_PROVIDER = {
  docs: ["documentation"],
  github: ["github_issue", "pull_request"],
  jira: ["jira_issue"],
  linear: ["linear_issue"],
} as const satisfies Record<
  CortexTaskExternalLinkProvider,
  readonly CortexTaskExternalLinkResourceType[]
>;

const EXTERNAL_LINK_RESOURCE_TYPES_REQUIRING_EXTERNAL_ID =
  new Set<CortexTaskExternalLinkResourceType>([
    "github_issue",
    "jira_issue",
    "linear_issue",
    "pull_request",
  ]);

const secretUrlParameterPattern =
  /^(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)$/iu;

const unsafeExternalLinkTextPatterns = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /```[^\n]*\n/i,
  /\b(?:sourceCode|rawSource|rawDiff|patchText|codeSnippet|rawOutput|rawLog)\b/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i,
  /(?:^|[\s"'([{:=,])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/u,
  /(?:^|[/\\])\.\.(?:[/\\]|$)/u,
] as const;

const hasUnsafeExternalLinkText = (value: string): boolean =>
  unsafeExternalLinkTextPatterns.some((pattern) => pattern.test(value));

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
};

const SafeExternalLinkTextSchema = (maxLength: number) =>
  TrimmedNonEmptyStringSchema.max(maxLength).superRefine((value, context) => {
    if (hasControlCharacter(value) || hasUnsafeExternalLinkText(value)) {
      context.addIssue({
        code: "custom",
        message: "External link text must be safe display metadata.",
      });
    }
  });

const SafeExternalLinkIdSchema = TrimmedNonEmptyStringSchema.max(240)
  .regex(/^[A-Za-z0-9._:-]+$/u)
  .superRefine((value, context) => {
    if (hasControlCharacter(value) || hasUnsafeExternalLinkText(value)) {
      context.addIssue({
        code: "custom",
        message: "External link id must be safe metadata.",
      });
    }
  });

const ExternalLinkUrlSchema = TrimmedNonEmptyStringSchema.max(2_048)
  .url()
  .superRefine((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "External link URL must be valid.",
      });
      return;
    }

    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
      context.addIssue({
        code: "custom",
        message: "External link URL must be HTTPS without embedded credentials.",
      });
    }

    for (const key of url.searchParams.keys()) {
      if (secretUrlParameterPattern.test(key)) {
        context.addIssue({
          code: "custom",
          message: "External link URL cannot include secret-like query parameters.",
        });
      }
    }
  })
  .transform((value) => new URL(value).toString());

const ExternalLinkSyncedAtSchema = TrimmedNonEmptyStringSchema.max(80)
  .superRefine((value, context) => {
    const timestamp = new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      context.addIssue({
        code: "custom",
        message: "syncedAt must be an ISO timestamp.",
      });
    }
  })
  .transform((value) => new Date(value).toISOString());

const inferExternalIdFromUrl = (url: string, resourceType: CortexTaskExternalLinkResourceType) => {
  const parsedUrl = new URL(url);
  const segments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);

  if (resourceType === "github_issue") {
    const issueSegmentIndex = segments.indexOf("issues");

    return issueSegmentIndex >= 0 ? segments[issueSegmentIndex + 1] : undefined;
  }

  if (resourceType === "pull_request") {
    const pullSegmentIndex = segments.indexOf("pull");

    return pullSegmentIndex >= 0 ? segments[pullSegmentIndex + 1] : undefined;
  }

  if (resourceType === "jira_issue") {
    const browseSegmentIndex = segments.indexOf("browse");

    return browseSegmentIndex >= 0 ? segments[browseSegmentIndex + 1] : segments.at(-1);
  }

  if (resourceType === "linear_issue") {
    const issueSegmentIndex = segments.indexOf("issue");
    const issueSegment = issueSegmentIndex >= 0 ? segments[issueSegmentIndex + 1] : undefined;
    const identifierMatch = issueSegment?.match(/^[A-Z][A-Z0-9]+-\d+/u);

    return identifierMatch?.[0] ?? issueSegment;
  }

  return undefined;
};

const inferLegacyExternalLinkType = (input: {
  externalId?: string | undefined;
  label: string;
  url: string;
}): {
  externalId?: string;
  provider: CortexTaskExternalLinkProvider;
  resourceType: CortexTaskExternalLinkResourceType;
} => {
  const parsedUrl = new URL(input.url);
  const host = parsedUrl.hostname.toLowerCase();
  const pathSegments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);
  const label = input.label.toLowerCase();

  if (host === "github.com" && pathSegments.includes("pull")) {
    const resourceType = "pull_request";
    const externalId = input.externalId ?? inferExternalIdFromUrl(input.url, resourceType);

    return {
      ...(externalId === undefined ? {} : { externalId }),
      provider: "github",
      resourceType,
    };
  }

  if (host === "github.com" && pathSegments.includes("issues")) {
    const resourceType = "github_issue";
    const externalId = input.externalId ?? inferExternalIdFromUrl(input.url, resourceType);

    return {
      ...(externalId === undefined ? {} : { externalId }),
      provider: "github",
      resourceType,
    };
  }

  if (host.endsWith("linear.app") || label.includes("linear")) {
    const resourceType = "linear_issue";
    const externalId = input.externalId ?? inferExternalIdFromUrl(input.url, resourceType);

    return {
      ...(externalId === undefined ? {} : { externalId }),
      provider: "linear",
      resourceType,
    };
  }

  if (host.endsWith("atlassian.net") || label.includes("jira")) {
    const resourceType = "jira_issue";
    const externalId = input.externalId ?? inferExternalIdFromUrl(input.url, resourceType);

    return {
      ...(externalId === undefined ? {} : { externalId }),
      provider: "jira",
      resourceType,
    };
  }

  return {
    ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
    provider: "docs",
    resourceType: "documentation",
  };
};

export const CORTEX_TASK_STATUS_TRANSITION_TABLE = {
  external_sync: {
    approved: [],
    blocked: [],
    completed: [],
    deferred: [],
    draft: [],
    needs_review: [],
    pr_opened: ["completed"],
    queued: [],
    rejected: [],
    running: [],
  },
  runner: {
    approved: [],
    blocked: [],
    completed: [],
    deferred: [],
    draft: [],
    needs_review: [],
    pr_opened: [],
    queued: ["running", "blocked"],
    rejected: [],
    running: ["blocked", "pr_opened"],
  },
  user: {
    approved: ["queued", "deferred"],
    blocked: ["queued", "deferred", "rejected"],
    completed: [],
    deferred: ["draft", "needs_review"],
    draft: ["needs_review", "deferred", "rejected"],
    needs_review: ["approved", "draft", "deferred", "rejected"],
    pr_opened: [],
    queued: ["deferred"],
    rejected: [],
    running: [],
  },
} as const satisfies Record<
  CortexTaskTransitionActor,
  Record<CortexTaskStatus, readonly CortexTaskStatus[]>
>;

export type CortexTaskStatusTransitionInput = {
  actor: CortexTaskTransitionActor;
  currentApprovalStatus: CortexTaskApprovalStatus;
  currentStatus: CortexTaskStatus;
  nextStatus: CortexTaskStatus;
};

export type CortexTaskStatusTransitionEvaluation =
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
      reason: "approval_required" | "transition_not_allowed";
    };

const APPROVED_APPROVAL_STATUS: CortexTaskApprovalStatus = "approved";

const STATUSES_REQUIRING_APPROVAL_BEFORE_TRANSITION = new Set<CortexTaskStatus>([
  "blocked",
  "completed",
  "pr_opened",
  "queued",
  "running",
]);

const deriveApprovalStatusForStatus = (input: {
  currentApprovalStatus: CortexTaskApprovalStatus;
  nextStatus: CortexTaskStatus;
}): CortexTaskApprovalStatus => {
  switch (input.nextStatus) {
    case "draft":
      return "not_requested";
    case "needs_review":
      return "pending";
    case "approved":
    case "queued":
    case "running":
    case "pr_opened":
    case "completed":
      return "approved";
    case "blocked":
      return input.currentApprovalStatus;
    case "rejected":
      return "rejected";
    case "deferred":
      return "deferred";
  }
};

export const evaluateCortexTaskStatusTransition = (
  input: CortexTaskStatusTransitionInput,
): CortexTaskStatusTransitionEvaluation => {
  const allowedNextStatuses: readonly CortexTaskStatus[] =
    CORTEX_TASK_STATUS_TRANSITION_TABLE[input.actor][input.currentStatus];

  if (!allowedNextStatuses.includes(input.nextStatus)) {
    return {
      actor: input.actor,
      allowed: false,
      currentApprovalStatus: input.currentApprovalStatus,
      currentStatus: input.currentStatus,
      nextStatus: input.nextStatus,
      reason: "transition_not_allowed",
    };
  }

  if (
    STATUSES_REQUIRING_APPROVAL_BEFORE_TRANSITION.has(input.nextStatus) &&
    input.currentApprovalStatus !== APPROVED_APPROVAL_STATUS
  ) {
    return {
      actor: input.actor,
      allowed: false,
      currentApprovalStatus: input.currentApprovalStatus,
      currentStatus: input.currentStatus,
      nextStatus: input.nextStatus,
      reason: "approval_required",
    };
  }

  return {
    actor: input.actor,
    allowed: true,
    currentApprovalStatus: input.currentApprovalStatus,
    currentStatus: input.currentStatus,
    nextApprovalStatus: deriveApprovalStatusForStatus({
      currentApprovalStatus: input.currentApprovalStatus,
      nextStatus: input.nextStatus,
    }),
    nextStatus: input.nextStatus,
  };
};

export const CortexTaskOriginSchema = z
  .object({
    type: CortexTaskOriginTypeSchema,
    externalId: NonEmptyStringSchema.optional(),
    externalSystem: NonEmptyStringSchema.optional(),
  })
  .strict();

export type CortexTaskOrigin = z.infer<typeof CortexTaskOriginSchema>;

export const CortexTaskSuggestedValidationSchema = z
  .object({
    validationId: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    required: z.boolean(),
  })
  .strict();

export type CortexTaskSuggestedValidation = z.infer<typeof CortexTaskSuggestedValidationSchema>;

const CanonicalCortexTaskExternalLinkInputSchema = z
  .object({
    externalId: SafeExternalLinkIdSchema.optional(),
    provider: CortexTaskExternalLinkProviderSchema,
    resourceType: CortexTaskExternalLinkResourceTypeSchema,
    status: SafeExternalLinkTextSchema(120).default("unknown"),
    syncedAt: ExternalLinkSyncedAtSchema.optional(),
    title: SafeExternalLinkTextSchema(240),
    url: ExternalLinkUrlSchema,
  })
  .strict();

const LegacyCortexTaskExternalLinkInputSchema = z
  .object({
    externalId: SafeExternalLinkIdSchema.optional(),
    label: SafeExternalLinkTextSchema(120),
    url: ExternalLinkUrlSchema,
  })
  .strict()
  .transform((link) => {
    const inferredType = inferLegacyExternalLinkType(link);

    return {
      ...inferredType,
      status: "unknown",
      title: link.label,
      url: link.url,
    };
  });

const CortexTaskExternalLinkNormalizedSchema = z
  .object({
    externalId: SafeExternalLinkIdSchema.optional(),
    provider: CortexTaskExternalLinkProviderSchema,
    resourceType: CortexTaskExternalLinkResourceTypeSchema,
    status: SafeExternalLinkTextSchema(120).default("unknown"),
    syncedAt: ExternalLinkSyncedAtSchema.optional(),
    title: SafeExternalLinkTextSchema(240),
    url: ExternalLinkUrlSchema,
  })
  .strict()
  .superRefine((link, context) => {
    const allowedResourceTypes = EXTERNAL_LINK_RESOURCE_TYPES_BY_PROVIDER[
      link.provider
    ] as readonly CortexTaskExternalLinkResourceType[];

    if (!allowedResourceTypes.includes(link.resourceType)) {
      context.addIssue({
        code: "custom",
        message: "External link provider and resourceType are incompatible.",
        path: ["resourceType"],
      });
    }

    if (
      EXTERNAL_LINK_RESOURCE_TYPES_REQUIRING_EXTERNAL_ID.has(link.resourceType) &&
      link.externalId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "External link resource type requires externalId.",
        path: ["externalId"],
      });
    }
  });

export const CortexTaskExternalLinkSchema = z
  .union([CanonicalCortexTaskExternalLinkInputSchema, LegacyCortexTaskExternalLinkInputSchema])
  .transform((link, context) => {
    const result = CortexTaskExternalLinkNormalizedSchema.safeParse(link);

    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
      }

      return z.NEVER;
    }

    return result.data;
  });

export type CortexTaskExternalLink = z.infer<typeof CortexTaskExternalLinkSchema>;

export const CortexTaskMetadataSchema = z
  .record(z.string(), z.json())
  .superRefine((metadata, context) => {
    addUnsafePayloadKeyIssues(metadata, context);
    addUnsafePayloadValueIssues(
      metadata,
      context,
      "Cortex task metadata cannot include unsafe text values.",
    );
  });

export type CortexTaskMetadata = z.infer<typeof CortexTaskMetadataSchema>;

const CortexTaskShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    taskId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    origin: CortexTaskOriginSchema,
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
    riskLevel: CortexTaskRiskLevelSchema,
    executionMode: CortexTaskExecutionModeSchema,
    status: CortexTaskStatusSchema,
    approvalStatus: CortexTaskApprovalStatusSchema,
    suggestedValidation: z.array(CortexTaskSuggestedValidationSchema),
    findingIds: z.array(NonEmptyStringSchema),
    taskRecommendationId: NonEmptyStringSchema.optional(),
    taskPacketId: NonEmptyStringSchema.optional(),
    runIds: z.array(NonEmptyStringSchema),
    latestRunId: NonEmptyStringSchema.optional(),
    prArtifactIds: z.array(NonEmptyStringSchema),
    externalLinks: z.array(CortexTaskExternalLinkSchema),
    metadata: CortexTaskMetadataSchema,
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((task, context) => {
    if (task.origin.type === "finding" && task.findingIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Finding-origin Cortex tasks require at least one findingId.",
        path: ["findingIds"],
      });
    }

    if (task.origin.type === "task_recommendation" && !task.taskRecommendationId) {
      context.addIssue({
        code: "custom",
        message: "Task-recommendation-origin Cortex tasks require taskRecommendationId.",
        path: ["taskRecommendationId"],
      });
    }

    if (
      task.origin.type === "external_import" &&
      !task.origin.externalId &&
      task.externalLinks.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "External-import Cortex tasks require origin.externalId or at least one external link.",
        path: ["origin", "externalId"],
      });
    }

    if (task.latestRunId && !task.runIds.includes(task.latestRunId)) {
      context.addIssue({
        code: "custom",
        message: "latestRunId must reference an id in runIds.",
        path: ["latestRunId"],
      });
    }
  });

export const CortexTaskSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(payload, context, "Cortex task cannot include unsafe text values.");
  })
  .pipe(CortexTaskShapeSchema);

export type CortexTask = z.infer<typeof CortexTaskSchema>;
