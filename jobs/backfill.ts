import { eq, sql } from "drizzle-orm";
import { accounts, db, queries, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { compile, compileFilters } from "@/lib/query/compile";
import { analyze } from "@/lib/query/lint";
import { simNow } from "@/lib/simclock";
import { addMentionUsage, getMentionUsage } from "@/lib/usage";

/**
 * Materialise a query's matches over the plan's history window. Matches are counted against the
 * account's monthly mention allowance at match time; when it runs out, collection stops (existing
 * matches stay visible) and the query is marked quota_exhausted.
 */
export async function runBackfill(queryId: string, actorUserId?: string | null): Promise<void> {
  const t0 = Date.now();
  const [q] = await db.select().from(queries).where(eq(queries.id, queryId));
  if (!q || q.status !== "live") return;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, q.workspaceId));
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws!.accountId));
  const plan = limits(acct!.planTier as PlanTier);

  const analysis = analyze(q.booleanText);
  if (!analysis.ok || !analysis.ast) {
    await db.update(queries).set({ backfillStatus: "failed" }).where(eq(queries.id, queryId));
    return;
  }
  await db.update(queries).set({ backfillStatus: "running" }).where(eq(queries.id, queryId));

  const end = simNow();
  const start = new Date(end.getTime() - plan.historyDays * 86_400_000);
  const before = await getMentionUsage(ws!.accountId);
  const predicate = sql`published_at >= ${start} AND published_at < ${end} AND ${compile(analysis.ast)} AND ${compileFilters({ sources: q.sources, languages: q.languages, countries: q.countries })}`;

  await db.execute(sql`DELETE FROM query_matches WHERE query_id = ${queryId}`);
  await db.execute(sql`DELETE FROM query_daily_stats WHERE query_id = ${queryId}`);

  // Most recent first, up to what the monthly allowance still permits (+1 to detect overflow).
  const inserted = await db.execute(sql`
    WITH picked AS (
      SELECT id, published_at FROM mentions WHERE ${predicate} ORDER BY published_at DESC LIMIT ${before.remaining + 1}
    ), kept AS (
      SELECT id, published_at, row_number() OVER (ORDER BY published_at DESC) AS rn FROM picked
    )
    INSERT INTO query_matches (query_id, mention_id, published_at)
    SELECT ${queryId}, id, published_at FROM kept WHERE rn <= ${before.remaining}
    ON CONFLICT DO NOTHING
    RETURNING 1`);
  const matched = inserted.rowCount ?? 0;
  const overflow = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM mentions WHERE ${predicate} LIMIT ${before.remaining + 1}) c`,
    )
  ).rows[0] as { n: number };
  const exhausted = overflow.n > before.remaining;

  await db.execute(sql`
    INSERT INTO query_daily_stats (query_id, day, mentions, positive, negative, neutral, mixed, reach)
    SELECT qm.query_id, date_trunc('day', m.published_at)::date, count(*),
           count(*) FILTER (WHERE m.sentiment_pred = 'positive'), count(*) FILTER (WHERE m.sentiment_pred = 'negative'),
           count(*) FILTER (WHERE m.sentiment_pred = 'neutral'), count(*) FILTER (WHERE m.sentiment_pred = 'mixed'),
           coalesce(sum(m.reach_est), 0)
    FROM query_matches qm JOIN mentions m ON m.id = qm.mention_id WHERE qm.query_id = ${queryId} GROUP BY 1, 2`);

  await addMentionUsage(ws!.accountId, matched);
  await db
    .update(queries)
    .set({
      backfillStatus: exhausted ? "quota_exhausted" : "done",
      backfillMatched: matched,
      backfilledAt: new Date(),
    })
    .where(eq(queries.id, queryId));

  const ctx = {
    userId: actorUserId ?? q.createdBy,
    workspaceId: q.workspaceId,
    accountId: ws!.accountId,
  };
  await trackServer("Query Backfill Completed", ctx, {
    query_id: queryId,
    backfill_days: plan.historyDays,
    matched_count: matched,
    duration_ms: Date.now() - t0,
  });
  const pctBefore = before.pct;
  const pctAfter = Math.min(100, Math.round(((before.used + matched) / before.limit) * 100));
  if (exhausted || pctAfter >= 100)
    await trackServer("Quota Threshold Reached", ctx, {
      quota_type: "mentions",
      threshold_pct: 100,
    });
  else if (pctAfter >= 80 && pctBefore < 80)
    await trackServer("Quota Threshold Reached", ctx, {
      quota_type: "mentions",
      threshold_pct: 80,
    });
}
