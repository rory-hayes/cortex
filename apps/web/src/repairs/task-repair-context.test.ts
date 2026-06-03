import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importContext = async () => import("./task-repair-context");

type StoreMembershipInput = {
  userId: string;
  workspaceId: string;
};

type StoreListInput = {
  taskIds: string[];
  workspaceId: string;
};

type RepairContextRow = {
  attemptCount: number;
  maxAttempts: number;
  prNumber: number | null;
  prStatus: "closed" | "draft" | "merged" | "open" | null;
  prUrl: string | null;
  runId: string;
  runState: "awaiting_approval" | "repair_requested";
  taskId: string;
  validationResultId: string | null;
  validationStatus: "cancelled" | "failed" | "passed" | "skipped" | null;
  workspaceId: string;
};

const createRow = (overrides: Partial<RepairContextRow> = {}): RepairContextRow => ({
  attemptCount: 1,
  maxAttempts: 2,
  prNumber: 42,
  prStatus: "open",
  prUrl: "https://github.com/rory/control-plane/pull/42",
  runId: "run_previous_1",
  runState: "awaiting_approval",
  taskId: "cortex_task_1",
  validationResultId: "validation_result_1",
  validationStatus: "failed",
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (rows: RepairContextRow[]) => ({
  findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }: StoreMembershipInput) =>
    userId === "user_1" && workspaceId === "workspace_1"
      ? { id: "membership_1", role: "member" }
      : null,
  ),
  listCortexTaskRepairContextRows: vi.fn(async ({ taskIds, workspaceId }: StoreListInput) =>
    rows.filter(
      (row) =>
        row.workspaceId === workspaceId &&
        (taskIds.length === 0 || taskIds.includes(String(row.taskId))),
    ),
  ),
});

describe("Cortex Task repair context service", () => {
  test("aggregates safe repair request context by task without exposing validation output", async () => {
    const { createCortexTaskRepairContextService } = await importContext();
    const store = createStore([
      createRow(),
      createRow({
        validationResultId: "validation_result_2",
        validationStatus: "passed",
      }),
    ]);
    const service = createCortexTaskRepairContextService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listCortexTaskRepairContexts({
        taskIds: [" cortex_task_1 "],
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      cortex_task_1: {
        attemptCount: 1,
        canRequestRepair: true,
        disabledReason: null,
        maxAttempts: 2,
        nextAttempt: 2,
        previousRunId: "run_previous_1",
        pr: {
          number: 42,
          status: "open",
          url: "https://github.com/rory/control-plane/pull/42",
        },
        remainingAttempts: 1,
        taskId: "cortex_task_1",
        validationEvidence: {
          statusCounts: [
            { count: 1, status: "failed" },
            { count: 1, status: "passed" },
          ],
          totalCount: 2,
        },
      },
    });
    expect(store.listCortexTaskRepairContextRows).toHaveBeenCalledWith({
      taskIds: ["cortex_task_1"],
      workspaceId: "workspace_1",
    });
  });

  test("respects repair attempt limits and drops unsafe PR URLs", async () => {
    const { createCortexTaskRepairContextService } = await importContext();
    const store = createStore([
      createRow({
        attemptCount: 2,
        maxAttempts: 2,
        prUrl: "https://github.com/rory/control-plane/pull/42?token=unsafe",
        validationResultId: "validation_result_limit",
      }),
    ]);
    const service = createCortexTaskRepairContextService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const contexts = await service.listCortexTaskRepairContexts({
      taskIds: ["cortex_task_1"],
      workspaceId: "workspace_1",
    });

    expect(contexts.cortex_task_1).toMatchObject({
      canRequestRepair: false,
      disabledReason: "Repair attempt limit reached.",
      nextAttempt: 3,
      pr: {
        number: 42,
        status: "open",
        url: null,
      },
      remainingAttempts: 0,
    });
    expect(JSON.stringify(contexts)).not.toMatch(
      /token=unsafe|stdout|stderr|raw output|diff --git|patch|sourceCode|secret/i,
    );
  });
});
