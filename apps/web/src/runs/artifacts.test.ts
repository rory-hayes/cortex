import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DryRunResultSchema,
  PrArtifactSchema,
  ValidationResultSchema,
  type DryRunResult,
  type PrArtifact,
  type SubmitDryRunResultRequest,
  type SubmitPrArtifactRequest,
  type SubmitValidationResultRequest,
  type ValidationResult,
} from "@control-plane/shared";

import {
  RunArtifactSubmissionError,
  createDrizzleArtifactSubmissionStore,
  createDrizzleRunArtifactSubmissionStore,
  createRunArtifactSubmissionService,
  createSubmitDryRunResultService,
  createSubmitPrArtifactService,
  createSubmitValidationResultService,
  isRunArtifactSubmissionRequestError,
  type PersistDryRunResultInput,
  type PersistDryRunResultResult,
  type PersistPrArtifactInput,
  type PersistPrArtifactResult,
  type PersistValidationResultInput,
  type PersistValidationResultResult,
  type RunArtifactSubmissionStore,
} from "./artifacts.js";
import { schema } from "../db";

vi.mock("server-only", () => ({}));

type TestRun = {
  id: string;
  runnerId: string | null;
  workspaceId: string;
};

type StoredDryRunResult = {
  result: DryRunResult;
  resultCreatedAt: Date;
  submittedAt: Date;
  workspaceId: string;
};

type StoredValidationResult = {
  result: ValidationResult;
  submittedAt: Date;
  workspaceId: string;
};

type StoredPrArtifact = {
  artifact: PrArtifact;
  submittedAt: Date;
  workspaceId: string;
};

type DrizzlePrArtifactRun = TestRun & {
  changedPaths: string[];
  riskFindings: PrArtifact["riskFindings"];
  updatedAt: Date;
  updateCount: number;
};

type DrizzlePrArtifactCortexTask = {
  id: string;
  latestRunId: string | null;
  prArtifactIds: string[];
  runIds: string[];
  status: string;
  updatedAt: Date;
  updateCount: number;
  workspaceId: string;
};

type DrizzleValidationResultRow = {
  command: string;
  commandId: string;
  commandLabel: string;
  contractVersion: string;
  createdAt: Date;
  durationMs: number;
  exitCode: number | null;
  finishedAt: Date;
  id: string;
  redactionApplied: boolean;
  runId: string;
  startedAt: Date;
  status: ValidationResult["status"];
  stderrSummary: string;
  stdoutSummary: string;
  workspaceId: string;
};

type DrizzlePrArtifactRow = {
  branchName: string;
  changedFilePaths: PrArtifact["changedFilePaths"];
  contractVersion: string;
  createdAt: Date;
  id: string;
  prNumber: number;
  prStatus: PrArtifact["prStatus"];
  prTitle: string;
  prUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  riskFindings: PrArtifact["riskFindings"];
  runId: string;
  updatedAt: Date;
  workspaceId: string;
};

const submittedAt = "2026-05-23T10:00:00.000Z";

const createCapabilities = (runnerId = "runner_1"): DryRunResult["capabilities"] => ({
  contractVersion: CONTRACT_VERSION,
  runnerId,
  os: {
    arch: "arm64",
    platform: "darwin",
    release: "25.0.0",
  },
  shell: "zsh",
  tools: {
    codex: { available: true, version: "1.0.0" },
    gh: { available: true, version: "2.0.0" },
    git: { available: true, version: "2.50.0" },
    node: { available: true, version: "24.0.0" },
    npm: { available: true, version: "11.0.0" },
    pnpm: { available: true, version: "10.0.0" },
    python: { available: false },
    yarn: { available: false },
  },
  maxConcurrentJobs: 1,
  supportsCancellation: true,
  supportsDryRun: true,
  reportedAt: "2026-05-23T09:59:00.000Z",
});

const createDryRunResult = (overrides: Partial<DryRunResult> = {}): DryRunResult =>
  DryRunResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "dry_run_result_1",
    runId: "run_1",
    status: "passed",
    checks: [
      {
        id: "repo_clean",
        label: "Repo clean",
        status: "passed",
        message: "Repository was clean.",
        metadata: {
          changedFileCount: 0,
        },
      },
    ],
    capabilities: createCapabilities(),
    blockers: [],
    warnings: [],
    createdAt: "2026-05-23T09:59:30.000Z",
    ...overrides,
  });

const createValidationResult = (
  overrides: Partial<ValidationResult> = {},
): ValidationResult =>
  ValidationResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "validation_result_1",
    runId: "run_1",
    commandId: "web-tests",
    commandLabel: "Web tests",
    command: "pnpm --filter @control-plane/web test",
    status: "passed",
    exitCode: 0,
    durationMs: 1234,
    stdoutSummary: "Validation command passed.",
    stderrSummary: "",
    redactionApplied: true,
    startedAt: "2026-05-23T09:58:00.000Z",
    finishedAt: "2026-05-23T09:58:02.000Z",
    ...overrides,
  });

const createPrArtifact = (overrides: Partial<PrArtifact> = {}): PrArtifact =>
  PrArtifactSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "pr_artifact_1",
    runId: "run_1",
    repository: {
      owner: "control-plane",
      name: "app",
    },
    branchName: "aicp/task-119",
    prNumber: 42,
    prUrl: "https://github.com/control-plane/app/pull/42",
    prTitle: "TASK-119 artifact endpoints",
    prStatus: "draft",
    changedFilePaths: ["apps/web/src/runs/artifacts.ts"],
    riskFindings: [
      {
        id: "risk:package_lock",
        severity: "warning",
        category: "package_lock",
        message: "Package lock changed.",
        paths: ["pnpm-lock.yaml"],
      },
    ],
    createdAt: "2026-05-23T09:59:45.000Z",
    ...overrides,
  });

const createDryRunRequest = (
  overrides: Partial<SubmitDryRunResultRequest> = {},
): SubmitDryRunResultRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  runId: "run_1",
  result: createDryRunResult(),
  submittedAt,
  ...overrides,
});

const createValidationRequest = (
  overrides: Partial<SubmitValidationResultRequest> = {},
): SubmitValidationResultRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  runId: "run_1",
  result: createValidationResult(),
  submittedAt,
  ...overrides,
});

const createPrRequest = (
  overrides: Partial<SubmitPrArtifactRequest> = {},
): SubmitPrArtifactRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  runId: "run_1",
  artifact: createPrArtifact(),
  submittedAt,
  ...overrides,
});

const createRun = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "run_1",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const createDrizzlePrArtifactRun = (
  overrides: Partial<DrizzlePrArtifactRun> = {},
): DrizzlePrArtifactRun => ({
  ...createRun(),
  changedPaths: [],
  riskFindings: [],
  updatedAt: new Date("2026-05-23T09:00:00.000Z"),
  updateCount: 0,
  ...overrides,
});

const createDrizzlePrArtifactCortexTask = (
  overrides: Partial<DrizzlePrArtifactCortexTask> = {},
): DrizzlePrArtifactCortexTask => ({
  id: "cortex_task_1",
  latestRunId: "run_1",
  prArtifactIds: [],
  runIds: ["run_1"],
  status: "running",
  updatedAt: new Date("2026-05-23T09:00:00.000Z"),
  updateCount: 0,
  workspaceId: "workspace_1",
  ...overrides,
});

const toDrizzlePrArtifactRow = (
  artifact: PrArtifact,
  overrides: Partial<DrizzlePrArtifactRow> = {},
): DrizzlePrArtifactRow => ({
  branchName: artifact.branchName,
  changedFilePaths: artifact.changedFilePaths,
  contractVersion: artifact.contractVersion,
  createdAt: new Date(artifact.createdAt),
  id: artifact.id,
  prNumber: artifact.prNumber,
  prStatus: artifact.prStatus,
  prTitle: artifact.prTitle,
  prUrl: artifact.prUrl,
  repositoryName: artifact.repository.name,
  repositoryOwner: artifact.repository.owner,
  riskFindings: artifact.riskFindings,
  runId: artifact.runId,
  updatedAt: new Date(submittedAt),
  workspaceId: "workspace_1",
  ...overrides,
});

const toDrizzleValidationResultRow = (
  result: ValidationResult,
  overrides: Partial<DrizzleValidationResultRow> = {},
): DrizzleValidationResultRow => ({
  command: result.command,
  commandId: result.commandId,
  commandLabel: result.commandLabel,
  contractVersion: result.contractVersion,
  createdAt: new Date(submittedAt),
  durationMs: result.durationMs,
  exitCode: result.exitCode,
  finishedAt: new Date(result.finishedAt),
  id: result.id,
  redactionApplied: result.redactionApplied,
  runId: result.runId,
  startedAt: new Date(result.startedAt),
  status: result.status,
  stderrSummary: result.stderrSummary,
  stdoutSummary: result.stdoutSummary,
  workspaceId: "workspace_1",
  ...overrides,
});

const createPersistValidationResultInput = (
  overrides: {
    result?: Partial<ValidationResult>;
    runnerId?: string;
    submittedAt?: Date;
    workspaceId?: string;
  } = {},
): PersistValidationResultInput => {
  const result = createValidationResult(overrides.result);

  return {
    result,
    runId: result.runId,
    runnerId: overrides.runnerId ?? "runner_1",
    submittedAt: overrides.submittedAt ?? new Date(submittedAt),
    workspaceId: overrides.workspaceId ?? "workspace_1",
  };
};

const createPersistPrArtifactInput = (
  overrides: {
    artifact?: Partial<PrArtifact>;
    runnerId?: string;
    submittedAt?: Date;
    workspaceId?: string;
  } = {},
): PersistPrArtifactInput => {
  const artifact = createPrArtifact(overrides.artifact);

  return {
    artifact,
    runId: artifact.runId,
    runnerId: overrides.runnerId ?? "runner_1",
    submittedAt: overrides.submittedAt ?? new Date(submittedAt),
    workspaceId: overrides.workspaceId ?? "workspace_1",
  };
};

const createDrizzleValidationResultStoreHarness = (input: {
  conflictResult: DrizzleValidationResultRow;
  runs?: TestRun[];
}) => {
  const runs = [...(input.runs ?? [createRun()])];
  let activeInput: PersistValidationResultInput | null = null;
  let validationSelectCount = 0;

  const requireActiveInput = (): PersistValidationResultInput => {
    if (activeInput === null) {
      throw new Error("Drizzle harness used outside a persist call.");
    }

    return activeInput;
  };

  const selectRows = (table: unknown): unknown[] => {
    const currentInput = requireActiveInput();

    if (table === schema.runs) {
      const run = runs.find(
        (candidate) =>
          candidate.id === currentInput.result.runId &&
          candidate.workspaceId === currentInput.workspaceId,
      );

      return run === undefined
        ? []
        : [
            {
              id: run.id,
              runnerId: run.runnerId,
            },
          ];
    }

    if (table !== schema.validationResults) {
      return [];
    }

    validationSelectCount += 1;

    return validationSelectCount === 1 ? [] : [input.conflictResult];
  };

  const select = vi.fn((selection: Record<string, unknown>) => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectRows(table)),
      })),
    })),
    selection,
  }));

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => (table === schema.validationResults ? [] : [])),
      })),
    })),
  }));

  const transaction = vi.fn(
    async (
      callback: (tx: {
        insert: typeof insert;
        select: typeof select;
      }) => unknown,
    ) => callback({ insert, select }),
  );
  const store = createDrizzleRunArtifactSubmissionStore({ transaction } as never);

  const persistValidationResult = async (persistInput: PersistValidationResultInput) => {
    activeInput = persistInput;

    try {
      return await store.persistValidationResult(persistInput);
    } finally {
      activeInput = null;
    }
  };

  return {
    persistValidationResult,
    transaction,
    get validationSelectCount() {
      return validationSelectCount;
    },
  };
};

const createDrizzlePrArtifactStoreHarness = (input: {
  cortexTasks?: DrizzlePrArtifactCortexTask[];
  prArtifacts?: DrizzlePrArtifactRow[];
  runs?: DrizzlePrArtifactRun[];
}) => {
  const cortexTasks = [...(input.cortexTasks ?? [])];
  const prArtifacts = [...(input.prArtifacts ?? [])];
  const runs = [...(input.runs ?? [])];
  let activeInput: PersistPrArtifactInput | null = null;
  let insertCount = 0;
  let prArtifactUpdateCount = 0;
  let updateCount = 0;

  const requireActiveInput = (): PersistPrArtifactInput => {
    if (activeInput === null) {
      throw new Error("Drizzle harness used outside a persist call.");
    }

    return activeInput;
  };

  const selectRows = (table: unknown): unknown[] => {
    const currentInput = requireActiveInput();

    if (table === schema.runs) {
      const run = runs.find(
        (candidate) =>
          candidate.id === currentInput.artifact.runId &&
          candidate.workspaceId === currentInput.workspaceId,
      );

      return run === undefined
        ? []
        : [
            {
              id: run.id,
              runnerId: run.runnerId,
            },
          ];
    }

    if (table !== schema.prArtifacts) {
      return [];
    }

    const artifact = prArtifacts.find(
      (candidate) =>
        candidate.runId === currentInput.artifact.runId &&
        candidate.workspaceId === currentInput.workspaceId,
    );

    return artifact === undefined ? [] : [artifact];
  };

  const select = vi.fn((selection: Record<string, unknown>) => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectRows(table)),
      })),
    })),
    selection,
  }));

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((row: DrizzlePrArtifactRow) => {
      const insertRow = async () => {
        if (table !== schema.prArtifacts) {
          return [];
        }

        const hasConflict = prArtifacts.some(
          (candidate) => candidate.id === row.id || candidate.runId === row.runId,
        );

        if (hasConflict) {
          return [];
        }

        insertCount += 1;
        prArtifacts.push(row);

        return [row];
      };

      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(insertRow),
        })),
        onConflictDoUpdate: vi.fn(
          ({ set }: { set: Partial<DrizzlePrArtifactRow>; target: unknown }) => ({
            returning: vi.fn(async () => {
              if (table !== schema.prArtifacts) {
                return [];
              }

              const existingIndex = prArtifacts.findIndex(
                (candidate) => candidate.runId === row.runId,
              );

              if (existingIndex === -1) {
                insertCount += 1;
                prArtifacts.push(row);

                return [row];
              }

              const existingRow = prArtifacts[existingIndex];

              if (existingRow === undefined) {
                return [];
              }

              const updatedRow: DrizzlePrArtifactRow = {
                ...existingRow,
                ...set,
              };
              prArtifacts[existingIndex] = updatedRow;
              prArtifactUpdateCount += 1;

              return [updatedRow];
            }),
          }),
        ),
      };
    }),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Partial<DrizzlePrArtifactRun & DrizzlePrArtifactCortexTask>) => ({
      where: vi.fn(async () => {
        const currentInput = requireActiveInput();

        if (table === schema.runs) {
          const run = runs.find(
            (candidate) =>
              candidate.id === currentInput.artifact.runId &&
              candidate.workspaceId === currentInput.workspaceId,
          );

          if (run === undefined) {
            return;
          }

          Object.assign(run, values);
          run.updateCount += 1;
          updateCount += 1;

          return;
        }

        if (table === schema.cortexTasks) {
          const task = cortexTasks.find(
            (candidate) =>
              candidate.workspaceId === currentInput.workspaceId &&
              candidate.runIds.includes(currentInput.artifact.runId),
          );

          if (task === undefined) {
            return;
          }

          const nextPrArtifactIds = Array.isArray(values.prArtifactIds)
            ? values.prArtifactIds
            : [...new Set([...task.prArtifactIds, currentInput.artifact.id])];
          Object.assign(task, values, {
            prArtifactIds: nextPrArtifactIds,
          });
          task.updateCount += 1;
          updateCount += 1;
        }
      }),
    })),
  }));

  const transaction = vi.fn(
    async (
      callback: (tx: {
        insert: typeof insert;
        select: typeof select;
        update: typeof update;
      }) => unknown,
    ) => callback({ insert, select, update }),
  );
  const store = createDrizzleRunArtifactSubmissionStore({ transaction } as never);

  const persistPrArtifact = async (persistInput: PersistPrArtifactInput) => {
    activeInput = persistInput;

    try {
      return await store.persistPrArtifact(persistInput);
    } finally {
      activeInput = null;
    }
  };

  return {
    get insertCount() {
      return insertCount;
    },
    cortexTasks,
    persistPrArtifact,
    prArtifacts,
    get prArtifactUpdateCount() {
      return prArtifactUpdateCount;
    },
    runs,
    transaction,
    get updateCount() {
      return updateCount;
    },
  };
};

const createStore = (
  runs: TestRun[],
): RunArtifactSubmissionStore & {
  dryRunResults: StoredDryRunResult[];
  prArtifacts: StoredPrArtifact[];
  validationResults: StoredValidationResult[];
} => {
  const dryRunResults: StoredDryRunResult[] = [];
  const validationResults: StoredValidationResult[] = [];
  const prArtifacts: StoredPrArtifact[] = [];

  const findRun = (runId: string, workspaceId: string) =>
    runs.find((run) => run.id === runId && run.workspaceId === workspaceId);

  const assertAssignedRun = ({
    runId,
    runnerId,
    workspaceId,
  }: {
    runId: string;
    runnerId: string;
    workspaceId: string;
  }) => {
    const run = findRun(runId, workspaceId);

    if (run === undefined) {
      return "run_not_found" as const;
    }

    if (run.runnerId !== runnerId) {
      return "runner_conflict" as const;
    }

    return "ok" as const;
  };

  return {
    dryRunResults,
    prArtifacts,
    validationResults,
    persistDryRunResult: async (
      input: PersistDryRunResultInput,
    ): Promise<PersistDryRunResultResult> => {
      const runStatus = assertAssignedRun(input);

      if (runStatus !== "ok") {
        return { status: runStatus };
      }

      const existingForRun = dryRunResults.find(
        (candidate) =>
          candidate.result.runId === input.result.runId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (existingForRun !== undefined) {
        if (existingForRun.result.id !== input.result.id) {
          return { status: "artifact_conflict" };
        }

        return {
          inserted: false,
          result: existingForRun.result,
          status: "stored",
        };
      }

      if (dryRunResults.some((candidate) => candidate.result.id === input.result.id)) {
        return { status: "artifact_conflict" };
      }

      dryRunResults.push({
        result: input.result,
        resultCreatedAt: input.resultCreatedAt,
        submittedAt: input.submittedAt,
        workspaceId: input.workspaceId,
      });

      return {
        inserted: true,
        result: input.result,
        status: "stored",
      };
    },
    persistValidationResult: async (
      input: PersistValidationResultInput,
    ): Promise<PersistValidationResultResult> => {
      const runStatus = assertAssignedRun(input);

      if (runStatus !== "ok") {
        return { status: runStatus };
      }

      const existing = validationResults.find(
        (candidate) =>
          candidate.result.id === input.result.id &&
          candidate.result.runId === input.result.runId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (existing !== undefined) {
        return {
          inserted: false,
          result: existing.result,
          status: "stored",
        };
      }

      if (validationResults.some((candidate) => candidate.result.id === input.result.id)) {
        return { status: "artifact_conflict" };
      }

      validationResults.push({
        result: input.result,
        submittedAt: input.submittedAt,
        workspaceId: input.workspaceId,
      });

      return {
        inserted: true,
        result: input.result,
        status: "stored",
      };
    },
    persistPrArtifact: async (
      input: PersistPrArtifactInput,
    ): Promise<PersistPrArtifactResult> => {
      const runStatus = assertAssignedRun(input);

      if (runStatus !== "ok") {
        return { status: runStatus };
      }

      const existingForRun = prArtifacts.find(
        (candidate) =>
          candidate.artifact.runId === input.artifact.runId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (existingForRun !== undefined) {
        if (existingForRun.artifact.id !== input.artifact.id) {
          return { status: "artifact_conflict" };
        }

        return {
          artifact: existingForRun.artifact,
          inserted: false,
          status: "stored",
        };
      }

      if (prArtifacts.some((candidate) => candidate.artifact.id === input.artifact.id)) {
        return { status: "artifact_conflict" };
      }

      prArtifacts.push({
        artifact: input.artifact,
        submittedAt: input.submittedAt,
        workspaceId: input.workspaceId,
      });

      return {
        artifact: input.artifact,
        inserted: true,
        status: "stored",
      };
    },
  };
};

const createService = (runs: TestRun[] = [createRun()]) => {
  const store = createStore(runs);
  const service = createRunArtifactSubmissionService({ store });

  return { service, store };
};

describe("run artifact submission service", () => {
  test("exports endpoint-specific service and store aliases", () => {
    expect(createSubmitDryRunResultService).toBe(createRunArtifactSubmissionService);
    expect(createSubmitValidationResultService).toBe(createRunArtifactSubmissionService);
    expect(createSubmitPrArtifactService).toBe(createRunArtifactSubmissionService);
    expect(createDrizzleArtifactSubmissionStore).toBe(createDrizzleRunArtifactSubmissionStore);
  });

  test("stores a valid dry-run result and returns schema-valid data", async () => {
    const { service, store } = createService();
    const result = await service.submitDryRunResult({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createDryRunRequest(),
    });

    expect(DryRunResultSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual(createDryRunResult());
    expect(store.dryRunResults).toHaveLength(1);
    expect(store.dryRunResults[0]).toMatchObject({
      resultCreatedAt: new Date("2026-05-23T09:59:30.000Z"),
      submittedAt: new Date(submittedAt),
      workspaceId: "workspace_1",
    });
  });

  test("stores a valid validation result and returns schema-valid data", async () => {
    const { service, store } = createService();
    const result = await service.submitValidationResult({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createValidationRequest(),
    });

    expect(ValidationResultSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual(createValidationResult());
    expect(store.validationResults).toHaveLength(1);
  });

  test("stores a valid PR artifact and returns schema-valid data", async () => {
    const { service, store } = createService();
    const artifact = await service.submitPrArtifact({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createPrRequest(),
    });

    expect(PrArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact).toEqual(createPrArtifact());
    expect(store.prArtifacts).toHaveLength(1);
  });

  test("handles duplicate dry-run, validation, and PR artifact retries without duplicating", async () => {
    const { service, store } = createService();
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    const dryRunResult = await service.submitDryRunResult({
      context,
      request: createDryRunRequest(),
    });
    const retriedDryRunResult = await service.submitDryRunResult({
      context,
      request: createDryRunRequest(),
    });
    const validationResult = await service.submitValidationResult({
      context,
      request: createValidationRequest(),
    });
    const retriedValidationResult = await service.submitValidationResult({
      context,
      request: createValidationRequest({
        result: createValidationResult({
          commandLabel: "Changed retry body",
        }),
      }),
    });
    const prArtifact = await service.submitPrArtifact({
      context,
      request: createPrRequest(),
    });
    const retriedPrArtifact = await service.submitPrArtifact({
      context,
      request: createPrRequest(),
    });

    expect(retriedDryRunResult).toEqual(dryRunResult);
    expect(retriedValidationResult).toEqual(validationResult);
    expect(retriedPrArtifact).toEqual(prArtifact);
    expect(store.dryRunResults).toHaveLength(1);
    expect(store.validationResults).toHaveLength(1);
    expect(store.prArtifacts).toHaveLength(1);
    expect(store.prArtifacts[0]?.artifact).toEqual(prArtifact);
  });

  test.each([
    [
      "dry-run",
      "submitDryRunResult",
      () => createDryRunRequest(),
      () =>
        createDryRunRequest({
          result: createDryRunResult({
            id: "dry_run_result_changed",
          }),
        }),
      "dryRunResults",
    ],
    [
      "PR",
      "submitPrArtifact",
      () => createPrRequest(),
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            id: "pr_artifact_changed",
          }),
        }),
      "prArtifacts",
    ],
  ] as const)(
    "rejects a second %s artifact for the same run when the artifact id differs",
    async (_label, method, firstRequestFactory, conflictingRequestFactory, collection) => {
      const { service, store } = createService();
      const context = {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      };

      await service[method]({
        context,
        request: firstRequestFactory(),
      });

      await expect(
        service[method]({
          context,
          request: conflictingRequestFactory(),
        }),
      ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
      expect(store[collection]).toHaveLength(1);
    },
  );

  test.each([
    ["dry-run", () => createDryRunRequest({ runnerId: "runner_2" }), "submitDryRunResult"],
    [
      "validation",
      () => createValidationRequest({ runnerId: "runner_2" }),
      "submitValidationResult",
    ],
    ["PR", () => createPrRequest({ runnerId: "runner_2" }), "submitPrArtifact"],
  ] as const)("rejects %s runner id mismatch before persistence", async (_label, requestFactory, method) => {
    const { service, store } = createService();

    await expect(
      service[method]({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: requestFactory(),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store.dryRunResults).toHaveLength(0);
    expect(store.validationResults).toHaveLength(0);
    expect(store.prArtifacts).toHaveLength(0);
  });

  test("rejects dry-run capabilities runner id mismatch before persistence", async () => {
    const { service, store } = createService();

    await expect(
      service.submitDryRunResult({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createDryRunRequest({
          result: createDryRunResult({
            capabilities: createCapabilities("runner_2"),
          }),
        }),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store.dryRunResults).toHaveLength(0);
  });

  test.each([
    ["dry-run", () => createDryRunRequest(), "submitDryRunResult", "dryRunResults"],
    ["validation", () => createValidationRequest(), "submitValidationResult", "validationResults"],
    ["PR", () => createPrRequest(), "submitPrArtifact", "prArtifacts"],
  ] as const)("rejects %s artifacts for runs outside the authenticated workspace", async (
    _label,
    requestFactory,
    method,
    collection,
  ) => {
    const { service, store } = createService([createRun({ workspaceId: "workspace_2" })]);

    await expect(
      service[method]({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: requestFactory(),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store[collection]).toHaveLength(0);
  });

  test.each([
    ["dry-run", () => createDryRunRequest(), "submitDryRunResult", "dryRunResults"],
    ["validation", () => createValidationRequest(), "submitValidationResult", "validationResults"],
    ["PR", () => createPrRequest(), "submitPrArtifact", "prArtifacts"],
  ] as const)("rejects %s artifacts for runs assigned to another runner", async (
    _label,
    requestFactory,
    method,
    collection,
  ) => {
    const { service, store } = createService([createRun({ runnerId: "runner_2" })]);
    const context = {
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    };

    await expect(
      service[method]({
        context,
        request: requestFactory(),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store[collection]).toHaveLength(0);
  });

  test.each([
    ["dry-run", () => createDryRunRequest(), "submitDryRunResult", "dryRunResults"],
    ["validation", () => createValidationRequest(), "submitValidationResult", "validationResults"],
    ["PR", () => createPrRequest(), "submitPrArtifact", "prArtifacts"],
  ] as const)("rejects %s artifacts for unassigned runs", async (
    _label,
    requestFactory,
    method,
    collection,
  ) => {
    const { service, store } = createService([createRun({ runnerId: null })]);

    await expect(
      service[method]({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: requestFactory(),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store[collection]).toHaveLength(0);
  });

  test.each([
    [
      "dry-run result runId mismatch",
      () =>
        createDryRunRequest({
          result: createDryRunResult({ runId: "run_2" }),
        }),
      "submitDryRunResult",
    ],
    [
      "validation result runId mismatch",
      () =>
        createValidationRequest({
          result: createValidationResult({ runId: "run_2" }),
        }),
      "submitValidationResult",
    ],
    [
      "PR artifact runId mismatch",
      () =>
        createPrRequest({
          artifact: createPrArtifact({ runId: "run_2" }),
        }),
      "submitPrArtifact",
    ],
  ] as const)("rejects invalid shared schema payloads for %s", async (_label, requestFactory, method) => {
    const { service, store } = createService();

    await expect(
      service[method]({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: requestFactory(),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store.dryRunResults).toHaveLength(0);
    expect(store.validationResults).toHaveLength(0);
    expect(store.prArtifacts).toHaveLength(0);
  });

  test.each([
    [
      "raw diff in dry-run check metadata",
      () =>
        createDryRunRequest({
          result: createDryRunResult({
            checks: [
              {
                id: "repo_clean",
                label: "Repo clean",
                status: "passed",
                message: "Repository was clean.",
                metadata: {
                  summary: "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts",
                },
              },
            ],
          }),
        }),
      "submitDryRunResult",
    ],
    [
      "raw diff in dry-run blocker id",
      () =>
        createDryRunRequest({
          result: createDryRunResult({
            blockers: [
              {
                id: "diff --git a/app.ts b/app.ts",
                severity: "blocked",
                category: "protected_path",
                message: "Protected path changed.",
                paths: ["src/app.ts"],
              },
            ],
          }),
        }),
      "submitDryRunResult",
    ],
    [
      "source code snippet in dry-run warning id",
      () =>
        createDryRunRequest({
          result: createDryRunResult({
            warnings: [
              {
                id: "export const leakedValue = true;",
                severity: "warning",
                category: "large_diff",
                message: "Changed file count exceeded the warning threshold.",
                paths: [],
              },
            ],
          }),
        }),
      "submitDryRunResult",
    ],
    [
      "patch in validation stdout summary",
      () =>
        createValidationRequest({
          result: createValidationResult({
            stdoutSummary: "*** Begin Patch\n*** Update File: app.ts\n@@",
          }),
        }),
      "submitValidationResult",
    ],
    [
      "source code snippet in validation stderr summary",
      () =>
        createValidationRequest({
          result: createValidationResult({
            stderrSummary: "export const leakedValue = true;",
          }),
        }),
      "submitValidationResult",
    ],
    [
      "unredacted command output in validation summary",
      () =>
        createValidationRequest({
          result: createValidationResult({
            stdoutSummary: "raw output: unsafe command result\nstdout: full command log",
          }),
        }),
      "submitValidationResult",
    ],
    [
      "validation result without redaction applied",
      () =>
        createValidationRequest({
          result: createValidationResult({
            redactionApplied: false,
          }),
        }),
      "submitValidationResult",
    ],
    [
      "credential URL in PR artifact",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            prUrl: "https://deploy-user:deploy-pass@example.test/repo/pull/42",
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "credential query token in PR artifact URL",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            prUrl: "https://github.com/control-plane/app/pull/42?token=hunter2",
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "credential query access token in PR artifact URL",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            prUrl: "https://github.com/control-plane/app/pull/42?access_token=hunter2",
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "CLI secret flag in validation command",
      () =>
        createValidationRequest({
          result: createValidationResult({
            command: "pnpm test --token=hunter2",
          }),
        }),
      "submitValidationResult",
    ],
    [
      "embedded secret-like key assignment in validation summary",
      () =>
        createValidationRequest({
          result: createValidationResult({
            stderrSummary: "error: DATABASE_PASSWORD=hunter2",
          }),
        }),
      "submitValidationResult",
    ],
    [
      "secret-like text in PR title",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            prTitle: "Token ghp_artifactguardabcdefghijklmnopqrstuvwxyz123456 leaked",
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "secret-like text in PR risk finding id",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            riskFindings: [
              {
                id: "ghp_artifactguardabcdefghijklmnopqrstuvwxyz123456",
                severity: "warning",
                category: "package_lock",
                message: "Package lock changed.",
                paths: ["pnpm-lock.yaml"],
              },
            ],
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "raw source-like changed file path",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            changedFilePaths: ["src/index.ts\nexport const leakedValue = true;"],
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "code fence in dry-run check message",
      () =>
        createDryRunRequest({
          result: createDryRunResult({
            checks: [
              {
                id: "repo_clean",
                label: "Repo clean",
                status: "passed",
                message: "```ts\nconst leakedValue = true;\n```",
                metadata: {},
              },
            ],
          }),
        }),
      "submitDryRunResult",
    ],
    [
      "private key block in validation summary",
      () =>
        createValidationRequest({
          result: createValidationResult({
            stderrSummary:
              "-----BEGIN PRIVATE KEY-----\nunsafe-fixture-value\n-----END PRIVATE KEY-----",
          }),
        }),
      "submitValidationResult",
    ],
    [
      "bearer token in PR title",
      () =>
        createPrRequest({
          artifact: createPrArtifact({
            prTitle: "Bearer unsafeFixtureToken12345",
          }),
        }),
      "submitPrArtifact",
    ],
    [
      "unsafe diff request key",
      () => ({
        ...createDryRunRequest(),
        diff: "unsafe payload",
      }),
      "submitDryRunResult",
    ],
    [
      "unsafe patch request key",
      () => ({
        ...createPrRequest(),
        patch: "unsafe payload",
      }),
      "submitPrArtifact",
    ],
    [
      "unsafe source code request key",
      () => ({
        ...createValidationRequest(),
        sourceCode: "unsafe payload",
      }),
      "submitValidationResult",
    ],
    [
      "unsafe raw output request key",
      () => ({
        ...createValidationRequest(),
        rawOutput: "unsafe command result",
      }),
      "submitValidationResult",
    ],
  ] as const)("rejects %s before persistence", async (_label, requestFactory, method) => {
    const { service, store } = createService();

    await expect(
      service[method]({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: requestFactory(),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store.dryRunResults).toHaveLength(0);
    expect(store.validationResults).toHaveLength(0);
    expect(store.prArtifacts).toHaveLength(0);
  });

  test.each([
    ["absolute path", "/Users/runner/repo/src/app.ts"],
    ["traversal path", "../src/app.ts"],
    ["nested traversal path", "src/../app.ts"],
    ["control-character path", "src/app\u0000.ts"],
    ["credentialed URL path", "https://deploy-user:deploy-pass@example.test/src/app.ts"],
    ["source-like path text", "sourceCode.ts"],
    ["real dotenv path", ".env"],
    ["real dotenv nested path", "config/.env.production"],
  ] as const)("rejects PR changed file %s before persistence", async (_label, changedPath) => {
    const { service, store } = createService();

    await expect(
      service.submitPrArtifact({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createPrRequest({
          artifact: createPrArtifact({
            changedFilePaths: [changedPath],
          }),
        }),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store.prArtifacts).toHaveLength(0);
  });

  test("allows PR changed file paths for .env.example templates", async () => {
    const { service, store } = createService();

    await expect(
      service.submitPrArtifact({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createPrRequest({
          artifact: createPrArtifact({
            changedFilePaths: [".env.example", "apps/web/.env.example"],
          }),
        }),
      }),
    ).resolves.toEqual(
      createPrArtifact({
        changedFilePaths: [".env.example", "apps/web/.env.example"],
      }),
    );
    expect(store.prArtifacts).toHaveLength(1);
  });

  test("keeps unsafe request material out of service errors", async () => {
    const { service } = createService();
    let thrownError: unknown;

    try {
      await service.submitValidationResult({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createValidationRequest({
          result: createValidationResult({
            stdoutSummary:
              "diff --git a/app.ts b/app.ts\nDATABASE_PASSWORD=unsafe-fixture-value",
          }),
        }),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(RunArtifactSubmissionError);
    expect(isRunArtifactSubmissionRequestError(thrownError)).toBe(true);
    expect(`${String(thrownError)} ${JSON.stringify(thrownError)}`).not.toMatch(
      /diff --git|DATABASE_PASSWORD|unsafe-fixture-value|stdoutSummary|request body/i,
    );
  });

  test("rejects calendar-invalid timestamps before persistence", async () => {
    const { service, store } = createService();

    await expect(
      service.submitPrArtifact({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createPrRequest({
          submittedAt: "2026-02-31T00:00:00.000Z",
        }),
      }),
    ).rejects.toBeInstanceOf(RunArtifactSubmissionError);
    expect(store.prArtifacts).toHaveLength(0);
  });
});

describe("Drizzle PR artifact submission store", () => {
  test("returns the existing PR artifact on exact retry and refreshes run aggregates once", async () => {
    const run = createDrizzlePrArtifactRun();
    const harness = createDrizzlePrArtifactStoreHarness({ runs: [run] });
    const firstInput = createPersistPrArtifactInput();
    const retryInput = createPersistPrArtifactInput();

    const firstResult = await harness.persistPrArtifact(firstInput);
    const retryResult = await harness.persistPrArtifact(retryInput);

    expect(firstResult).toEqual({
      artifact: firstInput.artifact,
      inserted: true,
      status: "stored",
    });
    expect(retryResult).toEqual({
      artifact: firstInput.artifact,
      inserted: false,
      status: "stored",
    });
    expect(run).toMatchObject({
      changedPaths: firstInput.artifact.changedFilePaths,
      riskFindings: firstInput.artifact.riskFindings,
      updateCount: 1,
      updatedAt: firstInput.submittedAt,
    });
    expect(harness.prArtifacts).toEqual([
      toDrizzlePrArtifactRow(firstInput.artifact, {
        createdAt: new Date(firstInput.artifact.createdAt),
      }),
    ]);
    expect(harness.insertCount).toBe(1);
    expect(harness.prArtifactUpdateCount).toBe(0);
    expect(harness.updateCount).toBe(1);
    expect(harness.transaction).toHaveBeenCalledTimes(2);
  });

  test("links stored PR artifacts back to Cortex Tasks through the run id", async () => {
    const run = createDrizzlePrArtifactRun();
    const task = createDrizzlePrArtifactCortexTask({
      prArtifactIds: ["pr_artifact_existing"],
    });
    const harness = createDrizzlePrArtifactStoreHarness({
      cortexTasks: [task],
      runs: [run],
    });
    const input = createPersistPrArtifactInput();

    const result = await harness.persistPrArtifact(input);

    expect(result).toEqual({
      artifact: input.artifact,
      inserted: true,
      status: "stored",
    });
    expect(task).toMatchObject({
      prArtifactIds: ["pr_artifact_existing", input.artifact.id],
      status: "pr_opened",
      updateCount: 1,
      updatedAt: input.submittedAt,
    });
    expect(harness.updateCount).toBe(2);
  });

  test("conflicts when a second PR artifact id is submitted for the same run", async () => {
    const run = createDrizzlePrArtifactRun();
    const harness = createDrizzlePrArtifactStoreHarness({ runs: [run] });
    const firstInput = createPersistPrArtifactInput();
    const conflictingInput = createPersistPrArtifactInput({
      artifact: {
        id: "pr_artifact_changed",
      },
    });

    await harness.persistPrArtifact(firstInput);
    const conflictingResult = await harness.persistPrArtifact(conflictingInput);

    expect(conflictingResult).toEqual({ status: "artifact_conflict" });
    expect(run).toMatchObject({
      changedPaths: firstInput.artifact.changedFilePaths,
      riskFindings: firstInput.artifact.riskFindings,
      updateCount: 1,
      updatedAt: firstInput.submittedAt,
    });
    expect(harness.prArtifacts).toEqual([toDrizzlePrArtifactRow(firstInput.artifact)]);
    expect(harness.insertCount).toBe(1);
    expect(harness.prArtifactUpdateCount).toBe(0);
    expect(harness.updateCount).toBe(1);
  });
});

describe("Drizzle validation result submission store", () => {
  test("returns concurrently inserted duplicate validation result ids after insert conflict", async () => {
    const input = createPersistValidationResultInput();
    const conflictResult = toDrizzleValidationResultRow(input.result);
    const harness = createDrizzleValidationResultStoreHarness({ conflictResult });

    const result = await harness.persistValidationResult(input);

    expect(result).toEqual({
      inserted: false,
      result: input.result,
      status: "stored",
    });
    expect(harness.validationSelectCount).toBe(2);
    expect(harness.transaction).toHaveBeenCalledTimes(1);
  });
});
