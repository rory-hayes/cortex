import { eq, schema, sql, type Database } from "@control-plane/db";

export const BILLING_USAGE_ENFORCEMENT_ENABLED = false as const;

export type WorkspaceUsage = {
  enforcementEnabled: typeof BILLING_USAGE_ENFORCEMENT_ENABLED;
  monthlyRunLimit: number;
  plan: string;
  repoLimit: number;
  runnerLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  usageCount: number;
  workspaceId: string;
};

type BillingUsageDatabase = Pick<Database, "select" | "update">;

type WorkspaceUsageRow = Omit<WorkspaceUsage, "enforcementEnabled" | "workspaceId"> & {
  id?: string;
  workspaceId?: string;
};

const billingUsageReturning = {
  monthlyRunLimit: schema.workspaces.monthlyRunLimit,
  plan: schema.workspaces.plan,
  repoLimit: schema.workspaces.repoLimit,
  runnerLimit: schema.workspaces.runnerLimit,
  stripeCustomerId: schema.workspaces.stripeCustomerId,
  stripeSubscriptionId: schema.workspaces.stripeSubscriptionId,
  usageCount: schema.workspaces.usageCount,
  workspaceId: schema.workspaces.id,
};

const toWorkspaceUsage = (row: WorkspaceUsageRow): WorkspaceUsage => ({
  enforcementEnabled: BILLING_USAGE_ENFORCEMENT_ENABLED,
  monthlyRunLimit: row.monthlyRunLimit,
  plan: row.plan,
  repoLimit: row.repoLimit,
  runnerLimit: row.runnerLimit,
  stripeCustomerId: row.stripeCustomerId,
  stripeSubscriptionId: row.stripeSubscriptionId,
  usageCount: row.usageCount,
  workspaceId: row.workspaceId ?? row.id ?? "",
});

export const getWorkspaceUsage = async (
  db: BillingUsageDatabase,
  input: { workspaceId: string },
): Promise<WorkspaceUsage | null> => {
  const [workspace] = await db
    .select(billingUsageReturning)
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId))
    .limit(1);

  return workspace === undefined ? null : toWorkspaceUsage(workspace);
};

export const incrementWorkspaceUsageForClaim = async (
  db: Pick<BillingUsageDatabase, "update">,
  input: { updatedAt: Date; workspaceId: string },
): Promise<WorkspaceUsage | null> => {
  const [workspace] = await db
    .update(schema.workspaces)
    .set({
      updatedAt: input.updatedAt,
      usageCount: sql`${schema.workspaces.usageCount} + 1`,
    })
    .where(eq(schema.workspaces.id, input.workspaceId))
    .returning(billingUsageReturning);

  return workspace === undefined ? null : toWorkspaceUsage(workspace);
};
