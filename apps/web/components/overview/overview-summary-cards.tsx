import type { WorkspaceDashboardOverview } from "@/src/dashboard/overview";

type OverviewSummaryCardsProps = {
  summaryCards: WorkspaceDashboardOverview["summaryCards"];
};

const toneClasses = {
  danger: "border-destructive/35 bg-destructive/5",
  neutral: "border-border bg-card",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70",
} satisfies Record<WorkspaceDashboardOverview["summaryCards"][number]["tone"], string>;

export function OverviewSummaryCards({ summaryCards }: OverviewSummaryCardsProps) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Overview status">
      {summaryCards.map((card) => (
        <article className={`rounded-lg border p-4 ${toneClasses[card.tone]}`} key={card.id}>
          <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-normal">{card.value}</p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{card.detail}</p>
        </article>
      ))}
    </section>
  );
}
