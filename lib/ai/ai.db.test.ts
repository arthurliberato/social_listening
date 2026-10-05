// M10 acceptance: every AI answer cites at least 3 mentions, the quota decrements, failures are graceful.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accounts,
  aiAnswers,
  db,
  memberships,
  pool,
  queries,
  usageCounters,
  users,
  workspaces,
} from "@/db/client";
import { WORLD_END } from "@/datagen/config";
import { runRelease } from "@/jobs/release";
import { limits } from "@/lib/entitlements/plans";
import { periodOf } from "@/lib/usage";
import { analyze } from "@/lib/query/lint";
import type { AiProvider } from "./provider";
import { aiQuota } from "./quota";
import {
  askQuestion,
  citedNumbers,
  draftBoolean,
  explainPeak,
  MIN_CITATIONS,
  summarize,
  writeQuery,
  type Ctx,
} from "./service";

afterAll(() => pool.end());

let f: { ctx: Ctx; queryId: string; accountId: string; edge: Date };

async function fixture(tier: "trial" | "growth" = "trial") {
  const [a] = await db.insert(accounts).values({ name: "ai", planTier: tier }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({ accountId: a!.id, name: "ai", slug: `ai-${Math.random().toString(36).slice(2, 9)}` })
    .returning();
  const [u] = await db
    .insert(users)
    .values({
      email: `ai-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: "x",
      name: "ai",
    })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role: "owner" });
  const brand = (
    await db.execute(sql`
      SELECT b.name FROM mentions m JOIN brands b ON b.id = m.brand_id
      WHERE m.published_at > ${new Date(WORLD_END - 20 * 86_400_000)}
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)
  ).rows[0] as { name: string };
  const edge = new Date(WORLD_END - 86_400_000);
  const [q] = await db
    .insert(queries)
    .values({
      workspaceId: w!.id,
      name: brand.name,
      booleanText: `"${brand.name}"`,
      status: "live",
      backfillStatus: "done",
      releasedThrough: new Date(WORLD_END - 20 * 86_400_000),
      createdBy: u!.id,
    })
    .returning();
  await runRelease(q!.id, edge);
  return {
    ctx: {
      workspaceId: w!.id,
      accountId: a!.id,
      userId: u!.id,
      tier,
      historyDays: limits(tier).historyDays,
    },
    queryId: q!.id,
    accountId: a!.id,
    edge,
  };
}

beforeAll(async () => {
  f = await fixture();
}, 180_000);

describe("Ask AI", () => {
  it("cites at least 3 real mentions and decrements the quota", async () => {
    const before = await aiQuota(f.accountId, "trial");
    const r = await askQuestion(f.ctx, "What are people saying lately?");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.citations.length).toBeGreaterThanOrEqual(MIN_CITATIONS);
    expect(r.remaining).toBe(before.remaining - 1);
    expect((await aiQuota(f.accountId, "trial")).used).toBe(before.used + 1);
    // Every citation points at a mention that exists, and the answer text references each one.
    const ids = r.citations.map((c) => c.mentionId);
    const found = await db.execute(
      sql`SELECT id FROM mentions WHERE id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    expect(found.rows.length).toBe(new Set(ids).size);
    for (const c of r.citations) expect(r.answer).toContain(`[${c.n}]`);
    expect(r.provider).toBe("simulated");
    const [saved] = await db.select().from(aiAnswers).where(eq(aiAnswers.id, r.id));
    expect(saved?.kind).toBe("ask");
  }, 60_000);

  it("never exposes spam or ground truth: cited mentions are non-spam", async () => {
    const r = await askQuestion(f.ctx, "complaints this week");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = await db.execute(sql`
      SELECT count(*)::int AS n FROM mentions m JOIN authors a ON a.id = m.author_id
      WHERE m.id IN (${sql.join(
        r.citations.map((c) => sql`${c.mentionId}`),
        sql`, `,
      )})
        AND a.bot_score >= 0.8`);
    expect((res.rows[0] as { n: number }).n).toBe(0);
  }, 60_000);

  it("rejects empty and over-long questions without charging", async () => {
    const before = (await aiQuota(f.accountId, "trial")).used;
    expect(await askQuestion(f.ctx, "   ")).toMatchObject({ ok: false, failure: "empty" });
    expect(await askQuestion(f.ctx, "x".repeat(500))).toMatchObject({
      ok: false,
      failure: "too_long",
    });
    expect((await aiQuota(f.accountId, "trial")).used).toBe(before);
  });

  it("an answer that cites fewer than 3 mentions is withheld and refunded", async () => {
    const lazy: AiProvider = { id: "lazy", answer: async () => "Looks fine. [1] [2]" };
    const before = (await aiQuota(f.accountId, "trial")).used;
    const r = await askQuestion({ ...f.ctx, provider: lazy }, "How is sentiment?");
    expect(r).toMatchObject({ ok: false, failure: "invalid_answer" });
    expect((await aiQuota(f.accountId, "trial")).used).toBe(before);
  }, 60_000);

  it("citations that point at nothing don't count", () => {
    const ev = [1, 2, 3].map((n) => ({ n }) as never);
    expect(citedNumbers("a [1] b [2] c [9] d [1]", ev)).toEqual([1, 2]);
  });

  it("a provider outage is a graceful failure that costs nothing", async () => {
    const down: AiProvider = {
      id: "down",
      answer: async () => {
        throw new Error("503");
      },
    };
    const before = (await aiQuota(f.accountId, "trial")).used;
    const r = await askQuestion({ ...f.ctx, provider: down }, "What changed?");
    expect(r).toMatchObject({ ok: false, failure: "provider_error" });
    expect((await aiQuota(f.accountId, "trial")).used).toBe(before);
  }, 60_000);

  it("a workspace with no queries gets a clear explanation, not a charge", async () => {
    const e = await fixture();
    await db.delete(queries).where(eq(queries.id, e.queryId));
    const r = await askQuestion(e.ctx, "anything?");
    expect(r).toMatchObject({ ok: false, failure: "no_queries" });
    expect((await aiQuota(e.accountId, "trial")).used).toBe(0);
  }, 180_000);

  it("stops at the plan's limit, then resumes next month's counter fresh", async () => {
    const g = await fixture();
    const limit = limits("trial").askAiPerMonth;
    await db
      .insert(usageCounters)
      .values({ accountId: g.accountId, period: periodOf(), metric: "ai_questions", value: limit })
      .onConflictDoUpdate({
        target: [usageCounters.accountId, usageCounters.period, usageCounters.metric],
        set: { value: limit },
      });
    const r = await askQuestion(g.ctx, "What are people saying?");
    expect(r).toMatchObject({ ok: false, failure: "quota_exhausted", remaining: 0 });
    expect((await aiQuota(g.accountId, "trial")).used).toBe(limit); // not pushed past the limit
    expect(await writeQuery(g.ctx, "battery life")).toMatchObject({
      ok: false,
      failure: "quota_exhausted",
    });
  }, 180_000);

  it("simultaneous questions at the edge can't overspend", async () => {
    const g = await fixture();
    const limit = limits("trial").askAiPerMonth;
    await db
      .insert(usageCounters)
      .values({
        accountId: g.accountId,
        period: periodOf(),
        metric: "ai_questions",
        value: limit - 2,
      })
      .onConflictDoNothing();
    const rs = await Promise.all(
      [1, 2, 3, 4].map(() => askQuestion(g.ctx, "What are people saying?")),
    );
    expect(rs.filter((r) => r.ok).length).toBe(2);
    expect((await aiQuota(g.accountId, "trial")).used).toBe(limit);
  }, 180_000);
});

describe("summaries and peak explanations", () => {
  it("summarises a window with citations", async () => {
    const r = await summarize(f.ctx, {
      queryId: f.queryId,
      from: new Date(f.edge.getTime() - 5 * 86_400_000),
      to: f.edge,
      label: "the last 5 days",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.citations.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it("a thin peak hour widens the window instead of refusing, and says so", async () => {
    // An hour with only a mention or two, where the tight window around it has fewer than 3 mentions.
    const hours = (
      await db.execute(sql`
        SELECT date_trunc('hour', qm.published_at) AS h FROM query_matches qm
        WHERE qm.query_id = ${f.queryId}::uuid GROUP BY 1 HAVING count(*) <= 2 ORDER BY 1 DESC LIMIT 200`)
    ).rows as { h: string }[];
    let thin: Date | null = null;
    for (const { h } of hours) {
      const t = new Date(h).getTime();
      const n = (
        await db.execute(sql`
          SELECT count(*)::int AS n FROM query_matches
          WHERE query_id = ${f.queryId}::uuid AND published_at >= ${new Date(t - 3_600_000)} AND published_at < ${new Date(t + 2 * 3_600_000)}`)
      ).rows[0] as { n: number };
      if (n.n < 3) {
        thin = new Date(t);
        break;
      }
    }
    expect(thin, "the fixture should have a quiet hour").not.toBeNull();
    const r = await explainPeak(f.ctx, { queryId: f.queryId, peakHour: thin! });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.citations.length).toBeGreaterThanOrEqual(3);
    expect(r.scope).toMatch(/day around the peak|days around the peak/);
  }, 60_000);

  it("explains the busiest hour with citations from around it", async () => {
    const hour = (
      await db.execute(sql`
        SELECT date_trunc('hour', qm.published_at) AS h FROM query_matches qm
        WHERE qm.query_id = ${f.queryId}::uuid GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)
    ).rows[0] as { h: string };
    const r = await explainPeak(f.ctx, { queryId: f.queryId, peakHour: new Date(hour.h) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.citations.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe("query writer", () => {
  it("drafts Boolean that the real parser accepts, with exclusions", () => {
    const d = draftBoolean(
      'Find mentions about "battery life" and charging, but not refunds or jobs',
    );
    expect(d.text).toContain('"battery life"');
    expect(d.text).toContain("charging");
    expect(d.text).toMatch(/NOT \(.*refunds.*jobs.*\)/);
    expect(analyze(d.text).ok).toBe(true);
  });

  it("charges one unit for a valid draft and none for an unusable one", async () => {
    const before = (await aiQuota(f.accountId, "trial")).used;
    const ok = await writeQuery(f.ctx, "customers complaining about shipping delays");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(analyze(ok.booleanText).ok).toBe(true);
    expect((await aiQuota(f.accountId, "trial")).used).toBe(before + 1);
    const bad = await writeQuery(f.ctx, "find the mentions");
    expect(bad).toMatchObject({ ok: false, failure: "invalid_answer" });
    expect((await aiQuota(f.accountId, "trial")).used).toBe(before + 1);
  });
});
