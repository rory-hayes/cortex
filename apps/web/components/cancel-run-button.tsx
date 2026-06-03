"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";

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
import { cancelRunAction } from "@/src/server/actions";

type CancelRunButtonProps = {
  runId: string;
  workspaceId: string;
};

export function CancelRunButton({ runId, workspaceId }: CancelRunButtonProps) {
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

    const formData = new FormData(event.currentTarget);
    const reason = String(formData.get("reason") ?? "").trim();

    if (reason.length === 0) {
      setErrorMessage("Enter a cancellation reason.");
      return;
    }

    formData.set("reason", reason);

    startTransition(async () => {
      const result = await cancelRunAction(formData);

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Ban aria-hidden="true" className="size-4" />
          Cancel run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel run</DialogTitle>
          <DialogDescription>
            Request cooperative cancellation. The runner will stop at the next supported boundary.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <input name="runId" type="hidden" value={runId} />

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reason">Reason</FieldLabel>
              <Textarea
                id="reason"
                maxLength={500}
                name="reason"
                placeholder="Brief reason for requesting cancellation."
                required
                rows={4}
              />
              <FieldDescription>
                Required for the audit trail. Maximum 500 characters.
              </FieldDescription>
              {errorMessage !== null && <FieldError>{errorMessage}</FieldError>}
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={isPending} type="button" variant="outline">
                Keep running
              </Button>
            </DialogClose>
            <Button disabled={isPending} type="submit" variant="destructive">
              {isPending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Ban aria-hidden="true" className="size-4" />
              )}
              {isPending ? "Requesting" : "Request cancellation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
