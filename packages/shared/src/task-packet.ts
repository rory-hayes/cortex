import { z } from "zod";

import { RepoPolicySchema } from "./repo-policy.js";
import { ValidationCommandSchema } from "./validation-command.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const NonEmptyStringListSchema = z.array(NonEmptyStringSchema);

export const TASK_PACKET_MODES = ["dryRun", "execute", "repair"] as const;

export const TaskPacketModeSchema = z.enum(TASK_PACKET_MODES);
export type TaskPacketMode = z.infer<typeof TaskPacketModeSchema>;

export const TASK_PACKET_SOURCE_TYPES = ["manual", "linear", "repair"] as const;

export const TaskPacketSourceTypeSchema = z.enum(TASK_PACKET_SOURCE_TYPES);
export type TaskPacketSourceType = z.infer<typeof TaskPacketSourceTypeSchema>;

export const TaskPacketSourceSchema = z
  .object({
    type: TaskPacketSourceTypeSchema,
    externalId: NonEmptyStringSchema.optional(),
    title: NonEmptyStringSchema,
    url: NonEmptyStringSchema.optional(),
  })
  .strict();

export type TaskPacketSource = z.infer<typeof TaskPacketSourceSchema>;

export const TaskPacketRepoSchema = z
  .object({
    localPath: NonEmptyStringSchema,
    defaultBranch: NonEmptyStringSchema,
    targetBranch: NonEmptyStringSchema,
    worktreePath: NonEmptyStringSchema.optional(),
  })
  .strict();

export type TaskPacketRepo = z.infer<typeof TaskPacketRepoSchema>;

export const TaskPacketContextSchema = z
  .object({
    files: NonEmptyStringListSchema,
    notes: NonEmptyStringListSchema,
  })
  .strict();

export type TaskPacketContext = z.infer<typeof TaskPacketContextSchema>;

export const TaskPacketValidationSchema = z
  .object({
    commands: z.array(ValidationCommandSchema).min(1),
  })
  .strict();

export type TaskPacketValidation = z.infer<typeof TaskPacketValidationSchema>;

export const TaskPacketRepairSchema = z
  .object({
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    feedback: NonEmptyStringSchema,
    previousRunId: NonEmptyStringSchema,
  })
  .strict();

export type TaskPacketRepair = z.infer<typeof TaskPacketRepairSchema>;

export const TaskPacketSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    id: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    repositoryId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    mode: TaskPacketModeSchema,
    objective: NonEmptyStringSchema,
    acceptanceCriteria: NonEmptyStringListSchema,
    source: TaskPacketSourceSchema,
    repo: TaskPacketRepoSchema,
    context: TaskPacketContextSchema,
    policy: RepoPolicySchema,
    validation: TaskPacketValidationSchema,
    repair: TaskPacketRepairSchema.optional(),
    createdAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((packet, context) => {
    if (packet.mode === "repair") {
      if (packet.repair === undefined) {
        context.addIssue({
          code: "custom",
          message: "Repair task packets require repair metadata.",
          path: ["repair"],
        });
      }

      if (packet.source.type !== "repair") {
        context.addIssue({
          code: "custom",
          message: "Repair task packets require source.type to be repair.",
          path: ["source", "type"],
        });
      }
    } else {
      if (packet.repair !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Only repair task packets may include repair metadata.",
          path: ["repair"],
        });
      }

      if (packet.source.type === "repair") {
        context.addIssue({
          code: "custom",
          message: "Repair source metadata is only valid for repair task packets.",
          path: ["source", "type"],
        });
      }
    }

    if (packet.repair !== undefined && packet.repair.attempt > packet.repair.maxAttempts) {
      context.addIssue({
        code: "custom",
        message: "Repair attempt must not exceed maxAttempts.",
        path: ["repair", "attempt"],
      });
    }
  });

export type TaskPacket = z.infer<typeof TaskPacketSchema>;
