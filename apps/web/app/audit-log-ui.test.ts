import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { AuditLogRow } from "../src/audit-log/list";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const createRow = (overrides: Partial<AuditLogRow> = {}): AuditLogRow => ({
  actorId: "user_1",
  category: "runner",
  details: [
    { label: "Runner", value: "runner_1" },
    { label: "Pairing", value: "pairing_1" },
  ],
  eventType: "runner.linked",
  id: "audit:audit_1",
  message: "Runner linked.",
  occurredAt: new Date("2026-05-23T10:00:00.000Z"),
  runId: null,
  runnerId: "runner_1",
  severity: "info",
  source: "audit_event",
  sourceLabel: "Audit event",
  taskId: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const expectNoUnsafeDisplayMaterial = (html: string) => {
  expect(html).not.toMatch(
    /JSON\.stringify|raw metadata|credentialHash|credential_hash|pairingCodeHash|runnerCredential|diff --git|@@|raw source|source code|raw patch|raw logs|rawOutput|snippet|secret=|token=|\/Users\/rory|\/private\/tmp|ghp_|sk-test|stdout|stderr/i,
  );
};

const expectNoUnsafeSourceMaterial = (source: string) => {
  expect(source).not.toMatch(
    /JSON\.stringify|row\.metadata(?!Summary)|metadata={|credentialHash|credential_hash|pairingCodeHash|runnerCredential|diff --git|raw source|source code|raw patch|raw logs|rawOutput|snippet|secret|token|stdout|stderr/i,
  );
};

describe("audit log UI source conventions", () => {
  test("renders audit rows, counts, link filters, and metadata summary chips", async () => {
    const { AuditLogTable } = await import("../components/audit-log-table");
    const runnerRow = createRow();
    const policyRow = createRow({
      category: "policy",
      details: [
        { label: "Risk", value: "protected path" },
        { label: "Job", value: "job_1" },
      ],
      eventType: "run.blocked",
      id: "run-event:event_1",
      message: "Policy block recorded.",
      runId: "run_1",
      runnerId: "runner_2",
      severity: "blocked",
      source: "run_event",
      sourceLabel: "Run event",
      taskId: "task_1",
    });
    const approvalRow = createRow({
      actorId: "user_2",
      category: "approval",
      details: [
        { label: "Decision", value: "approve" },
        { label: "Reason length", value: "18" },
      ],
      eventType: "run.approval_decision_recorded",
      id: "audit:audit_approval",
      message: "Approval decision recorded.",
      runId: "run_2",
      runnerId: null,
    });

    const html = renderToStaticMarkup(
      createElement(AuditLogTable, {
        categoryFilter: "all",
        rows: [runnerRow, policyRow, approvalRow],
      }),
    );

    expect(html).toContain("3 audit events");
    expect(html).toContain("Policy blocks");
    expect(html).toContain("1 blocked");
    expect(html).toContain("Runner linked.");
    expect(html).toContain("Policy block recorded.");
    expect(html).toContain("Approval decision recorded.");
    expect(html).toContain("Source");
    expect(html).toContain("Audit event");
    expect(html).toContain("Run event");
    expect(html).toContain("Task");
    expect(html).toContain("task_1");
    expect(html).toContain("Runner");
    expect(html).toContain("runner_1");
    expect(html).toContain("Risk");
    expect(html).toContain("protected path");
    expect(html).toContain("Decision");
    expect(html).toContain("approve");
    expect(html).toContain("category=runner");
    expect(html).toContain("category=job");
    expect(html).toContain("category=cancellation");
    expect(html).toContain("category=approval");
    expect(html).toContain("category=repair");
    expect(html).toContain("category=integration");
    expect(html).toContain("category=policy");
    expect(html).toContain("category=repository");
    expect(html).toContain("category=task");
    expect(html).toContain("category=workspace");
    expect(html).toContain("source=audit_event");
    expect(html).toContain("source=run_event");
    expectNoUnsafeDisplayMaterial(html);
  });

  test("renders filtered rows, filtered empty state, clear-filter link, and no-data state", async () => {
    const { AuditLogTable } = await import("../components/audit-log-table");
    const runnerRow = createRow({
      id: "audit:runner",
      message: "Runner authentication failed.",
    });
    const repairRow = createRow({
      category: "repair",
      id: "audit:repair",
      message: "Repair requested.",
    });

    const filteredHtml = renderToStaticMarkup(
      createElement(AuditLogTable, {
        categoryFilter: "repair",
        rows: [runnerRow, repairRow],
      }),
    );

    expect(filteredHtml).toContain("Showing 1 of 2 events.");
    expect(filteredHtml).toContain("Repair requested.");
    expect(filteredHtml).not.toContain("Runner authentication failed.");

    const emptyFilterHtml = renderToStaticMarkup(
      createElement(AuditLogTable, {
        categoryFilter: "approval",
        rows: [runnerRow],
      }),
    );

    expect(emptyFilterHtml).toContain("No audit events match this filter.");
    expect(emptyFilterHtml).toContain("Clear filters");
    expect(emptyFilterHtml).toContain('href="/dashboard/audit-log"');

    const sourceFilterHtml = renderToStaticMarkup(
      createElement(AuditLogTable, {
        rows: [
          runnerRow,
          createRow({
            id: "run-event:claim",
            message: "Job claimed.",
            source: "run_event",
            sourceLabel: "Run event",
          }),
        ],
        sourceFilter: "run_event",
      }),
    );

    expect(sourceFilterHtml).toContain("Showing 1 of 2 events.");
    expect(sourceFilterHtml).toContain("Job claimed.");
    expect(sourceFilterHtml).not.toContain("Runner authentication failed.");

    const noRowsHtml = renderToStaticMarkup(
      createElement(AuditLogTable, {
        rows: [],
      }),
    );

    expect(noRowsHtml).toContain("No audit events yet.");
    expectNoUnsafeDisplayMaterial(filteredHtml);
    expectNoUnsafeDisplayMaterial(emptyFilterHtml);
    expectNoUnsafeDisplayMaterial(noRowsHtml);
  });

  test("does not render unsafe fields injected through widened row props", async () => {
    const { AuditLogTable } = await import("../components/audit-log-table");
    const unsafeRow = {
      ...createRow({
        details: [],
        message: "Safe audit message.",
      }),
      diff: "diff --git a/app.ts b/app.ts",
      metadata: {
        rawLog: "stdout secret=ghp_12345678901234567890",
        sourceCode: "const token = 'sk-test-unsafe'",
      },
      patch: "@@ -1 +1 @@",
      rawLog: "stderr token=abc12345",
      sourceCode: "function unsafe() {}",
      stderr: "stderr token=abc12345",
      stdout: "stdout token=abc12345",
      token: "token=ghp_12345678901234567890",
    } as unknown as AuditLogRow;

    const html = renderToStaticMarkup(
      createElement(AuditLogTable, {
        rows: [unsafeRow],
      }),
    );

    expect(html).toContain("Safe audit message.");
    expectNoUnsafeDisplayMaterial(html);
  });

  test("loads audit rows only after selected workspace membership is verified", async () => {
    const source = await readAppFile("./(app)/dashboard/audit-log/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createAuditLogService");
    expect(source).toContain("createDrizzleAuditLogStore");
    expect(source).toContain("AUDIT_LOG_SOURCES");
    expect(source).toContain("sourceFilter");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toMatch(/listAuditLog\(\{\s*workspaceId: verifiedWorkspace\.workspaceId\s*\}\)/);
    expect(source).not.toMatch(/listAuditLog\(\{[\s\S]*(category|source):/);
    expect(source).not.toMatch(/listAuditLog\(\{[\s\S]*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toContain("AuditLogTable");
    expect(source).toMatch(
      /<AuditLogTable[\s\S]*categoryFilter={categoryFilter}[\s\S]*rows={auditRows}[\s\S]*sourceFilter={sourceFilter}/,
    );
    expect(source).toContain("Operational audit");
    expect(source).toContain("Internal handover");
    expectNoUnsafeSourceMaterial(source);
  });

  test("renders a server audit table from display-ready rows without raw metadata dumps", async () => {
    await expectFile("../components/audit-log-table.tsx");

    const source = await readAppFile("../components/audit-log-table.tsx");

    expect(source.trimStart()).not.toMatch(/^"use client";/);
    expect(source).toContain("AuditLogRow");
    expect(source).toContain('from "@/src/audit-log/list";');
    expect(source).toContain('import { Badge } from "@/components/ui/badge";');
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain('from "@/components/ui/table"');
    expect(source).toContain("details");
    expect(source).toContain("categoryFilter");
    expect(source).toContain("sourceFilter");
    expect(source).toContain("filterBasePath");
    expect(source).toContain("Clear filters");
    expect(source).toContain("No audit events yet.");
    expect(source).toContain("No audit events match this filter.");
    expect(source).toContain("new URLSearchParams");
    expect(source).toContain('params.set("category", categoryFilter)');
    expect(source).toContain('params.set("source", sourceFilter)');
    expect(source).toContain("row.message");
    expect(source).toContain("row.sourceLabel");
    expect(source).toContain("row.taskId");
    expect(source).toMatch(/rows\.filter\(\(row\) => row\.category === "policy"\)/);
    expectNoUnsafeSourceMaterial(source);
  });

  test("keeps the retained handover page as metadata-only operator context", async () => {
    await expectFile("./(app)/dashboard/backend-handover/page.tsx");

    const source = await readAppFile("./(app)/dashboard/backend-handover/page.tsx");

    expect(source).toContain("Runner-submitted claim events");
    expect(source).toContain("Audit log");
    expect(source).not.toContain("Claim timestamps");
    expect(source).not.toContain("reconstructed from claimed run records");
    expectNoUnsafeSourceMaterial(source);
  });
});
