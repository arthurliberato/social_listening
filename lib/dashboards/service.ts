// Server-side dashboard rules shared by the authed actions and the public share page.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, db, queries, workspaces } from "@/db/client";
import { limits, type Entitlements, type PlanTier } from "@/lib/entitlements/plans";
import {
  WIDGETS,
  WIDGET_TYPES,
  isWidgetType,
  widgetAllowed,
  type WidgetConfig,
  type WidgetType,
} from "./catalog";
import { loadWidget, type DataCtx } from "./data";
import { ConfigSchema } from "./schema";

export { ConfigSchema };
import type { WidgetResult } from "./types";

export const WidgetSchema = z.object({
  id: z.string().max(64).optional(),
  type: z.enum(WIDGET_TYPES),
  title: z.string().trim().min(1, "Widgets need a title").max(80),
  config: ConfigSchema.default({}),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});

export const RangeSchema = z
  .string()
  .max(200)
  .transform((s) => {
    // Only the date-range params may flow through to the data layer.
    const src = new URLSearchParams(s);
    const out = new URLSearchParams();
    for (const k of ["range", "from", "to"]) if (src.get(k)) out.set(k, src.get(k)!);
    return out;
  });

export async function workspaceAccount(workspaceId: string) {
  const [row] = await db
    .select({ accountId: accounts.id, tier: accounts.planTier })
    .from(workspaces)
    .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
    .where(eq(workspaces.id, workspaceId));
  const tier = row!.tier as PlanTier;
  return { accountId: row!.accountId, tier, plan: limits(tier) };
}

export function features(tier: PlanTier): Entitlements["features"] {
  return limits(tier).features;
}

/** Validate and run one widget against a workspace. Never throws: failures become a typed result. */
export async function runWidget(
  workspaceId: string,
  type: string,
  rawConfig: unknown,
  rawRange: string,
): Promise<WidgetResult> {
  if (!isWidgetType(type)) return { ok: false, code: "not_found", error: "Unknown widget type." };
  const cfg = ConfigSchema.safeParse(rawConfig ?? {});
  if (!cfg.success)
    return { ok: false, code: "failed", error: "This widget has an invalid setting." };
  const { plan } = await workspaceAccount(workspaceId);
  if (!widgetAllowed(type, plan.features)) {
    const need = WIDGETS[type].requires!;
    return {
      ok: false,
      code: "plan",
      requires: need,
      error: `${WIDGETS[type].label} isn't included in your ${plan.label} plan.`,
    };
  }
  if (cfg.data.queryId) {
    const owns = await db
      .select({ id: queries.id })
      .from(queries)
      .where(and(eq(queries.id, cfg.data.queryId), eq(queries.workspaceId, workspaceId)))
      .limit(1);
    if (!owns.length)
      return {
        ok: false,
        code: "not_found",
        error: "The query this widget uses was deleted. Edit the widget to choose another.",
      };
  }
  const ctx: DataCtx = {
    workspaceId,
    historyDays: plan.historyDays,
    range: RangeSchema.parse(rawRange),
  };
  try {
    return { ok: true, payload: await loadWidget(ctx, type, cfg.data as WidgetConfig) };
  } catch (err) {
    console.error("[dashboards] widget failed", type, err);
    return { ok: false, code: "failed", error: "We couldn't load this widget." };
  }
}

export type { WidgetType };
