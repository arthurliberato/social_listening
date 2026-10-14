import { and, eq, sql } from "drizzle-orm";
import { analyticsEvents, db, surveyState, users } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { currentSessionId } from "@/lib/analytics/session";
import { simNow } from "@/lib/simclock";
import { SURVEY_ORDER, SURVEYS, type SurveyDefinition, type SurveyId } from "./definitions";
import { evaluateSurvey, type SurveyFacts, type SurveyHistory } from "./eligibility";

const EMPTY: SurveyHistory = { shownAt: null, answeredAt: null, dismissedAt: null };

export interface Ctx {
  userId: string;
  workspaceId: string;
}

async function loadFacts(userId: string): Promise<{ facts: SurveyFacts; open: SurveyId | null }> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const rows = await db.select().from(surveyState).where(eq(surveyState.userId, userId));
  const [{ n } = { n: 0 }] = (
    await db.execute(
      sql`SELECT count(DISTINCT props->>'session_id')::int AS n FROM ${analyticsEvents} WHERE user_id = ${userId} AND props->>'session_id' IS NOT NULL`,
    )
  ).rows as { n: number }[];
  const history = Object.fromEntries(SURVEY_ORDER.map((id) => [id, { ...EMPTY }])) as Record<
    SurveyId,
    SurveyHistory
  >;
  let open: SurveyId | null = null;
  const session = currentSessionId();
  for (const r of rows) {
    const id = r.surveyId as SurveyId;
    if (!(id in history)) continue;
    history[id] = { shownAt: r.shownAt, answeredAt: r.answeredAt, dismissedAt: r.dismissedAt };
    if (session && r.openSession === session && !r.answeredAt && !r.dismissedAt) open = id;
  }
  return {
    open,
    facts: {
      userId,
      now: simNow(),
      signupAt: u!.createdAt,
      onboardingCompletedAt: u!.onboardingCompletedAt,
      sessions: n,
      history,
    },
  };
}

export interface SurveyView {
  id: SurveyId;
  title: string;
  scale: SurveyDefinition["scale"];
  items: SurveyDefinition["items"];
}

const view = (d: SurveyDefinition): SurveyView => ({
  id: d.id,
  title: d.title,
  scale: d.scale,
  items: d.items,
});

/**
 * The survey to show this person right now, or null. A survey stays open for the rest of the visit until it is answered
 * or dismissed. Logs eligibility once per visit and survey, and `Survey Shown` the first time a survey appears.
 */
export async function surveyForVisit(ctx: Ctx): Promise<SurveyView | null> {
  const session = currentSessionId();
  if (!session) return null; // no browser visit (a job, a script): nobody to ask
  const { facts, open } = await loadFacts(ctx.userId);
  if (open) return view(SURVEYS[open]);
  const existing = await db.select().from(surveyState).where(eq(surveyState.userId, ctx.userId));
  const evaluatedIn = new Map(existing.map((r) => [r.surveyId, r.lastEvalSession]));
  let chosen: SurveyId | null = null;
  for (const id of SURVEY_ORDER) {
    const e = evaluateSurvey(id, facts);
    if (!e.triggered) continue;
    // Once chosen, later surveys in the order would only ever be "another survey recent": leave them for another visit.
    if (chosen) continue;
    if (evaluatedIn.get(id) !== session) {
      await upsert(ctx.userId, id, { lastEvalSession: session });
      await trackServer("Survey Eligibility Evaluated", ctx, {
        survey_id: id,
        eligible: e.eligible,
        reason: e.reason,
      });
    }
    if (e.eligible) chosen = id;
  }
  if (!chosen) return null;
  await upsert(ctx.userId, chosen, { shownAt: facts.now, openSession: session });
  await trackServer("Survey Shown", ctx, {
    survey_id: chosen,
    trigger: SURVEYS[chosen].trigger,
  });
  return view(SURVEYS[chosen]);
}

async function upsert(
  userId: string,
  surveyId: SurveyId,
  patch: Partial<typeof surveyState.$inferInsert>,
) {
  await db
    .insert(surveyState)
    .values({ userId, surveyId, ...patch })
    .onConflictDoUpdate({ target: [surveyState.userId, surveyState.surveyId], set: patch });
}

async function openRow(ctx: Ctx, surveyId: SurveyId) {
  const session = currentSessionId();
  const [row] = await db
    .select()
    .from(surveyState)
    .where(and(eq(surveyState.userId, ctx.userId), eq(surveyState.surveyId, surveyId)))
    .limit(1);
  if (!row || row.answeredAt || row.dismissedAt || !session || row.openSession !== session)
    return null;
  return row;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

/** Record the answers: one `Survey Item Answered` per question. Every question needs an answer inside the scale. */
export async function submitSurvey(
  ctx: Ctx,
  surveyId: SurveyId,
  answers: Record<string, number>,
): Promise<SubmitResult> {
  const def = SURVEYS[surveyId];
  const row = def && (await openRow(ctx, surveyId));
  if (!def || !row) return { ok: false, error: "This question is no longer open." };
  for (const item of def.items) {
    const v = answers[item.id];
    if (!Number.isInteger(v) || v! < def.scale.min || v! > def.scale.max)
      return { ok: false, error: "Please answer every question." };
  }
  const now = simNow();
  const seconds = row.shownAt
    ? Math.max(0, Math.round((now.getTime() - row.shownAt.getTime()) / 1000))
    : null;
  await upsert(ctx.userId, surveyId, { answeredAt: now, openSession: null });
  for (const [i, item] of def.items.entries())
    await trackServer("Survey Item Answered", ctx, {
      survey_id: surveyId,
      item_id: item.id,
      item_index: i + 1,
      response: answers[item.id]!,
      scale_min: def.scale.min,
      scale_max: def.scale.max,
      seconds_to_answer: seconds,
    });
  return { ok: true };
}

export async function dismissSurvey(ctx: Ctx, surveyId: SurveyId): Promise<void> {
  const row = SURVEYS[surveyId] && (await openRow(ctx, surveyId));
  if (!row) return;
  const now = simNow();
  await upsert(ctx.userId, surveyId, { dismissedAt: now, openSession: null });
  await trackServer("Survey Dismissed", ctx, {
    survey_id: surveyId,
    seconds_open: row.shownAt
      ? Math.max(0, Math.round((now.getTime() - row.shownAt.getTime()) / 1000))
      : null,
  });
}
