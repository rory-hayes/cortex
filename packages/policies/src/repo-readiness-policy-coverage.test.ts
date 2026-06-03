import { describe, expect, test } from "vitest";

import type { RepoScanPolicySummary } from "@control-plane/shared";

import { assessRepoReadinessPolicyCoverage } from "./repo-readiness-policy-coverage.js";

const policySummary = (overrides: Partial<RepoScanPolicySummary> = {}): RepoScanPolicySummary => ({
  dryRunCheckCount: 11,
  hasPolicyFile: true,
  protectedPathCount: 2,
  sensitivePathCount: 2,
  validationCommandCount: 3,
  ...overrides,
});

const expectNoUnsafePolicyCoverageMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);
      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      if (
        /^(?:command|content|diff|patch|paths|rawOutput|secret|source|stderr|stdout|token)$/iu.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(unsafeKeys).toEqual([]);
  expect(serialized).not.toMatch(
    /\.env|diff --git|@@|patch|snippet|export const|process\.env|ghp_|sk-proj-|BEGIN PRIVATE KEY|stdout|stderr|raw provider/iu,
  );
};

describe("repo-readiness policy coverage assessment", () => {
  test("marks missing coverage when no repository policy file is present", () => {
    const assessment = assessRepoReadinessPolicyCoverage(
      policySummary({
        dryRunCheckCount: 0,
        hasPolicyFile: false,
        protectedPathCount: 0,
        sensitivePathCount: 0,
        validationCommandCount: 0,
      }),
    );

    expect(assessment).toEqual({
      coverageStatus: "missing",
      dryRunCheckCount: 0,
      hasPolicyFile: false,
      missingCoverageLabels: ["repository policy", "protected area rules", "sensitive area rules"],
      protectedPathCount: 0,
      recommendedRuleLabels: [
        "Create repository policy",
        "Add protected area rules",
        "Add sensitive area rules",
      ],
      sensitivePathCount: 0,
      validationCommandCount: 0,
    });
    expectNoUnsafePolicyCoverageMaterial(assessment);
  });

  test("marks incomplete coverage when protected area rules are absent", () => {
    const assessment = assessRepoReadinessPolicyCoverage(policySummary({ protectedPathCount: 0 }));

    expect(assessment).toMatchObject({
      coverageStatus: "incomplete",
      missingCoverageLabels: ["protected area rules"],
      protectedPathCount: 0,
      recommendedRuleLabels: ["Add protected area rules"],
      sensitivePathCount: 2,
    });
    expectNoUnsafePolicyCoverageMaterial(assessment);
  });

  test("marks incomplete coverage when sensitive area rules are absent", () => {
    const assessment = assessRepoReadinessPolicyCoverage(policySummary({ sensitivePathCount: 0 }));

    expect(assessment).toMatchObject({
      coverageStatus: "incomplete",
      missingCoverageLabels: ["sensitive area rules"],
      protectedPathCount: 2,
      recommendedRuleLabels: ["Add sensitive area rules"],
      sensitivePathCount: 0,
    });
    expectNoUnsafePolicyCoverageMaterial(assessment);
  });

  test("marks policy coverage ready when protected and sensitive rule counts are present", () => {
    const assessment = assessRepoReadinessPolicyCoverage(policySummary());

    expect(assessment).toEqual({
      coverageStatus: "ready",
      dryRunCheckCount: 11,
      hasPolicyFile: true,
      missingCoverageLabels: [],
      protectedPathCount: 2,
      recommendedRuleLabels: [],
      sensitivePathCount: 2,
      validationCommandCount: 3,
    });
    expectNoUnsafePolicyCoverageMaterial(assessment);
  });
});
