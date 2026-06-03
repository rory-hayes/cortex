import Link from "next/link";
import { ArrowLeft, Database, GitBranch, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const handoverSections = [
  {
    description:
      "Runner pairing, linking, revocation, authentication failures, workspace changes, task creation, repository mapping changes, cancellations, and approval decisions are recorded as append-only coordination records.",
    items: ["Event type", "Actor", "Runner", "Run", "Task", "Allowlisted summary"],
    title: "Immutable audit rows",
  },
  {
    description:
      "Runner-submitted claim events, cancellation states, repair states, PR states, duplicate assignment blocks, and policy blocks are normalized into the audit view from this stream.",
    items: ["Run state", "Severity", "Idempotency", "Risk category"],
    title: "Runner event stream",
  },
  {
    description:
      "The audit page reads display-ready fields only. Raw metadata objects, task packets, source files, patches, command output, and local paths are outside this operator surface.",
    items: ["Display labels", "Related ids", "Event source", "Timestamp"],
    title: "Display boundary",
  },
] as const;

const boundaries = [
  "The hosted app coordinates work and stores metadata.",
  "The local runner executes repository work in the customer-controlled environment.",
  "Human approval remains explicit unless the local backlog runner is invoked with its verified merge mode.",
  "Operational views use display-ready summaries instead of raw payload dumps.",
] as const;

const knownGaps = [
  "Exact Cortex parity remains product-level until the external handover artifact is available locally.",
  "Enterprise audit export is deferred.",
  "Advanced analytics are deferred.",
] as const;

export default function BackendHandoverPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Internal handover</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Audit and backend map</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Product-level map for operators connecting the audit surface to implemented backend
            responsibilities and the runner/web trust boundary.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/audit-log">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Audit log
          </Link>
        </Button>
      </header>

      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="sources">
        <div className="flex max-w-3xl gap-3">
          <Database aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 id="sources" className="text-base font-semibold">
              Audit record sources
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The audit page combines immutable records and consequential runner lifecycle events
              into a single workspace-scoped view.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {handoverSections.map((section) => (
            <article className="rounded-lg border border-border p-4" key={section.title}>
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {section.items.map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        aria-labelledby="trust-boundary"
      >
        <div className="flex max-w-3xl gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 id="trust-boundary" className="text-base font-semibold">
              Trust boundary
            </h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground md:grid-cols-2">
              {boundaries.map((item) => (
                <li className="rounded-lg border border-border p-3" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="gaps">
        <div className="flex max-w-3xl gap-3">
          <GitBranch aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 id="gaps" className="text-base font-semibold">
              Known gaps
            </h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
              {knownGaps.map((item) => (
                <li className="rounded-lg border border-border p-3" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
