import type { RunEventSeverity, RunState } from "@control-plane/shared";

import type { RunTimelineEvent } from "@/src/runs/detail";
import { Badge } from "@/components/ui/badge";

type RunTimelineProps = {
  events: RunTimelineEvent[];
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const runStateLabels = {
  awaiting_approval: "Awaiting approval",
  blocked: "Blocked",
  cancel_requested: "Cancel requested",
  cancelled: "Cancelled",
  cancelling: "Cancelling",
  changes_scanned: "Changes scanned",
  claimed: "Claimed",
  codex_running: "Codex running",
  completed: "Completed",
  dry_run_passed: "Dry run passed",
  dry_run_running: "Dry run running",
  failed: "Failed",
  preflight: "Preflight",
  pr_opened: "PR opened",
  pushed: "Pushed",
  queued: "Queued",
  repair_requested: "Repair requested",
  validation_running: "Validation running",
  worktree_created: "Worktree created",
} satisfies Record<RunState, string>;

const severityLabels = {
  blocked: "Blocked",
  debug: "Debug",
  error: "Error",
  info: "Info",
  warning: "Warning",
} satisfies Record<RunEventSeverity, string>;

const stateVariant = (state: RunState): "destructive" | "outline" | "secondary" => {
  if (state === "blocked" || state === "cancelled" || state === "failed") {
    return "destructive";
  }

  if (state === "queued" || state === "cancel_requested" || state === "cancelling") {
    return "outline";
  }

  return "secondary";
};

const severityVariant = (severity: RunEventSeverity): "destructive" | "outline" | "secondary" => {
  if (severity === "blocked" || severity === "error") {
    return "destructive";
  }

  if (severity === "debug" || severity === "warning") {
    return "outline";
  }

  return "secondary";
};

const compareTimelineEvents = (left: RunTimelineEvent, right: RunTimelineEvent): number => {
  const createdAtComparison = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const receivedAtComparison = left.receivedAt.getTime() - right.receivedAt.getTime();

  if (receivedAtComparison !== 0) {
    return receivedAtComparison;
  }

  return left.id.localeCompare(right.id);
};

const visibleTimelineEvents = (events: RunTimelineEvent[]): RunTimelineEvent[] => {
  const seenIdempotencyKeys = new Set<string>();

  return events.toSorted(compareTimelineEvents).filter((event) => {
    if (seenIdempotencyKeys.has(event.idempotencyKey)) {
      return false;
    }

    seenIdempotencyKeys.add(event.idempotencyKey);

    return true;
  });
};

const unsafeMetadataKeys = new Set([
  "acceptancecriteria",
  "capabilitiessnapshot",
  "changedpaths",
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

const normalizeMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isUnsafeMetadataKey = (key: string): boolean => {
  const normalizedKey = normalizeMetadataKey(key);

  return (
    unsafeMetadataKeys.has(normalizedKey) ||
    unsafePayloadMetadataKeyPattern.test(normalizedKey) ||
    unsafeLogMetadataKeyPattern.test(normalizedKey) ||
    unsafeCredentialMetadataKeyPattern.test(normalizedKey)
  );
};

const sanitizeMetadataValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return unsafeAbsolutePathValuePattern.test(value.trim()) ? undefined : value;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeMetadataValue(item))
      .filter((item) => item !== undefined);

    return items.length === 0 ? undefined : items;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([key]) => !isUnsafeMetadataKey(key))
    .map(([key, childValue]) => [key, sanitizeMetadataValue(childValue)] as const)
    .filter(([, childValue]) => childValue !== undefined);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const formatMetadataValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  const serialized = JSON.stringify(value);

  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
};

const metadataEntries = (metadata: Record<string, unknown>): Array<[string, string]> =>
  Object.entries(metadata)
    .filter(([key]) => !isUnsafeMetadataKey(key))
    .map(([key, value]) => [key, sanitizeMetadataValue(value)] as const)
    .filter(([, value]) => value !== undefined)
    .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => [key, formatMetadataValue(value)]);

export function RunTimeline({ events }: RunTimelineProps) {
  const visibleEvents = visibleTimelineEvents(events);

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="run-timeline">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Timeline</p>
        <h2 id="run-timeline" className="text-base font-semibold">
          Append-only run events
        </h2>
      </div>

      {visibleEvents.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <p>No timeline events yet.</p>
          <p className="mt-2">Runner events will appear here after they are received.</p>
        </div>
      ) : (
        <ol className="mt-5 flex flex-col gap-4">
          {visibleEvents.map((event) => {
            const eventMetadataEntries = metadataEntries(event.metadata);

            return (
              <li
                className="rounded-md border border-border bg-background p-4"
                key={event.idempotencyKey}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={stateVariant(event.state)}>
                        {runStateLabels[event.state]}
                      </Badge>
                      <Badge variant={severityVariant(event.severity)}>
                        {severityLabels[event.severity]}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-medium leading-6">{event.message}</p>
                  </div>
                  <dl className="grid shrink-0 gap-2 font-mono text-xs text-muted-foreground">
                    <div>
                      <dt className="font-sans font-medium text-foreground">Event time</dt>
                      <dd>
                        <time dateTime={event.createdAt.toISOString()}>
                          {formatDate(event.createdAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-sans font-medium text-foreground">Received</dt>
                      <dd>
                        <time dateTime={event.receivedAt.toISOString()}>
                          {formatDate(event.receivedAt)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                </div>

                {eventMetadataEntries.length > 0 ? (
                  <dl className="mt-4 grid gap-2 rounded-md border border-border bg-muted p-3 text-xs leading-5 text-muted-foreground md:grid-cols-2">
                    {eventMetadataEntries.map(([key, value]) => (
                      <div className="min-w-0" key={key}>
                        <dt className="font-mono font-medium text-foreground">{key}</dt>
                        <dd className="mt-1 break-words font-mono">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
