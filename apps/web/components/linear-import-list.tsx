import Link from "next/link";
import { FileDown, GitBranch, PlusCircle } from "lucide-react";

import type { LinearIssueCandidateData } from "@/src/linear/sync-issues";
import { importLinearIssueCandidateAction } from "@/src/server/actions";
import { hasUnsafeDisplayText, safeDisplayText } from "@/components/display-safety";
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

async function submitImportLinearIssueCandidateAction(formData: FormData): Promise<void> {
  "use server";

  await importLinearIssueCandidateAction(formData);
}

export type LinearImportRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
};

type LinearImportListProps = {
  candidates: LinearIssueCandidateData[];
  repositories: LinearImportRepository[];
  workspaceId: string;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const safeCandidateTitle = (candidate: LinearIssueCandidateData): string =>
  hasUnsafeDisplayText(candidate.title)
    ? safeDisplayText(candidate.identifier)
    : safeDisplayText(`${candidate.identifier} ${candidate.title}`);

const safeSummary = (value: string): string | null => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || normalizedValue === "[redacted]") {
    return null;
  }

  return safeDisplayText(normalizedValue, "Unavailable");
};

export function LinearImportList({ candidates, repositories, workspaceId }: LinearImportListProps) {
  const readyCount = candidates.length;
  const repositoryCount = repositories.length;
  const canImport = repositoryCount > 0;

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="linear-import-list"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Import from Linear</p>
          <h2 id="linear-import-list" className="mt-1 text-base font-semibold">
            Ready Linear issue candidates
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Create draft Cortex Tasks from selected Linear candidates after choosing the target
            GitHub repository. Drafts require separate human approval before local execution.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{pluralize(readyCount, "ready candidate")}</Badge>
            <Badge variant={canImport ? "outline" : "destructive"}>
              {canImport
                ? pluralize(repositoryCount, "repository", "repositories")
                : "Repository required"}
            </Badge>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks">
            <GitBranch aria-hidden="true" className="size-4" />
            Back to tasks
          </Link>
        </Button>
      </div>

      {candidates.length === 0 ? (
        <div className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
          <FileDown aria-hidden="true" className="mb-3 size-5" />
          <p>No ready Linear candidates.</p>
          <p className="mt-2">Synced issues marked Ready for AI will appear here for import.</p>
        </div>
      ) : (
        <div className="mt-5">
          <Table aria-label="Linear issue candidates">
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Target repository</TableHead>
                <TableHead>Synced</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((candidate) => {
                const bodySummary = safeSummary(candidate.bodySummary);
                const commentsSummary = safeSummary(candidate.commentsSummary);

                return (
                  <TableRow key={candidate.id}>
                    <TableCell>
                      <div className="flex max-w-sm flex-col gap-2 whitespace-normal">
                        <span className="font-medium">{safeCandidateTitle(candidate)}</span>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{safeDisplayText(candidate.status)}</Badge>
                          {candidate.redactionApplied ? (
                            <Badge variant="outline">Redacted summaries</Badge>
                          ) : null}
                          {candidate.labels.map((label) => (
                            <Badge key={label} variant="outline">
                              {safeDisplayText(label)}
                            </Badge>
                          ))}
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {safeDisplayText(candidate.id)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {candidate.projectName === null
                        ? "No project"
                        : safeDisplayText(candidate.projectName)}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-md flex-col gap-2 whitespace-normal text-sm text-muted-foreground">
                        {bodySummary === null ? null : <span>{bodySummary}</span>}
                        {commentsSummary === null ? null : <span>{commentsSummary}</span>}
                        {bodySummary === null && commentsSummary === null ? (
                          <span>Summary unavailable</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <form action={submitImportLinearIssueCandidateAction} className="min-w-56">
                        <input name="workspaceId" type="hidden" value={workspaceId} />
                        <input name="linearIssueCandidateId" type="hidden" value={candidate.id} />
                        {canImport ? (
                          <select
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            name="repoId"
                          >
                            {repositories.map((repository) => (
                              <option key={repository.id} value={repository.id}>
                                {safeDisplayText(repository.repositoryFullName)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge variant="destructive">Repository required</Badge>
                        )}
                        <Button className="mt-3" disabled={!canImport} size="sm" type="submit">
                          <PlusCircle aria-hidden="true" className="size-4" />
                          Create draft
                        </Button>
                      </form>
                    </TableCell>
                    <TableCell>{formatDate(candidate.lastSyncedAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">Draft only</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
