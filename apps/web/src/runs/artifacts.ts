import "server-only";

import {
  DryRunResultSchema,
  PrArtifactSchema,
  SubmitDryRunResultRequestSchema,
  SubmitPrArtifactRequestSchema,
  SubmitValidationResultRequestSchema,
  ValidationResultSchema,
  type DryRunResult,
  type PrArtifact,
  type SubmitDryRunResultRequest,
  type SubmitPrArtifactRequest,
  type SubmitValidationResultRequest,
  type ValidationResult,
} from "@control-plane/shared";

import { and, eq, schema, sql, type Database } from "../db";
import type { AuthenticatedRunnerContext } from "../runner-auth";
import {
  hasUnsafePayloadPathText as hasUnsafePathText,
  hasUnsafeWebBoundPayload,
} from "../security/payload-guard";

export type PersistDryRunResultInput = {
  result: DryRunResult;
  resultCreatedAt: Date;
  runId: string;
  runnerId: string;
  submittedAt: Date;
  workspaceId: string;
};

export type PersistDryRunResultResult =
  | {
      inserted: boolean;
      result: DryRunResult;
      status: "stored";
    }
  | {
      status: "artifact_conflict" | "run_not_found" | "runner_conflict";
    };

export type PersistValidationResultInput = {
  result: ValidationResult;
  runId: string;
  runnerId: string;
  submittedAt: Date;
  workspaceId: string;
};

export type PersistValidationResultResult =
  | {
      inserted: boolean;
      result: ValidationResult;
      status: "stored";
    }
  | {
      status: "artifact_conflict" | "run_not_found" | "runner_conflict";
    };

export type PersistPrArtifactInput = {
  artifact: PrArtifact;
  runId: string;
  runnerId: string;
  submittedAt: Date;
  workspaceId: string;
};

export type PersistPrArtifactResult =
  | {
      artifact: PrArtifact;
      inserted: boolean;
      status: "stored";
    }
  | {
      status: "artifact_conflict" | "run_not_found" | "runner_conflict";
    };

export type RunArtifactSubmissionStore = {
  persistDryRunResult: (input: PersistDryRunResultInput) => Promise<PersistDryRunResultResult>;
  persistPrArtifact: (input: PersistPrArtifactInput) => Promise<PersistPrArtifactResult>;
  persistValidationResult: (
    input: PersistValidationResultInput,
  ) => Promise<PersistValidationResultResult>;
};

export type SubmitArtifactInput = {
  context: AuthenticatedRunnerContext;
  request: unknown;
};

export type RunArtifactSubmissionService = {
  submitDryRunResult: (input: SubmitArtifactInput) => Promise<DryRunResult>;
  submitPrArtifact: (input: SubmitArtifactInput) => Promise<PrArtifact>;
  submitValidationResult: (input: SubmitArtifactInput) => Promise<ValidationResult>;
};

export class SubmitRunArtifactRequestError extends Error {
  readonly code = "invalid_run_artifact_submission" as const;

  constructor() {
    super("Invalid run artifact submission.");
    this.name = "SubmitRunArtifactRequestError";
  }
}

export class RunArtifactSubmissionError extends SubmitRunArtifactRequestError {
  constructor() {
    super();
    this.name = "RunArtifactSubmissionError";
  }
}

export const isRunArtifactSubmissionRequestError = (
  error: unknown,
): error is SubmitRunArtifactRequestError => error instanceof SubmitRunArtifactRequestError;

const createRunArtifactSubmissionError = (): RunArtifactSubmissionError =>
  new RunArtifactSubmissionError();

const strictIsoTimestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;

const parseStrictIsoTimestamp = (value: string): Date => {
  const timestampMatch = strictIsoTimestampPattern.exec(value);

  if (timestampMatch === null) {
    throw createRunArtifactSubmissionError();
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw createRunArtifactSubmissionError();
  }

  const [, year, month, day, hour, minute, second, millisecond = "000"] = timestampMatch;

  if (
    timestamp.getUTCFullYear() !== Number(year) ||
    timestamp.getUTCMonth() + 1 !== Number(month) ||
    timestamp.getUTCDate() !== Number(day) ||
    timestamp.getUTCHours() !== Number(hour) ||
    timestamp.getUTCMinutes() !== Number(minute) ||
    timestamp.getUTCSeconds() !== Number(second) ||
    timestamp.getUTCMilliseconds() !== Number(millisecond)
  ) {
    throw createRunArtifactSubmissionError();
  }

  return timestamp;
};

const assertSafeArtifactValues = (values: unknown[], inspectKeys = false): void => {
  if (values.some((value) => hasUnsafeWebBoundPayload(value, { inspectKeys }))) {
    throw createRunArtifactSubmissionError();
  }
};

const assertSafePathValues = (paths: string[]): void => {
  if (paths.some((path) => hasUnsafePathText(path))) {
    throw createRunArtifactSubmissionError();
  }
};

const assertSafeRiskFindings = (
  findings: Array<Pick<DryRunResult["warnings"][number], "id" | "message" | "paths">>,
): void => {
  for (const finding of findings) {
    assertSafeArtifactValues([finding.id, finding.message]);
    assertSafePathValues(finding.paths);
  }
};

const parseDryRunRequest = (
  request: unknown,
  context: AuthenticatedRunnerContext,
): {
  request: SubmitDryRunResultRequest;
  resultCreatedAt: Date;
  submittedAt: Date;
} => {
  const parsedRequest = SubmitDryRunResultRequestSchema.safeParse(request);

  if (!parsedRequest.success || parsedRequest.data.runnerId !== context.runnerId) {
    throw createRunArtifactSubmissionError();
  }

  if (
    parsedRequest.data.result.capabilities.runnerId !== undefined &&
    parsedRequest.data.result.capabilities.runnerId !== context.runnerId
  ) {
    throw createRunArtifactSubmissionError();
  }

  const resultCreatedAt = parseStrictIsoTimestamp(parsedRequest.data.result.createdAt);
  const submittedAt = parseStrictIsoTimestamp(parsedRequest.data.submittedAt);
  parseStrictIsoTimestamp(parsedRequest.data.result.capabilities.reportedAt);
  assertSafeArtifactValues([
    parsedRequest.data.result.id,
    parsedRequest.data.result.status,
    parsedRequest.data.result.capabilities,
  ]);
  assertSafeArtifactValues(parsedRequest.data.result.checks, true);
  assertSafeRiskFindings(parsedRequest.data.result.blockers);
  assertSafeRiskFindings(parsedRequest.data.result.warnings);

  return {
    request: parsedRequest.data,
    resultCreatedAt,
    submittedAt,
  };
};

const parseValidationRequest = (
  request: unknown,
  context: AuthenticatedRunnerContext,
): {
  request: SubmitValidationResultRequest;
  submittedAt: Date;
} => {
  const parsedRequest = SubmitValidationResultRequestSchema.safeParse(request);

  if (!parsedRequest.success || parsedRequest.data.runnerId !== context.runnerId) {
    throw createRunArtifactSubmissionError();
  }

  if (!parsedRequest.data.result.redactionApplied) {
    throw createRunArtifactSubmissionError();
  }

  parseStrictIsoTimestamp(parsedRequest.data.result.startedAt);
  parseStrictIsoTimestamp(parsedRequest.data.result.finishedAt);
  const submittedAt = parseStrictIsoTimestamp(parsedRequest.data.submittedAt);
  assertSafeArtifactValues([
    parsedRequest.data.result.id,
    parsedRequest.data.result.commandId,
    parsedRequest.data.result.commandLabel,
    parsedRequest.data.result.command,
    parsedRequest.data.result.stdoutSummary,
    parsedRequest.data.result.stderrSummary,
  ]);

  return {
    request: parsedRequest.data,
    submittedAt,
  };
};

const parsePrArtifactRequest = (
  request: unknown,
  context: AuthenticatedRunnerContext,
): {
  request: SubmitPrArtifactRequest;
  submittedAt: Date;
} => {
  const parsedRequest = SubmitPrArtifactRequestSchema.safeParse(request);

  if (!parsedRequest.success || parsedRequest.data.runnerId !== context.runnerId) {
    throw createRunArtifactSubmissionError();
  }

  parseStrictIsoTimestamp(parsedRequest.data.artifact.createdAt);
  const submittedAt = parseStrictIsoTimestamp(parsedRequest.data.submittedAt);
  assertSafeArtifactValues([
    parsedRequest.data.artifact.id,
    parsedRequest.data.artifact.repository.owner,
    parsedRequest.data.artifact.repository.name,
    parsedRequest.data.artifact.branchName,
    parsedRequest.data.artifact.prUrl,
    parsedRequest.data.artifact.prTitle,
  ]);
  assertSafePathValues(parsedRequest.data.artifact.changedFilePaths);
  assertSafeRiskFindings(parsedRequest.data.artifact.riskFindings);

  return {
    request: parsedRequest.data,
    submittedAt,
  };
};

export const createRunArtifactSubmissionService = (input: {
  store: RunArtifactSubmissionStore;
}): RunArtifactSubmissionService => ({
  submitDryRunResult: async ({ context, request }) => {
    const parsedRequest = parseDryRunRequest(request, context);
    const result = DryRunResultSchema.parse({
      ...parsedRequest.request.result,
      createdAt: parsedRequest.resultCreatedAt.toISOString(),
    });
    const persisted = await input.store.persistDryRunResult({
      result,
      resultCreatedAt: parsedRequest.resultCreatedAt,
      runId: parsedRequest.request.runId,
      runnerId: context.runnerId,
      submittedAt: parsedRequest.submittedAt,
      workspaceId: context.workspaceId,
    });

    if (persisted.status !== "stored") {
      throw createRunArtifactSubmissionError();
    }

    return DryRunResultSchema.parse(persisted.result);
  },
  submitValidationResult: async ({ context, request }) => {
    const parsedRequest = parseValidationRequest(request, context);
    const parsedResult = parsedRequest.request.result;
    const result = ValidationResultSchema.parse({
      ...parsedResult,
      finishedAt: parseStrictIsoTimestamp(parsedResult.finishedAt).toISOString(),
      startedAt: parseStrictIsoTimestamp(parsedResult.startedAt).toISOString(),
    });
    const persisted = await input.store.persistValidationResult({
      result,
      runId: parsedRequest.request.runId,
      runnerId: context.runnerId,
      submittedAt: parsedRequest.submittedAt,
      workspaceId: context.workspaceId,
    });

    if (persisted.status !== "stored") {
      throw createRunArtifactSubmissionError();
    }

    return ValidationResultSchema.parse(persisted.result);
  },
  submitPrArtifact: async ({ context, request }) => {
    const parsedRequest = parsePrArtifactRequest(request, context);
    const artifact = PrArtifactSchema.parse({
      ...parsedRequest.request.artifact,
      createdAt: parseStrictIsoTimestamp(parsedRequest.request.artifact.createdAt).toISOString(),
    });
    const persisted = await input.store.persistPrArtifact({
      artifact,
      runId: parsedRequest.request.runId,
      runnerId: context.runnerId,
      submittedAt: parsedRequest.submittedAt,
      workspaceId: context.workspaceId,
    });

    if (persisted.status !== "stored") {
      throw createRunArtifactSubmissionError();
    }

    return PrArtifactSchema.parse(persisted.artifact);
  },
});

export const createSubmitDryRunResultService = createRunArtifactSubmissionService;
export const createSubmitValidationResultService = createRunArtifactSubmissionService;
export const createSubmitPrArtifactService = createRunArtifactSubmissionService;

const toIsoTimestamp = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Artifact row has an invalid timestamp.");
  }

  return date.toISOString();
};

type DryRunResultRow = typeof schema.dryRunResults.$inferSelect;
type ValidationResultRow = typeof schema.validationResults.$inferSelect;
type PrArtifactRow = typeof schema.prArtifacts.$inferSelect;

const dryRunResultReturningColumns = {
  blockers: schema.dryRunResults.blockers,
  capabilities: schema.dryRunResults.capabilities,
  checks: schema.dryRunResults.checks,
  contractVersion: schema.dryRunResults.contractVersion,
  createdAt: schema.dryRunResults.createdAt,
  id: schema.dryRunResults.id,
  resultCreatedAt: schema.dryRunResults.resultCreatedAt,
  runId: schema.dryRunResults.runId,
  status: schema.dryRunResults.status,
  submittedAt: schema.dryRunResults.submittedAt,
  updatedAt: schema.dryRunResults.updatedAt,
  warnings: schema.dryRunResults.warnings,
  workspaceId: schema.dryRunResults.workspaceId,
} satisfies Record<keyof DryRunResultRow, unknown>;

const validationResultReturningColumns = {
  command: schema.validationResults.command,
  commandId: schema.validationResults.commandId,
  commandLabel: schema.validationResults.commandLabel,
  contractVersion: schema.validationResults.contractVersion,
  createdAt: schema.validationResults.createdAt,
  durationMs: schema.validationResults.durationMs,
  exitCode: schema.validationResults.exitCode,
  finishedAt: schema.validationResults.finishedAt,
  id: schema.validationResults.id,
  redactionApplied: schema.validationResults.redactionApplied,
  runId: schema.validationResults.runId,
  startedAt: schema.validationResults.startedAt,
  status: schema.validationResults.status,
  stderrSummary: schema.validationResults.stderrSummary,
  stdoutSummary: schema.validationResults.stdoutSummary,
  workspaceId: schema.validationResults.workspaceId,
} satisfies Record<keyof ValidationResultRow, unknown>;

const prArtifactReturningColumns = {
  branchName: schema.prArtifacts.branchName,
  changedFilePaths: schema.prArtifacts.changedFilePaths,
  contractVersion: schema.prArtifacts.contractVersion,
  createdAt: schema.prArtifacts.createdAt,
  githubChecksSummary: schema.prArtifacts.githubChecksSummary,
  githubReviewState: schema.prArtifacts.githubReviewState,
  githubSyncedAt: schema.prArtifacts.githubSyncedAt,
  id: schema.prArtifacts.id,
  prNumber: schema.prArtifacts.prNumber,
  prStatus: schema.prArtifacts.prStatus,
  prTitle: schema.prArtifacts.prTitle,
  prUrl: schema.prArtifacts.prUrl,
  repositoryName: schema.prArtifacts.repositoryName,
  repositoryOwner: schema.prArtifacts.repositoryOwner,
  riskFindings: schema.prArtifacts.riskFindings,
  runId: schema.prArtifacts.runId,
  updatedAt: schema.prArtifacts.updatedAt,
  workspaceId: schema.prArtifacts.workspaceId,
} satisfies Record<keyof PrArtifactRow, unknown>;

const toDryRunResult = (row: DryRunResultRow): DryRunResult =>
  DryRunResultSchema.parse({
    blockers: row.blockers,
    capabilities: row.capabilities,
    checks: row.checks,
    contractVersion: row.contractVersion,
    createdAt: toIsoTimestamp(row.resultCreatedAt),
    id: row.id,
    runId: row.runId,
    status: row.status,
    warnings: row.warnings,
  });

const toValidationResult = (row: ValidationResultRow): ValidationResult =>
  ValidationResultSchema.parse({
    command: row.command,
    commandId: row.commandId,
    commandLabel: row.commandLabel,
    contractVersion: row.contractVersion,
    durationMs: row.durationMs,
    exitCode: row.exitCode,
    finishedAt: toIsoTimestamp(row.finishedAt),
    id: row.id,
    redactionApplied: row.redactionApplied,
    runId: row.runId,
    startedAt: toIsoTimestamp(row.startedAt),
    status: row.status,
    stderrSummary: row.stderrSummary,
    stdoutSummary: row.stdoutSummary,
  });

const toPrArtifact = (row: PrArtifactRow): PrArtifact =>
  PrArtifactSchema.parse({
    branchName: row.branchName,
    changedFilePaths: row.changedFilePaths,
    contractVersion: row.contractVersion,
    createdAt: toIsoTimestamp(row.createdAt),
    id: row.id,
    prNumber: row.prNumber,
    prStatus: row.prStatus,
    prTitle: row.prTitle,
    prUrl: row.prUrl,
    repository: {
      name: row.repositoryName,
      owner: row.repositoryOwner,
    },
    riskFindings: row.riskFindings,
    runId: row.runId,
  });

const findAssignedRun = async (
  tx: Pick<Database, "select">,
  input: {
    runId: string;
    runnerId: string;
    workspaceId: string;
  },
): Promise<"ok" | "run_not_found" | "runner_conflict"> => {
  const [run] = await tx
    .select({
      id: schema.runs.id,
      runnerId: schema.runs.runnerId,
    })
    .from(schema.runs)
    .where(and(eq(schema.runs.id, input.runId), eq(schema.runs.workspaceId, input.workspaceId)))
    .limit(1);

  if (run === undefined) {
    return "run_not_found";
  }

  if (run.runnerId !== input.runnerId) {
    return "runner_conflict";
  }

  return "ok";
};

export const createDrizzleRunArtifactSubmissionStore = (
  db: Database,
): RunArtifactSubmissionStore => ({
  persistDryRunResult: async (input) =>
    db.transaction(async (tx): Promise<PersistDryRunResultResult> => {
      const runStatus = await findAssignedRun(tx, {
        runId: input.result.runId,
        runnerId: input.runnerId,
        workspaceId: input.workspaceId,
      });

      if (runStatus !== "ok") {
        return { status: runStatus };
      }

      const [existingForRun] = await tx
        .select(dryRunResultReturningColumns)
        .from(schema.dryRunResults)
        .where(
          and(
            eq(schema.dryRunResults.runId, input.result.runId),
            eq(schema.dryRunResults.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (existingForRun !== undefined) {
        if (existingForRun.id !== input.result.id) {
          return { status: "artifact_conflict" };
        }

        return {
          inserted: false,
          result: toDryRunResult(existingForRun),
          status: "stored",
        };
      }

      const [insertedResult] = await tx
        .insert(schema.dryRunResults)
        .values({
          blockers: input.result.blockers,
          capabilities: input.result.capabilities,
          checks: input.result.checks,
          contractVersion: input.result.contractVersion,
          id: input.result.id,
          resultCreatedAt: input.resultCreatedAt,
          runId: input.result.runId,
          status: input.result.status,
          submittedAt: input.submittedAt,
          warnings: input.result.warnings,
          workspaceId: input.workspaceId,
        })
        .onConflictDoNothing()
        .returning(dryRunResultReturningColumns);

      if (insertedResult !== undefined) {
        return {
          inserted: true,
          result: toDryRunResult(insertedResult),
          status: "stored",
        };
      }

      const [storedResult] = await tx
        .select(dryRunResultReturningColumns)
        .from(schema.dryRunResults)
        .where(
          and(
            eq(schema.dryRunResults.runId, input.result.runId),
            eq(schema.dryRunResults.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (storedResult === undefined) {
        return { status: "artifact_conflict" };
      }

      if (storedResult.id !== input.result.id) {
        return { status: "artifact_conflict" };
      }

      return {
        inserted: false,
        result: toDryRunResult(storedResult),
        status: "stored",
      };
    }),
  persistValidationResult: async (input) =>
    db.transaction(async (tx): Promise<PersistValidationResultResult> => {
      const runStatus = await findAssignedRun(tx, {
        runId: input.result.runId,
        runnerId: input.runnerId,
        workspaceId: input.workspaceId,
      });

      if (runStatus !== "ok") {
        return { status: runStatus };
      }

      const [existingResult] = await tx
        .select(validationResultReturningColumns)
        .from(schema.validationResults)
        .where(
          and(
            eq(schema.validationResults.id, input.result.id),
            eq(schema.validationResults.runId, input.result.runId),
            eq(schema.validationResults.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (existingResult !== undefined) {
        return {
          inserted: false,
          result: toValidationResult(existingResult),
          status: "stored",
        };
      }

      const [insertedResult] = await tx
        .insert(schema.validationResults)
        .values({
          command: input.result.command,
          commandId: input.result.commandId,
          commandLabel: input.result.commandLabel,
          contractVersion: input.result.contractVersion,
          createdAt: input.submittedAt,
          durationMs: input.result.durationMs,
          exitCode: input.result.exitCode,
          finishedAt: new Date(input.result.finishedAt),
          id: input.result.id,
          redactionApplied: input.result.redactionApplied,
          runId: input.result.runId,
          startedAt: new Date(input.result.startedAt),
          status: input.result.status,
          stderrSummary: input.result.stderrSummary,
          stdoutSummary: input.result.stdoutSummary,
          workspaceId: input.workspaceId,
        })
        .onConflictDoNothing()
        .returning(validationResultReturningColumns);

      if (insertedResult !== undefined) {
        return {
          inserted: true,
          result: toValidationResult(insertedResult),
          status: "stored",
        };
      }

      const [storedResult] = await tx
        .select(validationResultReturningColumns)
        .from(schema.validationResults)
        .where(
          and(
            eq(schema.validationResults.id, input.result.id),
            eq(schema.validationResults.runId, input.result.runId),
            eq(schema.validationResults.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (storedResult !== undefined) {
        return {
          inserted: false,
          result: toValidationResult(storedResult),
          status: "stored",
        };
      }

      return { status: "artifact_conflict" };
    }),
  persistPrArtifact: async (input) =>
    db.transaction(async (tx): Promise<PersistPrArtifactResult> => {
      const runStatus = await findAssignedRun(tx, {
        runId: input.artifact.runId,
        runnerId: input.runnerId,
        workspaceId: input.workspaceId,
      });

      if (runStatus !== "ok") {
        return { status: runStatus };
      }

      const [existingForRun] = await tx
        .select(prArtifactReturningColumns)
        .from(schema.prArtifacts)
        .where(
          and(
            eq(schema.prArtifacts.runId, input.artifact.runId),
            eq(schema.prArtifacts.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (existingForRun !== undefined) {
        if (existingForRun.id !== input.artifact.id) {
          return { status: "artifact_conflict" };
        }

        return {
          artifact: toPrArtifact(existingForRun),
          inserted: false,
          status: "stored",
        };
      }

      const [insertedArtifact] = await tx
        .insert(schema.prArtifacts)
        .values({
          branchName: input.artifact.branchName,
          changedFilePaths: input.artifact.changedFilePaths,
          contractVersion: input.artifact.contractVersion,
          createdAt: new Date(input.artifact.createdAt),
          id: input.artifact.id,
          prNumber: input.artifact.prNumber,
          prStatus: input.artifact.prStatus,
          prTitle: input.artifact.prTitle,
          prUrl: input.artifact.prUrl,
          repositoryName: input.artifact.repository.name,
          repositoryOwner: input.artifact.repository.owner,
          riskFindings: input.artifact.riskFindings,
          runId: input.artifact.runId,
          updatedAt: input.submittedAt,
          workspaceId: input.workspaceId,
        })
        .onConflictDoNothing()
        .returning(prArtifactReturningColumns);

      if (insertedArtifact !== undefined) {
        await tx
          .update(schema.runs)
          .set({
            changedPaths: input.artifact.changedFilePaths,
            riskFindings: input.artifact.riskFindings,
            updatedAt: input.submittedAt,
          })
          .where(
            and(
              eq(schema.runs.id, input.artifact.runId),
              eq(schema.runs.workspaceId, input.workspaceId),
            ),
          );

        await tx
          .update(schema.cortexTasks)
          .set({
            prArtifactIds: sql<string[]>`case when ${schema.cortexTasks.prArtifactIds} ? ${input.artifact.id} then ${schema.cortexTasks.prArtifactIds} else ${schema.cortexTasks.prArtifactIds} || jsonb_build_array(${input.artifact.id}) end`,
            status: "pr_opened",
            updatedAt: input.submittedAt,
          })
          .where(
            and(
              eq(schema.cortexTasks.workspaceId, input.workspaceId),
              sql`${schema.cortexTasks.runIds} ? ${input.artifact.runId}`,
            ),
          );

        return {
          artifact: toPrArtifact(insertedArtifact),
          inserted: true,
          status: "stored",
        };
      }

      const [storedArtifact] = await tx
        .select(prArtifactReturningColumns)
        .from(schema.prArtifacts)
        .where(
          and(
            eq(schema.prArtifacts.runId, input.artifact.runId),
            eq(schema.prArtifacts.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (storedArtifact === undefined || storedArtifact.id !== input.artifact.id) {
        return { status: "artifact_conflict" };
      }

      return {
        artifact: toPrArtifact(storedArtifact),
        inserted: false,
        status: "stored",
      };
    }),
});

export const createDrizzleArtifactSubmissionStore = createDrizzleRunArtifactSubmissionStore;
