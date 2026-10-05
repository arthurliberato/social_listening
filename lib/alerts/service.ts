// Shared data access for the Alerts and Crisis Room screens and their server actions.
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { alertRules, db, queries, workspaces } from "@/db/client";
import { EFFECTIVE_SENTIMENT, SPAM_SQL } from "@/lib/mentions/feed";
import { simNow } from "@/lib/simclock";
import { loadBuckets } from "./engine";
import {
  backtest,
  denseBuckets,
  HOUR_MS,
  type AlertType,
  type Backtest,
  type Bucket,
  type Params,
} from "./rules";

/** Alert rules count against the account (like active queries), across its workspaces. */
export async function alertCount(accountId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(alertRules)
    .innerJoin(workspaces, eq(workspaces.id, alertRules.workspaceId))
    .where(eq(workspaces.accountId, accountId));
  return r?.n ?? 0;
}

export const BACKTEST_DAYS = 30;

/** Replay a rule over the query's last 30 days (or the plan's history, if shorter). */
export async function backtestRule<T extends AlertType>(opts: {
  workspaceId: string;
  queryId: string;
  type: T;
  params: Params[T];
  historyDays: number;
}): Promise<(Backtest & { empty: boolean }) | null> {
  const [q] = await db
    .select()
    .from(queries)
    .where(and(eq(queries.id, opts.queryId), eq(queries.workspaceId, opts.workspaceId)));
  if (!q) return null;
  const end = Math.floor((q.releasedThrough ?? simNow()).getTime() / HOUR_MS) * HOUR_MS;
  const days = Math.min(BACKTEST_DAYS, opts.historyDays);
  const from = end - days * 24 * HOUR_MS;
  const rows = await loadBuckets(opts.workspaceId, opts.queryId, from, end);
  const hours = denseBuckets(rows, from, end);
  return { ...backtest(opts.type, opts.params, hours), empty: rows.length === 0 };
}

export interface RoomStats {
  hours: Bucket[];
  total: number;
  negative: number;
  peakHour: number;
  peakVolume: number;
  reach: number;
  topMentions: {
    id: number;
    text: string;
    author: string;
    source: string;
    reach: number;
    publishedAt: string;
    sentiment: string;
  }[];
  topAuthors: { handle: string; name: string; mentions: number; reach: number }[];
}

/** Everything a crisis room shows: hourly volume split by sentiment, and what is driving it. */
export async function roomStats(opts: {
  workspaceId: string;
  queryId: string;
  from: Date;
  to: Date;
}): Promise<RoomStats> {
  const { workspaceId, queryId, from, to } = opts;
  const fromMs = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS;
  const toMs = Math.ceil(to.getTime() / HOUR_MS) * HOUR_MS;
  const hours = denseBuckets(await loadBuckets(workspaceId, queryId, fromMs, toMs), fromMs, toMs);

  const base = sql`
    FROM query_matches qm
    JOIN mentions m ON m.id = qm.mention_id
    JOIN authors a ON a.id = m.author_id
    JOIN sources s ON s.id = m.source_id
    LEFT JOIN mention_overrides o ON o.workspace_id = ${workspaceId}::uuid AND o.mention_id = m.id
    WHERE qm.query_id = ${queryId}::uuid AND qm.published_at >= ${new Date(fromMs)}
      AND qm.published_at < ${new Date(toMs)} AND NOT ${SPAM_SQL}`;
  const [mentions, authors, reach] = await Promise.all([
    db.execute(sql`
      SELECT m.id, left(m.text, 280) AS text, a.display_name AS author, s.display_name AS source,
             m.reach_est AS reach, m.published_at, ${EFFECTIVE_SENTIMENT} AS sentiment
      ${base} AND ${EFFECTIVE_SENTIMENT} = 'negative'
      ORDER BY m.reach_est DESC, m.id DESC LIMIT 5`),
    db.execute(sql`
      SELECT a.handle, a.display_name AS name, count(*)::int AS mentions, sum(m.reach_est)::bigint AS reach
      ${base} AND ${EFFECTIVE_SENTIMENT} = 'negative'
      GROUP BY a.id ORDER BY sum(m.reach_est) DESC LIMIT 5`),
    db.execute(sql`SELECT coalesce(sum(m.reach_est), 0)::bigint AS reach ${base}`),
  ]);
  const total = hours.reduce((a, b) => a + b.count, 0);
  const peak = hours.reduce(
    (a, b) => (b.count > a.count ? b : a),
    hours[0] ?? { t: fromMs, count: 0 },
  );
  return {
    hours,
    total,
    negative: hours.reduce((a, b) => a + b.negative, 0),
    peakHour: peak.t,
    peakVolume: peak.count,
    reach: Number((reach.rows[0] as { reach: string }).reach),
    topMentions: (
      mentions.rows as {
        id: string;
        text: string;
        author: string;
        source: string;
        reach: string;
        published_at: string;
        sentiment: string;
      }[]
    ).map((r) => ({
      id: Number(r.id),
      text: r.text,
      author: r.author,
      source: r.source,
      reach: Number(r.reach),
      publishedAt: new Date(r.published_at).toISOString(),
      sentiment: r.sentiment,
    })),
    topAuthors: (
      authors.rows as { handle: string; name: string; mentions: number; reach: string }[]
    ).map((r) => ({ ...r, reach: Number(r.reach) })),
  };
}

export async function queriesOf(workspaceId: string, ids?: string[]) {
  return db
    .select({ id: queries.id, name: queries.name, status: queries.status })
    .from(queries)
    .where(
      ids?.length
        ? and(eq(queries.workspaceId, workspaceId), inArray(queries.id, ids))
        : eq(queries.workspaceId, workspaceId),
    )
    .orderBy(queries.name);
}
