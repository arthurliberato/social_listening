import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import { positiveTerms, stats } from "./ast";
import { compile, compileFilters, type Filters } from "./compile";
import { analyze, type Issue } from "./lint";
import { SPAM_BOT_SCORE, SPAM_TEXT_RE } from "./spam";

export const PREVIEW_WINDOW_DAYS = 30;
const COUNT_CAP = 100_000;
const NOISE_SAMPLE = 500;

export interface SampleMention {
  id: number;
  text: string;
  title: string | null;
  publishedAt: string;
  lang: string;
  country: string;
  sentiment: string;
  source: string;
  author: { handle: string; name: string; followers: number };
  likelySpam: boolean;
}

export type Preview =
  | { ok: false; issues: Issue[] }
  | {
      ok: true;
      issues: Issue[];
      windowDays: number;
      count: number;
      capped: boolean;
      /** Share of this query's monthly volume vs the plan's mention allowance, 0..1+ */
      quotaShare: number;
      noiseScore: number;
      noiseSampleSize: number;
      sample: SampleMention[];
      terms: { value: string; wildcard: boolean }[];
      stats: { operators: number; exclusions: number; hasNear: boolean };
      elapsedMs: number;
    };

export async function previewQuery(input: {
  booleanText: string;
  filters?: Filters;
  planTier: PlanTier;
}): Promise<Preview> {
  const t0 = performance.now();
  const analysis = analyze(input.booleanText);
  if (!analysis.ok || !analysis.ast) return { ok: false, issues: analysis.issues };

  const plan = limits(input.planTier);
  const end = simNow();
  const windowDays = Math.min(PREVIEW_WINDOW_DAYS, plan.historyDays);
  const start = new Date(end.getTime() - windowDays * 86_400_000);
  const where = sql`published_at >= ${start} AND published_at < ${end} AND ${compile(analysis.ast)} AND ${compileFilters(input.filters ?? {})}`;

  const [countRes, sampleRes, noiseRes] = await Promise.all([
    db.execute(
      sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM mentions WHERE ${where} LIMIT ${COUNT_CAP + 1}) c`,
    ),
    db.execute(sql`
      SELECT m.id, m.text, m.title, m.published_at, m.lang, m.country, m.sentiment_pred, s.type AS source,
             a.handle, a.display_name, a.followers, a.bot_score
      FROM mentions m JOIN authors a ON a.id = m.author_id JOIN sources s ON s.id = m.source_id
      WHERE ${where} ORDER BY m.published_at DESC LIMIT 20`),
    db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE a.bot_score >= ${SPAM_BOT_SCORE} OR m.text ~* ${SPAM_TEXT_RE})::int AS noisy
      FROM (SELECT author_id, text FROM mentions WHERE ${where} ORDER BY published_at DESC LIMIT ${NOISE_SAMPLE}) m
      JOIN authors a ON a.id = m.author_id`),
  ]);

  const n = (countRes.rows[0] as { n: number }).n;
  const noise = noiseRes.rows[0] as { n: number; noisy: number };
  const spamRe = new RegExp(SPAM_TEXT_RE, "i");
  const sample = (sampleRes.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    text: String(r.text),
    title: (r.title as string | null) ?? null,
    publishedAt: new Date(r.published_at as string).toISOString(),
    lang: String(r.lang),
    country: String(r.country),
    sentiment: String(r.sentiment_pred),
    source: String(r.source),
    author: {
      handle: String(r.handle),
      name: String(r.display_name),
      followers: Number(r.followers),
    },
    likelySpam: Number(r.bot_score) >= SPAM_BOT_SCORE || spamRe.test(String(r.text)),
  }));

  return {
    ok: true,
    issues: analysis.issues,
    windowDays,
    count: Math.min(n, COUNT_CAP),
    capped: n > COUNT_CAP,
    quotaShare: (Math.min(n, COUNT_CAP) * (30 / windowDays)) / plan.mentionsPerMonth,
    noiseScore: noise.n ? Math.round((noise.noisy / noise.n) * 100) / 100 : 0,
    noiseSampleSize: noise.n,
    sample,
    terms: positiveTerms(analysis.ast),
    stats: stats(analysis.ast),
    elapsedMs: Math.round(performance.now() - t0),
  };
}
