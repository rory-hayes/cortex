"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Check, Loader2, XCircle } from "lucide-react";

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
import { APPROVAL_REASON_MAX_LENGTH } from "@/src/approvals/constants";
import { approveRunAction, rejectRunAction } from "@/src/server/actions";

type ApprovalActionsProps = {
  runId: string;
  workspaceId: string;
};

type OpenAction = "approve" | "reject";

export function ApprovalActions({ runId, workspaceId }: ApprovalActionsProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<OpenAction | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (action: OpenAction, nextOpen: boolean) => {
    setOpenAction(nextOpen ? action : null);

    if (!nextOpen) {
      setErrorMessage(null);
    }
  };

  const handleSubmit = (action: OpenAction, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const reason = String(formData.get("reason") ?? "").trim();

    if (reason.length === 0) {
      setErrorMessage("Enter a decision reason.");
      return;
    }

    formData.set("reason", reason);

    startTransition(async () => {
      const result =
        action === "approve" ? await approveRunAction(formData) : await rejectRunAction(formData);

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      setOpenAction(null);
      router.refresh();
    });
  };

  const renderDialog = (action: OpenAction) => {
    const isApprove = action === "approve";
    const Icon = isApprove ? Check : XCircle;
    const title = isApprove ? "Approve run" : "Reject run";
    const triggerLabel = isApprove ? "Approve" : "Reject";
    const submitLabel = isApprove ? "Record approval" : "Record rejection";
    const pendingLabel = isApprove ? "Approving" : "Rejecting";

    return (
      <Dialog open={openAction === action} onOpenChange={(open) => handleOpenChange(action, open)}>
        <DialogTrigger asChild>
          <Button size="sm" variant={isApprove ? "default" : "destructive"}>
            <Icon aria-hidden="true" className="size-4" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Record the human review decision for this run metadata.
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={(event) => handleSubmit(action, event)}>
            <input name="workspaceId" type="hidden" value={workspaceId} />
            <input name="runId" type="hidden" value={runId} />

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="approval-reason">Reason</FieldLabel>
                <Textarea
                  id="approval-reason"
                  maxLength={APPROVAL_REASON_MAX_LENGTH}
                  name="reason"
                  placeholder="Brief decision reason."
                  required
                  rows={4}
                />
                <FieldDescription>
                  Required for the audit trail. Maximum {APPROVAL_REASON_MAX_LENGTH} characters.
                </FieldDescription>
                {errorMessage !== null && <FieldError>{errorMessage}</FieldError>}
              </Field>
            </FieldGroup>

            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={isPending} type="button" variant="outline">
                  Keep pending
                </Button>
              </DialogClose>
              <Button
                disabled={isPending}
                type="submit"
                variant={isApprove ? "default" : "destructive"}
              >
                {isPending ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Icon aria-hidden="true" className="size-4" />
                )}
                {isPending ? pendingLabel : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      {renderDialog("approve")}
      {renderDialog("reject")}
    </div>
  );
}
