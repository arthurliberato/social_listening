// History packs: a one-time add-on that collects another year of history for one query, beyond the plan's window.
// Priced and charged like any other payment, and kept out of the monthly mentions allowance, because it is a
// purchase of past data rather than ongoing collection.
import { and, eq } from "drizzle-orm";
import { accounts, db, historyPacks, queries, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { enqueueHistoryBackfill } from "@/lib/jobs/boss";
import { simNow } from "@/lib/simclock";
import { defaultMethod, eventCtx, recordInvoice, sendReceipt } from "./service";
import { getProvider } from "./provider";
import type { PlanTier } from "@/lib/entitlements/plans";

export const HISTORY_PACK = { priceCents: 4900, extraDays: 365, maxMentions: 50_000 } as const;
/** Plans that can buy add-ons. Trials, lapsed and cancelled accounts cannot. */
export const PACK_TIERS: PlanTier[] = ["starter", "growth", "agency", "enterprise"];
export const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export type BuyResult =
  | { ok: true; packId: string; invoiceNumber: string }
  | {
      ok: false;
      code: "plan" | "not_found" | "not_ready" | "exists" | "card" | "declined";
      error: string;
      upgradeTo?: PlanTier;
    };

export async function buyHistoryPack(
  o: { accountId: string; queryId: string; userId: string },
  now: Date = simNow(),
): Promise<BuyResult> {
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, o.accountId));
  if (!acct) return { ok: false, code: "not_found", error: "We couldn't find that account." };
  if (acct.billingStatus !== "active" || !PACK_TIERS.includes(acct.planTier as PlanTier))
    return {
      ok: false,
      code: "plan",
      error: "History packs are available on paid plans. Start a plan to add more history.",
      upgradeTo: "starter",
    };
  const [row] = await db
    .select({ q: queries, accountId: workspaces.accountId })
    .from(queries)
    .innerJoin(workspaces, eq(workspaces.id, queries.workspaceId))
    .where(and(eq(queries.id, o.queryId), eq(workspaces.accountId, o.accountId)));
  if (!row) return { ok: false, code: "not_found", error: "That query no longer exists." };
  const q = row.q;
  if (q.status !== "live" || !["done", "quota_exhausted"].includes(q.backfillStatus))
    return {
      ok: false,
      code: "not_ready",
      error: "Wait until this query has finished collecting its first history, then add more.",
    };
  const [have] = await db.select().from(historyPacks).where(eq(historyPacks.queryId, q.id));
  if (have) return { ok: false, code: "exists", error: "This query already has a history pack." };
  const method = await defaultMethod(o.accountId);
  if (!method)
    return { ok: false, code: "card", error: "Add a card in Billing first, then come back." };

  const res = await getProvider().charge({
    accountId: o.accountId,
    amountCents: HISTORY_PACK.priceCents,
    description: `History pack: ${q.name}`,
    method: { id: method.id, behavior: method.behavior as "ok" | "fail_renewal" },
    kind: "upgrade",
  });
  if (!res.ok) return { ok: false, code: "declined", error: res.message };

  const [pack] = await db
    .insert(historyPacks)
    .values({
      accountId: o.accountId,
      queryId: q.id,
      purchasedBy: o.userId,
      priceCents: HISTORY_PACK.priceCents,
      extraDays: HISTORY_PACK.extraDays,
    })
    .onConflictDoNothing()
    .returning({ id: historyPacks.id });
  if (!pack) return { ok: false, code: "exists", error: "This query already has a history pack." };
  await db
    .update(accounts)
    .set({ historyExtraDays: HISTORY_PACK.extraDays })
    .where(eq(accounts.id, o.accountId));
  const inv = await recordInvoice({
    accountId: o.accountId,
    kind: "addon",
    description: `History pack: ${q.name} (+${HISTORY_PACK.extraDays} days)`,
    amountCents: HISTORY_PACK.priceCents,
    status: "paid",
    paymentMethodId: method.id,
    now,
  });
  await sendReceipt(inv, acct, acct.planTier as PlanTier, null);
  await audit({
    accountId: o.accountId,
    workspaceId: q.workspaceId,
    actorUserId: o.userId,
    action: "plan.addon_purchased",
    targetType: "query",
    targetId: q.id,
    meta: { addon: "history pack", name: q.name.slice(0, 120) },
  });
  await trackServer("Add-on Purchased", await eventCtx(o.accountId), {
    addon: "history_pack",
    price_cents: HISTORY_PACK.priceCents,
  });
  await enqueueHistoryBackfill(pack.id);
  return { ok: true, packId: pack.id, invoiceNumber: inv.number };
}
