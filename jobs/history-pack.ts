import { eq, sql } from "drizzle-orm";
import { accounts, db, historyPacks, queries, workspaces } from "@/db/client";
import { HISTORY_PACK } from "@/lib/billing/history-pack";
import { trackServer } from "@/lib/analytics/server";
import { limits, visibleUntil, type PlanTier } from "@/lib/entitlements/plans";
import { compile, compileFilters } from "@/lib/query/compile";
import { analyze } from "@/lib/query/lint";
import { simNow } from "@/lib/simclock";

/**
 * Collect the stretch just before the plan's window for one query: the year (or whatever the pack bought) before the
 * point where the normal backfill starts. Newest first, up to the pack's cap, and never counted against the monthly
 * mentions allowance. Safe to run again: it replaces nothing, adding only matches the query does not have yet, and it
 * recomputes the query's daily totals from everything it holds. The normal backfill calls it after rebuilding a query.
 */
export async function runHistoryBackfill(packId: string): Promise<{ matched: number } | null> {
  const t0 = Date.now();
  const [pack] = await db.select().from(historyPacks).where(eq(historyPacks.id, packId));
  if (!pack) return null;
  const [q] = await db.select().from(queries).where(eq(queries.id, pack.queryId));
  if (!q || q.status !== "live") return null;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, q.workspaceId));
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws!.accountId));
  const analysis = analyze(q.booleanText);
  if (!analysis.ok || !analysis.ast) {
    await db.update(historyPacks).set({ status: "failed" }).where(eq(historyPacks.id, packId));
    return null;
  }
  await db.update(historyPacks).set({ status: "running" }).where(eq(historyPacks.id, packId));

  const tier = acct!.planTier as PlanTier;
  const to = new Date(
    visibleUntil(tier, simNow()).getTime() - limits(tier).historyDays * 86_400_000,
  );
  const from = new Date(to.getTime() - pack.extraDays * 86_400_000);
  const predicate = sql`published_at >= ${from} AND published_at < ${to} AND ${compile(analysis.ast)} AND ${compileFilters({ sources: q.sources, languages: q.languages, countries: q.countries })}`;

  await db.execute(sql`
    WITH picked AS (
      SELECT id, published_at FROM mentions WHERE ${predicate} ORDER BY published_at DESC LIMIT ${HISTORY_PACK.maxMentions}
    )
    INSERT INTO query_matches (query_id, mention_id, published_at)
    SELECT ${q.id}, id, published_at FROM picked
    ON CONFLICT DO NOTHING`);
  const matched = Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM query_matches WHERE query_id = ${q.id} AND published_at < ${to}`,
      )
    ).rows[0]!.n,
  );
  await db.execute(sql`DELETE FROM query_daily_stats WHERE query_id = ${q.id}`);
  await db.execute(sql`
    INSERT INTO query_daily_stats (query_id, day, mentions, positive, negative, neutral, mixed, reach)
    SELECT qm.query_id, date_trunc('day', m.published_at)::date, count(*),
           count(*) FILTER (WHERE m.sentiment_pred = 'positive'), count(*) FILTER (WHERE m.sentiment_pred = 'negative'),
           count(*) FILTER (WHERE m.sentiment_pred = 'neutral'), count(*) FILTER (WHERE m.sentiment_pred = 'mixed'),
           coalesce(sum(m.reach_est), 0)
    FROM query_matches qm JOIN mentions m ON m.id = qm.mention_id WHERE qm.query_id = ${q.id} GROUP BY 1, 2`);
  await db
    .update(historyPacks)
    .set({ status: "done", matched, fromAt: from, toAt: to, completedAt: simNow() })
    .where(eq(historyPacks.id, packId));
  await trackServer(
    "History Pack Completed",
    { userId: pack.purchasedBy, workspaceId: q.workspaceId, accountId: acct!.id },
    { query_id: q.id, matched_count: matched, duration_ms: Date.now() - t0 },
  );
  return { matched };
}
