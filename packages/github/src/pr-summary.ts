import { RiskFindingSchema, TaskPacketSchema, ValidationResultSchema } from "@control-plane/shared";
import type { RiskFinding, TaskPacket, ValidationResult } from "@control-plane/shared";
import { z } from "zod";

const INVALID_PR_SUMMARY_INPUT_MESSAGE = "Invalid PR summary input.";
const INVALID_CHANGED_FILE_PATH_MESSAGE = "Invalid changed file path.";
const OMITTED_UNSAFE_TASK_PROSE = "[omitted: unsafe task prose]";

const ChangedFilePathSchema = z.string().superRefine((path, context) => {
  if (!isSafeRelativePath(path)) {
    context.addIssue({
      code: "custom",
      message: INVALID_CHANGED_FILE_PATH_MESSAGE,
    });
  }
});

const RenderPrSummaryInputSchema = z
  .object({
    task: TaskPacketSchema,
    changedFilePaths: z.array(ChangedFilePathSchema),
    validationResults: z.array(ValidationResultSchema),
    riskFindings: z.array(RiskFindingSchema),
  })
  .strict()
  .superRefine((input, context) => {
    input.riskFindings.forEach((finding, findingIndex) => {
      finding.paths.forEach((path, pathIndex) => {
        if (!isSafeRelativePath(path)) {
          context.addIssue({
            code: "custom",
            message: INVALID_PR_SUMMARY_INPUT_MESSAGE,
            path: ["riskFindings", findingIndex, "paths", pathIndex],
          });
        }
      });
    });
  });

export type RenderPrSummaryInput = {
  task: TaskPacket;
  changedFilePaths: string[];
  validationResults: ValidationResult[];
  riskFindings: RiskFinding[];
};

type ParsedRenderPrSummaryInput = z.infer<typeof RenderPrSummaryInputSchema>;

export function renderPrSummary(input: RenderPrSummaryInput): string {
  const parsedInput = parseRenderPrSummaryInput(input);

  const lines = [
    "# Pull Request Summary",
    "",
    "## Task",
    `- Task ID: ${escapeMarkdownText(parsedInput.task.id)}`,
    `- Source: ${escapeMarkdownText(parsedInput.task.source.type)} / ${renderTaskProse(
      parsedInput.task.source.title,
    )}`,
    `- Objective: ${renderTaskProse(parsedInput.task.objective)}`,
    "",
    "### Acceptance Criteria",
    ...renderAcceptanceCriteria(parsedInput.task.acceptanceCriteria),
    "",
    "## Changed Files",
    ...renderChangedFiles(parsedInput.changedFilePaths),
    "",
    "## Validation",
    ...renderValidationResults(parsedInput.validationResults),
    "",
    "## Risk Flags",
    ...renderRiskFindings(parsedInput.riskFindings),
  ];

  return `${lines.join("\n")}\n`;
}

function parseRenderPrSummaryInput(input: unknown): ParsedRenderPrSummaryInput {
  const result = RenderPrSummaryInputSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const hasChangedPathIssue = result.error.issues.some(
    (issue) => issue.path[0] === "changedFilePaths",
  );

  throw new Error(
    hasChangedPathIssue ? INVALID_CHANGED_FILE_PATH_MESSAGE : INVALID_PR_SUMMARY_INPUT_MESSAGE,
  );
}

function renderAcceptanceCriteria(criteria: string[]): string[] {
  if (criteria.length === 0) {
    return ["- None reported."];
  }

  return criteria.map((criterion) => `- ${renderTaskProse(criterion)}`);
}

function renderTaskProse(value: string): string {
  if (looksUnsafeForTaskProse(value)) {
    return OMITTED_UNSAFE_TASK_PROSE;
  }

  return escapeMarkdownText(value);
}

function renderChangedFiles(changedFilePaths: string[]): string[] {
  const paths = uniqueSorted(changedFilePaths);

  if (paths.length === 0) {
    return ["No changed files reported."];
  }

  return paths.map((path) => `- ${formatPath(path)}`);
}

function renderValidationResults(validationResults: ValidationResult[]): string[] {
  if (validationResults.length === 0) {
    return ["No validation results reported."];
  }

  return [
    "| Command | Status | Exit Code | Duration | Redaction Applied |",
    "| --- | --- | --- | --- | --- |",
    ...validationResults
      .toSorted((left, right) => left.commandLabel.localeCompare(right.commandLabel))
      .map(
        (result) =>
          `| ${escapeTableCell(result.commandLabel)} | ${escapeTableCell(
            result.status,
          )} | ${formatExitCode(result.exitCode)} | ${result.durationMs}ms | ${
            result.redactionApplied ? "yes" : "no"
          } |`,
      ),
  ];
}

function renderRiskFindings(riskFindings: RiskFinding[]): string[] {
  if (riskFindings.length === 0) {
    return ["No risk flags reported."];
  }

  return [
    "| Severity | Category | Message | Paths |",
    "| --- | --- | --- | --- |",
    ...riskFindings
      .toSorted((left, right) => {
        const severityOrder = riskSeverityOrder(left.severity) - riskSeverityOrder(right.severity);

        if (severityOrder !== 0) {
          return severityOrder;
        }

        const categoryOrder = left.category.localeCompare(right.category);

        if (categoryOrder !== 0) {
          return categoryOrder;
        }

        return left.id.localeCompare(right.id);
      })
      .map(
        (finding) =>
          `| ${escapeTableCell(finding.severity)} | ${escapeTableCell(
            finding.category,
          )} | ${escapeTableCell(finding.message)} | ${formatPathList(finding.paths)} |`,
      ),
  ];
}

function riskSeverityOrder(severity: RiskFinding["severity"]): number {
  return severity === "blocked" ? 0 : 1;
}

function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? "n/a" : String(exitCode);
}

function formatPathList(paths: string[]): string {
  const safePaths = uniqueSorted(paths);

  if (safePaths.length === 0) {
    return "none";
  }

  return safePaths.map(formatPath).join(", ");
}

function formatPath(path: string): string {
  return `\`${path}\``;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

function escapeTableCell(value: string): string {
  return escapeMarkdownText(value).replaceAll("|", "\\|");
}

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|");
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 512) {
    return false;
  }

  if (hasControlCharacter(path)) {
    return false;
  }

  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path)) {
    return false;
  }

  if (path.includes("\\") || path.includes("`") || path.includes("|")) {
    return false;
  }

  const segments = path.split("/");

  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const characterCode = character.charCodeAt(0);

    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
}

function looksUnsafeForTaskProse(value: string): boolean {
  return (
    looksSecretLike(value) || SOURCE_LIKE_TASK_PROSE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function looksSecretLike(value: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/iu.test(value) ||
    /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]/iu.test(
      value,
    ) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(value) ||
    /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u.test(value) ||
    /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/u.test(value) ||
    /\blin_api_[A-Za-z0-9_]{12,}\b/u.test(value) ||
    /\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value) ||
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u.test(value) ||
    /\bya29\.[A-Za-z0-9_-]{20,}\b/u.test(value) ||
    /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/u.test(value) ||
    /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu.test(value)
  );
}

const SOURCE_LIKE_TASK_PROSE_PATTERNS = [
  /(^|\n)diff --git\b/iu,
  /(^|\n)\*\*\* Begin Patch\b/iu,
  /(^|\n)@@\s+-\d/iu,
  /(^|\n)---\s+a\//iu,
  /(^|\n)\+\+\+\s+b\//iu,
  /(^|\n)```/u,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,160}[;{}=()]/u,
  /\b(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,120}[;{}=()]/u,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/u,
  /(^|\n)\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)\n]*\)\s*;?\s*(?=\n|$)/u,
  /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)\n]*\)/u,
];
