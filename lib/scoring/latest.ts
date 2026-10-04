// What the app shows from the nightly scores: the newest row, and whether to nudge toward sales.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { accountScores, accounts, db, salesRequests } from "@/db/client";
import { PQA_THRESHOLD, type HealthBand } from "./score";

export interface Latest {
  day: string;
  pqa: number;
  health: number;
  band: HealthBand;
  pqaReasons: string[];
  healthReasons: string[];
}

export async function latestScore(accountId: string): Promise<Latest | null> {
  const [r] = await db
    .select()
    .from(accountScores)
    .where(eq(accountScores.accountId, accountId))
    .orderBy(desc(accountScores.day))
    .limit(1);
  if (!r) return null;
  const sig = r.signals as { pqaReasons?: string[]; healthReasons?: string[] };
  return {
    day: r.day,
    pqa: r.pqa,
    health: r.health,
    band: r.healthBand as HealthBand,
    pqaReasons: sig.pqaReasons ?? [],
    healthReasons: sig.healthReasons ?? [],
  };
}

/** Show the "talk to sales" card? Only to people who manage the account, only when it's relevant right now. */
export async function showSalesCard(accountId: string, now: Date): Promise<boolean> {
  const last = await latestScore(accountId);
  if (!last || last.pqa < PQA_THRESHOLD) return false;
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a || a.planTier === "enterprise" || a.motion === "sales_assisted") return false;
  if (!["trialing", "active", "past_due", "grace"].includes(a.billingStatus)) return false;
  const life = a.lifecycle as { pqaCardDismissedAt?: string; pqaAlertedAt?: string };
  if (
    life.pqaCardDismissedAt &&
    (!life.pqaAlertedAt || life.pqaAlertedAt <= life.pqaCardDismissedAt)
  )
    return false;
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(salesRequests)
    .where(
      and(
        eq(salesRequests.accountId, accountId),
        gt(salesRequests.createdAt, new Date(now.getTime() - 60 * 86_400_000)),
      ),
    );
  return (open?.n ?? 0) === 0;
}
