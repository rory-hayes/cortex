import { z } from "zod";

import { addUnsafePayloadValueIssues } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().trim().min(1);

const UNSAFE_SETUP_PR_PREVIEW_PAYLOAD_KEYS = new Set([
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

const unsafeSetupPrPreviewPathPattern =
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

    if (UNSAFE_SETUP_PR_PREVIEW_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      context.addIssue({
        code: "custom",
        message: `Setup PR preview cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafePayloadKeyIssues(childValue, context, childPath, seen);
  }
};

const SafeSetupPrPreviewPathSchema = NonEmptyStringSchema.refine(
  (path) => !unsafeSetupPrPreviewPathPattern.test(path),
  "Setup PR preview file paths must be relative non-source setup paths.",
);

export const SETUP_PR_PREVIEW_STATUSES = ["draft", "pr_created", "superseded"] as const;

export const SetupPrPreviewStatusSchema = z.enum(SETUP_PR_PREVIEW_STATUSES);
export type SetupPrPreviewStatus = z.infer<typeof SetupPrPreviewStatusSchema>;

export const SetupPrPreviewFileSchema = z
  .object({
    omittedContent: z.literal(true),
    operation: z.literal("create_or_update"),
    path: SafeSetupPrPreviewPathSchema,
    reviewInstructions: z.array(NonEmptyStringSchema).min(1),
    reviewRequired: z.literal(true),
    sourceTaskIds: z.array(NonEmptyStringSchema).min(1),
    summary: NonEmptyStringSchema,
    templateId: NonEmptyStringSchema,
  })
  .strict();

export type SetupPrPreviewFile = z.infer<typeof SetupPrPreviewFileSchema>;

export const SetupPrPreviewMetadataSchema = z
  .record(z.string(), z.json())
  .superRefine((metadata, context) => {
    addUnsafePayloadKeyIssues(metadata, context);
    addUnsafePayloadValueIssues(
      metadata,
      context,
      "Setup PR preview metadata cannot include unsafe text values.",
    );
  });

export type SetupPrPreviewMetadata = z.infer<typeof SetupPrPreviewMetadataSchema>;

const SetupPrPreviewShapeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    createdAt: NonEmptyStringSchema,
    excludedTaskIds: z.array(NonEmptyStringSchema),
    excludedTemplateIds: z.array(NonEmptyStringSchema),
    files: z.array(SetupPrPreviewFileSchema).min(1),
    metadata: SetupPrPreviewMetadataSchema,
    previewId: NonEmptyStringSchema,
    repoId: NonEmptyStringSchema,
    status: SetupPrPreviewStatusSchema,
    taskIds: z.array(NonEmptyStringSchema).min(1),
    updatedAt: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
  })
  .strict();

export const SetupPrPreviewSchema = z
  .unknown()
  .superRefine((payload, context) => {
    addUnsafePayloadKeyIssues(payload, context);
    addUnsafePayloadValueIssues(
      payload,
      context,
      "Setup PR preview cannot include unsafe text values.",
    );
  })
  .pipe(SetupPrPreviewShapeSchema);

export type SetupPrPreview = z.infer<typeof SetupPrPreviewSchema>;
