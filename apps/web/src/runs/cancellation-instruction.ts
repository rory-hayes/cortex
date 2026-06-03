import { redactLogText } from "@control-plane/logging";
import {
  CancellationRequestSchema,
  CONTRACT_VERSION,
  type CancellationRequest,
} from "@control-plane/shared";

export type CancellationInstructionRow = {
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  cancellationRequestedByActorId: string | null;
  runId: string;
};

const FALLBACK_CANCELLATION_REASON = "Cancellation requested.";
const MAX_DELIVERED_CANCELLATION_REASON_LENGTH = 500;

const unsafeCancellationReasonPatterns = [
  /```[\s\S]*?```/,
  /\bdiff --git\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /^\s*(?:---|\+\+\+) [ab]\//m,
  /^\s*[+-]\s*(?:class|const|export|function|import|let|return|var)\b/m,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /\b(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/,
  /\b(?:try|else|finally)\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;?\s*$/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m,
  /^\s*[A-Za-z_$][\w$.[\]'"]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*[^;\n]+;\s*$/m,
  /^\s*(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b[\s\S]*;\s*$/im,
  /^\s*(?:git\s+(?:add|branch|checkout|clean|commit|diff|log|merge|pull|push|rebase|reset|show|status|switch|worktree)|(?:pnpm|npm|yarn)\s+(?:add|build|ci|exec|install|lint|run|test|typecheck)|(?:node|python3?|bash|sh|docker|kubectl)\s+\S+|rm\s+-[A-Za-z]+|curl\s+https?:\/\/|wget\s+https?:\/\/).*/im,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bprocess\.env\.[A-Z0-9_]+\b/i,
  /\breturn\s+[^;\n]+;/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s,;]{8,}/i,
] as const;

const sanitizeCancellationReasonForDelivery = (reason: string | null): string => {
  const normalizedReason = reason?.trim() ?? "";
  const redactedReason = redactLogText(normalizedReason).text.trim();

  if (
    redactedReason.length === 0 ||
    redactedReason.length > MAX_DELIVERED_CANCELLATION_REASON_LENGTH ||
    unsafeCancellationReasonPatterns.some((pattern) => pattern.test(redactedReason))
  ) {
    return FALLBACK_CANCELLATION_REASON;
  }

  return redactedReason;
};

export const toCancellationInstruction = (
  row: CancellationInstructionRow | null,
): CancellationRequest | undefined => {
  if (
    row === null ||
    row.cancellationRequestedAt === null ||
    row.cancellationRequestedByActorId === null
  ) {
    return undefined;
  }

  const parsedInstruction = CancellationRequestSchema.safeParse({
    contractVersion: CONTRACT_VERSION,
    reason: sanitizeCancellationReasonForDelivery(row.cancellationReason),
    requestedAt: row.cancellationRequestedAt.toISOString(),
    requestedByActorId: row.cancellationRequestedByActorId,
    runId: row.runId,
  });

  return parsedInstruction.success ? parsedInstruction.data : undefined;
};
