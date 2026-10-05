// Finding the mentions an AI answer rests on. Everything here reads the same visible, non-spam,
// override-aware mentions the feed shows, so an answer's numbers can be checked against Mentions.
import { and, eq } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { db, queries } from "@/db/client";
import { EFFECTIVE_SENTIMENT, FROM, SPAM_SQL } from "@/lib/mentions/feed";
import { simNow } from "@/lib/simclock";
import type { Evidence, Stats } from "./provider";

const DAY = 86_400_000;

const STOP = new Set(
  `a about after all also am an and any are as at be been but by can could did do does for from get got had has have how i in into is it its just me more most my of on or our out over so some than that the their them then there these they this those to up us was we were what when where which who why will with would you your people say saying said think thinks talk talking tell show mentions mention customers customer users latest recent lately happening happened going`.split(
    " ",
  ),
);
/** Words that steer which mentions are wanted rather than what they are about. */
const NEGATIVE_HINT =
  /\b(negative|complain\w*|angry|upset|problem\w*|issues?|bad|worst|hate\w*|frustrat\w*)\b/g;
const POSITIVE_HINT = /\b(positive|praise\w*|love\w*|happy|best|great)\b/g;

export interface Intent {
  terms: string[];
  sentiment: "negative" | "positive" | null;
  days: number;
  windowLabel: string;
}

/** Turn a question into search terms, an optional sentiment lean and a look-back window. */
export function parseQuestion(q: string): Intent {
  let s = q.toLowerCase();
  let days = 14;
  let windowLabel = "the last 14 days";
  if (/\b(today|last 24 hours|past day)\b/.test(s)) [days, windowLabel] = [1, "the last 24 hours"];
  else if (/\byesterday\b/.test(s)) [days, windowLabel] = [2, "the last 2 days"];
  else if (/\b(this week|last week|past week|7 days|seven days)\b/.test(s))
    [days, windowLabel] = [7, "the last 7 days"];
  else if (/\b(this month|last month|past month|30 days)\b/.test(s))
    [days, windowLabel] = [30, "the last 30 days"];
  const sentiment = NEGATIVE_HINT.test(s) ? "negative" : POSITIVE_HINT.test(s) ? "positive" : null;
  NEGATIVE_HINT.lastIndex = 0;
  POSITIVE_HINT.lastIndex = 0;
  s = s
    .replace(NEGATIVE_HINT, " ")
    .replace(POSITIVE_HINT, " ")
    .replace(/\b(today|yesterday|this|last|past|week|month|days?|hours?|seven|\d+)\b/g, " ");
  const terms = [...new Set((s.match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(
    0,
    6,
  );
  return { terms, sentiment, days, windowLabel };
}

export interface Retrieved {
  evidence: Evidence[];
  stats: Stats;
  scope: string;
  /** True when no search term matched and we fell back to the most visible recent mentions. */
  broadened: boolean;
}

export interface RetrieveOpts {
  workspaceId: string;
  historyDays: number;
  /** Limit to one query (otherwise all live queries in the workspace). */
  queryId?: string;
  terms?: string[];
  sentiment?: "negative" | "positive" | null;
  /** Explicit window; otherwise the last `days` before the data's edge. */
  from?: Date;
  to?: Date;
  days?: number;
  windowLabel?: string;
  limit?: number;
}

async function scopeQueries(workspaceId: string, queryId?: string) {
  const rows = await db
    .select({ id: queries.id, name: queries.name, through: queries.releasedThrough })
    .from(queries)
    .where(
      queryId
        ? and(eq(queries.workspaceId, workspaceId), eq(queries.id, queryId))
        : and(eq(queries.workspaceId, workspaceId), eq(queries.status, "live")),
    );
  return rows;
}

async function run(
  workspaceId: string,
  ids: string[],
  from: Date,
  to: Date,
  terms: string[],
  sentiment: "negative" | "positive" | null,
  limit: number,
) {
  const inIds = sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );
  const tsq = terms.length ? terms.join(" | ") : null;
  const where: SQL[] = [
    sql`m.id IN (SELECT qm.mention_id FROM query_matches qm WHERE qm.query_id IN (${inIds})
      AND qm.published_at >= ${from} AND qm.published_at < ${to})`,
    sql`NOT ${SPAM_SQL}`,
  ];
  if (tsq) where.push(sql`m.tsv @@ to_tsquery('simple', ${tsq})`);
  if (sentiment) where.push(sql`${EFFECTIVE_SENTIMENT} = ${sentiment}`);
  const w = sql.join(where, sql` AND `);
  const rank = tsq ? sql`ts_rank(m.tsv, to_tsquery('simple', ${tsq})) DESC,` : sql``;
  const [rows, agg, topics] = await Promise.all([
    db.execute(sql`
      SELECT m.id, left(m.text, 400) AS text, a.display_name AS author, s.display_name AS source,
             m.published_at, ${EFFECTIVE_SENTIMENT} AS sentiment, m.reach_est AS reach, m.topics
      ${FROM(workspaceId)} WHERE ${w}
      ORDER BY ${rank} m.reach_est DESC, m.id DESC LIMIT ${limit}`),
    db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative')::int AS negative
      ${FROM(workspaceId)} WHERE ${w}`),
    db.execute(sql`
      SELECT t AS topic, count(*)::int AS n
      FROM (SELECT unnest(m.topics) AS t ${FROM(workspaceId)} WHERE ${w}) x
      GROUP BY t ORDER BY n DESC, t LIMIT 3`),
  ]);
  const a = agg.rows[0] as { total: number; negative: number };
  return {
    total: a.total,
    negative: a.negative,
    topics: (topics.rows as { topic: string }[]).map((r) => r.topic),
    rows: rows.rows as {
      id: string;
      text: string;
      author: string;
      source: string;
      published_at: string;
      sentiment: string;
      reach: string;
      topics: string[];
    }[],
  };
}

export async function retrieve(o: RetrieveOpts): Promise<Retrieved | null> {
  const qs = await scopeQueries(o.workspaceId, o.queryId);
  if (!qs.length) return null;
  const edge = new Date(Math.max(...qs.map((q) => (q.through ?? simNow()).getTime())));
  const to = o.to ?? edge;
  const days = Math.min(o.days ?? 14, o.historyDays);
  const from = o.from ?? new Date(to.getTime() - days * DAY);
  const ids = qs.map((q) => q.id);
  const limit = o.limit ?? 8;
  const label = o.windowLabel ?? `the last ${days} days`;
  const where = qs.length === 1 ? `“${qs[0]!.name}”` : `${qs.length} queries`;

  let broadened = false;
  let r = await run(o.workspaceId, ids, from, to, o.terms ?? [], o.sentiment ?? null, limit);
  if (r.total < 3 && (o.terms?.length ?? 0) > 0) {
    // Nothing (or too little) about those words: widen to the most visible mentions in the window.
    broadened = true;
    r = await run(o.workspaceId, ids, from, to, [], o.sentiment ?? null, limit);
  }
  return {
    evidence: r.rows.map((x, i) => ({
      n: i + 1,
      mentionId: Number(x.id),
      text: x.text,
      author: x.author,
      source: x.source,
      publishedAt: new Date(x.published_at).toISOString(),
      sentiment: x.sentiment,
      reach: Number(x.reach),
      topics: x.topics ?? [],
    })),
    stats: {
      total: r.total,
      negativeShare: r.total ? r.negative / r.total : 0,
      topTopics: r.topics,
    },
    scope: broadened
      ? `${label} of ${where} (no mentions matched your wording, so these are the most visible)`
      : `${label} of ${where}`,
    broadened,
  };
}
