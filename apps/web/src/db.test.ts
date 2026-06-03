import { describe, expect, test, vi } from "vitest";

import { REPO_EXECUTION_READINESS_STATUSES, REPO_SCAN_STATUSES } from "@control-plane/shared";

vi.mock("server-only", () => ({}));

describe("web database facade", () => {
  test("re-exports repo scan table and status enum for web consumers", async () => {
    const db = await import("./db");

    expect(db.repoScans).toBeDefined();
    expect(db.repoScanStatusEnum.enumValues).toEqual([...REPO_SCAN_STATUSES]);
  });

  test("re-exports repo readiness report table and execution readiness enum", async () => {
    const db = await import("./db");

    expect(db.repoReadinessReports).toBeDefined();
    expect(db.repoExecutionReadinessEnum.enumValues).toEqual([
      ...REPO_EXECUTION_READINESS_STATUSES,
    ]);
  });

  test("re-exports finding-task relationship table for repo-readiness lookups", async () => {
    const db = await import("./db");

    expect(db.findingTaskLinks).toBeDefined();
  });
});
