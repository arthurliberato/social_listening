"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { crises, db, queries } from "@/db/client";
import { requireWorkspace } from "@/lib/auth/session";
import { explainPeak, summarize, writeQuery, askQuestion, type Ctx } from "@/lib/ai/service";
import type { AiFail } from "@/lib/ai/service";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { accountPlan } from "@/lib/queries";

export interface Upgrade {
  planLabel: string;
  bullets: string[];
  priceLine?: string;
}

const ORDER: PlanTier[] = ["starter", "growth", "agency", "enterprise"];

/** The next plan up that actually raises the AI allowance. */
function upgradeFor(tier: PlanTier): Upgrade | undefined {
  const cur = PLANS[tier].askAiPerMonth;
  const next = ORDER.find((t) => PLANS[t].askAiPerMonth > cur);
  if (!next) return undefined;
  const p = PLANS[next];
  return {
    planLabel: p.label,
    priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
    bullets: [
      `${p.askAiPerMonth.toLocaleString()} AI questions per month (you have ${cur.toLocaleString()})`,
      `${p.activeQueries} active queries`,
      `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
    ],
  };
}

async function ctxFor(slug: string): Promise<{ ctx: Ctx } | { error: AiFail }> {
  const { user, ws } = await requireWorkspace(slug);
  if (ws.locked)
    return {
      error: {
        ok: false,
        failure: "quota_exhausted",
        error:
          "This account is read-only right now, so AI features are paused. Billing can restore access.",
      },
    };
  const { accountId, tier, plan } = await accountPlan(ws.id);
  return {
    ctx: { workspaceId: ws.id, accountId, userId: user.id, tier, historyDays: plan.historyDays },
  };
}

export type Out<T> = T | (AiFail & { upgrade?: Upgrade });

function withUpgrade<T extends { ok: boolean }>(r: T | AiFail, tier: PlanTier): Out<T> {
  return !r.ok && "failure" in r && r.failure === "quota_exhausted"
    ? { ...(r as AiFail), upgrade: upgradeFor(tier) }
    : (r as Out<T>);
}

export async function askAction(slug: string, question: string) {
  const c = await ctxFor(slug);
  if ("error" in c) return c.error;
  const r = await askQuestion(c.ctx, question);
  revalidatePath(`/w/${slug}/ask`);
  return withUpgrade(r, c.ctx.tier);
}

export async function summaryAction(slug: string, crisisId: string) {
  const c = await ctxFor(slug);
  if ("error" in c) return c.error;
  const [room] = await db.select().from(crises).where(eq(crises.id, crisisId));
  if (!room || room.workspaceId !== c.ctx.workspaceId)
    return {
      ok: false,
      failure: "no_queries",
      error: "That crisis room no longer exists.",
    } as AiFail;
  const to = new Date(Math.min(Date.now(), room.windowStart.getTime() + 7 * 86_400_000));
  const [q] = await db.select().from(queries).where(eq(queries.id, room.queryId));
  const end = q?.releasedThrough && q.releasedThrough < to ? q.releasedThrough : to;
  return withUpgrade(
    await summarize(c.ctx, {
      queryId: room.queryId,
      from: room.windowStart,
      to: end,
      label: "this crisis room's window",
    }),
    c.ctx.tier,
  );
}

export async function peakAction(slug: string, crisisId: string, peakHour: number) {
  const c = await ctxFor(slug);
  if ("error" in c) return c.error;
  const [room] = await db.select().from(crises).where(eq(crises.id, crisisId));
  if (!room || room.workspaceId !== c.ctx.workspaceId)
    return {
      ok: false,
      failure: "no_queries",
      error: "That crisis room no longer exists.",
    } as AiFail;
  return withUpgrade(
    await explainPeak(c.ctx, { queryId: room.queryId, peakHour: new Date(peakHour) }),
    c.ctx.tier,
  );
}

export async function writeQueryAction(slug: string, description: string) {
  const c = await ctxFor(slug);
  if ("error" in c) return c.error;
  return withUpgrade(await writeQuery(c.ctx, description), c.ctx.tier);
}
