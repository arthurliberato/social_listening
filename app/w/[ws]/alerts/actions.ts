"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { alertEvents, alertRules, crises, db, queries } from "@/db/client";
import { requireWorkspace } from "@/lib/auth/session";
import {
  ALERT_TYPES,
  CHANNELS,
  COOLDOWNS,
  TYPE_INFO,
  parseParams,
  type AlertType,
  type Params,
} from "@/lib/alerts/rules";
import { alertCount, backtestRule } from "@/lib/alerts/service";
import { can, PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

type Fail = { ok: false; error: string; upgradeTo?: PlanTier; paywall?: "alert_limit" | "feature" };

const RuleInput = z.object({
  name: z.string().trim().min(1, "Give the alert a name").max(80),
  queryId: z.string().uuid("Choose a query"),
  type: z.enum(ALERT_TYPES),
  params: z.record(z.string(), z.unknown()).default({}),
  channels: z.array(z.enum(CHANNELS)).min(1, "Pick at least one way to be notified"),
  cooldownMin: z.number().refine((n) => (COOLDOWNS as readonly number[]).includes(n)),
});

/** Plan gate shared by preview and save: a rule type may need a feature the plan lacks. */
function typeGate(tier: PlanTier, type: AlertType): Fail | null {
  const feature = TYPE_INFO[type].feature;
  if (feature && !PLANS[tier].features[feature])
    return {
      ok: false,
      error: `${TYPE_INFO[type].label} alerts are on the ${PLANS[planUnlocking(feature)].label} plan and above.`,
      upgradeTo: planUnlocking(feature),
      paywall: "feature",
    };
  return null;
}

export type BacktestResult =
  | { ok: true; fires: number; at: number[]; days: number; empty: boolean; skippedHours: number }
  | Fail;

/** "How often would this have fired?" — shown live while building a rule. */
export async function backtestAction(
  slug: string,
  input: { queryId: string; type: string; params: unknown },
): Promise<BacktestResult> {
  const { ws } = await requireWorkspace(slug);
  if (!(ALERT_TYPES as readonly string[]).includes(input.type))
    return { ok: false, error: "Unknown alert type." };
  const type = input.type as AlertType;
  const { tier, plan } = await accountPlan(ws.id);
  const gate = typeGate(tier, type);
  if (gate) return gate;
  const p = parseParams(type, input.params);
  if (!p.ok) return { ok: false, error: p.error };
  const r = await backtestRule({
    workspaceId: ws.id,
    queryId: input.queryId,
    type,
    params: p.params as Params[typeof type],
    historyDays: plan.historyDays,
  });
  if (!r) return { ok: false, error: "That query no longer exists." };
  return { ok: true, ...r };
}

export async function createAlert(
  slug: string,
  input: unknown,
): Promise<{ ok: true; id: string } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return {
      ok: false,
      error: "Your role can view alerts but not create them. Ask an admin for editor access.",
    };
  const parsed = RuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  const { accountId, tier } = await accountPlan(ws.id);
  const gate = typeGate(tier, v.type);
  if (gate) return gate;
  const p = parseParams(v.type, v.params);
  if (!p.ok) return { ok: false, error: p.error };
  const [q] = await db
    .select({ id: queries.id })
    .from(queries)
    .where(and(eq(queries.id, v.queryId), eq(queries.workspaceId, ws.id)));
  if (!q) return { ok: false, error: "That query no longer exists." };

  const allowed = can(tier, "create_alert", {
    activeQueries: 0,
    seats: 0,
    workspaces: 0,
    alerts: await alertCount(accountId),
  });
  if (!allowed.ok)
    return {
      ok: false,
      error: allowed.reason,
      upgradeTo: allowed.upgradeTo,
      paywall: "alert_limit",
    };

  const [row] = await db
    .insert(alertRules)
    .values({
      workspaceId: ws.id,
      queryId: v.queryId,
      name: v.name,
      type: v.type,
      params: p.params,
      channels: v.channels,
      cooldownMin: v.cooldownMin,
      createdBy: user.id,
    })
    .returning({ id: alertRules.id });
  revalidatePath(`/w/${slug}/alerts`);
  return { ok: true, id: row!.id };
}

async function ownRule(slug: string, id: string) {
  const { user, ws } = await requireWorkspace(slug);
  const [rule] = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.id, id), eq(alertRules.workspaceId, ws.id)));
  return { user, ws, rule };
}

export async function setAlertMuted(
  slug: string,
  id: string,
  muted: boolean,
): Promise<{ ok: true } | Fail> {
  const { ws, rule } = await ownRule(slug, id);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't change alerts." };
  if (!rule) return { ok: false, error: "That alert no longer exists." };
  await db
    .update(alertRules)
    .set({ status: muted ? "muted" : "active", updatedAt: new Date() })
    .where(eq(alertRules.id, id));
  revalidatePath(`/w/${slug}/alerts`);
  return { ok: true };
}

export async function deleteAlert(slug: string, id: string): Promise<{ ok: true } | Fail> {
  const { ws, rule } = await ownRule(slug, id);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't delete alerts." };
  if (!rule) return { ok: false, error: "That alert no longer exists." };
  await db.delete(alertRules).where(eq(alertRules.id, id));
  revalidatePath(`/w/${slug}/alerts`);
  return { ok: true };
}

async function ownEvent(slug: string, id: string) {
  const { user, ws } = await requireWorkspace(slug);
  const [ev] = await db
    .select()
    .from(alertEvents)
    .where(and(eq(alertEvents.id, id), eq(alertEvents.workspaceId, ws.id)));
  return { user, ws, ev };
}

/** Record that someone looked at a fired alert; returns how long it sat unread (first open only). */
export async function markOpened(
  slug: string,
  id: string,
): Promise<{ firstOpenMs: number | null }> {
  const { ev } = await ownEvent(slug, id);
  if (!ev || ev.openedAt) return { firstOpenMs: null };
  const now = new Date();
  await db
    .update(alertEvents)
    .set({ openedAt: now, status: ev.status === "new" ? "opened" : ev.status })
    .where(and(eq(alertEvents.id, id), eq(alertEvents.status, ev.status)));
  return { firstOpenMs: now.getTime() - ev.createdAt.getTime() };
}

export async function acknowledgeAlert(
  slug: string,
  id: string,
): Promise<{ ok: true; ackMs: number } | Fail> {
  const { user, ws, ev } = await ownEvent(slug, id);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can view alerts but not acknowledge them." };
  if (!ev) return { ok: false, error: "That alert no longer exists." };
  const now = new Date();
  if (ev.status !== "acknowledged")
    await db
      .update(alertEvents)
      .set({ status: "acknowledged", acknowledgedAt: now, acknowledgedBy: user.id })
      .where(eq(alertEvents.id, id));
  revalidatePath(`/w/${slug}/alerts`);
  return { ok: true, ackMs: now.getTime() - ev.createdAt.getTime() };
}

/** Open (or reuse) a crisis room for a fired alert. Plan-gated server-side. */
export async function startCrisis(
  slug: string,
  eventId: string,
): Promise<{ ok: true; id: string } | Fail> {
  const { user, ws, ev } = await ownEvent(slug, eventId);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can view alerts but not open crisis rooms." };
  if (!ev) return { ok: false, error: "That alert no longer exists." };
  const { tier } = await accountPlan(ws.id);
  if (!PLANS[tier].features.crisisRoom)
    return {
      ok: false,
      error: `Crisis Rooms are on the ${PLANS[planUnlocking("crisisRoom")].label} plan and above.`,
      upgradeTo: planUnlocking("crisisRoom"),
      paywall: "feature",
    };
  const [existing] = await db.select().from(crises).where(eq(crises.alertEventId, eventId));
  if (existing) return { ok: true, id: existing.id };
  const [rule] = await db.select().from(alertRules).where(eq(alertRules.id, ev.ruleId));
  const [q] = await db.select().from(queries).where(eq(queries.id, rule!.queryId));
  const [row] = await db
    .insert(crises)
    .values({
      workspaceId: ws.id,
      queryId: rule!.queryId,
      alertEventId: eventId,
      title: `${q!.name}: ${TYPE_INFO[rule!.type as AlertType].label.toLowerCase()}`,
      windowStart: new Date(ev.firedAt.getTime() - 6 * 3_600_000),
      openedBy: user.id,
    })
    .returning({ id: crises.id });
  if (ev.status !== "acknowledged")
    await db
      .update(alertEvents)
      .set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: user.id })
      .where(eq(alertEvents.id, eventId));
  revalidatePath(`/w/${slug}/crisis`);
  return { ok: true, id: row!.id };
}
