// Changing who is in a workspace, with the guards that keep it safe: nobody manages someone above them,
// and a workspace never loses its last owner.
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { accounts, db, invitations, memberships, users, workspaces } from "@/db/client";
import { audit } from "@/lib/audit";
import { can, PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { canChangeRole, ROLE_LABEL, usesSeat, type Role } from "@/lib/permissions";
import type { Actor } from "./invites";
import { seatUsage } from "./seats";
import { simNow } from "@/lib/simclock";

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

export async function listInvites(workspaceId: string) {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, simNow()),
      ),
    )
    .orderBy(asc(invitations.createdAt));
}

type Out = { ok: true } | { ok: false; error: string; upgradeTo?: PlanTier };

const ownerCount = async (workspaceId: string) =>
  (
    await db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")))
  )[0]!.n;

async function target(workspaceId: string, userId: string) {
  const [m] = await db
    .select({ role: memberships.role, accountId: memberships.accountId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  return m;
}

export async function changeRole(o: {
  workspaceId: string;
  actor: Actor;
  userId: string;
  role: Role;
}): Promise<Out> {
  const t = await target(o.workspaceId, o.userId);
  if (!t) return { ok: false, error: "That person isn't in this workspace." };
  if (t.role === o.role) return { ok: true };
  if (!canChangeRole(o.actor.role, t.role, o.role))
    return {
      ok: false,
      error: `Your role can't change ${ROLE_LABEL[t.role as Role] ?? t.role}s to ${ROLE_LABEL[o.role]}.`,
    };
  if (t.role === "owner" && (await ownerCount(o.workspaceId)) <= 1)
    return {
      ok: false,
      error: "Every workspace needs an owner. Make someone else an owner first.",
    };
  // Moving a client viewer into a working role takes a seat, unless they already hold one in another workspace.
  if (!usesSeat(t.role) && usesSeat(o.role)) {
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, t.accountId));
    const held = (
      await db
        .select({ r: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.userId, o.userId), eq(memberships.accountId, t.accountId)))
    ).some((m) => usesSeat(m.r));
    if (!held) {
      const used = (await seatUsage(t.accountId)).used;
      const gate = can(acct!.planTier as PlanTier, "invite_member", {
        activeQueries: 0,
        seats: used,
        workspaces: 0,
        alerts: 0,
      });
      if (!gate.ok)
        return {
          ok: false,
          error: `${gate.reason} Upgrade to ${PLANS[gate.upgradeTo].label} to give ${t.name} a working role.`,
          upgradeTo: gate.upgradeTo,
        };
    }
  }
  await db
    .update(memberships)
    .set({ role: o.role })
    .where(and(eq(memberships.workspaceId, o.workspaceId), eq(memberships.userId, o.userId)));
  await audit({
    accountId: t.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.actor.id,
    action: "member.role_changed",
    targetType: "user",
    targetId: o.userId,
    meta: { name: t.name, from: t.role, to: o.role },
  });
  return { ok: true };
}

export async function removeMember(o: {
  workspaceId: string;
  actor: Actor;
  userId: string;
}): Promise<Out> {
  if (o.userId === o.actor.id)
    return { ok: false, error: "To leave a workspace, use Leave workspace." };
  const t = await target(o.workspaceId, o.userId);
  if (!t) return { ok: false, error: "That person isn't in this workspace." };
  if (!canChangeRole(o.actor.role, t.role, null))
    return { ok: false, error: `Your role can't remove ${ROLE_LABEL[t.role as Role] ?? t.role}s.` };
  if (t.role === "owner" && (await ownerCount(o.workspaceId)) <= 1)
    return { ok: false, error: "Every workspace needs an owner." };
  await db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, o.workspaceId), eq(memberships.userId, o.userId)));
  await audit({
    accountId: t.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.actor.id,
    action: "member.removed",
    targetType: "user",
    targetId: o.userId,
    meta: { name: t.name, role: t.role },
  });
  return { ok: true };
}

export async function leaveWorkspace(o: { workspaceId: string; userId: string }): Promise<Out> {
  const t = await target(o.workspaceId, o.userId);
  if (!t) return { ok: false, error: "You're not in this workspace." };
  const mine = await db
    .select({ n: count() })
    .from(memberships)
    .where(eq(memberships.userId, o.userId));
  if (mine[0]!.n <= 1)
    return { ok: false, error: "This is your only workspace, so you can't leave it." };
  if (t.role === "owner" && (await ownerCount(o.workspaceId)) <= 1)
    return {
      ok: false,
      error: "You're the only owner. Make someone else an owner before you leave.",
    };
  await db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, o.workspaceId), eq(memberships.userId, o.userId)));
  await audit({
    accountId: t.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.userId,
    action: "member.left",
    targetType: "user",
    targetId: o.userId,
    meta: { name: t.name, role: t.role },
  });
  return { ok: true };
}

export const workspaceName = async (id: string) =>
  (await db.select({ n: workspaces.name }).from(workspaces).where(eq(workspaces.id, id)))[0]?.n ??
  "";
