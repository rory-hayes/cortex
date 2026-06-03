"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { ArrowLeft, Loader2, PlusCircle, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createManualTaskAction, type CreateManualTaskActionState } from "@/src/server/actions";

export type TaskFormRepoMapping = {
  defaultBranch: string;
  id: string;
  label: string;
};

type TaskFormProps = {
  repoMappings: TaskFormRepoMapping[];
  workspaceId: string;
  workspaceName: string;
};

const initialState: CreateManualTaskActionState = null;
type ManualTaskMode = "dryRun" | "execute";
type DynamicRow = {
  id: string;
  value: string;
};

const createEmptyRow = (prefix: string, index: number): DynamicRow => ({
  id: `${prefix}-${index}`,
  value: "",
});

const getNextRowIndex = (rows: DynamicRow[]) =>
  rows.reduce((nextIndex, row) => {
    const suffix = Number(row.id.slice(row.id.lastIndexOf("-") + 1));

    return Number.isFinite(suffix) ? Math.max(nextIndex, suffix + 1) : nextIndex;
  }, rows.length);

export function TaskForm({ repoMappings, workspaceId, workspaceName }: TaskFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<CreateManualTaskActionState, FormData>(
    createManualTaskAction,
    initialState,
  );
  const [mode, setMode] = useState<ManualTaskMode>("dryRun");
  const [repoMappingId, setRepoMappingId] = useState(repoMappings[0]?.id ?? "");
  const [acceptanceCriteriaRows, setAcceptanceCriteriaRows] = useState<DynamicRow[]>([
    createEmptyRow("acceptance", 0),
  ]);
  const [contextPathRows, setContextPathRows] = useState<DynamicRow[]>([
    createEmptyRow("context", 0),
  ]);

  useEffect(() => {
    if (state?.ok === true) {
      router.push("/dashboard/tasks");
    }
  }, [router, state]);

  const updateAcceptanceCriterion = (id: string, value: string) => {
    setAcceptanceCriteriaRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, value } : row)),
    );
  };

  const updateContextPath = (id: string, value: string) => {
    setContextPathRows((rows) => rows.map((row) => (row.id === id ? { ...row, value } : row)));
  };

  const addAcceptanceCriterion = () => {
    setAcceptanceCriteriaRows((rows) => [
      ...rows,
      createEmptyRow("acceptance", getNextRowIndex(rows)),
    ]);
  };

  const addContextPath = () => {
    setContextPathRows((rows) => [...rows, createEmptyRow("context", getNextRowIndex(rows))]);
  };

  const removeAcceptanceCriterion = (id: string) => {
    setAcceptanceCriteriaRows((rows) =>
      rows.length === 1 ? [createEmptyRow("acceptance", 0)] : rows.filter((row) => row.id !== id),
    );
  };

  const removeContextPath = (id: string) => {
    setContextPathRows((rows) =>
      rows.length === 1 ? [createEmptyRow("context", 0)] : rows.filter((row) => row.id !== id),
    );
  };

  const selectedRepoMapping = repoMappings.find((mapping) => mapping.id === repoMappingId);

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="new-task">
      <div className="flex max-w-3xl gap-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">{workspaceName}</p>
          <h2 id="new-task" className="mt-1 text-base font-semibold">
            Create manual task
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Draft a metadata-only task for an existing local mapping. This does not create a task
            packet, queue a runner job, or start local execution.
          </p>
        </div>
      </div>

      <form action={formAction} className="mt-6 grid gap-5">
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <input name="repoMappingId" type="hidden" value={repoMappingId} />
        <input name="mode" type="hidden" value={mode} />

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="repoMappingId">Repository mapping</FieldLabel>
            <Select value={repoMappingId} onValueChange={setRepoMappingId}>
              <SelectTrigger id="repoMappingId" className="w-full">
                <SelectValue placeholder="Select a mapped repository" />
              </SelectTrigger>
              <SelectContent>
                {repoMappings.map((mapping) => (
                  <SelectItem key={mapping.id} value={mapping.id}>
                    {mapping.label} - {mapping.defaultBranch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRepoMapping && (
              <FieldDescription>
                Default branch: {selectedRepoMapping.defaultBranch}
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="title">Title</FieldLabel>
            <Input
              id="title"
              maxLength={240}
              name="title"
              placeholder="Short task title"
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="objective">Objective</FieldLabel>
            <Textarea
              id="objective"
              maxLength={4000}
              name="objective"
              placeholder="Describe the intended engineering outcome in metadata-only language."
              required
              rows={5}
            />
            <FieldDescription>
              Do not paste source, diffs, patches, logs, snippets, secrets, or .env contents.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <FieldSet>
          <FieldLegend>Acceptance criteria</FieldLegend>
          <FieldDescription>
            Add one metadata-only criterion per row. Do not paste source, diffs, patches, logs,
            snippets, secrets, or .env contents.
          </FieldDescription>
          <FieldGroup className="gap-3">
            {acceptanceCriteriaRows.map((row, index) => (
              <Field key={row.id}>
                <FieldLabel htmlFor={`acceptanceCriteria-${row.id}`}>
                  Acceptance criterion {index + 1}
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id={`acceptanceCriteria-${row.id}`}
                    name="acceptanceCriteria"
                    onChange={(event) => updateAcceptanceCriterion(row.id, event.target.value)}
                    placeholder="Draft task is visible in the tasks list."
                    required={index === 0}
                    value={row.value}
                  />
                  <Button
                    aria-label={`Remove acceptance criterion ${index + 1}`}
                    onClick={() => removeAcceptanceCriterion(row.id)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </Field>
            ))}
          </FieldGroup>
          <Button
            className="w-fit"
            onClick={addAcceptanceCriterion}
            type="button"
            variant="outline"
          >
            <PlusCircle aria-hidden="true" className="size-4" />
            Add criterion
          </Button>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Path references only</FieldLegend>
          <FieldDescription>
            Optional repo-relative path references only. Do not paste source, diffs, patches, logs,
            snippets, secrets, or .env contents.
          </FieldDescription>
          <FieldGroup className="gap-3">
            {contextPathRows.map((row, index) => (
              <Field key={row.id}>
                <FieldLabel htmlFor={`contextFilePaths-${row.id}`}>
                  Context path {index + 1}
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id={`contextFilePaths-${row.id}`}
                    name="contextFilePaths"
                    onChange={(event) => updateContextPath(row.id, event.target.value)}
                    placeholder="apps/web/app/page.tsx"
                    value={row.value}
                  />
                  <Button
                    aria-label={`Remove context path ${index + 1}`}
                    onClick={() => removeContextPath(row.id)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </Field>
            ))}
          </FieldGroup>
          <Button className="w-fit" onClick={addContextPath} type="button" variant="outline">
            <PlusCircle aria-hidden="true" className="size-4" />
            Add path
          </Button>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Mode</FieldLegend>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              aria-pressed={mode === "dryRun"}
              className="rounded-md border border-border bg-background p-4 text-left text-sm transition-colors hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary/5"
              onClick={() => setMode("dryRun")}
              type="button"
            >
              <FieldContent>
                <FieldTitle>Dry run</FieldTitle>
                <FieldDescription>
                  Create a draft intended for readiness checks before execution.
                </FieldDescription>
              </FieldContent>
            </button>
            <button
              aria-pressed={mode === "execute"}
              className="rounded-md border border-border bg-background p-4 text-left text-sm transition-colors hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary/5"
              onClick={() => setMode("execute")}
              type="button"
            >
              <FieldContent>
                <FieldTitle>Execute</FieldTitle>
                <FieldDescription>
                  Create a draft that can later be explicitly approved for execution.
                </FieldDescription>
              </FieldContent>
            </button>
          </div>
        </FieldSet>

        {state?.ok === false && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error.message}
          </p>
        )}

        {state?.ok === true && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            Draft created. Returning to tasks.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isPending} type="submit">
            {isPending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <PlusCircle aria-hidden="true" className="size-4" />
            )}
            {isPending ? "Creating" : "Create draft task"}
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to tasks
            </Link>
          </Button>
        </div>
      </form>
    </section>
  );
}
