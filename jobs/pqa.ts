// Nightly scoring: compute PQA and health for every account, store the day's row (the warehouse's
// account time series), push the scores to Amplitude as account group properties, and tell sales
// about accounts that newly cross the PQA threshold.
import { eq, inArray, sql } from "drizzle-orm";
import { accounts, accountScores, db, memberships, users } from "@/db/client";
import { groupIdentifyAccount } from "@/lib/analytics/server";
import { sendEmail } from "@/lib/email/service";
import { health, pqa, PQA_THRESHOLD } from "@/lib/scoring/score";
import { gatherSignals } from "@/lib/scoring/signals";
import { simNow } from "@/lib/simclock";

export const SDR_ADDRESS = "sdr@ripplewise.test";
/** Don't ping sales about the same account more than once in this long. */
export const RENOTIFY_DAYS = 30;

export interface ScoreResult {
  accountId: string;
  pqa: number;
  health: number;
  band: string;
  sdrNotified: boolean;
}

export async function runNightlyScoring(
  now: Date = simNow(),
  only?: string[],
): Promise<ScoreResult[]> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(only ? inArray(accounts.id, only) : sql`true`);
  const day = now.toISOString().slice(0, 10);
  const out: ScoreResult[] = [];
  for (const { id } of rows) {
    const s = await gatherSignals(id, now);
    if (!s) continue;
    const p = pqa(s);
    const h = health(s);
    await db
      .insert(accountScores)
      .values({
        accountId: id,
        day,
        pqa: p.score,
        health: h.score,
        healthBand: h.band,
        signals: { ...s, pqaReasons: p.reasons, healthReasons: h.reasons },
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: [accountScores.accountId, accountScores.day],
        set: {
          pqa: p.score,
          health: h.score,
          healthBand: h.band,
          signals: { ...s, pqaReasons: p.reasons, healthReasons: h.reasons },
          computedAt: now,
        },
      });
    await groupIdentifyAccount(id, {
      pqa_score: p.score,
      health_score: h.score,
      health_band: h.band,
      plan_tier: s.tier,
      motion: s.motion,
      live_queries: s.liveQueries,
      seats_used: s.seatsUsed,
      active_users_14d: s.activeUsers14d,
      // Account-level product mix and Influencers depth, so cohorts can be cut by what an account actually uses.
      products_used: s.productsUsed.join(",") || "none",
      uses_both_products: s.productsUsed.length >= 2,
      creator_lists: s.creatorLists,
      active_campaigns: s.activeCampaigns,
      creator_profiles_pct: s.creatorProfilesPct,
      invitations_pct: s.invitationsPct,
    });
    const sdrNotified = p.eligible && p.score >= PQA_THRESHOLD && (await notifySdr(id, p, now));
    out.push({ accountId: id, pqa: p.score, health: h.score, band: h.band, sdrNotified });
  }
  return out;
}

async function notifySdr(
  accountId: string,
  p: ReturnType<typeof pqa>,
  now: Date,
): Promise<boolean> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const last = (a!.lifecycle as Record<string, string>).pqaAlertedAt;
  if (last && now.getTime() - new Date(last).getTime() < RENOTIFY_DAYS * 86_400_000) return false;
  // Claim first so two runs can't both send it.
  const claimed = await db.execute(sql`
    UPDATE accounts SET lifecycle = lifecycle || ${JSON.stringify({ pqaAlertedAt: now.toISOString() })}::jsonb
    WHERE id = ${accountId}::uuid
      AND (lifecycle->>'pqaAlertedAt' IS NOT DISTINCT FROM ${last ?? null})`);
  if (!claimed.rowCount) return false;
  const [owner] = await db
    .select({ name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(sql`${memberships.accountId} = ${accountId}::uuid AND ${memberships.role} = 'owner'`)
    .limit(1);
  await sendEmail({
    to: SDR_ADDRESS,
    type: "sales",
    subject: `Product-qualified account: ${a!.name} (PQA ${p.score})`,
    text: [
      `${a!.name} is on ${a!.planTier} (${a!.billingStatus}) and scored ${p.score}/100 for sales readiness.`,
      ``,
      `Why:`,
      ...p.reasons.map((r) => `- ${r}`),
      ``,
      owner ? `Owner: ${owner.name} <${owner.email}>` : `Owner: unknown`,
      ``,
      `They have been shown an in-app prompt to talk to sales; reach out only if they respond or it fits your outreach rules.`,
    ].join("\n"),
  });
  return true;
}
