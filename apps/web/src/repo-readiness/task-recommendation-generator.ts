import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  FindingSchema,
  RepoScanSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScan,
  type RepoScanInventory,
  type RepoScanModuleStatus,
  type TaskRecommendation,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";
import { assertSafeWebBoundPayload } from "../security/payload-guard";
import type {
  BillingPlanLimitAdminOverride,
  BillingPlanLimitService,
} from "../billing/plan-limits";
import type { PersistedFinding, RepoFindingService } from "./findings";
import type { RepoScanService } from "./repo-scans";
import {
  buildTaskRecommendationTemplateCandidate,
  type TaskRecommendationTemplateCandidate,
} from "./task-recommendation-templates";
import type { TaskRecommendationService } from "./task-recommendations";

type PromptMessage = {
  content: string;
  role: "system" | "user";
};

type SafeFindingSummary = Pick<
  Finding,
  | "category"
  | "confidence"
  | "deterministicRuleId"
  | "findingId"
  | "recommendation"
  | "severity"
  | "status"
  | "summary"
  | "title"
> & {
  evidenceSummaries: string[];
};

type SafeModuleStatusSummary = Pick<
  RepoScanModuleStatus,
  "finishedAt" | "id" | "label" | "order" | "required" | "startedAt" | "status" | "summary"
>;

type SafeInventorySummary = Pick<
  RepoScanInventory,
  | "agentInstructionSummary"
  | "backlogQualitySummary"
  | "ciPostureSummary"
  | "ciProviderLabels"
  | "languageSummaries"
  | "packageManagerLabels"
  | "policySummary"
  | "productClaritySummary"
  | "repoHygieneSummary"
  | "validationPostureSummary"
>;

type SafeTemplateRecommendation = TaskRecommendationTemplateCandidate;

export type TaskRecommendationGenerationPromptSafeInput = {
  findingSummaries: SafeFindingSummary[];
  inventorySummary: SafeInventorySummary;
  scanMetadata: {
    createdAt: string;
    moduleStatuses: SafeModuleStatusSummary[];
    repoId: string;
    scanId: string;
    status: RepoScan["status"];
    statusSummary: string;
    taskRecommendationIds: string[];
    updatedAt: string;
    workspaceId: string;
  };
  templateRecommendations: SafeTemplateRecommendation[];
};

export type TaskRecommendationGenerationPrompt = {
  messages: PromptMessage[];
  safeInput: TaskRecommendationGenerationPromptSafeInput;
};

export type TaskRecommendationLlmAdapter = {
  generateRecommendations: (prompt: TaskRecommendationGenerationPrompt) => Promise<unknown>;
};

export type TaskRecommendationGenerationSource = "deterministic_fallback" | "llm" | "none";

export type GenerateAndPersistTaskRecommendationsInput = {
  createRecommendationId?: () => string;
  findingService: Pick<RepoFindingService, "listFindings">;
  llm?: TaskRecommendationLlmAdapter;
  now?: () => Date;
  scanId: string;
  scanService: Pick<RepoScanService, "getRepoScan">;
  taskRecommendationService: Pick<
    TaskRecommendationService,
    "listTaskRecommendations" | "persistTaskRecommendation"
  >;
  usageLimitAdminOverride?: BillingPlanLimitAdminOverride;
  usageLimitService?: Pick<BillingPlanLimitService, "assertUsageAllowed">;
  workspaceId: string;
};

export type GenerateAndPersistTaskRecommendationsResult = {
  generationSource: TaskRecommendationGenerationSource;
  recommendations: TaskRecommendation[];
};

export class TaskRecommendationGenerationContractError extends Error {
  readonly code = "task_recommendation_generation_contract_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskRecommendationGenerationContractError";
  }
}

type TaskRecommendationTextRefinement = {
  acceptanceCriteria?: string[];
  findingId: string;
  objective?: string;
  title?: string;
};

const allowedRefinementKeys: ReadonlySet<string> = new Set([
  "acceptanceCriteria",
  "findingId",
  "objective",
  "title",
] as const);

const allowedOutputKeys: ReadonlySet<string> = new Set(["refinements"] as const);

const terminalModuleStatuses: ReadonlySet<string> = new Set([
  "blocked",
  "failed",
  "passed",
  "skipped",
  "warning",
] as const);

const uniquePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

const toModuleStatusSummary = (moduleStatus: RepoScanModuleStatus): SafeModuleStatusSummary => ({
  finishedAt: moduleStatus.finishedAt,
  id: moduleStatus.id,
  label: moduleStatus.label,
  order: moduleStatus.order,
  required: moduleStatus.required,
  startedAt: moduleStatus.startedAt,
  status: moduleStatus.status,
  summary: moduleStatus.summary,
});

const toInventorySummary = (inventory: RepoScanInventory): SafeInventorySummary => ({
  agentInstructionSummary: inventory.agentInstructionSummary,
  backlogQualitySummary: inventory.backlogQualitySummary,
  ciPostureSummary: inventory.ciPostureSummary,
  ciProviderLabels: [...inventory.ciProviderLabels],
  languageSummaries: inventory.languageSummaries.map((summary) => ({ ...summary })),
  packageManagerLabels: [...inventory.packageManagerLabels],
  policySummary: inventory.policySummary,
  productClaritySummary: inventory.productClaritySummary,
  repoHygieneSummary: inventory.repoHygieneSummary,
  validationPostureSummary: inventory.validationPostureSummary,
});

const toFindingSummary = (finding: Finding): SafeFindingSummary => ({
  category: finding.category,
  confidence: finding.confidence,
  deterministicRuleId: finding.deterministicRuleId,
  evidenceSummaries: finding.evidence.map((evidence) => evidence.summary),
  findingId: finding.findingId,
  recommendation: finding.recommendation,
  severity: finding.severity,
  status: finding.status,
  summary: finding.summary,
  title: finding.title,
});

export const buildTaskRecommendationGenerationPrompt = (input: {
  findings: readonly Finding[];
  scan: RepoScan;
  templateCandidates: readonly TaskRecommendationTemplateCandidate[];
}): TaskRecommendationGenerationPrompt => {
  const scan = RepoScanSchema.parse(input.scan);
  const findings = input.findings.map((finding) => FindingSchema.parse(finding));
  const safeInput: TaskRecommendationGenerationPromptSafeInput = {
    findingSummaries: findings.map(toFindingSummary),
    inventorySummary: toInventorySummary(scan.inventory),
    scanMetadata: {
      createdAt: scan.createdAt,
      moduleStatuses: scan.moduleStatuses.map(toModuleStatusSummary),
      repoId: scan.repoId,
      scanId: scan.scanId,
      status: scan.status,
      statusSummary: scan.statusSummary,
      taskRecommendationIds: [...scan.taskRecommendationIds],
      updatedAt: scan.updatedAt,
      workspaceId: scan.workspaceId,
    },
    templateRecommendations: input.templateCandidates.map((templateCandidate) => ({
      acceptanceCriteria: [...templateCandidate.acceptanceCriteria],
      effort: templateCandidate.effort,
      executionMode: templateCandidate.executionMode,
      findingIds: [...templateCandidate.findingIds],
      objective: templateCandidate.objective,
      riskLevel: templateCandidate.riskLevel,
      suggestedValidation: templateCandidate.suggestedValidation.map((item) => ({ ...item })),
      title: templateCandidate.title,
    })),
  };

  assertSafeWebBoundPayload(safeInput);

  return {
    safeInput,
    messages: [
      {
        role: "system",
        content: [
          "You generate safe task recommendations for an AI engineering control plane.",
          "Use only supplied metadata, finding summaries, and deterministic template recommendations.",
          "Return only JSON with a refinements array.",
          "Each refinement may include only findingId, title, objective, and acceptanceCriteria.",
          "Do not include riskLevel, effort, executionMode, suggestedValidation, identifiers, timestamps, approval status, raw source, diffs, patches, snippets, secrets, local paths, command output, stdout, or stderr.",
          "The deterministic template fields remain authoritative for finding links, risk, effort, execution mode, and suggested validation.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Refine the wording of these deterministic task recommendation templates.",
          "Allowed fields per refinement: findingId, title, objective, and acceptanceCriteria.",
          "Do not change finding linkage, risk, effort, execution mode, or suggested validation.",
          JSON.stringify(safeInput, null, 2),
        ].join("\n\n"),
      },
    ],
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseStringArray = (value: unknown, fieldName: string): string[] => {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) {
    throw new TaskRecommendationGenerationContractError(
      `Task recommendation candidate field "${fieldName}" must be a non-empty string array.`,
    );
  }

  return value.map((item) => item.trim());
};

const parseRefinement = (value: unknown): TaskRecommendationTextRefinement => {
  if (!isRecord(value)) {
    throw new TaskRecommendationGenerationContractError(
      "Task recommendation refinement must be an object.",
    );
  }

  const keys = Object.keys(value);

  if (keys.some((key) => !allowedRefinementKeys.has(key))) {
    throw new TaskRecommendationGenerationContractError(
      "Task recommendation refinement included fields outside the text-only contract.",
    );
  }

  if (!nonEmptyString(value.findingId)) {
    throw new TaskRecommendationGenerationContractError(
      "Task recommendation refinement findingId must be non-empty.",
    );
  }

  if (
    value.title === undefined &&
    value.objective === undefined &&
    value.acceptanceCriteria === undefined
  ) {
    throw new TaskRecommendationGenerationContractError(
      "Task recommendation refinement must include at least one text field.",
    );
  }

  const refinement: TaskRecommendationTextRefinement = {
    findingId: value.findingId.trim(),
  };

  if (value.title !== undefined) {
    if (!nonEmptyString(value.title)) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation refinement title must be non-empty.",
      );
    }

    refinement.title = value.title.trim();
  }

  if (value.objective !== undefined) {
    if (!nonEmptyString(value.objective)) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation refinement objective must be non-empty.",
      );
    }

    refinement.objective = value.objective.trim();
  }

  if (value.acceptanceCriteria !== undefined) {
    refinement.acceptanceCriteria = parseStringArray(
      value.acceptanceCriteria,
      "acceptanceCriteria",
    );
  }

  return refinement;
};

const parseTaskRecommendationGenerationOutput = (
  payload: unknown,
): TaskRecommendationTextRefinement[] => {
  try {
    assertSafeWebBoundPayload(payload);

    if (!isRecord(payload)) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation generation output must be an object.",
      );
    }

    const keys = Object.keys(payload);

    if (keys.some((key) => !allowedOutputKeys.has(key))) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation generation output included fields outside the safe contract.",
      );
    }

    const refinements = payload.refinements;

    if (!Array.isArray(refinements) || refinements.length === 0 || refinements.length > 20) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation generation output must include 1-20 refinements.",
      );
    }

    return refinements.map(parseRefinement);
  } catch (error) {
    if (error instanceof TaskRecommendationGenerationContractError) {
      throw error;
    }

    throw new TaskRecommendationGenerationContractError(
      "Task recommendation generation output failed the safe text refinement contract.",
    );
  }
};

const assertScanScope = (input: { scan: RepoScan; scanId: string; workspaceId: string }): void => {
  if (input.scan.scanId !== input.scanId || input.scan.workspaceId !== input.workspaceId) {
    throw createActionError("validation_error");
  }
};

const assertScanReadyForGeneration = (scan: RepoScan): void => {
  if (scan.status === "failed" || scan.status === "cancelled") {
    throw createActionError("validation_error");
  }

  if (
    scan.moduleStatuses.length === 0 ||
    scan.moduleStatuses.some((moduleStatus) => !terminalModuleStatuses.has(moduleStatus.status))
  ) {
    throw createActionError("validation_error");
  }
};

const assertFindingScope = (input: {
  finding: Finding;
  scan: RepoScan;
  scanId: string;
  workspaceId: string;
}): void => {
  if (
    input.finding.workspaceId !== input.workspaceId ||
    input.finding.repoId !== input.scan.repoId ||
    input.finding.scanId !== input.scanId
  ) {
    throw createActionError("validation_error");
  }
};

const filterEligibleFindings = (input: {
  coveredFindingIds: Set<string>;
  persistedFindings: readonly PersistedFinding[];
  scan: RepoScan;
  scanId: string;
  workspaceId: string;
}): Finding[] =>
  input.persistedFindings.flatMap((persistedFinding) => {
    const finding = FindingSchema.parse(persistedFinding.finding);

    assertFindingScope({
      finding,
      scan: input.scan,
      scanId: input.scanId,
      workspaceId: input.workspaceId,
    });

    if (
      finding.status !== "open" ||
      persistedFinding.taskIds.length > 0 ||
      input.coveredFindingIds.has(finding.findingId)
    ) {
      return [];
    }

    return [finding];
  });

const candidateToRecommendation = (input: {
  candidate: TaskRecommendationTemplateCandidate;
  createRecommendationId: () => string;
  eligibleFindingIds: Set<string>;
  generationSource: Exclude<TaskRecommendationGenerationSource, "none">;
  now: Date;
  scan: RepoScan;
}): TaskRecommendation => {
  const findingIds = uniquePreservingOrder(input.candidate.findingIds);

  if (
    findingIds.length === 0 ||
    findingIds.some((findingId) => !input.eligibleFindingIds.has(findingId))
  ) {
    throw new TaskRecommendationGenerationContractError(
      "Generated task recommendation linked to an unknown or ineligible finding.",
    );
  }

  const timestamp = input.now.toISOString();

  return TaskRecommendationSchema.parse({
    acceptanceCriteria: input.candidate.acceptanceCriteria,
    contractVersion: CONTRACT_VERSION,
    createdAt: timestamp,
    effort: input.candidate.effort,
    executionMode: input.candidate.executionMode,
    findingIds,
    metadata: {
      findingCount: findingIds.length,
      generationSource: input.generationSource,
      sourceLabel: "task_recommendation_generator",
    },
    objective: input.candidate.objective,
    repoId: input.scan.repoId,
    riskLevel: input.candidate.riskLevel,
    scanId: input.scan.scanId,
    status: "open",
    suggestedValidation: input.candidate.suggestedValidation,
    taskRecommendationId: input.createRecommendationId(),
    title: input.candidate.title,
    updatedAt: timestamp,
    workspaceId: input.scan.workspaceId,
  });
};

const buildDeterministicRecommendations = (input: {
  createRecommendationId: () => string;
  templateCandidates: readonly TaskRecommendationTemplateCandidate[];
  now: Date;
  scan: RepoScan;
}): TaskRecommendation[] => {
  const eligibleFindingIds = new Set(
    input.templateCandidates.flatMap((templateCandidate) => templateCandidate.findingIds),
  );

  return input.templateCandidates.map((candidate) =>
    candidateToRecommendation({
      candidate,
      createRecommendationId: input.createRecommendationId,
      eligibleFindingIds,
      generationSource: "deterministic_fallback",
      now: input.now,
      scan: input.scan,
    }),
  );
};

const applyTextRefinements = (input: {
  refinements: readonly TaskRecommendationTextRefinement[];
  templateCandidates: readonly TaskRecommendationTemplateCandidate[];
}): TaskRecommendationTemplateCandidate[] => {
  const templateFindingIds = new Set<string>();

  for (const templateCandidate of input.templateCandidates) {
    if (templateCandidate.findingIds.length !== 1) {
      throw new TaskRecommendationGenerationContractError(
        "Text refinements currently require single-finding templates.",
      );
    }

    const findingId = templateCandidate.findingIds[0];

    if (findingId === undefined || templateFindingIds.has(findingId)) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation templates must have unique single finding IDs.",
      );
    }

    templateFindingIds.add(findingId);
  }

  const refinementsByFindingId = new Map<string, TaskRecommendationTextRefinement>();

  for (const refinement of input.refinements) {
    if (
      !templateFindingIds.has(refinement.findingId) ||
      refinementsByFindingId.has(refinement.findingId)
    ) {
      throw new TaskRecommendationGenerationContractError(
        "Task recommendation refinements must reference unique eligible finding IDs.",
      );
    }

    refinementsByFindingId.set(refinement.findingId, refinement);
  }

  return input.templateCandidates.map((templateCandidate) => {
    const findingId = templateCandidate.findingIds[0] as string;
    const refinement = refinementsByFindingId.get(findingId);

    if (refinement === undefined) {
      return templateCandidate;
    }

    refinementsByFindingId.delete(findingId);

    return {
      ...templateCandidate,
      ...(refinement.acceptanceCriteria === undefined
        ? {}
        : { acceptanceCriteria: refinement.acceptanceCriteria }),
      ...(refinement.objective === undefined ? {} : { objective: refinement.objective }),
      ...(refinement.title === undefined ? {} : { title: refinement.title }),
    };
  });
};

const maybeGenerateLlmRecommendations = async (input: {
  createRecommendationId: () => string;
  eligibleFindings: readonly Finding[];
  llm?: TaskRecommendationLlmAdapter;
  now: Date;
  scan: RepoScan;
}): Promise<{
  generationSource: Exclude<TaskRecommendationGenerationSource, "none">;
  recommendations: TaskRecommendation[];
}> => {
  const templateCandidates = input.eligibleFindings.map(buildTaskRecommendationTemplateCandidate);

  if (input.llm === undefined) {
    return {
      generationSource: "deterministic_fallback",
      recommendations: buildDeterministicRecommendations({
        createRecommendationId: input.createRecommendationId,
        now: input.now,
        scan: input.scan,
        templateCandidates,
      }),
    };
  }

  try {
    const eligibleFindingIds = new Set(
      templateCandidates.flatMap((templateCandidate) => templateCandidate.findingIds),
    );
    const prompt = buildTaskRecommendationGenerationPrompt({
      findings: input.eligibleFindings,
      scan: input.scan,
      templateCandidates,
    });
    const refinements = parseTaskRecommendationGenerationOutput(
      await input.llm.generateRecommendations(prompt),
    );
    const candidates = applyTextRefinements({
      refinements,
      templateCandidates,
    });

    return {
      generationSource: "llm",
      recommendations: candidates.map((candidate) =>
        candidateToRecommendation({
          candidate,
          createRecommendationId: input.createRecommendationId,
          eligibleFindingIds,
          generationSource: "llm",
          now: input.now,
          scan: input.scan,
        }),
      ),
    };
  } catch {
    return {
      generationSource: "deterministic_fallback",
      recommendations: buildDeterministicRecommendations({
        createRecommendationId: input.createRecommendationId,
        now: input.now,
        scan: input.scan,
        templateCandidates,
      }),
    };
  }
};

const persistRecommendations = async (input: {
  recommendations: readonly TaskRecommendation[];
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
}): Promise<TaskRecommendation[]> => {
  const persistedRecommendations: TaskRecommendation[] = [];

  for (const recommendation of input.recommendations) {
    const persistedRecommendation = await input.taskRecommendationService.persistTaskRecommendation(
      {
        recommendation,
        repoId: recommendation.repoId,
        scanId: recommendation.scanId,
        workspaceId: recommendation.workspaceId,
      },
    );

    persistedRecommendations.push(persistedRecommendation.recommendation);
  }

  return persistedRecommendations;
};

export const generateAndPersistTaskRecommendations = async (
  input: GenerateAndPersistTaskRecommendationsInput,
): Promise<GenerateAndPersistTaskRecommendationsResult> => {
  const createRecommendationId = input.createRecommendationId ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const scan = await input.scanService.getRepoScan({
    scanId: input.scanId,
    workspaceId: input.workspaceId,
  });

  if (scan === null) {
    throw createActionError("validation_error");
  }

  assertScanScope({
    scan,
    scanId: input.scanId,
    workspaceId: input.workspaceId,
  });
  assertScanReadyForGeneration(scan);

  const existingRecommendations = await input.taskRecommendationService.listTaskRecommendations({
    repoId: scan.repoId,
    scanId: scan.scanId,
    workspaceId: scan.workspaceId,
  });
  const coveredFindingIds = new Set(
    existingRecommendations.flatMap((recommendation) => recommendation.recommendation.findingIds),
  );
  const persistedFindings = await input.findingService.listFindings({
    repoId: scan.repoId,
    scanId: scan.scanId,
    workspaceId: scan.workspaceId,
  });
  const eligibleFindings = filterEligibleFindings({
    coveredFindingIds,
    persistedFindings,
    scan,
    scanId: scan.scanId,
    workspaceId: scan.workspaceId,
  });

  if (eligibleFindings.length === 0) {
    return {
      generationSource: "none",
      recommendations: [],
    };
  }

  await input.usageLimitService?.assertUsageAllowed({
    quantity: eligibleFindings.length,
    usageEventType: "task_recommendation_generation",
    workspaceId: scan.workspaceId,
    ...(input.usageLimitAdminOverride === undefined
      ? {}
      : { adminOverride: input.usageLimitAdminOverride }),
  });

  const generated = await maybeGenerateLlmRecommendations({
    createRecommendationId,
    eligibleFindings,
    ...(input.llm === undefined ? {} : { llm: input.llm }),
    now: now(),
    scan,
  });
  const recommendations = await persistRecommendations({
    recommendations: generated.recommendations,
    taskRecommendationService: input.taskRecommendationService,
  });

  return {
    generationSource: generated.generationSource,
    recommendations,
  };
};
