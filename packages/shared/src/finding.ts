import { z } from "zod";

import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

const UNSAFE_FINDING_METADATA_KEYS = new Set([
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

const normalizeMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const addUnsafeMetadataKeyIssues = (
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
  allowTopLevelSource = false,
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
      addUnsafeMetadataKeyIssues(item, context, [...path, index], seen, allowTopLevelSource),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    const normalizedKey = normalizeMetadataKey(key);

    if (
      UNSAFE_FINDING_METADATA_KEYS.has(normalizedKey) &&
      !(allowTopLevelSource && path.length === 0 && normalizedKey === "source")
    ) {
      context.addIssue({
        code: "custom",
        message: `Finding evidence metadata cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafeMetadataKeyIssues(childValue, context, childPath, seen, allowTopLevelSource);
  }
};

export const FINDING_CATEGORIES = [
  "product_clarity",
  "agent_readiness",
  "architecture",
  "backlog_quality",
  "validation",
  "ci_cd",
  "security",
  "repo_hygiene",
  "execution_risk",
  "integration",
] as const;

export const FindingCategorySchema = z.enum(FINDING_CATEGORIES);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FINDING_SEVERITIES = ["info", "low", "medium", "high", "blocked"] as const;

export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FINDING_STATUSES = ["open", "dismissed", "deferred", "resolved"] as const;

export const FindingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FINDING_SOURCES = ["deterministic_rule", "ai_summary", "manual", "imported"] as const;

export const FindingSourceSchema = z.enum(FINDING_SOURCES);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingMetadataSchema = z
  .record(z.string(), z.json())
  .superRefine((metadata, context) => {
    addUnsafeMetadataKeyIssues(metadata, context);
    addUnsafePayloadValueIssues(
      metadata,
      context,
      "Finding evidence metadata cannot include unsafe text values.",
    );
  });

export type FindingMetadata = z.infer<typeof FindingMetadataSchema>;

export const FindingEvidenceSchema = z
  .object({
    summary: NonEmptyStringSchema,
    paths: z.array(NonEmptyStringSchema),
    metadata: FindingMetadataSchema,
  })
  .strict();

export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

const FindingShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    findingId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    scanId: NonEmptyStringSchema,
    category: FindingCategorySchema,
    severity: FindingSeveritySchema,
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    evidence: z.array(FindingEvidenceSchema).min(1),
    recommendation: NonEmptyStringSchema,
    source: FindingSourceSchema,
    deterministicRuleId: NonEmptyStringSchema,
    confidence: z.number().min(0).max(1),
    status: FindingStatusSchema,
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const FindingSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafeMetadataKeyIssues(payload, context, [], new WeakSet(), true);
    addUnsafePayloadValueIssues(payload, context, "Finding cannot include unsafe text values.");
  })
  .pipe(FindingShapeSchema);

export type Finding = z.infer<typeof FindingSchema>;
