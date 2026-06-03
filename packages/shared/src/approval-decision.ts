import { z } from "zod";

import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);

export const APPROVAL_DECISIONS = [
  "approve",
  "reject",
  "request_repair",
  "rerun_validation",
  "cancel_run",
  "close_run",
] as const;

export const ApprovalDecisionValueSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecisionValue = z.infer<typeof ApprovalDecisionValueSchema>;

export const ApprovalDecisionSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    id: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    actorId: NonEmptyStringSchema,
    decision: ApprovalDecisionValueSchema,
    reason: NonEmptyStringSchema,
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
