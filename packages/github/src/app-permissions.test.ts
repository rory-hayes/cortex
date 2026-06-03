import { readFileSync } from "node:fs";

import * as github from "@control-plane/github";
import { describe, expect, it } from "vitest";

import {
  GITHUB_APP_PERMISSION_PROFILES,
  GITHUB_APP_REJECTED_MVP_PERMISSIONS,
  reviewGitHubAppPermissions,
} from "./app-permissions.js";

describe("GitHub App permission profiles", () => {
  it("exports canonical scan-only, setup-PR, and PR visibility profiles", () => {
    expect(github.GITHUB_APP_PERMISSION_PROFILES).toBe(GITHUB_APP_PERMISSION_PROFILES);
    expect(github.GITHUB_APP_REJECTED_MVP_PERMISSIONS).toBe(GITHUB_APP_REJECTED_MVP_PERMISSIONS);
    expect(github.reviewGitHubAppPermissions).toBe(reviewGitHubAppPermissions);

    expect(GITHUB_APP_PERMISSION_PROFILES.scan_only).toMatchObject({
      mode: "scan_only",
      requiresRunner: false,
      requiredPermissions: [
        { permission: "metadata", access: "read" },
        { permission: "contents", access: "read" },
      ],
    });
    const scanOnlyRequiredPermissions: readonly { access: string }[] =
      GITHUB_APP_PERMISSION_PROFILES.scan_only.requiredPermissions;
    expect(scanOnlyRequiredPermissions.some((requirement) => requirement.access === "write")).toBe(
      false,
    );

    expect(GITHUB_APP_PERMISSION_PROFILES.setup_pr).toMatchObject({
      mode: "setup_pr",
      requiredPermissions: [
        { permission: "metadata", access: "read" },
        { permission: "contents", access: "write" },
        { permission: "pull_requests", access: "write" },
      ],
    });
    expect(GITHUB_APP_PERMISSION_PROFILES.pr_visibility).toMatchObject({
      mode: "pr_visibility",
      requiredPermissions: [
        { permission: "pull_requests", access: "read" },
        { permission: "checks", access: "read" },
      ],
    });

    const profilePermissions = new Set(
      Object.values(GITHUB_APP_PERMISSION_PROFILES).flatMap((profile) =>
        profile.requiredPermissions.map((requirement) => requirement.permission),
      ),
    );
    expect(profilePermissions).not.toContain("administration");
    expect(profilePermissions).not.toContain("secrets");
    expect(profilePermissions).not.toContain("actions");
    expect(profilePermissions).not.toContain("workflows");
    expect(profilePermissions).not.toContain("issues");
    expect(GITHUB_APP_PERMISSION_PROFILES.pr_visibility.requiredPermissions).not.toContainEqual({
      permission: "checks",
      access: "write",
    });
    expect(GITHUB_APP_REJECTED_MVP_PERMISSIONS).toEqual(
      expect.arrayContaining([
        { permission: "administration", access: "read", label: "Repository administration" },
        { permission: "secrets", access: "read", label: "Repository secrets" },
        { permission: "actions", access: "write", label: "GitHub Actions" },
        { permission: "workflows", access: "write", label: "Workflow file updates" },
        { permission: "checks", access: "write", label: "Check run mutation" },
        { permission: "issues", access: "write", label: "Issue mutation" },
      ]),
    );
  });
});

describe("reviewGitHubAppPermissions", () => {
  it("marks metadata read and contents read as supporting scan-only without a runner", () => {
    const review = reviewGitHubAppPermissions({
      contents: "read",
      metadata: "read",
    });

    expect(review.profiles.scan_only).toMatchObject({
      mode: "scan_only",
      requiresRunner: false,
      supported: true,
    });
    expect(review.profiles.scan_only.missingPermissions).toEqual([]);
    expect(review.profiles.scan_only.excessPermissions).toEqual([]);
  });

  it("fails scan-only when contents read is missing", () => {
    const review = reviewGitHubAppPermissions({
      metadata: "read",
    });

    expect(review.profiles.scan_only.supported).toBe(false);
    expect(review.profiles.scan_only.missingPermissions).toEqual([
      {
        actualAccess: "none",
        access: "read",
        label: "Repository contents",
        permission: "contents",
      },
    ]);
  });

  it("flags contents write as excessive for scan-only and allows it only when requested", () => {
    const strictReview = reviewGitHubAppPermissions({
      contents: "write",
      metadata: "read",
    });
    const compatibilityReview = reviewGitHubAppPermissions(
      {
        contents: "write",
        metadata: "read",
      },
      { allowWriteToSatisfyRead: true },
    );

    expect(strictReview.profiles.scan_only.supported).toBe(false);
    expect(strictReview.profiles.scan_only.missingPermissions).toEqual([
      {
        actualAccess: "write",
        access: "read",
        label: "Repository contents",
        permission: "contents",
      },
    ]);
    expect(strictReview.profiles.scan_only.excessPermissions).toEqual([
      {
        actualAccess: "write",
        access: "read",
        label: "Repository contents",
        permission: "contents",
        reason: "exceeds_required_access",
      },
    ]);
    expect(compatibilityReview.profiles.scan_only.supported).toBe(true);
    expect(compatibilityReview.profiles.scan_only.missingPermissions).toEqual([]);
    expect(compatibilityReview.profiles.scan_only.excessPermissions).toEqual(
      strictReview.profiles.scan_only.excessPermissions,
    );
  });

  it("requires write permissions for setup PR generation", () => {
    const readOnlyReview = reviewGitHubAppPermissions({
      contents: "read",
      metadata: "read",
      pull_requests: "read",
    });
    const setupPrReview = reviewGitHubAppPermissions({
      contents: "write",
      metadata: "read",
      pull_requests: "write",
    });

    expect(readOnlyReview.profiles.setup_pr.supported).toBe(false);
    expect(readOnlyReview.profiles.setup_pr.missingPermissions).toEqual([
      {
        actualAccess: "read",
        access: "write",
        label: "Repository contents",
        permission: "contents",
      },
      {
        actualAccess: "read",
        access: "write",
        label: "Pull requests",
        permission: "pull_requests",
      },
    ]);
    expect(setupPrReview.profiles.setup_pr.supported).toBe(true);
    expect(setupPrReview.profiles.setup_pr.missingPermissions).toEqual([]);
  });

  it("supports optional PR and check status visibility with read-only permissions", () => {
    const review = reviewGitHubAppPermissions({
      checks: "read",
      pull_requests: "read",
    });

    expect(review.profiles.pr_visibility).toMatchObject({
      mode: "pr_visibility",
      supported: true,
    });
    expect(review.profiles.pr_visibility.missingPermissions).toEqual([]);
  });

  it("flags broad GitHub permissions as rejected for MVP profiles", () => {
    const review = reviewGitHubAppPermissions({
      actions: "write",
      administration: "write",
      checks: "write",
      contents: "read",
      issues: "write",
      metadata: "read",
      secrets: "write",
      workflows: "write",
    });

    expect(review.profiles.scan_only.supported).toBe(true);
    expect(review.rejectedPermissions).toEqual([
      { permission: "actions", access: "write", label: "GitHub Actions" },
      { permission: "administration", access: "write", label: "Repository administration" },
      { permission: "checks", access: "write", label: "Check run mutation" },
      { permission: "issues", access: "write", label: "Issue mutation" },
      { permission: "secrets", access: "write", label: "Repository secrets" },
      { permission: "workflows", access: "write", label: "Workflow file updates" },
    ]);
  });

  it("rejects administration and secrets grants even when GitHub reports read access", () => {
    const review = reviewGitHubAppPermissions({
      administration: "read",
      contents: "read",
      metadata: "read",
      secrets: "read",
    });

    expect(review.rejectedPermissions).toEqual([
      { permission: "administration", access: "read", label: "Repository administration" },
      { permission: "secrets", access: "read", label: "Repository secrets" },
    ]);
  });
});

describe("GitHub App permissions documentation", () => {
  it("records the canonical permission list and mode boundaries", () => {
    const document = readFileSync(
      new URL("../../../docs/GITHUB_APP_PERMISSIONS.md", import.meta.url),
      "utf8",
    );

    expect(document).toContain("Permission List");
    expect(document).toContain("least-privilege");
    expect(document).toContain("Scan-only");
    expect(document).toContain("Setup-PR");
    expect(document).toContain("No runner installation is required for scan-only mode.");
  });
});
