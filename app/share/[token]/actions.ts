"use server";

import { and, eq } from "drizzle-orm";
import { dashboards, db, widgets } from "@/db/client";
import { runWidget, workspaceAccount } from "@/lib/dashboards/service";
import type { WidgetResult } from "@/lib/dashboards/types";

/**
 * Data for one widget of a publicly shared dashboard. The token identifies the dashboard; the widget id must
 * belong to it, and the widget's saved settings (not caller-supplied ones) decide what runs. No login required.
 */
export async function getSharedWidgetData(
  token: string,
  widgetId: string,
  range: string,
): Promise<WidgetResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !/^[0-9a-f-]{36}$/.test(widgetId))
    return { ok: false, code: "not_found", error: "This link is no longer valid." };
  const dash = (await db.select().from(dashboards).where(eq(dashboards.publicToken, token)))[0];
  if (!dash) return { ok: false, code: "not_found", error: "This link is no longer valid." };
  const { plan } = await workspaceAccount(dash.workspaceId);
  if (!plan.features.publicShareLinks)
    return { ok: false, code: "not_found", error: "This link is no longer available." };
  const w = (
    await db
      .select()
      .from(widgets)
      .where(and(eq(widgets.id, widgetId), eq(widgets.dashboardId, dash.id)))
  )[0];
  if (!w)
    return { ok: false, code: "not_found", error: "This widget is no longer on the dashboard." };
  return runWidget(dash.workspaceId, w.type, w.config, range);
}
