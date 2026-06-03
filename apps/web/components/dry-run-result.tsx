import type {
  DryRunCheckResultStatus,
  DryRunResult,
  DryRunResultStatus,
  RiskFinding,
  RunnerCapabilities,
  ToolCapability,
} from "@control-plane/shared";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DryRunResultDisplayProps = {
  result: DryRunResult | null;
};

type BadgeVariant = "destructive" | "outline" | "secondary";

type MetadataEntry = {
  key: string;
  value: string;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const resultLabels = {
  failed: "Failed",
  passed: "Passed",
  warning: "Warning",
} satisfies Record<DryRunResultStatus, string>;

const checkStatusLabels = {
  failed: "Failed",
  passed: "Passed",
  skipped: "Skipped",
  warning: "Warning",
} satisfies Record<DryRunCheckResultStatus, string>;

const statusVariant = (status: DryRunCheckResultStatus | DryRunResultStatus): BadgeVariant => {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "warning" || status === "skipped") {
    return "outline";
  }

  return "secondary";
};

const unsafeMetadataKeys = new Set([
  "acceptancecriteria",
  "capabilitiessnapshot",
  "changedpaths",
  "checkoutroot",
  "command",
  "commandline",
  "commands",
  "commandtext",
  "content",
  "contents",
  "contextfilepaths",
  "credentials",
  "diff",
  "filecontent",
  "filecontents",
  "localpath",
  "logs",
  "objective",
  "patch",
  "policysnapshot",
  "rawlogs",
  "rawoutput",
  "riskfindings",
  "shellcommand",
  "snippet",
  "source",
  "sourcecode",
  "taskpacket",
  "validationcommands",
  "repopath",
  "repositorypath",
  "worktreepath",
]);

const unsafePayloadMetadataKeyPattern =
  /^(?:raw|full|unified|git)?(?:diff|patch|source|code)(?:text|content|contents|snippet|snippets|filecontent|filecontents|body|data|blob|value|code|line|lines)?$/;

const unsafeLogMetadataKeyPattern =
  /^(?:raw|full)?(?:stdout|stderr|output|log|logs)(?:text|content|contents|body|data|blob|value|line|lines)?$/;

const unsafeCredentialMetadataKeyPattern =
  /(?:apikey|credential|password|passwd|privatekey|secret|token)/;

const unsafeAbsolutePathValuePattern =
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[a-z]:[\\/]|\\\\))/i;
const absolutePathStartPattern = /^(?:\/(?!\/)|[a-z]:[\\/]|\\\\)/i;

const normalizeMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isUnsafeMetadataKey = (key: string): boolean => {
  const normalizedKey = normalizeMetadataKey(key);

  return (
    unsafeMetadataKeys.has(normalizedKey) ||
    normalizedKey.endsWith("path") ||
    normalizedKey.endsWith("paths") ||
    unsafePayloadMetadataKeyPattern.test(normalizedKey) ||
    unsafeLogMetadataKeyPattern.test(normalizedKey) ||
    unsafeCredentialMetadataKeyPattern.test(normalizedKey)
  );
};

const isUnsafeTextValue = (value: string): boolean =>
  unsafeAbsolutePathValuePattern.test(value.trim());

const toSafeCapabilityText = (value: string): string => {
  const trimmedValue = value.trim();

  if (!isUnsafeTextValue(trimmedValue)) {
    return value;
  }

  if (absolutePathStartPattern.test(trimmedValue)) {
    const pathSegments = trimmedValue.replace(/\\/g, "/").split("/").filter(Boolean);
    const lastSegment = pathSegments.at(-1);

    if (lastSegment !== undefined && lastSegment.length > 0) {
      return lastSegment;
    }
  }

  return "Not reported";
};

const toOptionalSafeCapabilityText = (value: string | undefined): string =>
  value === undefined ? "Not reported" : toSafeCapabilityText(value);

const formatPrimitive = (value: string | number | boolean | null): string | null => {
  if (typeof value === "string") {
    return isUnsafeTextValue(value) ? null : value;
  }

  return String(value);
};

const collectMetadataEntries = (
  value: unknown,
  prefix = "",
  entries: MetadataEntry[] = [],
): MetadataEntry[] => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    const formattedValue = formatPrimitive(value);

    if (formattedValue !== null && prefix.length > 0) {
      entries.push({ key: prefix, value: formattedValue });
    }

    return entries;
  }

  if (Array.isArray(value)) {
    const safeItems = value
      .map((item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null
          ? formatPrimitive(item)
          : null,
      )
      .filter((item): item is string => item !== null);

    if (safeItems.length > 0 && prefix.length > 0) {
      entries.push({ key: prefix, value: safeItems.join(", ") });
    }

    value.forEach((item, index) => {
      if (typeof item === "object" && item !== null) {
        collectMetadataEntries(item, `${prefix}.${index}`, entries);
      }
    });

    return entries;
  }

  if (typeof value !== "object" || value === null) {
    return entries;
  }

  Object.entries(value)
    .filter(([key]) => !isUnsafeMetadataKey(key))
    .forEach(([key, childValue]) => {
      const childPrefix = prefix.length === 0 ? key : `${prefix}.${key}`;
      collectMetadataEntries(childValue, childPrefix, entries);
    });

  return entries;
};

const metadataEntries = (metadata: Record<string, unknown>): MetadataEntry[] =>
  collectMetadataEntries(metadata).toSorted((left, right) => left.key.localeCompare(right.key));

const safeRiskPaths = (paths: string[]): string[] =>
  paths.filter((path) => !isUnsafeTextValue(path));

const toolLabels = {
  codex: "codex",
  gh: "gh",
  git: "git",
  node: "node",
  npm: "npm",
  pnpm: "pnpm",
  python: "python",
  yarn: "yarn",
} satisfies Record<keyof RunnerCapabilities["tools"], string>;

const toolEntries = (
  tools: RunnerCapabilities["tools"],
): Array<[keyof RunnerCapabilities["tools"], ToolCapability | undefined]> =>
  (Object.keys(toolLabels) as Array<keyof RunnerCapabilities["tools"]>).map((tool) => [
    tool,
    tools[tool],
  ]);

const renderFindingList = ({
  emptyText,
  findings,
  title,
  variant,
}: {
  emptyText: string;
  findings: RiskFinding[];
  title: string;
  variant: BadgeVariant;
}) => (
  <div className="rounded-md border border-border bg-background p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Badge variant={variant}>{findings.length}</Badge>
    </div>
    {findings.length === 0 ? (
      <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
    ) : (
      <ul className="mt-3 flex flex-col gap-3">
        {findings.map((finding) => {
          const paths = safeRiskPaths(finding.paths);

          return (
            <li className="rounded-md border border-border bg-muted p-3" key={finding.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={variant}>{finding.category}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{finding.id}</span>
              </div>
              <p className="mt-2 text-sm leading-6">{finding.message}</p>
              {paths.length > 0 ? (
                <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                  {paths.join(", ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

export function DryRunResultDisplay({ result }: DryRunResultDisplayProps) {
  if (result === null) {
    return (
      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="dry-run-result"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Dry run result</p>
          <h2 id="dry-run-result" className="text-base font-semibold">
            Readiness checks
          </h2>
        </div>
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No dry-run result has been submitted.</p>
          <p className="mt-2">Readiness checks will appear here after the runner reports them.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="dry-run-result"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Dry run result</p>
          <h2 id="dry-run-result" className="text-base font-semibold">
            Readiness checks
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Runner-submitted readiness metadata for this run.
          </p>
        </div>
        <dl className="grid gap-2 text-sm md:text-right">
          <div>
            <dt className="font-medium text-muted-foreground">Overall status</dt>
            <dd className="mt-1">
              <Badge variant={statusVariant(result.status)}>{resultLabels[result.status]}</Badge>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Reported</dt>
            <dd>
              <time dateTime={result.createdAt}>{formatDate(result.createdAt)}</time>
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {renderFindingList({
          emptyText: "No blockers were reported.",
          findings: result.blockers,
          title: "Blockers",
          variant: "destructive",
        })}
        {renderFindingList({
          emptyText: "No warnings were reported.",
          findings: result.warnings,
          title: "Warnings",
          variant: "outline",
        })}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Readiness checks</h3>
        <div className="mt-3 rounded-md border border-border">
          <Table aria-label="Dry-run readiness checks">
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.checks.map((check) => {
                const entries = metadataEntries(check.metadata);

                return (
                  <TableRow key={check.id}>
                    <TableCell className="font-medium whitespace-normal">{check.label}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(check.status)}>
                        {checkStatusLabels[check.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">{check.message}</TableCell>
                    <TableCell className="max-w-sm whitespace-normal">
                      {entries.length === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <dl className="grid gap-1">
                          {entries.map((entry) => (
                            <div className="min-w-0" key={entry.key}>
                              <dt className="font-mono text-xs font-medium">{entry.key}</dt>
                              <dd className="break-words font-mono text-xs text-muted-foreground">
                                {entry.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Runner capabilities</h3>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="font-medium text-muted-foreground">OS</dt>
            <dd className="mt-1 font-mono text-xs">
              {result.capabilities.os.platform} {result.capabilities.os.release}{" "}
              {result.capabilities.os.arch}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Shell</dt>
            <dd className="mt-1 font-mono text-xs">
              {toSafeCapabilityText(result.capabilities.shell)}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Max concurrent jobs</dt>
            <dd className="mt-1 font-mono text-xs">{result.capabilities.maxConcurrentJobs}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Dry-run support</dt>
            <dd className="mt-1">{result.capabilities.supportsDryRun ? "Supported" : "No"}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Cancellation support</dt>
            <dd className="mt-1">
              {result.capabilities.supportsCancellation ? "Supported" : "No"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Reported</dt>
            <dd className="mt-1">
              <time dateTime={result.capabilities.reportedAt}>
                {formatDate(result.capabilities.reportedAt)}
              </time>
            </dd>
          </div>
        </dl>

        <div className="mt-3 rounded-md border border-border">
          <Table aria-label="Runner tool capabilities">
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolEntries(result.capabilities.tools).map(([tool, capability]) => (
                <TableRow key={tool}>
                  <TableCell className="font-mono text-xs">{toolLabels[tool]}</TableCell>
                  <TableCell>
                    <Badge variant={capability?.available ? "secondary" : "outline"}>
                      {capability?.available ? "Available" : "Unavailable"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {toOptionalSafeCapabilityText(capability?.version)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
