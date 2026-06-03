import { Buffer } from "node:buffer";

import {
  CONTRACT_VERSION,
  RepoScanDocumentSummarySchema,
  RepoScanInventorySchema,
} from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import {
  buildGitHubRepositoryInventory,
  GitHubRepositoryInventoryError,
  type GitHubRepositoryInventory,
  type GitHubRepositoryInventoryRequest,
} from "./repo-inventory.js";
import type { GitHubAppRequest, GitHubAppRequestFunction } from "./app-client.js";

const fakeSourceSnippet = "export const leakedToken = process.env.GITHUB_TOKEN;";
const fakeToken = `${"ghp_"}inventoryshouldnotleak1234567890`;
const fakeEnvValue = "GITHUB_TOKEN=ghp_envvalueshouldnotleak1234567890";
const fakePrivateKey =
  "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----";
const fakeArchitectureText =
  "System shape: web coordinator, local runner executor, and package responsibilities.";
const clearProductDoc = [
  "# Product Spec",
  "Purpose: coordinate safe AI-assisted engineering work.",
  "Target users: engineering teams reviewing pull requests.",
  "Problem: approved intent needs validation before merge.",
  "Scope: repository readiness and local runner setup.",
  "Non-goals: hosted source execution.",
  "Workflow: scan, approve, run, validate, review.",
  "Success criteria: safe metadata-only recommendations.",
].join("\n");
const aiExecutableBacklogText = [
  "### RFB-026 — Add backlog-quality scan module",
  "Status: [ ]",
  "Priority: P0",
  "Milestone: Phase 4 — Deterministic Readiness Rules",
  "Area: Repo scan",
  "Depends on: RFB-020",
  "Goal: Detect whether the repo has an AI-executable backlog.",
  "Acceptance Criteria: Missing and weak backlog structures produce setup findings.",
  "Validation: Run pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm test.",
  "Files Likely Touched: BACKLOG.md, README.md, packages/shared, apps/web/src/repo-readiness",
  "Security/Trust Notes: Do not persist raw backlog text.",
].join("\n");
const weakBacklogText = [
  "### RFB-026 — Add backlog-quality scan module",
  "Status: [ ]",
  "Acceptance Criteria: Missing and weak backlog structures produce setup findings.",
].join("\n");
const alignedWorkflowText = [
  "name: CI",
  "jobs:",
  "  checks:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: pnpm run typecheck",
  "      - run: pnpm test",
].join("\n");
const partialWorkflowText = [
  "name: CI",
  "jobs:",
  "  checks:",
  "    steps:",
  "      - run: pnpm test -- --runInBand && cat src/index.ts",
].join("\n");

const encodeContent = (value: string): string => Buffer.from(value, "utf8").toString("base64");

const validPolicy = () =>
  JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    protectedBranches: ["main"],
    protectedPaths: ["apps/web/**", "packages/shared/**"],
    sensitivePaths: [".env", ".env.*", "secrets/**"],
    warningPaths: {
      packageLocks: ["pnpm-lock.yaml"],
      migrations: ["packages/db/migrations/**"],
      infrastructure: [".github/workflows/**"],
      auth: ["apps/web/src/auth/**"],
      billing: ["apps/web/src/billing/**"],
    },
    validationCommands: [
      {
        id: "typecheck",
        label: "Typecheck",
        command: "pnpm run typecheck",
        timeoutSeconds: 120,
        required: true,
      },
      {
        id: "lint",
        label: "Lint",
        command: "pnpm run lint",
        timeoutSeconds: 120,
        required: true,
      },
      {
        id: "format",
        label: "Format check",
        command: "pnpm run format:check",
        timeoutSeconds: 120,
        required: true,
      },
      {
        id: "test",
        label: "Test",
        command: "pnpm test",
        timeoutSeconds: 300,
        required: true,
      },
    ],
    maxChangedFiles: 20,
    allowUntrackedFiles: false,
    dryRunChecks: ["repo_clean", "validation_commands_configured"],
  });

const treePayload = () => ({
  sha: "tree-sha",
  truncated: false,
  tree: [
    { path: "src", mode: "040000", type: "tree", sha: "src-sha" },
    { path: "tests", mode: "040000", type: "tree", sha: "tests-sha" },
    { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
    { path: ".github/workflows", mode: "040000", type: "tree", sha: "workflows-sha" },
    { path: ".aicp", mode: "040000", type: "tree", sha: "aicp-sha" },
    { path: "docs", mode: "040000", type: "tree", sha: "docs-sha" },
    { path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" },
    { path: "AGENTS.md", mode: "100644", type: "blob", size: 512, sha: "agents-sha" },
    { path: "BACKLOG.md", mode: "100644", type: "blob", size: 840, sha: "backlog-sha" },
    {
      path: "PRODUCT_SPEC.md",
      mode: "100644",
      type: "blob",
      size: 240,
      sha: "product-spec-sha",
    },
    {
      path: "MVP_PLAN.md",
      mode: "100644",
      type: "blob",
      size: 240,
      sha: "mvp-plan-sha",
    },
    {
      path: "docs/SECURITY.md",
      mode: "100644",
      type: "blob",
      size: 20_000,
      sha: "security-sha",
    },
    { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
    { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 4_000, sha: "lock-sha" },
    { path: "tsconfig.json", mode: "100644", type: "blob", size: 240, sha: "tsconfig-sha" },
    {
      path: ".github/workflows/ci.yml",
      mode: "100644",
      type: "blob",
      size: 420,
      sha: "workflow-sha",
    },
    { path: ".aicp/policy.json", mode: "100644", type: "blob", size: 1_400, sha: "policy-sha" },
    { path: "src/index.ts", mode: "100644", type: "blob", size: 120, sha: "source-sha" },
    { path: "src/secret.ts", mode: "100644", type: "blob", size: 128, sha: "secret-sha" },
    { path: "tests/app.test.ts", mode: "100644", type: "blob", size: 210, sha: "test-sha" },
  ],
});

const filePayloads: Record<string, unknown> = {
  ".aicp/policy.json": {
    type: "file",
    size: validPolicy().length,
    encoding: "base64",
    content: encodeContent(validPolicy()),
    token: fakeToken,
  },
  "README.md": {
    type: "file",
    size: 320,
    encoding: "base64",
    content: encodeContent(`# Control Plane\n\n${fakeSourceSnippet}`),
  },
  "AGENTS.md": {
    type: "file",
    size: 512,
    encoding: "base64",
    content: encodeContent(
      [
        "# Agent Instructions",
        "## Purpose",
        "Build a safe control plane.",
        "## Security",
        "Do not expose raw source or secrets.",
        "## Architecture",
        "Keep web coordination separate from local execution.",
        "## Testing",
        "Run validation before completion.",
      ].join("\n"),
    ),
  },
  "agents.md": {
    type: "file",
    size: 256,
    encoding: "base64",
    content: encodeContent("# Lowercase agent instructions\n"),
  },
  "BACKLOG.md": {
    type: "file",
    size: 840,
    encoding: "base64",
    content: encodeContent(aiExecutableBacklogText),
  },
  "PRODUCT_SPEC.md": {
    type: "file",
    size: 240,
    encoding: "base64",
    content: encodeContent(clearProductDoc),
  },
  "MVP_PLAN.md": {
    type: "file",
    size: 240,
    encoding: "base64",
    content: encodeContent(clearProductDoc),
  },
  "PRODUCT.md": {
    type: "file",
    size: 240,
    encoding: "base64",
    content: encodeContent(clearProductDoc),
  },
  "docs/PRODUCT.md": {
    type: "file",
    size: 120,
    encoding: "base64",
    content: encodeContent("# Product\n\nComing soon."),
  },
  "docs/PRODUCT_SPEC.md": {
    type: "file",
    size: 240,
    encoding: "base64",
    content: encodeContent(clearProductDoc),
  },
  "package.json": {
    type: "file",
    size: 512,
    encoding: "base64",
    content: encodeContent(
      JSON.stringify({
        scripts: {
          test: "vitest",
        },
      }),
    ),
  },
  "docs/SECURITY.md": {
    type: "file",
    size: 512,
    encoding: "base64",
    content: encodeContent("# Security\n"),
  },
  "tsconfig.json": {
    type: "file",
    size: 240,
    encoding: "base64",
    content: encodeContent(JSON.stringify({ compilerOptions: { strict: true } })),
  },
  "turbo.json": {
    type: "file",
    size: 300,
    encoding: "base64",
    content: encodeContent(JSON.stringify({ tasks: {} })),
  },
  ".github/workflows/ci.yml": {
    type: "file",
    size: 420,
    encoding: "base64",
    content: encodeContent(alignedWorkflowText),
  },
};

const createRequest = (
  options: { tree?: unknown } = {},
): { request: GitHubAppRequestFunction; requests: GitHubAppRequest[] } => {
  const requests: GitHubAppRequest[] = [];
  const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
    requests.push(transportRequest);

    if (transportRequest.path.includes("/git/trees/")) {
      return options.tree ?? treePayload();
    }

    if (transportRequest.path.includes("/contents/")) {
      const encodedPath = transportRequest.path.split("/contents/")[1] ?? "";
      const decodedPath = decodeURIComponent(encodedPath);
      const payload = filePayloads[decodedPath];

      if (payload === undefined) {
        throw new Error(`Unexpected file read for ${decodedPath}`);
      }

      return payload;
    }

    throw new Error("Unexpected GitHub request.");
  });

  return { request, requests };
};

const requestInput = (
  overrides: { request: GitHubAppRequestFunction } & Partial<
    Omit<GitHubRepositoryInventoryRequest, "request">
  >,
): GitHubRepositoryInventoryRequest => ({
  defaultBranch: "main",
  installationId: 42,
  maxFileReadBytes: 4096,
  owner: "acme",
  repo: "control-plane",
  ...overrides,
});

const expectNoUnsafeInventoryMaterial = (inventory: GitHubRepositoryInventory): void => {
  const serialized = JSON.stringify(inventory);
  const keys: string[] = [];

  const collectKeys = (value: unknown) => {
    if (typeof value !== "object" || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(collectKeys);
      return;
    }

    for (const [key, childValue] of Object.entries(value)) {
      if (
        /^(?:content|contents|diff|filePaths|patch|paths|rawOutput|secret|snippet|source|token)$/u.test(
          key,
        )
      ) {
        keys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(inventory);

  expect(keys).toEqual([]);
  expect(serialized).not.toContain(fakeSourceSnippet);
  expect(serialized).not.toContain(fakeToken);
  expect(serialized).not.toContain(fakeEnvValue);
  expect(serialized).not.toContain(fakePrivateKey);
  expect(serialized).not.toContain(fakeArchitectureText);
  expect(serialized).not.toContain(aiExecutableBacklogText);
  expect(serialized).not.toContain(".env.local");
  expect(serialized).not.toContain("id_rsa");
  expect(serialized).not.toContain("src/index.ts");
  expect(serialized).not.toContain("src/secret.ts");
  expect(serialized).not.toContain("tests/app.test.ts");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@ -1");
  expect(serialized).not.toContain("-----BEGIN");
  expect(serialized).not.toContain("coordinate safe AI-assisted engineering work");
  expect(serialized).not.toContain("pnpm run typecheck");
  expect(serialized).not.toContain("pnpm test");
  expect(serialized).not.toContain("runInBand");
};

describe("GitHub repository inventory", () => {
  test("builds a RepoScanInventory-compatible metadata summary from GitHub tree data", async () => {
    const { request, requests } = createRequest();

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repository).toEqual({
      defaultBranch: "main",
      name: "control-plane",
      owner: "acme",
    });
    expect(inventory.repoScanInventory).toEqual({
      ciProviderLabels: ["GitHub Actions"],
      ciPostureSummary: {
        detectedCommandLabels: ["test", "typecheck"],
        hasCi: true,
        missingCommandLabels: [],
        postureStatus: "aligned",
        providerLabels: ["GitHub Actions"],
        requiredCommandLabels: ["test", "typecheck"],
        workflowFileCount: 1,
      },
      agentInstructionSummary: {
        completenessStatus: "complete",
        hasAgentInstructions: true,
        instructionFileCount: 1,
        missingSectionLabels: [],
        readStatus: "read",
      },
      backlogSummary: {
        backlogFileCount: 1,
        hasBacklog: true,
        missingStructureLabels: [],
        readStatus: "read",
        structureStatus: "complete",
      },
      backlogQualitySummary: {
        backlogFileCount: 1,
        hasBacklog: true,
        missingSignalLabels: [],
        readStatus: "read",
        signalLabels: [
          "acceptance criteria",
          "dependencies",
          "file-touch hints",
          "priority or milestone",
          "security notes",
          "status markers",
          "task ids",
          "validation",
        ],
        structureStatus: "ai_executable",
      },
      documentationSummaries: [
        { kind: "product_spec", pathCount: 1, present: true },
        { kind: "readme", pathCount: 1, present: true },
        { kind: "security", pathCount: 1, present: true },
      ],
      documentSummaries: expect.arrayContaining([
        expect.objectContaining({
          documentByteCount: 512,
          kind: "agent_instructions",
          label: "Agent instructions",
          topicLabels: expect.arrayContaining([
            "agent_rules",
            "architecture",
            "security",
            "validation",
          ]),
        }),
        expect.objectContaining({
          documentByteCount: 240,
          kind: "mvp_plan",
          label: "MVP plan",
          topicLabels: expect.arrayContaining(["execution_flow", "product_scope", "validation"]),
        }),
        expect.objectContaining({
          documentByteCount: 240,
          kind: "product_spec",
          label: "Product spec",
          topicLabels: expect.arrayContaining(["execution_flow", "product_scope", "validation"]),
        }),
        expect.objectContaining({
          documentByteCount: 320,
          kind: "readme",
          label: "README",
        }),
      ]),
      languageSummaries: expect.arrayContaining([
        { fileCount: 3, name: "TypeScript" },
        { fileCount: 2, name: "JSON" },
        { fileCount: 6, name: "Markdown" },
        { fileCount: 2, name: "YAML" },
      ]),
      omittedFileCount: 0,
      packageManagerLabels: ["pnpm"],
      policySummary: {
        dryRunCheckCount: 2,
        hasPolicyFile: true,
        protectedPathCount: 2,
        sensitivePathCount: 3,
        validationCommandCount: 4,
      },
      validationPostureSummary: {
        detectedCommandLabels: ["format", "lint", "test", "typecheck"],
        dryRunCheckCount: 2,
        hasPolicyFile: true,
        missingCommandLabels: [],
        postureStatus: "ready",
        suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
        validationCommandCount: 4,
      },
      productClaritySummary: {
        clarityStatus: "sufficient",
        goalContextStatus: "not_provided",
        hasProductDocs: true,
        missingSignalLabels: [],
        productDocCount: 2,
        readStatus: "read",
        signalLabels: [
          "non_goals",
          "problem",
          "purpose",
          "scope",
          "success_criteria",
          "target_user",
          "workflow",
        ],
      },
      repoHygieneSummary: {
        contributionDocCount: 0,
        hasContributionDocs: false,
        hasRootGitignore: false,
        hygieneStatus: "minor_gaps",
        issueLabels: ["missing_gitignore", "missing_contribution_docs", "missing_issue_templates"],
        issueTemplateCount: 0,
        jsLockfileCount: 1,
        monorepoSignalCount: 0,
        monorepoStructureStatus: "single_project",
        packageManagerCount: 1,
        packageManagerStatus: "single",
        workspaceConfigCount: 0,
      },
      scannedFileCount: 14,
      totalDirectoryCount: 6,
      totalFileCount: 14,
    });
    expect(inventory.repoScanInventory.documentSummaries).toHaveLength(4);
    expect(
      inventory.repoScanInventory.documentSummaries.every(
        (summary) => RepoScanDocumentSummarySchema.safeParse(summary).success,
      ),
    ).toBe(true);
    expect(inventory.treeSummary).toEqual({
      hasTestDirectories: true,
      processedEntryCount: 20,
      skippedEntryCount: 0,
      truncated: false,
    });
    expect(inventory.allowlistedFileReadSummary).toEqual({
      attemptedFileCount: 9,
      readFileCount: 9,
      skippedOversizedFileCount: 1,
      unreadableFileCount: 0,
    });
    expect(inventory.policyReadStatus).toBe("parsed");
    expect(RepoScanInventorySchema.safeParse(inventory.repoScanInventory).success).toBe(true);
    expectNoUnsafeInventoryMaterial(inventory);

    const requestedSafeFilePaths = requests
      .filter((transportRequest) => transportRequest.path.includes("/contents/"))
      .map((transportRequest) =>
        decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
      )
      .toSorted((left, right) => left.localeCompare(right));

    expect(requestedSafeFilePaths).toEqual(
      [
        ".aicp/policy.json",
        ".github/workflows/ci.yml",
        "AGENTS.md",
        "BACKLOG.md",
        "MVP_PLAN.md",
        "PRODUCT_SPEC.md",
        "README.md",
        "package.json",
        "tsconfig.json",
      ].toSorted((left, right) => left.localeCompare(right)),
    );
    expect(requestedSafeFilePaths).not.toContain("src/index.ts");
    expect(requestedSafeFilePaths).not.toContain("src/secret.ts");
    expect(requestedSafeFilePaths).not.toContain("tests/app.test.ts");
    expect(requestedSafeFilePaths).not.toContain("docs/SECURITY.md");
    expect(requests[0]).toMatchObject({
      installationId: 42,
      method: "GET",
      operation: "getRepositoryTree",
      path: "/repos/acme/control-plane/git/trees/main",
      query: { recursive: "1" },
    });
  });

  test("summarizes mixed JavaScript lockfiles from tree metadata only", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
          {
            path: ".github/ISSUE_TEMPLATE",
            mode: "040000",
            type: "tree",
            sha: "issue-template-dir-sha",
          },
          {
            path: ".github/ISSUE_TEMPLATE/bug.yml",
            mode: "100644",
            type: "blob",
            size: 120,
            sha: "issue-template-sha",
          },
          { path: ".gitignore", mode: "100644", type: "blob", size: 120, sha: "gitignore-sha" },
          { path: "DEVELOPMENT.md", mode: "100644", type: "blob", size: 120, sha: "dev-sha" },
          { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
          {
            path: "package-lock.json",
            mode: "100644",
            type: "blob",
            size: 512,
            sha: "npm-lock-sha",
          },
          { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 512, sha: "pnpm-sha" },
          { path: "yarn.lock", mode: "100644", type: "blob", size: 512, sha: "yarn-sha" },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.repoHygieneSummary).toEqual({
      contributionDocCount: 1,
      hasContributionDocs: true,
      hasRootGitignore: true,
      hygieneStatus: "needs_attention",
      issueLabels: ["mixed_lockfiles"],
      issueTemplateCount: 1,
      jsLockfileCount: 3,
      monorepoSignalCount: 0,
      monorepoStructureStatus: "single_project",
      packageManagerCount: 3,
      packageManagerStatus: "mixed",
      workspaceConfigCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes package.json without a JavaScript lockfile as a setup gap", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
          {
            path: ".github/ISSUE_TEMPLATE",
            mode: "040000",
            type: "tree",
            sha: "issue-template-dir-sha",
          },
          {
            path: ".github/ISSUE_TEMPLATE/feature.yml",
            mode: "100644",
            type: "blob",
            size: 120,
            sha: "issue-template-sha",
          },
          { path: ".gitignore", mode: "100644", type: "blob", size: 120, sha: "gitignore-sha" },
          { path: "DEVELOPMENT.md", mode: "100644", type: "blob", size: 120, sha: "dev-sha" },
          { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.repoHygieneSummary).toMatchObject({
      hygieneStatus: "minor_gaps",
      issueLabels: ["missing_js_lockfile"],
      jsLockfileCount: 0,
      packageManagerStatus: "manifest_without_lockfile",
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes a missing root gitignore from tree metadata", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
          {
            path: ".github/ISSUE_TEMPLATE.md",
            mode: "100644",
            type: "blob",
            size: 120,
            sha: "issue-template-sha",
          },
          { path: "DEVELOPMENT.md", mode: "100644", type: "blob", size: 120, sha: "dev-sha" },
          { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
          { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 512, sha: "pnpm-sha" },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.repoHygieneSummary).toMatchObject({
      hasRootGitignore: false,
      hygieneStatus: "minor_gaps",
      issueLabels: ["missing_gitignore"],
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes unclear monorepo signals without workspace configuration", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: "apps", mode: "040000", type: "tree", sha: "apps-sha" },
          { path: "apps/web", mode: "040000", type: "tree", sha: "web-sha" },
          {
            path: "apps/web/package.json",
            mode: "100644",
            type: "blob",
            size: 512,
            sha: "web-package-sha",
          },
          { path: "packages", mode: "040000", type: "tree", sha: "packages-sha" },
          { path: "packages/core", mode: "040000", type: "tree", sha: "core-sha" },
          {
            path: "packages/core/package.json",
            mode: "100644",
            type: "blob",
            size: 512,
            sha: "core-package-sha",
          },
          { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
          {
            path: ".github/ISSUE_TEMPLATE/bug.yml",
            mode: "100644",
            type: "blob",
            size: 120,
            sha: "issue-template-sha",
          },
          { path: ".gitignore", mode: "100644", type: "blob", size: 120, sha: "gitignore-sha" },
          { path: "DEVELOPMENT.md", mode: "100644", type: "blob", size: 120, sha: "dev-sha" },
          { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
          { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 512, sha: "pnpm-sha" },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.repoHygieneSummary).toMatchObject({
      hygieneStatus: "needs_attention",
      issueLabels: ["unclear_monorepo_structure"],
      monorepoSignalCount: 4,
      monorepoStructureStatus: "unclear",
      workspaceConfigCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes missing contribution notes and issue templates as minor hygiene gaps", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: ".gitignore", mode: "100644", type: "blob", size: 120, sha: "gitignore-sha" },
          { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
          { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 512, sha: "pnpm-sha" },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.repoHygieneSummary).toMatchObject({
      contributionDocCount: 0,
      hasContributionDocs: false,
      hygieneStatus: "minor_gaps",
      issueLabels: ["missing_contribution_docs", "missing_issue_templates"],
      issueTemplateCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("does not request contents for gitignore, issue templates, source, env, or secret-like hygiene files", async () => {
    const requests: GitHubAppRequest[] = [];
    const disallowedContentPaths = new Set([
      ".env",
      ".env.example",
      ".github/ISSUE_TEMPLATE/bug.yml",
      ".gitignore",
      "docs/client-secret.md",
      "src/index.ts",
    ]);
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      requests.push(transportRequest);

      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
            {
              path: ".github/ISSUE_TEMPLATE",
              mode: "040000",
              type: "tree",
              sha: "issue-template-dir-sha",
            },
            {
              path: ".github/ISSUE_TEMPLATE/bug.yml",
              mode: "100644",
              type: "blob",
              size: 120,
              sha: "issue-template-sha",
            },
            { path: ".gitignore", mode: "100644", type: "blob", size: 120, sha: "gitignore-sha" },
            { path: ".env", mode: "100644", type: "blob", size: 24, sha: "env-sha" },
            {
              path: ".env.example",
              mode: "100644",
              type: "blob",
              size: 24,
              sha: "env-example-sha",
            },
            {
              path: "docs/client-secret.md",
              mode: "100644",
              type: "blob",
              size: 320,
              sha: "secret-doc-sha",
            },
            { path: "src/index.ts", mode: "100644", type: "blob", size: 120, sha: "source-sha" },
            { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
            { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 512, sha: "pnpm-sha" },
          ],
        };
      }

      const decodedPath = decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? "");
      if (disallowedContentPaths.has(decodedPath)) {
        throw new Error(`Disallowed hygiene content request for ${decodedPath}`);
      }

      const payload = filePayloads[decodedPath];
      if (payload === undefined) {
        throw new Error(`Unexpected file read for ${decodedPath}`);
      }

      return payload;
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));
    const requestedContentsPaths = requests
      .filter((transportRequest) => transportRequest.path.includes("/contents/"))
      .map((transportRequest) =>
        decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
      );

    for (const disallowedPath of disallowedContentPaths) {
      expect(requestedContentsPaths).not.toContain(disallowedPath);
    }
    expect(inventory.repoScanInventory.repoHygieneSummary).toMatchObject({
      hasRootGitignore: true,
      issueTemplateCount: 1,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes missing product documentation as metadata only", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [{ path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" }],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.productClaritySummary).toEqual({
      clarityStatus: "missing",
      goalContextStatus: "not_provided",
      hasProductDocs: false,
      missingSignalLabels: [],
      productDocCount: 0,
      readStatus: "missing",
      signalLabels: [],
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes missing backlog metadata without reading unavailable files", async () => {
    const { request, requests } = createRequest({
      tree: {
        truncated: false,
        tree: [{ path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" }],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.backlogSummary).toEqual({
      backlogFileCount: 0,
      hasBacklog: false,
      missingStructureLabels: ["backlog"],
      readStatus: "missing",
      structureStatus: "missing",
    });
    expect(inventory.repoScanInventory.backlogQualitySummary).toEqual({
      backlogFileCount: 0,
      hasBacklog: false,
      missingSignalLabels: ["backlog"],
      readStatus: "missing",
      signalLabels: [],
      structureStatus: "missing",
    });
    expect(
      requests
        .filter((transportRequest) => transportRequest.path.includes("/contents/"))
        .map((transportRequest) =>
          decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
        ),
    ).not.toContain("BACKLOG.md");
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes missing validation posture without executing commands", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [{ path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" }],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.validationPostureSummary).toEqual({
      detectedCommandLabels: [],
      dryRunCheckCount: 0,
      hasPolicyFile: false,
      missingCommandLabels: ["format", "lint", "test", "typecheck"],
      postureStatus: "missing",
      suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
      validationCommandCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("flags missing CI when validation commands are detected", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: ".aicp", mode: "040000", type: "tree", sha: "aicp-sha" },
          {
            path: ".aicp/policy.json",
            mode: "100644",
            type: "blob",
            size: validPolicy().length,
            sha: "policy-sha",
          },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.ciProviderLabels).toEqual([]);
    expect(inventory.repoScanInventory.ciPostureSummary).toEqual({
      detectedCommandLabels: [],
      hasCi: false,
      missingCommandLabels: ["test", "typecheck"],
      postureStatus: "missing",
      providerLabels: [],
      requiredCommandLabels: ["test", "typecheck"],
      workflowFileCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("flags CI workflows that do not run detected validation labels", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: ".aicp", mode: "040000", type: "tree", sha: "aicp-sha" },
            { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
            {
              path: ".github/workflows",
              mode: "040000",
              type: "tree",
              sha: "workflow-dir-sha",
            },
            {
              path: ".github/workflows/ci.yml",
              mode: "100644",
              type: "blob",
              size: partialWorkflowText.length,
              sha: "workflow-sha",
            },
            {
              path: ".aicp/policy.json",
              mode: "100644",
              type: "blob",
              size: validPolicy().length,
              sha: "policy-sha",
            },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/")) {
        const decodedPath = decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? "");

        return {
          type: "file",
          size:
            decodedPath === ".aicp/policy.json" ? validPolicy().length : partialWorkflowText.length,
          encoding: "base64",
          content: encodeContent(
            decodedPath === ".aicp/policy.json" ? validPolicy() : partialWorkflowText,
          ),
        };
      }

      throw new Error("Unexpected GitHub request.");
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.ciPostureSummary).toEqual({
      detectedCommandLabels: ["test"],
      hasCi: true,
      missingCommandLabels: ["typecheck"],
      postureStatus: "partial",
      providerLabels: ["GitHub Actions"],
      requiredCommandLabels: ["test", "typecheck"],
      workflowFileCount: 1,
    });
    expect(JSON.stringify(inventory)).not.toContain("cat src/index.ts");
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes partial validation posture with safe command labels only", async () => {
    const partialPolicy = JSON.stringify({
      ...JSON.parse(validPolicy()),
      validationCommands: [
        {
          id: "test",
          label: "Test",
          command: "pnpm test -- --runInBand && cat src/index.ts",
          required: true,
          timeoutSeconds: 300,
        },
      ],
    });
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: ".aicp", mode: "040000", type: "tree", sha: "aicp-sha" },
            {
              path: ".aicp/policy.json",
              mode: "100644",
              type: "blob",
              size: partialPolicy.length,
              sha: "policy-sha",
            },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/")) {
        return {
          type: "file",
          size: partialPolicy.length,
          encoding: "base64",
          content: encodeContent(partialPolicy),
        };
      }

      throw new Error("Unexpected GitHub request.");
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.validationPostureSummary).toEqual({
      detectedCommandLabels: ["test"],
      dryRunCheckCount: 2,
      hasPolicyFile: true,
      missingCommandLabels: ["format", "lint", "typecheck"],
      postureStatus: "partial",
      suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
      validationCommandCount: 1,
    });
    expect(JSON.stringify(inventory)).not.toContain("cat src/index.ts");
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes weak backlog structure with safe missing labels only", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: "BACKLOG.md", mode: "100644", type: "blob", size: 320, sha: "backlog-sha" },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/")) {
        return {
          type: "file",
          size: weakBacklogText.length,
          encoding: "base64",
          content: encodeContent(weakBacklogText),
        };
      }

      throw new Error("Unexpected GitHub request.");
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.backlogSummary).toEqual({
      backlogFileCount: 1,
      hasBacklog: true,
      missingStructureLabels: ["validation guidance", "execution metadata"],
      readStatus: "read",
      structureStatus: "weak",
    });
    expect(inventory.repoScanInventory.backlogQualitySummary).toEqual({
      backlogFileCount: 1,
      hasBacklog: true,
      missingSignalLabels: [
        "dependencies",
        "file-touch hints",
        "priority or milestone",
        "security notes",
        "validation",
      ],
      readStatus: "read",
      signalLabels: ["acceptance criteria", "status markers", "task ids"],
      structureStatus: "weak",
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes architecture documentation from tree metadata without reading content", async () => {
    const requests: GitHubAppRequest[] = [];
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      requests.push(transportRequest);

      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: "docs", mode: "040000", type: "tree", sha: "docs-sha" },
            {
              path: "ARCHITECTURE.md",
              mode: "100644",
              type: "blob",
              size: 240,
              sha: "architecture-root-sha",
            },
            {
              path: "docs/ARCHITECTURE.md",
              mode: "100644",
              type: "blob",
              size: 240,
              sha: "architecture-docs-sha",
            },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/")) {
        const decodedPath = decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? "");

        throw new Error(`Architecture docs must not be read: ${decodedPath}`);
      }

      throw new Error("Unexpected GitHub request.");
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.documentationSummaries).toEqual([
      { kind: "architecture", pathCount: 2, present: true },
    ]);
    expect(
      requests.filter((transportRequest) => transportRequest.path.includes("/contents/")),
    ).toHaveLength(0);
    expectNoUnsafeInventoryMaterial(inventory);

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toMatch(
      /content|contents|diff|patch|snippet|source|ARCHITECTURE\.md|docs\/ARCHITECTURE\.md/iu,
    );
  });

  test("ignores product-like documentation outside the bounded allowlist scope", async () => {
    const { request, requests } = createRequest({
      tree: {
        truncated: false,
        tree: [
          {
            path: "src/PRODUCT.md",
            mode: "100644",
            type: "blob",
            size: 120,
            sha: "product-sha",
          },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.productClaritySummary).toEqual({
      clarityStatus: "missing",
      goalContextStatus: "not_provided",
      hasProductDocs: false,
      missingSignalLabels: [],
      productDocCount: 0,
      readStatus: "missing",
      signalLabels: [],
    });
    expect(
      requests.filter((transportRequest) => transportRequest.path.includes("/contents/")),
    ).toHaveLength(0);
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes weak product documentation when product docs lack fixed clarity signals", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          {
            path: "docs/PRODUCT.md",
            mode: "100644",
            type: "blob",
            size: 120,
            sha: "product-sha",
          },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.productClaritySummary).toEqual({
      clarityStatus: "weak",
      goalContextStatus: "not_provided",
      hasProductDocs: true,
      missingSignalLabels: [
        "non_goals",
        "problem",
        "purpose",
        "scope",
        "success_criteria",
        "target_user",
        "workflow",
      ],
      productDocCount: 1,
      readStatus: "read",
      signalLabels: [],
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes sufficient product documentation from fixed signal labels only", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          {
            path: "docs/PRODUCT_SPEC.md",
            mode: "100644",
            type: "blob",
            size: 240,
            sha: "product-sha",
          },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.productClaritySummary).toEqual({
      clarityStatus: "sufficient",
      goalContextStatus: "not_provided",
      hasProductDocs: true,
      missingSignalLabels: [],
      productDocCount: 1,
      readStatus: "read",
      signalLabels: [
        "non_goals",
        "problem",
        "purpose",
        "scope",
        "success_criteria",
        "target_user",
        "workflow",
      ],
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("does not serialize hostile strings found in product documentation", async () => {
    const hostileProductText = [
      "# Product",
      "Purpose: do not leak this sentence.",
      "Target users: reviewers.",
      "Problem: diff --git a/src/private.ts b/src/private.ts",
      "Scope: /Users/rory/private/source",
      "Success criteria: ghp_productsecret1234567890",
    ].join("\n");
    const requests: GitHubAppRequest[] = [];
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      requests.push(transportRequest);

      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            {
              path: "PRODUCT.md",
              mode: "100644",
              type: "blob",
              size: 240,
              sha: "product-sha",
            },
          ],
        };
      }

      return {
        type: "file",
        size: 240,
        encoding: "base64",
        content: encodeContent(hostileProductText),
      };
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));
    const serialized = JSON.stringify(inventory);

    expect(inventory.repoScanInventory.productClaritySummary).toMatchObject({
      clarityStatus: "sufficient",
      signalLabels: ["problem", "purpose", "scope", "success_criteria", "target_user"],
    });
    expect(serialized).not.toContain("do not leak this sentence");
    expect(serialized).not.toContain("diff --git");
    expect(serialized).not.toContain("/Users/rory");
    expect(serialized).not.toContain("ghp_productsecret");
    expect(
      requests.filter((transportRequest) => transportRequest.path.includes("/contents/")),
    ).toHaveLength(1);
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("skips allowlisted config reads when the GitHub tree reports oversized files", async () => {
    const { request, requests } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: ".aicp", mode: "040000", type: "tree", sha: "aicp-sha" },
          {
            path: ".aicp/policy.json",
            mode: "100644",
            type: "blob",
            size: 10_000,
            sha: "policy-sha",
          },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(
      requestInput({ maxFileReadBytes: 100, request }),
    );

    expect(inventory.repoScanInventory.policySummary).toEqual({
      dryRunCheckCount: 0,
      hasPolicyFile: true,
      protectedPathCount: 0,
      sensitivePathCount: 0,
      validationCommandCount: 0,
    });
    expect(inventory.repoScanInventory.validationPostureSummary).toEqual({
      detectedCommandLabels: [],
      dryRunCheckCount: 0,
      hasPolicyFile: true,
      missingCommandLabels: ["format", "lint", "test", "typecheck"],
      postureStatus: "missing",
      suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
      validationCommandCount: 0,
    });
    expect(inventory.allowlistedFileReadSummary).toEqual({
      attemptedFileCount: 0,
      readFileCount: 0,
      skippedOversizedFileCount: 1,
      unreadableFileCount: 0,
    });
    expect(inventory.policyReadStatus).toBe("oversized");
    expect(
      requests.filter((transportRequest) => transportRequest.path.includes("/contents/")),
    ).toEqual([]);
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes missing agent instructions without reading unavailable files", async () => {
    const { request, requests } = createRequest({
      tree: {
        truncated: false,
        tree: [{ path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" }],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.agentInstructionSummary).toEqual({
      completenessStatus: "missing",
      hasAgentInstructions: false,
      instructionFileCount: 0,
      missingSectionLabels: ["agent instructions"],
      readStatus: "missing",
    });
    expect(
      requests
        .filter((transportRequest) => transportRequest.path.includes("/contents/"))
        .map((transportRequest) =>
          decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
        ),
    ).toEqual(["README.md"]);
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes incomplete agent instructions with safe missing-section labels only", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [{ path: "AGENTS.md", mode: "100644", type: "blob", size: 128, sha: "agents-sha" }],
        };
      }

      return {
        type: "file",
        size: 128,
        encoding: "base64",
        content: encodeContent(`# Agents\n\n${fakeSourceSnippet}\n${fakeToken}`),
      };
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.agentInstructionSummary).toEqual({
      completenessStatus: "incomplete",
      hasAgentInstructions: true,
      instructionFileCount: 1,
      missingSectionLabels: ["architecture", "security", "testing"],
      readStatus: "read",
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("summarizes duplicate root agent instruction files as conflicting metadata", async () => {
    const { request } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: "AGENTS.md", mode: "100644", type: "blob", size: 512, sha: "agents-sha" },
          { path: "agents.md", mode: "100644", type: "blob", size: 256, sha: "lower-agents-sha" },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(requestInput({ request }));

    expect(inventory.repoScanInventory.agentInstructionSummary).toEqual({
      completenessStatus: "conflicting",
      hasAgentInstructions: true,
      instructionFileCount: 2,
      missingSectionLabels: ["duplicate root instruction files"],
      readStatus: "read",
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("never requests contents for unsafe, unknown-size, binary, or source-like scan files", async () => {
    const hostileContentPaths = new Set([
      ".env",
      ".env.example",
      ".env.local",
      ".env.production",
      ".ssh/id_rsa",
      "README.png",
      "api.local.env",
      "certificates/deploy.key",
      "docs/client-secret.md",
      "id_ed25519",
      "local.env",
      "secrets/service.json",
      "src/README.ts",
    ]);
    const { request, requests } = createRequest({
      tree: {
        truncated: false,
        tree: [
          { path: "docs", mode: "040000", type: "tree", sha: "docs-sha" },
          { path: "src", mode: "040000", type: "tree", sha: "src-sha" },
          { path: "secrets", mode: "040000", type: "tree", sha: "secrets-sha" },
          { path: ".ssh", mode: "040000", type: "tree", sha: "ssh-sha" },
          { path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" },
          {
            path: "docs/SECURITY.md",
            mode: "100644",
            type: "blob",
            size: 512,
            sha: "security-sha",
          },
          { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
          { path: "turbo.json", mode: "100644", type: "blob", size: 300, sha: "turbo-sha" },
          {
            path: ".github/workflows/ci.yml",
            mode: "100644",
            type: "blob",
            size: 420,
            sha: "workflow-sha",
          },
          {
            path: ".aicp/policy.json",
            mode: "100644",
            type: "blob",
            size: 10_000,
            sha: "policy-sha",
          },
          { path: ".env", mode: "100644", type: "blob", size: 24, sha: "env-sha" },
          { path: ".env.example", mode: "100644", type: "blob", size: 24, sha: "env-example-sha" },
          { path: ".env.local", mode: "100644", type: "blob", size: 24, sha: "env-local-sha" },
          {
            path: ".env.production",
            mode: "100644",
            type: "blob",
            size: 24,
            sha: "env-production-sha",
          },
          { path: "local.env", mode: "100644", type: "blob", size: 24, sha: "local-env-sha" },
          {
            path: "api.local.env",
            mode: "100644",
            type: "blob",
            size: 24,
            sha: "api-local-env-sha",
          },
          {
            path: "secrets/service.json",
            mode: "100644",
            type: "blob",
            size: 64,
            sha: "secret-sha",
          },
          { path: ".ssh/id_rsa", mode: "100644", type: "blob", size: 64, sha: "ssh-sha" },
          { path: "id_ed25519", mode: "100644", type: "blob", size: 64, sha: "ed25519-sha" },
          {
            path: "certificates/deploy.key",
            mode: "100644",
            type: "blob",
            size: 64,
            sha: "key-sha",
          },
          { path: "README.png", mode: "100644", type: "blob", size: 320, sha: "png-sha" },
          {
            path: "docs/client-secret.md",
            mode: "100644",
            type: "blob",
            size: 320,
            sha: "secret-doc-sha",
          },
          { path: "src/README.ts", mode: "100644", type: "blob", size: 320, sha: "src-readme-sha" },
          {
            path: "docs/CONTRIBUTING.md",
            mode: "100644",
            type: "blob",
            size: null,
            sha: "unknown-size-doc-sha",
          },
        ],
      },
    });

    const inventory = await buildGitHubRepositoryInventory(
      requestInput({ maxFileReadBytes: 4096, request }),
    );

    const requestedContentsPaths = requests
      .filter((transportRequest) => transportRequest.path.includes("/contents/"))
      .map((transportRequest) =>
        decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
      )
      .toSorted((left, right) => left.localeCompare(right));

    expect(requestedContentsPaths).toEqual(
      [
        ".github/workflows/ci.yml",
        "README.md",
        "docs/SECURITY.md",
        "package.json",
        "turbo.json",
      ].toSorted((left, right) => left.localeCompare(right)),
    );
    for (const hostilePath of hostileContentPaths) {
      expect(requestedContentsPaths).not.toContain(hostilePath);
    }
    expect(requestedContentsPaths).not.toContain(".aicp/policy.json");
    expect(requestedContentsPaths).not.toContain("docs/CONTRIBUTING.md");
    expect(inventory.policyReadStatus).toBe("oversized");
    expect(inventory.allowlistedFileReadSummary).toMatchObject({
      attemptedFileCount: 5,
      readFileCount: 5,
      skippedOversizedFileCount: 1,
      unreadableFileCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test("requests contents only for bounded RFB-019 allowlisted scan inputs", async () => {
    const disallowedContent = new Map([
      [".env", fakeEnvValue],
      [".env.example", "PLACEHOLDER_TOKEN=example"],
      [".env.local", fakeEnvValue],
      [".ssh/id_rsa", fakePrivateKey],
      ["README.png", "binary-by-extension"],
      ["apps/web/page.tsx", fakeSourceSnippet],
      ["certificates/deploy.pem", fakePrivateKey],
      ["docs/CODE_OF_CONDUCT.md", "oversized documentation should not be read"],
      ["docs/CONTRIBUTING.md", "unknown-size documentation should not be read"],
      ["id_rsa", fakePrivateKey],
      ["packages/shared/src/index.ts", fakeSourceSnippet],
      ["src/index.ts", fakeSourceSnippet],
      ["tests/app.test.ts", fakeSourceSnippet],
    ]);
    const requests: GitHubAppRequest[] = [];
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      requests.push(transportRequest);

      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: ".aicp", mode: "040000", type: "tree", sha: "aicp-sha" },
            { path: ".github", mode: "040000", type: "tree", sha: "github-sha" },
            { path: ".github/workflows", mode: "040000", type: "tree", sha: "workflows-sha" },
            { path: ".ssh", mode: "040000", type: "tree", sha: "ssh-sha" },
            { path: "apps", mode: "040000", type: "tree", sha: "apps-sha" },
            { path: "apps/web", mode: "040000", type: "tree", sha: "web-sha" },
            { path: "certificates", mode: "040000", type: "tree", sha: "certs-sha" },
            { path: "docs", mode: "040000", type: "tree", sha: "docs-sha" },
            { path: "packages", mode: "040000", type: "tree", sha: "packages-sha" },
            { path: "packages/shared", mode: "040000", type: "tree", sha: "shared-sha" },
            { path: "packages/shared/src", mode: "040000", type: "tree", sha: "shared-src-sha" },
            { path: "src", mode: "040000", type: "tree", sha: "src-sha" },
            { path: "tests", mode: "040000", type: "tree", sha: "tests-sha" },
            {
              path: ".aicp/policy.json",
              mode: "100644",
              type: "blob",
              size: 1_400,
              sha: "policy-sha",
            },
            {
              path: ".github/workflows/ci.yml",
              mode: "100644",
              type: "blob",
              size: 420,
              sha: "workflow-sha",
            },
            { path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" },
            {
              path: "docs/SECURITY.md",
              mode: "100644",
              type: "blob",
              size: 512,
              sha: "security-sha",
            },
            { path: "package.json", mode: "100644", type: "blob", size: 512, sha: "package-sha" },
            { path: ".env", mode: "100644", type: "blob", size: 24, sha: "env-sha" },
            {
              path: ".env.example",
              mode: "100644",
              type: "blob",
              size: 24,
              sha: "env-example-sha",
            },
            { path: ".env.local", mode: "100644", type: "blob", size: 24, sha: "env-local-sha" },
            { path: ".ssh/id_rsa", mode: "100644", type: "blob", size: 64, sha: "ssh-key-sha" },
            { path: "id_rsa", mode: "100644", type: "blob", size: 64, sha: "id-rsa-sha" },
            {
              path: "certificates/deploy.pem",
              mode: "100644",
              type: "blob",
              size: 64,
              sha: "pem-sha",
            },
            { path: "README.png", mode: "100644", type: "blob", size: 320, sha: "png-sha" },
            {
              path: "docs/CODE_OF_CONDUCT.md",
              mode: "100644",
              type: "blob",
              size: 9_000,
              sha: "large-doc-sha",
            },
            {
              path: "docs/CONTRIBUTING.md",
              mode: "100644",
              type: "blob",
              size: null,
              sha: "unknown-doc-sha",
            },
            { path: "src/index.ts", mode: "100644", type: "blob", size: 120, sha: "source-sha" },
            {
              path: "apps/web/page.tsx",
              mode: "100644",
              type: "blob",
              size: 120,
              sha: "app-source-sha",
            },
            {
              path: "packages/shared/src/index.ts",
              mode: "100644",
              type: "blob",
              size: 120,
              sha: "package-source-sha",
            },
            {
              path: "tests/app.test.ts",
              mode: "100644",
              type: "blob",
              size: 120,
              sha: "test-source-sha",
            },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/")) {
        const encodedPath = transportRequest.path.split("/contents/")[1] ?? "";
        const decodedPath = decodeURIComponent(encodedPath);

        if (disallowedContent.has(decodedPath)) {
          throw new Error(
            `Disallowed content request for ${decodedPath}: ${disallowedContent.get(decodedPath)}`,
          );
        }

        const payload = filePayloads[decodedPath];

        if (payload === undefined) {
          throw new Error(`Unexpected file read for ${decodedPath}`);
        }

        return payload;
      }

      throw new Error("Unexpected GitHub request.");
    });

    const inventory = await buildGitHubRepositoryInventory(
      requestInput({ maxFileReadBytes: 4096, request }),
    );
    const requestedContentsPaths = requests
      .filter((transportRequest) => transportRequest.path.includes("/contents/"))
      .map((transportRequest) =>
        decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
      )
      .toSorted((left, right) => left.localeCompare(right));

    expect(requestedContentsPaths).toEqual(
      [
        ".aicp/policy.json",
        ".github/workflows/ci.yml",
        "README.md",
        "docs/SECURITY.md",
        "package.json",
      ].toSorted((left, right) => left.localeCompare(right)),
    );
    for (const disallowedPath of disallowedContent.keys()) {
      expect(requestedContentsPaths).not.toContain(disallowedPath);
    }
    expect(inventory.allowlistedFileReadSummary).toMatchObject({
      attemptedFileCount: 5,
      readFileCount: 5,
      skippedOversizedFileCount: 1,
      unreadableFileCount: 0,
    });
    expectNoUnsafeInventoryMaterial(inventory);
  });

  test.each([
    "raw GitHub error with diff --git a/src/private.ts b/src/private.ts",
    `${"ghp_"}inventoryrequestfailuremustnotleak1234567890`,
    fakePrivateKey,
  ])(
    "throws generic safe inventory errors for unsafe request failure %#",
    async (unsafeMessage) => {
      const request = vi.fn<GitHubAppRequestFunction>(async () => {
        throw new Error(unsafeMessage);
      });

      try {
        await buildGitHubRepositoryInventory(requestInput({ request }));
        throw new Error("Expected GitHub inventory request to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubRepositoryInventoryError);
        expect(error).toMatchObject({
          code: "request_failed",
          message: "GitHub repository inventory request failed.",
        });
        expect(String(error)).not.toContain(unsafeMessage);
        expect(String(error)).not.toContain("diff --git");
        expect(String(error)).not.toContain("ghp_");
        expect(String(error)).not.toContain("PRIVATE KEY");
      }
    },
  );

  test("rejects unsafe repository inputs before GitHub requests", async () => {
    const { request } = createRequest();

    await expect(
      buildGitHubRepositoryInventory(
        requestInput({
          owner: "acme:token",
          request,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_repository" });
    expect(request).not.toHaveBeenCalled();
  });
});
