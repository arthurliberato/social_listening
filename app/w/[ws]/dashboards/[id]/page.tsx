import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { dashboards, db, queries, widgets } from "@/db/client";
import { DashboardEditor } from "@/components/dashboards/DashboardEditor";
import type { DraftWidget } from "@/components/dashboards/DashboardGrid";
import { requireWorkspace } from "@/lib/auth/session";
import { isWidgetType, type WidgetConfig } from "@/lib/dashboards/catalog";
import { workspaceAccount } from "@/lib/dashboards/service";
import { parseFilters } from "@/lib/mentions/filters";
import { canEdit } from "@/lib/queries";

export const metadata = { title: "Dashboard · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug, id } = await params;
  const sp = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const dash = (
    await db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ws.id)))
  )[0];
  if (!dash) notFound();
  const rows = await db
    .select()
    .from(widgets)
    .where(eq(widgets.dashboardId, id))
    .orderBy(asc(widgets.y), asc(widgets.x));
  const { plan } = await workspaceAccount(ws.id);
  const qs = await db
    .select({ id: queries.id, name: queries.name })
    .from(queries)
    .where(eq(queries.workspaceId, ws.id));
  const f = parseFilters(sp as Record<string, string | string[] | undefined>);
  const draft: DraftWidget[] = rows
    .filter((r) => isWidgetType(r.type))
    .map((r) => ({
      id: r.id,
      type: r.type as DraftWidget["type"],
      title: r.title,
      config: r.config as WidgetConfig,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
    }));
  const editable = canEdit(ws.role);

  return (
    <DashboardEditor
      key={dash.id}
      ws={slug}
      id={dash.id}
      initial={{ name: dash.name, description: dash.description, widgets: draft }}
      canEdit={editable}
      isCreator={dash.createdBy === user.id}
      features={plan.features}
      historyDays={plan.historyDays}
      planLabel={plan.label}
      queries={qs}
      range={{ range: f.range, from: f.from, to: f.to }}
      startEditing={editable && sp.edit === "1"}
      publicToken={dash.publicToken}
    />
  );
}
