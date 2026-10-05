// The Home "Get set up" checklist: one definition of what is done, used by the page and by the actions
// that complete an item (so the on-screen state and the "Checklist Item Completed" event can't disagree).
import { and, count, eq, like } from "drizzle-orm";
import { alertRules, dashboards, db, invitations, memberships, queries } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";

export const ITEMS = [
  { id: "create_query", label: "Create your first query" },
  { id: "refine_query", label: "Refine it with an exclusion" },
  { id: "set_alert", label: "Set an alert" },
  { id: "build_dashboard", label: "Build a dashboard" },
  { id: "invite_teammate", label: "Invite a teammate" },
] as const;
export type ItemId = (typeof ITEMS)[number]["id"];

export async function checklist(workspaceId: string) {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [nq, nx, na, nd, ni, nm] = await Promise.all([
    n(db.select({ n: count() }).from(queries).where(eq(queries.workspaceId, workspaceId))),
    n(
      db
        .select({ n: count() })
        .from(queries)
        .where(and(eq(queries.workspaceId, workspaceId), like(queries.booleanText, "% NOT %"))),
    ),
    n(db.select({ n: count() }).from(alertRules).where(eq(alertRules.workspaceId, workspaceId))),
    n(db.select({ n: count() }).from(dashboards).where(eq(dashboards.workspaceId, workspaceId))),
    n(db.select({ n: count() }).from(invitations).where(eq(invitations.workspaceId, workspaceId))),
    n(db.select({ n: count() }).from(memberships).where(eq(memberships.workspaceId, workspaceId))),
  ]);
  const done: Record<ItemId, boolean> = {
    create_query: nq > 0,
    refine_query: nx > 0,
    set_alert: na > 0,
    build_dashboard: nd > 0,
    invite_teammate: ni > 0 || nm > 1,
  };
  const items = ITEMS.map((i) => ({ ...i, done: done[i.id] }));
  return {
    items,
    doneCount: items.filter((i) => i.done).length,
    counts: { alerts: na, dashboards: nd },
  };
}

/**
 * Call after creating an alert or dashboard. The event fires only for the first one in the workspace
 * (the moment the item becomes done), with the number of items done at that point.
 */
export async function itemCompleted(
  ctx: { userId: string; workspaceId: string },
  id: "set_alert" | "build_dashboard",
): Promise<void> {
  const c = await checklist(ctx.workspaceId);
  const total = id === "set_alert" ? c.counts.alerts : c.counts.dashboards;
  if (total !== 1) return;
  await trackServer("Checklist Item Completed", ctx, { item_id: id, completed_count: c.doneCount });
}
