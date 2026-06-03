import { z } from "zod";

import { DryRunCheckSchema } from "./repo-policy.js";
import { RiskFindingSchema } from "./risk.js";
import { RunnerCapabilitiesSchema } from "./runner-capabilities.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

const UNSAFE_METADATA_KEYS = new Set([
  "diff",
  "patch",
  "source",
  "code",
  "sourcecode",
  "sourcecontent",
  "content",
  "contents",
  "snippet",
  "snippets",
  "filecontent",
  "filecontents",
]);

const RAW_PAYLOAD_METADATA_KEY_PATTERN =
  /^(?:raw|full|unified|git)?(?:diff|patch|source|code)(?:text|content|contents|snippet|snippets|filecontent|filecontents|body|data|blob|value|code|line|lines)?$/;

const normalizeMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isUnsafeMetadataKey = (key: string): boolean => {
  const normalizedKey = normalizeMetadataKey(key);

  return (
    UNSAFE_METADATA_KEYS.has(normalizedKey) || RAW_PAYLOAD_METADATA_KEY_PATTERN.test(normalizedKey)
  );
};

const addUnsafeMetadataKeyIssues = (
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
      addUnsafeMetadataKeyIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (isUnsafeMetadataKey(key)) {
      context.addIssue({
        code: "custom",
        message: `Dry-run check metadata cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafeMetadataKeyIssues(childValue, context, childPath, seen);
  }
};

export const DRY_RUN_RESULT_STATUSES = ["passed", "failed", "warning"] as const;

export const DryRunResultStatusSchema = z.enum(DRY_RUN_RESULT_STATUSES);
export type DryRunResultStatus = z.infer<typeof DryRunResultStatusSchema>;

export const DRY_RUN_CHECK_RESULT_STATUSES = ["passed", "failed", "warning", "skipped"] as const;

export const DryRunCheckResultStatusSchema = z.enum(DRY_RUN_CHECK_RESULT_STATUSES);
export type DryRunCheckResultStatus = z.infer<typeof DryRunCheckResultStatusSchema>;

export const DryRunCheckResultMetadataSchema = z
  .record(z.string(), z.unknown())
  .superRefine((metadata, context) => {
    addUnsafeMetadataKeyIssues(metadata, context);
  });

export type DryRunCheckResultMetadata = z.infer<typeof DryRunCheckResultMetadataSchema>;

export const DryRunCheckResultSchema = z
  .object({
    id: DryRunCheckSchema,
    label: NonEmptyStringSchema,
    status: DryRunCheckResultStatusSchema,
    message: NonEmptyStringSchema,
    metadata: DryRunCheckResultMetadataSchema,
  })
  .strict();

export type DryRunCheckResult = z.infer<typeof DryRunCheckResultSchema>;

export const DryRunResultSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    id: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    status: DryRunResultStatusSchema,
    checks: z.array(DryRunCheckResultSchema),
    capabilities: RunnerCapabilitiesSchema,
    blockers: z.array(RiskFindingSchema),
    warnings: z.array(RiskFindingSchema),
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export type DryRunResult = z.infer<typeof DryRunResultSchema>;
