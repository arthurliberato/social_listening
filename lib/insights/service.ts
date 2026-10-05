// Authors and Topics: aggregates over the same visible, non-spam, override-aware mentions as the feed.
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { authorWatchlist, db } from "@/db/client";
import { buildFeedWhere, EFFECTIVE_SENTIMENT, FROM } from "@/lib/mentions/feed";
import type { FeedFilters } from "@/lib/mentions/filters";

export interface AuthorRow {
  id: number;
  handle: string;
  name: string;
  source: string;
  type: string;
  followers: number;
  verified: boolean;
  mentions: number;
  negative: number;
  reach: number;
  watched: boolean;
}

export type AuthorSort = "reach" | "mentions" | "negative";
export const AUTHOR_SORTS: AuthorSort[] = ["reach", "mentions", "negative"];

export async function topAuthors(o: {
  workspaceId: string;
  filters: FeedFilters;
  historyDays: number;
  sort: AuthorSort;
  watchedOnly: boolean;
  limit?: number;
}): Promise<{ rows: AuthorRow[]; hasQueries: boolean }> {
  const b = await buildFeedWhere({
    workspaceId: o.workspaceId,
    filters: o.filters,
    historyDays: o.historyDays,
    since: null,
  });
  if (!b.scoped.length) return { rows: [], hasQueries: false };
  const order =
    o.sort === "mentions"
      ? sql`count(*) DESC`
      : o.sort === "negative"
        ? sql`count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative') DESC`
        : sql`sum(m.reach_est) DESC`;
  const res = await db.execute(sql`
    SELECT a.id, a.handle, a.display_name AS name, s.display_name AS source, a.author_type AS type,
           a.followers, a.verified, count(*)::int AS mentions,
           count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative')::int AS negative,
           coalesce(sum(m.reach_est), 0)::bigint AS reach,
           (w.author_id IS NOT NULL) AS watched
    ${FROM(o.workspaceId)}
    LEFT JOIN author_watchlist w ON w.workspace_id = ${o.workspaceId}::uuid AND w.author_id = a.id
    WHERE ${b.where} AND ${b.spamPart}
      ${o.watchedOnly ? sql`AND w.author_id IS NOT NULL` : sql``}
    GROUP BY a.id, s.display_name, w.author_id
    ORDER BY ${order}, a.id
    LIMIT ${o.limit ?? 50}`);
  return {
    hasQueries: true,
    rows: (res.rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      handle: String(r.handle),
      name: String(r.name),
      source: String(r.source),
      type: String(r.type),
      followers: Number(r.followers),
      verified: Boolean(r.verified),
      mentions: Number(r.mentions),
      negative: Number(r.negative),
      reach: Number(r.reach),
      watched: Boolean(r.watched),
    })),
  };
}

export interface AuthorProfile {
  author: Omit<AuthorRow, "mentions" | "negative" | "reach" | "watched">;
  bio: string;
  joined: string;
  watched: boolean;
  total: number;
  negative: number;
  positive: number;
  reach: number;
  recent: { id: number; text: string; publishedAt: string; sentiment: string; reach: number }[];
}

/** One author as this workspace sees them: only mentions that match the workspace's queries. */
export async function authorProfile(o: {
  workspaceId: string;
  authorId: number;
  filters: FeedFilters;
  historyDays: number;
}): Promise<AuthorProfile | null> {
  const b = await buildFeedWhere({
    workspaceId: o.workspaceId,
    filters: o.filters,
    historyDays: o.historyDays,
    since: null,
  });
  const [a] = (
    await db.execute(sql`
      SELECT a.id, a.handle, a.display_name AS name, s.display_name AS source, a.author_type AS type,
             a.followers, a.verified, a.bio, a.created_at
      FROM authors a JOIN sources s ON s.id = a.source_id WHERE a.id = ${o.authorId}`)
  ).rows as Record<string, unknown>[];
  if (!a) return null;
  const scope = b.scoped.length
    ? sql`${b.where} AND ${b.spamPart} AND a.id = ${o.authorId}`
    : sql`FALSE`;
  const [agg, recent, watch] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative')::int AS negative,
             count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'positive')::int AS positive,
             coalesce(sum(m.reach_est), 0)::bigint AS reach
      ${FROM(o.workspaceId)} WHERE ${scope}`),
    db.execute(sql`
      SELECT m.id, left(m.text, 280) AS text, m.published_at, ${EFFECTIVE_SENTIMENT} AS sentiment, m.reach_est AS reach
      ${FROM(o.workspaceId)} WHERE ${scope} ORDER BY m.published_at DESC, m.id DESC LIMIT 10`),
    db
      .select()
      .from(authorWatchlist)
      .where(
        and(
          eq(authorWatchlist.workspaceId, o.workspaceId),
          eq(authorWatchlist.authorId, o.authorId),
        ),
      ),
  ]);
  const g = agg.rows[0] as Record<string, unknown>;
  return {
    author: {
      id: Number(a.id),
      handle: String(a.handle),
      name: String(a.name),
      source: String(a.source),
      type: String(a.type),
      followers: Number(a.followers),
      verified: Boolean(a.verified),
    },
    bio: String(a.bio ?? ""),
    joined: new Date(String(a.created_at)).toISOString().slice(0, 10),
    watched: watch.length > 0,
    total: Number(g.total),
    negative: Number(g.negative),
    positive: Number(g.positive),
    reach: Number(g.reach),
    recent: (recent.rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      text: String(r.text),
      publishedAt: new Date(String(r.published_at)).toISOString(),
      sentiment: String(r.sentiment),
      reach: Number(r.reach),
    })),
  };
}

export interface TopicRow {
  topic: string;
  mentions: number;
  previous: number;
  /** Percent change vs the previous period of the same length; null when there was nothing before. */
  growthPct: number | null;
  negativeShare: number;
  reach: number;
}

export async function topicStats(o: {
  workspaceId: string;
  filters: FeedFilters;
  historyDays: number;
  limit?: number;
}): Promise<{ rows: TopicRow[]; hasQueries: boolean; from: Date; to: Date }> {
  const cur = await buildFeedWhere({
    workspaceId: o.workspaceId,
    filters: o.filters,
    historyDays: o.historyDays,
    since: null,
  });
  const span = cur.win.to.getTime() - cur.win.from.getTime();
  const prev = await buildFeedWhere({
    workspaceId: o.workspaceId,
    filters: o.filters,
    historyDays: o.historyDays,
    since: null,
    window: { from: new Date(cur.win.from.getTime() - span), to: cur.win.from },
  });
  if (!cur.scoped.length)
    return { rows: [], hasQueries: false, from: cur.win.from, to: cur.win.to };
  const agg = (w: typeof cur) => sql`
    SELECT t AS topic, count(*)::int AS n,
           count(*) FILTER (WHERE sentiment = 'negative')::int AS neg, coalesce(sum(reach), 0)::bigint AS reach
    FROM (SELECT unnest(m.topics) AS t, ${EFFECTIVE_SENTIMENT} AS sentiment, m.reach_est AS reach
          ${FROM(o.workspaceId)} WHERE ${w.where} AND ${w.spamPart}) x
    GROUP BY t`;
  const [now, before] = await Promise.all([db.execute(agg(cur)), db.execute(agg(prev))]);
  const was = new Map(
    (before.rows as { topic: string; n: number }[]).map((r) => [r.topic, Number(r.n)]),
  );
  const rows = (now.rows as { topic: string; n: number; neg: number; reach: string }[])
    .map((r) => {
      const p = was.get(r.topic) ?? 0;
      return {
        topic: r.topic,
        mentions: Number(r.n),
        previous: p,
        growthPct: p > 0 ? Math.round(((Number(r.n) - p) / p) * 100) : null,
        negativeShare: Number(r.n) ? Number(r.neg) / Number(r.n) : 0,
        reach: Number(r.reach),
      };
    })
    .sort((a, b) => b.mentions - a.mentions || a.topic.localeCompare(b.topic))
    .slice(0, o.limit ?? 30);
  return { rows, hasQueries: true, from: cur.win.from, to: cur.win.to };
}
