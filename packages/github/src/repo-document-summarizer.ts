import {
  REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS,
  RepoScanDocumentSummarySchema,
  type RepoScanDocumentSummary,
  type RepoScanDocumentSummaryKind,
  type RepoScanDocumentSummaryTopicLabel,
} from "@control-plane/shared";

import {
  classifyRepoScanFileRead,
  type RepoScanFileReadAllowReason,
} from "./repo-scan-file-allowlist.js";

export type SummarizeAllowlistedDocumentInput = {
  allowReason: RepoScanFileReadAllowReason;
  maxFileReadBytes: number;
  path: string;
  size: number | null;
  text: string;
};

const DOCUMENT_KIND_LABELS: Record<RepoScanDocumentSummaryKind, string> = {
  agent_instructions: "Agent instructions",
  code_of_conduct: "Code of conduct",
  contributing: "Contributing",
  mvp_plan: "MVP plan",
  product: "Product",
  product_spec: "Product spec",
  readme: "README",
  security: "Security",
};

const TOPIC_LABEL_TEXT: Record<RepoScanDocumentSummaryTopicLabel, string> = {
  agent_rules: "agent rules",
  architecture: "architecture",
  backlog: "backlog",
  execution_flow: "execution flow",
  product_scope: "product scope",
  security: "security",
  setup: "setup",
  validation: "validation",
  workflow: "workflow",
};

const TOPIC_PATTERNS: Record<RepoScanDocumentSummaryTopicLabel, RegExp> = {
  agent_rules: /\b(?:agent|agents|approval|codex|instruction|instructions|runner)\b/iu,
  architecture: /\b(?:architecture|boundary|component|coordinator|package|runner|system)\b/iu,
  backlog: /\b(?:backlog|milestone|sprint|task|tasks)\b/iu,
  execution_flow:
    /\b(?:commit|dry[-\s]?run|execute|execution|merge|pull request|push|worktree)\b/iu,
  product_scope:
    /\b(?:audience|customer|goal|mvp|non[-\s]?goal|problem|product|purpose|scope|target user|user)\b/iu,
  security:
    /\b(?:boundary|credential|diff|env|patch|permission|private key|secret|security|trust)\b/iu,
  setup: /\b(?:configure|connect|getting started|install|onboarding|prerequisite|setup)\b/iu,
  validation: /\b(?:build|ci|format|lint|test|tests|typecheck|validation|verification|verify)\b/iu,
  workflow: /\b(?:approve|flow|process|queue|review|scan|status|workflow)\b/iu,
};

const fencedCodeBlockPattern = /```[\s\S]*?```/gu;
const inlineCodePattern = /`[^`\n]+`/gu;
const markdownLinkPattern = /\[([^\]\n]{1,120})\]\([^)]+?\)/gu;
const markdownMarkerPattern = /[#*>~|[\]()]/gu;

const secretRedactionPatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/giu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/giu,
  /(?:^|[\s;"',])(?:export\s+)?[A-Za-z_][A-Za-z0-9_-]*(?:password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|token|secret)[A-Za-z0-9_-]*\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/giu,
  /\bprocess\.env\.[A-Za-z0-9_]*(?:password|passwd|api_?key|apikey|access_?token|auth_?token|refresh_?token|id_?token|client_?secret|private_?key|token|secret)[A-Za-z0-9_]*\b/giu,
  /\$[A-Za-z0-9_]*(?:PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|REFRESH_?TOKEN|ID_?TOKEN|CLIENT_?SECRET|PRIVATE_?KEY|TOKEN|SECRET)[A-Za-z0-9_]*\b/gu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/gu,
  /\blin_api_[A-Za-z0-9_]{12,}\b/gu,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
] as const;

const normalizeBasename = (path: string): string => path.split("/").at(-1) ?? "";

const stripKnownExtension = (basename: string): string =>
  basename.replace(/\.(?:markdown|md|txt)$/iu, "").toLowerCase();

const documentKindForPath = (
  path: string,
  allowReason: RepoScanFileReadAllowReason,
): RepoScanDocumentSummaryKind | null => {
  if (allowReason === "agent_instructions") {
    return "agent_instructions";
  }

  const name = stripKnownExtension(normalizeBasename(path));

  switch (name) {
    case "code_of_conduct":
      return "code_of_conduct";
    case "contributing":
      return "contributing";
    case "mvp_plan":
      return "mvp_plan";
    case "product":
      return "product";
    case "product_spec":
      return "product_spec";
    case "readme":
      return "readme";
    case "security":
      return "security";
    default:
      return null;
  }
};

const stripMarkdown = (text: string): string =>
  text
    .replace(fencedCodeBlockPattern, " ")
    .replace(inlineCodePattern, " ")
    .replace(markdownLinkPattern, "$1")
    .replace(markdownMarkerPattern, " ")
    .replace(/\s+/gu, " ")
    .trim();

const redactDocumentText = (text: string): { redactionApplied: boolean; text: string } => {
  let redacted = text;

  for (const pattern of secretRedactionPatterns) {
    redacted = redacted.replace(pattern, " ");
  }

  return {
    redactionApplied: redacted !== text,
    text: redacted,
  };
};

const detectTopicLabels = (text: string): RepoScanDocumentSummaryTopicLabel[] =>
  REPO_SCAN_DOCUMENT_SUMMARY_TOPIC_LABELS.filter((label) => TOPIC_PATTERNS[label].test(text));

const joinTopicText = (topicLabels: readonly RepoScanDocumentSummaryTopicLabel[]): string => {
  const labels = topicLabels.map((label) => TOPIC_LABEL_TEXT[label]);

  if (labels.length === 0) {
    return "bounded documentation";
  }

  if (labels.length === 1) {
    return labels[0] ?? "bounded documentation";
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
};

const composeSummary = (
  kind: RepoScanDocumentSummaryKind,
  topicLabels: readonly RepoScanDocumentSummaryTopicLabel[],
): string =>
  `${DOCUMENT_KIND_LABELS[kind]} indicates ${joinTopicText(topicLabels)} context for readiness review.`;

export const summarizeAllowlistedDocument = (
  input: SummarizeAllowlistedDocumentInput,
): RepoScanDocumentSummary | null => {
  const fileReadDecision = classifyRepoScanFileRead({
    maxFileReadBytes: input.maxFileReadBytes,
    path: input.path,
    size: input.size,
  });

  if (
    fileReadDecision.action !== "read" ||
    fileReadDecision.reason !== input.allowReason ||
    !["agent_instructions", "documentation"].includes(input.allowReason)
  ) {
    return null;
  }

  const kind = documentKindForPath(input.path, input.allowReason);

  if (kind === null) {
    return null;
  }

  const redactedInputText = redactDocumentText(input.text);
  const strippedText = stripMarkdown(redactedInputText.text);
  const redactedAnalysisText = redactDocumentText(strippedText);
  const topicLabels = detectTopicLabels(redactedAnalysisText.text);
  const summary = RepoScanDocumentSummarySchema.parse({
    documentByteCount: input.size,
    inputCharacterCount: input.text.length,
    kind,
    label: DOCUMENT_KIND_LABELS[kind],
    redactedCharacterCount: redactedAnalysisText.text.length,
    redactionApplied: redactedInputText.redactionApplied || redactedAnalysisText.redactionApplied,
    summary: composeSummary(kind, topicLabels),
    topicLabels,
  });

  return summary;
};
