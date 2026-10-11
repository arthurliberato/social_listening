import { and, count, eq } from "drizzle-orm";
import { accounts, db, queries, workspaces } from "@/db/client";
import { limits, type PlanTier } from "@/lib/entitlements/plans";

export const EDIT_ROLES = ["owner", "admin", "editor"] as const;
export const canEdit = (role: string) => (EDIT_ROLES as readonly string[]).includes(role);

export { COUNTRIES, LANGUAGES, SOURCE_TYPES } from "@/lib/query/constants";

export async function accountPlan(workspaceId: string) {
  const [row] = await db
    .select({
      accountId: accounts.id,
      tier: accounts.planTier,
      extraDays: accounts.historyExtraDays,
    })
    .from(workspaces)
    .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
    .where(eq(workspaces.id, workspaceId));
  return {
    accountId: row!.accountId,
    tier: row!.tier as PlanTier,
    // A history pack extends how far back the account can read, on top of the plan's window.
    plan: {
      ...limits(row!.tier as PlanTier),
      historyDays: limits(row!.tier as PlanTier).historyDays + row!.extraDays,
    },
  };
}

/** Queries that count against the plan's active-query limit (live ones, across the account). */
export async function activeQueryCount(accountId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(queries)
    .innerJoin(workspaces, eq(workspaces.id, queries.workspaceId))
    .where(and(eq(workspaces.accountId, accountId), eq(queries.status, "live")));
  return r?.n ?? 0;
}
