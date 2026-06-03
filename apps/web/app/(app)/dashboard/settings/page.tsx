import Link from "next/link";
import { ArrowRight, GitBranch, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Workspace settings</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Settings stay focused on operational metadata while the runner executes locally.
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="billing">
          <div className="flex max-w-3xl gap-3">
            <ReceiptText aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 id="billing" className="text-base font-semibold">
                Billing hooks
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                View MVP plan, usage, and limits. Stripe billing is inactive in MVP, and no billing
                actions are available from this control plane.
              </p>
            </div>
          </div>
          <Button asChild className="mt-5">
            <Link href="/dashboard/settings/billing">
              <ArrowRight aria-hidden="true" className="size-4" />
              View billing hooks
            </Link>
          </Button>
        </section>

        <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="github">
          <div className="flex max-w-3xl gap-3">
            <GitBranch aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 id="github" className="text-base font-semibold">
                GitHub connection
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Review GitHub App metadata-only visibility for installations and synced
                repositories. GitHub shows coordination status; local runners still execute code.
              </p>
            </div>
          </div>
          <Button asChild className="mt-5">
            <Link href="/dashboard/settings/github">
              <ArrowRight aria-hidden="true" className="size-4" />
              View GitHub visibility
            </Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
