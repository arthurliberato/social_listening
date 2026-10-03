"use server";

import { and, count, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accounts, db, invitations, memberships, queries, users } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { requireUser, userWorkspaces } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { inviteEmail, sendEmail } from "@/lib/email/service";
import { PLANS, can, type PlanTier } from "@/lib/entitlements/plans";
import { enqueueBackfill } from "@/lib/jobs/boss";
import { brandQuery } from "@/lib/query/generate";
import { estimateMentions } from "@/lib/query/estimate";

export type StepResult = { ok: true } | { ok: false; error: string };

const Roles = ["analyst", "social", "comms", "agency", "exec", "admin"] as const;
const Goals = ["brand_monitoring", "competitor", "campaign", "crisis", "research"] as const;

const BrandSchema = z.object({
  brandName: z.string().trim().min(1, "Enter your brand name").max(80),
  website: z.string().trim().max(200).optional().default(""),
  handles: z.array(z.string().trim().max(40)).max(5).default([]),
  competitors: z.array(z.string().trim().min(1).max(80)).max(3).default([]),
});

async function saveData(userId: string, patch: Record<string, unknown>, step: number) {
  const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]!;
  await db
    .update(users)
    .set({
      onboardingData: { ...(u.onboardingData as object), ...patch },
      onboardingStep: Math.max(u.onboardingStep, step),
    })
    .where(eq(users.id, userId));
}

export async function saveRole(role: string): Promise<StepResult> {
  const user = await requireUser();
  if (!(Roles as readonly string[]).includes(role))
    return { ok: false, error: "Pick the role that fits you best." };
  await db.update(users).set({ roleSelected: role }).where(eq(users.id, user.id));
  await saveData(user.id, {}, 1);
  return { ok: true };
}

export async function saveGoals(goals: string[]): Promise<StepResult> {
  const user = await requireUser();
  const clean = goals.filter((g): g is (typeof Goals)[number] =>
    (Goals as readonly string[]).includes(g),
  );
  await db.update(users).set({ goals: clean }).where(eq(users.id, user.id));
  await saveData(user.id, {}, 2);
  return { ok: true };
}

export async function saveBrand(input: unknown): Promise<StepResult> {
  const user = await requireUser();
  const parsed = BrandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  await saveData(user.id, { brand: parsed.data }, 3);
  return { ok: true };
}

/** Generated query + match estimate for step 4 (pre-filled from step 3: no re-typing). */
export async function getQueryPreview(): Promise<{
  booleanText: string;
  estimate: number;
  brandName: string;
}> {
  const user = await requireUser();
  const brand = (user.onboardingData as { brand?: z.infer<typeof BrandSchema> }).brand;
  if (!brand) redirect("/onboarding");
  const booleanText = brandQuery({ name: brand.brandName, handles: brand.handles });
  const estimate = await estimateMentions([
    brand.brandName,
    ...brand.handles.map((h) => h.replace(/^@/, "")),
  ]);
  return { booleanText, estimate, brandName: brand.brandName };
}

export async function saveFirstQuery(): Promise<StepResult & { queryId?: string }> {
  const user = await requireUser();
  const ws = (await userWorkspaces(user.id))[0]!;
  const brand = (user.onboardingData as { brand?: z.infer<typeof BrandSchema> }).brand;
  if (!brand) return { ok: false, error: "Add your brand first." };

  const acct = (await db.select().from(accounts).where(eq(accounts.id, ws.accountId)).limit(1))[0]!;
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(queries)
    .where(eq(queries.workspaceId, ws.id));
  const gate = can(acct.planTier as PlanTier, "create_query", {
    activeQueries: n,
    seats: 0,
    workspaces: 0,
    alerts: 0,
  });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const booleanText = brandQuery({ name: brand.brandName, handles: brand.handles });
  const [q] = await db
    .insert(queries)
    .values({
      workspaceId: ws.id,
      name: `${brand.brandName} (brand)`,
      booleanText,
      status: "live",
      createdBy: user.id,
    })
    .returning({ id: queries.id });
  await enqueueBackfill(q!.id);
  await saveData(user.id, { firstQueryId: q!.id }, 4);
  await trackServer(
    "Query Saved",
    { userId: user.id, workspaceId: ws.id },
    { query_id: q!.id, builder_mode: "guided", is_from_template: true, exclusion_count: 2 },
  );
  await trackServer(
    "Checklist Item Completed",
    { userId: user.id, workspaceId: ws.id },
    { item_id: "create_query", completed_count: 1 },
  );
  return { ok: true, queryId: q!.id };
}

export async function sendInvites(rawEmails: string[]): Promise<StepResult & { sent?: number }> {
  const user = await requireUser();
  const ws = (await userWorkspaces(user.id))[0]!;
  const acct = (await db.select().from(accounts).where(eq(accounts.id, ws.accountId)).limit(1))[0]!;
  const list = [...new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.every((e) => z.string().email().safeParse(e).success))
    return { ok: false, error: "One of those email addresses looks invalid." };

  const [{ members } = { members: 0 }] = await db
    .select({ members: count() })
    .from(memberships)
    .where(eq(memberships.accountId, ws.accountId));
  // Pending invitations hold a seat, so repeated calls can't exceed the plan's limit.
  const pending = await db
    .select({ email: invitations.email })
    .from(invitations)
    .where(
      and(
        eq(invitations.accountId, ws.accountId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  const alreadyInvited = new Set(pending.map((p) => p.email.toLowerCase()));
  let used = members + pending.length;
  let sent = 0;
  for (const email of list) {
    if (alreadyInvited.has(email)) continue;
    const gate = can(acct.planTier as PlanTier, "invite_member", {
      activeQueries: 0,
      seats: used,
      workspaces: 0,
      alerts: 0,
    });
    if (!gate.ok) {
      await trackServer(
        "Paywall Viewed",
        { userId: user.id, workspaceId: ws.id },
        { paywall_trigger: "seat_limit", required_plan: gate.upgradeTo },
      );
      return {
        ok: false,
        error: `${gate.reason} Upgrade to ${PLANS[gate.upgradeTo].label} to add more teammates.`,
        sent,
      };
    }
    const raw = randomBytes(24).toString("base64url");
    await db.insert(invitations).values({
      workspaceId: ws.id,
      accountId: ws.accountId,
      email,
      role: "editor",
      tokenHash: hashToken(raw),
      invitedBy: user.id,
      source: "onboarding",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    const m = inviteEmail({ inviter: user.name, workspace: ws.name, token: raw });
    await sendEmail({ to: email, type: "invite", subject: m.subject, text: m.text });
    await trackServer(
      "Teammate Invited",
      { userId: user.id, workspaceId: ws.id },
      { invited_role: "editor", invite_source: "onboarding" },
    );
    used++;
    sent++;
  }
  await saveData(user.id, {}, 5);
  if (sent)
    await trackServer(
      "Checklist Item Completed",
      { userId: user.id, workspaceId: ws.id },
      { item_id: "invite_teammate" },
    );
  return { ok: true, sent };
}

export async function completeOnboarding(durationMs: number): Promise<void> {
  const user = await requireUser();
  const ws = (await userWorkspaces(user.id))[0]!;
  if (!user.onboardingCompletedAt) {
    await db.update(users).set({ onboardingCompletedAt: new Date() }).where(eq(users.id, user.id));
    await trackServer(
      "Onboarding Completed",
      { userId: user.id, workspaceId: ws.id },
      { duration_ms: Math.round(durationMs) },
    );
  }
  redirect(`/w/${ws.slug}/home`);
}
