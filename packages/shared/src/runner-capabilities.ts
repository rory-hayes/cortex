import { z } from "zod";

import { hasUnsafePayloadValueText } from "./payload-safety.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const SafeCapabilityStringSchema = NonEmptyStringSchema.superRefine((value, context) => {
  if (hasUnsafePayloadValueText(value, { rejectControlCharacters: true })) {
    context.addIssue({
      code: "custom",
      message: "Runner capability string must be safe metadata.",
    });
  }
});

export const ToolCapabilitySchema = z
  .object({
    available: z.boolean(),
    version: SafeCapabilityStringSchema.optional(),
    path: SafeCapabilityStringSchema.optional(),
  })
  .strict();

export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const RunnerCapabilitiesOsSchema = z
  .object({
    platform: SafeCapabilityStringSchema,
    release: SafeCapabilityStringSchema,
    arch: SafeCapabilityStringSchema,
  })
  .strict();

export type RunnerCapabilitiesOs = z.infer<typeof RunnerCapabilitiesOsSchema>;

export const RunnerCapabilitiesToolsSchema = z
  .object({
    git: ToolCapabilitySchema.optional(),
    gh: ToolCapabilitySchema.optional(),
    codex: ToolCapabilitySchema.optional(),
    node: ToolCapabilitySchema.optional(),
    npm: ToolCapabilitySchema.optional(),
    pnpm: ToolCapabilitySchema.optional(),
    yarn: ToolCapabilitySchema.optional(),
    python: ToolCapabilitySchema.optional(),
  })
  .strict();

export type RunnerCapabilitiesTools = z.infer<typeof RunnerCapabilitiesToolsSchema>;

export const RunnerCapabilitiesSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: SafeCapabilityStringSchema.optional(),
    os: RunnerCapabilitiesOsSchema,
    shell: SafeCapabilityStringSchema,
    tools: RunnerCapabilitiesToolsSchema,
    maxConcurrentJobs: z.number().int().positive(),
    supportsDryRun: z.boolean(),
    supportsCancellation: z.boolean(),
    reportedAt: SafeCapabilityStringSchema,
  })
  .strict();

export type RunnerCapabilities = z.infer<typeof RunnerCapabilitiesSchema>;
