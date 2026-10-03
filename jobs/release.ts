import { eq, sql } from "drizzle-orm";
import { accounts, db, queries, workspaces } from "@/db/client";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { trackServer } from "@/lib/analytics/server";
import { limits, visibleUntil, type PlanTier } from "@/lib/entitlements/plans";
import { compile, compileFilters } from "@/lib/query/compile";
import { analyze } from "@/lib/query/lint";
import { simNow } from "@/lib/simclock";
import { addMentionUsage, getMentionUsage } from "@/lib/usage";

export interface ReleaseResult {
  queryId: string;
  matched: number;
  exhausted: boolean;
}

/**
 * Release newly "published" corpus mentions to a live query. The corpus is pre-generated with future
 * timestamps; this job reveals them as the sim clock advances, honouring the plan's refresh tier and
 * monthly mention allowance (skipped mentions are not collected later).
 */
export async function runRelease(
  queryId: string,
  now: Date = simNow(),
): Promise<ReleaseResult | null> {
  const [q] = await db.select().from(queries).where(eq(queries.id, queryId));
  if (!q || q.status !== "live" || !q.releasedThrough) return null; // not backfilled yet
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, q.workspaceId));
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws!.accountId));
  const tier = acct!.planTier as PlanTier;
  const until = visibleUntil(tier, now);
  if (until <= q.releasedThrough) return { queryId, matched: 0, exhausted: false };

  const analysis = analyze(q.booleanText);
  if (!analysis.ok || !analysis.ast) return null;
  const usage = await getMentionUsage(ws!.accountId);
  const predicate = sql`published_at > ${q.releasedThrough} AND published_at <= ${until} AND ${compile(analysis.ast)} AND ${compileFilters({ sources: q.sources, languages: q.languages, countries: q.countries })}`;

  const inserted = await db.execute(sql`
    WITH picked AS (SELECT id, published_at FROM mentions WHERE ${predicate} ORDER BY published_at ASC LIMIT ${usage.remaining + 1}),
    kept AS (SELECT id, published_at, row_number() OVER (ORDER BY published_at ASC) AS rn FROM picked)
    INSERT INTO query_matches (query_id, mention_id, published_at)
    SELECT ${queryId}, id, published_at FROM kept WHERE rn <= ${usage.remaining}
    ON CONFLICT DO NOTHING RETURNING published_at`);
  const matched = inserted.rowCount ?? 0;
  const exhausted =
    matched >= usage.remaining &&
    usage.remaining >= 0 &&
    (
      await db.execute(
        sql`SELECT 1 FROM mentions WHERE ${predicate} OFFSET ${usage.remaining} LIMIT 1`,
      )
    ).rows.length > 0;

  if (matched) {
    await db.execute(
      sql`DELETE FROM query_daily_stats WHERE query_id = ${queryId} AND day >= date_trunc('day', ${q.releasedThrough}::timestamptz)::date`,
    );
    await db.execute(sql`
      INSERT INTO query_daily_stats (query_id, day, mentions, positive, negative, neutral, mixed, reach)
      SELECT qm.query_id, date_trunc('day', m.published_at)::date, count(*),
             count(*) FILTER (WHERE m.sentiment_pred = 'positive'), count(*) FILTER (WHERE m.sentiment_pred = 'negative'),
             count(*) FILTER (WHERE m.sentiment_pred = 'neutral'), count(*) FILTER (WHERE m.sentiment_pred = 'mixed'), coalesce(sum(m.reach_est), 0)
      FROM query_matches qm JOIN mentions m ON m.id = qm.mention_id
      WHERE qm.query_id = ${queryId} AND qm.published_at >= date_trunc('day', ${q.releasedThrough}::timestamptz)
      GROUP BY 1, 2`);
    await addMentionUsage(ws!.accountId, matched);
  }
  await db
    .update(queries)
    .set({
      releasedThrough: until,
      backfillMatched: sql`${queries.backfillMatched} + ${matched}`,
      ...(exhausted ? { backfillStatus: "quota_exhausted" } : {}),
    })
    .where(eq(queries.id, queryId));

  // Alerts see exactly what the release just made visible, so they fire within this cycle.
  try {
    await evaluateAlerts(queryId, until);
  } catch (e) {
    console.error("[alerts] evaluation failed for query", queryId, e);
  }

  const ctx = { userId: q.createdBy, workspaceId: q.workspaceId, accountId: ws!.accountId };
  const after = Math.min(100, Math.round(((usage.used + matched) / usage.limit) * 100));
  if (exhausted && usage.pct < 100)
    await trackServer("Quota Threshold Reached", ctx, {
      quota_type: "mentions",
      threshold_pct: 100,
    });
  else if (after >= 80 && usage.pct < 80)
    await trackServer("Quota Threshold Reached", ctx, {
      quota_type: "mentions",
      threshold_pct: 80,
    });
  return { queryId, matched, exhausted };
}

/** Release for every live, backfilled query. Runs on a 5-minute schedule. */
export async function runReleaseAll(now: Date = simNow()): Promise<ReleaseResult[]> {
  const live = await db.select({ id: queries.id }).from(queries).where(eq(queries.status, "live"));
  const out: ReleaseResult[] = [];
  for (const { id } of live) {
    try {
      const r = await runRelease(id, now);
      if (r) out.push(r);
    } catch (e) {
      console.error("[release] failed for query", id, e);
    }
  }
  return out;
}
