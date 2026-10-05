import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  accounts,
  auditLog,
  db,
  historyPacks,
  invoices,
  memberships,
  paymentMethods,
  pool,
  queries,
  users,
  workspaces,
} from "@/db/client";
import { buyHistoryPack, HISTORY_PACK } from "@/lib/billing/history-pack";
import { setProvider, simulatedProvider } from "@/lib/billing/provider";
import { accountPlan } from "@/lib/queries";
import { getMentionUsage } from "@/lib/usage";
import { brandQuery, busiestBrands } from "@/lib/testing/corpus";
import { runBackfill } from "./backfill";
import { runHistoryBackfill } from "./history-pack";

vi.mock("@/lib/jobs/boss", () => ({
  enqueueHistoryBackfill: vi.fn(async () => {}),
  enqueueBackfill: vi.fn(async () => {}),
}));

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);

async function fixture(o: { tier: string; status: string; card?: boolean; backfill?: boolean }) {
  const [a] = await db
    .insert(accounts)
    .values({ name: "hp", planTier: o.tier, billingStatus: o.status })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({ accountId: a!.id, name: "hp", slug: `hp-${rnd()}` })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ email: `hp-${rnd()}@example.test`, passwordHash: "x", name: "HP" })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role: "owner" });
  if (o.card ?? true)
    await db.insert(paymentMethods).values({
      accountId: a!.id,
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      holderName: "HP",
      behavior: "ok",
      isDefault: true,
    });
  const brand = (await busiestBrands(1))[0]!;
  const [q] = await db
    .insert(queries)
    .values({ workspaceId: w!.id, name: brand, booleanText: brandQuery(brand), status: "live" })
    .returning();
  if (o.backfill ?? true) await runBackfill(q!.id);
  return { a: a!, w: w!, u: u!, q: q! };
}

const olderCount = async (queryId: string, before: Date) =>
  Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM query_matches WHERE query_id = ${queryId} AND published_at < ${before}`,
      )
    ).rows[0]!.n,
  );

describe("history packs", () => {
  beforeAll(() => setProvider(simulatedProvider));

  it("is refused for trials, unfinished queries and accounts without a card", async () => {
    const trial = await fixture({ tier: "trial", status: "trialing" });
    expect(
      await buyHistoryPack({ accountId: trial.a.id, queryId: trial.q.id, userId: trial.u.id }),
    ).toMatchObject({ ok: false, code: "plan", upgradeTo: "starter" });

    const fresh = await fixture({ tier: "starter", status: "active", backfill: false });
    expect(
      await buyHistoryPack({ accountId: fresh.a.id, queryId: fresh.q.id, userId: fresh.u.id }),
    ).toMatchObject({ ok: false, code: "not_ready" });

    const nocard = await fixture({ tier: "starter", status: "active", card: false });
    expect(
      await buyHistoryPack({ accountId: nocard.a.id, queryId: nocard.q.id, userId: nocard.u.id }),
    ).toMatchObject({ ok: false, code: "card" });
    expect(await db.select().from(invoices).where(eq(invoices.accountId, nocard.a.id))).toEqual([]);
  }, 120_000);

  it("does not charge twice, or at all when the card is declined", async () => {
    const f = await fixture({ tier: "starter", status: "active" });
    setProvider({
      name: "simulated",
      charge: async () => ({ ok: false, code: "card_declined", message: "Declined." }),
    });
    expect(
      await buyHistoryPack({ accountId: f.a.id, queryId: f.q.id, userId: f.u.id }),
    ).toMatchObject({
      ok: false,
      code: "declined",
    });
    expect(await db.select().from(historyPacks).where(eq(historyPacks.accountId, f.a.id))).toEqual(
      [],
    );
    setProvider(simulatedProvider);
    const first = await buyHistoryPack({ accountId: f.a.id, queryId: f.q.id, userId: f.u.id });
    expect(first.ok).toBe(true);
    expect(
      await buyHistoryPack({ accountId: f.a.id, queryId: f.q.id, userId: f.u.id }),
    ).toMatchObject({
      ok: false,
      code: "exists",
    });
    expect(await db.select().from(invoices).where(eq(invoices.accountId, f.a.id))).toHaveLength(1);
  }, 120_000);

  it("charges, records, widens the readable window, and collects the older stretch outside the quota", async () => {
    const f = await fixture({ tier: "starter", status: "active" });
    const usageBefore = await getMentionUsage(f.a.id);
    const firstMatched = (await db.select().from(queries).where(eq(queries.id, f.q.id)))[0]!
      .backfillMatched;

    const r = await buyHistoryPack({ accountId: f.a.id, queryId: f.q.id, userId: f.u.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [inv] = await db.select().from(invoices).where(eq(invoices.accountId, f.a.id));
    expect(inv).toMatchObject({
      kind: "addon",
      amountCents: HISTORY_PACK.priceCents,
      status: "paid",
    });
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, f.a.id));
    expect(acct!.historyExtraDays).toBe(365);
    expect((await accountPlan(f.w.id)).plan.historyDays).toBe(30 + 365);
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.accountId, f.a.id), eq(auditLog.action, "plan.addon_purchased")));
    expect(audit).toHaveLength(1);

    const res = await runHistoryBackfill(r.packId);
    expect(res!.matched).toBeGreaterThan(0);
    const [pack] = await db.select().from(historyPacks).where(eq(historyPacks.id, r.packId));
    expect(pack).toMatchObject({ status: "done", matched: res!.matched });
    expect(pack!.toAt!.getTime() - pack!.fromAt!.getTime()).toBe(365 * 86_400_000);
    // Everything older than the plan window is the pack's; nothing newer was touched.
    expect(await olderCount(f.q.id, pack!.toAt!)).toBe(res!.matched);
    const older = (
      await db.execute(
        sql`SELECT min(published_at) AS lo FROM query_matches WHERE query_id = ${f.q.id}`,
      )
    ).rows[0] as { lo: string };
    expect(new Date(older.lo).getTime()).toBeGreaterThanOrEqual(pack!.fromAt!.getTime());
    const all = (
      await db.execute(sql`SELECT count(*)::int AS n FROM query_matches WHERE query_id = ${f.q.id}`)
    ).rows[0] as { n: number };
    expect(all.n).toBe(firstMatched + res!.matched);
    // Daily totals agree with the matches.
    const days = (
      await db.execute(
        sql`SELECT sum(mentions)::int AS n FROM query_daily_stats WHERE query_id = ${f.q.id}`,
      )
    ).rows[0] as { n: number };
    expect(days.n).toBe(all.n);
    // Not counted against the monthly allowance.
    expect((await getMentionUsage(f.a.id)).used).toBe(usageBefore.used);

    // Running again changes nothing, and rebuilding the query keeps the older stretch.
    expect((await runHistoryBackfill(r.packId))!.matched).toBe(res!.matched);
    await runBackfill(f.q.id);
    expect(await olderCount(f.q.id, pack!.toAt!)).toBe(res!.matched);
  }, 180_000);
});
