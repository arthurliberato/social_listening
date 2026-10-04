import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { accounts, db, invitations, memberships, users, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { hashToken, issueToken } from "@/lib/auth/tokens";
import { afterJoin } from "@/lib/team/invites";
import { hashPassword } from "@/lib/auth/password";
import { sendEmail, verifyEmail } from "@/lib/email/service";
import { TRIAL_DAYS } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import type { SimContext } from "@/lib/sim-context";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

export async function uniqueSlug(base: string): Promise<string> {
  const slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    if (
      !(
        await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.slug, candidate))
          .limit(1)
      )[0]
    )
      return candidate;
  }
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function findInvite(rawToken: string) {
  const row = (
    await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, hashToken(rawToken)),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1)
  )[0];
  return row ?? null;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  company: string;
  inviteToken?: string | null;
  attribution: Record<string, string>;
  sim: SimContext;
}

export type SignupResult =
  | { ok: true; userId: string }
  | { ok: false; error: "email_taken" | "invite_invalid" | "invite_email_mismatch" };

export async function createAccountAndUser(i: SignupInput): Promise<SignupResult> {
  const email = i.email.trim().toLowerCase();
  if (
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1)
    )[0]
  )
    return { ok: false, error: "email_taken" };

  const invite = i.inviteToken ? await findInvite(i.inviteToken) : null;
  if (i.inviteToken && !invite) return { ok: false, error: "invite_invalid" };
  if (invite && invite.email.toLowerCase() !== email)
    return { ok: false, error: "invite_email_mismatch" };

  const passwordHash = await hashPassword(i.password);
  const now = simNow();
  const out = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        name: i.name,
        attribution: i.attribution,
        isSynthetic: true,
        personaArchetype: i.sim.persona,
        agentRunId: i.sim.run,
        agentModel: i.sim.model,
        // Invited teammates arrive through an emailed link, which proves they own the address.
        emailVerifiedAt: invite ? now : null,
        onboardingCompletedAt: invite ? now : null,
      })
      .returning();
    if (invite) {
      await tx.insert(memberships).values({
        userId: user!.id,
        workspaceId: invite.workspaceId,
        accountId: invite.accountId,
        role: invite.role,
      });
      await tx.update(invitations).set({ acceptedAt: now }).where(eq(invitations.id, invite.id));
      const ws = (
        await tx
          .select({ slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.id, invite.workspaceId))
          .limit(1)
      )[0]!;
      return {
        user: user!,
        accountId: invite.accountId,
        workspaceId: invite.workspaceId,
        slug: ws.slug,
        invite,
      };
    }
    const [account] = await tx
      .insert(accounts)
      .values({
        name: i.company,
        trialStartAt: now,
        trialEndAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
      })
      .returning();
    const [ws] = await tx
      .insert(workspaces)
      .values({ accountId: account!.id, name: i.company, slug: await uniqueSlug(i.company) })
      .returning();
    await tx
      .insert(memberships)
      .values({ userId: user!.id, workspaceId: ws!.id, accountId: account!.id, role: "owner" });
    return {
      user: user!,
      accountId: account!.id,
      workspaceId: ws!.id,
      slug: ws!.slug,
      invite: null,
    };
  });

  await trackServer(
    "Sign Up Completed",
    { userId: out.user.id, accountId: out.accountId, workspaceId: out.workspaceId },
    {
      method: "password",
      signup_source:
        i.attribution.utm_source ?? i.attribution.referrer ?? (invite ? "invite" : "direct"),
    },
  );
  if (invite) {
    await afterJoin({
      accountId: out.accountId,
      workspaceId: out.workspaceId,
      userId: out.user.id,
      role: invite.role,
      invitedAt: invite.createdAt,
      newMember: true,
      now,
    });
  } else {
    await sendVerification(out.user.id, email);
  }
  return { ok: true, userId: out.user.id };
}

export async function sendVerification(userId: string, email: string) {
  const token = await issueToken(userId, "verify_email", 24 * 3600_000);
  const m = verifyEmail(token);
  await sendEmail({
    toUserId: userId,
    to: email,
    type: "verify_email",
    subject: m.subject,
    text: m.text,
  });
}
