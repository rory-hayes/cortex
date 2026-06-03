import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const acceptanceLanes = [
  {
    evidence: [
      "apps/web/src/repo-readiness/onboarding-e2e.test.tsx",
      "apps/web/app/task-184-browser-happy-path-smoke.test.tsx",
    ],
    heading: "## Repo Scan Onboarding",
    phrases: ["Connect GitHub", "Select repository", "Describe product goal", "Run scan"],
  },
  {
    evidence: [
      "apps/web/src/repo-readiness/onboarding-e2e.test.tsx",
      "apps/web/app/findings-list-ui.test.tsx",
      "apps/web/app/cortex-task-queue-ui.test.tsx",
    ],
    heading: "## Findings And Task Generation",
    phrases: ["Readiness report", "Findings review", "Task recommendation", "Cortex Task"],
  },
  {
    evidence: ["apps/web/src/setup-pr/e2e.test.tsx", "apps/web/app/setup-pr-flow-ui.test.tsx"],
    heading: "## Setup PR Creation",
    phrases: ["metadata-only preview", "draft setup PR", "Generated file body omitted"],
  },
  {
    evidence: [
      "apps/runner/test/e2e/runner-happy-path.test.ts",
      "apps/web/src/jobs/runner-protocol-e2e.test.ts",
      "apps/web/app/cortex-task-queue-ui.test.tsx",
    ],
    heading: "## Optional Runner Execution",
    phrases: ["runner is optional", "local execution", "poll", "claim", "PR artifact"],
  },
  {
    evidence: [
      "apps/web/src/security/payload-guard.test.ts",
      "apps/runner/test/e2e/runner-blocked-paths.test.ts",
      "packages/shared/src/payload-safety.test.ts",
      "packages/logging/src/redact.test.ts",
    ],
    heading: "## Security Boundary Checks",
    phrases: ["raw source", "diffs", "patches", "code snippets", "secrets"],
  },
] as const;

describe("MVP acceptance checklist", () => {
  test("maps the repo-readiness MVP acceptance lanes to validation evidence", () => {
    const checklist = readRepoFile("docs/MVP_ACCEPTANCE.md");

    expect(checklist).toContain("# MVP Acceptance Checklist");
    expect(checklist).toContain("Last updated: June 2, 2026");
    expect(checklist).toContain("Every row must have either automated evidence or a manual check");
    expect(checklist).toContain("Status source");
    expect(checklist).toContain("Manual check");

    for (const lane of acceptanceLanes) {
      expect(checklist).toContain(lane.heading);

      for (const phrase of lane.phrases) {
        expect(checklist).toContain(phrase);
      }

      for (const evidencePath of lane.evidence) {
        expect(checklist).toContain(evidencePath);
      }
    }
  });

  test("keeps acceptance criteria aligned with the MVP trust boundary", () => {
    const checklist = readRepoFile("docs/MVP_ACCEPTANCE.md");

    expect(checklist).toContain("The runner is the executor; the web app is the coordinator.");
    expect(checklist).toContain("Source stays local for implementation execution.");
    expect(checklist).toContain(
      "Raw source, diffs, patches, code snippets, `.env` contents, secrets, private keys, and unredacted command output must not cross into hosted payloads.",
    );
    expect(checklist).toContain("Hosted setup PR surfaces store generated file metadata only.");
    expect(checklist).not.toMatch(
      /hosted source-code execution|auto-merge by default|broad company crawling/iu,
    );
  });
});
