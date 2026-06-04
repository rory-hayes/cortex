import Link from "next/link";
import { Cable, FileSearch, PlusCircle, ScanSearch } from "lucide-react";

import { Button } from "@/components/ui/button";

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="max-w-2xl">
        <div className="mb-4 h-1.5 w-12 rounded-full bg-primary" />
        <h2 className="text-xl font-semibold tracking-normal">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/dashboard/repositories">
            <ScanSearch aria-hidden="true" className="size-4" />
            Start repo scan
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/findings">
            <FileSearch aria-hidden="true" className="size-4" />
            Review findings
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/runners">
            <Cable aria-hidden="true" className="size-4" />
            Pair runner
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/tasks/new">
            <PlusCircle aria-hidden="true" className="size-4" />
            Create manual task
          </Link>
        </Button>
      </div>
    </section>
  );
}
