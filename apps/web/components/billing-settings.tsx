import { Badge } from "@/components/ui/badge";
import type { BillingPlanUsageMetric, BillingPlanUsageSummary } from "@/src/billing/plan-limits";
import type { WorkspaceUsage } from "@/src/billing/usage";

type BillingSettingsProps = {
  planUsage: BillingPlanUsageSummary;
  usage: WorkspaceUsage;
  workspaceName?: string;
};

const formatCount = (value: number) =>
  new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const statusLabel = (configured: boolean) => (configured ? "Configured" : "Not configured");

const MetricCard = ({ metric }: { metric: BillingPlanUsageMetric }) => (
  <div className="rounded-md border border-border bg-background p-4">
    <dt className="text-sm font-medium text-muted-foreground">{metric.label}</dt>
    <dd className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-xl font-semibold tracking-normal">
          {formatCount(metric.used)} used
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          {formatCount(metric.remaining)} remaining
        </span>
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        {`Limit ${formatCount(metric.limit)} / month`}
      </p>
    </dd>
  </div>
);

export function BillingSettings({ planUsage, usage, workspaceName }: BillingSettingsProps) {
  const workspaceLabel = workspaceName ?? "selected workspace";

  const usageStats = [
    {
      label: "Current plan",
      value: planUsage.plan,
    },
    {
      label: "Billing period",
      value: `${formatDate(planUsage.periodStart)} to ${formatDate(planUsage.periodEnd)}`,
    },
    {
      label: "Reset",
      value: `Resets ${formatDate(planUsage.resetAt)}`,
    },
  ];

  const limitStats = [
    {
      label: "Runner limit",
      value: `${formatCount(planUsage.workspaceLimits.runnerLimit)} runners`,
    },
    {
      label: "Repository limit",
      value: `${formatCount(planUsage.workspaceLimits.repoLimit)} repositories`,
    },
  ];

  const stripeStats = [
    {
      label: "Customer status",
      value: statusLabel(planUsage.stripeCustomerConfigured),
    },
    {
      label: "Subscription status",
      value: statusLabel(planUsage.stripeSubscriptionConfigured),
    },
  ];

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="billing-settings"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Billing hooks</p>
          <h2 id="billing-settings" className="mt-1 text-base font-semibold">
            Billing settings
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Plan and usage metadata for {workspaceLabel}. Billing is visible for MVP planning only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={usage.enforcementEnabled ? "secondary" : "outline"}>
            {usage.enforcementEnabled ? "Usage enforcement enabled" : "Usage enforcement disabled"}
          </Badge>
          <Badge variant="outline">Stripe disabled</Badge>
          <Badge variant="outline">No Stripe required</Badge>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 md:grid-cols-3">
        {usageStats.map((item) => (
          <div className="rounded-md border border-border bg-background p-4" key={item.label}>
            <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
            <dd className="mt-2 break-words text-lg font-semibold tracking-normal">{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Plan usage</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Monthly metadata-only usage for scans, AI task generation, and setup PR creation.
          </p>
        </div>
        <dl className="mt-3 grid gap-3 md:grid-cols-3">
          {planUsage.metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </dl>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <dl className="rounded-md border border-border bg-background p-4">
          <dt className="text-sm font-medium text-muted-foreground">Workspace limits</dt>
          <dd className="mt-3 grid gap-3">
            {limitStats.map((item) => (
              <div className="flex items-center justify-between gap-4 text-sm" key={item.label}>
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium">{item.value}</span>
              </div>
            ))}
          </dd>
        </dl>

        <dl className="rounded-md border border-border bg-background p-4">
          <dt className="text-sm font-medium text-muted-foreground">
            {planUsage.runnerExecutions.label}
          </dt>
          <dd className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Monthly usage</span>
              <span className="font-medium">
                {formatCount(planUsage.runnerExecutions.used)} used
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Remaining runs</span>
              <span className="font-medium">
                {formatCount(planUsage.runnerExecutions.remaining)} remaining
              </span>
            </div>
          </dd>
        </dl>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-1">
        <dl className="rounded-md border border-border bg-background p-4">
          <dt className="text-sm font-medium text-muted-foreground">Stripe metadata</dt>
          <dd className="mt-3 grid gap-3">
            {stripeStats.map((item) => (
              <div className="flex items-center justify-between gap-4 text-sm" key={item.label}>
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium">{item.value}</span>
              </div>
            ))}
          </dd>
        </dl>
      </div>
    </section>
  );
}
