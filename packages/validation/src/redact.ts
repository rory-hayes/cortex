import { redactLogText } from "@control-plane/logging";
import type { RedactedLogText } from "@control-plane/logging";

export type RedactedValidationOutput = RedactedLogText;

export const redactValidationOutput = (output: string): RedactedValidationOutput =>
  redactLogText(output);
