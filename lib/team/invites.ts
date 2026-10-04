// Inviting people: seat checks, the email, resend and revoke, and accepting (new or existing user).
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, db, invitations, memberships, users, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/auth/tokens";
import { inviteEmail, sendEmail } from "@/lib/email/service";
import { can, PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { assignableRoles, ROLE_LABEL, usesSeat, type Role } from "@/lib/permissions";
import { seatUsage } from "./seats";

const WEEK = 7 * 86_400_000;
const Email = z.string().email().max(200);

export type InviteStatus =
  "sent" | "already_member" | "already_invited" | "invalid" | "seat_limit" | "role_not_allowed";
export interface InviteResult {
  email: string;
  status: InviteStatus;
  reason?: string;
}
export interface Actor {
  id: string;
  name: string;
  role: string;
}

export async function inviteMembers(o: {
  workspaceId: string;
  actor: Actor;
  emails: string[];
  role: Role;
  source: "onboarding" | "settings";
}): Promise<{ results: InviteResult[]; upgradeTo?: PlanTier }> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, o.workspaceId));
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws!.accountId));
  const list = [...new Set(o.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const results: InviteResult[] = [];
  let upgradeTo: PlanTier | undefined;

  if (!assignableRoles(o.actor.role).includes(o.role))
    return {
      results: list.map((email) => ({
        email,
        status: "role_not_allowed",
        reason: `Your role can't invite someone as ${ROLE_LABEL[o.role]}.`,
      })),
    };

  const seats = await seatUsage(ws!.accountId);
  let used = seats.used;
  // People who already hold a seat elsewhere in the account don't need another.
  const seated = new Set(
    (
      await db
        .select({ email: users.email })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(
          and(
            eq(memberships.accountId, ws!.accountId),
            sql`${memberships.role} <> 'client_viewer'`,
          ),
        )
    ).map((r) => r.email.toLowerCase()),
  );

  for (const email of list) {
    if (!Email.safeParse(email).success) {
      results.push({
        email,
        status: "invalid",
        reason: "That doesn't look like an email address.",
      });
      continue;
    }
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (existing) {
      const [m] = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(eq(memberships.userId, existing.id), eq(memberships.workspaceId, o.workspaceId)),
        );
      if (m) {
        results.push({
          email,
          status: "already_member",
          reason: `Already in this workspace as ${ROLE_LABEL[m.role as Role] ?? m.role}.`,
        });
        continue;
      }
    }
    const [pending] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.workspaceId, o.workspaceId),
          sql`lower(${invitations.email}) = ${email}`,
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    if (pending) {
      results.push({
        email,
        status: "already_invited",
        reason: "Already invited. Resend it from the pending list.",
      });
      continue;
    }
    const needsSeat = usesSeat(o.role) && !seated.has(email);
    if (needsSeat) {
      const gate = can(acct!.planTier as PlanTier, "invite_member", {
        activeQueries: 0,
        seats: used,
        workspaces: 0,
        alerts: 0,
      });
      if (!gate.ok) {
        upgradeTo = gate.upgradeTo;
        results.push({
          email,
          status: "seat_limit",
          reason: `${gate.reason} Upgrade to ${PLANS[gate.upgradeTo].label} to add more people.`,
        });
        await trackServer(
          "Paywall Viewed",
          { userId: o.actor.id, workspaceId: o.workspaceId },
          { paywall_trigger: "seat_limit", required_plan: gate.upgradeTo },
        );
        continue;
      }
    }
    const raw = randomBytes(24).toString("base64url");
    await db.insert(invitations).values({
      workspaceId: o.workspaceId,
      accountId: ws!.accountId,
      email,
      role: o.role,
      tokenHash: hashToken(raw),
      invitedBy: o.actor.id,
      source: o.source,
      expiresAt: new Date(Date.now() + WEEK),
    });
    const m = inviteEmail({ inviter: o.actor.name, workspace: ws!.name, token: raw, role: o.role });
    await sendEmail({ to: email, type: "invite", subject: m.subject, text: m.text });
    if (needsSeat) used++;
    await audit({
      accountId: ws!.accountId,
      workspaceId: o.workspaceId,
      actorUserId: o.actor.id,
      action: "member.invited",
      targetType: "invitation",
      targetId: email,
      meta: { role: o.role, source: o.source },
    });
    await trackServer(
      "Teammate Invited",
      { userId: o.actor.id, workspaceId: o.workspaceId },
      { invited_role: o.role, invite_source: o.source },
    );
    results.push({ email, status: "sent" });
  }
  return { results, upgradeTo };
}

async function ownInvite(workspaceId: string, inviteId: string) {
  const [inv] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.id, inviteId),
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
      ),
    );
  return inv;
}

export async function resendInvite(o: {
  workspaceId: string;
  actor: Actor;
  inviteId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const inv = await ownInvite(o.workspaceId, o.inviteId);
  if (!inv) return { ok: false, error: "That invitation no longer exists." };
  if (!assignableRoles(o.actor.role).includes(inv.role as Role))
    return {
      ok: false,
      error: `Your role can't manage ${ROLE_LABEL[inv.role as Role] ?? inv.role} invitations.`,
    };
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, o.workspaceId));
  const raw = randomBytes(24).toString("base64url");
  await db
    .update(invitations)
    .set({ tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + WEEK) })
    .where(eq(invitations.id, inv.id));
  const m = inviteEmail({ inviter: o.actor.name, workspace: ws!.name, token: raw, role: inv.role });
  await sendEmail({ to: inv.email, type: "invite", subject: m.subject, text: m.text });
  await audit({
    accountId: inv.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.actor.id,
    action: "member.invite_resent",
    targetType: "invitation",
    targetId: inv.email,
    meta: { role: inv.role },
  });
  return { ok: true };
}

export async function revokeInvite(o: {
  workspaceId: string;
  actor: Actor;
  inviteId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const inv = await ownInvite(o.workspaceId, o.inviteId);
  if (!inv) return { ok: false, error: "That invitation no longer exists." };
  if (!assignableRoles(o.actor.role).includes(inv.role as Role))
    return {
      ok: false,
      error: `Your role can't manage ${ROLE_LABEL[inv.role as Role] ?? inv.role} invitations.`,
    };
  await db.delete(invitations).where(eq(invitations.id, inv.id));
  await audit({
    accountId: inv.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.actor.id,
    action: "member.invite_revoked",
    targetType: "invitation",
    targetId: inv.email,
    meta: { role: inv.role },
  });
  return { ok: true };
}

/** What follows someone joining a workspace, whether they signed up or already had an account. */
export async function afterJoin(o: {
  accountId: string;
  workspaceId: string;
  userId: string;
  role: string;
  invitedAt: Date;
  newMember: boolean;
  now?: Date;
}) {
  const now = o.now ?? new Date();
  const ctx = { userId: o.userId, accountId: o.accountId, workspaceId: o.workspaceId };
  await audit({
    accountId: o.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.userId,
    action: "member.joined",
    targetType: "user",
    targetId: o.userId,
    meta: { role: o.role },
  });
  await trackServer("Invite Accepted", ctx, {
    days_to_accept: Math.max(0, Math.round((now.getTime() - o.invitedAt.getTime()) / 86_400_000)),
  });
  if (o.newMember && usesSeat(o.role)) {
    const s = await seatUsage(o.accountId);
    await trackServer("Seat Added", ctx, { seats_total: s.members, mrr_delta: 0 });
  }
  if (o.role === "client_viewer") await trackServer("Client Viewer Added", ctx, {});
}

export type AcceptResult =
  | { ok: true; slug: string; role: string; workspaceId: string; already: boolean }
  | { ok: false; error: "invalid" | "email_mismatch" };

/** An existing, signed-in user accepting an invitation sent to their address. */
export async function acceptInvite(o: { token: string; userId: string }): Promise<AcceptResult> {
  const [inv] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, hashToken(o.token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  if (!inv) return { ok: false, error: "invalid" };
  const [user] = await db.select().from(users).where(eq(users.id, o.userId));
  if (!user || user.email.toLowerCase() !== inv.email.toLowerCase())
    return { ok: false, error: "email_mismatch" };
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId));
  const [have] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, o.userId), eq(memberships.workspaceId, inv.workspaceId)));
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
  if (have)
    return {
      ok: true,
      slug: ws!.slug,
      role: have.role,
      workspaceId: inv.workspaceId,
      already: true,
    };
  await db.insert(memberships).values({
    userId: o.userId,
    workspaceId: inv.workspaceId,
    accountId: inv.accountId,
    role: inv.role,
  });
  await afterJoin({
    accountId: inv.accountId,
    workspaceId: inv.workspaceId,
    userId: o.userId,
    role: inv.role,
    invitedAt: inv.createdAt,
    newMember: true,
  });
  return { ok: true, slug: ws!.slug, role: inv.role, workspaceId: inv.workspaceId, already: false };
}
