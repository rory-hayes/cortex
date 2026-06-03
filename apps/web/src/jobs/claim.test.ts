import { describe, expect, test, vi } from "vitest";

import {
  ClaimJobResponseSchema,
  CONTRACT_VERSION,
  RunEventSchema,
  RunnerCapabilitiesSchema,
  createClaimJobIdempotencyKey,
  type RunEvent,
  type ClaimJobRequest,
  type RepoPolicy,
  type RiskFinding,
  type RunnerCapabilities,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";
import { schema } from "@control-plane/db";

import {
  ClaimJobRequestError,
  RUNNER_JOB_CLAIM_TTL_MS,
  createClaimJobService,
  createDrizzleClaimJobStore,
  isClaimJobRequestError,
  type ClaimJobStore,
  type ClaimRunRow,
} from "./claim.js";

const now = new Date("2026-05-23T09:00:00.000Z");
const claimExpiresAt = new Date(now.getTime() + RUNNER_JOB_CLAIM_TTL_MS);

const validationCommand: ValidationCommand = {
  id: "test",
  label: "Unit tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
};

const policy: RepoPolicy = {
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["infra/**"],
  sensitivePaths: [".env", ".env.*"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["packages/db/migrations/**"],
    infrastructure: ["infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [validationCommand],
  maxChangedFiles: 20,
  maxDiffLines: 400,
  allowUntrackedFiles: true,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
  ],
};

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    runnerId: "runner_1",
    os: {
      platform: "darwin",
      release: "25.5.0",
      arch: "arm64",
    },
    shell: "/bin/zsh",
    tools: {
      codex: {
        available: true,
        path: "/opt/homebrew/bin/codex",
        version: "0.12.0",
      },
      gh: {
        available: true,
        path: "/opt/homebrew/bin/gh",
        version: "2.72.0",
      },
      git: {
        available: true,
        path: "/usr/bin/git",
        version: "2.49.0",
      },
      pnpm: {
        available: true,
        path: "/opt/homebrew/bin/pnpm",
        version: "10.11.0",
      },
    },
    maxConcurrentJobs: 1,
    reportedAt: "2026-05-23T08:59:30.000Z",
    supportsCancellation: true,
    supportsDryRun: true,
    ...overrides,
  });

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "packet_1",
  workspaceId: "workspace_1",
  repositoryId: "repo_mapping_1",
  runId: "run_1",
  mode: "execute",
  objective: "Update queue metadata for the local runner.",
  acceptanceCriteria: ["The runner can claim a metadata-only queued job."],
  source: {
    type: "manual",
    title: "Claim queued runner job",
  },
  repo: {
    localPath: "/repos/control-plane",
    defaultBranch: "main",
    targetBranch: "aicp/claim-queued-runner-job",
  },
  context: {
    files: ["apps/web/src/jobs/claim.ts"],
    notes: ["Use path references only."],
  },
  policy,
  validation: {
    commands: [validationCommand],
  },
  createdAt: "2026-05-23T08:59:00.000Z",
  ...overrides,
});

const createRequest = (overrides: Partial<ClaimJobRequest> = {}): ClaimJobRequest => {
  const runnerId = overrides.runnerId ?? "runner_1";
  const jobId = overrides.jobId ?? "job_1";
  const runId = overrides.runId ?? "run_1";

  return {
    contractVersion: CONTRACT_VERSION,
    runnerId,
    jobId,
    runId,
    idempotencyKey: createClaimJobIdempotencyKey({ jobId, runId, runnerId }),
    capabilitiesSnapshot: validCapabilities({ runnerId }),
    ...overrides,
  };
};

const runRow = (overrides: Partial<ClaimRunRow> = {}): ClaimRunRow =>
  ({
    capabilitiesSnapshot: null,
    claimExpiresAt: null,
    claimIdempotencyKey: null,
    claimedAt: null,
    id: "run_1",
    jobId: "job_1",
    repoMappingId: "repo_mapping_1",
    riskFindings: [],
    runnerId: null,
    state: "queued",
    taskPacket: validTaskPacket(),
    updatedAt: new Date("2026-05-23T08:55:00.000Z"),
    workspaceId: "workspace_1",
    ...overrides,
  }) as ClaimRunRow;

type ClaimRepoMappingRow = {
  archivedAt: Date | null;
  defaultBranch: string | null;
  id: string;
  localPath: string | null;
  runnerId: string | null;
  workspaceId: string;
};

const repoMapping = (overrides: Partial<ClaimRepoMappingRow> = {}): ClaimRepoMappingRow => ({
  archivedAt: null,
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/repos/control-plane",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const workspaceUsageRow = (overrides: Partial<typeof schema.workspaces.$inferSelect> = {}) => ({
  createdAt: new Date("2026-05-23T08:00:00.000Z"),
  id: "workspace_1",
  monthlyRunLimit: 10_000,
  name: "Control Plane",
  plan: "mvp",
  repoLimit: 25,
  runnerLimit: 10,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  updatedAt: new Date("2026-05-23T08:55:00.000Z"),
  usageCount: 7,
  ...overrides,
});

const hasUsableRepoMapping = (
  mapping: ClaimRepoMappingRow | undefined,
): mapping is ClaimRepoMappingRow & {
  defaultBranch: string;
  localPath: string;
  runnerId: string;
} =>
  mapping !== undefined &&
  mapping.archivedAt === null &&
  typeof mapping.defaultBranch === "string" &&
  mapping.defaultBranch.trim().length > 0 &&
  typeof mapping.localPath === "string" &&
  mapping.localPath.trim().length > 0 &&
  typeof mapping.runnerId === "string" &&
  mapping.runnerId.trim().length > 0;

const createStore = (
  input: ClaimRunRow[] | { repoMappings?: ClaimRepoMappingRow[]; runs?: ClaimRunRow[] } = [
    runRow(),
  ],
): ClaimJobStore & {
  claimRun: ReturnType<typeof vi.fn<ClaimJobStore["claimRun"]>>;
  claimMutations: number;
  recordDuplicateAssignmentBlock: ReturnType<
    typeof vi.fn<ClaimJobStore["recordDuplicateAssignmentBlock"]>
  >;
  repoMappings: ClaimRepoMappingRow[];
  runEvents: RunEvent[];
  runs: ClaimRunRow[];
  usageCount: number;
  usageUpdates: number;
} => {
  const runs = Array.isArray(input) ? input : (input.runs ?? [runRow()]);
  const repoMappings = Array.isArray(input)
    ? [repoMapping()]
    : (input.repoMappings ?? [repoMapping()]);
  const store = {
    claimMutations: 0,
    repoMappings,
    runEvents: [] as RunEvent[],
    runs,
    usageCount: 7,
    usageUpdates: 0,
    claimRun: vi.fn(async (input) => {
      const run = runs.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.id === input.runId &&
          candidate.jobId === input.jobId,
      );

      if (run === undefined || run.state !== "queued" || run.claimIdempotencyKey !== null) {
        return {
          run: run ?? null,
          status: "miss" as const,
        };
      }

      const mapping = store.repoMappings.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId && candidate.id === run.repoMappingId,
      );

      if (hasUsableRepoMapping(mapping) && mapping.runnerId !== input.runnerId) {
        return {
          run,
          status: "miss" as const,
        };
      }

      const taskPacket = run.taskPacket as Partial<TaskPacket> | null | undefined;
      const mappingIsEligible =
        hasUsableRepoMapping(mapping) &&
        mapping.runnerId === input.runnerId &&
        taskPacket !== null &&
        taskPacket !== undefined &&
        taskPacket.runId === run.id &&
        (taskPacket.workspaceId === undefined || taskPacket.workspaceId === run.workspaceId) &&
        taskPacket.repo?.localPath === mapping.localPath &&
        taskPacket.repo?.defaultBranch === mapping.defaultBranch;

      if (!mappingIsEligible) {
        run.state = "blocked";
        run.riskFindings = [
          ...((run.riskFindings as RiskFinding[] | null | undefined) ?? []).filter(
            (riskFinding) => riskFinding.id !== input.missingMappingFinding.id,
          ),
          input.missingMappingFinding,
        ];
        run.updatedAt = input.updatedAt;

        return {
          run,
          status: "blocked_missing_mapping" as const,
        };
      }

      run.state = "claimed";
      run.runnerId = input.runnerId;
      run.claimIdempotencyKey = input.idempotencyKey;
      run.capabilitiesSnapshot = input.capabilitiesSnapshot;
      run.claimedAt = input.claimedAt;
      run.claimExpiresAt = input.claimExpiresAt;
      run.updatedAt = input.updatedAt;
      store.claimMutations += 1;
      if (taskPacket.mode !== "dryRun") {
        store.usageCount += 1;
        store.usageUpdates += 1;
      }

      return {
        run,
        status: "claimed" as const,
      };
    }),
    recordDuplicateAssignmentBlock: vi.fn(async ({ event }) => {
      const parsedEvent = RunEventSchema.parse(event);
      const existingEvent = store.runEvents.find(
        (candidate) =>
          candidate.runId === parsedEvent.runId &&
          candidate.idempotencyKey === parsedEvent.idempotencyKey,
      );

      if (existingEvent === undefined) {
        store.runEvents.push(parsedEvent);
      }
    }),
  };

  return store;
};

const createService = (store: ClaimJobStore) =>
  createClaimJobService({
    now: () => now,
    store,
  });

const expectInvalidRequest = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toBeInstanceOf(ClaimJobRequestError);
  await expect(promise).rejects.toSatisfy(isClaimJobRequestError);
  await expect(promise).rejects.toMatchObject({
    code: "invalid_request",
  });
};

const collectUnsafeKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUnsafeKeys(item, keys));

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      [
        "authorization",
        "bearer",
        "credential",
        "credentialhash",
        "diff",
        "filecontent",
        "filecontents",
        "logs",
        "output",
        "patch",
        "rawdiff",
        "rawlog",
        "rawoutput",
        "rawpatch",
        "rawstderr",
        "rawstdout",
        "rawsource",
        "privatekey",
        "secret",
        "snippet",
        "snippets",
        "source",
        "sourcecode",
        "token",
      ].includes(normalizedKey)
    ) {
      keys.push(key);
    }

    collectUnsafeKeys(childValue, keys);
  }

  return keys;
};

const containsInspectableText = (
  value: unknown,
  searchText: string,
  seen = new WeakSet<object>(),
  depth = 0,
): boolean => {
  if (typeof value === "string") {
    return value.toLowerCase().includes(searchText.toLowerCase());
  }

  if (typeof value === "symbol") {
    return (value.description ?? "").toLowerCase().includes(searchText.toLowerCase());
  }

  if (typeof value !== "object" || value === null || depth > 8 || seen.has(value)) {
    return false;
  }

  seen.add(value);

  for (const propertyName of Object.getOwnPropertyNames(value)) {
    if (propertyName.toLowerCase().includes(searchText.toLowerCase())) {
      return true;
    }

    if (
      containsInspectableText(
        (value as Record<string, unknown>)[propertyName],
        searchText,
        seen,
        depth + 1,
      )
    ) {
      return true;
    }
  }

  for (const propertySymbol of Object.getOwnPropertySymbols(value)) {
    if (containsInspectableText(propertySymbol, searchText, seen, depth + 1)) {
      return true;
    }

    if (
      containsInspectableText(
        (value as Record<PropertyKey, unknown>)[propertySymbol],
        searchText,
        seen,
        depth + 1,
      )
    ) {
      return true;
    }
  }

  return false;
};

const renderSqlConditionText = (condition: unknown): string => {
  if (
    typeof condition !== "object" ||
    condition === null ||
    typeof (condition as { toQuery?: unknown }).toQuery !== "function"
  ) {
    return "";
  }

  try {
    return (condition as { toQuery: (config: unknown) => { sql: string } }).toQuery({
      casing: {
        getColumnCasing: (column: { name?: string }) => column.name ?? "",
      },
      escapeName: (name: string) => `"${name}"`,
      escapeParam: () => "?",
      escapeString: (value: string) => value.replaceAll("'", "''"),
      paramStartIndex: {
        value: 0,
      },
    }).sql;
  } catch {
    return "";
  }
};

describe("claim job service", () => {
  test("invalid claim requests throw ClaimJobRequestError before mutation", async () => {
    const store = createStore();
    const service = createService(store);

    await expectInvalidRequest(
      service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: {
          contractVersion: CONTRACT_VERSION,
          runnerId: "runner_1",
          jobId: "job_1",
          runId: "run_1",
          idempotencyKey: "not-canonical",
          capabilitiesSnapshot: validCapabilities(),
        },
      }),
    );

    expect(store.claimRun).not.toHaveBeenCalled();
    expect(store.claimMutations).toBe(0);
    expect(store.usageUpdates).toBe(0);
  });

  test("request runner mismatch throws safely before mutation", async () => {
    const store = createStore();
    const service = createService(store);
    const request = createRequest({
      runnerId: "runner_2",
      capabilitiesSnapshot: validCapabilities({ runnerId: "runner_2" }),
      idempotencyKey: createClaimJobIdempotencyKey({
        jobId: "job_1",
        runId: "run_1",
        runnerId: "runner_2",
      }),
    });

    await expectInvalidRequest(
      service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request,
      }),
    );

    expect(store.claimRun).not.toHaveBeenCalled();
    expect(store.claimMutations).toBe(0);
    expect(store.usageUpdates).toBe(0);
  });

  test("capabilities snapshot runner mismatch throws safely before mutation", async () => {
    const store = createStore();
    const service = createService(store);

    await expectInvalidRequest(
      service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          capabilitiesSnapshot: validCapabilities({ runnerId: "runner_2" }),
        }),
      }),
    );

    expect(store.claimRun).not.toHaveBeenCalled();
    expect(store.claimMutations).toBe(0);
    expect(store.usageUpdates).toBe(0);
  });

  test("unsafe capabilities snapshot values throw safely before mutation", async () => {
    const store = createStore();
    const service = createService(store);
    const unsafeValue = "raw stdout: private command output";

    await expectInvalidRequest(
      service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: createRequest({
          capabilitiesSnapshot: {
            ...validCapabilities(),
            shell: unsafeValue,
          } as RunnerCapabilities,
        }),
      }),
    );

    expect(store.claimRun).not.toHaveBeenCalled();
    expect(store.claimMutations).toBe(0);
    expect(store.usageUpdates).toBe(0);
  });

  test("first claim atomically updates one queued run and returns a schema-valid claimed response", async () => {
    const run = runRow();
    const store = createStore({ runs: [run] });
    const service = createService(store);
    const request = createRequest();

    const response = await service.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request,
    });

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobId: "job_1",
      runId: "run_1",
      status: "claimed",
      claimedByRunnerId: "runner_1",
      claimExpiresAt: claimExpiresAt.toISOString(),
    });
    expect(ClaimJobResponseSchema.safeParse(response).success).toBe(true);
    expect(run).toMatchObject({
      capabilitiesSnapshot: request.capabilitiesSnapshot,
      claimExpiresAt,
      claimIdempotencyKey: request.idempotencyKey,
      claimedAt: now,
      runnerId: "runner_1",
      state: "claimed",
      updatedAt: now,
    });
    expect(store.claimRun).toHaveBeenCalledTimes(1);
    expect(store.claimMutations).toBe(1);
    expect(store.usageCount).toBe(8);
    expect(store.usageUpdates).toBe(1);
  });

  test.each([
    {
      expectedUsageCount: 7,
      expectedUsageUpdates: 0,
      mode: "dryRun" as const,
      taskPacket: validTaskPacket({ mode: "dryRun" }),
    },
    {
      expectedUsageCount: 8,
      expectedUsageUpdates: 1,
      mode: "repair" as const,
      taskPacket: validTaskPacket({
        mode: "repair",
        repair: {
          attempt: 1,
          feedback: "Retry validation after applying review feedback.",
          maxAttempts: 2,
          previousRunId: "run_previous",
        },
        source: {
          type: "repair",
          title: "Repair claimed runner job",
        },
      }),
    },
  ])("$mode claims apply the expected usage-counting policy", async (input) => {
    const run = runRow({ taskPacket: input.taskPacket });
    const store = createStore({ runs: [run] });
    const service = createService(store);

    const response = await service.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response.status).toBe("claimed");
    expect(store.claimMutations).toBe(1);
    expect(store.usageCount).toBe(input.expectedUsageCount);
    expect(store.usageUpdates).toBe(input.expectedUsageUpdates);
  });

  test("a runner cannot claim a queued job mapped to another active runner", async () => {
    const run = runRow();
    const store = createStore({
      repoMappings: [repoMapping({ runnerId: "runner_1" })],
      runs: [run],
    });
    const service = createService(store);
    const request = createRequest({
      runnerId: "runner_2",
      capabilitiesSnapshot: validCapabilities({ runnerId: "runner_2" }),
      idempotencyKey: createClaimJobIdempotencyKey({
        jobId: "job_1",
        runId: "run_1",
        runnerId: "runner_2",
      }),
    });

    const response = await service.claimJob({
      context: {
        runnerId: "runner_2",
        workspaceId: "workspace_1",
      },
      request,
    });

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobId: "job_1",
      runId: "run_1",
      status: "conflict",
      conflictReason: "not_claimable",
    });
    expect(ClaimJobResponseSchema.safeParse(response).success).toBe(true);
    expect(run).toMatchObject({
      capabilitiesSnapshot: null,
      claimExpiresAt: null,
      claimIdempotencyKey: null,
      claimedAt: null,
      runnerId: null,
      state: "queued",
    });
    expect(store.claimMutations).toBe(0);
    expect(store.usageCount).toBe(7);
    expect(store.usageUpdates).toBe(0);
  });

  test.each([
    {
      name: "missing mapping",
      repoMappings: [],
    },
    {
      name: "archived mapping",
      repoMappings: [repoMapping({ archivedAt: now })],
    },
    {
      name: "unusable mapping without local path",
      repoMappings: [repoMapping({ localPath: null })],
    },
    {
      name: "unusable mapping without default branch",
      repoMappings: [repoMapping({ defaultBranch: "" })],
    },
    {
      name: "task packet repo metadata mismatch",
      repoMappings: [repoMapping()],
      taskPacket: validTaskPacket({
        repo: {
          ...validTaskPacket().repo,
          localPath: "/repos/other",
        },
      }),
    },
  ])(
    "blocks a queued claim with a pathless missing_mapping finding for $name",
    async ({ repoMappings, taskPacket }) => {
      const run = runRow({
        riskFindings: [],
        taskPacket: taskPacket ?? validTaskPacket(),
      });
      const store = createStore({ repoMappings, runs: [run] });
      const service = createService(store);
      const request = createRequest();

      const response = await service.claimJob({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request,
      });

      expect(response).toEqual({
        contractVersion: CONTRACT_VERSION,
        jobId: "job_1",
        runId: "run_1",
        status: "conflict",
        conflictReason: "not_claimable",
      });
      expect(ClaimJobResponseSchema.safeParse(response).success).toBe(true);
      expect(run).toMatchObject({
        capabilitiesSnapshot: null,
        claimExpiresAt: null,
        claimIdempotencyKey: null,
        claimedAt: null,
        runnerId: null,
        state: "blocked",
      });
      expect(run.riskFindings).toEqual([
        {
          id: "risk:missing_mapping",
          severity: "blocked",
          category: "missing_mapping",
          message: expect.any(String),
          paths: [],
        },
      ]);
      expect(collectUnsafeKeys(response)).toEqual([]);
      expect(collectUnsafeKeys(run.riskFindings)).toEqual([]);
      expect(JSON.stringify(run.riskFindings)).not.toMatch(
        /\/repos|diff --git|raw|patch|snippet|secret|token|private key/i,
      );
      expect(store.claimMutations).toBe(0);
      expect(store.usageCount).toBe(7);
      expect(store.usageUpdates).toBe(0);
    },
  );

  test("retrying the same canonical claim returns already_claimed without a second mutation", async () => {
    const run = runRow();
    const store = createStore({ runs: [run] });
    const service = createService(store);
    const request = createRequest();

    await service.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request,
    });
    const retryResponse = await service.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request,
    });

    expect(retryResponse).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobId: "job_1",
      runId: "run_1",
      status: "already_claimed",
      claimedByRunnerId: "runner_1",
      claimExpiresAt: claimExpiresAt.toISOString(),
    });
    expect(ClaimJobResponseSchema.safeParse(retryResponse).success).toBe(true);
    expect(store.claimRun).toHaveBeenCalledTimes(2);
    expect(store.claimMutations).toBe(1);
    expect(store.usageCount).toBe(8);
    expect(store.usageUpdates).toBe(1);
    expect(run.claimedAt).toBe(now);
    expect(run.capabilitiesSnapshot).toEqual(request.capabilitiesSnapshot);
  });

  test("a different runner claiming an already claimed job receives conflict without mutation", async () => {
    const run = runRow();
    const store = createStore([run]);
    const firstService = createService(store);
    const secondService = createService(store);

    await firstService.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    const conflictResponse = await secondService.claimJob({
      context: {
        runnerId: "runner_2",
        workspaceId: "workspace_1",
      },
      request: createRequest({
        runnerId: "runner_2",
        capabilitiesSnapshot: validCapabilities({ runnerId: "runner_2" }),
        idempotencyKey: createClaimJobIdempotencyKey({
          jobId: "job_1",
          runId: "run_1",
          runnerId: "runner_2",
        }),
      }),
    });

    expect(conflictResponse).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobId: "job_1",
      runId: "run_1",
      status: "conflict",
      conflictReason: "already_claimed",
    });
    expect(ClaimJobResponseSchema.safeParse(conflictResponse).success).toBe(true);
    expect(store.claimRun).toHaveBeenCalledTimes(2);
    expect(store.claimMutations).toBe(1);
    expect(store.usageCount).toBe(8);
    expect(store.usageUpdates).toBe(1);
    expect(run.runnerId).toBe("runner_1");
    expect(run.claimIdempotencyKey).toBe(createRequest().idempotencyKey);
  });

  test("unknown workspace, job, or run returns schema-valid not_found", async () => {
    const store = createStore([
      runRow({
        id: "run_other",
        jobId: "job_other",
        workspaceId: "workspace_other",
      }),
    ]);
    const service = createService(store);

    const response = await service.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      jobId: "job_1",
      runId: "run_1",
      status: "not_found",
    });
    expect(ClaimJobResponseSchema.safeParse(response).success).toBe(true);
    expect(store.claimMutations).toBe(0);
    expect(store.usageCount).toBe(7);
    expect(store.usageUpdates).toBe(0);
  });

  test("claim responses never include task packet bodies, source, diffs, patches, logs, credentials, or capability secrets", async () => {
    const store = createStore([
      runRow({
        taskPacket: {
          objective: "diff --git a/secret b/secret",
          rawLogs: "Bearer runner-secret-credential",
          source: "do not serialize",
        },
      } as unknown as Partial<ClaimRunRow>),
    ]);
    const service = createService(store);

    const response = await service.claimJob({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: createRequest(),
    });
    const serialized = JSON.stringify(response);

    expect(ClaimJobResponseSchema.safeParse(response).success).toBe(true);
    expect(collectUnsafeKeys(response)).toEqual([]);
    expect(serialized).not.toMatch(
      /taskPacket|diff --git|rawLogs|Bearer|credential|secret|source|patch|logs?|token|capabilitiesSnapshot/i,
    );
  });

  test("drizzle store leaves workspace usage unchanged for dry-run claims", async () => {
    const updateTables: unknown[] = [];
    const dryRunPacket = validTaskPacket({ mode: "dryRun" });
    const select = vi.fn(() => {
      const rows =
        select.mock.calls.length === 1 ? [runRow({ taskPacket: dryRunPacket })] : [repoMapping()];

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
          })),
        })),
      };
    });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const update = vi.fn((table: unknown) => {
        updateTables.push(table);

        return {
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () =>
                table === schema.workspaces
                  ? [workspaceUsageRow({ updatedAt: now, usageCount: 8 })]
                  : [
                      runRow({
                        claimExpiresAt,
                        claimIdempotencyKey: createRequest().idempotencyKey,
                        claimedAt: now,
                        runnerId: "runner_1",
                        state: "claimed",
                        taskPacket: dryRunPacket,
                      }),
                    ],
              ),
            })),
          })),
        };
      });

      return callback({
        select,
        update,
      });
    });
    const store = createDrizzleClaimJobStore({ transaction } as never);

    const result = await store.claimRun({
      capabilitiesSnapshot: createRequest().capabilitiesSnapshot,
      claimExpiresAt,
      claimedAt: now,
      idempotencyKey: createRequest().idempotencyKey,
      jobId: "job_1",
      missingMappingFinding: {
        id: "risk:missing_mapping",
        severity: "blocked",
        category: "missing_mapping",
        message: "Runner job is blocked because an active usable repo mapping is required.",
        paths: [],
      },
      runId: "run_1",
      runnerId: "runner_1",
      updatedAt: now,
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("claimed");
    expect(updateTables).toEqual([schema.runs]);
  });

  test("drizzle store makes the claim update conditional on current repo mapping eligibility", async () => {
    const claimWherePredicates: unknown[] = [];
    const insertTables: unknown[] = [];
    const insertValues: unknown[] = [];
    const selectWherePredicates: unknown[] = [];
    const updateTables: unknown[] = [];
    const workspaceUsageSetValues: unknown[] = [];
    const select = vi.fn(() => {
      const rows = select.mock.calls.length === 1 ? [runRow()] : [repoMapping()];

      return {
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            selectWherePredicates.push(condition);

            return {
              limit: vi.fn(async () => rows),
            };
          }),
        })),
      };
    });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const update = vi.fn((table: unknown) => {
        updateTables.push(table);

        return {
          set: vi.fn((values: unknown) => {
            if (table === schema.workspaces) {
              workspaceUsageSetValues.push(values);
            }

            return {
              where: vi.fn((condition: unknown) => {
                if (table === schema.runs) {
                  claimWherePredicates.push(condition);
                }

                return {
                  returning: vi.fn(async () =>
                    table === schema.workspaces
                      ? [workspaceUsageRow({ updatedAt: now, usageCount: 8 })]
                      : [
                          runRow({
                            claimExpiresAt,
                            claimIdempotencyKey: createRequest().idempotencyKey,
                            claimedAt: now,
                            runnerId: "runner_1",
                            state: "claimed",
                          }),
                        ],
                  ),
                };
              }),
            };
          }),
        };
      });
      const insert = vi.fn((table: unknown) => {
        insertTables.push(table);

        return {
          values: vi.fn((values: unknown) => {
            insertValues.push(values);

            return {
              onConflictDoNothing: vi.fn(async () => undefined),
            };
          }),
        };
      });

      return callback({
        insert,
        select,
        update,
      });
    });
    const store = createDrizzleClaimJobStore({ transaction } as never);

    const result = await store.claimRun({
      capabilitiesSnapshot: createRequest().capabilitiesSnapshot,
      claimExpiresAt,
      claimedAt: now,
      idempotencyKey: createRequest().idempotencyKey,
      jobId: "job_1",
      missingMappingFinding: {
        id: "risk:missing_mapping",
        severity: "blocked",
        category: "missing_mapping",
        message: "Runner job is blocked because an active usable repo mapping is required.",
        paths: [],
      },
      runId: "run_1",
      runnerId: "runner_1",
      updatedAt: now,
      workspaceId: "workspace_1",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("claimed");
    expect(result.run?.state).toBe("claimed");
    expect(updateTables).toEqual([schema.runs, schema.workspaces]);
    expect(insertTables).toEqual([schema.usageEvents]);
    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toMatchObject({
      idempotencyKey: "usage:workspace_1:runner_execution:run_1",
      metadata: {
        mode: "execute",
      },
      modelUsageCategory: "runner_execution",
      quantity: 1,
      sourceId: "run_1",
      sourceTable: "runs",
      usageEventType: "runner_execution",
      workspaceId: "workspace_1",
    });
    expect(insertValues[0]).not.toHaveProperty("taskPacket");
    expect(insertValues[0]).not.toHaveProperty("capabilitiesSnapshot");
    expect(workspaceUsageSetValues).toHaveLength(1);
    expect(Object.keys(workspaceUsageSetValues[0] as Record<string, unknown>).sort()).toEqual([
      "updatedAt",
      "usageCount",
    ]);
    expect(workspaceUsageSetValues[0]).not.toHaveProperty("runId");
    expect(workspaceUsageSetValues[0]).not.toHaveProperty("jobId");
    expect(workspaceUsageSetValues[0]).not.toHaveProperty("runnerId");
    expect(workspaceUsageSetValues[0]).not.toHaveProperty("capabilitiesSnapshot");
    expect(workspaceUsageSetValues[0]).not.toHaveProperty("taskPacket");
    expect(claimWherePredicates).toHaveLength(1);
    const claimUpdateWhereSql = claimWherePredicates.map(renderSqlConditionText).join("\n");

    expect(claimUpdateWhereSql).toMatch(/\bexists\b/i);
    const updateGuardPredicates = selectWherePredicates.filter(
      (predicate) =>
        containsInspectableText(predicate, "repo_mappings") &&
        containsInspectableText(predicate, "archived_at") &&
        containsInspectableText(predicate, "default_branch") &&
        containsInspectableText(predicate, "local_path") &&
        containsInspectableText(predicate, "repo_mapping_id") &&
        containsInspectableText(predicate, "runner_id"),
    );

    expect(updateGuardPredicates).toHaveLength(1);
    expect(
      selectWherePredicates.some((predicate) =>
        containsInspectableText(predicate, "repo_mappings"),
      ),
    ).toBe(true);
    expect(
      selectWherePredicates.some((predicate) => containsInspectableText(predicate, "archived_at")),
    ).toBe(true);
    expect(
      selectWherePredicates.some((predicate) =>
        containsInspectableText(predicate, "default_branch"),
      ),
    ).toBe(true);
    expect(
      selectWherePredicates.some((predicate) => containsInspectableText(predicate, "local_path")),
    ).toBe(true);
    expect(
      selectWherePredicates.some((predicate) => containsInspectableText(predicate, "runner_id")),
    ).toBe(true);
  });
});
