import type { PrArtifactStatus, RunState } from "@control-plane/shared";

import { Badge } from "@/components/ui/badge";

export const runStateLabels = {
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

export const prStatusLabels = {
  closed: "Closed",
  draft: "Draft",
  merged: "Merged",
  open: "Open",
} satisfies Record<PrArtifactStatus, string>;

const runStateVariant = (state: RunState): "destructive" | "outline" | "secondary" => {
  if (state === "blocked" || state === "cancelled" || state === "failed") {
    return "destructive";
  }

  if (state === "queued" || state === "cancel_requested" || state === "cancelling") {
    return "outline";
  }

  return "secondary";
};

const prStatusVariant = (status: PrArtifactStatus): "destructive" | "outline" | "secondary" => {
  if (status === "closed") {
    return "destructive";
  }

  if (status === "draft") {
    return "outline";
  }

  return "secondary";
};

export function RunStatusBadge({ state }: { state: RunState }) {
  return <Badge variant={runStateVariant(state)}>{runStateLabels[state]}</Badge>;
}

export function PrStatusBadge({ status }: { status: PrArtifactStatus }) {
  return <Badge variant={prStatusVariant(status)}>{prStatusLabels[status]}</Badge>;
}
