import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { accounts, db, pool, queries, usageCounters, workspaces } from "@/db/client";
import { visibleUntil } from "@/lib/entitlements/plans";
import { runBackfill } from "./backfill";
import { runRelease } from "./release";

afterAll(() => pool.end());

async function fixture(planTier: "trial" | "starter" | "agency", text: string) {
  const [a] = await db.insert(accounts).values({ name: "rel", planTier }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "rel",
      slug: `rel-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const [q] = await db
    .insert(queries)
    .values({ workspaceId: w!.id, name: text, booleanText: text, status: "live" })
    .returning();
  await runBackfill(q!.id);
  return { a: a!, q: (await db.select().from(queries).where(eq(queries.id, q!.id)))[0]! };
}
const count = async (id: string) =>
  (
    (await db.execute(sql`SELECT count(*)::int AS n FROM query_matches WHERE query_id = ${id}`))
      .rows[0] as { n: number }
  ).n;

describe("plan refresh tiers", () => {
  it("snaps visibility to 5 minutes / 1 hour / 12 hours", () => {
    const t = new Date("2026-10-03T14:47:31Z");
    expect(visibleUntil("agency", t).toISOString()).toBe("2026-10-03T14:45:00.000Z");
    expect(visibleUntil("growth", t).toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect(visibleUntil("starter", t).toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });
});

describe("release job", () => {
  it("reveals mentions published after the backfill as the sim clock advances", async () => {
    const { q } = await fixture("agency", "voltara");
    expect(q.releasedThrough).not.toBeNull();
    const base = await count(q.id);
    // Advance the sim clock 20 days: the corpus holds 'future' mentions that now become visible.
    const later = new Date(q.releasedThrough!.getTime() + 20 * 86_400_000);
    const r = await runRelease(q.id, later);
    expect(r!.matched).toBeGreaterThan(0);
    expect(await count(q.id)).toBe(base + r!.matched);
    const [after] = await db.select().from(queries).where(eq(queries.id, q.id));
    expect(after!.releasedThrough!.getTime()).toBeGreaterThanOrEqual(later.getTime() - 5 * 60_000);
    expect(after!.backfillMatched).toBe(base + r!.matched);
    // Nothing new until the clock moves again; running twice never duplicates.
    expect((await runRelease(q.id, later))!.matched).toBe(0);
    // Daily rollups stay consistent with the matches.
    const d = (
      await db.execute(
        sql`SELECT sum(mentions)::int AS n FROM query_daily_stats WHERE query_id = ${q.id}`,
      )
    ).rows[0] as { n: number };
    expect(d.n).toBe(await count(q.id));
  });

  it("only releases what the plan's refresh tier allows", async () => {
    const { q } = await fixture("starter", "voltara");
    const now = new Date(q.releasedThrough!.getTime() + 30 * 3_600_000);
    await runRelease(q.id, now);
    const [row] = await db.select().from(queries).where(eq(queries.id, q.id));
    expect(row!.releasedThrough!.getTime() % (12 * 3_600_000)).toBe(0); // 12-hour steps
    const newest = (
      await db.execute(
        sql`SELECT max(published_at) AS t FROM query_matches WHERE query_id = ${q.id}`,
      )
    ).rows[0] as { t: string };
    expect(new Date(newest.t).getTime()).toBeLessThanOrEqual(row!.releasedThrough!.getTime());
  });

  it("stops collecting at the monthly limit but still advances the clock", async () => {
    const { a, q } = await fixture("agency", "voltara");
    await db.update(usageCounters).set({ value: 199_995 }).where(eq(usageCounters.accountId, a.id)); // 5 left of 200,000
    const r = await runRelease(q.id, new Date(q.releasedThrough!.getTime() + 20 * 86_400_000));
    expect(r!.matched).toBeLessThanOrEqual(5);
    expect(r!.exhausted).toBe(true);
    const [row] = await db.select().from(queries).where(eq(queries.id, q.id));
    expect(row!.backfillStatus).toBe("quota_exhausted");
    expect(row!.releasedThrough!.getTime()).toBeGreaterThan(q.releasedThrough!.getTime());
  });

  it("ignores paused or not-yet-backfilled queries", async () => {
    const [a] = await db.insert(accounts).values({ name: "rel2", planTier: "agency" }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "rel2",
        slug: `rel-${Math.random().toString(36).slice(2, 9)}`,
      })
      .returning();
    const [q] = await db
      .insert(queries)
      .values({ workspaceId: w!.id, name: "x", booleanText: "voltara", status: "live" })
      .returning();
    expect(await runRelease(q!.id)).toBeNull(); // no backfill yet
  });
});
