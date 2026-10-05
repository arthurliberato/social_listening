// The AI features, end to end: check the plan and allowance, gather evidence, ask the provider,
// and refuse to return anything that isn't properly cited. Failures never cost a unit.
import { desc, eq } from "drizzle-orm";
import { aiAnswers, db } from "@/db/client";
import { analyze } from "@/lib/query/lint";
import { getProvider, type AiProvider, type Evidence } from "./provider";
import { refundAiUnit, takeAiUnit } from "./quota";
import { parseQuestion, retrieve } from "./retrieve";
import type { PlanTier } from "@/lib/entitlements/plans";

import { MAX_QUESTION, MIN_CITATIONS } from "./limits";
export { MAX_QUESTION, MIN_CITATIONS };

export type AiFailure =
  | "quota_exhausted"
  | "no_evidence"
  | "provider_error"
  | "invalid_answer"
  | "empty"
  | "too_long"
  | "no_queries";

export const FAILURE_MESSAGE: Record<AiFailure, string> = {
  quota_exhausted: "You've used this month's AI questions.",
  no_evidence:
    "There aren't enough mentions in your queries to answer that with citations, so nothing was counted against your allowance. Try a wider time range or different wording.",
  provider_error:
    "The AI service didn't respond. Nothing was counted against your allowance. Please try again in a moment.",
  invalid_answer:
    "The answer didn't meet our citation standard, so it wasn't shown and nothing was counted. Please try again.",
  empty: "Type a question first.",
  too_long: `Keep questions under ${MAX_QUESTION} characters.`,
  no_queries:
    "Create and run a query first. AI answers are drawn from the mentions your queries collect.",
};

export interface Citation {
  n: number;
  mentionId: number;
  excerpt: string;
  author: string;
  source: string;
  publishedAt: string;
}

export interface AiResult {
  ok: true;
  id: string;
  kind: "ask" | "summary" | "peak";
  answer: string;
  citations: Citation[];
  scope: string;
  provider: string;
  latencyMs: number;
  remaining: number;
}
export interface AiFail {
  ok: false;
  failure: AiFailure;
  error: string;
  remaining?: number;
}
export type AiOutcome = AiResult | AiFail;

const fail = (failure: AiFailure, remaining?: number): AiFail => ({
  ok: false,
  failure,
  error: FAILURE_MESSAGE[failure],
  remaining,
});

/** The distinct evidence numbers an answer actually cites, e.g. "[2]". Unknown numbers don't count. */
export function citedNumbers(answer: string, evidence: Evidence[]): number[] {
  const valid = new Set(evidence.map((e) => e.n));
  return [...new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))].filter((n) =>
    valid.has(n),
  );
}

export interface Ctx {
  workspaceId: string;
  accountId: string;
  userId: string;
  tier: PlanTier;
  historyDays: number;
  /** Injectable for tests; the simulated provider by default. */
  provider?: AiProvider;
}

interface Job {
  kind: "ask" | "summary" | "peak";
  prompt: string;
  queryId?: string;
  terms?: string[];
  sentiment?: "negative" | "positive" | null;
  days?: number;
  windowLabel?: string;
  from?: Date;
  to?: Date;
  /** Wider windows to try, in order, when the first one has too few mentions to cite. */
  widen?: { from: Date; to: Date; label: string }[];
}

async function produce(ctx: Ctx, job: Job): Promise<AiOutcome> {
  const taken = await takeAiUnit(ctx.accountId, ctx.tier);
  if (taken === null) return fail("quota_exhausted", 0);
  const started = Date.now();
  try {
    const attempts = [
      { from: job.from, to: job.to, windowLabel: job.windowLabel },
      ...(job.widen ?? []).map((w) => ({ from: w.from, to: w.to, windowLabel: w.label })),
    ];
    let r = null;
    for (const a of attempts) {
      r = await retrieve({
        workspaceId: ctx.workspaceId,
        historyDays: ctx.historyDays,
        queryId: job.queryId,
        terms: job.terms,
        sentiment: job.sentiment,
        days: job.days,
        windowLabel: a.windowLabel,
        from: a.from,
        to: a.to,
      });
      if (!r || r.evidence.length >= MIN_CITATIONS) break;
    }
    if (!r) {
      await refundAiUnit(ctx.accountId);
      return fail("no_queries", taken + 1);
    }
    if (r.evidence.length < MIN_CITATIONS) {
      await refundAiUnit(ctx.accountId);
      return fail("no_evidence", taken + 1);
    }
    const provider = ctx.provider ?? getProvider();
    const answer = await provider.answer({
      kind: job.kind,
      prompt: job.prompt,
      scope: r.scope,
      evidence: r.evidence,
      stats: r.stats,
    });
    const cited = citedNumbers(answer, r.evidence);
    if (cited.length < MIN_CITATIONS) {
      await refundAiUnit(ctx.accountId);
      return fail("invalid_answer", taken + 1);
    }
    const citations: Citation[] = cited
      .sort((a, b) => a - b)
      .map((n) => {
        const e = r.evidence.find((x) => x.n === n)!;
        return {
          n,
          mentionId: e.mentionId,
          excerpt: e.text.replace(/\s+/g, " ").slice(0, 200),
          author: e.author,
          source: e.source,
          publishedAt: e.publishedAt,
        };
      });
    const latencyMs = Date.now() - started;
    const [row] = await db
      .insert(aiAnswers)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        kind: job.kind,
        prompt: job.prompt,
        answer,
        citations,
        provider: provider.id,
        latencyMs,
      })
      .returning({ id: aiAnswers.id });
    return {
      ok: true,
      id: row!.id,
      kind: job.kind,
      answer,
      citations,
      scope: r.scope,
      provider: provider.id,
      latencyMs,
      remaining: taken,
    };
  } catch {
    await refundAiUnit(ctx.accountId);
    return fail("provider_error", taken + 1);
  }
}

export async function askQuestion(ctx: Ctx, question: string): Promise<AiOutcome> {
  const q = question.trim();
  if (!q) return fail("empty");
  if (q.length > MAX_QUESTION) return fail("too_long");
  const intent = parseQuestion(q);
  return produce(ctx, {
    kind: "ask",
    prompt: q,
    terms: intent.terms,
    sentiment: intent.sentiment,
    days: intent.days,
    windowLabel: intent.windowLabel,
  });
}

/** Summarise a query's mentions over a window (used from the crisis room). */
export async function summarize(
  ctx: Ctx,
  o: { queryId: string; from: Date; to: Date; label: string },
): Promise<AiOutcome> {
  return produce(ctx, {
    kind: "summary",
    prompt: `Summarise ${o.label}`,
    queryId: o.queryId,
    from: o.from,
    to: o.to,
    days: 30,
    windowLabel: o.label,
  });
}

/** Explain a peak: the mentions around the busiest hour, most visible first. */
export async function explainPeak(
  ctx: Ctx,
  o: { queryId: string; peakHour: Date },
): Promise<AiOutcome> {
  const t = o.peakHour.getTime();
  const H = 3_600_000;
  // Start tight (the hours around the peak). A quiet brand's busiest hour may hold only a mention or two, so
  // widen to the day, then the days around it, rather than refusing: the answer says which window it used.
  return produce(ctx, {
    kind: "peak",
    prompt: "Explain the peak",
    queryId: o.queryId,
    from: new Date(t - H),
    to: new Date(t + 2 * H),
    days: 30,
    windowLabel: "the hours around the peak",
    widen: [
      { from: new Date(t - 6 * H), to: new Date(t + 12 * H), label: "the day around the peak" },
      { from: new Date(t - 24 * H), to: new Date(t + 48 * H), label: "the days around the peak" },
    ],
  });
}

export async function recentAnswers(workspaceId: string, kind: "ask" | "summary" | "peak", n = 10) {
  return db
    .select()
    .from(aiAnswers)
    .where(eq(aiAnswers.workspaceId, workspaceId))
    .orderBy(desc(aiAnswers.createdAt))
    .limit(n * 3)
    .then((r) => r.filter((x) => x.kind === kind).slice(0, n));
}

// ---------------------------------------------------------------------------------------------
// Query writer: plain words in, Boolean text out. The result is run through the real parser and
// linter before it is returned, so the AI can never hand back a query the builder would reject.

export interface WrittenQuery {
  ok: true;
  booleanText: string;
  explanation: string;
  remaining: number;
  latencyMs: number;
}

/** Deterministic rewrite: quoted phrases and keywords become OR-groups; "not/without/exclude X" become NOTs. */
export function draftBoolean(description: string): { text: string; explanation: string } {
  const d = description.trim();
  const quoted = [...d.matchAll(/"([^"]{2,60})"/g)].map((m) => m[1]!.trim());
  let rest = d.replace(/"[^"]*"/g, " ");
  const ex: string[] = [];
  rest = rest.replace(
    /\b(?:not|without|excluding|exclude|except|ignore|no)\s+([a-z0-9#@' ,-]{2,60}?)(?=\s+but\b|[.;]|$)/gi,
    (_m, g: string) => {
      for (const w of g.split(/\s*(?:,|\bor\b|\band\b)\s*/i)) if (w.trim()) ex.push(w.trim());
      return " ";
    },
  );
  const FILLER =
    /\b(find|show|me|mentions?|posts?|about|of|that|which|talk|talking|mention|mentioning|people|where|the|a|an|and|or|for|with|in|on|to|all|any|every|related|but)\b/gi;
  const words = rest
    .replace(FILLER, " ")
    .split(/[\s,;]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}#@_-]/gu, ""))
    .filter((w) => w.length >= 2);
  const any = [...new Set([...quoted, ...words])];
  const q = (t: string) => (/^[#@]?[\p{L}\p{N}_-]+$/u.test(t) ? t : `"${t.replace(/"/g, "")}"`);
  const pos = any.length === 1 ? q(any[0]!) : `(${any.map(q).join(" OR ")})`;
  const exs = [...new Set(ex)];
  const neg = exs.length ? ` NOT (${exs.map(q).join(" OR ")})` : "";
  return {
    text: any.length ? `${pos}${neg}` : "",
    explanation: any.length
      ? `Matches any of ${any.join(", ")}${exs.length ? `, and leaves out ${exs.join(", ")}` : ""}.`
      : "",
  };
}

export async function writeQuery(ctx: Ctx, description: string): Promise<WrittenQuery | AiFail> {
  const d = description.trim();
  if (!d) return fail("empty");
  if (d.length > MAX_QUESTION) return fail("too_long");
  const taken = await takeAiUnit(ctx.accountId, ctx.tier);
  if (taken === null) return fail("quota_exhausted", 0);
  const started = Date.now();
  const draft = draftBoolean(d);
  if (!draft.text || !analyze(draft.text).ok) {
    await refundAiUnit(ctx.accountId);
    return {
      ok: false,
      failure: "invalid_answer",
      error:
        "Couldn't turn that into a valid query, so nothing was counted. Try naming a few specific words or phrases.",
      remaining: taken + 1,
    };
  }
  return {
    ok: true,
    booleanText: draft.text,
    explanation: draft.explanation,
    remaining: taken,
    latencyMs: Date.now() - started,
  };
}
