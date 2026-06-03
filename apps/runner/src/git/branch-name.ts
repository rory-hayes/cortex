import { createHash } from "node:crypto";

import type { TaskPacket } from "@control-plane/shared";

export const BRANCH_NAME_PREFIX = "aicp";

export type BranchNameTaskPacketInput = Pick<
  TaskPacket,
  "contractVersion" | "id" | "repositoryId" | "runId"
>;

const HASH_SUFFIX_LENGTH = 12;
const MAX_BRANCH_NAME_LENGTH = 120;
const MAX_VISIBLE_SEGMENT_LENGTH = 64;

export const createTaskBranchName = (task: BranchNameTaskPacketInput): string => {
  const taskSegment = sanitizeBranchNameSegment(task.id, "task");
  const runSegment = sanitizeBranchNameSegment(task.runId, "run");
  const suffix = createHash("sha256")
    .update([task.contractVersion, task.repositoryId, task.id, task.runId].join("\0"))
    .digest("hex")
    .slice(0, HASH_SUFFIX_LENGTH);

  const branchName = `${BRANCH_NAME_PREFIX}/${taskSegment}-${runSegment}-${suffix}`;

  if (branchName.length <= MAX_BRANCH_NAME_LENGTH) {
    return branchName;
  }

  const visibleBudget =
    MAX_BRANCH_NAME_LENGTH - BRANCH_NAME_PREFIX.length - 1 - HASH_SUFFIX_LENGTH - 2;
  const perSegmentBudget = Math.max(1, Math.floor(visibleBudget / 2));

  return `${BRANCH_NAME_PREFIX}/${truncateSegment(taskSegment, perSegmentBudget)}-${truncateSegment(
    runSegment,
    visibleBudget - perSegmentBudget,
  )}-${suffix}`;
};

export const sanitizeBranchNameSegment = (value: string, fallback: string): string => {
  const fallbackSegment = sanitizePlainSegment(fallback) || "segment";

  if (typeof value !== "string" || value.trim().length === 0 || hasSecretLikeText(value)) {
    return fallbackSegment;
  }

  return sanitizePlainSegment(value) || fallbackSegment;
};

export const isSafeBranchName = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 512 &&
  value.trim() === value &&
  value !== "@" &&
  !value.startsWith("-") &&
  !value.startsWith("/") &&
  !value.endsWith("/") &&
  !value.includes("//") &&
  !value.includes("@{") &&
  !value.includes("..") &&
  !/[?*{}[\]\\~^:\s]/u.test(value) &&
  !hasControlCharacters(value) &&
  !hasUnsafeText(value) &&
  value.split("/").every(isSafeBranchNameSegment);

const sanitizePlainSegment = (value: string): string =>
  truncateSegment(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "")
      .replace(/(?:-lock)+$/u, ""),
    MAX_VISIBLE_SEGMENT_LENGTH,
  );

const truncateSegment = (value: string, maxLength: number): string =>
  value.slice(0, maxLength).replace(/-+$/u, "");

const isSafeBranchNameSegment = (segment: string): boolean =>
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !segment.startsWith(".") &&
  !segment.endsWith(".") &&
  !segment.endsWith(".lock") &&
  /^[A-Za-z0-9._@+=,%-]+$/u.test(segment);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

const hasUnsafeText = (value: string): boolean =>
  hasSecretLikeText(value) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/u.test(value) ||
  /(?:=>|[{};])/u.test(value);

const hasSecretLikeText = (value: string): boolean =>
  /\[(?:redacted|REDACTED)[^\]]*\]/u.test(value) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/iu.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/u.test(value) ||
  /\bsk-[A-Za-z0-9_-]{8,}\b/u.test(value) ||
  hasCredentialAssignment(value);

const hasCredentialAssignment = (value: string): boolean =>
  /(?:^|[/_.-])(?:api[-_]?key|token|secret|secrets|password|passwd|private[-_]?key)=[A-Za-z0-9._@+=,%-]+(?:$|[/_.-])/iu.test(
    value,
  );
