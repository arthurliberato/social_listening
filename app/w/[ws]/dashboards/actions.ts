"use server";

import { and, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dashboards, db, widgets } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import { WIDGETS, widgetAllowed, type WidgetType } from "@/lib/dashboards/catalog";
import { compact } from "@/lib/dashboards/layout";
import { WidgetSchema, runWidget, workspaceAccount } from "@/lib/dashboards/service";
import { getTemplate, layoutTemplate } from "@/lib/dashboards/templates";
import type { WidgetResult } from "@/lib/dashboards/types";
import { PLANS, planUnlocking } from "@/lib/entitlements/plans";
import { canEdit } from "@/lib/queries";

type Fail = { ok: false; error: string; upgradeTo?: string };

export async function getWidgetData(
  slug: string,
  type: string,
  config: unknown,
  range: string,
): Promise<WidgetResult> {
  const { ws } = await requireWorkspace(slug);
  return runWidget(ws.id, type, config, range);
}

export async function createDashboard(
  slug: string,
  input: { templateId?: string; name?: string },
): Promise<{ ok: true; id: string; skipped: string[] } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can view dashboards but not create them." };
  const { plan } = await workspaceAccount(ws.id);
  const tpl = input.templateId ? getTemplate(input.templateId) : undefined;
  if (input.templateId && !tpl) return { ok: false, error: "Unknown template." };
  const name = (input.name?.trim() || tpl?.label || "Untitled dashboard").slice(0, 80);
  const { placed, skipped } = layoutTemplate(tpl?.widgets ?? [], (t) =>
    widgetAllowed(t, plan.features),
  );

  const id = await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(dashboards)
      .values({
        workspaceId: ws.id,
        name,
        description: tpl?.description ?? "",
        templateId: tpl?.id ?? null,
        createdBy: user.id,
      })
      .returning({ id: dashboards.id });
    if (placed.length)
      await tx.insert(widgets).values(
        placed.map((p) => ({
          dashboardId: d!.id,
          type: p.type,
          title: p.title,
          config: p.config,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
        })),
      );
    return d!.id;
  });
  await trackServer(
    "Dashboard Created",
    { userId: user.id, workspaceId: ws.id },
    { template_id: tpl?.id ?? "blank" },
  );
  revalidatePath(`/w/${slug}/dashboards`);
  return { ok: true, id, skipped };
}

const SaveSchema = z.object({
  name: z.string().trim().min(1, "Give the dashboard a name").max(80),
  description: z.string().trim().max(300).default(""),
  widgets: z.array(WidgetSchema).max(24, "A dashboard can hold up to 24 widgets"),
});

export async function saveDashboard(
  slug: string,
  id: string,
  input: unknown,
): Promise<
  { ok: true; widgets: { id: string; x: number; y: number; w: number; h: number }[] } | Fail
> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can view dashboards but not change them." };
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const dash = (
    await db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)))
  )[0];
  if (!dash) return { ok: false, error: "That dashboard no longer exists." };

  const { plan } = await workspaceAccount(ws.id);
  const existing = new Map(
    (await db.select().from(widgets).where(eq(widgets.dashboardId, id))).map((w) => [w.id, w]),
  );
  for (const w of parsed.data.widgets) {
    const kept = w.id && existing.get(w.id)?.type === w.type; // widgets already on the board stay, even after a downgrade
    if (!kept && !widgetAllowed(w.type as WidgetType, plan.features)) {
      const def = WIDGETS[w.type as WidgetType];
      const need = PLANS[planUnlocking(def.requires!)];
      return {
        ok: false,
        error: `${def.label} needs the ${need.label} plan.`,
        upgradeTo: need.label,
      };
    }
  }

  const rows = parsed.data.widgets.map((w, i) => ({
    ...w,
    key: w.id && /^[0-9a-f-]{36}$/.test(w.id) ? w.id : `n${i}`,
  }));
  const settled = compact(rows.map((r) => ({ id: r.key, x: r.x, y: r.y, w: r.w, h: r.h })));
  const saved = await db.transaction(async (tx) => {
    await tx
      .update(dashboards)
      .set({ name: parsed.data.name, description: parsed.data.description, updatedAt: new Date() })
      .where(eq(dashboards.id, id));
    await tx.delete(widgets).where(eq(widgets.dashboardId, id));
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const [i, r] of rows.entries()) {
      const b = settled.find((s) => s.id === r.key)!;
      const [row] = await tx
        .insert(widgets)
        .values({
          ...(r.key.startsWith("n") ? {} : { id: r.key }),
          dashboardId: id,
          type: r.type,
          title: r.title,
          config: r.config,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        })
        .returning({ id: widgets.id });
      out[i] = { id: row!.id, x: b.x, y: b.y, w: b.w, h: b.h };
    }
    return out;
  });
  await trackServer(
    "Dashboard Saved",
    { userId: user.id, workspaceId: ws.id },
    { widgets_count: saved.length },
  );
  revalidatePath(`/w/${slug}/dashboards`);
  return { ok: true, widgets: saved };
}

export async function deleteDashboard(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't delete dashboards." };
  await db.delete(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)));
  revalidatePath(`/w/${slug}/dashboards`);
  return { ok: true };
}

export async function duplicateDashboard(
  slug: string,
  id: string,
): Promise<{ ok: true; id: string } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't create dashboards." };
  const src = (
    await db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)))
  )[0];
  if (!src) return { ok: false, error: "That dashboard no longer exists." };
  const ws2 = await db.select().from(widgets).where(eq(widgets.dashboardId, id));
  const newId = await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(dashboards)
      .values({
        workspaceId: ws.id,
        name: `${src.name} (copy)`.slice(0, 80),
        description: src.description,
        templateId: src.templateId,
        createdBy: user.id,
      })
      .returning({ id: dashboards.id });
    if (ws2.length)
      await tx.insert(widgets).values(
        ws2.map((w) => ({
          dashboardId: d!.id,
          type: w.type,
          title: w.title,
          config: w.config,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
        })),
      );
    return d!.id;
  });
  revalidatePath(`/w/${slug}/dashboards`);
  return { ok: true, id: newId };
}

/** Turn the public read-only link on or off. Public links are a Growth+ feature. */
export async function setPublicLink(
  slug: string,
  id: string,
  enabled: boolean,
): Promise<{ ok: true; token: string | null } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't change sharing." };
  const { plan } = await workspaceAccount(ws.id);
  if (enabled && !plan.features.publicShareLinks) {
    const need = PLANS[planUnlocking("publicShareLinks")];
    await trackServer(
      "Paywall Viewed",
      { userId: user.id, workspaceId: ws.id },
      { paywall_trigger: "public_share", required_plan: need.label.toLowerCase() },
    );
    return {
      ok: false,
      error: `Public links are included from the ${need.label} plan.`,
      upgradeTo: need.label,
    };
  }
  const dash = (
    await db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)))
  )[0];
  if (!dash) return { ok: false, error: "That dashboard no longer exists." };
  const token = enabled ? (dash.publicToken ?? randomBytes(24).toString("base64url")) : null;
  await db.update(dashboards).set({ publicToken: token }).where(eq(dashboards.id, id));
  if (enabled)
    await trackServer(
      "Dashboard Shared",
      { userId: user.id, workspaceId: ws.id },
      { share_type: "public_link", recipients_count: 0 },
    );
  revalidatePath(`/w/${slug}/dashboards/${id}`);
  return { ok: true, token };
}

export async function recordInternalShare(slug: string, id: string): Promise<void> {
  const { user, ws } = await requireWorkspace(slug);
  const exists = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)))
    .limit(1);
  if (exists.length)
    await trackServer(
      "Dashboard Shared",
      { userId: user.id, workspaceId: ws.id },
      { share_type: "internal_link", recipients_count: 0 },
    );
}

/** Log a view (once per user per 10 minutes) for "last viewed" and the viewer count. */
export async function recordDashboardView(slug: string, id: string): Promise<void> {
  const { user, ws } = await requireWorkspace(slug);
  const exists = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)))
    .limit(1);
  if (!exists.length) return;
  await db.execute(sql`
    INSERT INTO dashboard_views (dashboard_id, user_id)
    SELECT ${id}::uuid, ${user.id}::uuid
    WHERE NOT EXISTS (SELECT 1 FROM dashboard_views WHERE dashboard_id = ${id}::uuid AND user_id = ${user.id}::uuid AND viewed_at > now() - interval '10 minutes')`);
}
