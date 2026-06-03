"use client";

import { Button } from "@/components/ui/button";

export default function PullRequestsError({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Unable to load this view.</h2>
      <p className="mt-2 text-sm text-muted-foreground">Retry the pull request list.</p>
      <Button className="mt-4" onClick={reset} type="button" variant="outline">
        Try again
      </Button>
    </div>
  );
}
