import type { GitHubAppInstallationData } from "@/src/github/installations";
import type { GitHubRepositoryData } from "@/src/github/repositories";
import {
  reviewGitHubAppPermissions,
  type GitHubAppGrantedPermission,
  type GitHubAppPermissionProfileReview,
  type GitHubAppPermissionReviewExcessPermission,
} from "@control-plane/github";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type GitHubSettingsProps = {
  installations: GitHubAppInstallationData[];
  repositories: GitHubRepositoryData[];
  workspaceName?: string;
};

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const formatRepositorySelection = (selection: GitHubAppInstallationData["repositorySelection"]) =>
  selection === "all" ? "All repositories" : "Selected repositories";

const formatPermissionName = (permission: string) => permission.replaceAll("_", " ");

const formatPermission = (permission: GitHubAppGrantedPermission) =>
  `${formatPermissionName(permission.permission)} ${permission.access.replaceAll("_", " ")}`;

const formatPermissions = (permissions: GitHubAppGrantedPermission[]) => {
  if (permissions.length === 0) {
    return "No permissions reported";
  }

  return permissions.map(formatPermission).join(", ");
};

const formatProfileLabel = (label: string) => (label === "Setup-PR" ? "Setup PR" : label);

const formatPermissionReviewStatus = (
  review: GitHubAppPermissionProfileReview,
  options: { blockedByRejectedPermissions?: boolean } = {},
) => {
  const profileLabel = formatProfileLabel(review.label);

  if (options.blockedByRejectedPermissions === true) {
    return `${profileLabel} blocked by rejected permissions`;
  }

  return `${profileLabel} ${review.supported ? "ready" : "needs permission upgrade"}`;
};

const formatMissingPermission = (
  missingPermission: GitHubAppPermissionProfileReview["missingPermissions"][number],
) => `Missing ${formatPermissionName(missingPermission.permission)} ${missingPermission.access}`;

const formatRejectedPermission = (permission: GitHubAppGrantedPermission) =>
  `${permission.label} ${permission.access}`;

const formatLeastPrivilegeWarning = (
  warning: GitHubAppPermissionReviewExcessPermission,
  profileReview: GitHubAppPermissionProfileReview,
) => {
  const profileLabel = formatProfileLabel(profileReview.label).toLowerCase();

  if (warning.reason === "not_required_for_profile") {
    return `${formatPermissionName(warning.permission)} ${warning.actualAccess} is not required for ${profileLabel}`;
  }

  const requirement = profileReview.requiredPermissions.find(
    (item) => item.permission === warning.permission,
  );

  return `${formatPermissionName(warning.permission)} ${warning.actualAccess} exceeds ${profileLabel} ${requirement?.access ?? "required"} access`;
};

const formatVisibility = (repository: GitHubRepositoryData): string => {
  if (repository.visibility === "internal") {
    return "Internal";
  }

  return repository.isPrivate ? "Private" : "Public";
};

const getRepositoryStates = (repository: GitHubRepositoryData): string[] => {
  const states = [];

  if (repository.archived) {
    states.push("Archived");
  }

  if (repository.disabled) {
    states.push("Disabled");
  }

  return states.length > 0 ? states : ["Active"];
};

export function GitHubSettings({
  installations,
  repositories,
  workspaceName,
}: GitHubSettingsProps) {
  const workspaceLabel = workspaceName ?? "selected workspace";
  const activeInstallationCount = installations.filter(
    (installation) => installation.suspendedAt === null,
  ).length;
  const suspendedInstallationCount = installations.length - activeInstallationCount;
  const matchedRepositoryCount = repositories.filter(
    (repository) => repository.matchedRepoMappingId !== null,
  ).length;

  const stats = [
    {
      label: "Installations",
      value: formatCount(installations.length, "installation"),
    },
    {
      label: "Active",
      value: `${activeInstallationCount} active`,
    },
    {
      label: "Suspended",
      value: `${suspendedInstallationCount} suspended`,
    },
    {
      label: "Synced repositories",
      value: formatCount(repositories.length, "synced repository", "synced repositories"),
    },
    {
      label: "Local mappings",
      value: `${matchedRepositoryCount} matched to local mappings`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="github-visibility"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">GitHub connection</p>
            <h2 id="github-visibility" className="mt-1 text-base font-semibold">
              GitHub visibility
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              GitHub App data for {workspaceLabel} is metadata-only visibility. It shows
              installation and repository status and does not execute code in v1.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Metadata-only</Badge>
            <Badge variant="outline">Visibility only</Badge>
            <Badge variant="secondary">Local runner execution</Badge>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {stats.map((item) => (
            <div className="rounded-md border border-border bg-background p-4" key={item.label}>
              <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
              <dd className="mt-2 break-words text-lg font-semibold tracking-normal">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="github-installations"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">GitHub App</p>
          <h2 id="github-installations" className="text-base font-semibold">
            Installations
          </h2>
        </div>

        {installations.length === 0 ? (
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            No GitHub App installations synced for this workspace.
          </p>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {installations.map((installation) => {
              const suspendedAt = installation.suspendedAt;
              const suspended = suspendedAt !== null;
              const permissionReview = reviewGitHubAppPermissions(installation.permissions);
              const permissionCount = permissionReview.grantedPermissions.length;
              const scanOnlyReview = permissionReview.profiles.scan_only;
              const setupPrReview = permissionReview.profiles.setup_pr;
              const rejectedPermissions = permissionReview.rejectedPermissions;
              const scanOnlyBlockedByRejectedPermissions =
                scanOnlyReview.supported && rejectedPermissions.length > 0;

              return (
                <article
                  aria-labelledby={`github-installation-${installation.id}`}
                  className="rounded-md border border-border bg-background p-4"
                  key={installation.id}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3
                        id={`github-installation-${installation.id}`}
                        className="text-sm font-semibold"
                      >
                        {installation.accountLogin}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {installation.accountType}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={suspended ? "destructive" : "secondary"}>
                        {suspended ? "Suspended" : "Active"}
                      </Badge>
                      <Badge variant="outline">
                        {formatRepositorySelection(installation.repositorySelection)}
                      </Badge>
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm">
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Permissions
                      </dt>
                      <dd className="mt-1">
                        {formatCount(permissionCount, "permission")}
                        {" · "}
                        {formatPermissions(permissionReview.grantedPermissions)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Repository scan permissions
                      </dt>
                      <dd className="mt-2 flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant={
                              scanOnlyBlockedByRejectedPermissions
                                ? "destructive"
                                : scanOnlyReview.supported
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {formatPermissionReviewStatus(scanOnlyReview, {
                              blockedByRejectedPermissions: scanOnlyBlockedByRejectedPermissions,
                            })}
                          </Badge>
                          <Badge variant={setupPrReview.supported ? "secondary" : "outline"}>
                            {formatPermissionReviewStatus(setupPrReview)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Scan-only does not require a runner.
                        </p>
                        {setupPrReview.missingPermissions.length === 0 ? null : (
                          <ul className="grid gap-1 text-sm text-muted-foreground">
                            {setupPrReview.missingPermissions.map((missingPermission) => (
                              <li
                                key={`${missingPermission.permission}:${missingPermission.access}`}
                              >
                                {formatMissingPermission(missingPermission)}
                              </li>
                            ))}
                          </ul>
                        )}
                        {rejectedPermissions.length === 0 ? null : (
                          <div className="grid gap-1 text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">Rejected MVP permissions</p>
                            <ul className="grid gap-1">
                              {rejectedPermissions.map((permission) => (
                                <li key={`${permission.permission}:${permission.access}`}>
                                  {formatRejectedPermission(permission)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {scanOnlyReview.excessPermissions.length === 0 ? null : (
                          <div className="grid gap-1 text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">Least-privilege warnings</p>
                            <ul className="grid gap-1">
                              {scanOnlyReview.excessPermissions.map((warning) => (
                                <li key={`${warning.permission}:${warning.actualAccess}`}>
                                  {formatLeastPrivilegeWarning(warning, scanOnlyReview)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Last sync
                      </dt>
                      <dd className="mt-1">Synced {formatDate(installation.lastSyncedAt)}</dd>
                    </div>
                    {suspended ? (
                      <div>
                        <dt className="text-xs font-medium uppercase text-muted-foreground">
                          Suspension
                        </dt>
                        <dd className="mt-1">Suspended {formatDate(suspendedAt)}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {installation.installationHtmlUrl === null ? null : (
                    <Button asChild className="mt-4" size="sm" variant="outline">
                      <a href={installation.installationHtmlUrl} rel="noreferrer" target="_blank">
                        Open installation
                      </a>
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="github-repositories"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Repository metadata</p>
          <h2 id="github-repositories" className="text-base font-semibold">
            Synced repositories
          </h2>
        </div>

        {repositories.length === 0 ? (
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            No synced GitHub repositories for this workspace.
          </p>
        ) : (
          <div className="mt-5">
            <Table aria-label="Synced GitHub repositories">
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Default branch</TableHead>
                  <TableHead>Repository state</TableHead>
                  <TableHead>Local mapping</TableHead>
                  <TableHead>Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((repository) => (
                  <TableRow key={repository.id}>
                    <TableCell className="font-medium">{repository.repositoryFullName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{formatVisibility(repository)}</Badge>
                    </TableCell>
                    <TableCell>{repository.defaultBranch}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {getRepositoryStates(repository).map((state) => (
                          <Badge key={state} variant={state === "Active" ? "secondary" : "outline"}>
                            {state}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={repository.matchedRepoMappingId === null ? "outline" : "secondary"}
                      >
                        {repository.matchedRepoMappingId === null ? "Unmatched" : "Matched"}
                      </Badge>
                    </TableCell>
                    <TableCell>Synced {formatDate(repository.lastSyncedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
