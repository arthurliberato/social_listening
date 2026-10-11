// The evaluator (spec 15): scores a run against the corpus's own ground truth. It reads the database and the case
// truth; agents never see either. Metrics are plain counts so a score can always be re-derived by hand.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { CaseTruth, Deliverable, PublicCase } from "./types";

export interface Evaluation {
  case_id: string;
  query: {
    matched: number;
    true_positive: number;
    precision: number;
    recall: number;
    f1: number;
    spam_share: number;
    truth_total: number;
  };
  sentiment: {
    overrides: number;
    override_accuracy: number | null;
    classifier_accuracy_on_same: number | null;
  };
  deliverable: {
    total_error_pct: number;
    negative_share_error_pp: number;
    findings: number;
    recommendations: number;
    mentions_brand: boolean;
    rubric_pass: boolean;
  };
  categories: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function evaluate(o: {
  assignment: PublicCase;
  truth: CaseTruth;
  queryId: string;
  deliverable: Deliverable;
  categories: number;
}): Promise<Evaluation> {
  const q = (
    await db.execute(
      sql`SELECT released_through, workspace_id FROM queries WHERE id = ${o.queryId}`,
    )
  ).rows[0] as { released_through: string; workspace_id: string };
  const to = new Date(q.released_through);
  const from = new Date(to.getTime() - o.assignment.window_days * 86_400_000);
  const brand = (await db.execute(sql`SELECT id FROM brands WHERE name = ${o.truth.brand}`))
    .rows[0] as { id: number };

  const agent = (
    await db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE m.brand_id = ${brand.id} AND NOT m.is_spam)::int AS tp,
             count(*) FILTER (WHERE m.is_spam)::int AS spam
      FROM query_matches qm JOIN mentions m ON m.id = qm.mention_id
      WHERE qm.query_id = ${o.queryId} AND m.published_at >= ${from} AND m.published_at < ${to}`)
  ).rows[0] as { n: number; tp: number; spam: number };
  const truth = (
    await db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE sentiment_true = 'negative')::int AS neg
      FROM mentions WHERE brand_id = ${brand.id} AND NOT is_spam AND published_at >= ${from} AND published_at < ${to}`)
  ).rows[0] as { n: number; neg: number };
  const precision = agent.n ? agent.tp / agent.n : 0;
  const recall = truth.n ? agent.tp / truth.n : 0;

  const ov = (
    await db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE o.sentiment = m.sentiment_true)::int AS agent_ok,
             count(*) FILTER (WHERE m.sentiment_pred = m.sentiment_true)::int AS clf_ok
      FROM mention_overrides o JOIN mentions m ON m.id = o.mention_id
      WHERE o.workspace_id = ${q.workspace_id} AND o.sentiment IS NOT NULL`)
  ).rows[0] as { n: number; agent_ok: number; clf_ok: number };

  const d = o.deliverable;
  const truthNeg = truth.n ? Math.round((100 * truth.neg) / truth.n) : 0;
  const text = [d.title, ...d.findings, ...d.recommendations].join(" ").toLowerCase();
  const mentionsBrand = text.includes(o.truth.brand.toLowerCase());
  const pass =
    (!o.truth.rubric.mentions_brand || mentionsBrand) &&
    d.findings.length >= o.truth.rubric.min_findings &&
    d.recommendations.length >= o.truth.rubric.min_recommendations;
  return {
    case_id: o.assignment.id,
    query: {
      matched: agent.n,
      true_positive: agent.tp,
      precision: r3(precision),
      recall: r3(recall),
      f1: r3(precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
      spam_share: r3(agent.n ? agent.spam / agent.n : 0),
      truth_total: truth.n,
    },
    sentiment: {
      overrides: ov.n,
      override_accuracy: ov.n ? r3(ov.agent_ok / ov.n) : null,
      classifier_accuracy_on_same: ov.n ? r3(ov.clf_ok / ov.n) : null,
    },
    deliverable: {
      total_error_pct: truth.n ? r3((100 * Math.abs(d.numbers.total - truth.n)) / truth.n) : 0,
      negative_share_error_pp: Math.abs(d.numbers.negative_share - truthNeg),
      findings: d.findings.length,
      recommendations: d.recommendations.length,
      mentions_brand: mentionsBrand,
      rubric_pass: pass,
    },
    categories: o.categories,
  };
}
