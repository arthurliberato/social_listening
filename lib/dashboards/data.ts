import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { detectSpikes } from "@/lib/analytics/spikes";
import { buildFeedWhere, EFFECTIVE_SENTIMENT, FROM } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";
import { SPAM_BOT_SCORE, SPAM_TEXT_RE } from "@/lib/query/spam";
import type { WidgetConfig, WidgetType } from "./catalog";

import {
  COUNTRY_NAMES,
  type DayPoint,
  type Period,
  type WidgetData,
  type WidgetPayload,
} from "./types";

export interface DataCtx {
  workspaceId: string;
  historyDays: number;
  /** Global dashboard filter, as feed URL params (range / from / to). */
  range: URLSearchParams;
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Every day from..to inclusive, so charts show gaps as zeros rather than skipping them. */
function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (
    let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    t <= to.getTime();
    t += DAY
  )
    out.push(isoDay(new Date(t)));
  return out;
}
const fill = (days: string[], rows: Map<string, number>): DayPoint[] =>
  days.map((day) => ({ day, value: rows.get(day) ?? 0 }));

async function scope(ctx: DataCtx, cfg: WidgetConfig, win?: { from: Date; to: Date }) {
  const params = new URLSearchParams(ctx.range);
  if (cfg.queryId) params.set("q", cfg.queryId);
  const filters = parseFilters(params);
  const base = await buildFeedWhere({
    workspaceId: ctx.workspaceId,
    filters,
    historyDays: ctx.historyDays,
    since: null,
    window: win,
  });
  // Same rule as the feed: likely spam is hidden, so dashboard numbers match what drill-down shows.
  return {
    where: sql`${base.where} AND ${base.spamPart}`,
    win: base.win,
    names: base.scoped.map((q) => q.name),
    liveIds: base.queries.filter((q) => q.status === "live").map((q) => q.id),
  };
}

const rowsOf = async <T>(q: SQL) => (await db.execute(q)).rows as T[];
const DAYCOL = sql`to_char(m.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
const SENT_SCORE = sql`(CASE ${EFFECTIVE_SENTIMENT} WHEN 'positive' THEN 1 WHEN 'negative' THEN -1 ELSE 0 END)`;

async function dailyMetric(
  ctx: DataCtx,
  cfg: WidgetConfig,
  win: { from: Date; to: Date },
  metric: string,
) {
  const s = await scope(ctx, cfg, win);
  const expr =
    metric === "reach"
      ? sql`sum(m.reach_est)`
      : metric === "engagement"
        ? sql`sum(m.likes + m.shares + m.comments)`
        : metric === "net_sentiment"
          ? sql`sum(${SENT_SCORE})`
          : sql`count(*)`;
  const rows = await rowsOf<{ day: string; v: string; n: string }>(
    sql`SELECT ${DAYCOL} AS day, ${expr}::float8 AS v, count(*)::int AS n ${FROM(ctx.workspaceId)} WHERE ${s.where} GROUP BY 1 ORDER BY 1`,
  );
  return { s, rows };
}

const pct = (cur: number, prev: number) =>
  prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
const LABEL: Record<string, string> = {
  mentions: "Mentions",
  reach: "Est. reach",
  net_sentiment: "Net sentiment",
  engagement: "Engagement",
  share_of_voice: "Share of voice",
};

export async function loadWidget(
  ctx: DataCtx,
  type: WidgetType,
  cfg: WidgetConfig,
): Promise<WidgetPayload> {
  const s0 = await scope(ctx, cfg);
  const win = s0.win;
  const days = eachDay(win.from, win.to);
  const period: Period = {
    from: win.from.toISOString(),
    to: win.to.toISOString(),
    days: days.length,
  };
  const done = (data: WidgetData, names = s0.names): WidgetPayload => ({
    data,
    period,
    scope: names,
  });
  const from = FROM(ctx.workspaceId);
  const topN = Math.max(3, Math.min(20, cfg.topN ?? 8));

  switch (type) {
    case "kpi": {
      const metric = cfg.metric ?? "mentions";
      const len = win.to.getTime() - win.from.getTime();
      const prevWin = {
        from: new Date(win.from.getTime() - len),
        to: new Date(win.from.getTime() - 1),
      };
      if (metric === "share_of_voice") {
        const sov = await shareOfVoice(ctx, win);
        const mine = sov.rows.find((r) => r.queryId === (cfg.queryId ?? sov.rows[0]?.queryId));
        const prev = await shareOfVoice(ctx, prevWin);
        const was = prev.rows.find((r) => r.queryId === mine?.queryId)?.share ?? 0;
        return done(
          {
            kind: "kpi",
            metric,
            label: LABEL[metric]!,
            value: mine?.share ?? 0,
            previous: was,
            deltaPct: mine ? Math.round((mine.share - was) * 10) / 10 : null,
            format: "percent",
            spark: [],
          },
          mine ? [mine.name] : [],
        );
      }
      const [cur, prev] = await Promise.all([
        dailyMetric(ctx, cfg, win, metric),
        dailyMetric(ctx, cfg, prevWin, metric),
      ]);
      const sum = (r: { v: string; n: string }[]) => r.reduce((a, x) => a + Number(x.v), 0);
      const total = (r: { n: string }[]) => r.reduce((a, x) => a + Number(x.n), 0);
      let value = sum(cur.rows),
        previous = sum(prev.rows);
      if (metric === "net_sentiment") {
        value = total(cur.rows) ? Math.round((value / total(cur.rows)) * 1000) / 10 : 0;
        previous = total(prev.rows) ? Math.round((previous / total(prev.rows)) * 1000) / 10 : 0;
      }
      const byDay = new Map(
        cur.rows.map((r) => [
          r.day,
          metric === "net_sentiment" && Number(r.n)
            ? (Number(r.v) / Number(r.n)) * 100
            : Number(r.v),
        ]),
      );
      const spark = fill(days, byDay)
        .slice(-14)
        .map((p) => p.value);
      const isNet = metric === "net_sentiment";
      return done({
        kind: "kpi",
        metric,
        label: LABEL[metric] ?? metric,
        value,
        previous,
        deltaPct: isNet ? Math.round((value - previous) * 10) / 10 : pct(value, previous),
        format: isNet ? "points" : "count",
        spark,
      });
    }
    case "volume": {
      const metric = cfg.metric ?? "mentions";
      const { rows } = await dailyMetric(ctx, cfg, win, metric);
      const series = fill(days, new Map(rows.map((r) => [r.day, Number(r.v)])));
      const counts =
        metric === "mentions"
          ? series
          : fill(
              days,
              new Map(
                (await dailyMetric(ctx, cfg, win, "mentions")).rows.map((r) => [
                  r.day,
                  Number(r.v),
                ]),
              ),
            );
      return done({
        kind: "volume",
        metric,
        label: LABEL[metric] ?? metric,
        days: series,
        total: series.reduce((a, p) => a + p.value, 0),
        spikes: detectSpikes(counts),
      });
    }
    case "sentiment_area": {
      const rows = await rowsOf<{ day: string; sentiment: string; n: number }>(
        sql`SELECT ${DAYCOL} AS day, ${EFFECTIVE_SENTIMENT} AS sentiment, count(*)::int AS n ${from} WHERE ${s0.where} GROUP BY 1, 2`,
      );
      const map = new Map<string, Record<string, number>>();
      for (const r of rows) (map.get(r.day) ?? map.set(r.day, {}).get(r.day)!)[r.sentiment] = r.n;
      const out = days.map((day) => ({
        day,
        positive: map.get(day)?.positive ?? 0,
        neutral: map.get(day)?.neutral ?? 0,
        negative: map.get(day)?.negative ?? 0,
        mixed: map.get(day)?.mixed ?? 0,
      }));
      return done({ kind: "sentiment_area", days: out, total: rows.reduce((a, r) => a + r.n, 0) });
    }
    case "sentiment_donut": {
      const rows = await rowsOf<{ sentiment: string; n: number }>(
        sql`SELECT ${EFFECTIVE_SENTIMENT} AS sentiment, count(*)::int AS n ${from} WHERE ${s0.where} GROUP BY 1`,
      );
      const order = ["positive", "neutral", "negative", "mixed"];
      return done({
        kind: "sentiment_donut",
        total: rows.reduce((a, r) => a + r.n, 0),
        parts: order.map((sentiment) => ({
          sentiment,
          count: rows.find((r) => r.sentiment === sentiment)?.n ?? 0,
        })),
      });
    }
    case "bar": {
      const breakdown = cfg.breakdown ?? "source";
      const col = {
        source: sql`s.type`,
        country: sql`m.country`,
        language: sql`m.lang`,
        type: sql`m.content_type`,
      }[breakdown];
      const rows = await rowsOf<{ k: string; n: number }>(
        sql`SELECT ${col} AS k, count(*)::int AS n ${from} WHERE ${s0.where} GROUP BY 1 ORDER BY n DESC`,
      );
      const total = rows.reduce((a, r) => a + r.n, 0);
      const label = (k: string) => (breakdown === "country" ? (COUNTRY_NAMES[k] ?? k) : k);
      const top = rows.slice(0, topN).map((r) => ({ key: r.k, label: label(r.k), count: r.n }));
      const rest = rows.slice(topN).reduce((a, r) => a + r.n, 0);
      return done({
        kind: "bar",
        breakdown,
        label: { source: "Source", country: "Country", language: "Language", type: "Content type" }[
          breakdown
        ],
        total,
        rows: rest ? [...top, { key: "other", label: "Other", count: rest }] : top,
      });
    }
    case "share_of_voice": {
      const r = await shareOfVoice(ctx, win);
      return done(
        { kind: "share_of_voice", total: r.total, rows: r.rows },
        r.rows.map((x) => x.name),
      );
    }
    case "topic_cloud": {
      const rows = await rowsOf<{ topic: string; n: number }>(
        sql`SELECT t AS topic, count(*)::int AS n ${from}, unnest(m.topics) AS t WHERE ${s0.where} GROUP BY 1 ORDER BY n DESC, t LIMIT ${Math.max(topN, 12)}`,
      );
      return done({ kind: "topic_cloud", rows: rows.map((r) => ({ topic: r.topic, count: r.n })) });
    }
    case "top_authors": {
      const rows = await rowsOf<{
        handle: string;
        name: string;
        source: string;
        mentions: number;
        reach: string;
        avg: number;
      }>(sql`
        SELECT a.handle, a.display_name AS name, s.type AS source, count(*)::int AS mentions, sum(m.reach_est)::float8 AS reach, avg(${SENT_SCORE})::float8 AS avg
        ${from} WHERE ${s0.where} GROUP BY a.id, a.handle, a.display_name, s.type ORDER BY sum(m.reach_est) DESC LIMIT ${topN}`);
      return done({
        kind: "top_authors",
        rows: rows.map((r) => ({
          handle: r.handle,
          name: r.name,
          source: r.source,
          mentions: r.mentions,
          reach: Number(r.reach),
          avgSentiment: Math.round(r.avg * 100) / 100,
        })),
      });
    }
    case "top_mentions": {
      const rows = await rowsOf<{
        id: string;
        text: string;
        title: string | null;
        author: string;
        source: string;
        reach: string;
        sentiment: string;
        at: string;
      }>(sql`
        SELECT m.id, m.text, m.title, a.display_name AS author, s.type AS source, m.reach_est AS reach, ${EFFECTIVE_SENTIMENT} AS sentiment, m.published_at AS at
        ${from} WHERE ${s0.where} ORDER BY m.reach_est DESC, m.id DESC LIMIT ${topN}`);
      return done({
        kind: "top_mentions",
        rows: rows.map((r) => ({
          id: Number(r.id),
          text: r.title ? `${r.title}. ${r.text}` : r.text,
          author: r.author,
          source: r.source,
          reach: Number(r.reach),
          sentiment: r.sentiment,
          publishedAt: new Date(r.at).toISOString(),
        })),
      });
    }
    case "geo": {
      const rows = await rowsOf<{ country: string; n: number }>(
        sql`SELECT m.country, count(*)::int AS n ${from} WHERE ${s0.where} GROUP BY 1 ORDER BY n DESC`,
      );
      return done({
        kind: "geo",
        total: rows.reduce((a, r) => a + r.n, 0),
        rows: rows.map((r) => ({
          country: r.country,
          name: COUNTRY_NAMES[r.country] ?? r.country,
          count: r.n,
        })),
      });
    }
    case "emotion": {
      const rows = await rowsOf<{ emotion: string; n: number }>(
        sql`SELECT m.emotion_pred AS emotion, count(*)::int AS n ${from} WHERE ${s0.where} GROUP BY 1 ORDER BY n DESC`,
      );
      return done({
        kind: "emotion",
        total: rows.reduce((a, r) => a + r.n, 0),
        rows: rows.map((r) => ({ emotion: r.emotion, count: r.n })),
      });
    }
    case "heatmap": {
      const rows = await rowsOf<{ dow: number; hour: number; n: number }>(sql`
        SELECT extract(dow FROM m.published_at AT TIME ZONE 'UTC')::int AS dow, extract(hour FROM m.published_at AT TIME ZONE 'UTC')::int AS hour, count(*)::int AS n
        ${from} WHERE ${s0.where} GROUP BY 1, 2`);
      return done({
        kind: "heatmap",
        total: rows.reduce((a, r) => a + r.n, 0),
        max: rows.reduce((a, r) => Math.max(a, r.n), 0),
        cells: rows.map((r) => ({ dow: r.dow, hour: r.hour, count: r.n })),
      });
    }
  }
}

/** Each live query's mentions as a share of all live queries' mentions (spam hidden, same window). */
async function shareOfVoice(ctx: DataCtx, win: { from: Date; to: Date }) {
  const base = await buildFeedWhere({
    workspaceId: ctx.workspaceId,
    filters: parseFilters(new URLSearchParams(ctx.range)),
    historyDays: ctx.historyDays,
    since: null,
    window: win,
  });
  const live = base.queries.filter((q) => q.status === "live");
  if (!live.length)
    return {
      total: 0,
      rows: [] as { queryId: string; name: string; count: number; share: number }[],
    };
  const rows = await rowsOf<{ query_id: string; n: number }>(sql`
    SELECT qm.query_id, count(*)::int AS n
    FROM query_matches qm JOIN mentions m ON m.id = qm.mention_id JOIN authors a ON a.id = m.author_id
    WHERE qm.query_id IN (${sql.join(
      live.map((q) => sql`${q.id}::uuid`),
      sql`, `,
    )}) AND m.published_at >= ${base.win.from} AND m.published_at <= ${base.win.to} AND NOT (a.bot_score >= ${SPAM_BOT_SCORE} OR m.text ~* ${SPAM_TEXT_RE})
    GROUP BY 1`);
  const total = rows.reduce((a, r) => a + r.n, 0);
  return {
    total,
    rows: live
      .map((q) => {
        const n = rows.find((r) => r.query_id === q.id)?.n ?? 0;
        return {
          queryId: q.id,
          name: q.name,
          count: n,
          share: total ? Math.round((n / total) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.count - a.count),
  };
}
