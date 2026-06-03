export type GitHubAppPermissionProfileMode = "scan_only" | "setup_pr" | "pr_visibility";

export type GitHubAppPermissionAccessLevel = "read" | "write";
export type GitHubAppGrantedPermissionAccessLevel = GitHubAppPermissionAccessLevel | "admin";
export type GitHubAppActualPermissionAccessLevel = "none" | GitHubAppGrantedPermissionAccessLevel;

export type GitHubAppPermissionProfileRequirement = {
  access: GitHubAppPermissionAccessLevel;
  permission: string;
};

export type GitHubAppPermissionProfile = {
  label: string;
  mode: GitHubAppPermissionProfileMode;
  requiredPermissions: readonly GitHubAppPermissionProfileRequirement[];
  requiresRunner: boolean;
};

export type GitHubAppRejectedMvpPermission = {
  access: GitHubAppPermissionAccessLevel;
  label: string;
  permission: string;
};

export type GitHubAppGrantedPermission = {
  access: GitHubAppGrantedPermissionAccessLevel;
  label: string;
  permission: string;
};

export type GitHubAppPermissionReviewMissingPermission = {
  access: GitHubAppPermissionAccessLevel;
  actualAccess: GitHubAppActualPermissionAccessLevel;
  label: string;
  permission: string;
};

export type GitHubAppPermissionReviewExcessPermission =
  GitHubAppPermissionReviewMissingPermission & {
    reason: "exceeds_required_access" | "not_required_for_profile";
  };

export type GitHubAppPermissionProfileReview = {
  excessPermissions: GitHubAppPermissionReviewExcessPermission[];
  label: string;
  missingPermissions: GitHubAppPermissionReviewMissingPermission[];
  mode: GitHubAppPermissionProfileMode;
  requiredPermissions: readonly GitHubAppPermissionProfileRequirement[];
  requiresRunner: boolean;
  supported: boolean;
};

export type GitHubAppPermissionsReview = {
  grantedPermissions: GitHubAppGrantedPermission[];
  omittedPermissionCount: number;
  profiles: Record<GitHubAppPermissionProfileMode, GitHubAppPermissionProfileReview>;
  rejectedPermissions: GitHubAppGrantedPermission[];
};

export type ReviewGitHubAppPermissionsOptions = {
  allowWriteToSatisfyRead?: boolean;
};

export const GITHUB_APP_PERMISSION_PROFILES = {
  scan_only: {
    label: "Scan-only",
    mode: "scan_only",
    requiredPermissions: [
      { permission: "metadata", access: "read" },
      { permission: "contents", access: "read" },
    ],
    requiresRunner: false,
  },
  setup_pr: {
    label: "Setup-PR",
    mode: "setup_pr",
    requiredPermissions: [
      { permission: "metadata", access: "read" },
      { permission: "contents", access: "write" },
      { permission: "pull_requests", access: "write" },
    ],
    requiresRunner: false,
  },
  pr_visibility: {
    label: "PR visibility",
    mode: "pr_visibility",
    requiredPermissions: [
      { permission: "pull_requests", access: "read" },
      { permission: "checks", access: "read" },
    ],
    requiresRunner: false,
  },
} as const satisfies Record<GitHubAppPermissionProfileMode, GitHubAppPermissionProfile>;

export const GITHUB_APP_REJECTED_MVP_PERMISSIONS = [
  { permission: "administration", access: "read", label: "Repository administration" },
  { permission: "secrets", access: "read", label: "Repository secrets" },
  { permission: "actions", access: "write", label: "GitHub Actions" },
  { permission: "workflows", access: "write", label: "Workflow file updates" },
  { permission: "checks", access: "write", label: "Check run mutation" },
  { permission: "issues", access: "write", label: "Issue mutation" },
] as const satisfies readonly GitHubAppRejectedMvpPermission[];

const ACCESS_RANK: Record<GitHubAppActualPermissionAccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const PERMISSION_LABELS: Record<string, string> = {
  actions: "GitHub Actions",
  administration: "Repository administration",
  checks: "Checks",
  contents: "Repository contents",
  issues: "Issues",
  metadata: "Repository metadata",
  pull_requests: "Pull requests",
  secrets: "Repository secrets",
  workflows: "Workflow file updates",
};

const UNSAFE_PERMISSION_PATTERN =
  /(?:api[_-]?key|command|credential|diff|passw(?:or)?d|patch|private[_-]?key|raw|snippet|source|stderr|stdout|token)/iu;

const safePermissionName = (permission: string): boolean =>
  permission.length > 0 &&
  permission.length <= 80 &&
  /^[a-z_]+$/u.test(permission) &&
  !UNSAFE_PERMISSION_PATTERN.test(permission);

const grantedAccess = (value: string): value is GitHubAppGrantedPermissionAccessLevel =>
  value === "read" || value === "write" || value === "admin";

const labelForPermission = (permission: string): string =>
  PERMISSION_LABELS[permission] ?? permission.replaceAll("_", " ");

const normalizePermissions = (
  permissions: Record<string, string>,
): {
  omittedPermissionCount: number;
  permissions: Record<string, GitHubAppGrantedPermissionAccessLevel>;
} => {
  const normalizedPermissions: Record<string, GitHubAppGrantedPermissionAccessLevel> = {};
  let omittedPermissionCount = 0;

  for (const [rawPermission, rawAccess] of Object.entries(permissions).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const permission = rawPermission.trim();
    const access = rawAccess.trim();

    if (!safePermissionName(permission) || !grantedAccess(access)) {
      omittedPermissionCount += 1;
      continue;
    }

    normalizedPermissions[permission] = access;
  }

  return {
    omittedPermissionCount,
    permissions: normalizedPermissions,
  };
};

const actualAccessFor = (
  permissions: Record<string, GitHubAppGrantedPermissionAccessLevel>,
  permission: string,
): GitHubAppActualPermissionAccessLevel => permissions[permission] ?? "none";

const satisfiesRequirement = (
  actualAccess: GitHubAppActualPermissionAccessLevel,
  requiredAccess: GitHubAppPermissionAccessLevel,
  options: ReviewGitHubAppPermissionsOptions,
): boolean => {
  if (actualAccess === requiredAccess) {
    return true;
  }

  return (
    options.allowWriteToSatisfyRead === true &&
    requiredAccess === "read" &&
    (actualAccess === "write" || actualAccess === "admin")
  );
};

const missingPermissionFor = (
  requirement: GitHubAppPermissionProfileRequirement,
  actualAccess: GitHubAppActualPermissionAccessLevel,
): GitHubAppPermissionReviewMissingPermission => ({
  ...requirement,
  actualAccess,
  label: labelForPermission(requirement.permission),
});

const excessPermissionFor = (
  requirement: GitHubAppPermissionProfileRequirement,
  actualAccess: GitHubAppActualPermissionAccessLevel,
): GitHubAppPermissionReviewExcessPermission | null => {
  if (ACCESS_RANK[actualAccess] <= ACCESS_RANK[requirement.access]) {
    return null;
  }

  return {
    ...missingPermissionFor(requirement, actualAccess),
    reason: "exceeds_required_access",
  };
};

const reviewProfile = (
  profile: GitHubAppPermissionProfile,
  permissions: Record<string, GitHubAppGrantedPermissionAccessLevel>,
  options: ReviewGitHubAppPermissionsOptions,
): GitHubAppPermissionProfileReview => {
  const requiredPermissionNames = new Set(
    profile.requiredPermissions.map((requirement) => requirement.permission),
  );
  const missingPermissions: GitHubAppPermissionReviewMissingPermission[] = [];
  const excessPermissions: GitHubAppPermissionReviewExcessPermission[] = [];

  for (const requirement of profile.requiredPermissions) {
    const actualAccess = actualAccessFor(permissions, requirement.permission);

    if (!satisfiesRequirement(actualAccess, requirement.access, options)) {
      missingPermissions.push(missingPermissionFor(requirement, actualAccess));
    }

    const excessPermission = excessPermissionFor(requirement, actualAccess);

    if (excessPermission !== null) {
      excessPermissions.push(excessPermission);
    }
  }

  for (const [permission, actualAccess] of Object.entries(permissions)) {
    if (requiredPermissionNames.has(permission) || ACCESS_RANK[actualAccess] <= ACCESS_RANK.read) {
      continue;
    }

    excessPermissions.push({
      access: "read",
      actualAccess,
      label: labelForPermission(permission),
      permission,
      reason: "not_required_for_profile",
    });
  }

  return {
    excessPermissions: excessPermissions.toSorted((left, right) =>
      left.permission.localeCompare(right.permission),
    ),
    label: profile.label,
    missingPermissions,
    mode: profile.mode,
    requiredPermissions: profile.requiredPermissions,
    requiresRunner: profile.requiresRunner,
    supported: missingPermissions.length === 0,
  };
};

const buildRejectedPermissions = (
  permissions: Record<string, GitHubAppGrantedPermissionAccessLevel>,
): GitHubAppGrantedPermission[] => {
  const rejectedByPermission = new Map<string, GitHubAppRejectedMvpPermission>(
    GITHUB_APP_REJECTED_MVP_PERMISSIONS.map((permission) => [permission.permission, permission]),
  );

  return Object.entries(permissions)
    .flatMap(([permission, access]): GitHubAppGrantedPermission[] => {
      const rejectedPermission = rejectedByPermission.get(permission);

      if (
        rejectedPermission === undefined ||
        ACCESS_RANK[access] < ACCESS_RANK[rejectedPermission.access]
      ) {
        return [];
      }

      return [
        {
          access,
          label: rejectedPermission.label,
          permission,
        },
      ];
    })
    .toSorted((left, right) => left.permission.localeCompare(right.permission));
};

export const reviewGitHubAppPermissions = (
  permissions: Record<string, string>,
  options: ReviewGitHubAppPermissionsOptions = {},
): GitHubAppPermissionsReview => {
  const normalized = normalizePermissions(permissions);

  return {
    grantedPermissions: Object.entries(normalized.permissions).map(([permission, access]) => ({
      access,
      label: labelForPermission(permission),
      permission,
    })),
    omittedPermissionCount: normalized.omittedPermissionCount,
    profiles: {
      scan_only: reviewProfile(
        GITHUB_APP_PERMISSION_PROFILES.scan_only,
        normalized.permissions,
        options,
      ),
      setup_pr: reviewProfile(GITHUB_APP_PERMISSION_PROFILES.setup_pr, normalized.permissions, {
        ...options,
        allowWriteToSatisfyRead: true,
      }),
      pr_visibility: reviewProfile(
        GITHUB_APP_PERMISSION_PROFILES.pr_visibility,
        normalized.permissions,
        options,
      ),
    },
    rejectedPermissions: buildRejectedPermissions(normalized.permissions),
  };
};
