"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, Clipboard, Clock3, Loader2, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/src/server/errors";
import { createRunnerPairingCodeAction } from "@/src/server/actions";

type RunnerPairingActionData = {
  code: string;
  expiresAt: Date;
  pairingId: string;
  ttlSeconds: number;
  workspaceId: string;
};

type RunnerPairingActionState = ActionResult<RunnerPairingActionData> | null;

type RunnerPairingProps = {
  apiBaseUrl: string;
  workspaceId: string;
  workspaceName: string;
};

const initialState: RunnerPairingActionState = null;

const formatExpiry = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

export function RunnerPairing({ apiBaseUrl, workspaceId, workspaceName }: RunnerPairingProps) {
  const [state, formAction, isPending] = useActionState<RunnerPairingActionState, FormData>(
    createRunnerPairingCodeAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const pairing = state?.ok === true ? state.data : null;
  const command = useMemo(
    () =>
      pairing === null
        ? `control-plane-runner link --code <pairing-code> --base-url ${apiBaseUrl}`
        : `control-plane-runner link --code ${pairing.code} --base-url ${apiBaseUrl}`,
    [apiBaseUrl, pairing],
  );

  const copyCommand = () => {
    if (pairing === null) {
      return;
    }

    void navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="pair-runner">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">{workspaceName}</p>
        <h2 id="pair-runner" className="text-base font-semibold">
          Pair a local runner
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Generate a short-lived code, then run the command on the machine that will execute work.
          The web app coordinates metadata; execution stays on the runner.
        </p>
      </div>

      <form action={formAction} className="mt-5">
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <Button disabled={isPending} type="submit">
          {isPending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Terminal aria-hidden="true" className="size-4" />
          )}
          {isPending ? "Generating" : "Generate pairing code"}
        </Button>
      </form>

      {state?.ok === false && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error.message}
        </p>
      )}

      {pairing !== null && (
        <div className="mt-5 grid gap-4 rounded-md border border-border bg-background p-4">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Pairing code</p>
            <p className="mt-2 break-all font-mono text-lg font-semibold">{pairing.code}</p>
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <Clock3 aria-hidden="true" className="size-4" />
              <span>Expires {formatExpiry(pairing.expiresAt)}</span>
            </div>
            <div>TTL {pairing.ttlSeconds} seconds</div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">CLI command</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                {command}
              </code>
              <Button onClick={copyCommand} type="button" variant="outline">
                {copied ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Clipboard aria-hidden="true" className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
