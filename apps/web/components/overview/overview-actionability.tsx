import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type OverviewActionabilityProps = {
  actionability: WorkspaceDashboardOverview["actionability"];
};

const toneClasses = {
  danger: "border-l-destructive bg-destructive/5 hover:bg-destructive/10",
  neutral: "border-l-border bg-muted/20 hover:bg-muted/40",
  success: "border-l-emerald-500 bg-emerald-50/70 hover:bg-emerald-50",
  warning: "border-l-amber-500 bg-amber-50/70 hover:bg-amber-50",
} satisfies Record<WorkspaceDashboardOverview["actionability"]["items"][number]["tone"], string>;

const toneBadgeVariants = {
  danger: "destructive",
  neutral: "outline",
  success: "secondary",
  warning: "outline",
} satisfies Record<
  WorkspaceDashboardOverview["actionability"]["items"][number]["tone"],
  "destructive" | "outline" | "secondary"
>;

export function OverviewActionability({ actionability }: OverviewActionabilityProps) {
  return (
    <section
      aria-labelledby="overview-actionability"
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Recommended next actions</p>
          <h2 id="overview-actionability" className="mt-1 text-lg font-semibold tracking-normal">
            What can safely move forward today?
          </h2>
        </div>
        <Badge variant={actionability.runnerOnline ? "secondary" : "outline"}>
          {actionability.runnerOnline
            ? "Runner online"
            : actionability.runnerInstalled
              ? "Runner paired"
              : "Runner optional"}
        </Badge>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {actionability.items.map((item) => (
          <article
            className={`flex min-w-0 flex-col gap-4 border-l-4 px-4 py-4 transition-colors md:flex-row md:items-center md:justify-between ${toneClasses[item.tone]}`}
            key={item.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={toneBadgeVariants[item.tone]}>{item.label}</Badge>
                <span className="text-sm font-semibold">{item.count} items</span>
              </div>
              <h3 className="mt-3 text-base font-semibold tracking-normal">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link aria-label={item.title} href={item.href}>
                <ArrowRight aria-hidden="true" />
                <span className="sr-only">Open {item.title}</span>
              </Link>
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}
