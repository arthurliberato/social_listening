// Workspaces: one per brand or client. Created within the plan's limit, archived without losing data.
import { and, count, eq, isNull } from "drizzle-orm";
import {
  accounts,
  dashboards,
  db,
  memberships,
  queries,
  reports,
  widgets,
  workspaces,
} from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { can, type PlanTier } from "@/lib/entitlements/plans";
import { can as roleCan } from "@/lib/permissions";
import type { Actor } from "./invites";
import { simNow } from "@/lib/simclock";

type Out<T = object> = ({ ok: true } & T) | { ok: false; error: string; upgradeTo?: PlanTier };
export const WORKSPACE_TYPES = ["own_brand", "client"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "workspace";

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const [hit] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate));
    if (!hit) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export const activeWorkspaceCount = async (accountId: string) =>
  (
    await db
      .select({ n: count() })
      .from(workspaces)
      .where(and(eq(workspaces.accountId, accountId), isNull(workspaces.archivedAt)))
  )[0]!.n;

/** Copy dashboards (with their widgets) and reports from another workspace. Query-specific settings are dropped, because the new workspace has its own queries. */
async function copyContent(fromId: string, toId: string, userId: string) {
  const dashes = await db.select().from(dashboards).where(eq(dashboards.workspaceId, fromId));
  for (const d of dashes) {
    const [nd] = await db
      .insert(dashboards)
      .values({
        workspaceId: toId,
        name: d.name,
        description: d.description,
        templateId: d.templateId,
        createdBy: userId,
      })
      .returning({ id: dashboards.id });
    const ws = await db.select().from(widgets).where(eq(widgets.dashboardId, d.id));
    if (ws.length)
      await db.insert(widgets).values(
        ws.map((w) => {
          const { queryId: _q, ...config } = (w.config ?? {}) as Record<string, unknown>;
          void _q;
          return {
            dashboardId: nd!.id,
            type: w.type,
            title: w.title,
            config,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
          };
        }),
      );
  }
  const reps = await db.select().from(reports).where(eq(reports.workspaceId, fromId));
  for (const r of reps)
    await db.insert(reports).values({
      workspaceId: toId,
      name: r.name,
      description: r.description,
      templateId: r.templateId,
      range: r.range,
      sections: (r.sections as { config?: Record<string, unknown> }[]).map((s) => {
        const { queryId: _q, ...config } = s.config ?? {};
        void _q;
        return { ...s, config };
      }),
      createdBy: userId,
    });
  return { dashboards: dashes.length, reports: reps.length };
}

export async function createWorkspace(o: {
  accountId: string;
  actor: Actor;
  name: string;
  type: WorkspaceType;
  copyFromWorkspaceId?: string | null;
}): Promise<Out<{ slug: string; id: string }>> {
  if (!roleCan(o.actor.role, "workspace.manage"))
    return { ok: false, error: "Your role can't create workspaces." };
  const name = o.name.trim();
  if (!name) return { ok: false, error: "Give the workspace a name." };
  if (name.length > 80) return { ok: false, error: "Keep the name under 80 characters." };
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, o.accountId));
  const used = await activeWorkspaceCount(o.accountId);
  const gate = can(acct!.planTier as PlanTier, "create_workspace", {
    activeQueries: 0,
    seats: 0,
    workspaces: used,
    alerts: 0,
  });
  if (!gate.ok) {
    await trackServer(
      "Paywall Viewed",
      { userId: o.actor.id, accountId: o.accountId },
      { paywall_trigger: "workspace_limit", required_plan: gate.upgradeTo },
    );
    return { ok: false, error: gate.reason, upgradeTo: gate.upgradeTo };
  }
  let source: string | null = null;
  if (o.copyFromWorkspaceId) {
    // You can only copy from a workspace you belong to, in this account.
    const [m] = await db
      .select({ ws: workspaces.id })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(
        and(
          eq(memberships.userId, o.actor.id),
          eq(workspaces.id, o.copyFromWorkspaceId),
          eq(workspaces.accountId, o.accountId),
        ),
      );
    if (!m) return { ok: false, error: "You can only copy from a workspace you belong to." };
    source = m.ws;
  }
  const [ws] = await db
    .insert(workspaces)
    .values({ accountId: o.accountId, name, slug: await uniqueSlug(name), workspaceType: o.type })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: o.actor.id, workspaceId: ws!.id, accountId: o.accountId, role: "owner" });
  if (source) await copyContent(source, ws!.id, o.actor.id);
  await audit({
    accountId: o.accountId,
    workspaceId: ws!.id,
    actorUserId: o.actor.id,
    action: "workspace.created",
    targetType: "workspace",
    targetId: ws!.id,
    meta: { name, type: o.type, copied: !!source },
  });
  await trackServer(
    "Workspace Created",
    { userId: o.actor.id, accountId: o.accountId, workspaceId: ws!.id },
    { workspaces_count: used + 1, copied_from_template: !!source },
  );
  return { ok: true, slug: ws!.slug, id: ws!.id };
}

async function managed(workspaceId: string, actor: Actor) {
  if (!roleCan(actor.role, "workspace.manage")) return null;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return ws ?? null;
}

export async function renameWorkspace(o: {
  workspaceId: string;
  actor: Actor;
  name: string;
}): Promise<Out> {
  const ws = await managed(o.workspaceId, o.actor);
  if (!ws) return { ok: false, error: "Your role can't change this workspace." };
  const name = o.name.trim();
  if (!name || name.length > 80)
    return { ok: false, error: "Use a name between 1 and 80 characters." };
  if (name === ws.name) return { ok: true };
  await db.update(workspaces).set({ name }).where(eq(workspaces.id, ws.id));
  await audit({
    accountId: ws.accountId,
    workspaceId: ws.id,
    actorUserId: o.actor.id,
    action: "workspace.renamed",
    targetType: "workspace",
    targetId: ws.id,
    meta: { from: ws.name, to: name },
  });
  return { ok: true };
}

/** Archive: hidden everywhere, collection stops (live queries pause, freeing their slots), nothing is deleted. */
export async function archiveWorkspace(o: {
  workspaceId: string;
  actor: Actor;
}): Promise<Out<{ pausedQueries: number }>> {
  const ws = await managed(o.workspaceId, o.actor);
  if (!ws) return { ok: false, error: "Your role can't change this workspace." };
  if (ws.archivedAt) return { ok: true, pausedQueries: 0 };
  if ((await activeWorkspaceCount(ws.accountId)) <= 1)
    return {
      ok: false,
      error: "You need at least one active workspace. Create another before archiving this one.",
    };
  const paused = await db
    .update(queries)
    .set({ status: "paused" })
    .where(and(eq(queries.workspaceId, ws.id), eq(queries.status, "live")))
    .returning({ id: queries.id });
  await db.update(workspaces).set({ archivedAt: simNow() }).where(eq(workspaces.id, ws.id));
  await audit({
    accountId: ws.accountId,
    workspaceId: ws.id,
    actorUserId: o.actor.id,
    action: "workspace.archived",
    targetType: "workspace",
    targetId: ws.id,
    meta: { name: ws.name, paused_queries: paused.length },
  });
  return { ok: true, pausedQueries: paused.length };
}

export async function restoreWorkspace(o: { workspaceId: string; actor: Actor }): Promise<Out> {
  const ws = await managed(o.workspaceId, o.actor);
  if (!ws || !ws.archivedAt) return { ok: false, error: "That workspace isn't archived." };
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws.accountId));
  const gate = can(acct!.planTier as PlanTier, "create_workspace", {
    activeQueries: 0,
    seats: 0,
    workspaces: await activeWorkspaceCount(ws.accountId),
    alerts: 0,
  });
  if (!gate.ok) return { ok: false, error: gate.reason, upgradeTo: gate.upgradeTo };
  await db.update(workspaces).set({ archivedAt: null }).where(eq(workspaces.id, ws.id));
  await audit({
    accountId: ws.accountId,
    workspaceId: ws.id,
    actorUserId: o.actor.id,
    action: "workspace.restored",
    targetType: "workspace",
    targetId: ws.id,
    meta: { name: ws.name },
  });
  return { ok: true };
}
