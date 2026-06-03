"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Loader2, ShieldAlert, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { REPAIR_FEEDBACK_MAX_LENGTH as REQUEST_REPAIR_FEEDBACK_MAX_LENGTH } from "@/src/repairs/constants";
import { requestRepairAction } from "@/src/server/actions";

type RequestRepairDialogProps = {
  attemptCount: number;
  disabled: boolean;
  disabledReason: string;
  maxAttempts: number;
  nextAttempt: number;
  previousRunId: string;
  remainingAttempts: number;
  workspaceId: string;
};

export function RequestRepairDialog({
  attemptCount,
  disabled,
  disabledReason,
  maxAttempts,
  nextAttempt,
  previousRunId,
  remainingAttempts,
  workspaceId,
}: RequestRepairDialogProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setErrorMessage(null);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (disabled) {
      setErrorMessage(disabledReason);
      return;
    }

    const formData = new FormData(event.currentTarget);
    const feedback = String(formData.get("feedback") ?? "").trim();

    if (feedback.length === 0) {
      setErrorMessage("Enter concise repair feedback.");
      return;
    }

    formData.set("feedback", feedback);

    startTransition(async () => {
      const result = await requestRepairAction(formData);

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1 md:items-end">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button disabled={disabled} size="sm" variant="outline">
            <Wrench aria-hidden="true" className="size-4" />
            Request repair
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request repair</DialogTitle>
            <DialogDescription>
              Queue repair attempt {nextAttempt} of {maxAttempts}.
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={handleSubmit}>
            <input name="workspaceId" type="hidden" value={workspaceId} />
            <input name="previousRunId" type="hidden" value={previousRunId} />

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="feedback">Repair feedback</FieldLabel>
                <Textarea
                  id="feedback"
                  maxLength={REQUEST_REPAIR_FEEDBACK_MAX_LENGTH}
                  name="feedback"
                  placeholder="Briefly describe what should be repaired."
                  required
                  rows={5}
                />
                <FieldDescription>
                  Keep feedback concise. {remainingAttempts} repair attempt
                  {remainingAttempts === 1 ? "" : "s"} remaining.
                </FieldDescription>
                <FieldDescription className="flex gap-2 text-warning-foreground">
                  <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>Do not paste secrets, source code, diffs, patches, or command output.</span>
                </FieldDescription>
                {errorMessage !== null && <FieldError>{errorMessage}</FieldError>}
              </Field>
            </FieldGroup>

            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={isPending} type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={isPending || disabled} type="submit">
                {isPending ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Wrench aria-hidden="true" className="size-4" />
                )}
                {isPending ? "Requesting" : "Queue repair"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        Repair attempts: {attemptCount} / {maxAttempts}
        {remainingAttempts > 0 ? `, ${remainingAttempts} remaining` : ", limit reached"}
      </p>
      {disabled && disabledReason.length > 0 && (
        <p className="max-w-64 text-right text-xs text-muted-foreground">{disabledReason}</p>
      )}
    </div>
  );
}
