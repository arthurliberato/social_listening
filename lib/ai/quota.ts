// The monthly AI allowance: one counter per account per month, shared by every AI feature.
// Taking a unit is a single conditional UPDATE, so two simultaneous questions can't both squeeze
// through at the limit. A unit is handed back if the answer couldn't be produced.
import { and, eq, sql } from "drizzle-orm";
import { db, usageCounters } from "@/db/client";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { periodOf } from "@/lib/usage";

const where = (accountId: string) =>
  and(
    eq(usageCounters.accountId, accountId),
    eq(usageCounters.period, periodOf()),
    eq(usageCounters.metric, "ai_questions"),
  );

export async function aiQuota(accountId: string, tier: PlanTier) {
  const limit = limits(tier).askAiPerMonth;
  const [row] = await db
    .select({ v: usageCounters.value })
    .from(usageCounters)
    .where(where(accountId));
  const used = row?.v ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** Take one unit. Returns the units left afterwards, or null when the allowance is spent. */
export async function takeAiUnit(accountId: string, tier: PlanTier): Promise<number | null> {
  const limit = limits(tier).askAiPerMonth;
  await db
    .insert(usageCounters)
    .values({ accountId, period: periodOf(), metric: "ai_questions", value: 0 })
    .onConflictDoNothing();
  const res = await db
    .update(usageCounters)
    .set({ value: sql`${usageCounters.value} + 1` })
    .where(and(where(accountId), sql`${usageCounters.value} < ${limit}`))
    .returning({ v: usageCounters.value });
  return res[0] ? limit - res[0].v : null;
}

export async function refundAiUnit(accountId: string) {
  await db
    .update(usageCounters)
    .set({ value: sql`greatest(${usageCounters.value} - 1, 0)` })
    .where(where(accountId));
}
