import { z } from "zod";

import { CortexTaskRiskLevelSchema } from "./cortex-task.js";
import { FindingCategorySchema, FindingSeveritySchema, FindingStatusSchema } from "./finding.js";
import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().trim().min(1);

const UNSAFE_SETUP_PR_EVIDENCE_PAYLOAD_KEYS = new Set([
  "code",
  "codesnippet",
  "command",
  "content",
  "contents",
  "diff",
  "filecontent",
  "filecontents",
  "patch",
  "patchtext",
  "privatekey",
  "rawcommandoutput",
  "rawdiff",
  "rawlog",
  "rawlogs",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "secret",
  "snippet",
  "snippets",
  "source",
  "sourcecode",
  "stderr",
  "stderrsummary",
  "stdout",
  "stdoutsummary",
  "token",
]);

const unsafeSetupPrEvidencePathPattern =
  /(^|\/)\.\.?($|\/)|(^|\/)\.env(?:\.|$)|(^|\/)(?:apps|packages|src|test|tests|__tests__)(?:\/|$)|^\/|^[A-Za-z]:[\\/]|\\/u;

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

    if (UNSAFE_SETUP_PR_EVIDENCE_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Setup PR evidence cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

const SafeSetupPrEvidencePathSchema = NonEmptyStringSchema.refine(
  (path) => !unsafeSetupPrEvidencePathPattern.test(path),
  "Setup PR evidence file paths must be relative non-source setup paths.",
);

export const SetupPrEvidenceTaskSummarySchema = z
  .object({
    riskLevel: CortexTaskRiskLevelSchema,
    taskId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    validationLabels: z.array(NonEmptyStringSchema),
  })
  .strict();

export type SetupPrEvidenceTaskSummary = z.infer<typeof SetupPrEvidenceTaskSummarySchema>;

export const SetupPrEvidenceFindingSummarySchema = z
  .object({
    category: FindingCategorySchema,
    findingId: NonEmptyStringSchema,
    severity: FindingSeveritySchema,
    status: FindingStatusSchema,
    title: NonEmptyStringSchema,
  })
  .strict();

export type SetupPrEvidenceFindingSummary = z.infer<typeof SetupPrEvidenceFindingSummarySchema>;

export const SetupPrEvidenceFileSummarySchema = z
  .object({
    findingIds: z.array(NonEmptyStringSchema),
    findings: z.array(SetupPrEvidenceFindingSummarySchema),
    omittedContent: z.literal(true),
    path: SafeSetupPrEvidencePathSchema,
    reviewChecklist: z.array(NonEmptyStringSchema).min(1),
    sourceTaskIds: z.array(NonEmptyStringSchema).min(1),
    summary: NonEmptyStringSchema,
    tasks: z.array(SetupPrEvidenceTaskSummarySchema).min(1),
    templateId: NonEmptyStringSchema,
    whyGenerated: NonEmptyStringSchema,
  })
  .strict();

export type SetupPrEvidenceFileSummary = z.infer<typeof SetupPrEvidenceFileSummarySchema>;

const SetupPrEvidenceSummaryShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    files: z.array(SetupPrEvidenceFileSummarySchema).min(1),
    findingIds: z.array(NonEmptyStringSchema),
    generatedAt: NonEmptyStringSchema,
    previewId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    taskIds: z.array(NonEmptyStringSchema).min(1),
    workspaceId: NonEmptyStringSchema,
  })
  .strict();

export const SetupPrEvidenceSummarySchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(
      payload,
      context,
      "Setup PR evidence cannot include unsafe text values.",
    );
  })
  .pipe(SetupPrEvidenceSummaryShapeSchema);

export type SetupPrEvidenceSummary = z.infer<typeof SetupPrEvidenceSummarySchema>;
