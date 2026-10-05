import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { runBackfill } from "@/jobs/backfill";
import { accounts, db, pool, queries, usageCounters, workspaces } from "@/db/client";
import { previewQuery } from "./preview";

afterAll(() => pool.end());

describe("preview", () => {
  // Acceptance: preview < 1.5s even on the full 4M-row corpus, including very broad queries.
  const QUERIES = [
    "juniper",
    '"Juniper Roast" NOT (job OR hiring)',
    "love OR great OR terrible",
    "price* NEAR/5 (high OR low OR fair)",
    "(coffee OR sneaker OR flight) lang:en",
  ];
  for (const q of QUERIES) {
    it(`returns within 1.5s: ${q}`, async () => {
      const t = performance.now();
      const p = await previewQuery({ booleanText: q, planTier: "growth" });
      const ms = performance.now() - t;
      expect(p.ok).toBe(true);
      expect(ms).toBeLessThan(1500);
    });
  }

  it("returns counts, a sample, a noise score and match statistics", async () => {
    const p = await previewQuery({
      booleanText: '("Juniper Roast" OR #juniperroast) NOT (job OR hiring)',
      planTier: "trial",
    });
    if (!p.ok) throw new Error("expected ok");
    expect(p.count).toBeGreaterThan(0);
    expect(p.sample.length).toBeLessThanOrEqual(20);
    expect(p.sample.length).toBeGreaterThan(0);
    expect(p.noiseScore).toBeGreaterThanOrEqual(0);
    expect(p.noiseScore).toBeLessThanOrEqual(1);
    expect(p.stats.exclusions).toBe(1);
    expect(p.terms.map((t) => t.value)).toContain("Juniper Roast");
    for (const m of p.sample)
      expect(new Date(m.publishedAt).getTime()).toBeLessThan(Date.now() + 1);
  });

  it("explains lint errors instead of running", async () => {
    const p = await previewQuery({ booleanText: "(coffee OR tea", planTier: "trial" });
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.message).toContain("Missing closing parenthesis");
  });

  it("a noisier naive query scores noisier than a refined one", async () => {
    const naive = await previewQuery({ booleanText: "juniper", planTier: "growth" });
    const refined = await previewQuery({
      booleanText:
        "juniper NOT (hiring OR giveaway OR promo OR coupon OR crypto OR berries OR gin OR router)",
      planTier: "growth",
    });
    if (!naive.ok || !refined.ok) throw new Error("expected ok");
    expect(refined.noiseScore).toBeLessThanOrEqual(naive.noiseScore);
  });
});

describe("backfill job", () => {
  async function fixture(planTier: "trial" | "starter", usage = 0) {
    const [a] = await db.insert(accounts).values({ name: "bf test", planTier }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "bf",
        slug: `bf-${Math.random().toString(36).slice(2, 9)}`,
      })
      .returning();
    if (usage)
      await db.insert(usageCounters).values({
        accountId: a!.id,
        period: new Date().toISOString().slice(0, 7),
        metric: "mentions",
        value: usage,
      });
    const mk = async (text: string) =>
      (
        await db
          .insert(queries)
          .values({ workspaceId: w!.id, name: text, booleanText: text, status: "live" })
          .returning()
      )[0]!;
    return { a: a!, w: w!, mk };
  }

  it("materialises matches within the plan window and rolls up daily stats", async () => {
    const { a, mk } = await fixture("trial");
    const q = await mk('"Brewline" NOT (job OR hiring)');
    await runBackfill(q.id);
    const [row] = await db.select().from(queries).where(eq(queries.id, q.id));
    expect(["done", "quota_exhausted"]).toContain(row!.backfillStatus);
    expect(row!.backfillMatched).toBeGreaterThan(0);
    expect(row!.backfillMatched).toBeLessThanOrEqual(5000);
    const m = (
      await db.execute(
        sql`SELECT count(*)::int AS n, min(published_at) AS lo FROM query_matches WHERE query_id = ${q.id}`,
      )
    ).rows[0] as { n: number; lo: string };
    expect(m.n).toBe(row!.backfillMatched);
    expect(Date.now() - new Date(m.lo).getTime()).toBeLessThan(31 * 86_400_000); // trial history = 30 days
    const d = (
      await db.execute(
        sql`SELECT sum(mentions)::int AS n, sum(positive + negative + neutral + mixed)::int AS s FROM query_daily_stats WHERE query_id = ${q.id}`,
      )
    ).rows[0] as { n: number; s: number };
    expect(d.n).toBe(m.n);
    expect(d.s).toBe(m.n);
    const [u] = await db.select().from(usageCounters).where(eq(usageCounters.accountId, a.id));
    expect(u!.value).toBe(m.n);
  });

  it("stops collecting when the monthly allowance runs out, keeping what it has", async () => {
    const { mk } = await fixture("trial", 4_990); // 10 mentions left of 5,000
    const q = await mk("love OR great");
    await runBackfill(q.id);
    const [row] = await db.select().from(queries).where(eq(queries.id, q.id));
    expect(row!.backfillStatus).toBe("quota_exhausted");
    expect(row!.backfillMatched).toBe(10);
  });

  it("re-running replaces matches instead of duplicating them", async () => {
    const { a, mk } = await fixture("trial");
    const q = await mk("brewline");
    await runBackfill(q.id);
    const first = (await db.select().from(queries).where(eq(queries.id, q.id)))[0]!.backfillMatched;
    await db.execute(sql`UPDATE usage_counters SET value = 0 WHERE account_id = ${a.id}`);
    await runBackfill(q.id);
    const n = (
      await db.execute(sql`SELECT count(*)::int AS n FROM query_matches WHERE query_id = ${q.id}`)
    ).rows[0] as { n: number };
    expect(n.n).toBe(first);
  });
});
