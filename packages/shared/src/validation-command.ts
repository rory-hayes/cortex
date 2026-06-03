import { z } from "zod";

export const ValidationCommandSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    command: z.string().min(1),
    cwd: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().positive(),
    required: z.boolean(),
  })
  .strict();

export type ValidationCommand = z.infer<typeof ValidationCommandSchema>;
