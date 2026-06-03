import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  TaskPacketSchema,
  type RepoPolicy,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import type {
  BuildRepairTaskPacketInput,
  PreviousRunForRepair,
  PreviousRunValidationSummary,
} from "./repair-requests";

vi.mock("server-only", () => ({}));

const importBuilder = async () => import("./build-repair-packet");

const requestedAt = new Date("2026-05-23T12:30:00.000Z");

const originalValidationCommand: ValidationCommand = {
  command: "pnpm --filter @control-plane/web typecheck",
  id: "web-typecheck",
  label: "Web typecheck",
  required: true,
  timeoutSeconds: 180,
};

const validationCommand: ValidationCommand = {
  command: "pnpm --filter @control-plane/web test",
  id: "web-test",
  label: "Web tests",
  required: true,
  timeoutSeconds: 240,
};

const createPolicy = (
  validationCommands: ValidationCommand[],
  maxChangedFiles = 20,
): RepoPolicy => ({
  allowUntrackedFiles: true,
  contractVersion: CONTRACT_VERSION,
  dryRunChecks: [
    "repo_path_exists",
    "git_repository",
    "repo_clean",
    "repo_policy_exists_and_parses",
    "validation_commands_configured",
  ],
  maxChangedFiles,
  maxDiffLines: 400,
  protectedBranches: ["main"],
  protectedPaths: ["infra/**"],
  sensitivePaths: [".env", ".env.*", "local.env", "*.local.env"],
  validationCommands,
  warningPaths: {
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
    infrastructure: ["infra/**"],
    migrations: ["packages/db/migrations/**"],
    packageLocks: ["pnpm-lock.yaml"],
  },
});

const originalPolicy = createPolicy([originalValidationCommand], 99);
const policySnapshot = createPolicy([validationCommand], 12);

const previousTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  TaskPacketSchema.parse({
    acceptanceCriteria: [
      "Reviewer can request a repair.",
      "Repair jobs preserve the original acceptance criteria.",
    ],
    context: {
      files: ["apps/web/src/repairs/repair-requests.ts"],
      notes: ["Original task context should not be needed for repair reconstruction."],
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: "2026-05-23T11:00:00.000Z",
    id: "task_packet_previous",
    mode: "execute",
    objective: "Add the repair request flow.",
    policy: originalPolicy,
    repo: {
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      targetBranch: "aicp/manual-task-145-run-previous",
      worktreePath: "/tmp/stale-worktree",
    },
    repositoryId: "repo_mapping_1",
    runId: "run_previous",
    source: {
      externalId: "manual_task_145",
      title: "Add repair request model",
      type: "manual",
    },
    validation: {
      commands: [originalValidationCommand],
    },
    workspaceId: "workspace_1",
    ...overrides,
  });

const validationSummary = (
  overrides: Partial<PreviousRunValidationSummary> = {},
): PreviousRunValidationSummary => ({
  commandId: "web-typecheck",
  commandLabel: "Web typecheck",
  durationMs: 15_000,
  exitCode: 1,
  finishedAt: new Date("2026-05-23T11:08:15.000Z"),
  redactionApplied: true,
  startedAt: new Date("2026-05-23T11:08:00.000Z"),
  status: "failed",
  stderrSummary: "TypeScript reported a repair packet builder type mismatch after redaction.",
  stdoutSummary: "No raw output retained. One validation command failed.",
  ...overrides,
});

const previousRunForRepair = (
  overrides: Partial<PreviousRunForRepair> = {},
): PreviousRunForRepair => ({
  attemptCount: 0,
  changedPaths: [
    "apps/web/src/repairs/repair-requests.ts",
    "apps/web/src/server/source-conventions.test.ts",
  ],
  contractVersion: CONTRACT_VERSION,
  id: "run_previous",
  jobId: "job_previous",
  maxAttempts: 1,
  mode: "execute",
  policySnapshot: originalPolicy,
  repoMappingId: "repo_mapping_1",
  state: "awaiting_approval",
  taskId: "task_145",
  taskPacket: previousTaskPacket(),
  validationCommands: [originalValidationCommand],
  validationSummaries: [validationSummary()],
  workspaceId: "workspace_1",
  ...overrides,
});

const buildPacket = async (
  previousRun: PreviousRunForRepair = previousRunForRepair(),
  overrides: Partial<BuildRepairTaskPacketInput> = {},
) => {
  const { buildRepairTaskPacket } = await importBuilder();

  return buildRepairTaskPacket({
    attempt: 1,
    feedback: "Please preserve the original validation contract while fixing the blocker.",
    maxAttempts: 2,
    previousRun,
    queuedRunId: "run_repair_1",
    repairRequestId: "repair_request_1",
    requestedAt,
    workspaceId: "workspace_1",
    ...overrides,
  });
};

const collectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }

    return keys;
  }

  if (typeof value !== "object" || value === null) {
    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    keys.push(key);
    collectKeys(childValue, keys);
  }

  return keys;
};

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

describe("buildRepairTaskPacket", () => {
  test("builds a schema-valid repair packet from the previous run and safe repair context", async () => {
    const previousRun = previousRunForRepair();
    const previousPacket = previousRun.taskPacket;

    if (previousPacket === null) {
      throw new Error("Test fixture requires a previous task packet.");
    }

    const packet = await buildPacket(previousRun);

    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet).toMatchObject({
      acceptanceCriteria: previousPacket.acceptanceCriteria,
      contractVersion: CONTRACT_VERSION,
      createdAt: requestedAt.toISOString(),
      mode: "repair",
      objective: previousPacket.objective,
      policy: originalPolicy,
      repositoryId: previousPacket.repositoryId,
      runId: "run_repair_1",
      source: {
        externalId: "repair_request_1",
        title: "Repair request for Add repair request model",
        type: "repair",
      },
      validation: {
        commands: [originalValidationCommand],
      },
      workspaceId: "workspace_1",
    });
    expect(packet.repair).toEqual({
      attempt: 1,
      feedback: "Please preserve the original validation contract while fixing the blocker.",
      maxAttempts: 2,
      previousRunId: "run_previous",
    });
    expect(packet.repo).toEqual({
      defaultBranch: previousPacket.repo.defaultBranch,
      localPath: previousPacket.repo.localPath,
      targetBranch: previousPacket.repo.targetBranch,
    });
    expect(packet.context.files).toEqual([
      "apps/web/src/repairs/repair-requests.ts",
      "apps/web/src/server/source-conventions.test.ts",
    ]);

    const notes = packet.context.notes.join("\n");
    expect(notes).toContain("Previous run: run_previous");
    expect(notes).toContain("Validation Web typecheck failed with exit code 1");
    expect(notes).toContain("duration 15000ms");
    expect(notes).toContain(
      "Output summary: No raw output retained. One validation command failed.",
    );
    expect(notes).toContain(
      "Error summary: TypeScript reported a repair packet builder type mismatch after redaction.",
    );
    expect(notes).not.toContain(validationCommand.command);
    expect(notes).not.toMatch(/\bstdout\b|\bstderr\b/);
    expect(JSON.stringify(packet)).not.toContain("/tmp/stale-worktree");
  });

  test("rejects missing or invalid previous task packets", async () => {
    await expect(buildPacket(previousRunForRepair({ taskPacket: null }))).rejects.toMatchObject({
      code: "validation_error",
    });
    await expect(
      buildPacket(
        previousRunForRepair({
          taskPacket: {
            ...previousTaskPacket(),
            contractVersion: "wrong-version",
          } as unknown as TaskPacket,
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("prefers previous run policy and validation command snapshots over the original packet", async () => {
    const packet = await buildPacket(
      previousRunForRepair({
        policySnapshot,
        validationCommands: [validationCommand],
      }),
    );

    expect(packet.policy).toEqual(policySnapshot);
    expect(packet.validation.commands).toEqual([validationCommand]);
  });

  test("rejects unsafe text copied from previous run policy and validation command snapshots", async () => {
    await expect(
      buildPacket(
        previousRunForRepair({
          policySnapshot: createPolicy([
            {
              ...validationCommand,
              label: "const leakedValue = true;",
            },
          ]),
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });

    await expect(
      buildPacket(
        previousRunForRepair({
          validationCommands: [
            {
              ...validationCommand,
              label: "const leakedValue = true;",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("preserves external repository ids from the previous task packet", async () => {
    const packet = await buildPacket(
      previousRunForRepair({
        repoMappingId: "repo_mapping_1",
        taskPacket: previousTaskPacket({
          repositoryId: "rory/control-plane",
        }),
      }),
    );

    expect(packet.repositoryId).toBe("rory/control-plane");
  });

  test("falls back to the previous task packet policy and validation commands when run snapshots are missing", async () => {
    const packet = await buildPacket(
      previousRunForRepair({
        policySnapshot: null,
        validationCommands: null,
      }),
    );

    expect(packet.policy).toEqual(originalPolicy);
    expect(packet.validation.commands).toEqual([originalValidationCommand]);
  });

  test.each([
    [
      "run id",
      previousRunForRepair({
        id: "run_other",
      }),
    ],
    [
      "workspace id",
      previousRunForRepair({
        workspaceId: "workspace_other",
      }),
    ],
    [
      "task packet workspace id",
      previousRunForRepair({
        taskPacket: previousTaskPacket({ workspaceId: "workspace_other" }),
      }),
    ],
    [
      "mode",
      previousRunForRepair({
        mode: "repair",
      }),
    ],
  ])("rejects inconsistent previous run %s metadata", async (_label, previousRun) => {
    await expect(buildPacket(previousRun)).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  test("rejects unsafe text copied from the previous task packet", async () => {
    await expect(
      buildPacket(
        previousRunForRepair({
          taskPacket: previousTaskPacket({
            acceptanceCriteria: ["Do not include diff --git a/app.ts b/app.ts in repair packets."],
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      buildPacket(
        previousRunForRepair({
          taskPacket: previousTaskPacket({
            objective:
              "Repair by applying export function readSecret() { return process.env.TOKEN; }",
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test.each([
    ["raw diff", "diff --git a/app.ts b/app.ts"],
    ["patch hunk", "@@ -1,3 +1,4 @@"],
    ["patch text", "Please apply this patch to the previous changes."],
    ["fenced source", "```ts\nconst value = true;\n```"],
    ["source-like addition line", "+ const value = true;"],
    ["source-like snippet", "function repair() { return true; }"],
    ["private key", "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----"],
  ])("rejects repair feedback containing %s when called directly", async (_label, feedback) => {
    await expect(buildPacket(previousRunForRepair(), { feedback })).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  test.each([
    "/absolute/path.ts",
    "../outside.ts",
    "apps/../outside.ts",
    "C:\\repo\\file.ts",
    "C:repo/file.ts",
    "apps\\web\\file.ts",
    ".env",
    ".env.production",
    "config/.env.local",
    "local.env",
    "apps/web.local.env",
  ])("rejects unsafe changed path %s", async (changedPath) => {
    await expect(
      buildPacket(previousRunForRepair({ changedPaths: [changedPath] })),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test.each([
    ["raw diff", "diff --git a/app.ts b/app.ts"],
    ["patch hunk", "@@ -1,3 +1,4 @@"],
    ["patch text", "patches/repair.patch"],
    ["source-like snippet", "export function readSecret() { return process.env.TOKEN; }"],
    ["interface snippet", "interface SecretConfig { apiKey: string }"],
    ["type alias snippet", "type Credentials = { token: string }"],
    ["private key marker", "src/-----BEGIN PRIVATE KEY-----.ts"],
    ["provider token", "src/ghp_abcdefghijklmnopqrstuvwxyz123456.ts"],
    ["unredacted assignment", "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"],
  ])("rejects changed path containing %s", async (_label, changedPath) => {
    await expect(
      buildPacket(previousRunForRepair({ changedPaths: [changedPath] })),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test.each([
    ["raw diff", "diff --git a/app.ts b/app.ts"],
    ["patch hunk", "@@ -1,3 +1,4 @@"],
    ["source-like snippet", "export function readSecret() { return process.env.TOKEN; }"],
    ["interface snippet", "interface SecretConfig { apiKey: string }"],
    ["type alias snippet", "type Credentials = { token: string }"],
    ["private key", "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----"],
    ["provider token", "ghp_abcdefghijklmnopqrstuvwxyz123456"],
    ["unredacted assignment", "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"],
    ["raw output label", "Raw output: full validation command output"],
    ["lowercase raw output label", "raw output: full validation command output"],
  ])("rejects validation summaries containing %s", async (_label, unsafeSummary) => {
    await expect(
      buildPacket(
        previousRunForRepair({
          validationSummaries: [validationSummary({ stdoutSummary: unsafeSummary })],
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("rejects validation summary command labels containing source-like text", async () => {
    await expect(
      buildPacket(
        previousRunForRepair({
          validationSummaries: [
            validationSummary({
              commandLabel: "const leakedValue = true;",
            }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("serializes repair packets without unsafe payload keys or raw artifact text", async () => {
    const packet = await buildPacket();
    const unsafeKeys = new Set([
      "content",
      "diff",
      "patch",
      "rawoutput",
      "snippet",
      "sourcecode",
      "stderr",
      "stdout",
    ]);
    const normalizedKeys = collectKeys(packet).map(normalizeKey);

    for (const key of unsafeKeys) {
      expect(normalizedKeys).not.toContain(key);
    }

    const serializedPacket = JSON.stringify(packet);

    expect(serializedPacket).not.toMatch(
      /diff --git|@@ -\d|\bpatch\b|sourceCode|\bstdout\b|\bstderr\b|-----BEGIN|ghp_|OPENAI_API_KEY=|\.env=/i,
    );
  });
});
