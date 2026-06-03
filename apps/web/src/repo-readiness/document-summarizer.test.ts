import { describe, expect, test, vi } from "vitest";

import { RepoScanDocumentSummarySchema } from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const importDocumentSummarizer = async () => import("./document-summarizer");

const summarize = async (input: {
  allowReason?:
    | "agent_instructions"
    | "documentation"
    | "config"
    | "github_workflow"
    | "repo_policy";
  path: string;
  size?: number | null;
  text?: string;
}) => {
  const { summarizeAllowlistedDocument } = await importDocumentSummarizer();

  return summarizeAllowlistedDocument({
    allowReason: input.allowReason ?? "documentation",
    maxFileReadBytes: 4096,
    path: input.path,
    size: input.size === undefined ? 512 : input.size,
    text:
      input.text ??
      [
        "# Product",
        "Purpose: help engineering teams review safe AI work.",
        "Workflow: scan, approve, validate, and review pull requests.",
        "Security: keep source, secrets, diffs, and patches out of hosted surfaces.",
        "Validation: require typecheck, lint, format, and tests.",
      ].join("\n"),
  });
};

describe("safe document summarizer", () => {
  test.each([
    ["README.md", "documentation", "readme"],
    ["PRODUCT.md", "documentation", "product"],
    ["PRODUCT_SPEC.md", "documentation", "product_spec"],
    ["MVP_PLAN.md", "documentation", "mvp_plan"],
    ["docs/PRODUCT.md", "documentation", "product"],
    ["docs/SECURITY.md", "documentation", "security"],
    ["AGENTS.md", "agent_instructions", "agent_instructions"],
    ["agents.md", "agent_instructions", "agent_instructions"],
  ] as const)("summarizes allowlisted document %s", async (path, allowReason, expectedKind) => {
    const summary = await summarize({ allowReason, path });

    expect(summary).toMatchObject({
      documentByteCount: 512,
      inputCharacterCount: expect.any(Number),
      kind: expectedKind,
      redactedCharacterCount: expect.any(Number),
      redactionApplied: false,
      topicLabels: expect.arrayContaining(["product_scope", "security", "validation", "workflow"]),
    });
    expect(RepoScanDocumentSummarySchema.safeParse(summary).success).toBe(true);
  });

  test.each([
    [".aicp/policy.json", "repo_policy"],
    [".github/workflows/ci.yml", "github_workflow"],
    ["package.json", "config"],
    ["tsconfig.json", "config"],
    ["src/index.ts", "documentation"],
    ["ARCHITECTURE.md", "documentation"],
    ["docs/ARCHITECTURE.md", "documentation"],
    [".env.local", "documentation"],
    ["docs/service-credentials.md", "documentation"],
    ["deploy.pem", "documentation"],
  ] as const)("skips non-document or disallowed input %s", async (path, allowReason) => {
    await expect(summarize({ allowReason, path })).resolves.toBeNull();
  });

  test("redacts before analysis and never returns raw or redacted source text", async () => {
    const rawSentence = "Approved intent needs validation before merge.";
    const token = `${"ghp_"}documentSummaryShouldNotLeak1234567890`;
    const summary = await summarize({
      path: "PRODUCT_SPEC.md",
      text: [
        "# Product Spec",
        rawSentence,
        `GITHUB_TOKEN=${token}`,
        "Scope: repo-readiness onboarding.",
        "Security: no raw source leaves the boundary.",
        "Workflow: scan, approve, validate, review.",
        "Validation: run typecheck and tests.",
      ].join("\n"),
    });

    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      kind: "product_spec",
      redactionApplied: true,
      topicLabels: expect.arrayContaining(["product_scope", "security", "validation", "workflow"]),
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(rawSentence);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("[REDACTED_SECRET]");
    expect(serialized).not.toContain("GITHUB_TOKEN");
    expect(serialized).not.toContain("raw source leaves the boundary");
    expect(RepoScanDocumentSummarySchema.safeParse(summary).success).toBe(true);
  });

  test("does not summarize oversized or unknown-size allowlisted documents", async () => {
    await expect(summarize({ path: "README.md", size: null })).resolves.toBeNull();
    await expect(summarize({ path: "README.md", size: 4097 })).resolves.toBeNull();
  });
});
