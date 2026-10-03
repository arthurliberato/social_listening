import { and, eq, sql } from "drizzle-orm";
import { accounts, db, usageCounters } from "@/db/client";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";

export const periodOf = (d: Date = simNow()) => d.toISOString().slice(0, 7);

export async function getMentionUsage(accountId: string) {
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const plan = limits((acct?.planTier ?? "trial") as PlanTier);
  const [row] = await db
    .select({ value: usageCounters.value })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.accountId, accountId),
        eq(usageCounters.period, periodOf()),
        eq(usageCounters.metric, "mentions"),
      ),
    );
  const used = row?.value ?? 0;
  return {
    used,
    limit: plan.mentionsPerMonth,
    remaining: Math.max(0, plan.mentionsPerMonth - used),
    pct: Math.min(100, Math.round((used / plan.mentionsPerMonth) * 100)),
    plan: acct?.planTier ?? "trial",
  };
}

export async function addMentionUsage(accountId: string, n: number) {
  await db
    .insert(usageCounters)
    .values({ accountId, period: periodOf(), metric: "mentions", value: n })
    .onConflictDoUpdate({
      target: [usageCounters.accountId, usageCounters.period, usageCounters.metric],
      set: { value: sql`${usageCounters.value} + ${n}` },
    });
}
