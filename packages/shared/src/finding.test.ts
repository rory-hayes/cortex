import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "./version.js";

const DOCUMENTED_FINDING_CATEGORIES = [
  "product_clarity",
  "agent_readiness",
  "architecture",
  "backlog_quality",
  "validation",
  "ci_cd",
  "security",
  "repo_hygiene",
  "execution_risk",
  "integration",
] as const;

const DOCUMENTED_FINDING_SEVERITIES = ["info", "low", "medium", "high", "blocked"] as const;

const DOCUMENTED_FINDING_STATUSES = ["open", "dismissed", "deferred", "resolved"] as const;

const DOCUMENTED_FINDING_SOURCES = [
  "deterministic_rule",
  "ai_summary",
  "manual",
  "imported",
] as const;

const UNSAFE_FINDING_METADATA_KEYS = [
  "diff",
  "patch",
  "rawDiff",
  "patchText",
  "source",
  "rawSource",
  "sourceCode",
  "snippet",
  "codeSnippet",
  "code",
  "content",
  "fileContent",
  "fileContents",
  "secret",
  "token",
  "password",
  "privateKey",
  "rawLog",
  "rawLogs",
  "stdout",
  "stdoutSummary",
  "stderr",
  "stderrSummary",
  "rawOutput",
  "rawCommandOutput",
] as const;

const UNSAFE_FINDING_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw stdout: private command output",
  "https://runner:secret@example.test/repo.git",
  "OPENAI_API_KEY=sk-finding-secret-value",
  "process.env.OPENAI_API_KEY",
] as const;

type FindingCategory = (typeof DOCUMENTED_FINDING_CATEGORIES)[number];
type FindingSeverity = (typeof DOCUMENTED_FINDING_SEVERITIES)[number];
type FindingStatus = (typeof DOCUMENTED_FINDING_STATUSES)[number];
type FindingSource = (typeof DOCUMENTED_FINDING_SOURCES)[number];
type FindingMetadata = Record<string, unknown>;

type FindingEvidence = {
  summary: string;
  paths: string[];
  metadata: FindingMetadata;
};

type Finding = {
  contractVersion: typeof CONTRACT_VERSION;
  findingId: string;
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  summary: string;
  evidence: FindingEvidence[];
  recommendation: string;
  source: FindingSource;
  deterministicRuleId: string;
  confidence: number;
  status: FindingStatus;
  createdAt: string;
  updatedAt: string;
};

type ZodIssueSummary = {
  path: PropertyKey[];
  message: string;
};

type SchemaLike = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: ZodIssueSummary[];
        };
      };
};

type FindingModule = {
  FINDING_CATEGORIES: readonly FindingCategory[];
  FINDING_SEVERITIES: readonly FindingSeverity[];
  FINDING_STATUSES: readonly FindingStatus[];
  FINDING_SOURCES: readonly FindingSource[];
  FindingCategorySchema: SchemaLike;
  FindingSeveritySchema: SchemaLike;
  FindingStatusSchema: SchemaLike;
  FindingSourceSchema: SchemaLike;
  FindingMetadataSchema: SchemaLike;
  FindingEvidenceSchema: SchemaLike;
  FindingSchema: SchemaLike;
};

const loadFindingModule = async () => (await import("./finding.js")) as FindingModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<FindingModule>;

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

const validEvidence = (overrides: Partial<FindingEvidence> = {}): FindingEvidence => ({
  summary: "Validation command metadata is not present in the repository setup.",
  paths: [".aicp/policy.json", ".github/workflows/ci.yml"],
  metadata: {
    pathCount: 2,
    referencedPaths: [".aicp/policy.json", ".github/workflows/ci.yml"],
    scanSummary: "No configured validation command metadata was detected.",
  },
  ...overrides,
});

const validFinding = (overrides: Partial<Finding> = {}): Finding => ({
  contractVersion: CONTRACT_VERSION,
  findingId: "finding-validation-001",
  workspaceId: "workspace-001",
  repoId: "repo-001",
  scanId: "scan-001",
  category: "validation",
  severity: "high",
  title: "Validation commands are missing",
  summary: "The repository does not declare validation commands that Cortex can verify.",
  evidence: [validEvidence()],
  recommendation: "Add explicit validation command metadata before enabling local execution.",
  source: "deterministic_rule",
  deterministicRuleId: "validation.commands.missing",
  confidence: 0.94,
  status: "open",
  createdAt: "2026-05-25T10:00:00.000Z",
  updatedAt: "2026-05-25T10:00:00.000Z",
  ...overrides,
});

describe("Finding", () => {
  it("exports the documented category values in canonical order", async () => {
    const { FINDING_CATEGORIES, FindingCategorySchema } = await loadFindingModule();

    expect(FINDING_CATEGORIES).toEqual(DOCUMENTED_FINDING_CATEGORIES);
    for (const category of DOCUMENTED_FINDING_CATEGORIES) {
      expect(FindingCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("exports the documented severity values in canonical order", async () => {
    const { FINDING_SEVERITIES, FindingSeveritySchema } = await loadFindingModule();

    expect(FINDING_SEVERITIES).toEqual(DOCUMENTED_FINDING_SEVERITIES);
    for (const severity of DOCUMENTED_FINDING_SEVERITIES) {
      expect(FindingSeveritySchema.safeParse(severity).success).toBe(true);
    }
  });

  it("exports conservative status and source enums", async () => {
    const { FINDING_STATUSES, FINDING_SOURCES, FindingStatusSchema, FindingSourceSchema } =
      await loadFindingModule();

    expect(FINDING_STATUSES).toEqual(DOCUMENTED_FINDING_STATUSES);
    expect(FINDING_SOURCES).toEqual(DOCUMENTED_FINDING_SOURCES);

    for (const status of DOCUMENTED_FINDING_STATUSES) {
      expect(FindingStatusSchema.safeParse(status).success).toBe(true);
    }

    for (const source of DOCUMENTED_FINDING_SOURCES) {
      expect(FindingSourceSchema.safeParse(source).success).toBe(true);
    }
  });

  it("validates a repo-readiness finding with every required field", async () => {
    const { FindingSchema } = await loadFindingModule();

    expect(FindingSchema.safeParse(validFinding()).success).toBe(true);
  });

  it("rejects missing required top-level fields", async () => {
    const { FindingSchema } = await loadFindingModule();
    const requiredFields = [
      "contractVersion",
      "findingId",
      "workspaceId",
      "repoId",
      "scanId",
      "category",
      "severity",
      "title",
      "summary",
      "evidence",
      "recommendation",
      "source",
      "deterministicRuleId",
      "confidence",
      "status",
      "createdAt",
      "updatedAt",
    ] as const;

    for (const field of requiredFields) {
      const candidate: Partial<Finding> = { ...validFinding() };
      delete candidate[field];

      const result = FindingSchema.safeParse(candidate);

      expect(result.success, `Expected missing ${field} to be rejected.`).toBe(false);
    }
  });

  it("requires confidence to stay within the 0..1 range", async () => {
    const { FindingSchema } = await loadFindingModule();

    expect(FindingSchema.safeParse(validFinding({ confidence: 0 })).success).toBe(true);
    expect(FindingSchema.safeParse(validFinding({ confidence: 1 })).success).toBe(true);
    expect(FindingSchema.safeParse(validFinding({ confidence: -0.01 })).success).toBe(false);
    expect(FindingSchema.safeParse(validFinding({ confidence: 1.01 })).success).toBe(false);
  });

  it("rejects unknown top-level fields", async () => {
    const { FindingSchema } = await loadFindingModule();
    const result = FindingSchema.safeParse({
      ...validFinding(),
      rawPayload: "metadata-only contracts must not accept arbitrary fields",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issuePath(issue.path))).toContain("<root>");
    }
  });

  it("rejects unsafe evidence metadata keys recursively", async () => {
    const { FindingSchema, FindingMetadataSchema } = await loadFindingModule();

    for (const key of UNSAFE_FINDING_METADATA_KEYS) {
      const metadata = {
        safeSummary: "Only metadata summaries are allowed.",
        nested: [{ [key]: "placeholder value" }],
      };
      const findingResult = FindingSchema.safeParse(
        validFinding({
          evidence: [
            validEvidence({
              metadata,
            }),
          ],
        }),
      );
      const metadataResult = FindingMetadataSchema.safeParse(metadata);

      expect(findingResult.success, `Expected finding metadata key ${key} to be rejected.`).toBe(
        false,
      );
      expect(metadataResult.success, `Expected metadata key ${key} to be rejected.`).toBe(false);

      if (!findingResult.success) {
        expect(findingResult.error.issues.map((issue) => issuePath(issue.path))).toContain(
          `evidence.0.metadata.nested.0.${key}`,
        );
      }
    }
  });

  it("rejects source-like, raw-log, and secret-like text values across finding payloads", async () => {
    const { FindingSchema } = await loadFindingModule();

    for (const unsafeValue of UNSAFE_FINDING_VALUES) {
      expect(
        FindingSchema.safeParse(
          validFinding({
            evidence: [
              validEvidence({
                metadata: {
                  safeKey: unsafeValue,
                },
              }),
            ],
          }),
        ).success,
        `Expected finding metadata value to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        FindingSchema.safeParse(
          validFinding({
            summary: unsafeValue,
          }),
        ).success,
        `Expected finding summary value to reject ${unsafeValue}`,
      ).toBe(false);
    }
  });

  it("keeps evidence metadata path-summary oriented", async () => {
    const { FindingEvidenceSchema } = await loadFindingModule();

    expect(FindingEvidenceSchema.safeParse(validEvidence()).success).toBe(true);
    expect(
      FindingEvidenceSchema.safeParse({
        ...validEvidence(),
        sourceCode: "placeholder",
      }).success,
    ).toBe(false);
  });

  it("exports the finding contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.FINDING_CATEGORIES).toEqual(DOCUMENTED_FINDING_CATEGORIES);
    expect(shared.FindingCategorySchema?.safeParse("validation").success).toBe(true);
    expect(shared.FINDING_SEVERITIES).toEqual(DOCUMENTED_FINDING_SEVERITIES);
    expect(shared.FindingSeveritySchema?.safeParse("blocked").success).toBe(true);
    expect(shared.FINDING_STATUSES).toEqual(DOCUMENTED_FINDING_STATUSES);
    expect(shared.FindingStatusSchema?.safeParse("resolved").success).toBe(true);
    expect(shared.FINDING_SOURCES).toEqual(DOCUMENTED_FINDING_SOURCES);
    expect(shared.FindingSourceSchema?.safeParse("manual").success).toBe(true);
    expect(shared.FindingSchema?.safeParse(validFinding()).success).toBe(true);
  });
});
