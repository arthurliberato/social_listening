import { and, eq } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { db, memberships, queries } from "@/db/client";
import { positiveTerms } from "@/lib/query/ast";
import { compile } from "@/lib/query/compile";
import { analyze } from "@/lib/query/lint";
import { SPAM_BOT_SCORE, SPAM_TEXT_RE } from "@/lib/query/spam";
import { simNow } from "@/lib/simclock";
import { FOLLOWER_BANDS, RANGE_DAYS, type FeedFilters } from "./filters";

export interface FeedRow {
  id: number;
  title: string | null;
  text: string;
  publishedAt: string;
  lang: string;
  country: string;
  city: string;
  sourceType: string;
  sourceName: string;
  contentType: string;
  author: { handle: string; name: string; followers: number; verified: boolean; type: string };
  likes: number;
  shares: number;
  comments: number;
  views: number;
  reach: number;
  sentiment: string; // effective (override applied)
  predicted: string; // what the classifier said
  overridden: boolean;
  confidence: number;
  emotion: string;
  topics: string[];
  tags: string[];
  flagged: boolean;
  hasMedia: boolean;
  mediaAlt: string | null;
  likelySpam: boolean;
  url: string;
  unread: boolean;
}

export interface FeedResult {
  rows: FeedRow[];
  total: number;
  capped: boolean;
  hiddenSpam: number;
  terms: { value: string; wildcard: boolean }[];
  queries: { id: string; name: string; status: string }[];
  /** True while any live query is still collecting its history. */
  collecting: boolean;
  since: string | null;
  searchError: string | null;
  loadedAt: string;
  window: { from: string; to: string };
}

const COUNT_CAP = 100_000;
export const VISIT_GAP_MS = 30 * 60_000;
const SPAM_SQL = sql`(a.bot_score >= ${SPAM_BOT_SCORE} OR m.text ~* ${SPAM_TEXT_RE})`;
const EFFECTIVE_SENTIMENT = sql`coalesce(o.sentiment, m.sentiment_pred)`;

export function resolveWindow(
  f: FeedFilters,
  historyDays: number,
  now = simNow(),
): { from: Date; to: Date } {
  const floor = new Date(now.getTime() - historyDays * 86_400_000);
  let from: Date;
  let to = now;
  if (f.range === "custom" && f.from) {
    from = new Date(`${f.from}T00:00:00Z`);
    if (f.to) to = new Date(Math.min(now.getTime(), new Date(`${f.to}T23:59:59.999Z`).getTime()));
  } else {
    from = new Date(
      now.getTime() - (RANGE_DAYS[f.range as keyof typeof RANGE_DAYS] ?? 30) * 86_400_000,
    );
  }
  return { from: from < floor ? floor : from, to };
}

export async function workspaceQueries(workspaceId: string) {
  return db
    .select({
      id: queries.id,
      name: queries.name,
      status: queries.status,
      booleanText: queries.booleanText,
      backfillStatus: queries.backfillStatus,
    })
    .from(queries)
    .where(eq(queries.workspaceId, workspaceId));
}

/** WHERE clause over mentions m / authors a / mention_overrides o for a workspace's feed. */
export async function buildFeedWhere(opts: {
  workspaceId: string;
  filters: FeedFilters;
  historyDays: number;
  since: Date | null;
}) {
  const { workspaceId, filters: f } = opts;
  const qs = await workspaceQueries(workspaceId);
  const scoped = f.q ? qs.filter((q) => q.id === f.q) : qs;
  const win = resolveWindow(f, opts.historyDays);
  const parts: SQL[] = [
    scoped.length
      ? sql`m.id IN (SELECT mention_id FROM query_matches WHERE query_id IN (${sql.join(
          scoped.map((q) => sql`${q.id}::uuid`),
          sql`, `,
        )}))`
      : sql`FALSE`,
    sql`m.published_at >= ${win.from} AND m.published_at <= ${win.to}`,
  ];
  const inList = (col: SQL, v: string[]) =>
    parts.push(
      sql`${col} IN (${sql.join(
        v.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
  if (f.source.length)
    parts.push(
      sql`m.source_id IN (SELECT id FROM sources WHERE type IN (${sql.join(
        f.source.map((x) => sql`${x}`),
        sql`, `,
      )}))`,
    );
  if (f.sentiment.length) inList(EFFECTIVE_SENTIMENT, f.sentiment);
  if (f.lang.length) inList(sql`m.lang`, f.lang);
  if (f.country.length) inList(sql`m.country`, f.country);
  if (f.type.length) inList(sql`m.content_type`, f.type);
  if (f.tag.length)
    parts.push(
      sql`o.tags && ARRAY[${sql.join(
        f.tag.map((x) => sql`${x}`),
        sql`, `,
      )}]::text[]`,
    );
  if (f.author)
    parts.push(
      sql`(a.handle ILIKE ${"%" + f.author.replace(/[\\%_]/g, "\\$&") + "%"} OR a.display_name ILIKE ${"%" + f.author.replace(/[\\%_]/g, "\\$&") + "%"})`,
    );
  const band = FOLLOWER_BANDS.find((b) => b.id === f.followers);
  if (band)
    parts.push(
      sql`a.followers >= ${band.min}${band.max !== undefined ? sql` AND a.followers <= ${band.max}` : sql``}`,
    );
  if (f.media) parts.push(sql`m.has_media`);
  if (f.flagged) parts.push(sql`coalesce(o.flagged, false)`);
  if (opts.since) parts.push(sql`m.published_at > ${opts.since}`);
  let searchError: string | null = null;
  let terms: { value: string; wildcard: boolean }[] = [];
  if (f.search) {
    const a = analyze(f.search);
    if (a.ok && a.ast) {
      parts.push(compile(a.ast));
      terms = positiveTerms(a.ast);
    } else searchError = a.issues.find((i) => i.severity === "error")?.message ?? "Invalid search";
  }
  const spamPart =
    f.spam === "hide" ? sql`NOT ${SPAM_SQL}` : f.spam === "only" ? SPAM_SQL : sql`TRUE`;
  return {
    where: sql.join(parts, sql` AND `),
    spamPart,
    win,
    searchError,
    terms,
    queries: qs,
    scoped,
  };
}

const ORDER: Record<FeedFilters["sort"], SQL> = {
  newest: sql`m.published_at DESC, m.id DESC`,
  reach: sql`m.reach_est DESC, m.id DESC`,
  engagement: sql`(m.likes + m.shares + m.comments) DESC, m.id DESC`,
  negative: sql`(CASE ${EFFECTIVE_SENTIMENT} WHEN 'negative' THEN 0 WHEN 'mixed' THEN 1 ELSE 2 END), m.sentiment_conf DESC, m.id DESC`,
};

const FROM = (workspaceId: string) => sql`
  FROM mentions m
  JOIN authors a ON a.id = m.author_id
  JOIN sources s ON s.id = m.source_id
  LEFT JOIN mention_overrides o ON o.workspace_id = ${workspaceId}::uuid AND o.mention_id = m.id`;

export async function loadFeed(opts: {
  workspaceId: string;
  userId: string;
  filters: FeedFilters;
  historyDays: number;
  markSeen?: boolean;
  limit?: number;
}): Promise<FeedResult> {
  const { workspaceId, userId, filters: f } = opts;
  const [mem] = await db
    .select({ seen: memberships.feedSeenAt, since: memberships.feedSinceAt })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  // A new visit begins after VISIT_GAP_MS of inactivity; "unread" is measured from the previous visit's last activity.
  const now = Date.now();
  const newVisit = !mem?.seen || now - mem.seen.getTime() > VISIT_GAP_MS;
  const since = newVisit ? (mem?.seen ?? null) : (mem?.since ?? null);
  const base = await buildFeedWhere({
    workspaceId,
    filters: f,
    historyDays: opts.historyDays,
    since: f.since === "last" ? since : null,
  });
  const where = sql`${base.where} AND ${base.spamPart}`;
  const limit = opts.limit ?? f.size;
  const offset = opts.limit ? 0 : (f.page - 1) * f.size;

  const [rowsRes, countRes, spamRes] = await Promise.all([
    db.execute(sql`
      SELECT m.id, m.title, m.text, m.published_at, m.lang, m.country, m.city, s.type AS source_type, s.display_name AS source_name,
             m.content_type, a.handle, a.display_name, a.followers, a.verified, a.author_type, m.likes, m.shares, m.comments, m.views,
             m.reach_est, m.sentiment_pred, o.sentiment AS override_sentiment, m.sentiment_conf, m.emotion_pred, m.topics,
             coalesce(o.tags, '{}') AS tags, coalesce(o.flagged, false) AS flagged, m.has_media, m.media_alt, m.url,
             (a.bot_score >= ${SPAM_BOT_SCORE} OR m.text ~* ${SPAM_TEXT_RE}) AS likely_spam
      ${FROM(workspaceId)} WHERE ${where} ORDER BY ${ORDER[f.sort]} LIMIT ${limit} OFFSET ${offset}`),
    db.execute(
      sql`SELECT count(*)::int AS n FROM (SELECT 1 ${FROM(workspaceId)} WHERE ${where} LIMIT ${COUNT_CAP + 1}) c`,
    ),
    f.spam === "hide"
      ? db.execute(
          sql`SELECT count(*)::int AS n FROM (SELECT 1 ${FROM(workspaceId)} WHERE ${base.where} AND ${SPAM_SQL} LIMIT ${COUNT_CAP + 1}) c`,
        )
      : Promise.resolve({ rows: [{ n: 0 }] }),
  ]);

  const rows: FeedRow[] = (rowsRes.rows as Record<string, unknown>[]).map((r) => {
    const published = new Date(r.published_at as string);
    return {
      id: Number(r.id),
      title: (r.title as string | null) ?? null,
      text: String(r.text),
      publishedAt: published.toISOString(),
      lang: String(r.lang),
      country: String(r.country),
      city: String(r.city),
      sourceType: String(r.source_type),
      sourceName: String(r.source_name),
      contentType: String(r.content_type),
      author: {
        handle: String(r.handle),
        name: String(r.display_name),
        followers: Number(r.followers),
        verified: Boolean(r.verified),
        type: String(r.author_type),
      },
      likes: Number(r.likes),
      shares: Number(r.shares),
      comments: Number(r.comments),
      views: Number(r.views),
      reach: Number(r.reach_est),
      sentiment: String(r.override_sentiment ?? r.sentiment_pred),
      predicted: String(r.sentiment_pred),
      overridden: r.override_sentiment != null,
      confidence: Number(r.sentiment_conf),
      emotion: String(r.emotion_pred),
      topics: (r.topics as string[]) ?? [],
      tags: (r.tags as string[]) ?? [],
      flagged: Boolean(r.flagged),
      hasMedia: Boolean(r.has_media),
      mediaAlt: (r.media_alt as string | null) ?? null,
      likelySpam: Boolean(r.likely_spam),
      url: String(r.url),
      unread: since ? published > since : false,
    };
  });

  // Terms for highlighting: the scoped queries' positive terms plus any free-text search.
  const termSet = new Map<string, { value: string; wildcard: boolean }>();
  for (const q of base.scoped) {
    const a = analyze(q.booleanText);
    if (a.ast) for (const t of positiveTerms(a.ast)) termSet.set(`${t.value}|${t.wildcard}`, t);
  }
  for (const t of base.terms) termSet.set(`${t.value}|${t.wildcard}`, t);

  if (opts.markSeen) {
    await db
      .update(memberships)
      .set({ feedSeenAt: new Date(), feedSinceAt: since })
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  }
  const n = (countRes.rows[0] as { n: number }).n;
  return {
    rows,
    total: Math.min(n, COUNT_CAP),
    capped: n > COUNT_CAP,
    hiddenSpam: (spamRes.rows[0] as { n: number }).n,
    terms: [...termSet.values()],
    queries: base.queries.map(({ id, name, status }) => ({ id, name, status })),
    collecting: base.queries.some(
      (q) =>
        q.status === "live" && (q.backfillStatus === "pending" || q.backfillStatus === "running"),
    ),
    since: since?.toISOString() ?? null,
    searchError: base.searchError,
    loadedAt: new Date().toISOString(),
    window: { from: base.win.from.toISOString(), to: base.win.to.toISOString() },
  };
}

/** Which of these mention ids belong to the workspace's feed? Guards every write. */
export async function ownedMentionIds(workspaceId: string, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const qs = await db
    .select({ id: queries.id })
    .from(queries)
    .where(eq(queries.workspaceId, workspaceId));
  if (!qs.length) return [];
  const r = await db.execute(sql`
    SELECT DISTINCT mention_id FROM query_matches
    WHERE query_id IN (${sql.join(
      qs.map((q) => sql`${q.id}::uuid`),
      sql`, `,
    )}) AND mention_id IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )})`);
  return (r.rows as { mention_id: string | number }[]).map((x) => Number(x.mention_id));
}
